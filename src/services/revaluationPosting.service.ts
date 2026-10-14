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
import { postSlaToGL, buildGlJournalPayload, makeBatchName, type GlPostingOptions, type GlPostingResult } from './glPosting.service';
import { APEX_DB_CONFIG } from '../config/api.config';
import { apiStepName, type ApiCall } from './apiCallRecorder';
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
export interface RevalCcyIn { currencyCode: string; newRate: number; /** the currency's AED adjustment (gain +, loss −) */ revalAmt?: number }

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

/** A revaluation currency named in a line's description as a word ("Julius Bar USD Adhoc Ac") — only when exactly one is. */
const ccyNamedIn = (desc: string | undefined, known: string[]) => {
  const hits = known.filter(c => new RegExp(`(^|[^A-Z])${c}([^A-Z]|$)`).test(String(desc || '').toUpperCase()));
  return hits.length === 1 ? hits[0] : '';
};

/**
 * Lines saved without a currency (before database/gl/164): the currency each one's account actually holds in the GL.
 * account combination → currency, only where the account has activity in exactly one of the revaluation's currencies
 * (revaluation journals themselves are left out).
 */
export async function readRevaluationCurrencyHints(lines: RevalLineIn[], ccyRows: RevalCcyIn[]): Promise<Record<string, string>> {
  const known = [...new Set(ccyRows.map(c => upper(c.currencyCode)).filter(Boolean))];
  const accts = [...new Set(lines.filter(l => !upper(l.currencyCode) && amountOf(l) !== 0).map(l => normAcct(l.combo)).filter(Boolean))];
  if (known.length < 2 || !accts.length) return {};
  const seen = new Map<string, Set<string>>();
  for (let i = 0; i < accts.length; i += 300) {
    const rows = await poQuery(
      `SELECT UPPER(TRIM(l.account_combination)) AS acct, UPPER(l.currency_code) AS ccy FROM rr_gl_je_lines_all l `
      + `WHERE UPPER(TRIM(l.account_combination)) IN (${accts.slice(i, i + 300).map(lit).join(', ')}) `
      + `AND UPPER(l.currency_code) IN (${known.map(lit).join(', ')}) `
      + `AND NVL(UPPER(l.reference5), '-') NOT IN ('GL_REVALUATION', 'GL-REVALUATION') `
      + `GROUP BY UPPER(TRIM(l.account_combination)), UPPER(l.currency_code)`, 5000, 'GL_REVALUATION');
    rows.forEach(r => seen.set(String(r.ACCT), new Set([...(seen.get(String(r.ACCT)) || []), String(r.CCY)])));
  }
  return Object.fromEntries([...seen].filter(([, cs]) => cs.size === 1).map(([a, cs]) => [a, [...cs][0]]));
}

/** planRevaluationJournals, with the GL's currency evidence for lines saved without one. */
export async function planRevaluationJournalsWithGl(lines: RevalLineIn[], ccyRows: RevalCcyIn[]): Promise<RevalPlan> {
  const hints = await readRevaluationCurrencyHints(lines, ccyRows).catch(() => ({} as Record<string, string>));
  return planRevaluationJournals(lines, ccyRows, hints);
}

/** Every line → its currency's journal. Lines it cannot place are reported, never dropped. */
export function planRevaluationJournals(lines: RevalLineIn[], ccyRows: RevalCcyIn[], glHints: Record<string, string> = {}): RevalPlan {
  const problems: string[] = [];
  const rates = new Map<string, number>();
  ccyRows.forEach(c => {
    const k = upper(c.currencyCode);
    if (k && n(c.newRate) > 0 && !rates.has(k)) rates.set(k, n(c.newRate));
  });
  const known = [...rates.keys()];
  const live = lines.filter(l => amountOf(l) !== 0).sort((a, b) => n(a.lineNum) - n(b.lineNum));

  // 1. the line's own currency: CURRENCY_CODE; else the one its account holds in the GL; else the one its
  //    description names ("FX Gain - USD", or a single revaluation currency as a word: "Julius Bar USD Adhoc Ac")
  const ccyOf = live.map(l => {
    const own = upper(l.currencyCode);
    if (own) return own;
    const gl = glHints[normAcct(l.combo)];
    if (gl && rates.has(gl)) return gl;
    const m = CCY_IN_DESC.exec(l.description || '');
    if (m && rates.has(m[1].toUpperCase())) return m[1].toUpperCase();
    return ccyNamedIn(l.description, known);
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
  // 4. only one currency has an adjustment (CHF 0.00, USD 8.58) and it accounts for every line (2.03 + 6.55 = 8.58):
  //    the lines are all that currency's. A currency netting to zero can still have gain and loss lines — then the
  //    totals do not match and nothing is assumed.
  if (ccyOf.some(c => !c)) {
    const adj = (c: string) => ccyRows.find(x => upper(x.currencyCode) === c)?.revalAmt;
    const withAdj = known.filter(c => adj(c) != null && Math.abs(n(adj(c))) >= TOL);
    if (known.every(c => adj(c) != null) && withAdj.length === 1
        && Math.abs(sum(live, 'drAmount') - Math.abs(n(adj(withAdj[0])))) < 0.01
        && ccyOf.every(c => !c || c === withAdj[0])) {
      live.forEach((_, i) => { if (!ccyOf[i]) ccyOf[i] = withAdj[0]; });
    }
  }

  const unplaced = live.filter((_, i) => !ccyOf[i]);
  if (unplaced.length) {
    problems.push(`Line${unplaced.length === 1 ? '' : 's'} ${lineList(unplaced)}: cannot tell which currency ${unplaced.length === 1 ? 'it belongs' : 'they belong'} to `
      + `(the revaluation has ${known.join(', ') || 'no currency with a rate'}; neither the line, its account's GL activity nor its `
      + `description says which). Install database/gl/164 and save the revaluation again from the Trial Balance.`);
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
    `SELECT l.batch_id, l.je_header_id, l.account_combination, l.accounted_dr, l.accounted_cr, l.currency_code, l.reference1 `
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

// ── Delete & re-post ──────────────────────────────────────────────────────────
// The GL allows one journal per reference2 + reference5 (journals/create answers DUPLICATE), so a
// half-posted revaluation cannot be completed by adding a second journal. Instead: delete the
// revaluation's GL batches — the same DELETE gl/journals/batches/:id the Delete Journals page uses
// (deleted rows are kept in the RR_GL_*_DEL audit tables) — then post every line again.

const BASE = APEX_DB_CONFIG.baseUrl;

export interface RebuildBatch { batchId: number; name: string; status: string; lines: number; mine: number; dr: number }
export interface RebuildPlan {
  ctx: RevalPostContext;
  plan: RevalPlan;
  batches: RebuildBatch[];     // to delete
  problems: string[];          // block the run
  warnings: string[];
  calls: ApiCall[];            // exactly what will be sent (placeholders where the server assigns ids)
}

export async function planRevaluationRebuild(ctx: RevalPostContext, plan: RevalPlan): Promise<RebuildPlan> {
  const problems = [...plan.problems];
  const warnings: string[] = [];
  const gl = await readRevaluationGl(ctx.revalueId);
  const ids = [...new Set(gl.map(l => n(l.BATCH_ID)).filter(Boolean))];
  let batches: RebuildBatch[] = [];
  if (ids.length) {
    const list = ids.join(', ');
    const counts = await poQuery(
      `SELECT l.batch_id, COUNT(*) AS n, SUM(CASE WHEN l.reference2 = ${lit(String(ctx.revalueId))} THEN 1 ELSE 0 END) AS mine, `
      + `SUM(NVL(l.accounted_dr, 0)) AS dr FROM rr_gl_je_lines_all l WHERE l.batch_id IN (${list}) GROUP BY l.batch_id`, 200, 'GL_REVALUATION');
    const meta = await poQuery(`SELECT b.* FROM rr_gl_journal_batches b WHERE b.je_batch_id IN (${list})`, 200, 'GL_REVALUATION').catch(() => [] as Row[]);
    batches = ids.map(id => {
      const c = counts.find(r => n(r.BATCH_ID) === id);
      const m = meta.find(r => n(r.JE_BATCH_ID) === id);
      return { batchId: id, name: String(m?.BATCH_NAME || m?.NAME || `Batch ${id}`), status: String(m?.STATUS_MEANING || m?.STATUS || ''),
        lines: n(c?.N), mine: n(c?.MINE), dr: r2(n(c?.DR)) };
    });
    batches.filter(b => b.lines !== b.mine).forEach(b =>
      problems.push(`${b.name} also holds ${b.lines - b.mine} line(s) of other transactions — it is not deleted automatically; delete or correct it from Delete Journals.`));
  }
  plan.journals.forEach(j => {
    const cos = [...new Set(j.lines.map(l => String(l.combo || '').split('-')[0]))];
    if (cos.length > 1) problems.push(`${j.ccy} lines use companies ${cos.join(', ')} — the GL rejects a journal that spans companies.`);
  });
  if (plan.journals.length > 1) {
    warnings.push(`This revaluation needs ${plan.journals.length} journals (one per currency: ${plan.journals.map(j => j.ccy).join(', ')}). `
      + 'If the GL rejects the second one as DUPLICATE (one journal per reference2 + reference5), only the first currency will be posted.');
  }
  const calls: ApiCall[] = [
    ...batches.map(b => ({ step: `Delete GL batch ${b.name}${b.status ? ` (${b.status})` : ''} — ${b.lines} lines`, method: 'DELETE', url: `${BASE}/gl/journals/batches/${b.batchId}` })),
    ...plan.journals.flatMap(j => {
      const opts = revaluationJournalOptions(ctx, j);
      const body = buildGlJournalPayload(opts, makeBatchName(opts.eventTypeCode, opts.sourceNumber));
      return [
        { step: apiStepName('POST', '/journals/create', body), method: 'POST', url: `${BASE}/journals/create`, body },
        { step: `Post GL batch — ${j.ccy}`, method: 'PUT', url: `${BASE}/gl/journals/{jeBatchId returned by create}/post` },
        { step: 'Stamp SLA header with the GL batch', method: 'POST', url: `${BASE}/sla/accounting/post`,
          body: { headerId: ctx.slaHeaderId, glBatchId: '{jeBatchId}', glBatchName: body.batch.batchName, glHeaderId: '{jeHeaderId}', postedBy: ctx.createdBy } },
      ];
    }),
  ];
  return { ctx, plan, batches, problems, warnings, calls };
}

export interface RebuildOutcome { deleted: RebuildBatch[]; outcome: RevalPostOutcome; check: GlCheck }

/** Deletes the revaluation's GL batches, posts every line again and reads the GL back. */
export async function rebuildRevaluationGl(rp: RebuildPlan): Promise<RebuildOutcome> {
  if (rp.problems.length) throw new Error(rp.problems.join(' '));
  const deleted: RebuildBatch[] = [];
  for (const b of rp.batches) {
    const res = await fetch(`${BASE}/gl/journals/batches/${b.batchId}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({} as any));
    const ok = res.ok && data?.success !== false && !/^ERROR$/i.test(String(data?.status ?? ''));
    if (!ok) {
      const why = data?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(deleted.length
        ? `Deleted ${deleted.map(d => d.name).join(', ')}, but ${b.name} could not be deleted: ${why}. Nothing new was posted.`
        : `${b.name} could not be deleted: ${why}. Nothing was changed.`);
    }
    deleted.push(b);
  }
  let outcome: RevalPostOutcome;
  try {
    outcome = await postRevaluationToGl(rp.ctx, rp.plan);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`${deleted.length ? `Deleted ${deleted.map(d => d.name).join(', ')} (kept in the delete archive). ` : ''}`
      + `The new journal was not posted: ${why}. Fix the cause and run Delete & re-post again — every line will be posted.`);
  }
  const check = await checkRevaluationInGl(rp.ctx.revalueId, rp.plan, outcome.posted.map(p => p.result.batchId));
  return { deleted, outcome, check };
}

/** Last day of a Mon-YY period as YYYY-MM-DD in LOCAL time (toISOString would shift it a day back east of UTC). */
export function periodLastDay(periodName: string): string {
  const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const [mon, yr] = periodName.split('-');
  const d = mon && yr && MONTHS[mon] !== undefined ? new Date(2000 + parseInt(yr, 10), MONTHS[mon] + 1, 0) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
