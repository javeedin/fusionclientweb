// Cash Management — archived bank reconciliations.
//   Reads  → POST ai/executequery (guarded SELECT gateway) over the RR_CM_V_ARCHIVE* views
//   Writes → POST cash/execute (registry-whitelisted RR_CM_ARCHIVE_PKG procedures); every call returns
//            { status: S|W|E, id, number, message }
// Database: database/cash/170_cm_archive_bank_statements.sql
import { buildApexUrl } from '../config/api.helper';

/** APEX REST base, worked out per call so it follows the selected company. */
export const apexBase = () => buildApexUrl('').replace(/\/+$/, '');

// ── API call log (shown by the API button on the archive screens) ─────────────────
export interface ArchiveApiCall {
  id: number; at: string; method: string; url: string; body: unknown;
  status: number | null; ok: boolean; ms: number; response: unknown; label: string;
}
const apiLog: ArchiveApiCall[] = [];
const apiListeners = new Set<() => void>();
let apiSeq = 0;
export const getArchiveApiLog = () => apiLog;
export const clearArchiveApiLog = () => { apiLog.length = 0; apiListeners.forEach(f => f()); };
export const onArchiveApiLog = (f: () => void) => { apiListeners.add(f); return () => { apiListeners.delete(f); }; };
const logCall = (c: Omit<ArchiveApiCall, 'id' | 'at'>) => {
  apiLog.unshift({ ...c, id: ++apiSeq, at: new Date().toISOString() });
  if (apiLog.length > 100) apiLog.length = 100;
  apiListeners.forEach(f => f());
};
const parseMaybe = (t: string) => { try { return JSON.parse(t); } catch { return t.slice(0, 4000); } };
/** file contents are long base64 strings — keep the log readable */
const forLog = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) =>
  (k === 'fileContent' && typeof x === 'string' && x.length > 120 ? `${x.slice(0, 60)}… (${x.length} base64 characters)` : x)));

export type Row = Record<string, any>;

export interface ExecResult { success: boolean; status: 'S' | 'W' | 'E'; id: number | null; number: string | null; message: string }

export const ARCHIVE_PROC = {
  create: 'RR_CM_ARCHIVE_PKG.CREATE_ARCHIVE',
  update: 'RR_CM_ARCHIVE_PKG.UPDATE_ARCHIVE',
  refresh: 'RR_CM_ARCHIVE_PKG.REFRESH_ANALYSIS',
  addAttachment: 'RR_CM_ARCHIVE_PKG.ADD_ATTACHMENT',
  deleteAttachment: 'RR_CM_ARCHIVE_PKG.DELETE_ATTACHMENT',
  cancel: 'RR_CM_ARCHIVE_PKG.CANCEL_ARCHIVE',
} as const;

export const INSTALL_SCRIPT = 'database/cash/170_cm_archive_bank_statements.sql';

/** SQL literal for the read gateway (always quoted / escaped). */
export const lit = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};
export const nlit = (v: unknown): string => {
  const x = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(x) ? 'NULL' : String(x);
};
export const dlit = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `DATE '${d.slice(0, 10)}'` : 'NULL');

const errText = (text: string, data: any, status: number) => {
  const detail = data?.error || data?.message || (text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '');
  return detail ? `HTTP ${status} — ${detail}` : `HTTP ${status}`;
};

/** One SELECT through the gateway (at most 1000 rows); rows keyed by UPPER column name. */
export async function cmQuery(sql: string, maxRows = 1000): Promise<Row[]> {
  const url = `${apexBase()}/ai/executequery`;
  const body = { sql: sql.trim().replace(/;\s*$/, ''), maxRows, appUser: 'CASH' };
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch (e: any) {
    logCall({ method: 'POST', url, body, status: null, ok: false, ms: Math.round(performance.now() - t0), response: String(e?.message || e), label: 'Query' });
    throw new Error(`Could not reach ${url} — ${e?.message || e}`);
  }
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* HTML error page */ }
  logCall({ method: 'POST', url, body, status: res.status, ms: Math.round(performance.now() - t0), label: 'Query',
    ok: res.ok && data?.success !== false,
    response: data && typeof data === 'object' ? { ...data, rows: `(${data.rows?.length ?? 0} rows)` } : parseMaybe(text) });
  if (!res.ok || !data || data.success === false) throw new Error(errText(text, data, res.status));
  const cols: string[] = (data.columns || []).map((c: any) => String(typeof c === 'string' ? c : c?.name ?? c).toUpperCase());
  return (data.rows || []).map((r: any[]) => { const o: Row = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
}

/** All rows of an ordered query, 1000 at a time (the gateway caps one call at 1000). */
export async function cmQueryAll(sql: string, orderBy: string, limit = 50000): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const page = await cmQuery(`SELECT * FROM (${sql}) ORDER BY ${orderBy} OFFSET ${offset} ROWS FETCH NEXT 1000 ROWS ONLY`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** Call a registered procedure. Resolves for S and W; throws with the procedure's message on E. */
export async function cmExec(proc: string, params: Record<string, unknown>, user: string): Promise<ExecResult> {
  const url = `${apexBase()}/cash/execute`;
  const body = { proc, params, user: user || 'UNKNOWN' };
  const label = proc.replace(/^RR_CM_ARCHIVE_PKG\./, '');
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch (e: any) {
    logCall({ method: 'POST', url, body: forLog(body), status: null, ok: false, ms: Math.round(performance.now() - t0), response: String(e?.message || e), label });
    throw new Error(`Could not reach ${url} — ${e?.message || e}`);
  }
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* HTML error page */ }
  logCall({ method: 'POST', url, body: forLog(body), status: res.status, ms: Math.round(performance.now() - t0), label,
    ok: res.ok && ['S', 'W'].includes(data?.status), response: data ?? parseMaybe(text) });
  // ORDS answers 404 ("Not Found") when the cash/execute handler does not exist in the database
  if (res.status === 404) throw new Error(`${NOT_DEPLOYED} (HTTP 404 from ${url})`);
  if (!data) throw new Error(errText(text, data, res.status));
  if (data.status !== 'S' && data.status !== 'W') throw new Error(data.message || errText(text, data, res.status));
  return data as ExecResult;
}

export const EXECUTE_SCRIPT = 'database/cash/169_cm_execute.sql';
export const NOT_DEPLOYED = `The cash/execute web service is not installed — run ${EXECUTE_SCRIPT}, then ${'database/cash/170_cm_archive_bank_statements.sql'}`;

/** One check of the web services the archive needs. */
export interface ServiceCheck { key: string; name: string; url: string; ok: boolean | null; detail: string; fix?: string }

/** Probe every service the archive screens use, without changing any data. */
export async function checkArchiveServices(): Promise<ServiceCheck[]> {
  const base = apexBase();
  const out: ServiceCheck[] = [];
  const timed = async (url: string, init?: RequestInit) => {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { cache: 'no-store', ...init });
      const text = await res.text();
      logCall({ method: init?.method || 'GET', url, body: init?.body ? parseMaybe(String(init.body)) : null, status: res.status,
        ok: res.ok || res.status === 405, ms: Math.round(performance.now() - t0), response: parseMaybe(text), label: 'Check' });
      return { res, text };
    } catch (e: any) {
      logCall({ method: init?.method || 'GET', url, body: null, status: null, ok: false, ms: Math.round(performance.now() - t0), response: String(e?.message || e), label: 'Check' });
      return { res: null as Response | null, text: String(e?.message || e) };
    }
  };
  // 1. cash/execute — only a POST handler exists, so a GET answers 405 when it is installed and 404 when it is not
  {
    const url = `${base}/cash/execute`;
    const { res, text } = await timed(url, { method: 'GET', headers: { Accept: 'application/json' } });
    const st = res?.status ?? null;
    out.push({ key: 'execute', name: 'cash/execute (saves: archive, update, attachments)', url,
      ok: st !== null && [200, 400, 403, 405].includes(st),
      detail: st === 405 ? 'Installed (answers POST only — 405 on GET is expected)'
        : st === 404 ? 'Not found (HTTP 404) — the web service does not exist in the database'
          : st === null ? `Could not reach the server: ${text}` : `HTTP ${st}: ${text.slice(0, 200)}`,
      fix: st === 404 ? `Run ${EXECUTE_SCRIPT} as the schema owner (SQL Developer: Run Script F5, or APEX: SQL Workshop → SQL Scripts)` : undefined });
  }
  // 2. archive tables / views through the read gateway
  {
    const url = `${base}/ai/executequery`;
    try {
      const [r] = await cmQuery('SELECT COUNT(*) AS N FROM RR_CM_V_ARCHIVES');
      out.push({ key: 'views', name: 'Archive tables and views (RR_CM_V_ARCHIVES …)', url, ok: true, detail: `Installed — ${r?.N ?? 0} archive(s)` });
    } catch (e: any) {
      out.push({ key: 'views', name: 'Archive tables and views (RR_CM_V_ARCHIVES …)', url, ok: false, detail: e.message,
        fix: archiveNotInstalled(e) ? `Run ${INSTALL_SCRIPT}` : undefined });
    }
  }
  // 3. archive procedures registered for cash/execute
  {
    const url = `${base}/ai/executequery`;
    try {
      const rows = await cmQuery(`SELECT PROC_NAME, ENABLED_FLAG FROM RR_CM_PROC_REGISTRY WHERE PROC_NAME LIKE 'RR_CM_ARCHIVE_PKG.%' ORDER BY PROC_NAME`);
      const enabled = rows.filter(r => r.ENABLED_FLAG === 'Y').length;
      out.push({ key: 'registry', name: 'Archive procedures registered for cash/execute', url, ok: enabled >= 6,
        detail: rows.length ? `${enabled} of 6 enabled: ${rows.map(r => String(r.PROC_NAME).replace('RR_CM_ARCHIVE_PKG.', '')).join(', ')}` : 'None registered',
        fix: enabled >= 6 ? undefined : `Run ${INSTALL_SCRIPT}` });
    } catch (e: any) {
      out.push({ key: 'registry', name: 'Archive procedures registered for cash/execute', url, ok: false, detail: e.message,
        fix: archiveNotInstalled(e) ? `Run ${EXECUTE_SCRIPT}, then ${INSTALL_SCRIPT}` : undefined });
    }
  }
  // 4. GL account analysis (used for the preview before archiving)
  {
    const today = new Date().toISOString().slice(0, 10);
    const url = `${base}/gl/accountanalysis?from_date=${today}&to_date=${today}&page_size=1`;
    const { res, text } = await timed(url, { headers: { Accept: 'application/json' } });
    out.push({ key: 'analysis', name: 'gl/accountanalysis (account analysis preview)', url, ok: !!res?.ok,
      detail: res?.ok ? 'Reachable' : res ? `HTTP ${res.status}: ${text.slice(0, 200)}` : `Could not reach the server: ${text}` });
  }
  return out;
}

/** The read failed because the archive script is not installed. */
export const archiveNotInstalled = (e: unknown) =>
  /ORA-00942|ORA-04043|table or view does not exist|RR_CM_V_ARCHIVE/i.test(String((e as Error)?.message ?? e));

// ── types ──────────────────────────────────────────────────────────────────────
export interface ArchiveHeader {
  ARCHIVE_ID: number; ARCHIVE_NUMBER: string; STATEMENT_ID: number; STATEMENT_NUMBER: string; STATEMENT_DATE: string | null;
  BUSINESS_UNIT_NAME: string | null; BANK_ACCOUNT_NAME: string | null; BANK_ACCOUNT_NUMBER: string | null; CURRENCY_CODE: string | null;
  CASH_ACCOUNT: string | null; DATE_FROM: string; DATE_TO: string; RECONCILED_DATE: string | null; COMMENTS: string | null;
  STMT_OPENING_BALANCE: number | null; STMT_CLOSING_BALANCE: number | null; STMT_TOTAL_LINES: number | null;
  STMT_RECON_LINES: number | null; STMT_UNRECON_LINES: number | null;
  GL_OPENING_BALANCE: number | null; GL_TOTAL_DR: number | null; GL_TOTAL_CR: number | null; GL_CLOSING_BALANCE: number | null;
  GL_LINE_COUNT: number | null; ANALYSIS_DATE: string | null; STATUS: string; CANCEL_REASON: string | null; DIFFERENCE: number | null;
  MANUAL_LINES: number; ATTACHMENTS: number; CREATED_BY: string | null; CREATION_DATE: string | null;
  LAST_UPDATED_BY: string | null; LAST_UPDATE_DATE: string | null;
}

/** One account analysis line — the archived snapshot, or a live preview before archiving. */
export interface GlLine {
  key: string;
  accountingDate: string; periodName: string; batchName: string; journalName: string; source: string; category: string;
  account: string; accountDescription: string; description: string; currency: string;
  enteredDr: number; enteredCr: number; accountedDr: number; accountedCr: number;
  references: string[]; jeHeaderId: number | null; jeLineNumber: number | null; approvalStatus: string;
}

export interface ArchiveAttachment {
  ATTACHMENT_ID: number; ARCHIVE_ID: number; FILE_NAME: string; MIME_TYPE: string | null; FILE_SIZE: number;
  DESCRIPTION: string | null; UPLOADED_BY: string | null; UPLOAD_DATE: string | null; CHUNK_COUNT: number;
}

export interface ArchiveFilters {
  businessUnit?: string; bankAccount?: string; statementFrom?: string; statementTo?: string; status?: string;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const toHeader = (r: Row): ArchiveHeader => ({
  ...(r as ArchiveHeader),
  ARCHIVE_ID: Number(r.ARCHIVE_ID), STATEMENT_ID: Number(r.STATEMENT_ID),
  STMT_OPENING_BALANCE: num(r.STMT_OPENING_BALANCE), STMT_CLOSING_BALANCE: num(r.STMT_CLOSING_BALANCE),
  STMT_TOTAL_LINES: num(r.STMT_TOTAL_LINES), STMT_RECON_LINES: num(r.STMT_RECON_LINES), STMT_UNRECON_LINES: num(r.STMT_UNRECON_LINES),
  GL_OPENING_BALANCE: num(r.GL_OPENING_BALANCE), GL_TOTAL_DR: num(r.GL_TOTAL_DR), GL_TOTAL_CR: num(r.GL_TOTAL_CR),
  GL_CLOSING_BALANCE: num(r.GL_CLOSING_BALANCE), GL_LINE_COUNT: num(r.GL_LINE_COUNT), DIFFERENCE: num(r.DIFFERENCE),
  MANUAL_LINES: Number(r.MANUAL_LINES) || 0, ATTACHMENTS: Number(r.ATTACHMENTS) || 0,
});

// ── reads ──────────────────────────────────────────────────────────────────────
export async function loadArchives(f: ArchiveFilters = {}): Promise<ArchiveHeader[]> {
  const w: string[] = [];
  if (f.businessUnit) w.push(`BUSINESS_UNIT_NAME = ${lit(f.businessUnit)}`);
  if (f.bankAccount) w.push(`(BANK_ACCOUNT_NAME = ${lit(f.bankAccount)} OR BANK_ACCOUNT_NUMBER = ${lit(f.bankAccount)})`);
  if (f.statementFrom) w.push(`STATEMENT_DATE >= ${dlit(f.statementFrom)}`);
  if (f.statementTo) w.push(`STATEMENT_DATE < ${dlit(f.statementTo)} + 1`);
  if (f.status && f.status !== 'ALL') w.push(`STATUS = ${lit(f.status)}`);
  const rows = await cmQuery(`SELECT * FROM RR_CM_V_ARCHIVES ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
                              ORDER BY STATEMENT_DATE DESC NULLS LAST, ARCHIVE_ID DESC`);
  return rows.map(toHeader);
}

export async function loadArchive(id: number): Promise<ArchiveHeader | null> {
  const [r] = await cmQuery(`SELECT * FROM RR_CM_V_ARCHIVES WHERE ARCHIVE_ID = ${nlit(id)}`);
  return r ? toHeader(r) : null;
}

/** statementId → active archive, for the statements on screen (empty when not installed). */
export async function archivesForStatements(ids: number[]): Promise<Map<number, { id: number; number: string }>> {
  const m = new Map<number, { id: number; number: string }>();
  const clean = Array.from(new Set(ids.filter(i => Number.isFinite(Number(i))).map(Number)));
  if (!clean.length) return m;
  try {
    for (let i = 0; i < clean.length; i += 500) {
      const rows = await cmQuery(`SELECT STATEMENT_ID, ARCHIVE_ID, ARCHIVE_NUMBER FROM RR_CM_V_ARCHIVES
                                  WHERE STATUS = 'ARCHIVED' AND STATEMENT_ID IN (${clean.slice(i, i + 500).join(',')})`);
      rows.forEach(r => m.set(Number(r.STATEMENT_ID), { id: Number(r.ARCHIVE_ID), number: String(r.ARCHIVE_NUMBER) }));
    }
  } catch { /* archive not installed yet: nothing is archived */ }
  return m;
}

const glFromArchive = (r: Row): GlLine => ({
  key: `a${r.ARCHIVE_LINE_ID}`,
  accountingDate: isoDate(r.ACCOUNTING_DATE), periodName: r.PERIOD_NAME || '', batchName: r.BATCH_NAME || '',
  journalName: r.JOURNAL_NAME || '', source: r.JE_SOURCE || '', category: r.JE_CATEGORY || '', account: r.ACCOUNT_COMBINATION || '',
  accountDescription: r.ACCOUNT_DESCRIPTION || '', description: r.LINE_DESCRIPTION || '', currency: r.CURRENCY_CODE || '',
  enteredDr: Number(r.ENTERED_DR) || 0, enteredCr: Number(r.ENTERED_CR) || 0, accountedDr: Number(r.ACCOUNTED_DR) || 0,
  accountedCr: Number(r.ACCOUNTED_CR) || 0,
  references: [r.REFERENCE1, r.REFERENCE2, r.REFERENCE3, r.REFERENCE4, r.REFERENCE5].map(x => (x == null ? '' : String(x))),
  jeHeaderId: num(r.JE_HEADER_ID), jeLineNumber: num(r.JE_LINE_NUMBER), approvalStatus: r.APPROVAL_STATUS || '',
});

export async function loadArchiveGlLines(id: number): Promise<GlLine[]> {
  const rows = await cmQueryAll(`SELECT * FROM RR_CM_V_ARCHIVE_GL_LINES WHERE ARCHIVE_ID = ${nlit(id)}`, 'LINE_SEQ, ARCHIVE_LINE_ID');
  return rows.map(glFromArchive);
}

export async function loadArchiveManualText(id: number): Promise<string> {
  const rows = await cmQueryAll(`SELECT LINE_NUM, LINE_TEXT FROM RR_CM_V_ARCHIVE_MANUAL WHERE ARCHIVE_ID = ${nlit(id)}`, 'LINE_NUM');
  return rows.map(r => (r.LINE_TEXT == null ? '' : String(r.LINE_TEXT))).join('\n');
}

export async function loadArchiveAttachments(id: number): Promise<ArchiveAttachment[]> {
  const rows = await cmQuery(`SELECT * FROM RR_CM_V_ARCHIVE_ATTACH WHERE ARCHIVE_ID = ${nlit(id)} ORDER BY ATTACHMENT_ID`);
  return rows.map(r => ({ ...(r as ArchiveAttachment), ATTACHMENT_ID: Number(r.ATTACHMENT_ID), ARCHIVE_ID: Number(r.ARCHIVE_ID),
    FILE_SIZE: Number(r.FILE_SIZE) || 0, CHUNK_COUNT: Number(r.CHUNK_COUNT) || 0 }));
}

/** Read an attachment back (base64 chunks through the gateway) as a Blob. */
export async function downloadAttachment(a: ArchiveAttachment, onProgress?: (pct: number) => void): Promise<Blob> {
  const parts: string[] = [];
  for (let from = 1; from <= a.CHUNK_COUNT; from += 1000) {
    const to = Math.min(a.CHUNK_COUNT, from + 999);
    const rows = await cmQuery(`SELECT CHUNK_NO, CHUNK_DATA FROM RR_CM_V_ARCHIVE_ATT_CHUNKS
                                WHERE ATTACHMENT_ID = ${nlit(a.ATTACHMENT_ID)} AND CHUNK_NO BETWEEN ${from} AND ${to} ORDER BY CHUNK_NO`);
    rows.forEach(r => parts.push(String(r.CHUNK_DATA || '')));
    onProgress?.(Math.round((to / Math.max(1, a.CHUNK_COUNT)) * 100));
  }
  const bytes: Uint8Array[] = parts.map(b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  return new Blob(bytes as BlobPart[], { type: a.MIME_TYPE || 'application/octet-stream' });
}

export const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error || new Error('Could not read the file'));
  r.readAsDataURL(file);
});

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// ── live account analysis (preview before archiving) ─────────────────────────────
const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** 01-JUN-2026 or 2026-06-01[T…] → 2026-06-01 */
export const isoDate = (v: unknown): string => {
  const s = String(v ?? '').trim();
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
};

const SEGMENTS = ['company', 'lob', 'department', 'account', 'sub_account', 'analysis', 'intercompany'];

/** GL lines of a cash account combination between two dates, from gl/accountanalysis. */
export async function previewAccountAnalysis(cashAccount: string, from: string, to: string): Promise<GlLine[]> {
  const segs = cashAccount.split('-').map(s => s.trim());
  const p = new URLSearchParams({ from_date: from, to_date: to, page_size: '99999' });
  SEGMENTS.forEach((k, i) => { if (segs[i]) p.set(k, segs[i]); });
  const url = `${apexBase()}/gl/accountanalysis?${p}`;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => null);
  logCall({ method: 'GET', url, body: null, status: res.status, ok: res.ok && !!data, ms: Math.round(performance.now() - t0),
    response: data && typeof data === 'object' ? { ...data, items: `(${data.items?.length ?? 0} lines)` } : data, label: 'Account analysis' });
  if (!res.ok || !data) throw new Error(data?.error || `Account analysis failed (HTTP ${res.status})`);
  const seen = new Set<string>();
  const want = segs.join('-');
  return (data.items || []).flatMap((it: any, i: number) => {
    const combo = [it.company, it.lob, it.department, it.account, it.subAccount ?? it.sub_account, it.analysis, it.intercompany,
      it.future1, it.future2].filter(v => v != null && v !== '').join('-');
    if (combo && combo !== want) return [];                    // the service does not filter the future segments
    const k = `${it.jeHeaderId}-${it.jeLineNumber}`;
    if (seen.has(k)) return [];
    seen.add(k);
    return [{
      key: `p${i}`, accountingDate: isoDate(it.accountingDate), periodName: it.defaultPeriodName || '', batchName: it.batchName || '', journalName: '',
      source: it.userJeSourceName || '', category: it.userJeCategoryName || '', account: combo || cashAccount,
      accountDescription: it.accountDescription || '', description: it.description || '', currency: it.currencyCode || '',
      enteredDr: Number(it.enteredDr) || 0, enteredCr: Number(it.enteredCr) || 0, accountedDr: Number(it.accountedDr) || 0,
      accountedCr: Number(it.accountedCr) || 0, references: [], jeHeaderId: num(it.jeHeaderId), jeLineNumber: num(it.jeLineNumber),
      approvalStatus: it.approvalStatusMeaning || '',
    } as GlLine];
  }).sort((a: GlLine, b: GlLine) => a.accountingDate.localeCompare(b.accountingDate) || (a.jeHeaderId ?? 0) - (b.jeHeaderId ?? 0));
}

// ── manual reconciled data (pasted from Excel) ─────────────────────────────────────
export interface ManualGrid {
  header: string[] | null; rows: string[][]; columns: number;
  /** numeric columns → total */
  totals: (number | null)[];
}
const NUM_RE = /^\(?-?[\d,]+(\.\d+)?\)?$/;
export const parseAmount = (s: string): number | null => {
  const t = String(s || '').trim().replace(/\s/g, '');
  if (!t || !NUM_RE.test(t)) return null;
  const neg = t.startsWith('(') && t.endsWith(')');
  const v = Number(t.replace(/[(),]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};

/** Split pasted text into a grid: tab-separated cells (Excel), first row as header when it has no numbers. */
export function parseManual(text: string, firstRowHeader?: boolean): ManualGrid {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].replace(/\t/g, '').trim()) lines.pop();
  const cells = lines.map(l => l.split('\t'));
  const columns = cells.reduce((m, r) => Math.max(m, r.length), 0);
  const looksHeader = cells.length > 1 && cells[0].filter(c => c.trim()).length >= 2 && cells[0].every(c => parseAmount(c) === null);
  const useHeader = firstRowHeader ?? looksHeader;
  const header = useHeader && cells.length ? cells[0] : null;
  const rows = useHeader ? cells.slice(1) : cells;
  const totals = Array.from({ length: columns }, (_, c) => {
    let any = false; let t = 0; let text = 0;
    rows.forEach(r => {
      const v = parseAmount(r[c] ?? '');
      if (v !== null) { any = true; t += v; } else if ((r[c] ?? '').trim()) text++;
    });
    return any && text <= Math.max(1, rows.length * 0.2) ? Math.round(t * 100) / 100 : null;
  });
  return { header, rows, columns, totals };
}
