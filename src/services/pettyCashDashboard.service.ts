// Petty cash dashboard — direct SQL through the read gateway (POST ai/executequery), aggregated in the database.
// Active registers only (as the Search tab lists them by default): draft, inactive and closed ones are left out everywhere.
//
// The same figures a register shows in its header, for every active register at once:
//   balance = money in (debits) − money out (credits)   (as GET pc/registers computes it)
//   balance with suspense = balance − suspense amounts   (as the register screen computes it)
//   available to add = limit − balance (registers with a limit)
// plus what is waiting to be posted, money in / out per month and spending by expense type.
import { poQuery, type Row } from './po.service';
import type { PCRegister } from './pc.service';

const APP = 'PETTY_CASH';

/** One row per active register with its totals. */
export const registersSql = `SELECT r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT, NVL(r.CURRENCY, 'AED') AS CURRENCY, r.STATUS, r.OWNED_BY,
       r.CASH_LIMIT, TO_CHAR(r.START_DATE, 'YYYY-MM-DD') AS START_DATE, TO_CHAR(r.END_DATE, 'YYYY-MM-DD') AS END_DATE,
       r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC, r.COMMENTS, r.CREATED_BY, TO_CHAR(r.CREATION_DATE, 'YYYY-MM-DD') AS CREATION_DATE,
       NVL(SUM(t.DEBIT_AMOUNT), 0) AS TOTAL_DEBIT, NVL(SUM(t.CREDIT_AMOUNT), 0) AS TOTAL_CREDIT,
       NVL(SUM(t.SUSPENSE_AMOUNT), 0) AS SUSPENSE,
       COUNT(CASE WHEN t.POSTING_STATUS = 'Unposted' THEN 1 END) AS UNPOSTED,
       NVL(SUM(CASE WHEN t.POSTING_STATUS = 'Unposted' THEN NVL(t.DEBIT_AMOUNT, 0) + NVL(t.CREDIT_AMOUNT, 0) END), 0) AS UNPOSTED_AMOUNT,
       COUNT(CASE WHEN t.POSTING_STATUS = 'Error' THEN 1 END) AS ERRORS,
       NVL(SUM(CASE WHEN t.TRANSACTION_DATE >= TRUNC(SYSDATE, 'MM') THEN t.DEBIT_AMOUNT END), 0) AS IN_MTD,
       NVL(SUM(CASE WHEN t.TRANSACTION_DATE >= TRUNC(SYSDATE, 'MM') THEN t.CREDIT_AMOUNT END), 0) AS OUT_MTD,
       TO_CHAR(MAX(t.TRANSACTION_DATE), 'YYYY-MM-DD') AS LAST_TXN
FROM RR_PC_REGISTERS r
LEFT JOIN RR_PC_TRANSACTIONS t ON t.REGISTER_ID = r.REGISTER_ID
WHERE UPPER(r.STATUS) = 'ACTIVE'
GROUP BY r.REGISTER_ID, r.REGISTER_NAME, r.BUSINESS_UNIT, r.CURRENCY, r.STATUS, r.OWNED_BY, r.CASH_LIMIT, r.START_DATE, r.END_DATE,
         r.CASH_ACCOUNT_CCID, r.CASH_ACCOUNT_DESC, r.COMMENTS, r.CREATED_BY, r.CREATION_DATE
ORDER BY r.REGISTER_NAME`;

/** Money in / out per month, last 6 months, per currency (active registers). */
export const monthsSql = `SELECT TO_CHAR(TRUNC(t.TRANSACTION_DATE, 'MM'), 'YYYY-MM') AS MON, NVL(t.CURRENCY, 'AED') AS CURRENCY,
       SUM(NVL(t.DEBIT_AMOUNT, 0)) AS MONEY_IN, SUM(NVL(t.CREDIT_AMOUNT, 0)) AS MONEY_OUT
FROM RR_PC_TRANSACTIONS t JOIN RR_PC_REGISTERS r ON r.REGISTER_ID = t.REGISTER_ID AND UPPER(r.STATUS) = 'ACTIVE'
WHERE t.TRANSACTION_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)
GROUP BY TO_CHAR(TRUNC(t.TRANSACTION_DATE, 'MM'), 'YYYY-MM'), NVL(t.CURRENCY, 'AED')`;

/** Spending (expenses) by expense type, last 90 days, per currency (active registers). */
export const expenseTypesSql = `SELECT NVL(t.EXPENSE_TYPE, '(no expense type)') AS EXPENSE_TYPE, NVL(t.CURRENCY, 'AED') AS CURRENCY,
       SUM(NVL(t.CREDIT_AMOUNT, 0)) AS AMOUNT, COUNT(*) AS N
FROM RR_PC_TRANSACTIONS t JOIN RR_PC_REGISTERS r ON r.REGISTER_ID = t.REGISTER_ID AND UPPER(r.STATUS) = 'ACTIVE'
WHERE t.TRANSACTION_TYPE = 'Expense' AND t.TRANSACTION_DATE >= TRUNC(SYSDATE) - 90
GROUP BY NVL(t.EXPENSE_TYPE, '(no expense type)'), NVL(t.CURRENCY, 'AED')
ORDER BY AMOUNT DESC FETCH FIRST 40 ROWS ONLY`;

// ── shapes ─────────────────────────────────────────────────────────────────
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface PcRegisterStat {
  register: PCRegister;
  suspense: number;
  balanceWithSuspense: number;
  /** limit − balance; null without a limit */
  available: number | null;
  /** balance as a share of the limit (0–100+); null without a limit */
  usedPct: number | null;
  unposted: number; unpostedAmount: number; errors: number;
  inMtd: number; outMtd: number; lastTxn: string;
}
export interface PcMonth { month: string; label: string; moneyIn: number; moneyOut: number }
export interface PcExpense { type: string; amount: number; n: number }
export interface PcData {
  /** the currency most active registers use — totals and charts are in it */
  currency: string;
  otherCurrencies: string[];
  registers: PcRegisterStat[];
  active: PcRegisterStat[];
  balance: number; balanceWithSuspense: number; suspense: number; limit: number; available: number;
  inMtd: number; outMtd: number; unposted: number; unpostedAmount: number; errors: number;
  months: PcMonth[]; expenses: PcExpense[];
  asOf: Date; queries: { label: string; sql: string }[]; errors_: string[];
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return `${d.toLocaleDateString('en-US', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;
};

export async function loadPettyCashDashboard(): Promise<PcData> {
  const queries = [
    { label: 'Active registers and their totals', sql: registersSql },
    { label: 'Money in and out per month', sql: monthsSql },
    { label: 'Spending by expense type (90 days)', sql: expenseTypesSql },
  ];
  const errors_: string[] = [];
  const run = (i: number) => poQuery(queries[i].sql, 1000, APP).catch((e: Error) => { errors_.push(`${queries[i].label}: ${e.message}`); return [] as Row[]; });
  const [regs, mons, exps] = await Promise.all([run(0), run(1), run(2)]);

  const registers: PcRegisterStat[] = regs.map(r => {
    const totalDebit = num(r.TOTAL_DEBIT), totalCredit = num(r.TOTAL_CREDIT);
    const balance = r2(totalDebit - totalCredit);
    const limit = r.CASH_LIMIT == null || r.CASH_LIMIT === '' ? null : num(r.CASH_LIMIT);
    const suspense = num(r.SUSPENSE);
    const register: PCRegister = {
      registerId: num(r.REGISTER_ID), registerName: str(r.REGISTER_NAME), businessUnit: str(r.BUSINESS_UNIT),
      startDate: r.START_DATE ? str(r.START_DATE) : null, endDate: r.END_DATE ? str(r.END_DATE) : null, comments: r.COMMENTS ? str(r.COMMENTS) : null,
      cashAccountCcid: r.CASH_ACCOUNT_CCID == null ? null : num(r.CASH_ACCOUNT_CCID), cashAccountDesc: r.CASH_ACCOUNT_DESC ? str(r.CASH_ACCOUNT_DESC) : null,
      currency: str(r.CURRENCY) || 'AED', status: str(r.STATUS) as PCRegister['status'], balance, totalDebit, totalCredit,
      ownedBy: r.OWNED_BY ? str(r.OWNED_BY) : null, limit, createdBy: r.CREATED_BY ? str(r.CREATED_BY) : null, creationDate: r.CREATION_DATE ? str(r.CREATION_DATE) : null,
    };
    const hasLimit = limit != null && limit > 0;
    return {
      register, suspense, balanceWithSuspense: r2(balance - suspense),
      available: hasLimit ? r2(Math.max(0, limit! - balance)) : null,
      usedPct: hasLimit ? Math.round((balance / limit!) * 100) : null,
      unposted: num(r.UNPOSTED), unpostedAmount: num(r.UNPOSTED_AMOUNT), errors: num(r.ERRORS),
      inMtd: num(r.IN_MTD), outMtd: num(r.OUT_MTD), lastTxn: str(r.LAST_TXN),
    };
  });

  const activeAll = registers.filter(x => String(x.register.status).toUpperCase() === 'ACTIVE');
  const counts = new Map<string, number>();
  (activeAll.length ? activeAll : registers).forEach(x => counts.set(x.register.currency, (counts.get(x.register.currency) || 0) + 1));
  const currency = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 'AED';
  const otherCurrencies = [...counts.keys()].filter(c => c !== currency);
  const inCcy = (x: PcRegisterStat) => x.register.currency === currency;
  const active = activeAll.filter(inCcy);
  const sum = (xs: PcRegisterStat[], f: (x: PcRegisterStat) => number) => r2(xs.reduce((t, x) => t + f(x), 0));
  const allInCcy = registers.filter(inCcy);

  const today = new Date();
  const months: PcMonth[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(today.getFullYear(), today.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = mons.find(x => str(x.MON) === key && (str(x.CURRENCY) || 'AED') === currency);
    months.push({ month: key, label: monthLabel(key), moneyIn: num(r?.MONEY_IN), moneyOut: num(r?.MONEY_OUT) });
  }

  return {
    currency, otherCurrencies, registers, active,
    balance: sum(active, x => x.register.balance), balanceWithSuspense: sum(active, x => x.balanceWithSuspense), suspense: sum(allInCcy, x => x.suspense),
    limit: sum(active, x => x.register.limit ?? 0), available: sum(active, x => x.available ?? 0),
    inMtd: sum(allInCcy, x => x.inMtd), outMtd: sum(allInCcy, x => x.outMtd),
    unposted: allInCcy.reduce((t, x) => t + x.unposted, 0), unpostedAmount: sum(allInCcy, x => x.unpostedAmount), errors: registers.reduce((t, x) => t + x.errors, 0),
    months,
    expenses: exps.filter(r => (str(r.CURRENCY) || 'AED') === currency).slice(0, 8).map(r => ({ type: str(r.EXPENSE_TYPE), amount: num(r.AMOUNT), n: num(r.N) })),
    asOf: new Date(), queries, errors_,
  };
}
