/**
 * Central GL Posting Service
 * Single place for the 3-step journal posting flow:
 *   0. Duplicate check  (GET  /gl/journals/check)
 *   1. Create journal   (POST /journals/create)
 *   2. Post to GL       (PUT  /gl/journals/:id/post — RR_POST_JOURNAL)
 *   3. Stamp SLA header (POST /sla/accounting/post)
 */
import { APEX_DB_CONFIG } from '../config/api.config';
import { checkGLJournalExists } from './sla.service';

const BASE = APEX_DB_CONFIG.baseUrl;

/**
 * Fetch actual GL journal lines (RR_GL_JE_LINES_ALL joined to headers) filtered
 * by GL reference columns. This reads the posted journal directly — not the SLA
 * staging tables. Columns returned (snake_case): line_num, je_header_id,
 * journal_name, period_name, accounting_date, je_batch_id, posting_status,
 * reference1..6, account, description, entered_dr/cr, accounted_dr/cr, currency_code.
 */
export async function getGlJournalLines(params: {
  reference1?: string | number;
  reference2?: string | number;
  reference5?: string;
  periodName?: string;
  limit?: number;
}): Promise<{ items: any[] }> {
  const qs = new URLSearchParams();
  if (params.reference1 != null) qs.set('reference1', String(params.reference1));
  if (params.reference2 != null) qs.set('reference2', String(params.reference2));
  if (params.reference5 != null) qs.set('reference5', String(params.reference5));
  if (params.periodName)         qs.set('period_name', params.periodName);
  qs.set('limit', String(params.limit ?? 500));
  const res  = await fetch(`${BASE}/gl/journals/lines?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return { items: Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []) };
}

// Maps SLA event type codes → reference5 label stored on GL lines
const EVENT_TYPE_TO_REF5: Record<string, string> = {
  AP_INVOICE_CREATION:     'AP-INVOICE-CREATION',
  INVOICE_CANCELLED:       'AP-INVOICE-CANCELLATION',
  PREPAYMENT_APPLIED:      'AP-PREPAYMENT-APPLICATION',
  PAYMENT_CREATED:         'AP-PAYMENT',
  AP_PAYMENT_CREATED:      'AP-PAYMENT',
  VOID_PAYMENT:            'AP-PAYMENT-VOID',
  AP_PAYMENT_VOID:         'AP-PAYMENT-VOID',
  PAYMENT_MATURITY:        'AP-PAYMENT-MATURITY',
  AP_PDC_CLEARING:         'AP-PDC-CLEARING',
};

export function eventTypeToRef5(eventTypeCode: string): string {
  return EVENT_TYPE_TO_REF5[eventTypeCode?.toUpperCase()] ?? eventTypeCode ?? 'PAYABLES';
}

export interface GlPostingLine {
  lineType:           'DR' | 'CR';
  enteredDr:          number | null;
  enteredCr:          number | null;
  accountedDr:        number | null;
  accountedCr:        number | null;
  description:        string;
  currencyCode:       string;
  accountingDate:     string;
  accountCombination: string;
  accountingClass:    string | null;
  legalEntity:        string | null;
  // Reference columns (reference1-5 mapped internally; 6-10 passed through as-is)
  reference6?:        string | null;
  reference7?:        string | null;  // bank account name for bank transfer recon
  reference8?:        string | null;
  reference9?:        string | null;
  reference10?:       string | null;
  reconciledFlag?:    string | null;
  [key: string]: any;
}

export interface GlPostingOptions {
  // SLA header info
  slaHeaderId:    number;
  sourceNumber:   string;          // invoice number / payment number — goes to reference1
  sourceId:       number | string; // invoice id / payment id — goes to reference2
  eventTypeCode:  string;          // AP_INVOICE_CREATION, INVOICE_CANCELLED, etc.
  // Journal metadata
  periodName:     string;          // Mon-YY format e.g. Apr-26
  ledgerName:     string;
  ledgerId:       number;
  currency:       string;
  accountingDate:  string;          // YYYY-MM-DD
  legalEntity:     string;
  businessUnit:    string;
  conversionRate?: number;          // 1 for functional currency, actual rate otherwise
  jeCategory?:     string;          // defaults to 'Purchase Invoices' if omitted
  jeSource?:       string;          // defaults to 'Payables' if omitted
  batchSource?:    string;          // defaults to 'Payables' if omitted
  // Optional description overrides (fall back to auto-generated if omitted)
  batchDescription?: string;
  journalDescription?: string;
  journalName?:    string;
  // Lines
  lines:          GlPostingLine[];
  createdBy?:     string;
  // When true, skip the duplicate-journal check and always create a fresh batch.
  // Use for revaluation accounting where an old FC journal must NOT be reused.
  forceCreate?:   boolean;
}

export interface GlPostingResult {
  success:    boolean;
  skipped:    boolean;   // true when duplicate was found and reused
  batchId:    number | null;
  headerId:   number | null;
  batchName:  string;
  error?:     string;
  postPayload?: { url: string; body: object };  // captured for debug display
}

/**
 * Build the exact POST /journals/create body (batch + header + lines) from the
 * posting options. This is the single source of truth for the journal payload —
 * used by postSlaToGL() and surfaced in the step-by-step debug modals so what is
 * shown matches what is actually sent (including reference1/2/5).
 */
export function buildGlJournalPayload(opts: GlPostingOptions, batchName: string) {
  const {
    sourceNumber, sourceId, eventTypeCode,
    periodName, ledgerName, ledgerId, currency, accountingDate,
    businessUnit, lines, createdBy = 'user',
    conversionRate = 1, jeCategory = 'Purchase Invoices',
    jeSource = 'Payables', batchSource = 'Payables',
    batchDescription: batchDescOverride,
    journalDescription: journalDescOverride,
    journalName: journalNameOverride,
  } = opts;

  const rate = (conversionRate && conversionRate > 0) ? conversionRate : 1;
  const ref5 = eventTypeToRef5(eventTypeCode);

  // runningTotalDr/Cr = entered (foreign currency) amounts for the journal header.
  // For revaluation journals enteredDr/Cr are 0, so fall back to accountedDr/Cr.
  const entTotalDr = lines.reduce((s, l) => s + (l.enteredDr ?? 0), 0);
  const entTotalCr = lines.reduce((s, l) => s + (l.enteredCr ?? 0), 0);
  const totalDr = entTotalDr > 0 ? entTotalDr : lines.reduce((s, l) => s + (l.accountedDr ?? 0), 0);
  const totalCr = entTotalCr > 0 ? entTotalCr : lines.reduce((s, l) => s + (l.accountedCr ?? 0), 0);

  return {
    batch: {
      batchName,
      batchDescription:  batchDescOverride || `${ref5} – ${sourceNumber}`,
      ledgerName, ledgerId,
      status:            'NEW',
      accountingPeriod:  periodName,
      controlTotal:      totalDr,
      runningTotalDr:    totalDr,
      runningTotalCr:    totalCr,
      batchSource:       batchSource,
      createdBy,
    },
    header: {
      ledgerId, ledgerName,
      jeCategory:             jeCategory,
      jeSource:               jeSource,
      periodName,
      journalName:            journalNameOverride || `${ref5}-${sourceNumber}`,
      description:            journalDescOverride || batchDescOverride || `${ref5} – ${sourceNumber}`,
      currencyCode:           currency,
      currencyConversionType: 'User',
      currencyConversionDate: accountingDate,
      currencyConversionRate: rate,
      defaultEffectiveDate:   accountingDate,
      status:                 'NEW',
      runningTotalDr:         totalDr,
      runningTotalCr:         totalCr,
      createdBy,
    },
    lines: lines.map(l => {
      // Always send both enteredDr and enteredCr from the input.
      // For revaluation lines both are 0; for normal lines the inactive side is 0 or null.
      const eDr = l.enteredDr ?? null;
      const eCr = l.enteredCr ?? null;
      // accountedDr only on DR lines; accountedCr only on CR lines.
      // Use the explicit value when provided (revaluation sends actual AED amounts here).
      // Fall back to entered × rate for normal currency conversion journals.
      const aDr = l.lineType === 'DR'
        ? (l.accountedDr != null ? l.accountedDr : (eDr != null ? Math.round(eDr * rate * 100) / 100 : null))
        : null;
      const aCr = l.lineType === 'CR'
        ? (l.accountedCr != null ? l.accountedCr : (eCr != null ? Math.round(eCr * rate * 100) / 100 : null))
        : null;
      return {
      enteredDr:                eDr,
      enteredCr:                eCr,
      accountedDr:              aDr,
      accountedCr:              aCr,
      statAmount:               null,
      description:              l.description || '',
      currencyCode:             l.currencyCode || currency,
      currencyConversionDate:   l.accountingDate || accountingDate,
      currencyConversionRate:   rate,
      userCurrencyConversionType: 'User',
      accountCombination:       l.accountCombination || '',
      chartOfAccountsName:      'Chart of Accounts',
      reference1:               sourceNumber,
      reference2:               String(sourceId),
      reference3:               l.accountingClass || null,
      reference4:               businessUnit || null,
      reference5:               ref5,
      reference6:               l.reference6  || null,
      reference7:               l.reference7  || null,
      reference8:               l.reference8  || null,
      reference9:               l.reference9  || null,
      reference10:              l.reference10 || null,
      reconciledFlag:           l.reconciledFlag || 'N',
      createdBy,
    };
    }),
  };
}

/**
 * Compute the deterministic-shaped batch name for a posting.
 * (Contains a timestamp, so two calls differ — pass an explicit name to reuse.)
 */
export function makeBatchName(eventTypeCode: string, sourceNumber: string): string {
  const ref5 = eventTypeToRef5(eventTypeCode);
  return `${ref5}-${sourceNumber}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-6)}`;
}

export async function postSlaToGL(opts: GlPostingOptions): Promise<GlPostingResult> {
  const {
    slaHeaderId, sourceNumber, sourceId, eventTypeCode,
    createdBy = 'user', forceCreate = false,
  } = opts;

  const ref5 = eventTypeToRef5(eventTypeCode);
  const batchName = makeBatchName(eventTypeCode, sourceNumber);

  // ── 0. Duplicate check ────────────────────────────────────────────────────
  // forceCreate=true bypasses this check (used for revaluation to avoid reusing
  // an old journal created with the wrong currency before a code fix).
  if (!forceCreate) {
    const exists = await checkGLJournalExists(sourceNumber, String(sourceId), ref5);
    if (exists.exists) {
      if (exists.status === 'P') {
        // Already posted — just stamp SLA and return
        await stampSla(slaHeaderId, exists.batchId, batchName, exists.headerId, createdBy);
        return { success: true, skipped: true, batchId: exists.batchId, headerId: exists.headerId, batchName };
      }
      // Exists but unposted — post the existing batch
      const putOk = await putPostJournal(exists.batchId!);
      if (!putOk.success) return { success: false, skipped: false, batchId: exists.batchId, headerId: exists.headerId, batchName, error: putOk.error };
      await stampSla(slaHeaderId, exists.batchId, batchName, exists.headerId, createdBy);
      return { success: true, skipped: true, batchId: exists.batchId, headerId: exists.headerId, batchName };
    }
  }

  // ── 1. Create journal ─────────────────────────────────────────────────────
  // Build the batch + header + lines body via the shared builder so the payload
  // is identical to what the step-by-step debug modal shows (references included).
  const payload = buildGlJournalPayload(opts, batchName);

  const createUrl  = `${BASE}/journals/create`;
  const postPayload = { url: createUrl, body: payload };
  const createRes  = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    return { success: false, skipped: false, batchId: null, headerId: null, batchName, error: createData?.message || `HTTP ${createRes.status}`, postPayload };
  }

  const glBatchId  = createData.jeBatchId  ?? createData.je_batch_id  ?? createData.batchId  ?? null;
  const glHeaderId = createData.jeHeaderId ?? createData.je_header_id ?? createData.headerId ?? null;

  // ── 2. PUT /gl/journals/:id/post (RR_POST_JOURNAL — validates period + posts) ──
  if (glBatchId) {
    const putOk = await putPostJournal(glBatchId);
    if (!putOk.success) {
      return { success: false, skipped: false, batchId: glBatchId, headerId: glHeaderId, batchName, error: putOk.error };
    }
  }

  // ── 3. Stamp SLA header ───────────────────────────────────────────────────
  await stampSla(slaHeaderId, glBatchId, batchName, glHeaderId, createdBy);

  return { success: true, skipped: false, batchId: glBatchId, headerId: glHeaderId, batchName, postPayload };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function putPostJournal(batchId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const res  = await fetch(`${BASE}/gl/journals/${batchId}/post`, {
      method: 'PUT',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      const err = Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors[0] : data?.error || `HTTP ${res.status}`;
      return { success: false, error: err };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function stampSla(
  headerId: number,
  glBatchId: number | null,
  glBatchName: string,
  glHeaderId: number | null,
  postedBy: string,
): Promise<void> {
  try {
    await fetch(`${BASE}/sla/accounting/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headerId, glBatchId, glBatchName, glHeaderId, postedBy }),
    });
  } catch { /* stamp failure is non-fatal — journal is posted */ }
}
