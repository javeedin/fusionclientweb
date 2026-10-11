// Rich text for stored clauses (terms and conditions …): a small, safe HTML subset.
//   Allowed: <p> <div> <br> <b>/<strong> <i>/<em> <u> <s> <ul> <ol> <li> <blockquote>
//            and text-align on blocks. Everything else is dropped (pasted Word / web HTML included).
//   Plain text (older clauses) stays plain: line breaks are kept when shown or printed.
// parseRichBlocks() turns the HTML into styled blocks for jsPDF — it needs no DOM, so it also runs in tests.

export const RICH_TAGS = ['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'UL', 'OL', 'LI', 'BLOCKQUOTE'];

const RICH_RE = /<\/?(p|div|br|b|strong|i|em|u|s|strike|del|ul|ol|li|blockquote|span)\b[^>]*>/i;
/** Text holds HTML markup (else it is plain text). */
export const isRichText = (s: string | null | undefined) => RICH_RE.test(String(s || ''));

export const escapeHtml = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] !== undefined) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32);
    return m;
  });

/** Plain text → HTML (escaped, line breaks kept). */
export const plainToHtml = (s: string) => escapeHtml(String(s ?? '').replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');

/** Any clause text → HTML: rich text as is, plain text escaped. */
export const toHtml = (s: string) => (isRichText(s) ? String(s) : plainToHtml(s));

/** HTML → plain text with line breaks (list items as "• item" / "1. item"). No DOM needed. */
export function htmlToPlain(html: string): string {
  if (!isRichText(html)) return String(html ?? '');
  const lines: string[] = [];
  parseRichBlocks(html).forEach(b => {
    const text = b.runs.map(r => r.text).join('');
    const prefix = b.list === 'ul' ? '• ' : b.list === 'ol' ? `${b.index}. ` : '';
    const pad = '  '.repeat(Math.max(0, b.level - (b.list ? 1 : 0)));
    text.split('\n').forEach((l, i) => lines.push(pad + (i === 0 ? prefix : prefix ? ' '.repeat(prefix.length) : '') + l.trimEnd()));
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── sanitizing (browser) ───────────────────────────────────────────────────────
const ALIGN_RE = /text-align\s*:\s*(left|center|right|justify)/i;

/** Keep only the allowed tags / alignment; turn styled spans and headings into b / i / u; drop the rest. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return plainToHtml(htmlToPlain(html));
  const doc = new DOMParser().parseFromString(`<div>${String(html ?? '')}</div>`, 'text/html');
  const out = document.createElement('div');
  const walk = (src: Node, dst: Node) => {
    src.childNodes.forEach(n => {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.textContent || '')); return; }
      if (n.nodeType !== 1) return;
      const el = n as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IFRAME', 'OBJECT', 'svg', 'SVG', 'XML'].includes(tag) || tag.includes(':')) return;
      const style = (el.getAttribute('style') || '').toLowerCase();
      let target: Node = dst;
      const wrap = (t: string) => { const w = document.createElement(t); target.appendChild(w); target = w; };
      if (RICH_TAGS.includes(tag)) {
        const t = tag === 'STRONG' ? 'B' : tag === 'EM' ? 'I' : tag === 'STRIKE' || tag === 'DEL' ? 'S' : tag;
        const w = document.createElement(t);
        const a = ALIGN_RE.exec(style) || ALIGN_RE.exec(`text-align:${el.getAttribute('align') || ''}`);
        if (a && ['P', 'DIV', 'LI', 'BLOCKQUOTE'].includes(t)) w.setAttribute('style', `text-align: ${a[1].toLowerCase()}`);
        target.appendChild(w); target = w;
      } else if (/^H[1-6]$/.test(tag)) {
        wrap('P'); wrap('B');
      } else if (tag === 'TR') {
        wrap('DIV');
      } else if (tag === 'TD' || tag === 'TH') {
        if (el.previousElementSibling) target.appendChild(document.createTextNode('   '));
      } else if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD') {
        wrap('DIV');
      }
      // inline styling from spans / fonts (pasted Word, Google Docs)
      if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) wrap('B');
      if (/font-style\s*:\s*italic/.test(style)) wrap('I');
      if (/text-decoration[^;]*underline/.test(style)) wrap('U');
      if (/text-decoration[^;]*line-through/.test(style)) wrap('S');
      walk(el, target);
    });
  };
  walk(doc.body.firstChild || doc.body, out);
  return out.innerHTML
    .replace(/<(b|i|u|s)>\s*<\/\1>/g, '')          // empty formatting
    .replace(/(<br>\s*){3,}/g, '<br><br>')
    .trim();
}

// ── blocks for printing ───────────────────────────────────────────────────────
export interface RichRun { text: string; b: boolean; i: boolean; u: boolean; s: boolean }
export interface RichBlock {
  runs: RichRun[];
  /** list item of a bulleted (ul) or numbered (ol) list */
  list: 'ul' | 'ol' | null;
  /** number of an ol item */
  index: number;
  /** nesting (lists and blockquotes) */
  level: number;
  align: 'left' | 'center' | 'right' | 'justify';
  /** an empty paragraph (spacing line) */
  blank?: boolean;
}

/** Parse the HTML subset into blocks of styled runs ('\n' inside a run = line break). */
export function parseRichBlocks(input: string): RichBlock[] {
  const html = isRichText(input) ? String(input) : plainToHtml(input);
  const blocks: RichBlock[] = [];
  const fmt = { b: 0, i: 0, u: 0, s: 0 };
  const spanStack: string[][] = [];
  const lists: { type: 'ul' | 'ol'; n: number }[] = [];
  const alignStack: RichBlock['align'][] = ['left'];
  let quote = 0;
  const st: { cur: RichBlock | null } = { cur: null };
  const start = (list: RichBlock['list'] = null, index = 0) => {
    flush();
    st.cur = { runs: [], list, index, level: lists.length + quote, align: alignStack[alignStack.length - 1] };
  };
  const flush = () => {
    const c = st.cur;
    if (!c) return;
    st.cur = null;
    // trim spaces at the edges; a trailing <br> ends the block
    while (c.runs.length && !c.runs[0].text.replace(/^ +/, '')) c.runs.shift();
    if (c.runs.length) c.runs[0].text = c.runs[0].text.replace(/^ +/, '');
    while (c.runs.length && !c.list && !c.runs[c.runs.length - 1].text.replace(/[ \n]+$/, '')) c.runs.pop();
    if (c.runs.length) c.runs[c.runs.length - 1].text = c.runs[c.runs.length - 1].text.replace(/ +$/, '').replace(/\n$/, '');
    if (c.list || c.runs.some(r => r.text.trim())) blocks.push(c);
    else blocks.push({ ...c, runs: [], blank: true });
  };
  const add = (text: string) => {
    if (!text) return;
    if (!st.cur) start();
    const c = st.cur as RichBlock;
    const run: RichRun = { text, b: fmt.b > 0, i: fmt.i > 0, u: fmt.u > 0, s: fmt.s > 0 };
    const last = c.runs[c.runs.length - 1];
    if (last && last.b === run.b && last.i === run.i && last.u === run.u && last.s === run.s) last.text += text;
    else c.runs.push(run);
  };
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const t = decodeEntities(m[4].replace(/[\r\n\t ]+/g, ' '));
      if (t.trim() || (st.cur && st.cur.runs.length)) add(t);
      continue;
    }
    const close = m[1] === '/';
    const tag = m[2].toUpperCase();
    const attrs = m[3] || '';
    const a = ALIGN_RE.exec(attrs);
    switch (tag) {
      case 'B': case 'STRONG': fmt.b += close ? -1 : 1; break;
      case 'I': case 'EM': fmt.i += close ? -1 : 1; break;
      case 'U': fmt.u += close ? -1 : 1; break;
      case 'S': case 'STRIKE': case 'DEL': fmt.s += close ? -1 : 1; break;
      case 'SPAN': {
        if (close) { (spanStack.pop() || []).forEach(k => { (fmt as any)[k]--; }); break; }
        const st = attrs.toLowerCase(); const on: string[] = [];
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st)) on.push('b');
        if (/font-style\s*:\s*italic/.test(st)) on.push('i');
        if (/underline/.test(st)) on.push('u');
        if (/line-through/.test(st)) on.push('s');
        on.forEach(k => { (fmt as any)[k]++; });
        spanStack.push(on);
        break;
      }
      case 'BR': add('\n'); break;
      case 'P': case 'DIV': case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        if (close) { flush(); alignStack.length > 1 && alignStack.pop(); if (tag[0] === 'H') fmt.b--; }
        else { alignStack.push(a ? (a[1].toLowerCase() as RichBlock['align']) : alignStack[alignStack.length - 1]); start(); if (tag[0] === 'H') fmt.b++; }
        break;
      case 'BLOCKQUOTE':
        flush(); quote += close ? -1 : 1; quote = Math.max(0, quote);
        break;
      case 'UL': case 'OL':
        flush();
        if (close) lists.pop(); else lists.push({ type: tag === 'UL' ? 'ul' : 'ol', n: 0 });
        break;
      case 'LI':
        if (close) { flush(); break; }
        { const l = lists[lists.length - 1];
          if (l) { l.n++; start(l.type, l.n); } else start();
          if (a && st.cur) st.cur.align = a[1].toLowerCase() as RichBlock['align']; }
        break;
      default: break;
    }
  }
  flush();
  // drop leading / trailing blank lines
  while (blocks.length && blocks[0].blank) blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].blank) blocks.pop();
  return blocks;
}
