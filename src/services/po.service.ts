// Purchasing-RR (module PO) service.
//   Reads  → POST ai/executequery (guarded SELECT gateway) over the RR_PO_V_* views
//            (database/po/301_po_views.sql)
//   Writes → POST po/execute (registry-whitelisted package procedures,
//            database/po/303_po_execute.sql). Every procedure returns
//            { status: S|W|E, id, number, message }.
import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = APEX_DB_CONFIG.baseUrl.replace(/\/+$/, '');

export type Row = Record<string, any>;

// ── API call log (shown by the "API" button on Purchasing pages) ───────────
export interface ApiCall {
  id: number; at: string; method: string; url: string; body: unknown;
  status: number | null; ok: boolean; ms: number; response: unknown; label: string;
}
const apiLog: ApiCall[] = [];
const apiListeners = new Set<() => void>();
let apiSeq = 0;
export const getApiLog = () => apiLog;
export const clearApiLog = () => { apiLog.length = 0; apiListeners.forEach(f => f()); };
export const onApiLog = (f: () => void) => { apiListeners.add(f); return () => { apiListeners.delete(f); }; };
export function logApi(c: Omit<ApiCall, 'id' | 'at'>) {
  apiLog.unshift({ ...c, id: ++apiSeq, at: new Date().toISOString() });
  if (apiLog.length > 100) apiLog.length = 100;
  apiListeners.forEach(f => f());
}
const parseMaybe = (t: string) => { try { return JSON.parse(t); } catch { return t.slice(0, 4000); } };

export interface ExecResult {
  success: boolean;
  status: 'S' | 'W' | 'E';
  id: number | null;
  number: string | null;
  message: string;
}

/** SQL literal for the read gateway (values are always quoted/escaped). */
export const lit = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};
/** Numeric literal — never lets text through. */
export const nlit = (v: unknown): string => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? 'NULL' : String(n);
};
export const dlit = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `DATE '${d.slice(0, 10)}'` : 'NULL';

const errText = (text: string, data: any, status: number) => {
  const detail = data?.error || data?.message
    || (text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '');
  return detail ? `HTTP ${status} — ${detail}` : `HTTP ${status}`;
};

/** Run one SELECT through the gateway; rows come back as objects keyed by UPPER column name. */
export async function poQuery(sql: string, maxRows = 1000, appUser = 'PURCHASING'): Promise<Row[]> {
  const reqBody = { sql: sql.trim().replace(/;\s*$/, ''), maxRows, appUser };
  const t0 = performance.now();
  const res = await fetch(`${BASE}/ai/executequery`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reqBody),
  });
  const text = await res.text();
  const parsed = parseMaybe(text);
  logApi({ method: 'POST', url: `${BASE}/ai/executequery`, body: reqBody, status: res.status, ms: Math.round(performance.now() - t0),
    ok: res.ok && (parsed as any)?.success !== false, label: 'Query',
    response: typeof parsed === 'object' && parsed ? { ...(parsed as any), rows: `(${(parsed as any).rows?.length ?? 0} rows)` } : parsed });
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* HTML error page */ }
  if (!res.ok || !data || data.success === false) throw new Error(errText(text, data, res.status));
  const cols: string[] = (data.columns || []).map((c: any) => String(typeof c === 'string' ? c : c?.name ?? c).toUpperCase());
  return (data.rows || []).map((r: any[]) => {
    const o: Row = {};
    cols.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}

/** Call a registered procedure. Resolves for S and W; throws with the procedure's message on E. */
export async function poExec(proc: string, params: Record<string, unknown>, user: string): Promise<ExecResult> {
  const reqBody = { proc, params, user: user || 'UNKNOWN' };
  const t0 = performance.now();
  const res = await fetch(`${BASE}/po/execute`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reqBody),
  });
  const text = await res.text();
  const parsedResp = parseMaybe(text);
  logApi({ method: 'POST', url: `${BASE}/po/execute`, body: reqBody, status: res.status, ms: Math.round(performance.now() - t0),
    ok: res.ok && ['S', 'W'].includes((parsedResp as any)?.status), label: proc.replace(/^RR_PO_/, '').replace('_PKG', ''), response: parsedResp });
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* HTML error page */ }
  if (!data) {
    throw new Error(res.status === 404
      ? 'po/execute is not deployed — run database/po/303_po_execute.sql'
      : errText(text, data, res.status));
  }
  if (data.status !== 'S' && data.status !== 'W') throw new Error(data.message || errText(text, data, res.status));
  return data as ExecResult;
}

// ── Procedure names (must match RR_PO_PROC_REGISTRY) ───────────────────────
export const PROC = {
  saveSetup: 'RR_PO_SETUP_PKG.SAVE_SETUP',
  deleteSetup: 'RR_PO_SETUP_PKG.DELETE_SETUP',
  saveReq: 'RR_PO_REQ_PKG.SAVE_REQUISITION',
  submitReq: 'RR_PO_REQ_PKG.SUBMIT',
  withdrawReq: 'RR_PO_REQ_PKG.WITHDRAW',
  cancelReq: 'RR_PO_REQ_PKG.CANCEL',
  deleteReq: 'RR_PO_REQ_PKG.DELETE_DRAFT',
  returnReqLines: 'RR_PO_REQ_PKG.RETURN_LINES',
  savePo: 'RR_PO_DOC_PKG.SAVE_PO',
  autocreate: 'RR_PO_DOC_PKG.AUTOCREATE',
  copyPo: 'RR_PO_DOC_PKG.COPY_PO',
  submitPo: 'RR_PO_DOC_PKG.SUBMIT_PO',
  withdrawPo: 'RR_PO_DOC_PKG.WITHDRAW_PO',
  deletePo: 'RR_PO_DOC_PKG.DELETE_PO',
  cancelPo: 'RR_PO_DOC_PKG.CANCEL_PO',
  closePo: 'RR_PO_DOC_PKG.CLOSE_PO',
  holdPo: 'RR_PO_DOC_PKG.HOLD_PO',
  communicated: 'RR_PO_DOC_PKG.MARK_COMMUNICATED',
  submitChange: 'RR_PO_DOC_PKG.SUBMIT_CHANGE',
  cancelChange: 'RR_PO_DOC_PKG.CANCEL_CHANGE',
  receive: 'RR_PO_RCV_PKG.RECEIVE',
  returnRcv: 'RR_PO_RCV_PKG.RETURN_TO_SUPPLIER',
  correctRcv: 'RR_PO_RCV_PKG.CORRECT',
  markAccounted: 'RR_PO_ACCT_PKG.MARK_ACCOUNTED',
  runAccrual: 'RR_PO_ACCT_PKG.RUN_PERIOD_END_ACCRUAL',
  cancelAccrual: 'RR_PO_ACCT_PKG.CANCEL_ACCRUAL_RUN',
  writeOff: 'RR_PO_ACCT_PKG.WRITE_OFF',
  decide: 'RR_PO_APPROVAL_PKG.DECIDE',
  recordInvoice: 'RR_PO_MATCH_PKG.RECORD_INVOICE',
  cancelInvoiceMatch: 'RR_PO_MATCH_PKG.CANCEL_INVOICE',
  setInvoiceStatus: 'RR_PO_MATCH_PKG.SET_INVOICE_STATUS',
} as const;

// ── Lookups ────────────────────────────────────────────────────────────────
export interface BusinessUnit {
  BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string; COMPANY: string | null; PRIMARY_LEDGER_ID: number | null;
  FUNCTIONAL_CURRENCY: string | null; OPTIONS_SET: 'Y' | 'N'; REQUIRE_REQUISITION: string | null;
  ACCRUE_AT_RECEIPT_FLAG: string | null; RECEIPT_ACCRUAL_ACCOUNT: string | null;
}

export const loadBusinessUnits = () =>
  poQuery('SELECT * FROM RR_PO_V_BUSINESS_UNITS ORDER BY BUSINESS_UNIT_NAME') as Promise<BusinessUnit[]>;

export const loadLocations = () =>
  poQuery(`SELECT LOCATION_ID, LOCATION_CODE, LOCATION_NAME, BUSINESS_UNIT_ID, SHIP_TO_FLAG, BILL_TO_FLAG, DELIVER_TO_FLAG,
                  ADDRESS_LINE1, ADDRESS_LINE2, CITY, COUNTRY, STATUS
           FROM RR_PO_LOCATIONS WHERE STATUS = 'ACTIVE' ORDER BY LOCATION_NAME`);

export const loadCategories = () =>
  poQuery(`SELECT * FROM RR_PO_V_CATEGORIES WHERE STATUS = 'ACTIVE' ORDER BY FULL_NAME`);

export const loadItems = () =>
  poQuery(`SELECT EXPENSE_ITEM_ID, ITEM_CODE, DESCRIPTION, CATEGORY_ID, CATEGORY_NAME, LINE_TYPE, UOM_CODE, LIST_PRICE,
                  CURRENCY_CODE, PREFERRED_SUPPLIER_ID, PREFERRED_SUPPLIER_SITE_ID, PREFERRED_SUPPLIER_NAME, SUPPLIER_ITEM_NUM,
                  TAX_CODE, LEAD_TIME_DAYS
           FROM RR_PO_V_EXPENSE_ITEMS WHERE STATUS = 'ACTIVE' ORDER BY ITEM_CODE`);

export const loadUoms = () =>
  poQuery(`SELECT UOM_CODE, UOM_NAME, UOM_CLASS FROM RR_PO_UOMS WHERE STATUS = 'ACTIVE' ORDER BY UOM_CODE`);

export const loadSupplierSites = (bu: number | null) =>
  poQuery(`SELECT * FROM RR_PO_V_SUPPLIER_SITES ${bu ? `WHERE BUSINESS_UNIT_ID = ${nlit(bu)}` : ''}
           ORDER BY SUPPLIER_NAME, SITE_NAME`);

export async function loadTaxCodes(): Promise<Row[]> {
  try {
    return await poQuery(`SELECT TAX_CODE, MAX(TAX_RATE) AS TAX_RATE FROM RR_INPUT_OUTPUT_TAX
                          WHERE STATUS = 'ACTIVE' GROUP BY TAX_CODE ORDER BY TAX_CODE`);
  } catch { return []; }
}

export async function loadCurrencies(): Promise<string[]> {
  const base = ['AED', 'USD', 'EUR', 'GBP', 'SAR'];
  try {
    const r = await poQuery(`SELECT DISTINCT FROM_CURRENCY AS C FROM RR_CURRENCY_DAILY_RATES
                             UNION SELECT DISTINCT TO_CURRENCY FROM RR_CURRENCY_DAILY_RATES`);
    return Array.from(new Set([...base, ...r.map(x => String(x.C)).filter(Boolean)])).sort();
  } catch { return base; }
}

export const loadHistory = (entityType: string, id: number) =>
  poQuery(`SELECT * FROM RR_PO_V_HISTORY WHERE ENTITY_TYPE = ${lit(entityType)} AND ENTITY_ID = ${nlit(id)}
           ORDER BY ACTION_DATE DESC`);

// ── Formatting ─────────────────────────────────────────────────────────────
export const n = (v: unknown) => Number(v) || 0;
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const money = (v: unknown, dp = 2) =>
  v === null || v === undefined || v === '' ? '' :
    n(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const qty = (v: unknown) =>
  v === null || v === undefined || v === '' ? '' : n(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
export const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const plusDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

export const STATUS_COLOR: Record<string, string> = {
  INCOMPLETE: 'default', PENDING_APPROVAL: 'gold', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'volcano',
  WITHDRAWN: 'default', OPEN: 'blue', CLOSED: 'purple', FINALLY_CLOSED: 'magenta', CLOSED_FOR_RECEIVING: 'cyan',
  CLOSED_FOR_INVOICING: 'geekblue', ON_PO: 'green', RETURNED: 'orange', UNACCOUNTED: 'orange', ACCOUNTED: 'green',
  DRAFT: 'default', POSTED: 'green', PENDING: 'gold', ACTIVE: 'green', INACTIVE: 'default', RECEIVE: 'green',
  RETURN: 'orange', RETURN_TO_SUPPLIER: 'orange', CORRECT: 'blue', MATCHED: 'green',
  NOT_INVOICED: 'default', PARTIALLY_INVOICED: 'gold', FULLY_INVOICED: 'green',
};
export const label = (s: unknown) => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// ── Business unit memory (shared by all Purchasing pages) ──────────────────
const BU_KEY = 'po.businessUnitId';
export const rememberedBu = (): number | null => {
  try { const v = localStorage.getItem(BU_KEY); return v ? Number(v) : null; } catch { return null; }
};
export const rememberBu = (id: number | null) => {
  try { if (id) localStorage.setItem(BU_KEY, String(id)); else localStorage.removeItem(BU_KEY); } catch { /* ignore */ }
};
