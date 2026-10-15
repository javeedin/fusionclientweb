// Journal approvals. The person who prepared a GL journal batch sends it TO an approver; the approver
// approves or rejects it from the notification bell (with the journal's lines); a batch that waits for
// approval, was rejected, or changed after it was approved cannot be posted.
//
// Writes go through RR_GL_APPROVAL_PKG (POST po/execute — database/gl/166_gl_journal_approval.sql), whose
// triggers also stop posting at the database. Until that script is run, the approvals REST endpoints are used
// and the screens apply the same posting rule. Reads are direct SQL through the read gateway.
import { poExec, poQuery, nlit } from './po.service';
import {
  getApprovalRequests, getApprovalRules, getApprovalUsers, sendJournalApprovalRest, recallApprovalRequest, updateApprovalStatus,
  emailApprover, emitApprovalsChanged, JOURNAL_EMAIL_AREA,
  type ApprovalRule, type ApprovalUser, type ApprovalDebugStep,
} from './approvals.service';
import type { AccountingLine } from '../components/AccountingLinesView';

export const GL_APPROVAL_SCRIPT = 'database/gl/166_gl_journal_approval.sql';
export const GL_PROC = {
  send: 'RR_GL_APPROVAL_PKG.SEND_FOR_APPROVAL',
  decide: 'RR_GL_APPROVAL_PKG.DECIDE',
  withdraw: 'RR_GL_APPROVAL_PKG.WITHDRAW',
} as const;

/** po/execute answered "not registered / not deployed" → the package is not installed yet. */
const notInstalled = (e: unknown) => /not registered|not deployed|HTTP 404/i.test(String((e as Error)?.message ?? e));

/** "ORA-20460: The journal is waiting … ORA-06512: at …" → "The journal is waiting …" */
export function cleanDbMessage(m?: string | null): string {
  const t = String(m ?? '').trim();
  const hit = t.match(/ORA-20\d{3}:\s*([\s\S]*?)(?=\s*ORA-\d{5}|$)/);
  return (hit ? hit[1] : t).trim();
}

export type JournalApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RECALLED';

/** The latest approval request of a journal batch. */
export interface JournalApproval {
  batchId: number;
  requestId: number;
  status: JournalApprovalStatus;
  amount: number | null;
  currency: string;
  requestedBy?: string;
  requestedDate?: string;
  approverName?: string;
  approverEmail?: string;
  decidedBy?: string;
  decidedDate?: string;
  comments?: string;
  ruleName?: string;
}

const ISO = (col: string, alias: string) => `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS') AS ${alias}`;
const latestSql = (decided: boolean) => `SELECT * FROM (
  SELECT r.REQUEST_ID, r.TRANSACTION_ID AS BATCH_ID, NVL(r.STATUS, 'PENDING') AS STATUS, r.AMOUNT, NVL(r.CURRENCY, 'AED') AS CURRENCY,
         r.REQUESTED_BY_NAME, ${ISO('r.REQUESTED_DATE', 'REQUESTED_DATE')},
         ${decided ? `r.DECIDED_BY, ${ISO('r.DECIDED_DATE', 'DECIDED_DATE')},` : ''}
         u.FULL_NAME AS APPROVER_NAME, u.EMAIL AS APPROVER_EMAIL, ru.RULE_NAME,
         (SELECT MAX(h.COMMENTS) KEEP (DENSE_RANK LAST ORDER BY h.ACTION_DATE, h.HISTORY_ID) FROM RR_APPROVAL_HISTORY h
           WHERE h.REQUEST_ID = r.REQUEST_ID AND h.ACTION IN ('APPROVED', 'REJECTED', 'RECALLED')) AS DECISION_COMMENTS,
         (SELECT MAX(h.ACTOR_NAME) KEEP (DENSE_RANK LAST ORDER BY h.ACTION_DATE, h.HISTORY_ID) FROM RR_APPROVAL_HISTORY h
           WHERE h.REQUEST_ID = r.REQUEST_ID AND h.ACTION IN ('APPROVED', 'REJECTED', 'RECALLED')) AS DECISION_ACTOR,
         ROW_NUMBER() OVER (PARTITION BY r.TRANSACTION_ID ORDER BY r.REQUEST_ID DESC) AS RN
  FROM RR_APPROVAL_REQUESTS r
  LEFT JOIN RR_APPROVAL_USERS u ON u.USER_ID = r.CURRENT_APPROVER_ID
  LEFT JOIN RR_APPROVAL_RULES ru ON ru.RULE_ID = r.RULE_ID
  WHERE r.MODULE = 'GL' AND r.TRANSACTION_ID IS NOT NULL
) WHERE RN = 1`;

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Latest approval request of every journal batch that was ever sent (by JE_BATCH_ID). */
export async function loadJournalApprovals(): Promise<Map<number, JournalApproval>> {
  const out = new Map<number, JournalApproval>();
  let rows: Record<string, any>[] | null = null;
  for (const decided of [true, false]) {     // DECIDED_BY / DECIDED_DATE arrive with script 166 (or purchasing 309)
    try { rows = await poQuery(latestSql(decided), 5000, 'GL'); break; } catch { /* next */ }
  }
  if (rows) {
    rows.forEach(r => {
      const id = num(r.BATCH_ID);
      if (id == null) return;
      out.set(id, {
        batchId: id, requestId: Number(r.REQUEST_ID), status: String(r.STATUS).toUpperCase() as JournalApprovalStatus,
        amount: num(r.AMOUNT), currency: r.CURRENCY || 'AED', requestedBy: r.REQUESTED_BY_NAME ?? undefined,
        requestedDate: r.REQUESTED_DATE ?? undefined, approverName: r.APPROVER_NAME ?? undefined, approverEmail: r.APPROVER_EMAIL ?? undefined,
        decidedBy: r.DECIDED_BY ?? r.DECISION_ACTOR ?? undefined, decidedDate: r.DECIDED_DATE ?? undefined,
        comments: r.DECISION_COMMENTS ?? undefined, ruleName: r.RULE_NAME ?? undefined,
      });
    });
    return out;
  }
  // gateway refused → the approvals list (REST)
  const reqs = await getApprovalRequests({ module: 'GL' }).catch(() => []);
  [...reqs].sort((a, b) => Number(a.requestId) - Number(b.requestId)).forEach(r => {
    const id = num(r.transactionId);
    if (id == null) return;
    out.set(id, {
      batchId: id, requestId: Number(r.requestId), status: String(r.status || 'PENDING').toUpperCase() as JournalApprovalStatus,
      amount: num(r.amount), currency: r.currency || 'AED', requestedBy: r.requestedByName, requestedDate: r.requestedDate,
      approverName: r.currentApproverName, approverEmail: (r as any).currentApproverEmail, ruleName: r.ruleName,
    });
  });
  return out;
}

// ── rules: which journals need approval, and who approves ───────────────────

/** Active approval rules for journals (module GL, transaction type JOURNAL). */
export async function loadJournalRules(): Promise<ApprovalRule[]> {
  const rules = await getApprovalRules('GL').catch(() => [] as ApprovalRule[]);
  return rules.filter(r => r.active !== 'N' && (!r.transactionType || r.transactionType === 'JOURNAL'));
}

/** The rule that covers an amount (lowest priority number first). */
export function ruleFor(amount: number, rules: ApprovalRule[]): ApprovalRule | null {
  const a = Math.abs(amount || 0);
  return [...rules]
    .filter(r => a >= Number(r.minAmount || 0) && (r.maxAmount == null || (r.maxAmount as unknown) === '' || a <= Number(r.maxAmount)))
    .sort((x, y) => Number(x.priority ?? 10) - Number(y.priority ?? 10) || x.ruleId - y.ruleId)[0] ?? null;
}

export const ruleBand = (r: ApprovalRule) =>
  `${r.currency || ''} ${Number(r.minAmount || 0).toLocaleString()}${r.maxAmount != null && (r.maxAmount as unknown) !== '' ? ` – ${Number(r.maxAmount).toLocaleString()}` : '+'}`.trim();

export interface JournalApprover extends ApprovalUser { fromRule?: string; covers: boolean }

/**
 * Who can approve a journal of this amount: the approvers of the rule that covers it first, then the other journal
 * rules' approvers, then approval users with the GL module (or everyone active when nobody has it).
 */
export async function journalApprovers(amount: number, rules?: ApprovalRule[]): Promise<{ approvers: JournalApprover[]; rule: ApprovalRule | null }> {
  const rs = rules ?? await loadJournalRules();
  const rule = ruleFor(amount, rs);
  const seen = new Map<string, JournalApprover>();
  const add = (u: Partial<ApprovalUser> & { email: string; fullName: string }, fromRule: string | undefined, covers: boolean) => {
    const k = u.email.toLowerCase();
    if (!u.email || seen.has(k)) return;
    seen.set(k, { userId: u.userId ?? 0, fullName: u.fullName || u.email, email: u.email, department: u.department, active: 'Y',
      modules: ['GL'], currency: u.currency || 'AED', maxApprovalAmount: u.maxApprovalAmount, fromRule, covers });
  };
  if (rule) rule.approvers.forEach(a => add(a, rule.ruleName, true));
  rs.filter(r => r !== rule).forEach(r => r.approvers.forEach(a => add(a, r.ruleName, false)));
  if (seen.size === 0) {
    const users = (await getApprovalUsers().catch(() => [] as ApprovalUser[])).filter(u => u.active !== 'N' && u.email);
    const gl = users.filter(u => (u.modules || []).some(m => String(m).toUpperCase() === 'GL'));
    (gl.length ? gl : users).forEach(u => {
      const limit = u.maxApprovalAmount == null ? Infinity : Number(u.maxApprovalAmount);
      add(u, undefined, Math.abs(amount) <= limit);
    });
  }
  const approvers = [...seen.values()].sort((a, b) => Number(b.covers) - Number(a.covers) || a.fullName.localeCompare(b.fullName));
  return { approvers, rule };
}

// ── the posting gate ────────────────────────────────────────────────────────

export type GateTone = 'free' | 'needed' | 'pending' | 'approved' | 'rejected' | 'changed' | 'withdrawn';
export interface JournalGate {
  tone: GateTone;
  /** why it cannot be posted now (null = it can) */
  block: string | null;
  label: string;
  /** may be sent (again) for approval */
  canSend: boolean;
}

const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Where a batch stands for posting, given its latest request, its current amount and the rule that covers it. */
export function journalGate(a: JournalApproval | undefined, amount: number, rule: ApprovalRule | null): JournalGate {
  const st = a?.status;
  if (st === 'PENDING') {
    return { tone: 'pending', label: 'Awaiting approval', canSend: true,
      block: `Waiting for approval${a?.approverName ? ` from ${a.approverName}` : ''} — it can be posted once approved` };
  }
  if (st === 'REJECTED') {
    return { tone: 'rejected', label: 'Rejected', canSend: true,
      block: `Rejected${a?.decidedBy ? ` by ${a.decidedBy}` : ''}${a?.comments ? ` — "${a.comments}"` : ''} — change it and send it again` };
  }
  if (st === 'APPROVED') {
    if (a?.amount != null && Math.abs(Math.abs(amount) - Math.abs(a.amount)) > 0.01) {
      return { tone: 'changed', label: 'Changed after approval', canSend: true,
        block: `Changed after it was approved (approved ${money(a.amount)}, now ${money(Math.abs(amount))}) — send it for approval again` };
    }
    return { tone: 'approved', label: 'Approved', canSend: false, block: null };
  }
  if (rule) {
    return { tone: 'needed', label: 'Needs approval', canSend: true,
      block: `Needs approval — rule "${rule.ruleName}" (${ruleBand(rule)}) covers this journal` };
  }
  if (st === 'CANCELLED' || st === 'RECALLED') return { tone: 'withdrawn', label: 'Withdrawn', canSend: true, block: null };
  return { tone: 'free', label: 'No approval needed', canSend: true, block: null };
}

// ── actions ─────────────────────────────────────────────────────────────────

export interface SendResult { ok: boolean; message: string; requestId?: number; warning?: string; via?: 'package' | 'rest'; debug?: ApprovalDebugStep[] }

/** Send one journal batch to an approver (a resend replaces its pending request). */
export async function sendJournalForApproval(p: {
  batchId: number; batchName: string; amount: number; currency: string; description: string;
  approver: { email: string; fullName: string }; comments?: string; user: string; sendEmail?: boolean;
}): Promise<SendResult> {
  const { batchId, batchName, amount, currency, description, approver, comments, user, sendEmail } = p;
  let res: SendResult;
  try {
    const r = await poExec(GL_PROC.send, { p_batch_id: batchId, p_approver: approver.email, p_comments: comments || null }, user);
    res = { ok: true, message: r.message || `Sent to ${approver.fullName} for approval`, requestId: r.id ?? undefined, via: 'package' };
  } catch (e) {
    if (!notInstalled(e)) return { ok: false, message: cleanDbMessage((e as Error)?.message || String(e)) };
    const r = await sendJournalApprovalRest({ batchId, batchName, amount: Math.abs(amount), currency, description, approverEmail: approver.email, sentBy: user });
    if (!r.success) return { ok: false, message: r.message, debug: r.debug };
    res = { ok: true, message: `Sent to ${approver.fullName} for approval${r.requestId ? ` (request #${r.requestId})` : ''}`, requestId: r.requestId, via: 'rest', debug: r.debug };
  }
  emitApprovalsChanged({ reason: 'sent', module: 'GL', transactionId: batchId, transactionRef: batchName });
  if (sendEmail) {
    const debug = res.debug ?? [];
    const warning = await emailApprover({
      approvalRef: batchName || `GL-JE-${batchId}`, requestId: res.requestId ?? batchId, approverEmail: approver.email, approverName: approver.fullName,
      txnType: 'Journal', txnRef: batchName || `Journal batch ${batchId}`, amount: Math.abs(amount), currency, description, sentBy: user, area: JOURNAL_EMAIL_AREA,
    }, debug);
    res = { ...res, warning: warning || undefined, debug, message: warning ? res.message : `${res.message} · emailed ${approver.email}` };
  }
  return res;
}

/** Approve / reject from the bell: RR_GL_APPROVAL_PKG.DECIDE, else the approvals status endpoint. */
export async function decideJournalApproval(requestId: number, decision: 'APPROVED' | 'REJECTED', comments: string | undefined,
  user: string, actor: { name: string; email?: string }): Promise<{ via: 'package' | 'rest'; message: string }> {
  try {
    const r = await poExec(GL_PROC.decide, { p_request_id: requestId, p_decision: decision, p_comments: comments || null }, user);
    return { via: 'package', message: r.message || '' };
  } catch (e) {
    if (!notInstalled(e)) throw new Error(cleanDbMessage((e as Error)?.message || String(e)));
  }
  await updateApprovalStatus(requestId, decision, actor.name, comments, actor.email);
  return { via: 'rest', message: '' };
}

/** The sender takes a pending request back. */
export async function withdrawJournalApproval(batchId: number, user: string, current?: JournalApproval): Promise<string> {
  try {
    const r = await poExec(GL_PROC.withdraw, { p_batch_id: batchId, p_comments: null }, user);
    emitApprovalsChanged({ reason: 'decided', module: 'GL', transactionId: batchId, status: 'RECALLED', actorName: user });
    return r.message || 'Approval request withdrawn';
  } catch (e) {
    if (!notInstalled(e)) throw new Error(cleanDbMessage((e as Error)?.message || String(e)));
  }
  if (!current || current.status !== 'PENDING') throw new Error('The journal is not waiting for approval');
  const ok = await recallApprovalRequest(current.requestId, user, 'Withdrawn by the sender');
  if (!ok) throw new Error('Could not withdraw the approval request');
  emitApprovalsChanged({ reason: 'decided', module: 'GL', transactionId: batchId, status: 'RECALLED', actorName: user });
  return 'Approval request withdrawn';
}

// ── the journal an approver looks at ────────────────────────────────────────

export interface JournalForApproval {
  batchId: number;
  batchName: string;
  batchStatus?: string;
  period?: string;
  ledger?: string;
  ledgerCurrency: string;
  accountingDate?: string;
  source?: string;
  createdBy?: string;
  journals: { headerId: number; name: string; description?: string; category?: string; currency?: string; lines: number }[];
  lines: AccountingLine[];
  totalDr: number;
  totalCr: number;
  /** some lines are in another currency than the ledger: amounts are shown in the ledger currency */
  mixed: boolean;
  /** the description every line carries (shown once, not on each line) */
  lineNote?: string;
}

/** Natural account (4th segment) descriptions, read directly — the value set the journal preview uses. */
async function accountDescriptions(codes: string[]): Promise<Record<string, string>> {
  const vals = [...new Set(codes.map(c => String(c || '').split('-')[3]?.trim()).filter(v => v && /^\w+$/.test(v)))];
  if (!vals.length) return {};
  try {
    const rows = await poQuery(`SELECT VALUE, MAX(DESCRIPTION) AS DESCRIPTION FROM RR_VALUE_SET_VALUES
      WHERE VALUE_SET_CODE = 'BUIMERC_FIN_GLB_COA_ACCOUNT' AND VALUE IN (${vals.map(v => `'${v}'`).join(', ')})
      GROUP BY VALUE`, 2000, 'GL');
    return Object.fromEntries(rows.map(r => [String(r.VALUE), String(r.DESCRIPTION ?? '')]));
  } catch {
    return {};   // the screen falls back to the chart-of-accounts lookup
  }
}

const journalSql = (withLedger: boolean, batchId: number) => `SELECT h.JE_HEADER_ID, h.JOURNAL_NAME, h.JOURNAL_DESCRIPTION,
    h.USER_JE_CATEGORY_NAME AS CATEGORY, h.USER_JE_SOURCE_NAME AS SOURCE, h.PERIOD_NAME, h.LEDGER_NAME, h.CURRENCY_CODE AS JOURNAL_CURRENCY,
    TO_CHAR(h.DEFAULT_EFFECTIVE_DATE, 'YYYY-MM-DD') AS ACCOUNTING_DATE, h.CREATED_BY,
    l.JE_LINE_NUMBER, l.ACCOUNT_COMBINATION, l.DESCRIPTION AS LINE_DESCRIPTION,
    l.ENTERED_DR, l.ENTERED_CR, l.ACCOUNTED_DR, l.ACCOUNTED_CR, NVL(l.CURRENCY_CODE, h.CURRENCY_CODE) AS LINE_CURRENCY,
    (SELECT MAX(b.BATCH_NAME) FROM RR_GL_JOURNAL_BATCHES b WHERE b.JE_BATCH_ID = h.BATCH_ID) AS BATCH_NAME,
    (SELECT MAX(NVL(b.STATUS_MEANING, b.STATUS)) FROM RR_GL_JOURNAL_BATCHES b WHERE b.JE_BATCH_ID = h.BATCH_ID) AS BATCH_STATUS
    ${withLedger ? `, (SELECT MAX(lg.CURRENCY_CODE) FROM RR_LEDGERS lg WHERE lg.LEDGER_ID = h.LEDGER_ID OR UPPER(lg.LEDGER_NAME) = UPPER(h.LEDGER_NAME)) AS LEDGER_CURRENCY` : ''}
  FROM RR_GL_JE_HEADERS h
  LEFT JOIN RR_GL_JE_LINES_ALL l ON l.JE_HEADER_ID = h.JE_HEADER_ID
  WHERE h.BATCH_ID = ${nlit(batchId)}
  ORDER BY h.JE_HEADER_ID, l.JE_LINE_NUMBER`;

/** The batch's journals and Dr / Cr lines, read directly (headers + lines). */
export async function loadJournalForApproval(batchId: number): Promise<JournalForApproval | null> {
  let rows: Record<string, any>[] = [];
  try { rows = await poQuery(journalSql(true, batchId), 2000, 'GL'); }
  catch { rows = await poQuery(journalSql(false, batchId), 2000, 'GL'); }   // RR_LEDGERS not readable
  if (!rows.length) return null;
  const f = rows[0];
  const ledgerCurrency = rows.find(r => r.LEDGER_CURRENCY)?.LEDGER_CURRENCY || f.JOURNAL_CURRENCY || 'AED';
  const withLines = rows.filter(r => r.JE_LINE_NUMBER != null || r.ACCOUNT_COMBINATION);
  const ccys = new Set(withLines.map(r => r.LINE_CURRENCY || ledgerCurrency));
  const mixed = ccys.size > 1;
  const n = (v: unknown) => Number(v) || 0;
  const descs = await accountDescriptions(withLines.map(r => r.ACCOUNT_COMBINATION));
  // the line description only when lines differ — one shared text is shown once
  const lineTexts = new Set(withLines.map(r => String(r.LINE_DESCRIPTION ?? '').trim()));
  const sameText = lineTexts.size <= 1 ? [...lineTexts][0] || undefined : undefined;
  const lines: AccountingLine[] = withLines.map(r => {
    const dr = n(r.ENTERED_DR) !== 0 || n(r.ACCOUNTED_DR) !== 0;
    const entered = dr ? n(r.ENTERED_DR) : n(r.ENTERED_CR);
    const accounted = dr ? n(r.ACCOUNTED_DR) : n(r.ACCOUNTED_CR);
    const ccy = r.LINE_CURRENCY || ledgerCurrency;
    const note = mixed && ccy !== ledgerCurrency ? `${ccy} ${money(entered)}` : '';
    const label = [sameText ? '' : r.LINE_DESCRIPTION, note].filter(Boolean).join(' · ') || undefined;
    const code = String(r.ACCOUNT_COMBINATION || '');
    const seg = code.split('-')[3]?.trim();
    const acct = { accountValue: seg, accountDescription: seg ? descs[seg] || undefined : undefined };
    return mixed
      ? { side: dr ? 'DR' : 'CR', account: code, label, entered: accounted, currency: ledgerCurrency, ...acct }
      : { side: dr ? 'DR' : 'CR', account: code, label, entered, currency: ccy, accounted, ledgerCurrency, ...acct };
  });
  const byHeader = new Map<number, JournalForApproval['journals'][number]>();
  rows.forEach(r => {
    const id = Number(r.JE_HEADER_ID);
    const j = byHeader.get(id) ?? { headerId: id, name: r.JOURNAL_NAME || `Journal ${id}`, description: r.JOURNAL_DESCRIPTION ?? undefined,
      category: r.CATEGORY ?? undefined, currency: r.JOURNAL_CURRENCY ?? undefined, lines: 0 };
    if (r.JE_LINE_NUMBER != null || r.ACCOUNT_COMBINATION) j.lines += 1;
    byHeader.set(id, j);
  });
  return {
    batchId, batchName: f.BATCH_NAME || `Batch ${batchId}`, batchStatus: f.BATCH_STATUS ?? undefined, period: f.PERIOD_NAME ?? undefined,
    ledger: f.LEDGER_NAME ?? undefined, ledgerCurrency, accountingDate: f.ACCOUNTING_DATE ?? undefined, source: f.SOURCE ?? undefined,
    createdBy: f.CREATED_BY ?? undefined, journals: [...byHeader.values()], lines,
    totalDr: withLines.reduce((s, r) => s + n(r.ACCOUNTED_DR), 0), totalCr: withLines.reduce((s, r) => s + n(r.ACCOUNTED_CR), 0), mixed,
    lineNote: sameText,
  };
}
