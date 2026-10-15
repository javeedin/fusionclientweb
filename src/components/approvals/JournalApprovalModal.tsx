// Send GL journal batches for approval (from the GL dashboard or Manage Journals), and the approval tag shown
// next to a journal. The approver gets each batch in their notifications (bell) with its lines and approves or
// rejects it there; until then the batch cannot be posted. See glApproval.service.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Popover, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  AuditOutlined, CheckCircleFilled, CheckCircleOutlined, ClockCircleOutlined, CloseCircleFilled, CloseCircleOutlined,
  ExclamationCircleOutlined, HistoryOutlined, LoadingOutlined, MinusCircleOutlined, SendOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../../context/AuthContext';
import { emitApprovalsChanged, type ApprovalRule } from '../../services/approvals.service';
import {
  GL_APPROVAL_SCRIPT, decideJournalApproval, journalApprovers, postApprovedJournal, ruleBand, sendJournalForApproval,
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

// ── row action ──────────────────────────────────────────────────────────────

/**
 * The approval icon at the start of a journal row. Waiting for approval → approve / reject right there (optionally
 * posting it); not sent → send for approval; approved / rejected → the history.
 */
export const JournalApprovalAction: React.FC<{
  batchId: number;
  batchName: string;
  gate: JournalGate;
  approval?: JournalApproval;
  onSend: () => void;
  onTrail?: () => void;
  /** after a decision here (posted: an approval posts the journal) */
  onDecided?: (r: { status: 'APPROVED' | 'REJECTED'; posted: boolean }) => void;
}> = ({ batchId, batchName, gate, approval, onSend, onTrail, onDecided }) => {
  const user = useApprovalUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [comments, setComments] = useState('');
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();   // the row's own click (open / preview) stays out of it
  const btn: React.CSSProperties = { width: 22, height: 22, minWidth: 22, padding: 0 };

  const decide = async (status: 'APPROVED' | 'REJECTED') => {
    if (!approval) return;
    setBusy(status);
    const key = `decide-${batchId}`;
    if (status === 'APPROVED') message.loading({ content: `Approving and posting ${batchName}…`, key, duration: 0 });
    let r;
    try {
      r = await decideJournalApproval(approval.requestId, status, comments.trim() || undefined, user, { name: user }, batchId);
    } catch (e) {
      message.destroy(key);
      message.error(e instanceof Error ? e.message : String(e), 8);
      setBusy(null);
      return;
    }
    emitApprovalsChanged({ reason: 'decided', module: 'GL', transactionId: batchId, transactionRef: batchName, status, actorName: user, from: 'screen', posted: r.posted });
    if (status === 'REJECTED') message.success(`${batchName} rejected`);
    else if (r.posted) message.success({ content: `${batchName} approved and posted`, key });
    else {
      message.destroy(key);
      Modal.warning({ title: `${batchName} approved, but not posted`, width: 520,
        content: <div>{(r.warning || r.message).replace(/^.*approved, but not posted:\s*/i, '')}
          <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>It stays approved — post it with Post Batch once fixed.</div></div> });
    }
    setBusy(null); setOpen(false); setComments('');
    onDecided?.({ status, posted: r.posted });
  };

  if (gate.tone === 'pending' && approval) {
    const content = (
      <div style={{ width: 300 }} onClick={stop}>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <div><b>{approval.currency} {money(Math.abs(approval.amount ?? 0))}</b> · sent by {approval.requestedBy || '—'}{approval.requestedDate ? ` · ${day(approval.requestedDate)}` : ''}</div>
          <div style={{ color: '#8c8c8c' }}>waiting for {approval.approverName || 'the approver'}{approval.approverName && approval.approverName === user ? ' (you)' : ''}</div>
        </div>
        <Input.TextArea rows={2} maxLength={1000} placeholder="Comment (optional — the reason when rejecting)" value={comments}
          onChange={e => setComments(e.target.value)} disabled={!!busy} />
        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>Approving posts the journal (status Posted).</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          {onTrail ? <Button size="small" type="link" icon={<HistoryOutlined />} style={{ padding: 0 }} onClick={() => { setOpen(false); onTrail(); }}>History</Button> : <span />}
          <Space size={6}>
            <Button size="small" danger icon={<CloseCircleOutlined />} loading={busy === 'REJECTED'} disabled={!!busy} onClick={() => decide('REJECTED')}>Reject</Button>
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={busy === 'APPROVED'} disabled={!!busy}
              style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={() => decide('APPROVED')}>Approve &amp; post</Button>
          </Space>
        </div>
      </div>
    );
    return (
      <span onClick={stop}>
        <Popover trigger="click" open={open} onOpenChange={v => !busy && setOpen(v)} content={content} placement="bottomLeft"
          title={<Space size={6}><ClockCircleOutlined style={{ color: '#d48806' }} /><span>{`Approve ${batchName}?`}</span></Space>}>
          <Tooltip title={open ? '' : `Waiting for approval${approval.approverName ? ` from ${approval.approverName}` : ''} — click to approve or reject`}>
            <Button type="text" size="small" style={btn} aria-label="Approve or reject"
              icon={<CheckCircleOutlined style={{ color: '#1D7B4D', fontSize: 16 }} />} />
          </Tooltip>
        </Popover>
      </span>
    );
  }
  if (gate.tone === 'approved') {
    // the row is not posted (posted rows get no icon): approved before approval posted automatically → post it now
    const who = `Approved${approval?.decidedBy ? ` by ${approval.decidedBy}` : ''}${approval?.decidedDate ? ` · ${day(approval.decidedDate)}` : ''}`;
    const postNow = async () => {
      setBusy('APPROVED');
      const key = `post-${batchId}`;
      message.loading({ content: `Posting ${batchName}…`, key, duration: 0 });
      const r = await postApprovedJournal(batchId, batchName);
      setBusy(null); setOpen(false);
      if (r.posted) { message.success({ content: `${batchName} posted`, key }); onDecided?.({ status: 'APPROVED', posted: true }); }
      else {
        message.destroy(key);
        Modal.warning({ title: `${batchName} was not posted`, width: 520, content: r.why });
      }
    };
    return (
      <span onClick={stop}>
        <Popover trigger="click" open={open} onOpenChange={v => !busy && setOpen(v)} placement="bottomLeft"
          title={<Space size={6}><CheckCircleFilled style={{ color: '#1D7B4D' }} /><span>{`${batchName} is approved`}</span></Space>}
          content={<div style={{ width: 280 }} onClick={stop}>
            <div style={{ fontSize: 12, marginBottom: 10 }}>{who} — <b>not posted yet</b>. Posting runs PUT gl/journals/{batchId}/post (Post Batch).</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {onTrail ? <Button size="small" type="link" icon={<HistoryOutlined />} style={{ padding: 0 }} onClick={() => { setOpen(false); onTrail(); }}>History</Button> : <span />}
              <Button size="small" type="primary" icon={<SendOutlined />} loading={!!busy} style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={postNow}>Post now</Button>
            </div>
          </div>}>
          <Tooltip title={open ? '' : `${who} — not posted yet · click to post it`}>
            <Button type="text" size="small" style={btn} aria-label="Approved — post it"
              icon={<CheckCircleFilled style={{ color: '#1D7B4D', fontSize: 16 }} />} />
          </Tooltip>
        </Popover>
      </span>
    );
  }
  if (gate.tone === 'rejected') {
    return (
      <span onClick={stop}>
        <Tooltip title={`${gate.block}${onTrail ? ' · click for the history (send it again from there)' : ''}`}>
          <Button type="text" size="small" style={btn} aria-label="Rejected" onClick={onTrail ?? onSend}
            icon={<CloseCircleFilled style={{ color: '#d03b3b', fontSize: 16 }} />} />
        </Tooltip>
      </span>
    );
  }
  // not sent / withdrawn / needs approval / changed after approval → send it
  const loud = gate.tone === 'needed' || gate.tone === 'changed';
  return (
    <span onClick={stop}>
      <Tooltip title={gate.block ? `${gate.block} · click to send it for approval` : 'Send for approval'}>
        <Button type="text" size="small" style={btn} aria-label="Send for approval" onClick={onSend}
          icon={<AuditOutlined style={{ color: loud ? '#d48806' : '#8c8c8c', fontSize: 15 }} />} />
      </Tooltip>
    </span>
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
