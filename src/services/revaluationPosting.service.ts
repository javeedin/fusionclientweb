// FX revaluation → GL.
//
// A revaluation's lines are written as one Dr/Cr pair per account combination × currency (an account with
// three INR combinations has three INR pairs). The GL gets one journal per currency — journal currency = the
// foreign currency, entered 0, accounted = the AED adjustment, rate = the new revaluation rate — and that
// journal must carry EVERY line of its currency.
//
// The old posting loop paired currency #k with lines[2k] and lines[2k+1], so only the first combination of
// each currency reached the GL and the rest were silently dropped (and with several currencies a pair could
// land in the wrong currency's journal at the wrong rate). This module replaces it:
//   planRevaluationJournals  — puts every line in its currency's journal, refuses anything it cannot place
//   postRevaluationToGl      — posts only what the GL does not have yet (a retry or repair never duplicates)
//   checkRevaluationInGl     — reads the GL back; the revaluation is marked ACCOUNTED only when it all matches
import { postSlaToGL, type GlPostingOptions, type GlPostingResult } from './glPosting.service';
import { poQuery, lit, n, type Row } from './po.service';

export interface RevalLineIn {
  lineId?: number;
  lineNum: number;
  combo: string;
  description?: string;
  drAmount: number;
  crAmount: number;
  currencyCode?: string | null;
}
export interface RevalCcyIn { currencyCode: string; newRate: number }

export interface RevalJournalPlan { ccy: string; rate: number; lines: RevalLineIn[]; dr: number; cr: number }
export interface RevalPlan { journals: RevalJournalPlan[]; lineCount: number; problems: string[] }

const TOL = 0.005;
const r2 = (v: number) => Math.round(v * 100) / 100;
const amountOf = (l: RevalLineIn) => r2(l.drAmount || 0) || r2(l.crAmount || 0);
const sideOf = (l: RevalLineIn) => (r2(l.drAmount || 0) > 0 ? 'DR' : 'CR');
const normAcct = (s: unknown) => String(s ?? '').trim().toUpperCase();
const upper = (s: unknown) => String(s ?? '').trim().toUpperCase();
const lineList = (ls: RevalLineIn[]) => ls.map(l => l.lineNum).join(', ');
const sum = (ls: RevalLineIn[], k: 'drAmount' | 'crAmount') => r2(ls.reduce((s, l) => s + (l[k] || 0), 0));

// The Trial Balance writes the currency into the gain/loss line: "Unrealized FX Gain - INR (Sep-26)"
const CCY_IN_DESC = /\bFX\s+(?:Gain|Loss)\s*[-–]\s*([A-Z]{3})\b/i;

/** Every line → its currency's journal. Lines it cannot place are reported, never dropped. */
export function planRevaluationJournals(lines: RevalLineIn[], ccyRows: RevalCcyIn[]): RevalPlan {
  const problems: string[] = [];
  const rates = new Map<string, number>();
  ccyRows.forEach(c => {
    const k = upper(c.currencyCode);
    if (k && n(c.newRate) > 0 && !rates.has(k)) rates.set(k, n(c.newRate));
  });
  const known = [...rates.keys()];
  const live = lines.filter(l => amountOf(l) !== 0).sort((a, b) => n(a.lineNum) - n(b.lineNum));

  // 1. the line's own currency (CURRENCY_CODE, or the one in its description)
  const ccyOf = live.map(l => {
    const own = upper(l.currencyCode);
    if (own) return own;
    const m = CCY_IN_DESC.exec(l.description || '');
    return m && rates.has(m[1].toUpperCase()) ? m[1].toUpperCase() : '';
  });
  // 2. a line without one takes its pair partner's — lines are written as Dr/Cr pairs of the same amount
  const first = [...ccyOf];
  live.forEach((l, i) => {
    if (ccyOf[i]) return;
    const j = i % 2 === 0 ? i + 1 : i - 1;
    const p = live[j];
    if (p && first[j] && Math.abs(amountOf(p) - amountOf(l)) < TOL && sideOf(p) !== sideOf(l)) ccyOf[i] = first[j];
  });
  // 3. a single-currency revaluation needs no more
  if (known.length === 1) live.forEach((_, i) => { if (!ccyOf[i]) ccyOf[i] = known[0]; });

  const unplaced = live.filter((_, i) => !ccyOf[i]);
  if (unplaced.length) {
    problems.push(`Line${unplaced.length === 1 ? '' : 's'} ${lineList(unplaced)}: cannot tell which currency ${unplaced.length === 1 ? 'it belongs' : 'they belong'} to `
      + `(the revaluation has ${known.join(', ') || 'no currency with a rate'}). Install database/gl/164 and save the revaluation again from the Trial Balance.`);
  }

  const byCcy = new Map<string, RevalLineIn[]>();
  live.forEach((l, i) => { const c = ccyOf[i]; if (c) byCcy.set(c, [...(byCcy.get(c) || []), l]); });
  const journals: RevalJournalPlan[] = [];
  byCcy.forEach((ls, ccy) => {
    const rate = rates.get(ccy);
    if (!rate) { problems.push(`${ccy} (lines ${lineList(ls)}): no new rate on the revaluation.`); return; }
    const dr = sum(ls, 'drAmount'), cr = sum(ls, 'crAmount');
    if (Math.abs(dr - cr) > TOL) problems.push(`${ccy} lines ${lineList(ls)} do not balance: Dr ${dr.toFixed(2)}, Cr ${cr.toFixed(2)}.`);
    journals.push({ ccy, rate, lines: ls, dr, cr });
  });
  return { journals, lineCount: live.length, problems };
}

/** GL lines already posted for a revaluation (REFERENCE2 = revalue id). */
export async function readRevaluationGl(revalueId: number): Promise<Row[]> {
  return poQuery(
    `SELECT l.je_header_id, l.account_combination, l.accounted_dr, l.accounted_cr, l.currency_code, l.reference1 `
    + `FROM rr_gl_je_lines_all l WHERE l.reference2 = ${lit(String(revalueId))} `
    + `AND (UPPER(l.reference5) IN ('GL_REVALUATION', 'GL-REVALUATION') OR l.reference1 LIKE ${lit(`REVAL-${revalueId}%`)})`,
    5000, 'GL_REVALUATION');
}

/** GL line count per revaluation id, for every revaluation at once (REFERENCE2 → count). */
export async function readRevaluationGlCounts(): Promise<Record<string, number>> {
  const rows = await poQuery(
    `SELECT l.reference2 AS rid, COUNT(*) AS n FROM rr_gl_je_lines_all l `
    + `WHERE UPPER(l.reference5) IN ('GL_REVALUATION', 'GL-REVALUATION') GROUP BY l.reference2`,
    20000, 'GL_REVALUATION');
  return Object.fromEntries(rows.map(r => [String(r.RID), n(r.N)]));
}

export interface GlCompare {
  /** what still has to be posted, per currency */
  todo: RevalJournalPlan[];
  /** revaluation lines already in the GL */
  inGl: number;
  /** GL lines of this revaluation that match none of its lines */
  strays: Row[];
}

/** Ticks each planned line off against the GL (same account, side, amount and — when known — currency). */
export function compareWithGl(plan: RevalPlan, gl: Row[]): GlCompare {
  const pool = gl.map(l => ({ l, used: false }));
  const glAmt = (l: Row) => r2(n(l.ACCOUNTED_DR)) || r2(n(l.ACCOUNTED_CR));
  const glSide = (l: Row) => (r2(n(l.ACCOUNTED_DR)) > 0 ? 'DR' : 'CR');
  let inGl = 0;
  const todo = plan.journals.map(j => {
    const rest = j.lines.filter(x => {
      const hit = pool.find(p => !p.used
        && normAcct(p.l.ACCOUNT_COMBINATION) === normAcct(x.combo)
        && glSide(p.l) === sideOf(x)
        && Math.abs(glAmt(p.l) - amountOf(x)) < TOL * 3
        && (!p.l.CURRENCY_CODE || upper(p.l.CURRENCY_CODE) === j.ccy));
      if (!hit) return true;
      hit.used = true; inGl++;
      return false;
    });
    return { ...j, lines: rest, dr: sum(rest, 'drAmount'), cr: sum(rest, 'crAmount') };
  }).filter(j => j.lines.length > 0);
  return { todo, inGl, strays: pool.filter(p => !p.used).map(p => p.l) };
}

export interface RevalPostContext {
  revalueId: number;
  account: string;
  periodName: string;          // Mon-YY
  accountingDate: string;      // YYYY-MM-DD
  ledgerName: string;
  ledgerId: number;
  slaHeaderId: number;
  createdBy: string;
  journalDescription: string;
  lineDescription: (l: RevalLineIn, ccy: string) => string;
}
export interface RevalPosted { ccy: string; lines: number; dr: number; result: GlPostingResult }
export interface RevalPostOutcome { posted: RevalPosted[]; alreadyInGl: number; lineCount: number }

/** The GL journal of one currency (the exact options postSlaToGL / buildGlJournalPayload take). */
export function revaluationJournalOptions(ctx: RevalPostContext, j: RevalJournalPlan): GlPostingOptions {
  return {
    slaHeaderId:        ctx.slaHeaderId,
    sourceNumber:       `REVAL-${ctx.revalueId}-${j.ccy}`,
    sourceId:           ctx.revalueId,
    eventTypeCode:      'GL_REVALUATION',
    periodName:         ctx.periodName,
    ledgerName:         ctx.ledgerName,
    ledgerId:           ctx.ledgerId,
    currency:           j.ccy,          // foreign currency (e.g. INR) — Oracle standard
    conversionRate:     j.rate,         // new revaluation rate
    accountingDate:     ctx.accountingDate,
    legalEntity:        '',
    businessUnit:       '',
    jeCategory:         'Revaluation',
    jeSource:           'General Ledger',
    batchSource:        'General Ledger',
    batchDescription:   ctx.journalDescription,
    journalDescription: ctx.journalDescription,
    journalName:        `FX REVAL – ${ctx.account} – ${j.ccy} – ${ctx.periodName}`,
    createdBy:          ctx.createdBy,
    forceCreate:        true,
    lines: j.lines.map(l => ({
      lineType:           sideOf(l) as 'DR' | 'CR',
      enteredDr:          0,
      enteredCr:          0,
      accountedDr:        sideOf(l) === 'DR' ? r2(l.drAmount) : null,
      accountedCr:        sideOf(l) === 'CR' ? r2(l.crAmount) : null,
      description:        ctx.lineDescription(l, j.ccy),
      currencyCode:       j.ccy,
      accountingDate:     ctx.accountingDate,
      accountCombination: l.combo,
      accountingClass:    'Revaluation',
      legalEntity:        null,
    })),
  };
}

/**
 * Posts every revaluation line that is not in the GL yet — one balanced journal per currency.
 * Throws before posting anything when the plan has problems, the GL holds lines that match none of the
 * revaluation's, or what is left of a currency would not balance.
 */
export async function postRevaluationToGl(
  ctx: RevalPostContext, plan: RevalPlan, onPosted?: (p: RevalPosted) => void,
): Promise<RevalPostOutcome> {
  if (plan.problems.length) throw new Error(plan.problems.join(' '));
  const cmp = compareWithGl(plan, await readRevaluationGl(ctx.revalueId));
  if (cmp.strays.length) {
    throw new Error(`The GL already has ${cmp.strays.length} line${cmp.strays.length === 1 ? '' : 's'} for revaluation #${ctx.revalueId} `
      + `that match none of its lines — review them in View Accounting before posting again.`);
  }
  const unbalanced = cmp.todo.filter(j => Math.abs(j.dr - j.cr) > TOL);
  if (unbalanced.length) {
    throw new Error(unbalanced.map(j => `${j.ccy}: the lines still to post (${lineList(j.lines)}) do not balance — Dr ${j.dr.toFixed(2)}, Cr ${j.cr.toFixed(2)}.`).join(' ')
      + ' Part of a pair is already in the GL; review it in View Accounting.');
  }

  const posted: RevalPosted[] = [];
  for (const j of cmp.todo) {
    const result = await postSlaToGL(revaluationJournalOptions(ctx, j));
    const p = { ccy: j.ccy, lines: j.lines.length, dr: j.dr, result };
    posted.push(p);
    onPosted?.(p);
    if (!result.success) throw Object.assign(new Error(`${j.ccy}: ${result.error || 'GL posting failed'}`), { posted });
  }
  return { posted, alreadyInGl: cmp.inGl, lineCount: plan.lineCount };
}

/** One line for the accounting-flow step: what went to which batch. */
export function describeRevalPosting(o: RevalPostOutcome): string {
  if (!o.posted.length) return `All ${o.lineCount} lines were already in the GL — nothing to post`;
  return o.posted.map(p => `${p.ccy}: ${p.lines} line${p.lines === 1 ? '' : 's'} → ${p.result.batchName}`).join(' · ')
    + (o.alreadyInGl ? ` · ${o.alreadyInGl} already in the GL` : '');
}

export interface GlCheck { ok: boolean; inGl: number; lineCount: number; missing: number; strays: number; message: string }

/** Reads the GL back and confirms every revaluation line is there, and nothing else.
 *  When it is not, says what the batches just posted actually hold (lines, references). */
export async function checkRevaluationInGl(revalueId: number, plan: RevalPlan, postedBatchIds: (number | null)[] = []): Promise<GlCheck> {
  const cmp = compareWithGl(plan, await readRevaluationGl(revalueId));
  const missing = cmp.todo.reduce((s, j) => s + j.lines.length, 0);
  const ok = missing === 0 && cmp.strays.length === 0;
  let message = ok
    ? `All ${plan.lineCount} lines are in the GL`
    : [missing ? `${missing} of ${plan.lineCount} lines are not in the GL` : '',
       cmp.strays.length ? `${cmp.strays.length} GL line${cmp.strays.length === 1 ? '' : 's'} match no revaluation line` : '']
      .filter(Boolean).join('; ');
  const ids = postedBatchIds.filter((x): x is number => !!x);
  if (!ok && ids.length) {
    try {
      const rows = await poQuery(
        `SELECT l.batch_id, COUNT(*) AS n, MIN(l.reference2) AS r2, MIN(l.reference5) AS r5, SUM(NVL(l.accounted_dr, 0)) AS dr `
        + `FROM rr_gl_je_lines_all l WHERE l.batch_id IN (${ids.map(Number).join(', ')}) GROUP BY l.batch_id`, 100, 'GL_REVALUATION');
      message += ' — ' + ids.map(id => {
        const r = rows.find(x => n(x.BATCH_ID) === id);
        return r ? `batch ${id} holds ${n(r.N)} lines (reference2 ${r.R2 ?? '—'}, reference5 ${r.R5 ?? '—'}, Dr ${r2(n(r.DR)).toFixed(2)})`
          : `batch ${id} holds no lines`;
      }).join('; ');
    } catch { /* the check itself already failed; keep its message */ }
  }
  return { ok, inGl: cmp.inGl, lineCount: plan.lineCount, missing, strays: cmp.strays.length, message };
}

/** Last day of a Mon-YY period as YYYY-MM-DD in LOCAL time (toISOString would shift it a day back east of UTC). */
export function periodLastDay(periodName: string): string {
  const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const [mon, yr] = periodName.split('-');
  const d = mon && yr && MONTHS[mon] !== undefined ? new Date(2000 + parseInt(yr, 10), MONTHS[mon] + 1, 0) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
