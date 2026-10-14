// Payables dashboard — every figure is one SELECT through the read gateway (POST ai/executequery).
//
// Outstanding per invoice uses the same formula as suppliers/balance/outstanding (the supplier balance):
//   invoice amount − (amount paid + discount taken, voided payments excluded) − prepayments applied to it
//   − amounts applied out of it (prepayment invoices); never below 0 except credit memos.
// Foreign-currency invoices are converted to AED at their own conversion rate (the old tile added USD to AED).
// An invoice is due on its first installment's due date, else its terms date, else its invoice date.
import { poQuery, lit, type Row } from './po.service';

export const FUNCTIONAL_CCY = 'AED';
const APP = 'PAYABLES';
const buAnd = (alias: string, bu: string) => (bu ? ` AND ${alias}.BUSINESS_UNIT = ${lit(bu)}` : '');

/** Open invoices (anything with a balance), with their AED value, due date and days past due. */
export const openInvoicesSql = (bu: string) => `WITH pay AS (
    SELECT ri.INVOICE_ID, SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS PAID
    FROM RR_AP_PAYMENTS_RELATED_INVOICES ri JOIN RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
    WHERE NVL(p.PAYMENT_STATUS, 'Active') <> 'Voided' AND NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') <> 'Voided'
    GROUP BY ri.INVOICE_ID),
  prep AS (
    SELECT COALESCE(ap.INVOICE_ID, r.INVOICE_ID) AS INVOICE_ID, SUM(ap.APPLIED_AMOUNT) AS APPLIED
    FROM RR_AP_APPLIED_PREPAYMENTS ap
    LEFT JOIN RR_AP_INVOICES_ALL r ON ap.INVOICE_ID IS NULL AND r.INVOICE_NUMBER = ap.INVOICE_NUMBER
    WHERE NVL(ap.STATUS, 'Applied') <> 'Cancelled' GROUP BY COALESCE(ap.INVOICE_ID, r.INVOICE_ID)),
  prep_out AS (
    SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, r.INVOICE_ID) AS INVOICE_ID, SUM(ap.APPLIED_AMOUNT) AS APPLIED_OUT
    FROM RR_AP_APPLIED_PREPAYMENTS ap
    LEFT JOIN RR_AP_INVOICES_ALL r ON ap.PREPAYMENT_INVOICE_ID IS NULL AND r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
    WHERE NVL(ap.STATUS, 'Applied') <> 'Cancelled' GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, r.INVOICE_ID)),
  due AS (SELECT INVOICE_ID, MIN(DUE_DATE) AS DUE_DATE FROM RR_AP_INVOICE_INSTALLMENTS GROUP BY INVOICE_ID),
  inv AS (
    SELECT i.INVOICE_ID, i.INVOICE_NUMBER, i.SUPPLIER, i.SUPPLIER_NUMBER, NVL(i.INVOICE_CURRENCY, '${FUNCTIONAL_CCY}') AS CCY,
           i.INVOICE_TYPE, i.CONVERSION_RATE, i.INVOICE_DATE, NVL(d.DUE_DATE, NVL(i.TERMS_DATE, i.INVOICE_DATE)) AS DUE_ON,
           i.VALIDATION_STATUS, i.APPROVAL_STATUS, i.ACCOUNTING_STATUS,
           CASE WHEN NVL(i.INVOICE_AMOUNT, 0) < 0
                THEN NVL(i.INVOICE_AMOUNT, 0) - NVL(ps.PAID, 0) - NVL(pr.APPLIED, 0) - NVL(po.APPLIED_OUT, 0)
                ELSE GREATEST(0, NVL(i.INVOICE_AMOUNT, 0) - NVL(ps.PAID, 0) - NVL(pr.APPLIED, 0) - NVL(po.APPLIED_OUT, 0))
           END AS REMAINING
    FROM RR_AP_INVOICES_ALL i
    LEFT JOIN pay ps ON ps.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN prep pr ON pr.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN prep_out po ON po.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN due d ON d.INVOICE_ID = i.INVOICE_ID
    WHERE NVL(i.CANCELED_FLAG, 'N') <> 'Y'${buAnd('i', bu)})
SELECT INVOICE_ID, INVOICE_NUMBER, SUPPLIER, SUPPLIER_NUMBER, CCY, INVOICE_TYPE, CONVERSION_RATE AS RATE,
       ROUND(REMAINING, 2) AS REMAINING,
       ROUND(REMAINING * CASE WHEN CCY = '${FUNCTIONAL_CCY}' THEN 1 ELSE NVL(CONVERSION_RATE, 1) END, 2) AS REMAINING_AED,
       TO_CHAR(INVOICE_DATE, 'YYYY-MM-DD') AS INVOICE_DATE, TO_CHAR(DUE_ON, 'YYYY-MM-DD') AS DUE_DATE,
       TRUNC(SYSDATE) - TRUNC(DUE_ON) AS DAYS_PAST_DUE,
       VALIDATION_STATUS, APPROVAL_STATUS, ACCOUNTING_STATUS
FROM inv WHERE ABS(REMAINING) >= 0.005`;

/** Invoices that need someone to act — counted over every invoice that is not cancelled. */
export const ATTENTION = [
  { key: 'NOT_VALIDATED', label: 'Not validated', hint: 'Run validation before they can be paid or accounted',
    where: `UPPER(NVL(i.VALIDATION_STATUS, 'NEVER VALIDATED')) <> 'VALIDATED'` },
  { key: 'AWAITING_APPROVAL', label: 'Awaiting approval', hint: 'Sent for approval, no decision yet',
    where: `(UPPER(i.APPROVAL_STATUS) LIKE 'PENDING%' OR UPPER(i.APPROVAL_STATUS) IN ('INITIATED', 'REQUIRED'))` },
  { key: 'REJECTED', label: 'Rejected', hint: 'Approver rejected — correct and resend',
    where: `UPPER(i.APPROVAL_STATUS) LIKE 'REJECT%'` },
  { key: 'NOT_ACCOUNTED', label: 'Validated, not accounted', hint: 'Create accounting to post them to the GL',
    where: `UPPER(NVL(i.VALIDATION_STATUS, 'X')) = 'VALIDATED' AND UPPER(NVL(i.ACCOUNTING_STATUS, 'NOT ACCOUNTED')) <> 'ACCOUNTED'` },
] as const;
export type AttentionKey = typeof ATTENTION[number]['key'];

export const attentionCountsSql = (bu: string) => `SELECT ${ATTENTION.map(a => `SUM(CASE WHEN ${a.where} THEN 1 ELSE 0 END) AS ${a.key}`).join(', ')}
FROM RR_AP_INVOICES_ALL i WHERE NVL(i.CANCELED_FLAG, 'N') <> 'Y'${buAnd('i', bu)}`;

export const attentionListSql = (key: AttentionKey, bu: string) => {
  const a = ATTENTION.find(x => x.key === key)!;
  return `SELECT i.INVOICE_ID, i.INVOICE_NUMBER, i.SUPPLIER, i.SUPPLIER_NUMBER, NVL(i.INVOICE_CURRENCY, '${FUNCTIONAL_CCY}') AS CCY,
       i.INVOICE_AMOUNT, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS INVOICE_DATE,
       i.VALIDATION_STATUS, i.APPROVAL_STATUS, i.ACCOUNTING_STATUS
FROM RR_AP_INVOICES_ALL i
WHERE NVL(i.CANCELED_FLAG, 'N') <> 'Y' AND ${a.where}${buAnd('i', bu)}
ORDER BY i.INVOICE_DATE DESC, i.INVOICE_ID DESC`;
};

/** Payments per month, last 6 months (AED; voided excluded; one row per payment). */
export const paymentsByMonthSql = (bu: string) => `SELECT TO_CHAR(MON, 'YYYY-MM') AS MON, COUNT(*) AS N, ROUND(SUM(AED), 2) AS AED
FROM (SELECT p.CHECK_ID, TRUNC(MAX(p.PAYMENT_DATE), 'MM') AS MON,
             MAX(CASE WHEN NVL(p.PAYMENT_CURRENCY, '${FUNCTIONAL_CCY}') = '${FUNCTIONAL_CCY}' THEN p.PAYMENT_AMOUNT
                      ELSE NVL(p.PAYMENT_BASE_AMOUNT, p.PAYMENT_AMOUNT * NVL(p.CONVERSION_RATE, 1)) END) AS AED
      FROM RR_AP_PAYMENTS_ALL p
      WHERE NVL(p.PAYMENT_STATUS, 'X') <> 'Voided' AND p.PAYMENT_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)${buAnd('p', bu)}
      GROUP BY p.CHECK_ID)
GROUP BY MON ORDER BY MON`;

/** Business units that have invoices (the filter matches RR_AP_INVOICES_ALL.BUSINESS_UNIT exactly). */
export const businessUnitsSql = `SELECT BUSINESS_UNIT, COUNT(*) AS N FROM RR_AP_INVOICES_ALL
WHERE BUSINESS_UNIT IS NOT NULL GROUP BY BUSINESS_UNIT ORDER BY BUSINESS_UNIT`;

// ── shapes ───────────────────────────────────────────────────────────────────
export interface OpenInvoice {
  invoiceId: number; invoiceNumber: string; supplier: string; supplierNumber: string; ccy: string; invoiceType: string;
  rate: number | null; remaining: number; remainingAed: number; invoiceDate: string; dueDate: string; daysPastDue: number;
  validationStatus: string; approvalStatus: string; accountingStatus: string;
}
export interface MonthPaid { month: string; count: number; aed: number }
export interface Bucket { key: string; label: string; min: number; max: number; aed: number; count: number }
export interface SupplierBalance { supplierNumber: string; supplier: string; aed: number; overdueAed: number; count: number; oldestDays: number }
export interface PayablesSummary {
  outstandingAed: number; openCount: number; supplierCount: number; creditsAed: number;
  foreign: { ccy: string; amount: number; aed: number }[]; foreignWithoutRate: number;
  overdueAed: number; overdueCount: number; overduePct: number; oldestDays: number;
  due7Aed: number; due7Count: number; due30Aed: number; due30Count: number;
  readyAed: number; readyCount: number;
  buckets: Bucket[]; suppliers: SupplierBalance[];
  months: MonthPaid[]; paidThisMonth: MonthPaid; paidLastMonth: MonthPaid;
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const up = (v: unknown) => String(v ?? '').trim().toUpperCase();

export const toOpenInvoice = (r: Row): OpenInvoice => ({
  invoiceId: num(r.INVOICE_ID), invoiceNumber: String(r.INVOICE_NUMBER ?? ''), supplier: String(r.SUPPLIER ?? r.SUPPLIER_NUMBER ?? ''),
  supplierNumber: String(r.SUPPLIER_NUMBER ?? ''), ccy: String(r.CCY || FUNCTIONAL_CCY), invoiceType: String(r.INVOICE_TYPE ?? ''),
  rate: r.RATE == null || r.RATE === '' ? null : Number(r.RATE), remaining: num(r.REMAINING), remainingAed: num(r.REMAINING_AED),
  invoiceDate: String(r.INVOICE_DATE ?? ''), dueDate: String(r.DUE_DATE ?? ''), daysPastDue: num(r.DAYS_PAST_DUE),
  validationStatus: String(r.VALIDATION_STATUS ?? ''), approvalStatus: String(r.APPROVAL_STATUS ?? ''), accountingStatus: String(r.ACCOUNTING_STATUS ?? ''),
});

export const AGING: Omit<Bucket, 'aed' | 'count'>[] = [
  { key: 'current', label: 'Not yet due', min: -Infinity, max: 0 },
  { key: '1-30', label: '1–30 days', min: 1, max: 30 },
  { key: '31-60', label: '31–60 days', min: 31, max: 60 },
  { key: '61-90', label: '61–90 days', min: 61, max: 90 },
  { key: '90+', label: 'Over 90 days', min: 91, max: Infinity },
];
export const inBucket = (b: Omit<Bucket, 'aed' | 'count'>, i: OpenInvoice) => i.remaining > 0 && i.daysPastDue >= b.min && i.daysPastDue <= b.max;

/** Validated, not awaiting a decision and not rejected — payable now. */
export const isReadyToPay = (i: OpenInvoice) => i.remaining > 0 && up(i.validationStatus) === 'VALIDATED'
  && !/^PENDING|^REJECT/.test(up(i.approvalStatus)) && !['INITIATED', 'REQUIRED'].includes(up(i.approvalStatus));

/** Everything the tiles and charts show, from the open invoices and the monthly payments. */
export function summarize(open: OpenInvoice[], paid: MonthPaid[], today = new Date()): PayablesSummary {
  const owed = open.filter(i => i.remaining > 0);
  const overdue = owed.filter(i => i.daysPastDue > 0);
  const sumAed = (xs: OpenInvoice[]) => r2(xs.reduce((s, i) => s + i.remainingAed, 0));
  const outstandingAed = sumAed(open);
  const owedAed = sumAed(owed);

  const fx = new Map<string, { amount: number; aed: number }>();
  open.filter(i => up(i.ccy) !== FUNCTIONAL_CCY).forEach(i => {
    const f = fx.get(i.ccy) || { amount: 0, aed: 0 };
    fx.set(i.ccy, { amount: r2(f.amount + i.remaining), aed: r2(f.aed + i.remainingAed) });
  });

  const dueWithin = (days: number) => owed.filter(i => i.daysPastDue <= 0 && i.daysPastDue >= -days);
  const ready = open.filter(isReadyToPay);

  const bySupplier = new Map<string, SupplierBalance>();
  open.forEach(i => {
    const k = i.supplierNumber || i.supplier;
    const s = bySupplier.get(k) || { supplierNumber: i.supplierNumber, supplier: i.supplier, aed: 0, overdueAed: 0, count: 0, oldestDays: 0 };
    s.aed = r2(s.aed + i.remainingAed);
    if (i.remaining > 0) s.count += 1;
    if (i.remaining > 0 && i.daysPastDue > 0) { s.overdueAed = r2(s.overdueAed + i.remainingAed); s.oldestDays = Math.max(s.oldestDays, i.daysPastDue); }
    bySupplier.set(k, s);
  });

  // the last 6 months, oldest first; months without payments are 0
  const months: MonthPaid[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(today.getFullYear(), today.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const hit = paid.find(m => m.month === key);
    months.push({ month: key, count: hit?.count ?? 0, aed: hit?.aed ?? 0 });
  }

  return {
    outstandingAed, openCount: owed.length,
    supplierCount: new Set(owed.map(i => i.supplierNumber || i.supplier)).size,
    creditsAed: sumAed(open.filter(i => i.remaining < 0)),
    foreign: [...fx].map(([ccy, v]) => ({ ccy, ...v })).sort((a, b) => b.aed - a.aed),
    foreignWithoutRate: open.filter(i => up(i.ccy) !== FUNCTIONAL_CCY && !(i.rate && i.rate > 0)).length,
    overdueAed: sumAed(overdue), overdueCount: overdue.length,
    overduePct: owedAed > 0 ? Math.round((sumAed(overdue) / owedAed) * 100) : 0,
    oldestDays: overdue.reduce((m, i) => Math.max(m, i.daysPastDue), 0),
    due7Aed: sumAed(dueWithin(7)), due7Count: dueWithin(7).length,
    due30Aed: sumAed(dueWithin(30)), due30Count: dueWithin(30).length,
    readyAed: sumAed(ready), readyCount: ready.length,
    buckets: AGING.map(b => { const xs = owed.filter(i => inBucket(b, i)); return { ...b, aed: sumAed(xs), count: xs.length }; }),
    suppliers: [...bySupplier.values()].filter(s => s.aed > 0).sort((a, b) => b.aed - a.aed),
    months, paidThisMonth: months[5], paidLastMonth: months[4],
  };
}

export interface PayablesData {
  open: OpenInvoice[]; summary: PayablesSummary; attention: Record<AttentionKey, number>;
  asOf: Date; queries: { label: string; sql: string }[]; errors: string[];
}

/** The three reads behind the dashboard; a failing read is reported, the others still show. */
export async function loadPayablesDashboard(bu: string): Promise<PayablesData> {
  const queries = [
    { label: 'Open invoices — outstanding, due dates, aging, suppliers', sql: openInvoicesSql(bu) },
    { label: 'Invoices needing action (counts)', sql: attentionCountsSql(bu) },
    { label: 'Payments per month (last 6 months)', sql: paymentsByMonthSql(bu) },
  ];
  const errors: string[] = [];
  const run = (i: number, max: number) => poQuery(queries[i].sql, max, APP).catch((e: Error) => { errors.push(`${queries[i].label}: ${e.message}`); return [] as Row[]; });
  const [openRows, counts, months] = await Promise.all([run(0, 50000), run(1, 1), run(2, 12)]);
  const open = openRows.map(toOpenInvoice);
  const attention = Object.fromEntries(ATTENTION.map(a => [a.key, num(counts[0]?.[a.key])])) as Record<AttentionKey, number>;
  const paid = months.map(m => ({ month: String(m.MON), count: num(m.N), aed: num(m.AED) }));
  return { open, summary: summarize(open, paid), attention, asOf: new Date(), queries, errors };
}

export async function loadAttentionList(key: AttentionKey, bu: string): Promise<Row[]> {
  return poQuery(attentionListSql(key, bu), 2000, APP);
}

export async function loadPayablesBusinessUnits(): Promise<string[]> {
  const rows = await poQuery(businessUnitsSql, 500, APP);
  return rows.map(r => String(r.BUSINESS_UNIT)).filter(Boolean);
}
