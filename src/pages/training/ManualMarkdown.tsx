// Training — renders the manual's Markdown (the subset the manual uses): headings, paragraphs, nested lists,
// tables, callouts (> 💡 / > ⚠️ / > 🔒), screenshots with zoom, and inline bold / italic / code / links.
import React from 'react';
import { Image, Typography } from 'antd';
import { manualImage, manualImageRatio } from './manualCatalog';

const { Text } = Typography;

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'list'; ordered: boolean; start: number; items: { text: string; children: Block[] }[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'quote'; text: string }
  | { t: 'img'; alt: string; src: string }
  | { t: 'hr' };

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const IMG_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const indentOf = (s: string) => s.length - s.trimStart().length;

const splitRow = (line: string) => {
  const cells: string[] = [];
  let cur = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') { cur += '|'; i++; continue; }
    if (body[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
};

export const parseBlocks = (md: string): Block[] => {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: 'p', text: para.join(' ') }); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }

    const img = IMG_LINE.exec(trimmed);
    if (img) { flush(); out.push({ t: 'img', alt: img[1], src: img[2] }); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) { flush(); out.push({ t: 'h', level: h[1].length, text: h[2] }); continue; }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { flush(); out.push({ t: 'hr' }); continue; }

    if (trimmed.startsWith('>')) {
      flush();
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { q.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      i--;
      out.push({ t: 'quote', text: q.join(' ') });
      continue;
    }

    if (trimmed.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      i--;
      const sepAt = rows.findIndex(r => r.every(c => /^:?-{2,}:?$/.test(c)));
      const head = sepAt > 0 ? rows[sepAt - 1] : rows[0];
      const body = rows.filter((_, k) => k !== sepAt && k !== (sepAt > 0 ? sepAt - 1 : 0));
      out.push({ t: 'table', head, rows: body });
      continue;
    }

    const li = LIST_ITEM.exec(line);
    if (li && indentOf(line) < 4) {
      flush();
      const base = indentOf(line);
      const ordered = /\d/.test(li[2]);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = LIST_ITEM.exec(l);
        if (!l.trim()) {
          // a blank line ends the list unless the next line is indented under it or is another item of this list
          const next = lines.slice(i + 1).find(x => x.trim());
          if (!next) break;
          const nm = LIST_ITEM.exec(next);
          const sameList = nm && indentOf(next) === base && /\d/.test(nm[2]) === ordered;
          if (!sameList && indentOf(next) <= base) break;
          items[items.length - 1]?.sub.push('');
          i++;
          continue;
        }
        if (m && indentOf(l) === base) {
          if (/\d/.test(m[2]) !== ordered) break;
          items.push({ text: m[3], sub: [] });
        } else if (indentOf(l) > base && items.length) {
          items[items.length - 1].sub.push(l.slice(Math.min(indentOf(l), base + 3)));
        } else break;
        i++;
      }
      i--;
      out.push({
        t: 'list', ordered, start: ordered ? parseInt(li[2], 10) || 1 : 1,
        items: items.map(it => {
          // plain continuation lines (not a nested list) belong to the item's first paragraph
          const firstNested = it.sub.findIndex(s => !s.trim() || LIST_ITEM.test(s) || s.trim().startsWith('|') || s.trim().startsWith('>') || IMG_LINE.test(s.trim()));
          const cont = firstNested < 0 ? it.sub : it.sub.slice(0, firstNested);
          const rest = firstNested < 0 ? [] : it.sub.slice(firstNested);
          return { text: [it.text, ...cont.map(c => c.trim())].join(' '), children: parseBlocks(rest.join('\n')) };
        }),
      });
      continue;
    }

    para.push(trimmed);
  }
  flush();
  return out;
};

// ── inline ──────────────────────────────────────────────────────────────────────────────────────
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&[a-z]+;|&#39;/g, e => ENTITIES[e] ?? e);

// order matters: code, bold (may hold *italic*), italic, link, escape
const INLINE = /(`[^`]+`)|(\*\*(?:[^*]|\*[^*]+\*)+?\*\*)|(\*[^*\s](?:[^*]*?[^*\s])?\*)|(\[[^\]]+\]\([^)]+\))|(\\[\\`*_{}[\]()#+\-.!|>~])/;

export const renderInline = (text: string, highlight?: RegExp | null, key = 'i'): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  let rest = text;
  let n = 0;
  const plain = (s: string) => {
    const t = decode(s);
    if (!highlight) { out.push(t); return; }
    t.split(highlight).forEach((part, k) => {
      if (!part) return;
      out.push(k % 2 ? <mark key={`${key}-m${n++}`} className="rr-manual-mark">{part}</mark> : part);
    });
  };
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { plain(rest); break; }
    if (m.index > 0) plain(rest.slice(0, m.index));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rr-manual-code">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{renderInline(tok.slice(2, -2), highlight, k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{renderInline(tok.slice(1, -1), highlight, k)}</em>);
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(<a key={k} href={lm[2]} target="_blank" rel="noreferrer">{renderInline(lm[1], highlight, k)}</a>);
    } else if (m[5]) out.push(tok.slice(1));
    rest = rest.slice(m.index + tok.length);
  }
  return out;
};

// ── blocks ──────────────────────────────────────────────────────────────────────────────────────
const CALLOUT: { re: RegExp; bg: string; border: string }[] = [
  { re: /^⚠️?\s*/, bg: '#FFF7E6', border: '#FFC069' },
  { re: /^💡\s*/, bg: '#E6F4FF', border: '#91CAFF' },
  { re: /^🔒\s*/, bg: '#F6FFED', border: '#95DE64' },
];

const BlockView: React.FC<{ b: Block; hl?: RegExp | null; k: string }> = ({ b, hl, k }) => {
  switch (b.t) {
    case 'p': return <p className="rr-manual-p">{renderInline(b.text, hl, k)}</p>;
    case 'h': return <div className={`rr-manual-h rr-manual-h${b.level}`}>{renderInline(b.text, hl, k)}</div>;
    case 'hr': return <hr className="rr-manual-hr" />;
    case 'quote': {
      const c = CALLOUT.find(x => x.re.test(b.text)) ?? { re: /^/, bg: '#FAFAFA', border: '#D9D9D9' };
      const icon = /^(⚠️?|💡|🔒)/.exec(b.text)?.[0];
      return (
        <div className="rr-manual-callout" style={{ background: c.bg, borderLeftColor: c.border }}>
          {icon && <span className="rr-manual-callout-icon">{icon}</span>}
          <span>{renderInline(b.text.replace(c.re, ''), hl, k)}</span>
        </div>
      );
    }
    case 'img':
      return (
        <figure className="rr-manual-figure">
          <Image src={manualImage(b.src)} alt={b.alt} loading="lazy" style={{ width: '100%', height: 'auto', aspectRatio: manualImageRatio(b.src) }}
            preview={{ mask: 'Click to zoom' }} />
          <figcaption><Text type="secondary">{b.alt}</Text></figcaption>
        </figure>
      );
    case 'table':
      return (
        <div className="rr-manual-table-wrap">
          <table className="rr-manual-table">
            <thead><tr>{b.head.map((c, j) => <th key={j}>{renderInline(c, hl, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{renderInline(c, hl, `${k}r${ri}c${j}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    case 'list': {
      const items = b.items.map((it, j) => (
        <li key={j}>
          {renderInline(it.text, hl, `${k}l${j}`)}
          {it.children.map((c, ci) => <BlockView key={ci} b={c} hl={hl} k={`${k}l${j}c${ci}`} />)}
        </li>
      ));
      return b.ordered
        ? <ol className="rr-manual-list" start={b.start}>{items}</ol>
        : <ul className="rr-manual-list">{items}</ul>;
    }
  }
};

/** Styles for the manual (scoped by class names). */
export const MANUAL_CSS = `
.rr-manual { font-size: 14px; line-height: 1.65; color: #262626; }
.rr-manual-p { margin: 0 0 12px; }
.rr-manual-h { font-weight: 600; margin: 18px 0 8px; }
.rr-manual-h2 { font-size: 20px; } .rr-manual-h3 { font-size: 16px; } .rr-manual-h4 { font-size: 14px; }
.rr-manual-list { margin: 0 0 12px; padding-left: 24px; }
.rr-manual-list li { margin: 3px 0; }
.rr-manual-list li > .rr-manual-list { margin: 4px 0 4px; }
.rr-manual-list li > .rr-manual-p { margin: 6px 0; }
.rr-manual-code { background: #F5F5F5; border: 1px solid #EBEBEB; border-radius: 4px; padding: 0 5px; font-size: 12.5px;
  font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; word-break: break-word; }
.rr-manual-callout { display: flex; gap: 10px; border-left: 4px solid; border-radius: 6px; padding: 10px 14px; margin: 4px 0 14px; }
.rr-manual-callout-icon { font-size: 16px; line-height: 1.5; }
.rr-manual-figure { margin: 6px 0 18px; }
.rr-manual-figure .ant-image { display: block; border: 1px solid #E8E8E8; border-radius: 8px; overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
.rr-manual-figure figcaption { text-align: center; font-size: 12px; margin-top: 6px; }
.rr-manual-table-wrap { overflow-x: auto; margin: 4px 0 16px; }
.rr-manual-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.rr-manual-table th, .rr-manual-table td { border: 1px solid #E8E8E8; padding: 7px 10px; text-align: left; vertical-align: top; }
.rr-manual-table th { background: #FAFAFA; font-weight: 600; }
.rr-manual-hr { border: none; border-top: 1px solid #E8E8E8; margin: 16px 0; }
.rr-manual-mark { background: #FFE58F; padding: 0 1px; border-radius: 2px; }
`;

/** Escape text for use in a highlight RegExp. */
export const highlightRegExp = (query?: string | null) => {
  const words = (query || '').split(/\s+/).map(w => w.trim()).filter(w => w.length > 1)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return words.length ? new RegExp(`(${words.join('|')})`, 'gi') : null;
};

const ManualMarkdown: React.FC<{ md: string; highlight?: RegExp | null }> = ({ md, highlight }) => {
  const blocks = React.useMemo(() => parseBlocks(md), [md]);
  return <div className="rr-manual">{blocks.map((b, i) => <BlockView key={i} b={b} hl={highlight} k={`b${i}`} />)}</div>;
};

export default ManualMarkdown;
