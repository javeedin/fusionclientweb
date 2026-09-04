import Anthropic from '@anthropic-ai/sdk';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { getFilteredMenuItems } from '../../data/menuItems';

// ── Endpoint catalog (goes into the system prompt) ──────────────────────────
// Read-only GET services the assistant may call through the erp_api_get tool.
// All return JSON, usually { items: [...] }. Keep descriptions short — this
// text is sent with every request.
export const ENDPOINT_CATALOG = `
GENERAL LEDGER
- /gl/journals/headers?p_offset=0&p_limit=50 — journal headers (also ?jeHeaderId=, ?ledger_name=)
- /gl/journals/lines?<filters> — journal lines; filters: je_header_id, reference1..reference5, account, period_name
- /gl/rr-trialbalance/standard?ledger_name=&period_name=&account= — trial balance with opening/period/closing (period like Jun-26)
- /gl/rr-trialbalance/periods — periods available for trial balance
- /gl/periodsstatus — GL period statuses (open/closed)
- /gl/businessunits — business units
- /gl/ledgers — ledgers ( also /ledgers )
- /gl/categories — journal categories
- /glaccountslist — chart of accounts list with descriptions
- /accountanalysis?<filters> — account analysis transactions (account, period/date range)
- /currencies?enabled=Y — currencies; /currencies/dailyrates?from_currency=USD&row_limit=5 — FX rates
- /currencies/bmsrate?source_cur=USD&target_cur=AED&rate_date=YYYY-MM-DD — single conversion rate

ACCOUNTS PAYABLE
- /ap/invoices/stats — AP KPI stats (counts, amounts)
- /ap/invoices/outstanding-by-supplier — outstanding invoice balances grouped by supplier
- /ap/invoices/aging-data — invoice aging buckets
- /ap/payments?limit=100 — payments (filters: payment_number=, supplier_number=)
- /ap/invoice-holds — invoices on hold
- /ap/multiperiod — multiperiod accrual schedules
- /suppliers?limit=200 — suppliers (search: ?q=Supplier LIKE '%X%')
- /suppliers/balance/invoices/{supplierNumber}?status=All&limit=500 — a supplier's invoices with balances

ACCOUNTS RECEIVABLE
- /ar/invoices?<filters> — AR invoices (customer, status, date filters)
- /ar/receipts?<filters> — AR receipts
- /ar/customers — customers
- /ar/invoice-balances — invoice outstanding balances
- /ar/adjustments — AR adjustments
- /ar/receipt-applications — receipt applications

CASH MANAGEMENT
- /cash/bankstatements?<filters> — bank statement headers
- /cash/externaltransactions?row_limit=500 — external cash transactions (filters: bank_account=, status=, date_from=, date_to=)
- /banks/bankaccounts — bank accounts
- /cash/banktransfers — bank transfers
- /cash/recon-status — reconciliation status summary

FIXED ASSETS
- /fa/assets?limit=100 — fixed assets (filter: assetNumber=)
- /fa/deprn-by-period — depreciation by period
- /fa/deprn-workbench — depreciation workbench summary

PETTY CASH
- /pc/registers — petty cash registers
- /pc/transactions/<registerId> — transactions of a register

Conventions: amounts are in the ledger currency (AED for BUIMERC). GL periods use Mon-YY format (e.g. Jun-26). Prefer small limits first; raise only when needed.`;

// ── Tool definitions ────────────────────────────────────────────────────────
export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'erp_api_get',
    description:
      'Run a read-only GET request against the Re-ERP Oracle APEX REST API and return the JSON. ' +
      'Use the endpoint catalog in the system prompt. Path must start with "/" (e.g. "/gl/periodsstatus"). ' +
      'Pass query parameters in params. Responses are truncated to 200 rows — filter or paginate for more.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Endpoint path starting with /, without the base URL' },
        params: {
          type: 'object',
          description: 'Optional query parameters as key/value strings',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_excel_report',
    description:
      'Generate a colourful, professionally formatted Excel (.xlsx) file and download it to the user. ' +
      'Always fill it with REAL data fetched via erp_api_get — never invented figures. Prefer this for any tabular export. ' +
      'Numbers should be passed as numbers (not strings) so they format right-aligned with thousand separators.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name ending with .xlsx' },
        title: { type: 'string', description: 'Report title shown above the table' },
        subtitle: { type: 'string', description: 'Optional subtitle (e.g. period, filters, run date)' },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array' } },
              totalsRow: {
                type: 'array',
                description: 'Optional final totals row (same length as columns; use null for blank cells)',
              },
            },
            required: ['name', 'columns', 'rows'],
          },
        },
      },
      required: ['filename', 'sheets'],
    },
  },
  {
    name: 'erp_api_write',
    description:
      'Run a writing REST call (POST/PUT/DELETE/PATCH) against the Re-ERP Oracle APEX REST API — creates or changes real data. ' +
      'EVERY call shows the user an on-screen approval card (method, path, JSON body) and only runs if they approve. ' +
      'Fetch and validate first, write once, and verify with a GET afterwards where practical.',
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['POST', 'PUT', 'DELETE', 'PATCH'] },
        path: { type: 'string', description: 'Endpoint path starting with /, without the base URL' },
        body: { type: 'object', description: 'JSON request body (omit for DELETE unless the endpoint needs one)' },
        params: {
          type: 'object',
          description: 'Optional query parameters as key/value strings',
          additionalProperties: { type: 'string' },
        },
        summary: { type: 'string', description: 'One short sentence for the approval card: what this write does' },
      },
      required: ['method', 'path'],
    },
  },
  {
    name: 'navigate_to_page',
    description:
      'Navigate the ERP app to one of its pages (opens it for the user right away). ' +
      'Use a path from the APP PAGES catalog in the system prompt; query parameters may be appended when a page supports them ' +
      '(e.g. "/fa/assets?assetNumber=100009"). Use when the user asks to open, go to, or show a page or screen.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'App route starting with /, from the APP PAGES catalog (query string allowed)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_word_document',
    description:
      'Generate a formatted Word (.doc) document and download it to the user. ' +
      'Provide the body as simple HTML (h2, h3, p, table with th/td, ul/li, b). Use for narrative reports, memos, summaries.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name ending with .doc' },
        title: { type: 'string' },
        html: { type: 'string', description: 'Body HTML' },
      },
      required: ['filename', 'html'],
    },
  },
];

// ── Excel builder (Redwood-styled) ──────────────────────────────────────────
export interface ExcelSheetSpec {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
  totalsRow?: (string | number | null)[];
}
export interface ExcelSpec {
  filename?: string;
  title?: string;
  subtitle?: string;
  sheets: ExcelSheetSpec[];
}

const HEADER_BG = 'FFC74634'; // Redwood primary
const TITLE_FG = 'FF3A3632';
const ZEBRA_BG = 'FFFBF1EF';
const BORDER = { style: 'thin' as const, color: { argb: 'FFE0D5D2' } };
const THIN_BORDER = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

async function buildExcel(spec: ExcelSpec): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Re-ERP AI Assistant';
  wb.created = new Date();

  for (const s of spec.sheets || []) {
    const ws = wb.addWorksheet((s.name || 'Sheet').slice(0, 31));
    const cols = s.columns || [];
    let r = 1;

    if (spec.title) {
      ws.mergeCells(1, 1, 1, Math.max(cols.length, 1));
      const tc = ws.getCell(1, 1);
      tc.value = spec.title;
      tc.font = { bold: true, size: 15, color: { argb: TITLE_FG } };
      ws.getRow(1).height = 28;
      r = 2;
      if (spec.subtitle) {
        ws.mergeCells(2, 1, 2, Math.max(cols.length, 1));
        const sc = ws.getCell(2, 1);
        sc.value = spec.subtitle;
        sc.font = { size: 10, italic: true, color: { argb: 'FF8B8580' } };
        r = 3;
      }
    }

    const headerRow = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 22;

    (s.rows || []).forEach((row, ri) => {
      const xr = ws.getRow(r + 1 + ri);
      (row || []).forEach((v, ci) => {
        const cell = xr.getCell(ci + 1);
        cell.value = v === null || v === undefined ? '' : (v as ExcelJS.CellValue);
        cell.border = THIN_BORDER;
        cell.alignment = { vertical: 'middle' };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_BG } };
        if (typeof v === 'number') {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          if (!Number.isInteger(v) || Math.abs(v) >= 1000) cell.numFmt = '#,##0.00';
        }
      });
    });

    if (s.totalsRow && s.totalsRow.length) {
      const tr = ws.getRow(r + 1 + (s.rows || []).length);
      s.totalsRow.forEach((v, ci) => {
        const cell = tr.getCell(ci + 1);
        cell.value = v === null || v === undefined ? '' : (v as ExcelJS.CellValue);
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E6E3' } };
        cell.border = {
          ...THIN_BORDER,
          top: { style: 'double', color: { argb: 'FFC74634' } },
        };
        if (typeof v === 'number') {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        }
      });
    }

    cols.forEach((c, i) => {
      let mx = String(c ?? '').length;
      (s.rows || []).forEach(row => {
        const v = row && row[i];
        if (v !== null && v !== undefined) {
          mx = Math.max(mx, typeof v === 'number' ? v.toLocaleString().length : String(v).length);
        }
      });
      ws.getColumn(i + 1).width = Math.min(Math.max(mx + 3, 10), 52);
    });

    ws.views = [{ state: 'frozen', ySplit: r }];
    if ((s.rows || []).length) {
      ws.autoFilter = {
        from: { row: r, column: 1 },
        to: { row: r, column: Math.max(cols.length, 1) },
      };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ── Word builder (styled HTML → .doc) ───────────────────────────────────────
const escapeHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const WORD_CSS =
  'body{font-family:Calibri,Segoe UI,Arial,sans-serif;color:#3A3632;font-size:11pt;line-height:1.45}' +
  'h1{color:#C74634;border-bottom:2px solid #C74634;padding-bottom:4px;font-size:17pt}' +
  'h2{color:#8B4513;margin-top:16px;font-size:13pt}h3{color:#6B6B6B;font-size:11.5pt}' +
  'table{border-collapse:collapse;width:100%;margin:10px 0}' +
  'th{background:#C74634;color:#fff;padding:7px 8px;border:1px solid #d8b5ae;text-align:left;font-size:10pt}' +
  'td{padding:6px 8px;border:1px solid #e0d5d2;font-size:10pt}tr:nth-child(even) td{background:#FBF1EF}' +
  '.muted{color:#8B8580;font-size:9pt}';

// srcDoc for the in-app preview iframe — same styling as the downloaded .doc
export function wordPreviewSrcDoc(title: string | undefined, html: string | undefined): string {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + WORD_CSS +
    'body{padding:18px 22px;background:#fff}</style></head><body>' +
    (title ? '<h1>' + escapeHtml(title) + '</h1>' : '') + (html || '') + '</body></html>';
}

function buildWordDoc(spec: { title?: string; html?: string }): Blob {
  const css = WORD_CSS;
  const doc =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" ' +
    'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    (spec.title ? '<h1>' + escapeHtml(spec.title) + '</h1>' : '') +
    (spec.html || '') +
    '<p class="muted">Generated by Re-ERP AI Assistant · ' + new Date().toLocaleString() + '</p></body></html>';
  return new Blob(['﻿' + doc], { type: 'application/msword' });
}

// ── ERP API GET ─────────────────────────────────────────────────────────────
const MAX_ROWS = 200;
const MAX_CHARS = 60000;

// One entry per tool call, shown in the chat's API inspector
export interface ApiCallLog {
  tool: string;
  method: string;      // GET for webservices, LOCAL for file builders
  url: string;         // path+query (webservices) or filename (files)
  status: number | 'ERR' | 'OK';
  rows?: number;
  ms: number;
  error?: string;
}

async function erpApiGet(
  apexBase: string,
  path: string,
  params: Record<string, string> | undefined,
  onLog: (log: ApiCallLog) => void,
) {
  const t0 = performance.now();
  const done = (log: Omit<ApiCallLog, 'tool' | 'method' | 'ms'>) =>
    onLog({ tool: 'erp_api_get', method: 'GET', ms: Math.round(performance.now() - t0), ...log });

  if (!path || !path.startsWith('/') || path.includes('..')) {
    done({ url: String(path || ''), status: 'ERR', error: 'invalid path' });
    return { error: 'Invalid path — must start with "/" and contain no "..".' };
  }
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const url = apexBase.replace(/\/+$/, '') + path + qs;
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const text = await res.text();
    if (!res.ok) {
      done({ url: path + qs, status: res.status, error: text.slice(0, 120) });
      return { error: `HTTP ${res.status}`, url: path + qs, body: text.slice(0, 1500) };
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      done({ url: path + qs, status: res.status, error: 'non-JSON response' });
      return { error: 'Non-JSON response', body: text.slice(0, 1500) };
    }
    const obj = data as { items?: unknown[] } & Record<string, unknown>;
    const rows = Array.isArray(obj?.items) ? obj.items.length : undefined;
    done({ url: path + qs, status: res.status, rows });
    if (Array.isArray(obj?.items) && obj.items.length > MAX_ROWS) {
      return { ...obj, items: obj.items.slice(0, MAX_ROWS), truncated: true, totalReturned: obj.items.length };
    }
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    done({ url: path + qs, status: 'ERR', error: msg });
    return { error: msg };
  }
}

// Re-download a delivered file: use the live blob URL when the session still
// has it, otherwise rebuild the file from its stored spec (works after the
// app is reopened, since specs are persisted with the chat history).
export async function downloadDeliveredFile(f: DeliveredFile): Promise<boolean> {
  try {
    if (f.url) { saveAs(f.url, f.name); return true; }
    if (f.excel) { saveAs(await buildExcel(f.excel), f.name); return true; }
    if (f.kind === 'word' && f.wordHtml !== undefined) {
      saveAs(buildWordDoc({ title: f.wordTitle, html: f.wordHtml }), f.name);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── App navigation ──────────────────────────────────────────────────────────
// Only routes from the menu catalog (plus an optional query string) are allowed.
export function resolveAppPath(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const path = String(raw || '').trim();
  if (!path.startsWith('/')) return { ok: false, error: 'Path must start with "/"' };
  const base = path.split('?')[0].replace(/\/+$/, '') || '/';
  const known = getFilteredMenuItems().some(m => {
    const mp = m.path.replace(/\/+$/, '');
    return base === mp || base.startsWith(mp + '/');
  });
  if (!known) return { ok: false, error: `Unknown page "${base}" — use a path from the APP PAGES catalog` };
  return { ok: true, path };
}

// ── ERP API write (POST/PUT/DELETE/PATCH — user-approved) ───────────────────
export interface PendingWrite {
  method: string;
  path: string;
  body?: unknown;
  summary?: string;
}

async function erpApiWrite(
  apexBase: string,
  method: string,
  path: string,
  params: Record<string, string> | undefined,
  body: unknown,
  onLog: (log: ApiCallLog) => void,
) {
  const t0 = performance.now();
  const done = (log: Omit<ApiCallLog, 'tool' | 'method' | 'ms'>) =>
    onLog({ tool: 'erp_api_write', method, ms: Math.round(performance.now() - t0), ...log });

  if (!path || !path.startsWith('/') || path.includes('..')) {
    done({ url: String(path || ''), status: 'ERR', error: 'invalid path' });
    return { error: 'Invalid path — must start with "/" and contain no "..".' };
  }
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const url = apexBase.replace(/\/+$/, '') + path + qs;
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    done({ url: path + qs, status: res.status, error: res.ok ? undefined : text.slice(0, 120) });
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1500) }; }
    return res.ok
      ? { status: res.status, response: data }
      : { error: `HTTP ${res.status}`, response: data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    done({ url: path + qs, status: 'ERR', error: msg });
    return { error: msg };
  }
}

// ── Tool executor ───────────────────────────────────────────────────────────
export interface DeliveredFile {
  name: string;
  url: string;
  kind?: 'excel' | 'word';
  // in-memory preview data (stripped when history is persisted)
  excel?: ExcelSpec;
  wordHtml?: string;
  wordTitle?: string;
}

export async function runAssistantTool(
  name: string,
  input: Record<string, unknown>,
  apexBase: string,
  deliver: (file: DeliveredFile) => void,
  onLog: (log: ApiCallLog) => void = () => {},
  navigate?: (path: string) => void,
  confirmWrite?: (w: PendingWrite) => Promise<boolean>,
): Promise<string> {
  const t0 = performance.now();
  try {
    let result: unknown;
    switch (name) {
      case 'erp_api_get':
        result = await erpApiGet(apexBase, String(input.path || ''), input.params as Record<string, string> | undefined, onLog);
        break;
      case 'erp_api_write': {
        const method = String(input.method || 'POST').toUpperCase();
        const path = String(input.path || '');
        if (!confirmWrite) {
          result = { error: 'Write access is not available in this context' };
          break;
        }
        const approved = await confirmWrite({
          method, path, body: input.body, summary: input.summary as string | undefined,
        });
        if (!approved) {
          onLog({ tool: name, method, url: path, status: 'ERR', error: 'declined by user', ms: Math.round(performance.now() - t0) });
          result = { cancelled: true, message: 'The user declined this write. Do not retry it — ask what to change instead.' };
          break;
        }
        result = await erpApiWrite(apexBase, method, path, input.params as Record<string, string> | undefined, input.body, onLog);
        break;
      }
      case 'navigate_to_page': {
        const resolved = resolveAppPath(String(input.path || ''));
        const ms = () => Math.round(performance.now() - t0);
        if (!resolved.ok) {
          onLog({ tool: name, method: 'NAV', url: String(input.path || ''), status: 'ERR', error: resolved.error, ms: ms() });
          result = { error: resolved.error };
        } else if (!navigate) {
          onLog({ tool: name, method: 'NAV', url: resolved.path, status: 'ERR', error: 'navigation unavailable', ms: ms() });
          result = { error: 'Navigation is not available in this context' };
        } else {
          navigate(resolved.path);
          onLog({ tool: name, method: 'NAV', url: resolved.path, status: 'OK', ms: ms() });
          result = { status: 'navigated', path: resolved.path, note: 'The page is now open for the user.' };
        }
        break;
      }
      case 'create_excel_report': {
        const spec = input as unknown as ExcelSpec;
        const blob = await buildExcel(spec);
        const fname = (spec.filename || 'report.xlsx').replace(/[^\w .()-]/g, '_');
        saveAs(blob, fname);
        deliver({ name: fname, url: URL.createObjectURL(blob), kind: 'excel', excel: spec });
        const rows = (spec.sheets || []).reduce((n, s) => n + (s.rows?.length || 0), 0);
        onLog({ tool: name, method: 'LOCAL', url: fname, status: 'OK', rows, ms: Math.round(performance.now() - t0) });
        result = { status: 'created and downloaded', filename: fname };
        break;
      }
      case 'create_word_document': {
        const spec = input as { filename?: string; title?: string; html?: string };
        const blob = buildWordDoc(spec);
        const fname = (spec.filename || 'document.doc').replace(/[^\w .()-]/g, '_');
        saveAs(blob, fname);
        deliver({ name: fname, url: URL.createObjectURL(blob), kind: 'word', wordHtml: spec.html, wordTitle: spec.title });
        onLog({ tool: name, method: 'LOCAL', url: fname, status: 'OK', ms: Math.round(performance.now() - t0) });
        result = { status: 'created and downloaded', filename: fname };
        break;
      }
      default:
        result = { error: `Unknown tool: ${name}` };
    }
    const s = JSON.stringify(result);
    return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + '…(truncated)' : s;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onLog({ tool: name, method: 'ERR', url: '', status: 'ERR', error: msg, ms: Math.round(performance.now() - t0) });
    return JSON.stringify({ error: msg });
  }
}

// ── System prompt ───────────────────────────────────────────────────────────
export function buildSystemPrompt(companyCode: string, userName: string): string {
  return (
    `You are the Re-ERP AI Assistant, embedded in an Oracle Fusion companion ERP (company: ${companyCode || 'BUIMERC'}, user: ${userName || 'user'}). ` +
    `You answer questions about LIVE data across all modules — GL, AP, AR, Cash, Fixed Assets, Petty Cash — and produce downloadable reports.\n\n` +
    `RULES\n` +
    `- ALWAYS fetch real data with erp_api_get before answering anything about balances, journals, invoices, payments, receipts, assets or transactions. Never invent figures.\n` +
    `- When asked for a report, export, spreadsheet or document: call create_excel_report (preferred for tables — it produces a colourful formatted workbook) or create_word_document, filled with the data you fetched. Include a totalsRow for amount columns where it makes sense. After the file downloads, summarise its contents briefly.\n` +
    `- Chain calls when needed (e.g. look up a supplier number first, then fetch its invoices).\n` +
    `- If an endpoint errors or returns nothing, say so briefly, and try a sensible alternative endpoint or filter once before giving up.\n` +
    `- Keep chat answers concise. Use markdown tables for small result sets (≤15 rows); offer an Excel download for bigger ones.\n` +
    `- When the user asks to open / go to / show a screen, call navigate_to_page with a path from APP PAGES (query params allowed where pages support them, e.g. /fa/assets?assetNumber=100009). Confirm briefly what you opened.\n` +
    `- Amounts: format with thousand separators, 2 decimals. GL periods are Mon-YY (e.g. Jun-26). Ledger currency is AED unless data says otherwise.\n\n` +
    `WRITE ACCESS (via erp_api_write — every call requires the user's on-screen approval)\n` +
    `- You can create/update data with POST/PUT/DELETE. Known write endpoints:\n` +
    `  - POST /gl/journals/create — create a GL journal batch (batch + journals + lines payload, same as the app's Create Accounting)\n` +
    `  - PUT /gl/journals/batches/{jeBatchId}/period — change a batch's period + accounting date (body: periodName, accountingDate YYYY-MM-DD, updatedBy; they must be in the same GL period)\n` +
    `  - PUT /pc/transactions/{id}/status — set a petty cash transaction's account status (e.g. Posted)\n` +
    `  - PUT /ar/receipts/{id}/credits — replace a MISC receipt's multiple credit lines (lines total must equal the receipt amount)\n` +
    `  - Many collection endpoints also accept POST to create records (AR invoices/receipts, AP invoices, journals). When unsure of a payload shape, GET a similar existing record first and mirror its fields, or ask the user — never guess field names blindly.\n` +
    `- Before any write: fetch what you need, validate (period open, totals balance, no duplicates), then propose ONE write at a time with a clear summary. After success, verify with a GET when practical and report the created/updated ids.\n` +
    `- Never invent account combinations, amounts or ids — derive them from fetched data or the user's words. If the user declines a write, do not retry it unchanged.\n\n` +
    `AVAILABLE ENDPOINTS (via erp_api_get)\n${ENDPOINT_CATALOG}\n\n` +
    `APP PAGES (via navigate_to_page)\n${buildPageCatalog()}`
  );
}

// Compact "path — label" catalog grouped by module, for the system prompt
function buildPageCatalog(): string {
  const byModule = new Map<string, string[]>();
  for (const m of getFilteredMenuItems()) {
    if (!byModule.has(m.moduleLabel)) byModule.set(m.moduleLabel, []);
    byModule.get(m.moduleLabel)!.push(`${m.path} — ${m.label}`);
  }
  return Array.from(byModule.entries())
    .map(([label, pages]) => `${label.toUpperCase()}\n${pages.map(p => `- ${p}`).join('\n')}`)
    .join('\n');
}
