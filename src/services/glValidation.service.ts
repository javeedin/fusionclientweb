import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = `${APEX_DB_CONFIG.baseUrl}/gl`;

// ── Types ────────────────────────────────────────────────────────────────────

export type ValidationCategory =
  | 'STRUCTURE'    // wrong line count, both Dr+Cr set on one line, etc.
  | 'BALANCE'      // Dr total ≠ Cr total, batch totals mismatch
  | 'ACCOUNT'      // empty / suspiciously short account combination
  | 'INTEGRITY'    // Dr line references a txnId outside the declared group
  | 'DUPLICATE'    // same txnId appears on multiple Dr lines
  | 'STATUS'       // source transaction is already Posted
  | 'METADATA'     // empty ledger ID, period, currency, or date
  | 'DESCRIPTION'; // blank line description

export type ValidationSeverity = 'ERROR' | 'WARNING';

export interface GlValidationError {
  category: ValidationCategory;
  severity: ValidationSeverity;
  message:  string;
}

export interface GlJournalLine {
  enteredDr:          number | null;
  enteredCr:          number | null;
  accountCombination: string;
  description:        string | null;
  reference1?:        string | null;
  currencyCode?:      string | null;
}

export interface GlJournalPayload {
  batch: {
    batchName:        string;
    ledgerId:         number;
    ledgerName:       string;
    accountingPeriod: string;
    controlTotal:     number;
    runningTotalDr:   number;
    runningTotalCr:   number;
  };
  header: {
    periodName:             string;
    currencyCode:           string;
    currencyConversionDate: string;
    journalName:            string;
  };
  lines: GlJournalLine[];
}

export interface GlValidationMeta {
  module:              string;           // 'PC', 'GL', 'AP', 'FA', etc.
  referenceNo:         string;
  expectedDrCount?:    number;           // if known upfront
  sourceTxnIds?:       number[];         // all txnIds this journal should cover
  sourceTxnStatuses?:  Record<number, string>; // { txnId → 'Unposted'|'Posted'|'Error' }
}

export interface GlValidationResult {
  valid:   boolean;
  errors:  GlValidationError[];
  logId?:  number;
  summary: string;
}

export interface GlValidationLogEntry {
  logId:           number;
  module:          string;
  referenceNo:     string | null;
  batchName:       string | null;
  result:          'FAILED' | 'PASSED';
  errorCount:      number;
  warningCount:    number;
  errorCategories: string | null;
  errorSummary:    string | null;
  errorDetail:     GlValidationError[] | null;
  createdBy:       string | null;
  creationDate:    string;
}

// ── Pure validation — no side effects ────────────────────────────────────────

const AMOUNT_TOLERANCE = 0.01;

export function validateGlPayload(
  payload: GlJournalPayload,
  meta:    GlValidationMeta,
): Omit<GlValidationResult, 'logId'> {
  const errors: GlValidationError[] = [];
  const { batch, header, lines } = payload;

  // 1. METADATA ─────────────────────────────────────────────────────────────
  if (!batch.batchName?.trim())
    errors.push({ category: 'METADATA', severity: 'ERROR', message: 'batch.batchName is empty' });
  if (!batch.ledgerId || batch.ledgerId <= 0)
    errors.push({ category: 'METADATA', severity: 'ERROR', message: `batch.ledgerId is invalid: ${batch.ledgerId}` });
  if (!batch.ledgerName?.trim())
    errors.push({ category: 'METADATA', severity: 'ERROR', message: 'batch.ledgerName is empty' });
  if (!batch.accountingPeriod?.trim())
    errors.push({ category: 'METADATA', severity: 'ERROR', message: 'batch.accountingPeriod is empty' });
  if (!header.periodName?.trim())
    errors.push({ category: 'METADATA', severity: 'ERROR', message: 'header.periodName is empty' });
  if (!header.currencyCode?.trim())
    errors.push({ category: 'METADATA', severity: 'ERROR', message: 'header.currencyCode is empty' });
  if (!header.currencyConversionDate?.match(/^\d{4}-\d{2}-\d{2}$/))
    errors.push({ category: 'METADATA', severity: 'ERROR', message: `header.currencyConversionDate is not a valid YYYY-MM-DD: "${header.currencyConversionDate}"` });

  // Early exit if no lines — remaining checks can't run
  if (!lines || lines.length === 0) {
    errors.push({ category: 'STRUCTURE', severity: 'ERROR', message: 'Journal has no lines' });
    const hardErrors = errors.filter(e => e.severity === 'ERROR');
    return { valid: hardErrors.length === 0, errors, summary: buildSummary(errors, meta) };
  }

  // 2. STRUCTURE ─────────────────────────────────────────────────────────────
  const drLines    = lines.filter(l => l.enteredDr != null && l.enteredDr > 0);
  const crLines    = lines.filter(l => l.enteredCr != null && l.enteredCr > 0);
  const bothSet    = lines.filter(l => l.enteredDr != null && l.enteredDr > 0 && l.enteredCr != null && l.enteredCr > 0);
  const neitherSet = lines.filter(l => !(l.enteredDr != null && l.enteredDr > 0) && !(l.enteredCr != null && l.enteredCr > 0));

  if (bothSet.length > 0)
    errors.push({ category: 'STRUCTURE', severity: 'ERROR', message: `${bothSet.length} line(s) have both enteredDr and enteredCr set — each line must be Dr-only or Cr-only` });
  if (neitherSet.length > 0)
    errors.push({ category: 'STRUCTURE', severity: 'ERROR', message: `${neitherSet.length} line(s) have zero/null for both enteredDr and enteredCr — every line needs a positive amount` });
  if (drLines.length === 0)
    errors.push({ category: 'STRUCTURE', severity: 'ERROR', message: 'No debit lines found in journal' });
  if (crLines.length === 0)
    errors.push({ category: 'STRUCTURE', severity: 'ERROR', message: 'No credit lines found in journal' });
  if (meta.expectedDrCount != null && drLines.length !== meta.expectedDrCount)
    errors.push({ category: 'STRUCTURE', severity: 'WARNING', message: `Expected ${meta.expectedDrCount} Dr line(s) but found ${drLines.length} — possible missing or extra expense line` });

  // 3. BALANCE ──────────────────────────────────────────────────────────────
  const totalDr = drLines.reduce((s, l) => s + (l.enteredDr ?? 0), 0);
  const totalCr = crLines.reduce((s, l) => s + (l.enteredCr ?? 0), 0);
  const drCrDiff = Math.abs(totalDr - totalCr);

  if (drCrDiff > AMOUNT_TOLERANCE)
    errors.push({ category: 'BALANCE', severity: 'ERROR', message: `Journal is unbalanced — Dr total ${totalDr.toFixed(2)} ≠ Cr total ${totalCr.toFixed(2)} (diff: ${drCrDiff.toFixed(2)})` });
  if (Math.abs(batch.runningTotalDr - batch.runningTotalCr) > AMOUNT_TOLERANCE)
    errors.push({ category: 'BALANCE', severity: 'ERROR', message: `batch.runningTotalDr (${batch.runningTotalDr}) ≠ batch.runningTotalCr (${batch.runningTotalCr})` });
  if (Math.abs(batch.controlTotal - batch.runningTotalDr) > AMOUNT_TOLERANCE)
    errors.push({ category: 'BALANCE', severity: 'ERROR', message: `batch.controlTotal (${batch.controlTotal}) ≠ batch.runningTotalDr (${batch.runningTotalDr})` });
  if (Math.abs(batch.controlTotal - totalDr) > AMOUNT_TOLERANCE)
    errors.push({ category: 'BALANCE', severity: 'ERROR', message: `batch.controlTotal (${batch.controlTotal}) ≠ actual computed Dr sum (${totalDr.toFixed(2)})` });

  const zeroLines = lines.filter(l => l.enteredDr === 0 || l.enteredCr === 0);
  if (zeroLines.length > 0)
    errors.push({ category: 'BALANCE', severity: 'WARNING', message: `${zeroLines.length} line(s) have an explicit zero amount — they will post as zero entries in GL` });

  // 4. ACCOUNT ──────────────────────────────────────────────────────────────
  lines.forEach((l, i) => {
    const side = (l.enteredDr != null && l.enteredDr > 0) ? 'Dr' : 'Cr';
    const ref  = l.reference1 ? `txn#${l.reference1}` : `line ${i + 1}`;
    if (!l.accountCombination?.trim())
      errors.push({ category: 'ACCOUNT', severity: 'ERROR',   message: `${side} ${ref}: accountCombination is empty or null — line cannot post without a valid account` });
    else if (l.accountCombination.trim().length < 4)
      errors.push({ category: 'ACCOUNT', severity: 'WARNING', message: `${side} ${ref}: accountCombination "${l.accountCombination}" is suspiciously short — may be a placeholder` });
  });

  // 4b. COMPANY CODE — all lines must share the same company (first segment) ──
  const companyCodes = lines
    .map(l => (l.accountCombination?.trim() || '').split('-')[0]?.trim())
    .filter(Boolean);
  const uniqueCompanies = [...new Set(companyCodes)];
  if (uniqueCompanies.length === 0)
    errors.push({ category: 'ACCOUNT', severity: 'ERROR', message: 'No valid account combinations found — cannot determine company code' });
  else if (uniqueCompanies.length > 1)
    errors.push({ category: 'ACCOUNT', severity: 'ERROR', message: `Company code mismatch across journal lines: found ${uniqueCompanies.join(', ')}. All lines must use the same company code.` });

  // 5. INTEGRITY — every Dr line must belong to this reference group ─────────
  if (meta.sourceTxnIds && meta.sourceTxnIds.length > 0) {
    const validIds = new Set(meta.sourceTxnIds.map(String));
    drLines.forEach(l => {
      if (l.reference1 && !validIds.has(String(l.reference1)))
        errors.push({ category: 'INTEGRITY', severity: 'ERROR', message: `Dr line references txn#${l.reference1} which is NOT part of this journal group (expected txnIds: ${[...validIds].join(', ')})` });
    });

    // Also check for Dr lines that should be there but aren't
    const coveredIds = new Set(drLines.map(l => l.reference1).filter(Boolean).map(String));
    meta.sourceTxnIds.forEach(id => {
      if (!coveredIds.has(String(id)))
        errors.push({ category: 'INTEGRITY', severity: 'WARNING', message: `txn#${id} is in the source group but has no corresponding Dr line` });
    });
  }

  // 6. DUPLICATE — same txnId on multiple Dr lines ──────────────────────────
  const seen = new Set<string>();
  drLines.forEach(l => {
    if (!l.reference1) return;
    const key = String(l.reference1);
    if (seen.has(key))
      errors.push({ category: 'DUPLICATE', severity: 'ERROR', message: `txn#${l.reference1} appears on more than one Dr line — would double-count this transaction in GL` });
    else
      seen.add(key);
  });

  // 7. STATUS — no already-posted source transaction ────────────────────────
  if (meta.sourceTxnStatuses) {
    Object.entries(meta.sourceTxnStatuses).forEach(([txnId, status]) => {
      if (status === 'Posted')
        errors.push({ category: 'STATUS', severity: 'ERROR', message: `txn#${txnId} is already Posted — creating this journal would produce a duplicate GL entry` });
      else if (status === 'Error')
        errors.push({ category: 'STATUS', severity: 'WARNING', message: `txn#${txnId} has posting status 'Error' — review before re-posting` });
    });
  }

  // 8. DESCRIPTION ──────────────────────────────────────────────────────────
  lines.forEach((l, i) => {
    const side = (l.enteredDr != null && l.enteredDr > 0) ? 'Dr' : 'Cr';
    const ref  = l.reference1 ? `txn#${l.reference1}` : `line ${i + 1}`;
    if (!l.description?.trim())
      errors.push({ category: 'DESCRIPTION', severity: 'WARNING', message: `${side} ${ref}: description is blank — the GL line will have no description` });
  });

  const hardErrors = errors.filter(e => e.severity === 'ERROR');
  return { valid: hardErrors.length === 0, errors, summary: buildSummary(errors, meta) };
}

function buildSummary(errors: GlValidationError[], meta: GlValidationMeta): string {
  if (errors.length === 0) return 'All checks passed';
  const hardErrors = errors.filter(e => e.severity === 'ERROR');
  const warnings   = errors.filter(e => e.severity === 'WARNING');
  const cats = [...new Set(hardErrors.map(e => e.category))].join(', ');
  return `[${meta.module}] ${meta.referenceNo} — ${hardErrors.length} error(s)${warnings.length ? `, ${warnings.length} warning(s)` : ''}: ${cats}`;
}

// ── API layer ─────────────────────────────────────────────────────────────────

export async function persistValidationLog(
  module:      string,
  referenceNo: string,
  batchName:   string,
  result:      'FAILED' | 'PASSED',
  errors:      GlValidationError[],
  payload:     GlJournalPayload,
  createdBy:   string,
): Promise<number | null> {
  try {
    const hardErrors = errors.filter(e => e.severity === 'ERROR');
    const warnings   = errors.filter(e => e.severity === 'WARNING');
    const categories = [...new Set(errors.map(e => e.category))].join(',');
    const summary    = hardErrors.map(e => `[${e.category}] ${e.message}`).join(' | ');

    const res = await fetch(`${BASE}/validation-log`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        module,
        referenceNo,
        batchName,
        result,
        errorCount:      hardErrors.length,
        warningCount:    warnings.length,
        errorCategories: categories || null,
        errorSummary:    summary    || null,
        errorDetail:     errors,
        glPayload:       payload,
        createdBy,
      }),
    });
    const data = await res.json();
    return (data.logId as number) ?? null;
  } catch {
    // Logging failure must never block the caller
    return null;
  }
}

export async function getValidationLogs(params: {
  module?:   string;
  result?:   'FAILED' | 'PASSED';
  dateFrom?: string;
  dateTo?:   string;
  limit?:    number;
} = {}): Promise<GlValidationLogEntry[]> {
  const qs = new URLSearchParams();
  if (params.module)   qs.set('module',    params.module);
  if (params.result)   qs.set('result',    params.result);
  if (params.dateFrom) qs.set('date_from', params.dateFrom);
  if (params.dateTo)   qs.set('date_to',   params.dateTo);
  if (params.limit)    qs.set('limit',     String(params.limit));

  const res  = await fetch(`${BASE}/validation-log${qs.toString() ? '?' + qs.toString() : ''}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);

  return ((data.items || []) as GlValidationLogEntry[]).map(r => ({
    ...r,
    errorDetail: parseJsonSafe<GlValidationError[]>(r.errorDetail as unknown as string),
  }));
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
