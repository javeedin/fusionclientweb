// Receivables dashboard — every figure is one SELECT through the read gateway (POST ai/executequery), aggregated in
// the database so no list is cut by the gateway's row cap.
//
// Balance of a transaction, straight from the tables (the same parts as the invoice's Balance Details):
//   original amount − receipts applied − credit memos applied + approved adjustments
// Applications count once: only the latest version of each (Fusion keeps superseded rows with IS_LATEST_APPLICATION = 'N')
// and only applied rows (status APP). They match the invoice by id or by transaction number, as RR_AR_INVOICE_BALANCES does.
// Receivables = invoices, debit memos and chargebacks that are complete — void and incomplete ones and credit memos are left
// out. Due date = the invoice due date, else its first installment's, else the transaction date.
// Unapplied cash per receipt = amount − latest applications, never more than the unapplied amount synced from Fusion.
// Foreign-currency amounts are converted to AED at the document's own conversion rate.
import { poQuery, lit, type Row } from './po.service';

export const FUNCTIONAL_CCY = 'AED';
const APP = 'RECEIVABLES';
const bu = (alias: string, b: string) => (b ? ` AND ${alias}.BUSINESS_UNIT = ${lit(b)}` : '');
const RATE = (ccy: string, rate: string) => `CASE WHEN NVL(${ccy}, '${FUNCTIONAL_CCY}') = '${FUNCTIONAL_CCY}' THEN 1 ELSE NVL(${rate}, 1) END`;
const APPLIED = (a: string) => `(${a}.APPLICATION_STATUS = 'APP' OR UPPER(${a}.APPLICATION_STATUS) = 'APPLIED') AND NVL(${a}.IS_LATEST_APPLICATION, 'Y') <> 'N'`;
/** a complete debit item: not void, not incomplete, not a credit memo */
const RECEIVABLE = (h: string) => `UPPER(NVL(${h}.INVOICE_STATUS, '-')) NOT IN ('VOID', 'INCOMPLETE')
      AND UPPER(NVL(${h}.TRANSACTION_CLASS, 'INV')) NOT IN ('CM', 'CREDIT MEMO')`;

/** One row per receivable with its parts (original, received, credited, adjusted), balance, due date and days late. */
const BALANCES = (b: string) => `h AS (
    SELECT h0.CUSTOMER_TRANSACTION_ID, h0.TRANSACTION_NUMBER, h0.TRANSACTION_DATE, h0.DUE_DATE, NVL(h0.ENTERED_AMOUNT, 0) AS ORIG,
           NVL(h0.BILL_TO_CUSTOMER_NAME, '(no customer)') AS CUSTOMER, h0.BILL_TO_CUSTOMER_NUMBER AS CUSTOMER_NUMBER, h0.BUSINESS_UNIT,
           NVL(h0.INVOICE_CURRENCY_CODE, '${FUNCTIONAL_CCY}') AS CCY, ${RATE('h0.INVOICE_CURRENCY_CODE', 'h0.CONVERSION_RATE')} AS RATE
    FROM RR_AR_INVOICE_HEADERS h0
    WHERE ${RECEIVABLE('h0')}${bu('h0', b)}),
  rcpt AS (
    SELECT h.CUSTOMER_TRANSACTION_ID AS ID, SUM(NVL(a.APPLICATION_AMOUNT, 0)) AS AMT
    FROM h JOIN RR_AR_RECEIPT_APPLICATIONS a
      ON (a.REFERENCE_TRANSACTION_ID = h.CUSTOMER_TRANSACTION_ID OR a.REFERENCE_TRANSACTION_NUMBER = h.TRANSACTION_NUMBER)
    WHERE ${APPLIED('a')}
    GROUP BY h.CUSTOMER_TRANSACTION_ID),
  cm AS (
    SELECT h.CUSTOMER_TRANSACTION_ID AS ID, SUM(NVL(c.APPLICATION_AMOUNT, 0)) AS AMT
    FROM h JOIN RR_AR_CM_APPLICATIONS c
      ON (c.REFERENCE_TRANSACTION_ID = h.CUSTOMER_TRANSACTION_ID OR c.REFERENCE_TRANSACTION_NUMBER = h.TRANSACTION_NUMBER)
    WHERE ${APPLIED('c')}
    GROUP BY h.CUSTOMER_TRANSACTION_ID),
  adj AS (
    SELECT h.CUSTOMER_TRANSACTION_ID AS ID, SUM(NVL(j.ADJUSTMENT_AMOUNT, 0)) AS AMT
    FROM h JOIN RR_AR_ADJUSTMENTS j
      ON (j.CUSTOMER_TRANSACTION_ID = h.CUSTOMER_TRANSACTION_ID OR j.TRANSACTION_NUMBER = h.TRANSACTION_NUMBER)
    WHERE UPPER(NVL(j.STATUS, '-')) = 'APPROVED'
    GROUP BY h.CUSTOMER_TRANSACTION_ID),
  sched AS (
    SELECT CUSTOMER_TRANSACTION_ID AS ID, MIN(INSTALLMENT_DUE_DATE) AS DUE FROM RR_AR_INVOICE_INSTALLMENTS GROUP BY CUSTOMER_TRANSACTION_ID),
  bal AS (
    SELECT h.*, NVL(r.AMT, 0) AS RCPT, NVL(c.AMT, 0) AS CM, NVL(j.AMT, 0) AS ADJ,
           h.ORIG - NVL(r.AMT, 0) - NVL(c.AMT, 0) + NVL(j.AMT, 0) AS BAL,
           COALESCE(h.DUE_DATE, s.DUE, h.TRANSACTION_DATE) AS DUE_ON,
           TRUNC(SYSDATE) - TRUNC(COALESCE(h.DUE_DATE, s.DUE, h.TRANSACTION_DATE)) AS LATE
    FROM h
    LEFT JOIN rcpt r ON r.ID = h.CUSTOMER_TRANSACTION_ID
    LEFT JOIN cm c ON c.ID = h.CUSTOMER_TRANSACTION_ID
    LEFT JOIN adj j ON j.ID = h.CUSTOMER_TRANSACTION_ID
    LEFT JOIN sched s ON s.ID = h.CUSTOMER_TRANSACTION_ID),
  open_items AS (
    SELECT b.*, b.BAL * b.RATE AS AED FROM bal b WHERE b.BAL > 0.005)`;

export const AGES = [
  { key: 'CURRENT', label: 'Not yet due', min: -1e9, max: 0 },
  { key: 'D30', label: '1–30 days', min: 1, max: 30 },
  { key: 'D60', label: '31–60 days', min: 31, max: 60 },
  { key: 'D90', label: '61–90 days', min: 61, max: 90 },
  { key: 'D180', label: '91–180 days', min: 91, max: 180 },
  { key: 'OVER', label: 'Over 180 days', min: 181, max: 1e9 },
] as const;
const AGE_CASE = `CASE WHEN LATE <= 0 THEN 'CURRENT' WHEN LATE <= 30 THEN 'D30' WHEN LATE <= 60 THEN 'D60'
  WHEN LATE <= 90 THEN 'D90' WHEN LATE <= 180 THEN 'D180' ELSE 'OVER' END`;

/** Open balance by age bucket. */
export const agingSql = (b: string) => `WITH ${BALANCES(b)}
SELECT ${AGE_CASE} AS BUCKET, ROUND(SUM(AED), 2) AS AED, COUNT(*) AS INVOICES, COUNT(DISTINCT CUSTOMER) AS CUSTOMERS
FROM open_items GROUP BY ${AGE_CASE}`;

/** Totals, and how the open balance adds up: original − received − credited + adjusted = open. Plus over-applied ones. */
export const totalsSql = (b: string) => `WITH ${BALANCES(b)}
SELECT COUNT(DISTINCT CASE WHEN BAL > 0.005 THEN CUSTOMER END) AS CUSTOMERS,
       COUNT(CASE WHEN BAL > 0.005 THEN 1 END) AS INVOICES,
       COUNT(CASE WHEN BAL > 0.005 AND LATE > 0 THEN 1 END) AS OVERDUE_INVOICES,
       ROUND(SUM(CASE WHEN BAL > 0.005 THEN BAL * RATE ELSE 0 END), 2) AS OPEN_AED,
       ROUND(SUM(CASE WHEN BAL > 0.005 AND LATE > 0 THEN BAL * RATE ELSE 0 END), 2) AS OVERDUE_AED,
       ROUND(SUM(CASE WHEN BAL > 0.005 THEN ORIG * RATE ELSE 0 END), 2) AS ORIG_AED,
       ROUND(SUM(CASE WHEN BAL > 0.005 THEN RCPT * RATE ELSE 0 END), 2) AS RCPT_AED,
       ROUND(SUM(CASE WHEN BAL > 0.005 THEN CM * RATE ELSE 0 END), 2) AS CM_AED,
       ROUND(SUM(CASE WHEN BAL > 0.005 THEN ADJ * RATE ELSE 0 END), 2) AS ADJ_AED,
       COUNT(CASE WHEN BAL < -0.005 THEN 1 END) AS OVER_APPLIED,
       ROUND(SUM(CASE WHEN BAL < -0.005 THEN BAL * RATE ELSE 0 END), 2) AS OVER_APPLIED_AED,
       COUNT(*) AS ALL_INVOICES
FROM bal`;

/** Customers owing the most: open and overdue AED, invoices, oldest days late. */
export const topCustomersSql = (b: string) => `WITH ${BALANCES(b)}
SELECT CUSTOMER, MAX(CUSTOMER_NUMBER) AS CUSTOMER_NUMBER, ROUND(SUM(AED), 2) AS AED,
       ROUND(SUM(CASE WHEN LATE > 0 THEN AED ELSE 0 END), 2) AS OVERDUE_AED,
       COUNT(*) AS INVOICES, MAX(LATE) AS MAX_LATE
FROM open_items GROUP BY CUSTOMER ORDER BY AED DESC FETCH FIRST 8 ROWS ONLY`;

/** Open invoices (one row per invoice) with how each balance adds up, most overdue first — the drill-down list. */
export const openInvoicesSql = (b: string, filter: 'ALL' | 'OVERDUE' | string = 'ALL') => `WITH ${BALANCES(b)}
SELECT CUSTOMER_TRANSACTION_ID, TRANSACTION_NUMBER, CUSTOMER, BUSINESS_UNIT, CCY,
       ROUND(ORIG, 2) AS ORIGINAL, ROUND(RCPT, 2) AS RECEIVED, ROUND(CM, 2) AS CREDITED, ROUND(ADJ, 2) AS ADJUSTED,
       ROUND(BAL, 2) AS BALANCE, ROUND(BAL * RATE, 2) AS AED,
       TO_CHAR(DUE_ON, 'YYYY-MM-DD') AS DUE_DATE, LATE, TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD') AS TRANSACTION_DATE
FROM bal
WHERE ${filter === 'OVERAPPLIED' ? 'BAL < -0.005' : 'BAL > 0.005'}${filter === 'OVERDUE' ? ' AND LATE > 0' : filter === 'OVER90' ? ' AND LATE > 90'
  : filter.startsWith('CUST:') ? ` AND CUSTOMER = ${lit(filter.slice(5))}` : filter !== 'ALL' && filter !== 'OVERAPPLIED' ? ` AND ${AGE_CASE} = ${lit(filter)}` : ''}
ORDER BY LATE DESC, AED DESC FETCH FIRST 500 ROWS ONLY`;

const RECEIPTS = (b: string) => `apps AS (
    SELECT a.STANDARD_RECEIPT_ID, SUM(NVL(a.APPLICATION_AMOUNT, 0)) AS APPLIED
    FROM RR_AR_RECEIPT_APPLICATIONS a
    WHERE ${APPLIED('a')}
    GROUP BY a.STANDARD_RECEIPT_ID),
  rc AS (
    SELECT r.STANDARD_RECEIPT_ID, r.RECEIPT_NUMBER, r.RECEIPT_DATE, NVL(r.CUSTOMER_NAME, '(no customer)') AS CUSTOMER, r.BUSINESS_UNIT,
           NVL(r.CURRENCY, '${FUNCTIONAL_CCY}') AS CCY, NVL(r.AMOUNT, 0) AS AMOUNT, ${RATE('r.CURRENCY', 'r.CONVERSION_RATE')} AS RATE,
           GREATEST(0, LEAST(NVL(r.AMOUNT, 0) - NVL(a.APPLIED, 0), NVL(r.UNAPPLIED_AMOUNT, NVL(r.AMOUNT, 0)))) AS UNAPPLIED
    FROM RR_AR_RECEIPTS r LEFT JOIN apps a ON a.STANDARD_RECEIPT_ID = r.STANDARD_RECEIPT_ID
    WHERE UPPER(NVL(r.STATE, '-')) <> 'REVERSED' AND UPPER(NVL(r.STATUS, '-')) <> 'REVERSED' AND r.REVERSAL_DATE IS NULL${bu('r', b)})`;

/** Billed (receivables) and received (receipt amounts) per month — the last 6 months, in AED. */
export const flowSql = (b: string) => `WITH ${RECEIPTS(b)},
  billed AS (
    SELECT TO_CHAR(TRUNC(h0.TRANSACTION_DATE, 'MM'), 'YYYY-MM') AS MON,
           SUM(NVL(h0.ENTERED_AMOUNT, 0) * ${RATE('h0.INVOICE_CURRENCY_CODE', 'h0.CONVERSION_RATE')}) AS AED
    FROM RR_AR_INVOICE_HEADERS h0
    WHERE ${RECEIVABLE('h0')} AND h0.TRANSACTION_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)${bu('h0', b)}
    GROUP BY TO_CHAR(TRUNC(h0.TRANSACTION_DATE, 'MM'), 'YYYY-MM')),
  received AS (
    SELECT TO_CHAR(TRUNC(RECEIPT_DATE, 'MM'), 'YYYY-MM') AS MON, SUM(AMOUNT * RATE) AS AED
    FROM rc WHERE RECEIPT_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)
    GROUP BY TO_CHAR(TRUNC(RECEIPT_DATE, 'MM'), 'YYYY-MM'))
SELECT NVL(b.MON, r.MON) AS MON, ROUND(NVL(b.AED, 0), 2) AS BILLED, ROUND(NVL(r.AED, 0), 2) AS RECEIVED
FROM billed b FULL OUTER JOIN received r ON r.MON = b.MON`;

/** Unapplied cash in total (every receipt, not just the listed ones). */
export const unappliedTotalSql = (b: string) => `WITH ${RECEIPTS(b)}
SELECT COUNT(*) AS RECEIPTS, ROUND(SUM(UNAPPLIED * RATE), 2) AS AED FROM rc WHERE UNAPPLIED > 0.005`;

/** Receipts with money not applied to invoices yet (the 300 largest). */
export const unappliedSql = (b: string) => `WITH ${RECEIPTS(b)}
SELECT STANDARD_RECEIPT_ID, RECEIPT_NUMBER, CUSTOMER, CCY, ROUND(AMOUNT, 2) AS AMOUNT, ROUND(UNAPPLIED, 2) AS UNAPPLIED,
       ROUND(UNAPPLIED * RATE, 2) AS AED, TO_CHAR(RECEIPT_DATE, 'YYYY-MM-DD') AS RECEIPT_DATE, TRUNC(SYSDATE) - TRUNC(RECEIPT_DATE) AS AGE
FROM rc WHERE UNAPPLIED > 0.005 ORDER BY AED DESC FETCH FIRST 300 ROWS ONLY`;

/** Things to act on, counted in the database. */
export const attentionSql = (b: string) => `SELECT
  (SELECT COUNT(*) FROM RR_AR_INVOICE_HEADERS h WHERE UPPER(NVL(h.INVOICE_STATUS, '-')) = 'INCOMPLETE'${bu('h', b)}) AS INCOMPLETE,
  (SELECT ROUND(SUM(NVL(h.ENTERED_AMOUNT, 0) * ${RATE('h.INVOICE_CURRENCY_CODE', 'h.CONVERSION_RATE')}), 2) FROM RR_AR_INVOICE_HEADERS h
     WHERE UPPER(NVL(h.INVOICE_STATUS, '-')) = 'INCOMPLETE'${bu('h', b)}) AS INCOMPLETE_AED,
  (SELECT COUNT(DISTINCT x.CUSTOMER_TRANSACTION_ID) FROM RR_AR_INVOICE_INSTALLMENTS x JOIN RR_AR_INVOICE_HEADERS h ON h.CUSTOMER_TRANSACTION_ID = x.CUSTOMER_TRANSACTION_ID
     WHERE NVL(x.DISPUTE_AMOUNT, 0) > 0 AND ${RECEIVABLE('h')}${bu('h', b)}) AS DISPUTED,
  (SELECT COUNT(*) FROM RR_AR_ADJUSTMENTS a WHERE UPPER(NVL(a.STATUS, '-')) LIKE 'MORE RESEARCH%'${bu('a', b)}) AS ADJ_RESEARCH,
  (SELECT ROUND(SUM(NVL(h.ENTERED_AMOUNT, 0) * ${RATE('h.INVOICE_CURRENCY_CODE', 'h.CONVERSION_RATE')}), 2) FROM RR_AR_INVOICE_HEADERS h
     WHERE ${RECEIVABLE('h')} AND h.TRANSACTION_DATE >= TRUNC(SYSDATE) - 90${bu('h', b)}) AS BILLED_90
FROM DUAL`;

export const businessUnitsSql = `SELECT DISTINCT BUSINESS_UNIT FROM RR_AR_INVOICE_HEADERS WHERE BUSINESS_UNIT IS NOT NULL ORDER BY BUSINESS_UNIT`;

// ── shapes ─────────────────────────────────────────────────────────────────
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface AgeBucket { key: string; label: string; aed: number; invoices: number; customers: number }
export interface CustomerOwing { customer: string; customerNumber: string; aed: number; overdueAed: number; invoices: number; maxLate: number }
export interface MonthFlow { month: string; label: string; billed: number; received: number }
export interface OpenInvoice {
  id: number; number: string; customer: string; businessUnit: string; ccy: string;
  original: number; received: number; credited: number; adjusted: number; balance: number; aed: number; dueDate: string; late: number; date: string;
}
export interface UnappliedReceipt { id: number; number: string; customer: string; ccy: string; amount: number; unapplied: number; aed: number; date: string; age: number }

export interface ArData {
  ages: AgeBucket[];
  open: number; overdue: number; invoices: number; overdueInvoices: number; customersOwing: number;
  topCustomers: CustomerOwing[];
  months: MonthFlow[];
  /** how the open balance adds up (AED): original − received − credited + adjusted = open */
  parts: { original: number; received: number; credited: number; adjusted: number } | null;
  /** receivables with more applied than billed (negative balance) — a data problem to look at */
  overApplied: number; overAppliedAed: number;
  /** the largest 300 receipts with unapplied money; the count and total cover every receipt */
  unapplied: UnappliedReceipt[]; unappliedCount: number; unappliedAed: number;
  attention: { incomplete: number; incompleteAed: number; disputed: number; adjResearch: number };
  /** days of sales outstanding: open ÷ billed in the last 90 days × 90 (null when nothing was billed) */
  dso: number | null;
  receivedThisMonth: number;
  asOf: Date; queries: { label: string; sql: string }[]; errors: string[];
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);   // "Sep-26", as GL periods are named
  return `${d.toLocaleDateString('en-US', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;
};

export async function loadReceivablesDashboard(businessUnit: string): Promise<ArData> {
  const queries = [
    { label: 'Open balance by age', sql: agingSql(businessUnit) },
    { label: 'Customers owing the most', sql: topCustomersSql(businessUnit) },
    { label: 'Billed and received per month', sql: flowSql(businessUnit) },
    { label: 'Receipts not fully applied', sql: unappliedSql(businessUnit) },
    { label: 'Needs attention', sql: attentionSql(businessUnit) },
    { label: 'Open totals and how they add up', sql: totalsSql(businessUnit) },
    { label: 'Unapplied cash in total', sql: unappliedTotalSql(businessUnit) },
  ];
  const errors: string[] = [];
  const run = (i: number, max = 1000) => poQuery(queries[i].sql, max, APP).catch((e: Error) => { errors.push(`${queries[i].label}: ${e.message}`); return [] as Row[]; });
  const [aging, top, flow, unap, att, tot, unapTot] = await Promise.all([run(0), run(1), run(2), run(3), run(4), run(5), run(6)]);

  const byKey = new Map(aging.map(r => [str(r.BUCKET), r]));
  const ages: AgeBucket[] = AGES.map(a => {
    const r = byKey.get(a.key);
    return { key: a.key, label: a.label, aed: num(r?.AED), invoices: num(r?.INVOICES), customers: num(r?.CUSTOMERS) };
  });
  const t = tot[0];
  const open = t ? num(t.OPEN_AED) : r2(ages.reduce((s, a) => s + a.aed, 0));
  const overdue = t ? num(t.OVERDUE_AED) : r2(ages.filter(a => a.key !== 'CURRENT').reduce((s, a) => s + a.aed, 0));

  const today = new Date();
  const months: MonthFlow[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(today.getFullYear(), today.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = flow.find(x => str(x.MON) === key);
    months.push({ month: key, label: monthLabel(key), billed: num(r?.BILLED), received: num(r?.RECEIVED) });
  }
  const unapplied: UnappliedReceipt[] = unap.map(r => ({
    id: num(r.STANDARD_RECEIPT_ID), number: str(r.RECEIPT_NUMBER), customer: str(r.CUSTOMER), ccy: str(r.CCY),
    amount: num(r.AMOUNT), unapplied: num(r.UNAPPLIED), aed: num(r.AED), date: str(r.RECEIPT_DATE), age: num(r.AGE),
  }));
  const a = att[0] || {};
  const billed90 = num(a.BILLED_90);
  return {
    ages, open, overdue,
    invoices: num(t?.INVOICES), overdueInvoices: num(t?.OVERDUE_INVOICES), customersOwing: num(t?.CUSTOMERS),
    parts: t ? { original: num(t.ORIG_AED), received: num(t.RCPT_AED), credited: num(t.CM_AED), adjusted: num(t.ADJ_AED) } : null,
    overApplied: num(t?.OVER_APPLIED), overAppliedAed: num(t?.OVER_APPLIED_AED),
    topCustomers: top.map(r => ({ customer: str(r.CUSTOMER), customerNumber: str(r.CUSTOMER_NUMBER), aed: num(r.AED), overdueAed: num(r.OVERDUE_AED), invoices: num(r.INVOICES), maxLate: num(r.MAX_LATE) })),
    months, unapplied,
    unappliedCount: unapTot[0] ? num(unapTot[0].RECEIPTS) : unapplied.length,
    unappliedAed: unapTot[0] ? num(unapTot[0].AED) : r2(unapplied.reduce((s, u) => s + u.aed, 0)),
    attention: { incomplete: num(a.INCOMPLETE), incompleteAed: num(a.INCOMPLETE_AED), disputed: num(a.DISPUTED), adjResearch: num(a.ADJ_RESEARCH) },
    dso: billed90 > 0 ? Math.round((open / billed90) * 90) : null,
    receivedThisMonth: months[months.length - 1]?.received ?? 0,
    asOf: new Date(), queries, errors,
  };
}

/** The open invoices behind a tile / bucket / customer (500 at most, most overdue first). */
export async function loadOpenInvoices(businessUnit: string, filter: 'ALL' | 'OVERDUE' | string = 'ALL'): Promise<OpenInvoice[]> {
  const rows = await poQuery(openInvoicesSql(businessUnit, filter), 500, APP);
  return rows.map(r => ({
    id: num(r.CUSTOMER_TRANSACTION_ID), number: str(r.TRANSACTION_NUMBER), customer: str(r.CUSTOMER), businessUnit: str(r.BUSINESS_UNIT),
    ccy: str(r.CCY), original: num(r.ORIGINAL), received: num(r.RECEIVED), credited: num(r.CREDITED), adjusted: num(r.ADJUSTED),
    balance: num(r.BALANCE), aed: num(r.AED), dueDate: str(r.DUE_DATE), late: num(r.LATE), date: str(r.TRANSACTION_DATE),
  }));
}

export async function loadReceivablesBusinessUnits(): Promise<string[]> {
  const rows = await poQuery(businessUnitsSql, 500, APP).catch(() => [] as Row[]);
  return rows.map(r => str(r.BUSINESS_UNIT)).filter(Boolean);
}
