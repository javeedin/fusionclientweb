// Portfolio Management (PMS) — live equity positions through the read gateway (POST {base}/ai/executequery).
// Source: PMS_V_PORTFOLIO_POSTION (open NRE / NRO holdings per company, cost / revalued / market in native, AED, USD),
// PMS_COMPANY (names) and PMS_FAIRVALUE_CHANGE (last RE-CAL revaluation date per company).
// Aggregation happens here, not in SQL: the view is a UNION of grouped queries, so outer aggregates are avoided.
import { poQuery, Row } from './po.service';

export interface PmsPosition {
  company: string; shareType: string; currency: string; symbol: string; symbolName: string; exchange: string;
  qty: number; shPercent: number; originalWac: number; recalRate: number; cmp: number;
  valueAtCmp: number; fxToAed: number | null;
  costAed: number; costUsd: number; marketAed: number; marketUsd: number;
  /* derived, native currency */
  originalValue: number; originalGain: number; originalReturn: number;
  revaluedValue: number; revaluedGain: number; revaluedReturn: number;
  /* revalued cost in AED, using the view's own native→AED conversion */
  revaluedAed: number;
}

export interface PmsData {
  positions: PmsPosition[];
  companyNames: Map<string, string>;
  revaluedDates: Map<string, string>;   // company → YYYY-MM-DD of the last RE-CAL
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (gain: number, base: number) => (base ? (gain / base) * 100 : 0);
const pmsQuery = (sql: string) => poQuery(sql, 1000, 'PMS');

const toPosition = (r: Row): PmsPosition => {
  const qty = num(r.QTY);
  const originalWac = num(r.ORIGINAL_WAG);                 // TO_CHAR in the view → text; bad text counts as 0
  const recalRate = num(r.AVGCOST_PRICE_INCL_RECAL);
  const valueAtCmp = num(r.VALUE_AT_CMP);
  const marketAed = num(r.VALUE_AT_CMP_AED);
  const currency = String(r.CURRENCY ?? '').trim();
  const originalValue = qty * originalWac;
  const revaluedValue = qty * recalRate;
  const revaluedAed = valueAtCmp !== 0 && r.VALUE_AT_CMP_AED != null
    ? revaluedValue * (marketAed / valueAtCmp)
    : currency.toUpperCase() === 'AED' ? revaluedValue : 0;   // never assume a missing FX rate is 1
  return {
    company: String(r.COMPANY_CODE ?? '').trim(), shareType: String(r.SHARE_TYPE ?? ''), currency,
    symbol: String(r.SYMBOL ?? ''), symbolName: String(r.SYMBOL_NAME ?? r.SYMBOL ?? ''), exchange: String(r.EXCHANGE ?? ''),
    qty, shPercent: num(r.SH_PERCENT), originalWac, recalRate, cmp: num(r.CMP), valueAtCmp,
    fxToAed: r.FX_RATE_TO_AED == null ? null : num(r.FX_RATE_TO_AED),
    costAed: num(r.PORTFOLIO_VALUE_AT_COST_AED), costUsd: num(r.PORTFOLIO_VALUE_AT_COST_USD),
    marketAed, marketUsd: num(r.VALUE_AT_CMP_USD),
    originalValue, originalGain: valueAtCmp - originalValue, originalReturn: pct(valueAtCmp - originalValue, originalValue),
    revaluedValue, revaluedGain: valueAtCmp - revaluedValue, revaluedReturn: pct(valueAtCmp - revaluedValue, revaluedValue),
    revaluedAed,
  };
};

export async function loadPortfolio(): Promise<PmsData> {
  const [pos, comps, reval] = await Promise.all([
    pmsQuery(`SELECT COMPANY_CODE, SHARE_TYPE, CURRENCY, SYMBOL_NAME, SYMBOL, EXCHANGE, QTY, SH_PERCENT, ORIGINAL_WAG,
                     AVGCOST_PRICE_INCL_RECAL, CMP, VALUE_AT_CMP, FX_RATE_TO_AED,
                     PORTFOLIO_VALUE_AT_COST_AED, PORTFOLIO_VALUE_AT_COST_USD, VALUE_AT_CMP_AED, VALUE_AT_CMP_USD
              FROM PMS_V_PORTFOLIO_POSTION`),
    pmsQuery('SELECT TRIM(COMPANY_CODE) AS COMPANY_CODE, COMPANY_NAME FROM PMS_COMPANY').catch(() => [] as Row[]),
    pmsQuery(`SELECT TRIM(COMPANY_CODE) AS COMPANY_CODE, TO_CHAR(MAX(TRANSACT_DATE), 'YYYY-MM-DD') AS REVAL_DATE
              FROM PMS_FAIRVALUE_CHANGE WHERE TRANS_TYPE = 'RE-CAL' GROUP BY TRIM(COMPANY_CODE)`).catch(() => [] as Row[]),
  ]);
  return {
    positions: pos.map(toPosition),
    companyNames: new Map(comps.map(c => [String(c.COMPANY_CODE), String(c.COMPANY_NAME ?? c.COMPANY_CODE)])),
    revaluedDates: new Map(reval.filter(r => r.REVAL_DATE).map(r => [String(r.COMPANY_CODE), String(r.REVAL_DATE)])),
  };
}

export interface PmsTotals { cost: number; market: number; gain: number; ret: number; costUsd: number; marketUsd: number; stocks: number; companies: number }
export const totals = (ps: PmsPosition[]): PmsTotals => {
  const cost = ps.reduce((s, p) => s + p.costAed, 0);
  const market = ps.reduce((s, p) => s + p.marketAed, 0);
  return {
    cost, market, gain: market - cost, ret: pct(market - cost, cost),
    costUsd: ps.reduce((s, p) => s + p.costUsd, 0), marketUsd: ps.reduce((s, p) => s + p.marketUsd, 0),
    stocks: new Set(ps.map(p => p.symbol)).size, companies: new Set(ps.map(p => p.company)).size,
  };
};

/** 1.23 K / 4.56 M / 7.89 B — same as the APEX report */
export const fmtShort = (v: number | null | undefined) => {
  const n = Number(v) || 0; const a = Math.abs(n);
  const f = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1e9) return `${f(n / 1e9)} B`;
  if (a >= 1e6) return `${f(n / 1e6)} M`;
  if (a >= 1e3) return `${f(n / 1e3)} K`;
  return f(n);
};
export const fmtPct = (v: number | null | undefined) => {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
};
export const fmtNum = (v: number | null | undefined, dp = 2) =>
  (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const curSym = (c: string) => ({ INR: '₹', USD: '$', AED: 'AED ', EUR: '€', GBP: '£', CHF: 'CHF ' } as Record<string, string>)[c.toUpperCase()] ?? (c ? `${c} ` : '');
export const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu');
