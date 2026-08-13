import { buildApexUrl } from '../../config/api.helper';
import React, { useState } from 'react';
import {
  Button, Drawer, Table, Tag, Space, Alert, Tooltip, Typography, Divider, Badge, Modal, Spin,
} from 'antd';
import {
  RobotOutlined, CheckOutlined, CloseOutlined, ThunderboltOutlined, SyncOutlined,
  CheckCircleOutlined, ApiOutlined, CheckCircleFilled, CloseCircleFilled,
} from '@ant-design/icons';

const { Text } = Typography;

// ── Types mirrored from BankReconciliation ────────────────────────────────────
interface StmtLine {
  lineId: number;
  statementId: number;
  amount: number;
  transactionDate?: string;
  referenceNumber?: string;
  transactionRef?: string;
  reference?: string;
  description?: string;
  reconStatus?: string;
}

interface SysTxn {
  txnId: number;
  txnNumber: string;
  source: string;
  amount: number;
  txnDate?: string;
  reference?: string;
  referenceText?: string;
  payee?: string;
  reconciledFlag?: string;
}

interface AgentMatch {
  stmtLineId: number;
  stmtAmount: number;
  stmtDate: string;
  stmtRef: string;
  txnId: number;
  txnSource: string;
  txnNumber: string;
  txnAmount: number;
  txnDate: string;
  txnRef: string;
  confidence: number;
  reason: string;
}

interface ReconAgentProps {
  stmtLines: StmtLine[];
  sysTxns: SysTxn[];
  bankAccount?: string;
  disabled?: boolean;
  onApplyMatches: (pairs: { stmtLineId: number; txnId: number }[]) => Promise<void>;
}

const SOURCE_LABEL: Record<string, string> = {
  AP_PAYMENT: 'AP Payment',
  AR_RECEIPT: 'AR Receipt',
  GL_JOURNAL: 'GL Journal',
  ORA_MAN:    'Ext Txn',
};

const confidenceColor = (c: number) =>
  c >= 95 ? 'green' : c >= 80 ? 'blue' : c >= 65 ? 'orange' : 'red';

const fmtAmt = (v: number) =>
  new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const APEX_BASE = buildApexUrl('');

const maskKey = (k: string) => !k || k.length < 16 ? k : k.substring(0, 14) + '••••••••••••' + k.substring(k.length - 4);

interface ApiTestResult { step: string; status: 'ok' | 'error' | 'warn'; detail: string; }

// ── Component ────────────────────────────────────────────────────────────────
const ReconAgent: React.FC<ReconAgentProps> = ({
  stmtLines,
  sysTxns,
  bankAccount,
  disabled,
  onApplyMatches,
}) => {
  const [open,     setOpen]     = useState(false);
  const [running,  setRunning]  = useState(false);
  const [applying, setApplying] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [matches,  setMatches]  = useState<AgentMatch[]>([]);
  const [summary,  setSummary]  = useState('');
  const [unmatchedStmt, setUnmatchedStmt] = useState<number[]>([]);
  const [unmatchedTxn,  setUnmatchedTxn]  = useState<number[]>([]);

  // Which matches the user has accepted / rejected (by index)
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [rejected, setRejected] = useState<Set<number>>(new Set());

  // API test modal
  const [apiOpen,      setApiOpen]      = useState(false);
  const [apiTesting,   setApiTesting]   = useState(false);
  const [apiResults,   setApiResults]   = useState<ApiTestResult[]>([]);

  const unreconciledStmt = stmtLines.filter(l => l.reconStatus !== 'RECONCILED');
  const unreconciledSys  = sysTxns.filter(t => !t.reconciledFlag || t.reconciledFlag === 'N');

  const handleApiTest = async () => {
    setApiResults([]);
    setApiTesting(true);
    setApiOpen(true);
    const results: ApiTestResult[] = [];

    // Step 1 — APEX endpoint reachable?
    try {
      const res  = await fetch(`${APEX_BASE}/settings/claudekey`);
      const text = await res.text();
      if (text.trimStart().startsWith('<')) {
        results.push({
          step: 'APEX: GET /settings/claudekey',
          status: 'error',
          detail: `HTTP ${res.status} — endpoint not deployed. Run database/cash/rr_claude_key.sql in Oracle APEX SQL Workshop.`,
        });
        setApiResults([...results]);
        setApiTesting(false);
        return;
      }
      let data: any;
      try { data = JSON.parse(text); } catch {
        results.push({ step: 'APEX: GET /settings/claudekey', status: 'error', detail: 'Invalid JSON: ' + text.substring(0, 100) });
        setApiResults([...results]);
        setApiTesting(false);
        return;
      }
      if (data.status === 'success' && data.apiKey) {
        results.push({ step: 'APEX: GET /settings/claudekey', status: 'ok', detail: 'Key retrieved — ' + maskKey(data.apiKey) });
      } else {
        results.push({ step: 'APEX: GET /settings/claudekey', status: 'error', detail: data.message || 'No active key in RR_CLAUDE_KEY. Go to Admin → Claude AI Key Settings → Add Key.' });
        setApiResults([...results]);
        setApiTesting(false);
        return;
      }
    } catch (e: any) {
      results.push({ step: 'APEX: GET /settings/claudekey', status: 'error', detail: 'Network error: ' + e.message });
      setApiResults([...results]);
      setApiTesting(false);
      return;
    }
    setApiResults([...results]);

    // Step 2 — Claude API ping via Electron
    const elApi = (window as any).electronAPI;
    if (elApi?.claudeTestKey) {
      try {
        const result = await elApi.claudeTestKey();
        if (result.success) {
          results.push({ step: 'Claude API: ping test', status: 'ok', detail: `Claude replied: "${result.reply}"` });
        } else {
          results.push({ step: 'Claude API: ping test', status: 'error', detail: result.error || 'Claude API returned an error.' });
        }
      } catch (e: any) {
        results.push({ step: 'Claude API: ping test', status: 'error', detail: e.message });
      }
    } else {
      results.push({ step: 'Claude API: ping test', status: 'warn', detail: 'Requires Electron desktop app. APEX key is ready — AI analysis will work when running as desktop app.' });
    }

    setApiResults([...results]);
    setApiTesting(false);
  };

  const handleOpen = () => {
    setOpen(true);
    setError(null);
    setMatches([]);
    setSummary('');
    setAccepted(new Set());
    setRejected(new Set());
  };

  const handleRun = async () => {
    const api = (window as any).electronAPI;
    if (!api?.claudeReconAgent) {
      setError('AI Agent requires the Electron desktop app. Not available in browser mode.');
      return;
    }
    if (unreconciledStmt.length === 0) {
      setError('No unreconciled statement lines to match.');
      return;
    }

    setRunning(true);
    setError(null);
    setMatches([]);
    setSummary('');
    setAccepted(new Set());
    setRejected(new Set());

    try {
      const result = await api.claudeReconAgent({
        stmtLines: unreconciledStmt,
        sysTxns:   unreconciledSys,
        bankAccount: bankAccount ?? '',
      });

      if (!result.success) {
        setError(result.error || 'Agent returned an error.');
        return;
      }

      const m: AgentMatch[] = result.matches ?? [];
      setMatches(m);
      setSummary(result.summary ?? '');
      setUnmatchedStmt(result.unmatchedStmt ?? []);
      setUnmatchedTxn(result.unmatchedTxn ?? []);

      // Auto-accept high-confidence (≥ 95) matches
      const autoAccept = new Set<number>(
        m.map((_, i) => i).filter(i => m[i].confidence >= 95)
      );
      setAccepted(autoAccept);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const toggle = (idx: number) => {
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(idx)) { next.delete(idx); } else { next.add(idx); }
      return next;
    });
    setRejected(prev => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  const reject = (idx: number) => {
    setRejected(prev => new Set([...prev, idx]));
    setAccepted(prev => { const next = new Set(prev); next.delete(idx); return next; });
  };

  const handleApply = async () => {
    const pairs = matches
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => accepted.has(i) && !rejected.has(i))
      .map(({ m }) => ({ stmtLineId: m.stmtLineId, txnId: m.txnId }));
    if (pairs.length === 0) return;
    setApplying(true);
    try {
      await onApplyMatches(pairs);
      setOpen(false);
    } finally {
      setApplying(false);
    }
  };

  const acceptedCount = [...accepted].filter(i => !rejected.has(i)).length;
  const hasRun = matches.length > 0 || unmatchedStmt.length > 0 || !!summary;

  const columns = [
    {
      title: 'Stmt Line',
      width: 110,
      render: (_: any, m: AgentMatch) => (
        <div>
          <Text strong style={{ fontSize: 12 }}>#{m.stmtLineId}</Text>
          <div style={{ fontSize: 11, color: '#666' }}>{m.stmtDate}</div>
          <Text style={{ fontSize: 12, color: '#1D7B4D', fontWeight: 600 }}>{fmtAmt(m.stmtAmount)}</Text>
          {m.stmtRef && <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{m.stmtRef}</div>}
        </div>
      ),
    },
    {
      title: '',
      width: 24,
      render: () => <span style={{ fontSize: 16, color: '#aaa' }}>⇄</span>,
    },
    {
      title: 'System Txn',
      render: (_: any, m: AgentMatch) => (
        <div>
          <Space size={4}>
            <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>{SOURCE_LABEL[m.txnSource] ?? m.txnSource}</Tag>
            <Text style={{ fontSize: 12, fontWeight: 600 }}>#{m.txnNumber}</Text>
          </Space>
          <div style={{ fontSize: 11, color: '#666' }}>{m.txnDate}</div>
          <Text style={{ fontSize: 12, color: '#1D7B4D', fontWeight: 600 }}>{fmtAmt(m.txnAmount)}</Text>
          {m.txnRef && <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{m.txnRef}</div>}
        </div>
      ),
    },
    {
      title: 'Confidence',
      width: 90,
      align: 'center' as const,
      render: (_: any, m: AgentMatch) => (
        <div style={{ textAlign: 'center' }}>
          <Tag color={confidenceColor(m.confidence)} style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>
            {m.confidence}%
          </Tag>
          <Tooltip title={m.reason}>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2, cursor: 'help' }}>why?</div>
          </Tooltip>
        </div>
      ),
    },
    {
      title: 'Action',
      width: 90,
      align: 'center' as const,
      render: (_: any, m: AgentMatch, idx: number) => {
        const isAcc = accepted.has(idx) && !rejected.has(idx);
        const isRej = rejected.has(idx);
        return (
          <Space size={4}>
            <Tooltip title={isAcc ? 'Accepted' : 'Accept'}>
              <Button
                size="small"
                type={isAcc ? 'primary' : 'default'}
                icon={<CheckOutlined />}
                onClick={() => toggle(idx)}
                style={isAcc ? { background: '#1D7B4D', borderColor: '#1D7B4D' } : {}}
              />
            </Tooltip>
            <Tooltip title="Reject">
              <Button
                size="small"
                danger={isRej}
                icon={<CloseOutlined />}
                onClick={() => reject(idx)}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Tooltip title={unreconciledStmt.length === 0 ? 'No unreconciled lines' : 'AI match suggestions'}>
        <Button
          icon={<RobotOutlined />}
          size="large"
          disabled={disabled || unreconciledStmt.length === 0}
          onClick={handleOpen}
          style={{ borderColor: '#722ed1', color: '#722ed1' }}
        >
          AI Suggest
        </Button>
      </Tooltip>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <Space>
              <RobotOutlined style={{ color: '#722ed1', fontSize: 16 }} />
              <span>AI Reconciliation Agent</span>
              {running && <SyncOutlined spin style={{ color: '#722ed1' }} />}
            </Space>
            <Tooltip title="Test API connection">
              <Button
                size="small"
                icon={<ApiOutlined />}
                onClick={handleApiTest}
                style={{ color: '#722ed1', borderColor: '#722ed1' }}
              >
                Test API
              </Button>
            </Tooltip>
          </div>
        }
        open={open}
        onClose={() => { if (!running && !applying) setOpen(false); }}
        width={680}
        styles={{ body: { padding: '16px 20px' } }}
        footer={
          matches.length > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#666' }}>
                {acceptedCount} of {matches.length} matches selected
              </Text>
              <Space>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={applying}
                  disabled={acceptedCount === 0}
                  onClick={handleApply}
                  style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                >
                  Reconcile {acceptedCount} Match{acceptedCount !== 1 ? 'es' : ''}
                </Button>
                <Button onClick={() => setOpen(false)} disabled={applying}>Close</Button>
              </Space>
            </div>
          ) : (
            <Button onClick={() => setOpen(false)}>Close</Button>
          )
        }
      >
        {/* Intro / Run section */}
        <div style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: '#444', display: 'block', marginBottom: 12 }}>
            Claude AI will analyse <strong>{unreconciledStmt.length}</strong> unreconciled statement line{unreconciledStmt.length !== 1 ? 's' : ''} against{' '}
            <strong>{unreconciledSys.length}</strong> system transaction{unreconciledSys.length !== 1 ? 's' : ''} and suggest matches.
          </Text>
          <Button
            type="primary"
            icon={running ? <SyncOutlined spin /> : <ThunderboltOutlined />}
            loading={running}
            onClick={handleRun}
            disabled={running || unreconciledStmt.length === 0}
            style={{ background: '#722ed1', borderColor: '#722ed1' }}
          >
            {running ? 'Analysing…' : hasRun ? 'Re-run Analysis' : 'Run AI Analysis'}
          </Button>
        </div>

        {error && (
          <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} closable onClose={() => setError(null)} />
        )}

        {/* Summary */}
        {summary && (
          <Alert
            type="info"
            message={summary}
            showIcon
            style={{ marginBottom: 16 }}
            icon={<RobotOutlined />}
          />
        )}

        {/* Match table */}
        {matches.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13 }}>
                Suggested Matches
                <Badge count={matches.length} style={{ marginLeft: 8, background: '#722ed1' }} />
              </Text>
              <Space size={4}>
                <Button size="small" onClick={() => setAccepted(new Set(matches.map((_, i) => i)))}>
                  Accept All
                </Button>
                <Button size="small" onClick={() => setAccepted(new Set())}>
                  Clear All
                </Button>
              </Space>
            </div>

            <Table
              size="small"
              dataSource={matches}
              rowKey={(_, i) => String(i)}
              columns={columns}
              pagination={false}
              rowClassName={(_, i) => accepted.has(i) && !rejected.has(i) ? 'agent-row-accepted' : rejected.has(i) ? 'agent-row-rejected' : ''}
              style={{ marginBottom: 16 }}
            />

            <style>{`
              .agent-row-accepted td { background: #f6ffed !important; }
              .agent-row-rejected td { background: #fff2f0 !important; opacity: 0.5; }
            `}</style>
          </>
        )}

        {/* Unmatched summary */}
        {hasRun && !running && (
          <>
            {unmatchedStmt.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${unmatchedStmt.length} statement line${unmatchedStmt.length !== 1 ? 's' : ''} could not be matched — needs manual review`}
                style={{ marginBottom: 8 }}
              />
            )}
            {unmatchedTxn.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${unmatchedTxn.length} system transaction${unmatchedTxn.length !== 1 ? 's' : ''} have no matching statement line`}
              />
            )}
            {matches.length === 0 && !error && (
              <Alert type="info" showIcon message="No confident matches found. All lines may need manual reconciliation." />
            )}
          </>
        )}

        <Divider style={{ margin: '16px 0 8px' }} />
        <Text style={{ fontSize: 11, color: '#aaa' }}>
          Matches ≥ 95% confidence are auto-selected. Review and adjust before reconciling.
          Claude AI key is loaded from your Oracle APEX RR_CLAUDE_KEY table.
        </Text>
      </Drawer>

      {/* ── API Test Modal ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: '#722ed1' }} /><span>AI Agent — API Connection Test</span></Space>}
        open={apiOpen}
        onCancel={() => setApiOpen(false)}
        footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}
        width={520}
      >
        <div style={{ padding: '8px 0' }}>
          {apiTesting && apiResults.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: '#666' }}>Testing connection…</div>
            </div>
          )}

          {apiResults.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
              borderBottom: i < apiResults.length - 1 ? '1px solid #f0f0f0' : 'none',
            }}>
              <div style={{ marginTop: 2, flexShrink: 0 }}>
                {r.status === 'ok'    && <CheckCircleFilled style={{ fontSize: 18, color: '#1D7B4D' }} />}
                {r.status === 'error' && <CloseCircleFilled  style={{ fontSize: 18, color: '#C74634' }} />}
                {r.status === 'warn'  && <CheckCircleFilled style={{ fontSize: 18, color: '#D4A800' }} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.step}</div>
                <div style={{ fontSize: 12, color: r.status === 'error' ? '#C74634' : '#666', marginTop: 3 }}>
                  {r.detail}
                </div>
                {r.status === 'error' && r.step.includes('APEX') && (
                  <div style={{ marginTop: 6, fontSize: 11, padding: '6px 10px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                    Fix: go to <strong>Administration → Claude AI Key Settings</strong> and add your key,
                    or run <code>database/cash/rr_claude_key.sql</code> in Oracle APEX SQL Workshop first.
                  </div>
                )}
              </div>
            </div>
          ))}

          {!apiTesting && apiResults.length > 0 && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6,
              background: apiResults.every(r => r.status !== 'error') ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${apiResults.every(r => r.status !== 'error') ? '#b7eb8f' : '#ffccc7'}`,
            }}>
              <Text style={{ fontSize: 12, color: apiResults.every(r => r.status !== 'error') ? '#1D7B4D' : '#C74634' }}>
                {apiResults.every(r => r.status !== 'error')
                  ? '✓ All checks passed — AI analysis is ready to use.'
                  : '✗ Setup incomplete. Fix the errors above, then try again.'}
              </Text>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default ReconAgent;
