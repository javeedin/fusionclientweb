// General Ledger dashboard — every figure is one SELECT through the read gateway (POST ai/executequery).
//
// Posted = the batch is posted (RR_POST_JOURNAL sets RR_GL_JOURNAL_BATCHES.STATUS 'P' / STATUS_MEANING 'Posted';
// headers can keep their create-time status) or the header says P / Posted. Anything else — NEW, Unposted, Error,
// no batch row — is "not posted".
// PMS journals are the ones whose category starts with PMS ("PMS FD Journals", "PMS Loan Journals", "PMS Stock Journals").
import { poQuery, type Row } from './po.service';

const APP = 'GL_DASHBOARD';

/** one row per batch (a sync can leave duplicates) */
const BATCHES = `(SELECT JE_BATCH_ID, MAX(BATCH_NAME) AS BATCH_NAME, MAX(STATUS) AS STATUS, MAX(STATUS_MEANING) AS STATUS_MEANING,
           MAX(DEFAULT_PERIOD_NAME) AS DEFAULT_PERIOD_NAME, MAX(USER_JE_SOURCE_NAME) AS USER_JE_SOURCE_NAME
    FROM RR_GL_JOURNAL_BATCHES GROUP BY JE_BATCH_ID)`;
const POSTED = `(UPPER(NVL(b.STATUS, '-')) = 'P' OR UPPER(NVL(b.STATUS_MEANING, '-')) = 'POSTED' OR UPPER(NVL(h.POSTING_STATUS, '-')) IN ('P', 'POSTED'))`;

export const isPmsCategory = (c: unknown) => /^\s*PMS\b/i.test(String(c ?? ''));
/** "PMS FD Journals" → "FD" */
export const pmsKind = (c: unknown) => String(c ?? '').replace(/^\s*PMS\s*/i, '').replace(/\s*Journals?\s*$/i, '').trim() || 'Other';

/** Journals not posted, with their accounted total and age. */
export const notPostedSql = `SELECT h.JE_HEADER_ID, h.BATCH_ID, b.BATCH_NAME, h.JOURNAL_NAME, h.JOURNAL_DESCRIPTION,
       NVL(h.USER_JE_CATEGORY_NAME, '—') AS CATEGORY, NVL(h.USER_JE_SOURCE_NAME, b.USER_JE_SOURCE_NAME) AS SOURCE,
       NVL(h.PERIOD_NAME, b.DEFAULT_PERIOD_NAME) AS PERIOD_NAME, h.LEDGER_ID, h.LEDGER_NAME, h.CURRENCY_CODE,
       NVL(b.STATUS_MEANING, NVL(b.STATUS, h.POSTING_STATUS)) AS STATUS,
       NVL(h.RUNNING_TOTAL_DR, 0) AS ENTERED_DR,
       (SELECT SUM(NVL(l.ACCOUNTED_DR, 0)) FROM RR_GL_JE_LINES_ALL l WHERE l.JE_HEADER_ID = h.JE_HEADER_ID) AS ACCOUNTED_DR,
       (SELECT COUNT(*) FROM RR_GL_JE_LINES_ALL l WHERE l.JE_HEADER_ID = h.JE_HEADER_ID) AS LINE_COUNT,
       h.CREATED_BY, TO_CHAR(h.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED,
       TO_CHAR(h.DEFAULT_EFFECTIVE_DATE, 'YYYY-MM-DD') AS ACCOUNTING_DATE,
       TRUNC(SYSDATE) - TRUNC(NVL(h.CREATION_DATE, h.DEFAULT_EFFECTIVE_DATE)) AS AGE_DAYS
FROM RR_GL_JE_HEADERS h
LEFT JOIN ${BATCHES} b ON b.JE_BATCH_ID = h.BATCH_ID
WHERE NOT ${POSTED}
ORDER BY h.CREATION_DATE`;

/** Journals per period × category, posted and not, for the last 6 months. */
export const byPeriodSql = `SELECT NVL(h.PERIOD_NAME, b.DEFAULT_PERIOD_NAME) AS PERIOD_NAME, NVL(h.USER_JE_CATEGORY_NAME, '—') AS CATEGORY,
       TO_CHAR(TRUNC(MIN(h.DEFAULT_EFFECTIVE_DATE), 'MM'), 'YYYY-MM') AS MON,
       COUNT(*) AS N, SUM(CASE WHEN ${POSTED} THEN 1 ELSE 0 END) AS POSTED
FROM RR_GL_JE_HEADERS h
LEFT JOIN ${BATCHES} b ON b.JE_BATCH_ID = h.BATCH_ID
WHERE h.DEFAULT_EFFECTIVE_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5)
GROUP BY NVL(h.PERIOD_NAME, b.DEFAULT_PERIOD_NAME), NVL(h.USER_JE_CATEGORY_NAME, '—')`;

/** GL periods that are open, per ledger — the table and rule RR_POST_JOURNAL checks before posting
 *  (application 101 = General Ledger, CLOSING_STATUS 'O'; PERIOD_NAME_ID is 'Aug-26' or prefixed '16_Aug-26'). */
export const openPeriodsSql = `SELECT LEDGER_ID, REGEXP_SUBSTR(PERIOD_NAME_ID, '[A-Z][a-z]{2}-[0-9]{2}$') AS PERIOD_NAME,
       TO_CHAR(START_DATE, 'YYYY-MM-DD') AS START_DATE, TO_CHAR(END_DATE, 'YYYY-MM-DD') AS END_DATE
FROM RR_ACCOUNTING_PERIODS_STATUS
WHERE APPLICATION_ID = 101 AND CLOSING_STATUS = 'O' AND NVL(ADJUSTMENT_PERIOD_FLAG, 'N') = 'N'
ORDER BY LEDGER_ID, START_DATE`;

// ── shapes ───────────────────────────────────────────────────────────────────
export interface GlJournal {
  headerId: number; batchId: number | null; batchName: string; journalName: string; description: string;
  category: string; source: string; period: string; ledgerId: number | null; ledger: string; currency: string; status: string;
  enteredDr: number; accountedDr: number; lines: number; createdBy: string; created: string; accountingDate: string; ageDays: number;
  /** its period is not open (for its ledger, else for any ledger) — RR_POST_JOURNAL refuses it until the period is opened */
  periodClosed: boolean;
}
export interface PeriodCount { period: string; category: string; month: string; count: number; posted: number }
export interface OpenPeriod { ledgerId: number | null; period: string; start: string; end: string }
export interface Bucket { key: string; label: string; min: number; max: number; count: number; aed: number }
export interface Slice { name: string; count: number; aed: number; pms: boolean }
export interface MonthBar { month: string; period: string; posted: number; notPosted: number }
export interface GlSummary {
  notPosted: GlJournal[]; count: number; aed: number; oldestDays: number;
  byStatus: { status: string; count: number }[];
  byCategory: Slice[]; byKind: Slice[];
  ages: Bucket[];
  blocked: GlJournal[];
  currentPeriod: string; currentTotal: number; currentPosted: number;
  months: MonthBar[];
  /** null when the period status could not be read */
  openPeriods: string[] | null;
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const str = (v: unknown) => (v == null ? '' : String(v));

export const AGES: Omit<Bucket, 'count' | 'aed'>[] = [
  { key: 'today', label: 'Created today', min: -Infinity, max: 0 },
  { key: '1-7', label: '1–7 days', min: 1, max: 7 },
  { key: '8-30', label: '8–30 days', min: 8, max: 30 },
  { key: '31-90', label: '31–90 days', min: 31, max: 90 },
  { key: '90+', label: 'Over 90 days', min: 91, max: Infinity },
];
export const inAge = (b: Omit<Bucket, 'count' | 'aed'>, j: GlJournal) => j.ageDays >= b.min && j.ageDays <= b.max;

/** "Oct-26" for a date (the GL period naming) */
export const periodOf = (d: Date) => `${d.toLocaleString('en-US', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;

/** Open for posting the way RR_POST_JOURNAL decides: open for the journal's ledger; a ledger with no open periods
 *  listed falls back to any ledger. Unknown (null) when the period status could not be read. */
export function periodOpen(period: string, ledgerId: number | null, open: OpenPeriod[] | null): boolean | null {
  if (!open || !period) return null;
  const mine = ledgerId != null ? open.filter(p => p.ledgerId === ledgerId) : [];
  return (mine.length ? mine : open).some(p => p.period === period);
}

export function toJournal(r: Row, open: OpenPeriod[] | null): GlJournal {
  const period = str(r.PERIOD_NAME);
  const ledgerId = r.LEDGER_ID == null || r.LEDGER_ID === '' ? null : num(r.LEDGER_ID);
  return {
    headerId: num(r.JE_HEADER_ID), batchId: r.BATCH_ID == null ? null : num(r.BATCH_ID), batchName: str(r.BATCH_NAME),
    journalName: str(r.JOURNAL_NAME), description: str(r.JOURNAL_DESCRIPTION), category: str(r.CATEGORY), source: str(r.SOURCE),
    period, ledgerId, ledger: str(r.LEDGER_NAME), currency: str(r.CURRENCY_CODE), status: str(r.STATUS) || 'Unposted',
    enteredDr: num(r.ENTERED_DR), accountedDr: r.ACCOUNTED_DR == null ? num(r.ENTERED_DR) : num(r.ACCOUNTED_DR), lines: num(r.LINE_COUNT),
    createdBy: str(r.CREATED_BY), created: str(r.CREATED), accountingDate: str(r.ACCOUNTING_DATE), ageDays: num(r.AGE_DAYS),
    periodClosed: periodOpen(period, ledgerId, open) === false,
  };
}

/** Everything the dashboard shows, for all journals or only PMS ones. */
export function summarizeGl(all: GlJournal[], periods: PeriodCount[], open: OpenPeriod[] | null, pmsOnly: boolean, today = new Date()): GlSummary {
  const notPosted = pmsOnly ? all.filter(j => isPmsCategory(j.category)) : all;
  const counts = pmsOnly ? periods.filter(p => isPmsCategory(p.category)) : periods;
  const sum = (xs: GlJournal[]) => r2(xs.reduce((s, j) => s + j.accountedDr, 0));
  const group = (key: (j: GlJournal) => string, pmsOf: (k: string) => boolean): Slice[] => {
    const m = new Map<string, GlJournal[]>();
    notPosted.forEach(j => m.set(key(j), [...(m.get(key(j)) || []), j]));
    return [...m].map(([name, js]) => ({ name, count: js.length, aed: sum(js), pms: pmsOf(name) })).sort((a, b) => b.count - a.count || b.aed - a.aed);
  };

  // this period: the one named after today's month; else the latest one with journals
  let currentPeriod = periodOf(today);
  if (!counts.some(p => p.period === currentPeriod)) {
    currentPeriod = [...counts].sort((a, b) => b.month.localeCompare(a.month))[0]?.period || currentPeriod;
  }
  const cur = counts.filter(p => p.period === currentPeriod);

  const months: MonthBar[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(today.getFullYear(), today.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rows = counts.filter(p => p.month === key);
    const n = rows.reduce((s, p) => s + p.count, 0), posted = rows.reduce((s, p) => s + p.posted, 0);
    months.push({ month: key, period: periodOf(d), posted, notPosted: n - posted });
  }

  const statuses = new Map<string, number>();
  notPosted.forEach(j => statuses.set(j.status, (statuses.get(j.status) || 0) + 1));

  return {
    notPosted, count: notPosted.length, aed: sum(notPosted), oldestDays: notPosted.reduce((m, j) => Math.max(m, j.ageDays), 0),
    byStatus: [...statuses].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    byCategory: group(j => j.category, isPmsCategory),
    byKind: group(j => (isPmsCategory(j.category) ? pmsKind(j.category) : 'Other'), k => k !== 'Other').filter(s => s.pms),
    ages: AGES.map(b => { const xs = notPosted.filter(j => inAge(b, j)); return { ...b, count: xs.length, aed: sum(xs) }; }),
    blocked: notPosted.filter(j => j.periodClosed),
    currentPeriod, currentTotal: cur.reduce((s, p) => s + p.count, 0), currentPosted: cur.reduce((s, p) => s + p.posted, 0),
    months,
    openPeriods: open ? [...new Set(open.map(p => p.period).filter(Boolean))] : null,
  };
}

export interface GlData {
  journals: GlJournal[]; periods: PeriodCount[]; open: OpenPeriod[] | null;
  asOf: Date; queries: { label: string; sql: string }[]; errors: string[];
}

export async function loadGlDashboard(): Promise<GlData> {
  const queries = [
    { label: 'Journals not posted', sql: notPostedSql },
    { label: 'Journals per period and category (last 6 months)', sql: byPeriodSql },
    { label: 'Open GL periods', sql: openPeriodsSql },
  ];
  const errors: string[] = [];
  const run = (i: number, max: number) => poQuery(queries[i].sql, max, APP).catch((e: Error) => { errors.push(`${queries[i].label}: ${e.message}`); return [] as Row[]; });
  let periodsRead = true;
  const [np, pc, op] = await Promise.all([run(0, 20000), run(1, 20000),
    poQuery(queries[2].sql, 5000, APP).catch((e: Error) => { periodsRead = false; errors.push(`${queries[2].label}: ${e.message}`); return [] as Row[]; })]);
  const open: OpenPeriod[] | null = periodsRead
    ? op.map(r => ({ ledgerId: r.LEDGER_ID == null ? null : num(r.LEDGER_ID), period: str(r.PERIOD_NAME), start: str(r.START_DATE), end: str(r.END_DATE) }))
    : null;
  return {
    journals: np.map(r => toJournal(r, open)),
    periods: pc.map(r => ({ period: str(r.PERIOD_NAME), category: str(r.CATEGORY), month: str(r.MON), count: num(r.N), posted: num(r.POSTED) })),
    open, asOf: new Date(), queries, errors,
  };
}
