// Create Accounting for one cash external transaction, without the screen — the same steps as Manage External
// Transactions › Create Accounting (SLA entry → GL journal → link → accounted flag), then the journal is posted.
// Run automatically when an external transaction is approved in the app, and from the "approved, not accounted"
// banner on Manage External Transactions (approvals made from an e-mail link).
import dayjs from 'dayjs';
import { buildApexUrl } from '../config/api.helper';
import { buildPcBankTxnSlaPayload, fetchLedgerByBusinessUnit, derivePeriodName, createAccounting } from './sla.service';
import { getGlJournalLines } from './glPosting.service';
import { validateGlPayload, persistValidationLog, type GlJournalPayload } from './glValidation.service';
import { postJournal } from './manage-journals.service';
import { loadExternalTransaction } from './externalTxnLookup';
import { cleanDbMessage } from './glApproval.service';
import { emitApprovalsChanged } from './approvals.service';

const APEX_BASE = buildApexUrl('');
/** transactions being accounted in this window — a second request for one of them waits for nothing and creates nothing */
const inFlight = new Set<number>();

export interface CashAccountingResult {
  ok: boolean;
  /** accounted: journal created (+ posted when `posted`) · already: it had a journal · failed: nothing changed */
  outcome: 'accounted' | 'already' | 'failed';
  posted: boolean;
  message: string;
  batchName?: string;
  batchId?: number;
}

const day = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : dayjs().format('YYYY-MM-DD');
};

async function setAccountedFlag(extId: number, user: string): Promise<string | null> {
  try {
    const res = await fetch(`${APEX_BASE}/cash/externaltransactions/${extId}/acctflag?updated_by=${encodeURIComponent(user)}`,
      { method: 'PUT', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({})) as { success?: boolean; message?: string };
    return res.ok && data.success ? null : (data.message || `accounting flag update failed (HTTP ${res.status})`);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Create the accounting of an external transaction and post its journal. Never throws: the result says what
 * happened. A transaction that already has its journal (BANK_EXTERNAL_TRANSACTIONS lines with reference2 = its id)
 * is only marked accounted.
 */
export async function accountExternalTransaction(extId: number, user: string, opts: { post?: boolean } = {}): Promise<CashAccountingResult> {
  if (inFlight.has(extId)) return { ok: true, outcome: 'already', posted: false, message: `Transaction ${extId}: its accounting is already being created` };
  inFlight.add(extId);
  try {
    return await accountOne(extId, user, opts.post ?? true);
  } finally {
    inFlight.delete(extId);
  }
}

async function accountOne(extId: number, user: string, post: boolean): Promise<CashAccountingResult> {
  const fail = (message: string): CashAccountingResult => ({ ok: false, outcome: 'failed', posted: false, message });
  const txn = await loadExternalTransaction({ extId });
  if (!txn) return fail(`External transaction ${extId} was not found`);
  const ref = String(txn.referenceText || txn.transactionId || extId);

  // already accounted? (the same check the screen makes)
  try {
    const gl = await getGlJournalLines({ reference2: String(extId), reference5: 'BANK_EXTERNAL_TRANSACTIONS' });
    if (gl.items?.length) {
      const flagErr = txn.accountingFlag === 'Y' ? null : await setAccountedFlag(extId, user);
      emitApprovalsChanged({ reason: 'accounted', module: 'CASH', transactionId: extId });
      return { ok: !flagErr, outcome: 'already', posted: false, message: flagErr ? `Journal exists, but ${flagErr}` : `${ref}: journal already exists — marked accounted` };
    }
  } catch { /* no journal found → create it */ }

  const direction = String(txn.transactionDirection || (Number(txn.amount) >= 0 ? 'DR' : 'CR')).toUpperCase();
  const amount = Math.abs(Number(txn.amount) || 0);
  if (!amount) return fail(`${ref}: the amount is zero`);
  const asset = String(txn.assetAccountCombination || ''), offset = String(txn.offsetAccountCombination || '');
  if (!asset || !offset) return fail(`${ref}: the bank (cash) or offset account is missing`);
  const drAccount = direction === 'DR' ? asset : offset;
  const crAccount = direction === 'DR' ? offset : asset;
  const drCo = drAccount.split('-')[0]?.trim(), crCo = crAccount.split('-')[0]?.trim();
  if (!drCo || drCo !== crCo) return fail(`${ref}: company code mismatch — Dr ${drCo || '?'}, Cr ${crCo || '?'}`);

  const bu = String(txn.businessUnitName || '');
  const ledger = await fetchLedgerByBusinessUnit(bu);
  if (!ledger) return fail(`${ref}: no ledger found for business unit "${bu || '—'}"`);

  const date = day(txn.transactionDate || txn.valueDate);
  const periodName = derivePeriodName(new Date(date));
  const currency = String(txn.currencyCode || 'AED');
  const rate = Number(txn.bankConversionRate) || 1;
  try {
    const slaPayload = buildPcBankTxnSlaPayload({
      externalTransactionId: extId, referenceText: ref, transactionDate: date, accountingDate: date, periodName,
      currency, amount, assetAccountCombination: crAccount, offsetAccountCombination: drAccount,
      description: txn.description || undefined, businessUnit: bu || undefined, legalEntity: txn.legalEntityName || undefined,
      ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName, exchangeRate: rate, ledgerCurrency: 'AED', createdBy: user,
    });
    const sla = await createAccounting(slaPayload);
    const batchName = `BANK-${extId}-${Date.now()}`;
    const glPayload = {
      batch: {
        batchName, batchDescription: `Bank External Txn ${extId}`, ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
        accountingPeriod: periodName, controlTotal: amount, runningTotalDr: amount, runningTotalCr: amount,
        batchSource: 'Cash Management', createdBy: user,
      },
      header: {
        ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName, jeCategory: 'Cash Management', jeSource: 'Cash Management', periodName,
        journalName: `BANK-EXT-${extId}`, description: `${txn.transactionType || 'Bank Txn'} – ${ref}`,
        currencyCode: currency, currencyConversionType: 'User', currencyConversionDate: date, currencyConversionRate: rate,
        defaultEffectiveDate: date, status: 'NEW', runningTotalDr: amount, runningTotalCr: amount, createdBy: user,
      },
      lines: slaPayload.lines.map(l => ({
        enteredDr: l.lineType === 'DR' ? l.enteredDr : null, enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
        accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null, statAmount: null, description: l.description,
        currencyCode: l.currencyCode || currency, currencyConversionDate: date, currencyConversionRate: rate, userCurrencyConversionType: 'User',
        accountCombination: l.accountCombination, chartOfAccountsName: 'Chart of Accounts',
        reference1: String(txn.transactionId ?? ''), reference2: String(extId), reference3: l.accountingClass || null,
        reference4: bu || null, reference5: 'BANK_EXTERNAL_TRANSACTIONS', createdBy: user,
      })),
    };
    const check: GlJournalPayload = {
      batch: { batchName, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName, accountingPeriod: periodName, controlTotal: amount, runningTotalDr: amount, runningTotalCr: amount },
      header: { periodName, currencyCode: currency, currencyConversionDate: date, journalName: `BANK-EXT-${extId}` },
      lines: glPayload.lines.map(l => ({ enteredDr: l.enteredDr, enteredCr: l.enteredCr, accountCombination: l.accountCombination, description: l.description ?? null, reference1: l.reference1 })),
    };
    const validation = validateGlPayload(check, { module: 'CASH', referenceNo: ref });
    await persistValidationLog('CASH', ref, batchName, validation.valid ? 'PASSED' : 'FAILED', validation.errors, check, user);
    if (!validation.valid) {
      return fail(`${ref}: GL validation failed — ${validation.errors.filter(e => e.severity === 'ERROR').map(e => e.message).join('; ')}`);
    }

    const glRes = await fetch(`${APEX_BASE}/journals/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(glPayload),
    });
    const glData = await glRes.json().catch(() => ({})) as Record<string, any>;
    if (!glRes.ok || glData.status === 'ERROR') {
      return fail(`${ref}: the GL journal was not created (${glData.message || `HTTP ${glRes.status}`}) — the SLA entry stays Draft`);
    }
    const batchId = Number(glData.jeBatchId ?? glData.batchId) || undefined;
    await fetch(`${APEX_BASE}/sla/accounting/post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ headerId: sla.headerId, glBatchId: batchId || 0, glBatchName: batchName, glHeaderId: glData.jeHeaderId ?? glData.headerId ?? 0, postedBy: user }),
    }).catch(() => undefined);

    // post the journal (as Post Batch) — a refusal (closed period …) leaves it NEW, the accounting stands
    let posted = false, postNote = '';
    if (post && batchId) {
      const p = await postJournal(batchId);
      posted = !!p.success;
      if (!posted) postNote = cleanDbMessage(p.errors?.[0] || p.error || p.message) || 'posting refused';
    }
    const flagErr = await setAccountedFlag(extId, user);
    emitApprovalsChanged({ reason: 'accounted', module: 'CASH', transactionId: extId });
    const msg = `${ref}: journal ${batchName} created${posted ? ' and posted' : postNote ? `, not posted (${postNote})` : ''}${flagErr ? ` — but ${flagErr}` : ''}`;
    return { ok: !flagErr, outcome: 'accounted', posted, message: msg, batchName, batchId };
  } catch (e) {
    return fail(`${ref}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
