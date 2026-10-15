// Approval status of one transaction (AP invoice, cash external transaction …): where it stands now, who it is
// with, and the full history — every request with its actions (sent, approved, rejected, replaced …), oldest first.
// Refreshes by itself when an approval is decided from the notification bell.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Modal, Space, Spin, Tag, Timeline, Tooltip, Typography } from 'antd';
import {
  AuditOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  ReloadOutlined, SendOutlined, MailOutlined, SwapOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  APPROVAL_STATE_LOOK, approvalState, getApprovalTrail, onApprovalsChanged,
  type ApprovalTrail, type ApprovalTrailEvent,
} from '../../services/approvals.service';

const { Text } = Typography;

const ACTION_LOOK: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  SUBMITTED: { label: 'Sent for approval', color: '#0572CE', icon: <SendOutlined /> },
  APPROVED:  { label: 'Approved',          color: '#1D7B4D', icon: <CheckCircleOutlined /> },
  REJECTED:  { label: 'Rejected',          color: '#D93025', icon: <CloseCircleOutlined /> },
  CANCELLED: { label: 'Cancelled',         color: '#8c8c8c', icon: <MinusCircleOutlined /> },
  RECALLED:  { label: 'Recalled',          color: '#8c8c8c', icon: <MinusCircleOutlined /> },
  NOTIFIED:  { label: 'Approver notified', color: '#722ed1', icon: <MailOutlined /> },
  FORWARDED: { label: 'Forwarded',         color: '#0572CE', icon: <SwapOutlined /> },
};
const fmt = (d?: string) => (d && dayjs(d).isValid() ? dayjs(d).format('D-MMM-YYYY HH:mm') : d || '');

export const ApprovalStatusModal: React.FC<{
  open: boolean;
  onClose: () => void;
  module: 'AP' | 'CASH' | string;
  transactionId?: number;
  /** approval reference (invoice number, CASH-EXT-…) */
  transactionRef?: string;
  /** only these transaction types (e.g. PURCHASE_ORDER) */
  transactionTypes?: string[];
  title: React.ReactNode;
  /** stored approval status of the transaction */
  status?: string;
  sentBy?: string;
  sentDate?: string;
  approverName?: string;
  approverEmail?: string;
  decisionDate?: string;
  /** offered while the transaction is not approved */
  onSendAgain?: () => void;
  /** offered while it waits for approval: the sender takes the request back */
  onWithdraw?: () => Promise<void>;
}> = ({ open, onClose, module, transactionId, transactionRef, transactionTypes, title, status, sentBy, sentDate, approverName, approverEmail, decisionDate, onSendAgain, onWithdraw }) => {
  const typesKey = (transactionTypes || []).join(',');
  const [trail, setTrail] = useState<ApprovalTrail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    if (!transactionId && !transactionRef) return;
    setLoading(true); setError(null);
    try { setTrail(await getApprovalTrail({ module, transactionId, transactionRef, transactionTypes: typesKey ? typesKey.split(',') : undefined })); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [module, transactionId, transactionRef, typesKey]);

  useEffect(() => { if (open) load(); else { setTrail(null); setError(null); } }, [open, load]);
  // decided from the bell while this is open → show it
  useEffect(() => (open ? onApprovalsChanged(d => {
    if (d.module === module && (d.transactionId === transactionId || (d.transactionRef && d.transactionRef === transactionRef))) load();
  }) : undefined), [open, module, transactionId, transactionRef, load]);

  const st = approvalState(status);
  const look = APPROVAL_STATE_LOOK[st];
  const events = trail?.events ?? [];
  const latestPending = [...events].reverse().find(e => e.requestStatus === 'PENDING');
  const waitingFor = approverName || latestPending?.approverName;

  const headline = st === 'PENDING' ? `Waiting for ${waitingFor || 'the approver'}${sentDate ? ` since ${fmt(sentDate)}` : ''}`
    : st === 'APPROVED' ? `Approved${approverName ? ` by ${approverName}` : ''}${decisionDate ? ` on ${fmt(decisionDate)}` : ''}`
    : st === 'REJECTED' ? `Rejected${approverName ? ` by ${approverName}` : ''}${decisionDate ? ` on ${fmt(decisionDate)}` : ''}`
    : st === 'CANCELLED' ? 'The approval request was cancelled — it can be sent again'
    : 'Not sent for approval yet';

  const item = (e: ApprovalTrailEvent, i: number) => {
    const a = ACTION_LOOK[e.action] || { label: e.action, color: '#8c8c8c', icon: <AuditOutlined /> };
    const replaced = e.action === 'CANCELLED' && /^Replaced by/i.test(e.comments || '');
    const who = e.action === 'SUBMITTED'
      ? <>by <Text strong>{e.actorName || '—'}</Text>{e.approverName || e.approverEmail ? <> to <Text strong>{e.approverName || e.approverEmail}</Text></> : null}</>
      : e.actorName ? <>by <Text strong>{e.actorName}</Text></> : null;
    return {
      key: `${e.requestId}-${i}`,
      color: a.color,
      icon: <span style={{ color: a.color, fontSize: 14 }}>{a.icon}</span>,
      content: (
        <div style={{ paddingBottom: 2 }}>
          <Space size={6} wrap>
            <Text strong style={{ color: a.color }}>{replaced ? 'Replaced by a new request' : a.label}</Text>
            <Tag style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}>#{e.requestId}</Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>{fmt(e.actionDate)}</Text>
          </Space>
          {who && <div style={{ fontSize: 12 }}>{who}</div>}
          {e.comments && !replaced && <div style={{ fontSize: 12, color: '#595959', fontStyle: 'italic' }}>“{e.comments}”</div>}
        </div>
      ),
    };
  };

  const rows: [string, React.ReactNode][] = [
    ['Approval ref', transactionRef ? <code style={{ fontSize: 12 }}>{transactionRef}</code> : null],
    ['Sent by', sentBy],
    ['Sent on', sentDate ? fmt(sentDate) : null],
    ['Approver', approverName || approverEmail ? <>{approverName || approverEmail}{approverName && approverEmail ? <Text type="secondary" style={{ fontSize: 11 }}> · {approverEmail}</Text> : null}</> : null],
    [st === 'REJECTED' ? 'Rejected on' : 'Approved on', st === 'APPROVED' || st === 'REJECTED' ? fmt(decisionDate) || null : null],
  ];

  return (
    <Modal open={open} onCancel={onClose} width={560} destroyOnHidden
      title={<Space><AuditOutlined style={{ color: look.color }} /><span>Approval — {title}</span></Space>}
      footer={<Space>
        {onWithdraw && st === 'PENDING' && (
          <Tooltip title="Take the request back — the approver no longer sees it">
            <Button icon={<MinusCircleOutlined />} loading={withdrawing}
              onClick={async () => { setWithdrawing(true); try { await onWithdraw(); await load(); } finally { setWithdrawing(false); } }}>Withdraw</Button>
          </Tooltip>
        )}
        {onSendAgain && st !== 'APPROVED' && (
          <Tooltip title={st === 'PENDING' ? 'Send to another approver — replaces the pending request' : 'Send for approval again'}>
            <Button icon={<SendOutlined />} onClick={onSendAgain}>{st === 'NONE' ? 'Send for approval' : 'Send again'}</Button>
          </Tooltip>
        )}
        <Button onClick={onClose}>Close</Button>
      </Space>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, marginBottom: 14,
        background: `${look.color}12`, border: `1px solid ${look.color}40` }}>
        <span style={{ fontSize: 26, color: look.color, lineHeight: 1 }}>
          {st === 'APPROVED' ? <CheckCircleOutlined /> : st === 'REJECTED' ? <CloseCircleOutlined /> : st === 'PENDING' ? <ClockCircleOutlined /> : <MinusCircleOutlined />}
        </span>
        <div>
          <Tag color={look.tag} style={{ margin: 0, fontSize: 13, padding: '2px 10px' }}>{look.label}</Tag>
          <div style={{ fontSize: 12, color: '#595959', marginTop: 4 }}>{headline}</div>
        </div>
      </div>

      <div style={{ background: '#fafafa', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <Text type="secondary">{k}</Text><span style={{ textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text strong>History</Text>
        <Space size={6}>
          {trail && <Text type="secondary" style={{ fontSize: 11 }}>{trail.requests} request{trail.requests === 1 ? '' : 's'}</Text>}
          <Tooltip title="Refresh"><Button size="small" type="text" icon={<ReloadOutlined spin={loading} />} onClick={load} /></Tooltip>
        </Space>
      </div>
      {error && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="History could not be loaded" description={error} />}
      {loading && !trail ? <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        : events.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No approval requests recorded for this transaction yet" />
        : <div style={{ maxHeight: 320, overflowY: 'auto', paddingTop: 6 }}><Timeline items={events.map(item)} /></div>}
    </Modal>
  );
};

export default ApprovalStatusModal;
