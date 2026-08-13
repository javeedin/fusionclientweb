import React, { useState, useCallback, useEffect, useRef, Component } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  DatePicker, InputNumber, Row, Col, Space, Tag, Tooltip, Tabs, Collapse,
  message, Empty, Divider, Badge, Modal, Upload, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, BankOutlined, PlusOutlined, SearchOutlined, ReloadOutlined,
  EditOutlined, CloseOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined,
  ApiOutlined, ReadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const APEX_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';

// ── Types ─────────────────────────────────────────────────────────────────────
interface StatementHeader {
  statementId:        number;
  statementNumber:    string;
  bankAccountNumber:  string;
  bankAccountName:    string;
  statementDate:      string;
  currencyCode:       string;
  openingBalance:     number;
  closingBalance:     number;
  totalCredits:       number;
  totalDebits:        number;
  status:             string;
  businessUnitName:   string;
  description:        string;
  creationDate:       string;
  lastUpdateDate:     string;
  totalLines?:        number;
  reconLines?:        number;
  unreconLines?:      number;
}

interface StatementLine {
  _key:               string;   // local-only row key
  lineId?:            number;
  lineNumber?:        number;
  transactionDate:    string;
  valueDate?:         string;
  amount:             number | null;
  transactionCode:    string;   // CR or DR
  categoryCode?:      string;   // from RR_TRANSACTION_CODES
  description?:       string;
  reference?:         string;
  bankTxnReference?:  string;
  counterpartyName?:  string;
  counterpartyAccount?: string;
  reconStatus?:       string;
  reconAmount?:       number;
  reconTxnType?:      string;
  reconTxnNumber?:    string;
  reconNotes?:        string;
  reconDate?:         string;
  reconBy?:           string;
}

interface BankAcctOption { label: string; value: string; bankAccountNumber?: string; currencyCode?: string; legalEntityName?: string; cashAccountCombination?: string; clearingAccountCombination?: string; }
interface BUOption       { label: string; value: string; legalEntityName?: string; }
interface TxnCodeOption  { value: string; label: string; endTransaction?: string; defaultAccountCombination?: string; }
interface PdfColMapping  { text: string; x: number; xMin: number; xMax: number; field: string; }
interface PdfTplOption   { templateId: number; templateName: string; dateFormat: string; columns: PdfColMapping[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const parseApexJson = async (res: Response) => {
  const text = await res.text();
  const fixed = text
    .replace(/:(-?)\.(\d)/g, ':$10.$2')
    .replace(/(\d)\.([,}\]])/g, '$1$2');
  return JSON.parse(fixed);
};

const fmtAmount = (v?: number | null, ccy?: string) => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return ccy ? `${s} ${ccy}` : s;
};

const fmtDate = (d?: string) => {
  if (!d) return '—';
  try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; }
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default', SUBMITTED: 'processing', RECONCILING: 'warning',
  RECONCILED: 'success', CLOSED: 'default',
};

const RECON_COLOR: Record<string, string> = {
  UNRECONCILED: 'default', RECONCILED: 'success',
  PARTIALLY_RECONCILED: 'warning', EXCLUDED: 'error',
};

let _keyCounter = 0;
const newKey = () => `row_${++_keyCounter}`;
let _tabCounter = 0;
const newTabKey = () => `tab_${++_tabCounter}`;

// ── CSV Parser ────────────────────────────────────────────────────────────────
function parseCsv(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { rows: [], errors: ['CSV must have a header row and at least one data row.'] };

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  const rows: Record<string, string>[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (parts[idx] ?? '').trim(); });
    if (!row.amount && !row.transaction_amount) { errors.push(`Row ${i}: amount is required`); continue; }
    if (!row.transaction_date && !row.date) { errors.push(`Row ${i}: transaction_date is required`); continue; }
    rows.push(row);
  }
  return { rows, errors };
}

function csvRowToLine(row: Record<string, string>): StatementLine {
  const dateStr = row.transaction_date || row.date || '';
  const amount  = parseFloat(row.amount || row.transaction_amount || '0');
  return {
    _key:              newKey(),
    transactionDate:   dateStr,
    valueDate:         row.value_date || row.valuedate || '',
    amount:            isNaN(amount) ? null : amount,
    transactionCode:   (row.transaction_code || row.type || 'CR').toUpperCase(),
    description:       row.description || row.narration || '',
    reference:         row.reference || row.ref || '',
    bankTxnReference:  row.bank_txn_reference || row.bank_ref || '',
    counterpartyName:  row.counterparty_name || row.counterparty || '',
    counterpartyAccount: row.counterparty_account || '',
    reconStatus:       'UNRECONCILED',
  };
}

// ── PDF Parser ────────────────────────────────────────────────────────────────
// Extracts text from all pages, then finds transaction rows by detecting
// the date pattern dd/mm/yyyy at the start of a line.
async function parseBankStatementPdf(file: File): Promise<{ lines: StatementLine[]; errors: string[]; log: string[] }> {
  const errors: string[] = [];
  const lines: StatementLine[] = [];
  const log: string[] = [];

  // Dynamic import so the page loads even when pdfjs-dist is not yet installed.
  // Run `npm install pdfjs-dist` if you see a "module not found" error here.
  let pdfjsLib: any;
  try {
    pdfjsLib = await import('pdfjs-dist');
    // Use CDN worker matching the installed version — avoids Vite/worker path issues
    const ver: string = pdfjsLib.version;
    const ext = ver.startsWith('3.') || ver.startsWith('2.') ? 'min.js' : 'min.mjs';
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.${ext}`;
  } catch {
    errors.push('pdfjs-dist is not installed. Run: npm install pdfjs-dist');
    return { lines, errors, log };
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
  }).promise;

  log.push(`PDF loaded: ${pdf.numPages} page(s)`);

  // Extract all text items with their x/y positions from all pages
  type TextItem = { str: string; x: number; y: number };
  const allItems: TextItem[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    // Offset Y by page index so rows from different pages never share the same Y bucket.
    // Subtract so page 1 stays highest (sorts first) and later pages go lower.
    const pageYOffset = (p - 1) * 100000;
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let pageItems = 0;
    for (const item of content.items) {
      if ('str' in item && item.str.trim()) {
        const tx = item.transform;
        allItems.push({ str: item.str.trim(), x: tx[4], y: tx[5] - pageYOffset });
        pageItems++;
      }
    }
    log.push(`  Page ${p}: ${pageItems} text item(s) extracted`);
  }

  // Group items into rows by similar Y coordinate (within 3px)
  const rowMap = new Map<number, TextItem[]>();
  for (const item of allItems) {
    const key = Math.round(item.y / 3) * 3;
    if (!rowMap.has(key)) rowMap.set(key, []);
    rowMap.get(key)!.push(item);
  }

  // Sort rows top-to-bottom (highest Y first in PDF coords)
  const sortedRows = [...rowMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.str));

  log.push(`Row grouping: ${sortedRows.length} distinct Y-rows found`);

  // Matches DD/MM/YYYY and DD-MM-YYYY (BOB, ENBD, etc.)
  const dateRe = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
  // Positive numbers only — negative balances (e.g. "-11,277,307.46") are intentionally excluded
  const amountRe = /^[\d,]+(\.\d{1,2})?$/;

  const isHeaderOrPageRow = (tokens: string[]) => {
    const joined = tokens.join(' ').toLowerCase();
    if (/transaction\s+date|value\s+date|narration|running\s+balance/.test(joined)) return true;
    if (/^\s*page\s+\d+\s+(of\s+\d+)?\s*$/i.test(joined)) return true;
    if (/^\s*\d+\s+of\s+\d+\s*$/i.test(joined)) return true;
    return false;
  };

  let rowNum = 0;
  for (const row of sortedRows) {
    rowNum++;
    const rowPreview = row.slice(0, 6).join(' | ');
    const first = row[0] ?? '';
    const dm = first.match(dateRe);

    // ── Continuation row (no date, no amounts) → stitch narration to last line ──
    if (!dm) {
      if (isHeaderOrPageRow(row)) {
        log.push(`  Row ${rowNum}: [HEADER/PAGE] "${rowPreview}"`);
        continue;
      }
      const amtCount = row.filter(t => amountRe.test(t.replace(/,/g, ''))).length;
      const text = row.join(' ').trim();
      if (lines.length > 0 && amtCount === 0 && text.length > 2) {
        lines[lines.length - 1].description =
          (lines[lines.length - 1].description + ' ' + text).trim();
        log.push(`  Row ${rowNum}: [NARRATION+] appended to prev → "${text.slice(0, 60)}"`);
      } else {
        log.push(`  Row ${rowNum}: [SKIP no-date] "${rowPreview}"`);
      }
      continue;
    }

    // Parse date
    const txDate = dayjs(`${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`);
    if (!txDate.isValid()) {
      log.push(`  Row ${rowNum}: [SKIP bad-date] first="${first}"`);
      continue;
    }

    // Collect remaining tokens (skip an immediately-following value date if present)
    let rest = row.slice(1);
    if (rest.length > 0 && dateRe.test(rest[0])) rest = rest.slice(1);

    // Identify positive amount tokens
    const amountIdxs = rest
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => amountRe.test(v.replace(/,/g, '')));

    if (amountIdxs.length < 1) {
      log.push(`  Row ${rowNum}: [SKIP no-amounts] date=${txDate.format('DD/MM/YYYY')} tokens="${rest.join(' | ')}"`);
      continue;
    }

    let txAmt: number;
    let txCode: string;
    let amtReason: string;

    if (amountIdxs.length >= 3) {
      // Layout: [DR_col, CR_col, Balance] — third-to-last is DR, second-to-last is CR
      const drVal = parseFloat(amountIdxs[amountIdxs.length - 3].v.replace(/,/g, ''));
      const crVal = parseFloat(amountIdxs[amountIdxs.length - 2].v.replace(/,/g, ''));
      if (drVal > 0 && crVal === 0) {
        txAmt = drVal; txCode = 'DR'; amtReason = `3-col DR=${drVal} CR=0`;
      } else if (crVal > 0 && drVal === 0) {
        txAmt = crVal; txCode = 'CR'; amtReason = `3-col DR=0 CR=${crVal}`;
      } else {
        txAmt = crVal || drVal;
        txCode = drVal > 0 ? 'DR' : 'CR';
        amtReason = `3-col both-nonzero DR=${drVal} CR=${crVal}`;
      }
    } else if (amountIdxs.length === 2) {
      const a0 = parseFloat(amountIdxs[0].v.replace(/,/g, ''));
      const a1 = parseFloat(amountIdxs[1].v.replace(/,/g, ''));
      if (a0 > 0 && a1 === 0) {
        txAmt = a0; txCode = 'DR'; amtReason = `2-amt [${a0},0] → DR`;
      } else if (a0 === 0 && a1 > 0) {
        txAmt = a1; txCode = 'CR'; amtReason = `2-amt [0,${a1}] → CR`;
      } else {
        txAmt = a0;
        const rowText = rest.join(' ').toUpperCase();
        txCode = (rowText.includes('WITHDRAWAL') || rowText.includes('DEBIT') || rowText.endsWith('DR'))
          ? 'DR' : 'CR';
        amtReason = `2-amt both-nonzero [${a0},${a1}] keyword→${txCode}`;
      }
    } else {
      txAmt = parseFloat(amountIdxs[0].v.replace(/,/g, ''));
      txCode = 'CR'; amtReason = `1-amt ${txAmt} default→CR`;
    }

    if (isNaN(txAmt) || txAmt === 0) {
      log.push(`  Row ${rowNum}: [SKIP zero-amt] date=${txDate.format('DD/MM/YYYY')} amounts=[${amountIdxs.map(a=>a.v).join(',')}]`);
      continue;
    }

    const descEnd = amountIdxs[0].i;
    const description = rest.slice(0, descEnd).join(' ');
    const ref = rest.find(t => /^\d{1,8}$/.test(t)) ?? '';

    log.push(`  Row ${rowNum}: [OK] ${txDate.format('DD/MM/YYYY')} ${txCode} ${txAmt.toLocaleString()} | ${amtReason} | desc="${(description||first).slice(0,50)}"`);

    lines.push({
      _key:            newKey(),
      transactionDate: txDate.format('YYYY-MM-DD'),
      valueDate:       '',
      amount:          txAmt,
      transactionCode: txCode,
      description:     description || first,
      reference:       ref,
      bankTxnReference: '',
      counterpartyName: '',
      counterpartyAccount: '',
      reconStatus:     'UNRECONCILED',
    });
  }

  log.push(`Done: ${lines.length} transaction(s) parsed, ${errors.length} error(s)`);

  if (lines.length === 0 && errors.length === 0) {
    errors.push('No transaction rows found. The PDF layout may not match the expected format.');
  }

  return { lines, errors, log };
}

// ── Template-based PDF parser ─────────────────────────────────────────────────
function parseDateStr(str: string, fmt: string): dayjs.Dayjs | null {
  const s = str.trim();
  if (fmt === 'DD/MM/YYYY' || fmt === 'DD-MM-YYYY') {
    // Accept both / and - separators regardless of which the format string specifies
    for (const sep of ['/', '-']) {
      const re = new RegExp(`^(\\d{1,2})\\${sep}(\\d{1,2})\\${sep}(\\d{4})$`);
      const m = s.match(re);
      if (m) return dayjs(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    }
  } else if (fmt === 'MM/DD/YYYY') {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return dayjs(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`);
  } else if (fmt === 'D-MMM-YYYY' || fmt === 'DD-MMM-YYYY') {
    const months: Record<string,string> = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (m) { const mo = months[m[2].toLowerCase()]; if (mo) return dayjs(`${m[3]}-${mo}-${m[1].padStart(2,'0')}`); }
  } else if (fmt === 'YYYY-MM-DD') {
    const d = dayjs(s); if (d.isValid()) return d;
  }
  const d = dayjs(s); return d.isValid() ? d : null;
}

async function parseBankStatementPdfWithTemplate(
  file: File,
  template: PdfTplOption | null,
): Promise<{ lines: StatementLine[]; errors: string[]; log: string[] }> {
  if (!template) return parseBankStatementPdf(file);

  const errors: string[] = [];
  const lines:  StatementLine[] = [];
  const log:    string[] = [];

  let pdfjsLib: any;
  try {
    pdfjsLib = await import('pdfjs-dist');
    const ver: string = pdfjsLib.version;
    const ext = ver.startsWith('3.') || ver.startsWith('2.') ? 'min.js' : 'min.mjs';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.${ext}`;
  } catch {
    errors.push('pdfjs-dist is not installed. Run: npm install pdfjs-dist');
    return { lines, errors, log };
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, useSystemFonts: true }).promise;
  log.push(`PDF loaded: ${pdf.numPages} page(s) | Template: ${template.templateName} | DateFmt: ${template.dateFormat}`);

  type TItem = { str: string; x: number; y: number };
  const allItems: TItem[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pageYOffset = (p - 1) * 100000;
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let pageItems = 0;
    for (const item of content.items) {
      if ('str' in item && item.str.trim()) {
        const tx = item.transform;
        allItems.push({ str: item.str.trim(), x: tx[4], y: tx[5] - pageYOffset });
        pageItems++;
      }
    }
    log.push(`  Page ${p}: ${pageItems} text item(s) extracted`);
  }

  const rowMap = new Map<number, TItem[]>();
  for (const item of allItems) {
    const key = Math.round(item.y / 3) * 3;
    if (!rowMap.has(key)) rowMap.set(key, []);
    rowMap.get(key)!.push(item);
  }

  const sortedRows = [...rowMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x));

  log.push(`Row grouping: ${sortedRows.length} distinct Y-rows`);
  log.push(`Column mappings: ${template.columns.map(c => `${c.field}(x${Math.round(c.xMin)}-${Math.round(c.xMax)})`).join(', ')}`);

  const dateCol    = template.columns.find(c => c.field === 'date');
  const narCol     = template.columns.find(c => c.field === 'narration');
  const amtRe      = /^[\d,]+(\.\d{1,2})?$/;
  const isHdrOrPg  = (tokens: { str: string }[]) => {
    const j = tokens.map(t => t.str).join(' ').toLowerCase();
    return /transaction\s+date|value\s+date|narration|running\s+balance|transaction\s+running|date\s+balance/.test(j)
      || /^\s*page\s+\d/.test(j) || /^\d+\s+of\s+\d+/.test(j);
  };
  const isNonNarration = (text: string) =>
    /^-[\d,]+(\.\d+)?$/.test(text.trim()) || text.includes('@') ||
    /^https?:\/\/|^www\./i.test(text) || /^Tel[\s:+]/i.test(text) || /^Timings?:/i.test(text);
  const splitAmts = (str: string): number[] =>
    str.trim().split(/\s+/).map(s => parseFloat(s.replace(/,/g, ''))).filter(n => !isNaN(n) && n >= 0);

  let rowNum = 0;
  let lastDateRowFailed = false;
  let inFooter = false;
  let pendingNarration = ''; // narration row that appeared ABOVE the next date row

  // Helper: does this row have a parseable date in the date column?
  const rowHasDate = (r: typeof sortedRows[0]) => {
    const di = dateCol ? r.find(it => it.x >= dateCol.xMin && it.x <= dateCol.xMax) : r[0];
    return !!(di && parseDateStr(di.str, template.dateFormat)?.isValid());
  };

  for (let ri = 0; ri < sortedRows.length; ri++) {
    const row = sortedRows[ri];
    rowNum++;
    const rowPreview = row.map(i => i.str).slice(0, 5).join(' | ');

    // Find date value in the date-column X range
    const dateItem = dateCol
      ? row.find(it => it.x >= dateCol.xMin && it.x <= dateCol.xMax)
      : row[0];

    // No date → possible narration continuation row
    if (!dateItem || !parseDateStr(dateItem.str, template.dateFormat)?.isValid()) {
      if (isHdrOrPg(row)) {
        log.push(`  Row ${rowNum}: [HEADER/PAGE] "${rowPreview}"`);
        continue;
      }
      // Detect footer markers — once seen, stop all narration stitching
      const rowJoined = row.map(t => t.str).join(' ');
      if (!inFooter && /closing\s+balance|transaction\s+total|end\s+of\s+statement/i.test(rowJoined)) {
        inFooter = true;
      }
      if (inFooter) {
        log.push(`  Row ${rowNum}: [FOOTER] "${rowPreview}"`);
        continue;
      }
      const amtItems = row.filter(it => amtRe.test(it.str.replace(/,/g, '')));
      if (amtItems.length === 0) {
        const narItems = narCol
          ? row.filter(it => it.x >= narCol.xMin && it.x <= narCol.xMax)
          : [];
        const candidates = narItems.length > 0 ? narItems : row;
        const extra = candidates
          .map(i => i.str)
          .filter(s => !parseDateStr(s, template.dateFormat)?.isValid())
          .join(' ').trim();
        if (extra.length > 2 && !isNonNarration(extra)) {
          // Look-ahead: if the NEXT row is a date row, this text belongs to that
          // transaction (pre-narration), not the previous one (post-narration)
          const nextRow = sortedRows[ri + 1];
          if (nextRow && rowHasDate(nextRow)) {
            pendingNarration = (pendingNarration + ' ' + extra).trim();
            log.push(`  Row ${rowNum}: [NARRATION>] (pre-narration for next txn) "${extra.slice(0, 60)}"`);
            continue;
          }
          // Post-narration: stitch to previous transaction
          if (lines.length > 0 && !lastDateRowFailed) {
            lines[lines.length - 1].description =
              (lines[lines.length - 1].description + ' ' + extra).trim();
            log.push(`  Row ${rowNum}: [NARRATION+] "${extra.slice(0, 60)}"`);
            continue;
          }
        }
      }
      const noDate = dateItem ? `date-col="${dateItem.str}" not parseable` : `no item in date-col x${Math.round(dateCol?.xMin ?? 0)}-${Math.round(dateCol?.xMax ?? 0)}`;
      log.push(`  Row ${rowNum}: [SKIP] ${noDate} | "${rowPreview}"`);
      continue;
    }

    const txDate = parseDateStr(dateItem.str, template.dateFormat)!;

    // Bucket items into their column fields; collect skip-zone text separately
    const bucket: Record<string, string> = {};
    const skipZoneText: string[] = [];
    for (const item of row) {
      const col = template.columns.find(c => item.x >= c.xMin && item.x <= c.xMax);
      if (col && col.field !== 'skip') {
        bucket[col.field] = bucket[col.field] ? bucket[col.field] + ' ' + item.str : item.str;
      } else if (col?.field === 'skip') {
        skipZoneText.push(item.str);
      }
    }

    // Narration fallback 1: pending pre-narration from the row above
    if (!bucket['narration'] && pendingNarration) {
      bucket['narration'] = pendingNarration;
    }
    pendingNarration = '';

    // Narration fallback 2: skip-zone non-amount text
    if (!bucket['narration'] && skipZoneText.length > 0) {
      const fb = skipZoneText
        .filter(s => !parseDateStr(s, template.dateFormat)?.isValid() && !amtRe.test(s.replace(/,/g, '')))
        .join(' ').trim();
      if (fb.length > 1) bucket['narration'] = fb;
    }

    // Narration fallback 3: any non-amount, non-date, non-skip item on the row
    // that didn't land in the narration bucket (catches misaligned Particulars text)
    if (!bucket['narration']) {
      const ignoreFields = new Set(['date', 'valueDate', 'balance', 'skip']);
      const fb = row
        .filter(it => {
          const col = template.columns.find(c => it.x >= c.xMin && it.x <= c.xMax);
          if (!col || ignoreFields.has(col.field)) return false;
          if (amtRe.test(it.str.replace(/,/g, ''))) return false;
          if (parseDateStr(it.str, template.dateFormat)?.isValid()) return false;
          return true;
        })
        .map(it => it.str)
        .join(' ').trim();
      if (fb.length > 1 && !isNonNarration(fb)) bucket['narration'] = fb;
    }

    // Resolve amount and CR/DR direction
    let amount: number | null = null;
    let txCode = 'CR';
    let amtReason = '';
    const amtStr = (bucket['amount']     ?? '').replace(/,/g, '');
    const typStr = (bucket['type']       ?? '').trim().toUpperCase();

    const wdAmts  = splitAmts(bucket['withdrawal'] ?? '');
    const depAmts = splitAmts(bucket['deposit']    ?? '');
    const wdVal   = wdAmts.find(v => v > 0) ?? 0;

    if (wdVal > 0) {
      amount = wdVal; txCode = 'DR'; amtReason = `withdrawal=${wdVal}`;
    } else if (depAmts.length >= 2) {
      // Two numbers in deposit bucket: one is Debit column, one is Credit column
      // Whichever is non-zero (and not the other) determines direction
      const nonZero = depAmts.filter(v => v > 0);
      const zeroIdx = depAmts.findIndex(v => v === 0);
      const nonZeroIdx = depAmts.findIndex(v => v > 0);
      if (nonZero.length === 1) {
        amount = nonZero[0];
        // first value non-zero, second zero → Debit (DR); first zero, second non-zero → Credit (CR)
        txCode = nonZeroIdx < zeroIdx ? 'DR' : 'CR';
        amtReason = `deposit-split=[${depAmts.join(',')}] idx=${nonZeroIdx}→${txCode}`;
      } else if (nonZero.length >= 2) {
        // Both non-zero — take last (credit column) as CR
        amount = depAmts[depAmts.length - 1]; txCode = 'CR';
        amtReason = `deposit-split-both=[${depAmts.join(',')}]→CR`;
      }
    } else if (depAmts.length === 1 && depAmts[0] > 0) {
      amount = depAmts[0]; txCode = 'CR'; amtReason = `deposit=${depAmts[0]}`;
    } else if (amtStr && amtRe.test(amtStr)) {
      amount = parseFloat(amtStr);
      txCode = typStr.startsWith('D') ? 'DR' : 'CR';
      amtReason = `amount=${amtStr} type="${typStr}"→${txCode}`;
    }

    if (!amount) {
      lastDateRowFailed = true;
      log.push(`  Row ${rowNum}: [SKIP no-amount] date=${txDate.format('DD/MM/YYYY')} bucket=${JSON.stringify(bucket).slice(0, 100)}`);
      continue;
    }

    lastDateRowFailed = false;
    log.push(`  Row ${rowNum}: [OK] ${txDate.format('DD/MM/YYYY')} ${txCode} ${amount.toLocaleString()} | ${amtReason} | narration="${(bucket['narration']??'').slice(0,50)}"`);

    lines.push({
      _key:            newKey(),
      transactionDate: txDate.format('YYYY-MM-DD'),
      valueDate:       bucket['valueDate'] ? (parseDateStr(bucket['valueDate'], template.dateFormat)?.format('YYYY-MM-DD') ?? '') : '',
      amount,
      transactionCode: txCode,
      description:     bucket['narration'] ?? '',
      reference:       bucket['reference'] ?? '',
      bankTxnReference: '',
      counterpartyName: '',
      counterpartyAccount: '',
      reconStatus:     'UNRECONCILED',
    });
  }

  log.push(`Done: ${lines.length} transaction(s) parsed, ${errors.length} error(s)`);

  if (lines.length === 0 && errors.length === 0)
    errors.push('No transaction rows found using this template. Check that the column mappings match the PDF.');

  return { lines, errors, log };
}

// ── StatementForm ─────────────────────────────────────────────────────────────
const StatementForm: React.FC<{
  initialHeader?:  Partial<StatementHeader>;
  initialLines?:   StatementLine[];
  bankAccounts:    BankAcctOption[];
  businessUnits:   BUOption[];
  onSave:          () => void;
  onCreated:       (statementId: number) => void;
  onCancel:        () => void;
}> = ({ initialHeader, initialLines, bankAccounts, businessUnits, onSave, onCreated, onCancel }) => {
  const [form]    = Form.useForm();
  const [lines, setLines]       = useState<StatementLine[]>(initialLines ?? []);
  const [saving, setSaving]     = useState(false);
  const [csvModal, setCsvModal] = useState(false);
  const [csvText, setCsvText]   = useState('');
  const [csvPreview, setCsvPreview] = useState<StatementLine[]>([]);
  const [csvErrors, setCsvErrors]   = useState<string[]>([]);
  // PDF import state
  const [pdfModal, setPdfModal]         = useState(false);
  const [pdfParsing, setPdfParsing]     = useState(false);
  const [pdfPreview, setPdfPreview]     = useState<StatementLine[]>([]);
  const [pdfErrors, setPdfErrors]       = useState<string[]>([]);
  const [pdfLog, setPdfLog]             = useState<string[]>([]);
  const [pdfFileName, setPdfFileName]   = useState('');
  const [pdfSelKeys, setPdfSelKeys]     = useState<string[]>([]);
  const [pdfApiOpen, setPdfApiOpen]     = useState(false);
  const [pdfApiPayload, setPdfApiPayload] = useState('');
  const [pdfApiResponse, setPdfApiResponse] = useState<{ status: number; body: string } | null>(null);
  const [pdfApiPosting, setPdfApiPosting]   = useState(false);
  const [pdfImporting, setPdfImporting]     = useState(false);
  const [pdfBatchLog, setPdfBatchLog]       = useState<{ batch: number; total: number; saved: number; raw: string; ok: boolean }[]>([]);
  const [pdfBatchProgress, setPdfBatchProgress] = useState(0);
  const [pdfGetRunning, setPdfGetRunning]   = useState(false);
  const [pdfGetResponse, setPdfGetResponse] = useState<string | null>(null);
  const [selectedBu, setSelectedBu] = useState<string | undefined>(initialHeader?.businessUnitName);
  const [txnCodes, setTxnCodes]         = useState<TxnCodeOption[]>([]);
  const [balanceTick, setBalanceTick]   = useState(0);
  const [pdfTemplates, setPdfTemplates] = useState<PdfTplOption[]>([]);
  const [pdfTplModal, setPdfTplModal]   = useState(false);
  const [pdfSearch,   setPdfSearch]     = useState('');
  const [selectedTplId, setSelectedTplId] = useState<number | null>(null);
  const [apiModal, setApiModal]       = useState(false);
  const [apiPayload, setApiPayload]   = useState('');
  const [apiPosting, setApiPosting]   = useState(false);
  const [apiResponse, setApiResponse] = useState<{ status: number; body: string } | null>(null);
  const [getApiModal, setGetApiModal] = useState(false);
  const [getApiRunning, setGetApiRunning] = useState(false);
  const [getApiResponse, setGetApiResponse] = useState<{ status: number; body: string } | null>(null);
  const [refreshingLines, setRefreshingLines] = useState(false);
  const fileRef    = useRef<HTMLInputElement>(null);
  const pdfFileRef = useRef<HTMLInputElement>(null);
  const isEdit  = !!initialHeader?.statementId;

  // GL accounts for the currently selected bank account (resolved on mount for edit, or on selection)
  const [selBankGl, setSelBankGl] = useState<{ cash: string; clearing: string }>(() => {
    if (initialHeader?.bankAccountName) {
      const a = bankAccounts.find(x => x.value === initialHeader.bankAccountName);
      return { cash: a?.cashAccountCombination ?? '', clearing: a?.clearingAccountCombination ?? '' };
    }
    return { cash: '', clearing: '' };
  });

  const buildPayload = (hdrValues: any) => ({
    header: {
      statementId:      initialHeader?.statementId,
      statementNumber:  hdrValues.statementNumber,
      bankAccountName:  hdrValues.bankAccountName,
      bankAccountNumber: hdrValues.bankAccountNumber ?? '',
      statementDate:    (hdrValues.statementDate as Dayjs).format('YYYY-MM-DD'),
      currencyCode:     hdrValues.currencyCode ?? '',
      openingBalance:   hdrValues.openingBalance ?? 0,
      closingBalance:   hdrValues.closingBalance ?? 0,
      businessUnitName: hdrValues.businessUnitName ?? '',
      description:      hdrValues.description ?? '',
      status:           hdrValues.status ?? 'DRAFT',
      createdBy:        'ERP_USER',
      lastUpdatedBy:    'ERP_USER',
    },
    lines: lines.map(l => ({
      lineId:              l.lineId,
      transactionDate:     l.transactionDate,
      valueDate:           l.valueDate || null,
      amount:              l.amount,
      transactionCode:     l.transactionCode,
      categoryCode:        l.categoryCode ?? '',
      description:         l.description ?? '',
      reference:           l.reference ?? '',
      bankTxnReference:    l.bankTxnReference ?? '',
      counterpartyName:    l.counterpartyName ?? '',
      counterpartyAccount: l.counterpartyAccount ?? '',
      createdBy:           'ERP_USER',
      lastUpdatedBy:       'ERP_USER',
    })),
  });

  const handleApiOpen = async () => {
    let hdrValues: any;
    try { hdrValues = await form.validateFields(); } catch { return; }
    setApiPayload(JSON.stringify(buildPayload(hdrValues), null, 2));
    setApiResponse(null);
    setApiModal(true);
  };

  const handleApiPost = async () => {
    setApiPosting(true);
    setApiResponse(null);
    try {
      const res = await fetch(`${APEX_BASE}/cash/bankstatements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: apiPayload,
      });
      const text = await res.text();
      setApiResponse({ status: res.status, body: (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })() });
    } catch (e: any) {
      setApiResponse({ status: 0, body: 'Network error: ' + e.message });
    } finally { setApiPosting(false); }
  };

  const handleRefreshLines = async () => {
    if (!initialHeader?.statementId) return;
    setRefreshingLines(true);
    try {
      const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${initialHeader.statementId}`);
      const data = await parseApexJson(res);
      if (data.status === 'success' || data.lines) {
        const fresh: StatementLine[] = (data.lines ?? []).map((l: any) => ({ ...l, _key: newKey() }));
        setLines(fresh);
        message.success(`Lines refreshed — ${fresh.length} line${fresh.length !== 1 ? 's' : ''} loaded.`);
      } else {
        message.error(data.message || 'Failed to refresh lines.');
      }
    } catch (e: any) {
      message.error('Refresh failed: ' + e.message);
    } finally {
      setRefreshingLines(false);
    }
  };

  // Bank accounts filtered by the legal entity of the selected BU
  const selectedBuLegalEntity = selectedBu
    ? (businessUnits.find(b => b.value === selectedBu)?.legalEntityName ?? '')
    : '';
  const filteredBankAccounts = selectedBu
    ? (selectedBuLegalEntity
        ? bankAccounts.filter(a => a.legalEntityName === selectedBuLegalEntity)
        : bankAccounts)
    : [];

  useEffect(() => {
    if (initialHeader) {
      form.setFieldsValue({
        statementNumber:   initialHeader.statementNumber,
        bankAccountName:   initialHeader.bankAccountName,
        bankAccountNumber: initialHeader.bankAccountNumber,
        statementDate:     initialHeader.statementDate ? dayjs(initialHeader.statementDate) : dayjs(),
        currencyCode:      initialHeader.currencyCode,
        openingBalance:    initialHeader.openingBalance,
        closingBalance:    initialHeader.closingBalance,
        businessUnitName:  initialHeader.businessUnitName,
        description:       initialHeader.description,
        status:            initialHeader.status ?? 'DRAFT',
      });
      if (initialHeader.businessUnitName) setSelectedBu(initialHeader.businessUnitName);
    } else {
      form.setFieldsValue({ statementDate: dayjs(), status: 'DRAFT' });
    }
  }, [initialHeader, form]);

  // Sync GL accounts when bankAccounts list loads (async) or when editing
  useEffect(() => {
    if (initialHeader?.bankAccountName && bankAccounts.length > 0) {
      const a = bankAccounts.find(x => x.value === initialHeader.bankAccountName);
      if (a) setSelBankGl({ cash: a.cashAccountCombination ?? '', clearing: a.clearingAccountCombination ?? '' });
    }
  }, [bankAccounts, initialHeader?.bankAccountName]);

  useEffect(() => {
    if (initialLines) setLines(initialLines);
  }, [initialLines]);

  // Load transaction codes whenever BU changes
  useEffect(() => {
    if (!selectedBu) { setTxnCodes([]); return; }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${APEX_BASE}/cash/transaction-codes?business_unit=${encodeURIComponent(selectedBu)}`, { signal: ctrl.signal });
        const data = await parseApexJson(res);
        // ORDS lowercases all JSON keys regardless of SQL aliases
        setTxnCodes((data.items || []).map((i: any) => ({
          value: i.transactioncode,
          label: `${i.transactioncode}${i.description ? ' — ' + i.description : ''}`,
          endTransaction: i.endtransaction,
          defaultAccountCombination: i.defaultaccountcombination,
        })));
      } catch { /* ignore abort */ }
    })();
    return () => ctrl.abort();
  }, [selectedBu]);

  // Load PDF templates whenever BU changes
  useEffect(() => {
    if (!selectedBu) { setPdfTemplates([]); return; }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${APEX_BASE}/cash/pdf-templates?business_unit=${encodeURIComponent(selectedBu)}`, { signal: ctrl.signal });
        const data = await parseApexJson(res);
        setPdfTemplates((data.items || []).map((i: any) => ({
          templateId:   i.templateid,
          templateName: i.templatename ?? '',
          dateFormat:   i.dateformat || 'DD/MM/YYYY',
          columns:      (() => { try { return JSON.parse(i.columnmappings || '[]'); } catch { return []; } })(),
        })));
      } catch { /* ignore abort */ }
    })();
    return () => ctrl.abort();
  }, [selectedBu]);

  const addLine = () => setLines(prev => [...prev, {
    _key: newKey(), transactionDate: dayjs().format('YYYY-MM-DD'),
    amount: null, transactionCode: '', reconStatus: 'UNRECONCILED',
  }]);

  const updateLine = (key: string, field: keyof StatementLine, value: any) =>
    setLines(prev => prev.map(l => l._key === key ? { ...l, [field]: value } : l));

  const deleteLine = (line: StatementLine) => {
    const recon = line.reconStatus ?? 'UNRECONCILED';
    if (recon === 'RECONCILED' || recon === 'PARTIALLY_RECONCILED') {
      message.warning('Cannot delete a reconciled line.');
      return;
    }
    Modal.confirm({
      title: 'Delete line?',
      content: `Line ${line.lineNumber ?? ''} — ${line.description || line.reference || 'no description'} will be permanently removed.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        if (line.lineId) {
          try {
            const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${initialHeader?.statementId}/lines/delete`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lineId: line.lineId }),
            });
            const data = await res.json();
            if (data.status === 'error') { message.error(data.message || 'Delete failed.'); return; }
          } catch (e: any) { message.error('Network error: ' + e.message); return; }
        }
        setLines(prev => prev.filter(l => l._key !== line._key));
      },
    });
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setCsvText(text);
      const { rows, errors } = parseCsv(text);
      setCsvErrors(errors);
      setCsvPreview(rows.map(csvRowToLine));
    };
    reader.readAsText(file);
  };

  const confirmCsvImport = () => {
    setLines(prev => [...prev, ...csvPreview]);
    setCsvModal(false);
    setCsvPreview([]);
    setCsvText('');
    setCsvErrors([]);
    message.success(`${csvPreview.length} lines imported from CSV.`);
  };

  const handlePdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setPdfPreview([]);
    setPdfErrors([]);
    setPdfLog([]);
    setPdfParsing(true);
    setPdfModal(true);
    try {
      const tpl = selectedTplId ? (pdfTemplates.find(t => t.templateId === selectedTplId) ?? null) : null;
      const { lines: parsed, errors, log } = await parseBankStatementPdfWithTemplate(file, tpl);
      setPdfPreview(parsed);
      setPdfErrors(errors);
      setPdfLog(log);
      setPdfSelKeys(parsed.map(l => l._key)); // select all by default
      setPdfApiOpen(false);
      setPdfApiResponse(null);
    } catch (err: any) {
      setPdfErrors([`Failed to read PDF: ${err.message}`]);
    } finally {
      setPdfParsing(false);
      if (pdfFileRef.current) pdfFileRef.current.value = '';
    }
  };

  const pdfQ = pdfSearch.trim().toLowerCase();
  const filteredPdfPreview = pdfQ
    ? pdfPreview.filter(l =>
        (l.description ?? '').toLowerCase().includes(pdfQ) ||
        (l.reference   ?? '').toLowerCase().includes(pdfQ) ||
        (l.transactionDate ?? '').includes(pdfQ) ||
        (l.transactionCode ?? '').toLowerCase().includes(pdfQ)
      )
    : pdfPreview;

  const getPdfSelected = () =>
    pdfSelKeys.length > 0 ? pdfPreview.filter(l => pdfSelKeys.includes(l._key)) : pdfPreview;

  const buildPdfLinesPayload = (selectedLines: StatementLine[]) => ({
    header: { statementId: initialHeader?.statementId, lastUpdatedBy: 'ERP_USER' },
    lines: selectedLines.map(l => ({
      transactionDate:     l.transactionDate,
      valueDate:           l.valueDate || null,
      amount:              l.amount,
      transactionCode:     l.transactionCode,
      description:         l.description ?? '',
      reference:           l.reference ?? '',
      bankTxnReference:    l.bankTxnReference ?? '',
      counterpartyName:    l.counterpartyName ?? '',
      counterpartyAccount: l.counterpartyAccount ?? '',
      createdBy:           'ERP_USER',
      lastUpdatedBy:       'ERP_USER',
    })),
  });

  const openPdfApi = () => {
    const sel = getPdfSelected();
    setPdfApiPayload(JSON.stringify(buildPdfLinesPayload(sel), null, 2));
    setPdfApiResponse(null);
    setPdfApiOpen(true);
  };

  const postPdfLines = async () => {
    setPdfApiPosting(true);
    setPdfApiResponse(null);
    try {
      const res = await fetch(`${APEX_BASE}/cash/bankstatements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: pdfApiPayload,
      });
      const text = await res.text();
      setPdfApiResponse({ status: res.status, body: (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })() });
    } catch (e: any) {
      setPdfApiResponse({ status: 0, body: 'Network error: ' + e.message });
    } finally { setPdfApiPosting(false); }
  };

  const confirmPdfImport = async () => {
    const toAdd = getPdfSelected();
    if (toAdd.length === 0) { message.warning('No lines selected.'); return; }

    const BATCH = 5;
    const batches: StatementLine[][] = [];
    for (let i = 0; i < toAdd.length; i += BATCH) batches.push(toAdd.slice(i, i + BATCH));

    setPdfImporting(true);
    setPdfBatchLog([]);
    setPdfBatchProgress(0);

    let totalSaved = 0;
    let anyError   = false;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch   = batches[bi];
      const payload = buildPdfLinesPayload(batch);
      let raw = '';
      let ok  = false;
      let saved = 0;
      try {
        const res  = await fetch(`${APEX_BASE}/cash/bankstatements`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        raw = await res.text();
        let data: any = {};
        try { data = JSON.parse(raw); } catch { /* raw shown as-is */ }
        ok    = data.status === 'success';
        saved = ok ? (data.linesProcessed ?? batch.length) : 0;
        if (!ok) anyError = true;
      } catch (e: any) {
        raw = `Network error: ${e.message}`;
        anyError = true;
      }
      totalSaved += saved;
      setPdfBatchLog(prev => [...prev, {
        batch: bi + 1, total: batches.length, saved, raw, ok,
      }]);
      setPdfBatchProgress(Math.round(((bi + 1) / batches.length) * 100));
    }

    setPdfImporting(false);

    if (!anyError) {
      // Reload lines from DB so the table reflects what was actually saved
      if (initialHeader?.statementId) {
        try {
          const r2  = await fetch(`${APEX_BASE}/cash/bankstatements/${initialHeader.statementId}`);
          const text = await r2.text();
          let d2: any = {};
          try { d2 = JSON.parse(text); } catch {
            message.warning(`Lines saved to DB but reload failed — raw response: ${text.slice(0, 200)}`, 10);
          }
          const fresh: StatementLine[] = (d2.lines ?? []).map((l: any) => ({ ...l, _key: newKey() }));
          setLines(fresh);
          if (fresh.length === 0 && totalSaved > 0) {
            message.warning(`${totalSaved} lines POSTed but GET returned 0 lines — click the API icon (ⓘ) next to "Statement Lines" to inspect the raw response.`, 10);
          }
        } catch (e: any) {
          message.error(`Lines saved but failed to reload: ${e.message}`, 8);
        }
      }
      setPdfModal(false);
      setPdfPreview([]);
      setPdfErrors([]);
      setPdfFileName('');
      setPdfSelKeys([]);
      setPdfApiOpen(false);
      setPdfApiResponse(null);
      setPdfBatchLog([]);
      setPdfBatchProgress(0);
      message.success(`${totalSaved} line${totalSaved !== 1 ? 's' : ''} saved to DB.`, 5);
    }
    // If errors → leave modal open so user can see the batch log
  };

  const handleSave = async () => {
    let hdrValues: any;
    try {
      hdrValues = await form.validateFields();
    } catch {
      message.error('Please fill in all required fields before saving.');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload(hdrValues);
      console.log('[handleSave] payload lines count:', payload.lines.length, payload);

      const res  = await fetch(`${APEX_BASE}/cash/bankstatements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseApexJson(res);
      console.log('[handleSave] response:', data);

      if (data.status === 'success') {
        const saved  = data.linesProcessed ?? 0;
        const sent   = payload.lines.length;
        if (sent > 0 && saved === 0) {
          message.warning(`Statement saved but 0 of ${sent} lines were stored — check date/amount formats.`);
        } else {
          message.success(isEdit
            ? `Statement updated (${saved} line${saved !== 1 ? 's' : ''} saved).`
            : `Statement created with ${saved} line${saved !== 1 ? 's' : ''}.`);
        }
        if (isEdit) {
          onSave();
        } else {
          onCreated(data.statementId);
        }
      } else {
        message.error(data.message || 'Save failed.');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally { setSaving(false); }
  };

  // Running balance — computed from opening balance per row
  const linesWithBal = (() => {
    let bal = Number(form.getFieldValue('openingBalance') ?? initialHeader?.openingBalance ?? 0);
    return lines.map(l => {
      const amt = l.amount ?? 0;
      if (l.transactionCode === 'CR') bal += amt;
      else if (l.transactionCode === 'DR') bal -= amt;
      return { ...l, _bal: bal };
    });
  })();
  const fmtN = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Line columns — inline editing with Withdrawal / Deposit / Balance presentation
  const lineColumns: ColumnsType<StatementLine & { _bal: number }> = [
    {
      title: '#', width: 44,
      render: (_, __, idx) => <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{idx + 1}</Text>,
    },
    {
      title: 'Date', width: 145,
      render: (_, r) => (
        <DatePicker size="small" format="D-MMM-YYYY" style={{ width: '100%' }}
          value={r.transactionDate ? dayjs(r.transactionDate) : undefined}
          onChange={d => updateLine(r._key, 'transactionDate', d?.format('YYYY-MM-DD') ?? '')} />
      ),
    },
    {
      title: 'Type', width: 70,
      render: (_, r) => (
        <Select size="small" style={{ width: '100%' }} value={r.transactionCode}
          onChange={v => updateLine(r._key, 'transactionCode', v)}>
          <Option value="CR">CR</Option>
          <Option value="DR">DR</Option>
        </Select>
      ),
    },
    {
      title: 'Withdrawal (DR)', width: 130, align: 'right' as const,
      render: (_, r) => r.transactionCode === 'DR' ? (
        <InputNumber size="small" style={{ width: '100%' }} precision={2}
          value={r.amount ?? undefined}
          onChange={v => updateLine(r._key, 'amount', v)} />
      ) : <Text style={{ fontSize: 11, color: REDWOOD.neutral300 }}>—</Text>,
    },
    {
      title: 'Deposit (CR)', width: 130, align: 'right' as const,
      render: (_, r) => r.transactionCode === 'CR' ? (
        <InputNumber size="small" style={{ width: '100%' }} precision={2}
          value={r.amount ?? undefined}
          onChange={v => updateLine(r._key, 'amount', v)} />
      ) : <Text style={{ fontSize: 11, color: REDWOOD.neutral300 }}>—</Text>,
    },
    {
      title: 'Balance', width: 120, align: 'right' as const,
      render: (_, r: any) => (
        <Text style={{ fontSize: 12, fontWeight: 500, color: r._bal >= 0 ? REDWOOD.neutral900 : REDWOOD.error }}>
          {fmtN(r._bal)}
        </Text>
      ),
    },
    {
      title: 'Txn Code', width: 160,
      render: (_, r) => (
        <Select
          size="small" style={{ width: '100%' }}
          value={r.categoryCode || undefined}
          placeholder={txnCodes.length ? 'Select' : selectedBu ? 'No codes' : 'Select BU'}
          showSearch optionFilterProp="label"
          options={txnCodes}
          onChange={v => {
            const code = txnCodes.find(c => c.value === v);
            setLines(prev => prev.map(l => l._key === r._key ? {
              ...l,
              categoryCode: v,
              description: l.description || (code?.label?.split(' — ')[1] ?? ''),
            } : l));
          }}
          allowClear
        />
      ),
    },
    {
      title: 'Description', width: 320,
      render: (_, r) => (
        <Input size="small" value={r.description}
          onChange={e => updateLine(r._key, 'description', e.target.value)} />
      ),
    },
    {
      title: 'Reference', width: 140,
      render: (_, r) => (
        <Input size="small" value={r.reference}
          onChange={e => updateLine(r._key, 'reference', e.target.value)} />
      ),
    },
    {
      title: 'Counterparty', width: 160,
      render: (_, r) => (
        <Input size="small" value={r.counterpartyName}
          onChange={e => updateLine(r._key, 'counterpartyName', e.target.value)} />
      ),
    },
    ...(isEdit ? [{
      title: 'Recon',
      width: 130,
      render: (_: any, r: StatementLine) => (
        <Tag color={RECON_COLOR[r.reconStatus ?? 'UNRECONCILED'] as any} style={{ fontSize: 11 }}>
          {r.reconStatus ?? 'UNRECONCILED'}
        </Tag>
      ),
    }] : []),
    {
      title: '', width: 40, align: 'center' as const,
      render: (_, r) => {
        const isReconciled = r.reconStatus === 'RECONCILED' || r.reconStatus === 'PARTIALLY_RECONCILED';
        return (
          <Tooltip title={isReconciled ? 'Cannot delete a reconciled line' : 'Delete line'}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />}
              disabled={isReconciled}
              onClick={() => deleteLine(r)} />
          </Tooltip>
        );
      },
    },
  ];

  const lc = { span: 8 };
  const wc = { span: 16 };
  const fs = { marginBottom: 12 };

  // Balance check — CR lines add to balance, DR lines reduce it (balanceTick forces re-render on field change)
  void balanceTick;
  const totalCr = lines.filter(l => l.transactionCode === 'CR').reduce((s, l) => s + (l.amount ?? 0), 0);
  const totalDr = lines.filter(l => l.transactionCode === 'DR').reduce((s, l) => s + (l.amount ?? 0), 0);
  const openingBal: number = form.getFieldValue('openingBalance') ?? 0;
  const closingBal: number = form.getFieldValue('closingBalance') ?? 0;
  const calcClosing = openingBal + totalCr - totalDr;
  const difference  = closingBal - calcClosing;

  return (
    <div style={{ padding: '12px 24px' }}>
      <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 14 }}>
        {isEdit ? `Edit Statement — ${initialHeader?.statementNumber}` : 'Create Bank Statement'}
      </Text>

      {/* ── Header ── */}
      <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900, display: 'block', marginBottom: 12 }}>
        Statement Details
      </Text>

      <Form form={form} layout="horizontal" labelCol={lc} wrapperCol={wc}
        onValuesChange={(changed) => {
          if ('openingBalance' in changed || 'closingBalance' in changed) setBalanceTick(t => t + 1);
        }}>
        <Row gutter={40}>
          <Col xs={24} lg={12}>
            <Form.Item label="Business Unit" name="businessUnitName"
              rules={[{ required: true, message: 'Required' }]} style={fs}>
              <Select showSearch placeholder="Select BU" optionFilterProp="label"
                options={businessUnits} allowClear style={{ width: '100%' }}
                disabled={isEdit}
                onChange={(v: string) => {
                  setSelectedBu(v ?? undefined);
                  form.setFieldsValue({ bankAccountName: undefined, bankAccountNumber: undefined, currencyCode: undefined });
                }} />
            </Form.Item>
            <Form.Item label="Bank Account" name="bankAccountName"
              rules={[{ required: true, message: 'Required' }]} style={fs}>
              <Select showSearch placeholder={selectedBu ? 'Select bank account' : 'Select BU first'}
                optionFilterProp="label" options={filteredBankAccounts}
                style={{ width: '100%' }} allowClear
                disabled={isEdit || !selectedBu}
                onChange={(v: string) => {
                  const acct = bankAccounts.find(a => a.value === v);
                  if (acct?.currencyCode)    form.setFieldValue('currencyCode',      acct.currencyCode);
                  if (acct?.bankAccountNumber) form.setFieldValue('bankAccountNumber', acct.bankAccountNumber);
                  setSelBankGl({ cash: acct?.cashAccountCombination ?? '', clearing: acct?.clearingAccountCombination ?? '' });
                }} />
            </Form.Item>
            <Form.Item label="Statement Number" name="statementNumber"
              rules={[{ required: true, message: 'Required' }]} style={fs}>
              <Input placeholder="e.g. STMT-2026-001" />
            </Form.Item>
            <Form.Item label="Statement Date" name="statementDate"
              rules={[{ required: true, message: 'Required' }]} style={fs}>
              <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
            </Form.Item>
            <Form.Item label="Status" name="status" style={fs}>
              <Select>
                {['DRAFT','SUBMITTED','RECONCILING','RECONCILED','CLOSED'].map(s => (
                  <Option key={s} value={s}>{s}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} lg={12}>
            <Form.Item label="Currency" name="currencyCode" style={fs}>
              <Select placeholder="Select currency" allowClear>
                {['AED','USD','EUR','GBP','SAR','QAR','KWD','BHD','OMR','INR'].map(c => (
                  <Option key={c} value={c}>{c}</Option>
                ))}
              </Select>
            </Form.Item>
            {/* GL accounts for the selected bank account — read-only, informational */}
            {(selBankGl.cash || selBankGl.clearing) && (
              <div style={{
                background: '#f0f5ff', border: '1px solid #adc6ff',
                borderRadius: 6, padding: '8px 12px', marginBottom: 12,
              }}>
                <Text style={{ fontSize: 11, color: '#1d39c4', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Bank GL Accounts
                </Text>
                {selBankGl.cash && (
                  <Row align="middle" style={{ marginBottom: 3 }}>
                    <Col style={{ width: 110 }}><Text style={{ fontSize: 11, color: '#595959' }}>Cash Account:</Text></Col>
                    <Col flex="auto">
                      <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#262626', fontWeight: 500 }}>
                        {selBankGl.cash}
                      </Text>
                    </Col>
                  </Row>
                )}
                {selBankGl.clearing && (
                  <Row align="middle">
                    <Col style={{ width: 110 }}><Text style={{ fontSize: 11, color: '#595959' }}>Clearing Account:</Text></Col>
                    <Col flex="auto">
                      <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#262626', fontWeight: 500 }}>
                        {selBankGl.clearing}
                      </Text>
                    </Col>
                  </Row>
                )}
              </div>
            )}
            <Row gutter={8}>
              <Col span={12}>
                <Form.Item label="Opening Bal" name="openingBalance" labelCol={{ span: 14 }} wrapperCol={{ span: 10 }} style={fs}>
                  <InputNumber style={{ width: '100%' }} precision={2} placeholder="0.00" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Closing Bal" name="closingBalance" labelCol={{ span: 14 }} wrapperCol={{ span: 10 }} style={fs}>
                  <InputNumber style={{ width: '100%' }} precision={2} placeholder="0.00" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Description" name="description" style={fs}>
              <Input.TextArea rows={2} placeholder="Optional description" />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {/* ── Balance Check ── */}
      {lines.length > 0 && (
        <div style={{
          background: difference === 0 ? '#f6ffed' : '#fffbe6',
          border: `1px solid ${difference === 0 ? '#b7eb8f' : '#ffe58f'}`,
          borderRadius: 6, padding: '8px 16px', marginBottom: 8,
        }}>
          <Row gutter={16} align="middle">
            <Col>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Opening</Text>
              <Text strong style={{ fontSize: 12, display: 'block' }}>{fmtAmount(openingBal)}</Text>
            </Col>
            <Col><Text style={{ color: REDWOOD.neutral300 }}>+</Text></Col>
            <Col>
              <Text style={{ fontSize: 12, color: REDWOOD.success }}>Credits (CR)</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.success }}>{fmtAmount(totalCr)}</Text>
            </Col>
            <Col><Text style={{ color: REDWOOD.neutral300 }}>−</Text></Col>
            <Col>
              <Text style={{ fontSize: 12, color: REDWOOD.error }}>Debits (DR)</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.error }}>{fmtAmount(totalDr)}</Text>
            </Col>
            <Col><Text style={{ color: REDWOOD.neutral300 }}>=</Text></Col>
            <Col>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Calc Closing</Text>
              <Text strong style={{ fontSize: 12, display: 'block' }}>{fmtAmount(calcClosing)}</Text>
            </Col>
            <Col flex="auto" style={{ textAlign: 'right' }}>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Actual Closing</Text>
              <Text strong style={{ fontSize: 12, display: 'block' }}>{fmtAmount(closingBal)}</Text>
            </Col>
            <Col>
              <Text style={{ fontSize: 12 }}>Difference</Text>
              <Text strong style={{
                fontSize: 13, display: 'block',
                color: difference === 0 ? REDWOOD.success : REDWOOD.error,
              }}>
                {fmtAmount(difference)}
              </Text>
            </Col>
          </Row>
        </div>
      )}

      {/* ── Lines ── */}
      <Divider style={{ margin: '8px 0 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Space align="center">
          <Text strong style={{ fontSize: 13 }}>
            Statement Lines
            {lines.length > 0 && <Tag color="blue" style={{ marginLeft: 8 }}>{lines.length}</Tag>}
          </Text>
          {initialHeader?.statementId && (
            <Tooltip title={`GET ${APEX_BASE}/cash/bankstatements/${initialHeader.statementId}`}>
              <Button size="small" type="text" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => { setGetApiResponse(null); setGetApiModal(true); }} />
            </Tooltip>
          )}
          {initialHeader?.statementId && (
            <Tooltip title="Refresh lines from database">
              <Button
                size="small" type="text"
                icon={<ReloadOutlined style={{ color: REDWOOD.success }} />}
                loading={refreshingLines}
                onClick={handleRefreshLines}
              />
            </Tooltip>
          )}
        </Space>
        <Space>
          <Button size="small" icon={<UploadOutlined />} onClick={() => setCsvModal(true)}>
            Import CSV
          </Button>
          <Button size="small" icon={<UploadOutlined />}
            style={{ borderColor: '#d46b08', color: '#d46b08' }}
            onClick={() => {
              if (pdfTemplates.length > 0) { setSelectedTplId(null); setPdfTplModal(true); }
              else pdfFileRef.current?.click();
            }}>
            Import PDF
          </Button>
          <input ref={pdfFileRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={handlePdfFile} />
        </Space>
      </div>

      <Table
        dataSource={linesWithBal} columns={lineColumns as any} rowKey="_key"
        size="small" pagination={false}
        scroll={{ x: 1100 }}
        locale={{ emptyText: <Empty description="No lines — add manually or import CSV" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        summary={() => lines.length > 0 ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>
              <Text strong style={{ fontSize: 12 }}>Totals</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3}>
              <Text strong style={{ fontSize: 12, color: REDWOOD.success }}>
                CR: {fmtAmount(totalCr)}
              </Text>
              <br />
              <Text strong style={{ fontSize: 12, color: REDWOOD.error }}>
                DR: {fmtAmount(totalDr)}
              </Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} colSpan={isEdit ? 6 : 5} />
          </Table.Summary.Row>
        ) : null}
      />

      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <Button size="small" icon={<PlusOutlined />} type="primary"
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
          onClick={addLine}>
          Add Line
        </Button>
      </div>

      <Divider />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button icon={<ApiOutlined />} onClick={handleApiOpen} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>
          API
        </Button>
        <Space>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={handleSave}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
            {isEdit ? 'Save Changes' : 'Create Statement'}
          </Button>
        </Space>
      </div>

      {/* ── API Inspector Modal ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — POST /cash/bankstatements</span></Space>}
        open={apiModal}
        onCancel={() => setApiModal(false)}
        width={820}
        footer={null}
        styles={{ body: { padding: '16px 24px' } }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Endpoint: <Text code copyable style={{ fontSize: 12 }}>{APEX_BASE}/cash/bankstatements</Text>
        </Text>

        <Divider style={{ margin: '12px 0 8px' }} />

        <Text strong style={{ fontSize: 13 }}>Request Body (JSON)</Text>
        <pre style={{
          background: '#1e1e2e', color: '#cdd6f4', padding: 16, borderRadius: 6,
          fontSize: 12, overflowX: 'auto', maxHeight: 360, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', margin: '8px 0 0',
        }}>
          {apiPayload}
        </pre>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<ApiOutlined />} loading={apiPosting} onClick={handleApiPost}
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
            POST Request
          </Button>
        </div>

        {apiResponse && (
          <>
            <Divider style={{ margin: '16px 0 10px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Text strong>Response</Text>
              <Tag color={apiResponse.status >= 200 && apiResponse.status < 300 ? 'success' : 'error'}>
                HTTP {apiResponse.status || 'Error'}
              </Tag>
            </div>
            <pre style={{
              background: apiResponse.status >= 200 && apiResponse.status < 300 ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${apiResponse.status >= 200 && apiResponse.status < 300 ? '#b7eb8f' : '#ffccc7'}`,
              color: REDWOOD.neutral900, padding: 16, borderRadius: 6,
              fontSize: 12, overflowX: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap',
              wordBreak: 'break-all', margin: 0,
            }}>
              {apiResponse.body}
            </pre>
          </>
        )}
      </Modal>

      {/* ── GET Lines API Inspector Modal ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>GET /cash/bankstatements/{initialHeader?.statementId} — Lines Inspector</span></Space>}
        open={getApiModal}
        onCancel={() => setGetApiModal(false)}
        width={820}
        footer={null}
        styles={{ body: { padding: '16px 24px' } }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Endpoint:{' '}
          <Text code copyable style={{ fontSize: 12 }}>
            {APEX_BASE}/cash/bankstatements/{initialHeader?.statementId ?? '<statementId>'}
          </Text>
        </Text>
        <div style={{ marginTop: 12 }}>
          <Button type="primary" loading={getApiRunning}
            icon={<ApiOutlined />}
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
            onClick={async () => {
              if (!initialHeader?.statementId) { return; }
              setGetApiRunning(true);
              setGetApiResponse(null);
              try {
                const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${initialHeader.statementId}`);
                const text = await res.text();
                setGetApiResponse({
                  status: res.status,
                  body: (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })(),
                });
              } catch (e: any) {
                setGetApiResponse({ status: 0, body: 'Network error: ' + e.message });
              } finally { setGetApiRunning(false); }
            }}>
            Run GET Request
          </Button>
        </div>
        {getApiResponse && (
          <>
            <Divider style={{ margin: '12px 0 8px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Tag color={getApiResponse.status >= 200 && getApiResponse.status < 300 ? 'success' : 'error'}>
                HTTP {getApiResponse.status || 'Error'}
              </Tag>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Raw response — check "lines" array and "linesProcessed" values
              </Text>
            </div>
            <Input.TextArea
              readOnly value={getApiResponse.body}
              rows={18}
              style={{ fontFamily: 'monospace', fontSize: 11 }}
            />
          </>
        )}
      </Modal>

      {/* ── CSV Import Modal ── */}
      <Modal
        title={<Space><UploadOutlined /><span>Import Lines from CSV</span></Space>}
        open={csvModal} onCancel={() => { setCsvModal(false); setCsvPreview([]); setCsvErrors([]); }}
        width={900}
        footer={[
          <Button key="cancel" onClick={() => { setCsvModal(false); setCsvPreview([]); setCsvErrors([]); }}>
            Cancel
          </Button>,
          <Button key="import" type="primary" disabled={csvPreview.length === 0}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={confirmCsvImport}>
            Import {csvPreview.length} Lines
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="info" showIcon
            message="Expected CSV columns (header row required)"
            description="transaction_date, amount, transaction_code (CR/DR), description, reference, value_date, counterparty_name, counterparty_account, bank_txn_reference"
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button icon={<DownloadOutlined />} size="small"
              onClick={() => {
                const csv = 'transaction_date,amount,transaction_code,description,reference,value_date,counterparty_name\n2026-03-28,1500.00,CR,Customer Payment,REF-001,2026-03-28,ABC Company';
                const a = document.createElement('a');
                a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                a.download = 'bank_statement_template.csv';
                a.click();
              }}>
              Download Template
            </Button>
            <Button icon={<UploadOutlined />} size="small"
              onClick={() => fileRef.current?.click()}>
              Choose CSV File
            </Button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={handleCsvFile} />
            {csvText && <Text type="secondary" style={{ fontSize: 12 }}>File loaded</Text>}
          </div>

          {csvErrors.length > 0 && (
            <Alert type="warning" showIcon message={`${csvErrors.length} parse errors`}
              description={csvErrors.slice(0, 5).join(' | ')} />
          )}

          {csvPreview.length > 0 && (
            <Table
              dataSource={csvPreview} rowKey="_key" size="small"
              pagination={false} scroll={{ y: 280 }}
              columns={[
                { title: 'Date', dataIndex: 'transactionDate', width: 110, render: fmtDate },
                { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right', render: v => fmtAmount(v) },
                { title: 'Type', dataIndex: 'transactionCode', width: 60,
                  render: v => <Tag color={v === 'CR' ? 'green' : 'red'}>{v}</Tag> },
                { title: 'Description', dataIndex: 'description', ellipsis: true },
                { title: 'Reference', dataIndex: 'reference', width: 120, ellipsis: true },
                { title: 'Counterparty', dataIndex: 'counterpartyName', ellipsis: true },
              ]}
            />
          )}
        </Space>
      </Modal>

      {/* Template Selection Modal */}
      <Modal
        title={<Space><UploadOutlined style={{ color: '#d46b08' }} /><span>Select PDF Import Template</span></Space>}
        open={pdfTplModal} onCancel={() => setPdfTplModal(false)} width={480}
        footer={[
          <Button key="cancel" onClick={() => setPdfTplModal(false)}>Cancel</Button>,
          <Button key="manage" type="text" style={{ color: REDWOOD.info }}
            onClick={() => { setPdfTplModal(false); window.location.hash = '#/cash/pdf-templates'; }}>
            Manage Templates
          </Button>,
          <Button key="go" type="primary"
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => { setPdfTplModal(false); pdfFileRef.current?.click(); }}>
            Continue
          </Button>,
        ]}
      >
        <Text style={{ fontSize: 12, display: 'block', marginBottom: 14, color: REDWOOD.neutral600 }}>
          Choose a template that matches your bank PDF format, or use auto-detect (generic parser).
        </Text>
        <Select
          style={{ width: '100%' }}
          value={selectedTplId ?? 'none'}
          onChange={(v: any) => setSelectedTplId(v === 'none' ? null : Number(v))}
          options={[
            { value: 'none', label: 'None — auto-detect (generic parser)' },
            ...pdfTemplates.map(t => ({ value: t.templateId, label: t.templateName })),
          ]}
        />
      </Modal>

      {/* PDF Import Modal */}
      <Modal
        title={<Space><UploadOutlined style={{ color: '#d46b08' }} /><span>Import Lines from PDF</span></Space>}
        open={pdfModal}
        onCancel={() => { setPdfModal(false); setPdfPreview([]); setPdfErrors([]); setPdfLog([]); setPdfFileName(''); setPdfSelKeys([]); setPdfApiOpen(false); setPdfApiResponse(null); setPdfBatchLog([]); setPdfBatchProgress(0); setPdfGetResponse(null); setPdfSearch(''); }}
        width={980}
        footer={[
          <Button key="cancel" onClick={() => { setPdfModal(false); setPdfPreview([]); setPdfErrors([]); setPdfFileName(''); setPdfSelKeys([]); setPdfApiOpen(false); setPdfApiResponse(null); setPdfBatchLog([]); setPdfBatchProgress(0); setPdfGetResponse(null); setPdfSearch(''); }}>
            Cancel
          </Button>,
          pdfPreview.length > 0 && (
            <Button key="api" icon={<ApiOutlined />}
              style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
              onClick={openPdfApi}>
              API Inspector ({pdfSelKeys.length > 0 ? pdfSelKeys.length : pdfPreview.length} selected)
            </Button>
          ),
          <Button key="import" type="primary"
            disabled={pdfPreview.length === 0}
            loading={pdfImporting}
            style={{ background: '#d46b08', borderColor: '#d46b08' }}
            onClick={confirmPdfImport}>
            Save {pdfSelKeys.length > 0 ? pdfSelKeys.length : pdfPreview.length} Lines to DB
          </Button>,
        ]}
      >
        {pdfFileName && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            File: <strong>{pdfFileName}</strong>
            {initialHeader?.statementId && (
              <Text type="secondary" style={{ marginLeft: 12 }}>
                Statement ID: <strong>{initialHeader.statementId}</strong>
              </Text>
            )}
          </Text>
        )}
        {pdfParsing && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Text type="secondary">Reading PDF...</Text>
          </div>
        )}
        {!pdfParsing && pdfErrors.length > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 8 }}
            message={`${pdfErrors.length} warning(s)`}
            description={pdfErrors.slice(0, 5).join(' | ')} />
        )}
        {!pdfParsing && pdfPreview.length === 0 && pdfErrors.length > 0 && (
          <Empty description="No transactions could be parsed from this PDF." />
        )}
        {!pdfParsing && pdfPreview.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Alert type="success" showIcon style={{ flex: 1, margin: 0 }}
                message={`${pdfPreview.length} transactions found${filteredPdfPreview.length !== pdfPreview.length ? ` — showing ${filteredPdfPreview.length}` : ''} — select rows to import, then click Add`} />
              <Input.Search
                placeholder="Search description, ref, date…"
                allowClear
                value={pdfSearch}
                onChange={e => setPdfSearch(e.target.value)}
                onSearch={v => setPdfSearch(v)}
                style={{ width: 240 }}
                size="small"
              />
            </div>
            <Table
              dataSource={filteredPdfPreview} rowKey="_key" size="small" pagination={false}
              scroll={{ y: 320, x: 800 }}
              rowSelection={{
                selectedRowKeys: pdfSelKeys,
                onChange: (keys) => {
                  setPdfSelKeys(keys as string[]);
                  setPdfApiOpen(false);
                  setPdfApiResponse(null);
                },
              }}
              columns={[
                { title: 'Date', dataIndex: 'transactionDate', width: 110,
                  render: (v: string) => <Text style={{ fontSize: 11 }}>{v ? dayjs(v).format('D-MMM-YYYY') : '—'}</Text> },
                { title: 'Description', dataIndex: 'description', ellipsis: true,
                  render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 11 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Ref', dataIndex: 'reference', width: 80,
                  render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
                { title: 'Type', dataIndex: 'transactionCode', width: 60,
                  render: (v: string) => <Tag color={v === 'CR' ? 'green' : 'red'} style={{ fontSize: 10 }}>{v}</Tag> },
                { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right',
                  render: (v: number, r: StatementLine) => (
                    <Text style={{ fontSize: 11, color: r.transactionCode === 'CR' ? '#1D7B4D' : '#C74634' }}>
                      {v != null ? v.toLocaleString('en-AE', { minimumFractionDigits: 2 }) : '—'}
                    </Text>
                  )},
              ]}
              summary={() => {
                const sel = getPdfSelected();
                const cr = sel.filter(r => r.transactionCode === 'CR').reduce((s, r) => s + (r.amount ?? 0), 0);
                const dr = sel.filter(r => r.transactionCode === 'DR').reduce((s, r) => s + (r.amount ?? 0), 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: '#fafafa' }}>
                      <Table.Summary.Cell index={0} colSpan={3}>
                        <Text strong style={{ fontSize: 11 }}>
                          Selected: {pdfSelKeys.length > 0 ? pdfSelKeys.length : pdfPreview.length} / {pdfPreview.length}
                        </Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} colSpan={2} align="right">
                        <Text strong style={{ fontSize: 11 }}>
                          CR: {cr.toLocaleString('en-AE', { minimumFractionDigits: 2 })} |{' '}
                          DR: {dr.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </>
        )}

        {/* Parse Log */}
        {!pdfParsing && pdfLog.length > 0 && (
          <Collapse size="small" style={{ marginTop: 10 }}
            items={[{
              key: 'log',
              label: (
                <span style={{ fontSize: 11, color: '#595959' }}>
                  Parse Log — {pdfLog.length} entries
                  {pdfLog.filter(l => l.includes('[OK]')).length > 0 &&
                    <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>{pdfLog.filter(l => l.includes('[OK]')).length} OK</Tag>}
                  {pdfLog.filter(l => l.includes('[SKIP')).length > 0 &&
                    <Tag color="orange" style={{ fontSize: 10 }}>{pdfLog.filter(l => l.includes('[SKIP')).length} skipped</Tag>}
                  {pdfLog.filter(l => l.includes('[NARRATION+')).length > 0 &&
                    <Tag color="blue" style={{ fontSize: 10 }}>{pdfLog.filter(l => l.includes('[NARRATION+')).length} narration continuations</Tag>}
                </span>
              ),
              children: (
                <pre style={{
                  maxHeight: 240, overflowY: 'auto', margin: 0,
                  fontSize: 10, lineHeight: 1.6, background: '#1e1e2e', color: '#cdd6f4',
                  padding: '10px 12px', borderRadius: 4,
                }}>
                  {pdfLog.map((line, i) => {
                    const color = line.includes('[OK]') ? '#a6e3a1'
                      : line.includes('[SKIP') ? '#f38ba8'
                      : line.includes('[NARRATION+]') ? '#89b4fa'
                      : line.includes('[HEADER') ? '#6c7086'
                      : '#cdd6f4';
                    return <span key={i} style={{ color, display: 'block' }}>{line}</span>;
                  })}
                </pre>
              ),
            }]}
          />
        )}

        {/* API Inspector */}
        {pdfApiOpen && (
          <div style={{ marginTop: 12, border: `1px solid ${REDWOOD.info}40`, borderRadius: 6, padding: 12, background: '#f0f7ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <ApiOutlined style={{ color: REDWOOD.info }} />
              <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>API Inspector — POST {APEX_BASE}/cash/bankstatements</Text>
              <Button size="small" type="text" style={{ marginLeft: 'auto', fontSize: 11 }}
                onClick={() => { setPdfApiOpen(false); setPdfApiResponse(null); }}>✕</Button>
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              Edit the payload below, then click POST to send directly to the API:
            </Text>
            <Input.TextArea
              value={pdfApiPayload}
              onChange={e => setPdfApiPayload(e.target.value)}
              rows={10}
              style={{ fontFamily: 'monospace', fontSize: 11 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <Button type="primary" size="small" loading={pdfApiPosting}
                icon={<ApiOutlined />}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={postPdfLines}>
                POST Request
              </Button>
              {pdfApiResponse && (
                <Tag color={pdfApiResponse.status >= 200 && pdfApiResponse.status < 300 ? 'green' : 'red'}>
                  HTTP {pdfApiResponse.status || 'Error'}
                </Tag>
              )}
            </div>
            {pdfApiResponse && (
              <Input.TextArea
                readOnly value={pdfApiResponse.body}
                rows={5} style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11 }}
              />
            )}
          </div>
        )}

        {/* Batch import progress */}
        {(pdfImporting || pdfBatchLog.length > 0) && (
          <div style={{ marginTop: 12, border: '1px solid #d9d9d9', borderRadius: 6, padding: 12, background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text strong style={{ fontSize: 12 }}>Batch POST Progress</Text>
              {!pdfImporting && pdfBatchLog.length > 0 && (
                <Button size="small" type="text" style={{ marginLeft: 'auto', fontSize: 11 }}
                  onClick={() => { setPdfBatchLog([]); setPdfBatchProgress(0); setPdfGetResponse(null); }}>Clear</Button>
              )}
            </div>
            {pdfImporting && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 11 }}>
                    Posting batch {pdfBatchLog.length + 1} of {Math.ceil((pdfSelKeys.length > 0 ? pdfSelKeys.length : pdfPreview.length) / 5)}…
                  </Text>
                  <Text style={{ fontSize: 11 }}>{pdfBatchProgress}%</Text>
                </div>
                <div style={{ height: 6, background: '#e6e6e6', borderRadius: 3 }}>
                  <div style={{ height: 6, background: REDWOOD.info, borderRadius: 3, width: `${pdfBatchProgress}%`, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
            {pdfBatchLog.map(entry => (
              <div key={entry.batch} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Tag color={entry.ok ? 'green' : 'red'} style={{ fontSize: 10, margin: 0 }}>
                    Batch {entry.batch}/{entry.total}
                  </Tag>
                  <Text style={{ fontSize: 11 }}>
                    {entry.ok ? `✓ ${entry.saved} line${entry.saved !== 1 ? 's' : ''} saved` : '✗ Failed'}
                  </Text>
                </div>
                <Input.TextArea
                  readOnly value={entry.raw}
                  rows={2} style={{ fontFamily: 'monospace', fontSize: 10 }}
                />
              </div>
            ))}

            {/* GET lines check */}
            {!pdfImporting && pdfBatchLog.length > 0 && initialHeader?.statementId && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e8e8e8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <ApiOutlined style={{ color: '#389e0d' }} />
                  <Text strong style={{ fontSize: 11, color: '#389e0d' }}>
                    GET {APEX_BASE}/cash/bankstatements/{initialHeader.statementId}
                  </Text>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <Button size="small" loading={pdfGetRunning}
                    icon={<ApiOutlined />}
                    style={{ borderColor: '#389e0d', color: '#389e0d' }}
                    onClick={async () => {
                      setPdfGetRunning(true);
                      setPdfGetResponse(null);
                      try {
                        const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${initialHeader!.statementId}`);
                        const text = await res.text();
                        setPdfGetResponse(text);
                      } catch (e: any) {
                        setPdfGetResponse('Network error: ' + e.message);
                      } finally { setPdfGetRunning(false); }
                    }}>
                    Run GET — check saved lines
                  </Button>
                  <Text type="secondary" style={{ fontSize: 10 }}>Returns header + all lines for this statement</Text>
                </div>
                {pdfGetResponse !== null && (
                  <Input.TextArea
                    readOnly value={pdfGetResponse}
                    rows={8} style={{ fontFamily: 'monospace', fontSize: 10 }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const ManageBankStatements: React.FC<{ module?: 'ap' | 'cash' }> = ({ module = 'cash' }) => {
  const [statements, setStatements] = useState<StatementHeader[]>([]);
  const [loading, setLoading]       = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAcctOption[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BUOption[]>([]);
  const [searchOpen, setSearchOpen] = useState(true);
  const [activeTabKey, setActiveTabKey] = useState('search');
  const [tabs, setTabs] = useState<{
    key: string; label: string;
    header?: StatementHeader; lines?: StatementLine[];
  }[]>([]);
  const [searchForm] = Form.useForm();
  const modulePrefix = module === 'ap' ? '/ap' : '/cash';
  const [searchSelectedBu, setSearchSelectedBu] = useState<string | undefined>();

  // ── Journal Lines dialog (cash account analysis per statement) ─────────────
  const [jlModalOpen, setJlModalOpen]     = useState(false);
  const [jlLoading,   setJlLoading]       = useState(false);
  const [jlStatement, setJlStatement]     = useState<StatementHeader | null>(null);
  const [jlLines,     setJlLines]         = useState<any[]>([]);

  // Search screen bank accounts filtered by legal entity of selected BU
  const searchBuLegalEntity = searchSelectedBu
    ? (businessUnits.find(b => b.value === searchSelectedBu)?.legalEntityName ?? '')
    : '';
  const searchFilteredAccounts = searchSelectedBu
    ? (searchBuLegalEntity
        ? bankAccounts.filter(a => a.legalEntityName === searchBuLegalEntity)
        : bankAccounts)
    : bankAccounts;

  // Load LOVs
  const loadLovs = useCallback(async () => {
    try {
      // BUs — include legal_entity_name for bank account filtering
      const buRes  = await fetch(`${APEX_BASE}/gl/businessunits`);
      const buData = await buRes.json();
      const buOptions: BUOption[] = (buData?.items ?? [])
        .map((i: any) => ({
          label:           i.business_unit_name || '',
          value:           i.business_unit_name || '',
          legalEntityName: i.legal_entity_name  || '',
        }))
        .filter((o: BUOption) => o.value)
        .sort((a: BUOption, b: BUOption) => a.label.localeCompare(b.label));
      setBusinessUnits(buOptions);
    } catch { /* silent */ }

    try {
      // Bank accounts from dedicated endpoint — has legalEntityName for filtering
      const res  = await fetch(`${APEX_BASE}/banks/bankaccounts`);
      const data = await res.json();
      const items: any[] = data?.items ?? [];
      const accts: BankAcctOption[] = items
        .filter((i: any) => i.bankAccountName || i.bank_account_name)
        .map((i: any) => ({
          label:                  i.bankAccountName   || i.bank_account_name   || '',
          value:                  i.bankAccountName   || i.bank_account_name   || '',
          bankAccountNumber:      i.bankAccountNumber || i.bank_account_number || '',
          currencyCode:           i.currencyCode      || i.currency_code       || '',
          legalEntityName:        i.legalEntityName   || i.legal_entity_name   || '',
          cashAccountCombination:     i.cashAccountCombination     || i.cash_account_combination     || '',
          clearingAccountCombination: i.clearingAccountCombination || i.cash_clearing_account_combination || '',
        }))
        .sort((a: BankAcctOption, b: BankAcctOption) => a.label.localeCompare(b.label));
      setBankAccounts(accts);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadLovs(); }, [loadLovs]);

  // Search
  const handleSearch = useCallback(async () => {
    const v = searchForm.getFieldsValue();
    const p = new URLSearchParams();
    if (v.businessUnit)    p.set('business_unit',    v.businessUnit);
    if (v.bankAccount)     p.set('bank_account',     v.bankAccount);
    if (v.statementNumber) p.set('statement_number', v.statementNumber);
    if (v.status)          p.set('status',           v.status);
    if (v.dateFrom)        p.set('date_from', (v.dateFrom as Dayjs).format('YYYY-MM-DD'));
    if (v.dateTo)          p.set('date_to',   (v.dateTo   as Dayjs).format('YYYY-MM-DD'));
    p.set('row_limit', '500');

    setLoading(true); setHasSearched(true);
    try {
      const res  = await fetch(`${APEX_BASE}/cash/bankstatements?${p.toString()}`);
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        setStatements(data.items ?? []);
        if (!(data.items ?? []).length) message.info('No statements found.');
      } else { message.error(data.message || 'Search failed.'); }
    } catch (e: any) { message.error('Network error: ' + e.message); }
    finally { setLoading(false); }
  }, [searchForm]);

  const handleReset = () => { searchForm.resetFields(); setStatements([]); setHasSearched(false); setSearchSelectedBu(undefined); };

  // Open edit tab — load full statement with lines
  const openEditTab = async (record: StatementHeader) => {
    const existing = tabs.find(t => t.header?.statementId === record.statementId);
    if (existing) { setActiveTabKey(existing.key); return; }
    try {
      const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${record.statementId}`);
      const data = await parseApexJson(res);
      const lines: StatementLine[] = (data.lines ?? []).map((l: any) => ({ ...l, _key: newKey() }));
      const key = newTabKey();
      setTabs(prev => [...prev, { key, label: record.statementNumber, header: record, lines }]);
      setActiveTabKey(key);
    } catch (e: any) { message.error('Failed to load statement: ' + e.message); }
  };

  const openCreateTab = () => {
    const key = newTabKey();
    setTabs(prev => [...prev, { key, label: 'New Statement' }]);
    setActiveTabKey(key);
  };

  const closeTab = (key: string) => {
    setTabs(prev => prev.filter(t => t.key !== key));
    if (activeTabKey === key) setActiveTabKey('search');
  };

  // After creating a new statement, reload the same tab as edit so lines can be added immediately
  const reloadTabAsEdit = async (tabKey: string, statementId: number) => {
    try {
      const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${statementId}`);
      const data = await parseApexJson(res);
      const header: StatementHeader = data.header ?? data;
      const dbLines: StatementLine[] = (data.lines ?? []).map((l: any) => ({ ...l, _key: newKey() }));
      console.log('[reloadTabAsEdit] DB returned lines:', dbLines.length);
      setTabs(prev => prev.map(t => {
        if (t.key !== tabKey) return t;
        // If DB returned lines, use them; if DB returned empty but we had local lines, keep local lines
        // (guards against rare case where DB commit isn't visible yet)
        const lines = dbLines.length > 0 ? dbLines : (t.lines && t.lines.length > 0 ? t.lines : dbLines);
        return { ...t, label: header.statementNumber ?? `Stmt #${statementId}`, header, lines };
      }));
      if (hasSearched) handleSearch();
    } catch { message.warning('Statement saved. Refresh the page to continue editing.'); }
  };

  // Table columns
  const openJournalLines = async (r: StatementHeader) => {
    // Find cash account for this bank
    const bankAcct = bankAccounts.find(a => a.value === r.bankAccountName);
    const cashAcct = bankAcct?.cashAccountCombination ?? '';
    setJlStatement(r);
    setJlLines([]);
    setJlModalOpen(true);
    setJlLoading(true);
    try {
      // Date range = first and last day of the statement month
      const d      = dayjs(r.statementDate);
      const dateFrom = d.startOf('month').format('YYYY-MM-DD');
      const dateTo   = d.endOf('month').format('YYYY-MM-DD');
      const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, limit: '2000' });
      if (cashAcct) qs.set('account', cashAcct);
      const res  = await fetch(`${APEX_BASE}/gl/journals/lines?${qs}`, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({ items: [] }));
      setJlLines(data.items ?? []);
    } catch {
      message.error('Failed to load journal lines');
    } finally {
      setJlLoading(false);
    }
  };

  const columns: ColumnsType<StatementHeader> = [
    { title: 'Business Unit', dataIndex: 'businessUnitName', width: 180, ellipsis: true,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v || '—'}</Text></Tooltip> },
    { title: 'Bank Account', dataIndex: 'bankAccountName', ellipsis: true,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v || '—'}</Text></Tooltip> },
    {
      title: 'Statement #', dataIndex: 'statementNumber', width: 150,
      render: (v, r) => (
        <Button type="link" size="small" style={{ padding: 0, color: REDWOOD.info }}
          onClick={() => openEditTab(r)}>{v}</Button>
      ),
    },
    { title: 'Date', dataIndex: 'statementDate', width: 110, render: fmtDate },
    { title: 'CCY', dataIndex: 'currencyCode', width: 60,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Opening Bal', dataIndex: 'openingBalance', width: 130, align: 'right',
      render: (v, r) => <Text style={{ fontSize: 12 }}>{fmtAmount(v, r.currencyCode)}</Text> },
    { title: 'Closing Bal', dataIndex: 'closingBalance', width: 130, align: 'right',
      render: (v, r) => <Text style={{ fontSize: 12 }}>{fmtAmount(v, r.currencyCode)}</Text> },
    { title: 'Credits', dataIndex: 'totalCredits', width: 120, align: 'right',
      render: (v, r) => <Text style={{ fontSize: 12, color: REDWOOD.success }}>{fmtAmount(v, r.currencyCode)}</Text> },
    { title: 'Debits', dataIndex: 'totalDebits', width: 120, align: 'right',
      render: (v, r) => <Text style={{ fontSize: 12, color: REDWOOD.error }}>{fmtAmount(v, r.currencyCode)}</Text> },
    {
      title: 'Lines', key: 'lines', width: 150, align: 'center',
      render: (_: any, r: StatementHeader) => {
        const total = r.totalLines ?? 0;
        if (!total) return <Text style={{ fontSize: 13, color: REDWOOD.neutral300 }}>—</Text>;
        return (
          <Tooltip title={`${total} total · ${r.reconLines ?? 0} reconciled · ${r.unreconLines ?? 0} unreconciled`}>
            <Space size={8}>
              <Text style={{ fontSize: 13, fontWeight: 500 }}>{total}</Text>
              <Text style={{ fontSize: 13, color: REDWOOD.success }}>✓{r.reconLines ?? 0}</Text>
              <Text style={{ fontSize: 13, color: REDWOOD.error }}>✗{r.unreconLines ?? 0}</Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: 'Status', dataIndex: 'status', width: 140,
      render: v => <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: '', key: 'actions', width: 90, align: 'center',
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title="View Journal Entries">
            <Button type="text" size="small" icon={<ReadOutlined />} onClick={() => openJournalLines(r)} />
          </Tooltip>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditTab(r)} />
        </Space>
      ),
    },
  ];

  const searchPane = (
    <div style={{ padding: '16px 0' }}>
      <Collapse
        activeKey={searchOpen ? ['s'] : []}
        onChange={(k: string | string[]) => setSearchOpen((Array.isArray(k) ? k : [k]).includes('s'))}
        style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface }}
        items={[{
          key: 's',
          label: <Text strong style={{ fontSize: 13 }}>Search</Text>,
          extra: (
            <Space size={8} onClick={e => e.stopPropagation()}>
              <Button size="small" icon={<ReloadOutlined />}
                onClick={e => { e.stopPropagation(); handleReset(); }}>Reset</Button>
              <Button size="small" type="primary" icon={<SearchOutlined />} loading={loading}
                onClick={e => { e.stopPropagation(); handleSearch(); }}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Search
              </Button>
            </Space>
          ),
          children: (
            <Form form={searchForm} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }}>
              <Row gutter={[24, 4]}>
                <Col xs={24} md={12}>
                  <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 10 }}>
                    <Select showSearch placeholder="Select BU" optionFilterProp="label"
                      options={businessUnits} allowClear style={{ width: '100%' }}
                      onChange={(v: string | undefined) => {
                        setSearchSelectedBu(v ?? undefined);
                        searchForm.setFieldValue('bankAccount', undefined);
                      }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Date From" name="dateFrom" style={{ marginBottom: 10 }}>
                    <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Bank Account" name="bankAccount" style={{ marginBottom: 10 }}>
                    <Select showSearch
                      placeholder={searchSelectedBu ? 'Select bank account' : 'Select account'}
                      optionFilterProp="label"
                      options={searchFilteredAccounts} allowClear style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Date To" name="dateTo" style={{ marginBottom: 10 }}>
                    <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Statement #" name="statementNumber" style={{ marginBottom: 10 }}>
                    <Input placeholder="Statement number" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Status" name="status" style={{ marginBottom: 10 }}>
                    <Select placeholder="Any status" allowClear>
                      {['DRAFT','SUBMITTED','RECONCILING','RECONCILED','CLOSED'].map(s => (
                        <Option key={s} value={s}>{s}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          ),
        }]}
      />

      {hasSearched && (
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          styles={{ body: { padding: 0 } }}
          title={
            <Text strong>
              Results {statements.length > 0 && <Tag color="blue">{statements.length}</Tag>}
            </Text>
          }
        >
          <Table
            dataSource={statements} columns={columns} rowKey="statementId"
            loading={loading} size="small"
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} statements` }}
            locale={{ emptyText: <Empty description="No statements found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            scroll={{ x: 1200 }}
          />
        </Card>
      )}
    </div>
  );

  const tabItems = [
    { key: 'search', label: <span><SearchOutlined /> Search</span>, children: searchPane, closable: false },
    ...tabs.map(t => ({
      key: t.key,
      closable: false,
      label: (
        <span>
          {t.header ? <EditOutlined style={{ marginRight: 4 }} /> : <PlusOutlined style={{ marginRight: 4 }} />}
          {t.label}
          <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }}
            onClick={e => { e.stopPropagation(); closeTab(t.key); }} />
        </span>
      ),
      children: (
        <StatementForm
          initialHeader={t.header}
          initialLines={t.lines}
          bankAccounts={bankAccounts}
          businessUnits={businessUnits}
          onSave={() => reloadTabAsEdit(t.key, t.header!.statementId!)}
          onCreated={(stmtId) => reloadTabAsEdit(t.key, stmtId)}
          onCancel={() => closeTab(t.key)}
        />
      ),
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to={modulePrefix}>{module === 'ap' ? 'Payables' : 'Cash Management'}</Link> },
            { title: 'Manage Bank Statements' },
          ]} />
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BankOutlined style={{ fontSize: 22, color: REDWOOD.info }} />
              <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>Manage Bank Statements</Title>
            </div>
            <Button icon={<PlusOutlined />} type="primary"
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={openCreateTab}>
              Create Statement
            </Button>
          </div>

          <Tabs type="card" activeKey={activeTabKey} onChange={setActiveTabKey}
            items={tabItems} style={{ marginTop: 8 }} />
        </div>
      </Content>

      {/* ── Journal Lines Dialog ──────────────────────────────────────────── */}
      <Modal
        open={jlModalOpen}
        onCancel={() => setJlModalOpen(false)}
        footer={null}
        width={1200}
        title={
          <Space size={12}>
            <ReadOutlined style={{ color: REDWOOD.info }} />
            <span>
              Journal Entries — {jlStatement?.bankAccountName ?? ''}{' '}
              <Tag color="blue" style={{ fontSize: 11, marginLeft: 4 }}>
                {jlStatement?.statementDate
                  ? (() => { const d = dayjs(jlStatement.statementDate); return `${d.startOf('month').format('DD-MMM-YYYY')} → ${d.endOf('month').format('DD-MMM-YYYY')}`; })()
                  : ''}
              </Tag>
            </span>
            {jlStatement && (() => {
              const bankAcct = bankAccounts.find(a => a.value === jlStatement.bankAccountName);
              const cashAcct = bankAcct?.cashAccountCombination;
              return cashAcct ? <Tag color="geekblue" style={{ fontSize: 11 }}>{cashAcct}</Tag> : null;
            })()}
          </Space>
        }
        styles={{ body: { padding: '12px 0' } }}
      >
        {jlLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: REDWOOD.neutral600 }}>Loading journal lines…</div>
        ) : jlLines.length === 0 ? (
          <Empty description="No journal lines found for this cash account and period" style={{ padding: 40 }} />
        ) : (
          <>
            <div style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{jlLines.length} lines</Text>
              <Space size={16}>
                <Text style={{ fontSize: 12 }}>
                  Total Dr: <Text strong style={{ color: REDWOOD.success }}>
                    {jlLines.reduce((s, l) => s + (Number(l.entered_dr) || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </Text>
                <Text style={{ fontSize: 12 }}>
                  Total Cr: <Text strong style={{ color: REDWOOD.error }}>
                    {jlLines.reduce((s, l) => s + (Number(l.entered_cr) || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </Text>
              </Space>
            </div>
            <Table
              dataSource={jlLines.map((l, i) => ({ ...l, _key: i }))}
              rowKey="_key"
              size="small"
              pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} lines` }}
              scroll={{ x: 1100 }}
              columns={[
                {
                  title: 'Date', dataIndex: 'accounting_date', width: 100,
                  render: v => <Text style={{ fontSize: 11 }}>{v ? String(v).slice(0, 10) : '—'}</Text>,
                  sorter: (a, b) => (a.accounting_date ?? '').localeCompare(b.accounting_date ?? ''),
                  defaultSortOrder: 'ascend',
                },
                {
                  title: 'Period', dataIndex: 'period_name', width: 90,
                  render: v => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
                },
                {
                  title: 'Journal', dataIndex: 'journal_name', ellipsis: true,
                  render: v => <Tooltip title={v}><Text style={{ fontSize: 11 }}>{v || '—'}</Text></Tooltip>,
                },
                {
                  title: 'Account', dataIndex: 'account', width: 220, ellipsis: true,
                  render: v => <Text code style={{ fontSize: 10 }}>{v || '—'}</Text>,
                },
                {
                  title: 'Description', dataIndex: 'description', ellipsis: true,
                  render: v => <Tooltip title={v}><Text style={{ fontSize: 11 }}>{v || '—'}</Text></Tooltip>,
                },
                {
                  title: 'Ref1', dataIndex: 'reference1', width: 130, ellipsis: true,
                  render: v => <Text style={{ fontSize: 10 }}>{v || '—'}</Text>,
                },
                {
                  title: 'Ent. Dr', dataIndex: 'entered_dr', width: 110, align: 'right' as const,
                  render: v => Number(v) ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : <Text style={{ color: REDWOOD.neutral300 }}>—</Text>,
                  sorter: (a, b) => (Number(a.entered_dr) || 0) - (Number(b.entered_dr) || 0),
                },
                {
                  title: 'Ent. Cr', dataIndex: 'entered_cr', width: 110, align: 'right' as const,
                  render: v => Number(v) ? <Text style={{ fontSize: 11, color: REDWOOD.error }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : <Text style={{ color: REDWOOD.neutral300 }}>—</Text>,
                  sorter: (a, b) => (Number(a.entered_cr) || 0) - (Number(b.entered_cr) || 0),
                },
                {
                  title: 'CCY', dataIndex: 'currency_code', width: 60,
                  render: v => <Tag style={{ fontSize: 10 }}>{v || '—'}</Tag>,
                },
                {
                  title: 'Status', dataIndex: 'journal_status', width: 80,
                  render: (v: any) => {
                    const val = (v ?? '').toString().toUpperCase();
                    const isPosted = val === 'P' || val === 'POSTED';
                    return <Tag color={isPosted ? 'green' : val ? 'orange' : 'default'} style={{ fontSize: 10 }}>{isPosted ? 'POSTED' : (v || '—')}</Tag>;
                  },
                },
              ]}
            />
          </>
        )}
      </Modal>
    </Layout>
  );
};

// ── Error Boundary ────────────────────────────────────────────────────────────
class StatementsErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ManageBankStatements] render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, padding: 16 }}>
            <strong style={{ color: '#cf1322' }}>Page Error</strong>
            <pre style={{ marginTop: 8, fontSize: 12, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8 }}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ManageBankStatementsWithBoundary: React.FC<{ module?: 'ap' | 'cash' }> = (props) => (
  <StatementsErrorBoundary>
    <ManageBankStatements {...props} />
  </StatementsErrorBoundary>
);

export default ManageBankStatementsWithBoundary;
