// Receivables dashboard — every figure is one SELECT through the read gateway (POST ai/executequery), aggregated in
// the database so no list is cut by the gateway's row cap.
//
// Open balance = what the installments (payment schedule) still have due: INSTALLMENT_BALANCE_DUE is reduced by
// receipts applied in this app and synced from Fusion — the invoice header's balance is not reduced by local
// receipts. An invoice without installments uses its header balance. Void invoices are left out.
// Due date = the installment's due date, else the invoice due date, else the transaction date.
// Foreign-currency amounts are converted to AED at the document's own conversion rate.
// Unapplied cash per receipt = amount − applied amounts (latest applications); before any application in the app,
// the receipt's own unapplied amount (as synced). Reversed receipts are left out.
import { poQuery, lit, type Row } from './po.service';

export const FUNCTIONAL_CCY = 'AED';
const APP = 'RECEIVABLES';
const bu = (alias: string, b: string) => (b ? ` AND ${alias}.BUSINESS_UNIT = ${lit(b)}` : '');
const RATE = (ccy: string, rate: string) => `CASE WHEN NVL(${ccy}, '${FUNCTIONAL_CCY}') = '${FUNCTIONAL_CCY}' THEN 1 ELSE NVL(${rate}, 1) END`;

/** One row per open installment (or invoice without installments): customer, due date, balance and its AED value. */
const OPEN_ITEMS = (b: string) => `h AS (
    SELECT CUSTOMER_TRANSACTION_ID, TRANSACTION_NUMBER, TRANSACTION_DATE, DUE_DATE, INVOICE_BALANCE_AMOUNT,
           NVL(BILL_TO_CUSTOMER_NAME, '(no customer)') AS CUSTOMER, BILL_TO_CUSTOMER_NUMBER AS CUSTOMER_NUMBER,
           BUSINESS_UNIT, NVL(INVOICE_CURRENCY_CODE, '${FUNCTIONAL_CCY}') AS CCY, ${RATE('INVOICE_CURRENCY_CODE', 'CONVERSION_RATE')} AS RATE
    FROM RR_AR_INVOICE_HEADERS
    WHERE UPPER(NVL(INVOICE_STATUS, '-')) <> 'VOID'${bu('RR_AR_INVOICE_HEADERS', b)}),
  items AS (
    SELECT h.CUSTOMER_TRANSACTION_ID, h.TRANSACTION_NUMBER, h.TRANSACTION_DATE, h.CUSTOMER, h.CUSTOMER_NUMBER, h.BUSINESS_UNIT,
           h.CCY, h.RATE, NVL(x.INSTALLMENT_DUE_DATE, NVL(h.DUE_DATE, h.TRANSACTION_DATE)) AS DUE_ON, NVL(x.INSTALLMENT_BALANCE_DUE, 0) AS BAL
    FROM h JOIN RR_AR_INVOICE_INSTALLMENTS x ON x.CUSTOMER_TRANSACTION_ID = h.CUSTOMER_TRANSACTION_ID
    UNION ALL
    SELECT h.CUSTOMER_TRANSACTION_ID, h.TRANSACTION_NUMBER, h.TRANSACTION_DATE, h.CUSTOMER, h.CUSTOMER_NUMBER, h.BUSINESS_UNIT,
           h.CCY, h.RATE, NVL(h.DUE_DATE, h.TRANSACTION_DATE), NVL(h.INVOICE_BALANCE_AMOUNT, 0)
    FROM h WHERE NOT EXISTS (SELECT 1 FROM RR_AR_INVOICE_INSTALLMENTS x WHERE x.CUSTOMER_TRANSACTION_ID = h.CUSTOMER_TRANSACTION_ID)),
  open_items AS (
    SELECT i.*, ROUND(i.BAL * i.RATE, 2) AS AED, TRUNC(SYSDATE) - TRUNC(i.DUE_ON) AS LATE FROM items i WHERE i.BAL > 0.005)`;

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
export const agingSql = (b: string) => `WITH ${OPEN_ITEMS(b)}
SELECT ${AGE_CASE} AS BUCKET, ROUND(SUM(AED), 2) AS AED, COUNT(DISTINCT CUSTOMER_TRANSACTION_ID) AS INVOICES,
       COUNT(DISTINCT CUSTOMER) AS CUSTOMERS
FROM open_items GROUP BY ${AGE_CASE}`;

/** Totals over all open items (an invoice can sit in several age buckets through its installments). */
export const totalsSql = (b: string) => `WITH ${OPEN_ITEMS(b)}
SELECT COUNT(DISTINCT CUSTOMER) AS CUSTOMERS, COUNT(DISTINCT CUSTOMER_TRANSACTION_ID) AS INVOICES,
       COUNT(DISTINCT CASE WHEN LATE > 0 THEN CUSTOMER_TRANSACTION_ID END) AS OVERDUE_INVOICES
FROM open_items`;

/** Customers owing the most: open and overdue AED, invoices, oldest days late. */
export const topCustomersSql = (b: string) => `WITH ${OPEN_ITEMS(b)}
SELECT CUSTOMER, MAX(CUSTOMER_NUMBER) AS CUSTOMER_NUMBER, ROUND(SUM(AED), 2) AS AED,
       ROUND(SUM(CASE WHEN LATE > 0 THEN AED ELSE 0 END), 2) AS OVERDUE_AED,
       COUNT(DISTINCT CUSTOMER_TRANSACTION_ID) AS INVOICES, MAX(LATE) AS MAX_LATE
FROM open_items GROUP BY CUSTOMER ORDER BY SUM(AED) DESC FETCH FIRST 8 ROWS ONLY`;

/** Open invoices (one row per invoice), largest overdue first — the drill-down list. */
export const openInvoicesSql = (b: string, filter: 'ALL' | 'OVERDUE' | string = 'ALL') => `WITH ${OPEN_ITEMS(b)}
SELECT CUSTOMER_TRANSACTION_ID, MAX(TRANSACTION_NUMBER) AS TRANSACTION_NUMBER, MAX(CUSTOMER) AS CUSTOMER, MAX(BUSINESS_UNIT) AS BUSINESS_UNIT,
       MAX(CCY) AS CCY, ROUND(SUM(BAL), 2) AS BALANCE, ROUND(SUM(AED), 2) AS AED,
       TO_CHAR(MIN(DUE_ON), 'YYYY-MM-DD') AS DUE_DATE, MAX(LATE) AS LATE, TO_CHAR(MAX(TRANSACTION_DATE), 'YYYY-MM-DD') AS TRANSACTION_DATE
FROM open_items
WHERE 1 = 1${filter === 'OVERDUE' ? ' AND LATE > 0' : filter === 'OVER90' ? ' AND LATE > 90'
  : filter.startsWith('CUST:') ? ` AND CUSTOMER = ${lit(filter.slice(5))}` : filter !== 'ALL' ? ` AND ${AGE_CASE} = ${lit(filter)}` : ''}
GROUP BY CUSTOMER_TRANSACTION_ID
ORDER BY MAX(LATE) DESC, SUM(AED) DESC FETCH FIRST 500 ROWS ONLY`;

const RECEIPTS = (b: string) => `apps AS (
    SELECT STANDARD_RECEIPT_ID, SUM(APPLICATION_AMOUNT) AS APPLIED
    FROM RR_AR_RECEIPT_APPLICATIONS
    WHERE (APPLICATION_STATUS = 'APP' OR UPPER(APPLICATION_STATUS) = 'APPLIED') AND NVL(IS_LATEST_APPLICATION, 'Y') <> 'N'
    GROUP BY STANDARD_RECEIPT_ID),
  rc AS (
    SELECT r.STANDARD_RECEIPT_ID, r.RECEIPT_NUMBER, r.RECEIPT_DATE, NVL(r.CUSTOMER_NAME, '(no customer)') AS CUSTOMER, r.BUSINESS_UNIT,
           NVL(r.CURRENCY, '${FUNCTIONAL_CCY}') AS CCY, r.AMOUNT, ${RATE('r.CURRENCY', 'r.CONVERSION_RATE')} AS RATE, r.ACCOUNTED_AMOUNT,
           GREATEST(0, CASE WHEN NVL(a.APPLIED, 0) > 0 THEN NVL(r.AMOUNT, 0) - a.APPLIED ELSE NVL(r.UNAPPLIED_AMOUNT, NVL(r.AMOUNT, 0)) END) AS UNAPPLIED
    FROM RR_AR_RECEIPTS r LEFT JOIN apps a ON a.STANDARD_RECEIPT_ID = r.STANDARD_RECEIPT_ID
    WHERE UPPER(NVL(r.STATE, '-')) <> 'REVERSED' AND UPPER(NVL(r.STATUS, '-')) <> 'REVERSED' AND r.REVERSAL_DATE IS NULL${bu('r', b)})`;

/** Billed (invoices) and received (receipts) per month — the last 6 months, in AED. */
export const flowSql = (b: string) => `WITH ${RECEIPTS(b)},
  billed AS (
    SELECT TO_CHAR(TRUNC(TRANSACTION_DATE, 'MM'), 'YYYY-MM') AS MON,
           SUM(NVL(ENTERED_AMOUNT, 0) * ${RATE('INVOICE_CURRENCY_CODE', 'CONVERSION_RATE')}) AS AED
    FROM RR_AR_INVOICE_HEADERS
    WHERE UPPER(NVL(INVOICE_STATUS, '-')) <> 'VOID' AND NVL(ENTERED_AMOUNT, 0) > 0
      AND TRANSACTION_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)${bu('RR_AR_INVOICE_HEADERS', b)}
    GROUP BY TO_CHAR(TRUNC(TRANSACTION_DATE, 'MM'), 'YYYY-MM')),
  received AS (
    SELECT TO_CHAR(TRUNC(RECEIPT_DATE, 'MM'), 'YYYY-MM') AS MON, SUM(NVL(ACCOUNTED_AMOUNT, NVL(AMOUNT, 0) * RATE)) AS AED
    FROM rc WHERE RECEIPT_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)
    GROUP BY TO_CHAR(TRUNC(RECEIPT_DATE, 'MM'), 'YYYY-MM'))
SELECT NVL(b.MON, r.MON) AS MON, ROUND(NVL(b.AED, 0), 2) AS BILLED, ROUND(NVL(r.AED, 0), 2) AS RECEIVED
FROM billed b FULL OUTER JOIN received r ON r.MON = b.MON`;

/** Receipts with money not applied to invoices yet. */
export const unappliedSql = (b: string) => `WITH ${RECEIPTS(b)}
SELECT STANDARD_RECEIPT_ID, RECEIPT_NUMBER, CUSTOMER, CCY, ROUND(UNAPPLIED, 2) AS UNAPPLIED, ROUND(UNAPPLIED * RATE, 2) AS AED,
       TO_CHAR(RECEIPT_DATE, 'YYYY-MM-DD') AS RECEIPT_DATE, TRUNC(SYSDATE) - TRUNC(RECEIPT_DATE) AS AGE
FROM rc WHERE UNAPPLIED > 0.005 ORDER BY UNAPPLIED * RATE DESC FETCH FIRST 300 ROWS ONLY`;

/** Things to act on, counted in the database. */
export const attentionSql = (b: string) => `SELECT
  (SELECT COUNT(*) FROM RR_AR_INVOICE_HEADERS h WHERE UPPER(NVL(h.INVOICE_STATUS, '-')) = 'INCOMPLETE'${bu('h', b)}) AS INCOMPLETE,
  (SELECT COUNT(*) FROM RR_AR_INVOICE_INSTALLMENTS x JOIN RR_AR_INVOICE_HEADERS h ON h.CUSTOMER_TRANSACTION_ID = x.CUSTOMER_TRANSACTION_ID
     WHERE NVL(x.DISPUTE_AMOUNT, 0) > 0 AND NVL(x.INSTALLMENT_BALANCE_DUE, 0) > 0.005${bu('h', b)}) AS DISPUTED,
  (SELECT COUNT(*) FROM RR_AR_ADJUSTMENTS a WHERE UPPER(NVL(a.STATUS, '-')) LIKE 'MORE RESEARCH%'${bu('a', b)}) AS ADJ_RESEARCH,
  (SELECT ROUND(SUM(NVL(ENTERED_AMOUNT, 0) * ${RATE('INVOICE_CURRENCY_CODE', 'CONVERSION_RATE')}), 2) FROM RR_AR_INVOICE_HEADERS
     WHERE UPPER(NVL(INVOICE_STATUS, '-')) <> 'VOID' AND NVL(ENTERED_AMOUNT, 0) > 0 AND TRANSACTION_DATE >= TRUNC(SYSDATE) - 90${bu('RR_AR_INVOICE_HEADERS', b)}) AS BILLED_90
FROM DUAL`;

export const businessUnitsSql = `SELECT DISTINCT BUSINESS_UNIT FROM RR_AR_INVOICE_HEADERS WHERE BUSINESS_UNIT IS NOT NULL ORDER BY BUSINESS_UNIT`;

// ── shapes ─────────────────────────────────────────────────────────────────
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface AgeBucket { key: string; label: string; aed: number; invoices: number; customers: number }
export interface CustomerOwing { customer: string; customerNumber: string; aed: number; overdueAed: number; invoices: number; maxLate: number }
export interface MonthFlow { month: string; label: string; billed: number; received: number }
export interface OpenInvoice { id: number; number: string; customer: string; businessUnit: string; ccy: string; balance: number; aed: number; dueDate: string; late: number; date: string }
export interface UnappliedReceipt { id: number; number: string; customer: string; ccy: string; unapplied: number; aed: number; date: string; age: number }

export interface ArData {
  ages: AgeBucket[];
  open: number; overdue: number; invoices: number; overdueInvoices: number; customersOwing: number;
  topCustomers: CustomerOwing[];
  months: MonthFlow[];
  unapplied: UnappliedReceipt[]; unappliedAed: number;
  attention: { incomplete: number; disputed: number; adjResearch: number };
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
    { label: 'Open totals', sql: totalsSql(businessUnit) },
  ];
  const errors: string[] = [];
  const run = (i: number, max = 1000) => poQuery(queries[i].sql, max, APP).catch((e: Error) => { errors.push(`${queries[i].label}: ${e.message}`); return [] as Row[]; });
  const [aging, top, flow, unap, att, tot] = await Promise.all([run(0), run(1), run(2), run(3), run(4), run(5)]);

  const byKey = new Map(aging.map(r => [str(r.BUCKET), r]));
  const ages: AgeBucket[] = AGES.map(a => {
    const r = byKey.get(a.key);
    return { key: a.key, label: a.label, aed: num(r?.AED), invoices: num(r?.INVOICES), customers: num(r?.CUSTOMERS) };
  });
  const open = r2(ages.reduce((t, a) => t + a.aed, 0));
  const overdue = r2(ages.filter(a => a.key !== 'CURRENT').reduce((t, a) => t + a.aed, 0));

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
    unapplied: num(r.UNAPPLIED), aed: num(r.AED), date: str(r.RECEIPT_DATE), age: num(r.AGE),
  }));
  const a = att[0] || {};
  const billed90 = num(a.BILLED_90);
  return {
    ages, open, overdue,
    invoices: num(tot[0]?.INVOICES), overdueInvoices: num(tot[0]?.OVERDUE_INVOICES), customersOwing: num(tot[0]?.CUSTOMERS),
    topCustomers: top.map(r => ({ customer: str(r.CUSTOMER), customerNumber: str(r.CUSTOMER_NUMBER), aed: num(r.AED), overdueAed: num(r.OVERDUE_AED), invoices: num(r.INVOICES), maxLate: num(r.MAX_LATE) })),
    months, unapplied, unappliedAed: r2(unapplied.reduce((t, u) => t + u.aed, 0)),
    attention: { incomplete: num(a.INCOMPLETE), disputed: num(a.DISPUTED), adjResearch: num(a.ADJ_RESEARCH) },
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
    ccy: str(r.CCY), balance: num(r.BALANCE), aed: num(r.AED), dueDate: str(r.DUE_DATE), late: num(r.LATE), date: str(r.TRANSACTION_DATE),
  }));
}

export async function loadReceivablesBusinessUnits(): Promise<string[]> {
  const rows = await poQuery(businessUnitsSql, 500, APP).catch(() => [] as Row[]);
  return rows.map(r => str(r.BUSINESS_UNIT)).filter(Boolean);
}
