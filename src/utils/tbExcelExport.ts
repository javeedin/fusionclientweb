/**
 * tbExcelExport.ts
 * Styled Excel exports for Trial Balance reports using ExcelJS.
 *
 * Sheet-writing logic is extracted into writeFusionSheet / writeRrSheet so the
 * same code can populate either a standalone workbook or both sheets in a
 * combined "Fusion + ReERP" workbook.
 */

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// ─────────────────────────────────────────────────────────────────────────────
// Palette  (ARGB — first two chars = alpha, always FF = fully opaque)
// ─────────────────────────────────────────────────────────────────────────────
const P = {
  TITLE_BG:   'FFC74634',   // Oracle Redwood red
  TITLE_SUB:  'FFA33B2C',   // darker red (subtitle row)
  COL_HDR:    'FF1A3C5E',   // dark navy  (column header row)
  INFO_BG:    'FFF8F9FA',   // very light grey (info rows)
  TOTAL_BG:   'FFE8F0FE',   // pale blue (totals row)
  WHITE:      'FFFFFFFF',
  DARK:       'FF1A1A1A',
  GREY:       'FF6B6B6B',
  BORDER_MED: 'FF2E6DA4',
  HAIR:       'FFE5E5E5',
  // Account type row tints (ReERP sheet)
  A: 'FFEBF5FB',
  L: 'FFFFF9E6',
  O: 'FFEAFAF1',
  R: 'FFFDF2F8',
  E: 'FFF4ECF7',
  EVEN: 'FFFAFBFC',
};

const TYPE_LABEL: Record<string, string> = {
  A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense',
};

const NUM_FMT = '#,##0.00;[Red](#,##0.00)';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const solid = (argb: string): ExcelJS.Fill => ({
  type: 'pattern', pattern: 'solid', fgColor: { argb },
});

const hairBottom: Partial<ExcelJS.Borders> = {
  bottom: { style: 'hair', color: { argb: P.HAIR } },
};

const todayStr = () =>
  new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

async function saveWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const eAPI = (window as any).electronAPI;
  if (eAPI?.openExcel) {
    await eAPI.openExcel(new Uint8Array(buf as ArrayBuffer), filename);
  } else {
    saveAs(
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: branded header block (rows 1–9)
// ─────────────────────────────────────────────────────────────────────────────
function writeHeader(
  ws:        ExcelJS.Worksheet,
  numCols:   number,
  titleText: string,
  info: { ledger: string; company: string; period: string; currency: string },
) {
  const infoItems: [string, string][] = [
    ['Ledger',    info.ledger],
    ['Company',   info.company],
    ['Period',    info.period],
    ['Currency',  info.currency],
    ['Generated', todayStr()],
  ];

  // Row 1 — Title
  ws.mergeCells(1, 1, 1, numCols);
  const title = ws.getCell(1, 1);
  title.value     = titleText;
  title.font      = { bold: true, size: 15, color: { argb: P.WHITE }, name: 'Calibri' };
  title.fill      = solid(P.TITLE_BG);
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 32;

  // Row 2 — Subtitle
  ws.mergeCells(2, 1, 2, numCols);
  const sub = ws.getCell(2, 1);
  sub.value     = `${info.ledger}   ·   ${info.period}   ·   Company: ${info.company}   ·   CCY: ${info.currency}`;
  sub.font      = { size: 10, italic: true, color: { argb: P.WHITE }, name: 'Calibri' };
  sub.fill      = solid(P.TITLE_SUB);
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 18;

  // Row 3 — spacer
  ws.getRow(3).height = 5;

  // Rows 4-8 — info detail
  infoItems.forEach(([label, value], i) => {
    const rn = 4 + i;
    const row = ws.getRow(rn);
    row.height = 17;
    for (let c = 1; c <= numCols; c++) ws.getCell(rn, c).fill = solid(P.INFO_BG);
    ws.mergeCells(rn, 3, rn, numCols);
    const lCell = ws.getCell(rn, 2);
    const vCell = ws.getCell(rn, 3);
    lCell.value     = `${label}:`;
    lCell.font      = { bold: true, size: 10, color: { argb: P.GREY }, name: 'Calibri' };
    lCell.alignment = { horizontal: 'right', vertical: 'middle' };
    vCell.value     = value;
    vCell.font      = { bold: true, size: 10, color: { argb: P.DARK }, name: 'Calibri' };
    vCell.alignment = { horizontal: 'left',  vertical: 'middle', indent: 1 };
    for (let c = 1; c <= numCols; c++) ws.getCell(rn, c).border = hairBottom;
  });

  // Row 9 — spacer
  ws.getRow(9).height = 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: column header row (row 10) + freeze + auto-filter
// ─────────────────────────────────────────────────────────────────────────────
function writeColHeaders(
  ws:          ExcelJS.Worksheet,
  rowNum:      number,
  headers:     string[],
  numericFrom: number,
) {
  const row = ws.getRow(rowNum);
  row.height = 23;
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value     = h;
    cell.font      = { bold: true, size: 10, color: { argb: P.WHITE }, name: 'Calibri' };
    cell.fill      = solid(P.COL_HDR);
    cell.alignment = {
      horizontal: i + 1 < numericFrom ? 'left' : 'right',
      vertical:   'middle',
      indent:     i + 1 < numericFrom ? 1 : 0,
    };
    cell.border = { bottom: { style: 'medium', color: { argb: P.BORDER_MED } } };
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: rowNum, activeCell: `A${rowNum + 1}` }];
  ws.autoFilter = { from: { row: rowNum, column: 1 }, to: { row: rowNum, column: headers.length } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: totals row
// ─────────────────────────────────────────────────────────────────────────────
function writeTotalsRow(
  ws:          ExcelJS.Worksheet,
  values:      (string | number)[],
  numericFrom: number,
) {
  ws.addRow([]).height = 4;
  const row = ws.addRow(values);
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell, c) => {
    cell.font  = { bold: true, size: 11, name: 'Calibri' };
    cell.fill  = solid(P.TOTAL_BG);
    cell.border = { top: { style: 'medium' }, bottom: { style: 'double' } };
    if (c >= numericFrom && typeof cell.value === 'number') {
      cell.numFmt    = NUM_FMT;
      cell.alignment = { horizontal: 'right' };
    }
    if (c === numericFrom - 1) {
      cell.alignment = { horizontal: 'right' };
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────
export interface RrTBRow {
  account_type:    string;
  account:         string;
  account_desc:    string;
  opening:         number;
  debit:           number;
  credit:          number;
  closing:         number;
  ytd_net:         number;
  entered_opening: number;
  entered_debit:   number;
  entered_credit:  number;
  entered_closing: number;
}

export interface RrTBTotals {
  opening: number; debit: number; credit: number; closing: number; ytd_net: number;
  entered_opening: number; entered_debit: number; entered_credit: number; entered_closing: number;
}

export interface FusionTBRow {
  account:         string;
  account_desc:    string;
  opening_balance: number;
  debit:           number;
  credit:          number;
  closing_balance: number;
  [key: string]: string | number;
}

export interface FusionTBTotals {
  opening: number; debit: number; credit: number; closing: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet writers — write into an existing worksheet (no save)
// ─────────────────────────────────────────────────────────────────────────────
function writeFusionSheet(
  ws:       ExcelJS.Worksheet,
  info:     { ledger: string; company: string; period: string; currency: string },
  rows:     FusionTBRow[],
  totals:   FusionTBTotals,
  segments: string[],
  segKeys:  string[],
) {
  const FIXED_HDR = ['Account', 'Description', ...segments];
  const AMT_HDR   = ['Opening Balance', 'Debit', 'Credit', 'Closing Balance'];
  const HEADERS   = [...FIXED_HDR, ...AMT_HDR];
  const NUM_COL   = FIXED_HDR.length + 1;
  const NUM_COLS  = HEADERS.length;

  const COL_WIDTHS = [14, 42, ...segments.map(() => 12), 18, 18, 18, 18];
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  writeHeader(ws, NUM_COLS, 'ORACLE GL TRIAL BALANCE', info);
  writeColHeaders(ws, 10, HEADERS, NUM_COL);

  rows.forEach((r, idx) => {
    const bgArgb = idx % 2 === 0 ? P.WHITE : P.EVEN;
    const row = ws.addRow([
      r.account,
      r.account_desc || '',
      ...segKeys.map(k => r[k] || ''),
      r.opening_balance || 0,
      r.debit           || 0,
      r.credit          || 0,
      r.closing_balance || 0,
    ]);
    row.height = 16;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.fill   = solid(bgArgb);
      cell.border = hairBottom;
      if (c === 1) {
        cell.font = { bold: true, size: 10, name: 'Calibri' };
      } else if (c === 2) {
        cell.font = { size: 10, name: 'Calibri' };
        cell.alignment = { indent: 1, wrapText: false };
      } else if (c < NUM_COL) {
        cell.font      = { size: 10, name: 'Calibri' };
        cell.alignment = { horizontal: 'center' };
      } else {
        cell.numFmt    = NUM_FMT;
        cell.alignment = { horizontal: 'right' };
        cell.font      = { size: 10, name: 'Calibri' };
      }
    });
  });

  writeTotalsRow(ws,
    ['', 'TOTAL', ...segKeys.map(() => ''), totals.opening, totals.debit, totals.credit, totals.closing],
    NUM_COL,
  );
}

function writeRrSheet(
  ws:     ExcelJS.Worksheet,
  info:   { ledger: string; company: string; period: string; currency: string },
  rows:   RrTBRow[],
  totals: RrTBTotals,
) {
  const HEADERS  = [
    'Type', 'Account', 'Description',
    'Acc Opening', 'Acc Debit', 'Acc Credit', 'Acc Closing',
    'Ent Opening', 'Ent Debit', 'Ent Credit', 'Ent Closing',
    'YTD Net',
  ];
  const NUM_COL  = 4;
  const NUM_COLS = HEADERS.length;

  const COL_WIDTHS = [12, 14, 42, 18, 18, 18, 18, 18, 18, 18, 18, 18];
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  writeHeader(ws, NUM_COLS, 'REERP TRIAL BALANCE', info);
  writeColHeaders(ws, 10, HEADERS, NUM_COL);

  rows.forEach((r, idx) => {
    const bgArgb = (P as any)[r.account_type] || (idx % 2 === 0 ? P.WHITE : P.EVEN);
    const row = ws.addRow([
      TYPE_LABEL[r.account_type] || r.account_type,
      r.account,
      r.account_desc || '',
      r.opening, r.debit, r.credit, r.closing,
      r.entered_opening || 0, r.entered_debit || 0, r.entered_credit || 0, r.entered_closing || 0,
      r.ytd_net,
    ]);
    row.height = 16;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.fill   = solid(bgArgb);
      cell.border = hairBottom;
      if      (c === 1) { cell.font = { size: 9, italic: true, color: { argb: P.GREY }, name: 'Calibri' }; }
      else if (c === 2) { cell.font = { size: 10, bold: true, name: 'Calibri' }; }
      else if (c === 3) { cell.font = { size: 10, name: 'Calibri' }; cell.alignment = { indent: 1, wrapText: false }; }
      else { cell.numFmt = NUM_FMT; cell.alignment = { horizontal: 'right' }; cell.font = { size: 10, name: 'Calibri' }; }
    });
  });

  writeTotalsRow(ws,
    ['', '', 'TOTAL',
     totals.opening, totals.debit, totals.credit, totals.closing,
     totals.entered_opening || 0, totals.entered_debit || 0, totals.entered_credit || 0, totals.entered_closing || 0,
     totals.ytd_net],
    NUM_COL,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public exports
// ─────────────────────────────────────────────────────────────────────────────

/** Single-sheet: Oracle Fusion GL Trial Balance */
export async function exportFusionTBToExcel(opts: {
  ledger: string; company: string; period: string; currency: string;
  segments: string[]; segKeys: string[];
  rows: FusionTBRow[]; totals: FusionTBTotals;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ReERP'; wb.created = new Date();
  const ws = wb.addWorksheet(`Fusion TB ${opts.period}`.slice(0, 31));
  writeFusionSheet(ws, opts, opts.rows, opts.totals, opts.segments, opts.segKeys);
  await saveWorkbook(wb, `Fusion_TrialBalance_${opts.period.replace(/[^a-zA-Z0-9-]/g, '_')}.xlsx`);
}

/** Single-sheet: ReERP Standard Trial Balance */
export async function exportRrTBToExcel(opts: {
  ledger: string; company: string; period: string; currency: string;
  rows: RrTBRow[]; totals: RrTBTotals;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ReERP'; wb.created = new Date();
  const ws = wb.addWorksheet(`RR TB ${opts.period}`.slice(0, 31));
  writeRrSheet(ws, opts, opts.rows, opts.totals);
  await saveWorkbook(wb, `RR_TrialBalance_${opts.period.replace(/[^a-zA-Z0-9-]/g, '_')}.xlsx`);
}

/** Two-sheet workbook: Sheet 1 = Fusion TB, Sheet 2 = ReERP TB */
export async function exportBothTBToExcel(opts: {
  ledger: string; company: string; period: string; currency: string;
  fusionRows: FusionTBRow[]; fusionTotals: FusionTBTotals;
  rrRows: RrTBRow[]; rrTotals: RrTBTotals;
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ReERP'; wb.created = new Date();

  const ws1 = wb.addWorksheet('Fusion TB');
  writeFusionSheet(ws1, opts, opts.fusionRows, opts.fusionTotals, [], []);

  const ws2 = wb.addWorksheet('ReERP TB');
  writeRrSheet(ws2, opts, opts.rrRows, opts.rrTotals);

  await saveWorkbook(
    wb,
    `TrialBalance_Combined_${opts.period.replace(/[^a-zA-Z0-9-]/g, '_')}.xlsx`,
  );
}
