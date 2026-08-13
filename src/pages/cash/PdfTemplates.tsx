import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  Space, Tag, Modal, Popconfirm, message, Steps, Alert, Divider, Tooltip, Collapse,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, BankOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  UploadOutlined, FileTextOutlined, CheckOutlined, ArrowRightOutlined, ArrowLeftOutlined,
  ApiOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { Empty } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const APEX_BASE = buildApexUrl('');

interface ColumnMapping {
  text: string;
  x: number;
  xMin: number;
  xMax: number;
  field: string;
}

interface PdfTemplate {
  templateId: number;
  templateName: string;
  description?: string;
  businessUnitName?: string;
  dateFormat: string;
  columnMappings: ColumnMapping[];
  headerRowText?: string;
  creationDate?: string;
}

const FIELD_OPTIONS = [
  { value: 'date',       label: 'Transaction Date (required)' },
  { value: 'valueDate',  label: 'Value Date' },
  { value: 'narration',  label: 'Description / Narration' },
  { value: 'reference',  label: 'Reference / Cheque No' },
  { value: 'withdrawal', label: 'Withdrawal / Debit Amount' },
  { value: 'deposit',    label: 'Deposit / Credit Amount' },
  { value: 'amount',     label: 'Transaction Amount (combined)' },
  { value: 'type',       label: 'Transaction Type (DR / CR)' },
  { value: 'balance',    label: 'Running Balance' },
  { value: 'skip',       label: 'Skip / Ignore' },
];

const FIELD_COLORS: Record<string, string> = {
  date:       '#0572CE', valueDate: '#096dd9', narration: '#1D7B4D',
  reference:  '#D4A800', withdrawal: '#D93025', deposit: '#1D7B4D',
  amount:     '#722ed1', type: '#d46b08', balance: '#08979c', skip: '#999',
};

const DATE_FORMATS = [
  'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY',
  'D-MMM-YYYY', 'DD-MMM-YYYY', 'YYYY-MM-DD',
];

const HEADER_KEYWORDS = new Set([
  'date', 'description', 'narration', 'particulars', 'reference', 'ref',
  'withdrawal', 'deposit', 'debit', 'credit', 'balance', 'amount', 'chq',
  'transaction', 'details', 'remarks', 'dr', 'cr', 'value',
]);

const FIELD_KEYWORD_MAP: Record<string, string[]> = {
  date:       ['date', 'txn date', 'trans date', 'transaction date', 'posting date', 'book date'],
  valueDate:  ['value date', 'val date'],
  narration:  ['description', 'narration', 'particulars', 'details', 'transaction details', 'remarks'],
  reference:  ['ref', 'reference', 'chq', 'chq.no', 'cheque', 'check', 'voucher', 'doc no', 'doc. no'],
  withdrawal: ['withdrawal', 'withdrawals', 'debit', 'dr amount', 'paid out'],
  deposit:    ['deposit', 'deposits', 'credit', 'cr amount', 'paid in'],
  balance:    ['balance', 'running balance', 'avail balance'],
};

interface ParsedLine {
  _key: string;
  transactionDate: string;
  description: string;
  reference: string;
  transactionCode: string;
  amount: number | null;
}

function parseDateStr(str: string, fmt: string): dayjs.Dayjs | null {
  const s = str.trim();
  if (fmt === 'DD/MM/YYYY' || fmt === 'DD-MM-YYYY') {
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

async function testPdfWithTemplate(
  file: File,
  template: PdfTemplate,
): Promise<{ lines: ParsedLine[]; errors: string[]; log: string[] }> {
  const errors: string[] = [];
  const lines: ParsedLine[] = [];
  const log: string[] = [];
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
        const tx = (item as any).transform;
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
  log.push(`Columns: ${template.columnMappings.map(c => `${c.field}(x${Math.round(c.xMin)}-${Math.round(c.xMax)})`).join(', ')}`);

  const dateCol   = template.columnMappings.find(c => c.field === 'date');
  const narCol    = template.columnMappings.find(c => c.field === 'narration');
  const amtRe     = /^[\d,]+(\.\d{1,2})?$/;
  const isHdrOrPg = (tokens: { str: string }[]) => {
    const j = tokens.map(t => t.str).join(' ').toLowerCase();
    return /transaction\s+date|value\s+date|narration|running\s+balance|transaction\s+running|date\s+balance/.test(j)
      || /^\s*page\s+\d/.test(j) || /^\d+\s+of\s+\d+/.test(j);
  };
  const isNonNarration = (text: string) =>
    /^-[\d,]+(\.\d+)?$/.test(text.trim()) || text.includes('@') ||
    /^https?:\/\/|^www\./i.test(text) || /^Tel[\s:+]/i.test(text) || /^Timings?:/i.test(text);
  const splitAmts = (str: string): number[] =>
    str.trim().split(/\s+/).map(s => parseFloat(s.replace(/,/g, ''))).filter(n => !isNaN(n) && n >= 0);

  let rowIdx = 0;
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

    const dateItem = dateCol
      ? row.find(it => it.x >= dateCol.xMin && it.x <= dateCol.xMax)
      : row[0];

    // No date → possible narration continuation
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
      const noDate = dateItem
        ? `date-col="${dateItem.str}" not parseable as ${template.dateFormat}`
        : `no item in date-col x${Math.round(dateCol?.xMin ?? 0)}-${Math.round(dateCol?.xMax ?? 0)}`;
      log.push(`  Row ${rowNum}: [SKIP] ${noDate} | "${rowPreview}"`);
      continue;
    }

    const txDate = parseDateStr(dateItem.str, template.dateFormat)!;

    // Bucket items; collect skip-zone text separately
    const bucket: Record<string, string> = {};
    const skipZoneText: string[] = [];
    for (const item of row) {
      const col = template.columnMappings.find(c => item.x >= c.xMin && item.x <= c.xMax);
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
          const col = template.columnMappings.find(c => it.x >= c.xMin && it.x <= c.xMax);
          if (!col || ignoreFields.has(col.field)) return false;
          if (amtRe.test(it.str.replace(/,/g, ''))) return false;
          if (parseDateStr(it.str, template.dateFormat)?.isValid()) return false;
          return true;
        })
        .map(it => it.str)
        .join(' ').trim();
      if (fb.length > 1 && !isNonNarration(fb)) bucket['narration'] = fb;
    }

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
      const nonZero = depAmts.filter(v => v > 0);
      const zeroIdx = depAmts.findIndex(v => v === 0);
      const nonZeroIdx = depAmts.findIndex(v => v > 0);
      if (nonZero.length === 1) {
        amount = nonZero[0];
        txCode = nonZeroIdx < zeroIdx ? 'DR' : 'CR';
        amtReason = `deposit-split=[${depAmts.join(',')}] idx=${nonZeroIdx}→${txCode}`;
      } else if (nonZero.length >= 2) {
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
      log.push(`  Row ${rowNum}: [SKIP no-amount] date=${txDate.format('DD/MM/YYYY')} bucket=${JSON.stringify(bucket).slice(0,100)}`);
      continue;
    }

    lastDateRowFailed = false;
    log.push(`  Row ${rowNum}: [OK] ${txDate.format('DD/MM/YYYY')} ${txCode} ${amount.toLocaleString()} | ${amtReason} | narration="${(bucket['narration']??'').slice(0,50)}"`);

    lines.push({
      _key:            String(rowIdx++),
      transactionDate: txDate.format('YYYY-MM-DD'),
      description:     bucket['narration'] ?? '',
      reference:       bucket['reference'] ?? '',
      transactionCode: txCode,
      amount,
    });
  }

  log.push(`Done: ${lines.length} transaction(s) parsed, ${errors.length} error(s)`);

  if (lines.length === 0 && errors.length === 0)
    errors.push('No transaction rows found. Check that column X-ranges match this PDF.');

  return { lines, errors, log };
}

function suggestField(headerText: string): string {
  const lower = headerText.toLowerCase().trim();
  for (const [field, keywords] of Object.entries(FIELD_KEYWORD_MAP)) {
    if (keywords.some(kw => lower === kw || lower.includes(kw))) return field;
  }
  return 'skip';
}

function scoreRowAsHeader(items: { str: string }[]): number {
  let score = 0;
  for (const item of items) {
    const lower = item.str.toLowerCase();
    for (const kw of HEADER_KEYWORDS) {
      if (lower.includes(kw)) { score++; break; }
    }
  }
  return score;
}

function computeXRanges(cols: { text: string; x: number; field: string }[]): ColumnMapping[] {
  const sorted = [...cols].sort((a, b) => a.x - b.x);
  return sorted.map((col, i) => ({
    ...col,
    xMin: i === 0 ? 0 : Math.round((sorted[i - 1].x + col.x) / 2),
    xMax: i === sorted.length - 1 ? 9999 : Math.round((col.x + sorted[i + 1].x) / 2),
  }));
}

const parseApexJson = async (res: Response) => {
  const text = await res.text();
  return JSON.parse(text.replace(/:(-?)\.(\d)/g, ':$10.$2').replace(/(\d)\.([,}\]])/g, '$1$2'));
};

const PdfTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<PdfTemplate[]>([]);
  const [buOptions, setBuOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiModal, setApiModal] = useState(false);

  // Designer modal state
  const [designerOpen, setDesignerOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<PdfTemplate | null>(null);
  const [step, setStep] = useState(0);
  const [infoForm] = Form.useForm();
  const pdfRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [candidateRows, setCandidateRows] = useState<{ items: { str: string; x: number }[]; score: number }[]>([]);
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [detectedCols, setDetectedCols] = useState<{ text: string; x: number; field: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [manualHeaders, setManualHeaders] = useState('');
  const [savedInfo, setSavedInfo] = useState<Record<string, any>>({});
  const [inspectModal, setInspectModal] = useState(false);
  const [inspectPayload, setInspectPayload] = useState('');
  const [inspectPosting, setInspectPosting] = useState(false);
  const [inspectResponse, setInspectResponse] = useState<{ status: number; body: string } | null>(null);

  // Test PDF state
  const [testModal, setTestModal]       = useState(false);
  const [testTemplate, setTestTemplate] = useState<PdfTemplate | null>(null);
  const [testParsing, setTestParsing]   = useState(false);
  const [testLines, setTestLines]       = useState<ParsedLine[]>([]);
  const [testErrors, setTestErrors]     = useState<string[]>([]);
  const [testLog, setTestLog]           = useState<string[]>([]);
  const [testFileName, setTestFileName] = useState('');
  const [testSearch, setTestSearch]     = useState('');
  const testFileRef = useRef<HTMLInputElement>(null);

  // Load BUs
  useEffect(() => {
    fetch(`${APEX_BASE}/gl/businessunits`)
      .then(r => r.json())
      .then(d => setBuOptions(
        (d.items ?? [])
          .map((b: any) => ({ label: b.business_unit_name || '', value: b.business_unit_name || '' }))
          .filter((o: any) => o.value)
          .sort((a: any, b: any) => a.label.localeCompare(b.label))
      ))
      .catch(() => {});
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${APEX_BASE}/cash/pdf-templates`);
      const data = await parseApexJson(res);
      setTemplates((data.items ?? []).map((r: any) => ({
        templateId:       r.templateid,
        templateName:     r.templatename ?? '',
        description:      r.description,
        businessUnitName: r.businessunitname,
        dateFormat:       r.dateformat || 'DD/MM/YYYY',
        columnMappings:   (() => { try { return JSON.parse(r.columnmappings || '[]'); } catch { return []; } })(),
        headerRowText:    r.headerrowtext,
        creationDate:     r.creationdate,
      })));
    } catch {
      message.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const openDesigner = (tpl?: PdfTemplate) => {
    setEditTemplate(tpl ?? null);
    setStep(0);
    setCandidateRows([]);
    setManualHeaders('');
    if (tpl) {
      setDetectedCols(tpl.columnMappings.map(c => ({ text: c.text, x: c.x, field: c.field })));
      infoForm.setFieldsValue({
        templateName:      tpl.templateName,
        businessUnitName:  tpl.businessUnitName,
        description:       tpl.description,
        dateFormat:        tpl.dateFormat,
      });
    } else {
      setDetectedCols([]);
      infoForm.resetFields();
      infoForm.setFieldValue('dateFormat', 'DD/MM/YYYY');
    }
    setDesignerOpen(true);
  };

  const closeDesigner = () => {
    setDesignerOpen(false);
    setEditTemplate(null);
    setDetectedCols([]);
    setCandidateRows([]);
    setManualHeaders('');
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setCandidateRows([]);
    try {
      let pdfjsLib: any;
      try {
        pdfjsLib = await import('pdfjs-dist');
        const ver: string = pdfjsLib.version;
        const ext = ver.startsWith('3.') || ver.startsWith('2.') ? 'min.js' : 'min.mjs';
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.${ext}`;
      } catch {
        message.error('pdfjs-dist is not installed. Run: npm install pdfjs-dist');
        return;
      }

      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf, useSystemFonts: true }).promise;

      const allItems: { str: string; x: number; y: number }[] = [];
      for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if ('str' in item && item.str.trim()) {
            const tx = (item as any).transform;
            allItems.push({ str: item.str.trim(), x: tx[4], y: tx[5] });
          }
        }
      }

      const rowMap = new Map<number, { str: string; x: number }[]>();
      for (const item of allItems) {
        const key = Math.round(item.y / 3) * 3;
        if (!rowMap.has(key)) rowMap.set(key, []);
        rowMap.get(key)!.push({ str: item.str, x: item.x });
      }

      const scored = [...rowMap.values()]
        .filter(row => row.length >= 3)
        .map(items => ({
          items: items.sort((a, b) => a.x - b.x),
          score: scoreRowAsHeader(items),
        }))
        .filter(r => r.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      setCandidateRows(scored);
      setSelectedRowIdx(0);

      if (scored.length > 0) {
        const best = scored[0].items;
        setDetectedCols(best.map(it => ({ text: it.str, x: it.x, field: suggestField(it.str) })));
        message.success(`Detected ${scored.length} header row candidate(s). Best match auto-selected.`);
      } else {
        message.warning('No clear header row found. Try uploading a different page or enter headers manually below.');
      }
    } catch (err: any) {
      message.error('PDF read error: ' + err.message);
    } finally {
      setExtracting(false);
      if (pdfRef.current) pdfRef.current.value = '';
    }
  };

  const selectCandidateRow = (idx: number) => {
    setSelectedRowIdx(idx);
    const row = candidateRows[idx];
    if (row) setDetectedCols(row.items.map(it => ({ text: it.str, x: it.x, field: suggestField(it.str) })));
  };

  const applyManualHeaders = () => {
    const texts = manualHeaders.split(',').map(t => t.trim()).filter(Boolean);
    if (!texts.length) return;
    setDetectedCols(texts.map((text, i) => ({ text, x: i * 80, field: suggestField(text) })));
    message.info(`Applied ${texts.length} manual columns.`);
  };

  const updateColField = (idx: number, field: string) =>
    setDetectedCols(prev => prev.map((c, i) => i === idx ? { ...c, field } : c));

  const buildPostPayload = () => {
    // Use savedInfo (captured when leaving Step 0) — form is unmounted on steps 1/2/3
    const info = step === 0 ? infoForm.getFieldsValue() : savedInfo;
    const mappings = computeXRanges(detectedCols);
    const payload: Record<string, unknown> = {
      template_name:      info.templateName || null,
      description:        info.description || null,
      business_unit_name: info.businessUnitName || null,
      date_format:        info.dateFormat || 'DD/MM/YYYY',
      column_mappings:    JSON.stringify(mappings),
      header_row_text:    detectedCols.map(c => c.text).join(' '),
      last_updated_by:    'APP_USER',
    };
    if (editTemplate?.templateId) payload.template_id = editTemplate.templateId;
    else payload.created_by = 'APP_USER';
    return payload;
  };

  const openInspect = () => {
    const info = step === 0 ? infoForm.getFieldsValue() : savedInfo;
    if (!info.templateName) {
      message.error('Fill in Template Name on Step 1 first');
      setStep(0);
      return;
    }
    setInspectPayload(JSON.stringify(buildPostPayload(), null, 2));
    setInspectResponse(null);
    setInspectModal(true);
  };

  const handleInspectPost = async () => {
    setInspectPosting(true);
    setInspectResponse(null);
    try {
      const res = await fetch(`${APEX_BASE}/cash/pdf-templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: inspectPayload,
      });
      const text = await res.text();
      setInspectResponse({
        status: res.status,
        body: (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })(),
      });
    } catch (e: any) {
      setInspectResponse({ status: 0, body: 'Network error: ' + e.message });
    } finally { setInspectPosting(false); }
  };

  const goNext = async () => {
    if (step === 0) {
      try {
        const values = await infoForm.validateFields();
        setSavedInfo(values); // persist values before form unmounts
        setStep(1);
      } catch { /* form errors shown */ }
    } else {
      setStep(s => s + 1);
    }
  };

  const handleSave = async () => {
    // Form is unmounted on steps 1/2 — use savedInfo captured when leaving Step 0
    const info = step === 0 ? infoForm.getFieldsValue() : savedInfo;
    if (!info.templateName) { message.error('Template Name is required'); setStep(0); return; }

    const hasDate = detectedCols.some(c => c.field === 'date');
    if (!hasDate) {
      message.error('At least one column must be mapped to "Transaction Date"');
      return;
    }

    setSaving(true);
    try {
      const mappings = computeXRanges(detectedCols);
      const payload: Record<string, unknown> = {
        template_name:      info.templateName,
        description:        info.description || null,
        business_unit_name: info.businessUnitName || null,
        date_format:        info.dateFormat || 'DD/MM/YYYY',
        column_mappings:    JSON.stringify(mappings),
        header_row_text:    detectedCols.map(c => c.text).join(' '),
        last_updated_by:    'APP_USER',
      };
      if (editTemplate?.templateId) {
        payload.template_id = editTemplate.templateId;
      } else {
        payload.created_by = 'APP_USER';
      }

      const res = await fetch(`${APEX_BASE}/cash/pdf-templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        message.success(editTemplate ? 'Template updated' : 'Template created');
        closeDesigner();
        loadTemplates();
      } else {
        message.error(data.message ?? 'Save failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`${APEX_BASE}/cash/pdf-templates/${id}`, { method: 'DELETE' });
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        message.success('Template deleted');
        loadTemplates();
      } else {
        message.error(data.message ?? 'Delete failed');
      }
    } catch {
      message.error('Delete failed');
    }
  };

  const openTest = (tpl: PdfTemplate) => {
    setTestTemplate(tpl);
    setTestLines([]);
    setTestErrors([]);
    setTestFileName('');
    setTestSearch('');
    setTestModal(true);
  };

  const closeTest = () => {
    setTestModal(false);
    setTestTemplate(null);
    setTestLines([]);
    setTestErrors([]);
    setTestLog([]);
    setTestFileName('');
    setTestSearch('');
  };

  const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !testTemplate) return;
    setTestFileName(file.name);
    setTestParsing(true);
    setTestLines([]);
    setTestErrors([]);
    setTestLog([]);
    try {
      const { lines, errors, log } = await testPdfWithTemplate(file, testTemplate);
      setTestLines(lines);
      setTestErrors(errors);
      setTestLog(log);
    } catch (err: any) {
      setTestErrors([err.message ?? 'Parse error']);
    } finally {
      setTestParsing(false);
      if (testFileRef.current) testFileRef.current.value = '';
    }
  };

  const testQ = testSearch.trim().toLowerCase();
  const filteredTestLines = testQ
    ? testLines.filter(l =>
        (l.description ?? '').toLowerCase().includes(testQ) ||
        (l.reference   ?? '').toLowerCase().includes(testQ) ||
        (l.transactionDate ?? '').includes(testQ) ||
        (l.transactionCode ?? '').toLowerCase().includes(testQ)
      )
    : testLines;

  const columns: ColumnsType<PdfTemplate> = [
    {
      title: 'Template Name', dataIndex: 'templateName', key: 'templateName',
      render: v => <Text strong style={{ color: REDWOOD.primary }}>{v}</Text>,
    },
    {
      title: 'Business Unit', dataIndex: 'businessUnitName', key: 'businessUnitName', width: 240, ellipsis: true,
      render: v => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Tag style={{ fontSize: 10 }}>All BUs</Tag>,
    },
    {
      title: 'Date Format', dataIndex: 'dateFormat', key: 'dateFormat', width: 130,
      render: v => <Tag color="blue">{v}</Tag>,
    },
    {
      title: 'Mapped Columns', key: 'cols', ellipsis: true,
      render: (_: unknown, r: PdfTemplate) => (
        <Space wrap size={4}>
          {r.columnMappings.filter(c => c.field !== 'skip').map(c => (
            <Tag key={c.text}
              style={{ fontSize: 10, background: (FIELD_COLORS[c.field] ?? '#999') + '20', border: `1px solid ${FIELD_COLORS[c.field] ?? '#999'}`, color: FIELD_COLORS[c.field] ?? '#999' }}>
              {c.text}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Created', dataIndex: 'creationDate', width: 110,
      render: v => v ? <Text style={{ fontSize: 11 }}>{dayjs(v).format('D-MMM-YY')}</Text> : '—',
    },
    {
      title: '', key: 'actions', width: 80, align: 'center',
      render: (_: unknown, r: PdfTemplate) => (
        <Space size={4}>
          <Tooltip title="Test PDF parsing with this template">
            <Button type="text" size="small" icon={<ExperimentOutlined />}
              style={{ color: REDWOOD.success }} onClick={() => openTest(r)} />
          </Tooltip>
          <Button type="text" size="small" icon={<EditOutlined />}
            style={{ color: REDWOOD.info }} onClick={() => openDesigner(r)} />
          <Popconfirm title="Delete this template?" description="This cannot be undone."
            onConfirm={() => handleDelete(r.templateId)}
            okText="Delete" okButtonProps={{ danger: true }} cancelText="Cancel">
            <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: REDWOOD.error }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const designerFooter = [
    <Button key="cancel" onClick={closeDesigner}>Cancel</Button>,
    step === 2 ? (
      <Button key="api" icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
        onClick={openInspect}>
        API
      </Button>
    ) : null,
    step > 0 ? <Button key="prev" icon={<ArrowLeftOutlined />} onClick={() => setStep(s => s - 1)}>Back</Button> : null,
    step < 2 ? (
      <Button key="next" type="primary" icon={<ArrowRightOutlined />}
        style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
        onClick={goNext}>
        Next
      </Button>
    ) : (
      <Button key="save" type="primary" icon={<CheckOutlined />} loading={saving}
        style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
        onClick={handleSave}>
        Save Template
      </Button>
    ),
  ].filter(Boolean);

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb style={{ marginBottom: 12 }}>
          <Breadcrumb.Item><Link to="/"><HomeOutlined /> Home</Link></Breadcrumb.Item>
          <Breadcrumb.Item><Link to="/cash"><BankOutlined /> Cash Management</Link></Breadcrumb.Item>
          <Breadcrumb.Item>PDF Statement Templates</Breadcrumb.Item>
        </Breadcrumb>

        <Card bordered={false} style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
          styles={{ body: { padding: 16 } }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>PDF Statement Templates</Title>
            <Space>
              <Button icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={() => setApiModal(true)}>
                API
              </Button>
              <Button type="primary" icon={<PlusOutlined />}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={() => openDesigner()}>
                New Template
              </Button>
            </Space>
          </div>

          <Alert type="info" showIcon style={{ marginBottom: 14 }}
            message="Templates map PDF column X-positions to statement fields (date, amount, description, etc.) so the system can automatically parse bank statement PDFs from any bank format."
          />

          <Table<PdfTemplate>
            dataSource={templates} columns={columns} rowKey="templateId"
            loading={loading} size="small"
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} templates` }}
          />
        </Card>

        {/* ── Designer Modal ── */}
        <Modal
          title={
            <Space>
              <FileTextOutlined style={{ color: REDWOOD.primary }} />
              <span>{editTemplate ? `Edit Template — ${editTemplate.templateName}` : 'New PDF Statement Template'}</span>
            </Space>
          }
          open={designerOpen} onCancel={closeDesigner}
          width={860} footer={designerFooter} destroyOnClose
        >
          <Steps current={step} size="small" style={{ marginBottom: 20 }}
            items={[
              { title: 'Template Info' },
              { title: 'Upload & Detect' },
              { title: 'Map Columns' },
            ]}
          />

          {/* ─ Step 0: Info ─ */}
          {step === 0 && (
            <Form form={infoForm} layout="vertical" style={{ maxWidth: 520 }}>
              <Form.Item name="templateName" label="Template Name"
                rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="e.g. Emirates NBD Statement, FAB Bank" maxLength={200} />
              </Form.Item>
              <Form.Item name="businessUnitName" label="Business Unit"
                extra="Leave blank to make this template available for all business units">
                <Select showSearch placeholder="All Business Units" allowClear options={buOptions}
                  filterOption={(i, o) => (o?.label as string ?? '').toLowerCase().includes(i.toLowerCase())} />
              </Form.Item>
              <Form.Item name="description" label="Description">
                <Input.TextArea rows={2} placeholder="Optional description" maxLength={500} />
              </Form.Item>
              <Form.Item name="dateFormat" label="Date Format"
                rules={[{ required: true }]}
                extra="Select the date format used in this bank's PDF statements">
                <Select placeholder="Select date format">
                  {DATE_FORMATS.map(f => <Option key={f} value={f}>{f}</Option>)}
                </Select>
              </Form.Item>
            </Form>
          )}

          {/* ─ Step 1: Upload & Detect ─ */}
          {step === 1 && (
            <div>
              <Alert type="info" showIcon style={{ marginBottom: 14 }}
                message="Upload a sample PDF bank statement. The system will extract column headers from the first page."
              />

              <Space style={{ marginBottom: 16 }}>
                <Button icon={<UploadOutlined />} loading={extracting}
                  onClick={() => pdfRef.current?.click()}>
                  {extracting ? 'Reading PDF…' : 'Upload Sample PDF'}
                </Button>
                <input ref={pdfRef} type="file" accept=".pdf" style={{ display: 'none' }}
                  onChange={handlePdfUpload} />
              </Space>

              {candidateRows.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    Header row candidates — click to select:
                  </Text>
                  {candidateRows.map((row, idx) => (
                    <div key={idx} onClick={() => selectCandidateRow(idx)}
                      style={{
                        padding: '8px 12px', marginBottom: 6, borderRadius: 6, cursor: 'pointer',
                        border: `2px solid ${idx === selectedRowIdx ? REDWOOD.primary : REDWOOD.neutral200}`,
                        background: idx === selectedRowIdx ? REDWOOD.primary + '08' : '#fff',
                      }}>
                      <Space wrap>
                        <Tag style={{ background: REDWOOD.info, color: '#fff', border: 'none', fontSize: 10, minWidth: 52, textAlign: 'center' }}>
                          Score {row.score}
                        </Tag>
                        {row.items.map((it, j) => (
                          <Tag key={j} style={{ fontSize: 11, background: (FIELD_COLORS[suggestField(it.str)] ?? '#999') + '18', borderColor: FIELD_COLORS[suggestField(it.str)] ?? '#999', color: FIELD_COLORS[suggestField(it.str)] ?? '#999' }}>
                            {it.str}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  ))}
                </div>
              )}

              {detectedCols.length > 0 && (
                <Alert type="success" showIcon style={{ marginBottom: 12 }}
                  message={`${detectedCols.length} columns detected. Click Next to assign fields to each column.`}
                />
              )}

              <Divider style={{ margin: '12px 0 10px' }} />
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 6 }}>
                Or enter column headers manually (comma-separated):
              </Text>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={manualHeaders}
                  onChange={e => setManualHeaders(e.target.value)}
                  placeholder="DATE, DESCRIPTION, CHQ.NO, WITHDRAWAL, DEPOSIT, BALANCE"
                  onPressEnter={applyManualHeaders}
                />
                <Button onClick={applyManualHeaders}>Apply</Button>
              </Space.Compact>
            </div>
          )}

          {/* ─ Step 2: Map Columns ─ */}
          {step === 2 && (
            <div>
              {detectedCols.length === 0 ? (
                <Alert type="warning" showIcon
                  message="No columns detected. Go back and upload a PDF or enter column headers manually." />
              ) : (
                <>
                  <Alert type="info" showIcon style={{ marginBottom: 14 }}
                    message="Assign each PDF column header to the corresponding statement field. The system has auto-suggested fields based on the column text."
                  />
                  <Table
                    dataSource={detectedCols.map((c, i) => ({ ...c, _idx: i }))}
                    rowKey="_idx" size="small" pagination={false}
                    columns={[
                      {
                        title: 'Column Text (from PDF)', dataIndex: 'text', width: 220,
                        render: (v: string, r: any) => (
                          <Tooltip title={`X position: ${Math.round(r.x)}`}>
                            <Tag style={{
                              fontSize: 12, padding: '2px 8px',
                              background: (FIELD_COLORS[r.field] ?? '#999') + '18',
                              borderColor: FIELD_COLORS[r.field] ?? '#999',
                              color: FIELD_COLORS[r.field] ?? '#999',
                            }}>
                              {v}
                            </Tag>
                          </Tooltip>
                        ),
                      },
                      {
                        title: 'X Pos', dataIndex: 'x', width: 70, align: 'center',
                        render: v => <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{Math.round(v)}</Text>,
                      },
                      {
                        title: 'Map to Field', key: 'field',
                        render: (_: unknown, r: any) => (
                          <Select style={{ width: '100%' }}
                            value={r.field}
                            onChange={v => updateColField(r._idx, v)}
                            options={FIELD_OPTIONS}
                          />
                        ),
                      },
                    ]}
                  />
                  <div style={{ marginTop: 12, padding: '8px 12px', background: REDWOOD.neutral100, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                      <strong>Required:</strong> at least one column → <strong>Transaction Date</strong> and at least one of <strong>Withdrawal</strong> or <strong>Deposit</strong> (or <strong>Transaction Amount</strong>).
                    </Text>
                  </div>
                </>
              )}
            </div>
          )}
        </Modal>

        {/* ── API Reference Modal ── */}
        <Modal
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Reference — PDF Statement Templates</span></Space>}
          open={apiModal} onCancel={() => setApiModal(false)} footer={null} width={720}
          styles={{ body: { padding: '16px 24px' } }}
        >
          {[
            { method: 'GET',    color: REDWOOD.success, url: `${APEX_BASE}/cash/pdf-templates`,      note: 'List all templates; optional ?business_unit= filter (also returns global templates)' },
            { method: 'POST',   color: REDWOOD.info,    url: `${APEX_BASE}/cash/pdf-templates`,      note: 'Create (no template_id) or Update (with template_id)' },
            { method: 'DELETE', color: REDWOOD.error,   url: `${APEX_BASE}/cash/pdf-templates/{id}`, note: 'Delete by TEMPLATE_ID' },
          ].map(({ method, color, url, note }) => (
            <div key={method} style={{ marginBottom: 14 }}>
              <Space align="start">
                <Tag style={{ background: color, color: '#fff', border: 'none', fontWeight: 600, minWidth: 60, textAlign: 'center' }}>
                  {method}
                </Tag>
                <div>
                  <Text code copyable style={{ fontSize: 11 }}>{url}</Text>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>{note}</Text>
                </div>
              </Space>
            </div>
          ))}

          <Divider style={{ margin: '12px 0 10px' }} />
          <Text strong style={{ fontSize: 12 }}>POST body fields</Text>
          <pre style={{
            background: '#1e1e2e', color: '#cdd6f4', padding: 14, borderRadius: 6,
            fontSize: 11, marginTop: 8, overflowX: 'auto',
          }}>{JSON.stringify({
            template_id:        '(number — omit for create, include for update)',
            template_name:      'string (required)',
            description:        'string | null',
            business_unit_name: 'string | null  (null = applies to all BUs)',
            date_format:        'DD/MM/YYYY | MM/DD/YYYY | DD-MMM-YYYY | YYYY-MM-DD',
            column_mappings:    '[{"text":"DATE","x":35,"xMin":0,"xMax":62,"field":"date"}, ...]',
            header_row_text:    'space-joined column header texts (for auto-detection)',
            created_by:         'APP_USER',
            last_updated_by:    'APP_USER',
          }, null, 2)}</pre>

          <Divider style={{ margin: '12px 0 10px' }} />
          <Text strong style={{ fontSize: 12 }}>column_mappings — field values</Text>
          <pre style={{
            background: '#1e1e2e', color: '#cdd6f4', padding: 14, borderRadius: 6,
            fontSize: 11, marginTop: 8, overflowX: 'auto',
          }}>{`date        — Transaction date column
valueDate   — Value / posting date column
narration   — Description / narration column
reference   — Reference / cheque number column
withdrawal  — Withdrawal / debit amount column
deposit     — Deposit / credit amount column
amount      — Combined amount column (use with "type" field)
type        — DR/CR indicator column (used when "amount" is mapped)
balance     — Running balance column
skip        — Ignore this column`}</pre>
        </Modal>

        {/* ── Designer API Inspector Modal ── */}
        <Modal
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — POST /cash/pdf-templates</span></Space>}
          open={inspectModal} onCancel={() => setInspectModal(false)}
          width={800} footer={null}
          styles={{ body: { padding: '16px 24px' } }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            Endpoint: <Text code copyable style={{ fontSize: 12 }}>{APEX_BASE}/cash/pdf-templates</Text>
          </Text>
          <Divider style={{ margin: '10px 0 8px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text strong style={{ fontSize: 13 }}>Request Body (JSON)</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>Edit the JSON below before sending</Text>
          </div>
          <Input.TextArea
            rows={14}
            value={inspectPayload}
            onChange={e => setInspectPayload(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 12, background: '#1e1e2e', color: '#cdd6f4', borderColor: '#444' }}
          />
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<ApiOutlined />} loading={inspectPosting}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
              onClick={handleInspectPost}>
              POST Request
            </Button>
          </div>
          {inspectResponse && (
            <>
              <Divider style={{ margin: '14px 0 10px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Text strong>Response</Text>
                <Tag color={inspectResponse.status >= 200 && inspectResponse.status < 300 ? 'success' : 'error'}>
                  HTTP {inspectResponse.status || 'Error'}
                </Tag>
              </div>
              <pre style={{
                background: inspectResponse.status >= 200 && inspectResponse.status < 300 ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${inspectResponse.status >= 200 && inspectResponse.status < 300 ? '#b7eb8f' : '#ffccc7'}`,
                color: REDWOOD.neutral900, padding: 14, borderRadius: 6,
                fontSize: 12, overflowX: 'auto', maxHeight: 200,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
              }}>
                {inspectResponse.body}
              </pre>
            </>
          )}
        </Modal>
        {/* ── Test PDF Modal ── */}
        <Modal
          title={
            <Space>
              <ExperimentOutlined style={{ color: REDWOOD.success }} />
              <span>Test PDF — {testTemplate?.templateName}</span>
            </Space>
          }
          open={testModal} onCancel={closeTest} width={900}
          footer={[
            <Button key="close" onClick={closeTest}>Close</Button>,
            <Button key="upload" type="primary" icon={<UploadOutlined />}
              loading={testParsing}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={() => testFileRef.current?.click()}>
              {testParsing ? 'Parsing…' : 'Upload PDF to Test'}
            </Button>,
          ]}
        >
          <input ref={testFileRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={handleTestUpload} />

          {/* Template summary */}
          {testTemplate && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <Tag color="blue">{testTemplate.dateFormat}</Tag>
              {testTemplate.businessUnitName
                ? <Tag color="purple">{testTemplate.businessUnitName}</Tag>
                : <Tag>All BUs</Tag>}
              {testTemplate.columnMappings.filter(c => c.field !== 'skip').map(c => (
                <Tag key={c.text}
                  style={{ fontSize: 10, background: (FIELD_COLORS[c.field] ?? '#999') + '20', border: `1px solid ${FIELD_COLORS[c.field] ?? '#999'}`, color: FIELD_COLORS[c.field] ?? '#999' }}>
                  {c.text} → {c.field}
                </Tag>
              ))}
            </div>
          )}

          {testFileName && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              File: <strong>{testFileName}</strong>
            </Text>
          )}

          {testParsing && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Text type="secondary">Reading PDF…</Text>
            </div>
          )}

          {!testParsing && testErrors.length > 0 && (
            <Alert type="warning" showIcon style={{ marginBottom: 8 }}
              message={`${testErrors.length} warning(s)`}
              description={testErrors.slice(0, 5).join(' | ')} />
          )}

          {!testParsing && testLines.length === 0 && !testFileName && (
            <div style={{ textAlign: 'center', padding: 32, color: REDWOOD.neutral600 }}>
              <ExperimentOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
              <Text type="secondary">Upload a bank statement PDF to test how this template parses it.</Text>
            </div>
          )}

          {!testParsing && testLines.length === 0 && testFileName && testErrors.length > 0 && (
            <Empty description="No transactions could be parsed. Try adjusting column mappings." />
          )}

          {!testParsing && testLines.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Alert type="success" showIcon style={{ flex: 1, margin: 0 }}
                  message={`${testLines.length} transactions parsed${filteredTestLines.length !== testLines.length ? ` — showing ${filteredTestLines.length}` : ''}`} />
                <Input.Search
                  placeholder="Search description, ref, date…"
                  allowClear
                  value={testSearch}
                  onChange={e => setTestSearch(e.target.value)}
                  onSearch={v => setTestSearch(v)}
                  style={{ width: 240 }}
                  size="small"
                />
              </div>
              <Table<ParsedLine>
                dataSource={filteredTestLines} rowKey="_key" size="small" pagination={false}
                scroll={{ y: 340, x: 800 }}
                columns={[
                  { title: 'Date', dataIndex: 'transactionDate', width: 110,
                    render: (v: string) => <Text style={{ fontSize: 11 }}>{v ? dayjs(v).format('D-MMM-YYYY') : '—'}</Text> },
                  { title: 'Description', dataIndex: 'description', ellipsis: true,
                    render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 11 }}>{v || '—'}</Text></Tooltip> },
                  { title: 'Ref', dataIndex: 'reference', width: 100,
                    render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
                  { title: 'Type', dataIndex: 'transactionCode', width: 60,
                    render: (v: string) => <Tag color={v === 'CR' ? 'green' : 'red'} style={{ fontSize: 10 }}>{v}</Tag> },
                  { title: 'Amount', dataIndex: 'amount', width: 130, align: 'right',
                    render: (v: number, r: ParsedLine) => (
                      <Text style={{ fontSize: 11, color: r.transactionCode === 'CR' ? REDWOOD.success : REDWOOD.error }}>
                        {v != null ? v.toLocaleString('en-AE', { minimumFractionDigits: 2 }) : '—'}
                      </Text>
                    )},
                ]}
                summary={() => {
                  const cr = filteredTestLines.filter(r => r.transactionCode === 'CR').reduce((s, r) => s + (r.amount ?? 0), 0);
                  const dr = filteredTestLines.filter(r => r.transactionCode === 'DR').reduce((s, r) => s + (r.amount ?? 0), 0);
                  return (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ background: '#fafafa' }}>
                        <Table.Summary.Cell index={0} colSpan={3}>
                          <Text strong style={{ fontSize: 11 }}>
                            {filteredTestLines.length} rows shown / {testLines.length} total
                          </Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} colSpan={2} align="right">
                          <Text strong style={{ fontSize: 11 }}>
                            <span style={{ color: REDWOOD.success }}>CR: {cr.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                            {' | '}
                            <span style={{ color: REDWOOD.error }}>DR: {dr.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
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
          {!testParsing && testLog.length > 0 && (
            <Collapse size="small" style={{ marginTop: 10 }}
              items={[{
                key: 'log',
                label: (
                  <span style={{ fontSize: 11, color: '#595959' }}>
                    Parse Log — {testLog.length} entries
                    {testLog.filter(l => l.includes('[OK]')).length > 0 &&
                      <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>{testLog.filter(l => l.includes('[OK]')).length} OK</Tag>}
                    {testLog.filter(l => l.includes('[SKIP')).length > 0 &&
                      <Tag color="orange" style={{ fontSize: 10 }}>{testLog.filter(l => l.includes('[SKIP')).length} skipped</Tag>}
                    {testLog.filter(l => l.includes('[NARRATION+')).length > 0 &&
                      <Tag color="blue" style={{ fontSize: 10 }}>{testLog.filter(l => l.includes('[NARRATION+')).length} narration+</Tag>}
                  </span>
                ),
                children: (
                  <pre style={{
                    maxHeight: 260, overflowY: 'auto', margin: 0,
                    fontSize: 10, lineHeight: 1.6, background: '#1e1e2e', color: '#cdd6f4',
                    padding: '10px 12px', borderRadius: 4,
                  }}>
                    {testLog.map((line, i) => {
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
        </Modal>

      </Content>
    </Layout>
  );
};

export default PdfTemplates;
