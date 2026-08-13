/**
 * SLA (Subledger Accounting) Service
 * Wraps all RR_SLA_PKG ORDS REST endpoints.
 */
import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = APEX_DB_CONFIG.baseUrl;
const EP   = APEX_DB_CONFIG.endpoints;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SlaExistsResult {
  exists: boolean;
  headerId: number | null;
  eventTypeCode: string | null;
  accountingStatus: string | null;
  postingStatus: string | null;
  accountingDate: string | null;
  creationDate: string | null;
  postedDate: string | null;
  canCreate: boolean;
  message: string;
}

export interface SlaCreateResult {
  headerId: number;
  lineCount: number;
  status: string;
  message: string;
}

export interface SlaPostResult {
  headerId: number;
  glBatchId: number;
  glHeaderId: number;
  status: string;
  message: string;
}

export interface SlaGetResult {
  found: boolean;
  headerId: number | null;
  moduleName: string | null;
  eventTypeCode: string | null;
  accountingStatus: string | null;
  postingStatus: string | null;
  accountingDate: string | null;
  periodName: string | null;
  description: string | null;
  creationDate: string | null;
  postedDate: string | null;
  postedBy: string | null;
  glBatchId: number | null;
  glBatchName: string | null;
  glHeaderId: number | null;
  lines: SlaLine[];
}

export interface SlaLine {
  lineId: number;
  lineNumber: number;
  lineType: string;
  accountingClass: string;
  accountCombination: string;
  enteredDr: number;
  enteredCr: number;
  accountedDr: number;
  accountedCr: number;
  currencyCode: string;
  description: string;
  accountDescription?: string;
}

export interface SlaCreatePayload {
  header: {
    moduleName: string;
    sourceTable: string;
    sourceId: number;
    sourceNumber: string;
    sourceType: string;
    eventTypeCode: string;
    eventDate: string;           // YYYY-MM-DD
    accountingDate: string;      // YYYY-MM-DD
    periodName: string;
    ledgerId: number;
    ledgerName: string;
    currencyCode: string;
    ledgerCurrency?: string;
    exchangeRate?: number;
    exchangeRateType?: string;
    businessUnit?: string;
    legalEntity?: string;
    description?: string;
    createdBy?: string;
  };
  lines: {
    lineNumber: number;
    lineType: string;            // 'DR' | 'CR'
    accountingClass: string;
    accountCombination: string;
    enteredDr: number;
    enteredCr: number;
    accountedDr: number;
    accountedCr: number;
    currencyCode?: string;
    exchangeRate?: number;
    description?: string;
    sourceLineId?: number;
    sourceLineNumber?: number;
    partyId?: number;
    partyType?: string;
  }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function apexGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body as T;
}

async function apexPost<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body as T;
}

// ── API calls ──────────────────────────────────────────────────────────────

/**
 * Check whether accounting exists for a source transaction.
 * Call this BEFORE createAccounting to understand current state.
 */
export async function checkAccountingExists(
  sourceTable: string,
  sourceId: number,
  eventType?: string,
): Promise<SlaExistsResult> {
  let url = `${BASE}/${EP.slaAccountingExists}?sourceTable=${encodeURIComponent(sourceTable)}&sourceId=${sourceId}`;
  if (eventType) url += `&eventType=${encodeURIComponent(eventType)}`;
  return apexGet<SlaExistsResult>(url);
}

/**
 * Create (or replace DRAFT) SLA accounting for a source transaction.
 * Will be rejected with HTTP 409 if a POSTED entry already exists.
 */
export async function createAccounting(payload: SlaCreatePayload): Promise<SlaCreateResult> {
  return apexPost<SlaCreateResult>(`${BASE}/${EP.slaAccountingCreate}`, payload);
}

/**
 * Stamp GL batch / header IDs and lock the SLA header to POSTED.
 */
export async function postToLedger(
  headerId: number,
  glBatchId: number,
  glBatchName: string,
  glHeaderId: number,
  postedBy?: string,
): Promise<SlaPostResult> {
  return apexPost<SlaPostResult>(`${BASE}/${EP.slaAccountingPost}`, {
    headerId,
    glBatchId,
    glBatchName,
    glHeaderId,
    postedBy: postedBy ?? 'SYSTEM',
  });
}

/**
 * Mark an SLA header as ERROR (called when GL write fails).
 */
export async function markError(
  headerId: number,
  errorMessage: string,
  postedBy?: string,
): Promise<{ headerId: number; status: string; message: string }> {
  return apexPost(`${BASE}/${EP.slaAccountingError}`, {
    headerId,
    errorMessage,
    postedBy: postedBy ?? 'SYSTEM',
  });
}

/**
 * Retrieve the most recent SLA header + lines for a source transaction.
 */
export async function getAccounting(
  sourceTable: string,
  sourceId: number,
): Promise<SlaGetResult> {
  const url = `${BASE}/${EP.slaAccounting}?sourceTable=${encodeURIComponent(sourceTable)}&sourceId=${sourceId}`;
  return apexGet<SlaGetResult>(url);
}

/**
 * Fetch SLA lines for a specific header ID via sla/journals/lines.
 * Returns { items: SlaLine[] }.
 */
export async function getLinesByHeaderId(headerId: number): Promise<{ items: SlaLine[] }> {
  const url = `${BASE}/sla/journals/lines?headerId=${headerId}&limit=500`;
  return apexGet<{ items: SlaLine[] }>(url);
}

/**
 * Fetch ALL SLA lines for a source number (e.g. payment number) across all events.
 * Returns { items: any[] } — each item has all SlaLine fields plus headerId, accountingStatus,
 * accountingDate, moduleName, sourceNumber, accountDescription etc from the header JOIN.
 */
export async function getAccountingLinesBySourceNumber(
  sourceNumber: string,
  moduleName?: string,
): Promise<{ items: any[] }> {
  const qs = new URLSearchParams({ sourceNumber, limit: '500' });
  if (moduleName) qs.set('moduleName', moduleName);
  return apexGet<{ items: any[] }>(`${BASE}/sla/journals/lines?${qs}`);
}

/**
 * Fetch ALL SLA lines for a specific sourceId (e.g. checkId) across all events.
 * More precise than getAccountingLinesBySourceNumber — avoids cross-payment leakage.
 */
export async function getAccountingLinesBySourceId(
  sourceId: number,
  sourceTable?: string,
  moduleName?: string,
): Promise<{ items: any[] }> {
  const qs = new URLSearchParams({ sourceId: String(sourceId), limit: '500' });
  if (sourceTable) qs.set('sourceTable', sourceTable);
  if (moduleName)  qs.set('moduleName', moduleName);
  return apexGet<{ items: any[] }>(`${BASE}/sla/journals/lines?${qs}`);
}

// ── GL journal duplicate-check ─────────────────────────────────────────────

export interface GlJournalExistsResult {
  exists:    boolean;
  batchId:   number | null;
  headerId:  number | null;
  status:    string | null;   // 'P' = Posted, 'NEW' = unposted
  period:    string | null;
  lineCount: number;
}

export async function checkGLJournalExists(
  reference1: string,
  reference2: string | number,
  reference5: string,
): Promise<GlJournalExistsResult> {
  const qs  = new URLSearchParams({
    reference1: String(reference1),
    reference2: String(reference2),
    reference5,
  });
  const url = `${BASE}/gl/journals/check?${qs.toString()}`;
  try {
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    return {
      exists:    data.exists    ?? false,
      batchId:   data.batchId   ?? null,
      headerId:  data.headerId  ?? null,
      status:    data.status    ?? null,
      period:    data.period    ?? null,
      lineCount: data.lineCount ?? 0,
    };
  } catch {
    return { exists: false, batchId: null, headerId: null, status: null, period: null, lineCount: 0 };
  }
}

// ── Ledger lookup ──────────────────────────────────────────────────────────

export interface LedgerInfo {
  ledgerId: number;
  ledgerName: string;
  legalEntity?: string;
  currency?: string;
}

/**
 * Fetch the primary ledger for a given business unit.
 * Returns null if the BU is blank or the lookup fails.
 */
export async function fetchLedgerByBusinessUnit(businessUnitName: string): Promise<LedgerInfo | null> {
  if (!businessUnitName) return null;
  try {
    const url = `${BASE}/gl/getledgername?P_BUSINESS_UNIT_NAME=${encodeURIComponent(businessUnitName)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    const item = body?.items?.[0];
    if (!item) return null;
    return { ledgerId: item.ledger_id, ledgerName: item.ledger_name };
  } catch {
    return null;
  }
}

// ── Payload builder for PC Transactions ──────────────────────────────────────

export interface PcTxnSlaOptions {
  transactionId:        number;
  sourceNumber:         string;
  eventTypeCode:        'PC_EXPENSE_CREATED' | 'PC_EXPENSE_REVERSAL' | 'PC_ADJUSTMENT';
  transactionDate:      string;   // YYYY-MM-DD
  accountingDate:       string;   // YYYY-MM-DD
  periodName:           string;
  currency:             string;
  amount:               number;
  drAccountCombination: string;
  crAccountCombination: string;
  drAccountingClass:    string;
  crAccountingClass:    string;
  drDescription?:       string;
  crDescription?:       string;
  businessUnit?:        string;
  legalEntity?:         string;
  ledgerId:             number;
  ledgerName:           string;
  ledgerCurrency?:      string;
  exchangeRate?:        number;
  createdBy?:           string;
}

export function buildPcTxnSlaPayload(opts: PcTxnSlaOptions): SlaCreatePayload {
  const exRate   = opts.exchangeRate ?? 1;
  const currency = opts.currency || 'AED';
  return {
    header: {
      moduleName:       'PC',
      sourceTable:      'PC_TRANSACTIONS',
      sourceId:         opts.transactionId,
      sourceNumber:     opts.sourceNumber,
      sourceType:       'Petty Cash',
      eventTypeCode:    opts.eventTypeCode,
      eventDate:        opts.transactionDate,
      accountingDate:   opts.accountingDate,
      periodName:       opts.periodName,
      ledgerId:         opts.ledgerId,
      ledgerName:       opts.ledgerName,
      currencyCode:     currency,
      ledgerCurrency:   opts.ledgerCurrency ?? currency,
      exchangeRate:     exRate,
      exchangeRateType: 'Corporate',
      businessUnit:     opts.businessUnit,
      legalEntity:      opts.legalEntity,
      description:      `${opts.eventTypeCode} – Transaction ${opts.transactionId}`,
      createdBy:        opts.createdBy ?? 'SYSTEM',
    },
    lines: [
      {
        lineNumber:         1,
        lineType:           'DR',
        accountingClass:    opts.drAccountingClass,
        accountCombination: opts.drAccountCombination,
        enteredDr:          opts.amount,
        enteredCr:          0,
        accountedDr:        opts.amount * exRate,
        accountedCr:        0,
        currencyCode:       currency,
        exchangeRate:       exRate,
        description:        opts.drDescription ?? `Debit – Txn ${opts.transactionId}`,
        sourceLineId:       opts.transactionId,
      },
      {
        lineNumber:         2,
        lineType:           'CR',
        accountingClass:    opts.crAccountingClass,
        accountCombination: opts.crAccountCombination,
        enteredDr:          0,
        enteredCr:          opts.amount,
        accountedDr:        0,
        accountedCr:        opts.amount * exRate,
        currencyCode:       currency,
        exchangeRate:       exRate,
        description:        opts.crDescription ?? `Credit – Txn ${opts.transactionId}`,
        sourceLineId:       opts.transactionId,
      },
    ],
  };
}

// ── Payload builder for PC Bank Transactions ──────────────────────────────────

export interface PcBankTxnSlaOptions {
  externalTransactionId:    number;
  referenceText?:           string;
  transactionDate:          string;
  accountingDate:           string;
  periodName:               string;
  currency:                 string;
  amount:                   number;
  assetAccountCombination:  string;   // bank account (CR)
  offsetAccountCombination: string;   // petty cash account (DR)
  description?:             string;   // from external transaction line
  businessUnit?:            string;
  legalEntity?:             string;
  ledgerId:                 number;
  ledgerName:               string;
  ledgerCurrency?:          string;
  exchangeRate?:            number;
  createdBy?:               string;
}

export function buildPcBankTxnSlaPayload(opts: PcBankTxnSlaOptions): SlaCreatePayload {
  const exRate   = opts.exchangeRate ?? 1;
  const currency = opts.currency || 'AED';
  return {
    header: {
      moduleName:       'PC',
      sourceTable:      'EXTERNAL_CASH_TRANSACTIONS',
      sourceId:         opts.externalTransactionId,
      sourceNumber:     opts.referenceText ?? String(opts.externalTransactionId),
      sourceType:       'Bank Transfer',
      eventTypeCode:    'PC_BALANCE_REFILL',
      eventDate:        opts.transactionDate,
      accountingDate:   opts.accountingDate,
      periodName:       opts.periodName,
      ledgerId:         opts.ledgerId,
      ledgerName:       opts.ledgerName,
      currencyCode:     currency,
      ledgerCurrency:   opts.ledgerCurrency ?? currency,
      exchangeRate:     exRate,
      exchangeRateType: 'Corporate',
      businessUnit:     opts.businessUnit,
      legalEntity:      opts.legalEntity,
      description:      `PC Balance Refill – Ext Txn ${opts.externalTransactionId}`,
      createdBy:        opts.createdBy ?? 'SYSTEM',
    },
    lines: [
      {
        lineNumber:         1,
        lineType:           'DR',
        accountingClass:    'PETTY_CASH',
        accountCombination: opts.offsetAccountCombination,
        enteredDr:          opts.amount,
        enteredCr:          0,
        accountedDr:        opts.amount * exRate,
        accountedCr:        0,
        currencyCode:       currency,
        exchangeRate:       exRate,
        description:        opts.description || `Petty Cash DR – Refill ${opts.externalTransactionId}`,
      },
      {
        lineNumber:         2,
        lineType:           'CR',
        accountingClass:    'BANK_ASSET',
        accountCombination: opts.assetAccountCombination,
        enteredDr:          0,
        enteredCr:          opts.amount,
        accountedDr:        0,
        accountedCr:        opts.amount * exRate,
        currencyCode:       currency,
        exchangeRate:       exRate,
        description:        opts.description || `Bank Asset CR – Refill ${opts.externalTransactionId}`,
      },
    ],
  };
}

export interface BankTransferSlaOptions {
  bankAccountTransferId: number;
  transferNumber:        number | string;
  transactionDate:       string;
  accountingDate:        string;
  periodName:            string;
  currency:              string;
  amount:                number;
  fromAssetAccount:      string;   // CR side — cash leaving the source bank
  toAssetAccount:        string;   // DR side — cash arriving at destination bank
  description?:          string;
  businessUnit?:         string;
  legalEntity?:          string;
  ledgerId:              number;
  ledgerName:            string;
  ledgerCurrency?:       string;
  exchangeRate?:         number;
  createdBy?:            string;
}

export function buildBankTransferSlaPayload(opts: BankTransferSlaOptions): SlaCreatePayload {
  const exRate   = opts.exchangeRate ?? 1;
  const currency = opts.currency || 'AED';
  const desc     = opts.description || `Bank Transfer ${opts.transferNumber}`;
  return {
    header: {
      moduleName:       'CM',
      sourceTable:      'BANK_ACCOUNT_TRANSFERS',
      sourceId:         opts.bankAccountTransferId,
      sourceNumber:     String(opts.transferNumber),
      sourceType:       'Bank Transfer',
      eventTypeCode:    'BANK_TRANSFER',
      eventDate:        opts.transactionDate,
      accountingDate:   opts.accountingDate,
      periodName:       opts.periodName,
      ledgerId:         opts.ledgerId,
      ledgerName:       opts.ledgerName,
      currencyCode:     currency,
      ledgerCurrency:   opts.ledgerCurrency ?? currency,
      exchangeRate:     exRate,
      exchangeRateType: 'Corporate',
      businessUnit:     opts.businessUnit,
      legalEntity:      opts.legalEntity,
      description:      desc,
      createdBy:        opts.createdBy ?? 'SYSTEM',
    },
    lines: [
      {
        lineNumber:         1,
        lineType:           'DR',
        accountingClass:    'BANK_ASSET',
        accountCombination: opts.toAssetAccount,
        enteredDr:          opts.amount,
        enteredCr:          0,
        accountedDr:        opts.amount * exRate,
        accountedCr:        0,
        currencyCode:       currency,
        exchangeRate:       exRate,
        description:        `${desc} – To Bank DR`,
      },
      {
        lineNumber:         2,
        lineType:           'CR',
        accountingClass:    'BANK_ASSET',
        accountCombination: opts.fromAssetAccount,
        enteredDr:          0,
        enteredCr:          opts.amount,
        accountedDr:        0,
        accountedCr:        opts.amount * exRate,
        currencyCode:       currency,
        exchangeRate:       exRate,
        description:        `${desc} – From Bank CR`,
      },
    ],
  };
}

/**
 * Derive GL period name from a date: "Mon-YY" format (e.g. "Mar-26").
 */
export function derivePeriodName(date: Date = new Date()): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
}

export interface ApInvoiceSlaOptions {
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;           // YYYY-MM-DD or raw date string
  invoiceType?: string;
  currencyCode: string;
  invoiceAmount: number;
  businessUnit?: string;
  legalEntity?: string;
  ledgerId?: number;
  ledgerName?: string;
  ledgerCurrency?: string;
  exchangeRate?: number;
  createdBy?: string;
  /** Expense/cost account for the DR side of each line */
  expenseAccount: string;
  /** AP Liability account for the CR side total */
  apLiabilityAccount: string;
  /** Invoice lines for individual DR splits */
  invoiceLines: { lineNumber: number; amount: number; description?: string; accrualAccount?: string; lineId?: number }[];
}

/**
 * Build a well-formed SLA create payload for a standard AP invoice.
 * Pattern: DR Expense (per line) / CR AP Liability (total).
 */
export function buildApInvoiceSlaPayload(opts: ApInvoiceSlaOptions): SlaCreatePayload {
  const today      = new Date();
  const acctDate   = today.toISOString().split('T')[0];
  const periodName = derivePeriodName(today);

  // Parse invoice date to YYYY-MM-DD
  const rawDate    = opts.invoiceDate
    ? new Date(opts.invoiceDate).toISOString().split('T')[0]
    : acctDate;

  const currency   = opts.currencyCode || 'AED';
  const exRate     = opts.exchangeRate  ?? 1;
  const total      = opts.invoiceAmount;

  const slaLines: SlaCreatePayload['lines'] = [];
  let lineNum = 1;

  // DR lines — one per invoice line
  for (const il of opts.invoiceLines) {
    const account = il.accrualAccount || opts.expenseAccount;
    slaLines.push({
      lineNumber:         lineNum++,
      lineType:           'DR',
      accountingClass:    'EXPENSE',
      accountCombination: account,
      enteredDr:          il.amount,
      enteredCr:          0,
      accountedDr:        il.amount * exRate,
      accountedCr:        0,
      currencyCode:       currency,
      exchangeRate:       exRate,
      description:        il.description || `AP Invoice ${opts.invoiceNumber} Line ${il.lineNumber}`,
      sourceLineId:       il.lineId,
      sourceLineNumber:   il.lineNumber,
    });
  }

  // CR line — AP Liability for the total
  slaLines.push({
    lineNumber:         lineNum,
    lineType:           'CR',
    accountingClass:    'LIABILITY',
    accountCombination: opts.apLiabilityAccount,
    enteredDr:          0,
    enteredCr:          total,
    accountedDr:        0,
    accountedCr:        total * exRate,
    currencyCode:       currency,
    exchangeRate:       exRate,
    description:        `AP Liability – Invoice ${opts.invoiceNumber}`,
    sourceLineNumber:   lineNum,
  });

  return {
    header: {
      moduleName:        'AP',
      sourceTable:       'AP_INVOICES',
      sourceId:          opts.invoiceId,
      sourceNumber:      opts.invoiceNumber,
      sourceType:        opts.invoiceType    || 'Standard',
      eventTypeCode:     'AP_INVOICE_CREATION',
      eventDate:         rawDate,
      accountingDate:    acctDate,
      periodName,
      ledgerId:          opts.ledgerId       ?? 300000003259529,
      ledgerName:        opts.ledgerName     ?? 'BCL DIFC',
      currencyCode:      currency,
      ledgerCurrency:    opts.ledgerCurrency ?? 'AED',
      exchangeRate:      exRate,
      exchangeRateType:  'Corporate',
      businessUnit:      opts.businessUnit,
      legalEntity:       opts.legalEntity,
      description:       `AP Invoice ${opts.invoiceNumber} – ${opts.invoiceType || 'Standard'}`,
      createdBy:         opts.createdBy      ?? 'SYSTEM',
    },
    lines: slaLines,
  };
}

// ── Payload builder for AP Payments ───────────────────────────────────────

export interface ApPaymentInvoiceLine {
  invoiceNumber: string;
  invoiceId: number;
  /** Amount paid against this invoice in the invoice currency */
  amountPaid: number;
  /** AP Liability account from the invoice's liability_distribution */
  liabilityDistribution: string;
}

export interface ApPaymentSlaOptions {
  checkId: number;
  paymentNumber: string;
  /** Paper document number (check/EFT doc number) — used as sourceNumber in SLA */
  paperDocumentNumber?: string;
  paymentDate: string;           // YYYY-MM-DD
  currencyCode: string;
  businessUnit?: string;
  legalEntity?: string;
  ledgerId?: number;
  ledgerName?: string;
  ledgerCurrency?: string;
  exchangeRate?: number;
  createdBy?: string;
  /** Cash / PDC account (was Cash Clearing — now uses bank's cash account for regular, PDC account for post-dated) */
  cashClearingAccount: string;
  /** Accounting class for the CR line: 'CASH' (default) or 'PDC' */
  accountingClass?: string;
  /** One entry per applied invoice */
  appliedInvoices: ApPaymentInvoiceLine[];
}

/**
 * Build one SLA payload per applied invoice for a payment.
 * Pattern per invoice: DR AP Liability / CR Cash Clearing.
 */
export function buildApPaymentSlaPayloads(opts: ApPaymentSlaOptions): SlaCreatePayload[] {
  const today      = new Date();
  const acctDate   = opts.paymentDate || today.toISOString().split('T')[0];
  const d          = new Date(acctDate);
  const periodName = derivePeriodName(d);
  const currency   = opts.currencyCode || 'AED';
  const exRate     = opts.exchangeRate  ?? 1;

  const docNum = opts.paperDocumentNumber || opts.paymentNumber;

  return opts.appliedInvoices.map((inv) => {
    const amt = inv.amountPaid;
    return {
      header: {
        moduleName:       'AP',
        sourceTable:      'AP_PAYMENTS',
        sourceId:         opts.checkId,
        sourceNumber:     docNum,
        sourceType:       'PAYMENT',
        eventTypeCode:    'AP_PAYMENT_CREATED',
        eventDate:        acctDate,
        accountingDate:   acctDate,
        periodName,
        ledgerId:         opts.ledgerId   ?? 300000003259529,
        ledgerName:       opts.ledgerName ?? 'BCL DIFC',
        currencyCode:     currency,
        ledgerCurrency:   opts.ledgerCurrency ?? 'AED',
        exchangeRate:     exRate,
        exchangeRateType: 'Corporate',
        businessUnit:     opts.businessUnit,
        legalEntity:      opts.legalEntity,
        description:      `AP Payment ${docNum} – Invoice ${inv.invoiceNumber}`,
        createdBy:        opts.createdBy ?? 'SYSTEM',
      },
      lines: [
        {
          lineNumber:         1,
          lineType:           'DR',
          accountingClass:    'LIABILITY',
          accountCombination: inv.liabilityDistribution,
          enteredDr:          amt,
          enteredCr:          0,
          accountedDr:        amt * exRate,
          accountedCr:        0,
          currencyCode:       currency,
          exchangeRate:       exRate,
          description:        `AP Liability – Payment ${docNum} / Invoice ${inv.invoiceNumber}`,
          sourceLineNumber:   1,
        },
        {
          lineNumber:         2,
          lineType:           'CR',
          accountingClass:    opts.accountingClass ?? 'CASH',
          accountCombination: opts.cashClearingAccount,
          enteredDr:          0,
          enteredCr:          amt,
          accountedDr:        0,
          accountedCr:        amt * exRate,
          currencyCode:       currency,
          exchangeRate:       exRate,
          description:        `Cash Clearing – Payment ${docNum} / Invoice ${inv.invoiceNumber}`,
          sourceLineNumber:   2,
        },
      ],
    };
  });
}
