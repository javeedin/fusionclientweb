// Fixed Assets dashboard — every figure is one SELECT through the read gateway (POST ai/executequery), aggregated in
// the database so no list is cut by the gateway's row cap.
//
// The FA tables come from the Fusion sync and keep numbers and dates as text: every value is converted defensively
// (N = number, D = date as 'YYYY-MM-DD…' or the session date format).
// An asset's book row = its active RR_FA_BOOKS row (DATE_INEFFECTIVE empty), else its latest one.
// Accumulated depreciation = DEPRN_RESERVE of its latest RR_FA_DEPRN_SUMMARY period; NBV = cost − that reserve.
// Retired = RETIRED_FLAG 'YES' or the book row made ineffective. Fully reserved = reserve ≥ cost − salvage value.
// Depreciation is run per book and period ('Mon-YY'); ACCOUNTED_STATUS 'ACCOUNTED' = its journal was created.
import { poQuery, lit, type Row } from './po.service';

export const FA_CCY = 'AED';
const APP = 'FIXED_ASSETS';
const N = (c: string) => `TO_NUMBER(TO_CHAR(${c}) DEFAULT NULL ON CONVERSION ERROR)`;
const D = (c: string) => `COALESCE(TO_DATE(SUBSTR(TO_CHAR(${c}), 1, 10) DEFAULT NULL ON CONVERSION ERROR, 'YYYY-MM-DD'),
  TO_DATE(TO_CHAR(${c}) DEFAULT NULL ON CONVERSION ERROR))`;

/** One row per asset: category, cost, salvage, reserve, NBV, retired, in service since, accounted. */
const ASSETS = `bk AS (
    SELECT TO_CHAR(b0.ASSET_ID) AS ASSET_ID, b0.BOOK_TYPE_CODE, ${N('b0.COST')} AS COST, ${N('b0.SALVAGE_VALUE')} AS SALVAGE,
           b0.DATE_INEFFECTIVE, ${D('b0.DATE_PLACED_IN_SERVICE')} AS DPIS,
           ROW_NUMBER() OVER (PARTITION BY TO_CHAR(b0.ASSET_ID)
             ORDER BY CASE WHEN b0.DATE_INEFFECTIVE IS NULL THEN 1 ELSE 2 END, TO_CHAR(b0.DATE_INEFFECTIVE) DESC) AS RN
    FROM RR_FA_BOOKS b0),
  rsv AS (
    SELECT ASSET_ID, BOOK_TYPE_CODE, RESERVE, LAST_PERIOD FROM (
      SELECT TO_CHAR(s.ASSET_ID) AS ASSET_ID, s.BOOK_TYPE_CODE, ${N('s.DEPRN_RESERVE')} AS RESERVE, s.PERIOD_NAME AS LAST_PERIOD,
             ROW_NUMBER() OVER (PARTITION BY TO_CHAR(s.ASSET_ID), s.BOOK_TYPE_CODE ORDER BY ${N('s.PERIOD_COUNTER')} DESC NULLS LAST) AS RN
      FROM RR_FA_DEPRN_SUMMARY s) WHERE RN = 1),
  assets AS (
    SELECT TO_CHAR(x.ASSET_ID) AS ASSET_ID, x.ASSET_NUMBER, x.DESCRIPTION, x.ACCOUNTED_STATUS, ${D('x.CREATION_DATE')} AS CREATED,
           NVL(c.SEGMENT1 || CASE WHEN c.SEGMENT2 IS NOT NULL THEN ' - ' || c.SEGMENT2 END, '(no category)') AS CATEGORY,
           CASE WHEN UPPER(NVL(x.RETIRED_FLAG, 'NO')) IN ('YES', 'Y') OR b.DATE_INEFFECTIVE IS NOT NULL THEN 'Y' ELSE 'N' END AS RETIRED,
           NVL(b.COST, 0) AS COST, NVL(b.SALVAGE, 0) AS SALVAGE, NVL(r.RESERVE, 0) AS RESERVE, b.DPIS, b.BOOK_TYPE_CODE, r.LAST_PERIOD
    FROM RR_FA_ADDITIONS x
    LEFT JOIN bk b ON b.ASSET_ID = TO_CHAR(x.ASSET_ID) AND b.RN = 1
    LEFT JOIN rsv r ON r.ASSET_ID = TO_CHAR(x.ASSET_ID) AND r.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
    LEFT JOIN RR_FA_CATEGORIES_B c ON TO_CHAR(c.CATEGORY_ID) = TO_CHAR(x.ASSET_CATEGORY_ID))`;
const FULL = `(COST > 0 AND RESERVE >= COST - SALVAGE - 0.01)`;

/** Headline figures over all assets. */
export const totalsSql = `WITH ${ASSETS}
SELECT COUNT(CASE WHEN RETIRED = 'N' THEN 1 END) AS ACTIVE, COUNT(CASE WHEN RETIRED = 'Y' THEN 1 END) AS RETIRED,
       ROUND(SUM(CASE WHEN RETIRED = 'N' THEN COST ELSE 0 END), 2) AS COST,
       ROUND(SUM(CASE WHEN RETIRED = 'N' THEN RESERVE ELSE 0 END), 2) AS RESERVE,
       COUNT(CASE WHEN RETIRED = 'N' AND ${FULL} THEN 1 END) AS FULLY_RESERVED,
       COUNT(CASE WHEN RETIRED = 'N' AND UPPER(NVL(ACCOUNTED_STATUS, '-')) <> 'ACCOUNTED' THEN 1 END) AS NOT_ACCOUNTED,
       COUNT(CASE WHEN RETIRED = 'N' AND RESERVE = 0 AND COST > 0 AND DPIS < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1) THEN 1 END) AS NO_DEPRN,
       COUNT(CASE WHEN CREATED >= TRUNC(SYSDATE, 'YYYY') THEN 1 END) AS ADDED_YTD,
       ROUND(SUM(CASE WHEN CREATED >= TRUNC(SYSDATE, 'YYYY') THEN COST ELSE 0 END), 2) AS ADDED_YTD_COST,
       MAX(BOOK_TYPE_CODE) AS BOOK
FROM assets`;

/** Cost, depreciation and NBV per category (in service). */
export const byCategorySql = `WITH ${ASSETS}
SELECT CATEGORY, COUNT(*) AS ASSETS, ROUND(SUM(COST), 2) AS COST, ROUND(SUM(LEAST(RESERVE, COST)), 2) AS RESERVE
FROM assets WHERE RETIRED = 'N' GROUP BY CATEGORY ORDER BY COST DESC FETCH FIRST 8 ROWS ONLY`;

export const LIFE = [
  { key: 'Q1', label: 'Under 25% used' }, { key: 'Q2', label: '25–50%' }, { key: 'Q3', label: '50–75%' },
  { key: 'Q4', label: 'Over 75%' }, { key: 'FULL', label: 'Fully depreciated' },
] as const;
const LIFE_CASE = `CASE WHEN ${FULL} THEN 'FULL' WHEN COST <= 0 THEN 'Q1' WHEN RESERVE / COST < 0.25 THEN 'Q1'
  WHEN RESERVE / COST < 0.5 THEN 'Q2' WHEN RESERVE / COST < 0.75 THEN 'Q3' ELSE 'Q4' END`;

/** How far through their depreciable value the assets in service are. */
export const lifeSql = `WITH ${ASSETS}
SELECT ${LIFE_CASE} AS BUCKET, COUNT(*) AS ASSETS, ROUND(SUM(COST), 2) AS COST, ROUND(SUM(GREATEST(COST - RESERVE, 0)), 2) AS NBV
FROM assets WHERE RETIRED = 'N' GROUP BY ${LIFE_CASE}`;

/** Depreciation per period (the last 12 runs): amount, the part already accounted, assets. */
export const deprnSql = `SELECT PERIOD_NAME, MAX(${N('PERIOD_COUNTER')}) AS PC, ROUND(SUM(${N('DEPRN_AMOUNT')}), 2) AS AMOUNT,
       ROUND(SUM(CASE WHEN UPPER(NVL(ACCOUNTED_STATUS, '-')) = 'ACCOUNTED' THEN ${N('DEPRN_AMOUNT')} ELSE 0 END), 2) AS ACCOUNTED,
       COUNT(DISTINCT TO_CHAR(ASSET_ID)) AS ASSETS
FROM RR_FA_DEPRN_SUMMARY WHERE PERIOD_NAME IS NOT NULL
GROUP BY PERIOD_NAME ORDER BY MAX(${N('PERIOD_COUNTER')}) DESC NULLS LAST FETCH FIRST 12 ROWS ONLY`;

/** Retirements this year, and drafts waiting (any year). Gain / loss = proceeds − removal cost − NBV when not stored. */
export const retirementsSql = `WITH r AS (
    SELECT STATUS, ${D('DATE_RETIRED')} AS RETIRED_ON, ${N('COST_RETIRED')} AS COST,
           NVL(${N('GAIN_LOSS_AMOUNT')}, NVL(${N('PROCEEDS_OF_SALE')}, 0) - NVL(${N('COST_OF_REMOVAL')}, 0) - NVL(${N('NBV_RETIRED')}, 0)) AS GAIN_LOSS,
           ${N('PROCEEDS_OF_SALE')} AS PROCEEDS
    FROM RR_FA_RETIREMENTS)
SELECT COUNT(CASE WHEN RETIRED_ON >= TRUNC(SYSDATE, 'YYYY') THEN 1 END) AS YTD,
       ROUND(SUM(CASE WHEN RETIRED_ON >= TRUNC(SYSDATE, 'YYYY') THEN COST ELSE 0 END), 2) AS YTD_COST,
       ROUND(SUM(CASE WHEN RETIRED_ON >= TRUNC(SYSDATE, 'YYYY') THEN PROCEEDS ELSE 0 END), 2) AS YTD_PROCEEDS,
       ROUND(SUM(CASE WHEN RETIRED_ON >= TRUNC(SYSDATE, 'YYYY') THEN GAIN_LOSS ELSE 0 END), 2) AS YTD_GAIN_LOSS,
       COUNT(CASE WHEN UPPER(NVL(STATUS, '-')) = 'DRAFT' THEN 1 END) AS DRAFTS
FROM r`;

/** Asset lists behind the tiles (500 at most). */
export type AssetFilter = 'ACTIVE' | 'FULL' | 'NOT_ACCOUNTED' | 'NO_DEPRN' | 'ADDED_YTD' | 'RETIRED' | `CAT:${string}` | `LIFE:${string}`;
export const assetListSql = (f: AssetFilter) => {
  const where = f === 'ACTIVE' ? `RETIRED = 'N'`
    : f === 'FULL' ? `RETIRED = 'N' AND ${FULL}`
    : f === 'NOT_ACCOUNTED' ? `RETIRED = 'N' AND UPPER(NVL(ACCOUNTED_STATUS, '-')) <> 'ACCOUNTED'`
    : f === 'NO_DEPRN' ? `RETIRED = 'N' AND RESERVE = 0 AND COST > 0 AND DPIS < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1)`
    : f === 'ADDED_YTD' ? `CREATED >= TRUNC(SYSDATE, 'YYYY')`
    : f === 'RETIRED' ? `RETIRED = 'Y'`
    : f.startsWith('CAT:') ? `RETIRED = 'N' AND CATEGORY = ${lit(f.slice(4))}`
    : `RETIRED = 'N' AND ${LIFE_CASE} = ${lit(f.slice(5))}`;
  return `WITH ${ASSETS}
SELECT ASSET_ID, ASSET_NUMBER, DESCRIPTION, CATEGORY, ROUND(COST, 2) AS COST, ROUND(RESERVE, 2) AS RESERVE,
       ROUND(COST - RESERVE, 2) AS NBV, TO_CHAR(DPIS, 'YYYY-MM-DD') AS DPIS, LAST_PERIOD, ACCOUNTED_STATUS, RETIRED,
       TO_CHAR(CREATED, 'YYYY-MM-DD') AS CREATED
FROM assets WHERE ${where}
ORDER BY ${f === 'ADDED_YTD' ? 'CREATED DESC' : 'COST DESC'} NULLS LAST FETCH FIRST 500 ROWS ONLY`;
};

/** The latest additions. */
export const recentSql = `WITH ${ASSETS}
SELECT ASSET_ID, ASSET_NUMBER, DESCRIPTION, CATEGORY, ROUND(COST, 2) AS COST, ROUND(RESERVE, 2) AS RESERVE, ROUND(COST - RESERVE, 2) AS NBV,
       TO_CHAR(DPIS, 'YYYY-MM-DD') AS DPIS, LAST_PERIOD, ACCOUNTED_STATUS, RETIRED, TO_CHAR(CREATED, 'YYYY-MM-DD') AS CREATED
FROM assets ORDER BY CREATED DESC NULLS LAST FETCH FIRST 6 ROWS ONLY`;

// ── shapes ─────────────────────────────────────────────────────────────────
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

export interface FaAsset { id: string; number: string; description: string; category: string; cost: number; reserve: number; nbv: number; dpis: string; lastPeriod: string; accounted: boolean; retired: boolean; created: string }
export interface FaCategory { category: string; assets: number; cost: number; reserve: number }
export interface FaLife { key: string; label: string; assets: number; cost: number; nbv: number }
export interface FaPeriod { period: string; counter: number; amount: number; accounted: number; assets: number }
export interface FaData {
  active: number; retired: number; cost: number; reserve: number; nbv: number;
  fullyReserved: number; notAccounted: number; noDeprn: number; addedYtd: number; addedYtdCost: number; book: string;
  categories: FaCategory[]; life: FaLife[]; periods: FaPeriod[];
  retirements: { ytd: number; ytdCost: number; ytdProceeds: number; ytdGainLoss: number; drafts: number };
  recent: FaAsset[];
  asOf: Date; queries: { label: string; sql: string }[]; errors: string[];
}

const toAsset = (r: Row): FaAsset => ({
  id: str(r.ASSET_ID), number: str(r.ASSET_NUMBER), description: str(r.DESCRIPTION), category: str(r.CATEGORY),
  cost: num(r.COST), reserve: num(r.RESERVE), nbv: num(r.NBV), dpis: str(r.DPIS), lastPeriod: str(r.LAST_PERIOD),
  accounted: str(r.ACCOUNTED_STATUS).toUpperCase() === 'ACCOUNTED', retired: str(r.RETIRED) === 'Y', created: str(r.CREATED),
});

export async function loadFaDashboard(): Promise<FaData> {
  const queries = [
    { label: 'Totals', sql: totalsSql },
    { label: 'By category', sql: byCategorySql },
    { label: 'Depreciated so far', sql: lifeSql },
    { label: 'Depreciation per period', sql: deprnSql },
    { label: 'Retirements', sql: retirementsSql },
    { label: 'Latest additions', sql: recentSql },
  ];
  const errors: string[] = [];
  const run = (i: number) => poQuery(queries[i].sql, 1000, APP).catch((e: Error) => { errors.push(`${queries[i].label}: ${e.message}`); return [] as Row[]; });
  const [tot, cat, life, dep, ret, rec] = await Promise.all(queries.map((_, i) => run(i)));
  const t = tot[0] || {};
  const cost = num(t.COST), reserve = num(t.RESERVE);
  const byLife = new Map(life.map(r => [str(r.BUCKET), r]));
  const rt = ret[0] || {};
  return {
    active: num(t.ACTIVE), retired: num(t.RETIRED), cost, reserve, nbv: Math.round((cost - reserve) * 100) / 100,
    fullyReserved: num(t.FULLY_RESERVED), notAccounted: num(t.NOT_ACCOUNTED), noDeprn: num(t.NO_DEPRN),
    addedYtd: num(t.ADDED_YTD), addedYtdCost: num(t.ADDED_YTD_COST), book: str(t.BOOK),
    categories: cat.map(r => ({ category: str(r.CATEGORY), assets: num(r.ASSETS), cost: num(r.COST), reserve: num(r.RESERVE) })),
    life: LIFE.map(l => { const r = byLife.get(l.key); return { key: l.key, label: l.label, assets: num(r?.ASSETS), cost: num(r?.COST), nbv: num(r?.NBV) }; }),
    periods: dep.map(r => ({ period: str(r.PERIOD_NAME), counter: num(r.PC), amount: num(r.AMOUNT), accounted: num(r.ACCOUNTED), assets: num(r.ASSETS) })).reverse(),
    retirements: { ytd: num(rt.YTD), ytdCost: num(rt.YTD_COST), ytdProceeds: num(rt.YTD_PROCEEDS), ytdGainLoss: num(rt.YTD_GAIN_LOSS), drafts: num(rt.DRAFTS) },
    recent: rec.map(toAsset),
    asOf: new Date(), queries, errors,
  };
}

export async function loadFaAssets(f: AssetFilter): Promise<FaAsset[]> {
  return (await poQuery(assetListSql(f), 500, APP)).map(toAsset);
}

/** "Oct-26" for a date — the period name depreciation runs use. */
export const periodOf = (d: Date) => `${d.toLocaleDateString('en-US', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;
