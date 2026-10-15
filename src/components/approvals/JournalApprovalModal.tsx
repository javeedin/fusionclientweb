// Send GL journal batches for approval (from the GL dashboard or Manage Journals), and the approval tag shown
// next to a journal. The approver gets each batch in their notifications (bell) with its lines and approves or
// rejects it there; until then the batch cannot be posted. See glApproval.service.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, LoadingOutlined,
  MinusCircleOutlined, SendOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../../context/AuthContext';
import type { ApprovalRule } from '../../services/approvals.service';
import {
  GL_APPROVAL_SCRIPT, journalApprovers, ruleBand, sendJournalForApproval,
  type JournalApproval, type JournalApprover, type JournalGate, type GateTone,
} from '../../services/glApproval.service';

const { Text } = Typography;
const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d?: string) => (d && dayjs(d).isValid() ? dayjs(d).format('D-MMM-YYYY HH:mm') : '');

/** The name the approval trail records for the signed-in user (the bell decides under the same name). */
export const useApprovalUser = () => {
  const { user } = useAuth();
  return user?.name ?? user?.username ?? 'User';
};

// ── tag ─────────────────────────────────────────────────────────────────────

const LOOK: Record<GateTone, { color: string; icon: React.ReactNode }> = {
  free:      { color: 'default', icon: null },
  needed:    { color: 'orange',  icon: <ExclamationCircleOutlined /> },
  pending:   { color: 'gold',    icon: <ClockCircleOutlined /> },
  approved:  { color: 'green',   icon: <CheckCircleOutlined /> },
  rejected:  { color: 'red',     icon: <CloseCircleOutlined /> },
  changed:   { color: 'orange',  icon: <WarningOutlined /> },
  withdrawn: { color: 'default', icon: <MinusCircleOutlined /> },
};

const SHORT: Partial<Record<GateTone, string>> = { pending: 'Awaiting', changed: 'Changed', needed: 'Needs approval' };

/** Approval of a journal batch: icon + label, the full story in the tooltip. Click → the approval trail. */
export const JournalApprovalTag: React.FC<{ gate: JournalGate; approval?: JournalApproval; onClick?: () => void; compact?: boolean }> = ({ gate, approval, onClick, compact }) => {
  if (gate.tone === 'free' && !approval) return <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{compact ? '—' : 'Not needed'}</Text>;
  const look = LOOK[gate.tone];
  const who = gate.tone === 'pending' ? approval?.approverName : approval?.decidedBy || approval?.approverName;
  const tip = (
    <div style={{ fontSize: 12 }}>
      <div>{gate.block || (gate.tone === 'approved'
        ? `Approved${approval?.decidedBy ? ` by ${approval.decidedBy}` : ''}${approval?.decidedDate ? ` · ${day(approval.decidedDate)}` : ''} — it can be posted`
        : gate.label)}</div>
      {approval && <div style={{ opacity: 0.75, marginTop: 4 }}>Request #{approval.requestId} · sent by {approval.requestedBy || '—'}{approval.requestedDate ? ` · ${day(approval.requestedDate)}` : ''}</div>}
      {onClick && <div style={{ opacity: 0.75 }}>Click for the approval history</div>}
    </div>
  );
  return (
    <Tooltip title={tip} overlayStyle={{ maxWidth: 420 }}>
      <Tag color={look.color} icon={look.icon} style={{ margin: 0, cursor: onClick ? 'pointer' : undefined, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
        onClick={e => { if (onClick) { e.stopPropagation(); onClick(); } }}>
        {compact ? SHORT[gate.tone] ?? gate.label : gate.label}{!compact && who && (gate.tone === 'pending' || gate.tone === 'approved' || gate.tone === 'rejected') ? ` · ${who}` : ''}
      </Tag>
    </Tooltip>
  );
};

// ── send dialog ─────────────────────────────────────────────────────────────

export interface JournalToSend {
  batchId: number;
  batchName: string;
  period?: string;
  category?: string;
  /** number of journals in the batch */
  journals: number;
  /** accounted debits of the batch (ledger currency) */
  amount: number;
  currency?: string;
  balanced?: boolean;
  approval?: JournalApproval;
  gate?: JournalGate;
}

type RowState = { status: 'ready' | 'skipped' | 'sending' | 'sent' | 'failed'; message?: string };

export const JournalApprovalModal: React.FC<{
  open: boolean;
  onClose: () => void;
  batches: JournalToSend[];
  rules?: ApprovalRule[];
  /** after sending (refresh the list) */
  onDone?: () => void;
}> = ({ open, onClose, batches, rules, onDone }) => {
  const user = useApprovalUser();
  const [approvers, setApprovers] = useState<JournalApprover[]>([]);
  const [rule, setRule] = useState<ApprovalRule | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState<string>();
  const [comments, setComments] = useState('');
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [running, setRunning] = useState(false);
  const [restUsed, setRestUsed] = useState(false);

  const skipWhy = (b: JournalToSend) =>
    b.balanced === false ? 'Out of balance — fix it first'
      : b.gate?.tone === 'approved' ? 'Already approved'
        : '';
  const largest = useMemo(() => batches.reduce((m, b) => Math.max(m, Math.abs(b.amount)), 0), [batches]);
  const total = useMemo(() => batches.reduce((m, b) => m + Math.abs(b.amount), 0), [batches]);
  const ccy = batches.find(b => b.currency)?.currency || 'AED';

  useEffect(() => {
    if (!open) return;
    setRows(Object.fromEntries(batches.map(b => [b.batchId, skipWhy(b) ? { status: 'skipped', message: skipWhy(b) } : { status: 'ready' }])));
    setComments(''); setRunning(false); setRestUsed(false);
    setLoading(true);
    journalApprovers(largest, rules)
      .then(r => {
        setApprovers(r.approvers); setRule(r.rule);
        const covering = r.approvers.filter(a => a.covers);
        setEmail(covering.length === 1 ? covering[0].email : undefined);
      })
      .catch(() => { setApprovers([]); setRule(null); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ready = batches.filter(b => rows[b.batchId]?.status === 'ready');
  const done = !running && batches.some(b => ['sent', 'failed'].includes(rows[b.batchId]?.status)) && !ready.length;
  const approver = approvers.find(a => a.email === email);

  const send = async () => {
    if (!approver) return;
    setRunning(true);
    let rest = false;
    for (const b of ready) {
      setRows(r => ({ ...r, [b.batchId]: { status: 'sending' } }));
      const res = await sendJournalForApproval({
        batchId: b.batchId, batchName: b.batchName, amount: b.amount, currency: b.currency || ccy,
        description: [b.category || 'Journal', b.period, `${b.journals} journal${b.journals === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
        approver, comments: comments.trim() || undefined, user, sendEmail: alsoEmail,
      });
      if (res.via === 'rest') rest = true;
      setRows(r => ({ ...r, [b.batchId]: res.ok ? { status: 'sent', message: res.warning ? `${res.message} · ${res.warning}` : res.message } : { status: 'failed', message: res.message } }));
    }
    setRestUsed(rest);
    setRunning(false);
    onDone?.();
  };

  const icon = (s?: RowState['status']) => ({
    ready: <ClockCircleOutlined style={{ color: '#8c8c8c' }} />, skipped: <MinusCircleOutlined style={{ color: '#d48806' }} />,
    sending: <LoadingOutlined style={{ color: '#2a78d6' }} />, sent: <CheckCircleOutlined style={{ color: '#0ca30c' }} />,
    failed: <CloseCircleOutlined style={{ color: '#d03b3b' }} />,
  }[s ?? 'ready']);
  const sent = batches.filter(b => rows[b.batchId]?.status === 'sent').length;
  const failed = batches.filter(b => rows[b.batchId]?.status === 'failed').length;

  return (
    <Modal open={open} width={860} destroyOnHidden maskClosable={!running} closable={!running} onCancel={() => !running && onClose()}
      title={<Space><SendOutlined style={{ color: '#2a78d6' }} />Send for approval
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{batches.length} journal batch{batches.length === 1 ? '' : 'es'} · {ccy} {money(total)}</Text></Space>}
      footer={done
        ? <Button type="primary" onClick={onClose}>Close</Button>
        : <Space>
            <Button disabled={running} onClick={onClose}>Cancel</Button>
            <Button type="primary" icon={<SendOutlined />} loading={running} disabled={!approver || !ready.length} onClick={send}>
              Send {ready.length ? `${ready.length} batch${ready.length === 1 ? '' : 'es'}` : ''}{approver ? ` to ${approver.fullName}` : ''}
            </Button>
          </Space>}>
      {done ? (
        <Alert type={failed ? 'warning' : 'success'} showIcon style={{ marginBottom: 12 }}
          message={`${sent} sent for approval${failed ? ` · ${failed} refused (reason shown)` : ''}`}
          description={<>
            {sent > 0 && <>The approver finds {sent === 1 ? 'it' : 'them'} in their notifications (bell) with the journal lines. Until approved, {sent === 1 ? 'it' : 'they'} cannot be posted.</>}
            {restUsed && <div style={{ marginTop: 4 }}>The journal approval package is not installed yet (<Text code>{GL_APPROVAL_SCRIPT}</Text>): the request went through the approvals endpoints, and posting is held on these screens only.</div>}
          </>} />
      ) : (
        <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
          message={<>The approver approves or rejects each batch from their notifications (bell), seeing its Dr / Cr lines. A batch waiting for approval or rejected cannot be posted; a batch changed after approval needs approving again.</>} />
      )}

      {!done && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 13 }}>Approver</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {rule ? <>Rule <b>{rule.ruleName}</b> covers {ccy} {money(largest)} ({ruleBand(rule)})</> : 'No journal approval rule covers this amount — any approver can be chosen'}
              </Text>
            </div>
            <Select showSearch style={{ width: '100%' }} loading={loading} value={email} onChange={setEmail} optionFilterProp="label"
              placeholder={loading ? 'Loading approvers…' : 'Choose who approves'} disabled={running}
              options={[
                { label: rule ? `Rule “${rule.ruleName}”` : 'Can approve this amount', options: approvers.filter(a => a.covers) },
                { label: 'Other approvers', options: approvers.filter(a => !a.covers) },
              ].filter(g => g.options.length).map(g => ({
                label: g.label,
                options: g.options.map(a => ({
                  value: a.email,
                  label: `${a.fullName}${a.fullName !== a.email ? ` — ${a.email}` : ''}${a.department ? ` (${a.department})` : ''}${a.fullName === user || a.email === user ? ' · you' : ''}`,
                })),
              }))} />
            {!loading && !approvers.length && (
              <Alert type="warning" showIcon style={{ marginTop: 8, fontSize: 12 }}
                message="No approvers found — add approval users (module GL) or a rule for module GL, transaction type JOURNAL, in Approvals." />
            )}
          </div>
          <Input.TextArea rows={2} maxLength={1000} placeholder="Note to the approver (optional)" value={comments} disabled={running}
            onChange={e => setComments(e.target.value)} />
          <Checkbox checked={alsoEmail} disabled={running} onChange={e => setAlsoEmail(e.target.checked)} style={{ fontSize: 12 }}>
            Also email the approver (approve / reject links)
          </Checkbox>
        </div>
      )}

      <Table<JournalToSend> size="small" rowKey="batchId" dataSource={batches} pagination={batches.length > 8 ? { pageSize: 8 } : false}
        columns={[
          { title: '', key: 's', width: 32, render: (_: unknown, b) => icon(rows[b.batchId]?.status) },
          { title: 'Batch', dataIndex: 'batchName', ellipsis: true, render: (v: string, b) => (
            <div>{v}<div style={{ fontSize: 11, color: '#8c8c8c' }}>{[b.category, `${b.journals} journal${b.journals === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div></div>) },
          { title: 'Period', dataIndex: 'period', width: 80 },
          { title: `${ccy} Dr`, dataIndex: 'amount', width: 130, align: 'right', render: (v: number) => money(Math.abs(v)) },
          { title: 'Now', key: 'g', width: 170, render: (_: unknown, b) => (b.gate ? <JournalApprovalTag gate={b.gate} approval={b.approval} /> : '—') },
          { title: 'Result', key: 'r', width: 230, render: (_: unknown, b) => {
            const r = rows[b.batchId];
            if (!r || r.status === 'ready') {
              return <Text type="secondary" style={{ fontSize: 11 }}>{b.approval?.status === 'PENDING' ? 'Replaces the pending request' : 'Ready'}</Text>;
            }
            if (r.status === 'sending') return <Text style={{ fontSize: 12 }}>Sending…</Text>;
            return <Text style={{ fontSize: 12, color: r.status === 'failed' ? '#d03b3b' : r.status === 'skipped' ? '#595959' : '#1f1f1f' }}>{r.message}</Text>;
          } },
        ]} />
    </Modal>
  );
};

export default JournalApprovalModal;
