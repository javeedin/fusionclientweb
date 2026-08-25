import React, { useState, useCallback, useMemo } from 'react';
import {
  Layout, Typography, Breadcrumb, Card, Row, Col, Tabs, Input, Button, Table, Tag,
  Statistic, Alert, Space, message, Tooltip, Select,
} from 'antd';
import {
  HomeOutlined, RobotOutlined, PlayCircleOutlined, CopyOutlined,
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined, ApiOutlined,
  ExperimentOutlined, DollarOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { STUDIO_WORKFLOWS, StudioWorkflow } from '../../data/fusionAiStudioCatalog';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface TBRow {
  account_combination: string;
  account_desc: string;
  account_type: string;
  opening: number; debit: number; credit: number; closing: number;
}

interface PeriodStatusRow { application: string; status: string; error?: string }
interface VarianceRow {
  account: string; description: string; current: number; prior: number; change: number;
  pctChange: number | null; newAccount?: boolean; droppedAccount?: boolean;
}
interface ClearingRow { account: string; description: string; opening: number; debit: number; credit: number; closing: number }

interface CloseReview {
  periodStatuses: PeriodStatusRow[];
  accountCount: number;
  totals: { opening: number; debit: number; credit: number; closing: number };
  debitsEqualCredits: boolean;
  drCrDifference: number;
  netClosingGap: number;
  topMovers: VarianceRow[];
  clearing: ClearingRow[];
  verdict: 'Ready' | 'Ready with exceptions' | 'Not ready';
  verdictReasons: string[];
}

async function fetchTB(ledger: string, period: string): Promise<TBRow[]> {
  const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandard}`
    + `?ledger_name=${encodeURIComponent(ledger)}&period_name=${encodeURIComponent(period)}&limit=10000`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Trial balance HTTP ${res.status} for ${period}`);
  const data = await res.json();
  return (data.items || []) as TBRow[];
}

async function fetchPeriodStatuses(ledger: string, period: string): Promise<PeriodStatusRow[]> {
  const apps = ['General Ledger', 'Payables', 'Receivables'];
  return Promise.all(apps.map(async (app) => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.periodsStatus}`
        + `?P_APPLICATION_NAME=${encodeURIComponent(app)}&P_LEDGER_NAME=${encodeURIComponent(ledger)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = data.items || [];
      const match = items.find((r) => String(r.period_name_id || r.period_name || '') === period);
      return { application: app, status: match ? String(match.status || '?') : 'Period not found' };
    } catch (e: any) {
      return { application: app, status: 'error', error: e.message };
    }
  }));
}

function runChecks(cur: TBRow[], prev: TBRow[], statuses: PeriodStatusRow[]): CloseReview {
  let opening = 0, debit = 0, credit = 0, closing = 0;
  for (const r of cur) {
    opening += Number(r.opening) || 0;
    debit += Number(r.debit) || 0;
    credit += Number(r.credit) || 0;
    closing += Number(r.closing) || 0;
  }
  const drCrDifference = Math.round((debit - credit) * 100) / 100;
  const netClosingGap = Math.round(closing * 100) / 100;

  const prevMap = new Map(prev.map((r) => [r.account_combination, r]));
  const seen = new Set<string>();
  const movers: VarianceRow[] = [];
  for (const r of cur) {
    seen.add(r.account_combination);
    const p = prevMap.get(r.account_combination);
    const change = (Number(r.closing) || 0) - (p ? Number(p.closing) || 0 : 0);
    if (Math.abs(change) >= 0.01) {
      movers.push({
        account: r.account_combination, description: r.account_desc,
        current: Number(r.closing) || 0, prior: p ? Number(p.closing) || 0 : 0, change,
        pctChange: p && Number(p.closing) !== 0 ? (change / Math.abs(Number(p.closing))) * 100 : null,
        newAccount: !p,
      });
    }
  }
  for (const p of prev) {
    if (!seen.has(p.account_combination) && Math.abs(Number(p.closing) || 0) >= 0.01) {
      movers.push({
        account: p.account_combination, description: p.account_desc,
        current: 0, prior: Number(p.closing) || 0, change: -(Number(p.closing) || 0),
        pctChange: -100, droppedAccount: true,
      });
    }
  }
  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const clearing: ClearingRow[] = cur
    .filter((r) => {
      const d = String(r.account_desc || '').toLowerCase();
      return d.includes('clearing') || d.includes('suspense');
    })
    .filter((r) => Math.abs(Number(r.closing) || 0) >= 0.01)
    .sort((a, b) => Math.abs(Number(b.closing) || 0) - Math.abs(Number(a.closing) || 0))
    .map((r) => ({
      account: r.account_combination, description: r.account_desc,
      opening: Number(r.opening) || 0, debit: Number(r.debit) || 0,
      credit: Number(r.credit) || 0, closing: Number(r.closing) || 0,
    }));

  const reasons: string[] = [];
  if (Math.abs(drCrDifference) >= 0.01) reasons.push(`Debits and credits differ by ${fmt(drCrDifference)}`);
  if (Math.abs(netClosingGap) >= 0.01) reasons.push(`Closing balances net to ${fmt(netClosingGap)} instead of zero`);
  if (clearing.length) reasons.push(`${clearing.length} clearing/suspense account(s) still carry a balance`);
  const statusIssues = statuses.filter((s) => s.status === 'error' || s.status === 'Period not found');
  if (statusIssues.length) reasons.push(`Period status unavailable for ${statusIssues.map((s) => s.application).join(', ')}`);

  let verdict: CloseReview['verdict'] = 'Ready';
  if (Math.abs(drCrDifference) >= 0.01) verdict = 'Not ready';
  else if (reasons.length) verdict = 'Ready with exceptions';

  return {
    periodStatuses: statuses, accountCount: cur.length,
    totals: { opening, debit, credit, closing },
    debitsEqualCredits: Math.abs(drCrDifference) < 0.01,
    drCrDifference, netClosingGap,
    topMovers: movers.slice(0, 15), clearing,
    verdict, verdictReasons: reasons,
  };
}

// ── Static reference data (from oracle/fusion-ai-studio, branch release-26C) ──
const CATALOG = [
  { area: 'Finance — Ledger Insights', wf: 9, bo: 13, apps: 'Ledger Insights close workspace', note: 'Mostly internal BOSS services — replicated here via Re-ERP ORDS' },
  { area: 'SCM — Cost Mgmt / Inventory / Maintenance', wf: 11, bo: 14, apps: '—', note: 'Public Fusion REST' },
  { area: 'Procurement — Purchasing', wf: 6, bo: 4, apps: '—', note: 'Public + Redwood search APIs' },
  { area: 'HCM — 12 areas', wf: 83, bo: 39, apps: 'Attrition Analysis, Succession workspaces', note: 'Overwhelmingly public REST' },
];

const SERVICE_SUMMARY = [
  { verdict: 'YES — public REST', bos: 41, wfs: 44, color: REDWOOD.success, desc: 'Documented fscmRestApi / hcmRestApi resources; callable today with Basic auth' },
  { verdict: 'CAUTION — undocumented', bos: 18, wfs: 50, color: '#9A6A00', desc: 'Redwood/search/OTBI APIs behind Oracle UIs; reachable but unsupported — re-verify each release' },
  { verdict: 'NO — internal platform', bos: 11, wfs: 5, color: REDWOOD.primary, desc: 'BOSS / insights platform services for the Fusion agentic framework only — we replace with ORDS' },
  { verdict: 'Mixed / no service', bos: 0, wfs: 8, color: REDWOOD.neutral600, desc: 'Workflows mixing categories, or pure LLM/code logic' },
];

const VERDICT_META: Record<StudioWorkflow['verdict'], { label: string; color: string; explain: string }> = {
  public:   { label: 'Public REST',   color: 'green',   explain: 'Every service this workflow needs is documented Fusion REST — we can call the same APIs from our MCP servers today with Basic auth.' },
  caution:  { label: 'Undocumented',  color: 'gold',    explain: 'Uses Redwood/search/OTBI APIs that back Oracle’s own UIs. They work with normal auth but are unsupported externally — usable with a re-verify-each-release policy.' },
  internal: { label: 'Internal only', color: 'red',     explain: 'Runs on BOSS/platform services built for the Fusion agentic framework. Not callable from outside — we replicate the design against our own ORDS endpoints instead.' },
  mixed:    { label: 'Mixed',         color: 'orange',  explain: 'Combines public REST with at least one internal service — partially replicable directly; the internal part needs an ORDS replacement.' },
  none:     { label: 'No service',    color: 'default', explain: 'Pure LLM/code logic — no external web service. The prompt/orchestration design is directly reusable.' },
};

const WorkflowCatalog: React.FC = () => {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string | undefined>();
  const [verdictFilter, setVerdictFilter] = useState<StudioWorkflow['verdict'] | undefined>();

  const modules = useMemo(() => [...new Set(STUDIO_WORKFLOWS.map((w) => w.module))], []);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return STUDIO_WORKFLOWS.filter((w) => {
      if (moduleFilter && w.module !== moduleFilter) return false;
      if (verdictFilter && w.verdict !== verdictFilter) return false;
      if (!term) return true;
      return w.name.toLowerCase().includes(term)
        || w.description.toLowerCase().includes(term)
        || w.area.toLowerCase().includes(term)
        || w.services.some((s) => s.toLowerCase().includes(term));
    });
  }, [search, moduleFilter, verdictFilter]);

  return (
    <Card style={{ borderRadius: 12 }}>
      <Paragraph>
        All <Text strong>{STUDIO_WORKFLOWS.length} sample workflows</Text> in Oracle&apos;s AI Agent Studio repository
        (<Text code>oracle/fusion-ai-studio</Text>, release-26C), with what each does and the web services behind it.
        Expand a row for the full explanation, business objects, and service endpoints.
      </Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search allowClear placeholder="Search workflows, descriptions, services…"
          style={{ width: 320 }} onSearch={setSearch} onChange={(e) => !e.target.value && setSearch('')} />
        <Select allowClear placeholder="Module" style={{ width: 130 }} value={moduleFilter}
          onChange={setModuleFilter}
          options={modules.map((m) => ({ value: m, label: m }))} />
        <Select allowClear placeholder="Callability" style={{ width: 170 }} value={verdictFilter}
          onChange={setVerdictFilter}
          options={(Object.keys(VERDICT_META) as StudioWorkflow['verdict'][]).map((v) => ({
            value: v, label: VERDICT_META[v].label,
          }))} />
        <Text type="secondary">{filtered.length} of {STUDIO_WORKFLOWS.length} workflows</Text>
      </Space>
      <Table<StudioWorkflow>
        dataSource={filtered}
        rowKey={(w) => `${w.area}/${w.name}`}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: false }}
        columns={[
          { title: 'Module', dataIndex: 'module', width: 80,
            render: (m: string) => <Tag>{m}</Tag> },
          { title: 'Area', dataIndex: 'area', width: 170 },
          { title: 'Workflow', dataIndex: 'name', width: 260, render: (v: string) => <Text strong>{v}</Text> },
          { title: 'What it does', dataIndex: 'description', ellipsis: true },
          { title: 'Can we call it?', dataIndex: 'verdict', width: 140,
            filters: undefined,
            render: (v: StudioWorkflow['verdict']) => (
              <Tooltip title={VERDICT_META[v].explain}>
                <Tag color={VERDICT_META[v].color}>{VERDICT_META[v].label}</Tag>
              </Tooltip>
            ) },
        ]}
        expandable={{
          expandedRowRender: (w) => (
            <div style={{ padding: '4px 8px' }}>
              <Paragraph style={{ marginBottom: 8 }}>{w.description}</Paragraph>
              <Paragraph style={{ marginBottom: 8 }}>
                <Text type="secondary">{VERDICT_META[w.verdict].explain}</Text>
              </Paragraph>
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 12 }}>Business objects: </Text>
                {w.businessObjects.length
                  ? w.businessObjects.map((b) => <Tag key={b} style={{ marginBottom: 4 }}>{b}</Tag>)
                  : <Text type="secondary">none — LLM/code logic only</Text>}
              </div>
              <div>
                <Text strong style={{ fontSize: 12 }}>Web services: </Text>
                {w.services.length
                  ? (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                      {w.services.map((s) => <li key={s}><Text code style={{ fontSize: 12 }}>{s}</Text></li>)}
                    </ul>
                  )
                  : <Text type="secondary">no external service</Text>}
              </div>
            </div>
          ),
        }}
      />
    </Card>
  );
};

const OracleFusionAI: React.FC = () => {
  const [ledger, setLedger] = useState('BUIMERC LEDGER');
  const [period, setPeriod] = useState('');
  const [priorPeriod, setPriorPeriod] = useState('');
  const [running, setRunning] = useState(false);
  const [review, setReview] = useState<CloseReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runReview = useCallback(async () => {
    if (!period.trim() || !priorPeriod.trim()) {
      message.warning('Enter both the period and the prior period (e.g., Jul-26 and Jun-26)');
      return;
    }
    setRunning(true); setError(null); setReview(null);
    try {
      const [cur, prev, statuses] = await Promise.all([
        fetchTB(ledger.trim(), period.trim()),
        fetchTB(ledger.trim(), priorPeriod.trim()),
        fetchPeriodStatuses(ledger.trim(), period.trim()),
      ]);
      if (!cur.length) throw new Error(`No trial balance rows for ${period} — check the period name`);
      setReview(runChecks(cur, prev, statuses));
    } catch (e: any) {
      setError(e.message || 'Close review failed');
    } finally {
      setRunning(false);
    }
  }, [ledger, period, priorPeriod]);

  const copyClaudePrompt = useCallback(() => {
    const p = period.trim() || '<period>';
    const pp = priorPeriod.trim() || '<prior period>';
    navigator.clipboard.writeText(
      `Run a period close review for ledger "${ledger.trim()}", period "${p}": call getPeriodStatus, getTrialBalanceHealth, getVarianceVsPriorPeriod (vs "${pp}") and getClearingAccountBalances, then give me an executive close summary with a readiness verdict and a prioritized action list.`
    );
    message.success('Prompt copied — paste it into Claude Desktop (gl-server must be connected)');
  }, [ledger, period, priorPeriod]);

  const verdictTag = (v: CloseReview['verdict']) =>
    v === 'Ready'
      ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ fontSize: 14, padding: '4px 12px' }}>Ready</Tag>
      : v === 'Ready with exceptions'
        ? <Tag icon={<WarningOutlined />} color="warning" style={{ fontSize: 14, padding: '4px 12px' }}>Ready with exceptions</Tag>
        : <Tag icon={<CloseCircleOutlined />} color="error" style={{ fontSize: 14, padding: '4px 12px' }}>Not ready</Tag>;

  const statusTag = (s: string) =>
    s.toLowerCase().includes('open') ? <Tag color="green">{s}</Tag>
      : s === 'error' || s === 'Period not found' ? <Tag color="red">{s}</Tag>
        : <Tag color="blue">{s}</Tag>;

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Administration</Link> },
            { title: 'Oracle Fusion AI' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12,
              background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #A33B2C 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RobotOutlined style={{ fontSize: 28, color: '#fff' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0 }}>Oracle Fusion AI</Title>
              <Text type="secondary">
                Period Close Copilot (modeled on Oracle's AI Agent Studio "Ledger Insights") plus the Agent Studio capability map.
              </Text>
            </div>
          </div>

          <Tabs
            defaultActiveKey="copilot"
            items={[
              {
                key: 'copilot',
                label: <span><ExperimentOutlined /> Period Close Copilot</span>,
                children: (
                  <>
                    <Card style={{ borderRadius: 12, marginBottom: 16 }}>
                      <Space wrap size="middle">
                        <div>
                          <Text strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Ledger</Text>
                          <Input value={ledger} onChange={(e) => setLedger(e.target.value)} style={{ width: 220 }} />
                        </div>
                        <div>
                          <Text strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Period</Text>
                          <Input placeholder="Jul-26" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 120 }} />
                        </div>
                        <div>
                          <Text strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Prior period</Text>
                          <Input placeholder="Jun-26" value={priorPeriod} onChange={(e) => setPriorPeriod(e.target.value)} style={{ width: 120 }} />
                        </div>
                        <div style={{ paddingTop: 20 }}>
                          <Space>
                            <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={runReview}
                              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                              Run Close Review
                            </Button>
                            <Tooltip title="Copy the same review as a prompt for Claude Desktop (gl-server /close-review)">
                              <Button icon={<CopyOutlined />} onClick={copyClaudePrompt}>Copy Claude prompt</Button>
                            </Tooltip>
                          </Space>
                        </div>
                      </Space>
                      <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                        Four checks run in parallel: period status per application (GL/AP/AR), trial-balance health
                        (debits = credits, net closing gap), balance variance vs the prior period, and clearing/suspense
                        accounts still carrying balances. The same checks are available in Claude Desktop as gl-server
                        tools and the <Text code>/close-review</Text> prompt.
                      </Paragraph>
                    </Card>

                    {error && <Alert type="error" showIcon message="Close review failed" description={error} style={{ marginBottom: 16 }} />}

                    {review && (
                      <>
                        <Card style={{ borderRadius: 12, marginBottom: 16 }}>
                          <Space size="large" wrap>
                            <div>
                              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Readiness verdict</Text>
                              {verdictTag(review.verdict)}
                            </div>
                            {review.periodStatuses.map((s) => (
                              <div key={s.application}>
                                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{s.application}</Text>
                                {statusTag(s.status)}
                              </div>
                            ))}
                          </Space>
                          {review.verdictReasons.length > 0 && (
                            <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 20 }}>
                              {review.verdictReasons.map((r, i) => (
                                <li key={i}><Text>{r}</Text></li>
                              ))}
                            </ul>
                          )}
                        </Card>

                        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                          <Col xs={12} md={6}><Card style={{ borderRadius: 12 }}><Statistic title="Accounts" value={review.accountCount} /></Card></Col>
                          <Col xs={12} md={6}><Card style={{ borderRadius: 12 }}><Statistic title="Total debits" value={fmt(review.totals.debit)} /></Card></Col>
                          <Col xs={12} md={6}><Card style={{ borderRadius: 12 }}><Statistic title="Total credits" value={fmt(review.totals.credit)} /></Card></Col>
                          <Col xs={12} md={6}>
                            <Card style={{ borderRadius: 12 }}>
                              <Statistic title="Net closing gap" value={fmt(review.netClosingGap)}
                                valueStyle={{ color: Math.abs(review.netClosingGap) < 0.01 ? REDWOOD.success : REDWOOD.primary }} />
                            </Card>
                          </Col>
                        </Row>

                        <Card title="Top balance movements vs prior period" style={{ borderRadius: 12, marginBottom: 16 }}>
                          <Table<VarianceRow>
                            dataSource={review.topMovers} rowKey="account" size="small" pagination={false}
                            columns={[
                              { title: 'Account', dataIndex: 'account', width: 200, render: (v, r) => (
                                <span>{v} {r.newAccount && <Tag color="blue">new</Tag>}{r.droppedAccount && <Tag>dropped</Tag>}</span>) },
                              { title: 'Description', dataIndex: 'description', ellipsis: true },
                              { title: 'Prior closing', dataIndex: 'prior', align: 'right', width: 140, render: fmt },
                              { title: 'Current closing', dataIndex: 'current', align: 'right', width: 140, render: fmt },
                              { title: 'Change', dataIndex: 'change', align: 'right', width: 140,
                                render: (v: number) => <Text strong style={{ color: v >= 0 ? REDWOOD.success : REDWOOD.primary }}>{fmt(v)}</Text> },
                              { title: '%', dataIndex: 'pctChange', align: 'right', width: 90,
                                render: (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`) },
                            ]}
                          />
                        </Card>

                        <Card title={`Clearing / suspense accounts with balances (${review.clearing.length})`} style={{ borderRadius: 12 }}>
                          {review.clearing.length === 0
                            ? <Alert type="success" showIcon message="All clearing and suspense accounts are at zero." />
                            : (
                              <Table<ClearingRow>
                                dataSource={review.clearing} rowKey="account" size="small" pagination={false}
                                columns={[
                                  { title: 'Account', dataIndex: 'account', width: 200 },
                                  { title: 'Description', dataIndex: 'description', ellipsis: true },
                                  { title: 'Opening', dataIndex: 'opening', align: 'right', width: 130, render: fmt },
                                  { title: 'Debit', dataIndex: 'debit', align: 'right', width: 130, render: fmt },
                                  { title: 'Credit', dataIndex: 'credit', align: 'right', width: 130, render: fmt },
                                  { title: 'Closing', dataIndex: 'closing', align: 'right', width: 130,
                                    render: (v: number) => <Text strong style={{ color: REDWOOD.primary }}>{fmt(v)}</Text> },
                                ]}
                              />
                            )}
                        </Card>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'catalog',
                label: <span><DollarOutlined /> Oracle's Agent Studio</span>,
                children: (
                  <>
                    <Card style={{ borderRadius: 12, marginBottom: 16 }}>
                      <Paragraph>
                        <Text strong>AI Agent Studio</Text> is Oracle's design-time platform for building agentic apps inside
                        Fusion Cloud. Its public sample repository (<Text code>oracle/fusion-ai-studio</Text>, branch
                        release-26C) ships <Text strong>107 workflows, 70 business objects and 4 ready-made apps</Text>.
                        Running them requires a Fusion pod (26B/26C) with Agent Studio enabled — the designs, however,
                        are UPL-licensed and replicated here on our own stack.
                      </Paragraph>
                      <Table
                        dataSource={CATALOG} rowKey="area" size="small" pagination={false}
                        columns={[
                          { title: 'Area', dataIndex: 'area' },
                          { title: 'Workflows', dataIndex: 'wf', align: 'right', width: 100 },
                          { title: 'Business objects', dataIndex: 'bo', align: 'right', width: 130 },
                          { title: 'Ready-made apps', dataIndex: 'apps', width: 260 },
                          { title: 'Services', dataIndex: 'note' },
                        ]}
                      />
                      <Alert
                        style={{ marginTop: 16 }} type="info" showIcon
                        message="Coverage gap = our opportunity"
                        description="Oracle ships nothing for AP, AR, FA or Cash Management — exactly the modules our MCP servers already cover. Finance has one solution (Ledger Insights), whose close-review pattern this page replicates on Re-ERP data."
                      />
                    </Card>
                  </>
                ),
              },
              {
                key: 'workflows',
                label: <span><UnorderedListOutlined /> Workflow catalog</span>,
                children: <WorkflowCatalog />,
              },
              {
                key: 'services',
                label: <span><ApiOutlined /> Service map</span>,
                children: (
                  <Card style={{ borderRadius: 12 }}>
                    <Paragraph>
                      Every web service behind the 70 business objects, classified by whether our stack can call it.
                      Full per-workflow detail lives in the research workbook
                      (<Text code>Fusion-AI-Studio-Services-All-Modules.xlsx</Text>).
                    </Paragraph>
                    <Table
                      dataSource={SERVICE_SUMMARY} rowKey="verdict" size="small" pagination={false}
                      columns={[
                        { title: 'Verdict', dataIndex: 'verdict', width: 240,
                          render: (v: string, r: any) => <Text strong style={{ color: r.color }}>{v}</Text> },
                        { title: 'Business objects', dataIndex: 'bos', align: 'right', width: 130 },
                        { title: 'Workflows', dataIndex: 'wfs', align: 'right', width: 100 },
                        { title: 'Meaning', dataIndex: 'desc' },
                      ]}
                    />
                    <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
                      Key takeaways: all internal services sit in Finance Ledger Insights (replaced here by ORDS);
                      the public <Text code>erpintegrations</Text> resource lets us submit the same corrective ESS jobs
                      (journal import, journal posting, subledger accounting); and the OTBI <Text code>sqlQuery</Text>{' '}
                      endpoint powering Oracle's natural-language analytics is reachable under a verify-per-release policy.
                    </Paragraph>
                  </Card>
                ),
              },
            ]}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default OracleFusionAI;
