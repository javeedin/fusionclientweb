// ─────────────────────────────────────────────────────────────────────────────
// Approval Management Engine — Service Layer
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:3001/api/apex/approvals';

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
  PROCUREMENT: ['PURCHASE_ORDER'],
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

export interface ApprovalDebugStep {
  step: string;
  url: string;
  method: string;
  payload?: unknown;
  status: number | string;
  response: unknown;
}

// ─── Internal: log to RR_APPROVAL_REQUESTS (best-effort) ─────────────────────

async function logApprovalRequest(
  params: {
    module: string;
    transactionType: string;
    transactionId: number;
    transactionRef: string;
    amount: number;
    currency: string;
    description: string;
    requestedByName: string;
    approverEmail: string;
  },
  debug: ApprovalDebugStep[],
): Promise<void> {
  const url = `${BASE}/requests`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    debug.push({ step: '4 — Log Approval Request', url, method: 'POST', payload: params, status: res.status, response: data });
  } catch (err) {
    debug.push({ step: '4 — Log Approval Request', url, method: 'POST', payload: params, status: 'ERROR', response: String(err) });
    // non-blocking — do not rethrow
  }
}

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
}): Promise<{ success: boolean; message: string; debug: ApprovalDebugStep[] }> {
  const { txnId, txnRef, txnType, amount, currency, description, approverEmail, approverName, sentBy } = params;
  const debug: ApprovalDebugStep[] = [];

  const approvalRef = `CASH-EXT-${txnId}`;
  const today = new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' });

  // Step 1 — Generate approval tokens
  const tokensUrl = `${BASE}/generate-links`;
  const tokensPayload = { requestRef: approvalRef, requestId: txnId, toEmail: approverEmail, toName: approverName, transactionType: txnType };
  let approveToken = '', rejectToken = '';
  try {
    const tokRes = await fetch(tokensUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokensPayload),
    });
    const tokData = await tokRes.json().catch(() => ({}));
    debug.push({ step: '1 — Generate Tokens', url: tokensUrl, method: 'POST', payload: tokensPayload, status: tokRes.status, response: tokData });
    if (!tokRes.ok) throw new Error(`Generate tokens failed (${tokRes.status}): ${JSON.stringify(tokData)}`);
    approveToken = tokData.approveToken ?? '';
    rejectToken  = tokData.rejectToken  ?? '';
  } catch (err) {
    if (debug.length === 0) debug.push({ step: '1 — Generate Tokens', url: tokensUrl, method: 'POST', payload: tokensPayload, status: 'ERROR', response: String(err) });
    return { success: false, message: err instanceof Error ? err.message : String(err), debug };
  }

  const approveUrl = `https://erp-approval.reerperp.workers.dev?token=${approveToken}`;
  const rejectUrl  = `https://erp-approval.reerperp.workers.dev?token=${rejectToken}`;

  // Step 2 — Mark transaction as PENDING in DB
  const putUrl = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${txnId}/approval`;
  const putPayload = { approvalStatus: 'PENDING', approvalSentBy: sentBy, approverName, approverEmail, approvalRef };
  try {
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putPayload),
    });
    const putData = await putRes.json().catch(() => putRes.statusText);
    debug.push({ step: '2 — Update Txn Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: putRes.status, response: putData });
    if (!putRes.ok) throw new Error(`Failed to update approval status (${putRes.status}): ${JSON.stringify(putData)}`);
  } catch (err) {
    if (debug.filter(d => d.step.startsWith('2')).length === 0) debug.push({ step: '2 — Update Txn Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: 'ERROR', response: String(err) });
    return { success: false, message: err instanceof Error ? err.message : String(err), debug };
  }

  // Step 3 — Send email via ORDS proxy
  const emailUrl = `${APEX_DB_CONFIG.baseUrl}/approvals/send-email`;
  const html = buildTxnApprovalEmailHtml({ recipientName: approverName, today, approveUrl, rejectUrl, txnRef, txnType, amount, currency, description, submittedBy: sentBy });
  const emailPayload = { toEmail: approverEmail, toName: approverName, subject: `[Approval Required] ${txnType || 'External Transaction'} — ${txnRef}`, htmlContent: '(HTML omitted from debug — see full email)' };
  try {
    const sendRes = await fetch(emailUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...emailPayload, htmlContent: html }),
    });
    const sendData = await sendRes.json().catch(() => ({ status: 'ERROR', message: sendRes.statusText }));
    debug.push({ step: '3 — Send Email (ORDS proxy)', url: emailUrl, method: 'POST', payload: emailPayload, status: sendRes.status, response: sendData });
    if (sendData.status !== 'SUCCESS') {
      return { success: false, message: sendData.message ?? 'Email send failed', debug };
    }
  } catch (err) {
    debug.push({ step: '3 — Send Email (ORDS proxy)', url: emailUrl, method: 'POST', payload: emailPayload, status: 'ERROR', response: String(err) });
    return { success: false, message: err instanceof Error ? err.message : String(err), debug };
  }

  // Step 4 — Log to RR_APPROVAL_REQUESTS (best-effort, non-blocking)
  await logApprovalRequest({
    module: 'CASH', transactionType: txnType || 'EXTERNAL_TXN',
    transactionId: txnId, transactionRef: approvalRef,
    amount, currency, description, requestedByName: sentBy, approverEmail,
  }, debug);

  return { success: true, message: `Approval email sent to ${approverName} (${approverEmail}). Single-use links expire in 72 hours.`, debug };
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
}): Promise<{ success: boolean; message: string; debug: ApprovalDebugStep[] }> {
  const { invoiceId, invoiceNumber, invoiceType, amount, currency, supplier, approverEmail, approverName, sentBy, businessUnit, invoiceDate, description, createdBy, attachmentContent, attachmentName } = params;
  const debug: ApprovalDebugStep[] = [];

  const approvalRef = invoiceNumber;   // human-readable ref — visible in approval engine & email replies
  const today = new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' });

  // Step 1 — Generate approval tokens
  const tokensUrl = `${BASE}/generate-links`;
  const tokensPayload = { requestRef: approvalRef, requestId: invoiceId, toEmail: approverEmail, toName: approverName, transactionType: 'INVOICE' };
  let approveToken = '', rejectToken = '';
  try {
    const tokRes = await fetch(tokensUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tokensPayload) });
    const tokData = await tokRes.json().catch(() => ({}));
    debug.push({ step: '1 — Generate Tokens', url: tokensUrl, method: 'POST', payload: tokensPayload, status: tokRes.status, response: tokData });
    if (!tokRes.ok) throw new Error(`Generate tokens failed (${tokRes.status}): ${JSON.stringify(tokData)}`);
    approveToken = tokData.approveToken ?? '';
    rejectToken  = tokData.rejectToken  ?? '';
  } catch (err) {
    if (debug.length === 0) debug.push({ step: '1 — Generate Tokens', url: tokensUrl, method: 'POST', payload: tokensPayload, status: 'ERROR', response: String(err) });
    return { success: false, message: err instanceof Error ? err.message : String(err), debug };
  }

  const approveUrl = `https://erp-approval.reerperp.workers.dev?token=${approveToken}`;
  const rejectUrl  = `https://erp-approval.reerperp.workers.dev?token=${rejectToken}`;

  // Step 2 — Mark invoice as PENDING in DB
  const putUrl = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/approval`;
  const putPayload = { approvalStatus: 'PENDING', approvalSentBy: sentBy, approverName, approverEmail, approvalRef };
  try {
    const putRes = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(putPayload) });
    const putData = await putRes.json().catch(() => putRes.statusText);
    debug.push({ step: '2 — Update Invoice Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: putRes.status, response: putData });
    if (!putRes.ok) throw new Error(`Failed to update invoice status (${putRes.status}): ${JSON.stringify(putData)}`);
  } catch (err) {
    if (debug.filter(d => d.step.startsWith('2')).length === 0) debug.push({ step: '2 — Update Invoice Approval Status', url: putUrl, method: 'PUT', payload: putPayload, status: 'ERROR', response: String(err) });
    return { success: false, message: err instanceof Error ? err.message : String(err), debug };
  }

  // Step 3 — Send email via ORDS proxy
  const emailUrl = `${APEX_DB_CONFIG.baseUrl}/approvals/send-email`;
  const html = buildInvoiceApprovalEmailHtml({ recipientName: approverName, today, approveUrl, rejectUrl, invoiceNumber, invoiceType, amount, currency, supplier, submittedBy: sentBy, businessUnit, invoiceDate, description, createdBy, attachmentContent });
  const emailPayload = { toEmail: approverEmail, toName: approverName, subject: `[Approval Required] AP Invoice — ${invoiceNumber}`, htmlContent: '(HTML omitted from debug)' };
  try {
    const bodyToSend: Record<string, unknown> = { ...emailPayload, htmlContent: html };
    if (attachmentContent) {
      bodyToSend.attachmentContent = attachmentContent;
      bodyToSend.attachmentName = attachmentName || `Invoice-${invoiceNumber}.pdf`;
    }
    const sendRes = await fetch(emailUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyToSend) });
    const sendData = await sendRes.json().catch(() => ({ status: 'ERROR', message: sendRes.statusText }));
    debug.push({ step: '3 — Send Email (ORDS proxy)', url: emailUrl, method: 'POST', payload: emailPayload, status: sendRes.status, response: sendData });
    if (sendData.status !== 'SUCCESS') {
      return { success: false, message: sendData.message ?? 'Email send failed', debug };
    }
  } catch (err) {
    debug.push({ step: '3 — Send Email (ORDS proxy)', url: emailUrl, method: 'POST', payload: emailPayload, status: 'ERROR', response: String(err) });
    return { success: false, message: err instanceof Error ? err.message : String(err), debug };
  }

  // Step 4 — Log to RR_APPROVAL_REQUESTS (best-effort, non-blocking)
  await logApprovalRequest({
    module: 'AP', transactionType: 'INVOICE',
    transactionId: invoiceId, transactionRef: approvalRef,
    amount, currency,
    description: description || `Invoice ${invoiceNumber} — ${supplier}`,
    requestedByName: sentBy, approverEmail,
  }, debug);

  return { success: true, message: `Approval email sent to ${approverName} (${approverEmail}). Links expire in 72 hours.`, debug };
}
