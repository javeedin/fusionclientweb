// Purchasing-RR — terms and conditions: the clause library, the clauses of a purchase order,
// and merge fields ({PO_NUMBER}, {SUPPLIER_NAME} …) filled in on screen and in the printed PO.
// Database: database/po/306_po_terms.sql (RR_PO_V_TERMS, RR_PO_V_ORDER_TERMS, RR_PO_TERMS_PKG).
import { poQuery, poExec, PROC, nlit, money, day, n, Row, ExecResult } from '../../services/po.service';

/** A clause in the library (RR_PO_V_TERMS). */
export interface LibraryTerm {
  TERM_ID: number; TERM_CODE: string; TITLE: string; TERM_TEXT: string; TERM_CATEGORY: string;
  BUSINESS_UNIT_ID: number | null; BUSINESS_UNIT_NAME: string | null; DISPLAY_ORDER: number;
  DEFAULT_FLAG: string; MANDATORY_FLAG: string; STATUS: string; PO_COUNT: number;
  LAST_UPDATED_BY?: string | null; LAST_UPDATE_DATE?: string | null;
}

/** A clause on a purchase order (or about to be put on one). */
export interface PoClause {
  key: string;
  /** library clause it came from; null = written for this order only */
  termId: number | null;
  title: string;
  text: string;
  mandatory: boolean;
  code?: string | null;
  category?: string | null;
  /** current library wording, to offer "use the latest wording" */
  libraryTitle?: string | null;
  libraryText?: string | null;
}

export const TERM_CATEGORIES: { value: string; label: string; color: string }[] = [
  { value: 'GENERAL', label: 'General', color: 'default' },
  { value: 'PAYMENT', label: 'Payment & invoicing', color: 'gold' },
  { value: 'DELIVERY', label: 'Delivery & shipping', color: 'blue' },
  { value: 'QUALITY', label: 'Quality & inspection', color: 'cyan' },
  { value: 'WARRANTY', label: 'Warranty', color: 'green' },
  { value: 'LIABILITY', label: 'Liability & insurance', color: 'orange' },
  { value: 'CONFIDENTIALITY', label: 'Confidentiality', color: 'purple' },
  { value: 'TERMINATION', label: 'Cancellation & termination', color: 'red' },
  { value: 'LEGAL', label: 'Law & disputes', color: 'geekblue' },
  { value: 'OTHER', label: 'Other', color: 'default' },
];
export const categoryInfo = (c?: string | null) =>
  TERM_CATEGORIES.find(x => x.value === String(c || '').toUpperCase()) || { value: String(c || 'GENERAL'), label: String(c || 'General'), color: 'default' };

// ── merge fields ─────────────────────────────────────────────────────────────
export const MERGE_FIELDS: { key: string; label: string; sample: string }[] = [
  { key: 'PO_NUMBER', label: 'PO number', sample: 'PO-2026-00042' },
  { key: 'PO_DATE', label: 'PO date', sample: '2026-10-10' },
  { key: 'SUPPLIER_NAME', label: 'Supplier', sample: 'Al Noor Trading LLC' },
  { key: 'SUPPLIER_SITE', label: 'Supplier site', sample: 'DUBAI' },
  { key: 'BU_NAME', label: 'Business unit', sample: 'BUIMERC' },
  { key: 'BUYER', label: 'Buyer', sample: 'J.SMITH' },
  { key: 'CURRENCY', label: 'Currency', sample: 'AED' },
  { key: 'TOTAL_AMOUNT', label: 'Order total', sample: '125,000.00' },
  { key: 'PAYMENT_TERMS', label: 'Payment terms', sample: '30 Days' },
  { key: 'SHIP_TO', label: 'Ship-to location', sample: 'Head Office Warehouse' },
  { key: 'BILL_TO', label: 'Bill-to location', sample: 'Head Office' },
];
const FIELD_KEYS = new Set(MERGE_FIELDS.map(f => f.key));
const FIELD_RE = /\{([A-Z0-9_]+)\}/g;

export type MergeContext = Record<string, string>;

export const sampleContext = (): MergeContext => Object.fromEntries(MERGE_FIELDS.map(f => [f.key, f.sample]));

/** Values for the merge fields of one purchase order (header row of RR_PO_V_ORDERS). */
export const orderContext = (h: Row | null | undefined, extra: { buName?: string | null; shipTo?: string | null; billTo?: string | null } = {}): MergeContext => {
  if (!h) return {};
  return {
    PO_NUMBER: String(h.PO_NUMBER || ''),
    PO_DATE: day(h.APPROVED_DATE || h.CREATION_DATE),
    SUPPLIER_NAME: String(h.SUPPLIER_NAME || ''),
    SUPPLIER_SITE: String(h.SITE_NAME || ''),
    BU_NAME: String(extra.buName || h.BUSINESS_UNIT_NAME || ''),
    BUYER: String(h.BUYER_USER || ''),
    CURRENCY: String(h.CURRENCY_CODE || ''),
    TOTAL_AMOUNT: h.TOTAL_AMOUNT === null || h.TOTAL_AMOUNT === undefined ? '' : money(n(h.TOTAL_AMOUNT) - n(h.AMOUNT_CANCELLED)),
    PAYMENT_TERMS: String(h.PAYMENT_TERMS || ''),
    SHIP_TO: String(extra.shipTo || h.SHIP_TO_NAME || ''),
    BILL_TO: String(extra.billTo || h.BILL_TO_NAME || ''),
  };
};

/** Replace {FIELD} with its value; unknown fields and fields without a value stay as typed. */
export const fillMergeFields = (text: string, ctx: MergeContext) =>
  String(text || '').replace(FIELD_RE, (m, k: string) => (ctx[k] ? ctx[k] : m));

/** Split text into plain parts and merge fields, for highlighting in previews. */
export const mergeParts = (text: string, ctx: MergeContext) => {
  const out: { text: string; field?: string; known?: boolean; filled?: boolean }[] = [];
  let last = 0;
  String(text || '').replace(FIELD_RE, (m, k: string, at: number) => {
    if (at > last) out.push({ text: text.slice(last, at) });
    const filled = !!ctx[k];
    out.push({ text: filled ? ctx[k] : m, field: k, known: FIELD_KEYS.has(k), filled });
    last = at + m.length;
    return m;
  });
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
};

/** {FIELDS} in the text that the app does not know (typos). */
export const unknownFields = (text: string) =>
  Array.from(new Set(Array.from(String(text || '').matchAll(FIELD_RE)).map(m => m[1]).filter(k => !FIELD_KEYS.has(k))));

export const MAX_CLAUSE_BYTES = 4000;
export const byteLength = (s: string) => new TextEncoder().encode(String(s || '')).length;

// ── library ──────────────────────────────────────────────────────────────────
/** The read failed because database/po/306_po_terms.sql is not installed yet. */
export const termsNotInstalled = (e: unknown) =>
  /ORA-00942|ORA-04043|table or view does not exist|RR_PO_V_(ORDER_)?TERMS/i.test(String((e as Error)?.message ?? e));

const libRow = (r: Row): LibraryTerm => ({
  ...(r as LibraryTerm),
  TERM_ID: Number(r.TERM_ID),
  BUSINESS_UNIT_ID: r.BUSINESS_UNIT_ID === null || r.BUSINESS_UNIT_ID === undefined ? null : Number(r.BUSINESS_UNIT_ID),
  DISPLAY_ORDER: n(r.DISPLAY_ORDER),
  PO_COUNT: n(r.PO_COUNT),
  TERM_TEXT: String(r.TERM_TEXT ?? ''),
  TITLE: String(r.TITLE ?? ''),
});

export async function loadTermLibrary(): Promise<LibraryTerm[]> {
  const rows = await poQuery('SELECT * FROM RR_PO_V_TERMS ORDER BY DISPLAY_ORDER, TERM_CODE', 2000);
  return rows.map(libRow);
}

export const appliesToBu = (t: LibraryTerm, bu: number | null | undefined) =>
  t.BUSINESS_UNIT_ID === null || (bu !== null && bu !== undefined && Number(t.BUSINESS_UNIT_ID) === Number(bu));

let keySeq = 0;
export const clauseKey = () => `c${Date.now().toString(36)}${(++keySeq).toString(36)}`;

export const fromLibrary = (t: LibraryTerm): PoClause => ({
  key: clauseKey(), termId: t.TERM_ID, title: t.TITLE, text: t.TERM_TEXT, mandatory: t.MANDATORY_FLAG === 'Y',
  code: t.TERM_CODE, category: t.TERM_CATEGORY, libraryTitle: t.TITLE, libraryText: t.TERM_TEXT,
});

const byOrder = (a: LibraryTerm, b: LibraryTerm) => a.DISPLAY_ORDER - b.DISPLAY_ORDER || a.TERM_CODE.localeCompare(b.TERM_CODE);

/** The clauses a new order of this business unit starts with (what the database trigger adds). */
export const defaultClauses = (lib: LibraryTerm[], bu: number | null | undefined) =>
  lib.filter(t => t.STATUS === 'ACTIVE' && appliesToBu(t, bu) && (t.DEFAULT_FLAG === 'Y' || t.MANDATORY_FLAG === 'Y'))
    .sort(byOrder).map(fromLibrary);

/** Active mandatory clauses of the business unit that are not on the order. */
export const missingMandatory = (clauses: PoClause[], lib: LibraryTerm[], bu: number | null | undefined) =>
  lib.filter(t => t.STATUS === 'ACTIVE' && t.MANDATORY_FLAG === 'Y' && appliesToBu(t, bu) && !clauses.some(c => c.termId === t.TERM_ID))
    .sort(byOrder);

/** The order's clauses with any missing mandatory clause appended. */
export const withMandatory = (clauses: PoClause[], lib: LibraryTerm[], bu: number | null | undefined) =>
  [...clauses, ...missingMandatory(clauses, lib, bu).map(fromLibrary)];

/** Library wording differs from the order's copy. */
export const libraryChanged = (c: PoClause) =>
  c.termId !== null && c.libraryText !== null && c.libraryText !== undefined
  && (c.libraryText !== c.text || (c.libraryTitle ?? c.title) !== c.title);

// ── the clauses of a purchase order ─────────────────────────────────────────────
export interface PoTerms {
  clauses: PoClause[];
  /** ORDER = the order's own clauses; LEGACY = the business unit's old free text (306 not installed) */
  source: 'ORDER' | 'LEGACY' | 'NONE';
  installed: boolean;
}

async function legacyTerms(bu: number | null | undefined): Promise<PoClause[]> {
  if (!bu) return [];
  const [r] = await poQuery(`SELECT CAST(SUBSTR(PO_TERMS_TEXT, 1, 3900) AS VARCHAR2(3900)) AS TERMS
                             FROM RR_PO_BU_OPTIONS WHERE BUSINESS_UNIT_ID = ${nlit(bu)}`).catch(() => [] as Row[]);
  const text = String(r?.TERMS || '').trim();
  return text ? [{ key: clauseKey(), termId: null, title: 'Terms and conditions', text, mandatory: false }] : [];
}

export async function loadPoTerms(poHeaderId: number | null | undefined, bu: number | null | undefined): Promise<PoTerms> {
  if (!poHeaderId) return { clauses: [], source: 'NONE', installed: true };
  try {
    const rows = await poQuery(`SELECT * FROM RR_PO_V_ORDER_TERMS WHERE PO_HEADER_ID = ${nlit(poHeaderId)} ORDER BY SEQ_NUM, PO_TERM_ID`);
    const clauses = rows.map(r => ({
      key: `t${r.PO_TERM_ID}`,
      termId: r.TERM_ID === null || r.TERM_ID === undefined ? null : Number(r.TERM_ID),
      title: String(r.TITLE ?? ''), text: String(r.TERM_TEXT ?? ''), mandatory: r.MANDATORY_FLAG === 'Y',
      code: r.TERM_CODE ?? null, category: r.TERM_CATEGORY ?? null,
      libraryTitle: r.LIBRARY_TITLE ?? null, libraryText: r.LIBRARY_TEXT ?? null,
    } as PoClause));
    return { clauses, source: clauses.length ? 'ORDER' : 'NONE', installed: true };
  } catch (e) {
    if (!termsNotInstalled(e)) throw e;
    const clauses = await legacyTerms(bu);
    return { clauses, source: clauses.length ? 'LEGACY' : 'NONE', installed: false };
  }
}

export const savePoTerms = (poHeaderId: number, clauses: PoClause[], user: string): Promise<ExecResult> =>
  poExec(PROC.setPoTerms, {
    p_po_header_id: poHeaderId,
    p_json: clauses.map(c => ({ termId: c.termId, title: c.title.trim(), text: c.text.trim() })),
  }, user);

/** Clauses with merge fields filled in, as printed. */
export const printableClauses = (clauses: PoClause[], ctx: MergeContext) =>
  clauses.map(c => ({ title: fillMergeFields(c.title, ctx), text: fillMergeFields(c.text, ctx) }));

/** Problems that stop a clause from being saved. */
export const clauseProblems = (c: Pick<PoClause, 'title' | 'text'>) => {
  const p: string[] = [];
  if (!c.title.trim()) p.push('Title is required');
  if (byteLength(c.title) > 240) p.push('Title is longer than 240 characters');
  if (!c.text.trim()) p.push('Text is required');
  if (byteLength(c.text) > MAX_CLAUSE_BYTES) p.push(`Text is longer than ${MAX_CLAUSE_BYTES} bytes`);
  return p;
};

/** Split one long text into clauses: numbered / bulleted items, else paragraphs. */
export const splitProposal = (text: string): { title: string; text: string }[] => {
  const norm = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!norm) return [];
  const marker = /^\s*(?:\(?\d{1,2}[.)]|\(?[a-z][.)](?=\s)|[•\-–*](?=\s))\s*/i;
  const lines = norm.split('\n');
  let parts: string[];
  if (lines.filter(l => marker.test(l)).length >= 2) {
    parts = [];
    lines.forEach(l => {
      if (marker.test(l) || !parts.length) parts.push(l.replace(marker, ''));
      else parts[parts.length - 1] += `\n${l}`;
    });
  } else {
    parts = norm.split(/\n\s*\n/);
  }
  return parts.map(p => p.trim()).filter(Boolean).map((p, i) => {
    const [first, ...rest] = p.split('\n');
    // a short first line without a full stop is a heading
    if (rest.length && first.length <= 80 && !/[.;]\s*$/.test(first)) return { title: first.replace(/[:\-–]\s*$/, '').trim(), text: rest.join('\n').trim() };
    const head = /^(.{3,80}?)(?::|\s[-–]\s)\s*(.+)$/s.exec(p);   // "Delivery: goods must …"
    if (head) { const t = head[2].trim(); return { title: head[1].trim(), text: t.charAt(0).toUpperCase() + t.slice(1) }; }
    const words = p.split(/\s+/).slice(0, 6).join(' ');
    return { title: `${words.replace(/[,.;:]$/, '')}${p.split(/\s+/).length > 6 ? '…' : ''}` || `Clause ${i + 1}`, text: p };
  });
};
