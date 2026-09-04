import Anthropic from '@anthropic-ai/sdk';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

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
interface ExcelSheetSpec {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
  totalsRow?: (string | number | null)[];
}
interface ExcelSpec {
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

function buildWordDoc(spec: { title?: string; html?: string }): Blob {
  const css =
    'body{font-family:Calibri,Segoe UI,Arial,sans-serif;color:#3A3632;font-size:11pt;line-height:1.45}' +
    'h1{color:#C74634;border-bottom:2px solid #C74634;padding-bottom:4px;font-size:17pt}' +
    'h2{color:#8B4513;margin-top:16px;font-size:13pt}h3{color:#6B6B6B;font-size:11.5pt}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0}' +
    'th{background:#C74634;color:#fff;padding:7px 8px;border:1px solid #d8b5ae;text-align:left;font-size:10pt}' +
    'td{padding:6px 8px;border:1px solid #e0d5d2;font-size:10pt}tr:nth-child(even) td{background:#FBF1EF}' +
    '.muted{color:#8B8580;font-size:9pt}';
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

// ── Tool executor ───────────────────────────────────────────────────────────
export interface DeliveredFile { name: string; url: string }

export async function runAssistantTool(
  name: string,
  input: Record<string, unknown>,
  apexBase: string,
  deliver: (file: DeliveredFile) => void,
  onLog: (log: ApiCallLog) => void = () => {},
): Promise<string> {
  const t0 = performance.now();
  try {
    let result: unknown;
    switch (name) {
      case 'erp_api_get':
        result = await erpApiGet(apexBase, String(input.path || ''), input.params as Record<string, string> | undefined, onLog);
        break;
      case 'create_excel_report': {
        const spec = input as unknown as ExcelSpec;
        const blob = await buildExcel(spec);
        const fname = (spec.filename || 'report.xlsx').replace(/[^\w .()-]/g, '_');
        saveAs(blob, fname);
        deliver({ name: fname, url: URL.createObjectURL(blob) });
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
        deliver({ name: fname, url: URL.createObjectURL(blob) });
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
    `- Amounts: format with thousand separators, 2 decimals. GL periods are Mon-YY (e.g. Jun-26). Ledger currency is AED unless data says otherwise.\n\n` +
    `AVAILABLE ENDPOINTS (via erp_api_get)\n${ENDPOINT_CATALOG}`
  );
}
