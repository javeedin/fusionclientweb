// Venture Capital (PMS) — trust-fund commitments, paid-in capital and deployment, read through
// POST {base}/ai/executequery. Port of the APEX VC dashboard (P309): per company and trust fund
//   opportunities  = VCAP_INVESTMENT_OPPORTUNITY (count, SUM(CAPITAL_COMMITMENT_AMOUNT))
//   paid           = VCAP_PAYMENT (STATUS = COMPLETED) → DRAWDOWN_NOTICE → STANDING_INSTRUCTION → OPPORTUNITY
//   AED / USD      = amount / BMSEXERATE rate (TARGET_CUR = fund currency)
//   deployment %   = paid / committed
// Value at cost = value at CMP = paid (no market price for unlisted investments), as in the APEX page.
// Small GROUP BY queries, combined here (no WITH / nested aggregates through the gateway).
import { poQuery, Row } from './po.service';

const q = (sql: string) => poQuery(sql, 1000, 'PMS-VC');
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface VcOpportunity {
  id: number; code: string; company: string; fundId: number | null; route: string; investee: string;
  stage: string; status: string; approval: string; currency: string; committed: number; paid: number; payments: number;
  lastPayment: string | null; initiated: string | null;
}
export interface VcFundRow {
  company: string; fundId: number; fundCode: string; fundName: string; currency: string;
  opportunities: number; committed: number; paid: number;
  aedRate: number | null; usdRate: number | null;
  costAed: number | null; costUsd: number | null; deployment: number;
  lastPayment: string | null;
}
export interface VcData {
  funds: VcFundRow[];                 // one row per company × trust fund (as the APEX report)
  opportunities: VcOpportunity[];     // all opportunities (drill-down)
  companyNames: Map<string, string>;
}

export async function loadVentureCapital(): Promise<VcData> {
  const [opp, paidByFund, paidByOpp, funds, rates, comps, opps] = await Promise.all([
    q(`SELECT TRIM(COMPANY_CODE) AS CC, TRUST_FUND_ID, COUNT(DISTINCT OPPORTUNITY_ID) AS OPP_CNT,
              NVL(SUM(CAPITAL_COMMITMENT_AMOUNT), 0) AS COMMITTED
       FROM VCAP_INVESTMENT_OPPORTUNITY
       WHERE TRUST_FUND_ID IS NOT NULL
       GROUP BY TRIM(COMPANY_CODE), TRUST_FUND_ID`),
    q(`SELECT TRIM(O.COMPANY_CODE) AS CC, O.TRUST_FUND_ID, NVL(SUM(P.AMOUNT), 0) AS PAID,
              TO_CHAR(MAX(P.PAYMENT_DATE), 'YYYY-MM-DD') AS LAST_PAY
       FROM VCAP_PAYMENT P
       JOIN VCAP_DRAWDOWN_NOTICE D        ON D.DRAWDOWN_ID = P.DRAWDOWN_ID
       JOIN VCAP_STANDING_INSTRUCTION S   ON S.VC_ORDER_ID = D.VC_ORDER_ID
       JOIN VCAP_INVESTMENT_OPPORTUNITY O ON O.OPPORTUNITY_ID = S.OPPORTUNITY_ID
       WHERE P.STATUS = 'COMPLETED' AND O.TRUST_FUND_ID IS NOT NULL
       GROUP BY TRIM(O.COMPANY_CODE), O.TRUST_FUND_ID`),
    q(`SELECT S.OPPORTUNITY_ID, NVL(SUM(P.AMOUNT), 0) AS PAID, COUNT(*) AS N,
              TO_CHAR(MAX(P.PAYMENT_DATE), 'YYYY-MM-DD') AS LAST_PAY
       FROM VCAP_PAYMENT P
       JOIN VCAP_DRAWDOWN_NOTICE D      ON D.DRAWDOWN_ID = P.DRAWDOWN_ID
       JOIN VCAP_STANDING_INSTRUCTION S ON S.VC_ORDER_ID = D.VC_ORDER_ID
       WHERE P.STATUS = 'COMPLETED'
       GROUP BY S.OPPORTUNITY_ID`),
    q('SELECT TRUST_FUND_ID, TRUST_FUND_CODE, TRUST_FUND_NAME, CURRENCY_CODE FROM VCAP_TRUST_FUND_MASTER'),
    q(`SELECT TARGET_CUR, MAX(CASE WHEN SOURCE_CUR = 'AED' THEN RATE END) AS AED_RATE,
              MAX(CASE WHEN SOURCE_CUR = 'USD' THEN RATE END) AS USD_RATE
       FROM BMSEXERATE GROUP BY TARGET_CUR`),
    q('SELECT TRIM(COMPANY_CODE) AS COMPANY_CODE, COMPANY_NAME FROM PMS_COMPANY').catch(() => [] as Row[]),
    q(`SELECT OPPORTUNITY_ID, OPPORTUNITY_CODE, TRIM(COMPANY_CODE) AS CC, TRUST_FUND_ID, INVESTMENT_ROUTE, COMPANY_NAME,
              INVESTMENT_STAGE, STATUS, APPROVAL_STATUS, CURRENCY_CODE, CAPITAL_COMMITMENT_AMOUNT,
              TO_CHAR(INITIATION_DATE, 'YYYY-MM-DD') AS INIT_DATE
       FROM VCAP_INVESTMENT_OPPORTUNITY`),
  ]);

  const fundMap = new Map(funds.map(f => [num(f.TRUST_FUND_ID), f]));
  const rateMap = new Map(rates.map(r => [String(r.TARGET_CUR ?? ''), r]));
  const key = (cc: unknown, fid: unknown) => `${String(cc ?? '')}|${num(fid)}`;
  const paidMap = new Map(paidByFund.map(p => [key(p.CC, p.TRUST_FUND_ID), p]));
  const keys = new Set([...opp.map(o => key(o.CC, o.TRUST_FUND_ID)), ...paidByFund.map(p => key(p.CC, p.TRUST_FUND_ID))]);
  const oppMap = new Map(opp.map(o => [key(o.CC, o.TRUST_FUND_ID), o]));

  const rows: VcFundRow[] = [...keys].map(k => {
    const [company, fid] = k.split('|');
    const f = fundMap.get(Number(fid));
    const o = oppMap.get(k);
    const p = paidMap.get(k);
    const currency = String(f?.CURRENCY_CODE ?? '');
    const r = rateMap.get(currency);
    const aedRate = r?.AED_RATE == null ? null : num(r.AED_RATE);
    const usdRate = r?.USD_RATE == null ? null : num(r.USD_RATE);
    const committed = num(o?.COMMITTED);
    const paid = num(p?.PAID);
    return {
      company, fundId: Number(fid), fundCode: String(f?.TRUST_FUND_CODE ?? ''), fundName: String(f?.TRUST_FUND_NAME ?? `Fund ${fid}`), currency,
      opportunities: num(o?.OPP_CNT), committed, paid, aedRate, usdRate,
      costAed: aedRate ? paid / aedRate : null,          // NULLIF(rate,0): no rate → no AED figure
      costUsd: usdRate ? paid / usdRate : null,
      deployment: committed ? (paid / committed) * 100 : 0,
      lastPayment: p?.LAST_PAY ? String(p.LAST_PAY) : null,
    };
  }).filter(r => fundMap.has(r.fundId))                   // inner join to the fund master, as in APEX
    .sort((a, b) => a.fundName.localeCompare(b.fundName));

  const paidOpp = new Map(paidByOpp.map(p => [num(p.OPPORTUNITY_ID), p]));
  return {
    funds: rows,
    opportunities: opps.map(o => {
      const p = paidOpp.get(num(o.OPPORTUNITY_ID));
      return {
        id: num(o.OPPORTUNITY_ID), code: String(o.OPPORTUNITY_CODE ?? ''), company: String(o.CC ?? ''),
        fundId: o.TRUST_FUND_ID == null ? null : num(o.TRUST_FUND_ID), route: String(o.INVESTMENT_ROUTE ?? ''),
        investee: String(o.COMPANY_NAME ?? ''), stage: String(o.INVESTMENT_STAGE ?? ''), status: String(o.STATUS ?? ''),
        approval: String(o.APPROVAL_STATUS ?? ''), currency: String(o.CURRENCY_CODE ?? ''),
        committed: num(o.CAPITAL_COMMITMENT_AMOUNT), paid: num(p?.PAID), payments: num(p?.N),
        lastPayment: p?.LAST_PAY ? String(p.LAST_PAY) : null, initiated: o.INIT_DATE ? String(o.INIT_DATE) : null,
      };
    }),
    companyNames: new Map(comps.map(c => [String(c.COMPANY_CODE), String(c.COMPANY_NAME ?? c.COMPANY_CODE)])),
  };
}

/** APEX formats: millions ("12.34 M"); INR in crores ("1.23 Cr") */
export const fmtM = (v: number | null | undefined) => (v == null ? '-' : `${(v / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`);
export const fmtOrig = (v: number | null | undefined, cur: string) => (v == null ? '-'
  : cur.toUpperCase() === 'INR' ? `${(v / 1e7).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr` : fmtM(v));
export const fmtAmt = (v: number | null | undefined) => (v == null ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
