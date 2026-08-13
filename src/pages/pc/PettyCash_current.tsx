import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Typography, Breadcrumb, Tabs, Form, Input, Select,
  DatePicker, Button, Table, Tag, Row, Col, Space, Divider,
  Modal, InputNumber, message, Tooltip, Statistic, Collapse, Progress, Descriptions, Upload,
  Spin, Alert, Switch, Dropdown, Popover, Badge, Segmented,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  HomeOutlined, WalletOutlined, PlusOutlined, SearchOutlined,
  ReloadOutlined, EditOutlined, DeleteOutlined, CloseOutlined,
  DollarOutlined, MinusCircleOutlined, ArrowUpOutlined, ArrowDownOutlined,
  DownloadOutlined, RollbackOutlined, BankOutlined,
  LockOutlined, UnlockOutlined, UserOutlined, FieldNumberOutlined, ApiOutlined,
  SwapOutlined, UploadOutlined, PaperClipOutlined, EyeOutlined,
  BookOutlined, CheckCircleOutlined, SyncOutlined, ExclamationCircleOutlined,
  TagOutlined, PrinterOutlined, FilePdfOutlined, BranchesOutlined,
  QuestionCircleOutlined, FullscreenOutlined, FullscreenExitOutlined,
} from '@ant-design/icons';
import FloatingMenu from '../../components/FloatingMenu';
import ApiDocsModal, { type ApiEndpoint } from '../../components/ApiDocsModal';
import AccountSelector, { validateAccountCode } from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import { useGlValidation } from '../../context/GlValidationContext';
import { APEX_DB_CONFIG } from '../../config/api.config';
import {
  validateGlPayload,
  persistValidationLog,
  type GlJournalPayload,
  type GlValidationLogEntry,
} from '../../services/glValidation.service';
import {
  searchRegisters, getRegister, createRegister, updateRegister, deleteRegister,
  getTransactions, getTransaction, createTransaction, updateTransaction, updateTransactionStatus, deleteTransaction,
  getTransactionAttachment, getOpenAPPeriods, getNextVoucherNo,
  addAttachment, getAttachments, getAttachmentData, deleteAttachment,
  type PCRegister, type PCTransaction, type APPeriod, type PCAttachment,
} from '../../services/pc.service';
import {
  searchCombinations,
  createCombination,
  type DistCombination,
} from '../../services/distCombinations.service';
import {
  getAccounting, fetchLedgerByBusinessUnit, derivePeriodName,
  type SlaGetResult,
} from '../../services/sla.service';
import { getGlJournalByTxnId } from '../../services/manage-journals.service';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  error: '#C74634', neutral100: '#F7F7F7', neutral200: '#E5E5E5',
  neutral300: '#C7C7C7', neutral600: '#6B6B6B', neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface RegisterTab {
  key: string;
  register: PCRegister;
  transactions: PCTransaction[];
  txnLoading: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status tag helper
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default', ACTIVE: 'green', INACTIVE: 'orange', CLOSED: 'red', Transferred: 'purple',
};
const StatusTag: React.FC<{ status: string }> = ({ status }) => (
  <Tag color={STATUS_COLOR[status] ?? 'default'} style={{ fontSize: 11 }}>
    {status}
  </Tag>
);

const PostingTag: React.FC<{ status: string }> = ({ status }) => {
  const color = status === 'Posted' ? 'green' : status === 'Error' ? 'red' : 'default';
  return <Tag color={color} style={{ fontSize: 11 }}>{status}</Tag>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Accounting progress row
// ─────────────────────────────────────────────────────────────────────────────
interface AcctDrLine {
  txnId:         number;
  chargeAccount: string;
  chargeDesc:    string;
  amount:        number;
  expenseType:   string | null;
  description:   string | null;
}

interface AcctProgressRow {
  // primary key — first txnId in group
  txnId:           number;
  lineNumber:      number;
  transactionType: string;
  expenseType:     string | null;  // joined for display
  amount:          number;          // total amount for the group
  currency:        string;
  accountingDate:  string;
  periodName:      string;
  drAccount:       string;          // first DR account (display fallback)
  drAccountDesc:   string;
  crAccount:       string;
  crAccountDesc:   string;
  status:          'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?:        string;
  headerId?:       number;
  // reference-group fields
  refNo:               string;       // reference number or unique key for no-ref rows
  referenceDescription?: string | null; // used as Cr line description in GL journal
  txnIds:          number[];        // all txnIds in this group
  drLines:         AcctDrLine[];    // one per transaction in the group
}

// Convert Oracle DD-MON-YYYY or any ISO-ish string to YYYY-MM-DD
const MON_MAP: Record<string, string> = {
  JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12',
};
function toIsoDate(s: string | null | undefined): string {
  if (!s) return '';
  const ddMon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (ddMon) return `${ddMon[3]}-${MON_MAP[ddMon[2].toUpperCase()] ?? '01'}-${ddMon[1].padStart(2,'0')}`;
  return s.slice(0, 10); // already ISO or truncate
}

interface ApiDebugItem {
  label:     string;
  url:       string;
  body:      unknown;
  response?: unknown;
  loading?:  boolean;
  error?:    string;
}

type TxnRow = PCTransaction & { __group?: true; __childOf?: string; children?: TxnRow[] };

interface ExpenseLine {
  key:              string;
  expenseType:      string;
  amount:           number | null;
  description:      string;
  paidTo:           string;
  chargeAccountDesc: string;
  chargeAccountCcid: number | null;
  acctDesc:         string;
}
let _lineSeq = 0;
const makeNewLine = (): ExpenseLine => ({
  key: String(++_lineSeq), expenseType: '', amount: null,
  description: '', paidTo: '', chargeAccountDesc: '', chargeAccountCcid: null, acctDesc: '',
});

// ─────────────────────────────────────────────────────────────────────────────
// Excel export
// ─────────────────────────────────────────────────────────────────────────────
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const numFmt = '#,##0.00;[Red](#,##0.00)';

async function exportRegisterToExcel(register: PCRegister, transactions: PCTransaction[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'ReactERP';
  wb.created  = new Date();
  const ws = wb.addWorksheet('Petty Cash Register', { views: [{ showGridLines: false }] });

  // ── column widths ──────────────────────────────────────────
  ws.columns = [
    { width: 6  }, // A  #
    { width: 14 }, // B  Date
    { width: 18 }, // C  Type
    { width: 20 }, // D  Expense Type
    { width: 10 }, // E  Currency
    { width: 16 }, // F  Debit
    { width: 16 }, // G  Credit
    { width: 16 }, // H  Balance
    { width: 26 }, // I  Charge Account
    { width: 14 }, // J  Acct Date
    { width: 12 }, // K  Posting
    { width: 20 }, // L  Reference
    { width: 30 }, // M  Comments
    { width: 22 }, // N  Created By
  ];

  // ── Title row ──────────────────────────────────────────────
  ws.mergeCells('A1:N1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Petty Cash Register — Export';
  titleCell.font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill  = solid('FFC74634');
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 32;

  // ── Register header section ─────────────────────────────────
  const hdr: [string, string | number][] = [
    ['Register Name',   register.registerName],
    ['Business Unit',   register.businessUnit || '—'],
    ['Register ID',     register.registerId],
    ['Status',          register.status],
    ['Currency',        register.currency],
    ['Start Date',      register.startDate || '—'],
    ['End Date',        register.endDate   || '—'],
    ['Cash Account',    register.cashAccountDesc || '—'],
    ['Balance',         register.balance],
    ['Total Money In',  register.totalDebit],
    ['Total Money Out',register.totalCredit],
    ['Export Date',     new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })],
  ];

  let r = 2;
  for (const [label, val] of hdr) {
    ws.mergeCells(`C${r}:F${r}`);
    ws.mergeCells(`G${r}:N${r}`);
    const lbl = ws.getCell(`C${r}`);
    lbl.value = label;
    lbl.font  = { bold: true, size: 11, color: { argb: 'FF1A3C5E' } };
    lbl.fill  = solid('FFF0F4FA');
    lbl.alignment = { horizontal: 'right', vertical: 'middle' };
    lbl.border = { bottom: { style: 'hair', color: { argb: 'FFE5E5E5' } } };

    const val_cell = ws.getCell(`G${r}`);
    val_cell.value = val;
    val_cell.font  = { size: 11 };
    val_cell.fill  = solid('FFFFFFFF');
    val_cell.alignment = { horizontal: 'left', vertical: 'middle' };
    val_cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E5E5' } } };
    if (typeof val === 'number') val_cell.numFmt = numFmt;
    ws.getRow(r).height = 18;
    r++;
  }

  r++; // blank spacer

  // ── Transactions header row ────────────────────────────────
  const COLS = ['#','Date','Type','Expense Type','Currency','Debit','Credit','Balance',
                'Charge Account','Acct Date','Posting','Reference','Comments','Created By'];
  const hdrRow = ws.getRow(r);
  COLS.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h;
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill  = solid('FF1A3C5E');
    cell.alignment = { horizontal: i >= 5 && i <= 7 ? 'right' : 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF2E6DA4' } } };
  });
  hdrRow.height = 22;
  r++;

  // ── Transaction rows ───────────────────────────────────────
  const startDataRow = r;
  for (const txn of transactions) {
    const isRefill = txn.transactionType === 'Balance Refill';
    const rowBg    = isRefill ? 'FFF0FFF4' : 'FFFFFFFF';
    const rowData  = ws.getRow(r);

    const vals: (string | number | null)[] = [
      txn.lineNumber, txn.transactionDate, txn.transactionType,
      txn.expenseType || '', txn.currency,
      txn.debitAmount  || 0,
      txn.creditAmount || 0,
      txn.runningBalance,
      txn.chargeAccountDesc || '', txn.accountingDate || '',
      txn.postingStatus, txn.referenceNo || '',
      txn.comments || '', txn.createdBy || '',
    ];

    vals.forEach((v, i) => {
      const cell = rowData.getCell(i + 1);
      cell.value = v;
      cell.fill  = solid(rowBg);
      cell.font  = { size: 10 };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E5E5' } } };
      const isAmt = i >= 5 && i <= 7;
      cell.alignment = { horizontal: isAmt ? 'right' : i === 0 ? 'center' : 'left', vertical: 'middle' };
      if (isAmt) cell.numFmt = numFmt;
    });
    // colour debit green, credit red, balance bold
    rowData.getCell(6).font  = { size: 10, color: { argb: 'FF1D7B4D' } };
    rowData.getCell(7).font  = { size: 10, color: { argb: 'FFC74634' } };
    rowData.getCell(8).font  = { size: 10, bold: true };
    rowData.height = 16;
    r++;
  }

  // ── Totals row ─────────────────────────────────────────────
  const totRow = ws.getRow(r);
  ws.mergeCells(`A${r}:E${r}`);
  totRow.getCell(1).value = `TOTAL  (${transactions.length} transactions)`;
  totRow.getCell(1).font  = { bold: true, size: 11 };
  totRow.getCell(1).fill  = solid('FFE8F0FE');
  totRow.getCell(1).alignment = { horizontal: 'right' };

  const sumDebit  = transactions.reduce((s, t) => s + (t.debitAmount  || 0), 0);
  const sumCredit = transactions.reduce((s, t) => s + (t.creditAmount || 0), 0);
  [[6, sumDebit, 'FF1D7B4D'], [7, sumCredit, 'FFC74634'], [8, register.balance, 'FF1A1A1A']].forEach(([col, val, argb]) => {
    const c = totRow.getCell(col as number);
    c.value  = val as number;
    c.numFmt = numFmt;
    c.font   = { bold: true, size: 11, color: { argb: argb as string } };
    c.fill   = solid('FFE8F0FE');
    c.alignment = { horizontal: 'right' };
    c.border = { top: { style: 'medium', color: { argb: 'FF2E6DA4' } } };
  });
  for (let col = 1; col <= 14; col++) {
    const c = totRow.getCell(col);
    if (!c.fill || (c.fill as any).fgColor?.argb === 'FF000000') c.fill = solid('FFE8F0FE');
  }
  totRow.height = 22;

  // ── Freeze panes & auto-filter ─────────────────────────────
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: startDataRow - 1, showGridLines: false }];
  ws.autoFilter = { from: { row: startDataRow - 1, column: 1 }, to: { row: r - 1, column: 14 } };

  // ── Summary sheet (by Reference No) ───────────────────────
  const ws2 = wb.addWorksheet('Summary by Reference', { views: [{ showGridLines: false }] });
  ws2.columns = [
    { width: 5  }, // A  #
    { width: 18 }, // B  Reference No
    { width: 14 }, // C  Date
    { width: 20 }, // D  Type
    { width: 22 }, // E  Expense Type(s)
    { width: 7  }, // F  Lines
    { width: 10 }, // G  Currency
    { width: 16 }, // H  Money In
    { width: 16 }, // I  Money Out
    { width: 16 }, // J  Net
    { width: 32 }, // K  Comments
  ];

  // Title
  ws2.mergeCells('A1:K1');
  const t2 = ws2.getCell('A1');
  t2.value = `Summary by Reference — ${register.registerName}`;
  t2.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  t2.fill  = solid('FF1A3C5E');
  t2.alignment = { vertical: 'middle', horizontal: 'center' };
  ws2.getRow(1).height = 28;

  // Sub-header: register stats
  const statsRows: [string, string | number][] = [
    ['Register',  register.registerName],
    ['Currency',  register.currency],
    ['Balance',   register.balance],
    ['Total In',  register.totalDebit],
    ['Total Out', register.totalCredit],
    ['Export',    new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })],
  ];
  let r2 = 2;
  for (const [lbl, val] of statsRows) {
    ws2.mergeCells(`A${r2}:B${r2}`);
    ws2.mergeCells(`C${r2}:E${r2}`);
    const lc = ws2.getCell(`A${r2}`);
    lc.value = lbl; lc.font = { bold: true, size: 10, color: { argb: 'FF1A3C5E' } };
    lc.fill  = solid('FFF0F4FA'); lc.alignment = { horizontal: 'right' };
    const vc = ws2.getCell(`C${r2}`);
    vc.value = val; vc.font = { size: 10 };
    vc.fill  = solid('FFFFFFFF'); vc.alignment = { horizontal: 'left' };
    if (typeof val === 'number') vc.numFmt = numFmt;
    ws2.getRow(r2).height = 16;
    r2++;
  }
  r2++;

  // Column header
  const S_COLS = ['#', 'Reference No', 'Date', 'Type', 'Expense Type(s)', 'Lines', 'Currency', 'Money In', 'Money Out', 'Net', 'Comments'];
  const sHdr = ws2.getRow(r2);
  S_COLS.forEach((h, i) => {
    const c = sHdr.getCell(i + 1);
    c.value = h;
    c.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.fill  = solid('FF1A3C5E');
    c.alignment = { horizontal: i >= 7 && i <= 9 ? 'right' : 'center', vertical: 'middle' };
    c.border = { bottom: { style: 'medium', color: { argb: 'FF2E6DA4' } } };
  });
  sHdr.height = 20;
  const sDataStart = r2;
  r2++;

  // Aggregate by reference number
  type SumRow = { ref: string; date: string; types: Set<string>; expTypes: Set<string>; lines: number; currency: string; debit: number; credit: number; comments: string[] };
  const refMap = new Map<string, SumRow>();
  for (const txn of transactions) {
    const key = txn.referenceNo || '—';
    if (!refMap.has(key)) {
      refMap.set(key, { ref: key, date: txn.transactionDate, types: new Set(), expTypes: new Set(), lines: 0, currency: txn.currency || register.currency, debit: 0, credit: 0, comments: [] });
    }
    const row = refMap.get(key)!;
    row.types.add(txn.transactionType);
    if (txn.expenseType) row.expTypes.add(txn.expenseType);
    row.lines++;
    row.debit  += txn.debitAmount  || 0;
    row.credit += txn.creditAmount || 0;
    if (txn.comments) row.comments.push(txn.comments);
  }

  // Sort: '—' last, rest alphabetically
  const sorted = [...refMap.values()].sort((a, b) => {
    if (a.ref === '—') return 1;
    if (b.ref === '—') return -1;
    return a.ref.localeCompare(b.ref);
  });

  let sIdx = 1;
  let sumTotalIn = 0, sumTotalOut = 0;
  for (const row of sorted) {
    const isRefill = [...row.types].some(t => t === 'Balance Refill' || t === 'Balance Brought Fwd');
    const bg = isRefill ? 'FFF0FFF4' : sIdx % 2 === 0 ? 'FFF7F9FC' : 'FFFFFFFF';
    const sRow = ws2.getRow(r2);
    const typesStr   = [...row.types].join(', ');
    const expTypesStr = [...row.expTypes].join(', ') || '—';
    const commentsStr = [...new Set(row.comments)].slice(0, 3).join(' · ');
    const net = row.debit - row.credit;

    const vals: (string | number)[] = [
      sIdx, row.ref, row.date, typesStr, expTypesStr,
      row.lines, row.currency, row.debit, row.credit, net, commentsStr,
    ];
    vals.forEach((v, i) => {
      const c = sRow.getCell(i + 1);
      c.value = v;
      c.fill  = solid(bg);
      c.font  = { size: 10 };
      c.border = { bottom: { style: 'hair', color: { argb: 'FFE5E5E5' } } };
      const isAmt = i >= 7 && i <= 9;
      c.alignment = { horizontal: isAmt ? 'right' : i === 0 || i === 5 ? 'center' : 'left', vertical: 'middle' };
      if (isAmt) c.numFmt = numFmt;
    });
    sRow.getCell(8).font  = { size: 10, color: { argb: 'FF1D7B4D' } };
    sRow.getCell(9).font  = { size: 10, color: { argb: 'FFC74634' } };
    sRow.getCell(10).font = { size: 10, bold: true, color: { argb: net >= 0 ? 'FF1D7B4D' : 'FFC74634' } };
    sRow.height = 16;
    sumTotalIn  += row.debit;
    sumTotalOut += row.credit;
    sIdx++; r2++;
  }

  // Summary totals row
  const sTot = ws2.getRow(r2);
  ws2.mergeCells(`A${r2}:G${r2}`);
  sTot.getCell(1).value = `TOTAL  (${sorted.length} references, ${transactions.length} lines)`;
  sTot.getCell(1).font  = { bold: true, size: 11 };
  sTot.getCell(1).fill  = solid('FFE8F0FE');
  sTot.getCell(1).alignment = { horizontal: 'right' };
  [[8, sumTotalIn, 'FF1D7B4D'], [9, sumTotalOut, 'FFC74634'], [10, sumTotalIn - sumTotalOut, 'FF1A1A1A']].forEach(([col, val, argb]) => {
    const c = sTot.getCell(col as number);
    c.value  = val as number;
    c.numFmt = numFmt;
    c.font   = { bold: true, size: 11, color: { argb: argb as string } };
    c.fill   = solid('FFE8F0FE');
    c.alignment = { horizontal: 'right' };
    c.border = { top: { style: 'medium', color: { argb: 'FF2E6DA4' } } };
  });
  for (let col = 1; col <= 11; col++) {
    const c = sTot.getCell(col);
    if (!c.fill || (c.fill as any).fgColor?.argb === 'FF000000') c.fill = solid('FFE8F0FE');
  }
  sTot.height = 22;

  ws2.views = [{ state: 'frozen', xSplit: 0, ySplit: sDataStart, showGridLines: false }];
  ws2.autoFilter = { from: { row: sDataStart, column: 1 }, to: { row: r2 - 1, column: 11 } };

  // ── Save ──────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const eAPI = (window as any).electronAPI;
  const safeName = register.registerName.replace(/[^a-z0-9]/gi, '_');
  const filename  = `PC_Register_${safeName}_${dayjs().format('YYYYMMDD')}.xlsx`;
  if (eAPI?.saveFile) {
    await eAPI.saveFile(buf, filename);
  } else {
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  }
  message.success(`Exported: ${filename}`);
}

// ── PDF helpers ───────────────────────────────────────────────────────────────
const PDF_BLUE  = [0,  83, 156] as [number, number, number];
const PDF_GREEN = [21, 128, 61] as [number, number, number];

function pdfHeader(doc: jsPDF, title: string, subtitle: string, color: [number,number,number]) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...color);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.text(title, W / 2, 12, { align: 'center' });
  doc.setFontSize(9);  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, W / 2, 21, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

function pdfFooter(doc: jsPDF, lastY: number) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFontSize(7); doc.setTextColor(150, 150, 150);
  doc.text(`Printed: ${new Date().toLocaleString()}  ·  ReactERP Petty Cash`, W / 2, lastY + 6, { align: 'center' });
}

function printBankTxnPDF(bankData: any, registerName: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  pdfHeader(doc, 'BANK TRANSACTION RECEIPT', registerName, PDF_BLUE);
  autoTable(doc, {
    startY: 34,
    body: [
      ['Transaction ID',   String(bankData.transactionId  ?? '—')],
      ['Status',           String(bankData.status         ?? '—')],
      ['Accounting',       bankData.accountingFlag === 'Y' ? 'Accounted' : 'Not Accounted'],
      ['Date',             String(bankData.transactionDate ?? '—')],
      ['Value Date',       String(bankData.valueDate       ?? '—')],
      ['Amount',           `${bankData.amount ?? '—'} ${bankData.currencyCode ?? ''}`],
      ['Bank Account',     String(bankData.bankAccountName  ?? '—')],
      ['Business Unit',    String(bankData.businessUnitName ?? '—')],
      ['Txn Type',         String(bankData.transactionType  ?? '—')],
      ['Reference',        String(bankData.referenceText    ?? '—')],
      ['Description',      String(bankData.description      ?? '—')],
      ['Asset Account',    String(bankData.assetAccountCombination  ?? '—')],
      ['Offset Account',   String(bankData.offsetAccountCombination ?? '—')],
      ['Created By',       String(bankData.createdBy    ?? '—')],
      ['Created On',       String(bankData.creationDate ?? '—')],
    ],
    theme: 'striped',
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, fillColor: [245, 245, 250] } },
    styles: { fontSize: 9.5 },
  });
  pdfFooter(doc, (doc as any).lastAutoTable.finalY);
  doc.save(`bank-txn-${bankData.transactionId ?? 'receipt'}.pdf`);
}

function printPCTxnPDF(txn: PCTransaction, register: PCRegister) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const isIn = txn.debitAmount > 0;
  pdfHeader(doc, 'PETTY CASH TRANSACTION', register.registerName, PDF_GREEN);
  const rows: [string, string][] = [
    ['Transaction ID',    String(txn.transactionId)],
    ['Line #',            String(txn.lineNumber)],
    ['Type',              txn.transactionType],
    ['Transaction Date',  txn.transactionDate    ?? '—'],
    ['Accounting Date',   txn.accountingDate     ?? '—'],
    [isIn ? 'Money In' : 'Money Out', `${(isIn ? txn.debitAmount : txn.creditAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${txn.currency}`],
  ];
  if (txn.expenseType)       rows.push(['Expense Type',    txn.expenseType]);
  if (txn.referenceNo)       rows.push(['Reference No',    txn.referenceNo]);
  if (txn.bankTxnId)         rows.push(['Bank Txn ID',     String(txn.bankTxnId)]);
  if (txn.chargeAccountDesc) rows.push(['Charge Account',  txn.chargeAccountDesc]);
  if (txn.employeeName)      rows.push(['Paid To',          txn.employeeName]);
  rows.push(['Posting Status', txn.postingStatus ?? 'Unposted']);
  if (txn.comments)          rows.push(['Comments',        txn.comments]);
  rows.push(['Created By',   txn.createdBy ?? '—']);
  autoTable(doc, {
    startY: 34,
    body: rows,
    theme: 'striped',
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, fillColor: [245, 250, 245] } },
    styles: { fontSize: 9.5 },
  });
  pdfFooter(doc, (doc as any).lastAutoTable.finalY);
  doc.save(`pc-txn-line${txn.lineNumber}.pdf`);
}

function printRefGroupPDF(ref: string, txns: PCTransaction[], register: PCRegister) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdfHeader(doc, 'PETTY CASH TRANSACTION GROUP', `${register.registerName}  ·  Reference: ${ref}`, PDF_BLUE);
  const totalIn  = txns.reduce((s, t) => s + (t.debitAmount  || 0), 0);
  const totalOut = txns.reduce((s, t) => s + (t.creditAmount || 0), 0);
  autoTable(doc, {
    startY: 34,
    head: [['Txn ID', '#', 'Date', 'Type', 'Expense Type', 'Money In', 'Money Out', 'Status', 'Comments']],
    body: txns.map(t => [
      String(t.transactionId),
      String(t.lineNumber),
      t.transactionDate  ?? '—',
      t.transactionType,
      t.expenseType      ?? '—',
      t.debitAmount  > 0 ? t.debitAmount.toLocaleString(undefined,  { minimumFractionDigits: 2 }) : '—',
      t.creditAmount > 0 ? t.creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—',
      t.postingStatus    ?? '—',
      t.comments         ?? '—',
    ]),
    foot: [['', '', '', '', `Total (${txns.length} lines)`,
      totalIn  > 0 ? totalIn.toLocaleString(undefined,  { minimumFractionDigits: 2 }) : '—',
      totalOut > 0 ? totalOut.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—',
      '', '']],
    theme: 'grid',
    headStyles: { fillColor: PDF_BLUE, fontSize: 9, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 235, 235], fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 10 }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });
  pdfFooter(doc, (doc as any).lastAutoTable.finalY);
  doc.save(`pc-ref-${ref}.pdf`);
}

interface FileEntry {
  uid: string;
  name: string;
  data: string;   // base64 without data: header
  mimeType: string;
}

function readFileAsEntry(file: File): Promise<FileEntry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma   = dataUrl.indexOf(',');
      const base64  = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const mime    = dataUrl.slice(0, comma >= 0 ? comma : 0).match(/data:([^;]+)/)?.[1] || file.type;
      resolve({ uid: (file as any).uid ?? String(Date.now()), name: file.name, data: base64, mimeType: mime });
    };
    reader.onerror = reject;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Register Detail Panel
// ─────────────────────────────────────────────────────────────────────────────
const RegisterDetail: React.FC<{
  tab: RegisterTab;
  onRefresh: () => void;
  currentUser: string;
  cashAccountName?: string;
  businessUnits?: string[];
}> = ({ tab, onRefresh, currentUser, cashAccountName, businessUnits = [] }) => {
  const { register, transactions, txnLoading } = tab;
  const { addSessionEntry } = useGlValidation();
  const [addMoneyOpen, setAddMoneyOpen]     = useState(false);
  const [addExpenseOpen, setAddExpenseOpen]   = useState(false);
  const [addSuspenseOpen, setAddSuspenseOpen]           = useState(false);
  const [convertSuspenseOpen, setConvertSuspenseOpen]   = useState(false);
  const [convertSuspenseRec,  setConvertSuspenseRec]    = useState<PCTransaction | null>(null);
  const [convertApiPayload,   setConvertApiPayload]     = useState<any>(null);
  const [convertApiResponse,  setConvertApiResponse]    = useState<any>(null);
  const [convertApiError,     setConvertApiError]       = useState<string>('');
  const [suspenseRefundOpen,     setSuspenseRefundOpen]    = useState(false);
  const [suspenseRefundRec,      setSuspenseRefundRec]     = useState<PCTransaction | null>(null);
  const [suspenseRefundForm]                               = Form.useForm();

  const [suspenseListOpen,       setSuspenseListOpen]      = useState(false);
  const [editTxnOpen, setEditTxnOpen]                   = useState(false);
  const [editTxn, setEditTxn]                           = useState<PCTransaction | null>(null);
  const [saving, setSaving]                             = useState(false);
  const [moneyForm]          = Form.useForm();
  const [expenseForm]        = Form.useForm();
  const [suspenseForm]       = Form.useForm();
  const [convertSuspenseForm] = Form.useForm();
  const [editTxnForm]        = Form.useForm();
  const needsRefresh = React.useRef(false);
  const [distCombinations, setDistCombinations] = useState<DistCombination[]>([]);
  const [openPeriods, setOpenPeriods]           = useState<APPeriod[]>([]);
  const [periodsLoaded, setPeriodsLoaded]       = useState(false);
  const [txnActionLoading, setTxnActionLoading] = useState<number | null>(null);
  const [coaOpen, setCoaOpen]         = useState(false);
  const [coaTarget, setCoaTarget]     = useState<'add' | 'edit' | 'money' | 'bankAsset' | 'bankOffset' | 'refundCash' | 'multiLine' | 'newDist' | 'convertLine' | 'suspenseRefund'>('edit');
  const [coaInitialValue, setCoaInitialValue] = useState<string>('');
  const [coaMultiLineKey, setCoaMultiLineKey] = useState<string | null>(null);
  const [coaConvertLineKey, setCoaConvertLineKey] = useState<string | null>(null);
  const [convertLines, setConvertLines] = useState<ExpenseLine[]>([makeNewLine()]);

  // New Expense Type (distribution combination) modal
  const [newDistOpen, setNewDistOpen]       = useState(false);
  const [newDistSaving, setNewDistSaving]   = useState(false);
  const [newDistForm]                       = Form.useForm();
  const [newDistAcctDesc, setNewDistAcctDesc] = useState<string>('');
  const [addAcctDesc, setAddAcctDesc]         = useState<string>('');
  const [editAcctDesc, setEditAcctDesc]       = useState<string>('');
  const [moneyAcctDesc, setMoneyAcctDesc]     = useState<string>('');
  const [bankOffsetDesc, setBankOffsetDesc]   = useState<string>('');
  const [bankAssetDesc, setBankAssetDesc]     = useState<string>('');
  const [fundingSource, setFundingSource]     = useState<'bank' | 'refund' | 'opening'>('bank');
  const [refundCashDesc, setRefundCashDesc]   = useState<string>('');
  const [linkedBankTxnRef, setLinkedBankTxnRef] = useState<string>('');
  const [bankTxnModalOpen, setBankTxnModalOpen] = useState(false);
  const [bankTxnForm]     = Form.useForm();
  const [bankTxnSaving, setBankTxnSaving] = useState(false);
  const [bankAccounts, setBankAccounts]   = useState<{ name: string; cashAccount: string; currency: string }[]>([]);
  const [buLegalEntityMap, setBuLegalEntityMap] = useState<Map<string, string>>(new Map());
  const [bankTxnDetailOpen, setBankTxnDetailOpen]     = useState(false);
  const [bankTxnDetail, setBankTxnDetail]             = useState<any>(null);
  const [bankTxnDetailLoading, setBankTxnDetailLoading] = useState(false);
  const [bankTxnDetailSourceId, setBankTxnDetailSourceId] = useState<number | null>(null);
  const [bankTxnDetailUrl, setBankTxnDetailUrl]       = useState<string>('');
  const [bankTxnPostResponse, setBankTxnPostResponse]   = useState<any>(null);
  const [bankTxnLookupResult, setBankTxnLookupResult]   = useState<any>(null);
  const [bankTxnPayload, setBankTxnPayload]             = useState<any>(null);
  const [bankTxnRawError, setBankTxnRawError]           = useState<string>('');
  const [chargeAcctResolved, setChargeAcctResolved] =
    useState<Map<number, { code: string; desc: string }>>(new Map());
  // Multi-file upload state (new RR_PC_ATTACHMENTS system)
  const [addExpenseFiles, setAddExpenseFiles] = useState<FileEntry[]>([]);
  const [editExpenseFiles, setEditExpenseFiles] = useState<FileEntry[]>([]);
  const [editTxnAttachments, setEditTxnAttachments] = useState<PCAttachment[]>([]);
  const [editTxnAttachmentsLoading, setEditTxnAttachmentsLoading] = useState(false);
  // Old single-attachment viewer (backward compat for hasAttachment=Y rows)
  const [viewAttachOpen, setViewAttachOpen]   = useState(false);
  const [viewAttachData, setViewAttachData]   = useState<string>('');
  const [viewAttachName, setViewAttachName]   = useState<string>('');
  // Attachment list modal (new system)
  const [attachListOpen, setAttachListOpen]         = useState(false);
  const [attachListTxn, setAttachListTxn]           = useState<PCTransaction | null>(null);
  const [attachListData, setAttachListData]          = useState<PCAttachment[]>([]);
  const [attachListLoading, setAttachListLoading]   = useState(false);
  const [attachListDeleting, setAttachListDeleting] = useState<number | null>(null);
  const [attachListUrl, setAttachListUrl]           = useState<string>('');
  const [attachListError, setAttachListError]       = useState<string>('');
  // File preview modal
  const [filePreviewOpen, setFilePreviewOpen]       = useState(false);
  const [filePreviewItem, setFilePreviewItem]       = useState<{ name: string; data: string; mimeType: string | null } | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewUrl, setFilePreviewUrl]         = useState<string>('');
  const [filePreviewError, setFilePreviewError]     = useState<string>('');
  const [filePreviewMaximized, setFilePreviewMaximized] = useState(false);
  const [attachListMaximized, setAttachListMaximized]   = useState(false);
  // ── Accounting state ──────────────────────────────────────────────────────
  const [selectedRowKeys, setSelectedRowKeys]   = useState<number[]>([]);
  const [txnSearch, setTxnSearch]               = useState('');
  const [linesFullscreen, setLinesFullscreen]   = useState(false);
  const [suspAmtPopover, setSuspAmtPopover]     = useState<number | null>(null);
  const [suspAmtValue, setSuspAmtValue]         = useState<number>(0);
  const [suspAmtSaving, setSuspAmtSaving]       = useState(false);
  const [bankTxnStatusMap, setBankTxnStatusMap] = useState<Map<number, { status: string; accountingFlag: string }>>(new Map());
  const [acctModalOpen, setAcctModalOpen]       = useState(false);
  const [acctProgress, setAcctProgress]         = useState<AcctProgressRow[]>([]);
  const [acctRunning, setAcctRunning]           = useState(false);
  const [acctDone, setAcctDone]                 = useState(false);
  const [viewAcctOpen, setViewAcctOpen]         = useState(false);
  const [viewAcctTxn, setViewAcctTxn]           = useState<PCTransaction | null>(null);
  const [viewAcctData, setViewAcctData]         = useState<SlaGetResult | null>(null);
  const [viewAcctLoading, setViewAcctLoading]   = useState(false);
  const [viewAcctQueue, setViewAcctQueue]       = useState<PCTransaction[]>([]);
  const [viewAcctQueueIdx, setViewAcctQueueIdx] = useState(0);
  const [ledgerInfo, setLedgerInfo]             = useState<{ ledgerId: number; ledgerName: string } | null>(null);
  const [legalEntityName, setLegalEntityName]   = useState<string>('');
  const [apiDebugOpen, setApiDebugOpen]         = useState(false);
  const [apiDebugItems, setApiDebugItems]       = useState<ApiDebugItem[]>([]);
  const [apiDebugLoading, setApiDebugLoading]   = useState(false);
  const [viewAcctLineDescs, setViewAcctLineDescs] = useState<Map<string, string>>(new Map());
  const [expenseMode, setExpenseMode]   = useState<'single' | 'multi'>('single');
  const [expenseLines, setExpenseLines] = useState<ExpenseLine[]>([makeNewLine()]);
  const [addExpenseFromRefGroup, setAddExpenseFromRefGroup] = useState(false);
  const [refGroupOpen, setRefGroupOpen]   = useState(false);
  const [refGroupRef, setRefGroupRef]     = useState<string>('');
  const [refGroupSaving, setRefGroupSaving] = useState(false);
  const [refGroupForm] = Form.useForm();
  const [reverseOpen, setReverseOpen]         = useState(false);
  const [reverseTxn, setReverseTxn]           = useState<PCTransaction | null>(null);
  const [reverseVoidBank, setReverseVoidBank]  = useState(true);
  const [reverseSaving, setReverseSaving]      = useState(false);
  const [reverseComments, setReverseComments]  = useState('');
  const [reverseBankData, setReverseBankData]           = useState<any | null>(null);
  const [reverseBankLoading, setReverseBankLoading]     = useState(false);
  const [reverseScenario, setReverseScenario]           = useState<'no_bank' | 'bank_void' | 'bank_unr' | 'bank_accounted'>('no_bank');
  const [addExpenseVoucherNo,  setAddExpenseVoucherNo]  = useState('');
  const [addMoneyVoucherNo,    setAddMoneyVoucherNo]    = useState('');
  const [addSuspenseVoucherNo, setAddSuspenseVoucherNo] = useState('');
  const [voucherNoLoading,     setVoucherNoLoading]     = useState(false);

  const updateLine = (key: string, patch: Partial<ExpenseLine>) =>
    setExpenseLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const updateConvertLine = (key: string, patch: Partial<ExpenseLine>) =>
    setConvertLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));

  const handleSaveRefGroup = async (values: any) => {
    const newRef = (values.referenceNo ?? '').trim() || null;
    const lines  = transactions.filter(t => t.referenceNo === refGroupRef);
    if (!lines.length) return;
    setRefGroupSaving(true);
    try {
      await Promise.all(lines.map(t =>
        updateTransaction(t.transactionId, { referenceNo: newRef, updatedBy: currentUser })
      ));
      message.success('Reference updated');
      setRefGroupOpen(false);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Update failed');
    } finally {
      setRefGroupSaving(false);
    }
  };

  // ── Upload helper: post files to new attachment table ────────
  const uploadFiles = async (
    transactionId: number,
    registerId: number,
    referenceNo: string | null,
    files: FileEntry[],
  ) => {
    for (const f of files) {
      await addAttachment({
        registerId,
        transactionId,
        referenceNo:  referenceNo ?? undefined,
        fileName:     f.name,
        fileData:     f.data,
        mimeType:     f.mimeType,
        createdBy:    currentUser,
      });
    }
  };

  // ── Open attachment list modal ────────────────────────────
  const openAttachList = async (txn: PCTransaction) => {
    const url = `${APEX_DB_CONFIG.baseUrl}/pc/attachments?transactionId=${txn.transactionId}`;
    setAttachListTxn(txn);
    setAttachListData([]);
    setAttachListError('');
    setAttachListUrl(url);
    setAttachListLoading(true);
    setAttachListOpen(true);
    try {
      const list = await getAttachments(txn.registerId, txn.transactionId);
      setAttachListData(list);
    } catch (e: any) {
      setAttachListError(e?.message ?? 'Failed to load attachments');
    } finally {
      setAttachListLoading(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    setAttachListDeleting(attachmentId);
    try {
      await deleteAttachment(attachmentId);
      setAttachListData(prev => prev.filter(a => a.attachmentId !== attachmentId));
      message.success('Attachment deleted');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Delete failed');
    } finally {
      setAttachListDeleting(null);
    }
  };

  const openFilePreview = async (att: PCAttachment) => {
    const url = `${APEX_DB_CONFIG.baseUrl}/pc/attachments/${att.attachmentId}`;
    setFilePreviewItem(null);
    setFilePreviewError('');
    setFilePreviewUrl(url);
    setFilePreviewLoading(true);
    setFilePreviewOpen(true);
    try {
      const raw = await getAttachmentData(att.attachmentId);
      // derive mime type from extension when the server returns null
      const ext = raw.fileName.split('.').pop()?.toLowerCase() ?? '';
      const extMime: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
      };
      const mimeType = raw.mimeType || extMime[ext] || 'application/octet-stream';
      setFilePreviewItem({ name: raw.fileName, data: raw.fileData, mimeType });
    } catch (e: any) {
      setFilePreviewError(e?.message ?? 'Failed to load file');
    } finally {
      setFilePreviewLoading(false);
    }
  };

  const isClosed   = register.status !== 'ACTIVE';
  const noBalance     = register.balance <= 0;
  const totalSuspense = transactions.reduce((s, t) => s + (t.suspenseAmount || 0), 0);
  const balanceWithSuspense = register.balance - totalSuspense;

  // ── Resolve charge account combination + description for table ─
  useEffect(() => {
    const isCombCode = (v: string) => (v.match(/-/g) || []).length >= 5;
    transactions.forEach(t => {
      if (!t.chargeAccountDesc || chargeAcctResolved.has(t.transactionId)) return;
      if (isCombCode(t.chargeAccountDesc)) {
        // Combination code stored → resolve segment-4 description async
        validateAccountCode(t.chargeAccountDesc).then(result => {
          const seg4 = Object.values(result.segmentDetails)[3];
          setChargeAcctResolved(prev => new Map(prev).set(t.transactionId, {
            code: t.chargeAccountDesc!,
            desc: seg4?.description || '',
          }));
        });
      } else {
        // Description stored → reverse-lookup combination code from loaded combos
        const match = distCombinations.find(d => d.glAccountDesc === t.chargeAccountDesc);
        setChargeAcctResolved(prev => new Map(prev).set(t.transactionId, {
          code: match?.combinationName || '',
          desc: t.chargeAccountDesc!,
        }));
      }
    });
  }, [transactions, distCombinations]);

  // ── Load bank accounts filtered by BU via legal entity ───────
  const BANK_ACCOUNTS_URL = `${APEX_DB_CONFIG.baseUrl}/banks/bankaccounts`;
  const EXT_TXN_URL       = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions`;
  const BU_LIST_URL       = `${APEX_DB_CONFIG.baseUrl}/gl/businessunits`;

  const loadBankAccountsByBU = (bu: string, leMap?: Map<string, string>) => {
    setBankAccounts([]);
    const map = leMap ?? buLegalEntityMap;
    const legalEntity = map.get(bu) || '';
    fetch(BANK_ACCOUNTS_URL, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const all = (data.items || []) as any[];
        const filtered = legalEntity
          ? all.filter(i => (i.legal_entity_name || '').toLowerCase() === legalEntity.toLowerCase())
          : all;
        const seen = new Set<string>();
        const accounts = filtered
          .map((i: any) => ({
            name:        i.bank_account_name || i.bankAccountName || '',
            cashAccount: i.cash_account_combination || '',
            currency:    i.currency_code || '',
          }))
          .filter(a => a.name && !seen.has(a.name) && seen.add(a.name));
        setBankAccounts(accounts);
      })
      .catch(() => {});
  };

  // ── Pre-fill bank txn modal on open ───────────────────────────
  useEffect(() => {
    if (!bankTxnModalOpen) return;
    const mv = moneyForm.getFieldsValue();
    const bu = register.businessUnit;
    const offsetAcct = mv.chargeAccountDesc || '';
    setBankOffsetDesc('');
    setBankAssetDesc('');
    bankTxnForm.setFieldsValue({
      businessUnitName:         bu,
      amount:                   mv.amount,
      transactionDate:          mv.transactionDate || dayjs(),
      currencyCode:             mv.currency || register.currency,
      offsetAccountCombination: offsetAcct,
      description:              `Petty Cash Refill — ${register.registerName}`,
    });
    // Fetch description for the pre-filled offset account
    if (offsetAcct) {
      validateAccountCode(offsetAcct).then(result => {
        const seg4 = Object.values(result.segmentDetails)[3];
        setBankOffsetDesc(seg4?.description || '');
      }).catch(() => {});
    }
    // Fetch BU list to resolve legal entity, then load bank accounts
    if (buLegalEntityMap.size > 0) {
      loadBankAccountsByBU(bu);
    } else {
      fetch(BU_LIST_URL, { headers: { Accept: 'application/json' } })
        .then(r => r.json())
        .then(data => {
          const leMap = new Map<string, string>(
            (data.items || []).map((i: any) => [
              i.business_unit_name || '',
              i.legal_entity_name  || '',
            ])
          );
          setBuLegalEntityMap(leMap);
          loadBankAccountsByBU(bu, leMap);
        })
        .catch(() => loadBankAccountsByBU(bu));
    }
  }, [bankTxnModalOpen]);

  // ── Batch-fetch bank txn status whenever transactions change ──
  // If a bank txn comes back as accountingFlag='Y' but the linked PC
  // transaction is still Unposted, auto-promote it to Posted.
  useEffect(() => {
    const ids = [...new Set(
      transactions
        .filter(t => t.bankTxnId != null)
        .map(t => t.bankTxnId!)
    )];
    if (!ids.length) { setBankTxnStatusMap(new Map()); return; }
    const url = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/batchstatus/${ids.join(',')}`;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(async (data: { items?: { externalTransactionId: number; status: string; accountingFlag: string }[] }) => {
        const map = new Map<number, { status: string; accountingFlag: string }>();
        (data.items || []).forEach(item =>
          map.set(item.externalTransactionId, { status: item.status, accountingFlag: item.accountingFlag })
        );
        setBankTxnStatusMap(map);

        // Sync: bank is accounted (Y) but PC row is still Unposted → promote to Posted
        const toSync = transactions.filter(t =>
          t.bankTxnId != null &&
          t.postingStatus !== 'Posted' &&
          map.get(t.bankTxnId!)?.accountingFlag === 'Y'
        );
        if (toSync.length > 0) {
          await Promise.all(
            toSync.map(t => updateTransactionStatus(t.transactionId, 'Posted').catch(() => {}))
          );
          onRefresh();
        }
      })
      .catch(() => {});
  }, [transactions]);

  // ── Load distribution combinations + open AP periods on mount ─
  useEffect(() => {
    searchCombinations({ status: 'ACTIVE' })
      .then(data => setDistCombinations(data.filter(d => d.module === 'PC' || d.module === 'ALL')))
      .catch(() => {});
    getOpenAPPeriods()
      .then(p => { setOpenPeriods(p); setPeriodsLoaded(true); })
      .catch(() => { setPeriodsLoaded(true); });
  }, []);

  // Auto-generate voucher number when Add Expense or Add Money modal opens
  useEffect(() => {
    if (!addExpenseOpen) return;
    if (addExpenseFromRefGroup) return; // voucher already set to refGroupRef
    setVoucherNoLoading(true);
    getNextVoucherNo(register.registerId)
      .then(v => setAddExpenseVoucherNo(v))
      .catch(() => {
        // Fallback: compute from transactions already in state
        const pat = new RegExp(`^R${register.registerId}-(\\d+)$`);
        const maxSeq = transactions.reduce((mx, t) => {
          if (!t.referenceNo) return mx;
          const m = t.referenceNo.match(pat);
          return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
        }, 0);
        setAddExpenseVoucherNo(`R${register.registerId}-${String(maxSeq + 1).padStart(2, '0')}`);
      })
      .finally(() => setVoucherNoLoading(false));
  }, [addExpenseOpen]);

  useEffect(() => {
    if (!addMoneyOpen) return;
    setVoucherNoLoading(true);
    getNextVoucherNo(register.registerId)
      .then(v => setAddMoneyVoucherNo(v))
      .catch(() => {
        const pat = new RegExp(`^R${register.registerId}-(\\d+)$`);
        const maxSeq = transactions.reduce((mx, t) => {
          if (!t.referenceNo) return mx;
          const m = t.referenceNo.match(pat);
          return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
        }, 0);
        setAddMoneyVoucherNo(`R${register.registerId}-${String(maxSeq + 1).padStart(2, '0')}`);
      })
      .finally(() => setVoucherNoLoading(false));
  }, [addMoneyOpen]);

  useEffect(() => {
    if (!addSuspenseOpen) return;
    setVoucherNoLoading(true);
    getNextVoucherNo(register.registerId)
      .then(v => setAddSuspenseVoucherNo(v))
      .catch(() => {
        const pat = new RegExp(`^R${register.registerId}-(\\d+)$`);
        const maxSeq = transactions.reduce((mx, t) => {
          if (!t.referenceNo) return mx;
          const m = t.referenceNo.match(pat);
          return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
        }, 0);
        setAddSuspenseVoucherNo(`R${register.registerId}-${String(maxSeq + 1).padStart(2, '0')}`);
      })
      .finally(() => setVoucherNoLoading(false));
  }, [addSuspenseOpen]);

  // ── Derive AP period for a given date ────────────────────
  const findAPPeriod = (date: dayjs.Dayjs | null): APPeriod | null => {
    if (!date) return null;
    return openPeriods.find(p =>
      !date.isBefore(dayjs(p.startDate)) && !date.isAfter(dayjs(p.endDate))
    ) ?? null;
  };

  // ── Populate edit form once modal is open and editTxn is set ─
  useEffect(() => {
    if (!editTxnOpen || !editTxn) return;
    const parseOracleDate = (s: string | null | undefined) => {
      if (!s) return null;
      // Oracle TO_CHAR 'DD-MON-YYYY' returns uppercase month e.g. '19-APR-2026'
      // Normalize to title-case so dayjs 'DD-MMM-YYYY' token matches
      const norm = s.replace(/-([A-Z]{3})-/g, (_, m) => `-${m[0]}${m.slice(1).toLowerCase()}-`);
      const d = dayjs(norm, ['YYYY-MM-DD', 'DD-MMM-YYYY']);
      return d.isValid() ? d : null;
    };
    const isExpense = editTxn.transactionType === 'Expense';
    const isCombCode = (v: string) => (v.match(/-/g) || []).length >= 5;
    const raw = editTxn.chargeAccountDesc;

    let combCode = raw;
    let desc = '';

    if (raw && !isCombCode(raw)) {
      // Stored as description — reverse-lookup the combination code
      const match = distCombinations.find(d => d.glAccountDesc === raw);
      if (match) {
        combCode = match.combinationName;
        desc = raw;
      }
    } else if (raw && isCombCode(raw)) {
      // Stored as combination code — resolve description async
      validateAccountCode(raw).then(result => {
        const seg4 = Object.values(result.segmentDetails)[3];
        setEditAcctDesc(seg4?.description || '');
      });
    }

    editTxnForm.setFieldsValue({
      transactionDate:   parseOracleDate(editTxn.transactionDate),
      accountingDate:    parseOracleDate(editTxn.accountingDate),
      currency:          editTxn.currency,
      amount:            isExpense ? editTxn.creditAmount : editTxn.debitAmount,
      expenseType:       editTxn.expenseType,
      chargeAccountDesc: combCode,
      chargeAccountCcid: editTxn.chargeAccountCcid,
      referenceNo:       editTxn.referenceNo,
      comments:          editTxn.comments,
      employeeName:      editTxn.employeeName,
      receiptStatus:     editTxn.receiptStatus,
    });
    setEditAcctDesc(desc);
    setEditExpenseFiles([]);
    setEditTxnAttachments([]);
    if (editTxn.transactionId) {
      setEditTxnAttachmentsLoading(true);
      getAttachments(editTxn.registerId, editTxn.transactionId)
        .then(list => setEditTxnAttachments(list))
        .catch(() => {})
        .finally(() => setEditTxnAttachmentsLoading(false));
    }
  }, [editTxnOpen, editTxn, distCombinations]);

  // ── Delete transaction (Unposted / Error only) ────────────
  const handleDeleteTransaction = (txn: PCTransaction) => {
    Modal.confirm({
      title: `Delete Line #${txn.lineNumber}?`,
      content: `This will permanently remove this ${txn.transactionType} transaction of ${fmt(txn.debitAmount || txn.creditAmount)} ${txn.currency}. This cannot be undone.`,
      okText: 'Delete', okButtonProps: { danger: true },
      onOk: async () => {
        setTxnActionLoading(txn.transactionId);
        try {
          await deleteTransaction(txn.transactionId);
          message.success(`Line #${txn.lineNumber} deleted`);
          onRefresh();
        } catch (e: any) {
          message.error(e?.message ?? 'Delete failed');
        } finally {
          setTxnActionLoading(null);
        }
      },
    });
  };

  // ── Update suspense refund amount inline ──────────────────────
  const handleUpdateSuspenseRefundAmt = async (txn: PCTransaction) => {
    setSuspAmtSaving(true);
    try {
      await updateTransaction(txn.transactionId, {
        transactionDate:   txn.transactionDate,
        accountingDate:    txn.accountingDate || txn.transactionDate,
        currency:          txn.currency,
        debitAmount:       txn.debitAmount,
        creditAmount:      txn.creditAmount,
        expenseType:       txn.expenseType       || null,
        chargeAccountDesc: txn.chargeAccountDesc || null,
        chargeAccountCcid: txn.chargeAccountCcid || null,
        referenceNo:       txn.referenceNo       || null,
        employeeName:      txn.employeeName      || null,
        receiptStatus:     txn.receiptStatus     || null,
        comments:          txn.comments          || null,
        suspenseAmount:    suspAmtValue,
        updatedBy:         currentUser,
      });
      message.success('Refund amount updated');
      setSuspAmtPopover(null);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Update failed');
    } finally {
      setSuspAmtSaving(false);
    }
  };

  // ── Open reverse modal (fetches bank txn status to pick scenario) ────
  const openReverseModal = async (txn: PCTransaction) => {
    setReverseTxn(txn);
    setReverseVoidBank(true);
    setReverseComments('');
    setReverseBankData(null);
    setReverseScenario('no_bank');
    setReverseOpen(true);
    if (!txn.bankTxnId) return;
    setReverseBankLoading(true);
    try {
      const res      = await fetch(`${EXT_TXN_URL}?external_transaction_id=${txn.bankTxnId}&row_limit=1`, { headers: { Accept: 'application/json' } });
      const data     = await res.json();
      const bankItem = (data.items || [])[0] ?? null;
      setReverseBankData(bankItem);
      if (!bankItem) {
        setReverseScenario('no_bank');
      } else if (bankItem.status === 'VOID') {
        setReverseScenario('bank_void');
      } else if (bankItem.accountingFlag === 'Y' || bankItem.status === 'REC') {
        setReverseScenario('bank_accounted');
      } else {
        setReverseScenario('bank_unr');
      }
    } catch {
      setReverseScenario('no_bank');
    } finally {
      setReverseBankLoading(false);
    }
  };

  // ── Confirm reversal — 3-branch decision tree ─────────────
  const handleConfirmReverse = async () => {
    if (!reverseTxn) return;
    setReverseSaving(true);
    try {

      // ── Scenario A: bank transaction is VOID (never accounted) ──────────
      // Delete the PC entry; no GL entries needed.
      if (reverseScenario === 'bank_void') {
        await deleteTransaction(reverseTxn.transactionId);
        message.success('Bank transaction was already void — Add Money entry removed');
        setReverseOpen(false);
        onRefresh();
        return;
      }

      // ── Scenario C: bank transaction is reconciled or accounted ─────────
      // Create a negative contra bank transaction, then link an Adjustment to it.
      if (reverseScenario === 'bank_accounted') {
        const bd     = reverseBankData;
        const negRef = `REV-${bd?.referenceText ?? reverseTxn.bankTxnId ?? Date.now()}`;
        const negPayload = {
          items: [{
            BankAccountName:          bd?.bankAccountName          ?? '',
            BusinessUnitName:         bd?.businessUnitName         ?? register.businessUnit,
            Amount:                   -(bd?.amount ?? reverseTxn.debitAmount),
            TransactionDate:          dayjs().format('YYYY-MM-DD'),
            CurrencyCode:             bd?.currencyCode             ?? reverseTxn.currency,
            ReferenceText:            negRef,
            TransactionType:          bd?.transactionType          ?? 'MISC',
            Description:              reverseComments.trim() || `Reversal of bank txn #${reverseTxn.bankTxnId}`,
            Source:                   'ORA_MAN',
            Status:                   'UNR',
            AccountingFlag:           false,
            CreatedBy:                currentUser,
            CreationDate:             new Date().toISOString(),
            LastUpdatedBy:            currentUser,
            LastUpdateDate:           new Date().toISOString(),
            LastUpdateLogin:          '',
            AssetAccountCombination:  bd?.assetAccountCombination  ?? '',
            OffsetAccountCombination: bd?.offsetAccountCombination ?? '',
          }],
        };
        const negRes  = await fetch(EXT_TXN_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify(negPayload),
        });
        const negData = await negRes.json().catch(() => ({})) as any;
        if (!negRes.ok || negData.status !== 'success') {
          throw new Error(negData.message ?? `Bank transaction POST failed (HTTP ${negRes.status})`);
        }
        const newBankTxnId: number | null = negData.externalTransactionId ?? null;
        let revVoucherNoC: string | undefined;
        try { revVoucherNoC = await getNextVoucherNo(reverseTxn.registerId); } catch { revVoucherNoC = undefined; }

        await createTransaction({
          registerId:        reverseTxn.registerId,
          transactionDate:   dayjs().format('YYYY-MM-DD'),
          accountingDate:    dayjs().format('YYYY-MM-DD'),
          transactionType:   'Balance Return',
          expenseType:       reverseTxn.expenseType || undefined,
          currency:          reverseTxn.currency,
          debitAmount:       reverseTxn.creditAmount,
          creditAmount:      reverseTxn.debitAmount,
          chargeAccountCcid: reverseTxn.chargeAccountCcid || undefined,
          chargeAccountDesc: reverseTxn.chargeAccountDesc || undefined,
          postingStatus:     'Unposted',
          referenceNo:       revVoucherNoC,
          bankTxnId:         newBankTxnId ?? undefined,
          comments:          reverseComments.trim()
            ? reverseComments.trim()
            : `Reversal of Line #${reverseTxn.lineNumber} (contra bank txn #${newBankTxnId ?? 'N/A'})`,
          createdBy:         currentUser,
        });

        message.success(
          `Reversal Adjustment created with offsetting bank transaction${newBankTxnId ? ` #${newBankTxnId}` : ''}`
        );
        setReverseOpen(false);
        onRefresh();
        return;
      }

      // ── Scenario B (default): bank is UNR + unaccounted, or no bank txn ─
      // Create Adjustment, then optionally void the bank transaction.
      let revVoucherNoB: string | undefined;
      try { revVoucherNoB = await getNextVoucherNo(reverseTxn.registerId); } catch { revVoucherNoB = undefined; }
      await createTransaction({
        registerId:        reverseTxn.registerId,
        transactionDate:   dayjs().format('YYYY-MM-DD'),
        accountingDate:    dayjs().format('YYYY-MM-DD'),
        transactionType:   'Balance Return',
        expenseType:       reverseTxn.expenseType || undefined,
        currency:          reverseTxn.currency,
        debitAmount:       reverseTxn.creditAmount,
        creditAmount:      reverseTxn.debitAmount,
        chargeAccountCcid: reverseTxn.chargeAccountCcid || undefined,
        chargeAccountDesc: reverseTxn.chargeAccountDesc || undefined,
        postingStatus:     'Unposted',
        referenceNo:       revVoucherNoB,
        bankTxnId:         reverseTxn.bankTxnId   || undefined,
        comments:          reverseComments.trim()
          ? reverseComments.trim()
          : `Reversal of Line #${reverseTxn.lineNumber}`,
        createdBy:         currentUser,
      });

      if (reverseTxn.bankTxnId) {
        const voidUrl = `${EXT_TXN_URL}/${reverseTxn.bankTxnId}/void?updated_by=${encodeURIComponent(currentUser)}`;
        const res  = await fetch(voidUrl, { method: 'PUT', headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({})) as { success?: boolean; code?: string; message?: string };
        if (!res.ok || !data.success) {
          const hint =
            data.code === 'IS_RECONCILED'
              ? 'The bank transaction is reconciled — unreconcile it in Oracle Fusion Cash Management first, then void manually.'
              : data.code === 'IS_ACCOUNTED'
              ? 'The bank transaction has been posted to GL — reverse the accounting entries in Oracle Fusion first, then void manually.'
              : data.code === 'ALREADY_VOID'
              ? 'The bank transaction was already voided.'
              : data.message || `HTTP ${res.status}`;
          message.warning({
            content: (
              <span>
                Petty cash reversal saved, but bank transaction <b>#{reverseTxn.bankTxnId}</b> could not be voided.
                <br /><span style={{ fontSize: 11, color: '#666' }}>{hint}</span>
              </span>
            ),
            duration: 8,
          });
        } else {
          message.success(`Reversal created and bank transaction ${reverseTxn.bankTxnId} voided`);
        }
      } else {
        message.success(`Reversal created for Line #${reverseTxn.lineNumber}`);
      }

      setReverseOpen(false);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Reversal failed');
    } finally {
      setReverseSaving(false);
    }
  };

  // ── Reverse transaction (non-BalanceRefill posted rows) ───
  const handleReverseTransaction = (txn: PCTransaction) => {
    Modal.confirm({
      title: `Reverse Line #${txn.lineNumber}?`,
      content: `This creates an offsetting Adjustment transaction to cancel this posted ${txn.transactionType}. The original line is kept for the audit trail.`,
      okText: 'Create Reversal',
      okButtonProps: { style: { background: REDWOOD.warning, borderColor: REDWOOD.warning } },
      onOk: async () => {
        setTxnActionLoading(txn.transactionId);
        try {
          let quickRevVoucherNo: string | undefined;
          try { quickRevVoucherNo = await getNextVoucherNo(txn.registerId); } catch { quickRevVoucherNo = undefined; }
          await createTransaction({
            registerId:      txn.registerId,
            transactionDate: dayjs().format('YYYY-MM-DD'),
            accountingDate:  dayjs().format('YYYY-MM-DD'),
            transactionType: 'Adjustment',
            expenseType:     txn.expenseType || undefined,
            currency:        txn.currency,
            debitAmount:     txn.creditAmount,
            creditAmount:    txn.debitAmount,
            chargeAccountCcid: txn.chargeAccountCcid || undefined,
            chargeAccountDesc: txn.chargeAccountDesc || undefined,
            postingStatus:   'Unposted',
            comments:        `Reversal of Line #${txn.lineNumber}${txn.comments ? ' — ' + txn.comments : ''}`,
            referenceNo:     quickRevVoucherNo,
            createdBy:       currentUser,
          });
          message.success(`Reversal created for Line #${txn.lineNumber}`);
          onRefresh();
        } catch (e: any) {
          message.error(e?.message ?? 'Reversal failed');
        } finally {
          setTxnActionLoading(null);
        }
      },
    });
  };

  // ── Open edit transaction modal (fetch-first) ────────────
  const openEditTransaction = async (txn: PCTransaction) => {
    setTxnActionLoading(txn.transactionId);
    try {
      const fresh = await getTransaction(txn.transactionId);
      editTxnForm.resetFields();
      // Merge: txn (from list) fills any fields the single-record endpoint
      // omits or returns in snake_case (e.g. employee_name vs employeeName)
      setEditTxn({ ...txn, ...fresh });
      setEditTxnOpen(true);
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to load transaction');
    } finally {
      setTxnActionLoading(null);
    }
  };

  // ── Save edited transaction ───────────────────────────────
  const handleSaveEditTransaction = async (values: any) => {
    if (!editTxn) return;
    const accDate = values.accountingDate ?? values.transactionDate;
    if (periodsLoaded && openPeriods.length > 0 && !findAPPeriod(accDate)) {
      message.error(`Accounting date ${accDate.format('DD-MMM-YYYY')} does not fall within an open AP period`);
      return;
    }
    setSaving(true);
    try {
      const isExpense = editTxn.transactionType === 'Expense';
      await updateTransaction(editTxn.transactionId, {
        transactionDate:   values.transactionDate.format('YYYY-MM-DD'),
        accountingDate:    values.accountingDate
          ? values.accountingDate.format('YYYY-MM-DD')
          : values.transactionDate.format('YYYY-MM-DD'),
        currency:          values.currency,
        debitAmount:       isExpense ? 0 : values.amount,
        creditAmount:      isExpense ? values.amount : 0,
        expenseType:       values.expenseType   || null,
        chargeAccountDesc: values.chargeAccountDesc || null,
        chargeAccountCcid: values.chargeAccountCcid || null,
        referenceNo:       values.referenceNo   || null,
        comments:          values.comments      || null,
        employeeName:      values.employeeName  || null,
        receiptStatus:     values.receiptStatus || null,
        updatedBy:         currentUser,
      });
      if (editExpenseFiles.length > 0) {
        await uploadFiles(editTxn.transactionId, editTxn.registerId, editTxn.referenceNo, editExpenseFiles);
      }
      message.success(`Line #${editTxn.lineNumber} updated`);
      setEditTxnOpen(false);
      setEditTxn(null);
      setEditExpenseFiles([]);
      setEditTxnAttachments([]);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Add Money ──────────────────────────────────────────────
  const handleAddMoney = async (values: any) => {
    const accDate = values.accountingDate ?? values.transactionDate;
    if (periodsLoaded && openPeriods.length > 0 && !findAPPeriod(accDate)) {
      message.error(`Accounting date ${accDate.format('DD-MMM-YYYY')} does not fall within an open AP period`);
      return;
    }
    if (fundingSource === 'bank' && !linkedBankTxnRef) {
      message.error('Create a bank transaction first before saving');
      return;
    }
    if (fundingSource === 'refund' && !values.refundCashAccount) {
      message.error('Cash Account is required for Balance Refund');
      return;
    }
    setSaving(true);
    try {
      const isRefund  = fundingSource === 'refund';
      const isOpening = fundingSource === 'opening';
      await createTransaction({
        registerId:         register.registerId,
        transactionDate:    values.transactionDate.format('YYYY-MM-DD'),
        accountingDate:     accDate.format('YYYY-MM-DD'),
        transactionType:    isRefund ? 'Balance Refund' : isOpening ? 'Opening Fund Balance' : 'Balance Refill',
        currency:           values.currency || register.currency,
        debitAmount:        values.amount,
        creditAmount:       0,
        chargeAccountCcid:  isRefund || isOpening ? null : (values.chargeAccountCcid || null),
        chargeAccountDesc:  isRefund ? values.refundCashAccount : isOpening ? null : (values.chargeAccountDesc || null),
        referenceNo:        addMoneyVoucherNo || null,
        bankTxnId:          isRefund || isOpening ? null : (linkedBankTxnRef ? (Number(linkedBankTxnRef) || null) : null),
        comments:           values.comments,
        postingStatus:      isOpening ? 'Posted' : 'Unposted',
        createdBy:          currentUser,
      });
      const seqMn = addMoneyVoucherNo.match(/(\d+)$/);
      const nextSeqN = seqMn ? parseInt(seqMn[1], 10) + 1 : 1;
      setAddMoneyVoucherNo(`R${register.registerId}-${String(nextSeqN).padStart(2, '0')}`);
      message.success(isRefund ? 'Refund recorded' : isOpening ? 'Opening balance recorded' : 'Money added to register');
      moneyForm.resetFields();
      setMoneyAcctDesc('');
      setRefundCashDesc('');
      setFundingSource('bank');
      setLinkedBankTxnRef('');
      setBankTxnPostResponse(null);
      setBankTxnLookupResult(null);
      needsRefresh.current = false;
      setAddMoneyOpen(false);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to add money');
    } finally {
      setSaving(false);
    }
  };

  // ── Open bank transaction detail popup ────────────────────
  const openBankTxnDetail = async (bankTxnId: number) => {
    setBankTxnDetailSourceId(bankTxnId);   // store so footer can find the PC transaction
    setBankTxnDetailLoading(true);
    setBankTxnDetailOpen(true);
    setBankTxnDetail(null);
    const url = `${EXT_TXN_URL}?external_transaction_id=${bankTxnId}&row_limit=1`;
    setBankTxnDetailUrl(url);
    try {
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const item = (data.items || [])[0] || null;
      setBankTxnDetail(item);
    } catch { setBankTxnDetail(null); }
    finally { setBankTxnDetailLoading(false); }
  };

  // ── Create Bank Transaction (from Add Money) ──────────────
  const handleCreateBankTxn = async (values: any) => {
    setBankTxnSaving(true);
    const uniqueRef = values.referenceText?.trim() || `PC-REG${register.registerId}-${Date.now()}`;
    const payload = {
      items: [{
        BankAccountName:          values.bankAccountName,
        BusinessUnitName:         values.businessUnitName ?? register.businessUnit,
        Amount:                   values.amount,
        TransactionDate:          values.transactionDate?.format('YYYY-MM-DD'),
        CurrencyCode:             values.currencyCode ?? register.currency,
        ReferenceText:            uniqueRef,
        TransactionType:          values.transactionType ?? 'MISC',
        Description:              values.description ?? `Petty Cash Refill — ${register.registerName}`,
        Source:                   'ORA_MAN',
        Status:                   'UNR',
        AccountingFlag:           false,
        CreatedBy:                currentUser,
        CreationDate:             new Date().toISOString(),
        LastUpdatedBy:            currentUser,
        LastUpdateDate:           new Date().toISOString(),
        LastUpdateLogin:          '',
        AssetAccountCombination:  values.assetAccountCombination ?? '',
        OffsetAccountCombination: values.offsetAccountCombination ?? '',
      }],
    };
    setBankTxnPayload(payload);
    setBankTxnPostResponse(null);
    setBankTxnRawError('');
    try {
      const res = await fetch(EXT_TXN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const rawText = await res.text();
      let data: any = {};
      try { data = JSON.parse(rawText); } catch { data = { status: 'error', message: rawText }; }
      setBankTxnPostResponse(data);
      setBankTxnRawError(res.ok ? '' : `HTTP ${res.status} — ${rawText}`);
      if (data.status === 'success') {
        // externalTransactionId is now returned directly by the POST handler
        const extId: number | null = data.externalTransactionId ?? null;
        const txnRef = extId ? String(extId) : uniqueRef;
        // Also do a lookup so we can show the full record in the debug panel
        let lookupResult: any = null;
        if (extId) {
          try {
            const srch = await fetch(
              `${EXT_TXN_URL}?external_transaction_id=${extId}&row_limit=1`,
              { headers: { Accept: 'application/json' } }
            );
            lookupResult = await srch.json();
          } catch {}
        }
        setBankTxnLookupResult(lookupResult);
        message.success(`Bank transaction created — ID: ${txnRef}`);
        setLinkedBankTxnRef(txnRef);
        // Copy offset account → charge account in Add Money
        const offsetAcct = bankTxnForm.getFieldValue('offsetAccountCombination');
        if (offsetAcct) {
          moneyForm.setFieldsValue({ chargeAccountDesc: offsetAcct, chargeAccountCcid: null });
          validateAccountCode(offsetAcct).then(result => {
            const seg4 = Object.values(result.segmentDetails)[3];
            setMoneyAcctDesc(seg4?.description || '');
          }).catch(() => {});
        }
        setBankTxnModalOpen(false);
      } else {
        message.error(data.message || 'Failed — see API Response panel below');
      }
    } catch (e: any) {
      setBankTxnRawError(String(e));
      message.error(e?.message ?? 'Network error');
    } finally {
      setBankTxnSaving(false);
    }
  };

  // ── Add Expense ────────────────────────────────────────────
  const handleAddExpense = async (values: any) => {
    const accDate = values.accountingDate ?? values.transactionDate;
    if (periodsLoaded && openPeriods.length > 0 && !findAPPeriod(accDate)) {
      message.error(`Accounting date ${accDate.format('DD-MMM-YYYY')} does not fall within an open AP period`);
      return;
    }
    if (values.amount > register.balance) {
      message.error(`Expense amount (${fmt(values.amount)}) exceeds available balance (${fmt(register.balance)} ${register.currency}). Balance cannot go negative.`);
      return;
    }
    setSaving(true);
    try {
      const result = await createTransaction({
        registerId:           register.registerId,
        transactionDate:      values.transactionDate.format('YYYY-MM-DD'),
        accountingDate:       values.accountingDate
          ? values.accountingDate.format('YYYY-MM-DD')
          : values.transactionDate.format('YYYY-MM-DD'),
        transactionType:      'Expense',
        expenseType:          values.expenseType,
        currency:             values.currency || register.currency,
        debitAmount:          0,
        creditAmount:         values.amount,
        chargeAccountCcid:    values.chargeAccountCcid || null,
        chargeAccountDesc:    values.chargeAccountDesc || null,
        referenceNo:          addExpenseVoucherNo || null,
        comments:             values.comments,
        referenceDescription: values.referenceDescription || null,
        employeeName:         values.employeeName || null,
        receiptStatus:        values.receiptStatus || null,
        postingStatus:        'Unposted',
        createdBy:            currentUser,
      });
      if (addExpenseFiles.length > 0) {
        await uploadFiles(result.transactionId, register.registerId, addExpenseVoucherNo || null, addExpenseFiles);
      }
      // Bump voucher immediately so next open shows correct incremented number
      const seqM = addExpenseVoucherNo.match(/(\d+)$/);
      const nextSeq = seqM ? parseInt(seqM[1], 10) + 1 : 1;
      setAddExpenseVoucherNo(`R${register.registerId}-${String(nextSeq).padStart(2, '0')}`);
      message.success('Expense recorded');
      expenseForm.resetFields();
      setAddExpenseFiles([]);
      setAddExpenseFromRefGroup(false);
      needsRefresh.current = false;
      setAddExpenseOpen(false);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to record expense');
    } finally {
      setSaving(false);
    }
  };

  // ── Add Suspense ────────────────────────────────────────────
  const handleAddSuspense = async (values: any) => {
    const accDate = values.accountingDate ?? values.transactionDate;
    if (periodsLoaded && openPeriods.length > 0 && !findAPPeriod(accDate)) {
      message.error(`Accounting date ${accDate.format('DD-MMM-YYYY')} does not fall within an open AP period`);
      return;
    }
    setSaving(true);
    try {
      await createTransaction({
        registerId:           register.registerId,
        transactionDate:      values.transactionDate.format('YYYY-MM-DD'),
        accountingDate:       accDate.format('YYYY-MM-DD'),
        transactionType:      'Expense',
        expenseType:          'SUSPENSE',
        currency:             values.currency || register.currency,
        debitAmount:          0,
        creditAmount:         0,
        suspenseAmount:         values.amount,
        originalSuspenseAmount: values.amount,
        chargeAccountCcid:    values.chargeAccountCcid || null,
        chargeAccountDesc:    values.chargeAccountDesc || null,
        referenceNo:          addSuspenseVoucherNo || null,
        employeeName:         values.employeeName || null,
        comments:             `${fmt(values.amount)} ${values.currency || register.currency}${values.comments ? ' — ' + values.comments : ''}`,
        postingStatus:        'Unposted',
        createdBy:            currentUser,
      });
      const seq = addSuspenseVoucherNo.match(/(\d+)$/);
      const nextSeq = seq ? parseInt(seq[1], 10) + 1 : 1;
      setAddSuspenseVoucherNo(`R${register.registerId}-${String(nextSeq).padStart(2, '0')}`);
      message.success('Suspense recorded');
      suspenseForm.resetFields();
      setAddSuspenseOpen(false);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to record suspense');
    } finally {
      setSaving(false);
    }
  };

  // ── Convert Suspense to Expense (multi-line) ──────────────
  const handleConvertSuspense = async (values: any) => {
    if (!convertSuspenseRec) return;

    const missingAmount = convertLines.filter(l => l.expenseType && !(l.amount && l.amount > 0));
    if (missingAmount.length > 0) {
      message.error(`Row ${missingAmount.map(l => convertLines.indexOf(l) + 1).join(', ')}: Amount is required`);
      return;
    }
    const missingType = convertLines.filter(l => !l.expenseType && (l.amount ?? 0) > 0);
    if (missingType.length > 0) {
      message.error(`Row ${missingType.map(l => convertLines.indexOf(l) + 1).join(', ')}: Expense Type is required`);
      return;
    }
    const validLines = convertLines.filter(l => l.expenseType && (l.amount ?? 0) > 0);
    if (validLines.length === 0) { message.error('Add at least one expense line'); return; }

    const totalConvert = validLines.reduce((s, l) => s + (l.amount ?? 0), 0);
    if (totalConvert > register.balance) {
      message.error(`Total (${fmt(totalConvert)}) exceeds available balance (${fmt(register.balance)} ${register.currency}). Balance cannot go negative.`);
      return;
    }

    setSaving(true);
    setConvertApiError('');
    setConvertApiResponse(null);
    try {
      const remaining = Math.max(0, (convertSuspenseRec.suspenseAmount || 0) - totalConvert);

      await updateTransaction(convertSuspenseRec.transactionId, {
        suspenseAmount: remaining,
        comments: values.reason
          ? `[Converted ${fmt(totalConvert)}] ${values.reason}`
          : convertSuspenseRec.comments ?? undefined,
        updatedBy: currentUser,
      });

      const txnDate = toIsoDate(convertSuspenseRec.transactionDate);
      const accDate = toIsoDate(convertSuspenseRec.accountingDate);
      for (const line of validLines) {
        const payload = {
          registerId:        register.registerId,
          transactionDate:   txnDate,
          accountingDate:    accDate || txnDate,
          transactionType:   'Expense' as const,
          expenseType:       line.expenseType,
          chargeAccountDesc: line.chargeAccountDesc || null,
          chargeAccountCcid: null as number | null,
          currency:          convertSuspenseRec.currency,
          debitAmount:       0,
          creditAmount:      line.amount!,
          suspenseAmount:    0,
          employeeName:      line.paidTo || null,
          comments:          line.description || `Converted from suspense #${convertSuspenseRec.transactionId}`,
          referenceNo:       convertSuspenseRec.referenceNo || null,
          postingStatus:     'Unposted' as const,
          createdBy:         currentUser,
        };
        setConvertApiPayload(payload);
        const result = await createTransaction(payload);
        setConvertApiResponse(result);
      }

      message.success(`Converted ${fmt(totalConvert)} to ${validLines.length} expense(s)${remaining > 0 ? ` — ${fmt(remaining)} remains in suspense` : ''}`);
      convertSuspenseForm.resetFields();
      setConvertLines([makeNewLine()]);
      setConvertSuspenseOpen(false);
      setConvertSuspenseRec(null);
      onRefresh();
    } catch (e: any) {
      setConvertApiError(e?.message ?? 'Failed to convert suspense');
      message.error(e?.message ?? 'Failed to convert suspense');
    } finally {
      setSaving(false);
    }
  };

  // ── Suspense Refund ────────────────────────────────────────
  const handleSuspenseRefund = async (values: any) => {
    if (!suspenseRefundRec) return;
    const refundAmt: number = values.amount;
    if (!refundAmt || refundAmt <= 0) { message.error('Amount is required'); return; }
    setSaving(true);
    try {
      const remaining = Math.max(0, (suspenseRefundRec.suspenseAmount || 0) - refundAmt);
      // Reduce the original suspense transaction's balance
      await updateTransaction(suspenseRefundRec.transactionId, {
        suspenseAmount: remaining,
        updatedBy: currentUser,
      });
      // Create the refund record — negative suspense, no debit (not money-in), no account needed
      await createTransaction({
        registerId:      register.registerId,
        transactionDate: values.transactionDate.format('YYYY-MM-DD'),
        accountingDate:  values.transactionDate.format('YYYY-MM-DD'),
        transactionType: 'Expense' as const,
        expenseType:     'SUSPENSE_REFUND',
        currency:        suspenseRefundRec.currency,
        debitAmount:     0,
        creditAmount:    0,
        suspenseAmount:  -refundAmt,
        referenceNo:     suspenseRefundRec.referenceNo || null,
        employeeName:    suspenseRefundRec.employeeName || null,
        comments:        values.comments
          ? `${fmt(refundAmt)} ${suspenseRefundRec.currency} — ${values.comments}`
          : `${fmt(refundAmt)} ${suspenseRefundRec.currency} — Suspense refund`,
        postingStatus:   'Posted' as const,
        createdBy:       currentUser,
      });
      message.success(`Refund of ${fmt(refundAmt)} recorded${remaining > 0 ? ` — ${fmt(remaining)} remains in suspense` : ''}`);
      suspenseRefundForm.resetFields();
      setSuspenseRefundOpen(false);
      setSuspenseRefundRec(null);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to record refund');
    } finally {
      setSaving(false);
    }
  };

  // ── Add Multiple Expenses ──────────────────────────────────
  const handleAddMultiExpense = async () => {
    const vals = expenseForm.getFieldsValue(['transactionDate', 'accountingDate', 'currency', 'referenceDescription']);
    if (!vals.transactionDate) { message.error('Transaction Date is required'); return; }
    const accDate = vals.accountingDate ?? vals.transactionDate;
    if (periodsLoaded && openPeriods.length > 0 && !findAPPeriod(accDate)) {
      message.error(`Accounting date ${accDate.format('DD-MMM-YYYY')} does not fall within an open AP period`);
      return;
    }
    // Any line that has been started (type or amount filled) must have both
    const missingAmount = expenseLines.filter(l => l.expenseType && !(l.amount && l.amount > 0));
    if (missingAmount.length > 0) {
      message.error(`Row ${missingAmount.map(l => expenseLines.indexOf(l) + 1).join(', ')}: Amount is required`);
      return;
    }
    const missingType = expenseLines.filter(l => !l.expenseType && (l.amount ?? 0) > 0);
    if (missingType.length > 0) {
      message.error(`Row ${missingType.map(l => expenseLines.indexOf(l) + 1).join(', ')}: Expense Type is required`);
      return;
    }
    const validLines = expenseLines.filter(l => l.expenseType && (l.amount ?? 0) > 0);
    if (validLines.length === 0) {
      message.error('Add at least one line with Expense Type and Amount > 0');
      return;
    }
    const totalAmt = validLines.reduce((s, l) => s + (l.amount ?? 0), 0);
    if (totalAmt > register.balance) {
      message.error(`Total (${fmt(totalAmt)}) exceeds available balance (${fmt(register.balance)} ${register.currency}). Balance cannot go negative.`);
      return;
    }
    setSaving(true);
    let created = 0;
    let firstTxnId: number | null = null;
    try {
      for (const line of validLines) {
        const result = await createTransaction({
          registerId:           register.registerId,
          transactionDate:      vals.transactionDate.format('YYYY-MM-DD'),
          accountingDate:       accDate.format('YYYY-MM-DD'),
          transactionType:      'Expense',
          expenseType:          line.expenseType,
          currency:             vals.currency || register.currency,
          debitAmount:          0,
          creditAmount:         line.amount!,
          chargeAccountCcid:    line.chargeAccountCcid || null,
          chargeAccountDesc:    line.chargeAccountDesc || null,
          employeeName:         line.paidTo || null,
          referenceNo:          addExpenseVoucherNo || null,
          comments:             line.description || null,
          referenceDescription: vals.referenceDescription || null,
          postingStatus:        'Unposted',
          createdBy:            currentUser,
        });
        if (firstTxnId === null) firstTxnId = result.transactionId;
        created++;
      }
      if (firstTxnId !== null && addExpenseFiles.length > 0) {
        await uploadFiles(firstTxnId, register.registerId, addExpenseVoucherNo || null, addExpenseFiles);
      }
      // Bump voucher so next open shows the next number in sequence
      const seqMm = addExpenseVoucherNo.match(/(\d+)$/);
      const nextSeqM = seqMm ? parseInt(seqMm[1], 10) + 1 : 1;
      setAddExpenseVoucherNo(`R${register.registerId}-${String(nextSeqM).padStart(2, '0')}`);
      message.success(`${created} expense line${created > 1 ? 's' : ''} recorded`);
      expenseForm.resetFields();
      setExpenseLines([makeNewLine()]);
      setExpenseMode('single');
      setAddExpenseFiles([]);
      setAddExpenseFromRefGroup(false);
      setAddExpenseOpen(false);
      onRefresh();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to record expenses');
    } finally {
      setSaving(false);
    }
  };

  // ── Accounting handlers ───────────────────────────────────

  const loadLedgerAndLE = async (): Promise<{ ledgerId: number; ledgerName: string; legalEntity: string } | null> => {
    let leInfo = legalEntityName;
    let ldInfo = ledgerInfo;
    if (!ldInfo) {
      try {
        const info = await fetchLedgerByBusinessUnit(register.businessUnit);
        if (!info) { message.error('Could not resolve ledger for this Business Unit'); return null; }
        setLedgerInfo(info);
        ldInfo = info;
      } catch { message.error('Failed to load ledger information'); return null; }
    }
    if (!leInfo) {
      try {
        const buRes = await fetch(`${BU_LIST_URL}`, { headers: { Accept: 'application/json' } });
        const buData = await buRes.json();
        const buItem = (buData.items || []).find((i: any) =>
          (i.business_unit_name || '').toLowerCase() === register.businessUnit.toLowerCase()
        );
        const le = buItem?.legal_entity_name || '';
        setLegalEntityName(le);
        leInfo = le;
      } catch { leInfo = ''; }
    }
    return { ...ldInfo, legalEntity: leInfo };
  };

  const loadViewAcctTxn = async (txn: PCTransaction) => {
    setViewAcctTxn(txn);
    setViewAcctData(null);
    setViewAcctLineDescs(new Map());
    setViewAcctLoading(true);
    try {
      // Try GL tables first (journals created without SLA steps)
      let data = await getGlJournalByTxnId(txn.transactionId);
      // Fall back to SLA sub-ledger for journals posted before the GL-direct flow
      if (!data.found) {
        data = await getAccounting('PC_TRANSACTIONS', txn.transactionId);
      }
      setViewAcctData(data);
      const unique = [...new Set((data.lines || []).map(l => l.accountCombination).filter(Boolean))];
      const resolved = new Map<string, string>();
      await Promise.all(unique.map(async (combo) => {
        try {
          const result = await validateAccountCode(combo);
          const seg4 = Object.values(result.segmentDetails)[3];
          resolved.set(combo, seg4?.description || '');
        } catch { resolved.set(combo, ''); }
      }));
      setViewAcctLineDescs(resolved);
    } catch { setViewAcctData(null); }
    finally { setViewAcctLoading(false); }
  };

  const openViewAccounting = (txn: PCTransaction, queue?: PCTransaction[]) => {
    const q = queue ?? [txn];
    const idx = q.findIndex(t => t.transactionId === txn.transactionId);
    setViewAcctQueue(q);
    setViewAcctQueueIdx(idx >= 0 ? idx : 0);
    setViewAcctOpen(true);
    loadViewAcctTxn(txn);
  };

  const openCreateAccountingModal = (overrideTxns?: PCTransaction[], crAccountOverride?: string) => {
    const selected = overrideTxns ?? transactions.filter(t => selectedRowKeys.includes(t.transactionId));
    if (selected.length === 0) { message.warning('Select at least one transaction.'); return; }

    const noAcct = selected.filter(t => !t.chargeAccountDesc && t.expenseType !== 'SUSPENSE_REFUND');
    const eligible = selected.filter(t => !!t.chargeAccountDesc && t.expenseType !== 'SUSPENSE_REFUND');
    if (noAcct.length > 0) message.warning(`${noAcct.length} line(s) skipped — no charge account assigned.`);
    if (eligible.length === 0) { message.error('None of the selected transactions have a charge account.'); return; }

    const cashCode = crAccountOverride ?? register.cashAccountDesc ?? '';
    const cashDesc = cashAccountName ?? '';

    // Group by referenceNo, always expanding to the FULL reference group from
    // the transactions list — never process a partial reference.
    const byRef = new Map<string, PCTransaction[]>();
    for (const t of eligible) {
      const key = t.referenceNo ? t.referenceNo : `__NOREF_${t.transactionId}`;
      if (byRef.has(key)) continue; // already added via group expansion below
      if (t.referenceNo) {
        // Pull every eligible line that shares this reference
        const group = transactions.filter(
          s => s.referenceNo === t.referenceNo && !!s.chargeAccountDesc
        );
        byRef.set(key, group);
      } else {
        byRef.set(key, [t]);
      }
    }

    const rows: AcctProgressRow[] = [];
    for (const [groupKey, txns] of byRef) {
      const refNo    = txns[0].referenceNo || '—';
      const first    = txns[0];
      const acctDate = toIsoDate(first.accountingDate || first.transactionDate);

      const drLines: AcctDrLine[] = txns.map(t => ({
        txnId:         t.transactionId,
        chargeAccount: t.chargeAccountDesc ?? '',
        chargeDesc:    chargeAcctResolved.get(t.transactionId)?.desc ?? '',
        amount:        t.creditAmount > 0 ? t.creditAmount : t.debitAmount,
        expenseType:   t.expenseType,
        description:   t.comments || null,
      }));

      const totalAmount   = drLines.reduce((s, l) => s + l.amount, 0);
      const allPosted     = txns.every(t => t.postingStatus === 'Posted');
      const joinedExpType = [...new Set(drLines.map(l => l.expenseType).filter(Boolean))].join(', ') || null;
      const refDesc       = txns.find(t => t.referenceDescription)?.referenceDescription || null;

      rows.push({
        txnId:                first.transactionId,
        lineNumber:           first.lineNumber,
        transactionType:      first.transactionType,
        expenseType:          joinedExpType,
        amount:               totalAmount,
        currency:             first.currency,
        accountingDate:       acctDate,
        periodName:           derivePeriodName(new Date(acctDate)),
        drAccount:            drLines[0]?.chargeAccount || '',
        drAccountDesc:        drLines[0]?.chargeDesc    || '',
        crAccount:            cashCode,
        crAccountDesc:        cashDesc,
        status:               allPosted ? 'skipped' : 'pending',
        message:              allPosted ? 'Already posted — skipped' : undefined,
        refNo,
        referenceDescription: refDesc,
        txnIds:               txns.map(t => t.transactionId),
        drLines,
      });
    }

    setAcctProgress(rows);
    setAcctDone(false);
    setAcctModalOpen(true);
  };

  const runCreateAccounting = async () => {
    setAcctRunning(true);
    const ctx = await loadLedgerAndLE();
    if (!ctx) { setAcctRunning(false); return; }

    const updateRow = (txnId: number, partial: Partial<AcctProgressRow>) =>
      setAcctProgress(prev => prev.map(r => r.txnId === txnId ? { ...r, ...partial } : r));

    const APEX_BASE = APEX_DB_CONFIG.baseUrl;

    for (const row of acctProgress) {
      if (row.status === 'skipped') continue;
      updateRow(row.txnId, { status: 'running' });

      if (!register.cashAccountDesc) {
        updateRow(row.txnId, { status: 'error', message: 'Register has no cash account configured' }); continue;
      }

      const txns = row.txnIds
        .map(id => transactions.find(t => t.transactionId === id))
        .filter(Boolean) as PCTransaction[];
      if (txns.length === 0) {
        updateRow(row.txnId, { status: 'error', message: 'Transactions not found locally' }); continue;
      }

      try {
        const acctDate   = row.accountingDate;
        const periodName = row.periodName;
        const currency   = row.currency;
        const totalAmt   = row.amount;
        const safRef     = row.refNo.replace(/[^a-z0-9]/gi, '_');
        const batchName  = `PC-${register.registerId}-REF-${safRef}-${Date.now()}`;

        // ── Step 1: Create ONE GL journal for the reference group ──
        // N debit lines (one per expense) + 1 credit line (cash total)
        const glLines = [
          ...row.drLines.map(dl => ({
            enteredDr:                  dl.amount,
            enteredCr:                  null,
            accountedDr:                dl.amount,
            accountedCr:                null,
            statAmount:                 null,
            description:                dl.description || dl.expenseType || 'Petty Cash Expense',
            currencyCode:               currency,
            currencyConversionDate:     acctDate,
            currencyConversionRate:     1,
            userCurrencyConversionType: 'User',
            accountCombination:         dl.chargeAccount,
            chartOfAccountsName:        'Chart of Accounts',
            reference1:                 String(dl.txnId),
            reference2:                 register.registerName,
            reference3:                 'EXPENSE',
            reference4:                 register.businessUnit || null,
            reference5:                 row.refNo !== '—' ? row.refNo : null,
            createdBy:                  currentUser,
          })),
          {
            enteredDr:                  null,
            enteredCr:                  totalAmt,
            accountedDr:                null,
            accountedCr:                totalAmt,
            statAmount:                 null,
            description:                row.referenceDescription || 'Petty Cash Account',
            currencyCode:               currency,
            currencyConversionDate:     acctDate,
            currencyConversionRate:     1,
            userCurrencyConversionType: 'User',
            accountCombination:         row.crAccount,
            chartOfAccountsName:        'Chart of Accounts',
            reference1:                 row.refNo !== '—' ? row.refNo : String(txns[0].transactionId),
            reference2:                 register.registerName,
            reference3:                 'PETTY_CASH',
            reference4:                 register.businessUnit || null,
            reference5:                 null,
            createdBy:                  currentUser,
          },
        ];

        const glPayload = {
          batch: {
            batchName,
            batchDescription: `Petty Cash – ${register.registerName}`,
            ledgerName:       ctx.ledgerName,
            ledgerId:         ctx.ledgerId,
            status:           'NEW',
            accountingPeriod: periodName,
            controlTotal:     totalAmt,
            runningTotalDr:   totalAmt,
            runningTotalCr:   totalAmt,
            batchSource:      'Petty Cash',
            createdBy:        currentUser,
          },
          header: {
            ledgerId:               ctx.ledgerId,
            ledgerName:             ctx.ledgerName,
            jeCategory:             'Petty Cash',
            jeSource:               'Petty Cash',
            periodName,
            journalName:            `PC-${row.refNo !== '—' ? row.refNo : `TXN-${txns[0].transactionId}`}`,
            description:            `${row.refNo !== '—' ? row.refNo : 'Petty Cash'} – ${register.registerName}`,
            currencyCode:           currency,
            currencyConversionType: 'User',
            currencyConversionDate: acctDate,
            currencyConversionRate: 1,
            defaultEffectiveDate:   acctDate,
            status:                 'NEW',
            runningTotalDr:         totalAmt,
            runningTotalCr:         totalAmt,
            createdBy:              currentUser,
          },
          lines: glLines,
        };

        // ── Pre-flight validation ─────────────────────────────
        const txnStatuses = Object.fromEntries(txns.map(t => [t.transactionId, t.postingStatus]));
        const validation  = validateGlPayload(glPayload as GlJournalPayload, {
          module:             'PC',
          referenceNo:        row.refNo,
          expectedDrCount:    row.drLines.length,
          sourceTxnIds:       row.txnIds,
          sourceTxnStatuses:  txnStatuses,
        });

        // Always persist the validation result for the audit trail
        const logId = await persistValidationLog(
          'PC', row.refNo, batchName,
          validation.valid ? 'PASSED' : 'FAILED',
          validation.errors, glPayload as GlJournalPayload, currentUser,
        );

        const logEntry: GlValidationLogEntry = {
          logId:           logId ?? Date.now(),
          module:          'PC',
          referenceNo:     row.refNo,
          batchName,
          result:          validation.valid ? 'PASSED' : 'FAILED',
          errorCount:      validation.errors.filter(e => e.severity === 'ERROR').length,
          warningCount:    validation.errors.filter(e => e.severity === 'WARNING').length,
          errorCategories: [...new Set(validation.errors.map(e => e.category))].join(',') || null,
          errorSummary:    validation.errors.filter(e => e.severity === 'ERROR').map(e => `[${e.category}] ${e.message}`).join(' | ') || null,
          errorDetail:     validation.errors,
          createdBy:       currentUser,
          creationDate:    new Date().toISOString(),
        };
        addSessionEntry(logEntry);

        if (!validation.valid) {
          const errorLines = validation.errors.filter(e => e.severity === 'ERROR');
          const logMsg = [
            `GL VALIDATION FAILED — ref: ${row.refNo} | batch: ${batchName}`,
            ...errorLines.map(e => `  [${e.category}] ${e.message}`),
          ].join('\n');
          console.error(logMsg);
          updateRow(row.txnId, {
            status:  'error',
            message: `Validation failed (${errorLines.length} error${errorLines.length !== 1 ? 's' : ''}) — see Errors log: ${errorLines.map(e => e.category).join(', ')}`,
          });
          continue;
        }

        const glRes  = await fetch(`${APEX_BASE}/journals/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:   JSON.stringify(glPayload),
        });
        const glData = glRes.ok ? await glRes.json() : null;

        // ── Step 2: Update status of every transaction in group ─
        let bankMsg = '';
        for (const txn of txns) {
          await updateTransactionStatus(txn.transactionId, glRes.ok ? 'Posted' : 'Unposted', currentUser);

          if (glRes.ok && txn.transactionType === 'Balance Refill' && txn.bankTxnId) {
            try {
              const flagUrl = `${APEX_BASE}/cash/externaltransactions/${txn.bankTxnId}/acctflag?updated_by=${encodeURIComponent(currentUser)}`;
              const flagRes = await fetch(flagUrl, { method: 'PUT', headers: { Accept: 'application/json' } });
              const flagData = await flagRes.json().catch(() => ({})) as { success?: boolean };
              bankMsg += flagData.success ? ` | Bank#${txn.bankTxnId} accounted` : ` | Bank#${txn.bankTxnId} flag failed`;
            } catch { bankMsg += ` | Bank acctflag error`; }
          }
        }

        updateRow(row.txnId, {
          status:  glRes.ok ? 'success' : 'error',
          message: glRes.ok
            ? `GL Batch: ${batchName} (${row.drLines.length} DR + 1 CR)${bankMsg}`
            : `GL journal failed`,
        });
      } catch (e: any) {
        updateRow(row.txnId, { status: 'error', message: e?.message || 'Unexpected error' });
      }
    }

    setAcctRunning(false);
    setAcctDone(true);
    setSelectedRowKeys([]);
    onRefresh();
  };

  // ── API Debug ─────────────────────────────────────────────
  const openApiDebug = async () => {
    setApiDebugLoading(true);
    setApiDebugItems([]);
    setApiDebugOpen(true);
    try {
      const ctx = await loadLedgerAndLE();
      if (!ctx) { setApiDebugLoading(false); return; }
      const APEX_BASE = APEX_DB_CONFIG.baseUrl;
      const items: ApiDebugItem[] = [];

      for (const row of acctProgress) {
        if (row.status === 'skipped') continue;
        const txns = row.txnIds.map(id => transactions.find(t => t.transactionId === id)).filter(Boolean) as PCTransaction[];
        if (txns.length === 0) continue;

        const acctDate   = row.accountingDate;
        const periodName = row.periodName;
        const safRef     = row.refNo.replace(/[^a-z0-9]/gi, '_');
        const batchName  = `PC-${register.registerId}-REF-${safRef}-<timestamp>`;

        // ONE grouped GL journal per reference
        const glLines = [
          ...row.drLines.map(dl => ({
            enteredDr: dl.amount, enteredCr: null, accountedDr: dl.amount, accountedCr: null,
            statAmount: null, description: dl.description || dl.expenseType || 'Petty Cash Expense',
            currencyCode: row.currency, currencyConversionDate: acctDate, currencyConversionRate: 1,
            userCurrencyConversionType: 'User', accountCombination: dl.chargeAccount,
            chartOfAccountsName: 'Chart of Accounts',
            reference1: String(dl.txnId), reference2: register.registerName,
            reference3: 'EXPENSE', reference4: register.businessUnit || null,
            reference5: row.refNo !== '—' ? row.refNo : null, createdBy: currentUser,
          })),
          {
            enteredDr: null, enteredCr: row.amount, accountedDr: null, accountedCr: row.amount,
            statAmount: null, description: row.referenceDescription || 'Petty Cash Account',
            currencyCode: row.currency, currencyConversionDate: acctDate, currencyConversionRate: 1,
            userCurrencyConversionType: 'User', accountCombination: row.crAccount,
            chartOfAccountsName: 'Chart of Accounts',
            reference1: row.refNo !== '—' ? row.refNo : String(txns[0].transactionId),
            reference2: register.registerName, reference3: 'PETTY_CASH',
            reference4: register.businessUnit || null, reference5: null, createdBy: currentUser,
          },
        ];
        const glPayload = {
          batch: {
            batchName, batchDescription: `Petty Cash – ${register.registerName}`,
            ledgerName: ctx.ledgerName, ledgerId: ctx.ledgerId, status: 'NEW',
            accountingPeriod: periodName, controlTotal: row.amount,
            runningTotalDr: row.amount, runningTotalCr: row.amount,
            batchSource: 'Petty Cash', createdBy: currentUser,
          },
          header: {
            ledgerId: ctx.ledgerId, ledgerName: ctx.ledgerName,
            jeCategory: 'Petty Cash', jeSource: 'Petty Cash', periodName,
            journalName: `PC-${row.refNo !== '—' ? row.refNo : `TXN-${txns[0].transactionId}`}`,
            description: `${row.refNo !== '—' ? row.refNo : 'Petty Cash'} – ${register.registerName}`,
            currencyCode: row.currency, currencyConversionType: 'User',
            currencyConversionDate: acctDate, currencyConversionRate: 1,
            defaultEffectiveDate: acctDate,
            status: 'NEW', runningTotalDr: row.amount, runningTotalCr: row.amount, createdBy: currentUser,
          },
          lines: glLines,
        };
        items.push({ label: `[${row.refNo}] POST journals/create  (${row.drLines.length} DR + 1 CR)`, url: `${APEX_BASE}/journals/create`, body: glPayload });
      }
      setApiDebugItems(items);
    } catch (e: any) {
      message.error(`Failed to build API preview: ${e?.message}`);
    }
    setApiDebugLoading(false);
  };

  const testApiItem = async (idx: number) => {
    const item = apiDebugItems[idx];
    if (!item) return;
    setApiDebugItems(prev => prev.map((it, i) => i === idx ? { ...it, loading: true, response: undefined, error: undefined } : it));
    try {
      const res = await fetch(item.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(item.body),
      });
      const data = await res.json();
      setApiDebugItems(prev => prev.map((it, i) => i === idx ? { ...it, loading: false, response: data, error: res.ok ? undefined : (data?.message || `HTTP ${res.status}`) } : it));
    } catch (e: any) {
      setApiDebugItems(prev => prev.map((it, i) => i === idx ? { ...it, loading: false, error: e?.message } : it));
    }
  };

  // ── Transaction columns ────────────────────────────────────
  const txnColumns: ColumnsType<TxnRow> = [
    { title: '#', dataIndex: 'lineNumber', width: 64, align: 'center',
      render: (v, rec) => rec.__group
        ? <Tag style={{ fontSize: 11, margin: 0 }}>{rec.children!.length} lines</Tag>
        : <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{v}</Text> },
    { title: 'Txn ID', dataIndex: 'transactionId', width: 76, align: 'center' as const,
      render: (v, rec) => rec.__group ? null
        : <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v}</Text> },
    { title: 'Reference', dataIndex: 'referenceNo', width: 140,
      render: (v: string | null, rec: TxnRow) => {
        if (rec.__group) {
          return (
            <a style={{ fontSize: 12, fontWeight: 700 }}
              onClick={() => { setRefGroupRef(v!); refGroupForm.setFieldsValue({ referenceNo: v! }); setRefGroupOpen(true); }}>
              {v}
            </a>
          );
        }
        if (rec.__childOf) return null; // child row — reference shown in group header
        if (!v) return <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
        return (
          <a style={{ fontSize: 12, fontWeight: 600 }}
            onClick={() => { setRefGroupRef(v); refGroupForm.setFieldsValue({ referenceNo: v }); setRefGroupOpen(true); }}>
            {v}
          </a>
        );
      }},
    { title: 'Date', dataIndex: 'transactionDate', width: 100,
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Period', dataIndex: 'accountingPeriod', width: 100,
      render: (v, rec) => rec.__group ? null
        : v ? <Tag color="blue" style={{ fontSize: 11 }}>{v}</Tag>
        : <Text style={{ fontSize: 12, color: '#ccc' }}>—</Text> },
    { title: 'Type', dataIndex: 'transactionType', width: 130,
      render: (v, rec) => {
        if (rec.__group) return null;
        const color = v === 'Balance Refill'        ? 'blue'
          : v === 'Balance Refund'       ? 'green'
          : v === 'Opening Fund Balance' ? 'gold'
          : v === 'Balance Return'       ? 'cyan'
          : v === 'Balance Brought Fwd'  ? 'geekblue'
          : v === 'Expense'              ? 'orange'
          : 'purple';
        return <Tag color={color} style={{ fontSize: 11 }}>{v}</Tag>;
      }},
    { title: 'Expense Type', dataIndex: 'expenseType', width: 120,
      render: (v, rec) => rec.__group ? null : <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Comments', dataIndex: 'comments', width: 220,
      render: (v, rec) => rec.__group ? null : <span style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '—'}</span> },
    { title: 'Currency', dataIndex: 'currency', width: 80, align: 'center',
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Money In', dataIndex: 'debitAmount', width: 130, align: 'right',
      render: (v, rec) => {
        const val = rec.__group ? rec.debitAmount : v;
        return val > 0
          ? <Text style={{ fontSize: 12, color: REDWOOD.success, fontWeight: rec.__group ? 600 : 400 }}>{fmt(val)}</Text>
          : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
      }},
    { title: 'Money Out', dataIndex: 'creditAmount', width: 130, align: 'right',
      render: (v, rec) => {
        const val = rec.__group ? rec.creditAmount : v;
        return val > 0
          ? <Text style={{ fontSize: 12, color: REDWOOD.error, fontWeight: rec.__group ? 600 : 400 }}>{fmt(val)}</Text>
          : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
      }},
    { title: 'Orig. Suspense', dataIndex: 'originalSuspenseAmount', width: 120, align: 'right',
      render: (v, rec) => {
        if (rec.__group) return null;
        return v != null && v !== 0
          ? <Text style={{ fontSize: 12, color: '#722ed1' }}>{fmt(v)}</Text>
          : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
      }},
    { title: 'Suspense', dataIndex: 'suspenseAmount', width: 130, align: 'right',
      render: (v, rec) => {
        const val = rec.__group ? rec.suspenseAmount : v;
        if (!val && val !== 0) return <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
        const amtEl = <Text style={{ fontSize: 12, color: val < 0 ? REDWOOD.error : '#722ed1', fontWeight: rec.__group ? 600 : 400 }}>{fmt(val)}</Text>;
        const canEdit = !rec.__group && rec.expenseType === 'SUSPENSE_REFUND' && !isClosed;
        if (!canEdit) return amtEl;
        return (
          <Popover
            open={suspAmtPopover === rec.transactionId}
            onOpenChange={open => {
              if (open) { setSuspAmtPopover(rec.transactionId); setSuspAmtValue(Math.abs(v ?? 0)); }
              else if (!suspAmtSaving) setSuspAmtPopover(null);
            }}
            trigger="click"
            title={<Space size={4}><EditOutlined style={{ color: REDWOOD.info }} />Update Refund Amount</Space>}
            content={
              <div style={{ width: 220 }}>
                <InputNumber
                  style={{ width: '100%', marginBottom: 8 }}
                  min={0}
                  precision={2}
                  value={suspAmtValue}
                  onChange={val => setSuspAmtValue(val ?? 0)}
                  autoFocus
                  onPressEnter={() => handleUpdateSuspenseRefundAmt(rec as PCTransaction)}
                />
                <Space>
                  <Button size="small" type="primary" loading={suspAmtSaving}
                    style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                    onClick={() => handleUpdateSuspenseRefundAmt(rec as PCTransaction)}
                  >Save</Button>
                  <Button size="small" onClick={() => setSuspAmtPopover(null)}>Cancel</Button>
                </Space>
              </div>
            }
          >
            <span style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {amtEl}
              <EditOutlined style={{ fontSize: 10, color: REDWOOD.info }} />
            </span>
          </Popover>
        );
      }},
    { title: 'Balance', dataIndex: 'runningBalance', width: 120, align: 'right',
      render: (v, rec) => {
        if (rec.__group) return null;
        return (
          <Text style={{ fontSize: 12, fontWeight: 600, color: v >= 0 ? REDWOOD.success : REDWOOD.error }}>
            {fmt(v)}
          </Text>
        );
      }},
    { title: 'Charge Account', dataIndex: 'chargeAccountDesc', width: 180,
      render: (_v, rec) => {
        if (rec.__group) return null;
        const r = chargeAcctResolved.get(rec.transactionId);
        const code = r?.code || rec.chargeAccountDesc || '';
        return <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{code || '—'}</Text>;
      }},
    { title: 'Acct Description', dataIndex: 'chargeAccountDesc', width: 160,
      render: (_v, rec) => {
        if (rec.__group) return null;
        const r = chargeAcctResolved.get(rec.transactionId);
        const desc = r?.desc || '';
        return <Text style={{ fontSize: 11 }}>{desc || '—'}</Text>;
      }},
    { title: 'Acct Date', dataIndex: 'accountingDate', width: 100,
      render: (v, rec) => rec.__group ? null : <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Posting', dataIndex: 'postingStatus', width: 90,
      render: (v, rec) => rec.__group ? null : <PostingTag status={v} /> },
    { title: 'Bank Txn ID', dataIndex: 'bankTxnId', width: 118,
      render: (v: number | null, rec: TxnRow) => {
        if (rec.__group) return null;
        if (!v) return <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
        const bankSt = bankTxnStatusMap.get(v);
        const stColor = bankSt?.status === 'VOID' ? 'red' : bankSt?.status === 'REC' ? 'blue' : 'default';
        return (
          <div>
            <a style={{ fontSize: 12, fontFamily: 'monospace' }} onClick={() => openBankTxnDetail(v)}>{v}</a>
            {bankSt && (
              <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <Tag color={stColor} style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', margin: 0 }}>{bankSt.status}</Tag>
                {bankSt.accountingFlag === 'Y'
                  ? <Tag color="green" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', margin: 0 }}>Acctd</Tag>
                  : <Tag color="default" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', margin: 0 }}>Unacctd</Tag>}
              </div>
            )}
          </div>
        );
      }},
    { title: 'Paid To', dataIndex: 'employeeName', width: 130, ellipsis: true,
      render: (v, rec) => rec.__group ? null : <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Receipt', dataIndex: 'receiptStatus', width: 75, align: 'center' as const,
      render: (v, rec) => rec.__group ? null
        : v === 'YES' ? <Tag color="green" style={{ fontSize: 11 }}>YES</Tag>
        : v === 'NO' ? <Tag color="orange" style={{ fontSize: 11 }}>NO</Tag>
        : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
    { title: 'Attachment', dataIndex: 'hasAttachment', width: 100, align: 'center' as const,
      render: (_v: string | null, rec: TxnRow) => {
        if (rec.__group) {
          const total = rec.children!.reduce((s, c) => s + (c.attachmentCount ?? 0), 0);
          return total > 0
            ? <Badge count={total} size="small"><PaperClipOutlined style={{ color: REDWOOD.neutral600 }} /></Badge>
            : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
        }
        const count = rec.attachmentCount ?? 0;
        if (count > 0) {
          return (
            <Badge count={count} size="small" offset={[4, 0]}>
              <Button type="text" size="small"
                icon={<PaperClipOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => openAttachList(rec)}
              />
            </Badge>
          );
        }
        if (rec.hasAttachment === 'Y') {
          return (
            <Tooltip title={rec.attachment || 'View attachment (legacy)'}>
              <Button type="text" size="small"
                icon={<PaperClipOutlined style={{ color: REDWOOD.neutral600 }} />}
                onClick={() => {
                  getTransactionAttachment(rec.transactionId)
                    .then(res => {
                      setViewAttachData(res.attachmentData);
                      setViewAttachName(res.fileName || rec.attachment || 'attachment');
                      setViewAttachOpen(true);
                    })
                    .catch(() => message.error('Failed to load attachment'));
                }}
              />
            </Tooltip>
          );
        }
        return <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text>;
      }},
    { title: 'Created By', dataIndex: 'createdBy', width: 130, ellipsis: true,
      render: (v, rec) => rec.__group ? null : <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '—'}</Text> },
    { title: '', key: 'actions', width: 100, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, txn: TxnRow) => {
        // Group header row — only show reference group button
        if (txn.__group) {
          return (
            <Tooltip title="View / edit reference group">
              <Button type="text" size="small"
                icon={<TagOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => { setRefGroupRef(txn.referenceNo!); refGroupForm.setFieldsValue({ referenceNo: txn.referenceNo! }); setRefGroupOpen(true); }}
              />
            </Tooltip>
          );
        }
        const isPosted  = txn.postingStatus === 'Posted';
        const isLoading = txnActionLoading === txn.transactionId;
        return (
          <Space size={2}>
            {txn.transactionType === 'Balance Refill' ? (
              /* Balance Refill — always show View Accounting regardless of PC posting status */
              <Tooltip title="View accounting entries">
                <Button type="text" size="small"
                  icon={<BookOutlined style={{ color: isPosted ? REDWOOD.success : REDWOOD.neutral300 }} />}
                  onClick={() => openViewAccounting(txn)}
                />
              </Tooltip>
            ) : isPosted ? (
              <Tooltip title="View accounting entries">
                <Button type="text" size="small"
                  icon={<BookOutlined style={{ color: REDWOOD.success }} />}
                  onClick={() => openViewAccounting(txn)}
                />
              </Tooltip>
            ) : null}
            {txn.transactionType === 'Balance Refill' ? (
              /* Balance Refill — always reverse via modal */
              <Tooltip title="Reverse this Add Money entry">
                <Button type="text" size="small"
                  icon={<RollbackOutlined style={{ color: REDWOOD.warning }} />}
                  loading={isLoading}
                  disabled={isClosed}
                  onClick={() => openReverseModal(txn)}
                />
              </Tooltip>
            ) : !isPosted ? (
              <>
                <Tooltip title="Edit transaction">
                  <Button type="text" size="small"
                    icon={<EditOutlined style={{ color: isLoading ? undefined : REDWOOD.info }} />}
                    loading={isLoading}
                    disabled={isClosed}
                    onClick={() => openEditTransaction(txn)}
                  />
                </Tooltip>
                <Tooltip title="Delete transaction">
                  <Button type="text" danger size="small"
                    icon={<DeleteOutlined />}
                    disabled={isClosed || isLoading}
                    onClick={() => handleDeleteTransaction(txn)}
                  />
                </Tooltip>
              </>
            ) : (
              <Tooltip title="Create reversal (posted — cannot edit)">
                <Button type="text" size="small"
                  icon={<RollbackOutlined style={{ color: REDWOOD.warning }} />}
                  loading={isLoading}
                  disabled={isClosed}
                  onClick={() => handleReverseTransaction(txn)}
                />
              </Tooltip>
            )}
            {/* Convert suspense to expense */}
            {txn.expenseType === 'SUSPENSE' && (txn.suspenseAmount || 0) > 0 && !isClosed && (
              <Tooltip title={`Convert suspense to expense (${fmt(txn.suspenseAmount)})`}>
                <Button type="text" size="small"
                  icon={<SwapOutlined style={{ color: '#722ed1' }} />}
                  onClick={() => {
                    setConvertSuspenseRec(txn);
                    convertSuspenseForm.resetFields();
                    const firstCvLine = makeNewLine();
                    firstCvLine.paidTo = txn.employeeName || '';
                    setConvertLines([firstCvLine]);
                    setConvertSuspenseOpen(true);
                  }}
                />
              </Tooltip>
            )}
            {txn.expenseType === 'SUSPENSE' && (txn.suspenseAmount || 0) > 0 && !isClosed && (
              <Tooltip title={`Refund suspense (${fmt(txn.suspenseAmount)})`}>
                <Button type="text" size="small"
                  icon={<RollbackOutlined style={{ color: REDWOOD.success }} />}
                  onClick={() => {
                    setSuspenseRefundRec(txn);
                    suspenseRefundForm.setFieldsValue({
                      transactionDate: dayjs(),
                      amount: txn.suspenseAmount,
                    });
                    setSuspenseRefundOpen(true);
                  }}
                />
              </Tooltip>
            )}
            {/* Print — available on all transaction types */}
            {(() => {
              const siblings = transactions.filter(t => txn.referenceNo && t.referenceNo === txn.referenceNo);
              const hasGroup = siblings.length > 1;
              const printItems = [
                { key: 'single', label: 'Print this transaction', icon: <PrinterOutlined /> },
                ...(hasGroup ? [{ key: 'group', label: `Print reference group (${siblings.length} lines)`, icon: <FilePdfOutlined /> }] : []),
              ];
              return (
                <Dropdown
                  menu={{
                    items: printItems,
                    onClick: ({ key }) => {
                      if (key === 'single') printPCTxnPDF(txn, register);
                      else printRefGroupPDF(txn.referenceNo!, siblings, register);
                    },
                  }}
                  trigger={['click']}
                >
                  <Tooltip title="Print / Download PDF">
                    <Button type="text" size="small" icon={<PrinterOutlined style={{ color: REDWOOD.neutral600 }} />} />
                  </Tooltip>
                </Dropdown>
              );
            })()}
          </Space>
        );
      }},
  ];

  return (
    <>
      {/* ── Header KPIs ── */}
      {(() => {
        const hasLimit = register.limit != null && register.limit > 0;
        const canAdd   = hasLimit ? Math.max(0, register.limit! - register.balance) : null;
        const usedPct  = hasLimit ? Math.min(100, Math.round((register.balance / register.limit!) * 100)) : 0;
        const kpiCard = (
          accent: string,
          label: string,
          value: React.ReactNode,
          sub?: React.ReactNode,
          bg?: string,
          icon?: React.ReactNode,
          onClick?: () => void,
        ) => (
          <div
            onClick={onClick}
            style={{
              background: bg || '#fff',
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
              borderTop: `3px solid ${accent}`,
              padding: '7px 12px 6px',
              position: 'relative',
              overflow: 'hidden',
              height: '100%',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              cursor: onClick ? 'pointer' : undefined,
              transition: onClick ? 'box-shadow 0.15s' : undefined,
            }}
            onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(114,46,209,0.18)'; } : undefined}
            onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; } : undefined}
          >
            {icon && (
              <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 22, color: accent, opacity: 0.10, lineHeight: 1 }}>
                {icon}
              </div>
            )}
            <div style={{ fontSize: 10, fontWeight: 600, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
              {label}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: REDWOOD.neutral900, lineHeight: 1.2 }}>
              {value}
            </div>
            {sub && <div style={{ marginTop: 3 }}>{sub}</div>}
          </div>
        );
        return (
          <>
          <Row gutter={10} style={{ marginBottom: 8 }} align="stretch">
            {/* Balance */}
            <Col span={4}>
              {kpiCard(
                REDWOOD.info,
                'Balance',
                <span>
                  <span style={{ color: register.balance >= 0 ? REDWOOD.success : REDWOOD.error }}>
                    {fmt(register.balance)}
                  </span>
                  {' '}
                  <span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{register.currency}</span>
                </span>,
                hasLimit ? (
                  <div>
                    <Progress
                      percent={usedPct}
                      size={[undefined, 4] as any}
                      strokeColor={usedPct >= 90 ? REDWOOD.warning : REDWOOD.info}
                      trailColor={REDWOOD.neutral200}
                      style={{ marginBottom: 0, lineHeight: 1 }}
                      format={p => <span style={{ fontSize: 10, color: REDWOOD.neutral600 }}>{p}%</span>}
                    />
                    <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>
                      {usedPct}% of {fmt(register.limit!)} limit
                    </div>
                  </div>
                ) : undefined,
                undefined,
                <WalletOutlined />,
              )}
            </Col>

            {/* Balance with Suspense */}
            <Col span={4}>
              {kpiCard(
                '#722ed1',
                'Balance w/ Suspense',
                <span>
                  <span style={{ color: balanceWithSuspense >= 0 ? REDWOOD.success : REDWOOD.error }}>
                    {fmt(balanceWithSuspense)}
                  </span>
                  {' '}
                  <span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{register.currency}</span>
                </span>,
                totalSuspense > 0 ? (
                  <div style={{ fontSize: 10, color: '#722ed1' }}>
                    <QuestionCircleOutlined style={{ marginRight: 3 }} />
                    {fmt(totalSuspense)} in suspense
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: REDWOOD.neutral300 }}>No pending suspense</div>
                ),
                totalSuspense > 0 ? '#f9f0ff' : undefined,
                <QuestionCircleOutlined />,
                totalSuspense > 0 ? () => setSuspenseListOpen(true) : undefined,
              )}
            </Col>

            {/* Can Add */}
            <Col span={3}>
              {hasLimit ? kpiCard(
                canAdd! > 0 ? REDWOOD.success : REDWOOD.neutral300,
                'Available to Add',
                <span>
                  <span style={{ color: canAdd! > 0 ? REDWOOD.success : REDWOOD.neutral300 }}>
                    {fmt(canAdd!)}
                  </span>
                  {' '}
                  <span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{register.currency}</span>
                </span>,
                <div style={{ fontSize: 10, color: REDWOOD.neutral600 }}>
                  {canAdd! > 0
                    ? `${Math.round((canAdd! / register.limit!) * 100)}% free`
                    : 'At limit'}
                </div>,
                canAdd! > 0 ? '#f6ffed' : undefined,
                <DollarOutlined />,
              ) : kpiCard(
                REDWOOD.neutral300, 'Available to Add',
                <span style={{ color: REDWOOD.neutral300, fontSize: 16 }}>No Limit</span>,
                undefined, undefined, <DollarOutlined />,
              )}
            </Col>

            {/* Limit */}
            <Col span={2}>
              {kpiCard(
                REDWOOD.neutral600,
                'Limit',
                hasLimit
                  ? <span>
                      <span style={{ color: REDWOOD.neutral900 }}>{fmt(register.limit!)}</span>
                      {' '}<span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{register.currency}</span>
                    </span>
                  : <span style={{ color: REDWOOD.neutral300, fontSize: 16 }}>—</span>,
                undefined, undefined, <FieldNumberOutlined />,
              )}
            </Col>

            {/* Total In */}
            <Col span={3}>
              {kpiCard(
                REDWOOD.success,
                'Total Money In',
                <span style={{ color: REDWOOD.success }}>
                  {fmt(register.totalDebit)}
                  {' '}<span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{register.currency}</span>
                </span>,
                <div style={{ fontSize: 10, color: REDWOOD.success }}>
                  <ArrowDownOutlined style={{ marginRight: 3 }} />Inflows
                </div>,
                undefined, <ArrowDownOutlined />,
              )}
            </Col>

            {/* Total Out */}
            <Col span={3}>
              {kpiCard(
                REDWOOD.error,
                'Total Money Out',
                <span style={{ color: REDWOOD.error }}>
                  {fmt(register.totalCredit)}
                  {' '}<span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{register.currency}</span>
                </span>,
                <div style={{ fontSize: 10, color: REDWOOD.error }}>
                  <ArrowUpOutlined style={{ marginRight: 3 }} />Outflows
                </div>,
                undefined, <ArrowUpOutlined />,
              )}
            </Col>

            {/* Register Info */}
            <Col span={5}>
              <div style={{
                background: '#fff',
                borderRadius: 8,
                border: `1px solid ${REDWOOD.neutral200}`,
                borderTop: `3px solid #722ed1`,
                padding: '7px 12px 6px',
                height: '100%',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                fontSize: 12,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                  Register Info
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                  <div style={{ display: 'flex' }}>
                    <span style={{ color: REDWOOD.neutral600 }}>Currency</span>
                    <span style={{ fontWeight: 600, marginLeft: 'auto' }}>{register.currency}</span>
                  </div>
                  {register.ownedBy && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ color: REDWOOD.neutral600 }}>Owner</span>
                      <span style={{ marginLeft: 'auto', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{register.ownedBy}</span>
                    </div>
                  )}
                  {register.startDate && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ color: REDWOOD.neutral600 }}>From</span>
                      <span style={{ marginLeft: 'auto' }}>{register.startDate}</span>
                    </div>
                  )}
                  {register.endDate && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ color: REDWOOD.neutral600 }}>To</span>
                      <span style={{ marginLeft: 'auto' }}>{register.endDate}</span>
                    </div>
                  )}
                </div>
              </div>
            </Col>
          </Row>

        {/* Cash Account popover button */}
        {register.cashAccountDesc && (
          <div style={{ marginBottom: 8, marginTop: 2 }}>
            <Popover
              title={<Space size={4}><BankOutlined style={{ color: REDWOOD.info }} /><span>Cash Account</span></Space>}
              content={
                <div style={{ maxWidth: 360 }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                    {register.cashAccountDesc}
                  </div>
                  {cashAccountName && (
                    <div style={{ fontSize: 12, color: REDWOOD.info }}>{cashAccountName}</div>
                  )}
                </div>
              }
              trigger="click"
              placement="bottomLeft"
            >
              <Button
                size="small"
                type="text"
                icon={<BankOutlined style={{ color: REDWOOD.info }} />}
                style={{ fontSize: 12, color: REDWOOD.info, padding: '0 6px' }}
              >
                Cash Account
              </Button>
            </Popover>
          </div>
        )}
          </>
        );
      })()}


      {/* Action buttons */}
      {(() => {
        const q = txnSearch.trim().toLowerCase();
        const filteredTxns = q
          ? transactions.filter(t =>
              (t.referenceNo     ?? '').toLowerCase().includes(q) ||
              (t.transactionType ?? '').toLowerCase().includes(q) ||
              (t.expenseType     ?? '').toLowerCase().includes(q) ||
              (t.comments        ?? '').toLowerCase().includes(q) ||
              (t.employeeName    ?? '').toLowerCase().includes(q) ||
              (t.createdBy       ?? '').toLowerCase().includes(q) ||
              (t.postingStatus   ?? '').toLowerCase().includes(q) ||
              (t.transactionDate ?? '').includes(q) ||
              String(t.lineNumber    ?? '').includes(q) ||
              String(t.debitAmount   ?? '').includes(q) ||
              String(t.creditAmount  ?? '').includes(q)
            )
          : transactions;
      const _content = (<>
      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#fff', border: `1px solid ${REDWOOD.neutral200}`,
        borderRadius: 8, padding: '8px 12px', marginBottom: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        gap: 8,
      }}>
        {/* Left: label + search */}
        <Space size={6} style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral600, whiteSpace: 'nowrap' }}>
            Transactions
            {transactions.length > 0 && (
              <span style={{
                marginLeft: 6, background: REDWOOD.neutral200,
                borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 500,
              }}>{transactions.length}</span>
            )}
          </Text>
          <Input.Search
            size="small"
            allowClear
            placeholder="Search…"
            style={{ width: 200 }}
            value={txnSearch}
            onChange={e => setTxnSearch(e.target.value)}
          />
          {q && (
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600, whiteSpace: 'nowrap' }}>
              {filteredTxns.length}/{transactions.length}
            </Text>
          )}
        </Space>

        {/* Right: actions */}
        <Space size={4} style={{ flexWrap: 'nowrap' }}>
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={tab.txnLoading}>
            Refresh
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => exportRegisterToExcel(register, transactions)}>
            Export Excel
          </Button>
          <Tooltip title={linesFullscreen ? 'Exit full screen' : 'Expand lines to full screen'}>
            <Button
              size="small"
              icon={linesFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => setLinesFullscreen(f => !f)}
            />
          </Tooltip>

          <Divider type="vertical" style={{ margin: '0 2px', height: 20 }} />

          {(() => {
            const postedSelected = transactions.filter(t =>
              selectedRowKeys.includes(t.transactionId) && t.postingStatus === 'Posted'
            );
            const disabled = postedSelected.length === 0;
            return (
              <Tooltip title={disabled ? 'Select one or more posted transactions to view accounting' : undefined}>
                <Button size="small"
                  icon={<BookOutlined />}
                  disabled={disabled}
                  onClick={() => openViewAccounting(postedSelected[0], postedSelected)}
                >
                  View Accounting{postedSelected.length > 1 ? ` (${postedSelected.length})` : ''}
                </Button>
              </Tooltip>
            );
          })()}
          <Tooltip title={selectedRowKeys.length === 0 ? 'Select expense transactions to account' : undefined}>
            <Button size="small"
              icon={<CheckCircleOutlined />}
              disabled={isClosed || selectedRowKeys.length === 0}
              style={!isClosed && selectedRowKeys.length > 0
                ? { background: REDWOOD.info, borderColor: REDWOOD.info, color: '#fff' }
                : {}}
              onClick={() => openCreateAccountingModal()}
            >
              Create Accounting{selectedRowKeys.length > 0 ? ` (${selectedRowKeys.length})` : ''}
            </Button>
          </Tooltip>

          <Divider type="vertical" style={{ margin: '0 2px', height: 20 }} />

          <Tooltip title={isClosed ? 'Register is closed' : undefined}>
            <Button
              icon={<DollarOutlined />}
              style={!isClosed
                ? { background: REDWOOD.success, borderColor: REDWOOD.success, color: '#fff', fontWeight: 600 }
                : {}}
              disabled={isClosed}
              onClick={() => {
                moneyForm.resetFields();
                setMoneyAcctDesc('');
                setLinkedBankTxnRef('');
                setBankTxnPostResponse(null);
                setBankTxnLookupResult(null);
                setBankTxnPayload(null);
                setBankTxnRawError('');
                if (register.cashAccountDesc) {
                  moneyForm.setFieldsValue({ chargeAccountDesc: register.cashAccountDesc });
                  setMoneyAcctDesc(cashAccountName ?? '');
                }
                if (register.limit != null && register.limit > 0) {
                  const canAdd = register.limit - register.balance;
                  if (canAdd <= 0) {
                    message.warning(`Register is already at its limit (${fmt(register.limit)} ${register.currency}). No more money can be added.`);
                    return;
                  }
                  moneyForm.setFieldsValue({ amount: Math.round(canAdd * 100) / 100 });
                }
                setAddMoneyOpen(true);
              }}
            >
              Add Money
            </Button>
          </Tooltip>
          <Tooltip title={noBalance ? 'No available balance to record an expense' : undefined}>
            <Button
              icon={<MinusCircleOutlined />}
              style={!isClosed && !noBalance
                ? { background: REDWOOD.warning, borderColor: REDWOOD.warning, color: '#fff', fontWeight: 600 }
                : {}}
              disabled={isClosed || noBalance}
              onClick={() => { expenseForm.resetFields(); setAddAcctDesc(''); setAddExpenseOpen(true); }}
            >
              Add Expense
            </Button>
          </Tooltip>
          <Tooltip title={isClosed ? 'Register is closed' : 'Record a suspense entry (not debit or credit)'}>
            <Button
              icon={<QuestionCircleOutlined />}
              disabled={isClosed}
              onClick={() => { suspenseForm.resetFields(); setAddSuspenseOpen(true); }}
            >
              Add Suspense
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* Transactions table — grouped by reference */}
      {(() => {
        const seenRefs = new Set<string>();
        let grpIdx = 0;
        const groupedRows: TxnRow[] = [];
        for (const txn of filteredTxns) {
          if (!txn.referenceNo) { groupedRows.push(txn); continue; }
          if (seenRefs.has(txn.referenceNo)) continue;
          seenRefs.add(txn.referenceNo);
          const lines = filteredTxns.filter(t => t.referenceNo === txn.referenceNo);
          if (lines.length === 1) { groupedRows.push(lines[0]); continue; }
          groupedRows.push({
            ...lines[0],
            transactionId: -(++grpIdx),
            __group: true,
            debitAmount:    lines.reduce((s, l) => s + (l.debitAmount    || 0), 0),
            creditAmount:   lines.reduce((s, l) => s + (l.creditAmount   || 0), 0),
            suspenseAmount: lines.reduce((s, l) => s + (l.suspenseAmount || 0), 0),
            children: lines.map(l => ({ ...l, __childOf: txn.referenceNo! })),
          });
        }
        return (
          <Table<TxnRow>
            dataSource={groupedRows}
            columns={txnColumns}
            rowKey={(r) => r.__group ? `grp-${r.referenceNo}` : r.transactionId}
            size="small"
            loading={txnLoading}
            pagination={false}
            scroll={{ x: 1600, y: linesFullscreen ? 'calc(100vh - 120px)' : 'calc(100vh - 420px)' }}
            expandable={{ defaultExpandAllRows: true, indentSize: 16 }}
            locale={{ emptyText: q ? 'No transactions match your search.' : 'No transactions yet — use Add Money or Add Expense to begin.' }}
            rowClassName={(r) => r.__group ? 'pc-row-group' : r.transactionType === 'Balance Refill' ? 'pc-row-refill' : r.__childOf ? 'pc-row-child' : ''}
            rowSelection={{
              type: 'checkbox',
              selectedRowKeys,
              onChange: (keys) => {
                const newKeys  = (keys as Array<string | number>).filter((k): k is number => typeof k === 'number');
                const added    = newKeys.filter(k => !selectedRowKeys.includes(k));
                const removed  = selectedRowKeys.filter(k => !newKeys.includes(k));
                const expanded = new Set(newKeys);
                added.forEach(key => {
                  const ref = transactions.find(t => t.transactionId === key)?.referenceNo;
                  if (ref) transactions.filter(t => t.referenceNo === ref && t.transactionType !== 'Balance Refill').forEach(t => expanded.add(t.transactionId));
                });
                removed.forEach(key => {
                  const ref = transactions.find(t => t.transactionId === key)?.referenceNo;
                  if (ref) transactions.filter(t => t.referenceNo === ref).forEach(t => expanded.delete(t.transactionId));
                });
                setSelectedRowKeys([...expanded]);
              },
              getCheckboxProps: (rec) => ({
                disabled: !!(rec.__group) || rec.transactionType === 'Balance Refill',
              }),
            }}
          />
        );
      })()}
      </>);
      if (linesFullscreen) return (
        <Modal
          open
          footer={null}
          onCancel={() => setLinesFullscreen(false)}
          closeIcon={<FullscreenExitOutlined />}
          title={
            <Space>
              <FullscreenExitOutlined style={{ color: REDWOOD.info }} />
              {register.registerName} — Lines
              {transactions.length > 0 && (
                <span style={{ fontWeight: 400, color: REDWOOD.neutral600, fontSize: 12 }}>
                  ({transactions.length})
                </span>
              )}
            </Space>
          }
          width="calc(100vw - 24px)"
          style={{ top: 4, padding: 0 }}
          styles={{ body: { padding: '8px 12px 4px', height: 'calc(100vh - 88px)', overflow: 'hidden' } }}
          zIndex={900}
          destroyOnClose={false}
        >
          {_content}
        </Modal>
      );
      return _content;
      })()}

      {/* ── Add Money Modal ────────────────────────────────── */}
      <Modal
        title={<Space><DollarOutlined style={{ color: REDWOOD.success }} /> Add Money to Register</Space>}
        open={addMoneyOpen}
        onCancel={() => {
          setAddMoneyOpen(false);
          setFundingSource('bank');
          setRefundCashDesc('');
          if (needsRefresh.current) { needsRefresh.current = false; onRefresh(); }
        }}
        footer={null}
        width={520}
        destroyOnClose
      >
        <Form form={moneyForm} layout="vertical" size="small" onFinish={handleAddMoney}>
          {/* Funding source selector */}
          <Segmented
            block
            options={[
              { label: <Space><BankOutlined />From Bank</Space>,        value: 'bank' },
              { label: <Space><RollbackOutlined />From Refund</Space>,   value: 'refund' },
              { label: <Space><DollarOutlined />Opening Balance</Space>, value: 'opening' },
            ]}
            value={fundingSource}
            onChange={v => {
              setFundingSource(v as 'bank' | 'refund' | 'opening');
              setMoneyAcctDesc('');
              setRefundCashDesc('');
            }}
            style={{ marginBottom: 14 }}
          />
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Transaction Date" name="transactionDate"
                rules={[{ required: true, message: 'Required' }]}
                initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY"
                  onChange={v => { if (v) moneyForm.setFieldsValue({ accountingDate: v }); }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Accounting Date" name="accountingDate" initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="AP Period" shouldUpdate>
                {({ getFieldValue }) => {
                  const d = getFieldValue('accountingDate') ?? getFieldValue('transactionDate');
                  if (!d) return <Input disabled placeholder="Select date" />;
                  if (!periodsLoaded) return <Input disabled placeholder="Loading…" />;
                  const p = findAPPeriod(d);
                  if (p) return <Input disabled value={p.periodName} style={{ color: REDWOOD.success, fontWeight: 600, background: '#f6ffed', borderColor: '#b7eb8f' }} />;
                  if (openPeriods.length === 0) return <Input disabled placeholder="Not synced" style={{ color: REDWOOD.warning }} />;
                  return <Input disabled placeholder="No open period" style={{ color: REDWOOD.error }} />;
                }}
              </Form.Item>
            </Col>
          </Row>
          {register.limit != null && register.limit > 0 && (
            <div style={{ marginBottom: 12, padding: '6px 10px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 12 }}>
              <Space size={16}>
                <span><b>Limit:</b> {fmt(register.limit)} {register.currency}</span>
                <span><b>Balance:</b> {fmt(register.balance)} {register.currency}</span>
                <span style={{ color: REDWOOD.success, fontWeight: 600 }}>
                  <b>Can Add:</b> {fmt(Math.max(0, register.limit - register.balance))} {register.currency}
                </span>
              </Space>
            </div>
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Amount" name="amount"
                rules={[
                  { required: true, message: 'Required' },
                  { type: 'number', min: 0.01, message: 'Must be > 0' },
                  ...(register.limit != null && register.limit > 0 ? [{
                    type: 'number' as const,
                    max: Math.max(0, register.limit - register.balance),
                    message: `Cannot exceed limit — max ${fmt(Math.max(0, register.limit - register.balance))} ${register.currency}`,
                  }] : []),
                ]}>
                <InputNumber style={{ width: '100%' }} precision={2} min={0}
                  max={register.limit != null ? Math.max(0, register.limit - register.balance) : undefined}
                  placeholder="0.00" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Currency" name="currency" initialValue={register.currency}>
                <Select>
                  {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                    <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* ── From Bank: Charge Account + Bank Transaction ── */}
          {fundingSource === 'bank' && (<>
            <Form.Item name="chargeAccountCcid" hidden><Input /></Form.Item>
            <Form.Item label="Charge Account">
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="chargeAccountDesc" noStyle>
                  <Input placeholder="Browse to select account" readOnly />
                </Form.Item>
                <Button icon={<BankOutlined />} onClick={() => {
                  setCoaInitialValue(moneyForm.getFieldValue('chargeAccountDesc') || '');
                  setCoaTarget('money');
                  setCoaOpen(true);
                }}>Browse</Button>
              </Space.Compact>
              {moneyAcctDesc && (
                <div style={{ marginTop: 4, fontSize: 11, color: REDWOOD.info, paddingLeft: 2 }}>{moneyAcctDesc}</div>
              )}
            </Form.Item>

            <Divider style={{ margin: '8px 0', fontSize: 12 }}>Bank Transaction</Divider>
            {linkedBankTxnRef ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space>
                    <BankOutlined style={{ color: REDWOOD.success }} />
                    <span><b>Bank Txn ID:</b> <Text style={{ fontFamily: 'monospace', fontWeight: 700, color: REDWOOD.success, fontSize: 13 }}>{linkedBankTxnRef}</Text></span>
                    <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>(saved to Bank Txn ID column)</Text>
                  </Space>
                  <Tooltip title="Download bank transaction receipt as PDF">
                    <Button size="small" icon={<FilePdfOutlined />} onClick={() => {
                      const bankData = (bankTxnLookupResult?.items || [])[0];
                      if (bankData) printBankTxnPDF(bankData, register.registerName);
                      else message.warning('Bank transaction data not available for printing');
                    }}>Print Receipt</Button>
                  </Tooltip>
                </div>
                <Collapse size="small" ghost>
                  <Collapse.Panel header={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>POST response</Text>} key="post">
                    <pre style={{ fontSize: 10, maxHeight: 160, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
                      {JSON.stringify(bankTxnPostResponse, null, 2)}
                    </pre>
                  </Collapse.Panel>
                  <Collapse.Panel header={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Lookup result (transaction_id source)</Text>} key="lookup">
                    <pre style={{ fontSize: 10, maxHeight: 160, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
                      {JSON.stringify(bankTxnLookupResult, null, 2)}
                    </pre>
                  </Collapse.Panel>
                </Collapse>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <Button icon={<BankOutlined />} onClick={() => setBankTxnModalOpen(true)} style={{ width: '100%', borderStyle: 'dashed' }}>
                  Create Bank Transaction
                </Button>
              </div>
            )}
          </>)}

          {/* ── From Refund: Cash Account + Offset Account ── */}
          {fundingSource === 'refund' && (<>
            <Divider style={{ margin: '8px 0', fontSize: 12 }}>Account Coding</Divider>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="Cash Account" required>
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item name="refundCashAccount" noStyle>
                      <Input readOnly placeholder="Browse to select account" style={{ fontFamily: 'monospace', fontSize: 11 }} />
                    </Form.Item>
                    <Button icon={<BankOutlined />} onClick={() => {
                      setCoaInitialValue(moneyForm.getFieldValue('refundCashAccount') || '');
                      setCoaTarget('refundCash');
                      setCoaOpen(true);
                    }}>Browse</Button>
                  </Space.Compact>
                  {refundCashDesc && (
                    <div style={{ marginTop: 4, fontSize: 11, color: REDWOOD.info }}>{refundCashDesc}</div>
                  )}
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Offset Account (from Register)">
                  <Input
                    value={register.cashAccountDesc || '—'}
                    readOnly
                    style={{ fontFamily: 'monospace', fontSize: 11, background: '#fafafa', color: '#595959' }}
                  />
                  {cashAccountName && (
                    <div style={{ marginTop: 4, fontSize: 11, color: REDWOOD.neutral600 }}>{cashAccountName}</div>
                  )}
                </Form.Item>
              </Col>
            </Row>
          </>)}

          {/* ── Opening Balance ── */}
          {fundingSource === 'opening' && (
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
              <Space size={6}>
                <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                <Text style={{ fontSize: 12, color: '#389e0d' }}>
                  This entry will be recorded as <b>Opening Fund Balance</b> and automatically marked as <b>Posted</b>.
                  No bank transaction required.
                </Text>
              </Space>
            </div>
          )}

          <Form.Item label="Voucher No">
            <Input
              value={addMoneyVoucherNo}
              readOnly
              prefix={<TagOutlined />}
              suffix={voucherNoLoading ? <SyncOutlined spin style={{ fontSize: 11 }} /> : null}
              style={{ fontFamily: 'monospace', color: '#1677ff', fontWeight: 600, background: '#f0f5ff', cursor: 'not-allowed' }}
            />
          </Form.Item>
          <Form.Item label="Comments" name="comments">
            <Input.TextArea rows={2} placeholder="Optional" />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button onClick={() => { setAddMoneyOpen(false); setFundingSource('bank'); setRefundCashDesc(''); }}>Cancel</Button>
            <Tooltip title={fundingSource === 'bank' && !linkedBankTxnRef ? 'Create a bank transaction first' : undefined}>
              <Button type="primary" htmlType="submit" loading={saving}
                disabled={fundingSource === 'bank' && !linkedBankTxnRef}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
                {fundingSource === 'refund' ? 'Record Refund' : fundingSource === 'opening' ? 'Record Opening Balance' : 'Add Money'}
              </Button>
            </Tooltip>
          </div>
        </Form>
      </Modal>

      {/* ── Create Bank Transaction Mini-Modal ────────────────── */}
      <Modal
        title={
          <Space style={{ width: '100%', justifyContent: 'space-between', paddingRight: 32 }}>
            <Space><BankOutlined style={{ color: REDWOOD.info }} /> Create Bank Transaction</Space>
            <Space size={4}>
              <Tooltip title={<><b>GET Bank Accounts</b><br />{BANK_ACCOUNTS_URL}</>} placement="bottomRight">
                <Tag icon={<ApiOutlined />} color="blue" style={{ cursor: 'help', fontSize: 11 }}>Bank Accounts</Tag>
              </Tooltip>
              <Tooltip title={<><b>POST External Transaction</b><br />{EXT_TXN_URL}</>} placement="bottomRight">
                <Tag icon={<ApiOutlined />} color="green" style={{ cursor: 'help', fontSize: 11 }}>Post Txn</Tag>
              </Tooltip>
            </Space>
          </Space>
        }
        open={bankTxnModalOpen}
        onCancel={() => { setBankTxnModalOpen(false); setBankOffsetDesc(''); setBankAssetDesc(''); }}
        footer={null}
        width={620}
        destroyOnClose
        zIndex={1100}
      >
        <Form form={bankTxnForm} layout="vertical" size="small" onFinish={handleCreateBankTxn}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Business Unit" name="businessUnitName" rules={[{ required: true, message: 'Required' }]}>
                <Input
                  placeholder={register.businessUnit}
                  onBlur={e => {
                    const bu = e.target.value.trim();
                    if (bu) loadBankAccountsByBU(bu);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Bank Account" name="bankAccountName" rules={[{ required: true, message: 'Required' }]}>
                <Select
                  showSearch allowClear placeholder="Select bank account"
                  options={bankAccounts.map(b => ({ value: b.name, label: b.name }))}
                  notFoundContent={<Text type="secondary" style={{ fontSize: 12 }}>No bank accounts found</Text>}
                  onChange={val => {
                    const acct = bankAccounts.find(b => b.name === val);
                    if (acct) {
                      bankTxnForm.setFieldsValue({ assetAccountCombination: acct.cashAccount });
                      setBankAssetDesc('');
                      if (acct.cashAccount) {
                        validateAccountCode(acct.cashAccount).then(result => {
                          const seg4 = Object.values(result.segmentDetails)[3];
                          setBankAssetDesc(seg4?.description || '');
                        }).catch(() => {});
                      }
                    }
                  }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber style={{ width: '100%' }} precision={2} placeholder="0.00" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Transaction Date" name="transactionDate" rules={[{ required: true, message: 'Required' }]}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Currency" name="currencyCode">
                <Select>
                  {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                    <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Transaction Type" name="transactionType">
                <Select placeholder="Select type" allowClear>
                  {['EFT','WIRE','CHECK','MISC'].map(t => <Option key={t} value={t}>{t}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Reference" name="referenceText">
                <Input placeholder="e.g. BANK-TXN-001" />
              </Form.Item>
            </Col>
          </Row>
          <Divider style={{ margin: '8px 0', fontSize: 11 }}>Account Coding</Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Cash Account (Asset)">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="assetAccountCombination" noStyle>
                    <Input readOnly placeholder="Select cash/bank account" style={{ fontFamily: 'monospace', fontSize: 11 }} />
                  </Form.Item>
                  <Button icon={<SearchOutlined />} onClick={() => {
                    setCoaInitialValue(bankTxnForm.getFieldValue('assetAccountCombination') || '');
                    setCoaTarget('bankAsset');
                    setCoaOpen(true);
                  }} />
                </Space.Compact>
                {bankAssetDesc && (
                  <div style={{ fontSize: 11, color: REDWOOD.info, marginTop: 2 }}>{bankAssetDesc}</div>
                )}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Offset Account">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="offsetAccountCombination" noStyle>
                    <Input readOnly placeholder="= Charge Account from Add Money" style={{ fontFamily: 'monospace', fontSize: 11 }} />
                  </Form.Item>
                  <Button icon={<SearchOutlined />} onClick={() => {
                    setCoaInitialValue(bankTxnForm.getFieldValue('offsetAccountCombination') || '');
                    setCoaTarget('bankOffset');
                    setCoaOpen(true);
                  }} />
                </Space.Compact>
                {bankOffsetDesc
                  ? <div style={{ fontSize: 11, color: REDWOOD.info, marginTop: 2 }}>{bankOffsetDesc}</div>
                  : <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2 }}>Pre-filled from Charge Account</div>
                }
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional" />
          </Form.Item>

          {/* ── API Inspector ── */}
          <Collapse size="small" style={{ marginBottom: 8 }}>
            <Collapse.Panel
              header={
                <Space size={4}>
                  <ApiOutlined style={{ color: REDWOOD.info }} />
                  <Text style={{ fontSize: 11 }}>API Inspector</Text>
                  <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>
                    POST {EXT_TXN_URL}
                  </Text>
                  {bankTxnRawError && <Tag color="error" style={{ fontSize: 10 }}>Error</Tag>}
                  {bankTxnPostResponse?.status === 'success' && <Tag color="success" style={{ fontSize: 10 }}>Success</Tag>}
                </Space>
              }
              key="api"
            >
              <Text style={{ fontSize: 10, color: REDWOOD.neutral600, display: 'block', marginBottom: 4 }}>
                <b>Endpoint:</b> <Text code copyable style={{ fontSize: 10 }}>{EXT_TXN_URL}</Text>
              </Text>
              <Collapse size="small" ghost defaultActiveKey={['payload']}>
                <Collapse.Panel header={<Text style={{ fontSize: 11 }}>Request Payload (JSON)</Text>} key="payload">
                  <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#f0f5ff', padding: 8, borderRadius: 4, margin: 0, border: '1px solid #adc6ff' }}>
                    {bankTxnPayload ? JSON.stringify(bankTxnPayload, null, 2) : '— submit form to see payload —'}
                  </pre>
                </Collapse.Panel>
                {bankTxnPostResponse && (
                  <Collapse.Panel header={<Text style={{ fontSize: 11 }}>Response</Text>} key="response">
                    <pre style={{ fontSize: 10, maxHeight: 160, overflow: 'auto', background: bankTxnPostResponse?.status === 'success' ? '#f6ffed' : '#fff2f0', padding: 8, borderRadius: 4, margin: 0, border: `1px solid ${bankTxnPostResponse?.status === 'success' ? '#b7eb8f' : '#ffccc7'}` }}>
                      {JSON.stringify(bankTxnPostResponse, null, 2)}
                    </pre>
                  </Collapse.Panel>
                )}
                {bankTxnRawError && (
                  <Collapse.Panel header={<Text style={{ fontSize: 11, color: REDWOOD.error }}>Raw Error</Text>} key="rawerr">
                    <pre style={{ fontSize: 10, maxHeight: 120, overflow: 'auto', background: '#fff2f0', padding: 8, borderRadius: 4, margin: 0, border: '1px solid #ffccc7', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {bankTxnRawError}
                    </pre>
                  </Collapse.Panel>
                )}
              </Collapse>
            </Collapse.Panel>
          </Collapse>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button onClick={() => setBankTxnModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={bankTxnSaving}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
              Create Bank Transaction
            </Button>
          </div>
        </Form>
      </Modal>

      {/* ── Add Expense Modal ──────────────────────────────── */}
      <Modal
        title={
          <Space>
            <MinusCircleOutlined style={{ color: REDWOOD.warning }} />
            Add Expense
            {addExpenseFromRefGroup && (
              <Tag color="blue" style={{ fontSize: 11, fontFamily: 'monospace' }}>{addExpenseVoucherNo}</Tag>
            )}
            {!addExpenseFromRefGroup && (
              <Switch
                size="small"
                checkedChildren="Multiple Lines"
                unCheckedChildren="Single Line"
                checked={expenseMode === 'multi'}
                onChange={v => {
                  setExpenseMode(v ? 'multi' : 'single');
                  setExpenseLines([makeNewLine()]);
                }}
              />
            )}
          </Space>
        }
        open={addExpenseOpen}
        onCancel={() => {
          setAddExpenseOpen(false);
          setAddExpenseFromRefGroup(false);
          setExpenseMode('single');
          setExpenseLines([makeNewLine()]);
          if (needsRefresh.current) { needsRefresh.current = false; onRefresh(); }
        }}
        footer={null}
        width={expenseMode === 'multi' ? 960 : 580}
        destroyOnClose
      >
        {/* ── Shared header form (used by both modes) ── */}
        <Form form={expenseForm} layout="vertical" size="small" onFinish={handleAddExpense}>
          <Row gutter={12}>
            <Col span={expenseMode === 'multi' ? 5 : 8}>
              <Form.Item label="Transaction Date" name="transactionDate"
                rules={[{ required: true, message: 'Required' }]}
                initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY"
                  onChange={v => { if (v) expenseForm.setFieldsValue({ accountingDate: v }); }} />
              </Form.Item>
            </Col>
            <Col span={expenseMode === 'multi' ? 5 : 8}>
              <Form.Item label="Accounting Date" name="accountingDate" initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={expenseMode === 'multi' ? 4 : 8}>
              <Form.Item label="AP Period" shouldUpdate>
                {({ getFieldValue }) => {
                  const d = getFieldValue('accountingDate') ?? getFieldValue('transactionDate');
                  if (!d) return <Input disabled placeholder="Select date" />;
                  if (!periodsLoaded) return <Input disabled placeholder="Loading…" />;
                  const p = findAPPeriod(d);
                  if (p) return <Input disabled value={p.periodName} style={{ color: REDWOOD.success, fontWeight: 600, background: '#f6ffed', borderColor: '#b7eb8f' }} />;
                  if (openPeriods.length === 0) return <Input disabled placeholder="Not synced" style={{ color: REDWOOD.warning }} />;
                  return <Input disabled placeholder="No open period" style={{ color: REDWOOD.error }} />;
                }}
              </Form.Item>
            </Col>
            <Col span={expenseMode === 'multi' ? 5 : 12}>
              <Form.Item label="Currency" name="currency" initialValue={register.currency}>
                <Select>
                  {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                    <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={expenseMode === 'multi' ? 5 : 12}>
              <Form.Item label="Voucher No">
                <Input
                  value={addExpenseVoucherNo}
                  readOnly
                  prefix={<TagOutlined />}
                  suffix={voucherNoLoading ? <SyncOutlined spin style={{ fontSize: 11 }} /> : null}
                  style={{ fontFamily: 'monospace', color: '#1677ff', fontWeight: 600, background: '#f0f5ff', cursor: 'not-allowed' }}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* ── SINGLE LINE MODE ── */}
          {expenseMode === 'single' && (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Expense Type" name="expenseType"
                    rules={[{ required: true, message: 'Required' }]}>
                    <Select
                      placeholder="Select expense type"
                      showSearch
                      filterOption={(input, option) =>
                        String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      onChange={(val) => {
                        const dist = distCombinations.find(d => d.combinationName === val);
                        expenseForm.setFieldsValue({
                          chargeAccountDesc: dist?.glAccountDesc ?? '',
                          chargeAccountCcid: dist?.glAccountCcid ?? null,
                        });
                        setAddAcctDesc(dist?.description ?? dist?.combinationName ?? '');
                      }}
                      options={distCombinations.map(d => ({
                        value: d.combinationName,
                        label: d.combinationName,
                      }))}
                      notFoundContent={
                        distCombinations.length === 0
                          ? <span style={{ fontSize: 12, color: REDWOOD.neutral600 }}>No combinations found</span>
                          : 'No match'
                      }
                      dropdownRender={menu => (
                        <>
                          {menu}
                          <Divider style={{ margin: '4px 0' }} />
                          <div
                            style={{ padding: '4px 8px', cursor: 'pointer', color: REDWOOD.info, fontSize: 12 }}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { newDistForm.resetFields(); newDistForm.setFieldsValue({ businessUnit: register.businessUnit || undefined }); setNewDistOpen(true); }}
                          >
                            <PlusOutlined /> Add New Expense Type
                          </div>
                        </>
                      )}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Amount" name="amount"
                    rules={[{ required: true, message: 'Required' }, { type: 'number', min: 0.01, message: 'Must be > 0' }]}>
                    <InputNumber style={{ width: '100%' }} precision={2} min={0} placeholder="0.00" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="chargeAccountCcid" hidden><Input /></Form.Item>
              <Form.Item label="Charge Account">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="chargeAccountDesc" noStyle>
                    <Input placeholder="Select via Browse" readOnly style={{ cursor: 'not-allowed', background: '#fafafa' }} />
                  </Form.Item>
                  <Button icon={<BankOutlined />} onClick={() => {
                    setCoaInitialValue(expenseForm.getFieldValue('chargeAccountDesc') || '');
                    setCoaTarget('add');
                    setCoaOpen(true);
                  }}>Browse</Button>
                </Space.Compact>
                {addAcctDesc && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#1677ff', paddingLeft: 2 }}>
                    {addAcctDesc}
                  </div>
                )}
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Paid To" name="employeeName">
                    <Input prefix={<UserOutlined />} placeholder="Optional" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Receipt Status" name="receiptStatus">
                    <Select allowClear placeholder="Select">
                      <Option value="YES">YES</Option>
                      <Option value="NO">NO</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Comments" name="comments">
                <Input.TextArea rows={2} placeholder="Optional" />
              </Form.Item>
              <Form.Item label="Reference Description" name="referenceDescription"
                help={<span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Used as GL Cr line description when posting</span>}>
                <Input.TextArea rows={2} placeholder="Purpose or summary of this expense reference (optional)" />
              </Form.Item>
              <Form.Item label="Attachments">
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  <Upload
                    multiple
                    beforeUpload={async (file) => {
                      try {
                        const entry = await readFileAsEntry(file);
                        setAddExpenseFiles(prev => [...prev, entry]);
                      } catch { message.error(`Failed to read ${file.name}`); }
                      return false;
                    }}
                    showUploadList={false}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  >
                    <Button icon={<UploadOutlined />}>Upload Files</Button>
                  </Upload>
                  {addExpenseFiles.map(f => (
                    <Space key={f.uid} size={4} style={{ display: 'flex' }}>
                      <PaperClipOutlined style={{ color: REDWOOD.info }} />
                      <Text style={{ fontSize: 12, color: REDWOOD.info }}>{f.name}</Text>
                      <Button type="text" size="small" danger icon={<CloseOutlined />}
                        onClick={() => setAddExpenseFiles(prev => prev.filter(x => x.uid !== f.uid))} />
                    </Space>
                  ))}
                </Space>
              </Form.Item>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <Button onClick={() => { setAddExpenseOpen(false); setAddExpenseFiles([]); }}>Cancel</Button>
                <Button type="primary" htmlType="submit" loading={saving}
                  style={{ background: REDWOOD.warning, borderColor: REDWOOD.warning }}>
                  Save Expense
                </Button>
              </div>
            </>
          )}

          {/* ── MULTIPLE LINES MODE ── */}
          {expenseMode === 'multi' && (
            <>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 110px 1fr 1fr 1fr 36px',
                gap: 6,
                padding: '4px 0',
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
                marginBottom: 4,
              }}>
                {['S.No', 'Expense Type', 'Amount', 'Paid To', 'Description', 'Account', ''].map((h, i) => (
                  <div key={i} style={{ fontSize: 11, fontWeight: 600, color: REDWOOD.neutral600, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
                ))}
              </div>

              {/* Lines */}
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {expenseLines.map((line, idx) => (
                  <div key={line.key} style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr 110px 1fr 1fr 1fr 36px',
                    gap: 6,
                    marginBottom: 6,
                    alignItems: 'start',
                  }}>
                    {/* S.No */}
                    <div style={{ textAlign: 'center', paddingTop: 6, fontSize: 12, color: REDWOOD.neutral600 }}>{idx + 1}</div>

                    {/* Expense Type */}
                    <Select
                      size="small"
                      placeholder="Expense type"
                      showSearch
                      value={line.expenseType || undefined}
                      filterOption={(input, option) =>
                        String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      onChange={(val) => {
                        const dist = distCombinations.find(d => d.combinationName === val);
                        updateLine(line.key, {
                          expenseType:       val,
                          chargeAccountDesc: dist?.glAccountDesc ?? '',
                          chargeAccountCcid: dist?.glAccountCcid ?? null,
                          acctDesc:          dist?.description ?? dist?.combinationName ?? '',
                        });
                      }}
                      options={distCombinations.map(d => ({ value: d.combinationName, label: d.combinationName }))}
                      style={{ width: '100%' }}
                      dropdownRender={menu => (
                        <>
                          {menu}
                          <Divider style={{ margin: '4px 0' }} />
                          <div
                            style={{ padding: '4px 8px', cursor: 'pointer', color: REDWOOD.info, fontSize: 12 }}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { newDistForm.resetFields(); newDistForm.setFieldsValue({ businessUnit: register.businessUnit || undefined }); setNewDistOpen(true); }}
                          >
                            <PlusOutlined /> Add New Expense Type
                          </div>
                        </>
                      )}
                    />

                    {/* Amount */}
                    <InputNumber
                      size="small"
                      style={{ width: '100%' }}
                      precision={2}
                      min={0}
                      placeholder="0.00"
                      value={line.amount ?? undefined}
                      onChange={v => updateLine(line.key, { amount: v as number | null })}
                    />

                    {/* Paid To */}
                    <Input
                      size="small"
                      placeholder="Paid to"
                      value={line.paidTo}
                      onChange={e => updateLine(line.key, { paidTo: e.target.value })}
                    />

                    {/* Description */}
                    <Input
                      size="small"
                      placeholder="Description"
                      value={line.description}
                      onChange={e => updateLine(line.key, { description: e.target.value })}
                    />

                    {/* Account (code + desc stacked) */}
                    <div>
                      <Space.Compact size="small" style={{ width: '100%' }}>
                        <Input
                          size="small"
                          placeholder="Auto-filled"
                          value={line.chargeAccountDesc}
                          onChange={e => updateLine(line.key, { chargeAccountDesc: e.target.value })}
                          style={{ width: 'calc(100% - 28px)' }}
                        />
                        <Tooltip title="Browse accounts">
                          <Button
                            size="small"
                            icon={<SearchOutlined />}
                            onClick={() => {
                              setCoaMultiLineKey(line.key);
                              setCoaInitialValue(line.chargeAccountDesc || '');
                              setCoaTarget('multiLine');
                              setCoaOpen(true);
                            }}
                          />
                        </Tooltip>
                      </Space.Compact>
                      {line.acctDesc && (
                        <div style={{ fontSize: 10, color: '#1677ff', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {line.acctDesc}
                        </div>
                      )}
                    </div>

                    {/* Delete */}
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<CloseOutlined />}
                      disabled={expenseLines.length === 1}
                      onClick={() => setExpenseLines(prev => prev.filter(l => l.key !== line.key))}
                    />
                  </div>
                ))}
              </div>

              {/* Add Line + Total */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <Button size="small" icon={<PlusOutlined />} onClick={() => setExpenseLines(prev => {
                  const last = prev[prev.length - 1];
                  const newLine = makeNewLine();
                  if (last?.paidTo) newLine.paidTo = last.paidTo;
                  return [...prev, newLine];
                })}>Add Line</Button>
                <Space>
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                    Total:
                  </Text>
                  <Text strong style={{ fontSize: 13, color: REDWOOD.error }}>
                    {fmt(expenseLines.reduce((s, l) => s + (l.amount ?? 0), 0))} {register.currency}
                  </Text>
                  <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                    / Balance: {fmt(register.balance)}
                  </Text>
                </Space>
              </div>

              <Divider style={{ margin: '10px 0' }} />

              {/* Reference Description — shared for all lines in this voucher */}
              <Form.Item label="Reference Description" name="referenceDescription"
                style={{ marginBottom: 10 }}
                help={<span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Used as GL Cr line description when posting (applies to all lines in this voucher)</span>}>
                <Input placeholder="Purpose or summary of this reference (optional)" />
              </Form.Item>

              {/* Shared attachments for multi-line voucher */}
              <div style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Attachments (shared for this voucher):</Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <Upload
                    multiple
                    beforeUpload={async (file) => {
                      try {
                        const entry = await readFileAsEntry(file);
                        setAddExpenseFiles(prev => [...prev, entry]);
                      } catch { message.error(`Failed to read ${file.name}`); }
                      return false;
                    }}
                    showUploadList={false}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  >
                    <Button size="small" icon={<UploadOutlined />}>Upload Files</Button>
                  </Upload>
                  {addExpenseFiles.map(f => (
                    <Space key={f.uid} size={4}>
                      <PaperClipOutlined style={{ color: REDWOOD.info, fontSize: 12 }} />
                      <Text style={{ fontSize: 12, color: REDWOOD.info }}>{f.name}</Text>
                      <Button type="text" size="small" danger icon={<CloseOutlined />}
                        onClick={() => setAddExpenseFiles(prev => prev.filter(x => x.uid !== f.uid))} />
                    </Space>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={() => { setAddExpenseOpen(false); setExpenseMode('single'); setExpenseLines([makeNewLine()]); setAddExpenseFiles([]); }}>Cancel</Button>
                <Button
                  type="primary"
                  loading={saving}
                  style={{ background: REDWOOD.warning, borderColor: REDWOOD.warning }}
                  onClick={handleAddMultiExpense}
                >
                  Add Expense ({expenseLines.filter(l => l.expenseType && (l.amount ?? 0) > 0).length})
                </Button>
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* ── Add Suspense Modal ─────────────────────────────── */}
      <Modal
        title={
          <Space>
            <QuestionCircleOutlined style={{ color: '#722ed1' }} />
            Add Suspense
          </Space>
        }
        open={addSuspenseOpen}
        onCancel={() => { setAddSuspenseOpen(false); suspenseForm.resetFields(); }}
        footer={null}
        width={520}
        destroyOnClose
      >
        <Form form={suspenseForm} layout="vertical" size="small" onFinish={handleAddSuspense}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Transaction Date" name="transactionDate"
                rules={[{ required: true, message: 'Required' }]}
                initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY"
                  onChange={v => { if (v) suspenseForm.setFieldsValue({ accountingDate: v }); }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Accounting Date" name="accountingDate" initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Voucher No">
                <Input
                  value={addSuspenseVoucherNo}
                  readOnly
                  prefix={<TagOutlined />}
                  suffix={voucherNoLoading ? <SyncOutlined spin style={{ fontSize: 11 }} /> : null}
                  style={{ fontFamily: 'monospace', color: '#722ed1', fontWeight: 600, background: '#f9f0ff', cursor: 'not-allowed' }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Expense Type" name="expenseType" initialValue="SUSPENSE">
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Amount" name="amount"
                rules={[{ required: true, message: 'Required' }, { type: 'number', min: 0.01, message: 'Must be > 0' }]}>
                <InputNumber style={{ width: '100%' }} precision={2} min={0} placeholder="0.00" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Paid To" name="employeeName">
            <Input prefix={<UserOutlined />} placeholder="Optional" />
          </Form.Item>
          <Form.Item label="Comments" name="comments">
            <Input.TextArea rows={2} placeholder="Optional" />
          </Form.Item>
          <Form.Item label="Reference Description" name="referenceDescription"
            help={<span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Used as GL Cr line description when posting</span>}>
            <Input.TextArea rows={2} placeholder="Purpose or summary (optional)" />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button onClick={() => { setAddSuspenseOpen(false); suspenseForm.resetFields(); }}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saving}
              style={{ background: '#722ed1', borderColor: '#722ed1' }}>
              Save Suspense
            </Button>
          </div>
        </Form>
      </Modal>

      {/* ── Convert Suspense to Expense Modal ─────────────── */}
      <Modal
        title={
          <Space>
            <SwapOutlined style={{ color: '#722ed1' }} />
            Convert Suspense to Expense
          </Space>
        }
        open={convertSuspenseOpen}
        onCancel={() => { setConvertSuspenseOpen(false); setConvertSuspenseRec(null); convertSuspenseForm.resetFields(); setConvertLines([makeNewLine()]); }}
        footer={null}
        width={860}
        destroyOnClose
      >
        {convertSuspenseRec && (
          <Form form={convertSuspenseForm} layout="vertical" size="small" onFinish={handleConvertSuspense}>
            {/* Suspense summary header */}
            <div style={{ background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 6, padding: '8px 12px', marginBottom: 14, display: 'flex', gap: 24, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: '#722ed1', fontWeight: 600, marginBottom: 2 }}>Suspense Amount</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#722ed1' }}>
                  {fmt(convertSuspenseRec.suspenseAmount)} <span style={{ fontSize: 13, fontWeight: 400 }}>{convertSuspenseRec.currency}</span>
                </div>
              </div>
              {convertSuspenseRec.employeeName && (
                <div>
                  <div style={{ fontSize: 11, color: '#722ed1', fontWeight: 600, marginBottom: 2 }}>Paid To</div>
                  <div style={{ fontSize: 13 }}>{convertSuspenseRec.employeeName}</div>
                </div>
              )}
              {convertSuspenseRec.comments && (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#722ed1', fontWeight: 600, marginBottom: 2 }}>Comments</div>
                  <div style={{ fontSize: 12, color: '#595959' }}>{convertSuspenseRec.comments}</div>
                </div>
              )}
            </div>

            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 110px 130px 1fr 1fr 36px', gap: 6, padding: '4px 0', borderBottom: `1px solid ${REDWOOD.neutral200}`, marginBottom: 4 }}>
              {['#', 'Expense Type', 'Amount', 'Paid To', 'Description', 'Account', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 600, color: REDWOOD.neutral600, textAlign: i === 0 ? 'center' : 'left' }}>{h}</div>
              ))}
            </div>

            {/* Lines */}
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 8 }}>
              {convertLines.map((line, idx) => (
                <div key={line.key} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 110px 130px 1fr 1fr 36px', gap: 6, marginBottom: 6, alignItems: 'start' }}>
                  <div style={{ textAlign: 'center', paddingTop: 6, fontSize: 12, color: REDWOOD.neutral600 }}>{idx + 1}</div>
                  <Select
                    size="small" placeholder="Expense type" showSearch
                    value={line.expenseType || undefined}
                    filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                    onChange={(val) => {
                      const dist = distCombinations.find(d => d.combinationName === val);
                      updateConvertLine(line.key, {
                        expenseType:       val,
                        chargeAccountDesc: dist?.glAccountDesc ?? '',
                        chargeAccountCcid: dist?.glAccountCcid ?? null,
                        acctDesc:          dist?.description ?? dist?.combinationName ?? '',
                      });
                    }}
                    options={distCombinations.map(d => ({ value: d.combinationName, label: d.combinationName }))}
                    dropdownRender={menu => (
                      <>
                        {menu}
                        <Divider style={{ margin: '4px 0' }} />
                        <div
                          style={{ padding: '4px 8px', cursor: 'pointer', color: REDWOOD.info, fontSize: 12 }}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { newDistForm.resetFields(); newDistForm.setFieldsValue({ businessUnit: register.businessUnit || undefined }); setNewDistOpen(true); }}
                        >
                          <PlusOutlined /> Add New Expense Type
                        </div>
                      </>
                    )}
                  />
                  <InputNumber size="small" style={{ width: '100%' }} precision={2} min={0} placeholder="0.00"
                    value={line.amount ?? undefined}
                    onChange={v => updateConvertLine(line.key, { amount: v as number | null })}
                  />
                  <Input size="small" placeholder="Paid to" value={line.paidTo}
                    onChange={e => updateConvertLine(line.key, { paidTo: e.target.value })}
                  />
                  <Input size="small" placeholder="Description" value={line.description}
                    onChange={e => updateConvertLine(line.key, { description: e.target.value })}
                  />
                  <div>
                    <Space.Compact size="small" style={{ width: '100%' }}>
                      <Input size="small" placeholder="Auto-filled" value={line.chargeAccountDesc}
                        onChange={e => updateConvertLine(line.key, { chargeAccountDesc: e.target.value })}
                        style={{ width: 'calc(100% - 28px)' }}
                      />
                      <Tooltip title="Browse accounts">
                        <Button size="small" icon={<SearchOutlined />}
                          onClick={() => { setCoaConvertLineKey(line.key); setCoaInitialValue(line.chargeAccountDesc || ''); setCoaTarget('convertLine'); setCoaOpen(true); }}
                        />
                      </Tooltip>
                    </Space.Compact>
                    {line.acctDesc && (
                      <div style={{ fontSize: 10, color: '#1677ff', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.acctDesc}</div>
                    )}
                  </div>
                  <Button size="small" danger type="text" icon={<MinusCircleOutlined />}
                    disabled={convertLines.length === 1}
                    onClick={() => setConvertLines(prev => prev.filter(l => l.key !== line.key))}
                  />
                </div>
              ))}
            </div>

            {/* Add row + totals */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Button size="small" type="dashed" icon={<PlusOutlined />}
                onClick={() => setConvertLines(prev => [...prev, makeNewLine()])}
                style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>
                Add Line
              </Button>
              <div style={{ fontSize: 12, display: 'flex', gap: 16 }}>
                {(() => {
                  const total = convertLines.reduce((s, l) => s + (l.amount ?? 0), 0);
                  const remaining = (convertSuspenseRec.suspenseAmount || 0) - total;
                  return (
                    <>
                      <span>Total: <b>{fmt(total)} {convertSuspenseRec.currency}</b></span>
                      {remaining > 0 && (
                        <span style={{ color: REDWOOD.warning }}>
                          <ExclamationCircleOutlined style={{ marginRight: 4 }} />
                          {fmt(remaining)} will remain in suspense
                        </span>
                      )}
                      {remaining < 0 && (
                        <span style={{ color: REDWOOD.info }}>
                          <ExclamationCircleOutlined style={{ marginRight: 4 }} />
                          {fmt(Math.abs(remaining))} over suspense (allowed)
                        </span>
                      )}
                      {remaining === 0 && total > 0 && (
                        <span style={{ color: REDWOOD.success }}>Fully converted</span>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            <Form.Item label="Reason (appended to suspense comments)" name="reason">
              <Input.TextArea rows={2} placeholder="Optional — will be prepended to suspense comments" />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => { setConvertSuspenseOpen(false); convertSuspenseForm.resetFields(); setConvertLines([makeNewLine()]); }}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={saving}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}>
                Convert to Expense
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      {/* ── Suspense Refund Modal ──────────────────────────── */}
      <Modal
        title={<Space><RollbackOutlined style={{ color: REDWOOD.success }} />Suspense Refund</Space>}
        open={suspenseRefundOpen}
        onCancel={() => { setSuspenseRefundOpen(false); setSuspenseRefundRec(null); suspenseRefundForm.resetFields(); }}
        footer={null}
        width={520}
        destroyOnClose
      >
        {suspenseRefundRec && (
          <Form form={suspenseRefundForm} layout="vertical" size="small" onFinish={handleSuspenseRefund}>
            {/* Info row */}
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '8px 12px', marginBottom: 16, display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: '#595959' }}>Suspense Balance</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#722ed1' }}>
                  {fmt(suspenseRefundRec.suspenseAmount)} <span style={{ fontSize: 13, fontWeight: 400 }}>{suspenseRefundRec.currency}</span>
                </div>
              </div>
              {suspenseRefundRec.employeeName && (
                <div>
                  <div style={{ fontSize: 11, color: '#595959' }}>Paid To</div>
                  <div style={{ fontSize: 13 }}>{suspenseRefundRec.employeeName}</div>
                </div>
              )}
              {suspenseRefundRec.referenceNo && (
                <div>
                  <div style={{ fontSize: 11, color: '#595959' }}>Reference</div>
                  <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{suspenseRefundRec.referenceNo}</div>
                </div>
              )}
            </div>

            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="Refund Date" name="transactionDate" rules={[{ required: true, message: 'Required' }]}>
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="Refund Amount"
                  name="amount"
                  rules={[{ validator: (_, v) => v !== undefined && v !== null ? Promise.resolve() : Promise.reject('Required') }]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    max={suspenseRefundRec.suspenseAmount || undefined}
                    precision={2}
                    placeholder="0.00"
                    addonBefore={
                      <Tooltip title="Editable — you can change or set to 0">
                        <EditOutlined style={{ color: REDWOOD.info }} />
                      </Tooltip>
                    }
                    addonAfter={suspenseRefundRec.currency}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item label="Comments" name="comments">
              <Input.TextArea rows={2} placeholder="Optional notes about this refund" />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button onClick={() => { setSuspenseRefundOpen(false); setSuspenseRefundRec(null); suspenseRefundForm.resetFields(); }}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={saving} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
                Record Refund
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      {/* ── Suspense List Modal ───────────────────────────────── */}
      {(() => {
        const suspenseTxns = transactions.filter(t => t.expenseType === 'SUSPENSE' && (t.suspenseAmount || 0) > 0);
        const total = suspenseTxns.reduce((s, t) => s + (t.suspenseAmount || 0), 0);
        return (
          <Modal
            title={<Space><QuestionCircleOutlined style={{ color: '#722ed1' }} />Pending Suspense Transactions</Space>}
            open={suspenseListOpen}
            onCancel={() => setSuspenseListOpen(false)}
            footer={null}
            width={900}
            destroyOnClose
          >
            <Table<PCTransaction>
              size="small"
              pagination={false}
              rowKey="transactionId"
              dataSource={suspenseTxns}
              scroll={{ x: 860 }}
              columns={[
                { title: 'Date', dataIndex: 'transactionDate', width: 100,
                  render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Reference', dataIndex: 'referenceNo', width: 120,
                  render: (v) => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', color: '#722ed1' }}>{v}</Text> : '—' },
                { title: 'Paid To', dataIndex: 'employeeName', width: 140, ellipsis: true,
                  render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                { title: 'Orig. Suspense', dataIndex: 'originalSuspenseAmount', width: 110, align: 'right' as const,
                  render: (v) => v != null ? <Text style={{ fontSize: 12, color: '#722ed1' }}>{fmt(v)}</Text> : <Text style={{ color: REDWOOD.neutral300 }}>—</Text> },
                { title: 'Balance', dataIndex: 'suspenseAmount', width: 110, align: 'right' as const,
                  render: (v) => <Text style={{ fontSize: 12, fontWeight: 600, color: '#722ed1' }}>{fmt(v)}</Text> },
                { title: 'Comments', dataIndex: 'comments', width: 220,
                  render: (v) => <span style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '—'}</span> },
                ...(!isClosed ? [{
                  title: '',
                  key: 'actions',
                  width: 90,
                  align: 'center' as const,
                  render: (_: any, row: PCTransaction) => (
                    <Space size={4}>
                      <Tooltip title={`Convert to expense (${fmt(row.suspenseAmount)})`}>
                        <Button type="text" size="small"
                          icon={<SwapOutlined style={{ color: '#722ed1' }} />}
                          onClick={() => {
                            setSuspenseListOpen(false);
                            setConvertSuspenseRec(row);
                            convertSuspenseForm.resetFields();
                            const firstLine = makeNewLine();
                            firstLine.paidTo = row.employeeName || '';
                            setConvertLines([firstLine]);
                            setConvertSuspenseOpen(true);
                          }}
                        />
                      </Tooltip>
                      <Tooltip title={`Refund (${fmt(row.suspenseAmount)})`}>
                        <Button type="text" size="small"
                          icon={<RollbackOutlined style={{ color: REDWOOD.success }} />}
                          onClick={() => {
                            setSuspenseListOpen(false);
                            setSuspenseRefundRec(row);
                            suspenseRefundForm.setFieldsValue({ transactionDate: dayjs(), amount: row.suspenseAmount });
                            setSuspenseRefundOpen(true);
                          }}
                        />
                      </Tooltip>
                    </Space>
                  ),
                }] : []),
              ]}
              summary={() => (
                <Table.Summary.Row style={{ background: '#f9f0ff' }}>
                  <Table.Summary.Cell index={0} colSpan={3}>
                    <Text strong style={{ fontSize: 12 }}>Total ({suspenseTxns.length} transactions)</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <Text strong style={{ fontSize: 12, color: '#722ed1' }}>{fmt(total)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} colSpan={2} />
                </Table.Summary.Row>
              )}
            />
          </Modal>
        );
      })()}

      {/* ── Edit Transaction Modal ─────────────────────────── */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: REDWOOD.info }} />
            {editTxn && (
              <>
                Edit Line #{editTxn.lineNumber}
                <Tag color={editTxn.transactionType === 'Balance Refill' ? 'blue' : editTxn.transactionType === 'Balance Refund' ? 'green' : editTxn.transactionType === 'Opening Fund Balance' ? 'gold' : editTxn.transactionType === 'Expense' ? 'orange' : 'purple'} style={{ fontSize: 11 }}>
                  {editTxn.transactionType}
                </Tag>
              </>
            )}
          </Space>
        }
        open={editTxnOpen}
        onCancel={() => { setEditTxnOpen(false); setEditTxn(null); editTxnForm.resetFields(); }}
        footer={null}
        width={580}
        zIndex={1060}
      >
        {editTxn && (
          <Form form={editTxnForm} layout="vertical" size="small" onFinish={handleSaveEditTransaction}>
            {editTxn.bankTxnId && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12, fontSize: 12 }}
                message={
                  <span>
                    This transaction is linked to bank transaction <b>#{editTxn.bankTxnId}</b>.
                    Editing fields here does <b>not</b> update the bank system — use <b>Reverse</b> if the amount needs to change.
                  </span>
                }
              />
            )}
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item label="Transaction Date" name="transactionDate"
                  rules={[{ required: true, message: 'Required' }]}>
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Accounting Date" name="accountingDate">
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="Defaults to Txn Date" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="AP Period" shouldUpdate>
                  {({ getFieldValue }) => {
                    const d = getFieldValue('accountingDate') ?? getFieldValue('transactionDate');
                    if (!d) return <Input disabled placeholder="Select date" />;
                    if (!periodsLoaded) return <Input disabled placeholder="Loading…" />;
                    const p = findAPPeriod(d);
                    if (p) return <Input disabled value={p.periodName} style={{ color: REDWOOD.success, fontWeight: 600, background: '#f6ffed', borderColor: '#b7eb8f' }} />;
                    if (openPeriods.length === 0) return <Input disabled placeholder="Not synced" style={{ color: REDWOOD.warning }} />;
                    return <Input disabled placeholder="No open period" style={{ color: REDWOOD.error }} />;
                  }}
                </Form.Item>
              </Col>
            </Row>

            {editTxn.transactionType === 'Expense' && (
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Expense Type" name="expenseType"
                    rules={[{ required: true, message: 'Required' }]}>
                    <Select
                      placeholder="Select expense type"
                      showSearch
                      filterOption={(input, option) =>
                        String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      onChange={(val) => {
                        const dist = distCombinations.find(d => d.combinationName === val);
                        editTxnForm.setFieldsValue({
                          chargeAccountDesc: dist?.glAccountDesc ?? editTxnForm.getFieldValue('chargeAccountDesc'),
                          chargeAccountCcid: dist?.glAccountCcid ?? editTxnForm.getFieldValue('chargeAccountCcid'),
                        });
                        setEditAcctDesc(dist?.description ?? dist?.combinationName ?? '');
                      }}
                      options={distCombinations.map(d => ({ value: d.combinationName, label: d.combinationName }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Currency" name="currency">
                    <Select>
                      {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                        <Option key={c} value={c}>{c}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            )}

            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  label={editTxn.transactionType === 'Expense' ? 'Amount (Credit)' : 'Amount (Debit)'}
                  name="amount"
                  rules={[{ required: true, message: 'Required' }, { type: 'number', min: 0.01, message: 'Must be > 0' }]}>
                  <InputNumber style={{ width: '100%' }} precision={2} min={0} placeholder="0.00" />
                </Form.Item>
              </Col>
              {editTxn.transactionType !== 'Expense' && (
                <Col span={12}>
                  <Form.Item label="Currency" name="currency">
                    <Select>
                      {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                        <Option key={c} value={c}>{c}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
              )}
              <Col span={12}>
                <Form.Item label="Voucher No" name="referenceNo">
                  <Input
                    readOnly
                    prefix={<TagOutlined />}
                    style={{ fontFamily: 'monospace', color: '#1677ff', fontWeight: 600, background: '#f0f5ff', cursor: 'not-allowed' }}
                  />
                </Form.Item>
              </Col>
            </Row>

            {editTxn.transactionType === 'Expense' && (
              <>
                <Form.Item name="chargeAccountCcid" hidden><Input /></Form.Item>
                <Form.Item label="Charge Account">
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item name="chargeAccountDesc" noStyle>
                      <Input placeholder="Select via Browse" readOnly style={{ cursor: 'not-allowed', background: '#fafafa' }} />
                    </Form.Item>
                    <Button icon={<BankOutlined />} onClick={() => { setCoaTarget('edit'); setCoaInitialValue(editTxnForm.getFieldValue('chargeAccountDesc') || ''); setCoaOpen(true); }}>
                      Browse
                    </Button>
                  </Space.Compact>
                  {editAcctDesc && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#1677ff', paddingLeft: 2 }}>
                      {editAcctDesc}
                    </div>
                  )}
                </Form.Item>
              </>
            )}

            <Row gutter={12}>
              <Col span={editTxn.transactionType === 'Expense' ? 12 : 24}>
                <Form.Item label="Paid To" name="employeeName">
                  <Input prefix={<UserOutlined />} placeholder="Optional" />
                </Form.Item>
              </Col>
              {editTxn.transactionType === 'Expense' && (
                <Col span={12}>
                  <Form.Item label="Receipt Status" name="receiptStatus">
                    <Select allowClear placeholder="Select">
                      <Option value="YES">YES</Option>
                      <Option value="NO">NO</Option>
                    </Select>
                  </Form.Item>
                </Col>
              )}
            </Row>
            <Form.Item label="Comments" name="comments">
              <Input.TextArea rows={2} placeholder="Optional" />
            </Form.Item>
            {editTxn.transactionType === 'Expense' && (
              <Form.Item label="Attachments">
                <Space direction="vertical" style={{ width: '100%' }} size={6}>
                  {/* Existing attachments */}
                  {editTxnAttachmentsLoading ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>Loading attachments…</Text>
                  ) : editTxnAttachments.length > 0 ? (
                    <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
                      {editTxnAttachments.map((att, idx) => (
                        <div key={att.attachmentId} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                          background: idx % 2 === 0 ? '#fafafa' : '#fff',
                          borderBottom: idx < editTxnAttachments.length - 1 ? '1px solid #f0f0f0' : undefined,
                        }}>
                          <PaperClipOutlined style={{ color: REDWOOD.info, flexShrink: 0 }} />
                          <Text style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {att.fileName}
                          </Text>
                          {att.createdBy && (
                            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{att.createdBy}</Text>
                          )}
                          <Button type="text" size="small" icon={<EyeOutlined />}
                            style={{ color: REDWOOD.info, flexShrink: 0 }}
                            onClick={() => openFilePreview(att)} />
                          <Tooltip
                            title={
                              <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                <div><span style={{ color: '#ff7875', fontWeight: 700 }}>DELETE</span></div>
                                <div style={{ color: '#aaa', wordBreak: 'break-all' }}>{`${APEX_DB_CONFIG.baseUrl}/pc/attachments/${att.attachmentId}`}</div>
                                <div style={{ color: '#aaa', marginTop: 4 }}>Body: none</div>
                                <div style={{ color: '#aaa' }}>Expects: {`{ "success": true }`}</div>
                              </div>
                            }
                            overlayStyle={{ maxWidth: 420 }}
                          >
                            <Button type="text" size="small" icon={<ApiOutlined />}
                              style={{ color: '#faad14', flexShrink: 0 }} />
                          </Tooltip>
                          <Button type="text" size="small" danger icon={<CloseOutlined />}
                            style={{ flexShrink: 0 }}
                            onClick={() => {
                              Modal.confirm({
                                title: 'Delete attachment?',
                                content: `"${att.fileName}" will be permanently removed.`,
                                okType: 'danger', okText: 'Delete',
                                onOk: async () => {
                                  try {
                                    await deleteAttachment(att.attachmentId);
                                    setEditTxnAttachments(prev => prev.filter(a => a.attachmentId !== att.attachmentId));
                                    message.success('Attachment deleted');
                                  } catch (e: any) {
                                    message.error(e?.message || 'Delete failed');
                                  }
                                },
                              });
                            }} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>No attachments</Text>
                  )}
                  {/* New files queued for upload */}
                  {editExpenseFiles.map(f => (
                    <Space key={f.uid} size={4} style={{ display: 'flex' }}>
                      <PaperClipOutlined style={{ color: REDWOOD.success }} />
                      <Text style={{ fontSize: 12, color: REDWOOD.success }}>{f.name} (new)</Text>
                      <Button type="text" size="small" danger icon={<CloseOutlined />}
                        onClick={() => setEditExpenseFiles(prev => prev.filter(x => x.uid !== f.uid))} />
                    </Space>
                  ))}
                  {/* Upload button */}
                  <Upload
                    multiple
                    beforeUpload={async (file) => {
                      try {
                        const entry = await readFileAsEntry(file);
                        setEditExpenseFiles(prev => [...prev, entry]);
                      } catch { message.error(`Failed to read ${file.name}`); }
                      return false;
                    }}
                    showUploadList={false}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  >
                    <Button icon={<UploadOutlined />} size="small">Upload New Files</Button>
                  </Upload>
                </Space>
              </Form.Item>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button onClick={() => { setEditTxnOpen(false); setEditTxn(null); setEditExpenseFiles([]); setEditTxnAttachments([]); }}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={saving}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
                Save Changes
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      {/* ── Reverse Add Money Modal ───────────────────────── */}
      <Modal
        title={<Space><RollbackOutlined style={{ color: REDWOOD.warning }} /> Reverse Add Money</Space>}
        open={reverseOpen}
        onCancel={() => setReverseOpen(false)}
        footer={null}
        width={520}
        destroyOnClose
      >
        {reverseTxn && (
          <>
            {/* Original transaction summary */}
            <div style={{ padding: '10px 14px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, marginBottom: 14 }}>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text style={{ fontSize: 12 }}>
                  <b>Line #{reverseTxn.lineNumber}</b> &nbsp;·&nbsp;
                  {reverseTxn.transactionDate} &nbsp;·&nbsp;
                  <Text strong style={{ color: REDWOOD.success }}>
                    {fmt(reverseTxn.debitAmount)} {reverseTxn.currency}
                  </Text>
                </Text>
                {reverseTxn.referenceNo && (
                  <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Ref: {reverseTxn.referenceNo}</Text>
                )}
                {reverseTxn.bankTxnId && (
                  <Text style={{ fontSize: 11, color: REDWOOD.info }}>
                    <BankOutlined /> Linked Bank Txn ID: <b>{reverseTxn.bankTxnId}</b>
                  </Text>
                )}
              </Space>
            </div>

            {/* Bank status loading spinner */}
            {reverseBankLoading && (
              <div style={{ textAlign: 'center', padding: '16px 0', marginBottom: 14 }}>
                <Spin size="small" tip="Checking bank transaction status…" />
              </div>
            )}

            {/* Scenario A: bank already VOID */}
            {!reverseBankLoading && reverseScenario === 'bank_void' && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 14, fontSize: 12 }}
                message={
                  <span>
                    The linked bank transaction is already <b>VOID</b> and was never accounted.<br />
                    The Add Money entry will be <b>deleted</b> from the register — no GL entries are needed.
                    The bank transaction is already closed.
                  </span>
                }
              />
            )}

            {/* Scenario C: bank reconciled or accounted */}
            {!reverseBankLoading && reverseScenario === 'bank_accounted' && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 14, fontSize: 12 }}
                message={
                  <span>
                    The linked bank transaction is{' '}
                    <b>
                      {reverseBankData?.status === 'REC' && reverseBankData?.accountingFlag === 'Y'
                        ? 'reconciled and accounted'
                        : reverseBankData?.status === 'REC'
                        ? 'reconciled'
                        : 'accounted'}
                    </b>.
                    <br />
                    A <b>negative offsetting bank transaction</b> will be created and linked to a new Adjustment entry.
                    The original bank transaction is preserved for reconciliation.
                  </span>
                }
              />
            )}

            {/* Scenario B / no_bank: standard Adjustment */}
            {!reverseBankLoading && (reverseScenario === 'bank_unr' || reverseScenario === 'no_bank') && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 14, fontSize: 12 }}
                message={
                  <span>
                    An <b>Adjustment</b> entry of{' '}
                    <Text strong style={{ color: REDWOOD.error }}>−{fmt(reverseTxn.debitAmount)} {reverseTxn.currency}</Text>{' '}
                    will be created, restoring the register balance to its prior state.
                    The original line is kept for the audit trail.
                  </span>
                }
              />
            )}

            {/* Void bank checkbox — only shown for bank_unr */}
            {!reverseBankLoading && reverseScenario === 'bank_unr' && reverseTxn.bankTxnId && (
              <div style={{ padding: '10px 14px', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, marginBottom: 14 }}>
                <Space>
                  <input
                    type="checkbox"
                    checked={reverseVoidBank}
                    onChange={e => setReverseVoidBank(e.target.checked)}
                    id="voidBankChk"
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="voidBankChk" style={{ cursor: 'pointer', fontSize: 13 }}>
                    Also void linked bank transaction <b>#{reverseTxn.bankTxnId}</b>
                  </label>
                </Space>
                {!reverseVoidBank && (
                  <div style={{ marginTop: 6, fontSize: 11, color: REDWOOD.warning }}>
                    The bank transaction will remain active — ensure the bank reconciliation team handles it separately.
                  </div>
                )}
              </div>
            )}

            {/* Reason / Comments — not shown for bank_void (no entry created) */}
            {!reverseBankLoading && reverseScenario !== 'bank_void' && (
              <div style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Reason / Comments</Text>
                <Input.TextArea
                  rows={2}
                  placeholder="e.g. Wrong amount entered — reversing"
                  value={reverseComments}
                  onChange={e => setReverseComments(e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setReverseOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                danger
                loading={reverseSaving}
                disabled={reverseBankLoading}
                icon={<RollbackOutlined />}
                onClick={handleConfirmReverse}
              >
                {reverseScenario === 'bank_void' ? 'Delete Entry' : 'Confirm Reversal'}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Reference Group Modal ─────────────────────────── */}
      <Modal
        title={
          <Space>
            <TagOutlined style={{ color: REDWOOD.info }} />
            Reference Group
            <Tag color="blue" style={{ fontSize: 11 }}>{refGroupRef}</Tag>
          </Space>
        }
        open={refGroupOpen}
        onCancel={() => setRefGroupOpen(false)}
        footer={null}
        width={1100}
        destroyOnClose
      >
        {/* Lines in this reference group */}
        <Table
          size="small"
          pagination={false}
          rowKey="transactionId"
          dataSource={transactions.filter(t => t.referenceNo === refGroupRef)}
          style={{ marginBottom: 16 }}
          scroll={{ x: 1000 }}
          columns={[
            { title: '#',    dataIndex: 'lineNumber',    width: 50,  align: 'center' as const,
              render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
            { title: 'Date', dataIndex: 'transactionDate', width: 100,
              render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
            { title: 'Type', dataIndex: 'transactionType', width: 110,
              render: (v) => {
                const color = v === 'Balance Refill' ? 'blue' : v === 'Balance Refund' ? 'green' : v === 'Opening Fund Balance' ? 'gold' : v === 'Expense' ? 'orange' : 'purple';
                return <Tag color={color} style={{ fontSize: 11 }}>{v}</Tag>;
              }},
            { title: 'Expense Type', dataIndex: 'expenseType', width: 130,
              render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
            { title: 'Paid To', dataIndex: 'employeeName', width: 130, ellipsis: true,
              render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
            { title: 'Money In', dataIndex: 'debitAmount', width: 90, align: 'right' as const,
              render: (v) => v > 0
                ? <Text style={{ fontSize: 12, color: REDWOOD.success }}>{fmt(v)}</Text>
                : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
            { title: 'Money Out', dataIndex: 'creditAmount', width: 90, align: 'right' as const,
              render: (v) => v > 0
                ? <Text style={{ fontSize: 12, color: REDWOOD.error }}>{fmt(v)}</Text>
                : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
            { title: 'Orig. Suspense', dataIndex: 'originalSuspenseAmount', width: 110, align: 'right' as const,
              render: (v) => v != null
                ? <Text style={{ fontSize: 12, color: '#722ed1' }}>{fmt(v)}</Text>
                : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
            { title: 'Suspense', dataIndex: 'suspenseAmount', width: 90, align: 'right' as const,
              render: (v) => v > 0
                ? <Text style={{ fontSize: 12, color: '#722ed1' }}>{fmt(v)}</Text>
                : v < 0
                  ? <Text style={{ fontSize: 12, color: REDWOOD.error }}>{fmt(v)}</Text>
                  : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
            { title: 'Comments', dataIndex: 'comments', width: 220,
              render: (v) => <span style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '—'}</span> },
            ...(!isClosed ? [{
              title: '',
              key: 'actions',
              width: 80,
              align: 'center' as const,
              render: (_: any, row: PCTransaction) => {
                const isPosted = row.postingStatus === 'Posted';
                const canDelete = !isPosted && row.transactionType === 'Expense';
                return (
                  <Space size={2}>
                    <Tooltip title={isPosted ? 'Posted — cannot edit' : 'Edit this line'}>
                      <Button
                        type="text"
                        size="small"
                        disabled={isPosted}
                        icon={<EditOutlined style={{ color: isPosted ? undefined : REDWOOD.info }} />}
                        loading={txnActionLoading === row.transactionId}
                        onClick={() => openEditTransaction(row)}
                      />
                    </Tooltip>
                    <Tooltip title={canDelete ? 'Delete this expense' : isPosted ? 'Posted — cannot delete' : 'Only unposted expense lines can be deleted'}>
                      <Button
                        type="text"
                        size="small"
                        disabled={!canDelete}
                        icon={<DeleteOutlined style={{ color: canDelete ? REDWOOD.error : undefined }} />}
                        loading={txnActionLoading === row.transactionId}
                        onClick={() => handleDeleteTransaction(row)}
                      />
                    </Tooltip>
                  </Space>
                );
              },
            }] : []),
          ]}
          summary={(rows) => {
            const totalDr  = rows.reduce((s, r) => s + (r.debitAmount    || 0), 0);
            const totalCr  = rows.reduce((s, r) => s + (r.creditAmount   || 0), 0);
            const totalSus = rows.reduce((s, r) => s + (r.suspenseAmount || 0), 0);
            return (
              <Table.Summary.Row style={{ background: '#fafafa' }}>
                <Table.Summary.Cell index={0} colSpan={5}>
                  <Text strong style={{ fontSize: 12 }}>Total ({rows.length} lines)</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <Text strong style={{ fontSize: 12, color: REDWOOD.success }}>{totalDr > 0 ? fmt(totalDr) : '—'}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  <Text strong style={{ fontSize: 12, color: REDWOOD.error }}>{totalCr > 0 ? fmt(totalCr) : '—'}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} />
                <Table.Summary.Cell index={8} align="right">
                  <Text strong style={{ fontSize: 12, color: totalSus < 0 ? REDWOOD.error : '#722ed1' }}>{totalSus !== 0 ? fmt(totalSus) : '—'}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} />
              </Table.Summary.Row>
            );
          }}
        />

        {/* Toolbar: Add Expense + Print */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {!isClosed && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              style={{ background: REDWOOD.warning, borderColor: REDWOOD.warning }}
              onClick={() => {
                setAddExpenseFromRefGroup(true);
                setAddExpenseVoucherNo(refGroupRef);
                expenseForm.resetFields();
                setAddAcctDesc('');
                setAddExpenseFiles([]);
                setExpenseMode('single');
                setAddExpenseOpen(true);
              }}
            >
              Add Expense to {refGroupRef}
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button
            size="small"
            icon={<FilePdfOutlined />}
            onClick={() => printRefGroupPDF(refGroupRef, transactions.filter(t => t.referenceNo === refGroupRef), register)}
          >
            Download PDF
          </Button>
        </div>

        {/* Rename reference */}
        {!isClosed && (
          <>
            <Divider style={{ margin: '0 0 12px' }}>Rename Reference</Divider>
            <Form form={refGroupForm} layout="inline" size="small" onFinish={handleSaveRefGroup}>
              <Form.Item label="Reference No" name="referenceNo" style={{ flex: 1 }}>
                <Input placeholder="New reference number (blank to clear)" allowClear />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={refGroupSaving}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                  Apply to All Lines
                </Button>
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      {/* ── New Expense Type (Distribution Combination) Modal ── */}
      <Modal
        title={<Space><PlusOutlined style={{ color: REDWOOD.success }} /> New Expense Type</Space>}
        open={newDistOpen}
        onCancel={() => { setNewDistOpen(false); newDistForm.resetFields(); setNewDistAcctDesc(''); }}
        footer={null}
        width={440}
        zIndex={1050}
        destroyOnClose
      >
        <Form form={newDistForm} layout="vertical" size="small"
          onFinish={async (values) => {
            setNewDistSaving(true);
            try {
              await createCombination({
                combinationName: values.combinationName,
                description:     values.description || null,
                glAccountDesc:   values.glAccountDesc || null,
                businessUnit:    values.businessUnit || null,
                module:          'PC',
                status:          'ACTIVE',
              });
              message.success(`Expense type "${values.combinationName}" created`);
              // Reload combinations
              const fresh = await searchCombinations({ status: 'ACTIVE' });
              setDistCombinations(fresh.filter(d => d.module === 'PC' || d.module === 'ALL'));
              setNewDistOpen(false);
              newDistForm.resetFields();
            } catch (e: any) {
              message.error(e.message || 'Failed to create expense type');
            } finally {
              setNewDistSaving(false);
            }
          }}
        >
          <Form.Item label="Business Unit" name="businessUnit" rules={[{ required: true, message: 'Required' }]}>
            <Select
              placeholder="Select business unit"
              showSearch
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={businessUnits.map(bu => ({ value: bu, label: bu }))}
              notFoundContent={businessUnits.length === 0 ? 'Loading…' : 'No match'}
            />
          </Form.Item>
          <Form.Item label="Expense Type Name" name="combinationName" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Office Supplies" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input placeholder="Optional description" />
          </Form.Item>
          <Form.Item label="GL Account" name="glAccountDesc">
            <Input
              placeholder="e.g. 01-000-5100-000-000-000-000"
              onChange={() => setNewDistAcctDesc('')}
              suffix={
                <Tooltip title="Browse accounts">
                  <SearchOutlined
                    style={{ cursor: 'pointer', color: '#1677ff' }}
                    onClick={() => {
                      setCoaTarget('newDist');
                      setCoaInitialValue(newDistForm.getFieldValue('glAccountDesc') || '');
                      setCoaOpen(true);
                    }}
                  />
                </Tooltip>
              }
            />
          </Form.Item>
          {newDistAcctDesc && (
            <div style={{ marginTop: -8, marginBottom: 8, fontSize: 11, color: '#1677ff', paddingLeft: 2 }}>
              {newDistAcctDesc}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button onClick={() => { setNewDistOpen(false); newDistForm.resetFields(); setNewDistAcctDesc(''); }}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={newDistSaving}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
              Create
            </Button>
          </div>
        </Form>
      </Modal>

      {/* ── Account (COA) Selector ────────────────────────── */}
      <AccountSelector
        visible={coaOpen}
        initialValue={coaInitialValue}
        onCancel={() => { setCoaOpen(false); setCoaInitialValue(''); }}
        onSelect={(accountCode, segmentDetails) => {
          const segs = Object.values(segmentDetails);
          const seg4Desc = segs[3]?.description || '';
          const seg5Desc = segs[4]?.description || '';
          const acctLabel = seg5Desc ? `${seg4Desc}  |  ${seg5Desc}` : seg4Desc;
          setCoaInitialValue('');
          if (coaTarget === 'add') {
            expenseForm.setFieldsValue({ chargeAccountDesc: accountCode, chargeAccountCcid: null });
            setAddAcctDesc(acctLabel);
          } else if (coaTarget === 'edit') {
            editTxnForm.setFieldsValue({ chargeAccountDesc: accountCode, chargeAccountCcid: null });
            setEditAcctDesc(acctLabel);
          } else if (coaTarget === 'money') {
            moneyForm.setFieldsValue({ chargeAccountDesc: accountCode, chargeAccountCcid: null });
            setMoneyAcctDesc(acctLabel);
            bankTxnForm.setFieldsValue({ offsetAccountCombination: accountCode });
          } else if (coaTarget === 'bankAsset') {
            bankTxnForm.setFieldsValue({ assetAccountCombination: accountCode });
            setBankAssetDesc(acctLabel);
          } else if (coaTarget === 'bankOffset') {
            bankTxnForm.setFieldsValue({ offsetAccountCombination: accountCode });
            setBankOffsetDesc(acctLabel);
          } else if (coaTarget === 'refundCash') {
            moneyForm.setFieldsValue({ refundCashAccount: accountCode });
            setRefundCashDesc(acctLabel);
          } else if (coaTarget === 'multiLine' && coaMultiLineKey) {
            updateLine(coaMultiLineKey, { chargeAccountDesc: accountCode, chargeAccountCcid: null, acctDesc: acctLabel });
            setCoaMultiLineKey(null);
          } else if (coaTarget === 'convertLine' && coaConvertLineKey) {
            updateConvertLine(coaConvertLineKey, { chargeAccountDesc: accountCode, chargeAccountCcid: null, acctDesc: acctLabel });
            setCoaConvertLineKey(null);
          } else if (coaTarget === 'newDist') {
            newDistForm.setFieldsValue({ glAccountDesc: accountCode });
            setNewDistAcctDesc(seg4Desc);
          } else if (coaTarget === 'suspenseRefund') {
            suspenseRefundForm.setFieldsValue({ chargeAccountDesc: accountCode, chargeAccountCcid: null });
          }
          setCoaOpen(false);
        }}
      />

      {/* ── Bank Transaction Detail Popup ─────────────────────── */}
      <Modal
        title={<Space><BankOutlined style={{ color: REDWOOD.info }} /> Bank Transaction {bankTxnDetail?.transactionId ?? ''}</Space>}
        open={bankTxnDetailOpen}
        onCancel={() => setBankTxnDetailOpen(false)}
        footer={(() => {
          // Use the bankTxnId that opened the modal (bankTxnDetailSourceId) rather than
          // bankTxnDetail.transactionId — the API field name / type may differ from
          // what is stored in the PC transaction's bankTxnId column.
          const pcTxn = bankTxnDetailSourceId != null
            ? transactions.find(t => t.bankTxnId === bankTxnDetailSourceId)
            : undefined;
          const alreadyPosted = pcTxn?.postingStatus === 'Posted' || bankTxnDetail?.accountingFlag === 'Y';
          return (
            <Space>
              {pcTxn && !alreadyPosted && (
                <Tooltip title={!pcTxn.chargeAccountDesc ? 'No charge account set on this transaction' : 'Create GL accounting entry for this transaction'}>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    disabled={!pcTxn.chargeAccountDesc}
                    style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                    onClick={() => {
                      setBankTxnDetailOpen(false);
                      openCreateAccountingModal([pcTxn], bankTxnDetail?.assetAccountCombination || undefined);
                    }}
                  >
                    Create Accounting
                  </Button>
                </Tooltip>
              )}
              {alreadyPosted && (
                <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 12 }}>Already Accounted</Tag>
              )}
              {bankTxnDetailUrl && (
                <Tooltip title="View API endpoint used to load this record">
                  <Button icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                    onClick={() => Modal.info({
                      title: 'Bank Transaction — API Endpoint',
                      width: 760,
                      content: (
                        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <Tag color="blue">GET</Tag>
                            <span style={{ wordBreak: 'break-all', color: REDWOOD.info }}>{bankTxnDetailUrl}</span>
                          </div>
                          <div style={{ background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 6,
                            padding: '8px 12px', marginTop: 8 }}>
                            {bankTxnDetailUrl.split('?')[1]?.split('&').map((part, i) => {
                              const [k, v] = part.split('=');
                              return <div key={i} style={{ marginBottom: 2 }}>
                                <Text code style={{ fontSize: 11 }}>{decodeURIComponent(k)}</Text>
                                {' = '}
                                <Text style={{ fontSize: 11, color: REDWOOD.info }}>{decodeURIComponent(v || '')}</Text>
                              </div>;
                            })}
                          </div>
                          {bankTxnDetail && (
                            <>
                              <div style={{ marginTop: 10, marginBottom: 4, fontWeight: 600, fontSize: 11 }}>Response (first item):</div>
                              <div style={{ background: '#1d1d1d', color: '#d4d4d4', borderRadius: 6, padding: '8px 12px',
                                maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 10 }}>
                                {JSON.stringify(bankTxnDetail, null, 2)}
                              </div>
                            </>
                          )}
                        </div>
                      ),
                    })}
                  >
                    API
                  </Button>
                </Tooltip>
              )}
              <Button onClick={() => setBankTxnDetailOpen(false)}>Close</Button>
            </Space>
          );
        })()}
        width={620}
        zIndex={1050}
      >
        {bankTxnDetailLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Text type="secondary">Loading…</Text></div>
        ) : bankTxnDetail ? (
          <Descriptions size="small" bordered column={2} labelStyle={{ fontWeight: 600, fontSize: 12 }} contentStyle={{ fontSize: 12 }}>
            <Descriptions.Item label="Txn Number">{bankTxnDetail.transactionId ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {bankTxnDetail.status
                ? <Tag color={bankTxnDetail.status === 'VOID' ? 'red' : bankTxnDetail.status === 'REC' ? 'blue' : 'default'} style={{ fontSize: 11 }}>{bankTxnDetail.status}</Tag>
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Accounting Status">
              {bankTxnDetail.accountingFlag === 'Y'
                ? <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Accounted</Tag>
                : <Tag color="default" style={{ fontSize: 11 }}>Not Accounted</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Acct Flag">{bankTxnDetail.accountingFlag ?? 'N'}</Descriptions.Item>
            <Descriptions.Item label="Bank Account" span={2}>{bankTxnDetail.bankAccountName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Business Unit" span={2}>{bankTxnDetail.businessUnitName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Txn Date">{bankTxnDetail.transactionDate ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Value Date">{bankTxnDetail.valueDate ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Amount">{bankTxnDetail.amount ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Currency">{bankTxnDetail.currencyCode ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Txn Type">{bankTxnDetail.transactionType ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Source">{bankTxnDetail.source ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Reference" span={2}>{bankTxnDetail.referenceText ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Asset Account" span={2}>
              <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{bankTxnDetail.assetAccountCombination ?? '—'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Offset Account" span={2}>
              <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{bankTxnDetail.offsetAccountCombination ?? '—'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Description" span={2}>{bankTxnDetail.description ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Created By">{bankTxnDetail.createdBy ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Created On">{bankTxnDetail.creationDate ?? '—'}</Descriptions.Item>
          </Descriptions>
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}><Text type="secondary">Bank transaction not found.</Text></div>
        )}
      </Modal>

      {/* ── Attachment List Modal (new RR_PC_ATTACHMENTS system) ── */}
      <Modal
        title={
          <Space style={{ width: '100%', justifyContent: 'space-between', paddingRight: 32 }}>
            <Space>
              <PaperClipOutlined style={{ color: REDWOOD.info }} />
              Attachments
              {attachListTxn && (
                <Tag color="blue" style={{ fontSize: 11 }}>
                  Line #{attachListTxn.lineNumber}
                  {attachListTxn.referenceNo && ` · ${attachListTxn.referenceNo}`}
                </Tag>
              )}
            </Space>
            <Space size={4}>
              <Tooltip title={attachListMaximized ? 'Restore' : 'Maximize'}>
                <Button
                  type="text" size="small"
                  icon={attachListMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => setAttachListMaximized(m => !m)}
                  style={{ color: REDWOOD.neutral600 }}
                />
              </Tooltip>
            {attachListTxn && (
              <Tooltip
                title={
                  <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
                    <div style={{ marginBottom: 4, color: '#adc6ff', fontWeight: 600 }}>GET (list)</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/pc/attachments?transactionId=${attachListTxn.transactionId}`}
                    </div>
                    <div style={{ marginTop: 8, marginBottom: 4, color: '#adc6ff', fontWeight: 600 }}>GET (single + fileData)</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/pc/attachments/:attachmentId`}
                    </div>
                    <div style={{ marginTop: 8, marginBottom: 4, color: '#adc6ff', fontWeight: 600 }}>POST (upload)</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/pc/attachments`}
                    </div>
                    <div style={{ marginTop: 8, marginBottom: 4, color: '#adc6ff', fontWeight: 600 }}>DELETE</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/pc/attachments/:attachmentId`}
                    </div>
                  </div>
                }
                placement="bottomRight"
                overlayStyle={{ maxWidth: 460 }}
              >
                <Tag
                  icon={<ApiOutlined />}
                  color="blue"
                  style={{ cursor: 'help', fontSize: 11, marginRight: 0 }}
                >
                  API
                </Tag>
              </Tooltip>
            )}
            </Space>
          </Space>
        }
        open={attachListOpen}
        onCancel={() => { setAttachListOpen(false); setAttachListMaximized(false); }}
        footer={null}
        width={attachListMaximized ? '100%' : 580}
        style={attachListMaximized ? { top: 0, padding: 0, maxWidth: '100vw' } : undefined}
        styles={attachListMaximized ? { body: { height: 'calc(100vh - 110px)', overflowY: 'auto' } } : undefined}
        destroyOnClose
        zIndex={1050}
      >
        {/* API URL bar — always visible for debugging */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', marginBottom: 12,
          background: '#f0f5ff', borderRadius: 6,
          border: '1px solid #adc6ff',
        }}>
          <ApiOutlined style={{ color: REDWOOD.info, flexShrink: 0 }} />
          <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.info, flex: 1, wordBreak: 'break-all' }}>
            GET {attachListUrl}
          </Text>
          <Tooltip title="Copy URL">
            <Button type="text" size="small" icon={<DownloadOutlined style={{ fontSize: 11 }} />}
              style={{ flexShrink: 0, padding: '0 4px' }}
              onClick={() => { navigator.clipboard?.writeText(attachListUrl); message.success('URL copied'); }}
            />
          </Tooltip>
        </div>

        {attachListError && (
          <Alert type="error" showIcon message={attachListError} style={{ marginBottom: 12, fontSize: 12 }} />
        )}

        {attachListLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin size="small" tip="Loading…" />
          </div>
        ) : !attachListError && attachListData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: REDWOOD.neutral300 }}>
            <PaperClipOutlined style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
            No attachments found
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            {attachListData.map((att, idx) => (
              <div key={att.attachmentId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px',
                background: idx % 2 === 0 ? '#fafafa' : '#fff',
                borderRadius: 4, marginBottom: 4,
                border: `1px solid ${REDWOOD.neutral200}`,
              }}>
                <Space size={8}>
                  <PaperClipOutlined style={{ color: REDWOOD.info }} />
                  <div>
                    <Text style={{ fontSize: 13, fontWeight: 500 }}>{att.fileName}</Text>
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                      {att.createdBy} · {att.creationDate}
                      {att.mimeType && <span style={{ marginLeft: 6, color: REDWOOD.neutral300 }}>{att.mimeType}</span>}
                    </div>
                  </div>
                </Space>
                <Space size={4}>
                  <Tooltip title="View / Download">
                    <Button size="small" icon={<EyeOutlined />}
                      onClick={() => openFilePreview(att)} />
                  </Tooltip>
                  <Tooltip title="Delete attachment">
                    <Button size="small" danger icon={<DeleteOutlined />}
                      loading={attachListDeleting === att.attachmentId}
                      onClick={() => {
                        Modal.confirm({
                          title: 'Delete attachment?',
                          content: `"${att.fileName}" will be permanently removed.`,
                          okText: 'Delete', okButtonProps: { danger: true },
                          onOk: () => handleDeleteAttachment(att.attachmentId),
                          zIndex: 1100,
                        });
                      }} />
                  </Tooltip>
                </Space>
              </div>
            ))}
          </div>
        )}

        {/* Upload more files to this transaction */}
        {attachListTxn && (
          <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, paddingTop: 12 }}>
            <Upload
              multiple
              beforeUpload={async (file) => {
                try {
                  const entry = await readFileAsEntry(file);
                  await addAttachment({
                    registerId:    attachListTxn.registerId,
                    transactionId: attachListTxn.transactionId,
                    referenceNo:   attachListTxn.referenceNo ?? undefined,
                    fileName:      entry.name,
                    fileData:      entry.data,
                    mimeType:      entry.mimeType,
                    createdBy:     currentUser,
                  });
                  message.success(`${file.name} uploaded`);
                  const list = await getAttachments(attachListTxn.registerId, attachListTxn.transactionId);
                  setAttachListData(list);
                  onRefresh();
                } catch (e: any) {
                  message.error(e?.message ?? 'Upload failed');
                }
                return false;
              }}
              showUploadList={false}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            >
              <Button icon={<UploadOutlined />} style={{ borderStyle: 'dashed', width: '100%' }}>
                Add More Files
              </Button>
            </Upload>
          </div>
        )}
      </Modal>

      {/* ── File Preview Modal ────────────────────────────────── */}
      <Modal
        title={
          <Space style={{ width: '100%', justifyContent: 'space-between', paddingRight: 32 }}>
            <Space>
              <EyeOutlined style={{ color: REDWOOD.info }} />
              {filePreviewItem?.name ?? 'File Preview'}
            </Space>
            <Tooltip title={filePreviewMaximized ? 'Restore' : 'Maximize'}>
              <Button
                type="text" size="small"
                icon={filePreviewMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => setFilePreviewMaximized(m => !m)}
                style={{ color: REDWOOD.neutral600 }}
              />
            </Tooltip>
          </Space>
        }
        open={filePreviewOpen}
        onCancel={() => { setFilePreviewOpen(false); setFilePreviewError(''); setFilePreviewMaximized(false); }}
        footer={[
          filePreviewItem && (
            <Button key="download" icon={<DownloadOutlined />}
              onClick={() => {
                const link = document.createElement('a');
                link.href = `data:${filePreviewItem.mimeType || 'application/octet-stream'};base64,${filePreviewItem.data}`;
                link.download = filePreviewItem.name;
                link.click();
              }}>
              Download
            </Button>
          ),
          <Button key="close" onClick={() => { setFilePreviewOpen(false); setFilePreviewMaximized(false); }}>Close</Button>,
        ]}
        width={filePreviewMaximized ? '100%' : 720}
        style={filePreviewMaximized ? { top: 0, padding: 0, maxWidth: '100vw' } : undefined}
        styles={filePreviewMaximized ? { body: { height: 'calc(100vh - 110px)', overflowY: 'auto' } } : undefined}
        destroyOnClose
        zIndex={1100}
      >
        {/* API URL bar — always visible for debugging */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', marginBottom: 12,
          background: '#f0f5ff', borderRadius: 6,
          border: '1px solid #adc6ff',
        }}>
          <ApiOutlined style={{ color: REDWOOD.info, flexShrink: 0 }} />
          <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.info, flex: 1, wordBreak: 'break-all' }}>
            GET {filePreviewUrl}
          </Text>
          <Tooltip title="Copy URL">
            <Button type="text" size="small" icon={<DownloadOutlined style={{ fontSize: 11 }} />}
              style={{ flexShrink: 0, padding: '0 4px' }}
              onClick={() => { navigator.clipboard?.writeText(filePreviewUrl); message.success('URL copied'); }}
            />
          </Tooltip>
        </div>

        {filePreviewError && (
          <Alert type="error" showIcon message={filePreviewError} style={{ marginBottom: 12, fontSize: 12 }} />
        )}

        {filePreviewLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin size="large" tip="Loading file…" />
          </div>
        ) : filePreviewItem ? (
          (() => {
            const mt   = filePreviewItem.mimeType || 'application/octet-stream';
            const src  = `data:${mt};base64,${filePreviewItem.data}`;
            const previewH = filePreviewMaximized ? 'calc(100vh - 220px)' : '60vh';
            if (mt.startsWith('image/')) {
              return (
                <img src={src} alt={filePreviewItem.name}
                  style={{ maxWidth: '100%', maxHeight: previewH, objectFit: 'contain', display: 'block', margin: '0 auto' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              );
            }
            if (mt === 'application/pdf') {
              return (
                <object data={src} type="application/pdf"
                  style={{ width: '100%', height: previewH, border: 'none' }}>
                  <iframe src={src} title={filePreviewItem.name}
                    style={{ width: '100%', height: previewH, border: 'none' }} />
                </object>
              );
            }
            return (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <PaperClipOutlined style={{ fontSize: 48, color: REDWOOD.neutral300, display: 'block', marginBottom: 12 }} />
                <Text style={{ fontSize: 14, display: 'block' }}>{filePreviewItem.name}</Text>
                <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginTop: 8 }}>
                  This file type cannot be previewed — use the Download button.
                </Text>
              </div>
            );
          })()
        ) : !filePreviewError ? null : null}
      </Modal>

      {/* ── Attachment Viewer ──────────────────────────────── */}
      <Modal
        title={<Space><PaperClipOutlined style={{ color: REDWOOD.info }} />{viewAttachName || 'Attachment'}</Space>}
        open={viewAttachOpen}
        onCancel={() => setViewAttachOpen(false)}
        footer={[
          <Button key="download" type="primary" icon={<DownloadOutlined />}
            onClick={() => {
              const a = document.createElement('a');
              a.href = viewAttachData;
              a.download = viewAttachName || 'attachment';
              a.click();
            }}>
            Download
          </Button>,
          <Button key="close" onClick={() => setViewAttachOpen(false)}>Close</Button>,
        ]}
        width={700}
        zIndex={1050}
      >
        {viewAttachData.startsWith('data:image') ? (
          <img src={viewAttachData} alt={viewAttachName} style={{ width: '100%', maxHeight: 500, objectFit: 'contain' }} />
        ) : viewAttachData.startsWith('data:application/pdf') ? (
          <iframe src={viewAttachData} title={viewAttachName} style={{ width: '100%', height: 500, border: 'none' }} />
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <PaperClipOutlined style={{ fontSize: 48, color: REDWOOD.neutral300 }} />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">Preview not available for this file type.</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12 }}>{viewAttachName}</Text>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create Accounting Modal ───────────────────────────── */}
      <Modal
        title={<Space><CheckCircleOutlined style={{ color: REDWOOD.info }} />Create Accounting</Space>}
        open={acctModalOpen}
        onCancel={() => { if (!acctRunning) { setAcctModalOpen(false); } }}
        footer={
          acctDone
            ? <Button onClick={() => setAcctModalOpen(false)}>Close</Button>
            : [
                <Button key="api" icon={<ApiOutlined />} onClick={openApiDebug}
                  loading={apiDebugLoading} disabled={acctRunning}
                  style={{ float: 'left' }}>
                  Show API
                </Button>,
                <Button key="cancel" onClick={() => setAcctModalOpen(false)} disabled={acctRunning}>Cancel</Button>,
                <Button key="run" type="primary" loading={acctRunning}
                  disabled={acctProgress.every(r => r.status === 'skipped')}
                  style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                  onClick={runCreateAccounting}>
                  {acctRunning ? 'Processing…' : 'Run Create Accounting'}
                </Button>,
              ]
        }
        width={900}
        destroyOnClose
      >
        {!register.cashAccountDesc && (
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="Register has no cash account configured"
            description="Set the GL Cash Account in the register settings before creating accounting entries."
            style={{ marginBottom: 12 }}
          />
        )}
        {acctProgress.length > 0 && (() => {
          const periods = [...new Set(acctProgress.map(r => r.periodName))].filter(Boolean);
          return (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Accounting Period{periods.length > 1 ? 's' : ''}:</Text>
              {periods.map(p => (
                <Tag key={p} color="blue" style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{p}</Tag>
              ))}
            </div>
          );
        })()}
        <Table<AcctProgressRow>
          dataSource={acctProgress}
          rowKey="txnId"
          size="small"
          pagination={false}
          expandable={{
            expandedRowRender: (row) => (
              <div style={{ paddingLeft: 24, paddingBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: REDWOOD.neutral600, marginBottom: 4 }}>
                  Journal lines — {row.refNo}
                </div>
                {row.drLines.map((dl, i) => (
                  <div key={dl.txnId} style={{ display: 'flex', gap: 12, fontSize: 11, padding: '2px 0', borderBottom: i < row.drLines.length - 1 ? `1px solid ${REDWOOD.neutral200}` : 'none' }}>
                    <span style={{ color: REDWOOD.error, fontFamily: 'monospace', minWidth: 180 }}>Dr  {dl.chargeAccount}</span>
                    <span style={{ color: REDWOOD.neutral600, minWidth: 120 }}>{dl.expenseType || '—'}</span>
                    <span style={{ fontWeight: 600, marginLeft: 'auto' }}>{fmt(dl.amount)} {row.currency}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 12, fontSize: 11, padding: '4px 0', borderTop: `2px solid ${REDWOOD.neutral200}`, marginTop: 2 }}>
                  <span style={{ color: REDWOOD.success, fontFamily: 'monospace', minWidth: 180 }}>Cr  {row.crAccount}</span>
                  <span style={{ color: REDWOOD.neutral600, minWidth: 120 }}>Petty Cash Account</span>
                  <span style={{ fontWeight: 600, marginLeft: 'auto' }}>{fmt(row.amount)} {row.currency}</span>
                </div>
              </div>
            ),
            rowExpandable: () => true,
          }}
          columns={[
            { title: 'Reference', dataIndex: 'refNo', width: 130,
              render: (v, r) => (
                <div>
                  <Text style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color: v === '—' ? REDWOOD.neutral300 : REDWOOD.info }}>{v}</Text>
                  <div style={{ fontSize: 10, color: REDWOOD.neutral600 }}>{r.txnIds.length} line{r.txnIds.length !== 1 ? 's' : ''}</div>
                </div>
              )},
            { title: 'Journal Lines', key: 'journal', width: 220,
              render: (_, r) => (
                <div style={{ fontSize: 10, lineHeight: 1.6 }}>
                  {r.drLines.map(dl => (
                    <div key={dl.txnId} style={{ color: REDWOOD.error }}>
                      Dr {dl.expenseType || '—'} <span style={{ float: 'right', fontWeight: 600 }}>{fmt(dl.amount)}</span>
                    </div>
                  ))}
                  <div style={{ color: REDWOOD.success, borderTop: `1px solid ${REDWOOD.neutral200}` }}>
                    Cr Cash <span style={{ float: 'right', fontWeight: 600 }}>{fmt(r.amount)}</span>
                  </div>
                </div>
              )},
            { title: 'Total', dataIndex: 'amount', width: 110, align: 'right' as const,
              render: (v, r) => <Text style={{ fontSize: 13, fontWeight: 700 }}>{fmt(v)} <span style={{ fontSize: 11, fontWeight: 400 }}>{r.currency}</span></Text> },
            { title: 'Period', dataIndex: 'periodName', width: 90,
              render: (v) => <Tag color="blue" style={{ fontSize: 11 }}>{v || '—'}</Tag> },
            { title: 'CR Cash Account', dataIndex: 'crAccount', width: 180,
              render: (v, r) => (
                <div>
                  <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.success }}>{v || '—'}</Text>
                  {r.crAccountDesc && (
                    <Tooltip title={r.crAccountDesc}>
                      <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.crAccountDesc}
                      </div>
                    </Tooltip>
                  )}
                </div>
              )},
            { title: 'Status', dataIndex: 'status', width: 150,
              render: (v, r) => {
                if (v === 'pending')  return <Tag color="default" style={{ fontSize: 11 }}>Pending</Tag>;
                if (v === 'running')  return <Tag icon={<SyncOutlined spin />} color="processing" style={{ fontSize: 11 }}>Running…</Tag>;
                if (v === 'success')  return (
                  <div>
                    <Tag color="success" style={{ fontSize: 11 }}>Done</Tag>
                    {r.message && <div style={{ fontSize: 10, color: REDWOOD.success, marginTop: 2 }}>{r.message}</div>}
                  </div>
                );
                if (v === 'error')    return (
                  <div>
                    <Tag color="error" style={{ fontSize: 11 }}>Error</Tag>
                    {r.message && <div style={{ fontSize: 10, color: REDWOOD.error, marginTop: 2 }}>{r.message}</div>}
                  </div>
                );
                if (v === 'skipped')  return <Tag color="warning" style={{ fontSize: 11 }}>Already Posted</Tag>;
                return null;
              }},
          ]}
        />
        {acctDone && (
          <Alert
            type={acctProgress.some(r => r.status === 'error') ? 'warning' : 'success'}
            showIcon
            message={acctProgress.some(r => r.status === 'error')
              ? 'Accounting completed with some errors — review the rows above'
              : 'Accounting created and posted successfully'}
            style={{ marginTop: 12 }}
          />
        )}
      </Modal>

      {/* ── View Accounting Modal ──────────────────────────────── */}
      <Modal
        title={
          <Space>
            <BookOutlined style={{ color: REDWOOD.success }} />
            {viewAcctQueue.length > 1
              ? `Accounting — ${viewAcctQueue.length} transactions`
              : `Accounting – Line #${viewAcctTxn?.lineNumber} (${viewAcctTxn?.transactionType})`}
          </Space>
        }
        open={viewAcctOpen}
        onCancel={() => setViewAcctOpen(false)}
        footer={<Button onClick={() => setViewAcctOpen(false)}>Close</Button>}
        width={720}
        zIndex={1050}
      >
        {/* Transaction tabs when multiple are queued */}
        {viewAcctQueue.length > 1 && (
          <Tabs
            size="small"
            activeKey={String(viewAcctQueueIdx)}
            onChange={key => {
              const idx = Number(key);
              setViewAcctQueueIdx(idx);
              loadViewAcctTxn(viewAcctQueue[idx]);
            }}
            style={{ marginBottom: 12 }}
            items={viewAcctQueue.map((t, i) => ({
              key: String(i),
              label: (
                <span style={{ fontSize: 12 }}>
                  Line #{t.lineNumber}
                  <span style={{ fontSize: 11, color: REDWOOD.neutral600, marginLeft: 4 }}>
                    {t.transactionType}
                  </span>
                </span>
              ),
            }))}
          />
        )}
        {viewAcctLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : !viewAcctData?.found ? (
          <Alert
            type="info"
            showIcon
            message="No GL journal found for this transaction"
            description="Use 'Create Accounting' to post this transaction to the General Ledger."
          />
        ) : (
          <>
            <Descriptions size="small" bordered column={2}
              labelStyle={{ fontWeight: 600, fontSize: 12 }} contentStyle={{ fontSize: 12 }}
              style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Status">
                <Tag color={viewAcctData.accountingStatus === 'POSTED' ? 'green' : viewAcctData.accountingStatus === 'DRAFT' ? 'orange' : 'red'}
                  style={{ fontSize: 11 }}>
                  {viewAcctData.accountingStatus}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Posting">
                <Tag color={viewAcctData.postingStatus === 'POSTED' ? 'green' : 'default'} style={{ fontSize: 11 }}>
                  {viewAcctData.postingStatus}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Accounting Date">{viewAcctData.accountingDate ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Period">{viewAcctData.periodName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="GL Batch" span={2}>
                {viewAcctData.glBatchName
                  ? <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{viewAcctData.glBatchName}</Text>
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Posted By">{viewAcctData.postedBy ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Posted Date">{viewAcctData.postedDate ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Description" span={2}>{viewAcctData.description ?? '—'}</Descriptions.Item>
            </Descriptions>
            <Table
              dataSource={viewAcctData.lines}
              rowKey="lineId"
              size="small"
              pagination={false}
              columns={[
                { title: '#', dataIndex: 'lineNumber', width: 40, align: 'center' as const },
                { title: 'Dr/Cr', dataIndex: 'lineType', width: 50, align: 'center' as const,
                  render: (v) => <Tag color={v === 'DR' ? 'red' : 'green'} style={{ fontSize: 11 }}>{v}</Tag> },
                { title: 'Class', dataIndex: 'accountingClass', width: 100,
                  render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                { title: 'Account', dataIndex: 'accountCombination',
                  render: (v, r) => {
                    const desc = viewAcctLineDescs.get(v) || '';
                    const color = r.lineType === 'DR' ? REDWOOD.error : REDWOOD.success;
                    return (
                      <div>
                        <Text style={{ fontSize: 11, fontFamily: 'monospace', color }}>{v}</Text>
                        {desc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>{desc}</div>}
                      </div>
                    );
                  }},
                { title: 'Debit', dataIndex: 'enteredDr', width: 110, align: 'right' as const,
                  render: (v) => v > 0
                    ? <Text style={{ fontSize: 12, color: REDWOOD.error }}>{fmt(v)}</Text>
                    : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
                { title: 'Credit', dataIndex: 'enteredCr', width: 110, align: 'right' as const,
                  render: (v) => v > 0
                    ? <Text style={{ fontSize: 12, color: REDWOOD.success }}>{fmt(v)}</Text>
                    : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
              ]}
            />
          </>
        )}
      </Modal>

      {/* ── API Debug Modal ───────────────────────────────────── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />API Inspector — Create Accounting</Space>}
        open={apiDebugOpen}
        onCancel={() => setApiDebugOpen(false)}
        footer={<Button onClick={() => setApiDebugOpen(false)}>Close</Button>}
        width={860}
        destroyOnClose
      >
        {apiDebugLoading
          ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Building payloads…" /></div>
          : apiDebugItems.length === 0
          ? <Text type="secondary">No payloads to show.</Text>
          : apiDebugItems.map((item, idx) => (
            <div key={idx} style={{ marginBottom: 16, border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden' }}>
              {/* Header bar */}
              <div style={{ background: '#f0f4fa', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Space size={6}>
                  <Tag color="blue" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>POST</Tag>
                  <Text style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</Text>
                </Space>
                <Button size="small" type="primary" loading={item.loading}
                  title="Send request"
                  onClick={() => testApiItem(idx)}>
                  Test
                </Button>
              </div>
              {/* URL */}
              <div style={{ padding: '6px 12px', background: '#fafafa', borderBottom: '1px solid #e5e5e5', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: REDWOOD.neutral600 }}>
                {item.url}
              </div>
              {/* Body */}
              <div style={{ padding: '0 12px' }}>
                <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Request Body:</Text>
                <pre style={{ fontSize: 11, background: '#1e1e1e', color: '#d4d4d4', padding: '10px 12px', borderRadius: 4, overflowX: 'auto', marginTop: 4, maxHeight: 260 }}>
                  {JSON.stringify(item.body, null, 2)}
                </pre>
              </div>
              {/* Response */}
              {(item.response !== undefined || item.error) && (
                <div style={{ padding: '0 12px 10px' }}>
                  <Text style={{ fontSize: 11, color: item.error ? REDWOOD.error : REDWOOD.success }}>
                    {item.error ? `Error: ${item.error}` : 'Response:'}
                  </Text>
                  {!!item.response && (
                    <pre style={{ fontSize: 11, background: item.error ? '#fff0f0' : '#f0fff4', color: '#333', padding: '8px 12px', borderRadius: 4, overflowX: 'auto', marginTop: 4 }}>
                      {JSON.stringify(item.response, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))
        }
      </Modal>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
const PC_BASE = `${APEX_DB_CONFIG.baseUrl}/pc`;

const PC_API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: 'GET', url: `${PC_BASE}/registers`,
    description: 'Search all petty cash registers',
    params: 'q (name contains), status (ACTIVE|CLOSED), dateFrom (YYYY-MM-DD), dateTo (YYYY-MM-DD)',
  },
  {
    method: 'POST', url: `${PC_BASE}/registers`,
    description: 'Create a new petty cash register',
    body: 'registerName*, businessUnit*, startDate, endDate, comments, cashAccountDesc, currency, createdBy',
    sampleBody: JSON.stringify({ registerName: 'Main Office Petty Cash', businessUnit: 'Business Unit Name', currency: 'AED', startDate: '2026-01-01', cashAccountDesc: '01-100-1010-000', createdBy: 'ADMIN' }, null, 2),
  },
  {
    method: 'GET', url: `${PC_BASE}/registers/:registerId`,
    description: 'Get single register with live balance, totalDebit, totalCredit',
  },
  {
    method: 'PUT', url: `${PC_BASE}/registers/:registerId`,
    description: 'Update register header fields',
    body: 'registerName, startDate, endDate, comments, cashAccountDesc, currency, status, updatedBy',
    sampleBody: JSON.stringify({ status: 'CLOSED', updatedBy: 'ADMIN' }, null, 2),
  },
  {
    method: 'DELETE', url: `${PC_BASE}/registers/:registerId`,
    description: 'Delete register — blocked if transactions exist',
  },
  {
    method: 'GET', url: `${PC_BASE}/registers/:registerId/transactions`,
    description: 'Get all transaction lines with running balance (analytic window)',
  },
  {
    method: 'POST', url: `${PC_BASE}/transactions`,
    description: 'Create a transaction — Balance Refill (debit) or Expense (credit)',
    body: 'registerId*, transactionDate*, transactionType*, currency, debitAmount, creditAmount, expenseType, chargeAccountCcid, chargeAccountDesc, accountingDate, postingStatus, comments, referenceNo, attachment, createdBy',
    sampleBody: JSON.stringify({ registerId: 1001, transactionDate: '2026-04-18', transactionType: 'Expense', expenseType: 'Meals & Entertainment', currency: 'AED', debitAmount: 0, creditAmount: 150, referenceNo: 'EXP-001', comments: 'Team lunch', createdBy: 'ADMIN' }, null, 2),
  },
  {
    method: 'PUT', url: `${PC_BASE}/transactions/:transactionId`,
    description: 'Update a transaction line',
    body: 'transactionDate, transactionType, expenseType, chargeAccountCcid, chargeAccountDesc, accountingDate, postingStatus, currency, debitAmount, creditAmount, comments, referenceNo, attachment, updatedBy',
    sampleBody: JSON.stringify({ postingStatus: 'Posted', updatedBy: 'ADMIN' }, null, 2),
  },
  {
    method: 'DELETE', url: `${PC_BASE}/transactions/:transactionId`,
    description: 'Delete a transaction line',
  },
];

const PettyCash: React.FC = () => {
  const { user } = useAuth();
  const currentUser = user?.username || 'SYSTEM';

  const [searchForm]    = Form.useForm();
  const [registerForm]  = Form.useForm();
  const [editRegForm]   = Form.useForm();
  const [regActionForm] = Form.useForm();
  const [transferForm]  = Form.useForm();

  const [activeTab, setActiveTab]             = useState('search');
  const [openTabs, setOpenTabs]               = useState<RegisterTab[]>([]);
  const [cashAccountNames, setCashAccountNames] = useState<Map<number, string>>(new Map());
  const [createTabOpen, setCreateTabOpen]     = useState(false);
  const openingKeys = React.useRef<Set<string>>(new Set());

  const [registers, setRegisters]             = useState<PCRegister[]>([]);
  const [searchLoading, setSearchLoading]     = useState(false);
  const [saveLoading, setSaveLoading]         = useState(false);
  const [deleteLoading, setDeleteLoading]     = useState<number | null>(null);
  const [searched, setSearched]               = useState(false);
  const [businessUnits, setBusinessUnits]     = useState<string[]>([]);

  // Edit register header
  const [editRegOpen, setEditRegOpen]         = useState(false);
  const [editRegTarget, setEditRegTarget]     = useState<RegisterTab | null>(null);
  const [editRegLoading, setEditRegLoading]   = useState(false);
  const [coaRegOpen, setCoaRegOpen]           = useState(false);

  // Close / Open register action
  const [regActionOpen, setRegActionOpen]     = useState(false);
  const [regActionTarget, setRegActionTarget] = useState<RegisterTab | null>(null);
  const [regActionLoading, setRegActionLoading] = useState(false);

  // Transfer to New Register
  const [transferOpen, setTransferOpen]       = useState(false);
  const [transferTarget, setTransferTarget]   = useState<RegisterTab | null>(null);
  const [transferSaving, setTransferSaving]   = useState(false);

  // ── Load Business Units on mount ───────────────────────────
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const items: any[] = Array.isArray(data) ? data : (data.items || []);
        setBusinessUnits(items.map((i: any) => i.business_unit_name || '').filter(Boolean));
      })
      .catch(() => {});
  }, []);

  // ── Search ────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setSearchLoading(true);
    try {
      const values = searchForm.getFieldsValue();
      const rows = await searchRegisters({
        q:        values.registerName || undefined,
        status:   values.status       || undefined,
        bu:       values.businessUnit  || undefined,
        dateFrom: values.dateFrom ? values.dateFrom.format('YYYY-MM-DD') : undefined,
        dateTo:   values.dateTo   ? values.dateTo.format('YYYY-MM-DD')   : undefined,
      });
      setRegisters(rows);
      setSearched(true);
    } catch (e: any) {
      message.error(e?.message ?? 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }, [searchForm]);

  useEffect(() => {
    searchForm.setFieldsValue({ status: 'ACTIVE' });
    handleSearch();
  }, []);  // auto-search on mount with ACTIVE default

  // ── Resolve cash account descriptions for open tabs ────────
  useEffect(() => {
    openTabs.forEach(tab => {
      const reg = tab.register;
      if (!reg.cashAccountDesc || cashAccountNames.has(reg.registerId)) return;
      validateAccountCode(reg.cashAccountDesc).then(result => {
        if (!result.segmentsLoaded || !Object.keys(result.segmentDetails).length) return;
        const name = Object.values(result.segmentDetails)
          .filter(d => d.description)
          .map(d => d.description)
          .join(' · ');
        if (name) setCashAccountNames(prev => new Map(prev).set(reg.registerId, name));
      });
    });
  }, [openTabs]);

  // ── Open register detail tab ───────────────────────────────
  const openRegisterTab = useCallback(async (reg: PCRegister) => {
    const key = `reg-${reg.registerId}`;
    // Guard: if already open or currently being opened, just switch to it
    if (openingKeys.current.has(key)) { setActiveTab(key); return; }
    if (openTabs.find(t => t.key === key)) { setActiveTab(key); return; }

    openingKeys.current.add(key);
    const newTab: RegisterTab = { key, register: reg, transactions: [], txnLoading: true };
    setOpenTabs(prev => {
      if (prev.find(t => t.key === key)) return prev;  // double-check inside updater
      return [...prev, newTab];
    });
    setActiveTab(key);

    try {
      const txns = await getTransactions(reg.registerId);
      setOpenTabs(prev => prev.map(t => t.key === key ? { ...t, transactions: txns, txnLoading: false } : t));
    } catch {
      setOpenTabs(prev => prev.map(t => t.key === key ? { ...t, txnLoading: false } : t));
    } finally {
      openingKeys.current.delete(key);
    }
  }, [openTabs]);

  // ── Refresh a tab (register header + transactions) ──────────
  const refreshTab = useCallback(async (key: string) => {
    const tab = openTabs.find(t => t.key === key);
    if (!tab) return;
    setOpenTabs(prev => prev.map(t => t.key === key ? { ...t, txnLoading: true } : t));
    try {
      const [reg, txns] = await Promise.all([
        getRegister(tab.register.registerId),
        getTransactions(tab.register.registerId),
      ]);
      setOpenTabs(prev => prev.map(t => t.key === key ? { ...t, register: reg, transactions: txns, txnLoading: false } : t));
      setRegisters(prev => prev.map(r => r.registerId === reg.registerId ? reg : r));
    } catch {
      setOpenTabs(prev => prev.map(t => t.key === key ? { ...t, txnLoading: false } : t));
    }
  }, [openTabs]);

  // ── Close tab ──────────────────────────────────────────────
  const closeTab = (key: string) => {
    const remaining = openTabs.filter(t => t.key !== key);
    setOpenTabs(remaining);
    if (activeTab === key) setActiveTab(remaining.length ? remaining[remaining.length - 1].key : 'search');
  };

  // ── Create register ────────────────────────────────────────
  const handleCreateRegister = async (values: any) => {
    setSaveLoading(true);
    try {
      const result = await createRegister({
        registerName:    values.registerName,
        businessUnit:    values.businessUnit,
        startDate:       values.startDate ? values.startDate.format('YYYY-MM-DD') : undefined,
        endDate:         values.endDate   ? values.endDate.format('YYYY-MM-DD')   : undefined,
        comments:        values.comments,
        cashAccountDesc: values.cashAccountDesc,
        ownedBy:         values.ownedBy   || null,
        limit:           values.limit     ?? null,
        currency:        values.currency || 'AED',
        status:          values.status   || 'DRAFT',
        createdBy:       currentUser,
      });
      message.success(`Register #${result.registerId} created`);
      registerForm.resetFields();
      setCreateTabOpen(false);
      setActiveTab('search');
      await handleSearch();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to create register');
    } finally {
      setSaveLoading(false);
    }
  };

  // ── Delete register ────────────────────────────────────────
  const handleDelete = async (reg: PCRegister, e: React.MouseEvent) => {
    e.stopPropagation();
    if (reg.status !== 'DRAFT') {
      message.warning(`Only Draft registers can be deleted — "${reg.registerName}" is ${reg.status}`);
      return;
    }
    Modal.confirm({
      title: `Delete "${reg.registerName}"?`,
      content: 'This cannot be undone. Only Draft registers with no transactions can be deleted.',
      okText: 'Delete', okButtonProps: { danger: true },
      onOk: async () => {
        setDeleteLoading(reg.registerId);
        try {
          await deleteRegister(reg.registerId);
          message.success('Register deleted');
          closeTab(`reg-${reg.registerId}`);
          await handleSearch();
        } catch (e: any) {
          message.error(e?.message ?? 'Delete failed');
        } finally {
          setDeleteLoading(null);
        }
      },
    });
  };

  // ── Edit register header ──────────────────────────────────
  const openEditReg = (tab: RegisterTab) => {
    setEditRegTarget(tab);
    editRegForm.setFieldsValue({
      cashAccountDesc: tab.register.cashAccountDesc,
      ownedBy:         tab.register.ownedBy,
      limit:           tab.register.limit,
    });
    setEditRegOpen(true);
  };

  const handleEditRegister = async (values: any) => {
    if (!editRegTarget) return;
    setEditRegLoading(true);
    try {
      await updateRegister(editRegTarget.register.registerId, {
        cashAccountDesc: values.cashAccountDesc || null,
        ownedBy:         values.ownedBy         || null,
        limit:           values.limit           ?? null,
        updatedBy:       currentUser,
      });
      message.success('Register updated');
      setEditRegOpen(false);
      await refreshTab(editRegTarget.key);
      await handleSearch();
    } catch (e: any) {
      message.error(e?.message ?? 'Update failed');
    } finally {
      setEditRegLoading(false);
    }
  };

  // ── Change register status ────────────────────────────────
  const openRegAction = (tab: RegisterTab) => {
    setRegActionTarget(tab);
    regActionForm.setFieldsValue({ status: tab.register.status, comments: '' });
    setRegActionOpen(true);
  };

  const handleRegAction = async (values: any) => {
    if (!regActionTarget) return;
    setRegActionLoading(true);
    const targetKey = regActionTarget.key;
    const targetId  = regActionTarget.register.registerId;
    const prevReg   = regActionTarget.register;
    try {
      await updateRegister(targetId, {
        status:          values.status,
        comments:        values.comments || undefined,
        // Preserve fields the SQL would NULL if not sent (no NVL in update_register)
        limit:           prevReg.limit,
        cashAccountCcid: prevReg.cashAccountCcid,
        cashAccountDesc: prevReg.cashAccountDesc,
        ownedBy:         prevReg.ownedBy,
        updatedBy:       currentUser,
      });
      message.success(`Status changed to ${values.status}`);
      setRegActionOpen(false);
      // Immediately reflect new status so buttons re-enable without waiting for server round-trip
      setOpenTabs(prev => prev.map(t =>
        t.key === targetKey
          ? { ...t, register: { ...t.register, status: values.status } }
          : t
      ));
      // Then refresh to sync full server state
      const [reg, txns] = await Promise.all([getRegister(targetId), getTransactions(targetId)]);
      setOpenTabs(prev => prev.map(t =>
        t.key === targetKey ? { ...t, register: reg, transactions: txns } : t
      ));
      setRegisters(prev => prev.map(r => r.registerId === targetId ? reg : r));
      await handleSearch();
    } catch (e: any) {
      message.error(e?.message ?? 'Action failed');
    } finally {
      setRegActionLoading(false);
    }
  };

  // ── Transfer to New Register ──────────────────────────────
  const openTransfer = (tab: RegisterTab) => {
    // Suspense entries are always Unposted by design — exclude them from the check
    const unposted = tab.transactions.filter(
      t => t.postingStatus !== 'Posted' && t.expenseType !== 'SUSPENSE' && t.expenseType !== 'SUSPENSE_REFUND'
    );
    if (unposted.length > 0) {
      message.error(
        `${unposted.length} transaction(s) are not yet Posted. Account all non-suspense lines before transferring.`
      );
      return;
    }
    setTransferTarget(tab);
    transferForm.setFieldsValue({
      registerName: `${tab.register.registerName} (2)`,
      limit:        tab.register.limit,
      ownedBy:      tab.register.ownedBy,
      startDate:    dayjs(),
    });
    setTransferOpen(true);
  };

  const handleTransfer = async (values: any) => {
    if (!transferTarget) return;
    setTransferSaving(true);
    try {
      // 1. Create new register (inherits BU, currency, cash account from old)
      const newRegResult = await createRegister({
        registerName:    values.registerName,
        businessUnit:    transferTarget.register.businessUnit,
        startDate:       values.startDate ? values.startDate.format('YYYY-MM-DD') : undefined,
        currency:        transferTarget.register.currency,
        limit:           values.limit           ?? null,
        ownedBy:         values.ownedBy          || null,
        cashAccountDesc: transferTarget.register.cashAccountDesc,
        cashAccountCcid: transferTarget.register.cashAccountCcid,
        status:          'ACTIVE',
        createdBy:       currentUser,
      });

      // 2. Get voucher no for the new register's first line
      let bfVoucherNo: string | undefined;
      try { bfVoucherNo = await getNextVoucherNo(newRegResult.registerId); } catch { bfVoucherNo = undefined; }

      // 3. Create 'Balance Brought Fwd' transaction on new register (immediately Posted)
      const txnDate = values.startDate ? values.startDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
      await createTransaction({
        registerId:      newRegResult.registerId,
        transactionDate: txnDate,
        transactionType: 'Balance Brought Fwd',
        currency:        transferTarget.register.currency,
        debitAmount:     transferTarget.register.balance,
        creditAmount:    0,
        suspenseAmount:  0,
        postingStatus:   'Posted',
        comments:        `Balance b/fwd from Register #${transferTarget.register.registerId} — ${transferTarget.register.registerName}`,
        referenceNo:     bfVoucherNo,
        createdBy:       currentUser,
      });

      // 3b. Transfer any open suspense lines to the new register
      const suspenseLines = transferTarget.transactions.filter(
        t => t.expenseType === 'SUSPENSE' && (t.suspenseAmount || 0) > 0
      );
      for (const sl of suspenseLines) {
        await createTransaction({
          registerId:      newRegResult.registerId,
          transactionDate: txnDate,
          transactionType: 'Expense',
          expenseType:     'SUSPENSE',
          currency:        sl.currency,
          debitAmount:     0,
          creditAmount:    0,
          suspenseAmount:  sl.suspenseAmount,
          comments:        `Transferred from Register #${transferTarget.register.registerId} — ${sl.comments || ''}`.trimEnd(),
          postingStatus:   'Unposted',
          createdBy:       currentUser,
        });
        await updateTransaction(sl.transactionId, {
          suspenseAmount: 0,
          comments: `[Transferred to Register #${newRegResult.registerId}] ${sl.comments || ''}`.trimEnd(),
          updatedBy: currentUser,
        });
      }

      // 4. Mark old register as Transferred (preserve fields to avoid NVL nullification)
      await updateRegister(transferTarget.register.registerId, {
        status:          'Transferred',
        comments:        `Transferred to Register #${newRegResult.registerId} — ${values.registerName}`,
        limit:           transferTarget.register.limit,
        cashAccountCcid: transferTarget.register.cashAccountCcid,
        cashAccountDesc: transferTarget.register.cashAccountDesc,
        ownedBy:         transferTarget.register.ownedBy,
        updatedBy:       currentUser,
      });

      setTransferOpen(false);
      message.success(
        `Transfer complete. New register #${newRegResult.registerId} is now open.` +
        (suspenseLines.length > 0 ? ` ${suspenseLines.length} suspense line(s) carried forward.` : '')
      );

      // 5. Refresh old tab (now Transferred — all actions disabled)
      await refreshTab(transferTarget.key);

      // 6. Open the new register tab
      const fullNewReg = await getRegister(newRegResult.registerId);
      await openRegisterTab(fullNewReg);

      await handleSearch();
    } catch (e: any) {
      message.error(e?.message ?? 'Transfer failed');
    } finally {
      setTransferSaving(false);
    }
  };

  // ── Search results columns ─────────────────────────────────
  const searchColumns: ColumnsType<PCRegister> = [
    { title: 'ID', dataIndex: 'registerId', width: 70, align: 'center',
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Register Name', dataIndex: 'registerName', width: 220,
      render: (v, rec) => (
        <Button type="link" style={{ padding: 0, fontSize: 13, fontWeight: 500 }}
          onClick={(e) => { e.stopPropagation(); openRegisterTab(rec); }}>
          {v}
        </Button>
      )},
    { title: 'Business Unit', dataIndex: 'businessUnit', width: 200, ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Currency', dataIndex: 'currency', width: 80, align: 'center',
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Status', dataIndex: 'status', width: 90,
      render: (v) => <StatusTag status={v} /> },
    { title: 'Balance', dataIndex: 'balance', width: 130, align: 'right',
      render: (v, rec) => (
        <Text style={{ fontSize: 13, fontWeight: 600,
          color: v >= 0 ? REDWOOD.success : REDWOOD.error }}>
          {fmt(v)} <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{rec.currency}</span>
        </Text>
      )},
    { title: 'Total In', dataIndex: 'totalDebit', width: 110, align: 'right',
      render: (v) => <Text style={{ fontSize: 12, color: REDWOOD.success }}>{fmt(v)}</Text> },
    { title: 'Total Out', dataIndex: 'totalCredit', width: 110, align: 'right',
      render: (v) => <Text style={{ fontSize: 12, color: REDWOOD.error }}>{fmt(v)}</Text> },
    { title: 'Start Date', dataIndex: 'startDate', width: 100,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'End Date', dataIndex: 'endDate', width: 100,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Owned By', dataIndex: 'ownedBy', width: 130, ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Limit', dataIndex: 'limit', width: 110, align: 'right',
      render: (v, rec) => v != null
        ? <Text style={{ fontSize: 12, fontWeight: 500 }}>{fmt(v)} <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{rec.currency}</span></Text>
        : <Text style={{ fontSize: 12, color: REDWOOD.neutral300 }}>—</Text> },
    { title: 'Cash Account', dataIndex: 'cashAccountDesc', ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Created By', dataIndex: 'createdBy', ellipsis: true,
      render: (v) => <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '—'}</Text> },
    { title: '', key: 'actions', width: 60, align: 'center',
      render: (_, rec) => {
        const canDelete = rec.status === 'DRAFT';
        return (
          <Tooltip title={canDelete ? 'Delete register' : `${rec.status} registers cannot be deleted`}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />}
              loading={deleteLoading === rec.registerId}
              disabled={!canDelete}
              onClick={(e) => handleDelete(rec, e)} />
          </Tooltip>
        );
      }},
  ];

  // ── Tab items ──────────────────────────────────────────────
  const tabItems = [
    // Search tab
    {
      key: 'search',
      label: <Space><SearchOutlined />Registers</Space>,
      children: (
        <div style={{ padding: '12px 0' }}>
          {/* Search form */}
          <Collapse
            defaultActiveKey={['search']}
            style={{ marginBottom: 12, borderRadius: 8 }}
            items={[{
              key: 'search',
              label: <Text style={{ fontWeight: 500 }}>Search Criteria</Text>,
              children: (
                <Form form={searchForm} layout="vertical" size="small">
                  <Row gutter={16}>
                    <Col span={5}>
                      <Form.Item label="Register Name" name="registerName">
                        <Input placeholder="Search by name" allowClear />
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item label="Business Unit" name="businessUnit">
                        <Select placeholder="All BUs" allowClear showSearch
                          filterOption={(v, o) => String(o?.value ?? '').toLowerCase().includes(v.toLowerCase())}>
                          {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item label="Status" name="status">
                        <Select placeholder="All" allowClear>
                          <Option value="DRAFT">Draft</Option>
                          <Option value="ACTIVE">Active</Option>
                          <Option value="INACTIVE">Inactive</Option>
                          <Option value="CLOSED">Closed</Option>
                          <Option value="Transferred">Transferred</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="Start Date From" name="dateFrom">
                        <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="Start Date To" name="dateTo">
                        <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                      </Form.Item>
                    </Col>
                    <Col span={3} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                      <Space>
                        <Button type="primary" icon={<SearchOutlined />}
                          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                          onClick={handleSearch} loading={searchLoading}>
                          Search
                        </Button>
                        <Button icon={<ReloadOutlined />} onClick={() => {
                          searchForm.resetFields(); handleSearch();
                        }}>
                          Reset
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </Form>
              ),
            }]}
          />

          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, color: REDWOOD.neutral600 }}>
              {searched ? `${registers.length} register(s) found` : ''}
            </Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={() => { setCreateTabOpen(true); setActiveTab('create'); }}
            >
              New Register
            </Button>
          </div>

          {/* Results table */}
          <Table<PCRegister>
            dataSource={registers}
            columns={searchColumns}
            rowKey="registerId"
            size="small"
            loading={searchLoading}
            pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} registers` }}
            scroll={{ x: 1100 }}
            onRow={(rec) => ({ onClick: () => openRegisterTab(rec), style: { cursor: 'pointer' } })}
            locale={{ emptyText: 'No registers found. Click New Register to create one.' }}
          />
        </div>
      ),
    },

    // Create Register tab
    ...(createTabOpen ? [{
      key: 'create',
      label: <Space><PlusOutlined />New Register</Space>,
      closable: true,
      children: (
        <div style={{ padding: '16px 0', maxWidth: 680 }}>
          <Title level={5} style={{ marginBottom: 16, color: REDWOOD.neutral900 }}>
            Create Petty Cash Register
          </Title>
          <Form form={registerForm} layout="vertical" size="small" onFinish={handleCreateRegister}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={<><span style={{ color: REDWOOD.primary }}>*</span> Register Name</>}
                  name="registerName" rules={[{ required: true, message: 'Required' }]}>
                  <Input placeholder="e.g. Main Office Petty Cash" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={<><span style={{ color: REDWOOD.primary }}>*</span> Business Unit</>}
                  name="businessUnit" rules={[{ required: true, message: 'Business Unit is required' }]}>
                  <Select placeholder="Select Business Unit" showSearch allowClear
                    filterOption={(v, o) => String(o?.value ?? '').toLowerCase().includes(v.toLowerCase())}>
                    {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Currency" name="currency" initialValue="AED">
                  <Select>
                    {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                      <Option key={c} value={c}>{c}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Status" name="status" initialValue="DRAFT">
                  <Select>
                    <Option value="DRAFT"><Tag color="default" style={{ fontSize: 11 }}>DRAFT</Tag> — set up, not yet active</Option>
                    <Option value="ACTIVE"><Tag color="green" style={{ fontSize: 11 }}>ACTIVE</Tag> — open for transactions</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Start Date" name="startDate">
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="End Date" name="endDate">
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Owned By" name="ownedBy">
                  <Input placeholder="e.g. Finance Dept / John Doe" prefix={<UserOutlined style={{ color: REDWOOD.neutral300 }} />} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Cash Limit" name="limit">
                  <InputNumber placeholder="0.00" style={{ width: '100%' }} min={0} precision={2} prefix={<FieldNumberOutlined style={{ color: REDWOOD.neutral300 }} />} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Cash Account" name="cashAccountDesc">
              <Input.Group compact>
                <Form.Item name="cashAccountDesc" noStyle>
                  <Input style={{ width: 'calc(100% - 40px)' }} placeholder="Select from LOV or type account" readOnly />
                </Form.Item>
                <Tooltip title="Browse GL Accounts">
                  <Button icon={<SearchOutlined />} onClick={() => setCoaRegOpen(true)} />
                </Tooltip>
              </Input.Group>
            </Form.Item>
            <Form.Item label="Comments" name="comments">
              <Input.TextArea rows={3} placeholder="Optional notes" />
            </Form.Item>
            <Divider />
            <Space>
              <Button type="primary" htmlType="submit" loading={saveLoading}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Save Register
              </Button>
              <Button onClick={() => { setCreateTabOpen(false); setActiveTab('search'); registerForm.resetFields(); }}>
                Cancel
              </Button>
            </Space>
          </Form>
        </div>
      ),
    }] : []),

    // Dynamic register detail tabs
    ...openTabs.map((tab) => ({
      key: tab.key,
      label: (
        <Space size={4}>
          <WalletOutlined style={{ color: REDWOOD.success }} />
          <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
            {tab.register.registerName}
          </span>
        </Space>
      ),
      closable: true,
      children: (
        <div style={{ padding: '12px 0' }}>
          {/* ── Register header banner ── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: '#fff',
            border: `1px solid ${REDWOOD.neutral200}`,
            borderLeft: `4px solid ${REDWOOD.primary}`,
            borderRadius: 8, padding: '10px 16px', marginBottom: 14,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryLight} 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <WalletOutlined style={{ color: '#fff', fontSize: 16 }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: REDWOOD.neutral900, lineHeight: 1.2 }}>
                  {tab.register.registerName}
                </div>
                <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', background: REDWOOD.neutral100, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>
                    #{tab.register.registerId}
                  </span>
                  <StatusTag status={tab.register.status} />
                  {tab.register.businessUnit && (
                    <span style={{ color: REDWOOD.neutral600 }}>{tab.register.businessUnit}</span>
                  )}
                  {tab.register.ownedBy && (
                    <span style={{ color: REDWOOD.neutral600 }}>
                      <UserOutlined style={{ marginRight: 3 }} />{tab.register.ownedBy}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Space size={6}>
              <Button size="small" icon={<ReloadOutlined />}
                onClick={() => refreshTab(tab.key)}>
                Refresh
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                disabled={tab.register.status !== 'ACTIVE'}
                onClick={() => openEditReg(tab)}
              >
                Edit Header
              </Button>
              <Button
                size="small"
                icon={<SwapOutlined />}
                onClick={() => openRegAction(tab)}
              >
                Change Status
              </Button>
              {tab.register.status === 'ACTIVE' && (
                <Button
                  size="small"
                  icon={<BranchesOutlined />}
                  onClick={() => openTransfer(tab)}
                  style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                >
                  Transfer to New Register
                </Button>
              )}
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => closeTab(tab.key)}
              >
                Close Tab
              </Button>
            </Space>
          </div>
          <RegisterDetail
            tab={tab}
            onRefresh={() => refreshTab(tab.key)}
            currentUser={currentUser}
            cashAccountName={cashAccountNames.get(tab.register.registerId)}
            businessUnits={businessUnits}
          />
        </div>
      ),
    })),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/ap">Payables</Link> },
            { title: 'Petty Cash Registers' },
          ]}
        />

        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          styles={{ body: { padding: 0 } }}>
          <Tabs
            type="editable-card"
            activeKey={activeTab}
            onChange={setActiveTab}
            hideAdd
            onEdit={(key, action) => { if (action === 'remove') closeTab(key as string); }}
            style={{ padding: '0 16px' }}
            tabBarStyle={{ marginBottom: 0 }}
            tabBarExtraContent={
              <div style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                <WalletOutlined style={{ color: REDWOOD.success }} />
                <Text style={{ fontWeight: 600, color: REDWOOD.neutral900, fontSize: 14 }}>
                  Petty Cash Registers
                </Text>
                <ApiDocsModal title="Petty Cash" endpoints={PC_API_ENDPOINTS} />
              </div>
            }
            items={tabItems}
          />
        </Card>
      </Content>
      <FloatingMenu />

      {/* ── Edit Register Header Modal ─────────────────────── */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: REDWOOD.primary }} />
            Edit Register Header
            <Tooltip
              overlayStyle={{ maxWidth: 480 }}
              title={
                <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  <div style={{ color: '#faad14', marginBottom: 4 }}>PUT</div>
                  {`${APEX_DB_CONFIG.baseUrl}/pc/registers/${editRegTarget?.register.registerId ?? ':id'}`}
                </div>
              }
            >
              <ApiOutlined style={{ color: REDWOOD.neutral300, fontSize: 13, cursor: 'help' }} />
            </Tooltip>
          </Space>
        }
        open={editRegOpen}
        onCancel={() => setEditRegOpen(false)}
        onOk={() => editRegForm.submit()}
        okText="Save"
        confirmLoading={editRegLoading}
        width={520}
        destroyOnClose
      >
        <Form form={editRegForm} layout="vertical" size="small" onFinish={handleEditRegister} style={{ marginTop: 16 }}>
          <Form.Item label="Owned By" name="ownedBy">
            <Input placeholder="e.g. Finance Dept / John Doe" prefix={<UserOutlined style={{ color: REDWOOD.neutral300 }} />} />
          </Form.Item>
          <Form.Item label="Cash Limit" name="limit">
            <InputNumber placeholder="0.00" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item label="Cash Account" name="cashAccountDesc">
            <Input.Group compact>
              <Form.Item name="cashAccountDesc" noStyle>
                <Input style={{ width: 'calc(100% - 40px)' }} placeholder="Select from LOV or type account" readOnly />
              </Form.Item>
              <Tooltip title="Browse GL Accounts">
                <Button icon={<SearchOutlined />} onClick={() => setCoaRegOpen(true)} />
              </Tooltip>
            </Input.Group>
          </Form.Item>

          {/* Live JSON preview */}
          <Form.Item shouldUpdate style={{ marginBottom: 0 }}>
            {() => {
              const v = editRegForm.getFieldsValue();
              const body = {
                cashAccountDesc: v.cashAccountDesc || null,
                ownedBy:         v.ownedBy         || null,
                limit:           v.limit           ?? null,
                updatedBy:       currentUser,
              };
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <ApiOutlined style={{ color: REDWOOD.info, fontSize: 12 }} />
                    <span style={{ fontSize: 11, color: REDWOOD.neutral600, fontFamily: 'monospace' }}>
                      PUT {`${APEX_DB_CONFIG.baseUrl}/pc/registers/${editRegTarget?.register.registerId ?? ':id'}`}
                    </span>
                  </div>
                  <pre style={{
                    background: '#1e1e1e', color: '#d4d4d4',
                    borderRadius: 6, padding: '8px 12px',
                    fontSize: 11, fontFamily: 'monospace',
                    margin: 0, overflowX: 'auto', lineHeight: 1.5,
                  }}>
                    {JSON.stringify(body, null, 2)}
                  </pre>
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Change Status Modal ────────────────────────────── */}
      <Modal
        title={
          <Space>
            <SwapOutlined style={{ color: REDWOOD.primary }} />
            Change Register Status
            <Tag style={{ fontSize: 11 }}>{regActionTarget?.register.registerName}</Tag>
          </Space>
        }
        open={regActionOpen}
        onCancel={() => setRegActionOpen(false)}
        onOk={() => regActionForm.submit()}
        okText="Apply"
        okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        confirmLoading={regActionLoading}
        width={420}
        destroyOnClose
      >
        <Form form={regActionForm} layout="vertical" size="small" onFinish={handleRegAction} style={{ marginTop: 16 }}>
          <Form.Item label="New Status" name="status" rules={[{ required: true, message: 'Select a status' }]}>
            <Select>
              <Option value="DRAFT"><Tag color="default" style={{ fontSize: 11 }}>DRAFT</Tag> — set up, not yet active</Option>
              <Option value="ACTIVE"><Tag color="green" style={{ fontSize: 11 }}>ACTIVE</Tag> — open for transactions</Option>
              <Option value="INACTIVE"><Tag color="orange" style={{ fontSize: 11 }}>INACTIVE</Tag> — temporarily suspended</Option>
              <Option value="CLOSED"><Tag color="red" style={{ fontSize: 11 }}>CLOSED</Tag> — permanently closed</Option>
            </Select>
          </Form.Item>
          <Form.Item label="Comments" name="comments">
            <Input.TextArea rows={3} placeholder="Reason for status change…" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Transfer to New Register Modal ───────────────── */}
      <Modal
        title={
          <Space>
            <BranchesOutlined style={{ color: REDWOOD.info }} />
            Transfer to New Register
            <Tag style={{ fontSize: 11 }}>{transferTarget?.register.registerName}</Tag>
          </Space>
        }
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        onOk={() => transferForm.submit()}
        okText="Transfer"
        okButtonProps={{ style: { background: REDWOOD.info, borderColor: REDWOOD.info } }}
        confirmLoading={transferSaving}
        width={620}
        destroyOnClose
      >
        {transferTarget && (
          <>
            <Alert
              type="info"
              showIcon
              icon={<WalletOutlined />}
              message={
                <span>
                  Balance to carry forward:{' '}
                  <strong>
                    {fmt(transferTarget.register.balance)} {transferTarget.register.currency}
                  </strong>
                </span>
              }
              style={{ marginBottom: 16 }}
            />
            <Form
              form={transferForm}
              layout="vertical"
              size="small"
              onFinish={handleTransfer}
              style={{ marginTop: 8 }}
            >
              <Form.Item
                label="New Register Name"
                name="registerName"
                rules={[{ required: true, message: 'Register name is required' }]}
              >
                <Input prefix={<WalletOutlined style={{ color: REDWOOD.neutral300 }} />} />
              </Form.Item>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Business Unit">
                    <Input
                      value={transferTarget.register.businessUnit}
                      readOnly
                      style={{ background: '#f5f5f5', cursor: 'not-allowed' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Currency">
                    <Input
                      value={transferTarget.register.currency}
                      readOnly
                      style={{ background: '#f5f5f5', cursor: 'not-allowed' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Start Date" name="startDate">
                    <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Cash Limit" name="limit">
                    <InputNumber
                      placeholder="0.00"
                      style={{ width: '100%' }}
                      min={0}
                      precision={2}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Owned By" name="ownedBy">
                <Input
                  placeholder="e.g. Finance Dept / John Doe"
                  prefix={<UserOutlined style={{ color: REDWOOD.neutral300 }} />}
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      {/* ── GL Account LOV for Register form ──────────────── */}
      <AccountSelector
        visible={coaRegOpen}
        onCancel={() => setCoaRegOpen(false)}
        onSelect={(accountCode, segmentDetails) => {
          const name = Object.values(segmentDetails)
            .filter(d => d.description)
            .map(d => d.description)
            .join(' · ');
          if (editRegOpen) {
            editRegForm.setFieldsValue({ cashAccountDesc: accountCode });
            if (editRegTarget && name) {
              setCashAccountNames(prev => new Map(prev).set(editRegTarget.register.registerId, name));
            }
          } else {
            registerForm.setFieldsValue({ cashAccountDesc: accountCode });
          }
          setCoaRegOpen(false);
        }}
      />
    </Layout>
  );
};

export default PettyCash;
