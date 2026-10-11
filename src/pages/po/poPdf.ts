// Purchasing-RR — printable purchase order (jsPDF + autotable).
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAppBranding } from '../../config/company.config';
import { Row, money, qty, day, n } from '../../services/po.service';
import { parseRichBlocks, type RichRun } from '../../components/RichText/richText';
import { drawBrandHeader, hexToRgb, textOn, type ReportBrand } from '../../services/reportBranding.service';

/**
 * Draw rich clause text (HTML subset or plain text) with wrapping, bold / italic / underline / strike,
 * bullets, numbering, indents and alignment. Calls newPage() when the page is full; returns the next y.
 */
export function drawRichText(doc: jsPDF, html: string, o: {
  x: number; y: number; width: number; bottom: number; fontSize?: number; lineHeight?: number; newPage: () => number;
}): number {
  const fs = o.fontSize ?? 9;
  const lh = o.lineHeight ?? Math.round(fs * 1.25 * 10) / 10;
  let y = o.y;
  const fontOf = (r: RichRun) => (r.b && r.i ? 'bolditalic' : r.b ? 'bold' : r.i ? 'italic' : 'normal');
  const width = (t: string, r: RichRun) => { doc.setFont('helvetica', fontOf(r)); doc.setFontSize(fs); return doc.getTextWidth(t); };
  for (const b of parseRichBlocks(html)) {
    if (b.blank) { y += lh * 0.7; continue; }
    const indent = Math.max(0, b.level - (b.list ? 1 : 0)) * 16;
    const prefix = b.list === 'ul' ? (b.level > 1 ? '-' : '\u2022') : b.list === 'ol' ? `${b.index}.` : '';
    const textX = o.x + indent + (prefix ? 14 : 0);
    const avail = Math.max(40, o.width - (textX - o.x));
    // words with their style; '\n' forces a line break
    type Tok = { t: string; r: RichRun; w: number; br?: boolean; space?: boolean };
    const toks: Tok[] = [];
    b.runs.forEach(r => r.text.split(/(\n| +)/).forEach(part => {
      if (!part) return;
      if (part === '\n') toks.push({ t: '', r, w: 0, br: true });
      else if (/^ +$/.test(part)) toks.push({ t: ' ', r, w: width(' ', r), space: true });
      else {
        // a word wider than the line is cut into pieces
        let rest = part;
        while (rest) {
          let cut = rest.length;
          while (cut > 1 && width(rest.slice(0, cut), r) > avail) cut = Math.floor(cut * 0.8);
          toks.push({ t: rest.slice(0, cut), r, w: width(rest.slice(0, cut), r) });
          rest = rest.slice(cut);
        }
      }
    }));
    const lines: Tok[][] = [[]];
    let lw = 0;
    toks.forEach(k => {
      const line = lines[lines.length - 1];
      if (k.br) { lines.push([]); lw = 0; return; }
      if (k.space && !line.length) return;                      // no space at the start of a line
      if (lw + k.w > avail && line.length && !k.space) { lines.push([k]); lw = k.w; return; }
      line.push(k); lw += k.w;
    });
    lines.forEach((line, li) => {
      while (line.length && line[line.length - 1].space) line.pop();
      if (y + lh > o.bottom) y = o.newPage();
      const total = line.reduce((s2, k) => s2 + k.w, 0);
      let cx = textX + (b.align === 'center' ? (avail - total) / 2 : b.align === 'right' ? avail - total : 0);
      if (li === 0 && prefix) {
        doc.setFont('helvetica', b.list === 'ol' ? 'bold' : 'normal'); doc.setFontSize(fs);
        doc.text(prefix, o.x + indent, y);
      }
      line.forEach(k => {
        doc.setFont('helvetica', fontOf(k.r)); doc.setFontSize(fs);
        if (k.t.trim()) doc.text(k.t, cx, y);
        if (k.r.u) { doc.setLineWidth(0.5); doc.line(cx, y + 1.5, cx + k.w, y + 1.5); }
        if (k.r.s) { doc.setLineWidth(0.5); doc.line(cx, y - fs * 0.3, cx + k.w, y - fs * 0.3); }
        cx += k.w;
      });
      y += lh;
    });
    y += 2;
  }
  doc.setFont('helvetica', 'normal');
  return y;
}

/** One printed clause (merge fields already filled in). */
export interface PrintClause { title: string; text: string }

export function buildPoPdf(h: Row, lines: Row[], extra: {
  buName?: string;
  /** numbered clauses, or one block of text (old single-text terms) */
  terms?: PrintClause[] | string | null;
  shipTo?: Row | null; billTo?: Row | null;
  /** logo and company details of the business unit (Purchasing → Report Branding) */
  brand?: ReportBrand | null;
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const red = hexToRgb(extra.brand?.accentColor);    // brand colour (default Re-ERP red)
  const onRed = textOn(red);

  doc.setFillColor(...red);
  doc.rect(0, 0, W, 6, 'F');
  // left: logo, company name, address, TRN, contacts — right: title and order details
  const brandBottom = drawBrandHeader(doc, extra.brand, {
    x: M, y: 22, maxWidth: W - 2 * M - 250, fallbackName: extra.buName || getAppBranding().name,
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20); doc.setTextColor(...red);
  doc.text('PURCHASE ORDER', W - M, 44, { align: 'right' });
  doc.setTextColor(0); doc.setFontSize(10); doc.setFont('helvetica', 'normal');

  const meta: [string, string][] = [
    ['PO number', `${h.PO_NUMBER}${n(h.REVISION_NUM) > 0 ? `  (Rev ${h.REVISION_NUM})` : ''}`],
    ['Date', day(h.APPROVED_DATE || h.CREATION_DATE)],
    ['Buyer', String(h.BUYER_USER || '')],
    ['Currency', String(h.CURRENCY_CODE || '')],
    ['Payment terms', String(h.PAYMENT_TERMS || '')],
  ];
  let y = 64;
  meta.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(k, W - 230, y);
    doc.setFont('helvetica', 'normal'); doc.text(v, W - M, y, { align: 'right' });
    y += 14;
  });
  if (h.DOCUMENT_STATUS !== 'APPROVED') {
    doc.setTextColor(200); doc.setFontSize(60); doc.setFont('helvetica', 'bold');
    doc.text('DRAFT', W / 2, 420, { align: 'center', angle: 30 });
    doc.setTextColor(0); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  }

  const addr = (r: Row | null | undefined) => r
    ? [r.LOCATION_NAME, r.ADDRESS_LINE1, r.ADDRESS_LINE2, [r.CITY, r.COUNTRY].filter(Boolean).join(', ')].filter(Boolean).join('\n')
    : '';
  const box = (title: string, body: string, x: number, top: number, w: number) => {
    doc.setFillColor(245, 245, 245); doc.rect(x, top, w, 16, 'F');
    doc.setFont('helvetica', 'bold'); doc.text(title, x + 6, top + 11);
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(body || '—', w - 12), x + 6, top + 30);
  };
  const top = Math.max(y, brandBottom + 4, 140) + 6;
  const bw = (W - 2 * M - 20) / 3;
  box('Supplier', [h.SUPPLIER_NAME, h.SITE_NAME, h.SUPPLIER_ADDRESS, h.TAX_REGISTRATION_NUMBER ? `TRN ${h.TAX_REGISTRATION_NUMBER}` : '',
    h.SUPPLIER_CONTACT ? `Attn: ${h.SUPPLIER_CONTACT}` : ''].filter(Boolean).join('\n'), M, top, bw);
  box('Ship to', addr(extra.shipTo) || String(h.SHIP_TO_NAME || ''), M + bw + 10, top, bw);
  box('Bill to', addr(extra.billTo) || String(h.BILL_TO_NAME || ''), M + 2 * (bw + 10), top, bw);

  const live = lines.filter(l => l.LINE_STATUS !== 'CANCELLED');
  autoTable(doc, {
    startY: top + 100,
    margin: { left: M, right: M },
    head: [['#', 'Description', 'Need by', 'Qty', 'UOM', 'Unit price', 'Amount']],
    body: live.map(l => [
      String(l.LINE_NUM),
      `${l.ITEM_DESCRIPTION}${l.SUPPLIER_ITEM_NUM ? `\nSupplier item: ${l.SUPPLIER_ITEM_NUM}` : ''}${l.NOTE_TO_SUPPLIER ? `\n${l.NOTE_TO_SUPPLIER}` : ''}`,
      day(l.NEED_BY_DATE),
      l.LINE_TYPE === 'QUANTITY' ? qty(n(l.QUANTITY) - n(l.QUANTITY_CANCELLED)) : '',
      l.LINE_TYPE === 'QUANTITY' ? String(l.UOM_CODE || '') : '',
      l.LINE_TYPE === 'QUANTITY' ? money(l.UNIT_PRICE, 2) : '',
      money(n(l.AMOUNT) - n(l.AMOUNT_CANCELLED)),
    ]),
    headStyles: { fillColor: red, textColor: onRed, fontSize: 9 },
    bodyStyles: { fontSize: 9, valign: 'top' },
    columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 62 }, 3: { halign: 'right', cellWidth: 46 }, 4: { cellWidth: 36 },
      5: { halign: 'right', cellWidth: 70 }, 6: { halign: 'right', cellWidth: 80 } },
    foot: [['', '', '', '', '', 'Total', `${money(live.reduce((s, l) => s + n(l.AMOUNT) - n(l.AMOUNT_CANCELLED), 0))} ${h.CURRENCY_CODE}`]],
    footStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold', halign: 'right' },
  });
  let fy = (doc as any).lastAutoTable.finalY + 20;
  const para = (title: string, text: string) => {
    if (!text) return;
    const parts = doc.splitTextToSize(text, W - 2 * M);
    if (fy + 30 + parts.length * 12 > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); fy = 50; }
    doc.setFont('helvetica', 'bold'); doc.text(title, M, fy); fy += 14;
    doc.setFont('helvetica', 'normal'); doc.text(parts, M, fy); fy += parts.length * 12 + 10;
  };
  para('Notes', String(h.NOTE_TO_SUPPLIER || ''));

  // ── terms and conditions: numbered clauses that flow across pages ──
  const clauses: PrintClause[] = typeof extra.terms === 'string'
    ? (extra.terms.trim() ? [{ title: '', text: extra.terms.trim() }] : [])
    : (extra.terms || []).filter(c => (c.title || '').trim() || (c.text || '').trim());
  if (clauses.length) {
    const H = doc.internal.pageSize.getHeight();
    const bottom = H - 46;
    const lh = 11;
    const indent = clauses.length > 1 || clauses[0].title ? 16 : 0;
    const heading = (cont: boolean) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...red);
      doc.text(cont ? 'TERMS AND CONDITIONS (continued)' : 'TERMS AND CONDITIONS', M, fy);
      doc.setDrawColor(...red); doc.setLineWidth(0.8); doc.line(M, fy + 4, W - M, fy + 4);
      doc.setTextColor(0); doc.setFontSize(9); fy += 18;
    };
    const newPage = () => { doc.addPage(); fy = 50; heading(true); };
    if (fy + 90 > bottom) { doc.addPage(); fy = 50; } else fy += 6;
    heading(false);
    clauses.forEach((c, i) => {
      const title = (c.title || '').trim();
      // keep a clause title with at least two lines of its text
      if (fy + (title ? 13 : 0) + 2 * lh > bottom) newPage();
      if (title || indent) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.text(`${i + 1}.`, M, fy);
        if (title) { doc.text(doc.splitTextToSize(title, W - 2 * M - indent)[0], M + indent, fy); fy += 13; }
      }
      // clause text: rich (bold, lists, alignment …) or plain, wrapped and continued on new pages
      fy = drawRichText(doc, (c.text || '').trim(), { x: M + indent, y: fy, width: W - 2 * M - indent, bottom, fontSize: 9, lineHeight: lh,
        newPage: () => { newPage(); return fy; } });
      fy += 5;
    });
  }

  const pages: number = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${h.PO_NUMBER} · page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
    doc.text(extra.brand?.displayName || `${getAppBranding().name} Purchasing`, M, doc.internal.pageSize.getHeight() - 20);
  }
  return doc;
}
