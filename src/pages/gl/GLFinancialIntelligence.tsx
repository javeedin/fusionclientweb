import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Card, Row, Col, Select, Button, Spin,
  Divider, Input, Tag, Space, Alert, Breadcrumb, Statistic, Tooltip,
} from 'antd';
import {
  HomeOutlined, RobotOutlined, SendOutlined, LineChartOutlined,
  ThunderboltOutlined, WarningOutlined, BulbOutlined, SyncOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

const BASE  = APEX_DB_CONFIG.baseUrl;
const MODEL = 'claude-haiku-4-5';

// ── Fetch active Claude key from admin settings ────────────────────────────────
async function fetchActiveKey(): Promise<string> {
  const res  = await fetch(`${BASE}/settings/claudekey`);
  const data = await res.json();
  if (data.status === 'success' && data.apiKey) return data.apiKey as string;
  throw new Error(
    data.message ||
    'No active Claude API key found. Go to Administration → Claude AI Key Settings to add one.',
  );
}

// ── Claude streaming via browser fetch / SSE ──────────────────────────────────
async function streamClaude(
  apiKey: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onDone: () => void,
) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    onChunk(`⚠️ API error ${res.status}: ${await res.text()}`);
    onDone();
    return;
  }

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          onChunk(evt.delta.text);
        }
      } catch { /* ignore */ }
    }
  }
  onDone();
}

// ── Formatting ────────────────────────────────────────────────────────────────
function fmt(v: number) {
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
}

const SYSTEM_FINANCE = `You are a senior financial controller specialising in Oracle Fusion GL.
You analyse period balances, identify anomalies, and provide concise, actionable commentary.
Always structure your output clearly with headers and bullet points.
Currency is AED. Use professional finance language.`;

// ── Types ─────────────────────────────────────────────────────────────────────
interface TBRow {
  account:        string;
  company:        string;
  accountType:    string;
  description:    string;
  openingBalance: number;
  periodActivity: number;
  closingBalance: number;
}
interface ChatMessage { role: 'user' | 'assistant'; content: string; }

// ── Component ─────────────────────────────────────────────────────────────────
const GLFinancialIntelligence: React.FC = () => {
  // ── Selectors ───────────────────────────────────────────────────────────────
  const [ledgers,        setLedgers]        = useState<string[]>([]);
  const [companies,      setCompanies]      = useState<string[]>([]);
  const [periods,        setPeriods]        = useState<string[]>([]);
  const [ledger,         setLedger]         = useState('');
  const [company,        setCompany]        = useState('');
  const [period,         setPeriod]         = useState('');
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);

  // ── Analysis ─────────────────────────────────────────────────────────────────
  const [tbData,        setTbData]        = useState<TBRow[]>([]);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [analysisText,  setAnalysisText]  = useState('');
  const [keyError,      setKeyError]      = useState('');

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load ledgers on mount ────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingLedgers(true);
    fetch(`${BASE}/${APEX_DB_CONFIG.endpoints.getLedgerName}`)
      .then(r => r.json())
      .then(d => {
        const names: string[] = (d.items ?? []).map((r: Record<string, unknown>) => r.ledger_name as string).filter(Boolean);
        setLedgers(names);
        if (names.length > 0) setLedger(names[0]);
      })
      .catch(() => {})
      .finally(() => setLoadingLedgers(false));
  }, []);

  // ── When ledger changes → load periods + companies ───────────────────────────
  const loadPeriodsAndCompanies = useCallback(async (l: string) => {
    if (!l) return;
    setLoadingPeriods(true);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(`${BASE}/${APEX_DB_CONFIG.endpoints.rrTrialBalancePeriods}?ledger_name=${encodeURIComponent(l)}`),
        fetch(`${BASE}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceCompanies}?ledger_name=${encodeURIComponent(l)}`),
      ]);
      const pData = await pRes.json();
      const cData = await cRes.json();

      const pNames: string[] = (pData.items ?? []).map((r: Record<string, unknown>) => r.period_name as string).filter(Boolean);
      const cNames: string[] = (cData.items ?? []).map((r: Record<string, unknown>) => r.company as string).filter(Boolean);

      setPeriods(pNames);
      setCompanies(cNames);
      if (pNames.length > 0) setPeriod(pNames[0]);
      setCompany('');
    } catch { /* silent */ }
    finally { setLoadingPeriods(false); }
  }, []);

  useEffect(() => {
    if (ledger) loadPeriodsAndCompanies(ledger);
  }, [ledger, loadPeriodsAndCompanies]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // ── Fetch trial balance data ──────────────────────────────────────────────────
  async function fetchTBData(): Promise<TBRow[]> {
    const params = new URLSearchParams({ ledger_name: ledger, limit: '10000' });
    if (period)  params.set('period_name', period);
    if (company) params.set('company', company);
    const res  = await fetch(`${BASE}/${APEX_DB_CONFIG.endpoints.rrTrialBalance}?${params}`);
    const data = await res.json();
    return (data.items ?? []).map((r: Record<string, unknown>) => {
      const openDr = Number(r.opening_dr ?? 0);
      const openCr = Number(r.opening_cr ?? 0);
      const ptdDr  = Number(r.ptd_dr  ?? 0);
      const ptdCr  = Number(r.ptd_cr  ?? 0);
      const closDr = Number(r.closing_dr ?? 0);
      const closCr = Number(r.closing_cr ?? 0);
      return {
        account:        (r.account        ?? '') as string,
        company:        (r.company        ?? '') as string,
        accountType:    (r.account_type   ?? '') as string,
        description:    (r.account_desc   ?? '') as string,
        openingBalance: openDr - openCr,
        periodActivity: ptdDr  - ptdCr,
        closingBalance: closDr - closCr,
      };
    });
  }

  // ── Analyse period ────────────────────────────────────────────────────────────
  async function handleAnalyse() {
    if (!ledger || !period) return;
    setAnalyzing(true);
    setAnalysisText('');
    setKeyError('');

    let apiKey = '';
    try { apiKey = await fetchActiveKey(); }
    catch (e: unknown) { setKeyError(e instanceof Error ? e.message : String(e)); setAnalyzing(false); return; }

    let rows: TBRow[] = [];
    try { rows = await fetchTBData(); setTbData(rows); }
    catch { setAnalysisText('⚠️ Could not load GL data. Check ORDS connectivity.'); setAnalyzing(false); return; }

    const byType = rows.reduce<Record<string, { opening: number; activity: number; closing: number }>>((acc, r) => {
      const t = r.accountType || 'Unknown';
      if (!acc[t]) acc[t] = { opening: 0, activity: 0, closing: 0 };
      acc[t].opening  += r.openingBalance;
      acc[t].activity += r.periodActivity;
      acc[t].closing  += r.closingBalance;
      return acc;
    }, {});

    const topMovers = [...rows]
      .sort((a, b) => Math.abs(b.periodActivity) - Math.abs(a.periodActivity))
      .slice(0, 12);

    const totalActivity = rows.reduce((s, r) => s + r.periodActivity, 0);

    const prompt = `Analyse the following Oracle Fusion GL trial balance data.

Ledger: ${ledger}
Company: ${company || 'All companies'}
Period: ${period}
Currency: AED
Total accounts with activity: ${rows.length}
Net period activity: AED ${fmt(totalActivity)}

## Balance by account type
${Object.entries(byType).map(([t, v]) =>
  `${t}: Opening ${fmt(v.opening)} | Activity ${fmt(v.activity)} | Closing ${fmt(v.closing)}`
).join('\n')}

## Top 12 accounts by period activity magnitude
${topMovers.map(r =>
  `${r.account} (${r.accountType}) ${r.description ? '– ' + r.description : ''} | Opening: ${fmt(r.openingBalance)} | Activity: ${fmt(r.periodActivity)} | Closing: ${fmt(r.closingBalance)}`
).join('\n')}

Please provide:
1. **Period Overview** – brief narrative of the period's financial activity
2. **Key Movements** – significant account movements and their likely business meaning
3. **Balance Sheet & P&L Health** – comment on asset, liability, equity, revenue, and expense balances
4. **Anomalies & Risks** – unusual patterns (large swings, sign reversals, unexpected account types)
5. **Recommendations** – 3–5 specific actions for the finance team`;

    let result = '';
    await streamClaude(
      apiKey,
      [{ role: 'user', content: prompt }],
      SYSTEM_FINANCE,
      chunk => { result += chunk; setAnalysisText(result); },
      () => setAnalyzing(false),
    );
  }

  // ── Chat send ─────────────────────────────────────────────────────────────────
  async function handleChatSend() {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput('');
    setKeyError('');

    let apiKey = '';
    try { apiKey = await fetchActiveKey(); }
    catch (e: unknown) { setKeyError(e instanceof Error ? e.message : String(e)); return; }

    const userMsg: ChatMessage = { role: 'user', content: q };
    setChatMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    const ctx = tbData.length > 0
      ? `GL data loaded — Ledger: ${ledger}, Company: ${company || 'All'}, Period: ${period}, ${tbData.length} account rows.`
      : 'No GL data loaded yet.';

    const history = [...chatMessages, userMsg].map(m => ({ role: m.role, content: m.content }));

    let reply = '';
    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    await streamClaude(
      apiKey,
      history,
      `${SYSTEM_FINANCE}\n\nContext: ${ctx}`,
      chunk => {
        reply += chunk;
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: reply };
          return updated;
        });
      },
      () => setChatLoading(false),
    );
  }

  // ── KPI summary ───────────────────────────────────────────────────────────────
  const totalActivity = tbData.reduce((s, r) => s + r.periodActivity, 0);
  const anomalyCount  = tbData.filter(r => {
    const swing = Math.abs(r.periodActivity);
    const base  = Math.abs(r.openingBalance) || 1;
    return swing / base > 2 && swing > 100_000;
  }).length;

  const canAnalyse = !!ledger && !!period;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Content style={{ padding: '24px' }}>

        <Breadcrumb style={{ marginBottom: 16 }} items={[
          { title: <Link to="/home"><HomeOutlined /> Home</Link> },
          { title: <Link to="/gl">General Ledger</Link> },
          { title: 'Financial Intelligence' },
        ]} />

        {/* ── Header ── */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <RobotOutlined style={{ fontSize: 24, color: '#fff' }} />
          </div>
          <div style={{ flex: 1 }}>
            <Title level={3} style={{ margin: 0 }}>Financial Intelligence</Title>
            <Text type="secondary">AI-powered GL analysis · Claude {MODEL}</Text>
          </div>
          <Tag color="purple">Beta</Tag>
          <Tooltip title="Claude AI Key Settings">
            <Link to="/admin/claude-key">
              <Button icon={<SettingOutlined />} style={{ color: '#764ba2', borderColor: '#764ba2' }}>
                AI Key
              </Button>
            </Link>
          </Tooltip>
        </div>

        {/* ── Key error banner ── */}
        {keyError && (
          <Alert
            type="warning" showIcon icon={<WarningOutlined />}
            message="Claude API key not available"
            description={<span>{keyError}&nbsp;<Link to="/admin/claude-key">Go to Claude AI Key Settings →</Link></span>}
            closable onClose={() => setKeyError('')}
            style={{ marginBottom: 24 }}
          />
        )}

        {/* ── Filter bar ── */}
        <Card style={{ marginBottom: 24, borderRadius: 12 }}>
          <Row gutter={12} align="middle" wrap>
            <Col>
              <Text strong style={{ fontSize: 13 }}>Ledger</Text>
            </Col>
            <Col flex="200px">
              <Select
                style={{ width: '100%' }}
                placeholder="Select ledger"
                loading={loadingLedgers}
                value={ledger || undefined}
                onChange={v => { setLedger(v); setCompany(''); setPeriod(''); setTbData([]); setAnalysisText(''); }}
                options={ledgers.map(l => ({ value: l, label: l }))}
              />
            </Col>

            <Col>
              <Text strong style={{ fontSize: 13 }}>Company</Text>
            </Col>
            <Col flex="160px">
              <Select
                style={{ width: '100%' }}
                placeholder="All companies"
                allowClear
                loading={loadingPeriods}
                value={company || undefined}
                onChange={v => setCompany(v ?? '')}
                options={companies.map(c => ({ value: c, label: c }))}
              />
            </Col>

            <Col>
              <Text strong style={{ fontSize: 13 }}>Period</Text>
            </Col>
            <Col flex="160px">
              <Select
                style={{ width: '100%' }}
                placeholder="Select period"
                loading={loadingPeriods}
                value={period || undefined}
                onChange={setPeriod}
                options={periods.map(p => ({ value: p, label: p }))}
              />
            </Col>

            <Col>
              <Button
                type="primary"
                icon={analyzing ? <SyncOutlined spin /> : <ThunderboltOutlined />}
                loading={analyzing}
                disabled={!canAnalyse}
                onClick={handleAnalyse}
                style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', border: 'none' }}
              >
                Analyse Period
              </Button>
            </Col>
          </Row>
        </Card>

        {/* ── KPI row ── */}
        {tbData.length > 0 && (
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={8}>
              <Card style={{ borderRadius: 12, textAlign: 'center' }}>
                <Statistic
                  title="Accounts with Activity"
                  value={tbData.length}
                  prefix={<LineChartOutlined />}
                  valueStyle={{ color: '#667eea' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card style={{ borderRadius: 12, textAlign: 'center' }}>
                <Statistic
                  title="Net Period Activity (AED)"
                  value={Math.abs(totalActivity)}
                  precision={2}
                  prefix={totalActivity < 0 ? '(' : ''}
                  suffix={totalActivity < 0 ? ')' : ''}
                  valueStyle={{ color: totalActivity < 0 ? '#cf1322' : '#3f8600' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card style={{ borderRadius: 12, textAlign: 'center' }}>
                <Statistic
                  title="Potential Anomalies"
                  value={anomalyCount}
                  prefix={<WarningOutlined />}
                  valueStyle={{ color: anomalyCount > 0 ? '#fa8c16' : '#3f8600' }}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Row gutter={24}>
          {/* ── AI Analysis panel ── */}
          <Col xs={24} lg={14}>
            <Card
              title={<Space><BulbOutlined style={{ color: '#667eea' }} /><span>Period Analysis</span></Space>}
              style={{ borderRadius: 12, minHeight: 440 }}
            >
              {analyzing && !analysisText && (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <Spin size="large" />
                  <div style={{ marginTop: 16, color: '#888' }}>Loading GL data and generating analysis…</div>
                </div>
              )}
              {!analyzing && !analysisText && (
                <div style={{ textAlign: 'center', padding: 48, color: '#bbb' }}>
                  <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                  <div>Select a <strong>Ledger</strong>, <strong>Company</strong>, and <strong>Period</strong>, then click <strong>Analyse Period</strong></div>
                </div>
              )}
              {analysisText && (
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 14, color: '#1a1a1a' }}>
                  {analysisText}
                  {analyzing && (
                    <span style={{
                      display: 'inline-block', width: 2, height: 14,
                      background: '#667eea', marginLeft: 2,
                      animation: 'blink 1s step-end infinite',
                    }} />
                  )}
                </div>
              )}
            </Card>
          </Col>

          {/* ── AI Chat panel ── */}
          <Col xs={24} lg={10}>
            <Card
              title={<Space><RobotOutlined style={{ color: '#764ba2' }} /><span>Ask the AI</span></Space>}
              style={{ borderRadius: 12, minHeight: 440 }}
              styles={{ body: { display: 'flex', flexDirection: 'column', height: 540 } }}
            >
              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                {chatMessages.length === 0 && (
                  <div style={{ color: '#bbb', textAlign: 'center', paddingTop: 40 }}>
                    <RobotOutlined style={{ fontSize: 32, marginBottom: 8 }} />
                    <div>Ask anything about your GL data</div>
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      e.g. "Why is account 21100 showing a large credit?" or "Summarise period activity"
                    </div>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: 12,
                  }}>
                    <div style={{
                      maxWidth: '85%',
                      padding: '10px 14px',
                      borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: m.role === 'user'
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : '#f5f5f5',
                      color: m.role === 'user' ? '#fff' : '#1a1a1a',
                      fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    }}>
                      {m.content || <Spin size="small" />}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <Divider style={{ margin: '8px 0 12px' }} />

              <div style={{ display: 'flex', gap: 8 }}>
                <TextArea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                  placeholder="Ask a financial question… (Enter to send)"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  style={{ flex: 1, borderRadius: 8 }}
                  disabled={chatLoading}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleChatSend}
                  loading={chatLoading}
                  disabled={!chatInput.trim()}
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    border: 'none', borderRadius: 8,
                  }}
                />
              </div>
            </Card>
          </Col>
        </Row>

        <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      </Content>
    </Layout>
  );
};

export default GLFinancialIntelligence;
