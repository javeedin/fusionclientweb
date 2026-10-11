// ─────────────────────────────────────────────────────────────────────────────
// Approval Management Engine — Service Layer
// ─────────────────────────────────────────────────────────────────────────────

import { buildApexUrl } from '../config/api.helper';
import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = buildApexUrl('approvals');

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ApprovalUser {
  userId: number;
  fullName: string;
  email: string;
  department?: string;
  jobTitle?: string;
  maxApprovalAmount?: number | null;  // null = unlimited
  currency: string;
  modules: string[];  // ['AP', 'AR', 'CASH', 'GL', 'FA', 'PROCUREMENT']
  active: 'Y' | 'N';
  phoneNumber?: string;
  createdBy?: string;
  creationDate?: string;
  lastUpdateDate?: string;
}

export interface RuleApprover {
  sequence: number;
  userId: number;
  fullName: string;
  email: string;
  department?: string;
}

export interface ApprovalRule {
  ruleId: number;
  ruleName: string;
  module: string;
  transactionType: string;
  description?: string;
  minAmount: number;
  maxAmount?: number | null;  // null = unlimited
  currency: string;
  approvalType: 'SEQUENTIAL' | 'PARALLEL' | 'ANY_ONE';
  approvers: RuleApprover[];
  active: 'Y' | 'N';
  priority: number;
  createdBy?: string;
  creationDate?: string;
}

export interface ApprovalRequest {
  requestId: number;
  module: string;
  transactionType: string;
  transactionId?: number;
  transactionRef: string;
  amount: number;
  currency: string;
  description?: string;
  requestedByName: string;
  requestedDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RECALLED';
  ruleId?: number;
  ruleName?: string;
  currentApproverName?: string;
  history?: ApprovalHistoryEntry[];
}

export interface ApprovalHistoryEntry {
  historyId: number;
  requestId: number;
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'FORWARDED' | 'RECALLED' | 'NOTIFIED' | 'CANCELLED';
  actorName: string;
  comments?: string;
  actionDate: string;
  notificationSent: 'Y' | 'N';
}

export interface EmailReply {
  replyId: number;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  actionDetected: 'APPROVE' | 'REJECT' | 'UNKNOWN';
  refNumber: string;
  requestId: number | null;
  status: 'PENDING' | 'PROCESSED' | 'IGNORED';
  receivedDate: string;
  processedDate?: string;
  processedBy?: string;
  notes?: string;
}

export interface ApprovalToken {
  tokenId: number;
  action: 'APPROVE' | 'REJECT';
  requestRef: string;
  requestId: number | null;
  toEmail: string;
  toName: string;
  status: 'PENDING' | 'USED' | 'EXPIRED';
  createdDate: string;
  expiresDate: string;
  usedDate?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const APPROVAL_MODULES = ['AP', 'AR', 'CASH', 'GL', 'FA', 'PROCUREMENT'] as const;

export const TRANSACTION_TYPES: Record<string, string[]> = {
  AP:          ['INVOICE', 'PAYMENT', 'CREDIT_NOTE'],
  AR:          ['INVOICE', 'RECEIPT'],
  CASH:        ['EXTERNAL_TXN', 'BANK_TRANSFER'],
  GL:          ['JOURNAL'],
  FA:          ['ASSET_ADDITION', 'DISPOSAL'],
  PROCUREMENT: ['PURCHASE_ORDER', 'REQUISITION', 'PO_CHANGE_ORDER'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

// ─── Approver Users CRUD ──────────────────────────────────────────────────────

export async function getApprovalUsers(): Promise<ApprovalUser[]> {
  const res = await fetch(`${BASE}/users`);
  const data = await handleResponse<{ items?: any[] } | any[]>(res);
  const raw: any[] = Array.isArray(data) ? data : (data as { items?: any[] }).items ?? [];
  return raw.map(u => ({
    ...u,
    modules: typeof u.modules === 'string'
      ? u.modules.split(',').map((s: string) => s.trim()).filter(Boolean)
      : (u.modules ?? []),
  }));
}

export async function createApprovalUser(
  payload: Omit<ApprovalUser, 'userId' | 'createdBy' | 'creationDate' | 'lastUpdateDate'>
): Promise<{ userId: number }> {
  const res = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ userId: number }>(res);
}

export async function updateApprovalUser(
  userId: number,
  payload: Partial<ApprovalUser>
): Promise<void> {
  const res = await fetch(`${BASE}/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await handleResponse<void>(res);
}

export async function deleteApprovalUser(userId: number): Promise<void> {
  const res = await fetch(`${BASE}/users/${userId}`, { method: 'DELETE' });
  await handleResponse<void>(res);
}

// ─── Approval Rules CRUD ──────────────────────────────────────────────────────

export async function getApprovalRules(module?: string): Promise<ApprovalRule[]> {
  const url = module ? `${BASE}/rules?module=${encodeURIComponent(module)}` : `${BASE}/rules`;
  const res = await fetch(url);
  const data = await handleResponse<{ items?: ApprovalRule[] } | ApprovalRule[]>(res);
  if (Array.isArray(data)) return data;
  return (data as { items?: ApprovalRule[] }).items ?? [];
}

export async function createApprovalRule(
  payload: Omit<ApprovalRule, 'ruleId' | 'createdBy' | 'creationDate'>
): Promise<{ ruleId: number }> {
  const res = await fetch(`${BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ ruleId: number }>(res);
}

export async function updateApprovalRule(
  ruleId: number,
  payload: Partial<ApprovalRule>
): Promise<void> {
  const res = await fetch(`${BASE}/rules/${ruleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await handleResponse<void>(res);
}

export async function deleteApprovalRule(ruleId: number): Promise<void> {
  const res = await fetch(`${BASE}/rules/${ruleId}`, { method: 'DELETE' });
  await handleResponse<void>(res);
}

// ─── Approval Requests ────────────────────────────────────────────────────────

export async function getApprovalRequests(params?: {
  module?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<ApprovalRequest[]> {
  const qs = new URLSearchParams();
  if (params?.module) qs.set('module', params.module);
  if (params?.status) qs.set('status', params.status);
  if (params?.from)   qs.set('from', params.from);
  if (params?.to)     qs.set('to', params.to);
  const url = `${BASE}/requests${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await fetch(url);
  const data = await handleResponse<{ items?: ApprovalRequest[] } | ApprovalRequest[]>(res);
  if (Array.isArray(data)) return data;
  return (data as { items?: ApprovalRequest[] }).items ?? [];
}

export async function getApprovalHistory(requestId: number): Promise<ApprovalHistoryEntry[]> {
  const res = await fetch(`${BASE}/requests/${requestId}/history`);
  const data = await handleResponse<{ items?: ApprovalHistoryEntry[] } | ApprovalHistoryEntry[]>(res);
  if (Array.isArray(data)) return data;
  return (data as { items?: ApprovalHistoryEntry[] }).items ?? [];
}

export async function submitApprovalAction(
  requestId: number,
  action: ApprovalHistoryEntry['action'],
  actorName: string,
  comments?: string
): Promise<void> {
  const res = await fetch(`${BASE}/requests/${requestId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, actorName, comments }),
  });
  await handleResponse<void>(res);
}

export async function updateApprovalStatus(
  requestId: number,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RECALLED',
  actorName: string,
  comments?: string,
  actorEmail?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/requests/${requestId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, actorName, actorEmail, comments }),
  });
  await handleResponse<void>(res);
}

// ─── Approval Tokens ─────────────────────────────────────────────────────────

async function generateApprovalTokens(
  requestRef: string,
  requestId: number | undefined,
  toEmail: string,
  toName: string,
  transactionType?: string,
): Promise<{ approveToken: string; rejectToken: string }> {
  const res = await fetch(`${BASE}/generate-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestRef, requestId, toEmail, toName, transactionType }),
  });
  return handleResponse<{ approveToken: string; rejectToken: string }>(res);
}

// ─── Email ────────────────────────────────────────────────────────────────────

function buildApprovalEmailHtml(
  recipientName: string,
  today: string,
  approveUrl: string,
  rejectUrl: string,
  requestRef = 'INV-TEST-001',
): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approval Required</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0"
  style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);max-width:600px;">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#C74634 0%,#9B3528 100%);padding:32px;text-align:center;">
    <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.70);margin-bottom:8px;text-transform:uppercase;">Bumeric Business Solutions</div>
    <div style="font-size:28px;font-weight:700;color:#ffffff;margin-bottom:6px;">&#128338; Approval Required</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.80);">ERP Approval Management System</div>
  </td></tr>

  <!-- ALERT BAR -->
  <tr><td style="background:#fff8e1;padding:12px 32px;border-bottom:2px solid #ffe082;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:13px;color:#7c5a00;font-weight:600;">&#9888;&nbsp; Action Required — Please click Approve or Reject below</td>
      <td align="right" style="font-size:11px;color:#bbb;white-space:nowrap;">Test &bull; ${today}</td>
    </tr></table>
  </td></tr>

  <!-- BODY -->
  <tr><td style="padding:28px 32px 0;">
    <p style="margin:0 0 10px;font-size:15px;color:#1a1a1a;font-weight:500;">Dear ${recipientName},</p>
    <p style="margin:0 0 22px;font-size:13px;color:#555;line-height:1.7;">
      A transaction has been submitted for your approval. Click <strong>Approve</strong> or
      <strong>Reject</strong> below — your response will be recorded instantly.
      Each link is single-use and expires in 72 hours.
    </p>
  </td></tr>

  <!-- DETAILS TABLE -->
  <tr><td style="padding:0 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
      style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
      <tr><td colspan="2" style="background:#f8f9fa;padding:10px 16px;
        font-size:10px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;">
        Transaction Details
      </td></tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;width:130px;background:#fff;">Module</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:600;background:#fff;">Accounts Payable (AP)</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#f8f9fa;">Type</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:600;background:#f8f9fa;">Invoice</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#fff;">Reference</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:600;background:#fff;">${requestRef}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#f8f9fa;">Amount</td>
        <td style="padding:11px 16px;font-size:16px;font-weight:700;color:#C74634;background:#f8f9fa;">AED 125,000.00</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#fff;">Submitted By</td>
        <td style="padding:11px 16px;font-size:13px;background:#fff;">System Test User</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#f8f9fa;">Date</td>
        <td style="padding:11px 16px;font-size:13px;background:#f8f9fa;">${today}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#fff;">Description</td>
        <td style="padding:11px 16px;font-size:13px;color:#555;background:#fff;">Test notification — vendor invoice for Q4 services</td>
      </tr>
    </table>
  </td></tr>

  <!-- ACTION BUTTONS -->
  <tr><td style="padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="padding:0 8px;">
          <a href="${approveUrl}"
            style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;
              padding:14px 40px;border-radius:7px;font-weight:700;font-size:15px;
              letter-spacing:0.4px;box-shadow:0 3px 10px rgba(22,163,74,0.40);">
            &#10003;&nbsp;APPROVE
          </a>
        </td>
        <td style="padding:0 8px;">
          <a href="${rejectUrl}"
            style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;
              padding:14px 40px;border-radius:7px;font-weight:700;font-size:15px;
              letter-spacing:0.4px;box-shadow:0 3px 10px rgba(220,38,38,0.40);">
            &#10007;&nbsp;REJECT
          </a>
        </td>
      </tr></table>
    </td></tr></table>
    <p style="text-align:center;margin:12px 0 0;font-size:11px;color:#aaa;">
      Each button is a single-use secure link valid for 72 hours.
    </p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f8f9fa;border-top:1px solid #e8e8e8;padding:18px 32px;text-align:center;">
    <p style="margin:0 0 4px;font-size:11px;color:#bbb;">
      This is an automated notification from the ERP Approval System. Please do not reply to this email.
    </p>
    <p style="margin:0;font-size:11px;color:#ddd;">
      &copy; ${new Date().getFullYear()} Bumeric Business Solutions LLC
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export async function sendTestNotification(
  toEmail: string,
  toName: string,
): Promise<{ success: boolean; message: string; usingTokens?: boolean }> {
  // Fetch email config only to get fromEmail for mailto: fallback links
  const cfgRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/config/emailsettings`);
  const cfg = await cfgRes.json();
  const monitoredInbox: string = cfg.status === 'success' ? cfg.user : toEmail;

  const requestRef = 'INV-TEST-001';
  const today = new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' });

  // Try secure token links first; fall back to mailto: if tokens endpoint not deployed yet
  let approveUrl: string;
  let rejectUrl: string;
  let usingTokens = false;
  let tokenError: string | null = null;
  try {
    const { approveToken, rejectToken } = await generateApprovalTokens(
      requestRef, undefined, toEmail, toName,
    );
    approveUrl  = `https://erp-approval.reerperp.workers.dev?token=${approveToken}`;
    rejectUrl   = `https://erp-approval.reerperp.workers.dev?token=${rejectToken}`;
    usingTokens = true;
  } catch (err) {
    tokenError = err instanceof Error ? err.message.slice(0, 300) : String(err);
    const approveSubject = encodeURIComponent(`APPROVE: ${requestRef} [ERP]`);
    const rejectSubject  = encodeURIComponent(`REJECT: ${requestRef} [ERP]`);
    const approveBody    = encodeURIComponent(`APPROVE\n\nReference: ${requestRef}\nPlease do not modify the subject line or the first word of this email.`);
    const rejectBody     = encodeURIComponent(`REJECT\n\nReference: ${requestRef}\nPlease do not modify the subject line or the first word of this email.`);
    approveUrl = `mailto:${monitoredInbox}?subject=${approveSubject}&body=${approveBody}`;
    rejectUrl  = `mailto:${monitoredInbox}?subject=${rejectSubject}&body=${rejectBody}`;
  }

  const html = buildApprovalEmailHtml(toName, today, approveUrl, rejectUrl, requestRef);

  // Send via ORDS server-side proxy — Oracle Cloud uses a fixed outbound IP
  const sendRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/approvals/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toEmail,
      toName,
      subject:     `[TEST] Approval Required — ${requestRef}`,
      htmlContent: html,
    }),
  });
  const sendData = await sendRes.json().catch(() => ({ status: 'ERROR', message: sendRes.statusText }));

  if (sendData.status === 'SUCCESS') {
    if (usingTokens) {
      return { success: true, usingTokens: true, message: `Email sent to ${toEmail}. Secure single-use links embedded (expire in 72 hours). Check Token Links tab.` };
    }
    return { success: true, usingTokens: false, message: `Email sent to ${toEmail} using mailto: reply links — secure token links not active. Run SQL patches 07 + 08 in APEX to enable token links.${tokenError ? `\n\nToken endpoint error: ${tokenError}` : ''}` };
  }
  return { success: false, usingTokens: false, message: sendData.message ?? 'Email send failed' };
}

// ─── Email Replies ────────────────────────────────────────────────────────────

export async function getEmailReplies(): Promise<EmailReply[]> {
  const res  = await fetch(`${BASE}/email-replies`);
  const data = await handleResponse<{ items?: EmailReply[] }>(res);
  return data.items ?? [];
}

export async function processEmailReply(
  replyId: number,
  action: string,
  requestId: number | null,
  notes?: string,
  actorName?: string,
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${BASE}/email-replies/${replyId}/process`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, requestId, actorName, notes: notes ?? `Processed via ERP on ${new Date().toLocaleString()}` }),
  });
  return handleResponse<{ status: string; message: string }>(res);
}

export async function simulateEmailReply(
  action: 'APPROVE' | 'REJECT',
  refNumber: string,
  fromEmail = 'approver@test.com',
  fromName  = 'Test Approver',
): Promise<void> {
  const res = await fetch(`${BASE}/email-replies/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, refNumber, fromEmail, fromName }),
  });
  await handleResponse<unknown>(res);
}

export async function getApprovalTokens(): Promise<ApprovalToken[]> {
  const res  = await fetch(`${BASE}/tokens`);
  const data = await handleResponse<{ items?: ApprovalToken[] }>(res);
  return data.items ?? [];
}

// ─── External Transaction Approval ───────────────────────────────────────────

function buildTxnApprovalEmailHtml(params: {
  recipientName: string;
  today: string;
  approveUrl: string;
  rejectUrl: string;
  txnRef: string;
  txnType: string;
  amount: number;
  currency: string;
  description: string;
  submittedBy: string;
}): string {
  const { recipientName, today, approveUrl, rejectUrl, txnRef, txnType, amount, currency, description, submittedBy } = params;
  const fmtAmt = `${currency} ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approval Required</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0"
  style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);max-width:600px;">
  <tr><td style="background:linear-gradient(135deg,#C74634 0%,#9B3528 100%);padding:32px;text-align:center;">
    <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.70);margin-bottom:8px;text-transform:uppercase;">Bumeric Business Solutions</div>
    <div style="font-size:28px;font-weight:700;color:#ffffff;margin-bottom:6px;">&#128338; Approval Required</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.80);">Cash — External Transaction Approval</div>
  </td></tr>
  <tr><td style="background:#fff8e1;padding:12px 32px;border-bottom:2px solid #ffe082;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:13px;color:#7c5a00;font-weight:600;">&#9888;&nbsp; Action Required — Please click Approve or Reject below</td>
      <td align="right" style="font-size:11px;color:#bbb;white-space:nowrap;">${today}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 32px 0;">
    <p style="margin:0 0 10px;font-size:15px;color:#1a1a1a;font-weight:500;">Dear ${recipientName},</p>
    <p style="margin:0 0 22px;font-size:13px;color:#555;line-height:1.7;">
      A cash external transaction has been submitted for your approval. Click <strong>Approve</strong> or
      <strong>Reject</strong> below — your response will be recorded instantly.
      Each link is single-use and expires in 72 hours.
    </p>
  </td></tr>
  <tr><td style="padding:0 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
      style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
      <tr><td colspan="2" style="background:#f8f9fa;padding:10px 16px;font-size:10px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;">Transaction Details</td></tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;width:130px;background:#fff;">Module</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:600;background:#fff;">Cash Management</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#f8f9fa;">Transaction Type</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:600;background:#f8f9fa;">${txnType || '—'}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#fff;">Reference</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:600;background:#fff;">${txnRef}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#f8f9fa;">Amount</td>
        <td style="padding:11px 16px;font-size:16px;font-weight:700;color:#C74634;background:#f8f9fa;">${fmtAmt}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#fff;">Submitted By</td>
        <td style="padding:11px 16px;font-size:13px;background:#fff;">${submittedBy}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#f8f9fa;">Date</td>
        <td style="padding:11px 16px;font-size:13px;background:#f8f9fa;">${today}</td>
      </tr>
      <tr style="border-top:1px solid #e8e8e8;">
        <td style="padding:11px 16px;font-size:12px;color:#888;background:#fff;">Description</td>
        <td style="padding:11px 16px;font-size:13px;color:#555;background:#fff;">${description || '—'}</td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="padding:0 8px;">
          <a href="${approveUrl}"
            style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;
              padding:14px 40px;border-radius:7px;font-weight:700;font-size:15px;
              letter-spacing:0.4px;box-shadow:0 3px 10px rgba(22,163,74,0.40);">
            &#10003;&nbsp;APPROVE
          </a>
        </td>
        <td style="padding:0 8px;">
          <a href="${rejectUrl}"
            style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;
              padding:14px 40px;border-radius:7px;font-weight:700;font-size:15px;
              letter-spacing:0.4px;box-shadow:0 3px 10px rgba(220,38,38,0.40);">
            &#10007;&nbsp;REJECT
          </a>
        </td>
      </tr></table>
    </td></tr></table>
    <p style="text-align:center;margin:12px 0 0;font-size:11px;color:#aaa;">Each button is a single-use secure link valid for 72 hours.</p>
  </td></tr>
  <tr><td style="background:#f8f9fa;border-top:1px solid #e8e8e8;padding:18px 32px;text-align:center;">
    <p style="margin:0 0 4px;font-size:11px;color:#bbb;">This is an automated notification from the ERP Approval System. Please do not reply to this email.</p>
    <p style="margin:0;font-size:11px;color:#ddd;">&copy; ${new Date().getFullYear()} Bumeric Business Solutions LLC</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ─── Approval status shown on the screens ────────────────────────────────────
// Stored values differ by path: PENDING, 'Manually approved' (in-app) / 'Workflow approved' / APPROVED,
// 'Rejected' / REJECTED, CANCELLED / RECALLED / Withdrawn, 'Not required' / 'Required' (not sent yet).

export type ApprovalState = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export function approvalState(s?: string | null): ApprovalState {
  const v = String(s ?? '').trim().toUpperCase();
  if (!v || v === 'NONE' || v === 'NOT REQUIRED' || v === 'REQUIRED') return 'NONE';
  if (v.includes('APPROVED')) return 'APPROVED';
  if (v.startsWith('REJECT')) return 'REJECTED';
  if (['CANCELLED', 'CANCELED', 'RECALLED', 'WITHDRAWN', 'STOPPED'].includes(v)) return 'CANCELLED';
  return 'PENDING';
}

export const APPROVAL_STATE_LOOK: Record<ApprovalState, { label: string; tag: string; color: string }> = {
  NONE:      { label: 'Not sent',         tag: 'default', color: '#6B6B6B' },
  PENDING:   { label: 'Pending Approval', tag: 'orange',  color: '#D4A800' },
  APPROVED:  { label: 'Approved',         tag: 'green',   color: '#1D7B4D' },
  REJECTED:  { label: 'Rejected',         tag: 'red',     color: '#D93025' },
  CANCELLED: { label: 'Cancelled',        tag: 'default', color: '#6B6B6B' },
};

/** Nothing active — the transaction can be sent (again). */
export const canSendForApproval = (s?: string | null) => ['NONE', 'CANCELLED'].includes(approvalState(s));

/** One line for a tooltip: "Sent for approval — waiting for Javeed", "Approved by Javeed · 11-Oct-2026" … */
export function approvalSummary(s: string | null | undefined, who?: { approverName?: string; approvedDate?: string }): string {
  const st = approvalState(s);
  const by = who?.approverName ? ` by ${who.approverName}` : '';
  const on = who?.approvedDate ? ` · ${new Date(who.approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')}` : '';
  if (st === 'PENDING')  return `Sent for approval${who?.approverName ? ` — waiting for ${who.approverName}` : ''}`;
  if (st === 'APPROVED') return `Approved${by}${on}`;
  if (st === 'REJECTED') return `Rejected${by}${on}`;
  if (st === 'CANCELLED') return 'Approval request cancelled — send again';
  return 'Send for approval';
}

// ─── Live updates between the notification bell and the screens ─────────────

export const APPROVALS_CHANGED_EVENT = 'rr:approvals-changed';
export interface ApprovalsChangedDetail {
  /** sent: a request was created (the bell refreshes) · decided: approved / rejected in the app */
  reason: 'sent' | 'decided';
  module?: string;
  transactionId?: number;
  transactionRef?: string;
  status?: 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RECALLED';
  actorName?: string;
}
export const emitApprovalsChanged = (detail: ApprovalsChangedDetail) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(APPROVALS_CHANGED_EVENT, { detail }));
};
export const onApprovalsChanged = (fn: (d: ApprovalsChangedDetail) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<ApprovalsChangedDetail>).detail || { reason: 'sent' });
  window.addEventListener(APPROVALS_CHANGED_EVENT, h);
  return () => window.removeEventListener(APPROVALS_CHANGED_EVENT, h);
};
/** The value AP invoices / cash transactions hold after an in-app decision (see PUT approvals/requests/:id/status). */
export const storedDecision = (status?: string) => (status === 'APPROVED' ? 'Manually approved' : status === 'REJECTED' ? 'Rejected' : status || 'PENDING');

// ─── Approval trail of one transaction (every request and every action) ─────

export interface ApprovalTrailEvent {
  requestId: number;
  action: string;            // SUBMITTED, APPROVED, REJECTED, CANCELLED, RECALLED, NOTIFIED, FORWARDED
  actorName?: string;
  comments?: string;
  actionDate?: string;
  requestStatus?: string;
  approverName?: string;
  approverEmail?: string;
}
export interface ApprovalTrail { events: ApprovalTrailEvent[]; requests: number; source: 'query' | 'rest' }

const sqlLit = (v: unknown) => `'${String(v ?? '').replace(/'/g, "''")}'`;

/**
 * All requests and actions for one transaction, oldest first. Reads RR_APPROVAL_REQUESTS / _HISTORY through the
 * read gateway (one call); falls back to the approvals REST endpoints when the gateway is not available.
 */
export async function getApprovalTrail(params: {
  module: string; transactionId?: number; transactionRef?: string;
  /** only these transaction types (purchasing has POs, requisitions and change orders under one module) */
  transactionTypes?: string[];
}): Promise<ApprovalTrail> {
  const { module, transactionId, transactionRef, transactionTypes } = params;
  const types = (transactionTypes || []).filter(Boolean);
  const idOk = transactionId != null && Number.isFinite(Number(transactionId));
  const match = idOk
    ? `(r.TRANSACTION_ID = ${Number(transactionId)}${transactionRef ? ` OR (r.TRANSACTION_ID IS NULL AND r.TRANSACTION_REF = ${sqlLit(transactionRef)})` : ''})`
    : `r.TRANSACTION_REF = ${sqlLit(transactionRef)}`;
  const sql = `SELECT r.REQUEST_ID, r.STATUS AS REQUEST_STATUS, u.FULL_NAME AS APPROVER_NAME, u.EMAIL AS APPROVER_EMAIL,
      h.HISTORY_ID, h.ACTION, h.ACTOR_NAME, h.COMMENTS, TO_CHAR(h.ACTION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS ACTION_DATE
    FROM RR_APPROVAL_REQUESTS r
    LEFT JOIN RR_APPROVAL_USERS u ON u.USER_ID = r.CURRENT_APPROVER_ID
    LEFT JOIN RR_APPROVAL_HISTORY h ON h.REQUEST_ID = r.REQUEST_ID
    WHERE r.MODULE = ${sqlLit(module)} AND ${match}${types.length ? ` AND r.TRANSACTION_TYPE IN (${types.map(sqlLit).join(', ')})` : ''}
    ORDER BY r.REQUEST_ID, h.ACTION_DATE, h.HISTORY_ID`;
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/ai/executequery`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sql: sql.replace(/\s+/g, ' ').trim(), maxRows: 1000, appUser: 'APPROVALS' }),
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
    const cols: string[] = (data.columns || []).map((c: any) => String(typeof c === 'string' ? c : c?.name ?? c).toUpperCase());
    const rows: Record<string, any>[] = (data.rows || []).map((r: any[]) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    const events: ApprovalTrailEvent[] = rows.filter(r => r.ACTION).map(r => ({
      requestId: Number(r.REQUEST_ID), action: String(r.ACTION), actorName: r.ACTOR_NAME ?? undefined, comments: r.COMMENTS ?? undefined,
      actionDate: r.ACTION_DATE ?? undefined, requestStatus: r.REQUEST_STATUS ?? undefined,
      approverName: r.APPROVER_NAME ?? undefined, approverEmail: r.APPROVER_EMAIL ?? undefined,
    }));
    return { events, requests: new Set(rows.map(r => Number(r.REQUEST_ID))).size, source: 'query' };
  } catch {
    // fallback: the module's requests, then each request's history
    const reqs = (await getApprovalRequests({ module })).filter(r =>
      (!types.length || types.includes(r.transactionType))
      && (idOk && r.transactionId != null ? Number(r.transactionId) === Number(transactionId) : r.transactionRef === transactionRef));
    const events: ApprovalTrailEvent[] = [];
    for (const r of reqs.sort((a, b) => a.requestId - b.requestId)) {
      const hist = await getApprovalHistory(r.requestId).catch(() => [] as ApprovalHistoryEntry[]);
      hist.forEach((h: any) => events.push({
        requestId: r.requestId, action: h.action, actorName: h.actorName, comments: h.comments, actionDate: h.actionDate,
        requestStatus: r.status, approverName: r.currentApproverName, approverEmail: (r as any).currentApproverEmail,
      }));
    }
    return { events, requests: reqs.length, source: 'rest' };
  }
}

export interface ApprovalDebugStep {
  step: string;
  url: string;
  method: string;
  payload?: unknown;
  status: number | string;
  response: unknown;
}

// ─── Internal: in-app approval request (RR_APPROVAL_REQUESTS) ────────────────
// The request is what the approver sees in the notification bell and acts on in the app.

interface ApprovalRequestInput {
  module: string;
  transactionType: string;
  transactionId: number;
  transactionRef: string;
  amount: number;
  currency: string;
  description: string;
  requestedByName: string;
  approverEmail: string;
}

async function createApprovalRequest(
  params: ApprovalRequestInput,
  debug: ApprovalDebugStep[],
  step: string,
): Promise<{ ok: boolean; requestId?: number; error?: string }> {
  const url = `${BASE}/requests`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    debug.push({ step, url, method: 'POST', payload: params, status: res.status, response: data });
    if (!res.ok || data?.status !== 'SUCCESS') {
      return { ok: false, error: data?.message || `Could not create the approval request (HTTP ${res.status}${res.status === 404 ? ' — approvals/requests is not deployed' : ''})` };
    }
    return { ok: true, requestId: Number(data.requestId) || undefined };
  } catch (err) {
    debug.push({ step, url, method: 'POST', payload: params, status: 'ERROR', response: String(err) });
    return { ok: false, error: `Could not reach the approvals service: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Cancel a request (best-effort), recording the call in the debug log. */
async function cancelApprovalRequest(requestId: number, actorName: string, comments: string, debug: ApprovalDebugStep[], step: string): Promise<boolean> {
  const url = `${BASE}/requests/${requestId}/status`;
  const payload = { status: 'CANCELLED', actorName, comments };
  try {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    debug.push({ step, url, method: 'PUT', payload, status: res.status, response: data });
    return res.ok;
  } catch (err) {
    debug.push({ step, url, method: 'PUT', payload, status: 'ERROR', response: String(err) });
    return false;
  }
}

/** Cancel the transaction's other PENDING requests (a resend replaces them). Best-effort. */
async function replaceEarlierRequests(
  module: string, match: (r: ApprovalRequest) => boolean, keepId: number | undefined, actor: string, debug: ApprovalDebugStep[], step: string,
): Promise<void> {
  try {
    const pending = await getApprovalRequests({ module, status: 'PENDING' });
    const older = pending.filter(r => r.status === 'PENDING' && Number(r.requestId) !== keepId && match(r));
    for (const r of older) {
      await cancelApprovalRequest(Number(r.requestId), actor, `Replaced by request #${keepId ?? ''}`.trim(), debug, `${step} #${r.requestId}`);
    }
  } catch (err) {
    debug.push({ step, url: `${BASE}/requests`, method: 'GET', status: 'ERROR', response: String(err) });
  }
}

/**
 * Send a cash external transaction for approval.
 * In-app first: the request goes to the approver's notifications, where they approve or reject it;
 * the transaction is marked PENDING. A resend replaces the transaction's earlier pending request.
 * The approval email (single-use links) is optional — off unless `sendEmail` is set.
 */
export async function sendExternalTxnApproval(params: {
  txnId: number;
  txnRef: string;
  txnType: string;
  amount: number;
  currency: string;
  description: string;
  approverEmail: string;
  approverName: string;
  sentBy: string;
  sendEmail?: boolean;
}): Promise<{ success: boolean; message: string; debug: ApprovalDebugStep[]; requestId?: number; warning?: string }> {
  const { txnId, txnRef, txnType, amount, currency, description, approverEmail, approverName, sentBy, sendEmail = false } = params;
  const debug: ApprovalDebugStep[] = [];
  const approvalRef = `CASH-EXT-${txnId}`;

  // Step 1 — Create the in-app approval request (required)
  const created = await createApprovalRequest({
    module: 'CASH', transactionType: txnType || 'EXTERNAL_TXN',
    transactionId: txnId, transactionRef: approvalRef,
    amount, currency, description: description || txnRef, requestedByName: sentBy, approverEmail,
  }, debug, '1 — Create In-App Approval Request');
  if (!created.ok) return { success: false, message: created.error || 'Could not create the approval request', debug };
  const requestId = created.requestId;

  // Step 2 — Replace earlier pending requests for this transaction (best-effort)
  await replaceEarlierRequests('CASH', r => r.transactionRef === approvalRef, requestId, sentBy, debug, '2 — Cancel Earlier Request');

  // Step 3 — Mark the transaction PENDING (required; undo the request when it fails)
  const putUrl = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${txnId}/approval`;
  const putPayload = { approvalStatus: 'PENDING', approvalSentBy: sentBy, approverName, approverEmail, approvalRef };
  let putError = '';
  try {
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putPayload),
    });
    const putData = await putRes.json().catch(() => putRes.statusText);
    debug.push({ step: '3 — Update Txn Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: putRes.status, response: putData });
    if (!putRes.ok) putError = `Failed to update the transaction's approval status (${putRes.status}): ${typeof putData === 'string' ? putData : putData?.message || JSON.stringify(putData)}`;
  } catch (err) {
    debug.push({ step: '3 — Update Txn Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: 'ERROR', response: String(err) });
    putError = err instanceof Error ? err.message : String(err);
  }
  if (putError) {
    if (requestId) await cancelApprovalRequest(requestId, sentBy, 'Transaction could not be marked pending', debug, '3b — Undo Approval Request');
    return { success: false, message: putError, debug };
  }

  emitApprovalsChanged({ reason: 'sent', module: 'CASH', transactionId: txnId, transactionRef: approvalRef });
  const sentMsg = `Sent to ${approverName} for approval — it is waiting in their notifications${requestId ? ` (request #${requestId})` : ''}.`;
  if (!sendEmail) return { success: true, message: sentMsg, debug, requestId };

  // Step 4 — Optional approval email with single-use links (failure does not undo the request)
  const today = new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' });
  let warning = '';
  const tokensUrl = `${BASE}/generate-links`;
  const tokensPayload = { requestRef: approvalRef, requestId: requestId ?? txnId, toEmail: approverEmail, toName: approverName, transactionType: txnType };
  try {
    const tokRes = await fetch(tokensUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tokensPayload) });
    const tokData = await tokRes.json().catch(() => ({}));
    debug.push({ step: '4 — Generate Email Tokens', url: tokensUrl, method: 'POST', payload: tokensPayload, status: tokRes.status, response: tokData });
    if (!tokRes.ok) throw new Error(`Generate tokens failed (${tokRes.status})`);
    const approveUrl = `https://erp-approval.reerperp.workers.dev?token=${tokData.approveToken ?? ''}`;
    const rejectUrl  = `https://erp-approval.reerperp.workers.dev?token=${tokData.rejectToken ?? ''}`;
    const emailUrl = `${APEX_DB_CONFIG.baseUrl}/approvals/send-email`;
    const html = buildTxnApprovalEmailHtml({ recipientName: approverName, today, approveUrl, rejectUrl, txnRef, txnType, amount, currency, description, submittedBy: sentBy });
    const emailPayload = { toEmail: approverEmail, toName: approverName, subject: `[Approval Required] ${txnType || 'External Transaction'} — ${txnRef}`, htmlContent: '(HTML omitted from debug — see full email)' };
    const sendRes = await fetch(emailUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...emailPayload, htmlContent: html }) });
    const sendData = await sendRes.json().catch(() => ({ status: 'ERROR', message: sendRes.statusText }));
    debug.push({ step: '5 — Send Email (ORDS proxy)', url: emailUrl, method: 'POST', payload: emailPayload, status: sendRes.status, response: sendData });
    if (sendData.status !== 'SUCCESS') throw new Error(sendData.message ?? 'Email send failed');
  } catch (err) {
    warning = `The email could not be sent (${err instanceof Error ? err.message : String(err)}); the approver can still act on it from their notifications.`;
  }
  return { success: true, message: warning ? sentMsg : `${sentMsg} An email with approve / reject links was also sent to ${approverEmail}.`, debug, requestId, warning: warning || undefined };
}

// ─── AP Invoice Approval ──────────────────────────────────────────────────────

function buildInvoiceApprovalEmailHtml(params: {
  recipientName: string;
  today: string;
  approveUrl: string;
  rejectUrl: string;
  invoiceNumber: string;
  invoiceType: string;
  amount: number;
  currency: string;
  supplier: string;
  submittedBy: string;
  businessUnit?: string;
  invoiceDate?: string;
  description?: string;
  createdBy?: string;
  attachmentContent?: string;
}): string {
  const { recipientName, today, approveUrl, rejectUrl, invoiceNumber, invoiceType, amount, currency, supplier, submittedBy, businessUnit, invoiceDate, description, createdBy } = params;
  const amountFmt = `${currency} ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AP Invoice Approval Required</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#0056b3 0%,#003d82 100%);padding:32px 40px;">
    <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">AP Invoice Approval Required</h1>
    <p style="margin:8px 0 0;color:#cce0ff;font-size:14px;">${today}</p>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <p style="margin:0 0 20px;font-size:15px;color:#333;">Dear <strong>${recipientName}</strong>,</p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.6;">
      The following AP invoice requires your approval. Please review the details and click Approve or Reject.
      ${params.attachmentContent !== undefined ? 'A PDF copy of the invoice is attached for your reference.' : ''}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f7ff;border-radius:8px;border:1px solid #cce0ff;padding:20px;margin-bottom:28px;">
      <tr><td style="padding:6px 0;font-size:13px;color:#666;width:140px;">Invoice Number</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;font-weight:600;">${invoiceNumber}</td></tr>
      ${invoiceDate ? `<tr><td style="padding:6px 0;font-size:13px;color:#666;">Invoice Date</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;">${invoiceDate}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-size:13px;color:#666;">Invoice Type</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;">${invoiceType}</td></tr>
      ${businessUnit ? `<tr><td style="padding:6px 0;font-size:13px;color:#666;">Business Unit</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;">${businessUnit}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-size:13px;color:#666;">Supplier</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;">${supplier}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#666;">Amount</td>
          <td style="padding:6px 0;font-size:16px;color:#0056b3;font-weight:700;">${amountFmt}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#666;">Submitted By</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;">${submittedBy}</td></tr>
      ${createdBy ? `<tr><td style="padding:6px 0;font-size:13px;color:#666;">Created By</td>
          <td style="padding:6px 0;font-size:14px;color:#1a1a1a;">${createdBy}</td></tr>` : ''}
      ${description ? `<tr><td style="padding:6px 0;font-size:13px;color:#666;">Description</td>
          <td style="padding:6px 0;font-size:13px;color:#555;">${description}</td></tr>` : ''}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="48%" align="center">
          <a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;width:100%;box-sizing:border-box;text-align:center;">
            ✓ Approve
          </a>
        </td>
        <td width="4%"></td>
        <td width="48%" align="center">
          <a href="${rejectUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;width:100%;box-sizing:border-box;text-align:center;">
            ✗ Reject
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#999;text-align:center;">
      These links are single-use and expire in 72 hours.
    </p>
  </td></tr>
  <tr><td style="background:#f8f9fa;border-top:1px solid #e8e8e8;padding:18px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#bbb;">Automated notification from ERP Approval System. Do not reply to this email.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * Send an AP invoice for approval — in-app first, like cash: the request goes to the approver's notifications,
 * an earlier pending request for the invoice is replaced, the invoice is marked PENDING.
 * The email (single-use links + invoice PDF) is optional — off unless `sendEmail` is set.
 */
export async function sendInvoiceApproval(params: {
  invoiceId: number;
  invoiceNumber: string;
  invoiceType: string;
  amount: number;
  currency: string;
  supplier: string;
  approverEmail: string;
  approverName: string;
  sentBy: string;
  businessUnit?: string;
  invoiceDate?: string;
  description?: string;
  createdBy?: string;
  attachmentContent?: string;
  attachmentName?: string;
  sendEmail?: boolean;
}): Promise<{ success: boolean; message: string; debug: ApprovalDebugStep[]; requestId?: number; warning?: string }> {
  const { invoiceId, invoiceNumber, invoiceType, amount, currency, supplier, approverEmail, approverName, sentBy, businessUnit, invoiceDate, description, createdBy, attachmentContent, attachmentName, sendEmail = false } = params;
  const debug: ApprovalDebugStep[] = [];

  const approvalRef = invoiceNumber;   // human-readable ref — visible in approval engine & email replies
  const today = new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' });

  // Step 1 — Create the in-app approval request (required)
  const created = await createApprovalRequest({
    module: 'AP', transactionType: 'INVOICE',
    transactionId: invoiceId, transactionRef: approvalRef,
    amount, currency,
    description: description || `Invoice ${invoiceNumber} — ${supplier}`,
    requestedByName: sentBy, approverEmail,
  }, debug, '1 — Create In-App Approval Request');
  if (!created.ok) return { success: false, message: created.error || 'Could not create the approval request', debug };
  const requestId = created.requestId;

  // Step 2 — Replace earlier pending requests for this invoice (best-effort)
  await replaceEarlierRequests('AP',
    r => (r.transactionId != null ? Number(r.transactionId) === invoiceId : r.transactionRef === approvalRef),
    requestId, sentBy, debug, '2 — Cancel Earlier Request');

  // Step 3 — Mark the invoice PENDING (required; undo the request when it fails)
  const putUrl = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/approval`;
  const putPayload = { approvalStatus: 'PENDING', approvalSentBy: sentBy, approverName, approverEmail, approvalRef };
  let putError = '';
  try {
    const putRes = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(putPayload) });
    const putData = await putRes.json().catch(() => putRes.statusText);
    debug.push({ step: '3 — Update Invoice Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: putRes.status, response: putData });
    if (!putRes.ok) putError = `Failed to update the invoice's approval status (${putRes.status}): ${typeof putData === 'string' ? putData : putData?.message || JSON.stringify(putData)}`;
  } catch (err) {
    debug.push({ step: '3 — Update Invoice Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: 'ERROR', response: String(err) });
    putError = err instanceof Error ? err.message : String(err);
  }
  if (putError) {
    if (requestId) await cancelApprovalRequest(requestId, sentBy, 'Invoice could not be marked pending', debug, '3b — Undo Approval Request');
    return { success: false, message: putError, debug };
  }

  emitApprovalsChanged({ reason: 'sent', module: 'AP', transactionId: invoiceId, transactionRef: approvalRef });
  const sentMsg = `Sent to ${approverName} for approval — it is waiting in their notifications${requestId ? ` (request #${requestId})` : ''}.`;
  if (!sendEmail) return { success: true, message: sentMsg, debug, requestId };

  // Step 4 — Optional email with single-use links and the invoice PDF (failure does not undo the request)
  let warning = '';
  const tokensUrl = `${BASE}/generate-links`;
  const tokensPayload = { requestRef: approvalRef, requestId: invoiceId, toEmail: approverEmail, toName: approverName, transactionType: 'INVOICE' };
  try {
    const tokRes = await fetch(tokensUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tokensPayload) });
    const tokData = await tokRes.json().catch(() => ({}));
    debug.push({ step: '4 — Generate Email Tokens', url: tokensUrl, method: 'POST', payload: tokensPayload, status: tokRes.status, response: tokData });
    if (!tokRes.ok) throw new Error(`Generate tokens failed (${tokRes.status})`);
    const approveUrl = `https://erp-approval.reerperp.workers.dev?token=${tokData.approveToken ?? ''}`;
    const rejectUrl  = `https://erp-approval.reerperp.workers.dev?token=${tokData.rejectToken ?? ''}`;
    const emailUrl = `${APEX_DB_CONFIG.baseUrl}/approvals/send-email`;
    const html = buildInvoiceApprovalEmailHtml({ recipientName: approverName, today, approveUrl, rejectUrl, invoiceNumber, invoiceType, amount, currency, supplier, submittedBy: sentBy, businessUnit, invoiceDate, description, createdBy, attachmentContent });
    const emailPayload = { toEmail: approverEmail, toName: approverName, subject: `[Approval Required] AP Invoice — ${invoiceNumber}`, htmlContent: '(HTML omitted from debug)' };
    const bodyToSend: Record<string, unknown> = { ...emailPayload, htmlContent: html };
    if (attachmentContent) {
      bodyToSend.attachmentContent = attachmentContent;
      bodyToSend.attachmentName = attachmentName || `Invoice-${invoiceNumber}.pdf`;
    }
    const sendRes = await fetch(emailUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyToSend) });
    const sendData = await sendRes.json().catch(() => ({ status: 'ERROR', message: sendRes.statusText }));
    debug.push({ step: '5 — Send Email (ORDS proxy)', url: emailUrl, method: 'POST', payload: emailPayload, status: sendRes.status, response: sendData });
    if (sendData.status !== 'SUCCESS') throw new Error(sendData.message ?? 'Email send failed');
  } catch (err) {
    warning = `The email could not be sent (${err instanceof Error ? err.message : String(err)}); the approver can still act on it from their notifications.`;
  }
  return { success: true, message: warning ? sentMsg : `${sentMsg} An email with the invoice PDF was also sent to ${approverEmail}.`, debug, requestId, warning: warning || undefined };
}
