// Purchasing-RR — single-level in-app approval (database/po/309_po_approval_inapp.sql), like cash external
// transactions and AP invoices: submit a purchase order or requisition TO a chosen approver, and see where its
// approval stands (with whom, who decided, the full history). The document stays pending until approved.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { AuditOutlined, SendOutlined } from '@ant-design/icons';
import {
  APPROVAL_STATE_LOOK, approvalState, getApprovalRules, getApprovalUsers, onApprovalsChanged, type ApprovalRule, type ApprovalUser,
} from '../../services/approvals.service';
import ApprovalStatusModal from '../../components/approvals/ApprovalStatusModal';
import { money, nlit, poQuery, type Row } from '../../services/po.service';

const { Text } = Typography;

export const APPROVAL_SCRIPT = 'database/po/309_po_approval_inapp.sql';
export type PoDocType = 'PURCHASE_ORDER' | 'REQUISITION';
const DOC_LABEL: Record<PoDocType, string> = { PURCHASE_ORDER: 'purchase order', REQUISITION: 'requisition' };

/** The approver is the person submitting (by e-mail, e-mail name or full name). */
const isMe = (u: ApprovalUser, me: string) => {
  const m = me.trim().toUpperCase();
  const e = (u.email || '').toUpperCase();
  return !!m && (e === m || e.split('@')[0] === m || (u.fullName || '').toUpperCase() === m);
};

// ── submit to an approver ───────────────────────────────────────────────────
export const SubmitForApprovalModal: React.FC<{
  open: boolean;
  docType: PoDocType;
  docNumber: string;
  /** in the functional currency (approval rules and limits use it) */
  amount: number;
  currency: string;
  user: string;
  /** Purchasing Options: PO / requisition approval required */
  approvalRequired: boolean;
  busy?: boolean;
  onCancel: () => void;
  /** approver e-mail, or null when approval is not required */
  onSubmit: (approverEmail: string | null) => void;
}> = ({ open, docType, docNumber, amount, currency, user, approvalRequired, busy, onCancel, onSubmit }) => {
  const [users, setUsers] = useState<ApprovalUser[]>([]);
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setApprover(undefined);
    if (!approvalRequired) return;
    setLoading(true); setError(null);
    Promise.all([getApprovalUsers(), getApprovalRules('PROCUREMENT').catch(() => [] as ApprovalRule[])])
      .then(([u, r]) => { setUsers(u); setRules(r); })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [open, approvalRequired]);

  // approvers named by the approval rules for this document type and amount (rule priority, then sequence)
  const ruleOf = useMemo(() => {
    const m = new Map<string, string>();
    rules
      .filter(r => r.module === 'PROCUREMENT' && r.transactionType === docType && r.active === 'Y'
        && amount >= Number(r.minAmount || 0) && (r.maxAmount == null || amount <= Number(r.maxAmount)))
      .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
      .forEach(r => [...(r.approvers || [])].sort((a, b) => a.sequence - b.sequence)
        .forEach(a => { const k = (a.email || '').toLowerCase(); if (k && !m.has(k)) m.set(k, r.ruleName); }));
    return m;
  }, [rules, docType, amount]);

  const options = useMemo(() => {
    const ruleOrder = [...ruleOf.keys()];
    return users
      .filter(u => u.active !== 'N' && u.email && !isMe(u, user))
      .sort((a, b) => {
        const ia = ruleOrder.indexOf(a.email.toLowerCase()), ib = ruleOrder.indexOf(b.email.toLowerCase());
        if (ia !== ib) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
        return (a.fullName || a.email).localeCompare(b.fullName || b.email);
      })
      .map(u => {
        const limit = u.maxApprovalAmount != null && Number(u.maxApprovalAmount) > 0 ? Number(u.maxApprovalAmount) : null;
        const over = limit != null && amount > limit;
        return { u, rule: ruleOf.get(u.email.toLowerCase()), limit, over };
      });
  }, [users, user, ruleOf, amount]);

  // suggest the first approver of the matching rule
  useEffect(() => {
    if (approver || !options.length) return;
    const first = options.find(o => o.rule && !o.over);
    if (first) setApprover(first.u.email);
  }, [options, approver]);

  const doc = DOC_LABEL[docType];
  return (
    <Modal open={open} onCancel={onCancel} width={600} destroyOnHidden
      title={<Space><SendOutlined style={{ color: '#C74634' }} />{approvalRequired ? 'Submit for approval' : 'Submit'} — {docNumber}</Space>}
      footer={<Space>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={approvalRequired && !approver}
          style={{ background: !approvalRequired || approver ? '#C74634' : undefined }}
          onClick={() => onSubmit(approvalRequired ? approver! : null)}>
          {approvalRequired ? 'Send for approval' : `Submit and approve`}
        </Button>
      </Space>}>
      <div style={{ background: '#fafafa', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div><Text type="secondary" style={{ fontSize: 12 }}>{doc[0].toUpperCase() + doc.slice(1)}</Text><div><Text strong>{docNumber}</Text></div></div>
        <div style={{ textAlign: 'right' }}><Text type="secondary" style={{ fontSize: 12 }}>Amount</Text>
          <div><Text strong style={{ color: '#C74634' }}>{currency} {money(amount)}</Text></div></div>
      </div>

      {!approvalRequired ? (
        <Alert type="warning" showIcon message={`Approval is not required for this business unit`}
          description={<span>Purchasing Options has <b>{docType === 'PURCHASE_ORDER' ? 'PO' : 'Requisition'} approval required = No</b>, so submitting
            approves the {doc} straight away. To have it approved first, set it to <b>Yes</b> in Purchasing → Setup → Purchasing Options.</span>} />
      ) : <>
        <Alert type="info" showIcon style={{ marginBottom: 14, fontSize: 12 }}
          message={<span>The approver gets the request in their notifications (bell icon) and on Purchasing → Approvals. The {doc} stays
            <b> Pending approval</b>{docType === 'PURCHASE_ORDER' ? ' — it cannot be received, invoiced, changed or sent to the supplier' : ''} until it is approved.</span>} />
        <div style={{ marginBottom: 6 }}><Text strong>Approver</Text></div>
        <Select style={{ width: '100%' }} showSearch optionFilterProp="label" loading={loading} placeholder={loading ? 'Loading approvers…' : 'Choose the approver'}
          value={approver} onChange={setApprover}
          options={options.map(o => ({
            value: o.u.email, disabled: o.over,
            label: `${o.u.fullName || o.u.email} ${o.u.email} ${o.u.department || ''}`,
            title: o.over ? `Above ${o.u.fullName}'s approval limit` : undefined,
          }))}
          optionRender={opt => {
            const o = options.find(x => x.u.email === opt.value);
            if (!o) return opt.label;
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{o.u.fullName || o.u.email}</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>{o.u.email}{o.u.department ? ` · ${o.u.department}` : ''}</div>
                </div>
                <Space size={4} style={{ flexShrink: 0 }}>
                  {o.rule && <Tag color="green" style={{ margin: 0, fontSize: 10 }}>rule: {o.rule}</Tag>}
                  {o.limit != null && <Tag color={o.over ? 'red' : 'default'} style={{ margin: 0, fontSize: 10 }}>limit {money(o.limit)}</Tag>}
                </Space>
              </div>
            );
          }}
          labelRender={l => {
            const o = options.find(x => x.u.email === l.value);
            return o ? <span>{o.u.fullName || o.u.email} <Text type="secondary" style={{ fontSize: 12 }}>— {o.u.email}</Text></span> : l.label;
          }} />
        {error && <Alert type="error" showIcon style={{ marginTop: 10 }} message="Could not load the approvers" description={error} />}
        {!loading && !error && !options.length && (
          <Alert type="warning" showIcon style={{ marginTop: 10 }} message="No approvers available"
            description="Add approval users in Administration → Approval Management → Users (you cannot approve your own documents)." />
        )}
      </>}
    </Modal>
  );
};

// ── where the approval stands ───────────────────────────────────────────────
export interface DocApproval {
  REQUEST_ID: number; STATUS: string; APPROVER_NAME?: string; APPROVER_EMAIL?: string; REQUESTED_BY_NAME?: string;
  REQUESTED_DATE?: string; DECIDED_BY?: string; DECIDED_DATE?: string; DECISION_COMMENTS?: string;
}

/** The approval request(s) of purchasing documents, by request id (309 view; the 301 view before 309 is installed). */
export async function loadDocApprovals(requestIds: number[]): Promise<Map<number, DocApproval>> {
  const ids = [...new Set(requestIds.filter(x => Number.isFinite(Number(x)) && Number(x) > 0).map(Number))];
  const out = new Map<number, DocApproval>();
  for (let i = 0; i < ids.length; i += 500) {
    const list = ids.slice(i, i + 500).map(nlit).join(',');
    let rows: Row[];
    try {
      rows = await poQuery(`SELECT REQUEST_ID, STATUS, APPROVER_NAME, APPROVER_EMAIL, REQUESTED_BY_NAME, REQUESTED_DATE, DECIDED_BY, DECIDED_DATE,
        DECISION_COMMENTS FROM RR_PO_V_DOC_APPROVAL WHERE REQUEST_ID IN (${list})`);
    } catch {
      rows = await poQuery(`SELECT REQUEST_ID, STATUS, CURRENT_APPROVER AS APPROVER_NAME, CURRENT_APPROVER_EMAIL AS APPROVER_EMAIL,
        REQUESTED_BY_NAME, REQUESTED_DATE FROM RR_PO_V_APPROVALS WHERE REQUEST_ID IN (${list})`).catch(() => []);
    }
    rows.forEach(r => out.set(Number(r.REQUEST_ID), r as DocApproval));
  }
  return out;
}

/** Approval of one document; reloads when it is decided anywhere (bell, approvals page). */
export function useDocApproval(requestId: number | null | undefined, docId: number | null | undefined) {
  const [row, setRow] = useState<DocApproval | null>(null);
  const reload = useCallback(async () => {
    if (!requestId) { setRow(null); return; }
    try { setRow((await loadDocApprovals([requestId])).get(Number(requestId)) || null); } catch { setRow(null); }
  }, [requestId]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => onApprovalsChanged(d => {
    if (d.module === 'PROCUREMENT' && docId && Number(d.transactionId) === Number(docId)) reload();
  }), [docId, reload]);
  return { row, reload };
}

/** "Pending — with Javeed", "Approved by Javeed", "Rejected by Javeed", "Withdrawn". */
export const approvalLine = (a: DocApproval | null | undefined) => {
  if (!a) return '';
  const st = approvalState(a.STATUS);
  const who = a.DECIDED_BY || a.APPROVER_NAME;
  if (st === 'PENDING') return `Pending — with ${a.APPROVER_NAME || 'the approver'}`;
  if (st === 'APPROVED') return `Approved${who ? ` by ${who}` : ''}`;
  if (st === 'REJECTED') return `Rejected${who ? ` by ${who}` : ''}`;
  if (st === 'CANCELLED') return 'Withdrawn';
  return a.STATUS;
};

export const DocApprovalButton: React.FC<{
  docType: PoDocType; docId: number; docNumber: string; approval: DocApproval | null;
  /** offered when rejected / withdrawn */
  onSendAgain?: () => void;
  size?: 'small' | 'middle'; iconOnly?: boolean;
}> = ({ docType, docId, docNumber, approval, onSendAgain, size, iconOnly }) => {
  const [open, setOpen] = useState(false);
  if (!approval) return null;
  const st = approvalState(approval.STATUS);
  const look = APPROVAL_STATE_LOOK[st];
  const decided = st === 'APPROVED' || st === 'REJECTED';
  return (
    <>
      <Tooltip title={<>{approvalLine(approval)}<div style={{ fontSize: 11, opacity: 0.75 }}>Click for the approval history</div></>}>
        {iconOnly
          ? <Button size="small" type="text" icon={<AuditOutlined style={{ color: look.color }} />} onClick={e => { e.stopPropagation(); setOpen(true); }} />
          : <Button size={size} icon={<AuditOutlined />} style={{ color: look.color, borderColor: look.color }} onClick={() => setOpen(true)}>
              {approvalLine(approval)}
            </Button>}
      </Tooltip>
      <ApprovalStatusModal open={open} onClose={() => setOpen(false)} module="PROCUREMENT" transactionId={docId} transactionRef={docNumber}
        transactionTypes={[docType]} title={docNumber} status={approval.STATUS}
        sentBy={approval.REQUESTED_BY_NAME} sentDate={approval.REQUESTED_DATE}
        approverName={decided ? (approval.DECIDED_BY || approval.APPROVER_NAME) : approval.APPROVER_NAME}
        approverEmail={approval.APPROVER_EMAIL} decisionDate={approval.DECIDED_DATE}
        onSendAgain={onSendAgain && (st === 'REJECTED' || st === 'CANCELLED') ? () => { setOpen(false); onSendAgain(); } : undefined} />
    </>
  );
};
