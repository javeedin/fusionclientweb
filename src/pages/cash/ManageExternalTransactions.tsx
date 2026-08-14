import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAccountDescriptions } from '../../hooks/useAccountDescriptions';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  DatePicker, InputNumber, Row, Col, Space, Tag, Tooltip, Tabs, Collapse,
  message, Empty, Divider, Badge, Modal, Alert, Spin, Segmented, Upload, Popconfirm, AutoComplete,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, BankOutlined, PlusOutlined, SearchOutlined, ReloadOutlined,
  EditOutlined, CloseOutlined, DollarOutlined, ApiOutlined, FileTextOutlined,
  SwapOutlined, DownloadOutlined, CheckCircleOutlined, SyncOutlined,
  AccountBookOutlined, EyeOutlined, UploadOutlined, PaperClipOutlined, DeleteOutlined,
  LockOutlined, PrinterOutlined, FilePdfOutlined, QuestionCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined, RollbackOutlined, CopyOutlined,
  SendOutlined, AuditOutlined, BugOutlined,
} from '@ant-design/icons';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import AccountSelector, { validateAccountCode } from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import {
  buildPcBankTxnSlaPayload, fetchLedgerByBusinessUnit, derivePeriodName, createAccounting,
} from '../../services/sla.service';
import { getGlJournalLines } from '../../services/glPosting.service';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { searchCombinations, type DistCombination } from '../../services/distCombinations.service';
import { validateGlPayload, persistValidationLog, type GlJournalPayload } from '../../services/glValidation.service';
import { useGlValidation } from '../../context/GlValidationContext';
import { getApprovalUsers, getApprovalRules, sendExternalTxnApproval, type ApprovalUser } from '../../services/approvals.service';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  textSecondary: '#6B6B6B',
};

const APEX_BASE = buildApexUrl('');

// ── Types ────────────────────────────────────────────────────────────────────
interface ExternalTxnRecord {
  externalTransactionId: number;
  transactionId: number;
  transactionDate: string;
  valueDate: string;
  clearedDate: string;
  amount: number;
  currencyCode: string;
  description: string;
  referenceText: string;
  source: string;
  status: string;
  transactionType: string;
  accountingFlag: string;
  bankAccountName: string;
  businessUnitName: string;
  legalEntityName: string;
  assetAccountCombination: string;
  offsetAccountCombination: string;
  bankConversionRate: number;
  bankConversionRateType: string;
  bankConversionDate?: string;
  transferId: number;
  checkNumber: string;
  reconReference: string;
  createdBy: string;
  creationDate: string;
  lastUpdateDate: string;
  syncDate: string;
  transactionDirection?: string;
  paymentMethod?: string;
  paymentDocument?: string;
  paperDocumentNumber?: string;
  payeeName?: string;
  payeeId?: number;
  approvalStatus?: string;
  approvalSentDate?: string;
  approvalSentBy?: string;
  approvalApproverName?: string;
  approvalApproverEmail?: string;
  approvedDate?: string;
  approvalRef?: string;
}

interface BankAccountOption { label: string; value: string; }
interface BUOption          { label: string; value: string; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const parseApexJson = async (res: Response) => {
  const text = await res.text();

  // Pass 1: fix Oracle numeric quirks (.428 → 0.428, 100., → 100)
  const fixNums = (s: string) => s
    .replace(/:(-?)\.(\d)/g, ':$10.$2')
    .replace(/(\d)\.([,}\]])/g, '$1$2');

  // Pass 2: strip/escape raw control chars (literal newlines etc.)
  const fixCtrl = (s: string) =>
    s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
     .replace(/\x0a/g, '\\n')
     .replace(/\x0d/g, '\\r');

  // Pass 3: context-aware unescaped-quote repair.
  //
  // The previous look-ahead heuristic failed when an unescaped `"` inside a
  // VALUE string was followed by `:` — it was wrongly treated as a closing
  // quote, turning `"desc": "Note: "see attached""` into a parse error.
  //
  // This pass tracks object/array nesting and key-vs-value position:
  //   • KEY context   → close the string on `"` followed by `:`
  //   • VALUE context → close the string only on `"` followed by `,`, `}`, `]`,
  //                     or end-of-input; everything else (including `:`) is an
  //                     interior unescaped quote and gets escaped to `\"`
  const fixQuotes = (s: string): string => {
    type Ctx = { inObj: boolean; afterColon: boolean };
    const stack: Ctx[] = [];
    let out = '';
    let i   = 0;

    const inValCtx = (): boolean => {
      if (!stack.length) return false;
      const t = stack[stack.length - 1];
      return !t.inObj || t.afterColon; // array elements are always values
    };

    const skipWs = (from: number): number => {
      let j = from;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      return j;
    };

    while (i < s.length) {
      const ch = s[i];
      if      (ch === '{') { stack.push({ inObj: true,  afterColon: false }); out += ch; i++; }
      else if (ch === '[') { stack.push({ inObj: false, afterColon: false }); out += ch; i++; }
      else if (ch === '}' || ch === ']') { stack.pop(); out += ch; i++; }
      else if (ch === ':') {
        if (stack.length && stack[stack.length - 1].inObj) stack[stack.length - 1].afterColon = true;
        out += ch; i++;
      }
      else if (ch === ',') {
        if (stack.length && stack[stack.length - 1].inObj) stack[stack.length - 1].afterColon = false;
        out += ch; i++;
      }
      else if (ch !== '"') { out += ch; i++; }
      else {
        // Opening quote — enter string
        const isVal = inValCtx();
        out += '"'; i++;

        while (i < s.length) {
          const sc = s[i];
          if (sc === '\\') {
            // Already-escaped sequence — pass through verbatim
            out += sc; i++;
            if (i < s.length) { out += s[i]; i++; }
          } else if (sc !== '"') {
            out += sc; i++;
          } else {
            // `"` encountered — closing or interior?
            const nwsIdx = skipWs(i + 1);
            const next   = nwsIdx < s.length ? s[nwsIdx] : '';
            if (!isVal) {
              // KEY context: close only when followed by `:` (or end, for safety)
              if (next === ':' || nwsIdx >= s.length) { out += '"'; i++; break; }
              else { out += '\\"'; i++; }
            } else {
              // VALUE context: close only on `,`, `}`, `]`, or end-of-input
              // A `"` followed by `:` here means an unescaped interior quote
              if (next === ',' || next === '}' || next === ']' || nwsIdx >= s.length) {
                out += '"'; i++; break;
              } else {
                out += '\\"'; i++;
              }
            }
          }
        }

        // Reset afterColon after consuming a value string
        if (isVal && stack.length && stack[stack.length - 1].inObj) {
          stack[stack.length - 1].afterColon = false;
        }
      }
    }
    return out;
  };

  const repair = (s: string) => fixNums(fixCtrl(s));

  try {
    return JSON.parse(repair(text));
  } catch {
    return JSON.parse(fixQuotes(repair(text)));
  }
};

const fmtAmount = (val?: number, ccy?: string) => {
  if (val == null) return '—';
  const s = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  return ccy ? `${s} ${ccy}` : s;
};

const fmtDate = (d?: string) => {
  if (!d) return '—';
  try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; }
};

const statusColor = (s: string) => {
  const m: Record<string, string> = {
    REC: 'success', UNR: 'default', CLR: 'processing', CAN: 'error',
  };
  return m[s] ?? 'default';
};

const statusLabel = (s: string) => {
  const m: Record<string, string> = {
    REC: 'Reconciled', UNR: 'Unreconciled', CLR: 'Cleared', CAN: 'Cancelled',
  };
  return m[s] ?? s;
};

interface BankAcctProgressRow {
  extTxnId:      number;
  txnDate:       string;
  periodName:    string;
  amount:        number;
  currency:      string;
  drAccount:     string;
  crAccount:     string;
  drAccountDesc?: string;
  crAccountDesc?: string;
  bu:            string;
  // Rate + currencies so the preview can show entered (txn currency) vs accounted
  // (ledger currency = entered × rate) amounts on each journal line.
  rate?:         number;
  enteredCurrency?: string;
  ledgerCurrency?:  string;
  status:        'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?:      string;
}

const SOURCE_LABELS: Record<string, string> = {
  ORA_BAT: 'Bank', ORA_MAN: 'Manual', ORA_STA: 'Statement',
};

// ── Tab management ───────────────────────────────────────────────────────────
let tabCounter = 0;
const newTabKey = () => `tab_${++tabCounter}`;

// ────────────────────────────────────────────────────────────────────────────
// Create / Edit Form
// ────────────────────────────────────────────────────────────────────────────
interface ExtTxnLine { key: number; amount?: number; description: string; offsetAccount: string; offsetDesc: string; }

interface PayeeOption { label: string; value: number; payeeName: string; }

// ── View Accounting Modal ─────────────────────────────────────────────────────
const ts = (extra?: React.CSSProperties): React.CSSProperties => ({
  padding: '7px 10px', border: '1px solid #e5e7eb', ...extra,
});

const ViewAcctModal: React.FC<{
  open: boolean;
  txn: any;
  hdr: any;
  lines: any[];
  loading: boolean;
  onClose: () => void;
}> = ({ open, txn, hdr, lines, loading, onClose }) => {
  const [apiOpen, setApiOpen] = useState(false);
  const [apiRefreshing, setApiRefreshing] = useState(false);
  const [apiUrls, setApiUrls] = useState({ headers: '', lines: '' });
  const [apiResponse, setApiResponse] = useState<{ headers: any; lines: any } | null>(null);

  // Resolve each account combination → natural-account segment description so we
  // can show it beneath the code in the Account column. Hook runs unconditionally.
  const acctCodes = useMemo(() => {
    const fromLines = (lines ?? []).map((l: any) => l.accountCombination).filter(Boolean);
    const fb = txn ? [txn.assetAccountCombination, txn.offsetAccountCombination] : [];
    return [...fromLines, ...fb].filter(Boolean) as string[];
  }, [lines, txn]);
  const acctDescMap = useAccountDescriptions(acctCodes);

  // Capture and set actual API URLs on mount
  useEffect(() => {
    if (open && txn && apiUrls.headers === '') {
      const lnUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${encodeURIComponent(String(txn.externalTransactionId))}&reference5=BANK_EXTERNAL_TRANSACTIONS`;
      setApiUrls({ headers: lnUrl, lines: lnUrl });
    }
  }, [open, txn]);

  // Refresh API call
  const refreshApi = useCallback(async () => {
    if (!txn) return;
    setApiRefreshing(true);
    try {
      const lnUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${encodeURIComponent(String(txn.externalTransactionId))}&reference5=BANK_EXTERNAL_TRANSACTIONS`;
      setApiUrls({ headers: lnUrl, lines: lnUrl });
      const lRes = await getGlJournalLines({
        reference2: txn.externalTransactionId,
        reference5: 'BANK_EXTERNAL_TRANSACTIONS',
      });
      const items = lRes.items || [];
      if (items.length > 0) {
        const firstLine = items[0];
        const hdr = {
          glBatchName: firstLine.batch_name,
          glBatchId: firstLine.je_batch_id,
          glHeaderId: firstLine.je_header_id,
          periodName: firstLine.period_name,
          accountingDate: firstLine.accounting_date,
          moduleName: firstLine.je_category || 'Cash Management',
          postingStatus: firstLine.journal_status || 'POSTED',
        };
        const formattedLines = items.map((line: any) => ({
          lineId: line.line_id,
          lineNumber: line.line_num,
          lineType: line.entered_dr ? 'DR' : 'CR',
          accountCombination: line.account,
          accountDescription: line.description,
          enteredDr: line.entered_dr,
          enteredCr: line.entered_cr,
          accountedDr: line.accounted_dr,
          accountedCr: line.accounted_cr,
          currency: line.currency_code,
        }));
        setViewAcctHeader(hdr);
        setViewAcctLines(formattedLines);
      }
      setApiResponse({ headers: lRes, lines: lRes });
      message.success('API refreshed successfully');
    } catch (e: any) {
      message.error('API refresh failed: ' + e.message);
    } finally {
      setApiRefreshing(false);
    }
  }, [txn]);

  if (!txn) return null;

  const direction = txn.transactionDirection ?? ((txn.amount ?? 0) >= 0 ? 'DR' : 'CR');
  const absAmount = Math.abs(txn.amount ?? 0);
  const exRate    = txn.bankConversionRate ?? 1;
  const ledgerCcy = 'AED';
  const entrCcy   = hdr?.currencyCode || txn.currencyCode || ledgerCcy;

  const liveLines  = lines.length > 0;
  const acctedAmtFb = Math.round(absAmount * exRate * 100) / 100;

  const totalEntDr = liveLines ? lines.reduce((s: number, l: any) => s + (l.enteredDr || 0), 0) : absAmount;
  const totalEntCr = liveLines ? lines.reduce((s: number, l: any) => s + (l.enteredCr || 0), 0) : absAmount;
  const totalAccDr = liveLines ? lines.reduce((s: number, l: any) => s + (l.accountedDr || 0), 0) : acctedAmtFb;
  const totalAccCr = liveLines ? lines.reduce((s: number, l: any) => s + (l.accountedCr || 0), 0) : acctedAmtFb;

  const dirTagColor   = direction === 'DR' ? 'blue' : 'green';
  const dirLabel      = direction === 'DR' ? '▲ DR — Money In' : '▼ CR — Money Out';
  const drAcctFb      = direction === 'DR' ? txn.assetAccountCombination : txn.offsetAccountCombination;
  const crAcctFb      = direction === 'DR' ? txn.offsetAccountCombination : txn.assetAccountCombination;
  const drLabelFb     = direction === 'DR' ? 'Bank / Asset Account' : 'Offset Account';
  const crLabelFb     = direction === 'DR' ? 'Offset Account' : 'Bank / Asset Account';

  let hdStatusColor = 'default';
  if (hdr) {
    if (hdr.postingStatus === 'POSTED') hdStatusColor = 'success';
    else if (hdr.accountingStatus === 'FINAL') hdStatusColor = 'processing';
  }

  const batchInfoEl = loading
    ? (
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <Spin size="small" />
        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>Loading journal details…</Typography.Text>
      </div>
    )
    : hdr
      ? (
        <div style={{ marginBottom: 12 }}>
          {/* GL Journal Header strip */}
          <div style={{ background: '#e6f4ff', border: '1px solid #91caff', borderRadius: '6px 6px 0 0', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: '#0572CE' }} />
            <Typography.Text strong style={{ fontSize: 12, color: '#0572CE' }}>GL Journal Header</Typography.Text>
          </div>
          <div style={{ border: '1px solid #91caff', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '10px 14px', background: '#fff' }}>
            <Row gutter={[16, 8]}>
              <Col xs={24} md={6}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Journal Name</Typography.Text>
                <Typography.Text strong style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{hdr.glBatchName || '—'}</Typography.Text>
              </Col>
              <Col xs={12} md={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>JE Batch ID</Typography.Text>
                <Typography.Text code style={{ fontSize: 12 }}>{hdr.glBatchId || '—'}</Typography.Text>
              </Col>
              <Col xs={12} md={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>JE Header ID</Typography.Text>
                <Typography.Text code style={{ fontSize: 12 }}>{hdr.glHeaderId || '—'}</Typography.Text>
              </Col>
              <Col xs={12} md={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Period</Typography.Text>
                <Typography.Text strong style={{ fontSize: 12 }}>{hdr.periodName || '—'}</Typography.Text>
              </Col>
              <Col xs={12} md={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Accounting Date</Typography.Text>
                <Typography.Text style={{ fontSize: 12 }}>{fmtDate(hdr.accountingDate)}</Typography.Text>
              </Col>
              <Col xs={12} md={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Status</Typography.Text>
                <Tag color={hdr.postingStatus === 'POSTED' ? 'success' : 'default'} style={{ fontSize: 11 }}>{hdr.postingStatus || '—'}</Tag>
              </Col>
              <Col xs={12} md={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Category</Typography.Text>
                <Typography.Text style={{ fontSize: 12 }}>{hdr.moduleName || '—'}</Typography.Text>
              </Col>
            </Row>
          </div>
        </div>
      )
      : null;

  const liveRows = lines.map((l: any, i: number) => {
    const lineColor = l.lineType === 'DR' ? '#0572CE' : '#389e0d';
    const rowBg     = i % 2 === 1 ? '#f9fafb' : undefined;
    const descLines = (l.accountDescription || '').split('\n').filter((s: string) => s.trim());
    return (
      <>
        <tr key={l.lineId ?? i} style={{ background: rowBg, verticalAlign: 'top' }}>
          <td style={ts({ textAlign: 'center', color: '#6b7280' })}>{l.lineNumber ?? i + 1}</td>
          <td style={ts({ fontWeight: 700, color: lineColor })}>{l.lineType}</td>
          <td style={ts()}>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{l.accountCombination || '—'}</div>
            {acctDescMap[l.accountCombination] && (
              <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 400, whiteSpace: 'normal', marginTop: 2 }}>{acctDescMap[l.accountCombination]}</div>
            )}
          </td>
          <td style={ts({ fontSize: 10, lineHeight: 1.4, maxWidth: 250 })}>
            {descLines.length > 0 ? descLines.map((line: string, idx: number) => (
              <div key={idx} style={{ whiteSpace: 'normal' }}>{line}</div>
            )) : '—'}
          </td>
          <td style={ts({ textAlign: 'right', color: '#0572CE', fontWeight: l.enteredDr ? 600 : 400 })}>
            {l.enteredDr ? fmtAmount(l.enteredDr) : '—'}
          </td>
          <td style={ts({ textAlign: 'right', color: '#389e0d', fontWeight: l.enteredCr ? 600 : 400 })}>
            {l.enteredCr ? fmtAmount(l.enteredCr) : '—'}
          </td>
          <td style={ts({ textAlign: 'right', color: '#0572CE', fontWeight: l.accountedDr ? 600 : 400 })}>
            {l.accountedDr ? fmtAmount(l.accountedDr) : '—'}
          </td>
          <td style={ts({ textAlign: 'right', color: '#389e0d', fontWeight: l.accountedCr ? 600 : 400 })}>
            {l.accountedCr ? fmtAmount(l.accountedCr) : '—'}
          </td>
        </tr>
        {i === 0 && (
          <tr style={{ background: '#f0f5ff', verticalAlign: 'top' }}>
            <td colSpan={8} style={ts({ padding: '8px 10px' })}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#0572CE', marginBottom: 6 }}>GL References</div>
              <Row gutter={[12, 4]} style={{ fontSize: 11 }}>
                <Col xs={12} md={6}><span style={{ color: '#6b7280' }}>Ref1:</span> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.reference1 || '—'}</span></Col>
                <Col xs={12} md={6}><span style={{ color: '#6b7280' }}>Ref2:</span> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.reference2 || '—'}</span></Col>
                <Col xs={12} md={6}><span style={{ color: '#6b7280' }}>Ref3:</span> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.reference3 || '—'}</span></Col>
                <Col xs={12} md={6}><span style={{ color: '#6b7280' }}>Ref4:</span> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.reference4 || '—'}</span></Col>
                <Col xs={12} md={6}><span style={{ color: '#6b7280' }}>Ref5:</span> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.reference5 || '—'}</span></Col>
              </Row>
            </td>
          </tr>
        )}
      </>
    );
  });

  const fallbackRows = [
    <tr key="dr">
      <td style={ts({ textAlign: 'center' })}>1</td>
      <td style={ts({ fontWeight: 700, color: '#0572CE' })}>DR</td>
      <td style={ts()}>
        <div>{drAcctFb || '—'}</div>
        {acctDescMap[drAcctFb] && <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 400, whiteSpace: 'normal' }}>{acctDescMap[drAcctFb]}</div>}
      </td>
      <td style={ts({ fontSize: 10 })}>{drLabelFb}</td>
      <td style={ts({ fontSize: 10 })}>—</td>
      <td style={ts({ textAlign: 'right', color: '#0572CE', fontWeight: 600 })}>{fmtAmount(absAmount)}</td>
      <td style={ts({ textAlign: 'right' })}>—</td>
      <td style={ts({ textAlign: 'right', color: '#0572CE', fontWeight: 600 })}>{fmtAmount(acctedAmtFb)}</td>
      <td style={ts({ textAlign: 'right' })}>—</td>
    </tr>,
    <tr key="cr" style={{ background: '#f9fafb' }}>
      <td style={ts({ textAlign: 'center' })}>2</td>
      <td style={ts({ fontWeight: 700, color: '#389e0d' })}>CR</td>
      <td style={ts()}>
        <div>{crAcctFb || '—'}</div>
        {acctDescMap[crAcctFb] && <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 400, whiteSpace: 'normal' }}>{acctDescMap[crAcctFb]}</div>}
      </td>
      <td style={ts({ fontSize: 10 })}>{crLabelFb}</td>
      <td style={ts({ fontSize: 10 })}>—</td>
      <td style={ts({ textAlign: 'right' })}>—</td>
      <td style={ts({ textAlign: 'right', color: '#389e0d', fontWeight: 600 })}>{fmtAmount(absAmount)}</td>
      <td style={ts({ textAlign: 'right' })}>—</td>
      <td style={ts({ textAlign: 'right', color: '#389e0d', fontWeight: 600 })}>{fmtAmount(acctedAmtFb)}</td>
    </tr>,
  ];

  return (
    <>
    <Modal
      title={<Space><EyeOutlined style={{ color: '#389e0d' }} />View Accounting</Space>}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Tooltip title="View API details">
            <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }}
              onClick={() => setApiOpen(true)} />
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} loading={apiRefreshing} onClick={refreshApi}>Refresh</Button>
          <Button onClick={onClose}>Close</Button>
        </Space>
      }
      width={980}
      destroyOnClose
    >
      {/* Transaction Info */}
      <div style={{ background: '#f9fafb', borderRadius: 6, padding: '12px 16px', marginBottom: 12 }}>
        <Row gutter={[16, 8]}>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Transaction ID</Typography.Text>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{txn.transactionId || txn.externalTransactionId}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Txn Date</Typography.Text>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{fmtDate(txn.transactionDate)}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Amount (Entered)</Typography.Text>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0572CE' }}>{fmtAmount(absAmount, entrCcy)}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Direction</Typography.Text>
            <Tag color={dirTagColor} style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{dirLabel}</Tag>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Business Unit</Typography.Text>
            <div style={{ fontSize: 13 }}>{txn.businessUnitName || '—'}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Reference</Typography.Text>
            <div style={{ fontSize: 13 }}>{txn.referenceText || '—'}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Conv. Rate</Typography.Text>
            <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{exRate} ({txn.bankConversionRateType || 'Corporate'})</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Ledger Currency</Typography.Text>
            <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{ledgerCcy}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>JE Batch ID</Typography.Text>
            <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', color: REDWOOD.info }}>{hdr?.glBatchId || '—'}</div>
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>JE Header ID</Typography.Text>
            <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', color: REDWOOD.info }}>{hdr?.glHeaderId || '—'}</div>
          </Col>
        </Row>
      </div>

      {/* GL Journal Header info */}
      {liveLines && batchInfoEl}

      {/* Data Source Indicator */}
      {liveLines ? (
        <Alert type="success" message="✓ GL Journal Data Found" description="Real journal data fetched from /gl/journals/lines"
          style={{ marginBottom: 12 }} showIcon />
      ) : (
        <Alert type="info" message="ℹ No Accounting Entry" description="No GL journal lines found for this transaction."
          style={{ marginBottom: 12 }} showIcon />
      )}

      {/* Journal Lines table */}
      {liveLines ? (
        <>
          <div style={{ fontWeight: 600, fontSize: 11, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            GL Journal Lines
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={ts({ textAlign: 'center', width: 32 })}>#</th>
                <th style={ts({ textAlign: 'left', width: 38 })}>DR/CR</th>
                <th style={ts({ textAlign: 'left', minWidth: 200 })}>GL Account</th>
                <th style={ts({ textAlign: 'left', minWidth: 180, fontSize: 10 })}>Description</th>
                <th colSpan={2} style={ts({ textAlign: 'center', background: '#e6f4ff', color: '#0572CE' })}>
                  Entered
                </th>
                <th colSpan={2} style={ts({ textAlign: 'center', background: '#f6ffed', color: '#389e0d' })}>
                  Accounted
                </th>
              </tr>
              <tr style={{ background: '#f9fafb' }}>
                <th style={ts()} /><th style={ts()} /><th style={ts()} /><th style={ts()} />
                <th style={ts({ textAlign: 'right', background: '#e6f4ff', fontSize: 10 })}>DR</th>
                <th style={ts({ textAlign: 'right', background: '#e6f4ff', fontSize: 10 })}>CR</th>
                <th style={ts({ textAlign: 'right', background: '#f6ffed', fontSize: 10 })}>DR</th>
                <th style={ts({ textAlign: 'right', background: '#f6ffed', fontSize: 10 })}>CR</th>
              </tr>
            </thead>
            <tbody>{liveRows}</tbody>
          </table>
        </>
      ) : null}

      {/* Totals */}
      {liveLines && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '5px 10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 4px 4px', fontSize: 11 }}>
          <Typography.Text>Entered DR: <Typography.Text strong style={{ color: '#0572CE' }}>{fmtAmount(totalEntDr, entrCcy)}</Typography.Text></Typography.Text>
          <Typography.Text>Entered CR: <Typography.Text strong style={{ color: '#389e0d' }}>{fmtAmount(totalEntCr, entrCcy)}</Typography.Text></Typography.Text>
          <Typography.Text>Accounted DR: <Typography.Text strong style={{ color: '#0572CE' }}>{fmtAmount(totalAccDr, ledgerCcy)}</Typography.Text></Typography.Text>
          <Typography.Text>Accounted CR: <Typography.Text strong style={{ color: '#389e0d' }}>{fmtAmount(totalAccCr, ledgerCcy)}</Typography.Text></Typography.Text>
        </div>
      )}
    </Modal>

    {/* API Inspector Drawer */}
    <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> API Inspector</Space>}
      open={apiOpen} onCancel={() => setApiOpen(false)} footer={null} width={900}
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Alert type="info" message="Querying GL Journal Lines directly by reference2 (External Transaction ID) and reference5 (BANK_EXTERNAL_TRANSACTIONS)"
          style={{ marginBottom: 8 }} showIcon />

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            <Tag color="blue">GET</Tag> GL Journal Lines
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 6, padding: 12, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
            {apiUrls.lines || `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${encodeURIComponent(String(txn?.externalTransactionId || ''))}&reference5=BANK_EXTERNAL_TRANSACTIONS`}
          </div>
          <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginTop: 6 }}
            onClick={() => { navigator.clipboard.writeText(apiUrls.lines || `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${encodeURIComponent(String(txn?.externalTransactionId || ''))}&reference5=BANK_EXTERNAL_TRANSACTIONS`); message.success('Copied'); }}>
            Copy URL
          </Button>
        </div>

        <Divider />

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Identifiers</div>
          <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12, fontSize: 12 }}>
            <div><Text type="secondary">External Transaction ID:</Text> <Text code>{txn?.externalTransactionId}</Text></div>
            <div style={{ marginTop: 6 }}><Text type="secondary">SLA Header ID (headerId):</Text> <Text code>{hdr?.headerId || '—'}</Text></div>
            <div style={{ marginTop: 6 }}><Text type="secondary">GL Batch ID:</Text> <Text code>{hdr?.glBatchId || '—'}</Text></div>
            <div style={{ marginTop: 6 }}><Text type="secondary">GL Header ID:</Text> <Text code>{hdr?.glHeaderId || '—'}</Text></div>
            <div style={{ marginTop: 6 }}><Text type="secondary">Module:</Text> <Text code>CASH</Text></div>
          </div>
        </div>

        <Divider />

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>API Response Preview</div>
            <Button size="small" type="text" loading={apiRefreshing} onClick={refreshApi}>Refresh Response</Button>
          </div>
          {apiResponse ? (
            <>
              {(!apiResponse.lines?.items || apiResponse.lines.items.length === 0) && (
                <Alert type="error" message="No Journal Data" description="API returned empty response for /gl/journals/lines"
                  style={{ marginBottom: 8 }} showIcon />
              )}
              <div style={{ background: '#f5f5f5', borderRadius: 6, padding: 12, maxHeight: 300, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: REDWOOD.neutral900 }}>
                {JSON.stringify(apiResponse.lines, null, 2)}
              </div>
            </>
          ) : (
            <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12, color: REDWOOD.neutral600, fontSize: 12 }}>
              Click "Refresh Response" to fetch and display the API response
            </div>
          )}
        </div>
      </div>
    </Modal>
    </>
  );
};

const ExternalTxnForm: React.FC<{
  initialValues?: Partial<ExternalTxnRecord>;
  bankAccounts: BankAccountOption[];
  businessUnits: BUOption[];
  bankAccountMap: Record<string, string>;
  bankAccountCurrencyMap: Record<string, string>;
  payeeOptions: PayeeOption[];
  buBankMap: Record<string, string[]>;
  buCompanyMap: Record<string, string>;
  onSave: () => void;
  onCancel: () => void;
  onPayeeCreated: (newOption: PayeeOption) => void;
  onCreateAccounting?: (txns: ExternalTxnRecord[]) => void;
}> = ({ initialValues, bankAccounts, businessUnits, bankAccountMap, bankAccountCurrencyMap, buBankMap, buCompanyMap, payeeOptions, onSave, onCancel, onPayeeCreated, onCreateAccounting }) => {
  const { user } = useAuth();
  const loggedUser = user?.email ?? user?.username ?? 'ERP_USER';
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [txnDirection, setTxnDirection] = useState<'DR' | 'CR'>('CR');
  const [selectedBu, setSelectedBu] = useState<string | undefined>(initialValues?.businessUnitName);
  const derivedCompany = selectedBu ? (buCompanyMap[selectedBu] || '') : '';
  const [apiModal, setApiModal]           = useState(false);
  const [apiPayload, setApiPayload]       = useState('');
  const [apiPosting, setApiPosting]       = useState(false);
  const [apiResponse, setApiResponse]     = useState<{ status: number; body: string } | null>(null);
  const [cashAcctOpen, setCashAcctOpen]   = useState(false);
  const [offsetAcctOpen, setOffsetAcctOpen] = useState(false);
  const [assetAcctDesc,  setAssetAcctDesc]  = useState('');
  const [offsetAcctDesc, setOffsetAcctDesc] = useState('');
  const [extTxnMode, setExtTxnMode]       = useState<'single' | 'multiple'>('single');
  const [extTxnLines, setExtTxnLines]     = useState<ExtTxnLine[]>([
    { key: 0, amount: undefined, description: '', offsetAccount: '', offsetDesc: '' },
  ]);
  const [lineCoaOpen, setLineCoaOpen]     = useState(false);
  const [lineCoaIdx, setLineCoaIdx]       = useState(0);
  const [lineCoaInitial, setLineCoaInitial] = useState('');
  const [distCombinations, setDistCombinations] = useState<DistCombination[]>([]);
  const [offsetDistSet, setOffsetDistSet] = useState('');                  // single mode
  const [lineDistSets, setLineDistSets]   = useState<Record<number, string>>({}); // multiple mode
  const [attachments, setAttachments]   = useState<Array<{id?: number; uid: string; name: string; fileType: string; fileSize: number; content?: string; rawFile?: File; status: 'done' | 'uploading' | 'error'}>>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<{ name: string; fileType: string; content: string; blobUrl?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedExtId, setSavedExtId] = useState<number | null>(null);
  const [savedExtIds, setSavedExtIds] = useState<number[]>([]);
  const [savedTxnId, setSavedTxnId] = useState<number | null>(null);
  const [lastSaveResponse, setLastSaveResponse] = useState<string | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [deleteApiUrl, setDeleteApiUrl] = useState('');
  const [attSaving, setAttSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfVisible, setPdfVisible] = useState(false);
  const [createPayeeVisible, setCreatePayeeVisible] = useState(false);
  const [createPayeeForm] = Form.useForm();
  const [createPayeeSaving, setCreatePayeeSaving] = useState(false);
  const [bmsRate, setBmsRate] = useState<{ rate: number; inverseRate: number; rateType: string; rateDate: string } | null>(null);
  const [bmsRateLoading, setBmsRateLoading] = useState(false);
  const isEdit = !!initialValues?.externalTransactionId;
  const [editingEnabled, setEditingEnabled] = useState(false);
  const buSelected = !!selectedBu;
  const [selectedBank, setSelectedBank] = useState<string | undefined>(initialValues?.bankAccountName);
  const bankSelected = !!selectedBank;

  // ── Approval state (form) ──────────────────────────────────────────────────
  const [fApprovalStatus, setFApprovalStatus]         = useState<string | undefined>(initialValues?.approvalStatus);
  const [fApprovalSentBy, setFApprovalSentBy]         = useState<string | undefined>(initialValues?.approvalSentBy);
  const [fApprovalSentDate, setFApprovalSentDate]     = useState<string | undefined>(initialValues?.approvalSentDate);
  const [fApproverName, setFApproverName]             = useState<string | undefined>(initialValues?.approvalApproverName);
  const [fApproverEmail, setFApproverEmail]           = useState<string | undefined>(initialValues?.approvalApproverEmail);
  const [fApprovedDate, setFApprovedDate]             = useState<string | undefined>(initialValues?.approvedDate);
  const [fApprovalRef, setFApprovalRef]               = useState<string | undefined>(initialValues?.approvalRef);
  const [fApprovalModalOpen, setFApprovalModalOpen]   = useState(false);
  const [fApprovalUsers, setFApprovalUsers]           = useState<ApprovalUser[]>([]);
  const [fApprovalLoadingUsers, setFApprovalLoadingUsers] = useState(false);
  const [fApprovalSending, setFApprovalSending]       = useState(false);
  const [fSelectedApprover, setFSelectedApprover]     = useState<string | undefined>(undefined);
  const [fApprovalStatusOpen, setFApprovalStatusOpen] = useState(false);
  const [fDebugSteps, setFDebugSteps]                 = useState<import('../../services/approvals.service').ApprovalDebugStep[]>([]);
  const [fDebugOpen, setFDebugOpen]                   = useState(false);

  const watchedAsset   = Form.useWatch('assetAccountCombination', form);
  const watchedOffset  = Form.useWatch('offsetAccountCombination', form);
  const watchedAmount  = Form.useWatch('amount', form);
  const watchedTxnType = Form.useWatch('transactionType', form);
  const watchedCurrency = Form.useWatch('currencyCode', form);
  const watchedRate      = Form.useWatch('bankConversionRate', form);
  const [inverseRateVal, setInverseRateVal] = useState<number | undefined>(undefined);
  const skipInverseSync  = useRef(false); // prevents watchedRate effect from overwriting while user types in inverse field
  const isForeignCurrency = !!watchedCurrency && watchedCurrency !== 'AED';
  const isAdhocPayment = watchedTxnType === 'Adhoc Payment';

  // Adhoc Payment → always money out (CR), always single mode
  useEffect(() => {
    if (isAdhocPayment) {
      setTxnDirection('CR');
      form.setFieldsValue({ transactionDirection: 'CR' });
      setExtTxnMode('single');
    }
  }, [isAdhocPayment, form]);

  // AED → auto-set conversion rate to 1
  useEffect(() => {
    if (watchedCurrency === 'AED') {
      form.setFieldsValue({ bankConversionRate: 1, bankConversionRateType: 'Corporate' });
      setInverseRateVal(1);
      setBmsRate(null);
    }
  }, [watchedCurrency, form]);

  // Fetch BMS rate and optionally auto-apply to form fields.
  // rateDate (YYYY-MM-DD): when provided fetches rate on or before that date.
  const fetchAndApplyBmsRate = useCallback((currency: string, apply: boolean, rateDate?: string) => {
    if (!currency || currency === 'AED') return;
    setBmsRateLoading(true);
    setBmsRate(null);
    const dateParam = rateDate ? `&rate_date=${encodeURIComponent(rateDate)}` : '';
    fetch(`${APEX_BASE}/currencies/bmsrate?source_cur=${currency}&target_cur=AED${dateParam}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'ok') {
          setBmsRate({ rate: data.rate, inverseRate: data.inverseRate, rateType: data.rateType, rateDate: data.rateDate });
          if (apply) {
            form.setFieldsValue({ bankConversionRate: data.rate, bankConversionRateType: data.rateType || 'Corporate' });
            setInverseRateVal(data.inverseRate);
          }
        }
      })
      .catch(() => {})
      .finally(() => setBmsRateLoading(false));
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch BMS rate once when a foreign currency is first selected on a new record.
  // Does NOT re-fetch on conv date changes — use the ↻ button for that.
  useEffect(() => {
    if (!watchedCurrency || watchedCurrency === 'AED') return;
    if (isEdit || initialValues?.bankConversionRate) return; // already has a rate
    const convDate = form.getFieldValue('bankConversionDate') as Dayjs | undefined;
    fetchAndApplyBmsRate(watchedCurrency, true, convDate?.format('YYYY-MM-DD'));
  }, [watchedCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync inverse rate display when watchedRate changes externally (e.g. on edit load, BMS apply).
  // Skipped when the change originated from typing in the inverse rate field to prevent a feedback loop.
  useEffect(() => {
    if (skipInverseSync.current) return;
    if (watchedRate && watchedRate > 0) {
      setInverseRateVal(Math.round((1 / watchedRate) * 10000000000) / 10000000000);
    }
  }, [watchedRate]);

  const filteredBankAccounts = selectedBu && buBankMap[selectedBu]?.length
    ? buBankMap[selectedBu].sort().map(n => ({ label: n, value: n }))
    : bankAccounts;

  const updateExtLine = (idx: number, field: string, value: any) =>
    setExtTxnLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  useEffect(() => { setSelectedBu(initialValues?.businessUnitName); }, [initialValues]);

  useEffect(() => {
    searchCombinations({}).then(setDistCombinations).catch(() => {});
  }, []);

  const applyCompanySegment = useCallback((combo: string): string => {
    if (!derivedCompany || !combo) return combo;
    const parts = combo.split('-');
    parts[0] = derivedCompany;
    return parts.join('-');
  }, [derivedCompany]);

  useEffect(() => {
    if (initialValues) {
      const rawDir = initialValues.transactionDirection as 'DR' | 'CR' | undefined;
      const dir: 'DR' | 'CR' = rawDir || ((initialValues.amount ?? 0) < 0 ? 'CR' : 'DR');
      setTxnDirection(dir);
      form.setFieldsValue({
        bankAccountName:           initialValues.bankAccountName,
        businessUnitName:          initialValues.businessUnitName,
        amount:                    initialValues.amount,
        transactionDate:           initialValues.transactionDate ? dayjs(initialValues.transactionDate) : dayjs(),
        valueDate:                 initialValues.valueDate ? dayjs(initialValues.valueDate) : undefined,
        referenceText:             initialValues.referenceText,
        transactionType:           initialValues.transactionType,
        description:               initialValues.description,
        currencyCode:              initialValues.currencyCode,
        assetAccountCombination:   initialValues.assetAccountCombination,
        offsetAccountCombination:  initialValues.offsetAccountCombination,
        bankConversionRate:        initialValues.bankConversionRate ?? null,
        bankConversionRateType:    initialValues.bankConversionRateType ?? null,
        bankConversionDate:        initialValues.bankConversionDate ? dayjs(initialValues.bankConversionDate) : undefined,
        transactionDirection:      dir,
        paymentMethod:             initialValues.paymentMethod,
        paymentDocument:           initialValues.paymentDocument,
        paperDocumentNumber:       initialValues.paperDocumentNumber,
        payeeName:                 initialValues.payeeName,
        payeeId:                   initialValues.payeeId,
      });
      // Populate lines table from initial values (edit mode)
      setExtTxnLines([{
        key: 0,
        amount: initialValues.amount ?? undefined,
        description: initialValues.description ?? '',
        offsetAccount: initialValues.offsetAccountCombination ?? '',
        offsetDesc: '',
      }]);
      // Fetch existing attachments for edit mode — moved to dedicated effect below
    } else {
      form.resetFields();
      form.setFieldsValue({ transactionDate: dayjs(), valueDate: dayjs(), clearedDate: dayjs(), bankConversionDate: dayjs(), transactionDirection: 'CR', transactionType: 'External Transaction' });
      setTxnDirection('CR');
      setAssetAcctDesc('');
      setOffsetAcctDesc('');
      setExtTxnLines([{ key: 0, amount: undefined, description: '', offsetAccount: '', offsetDesc: '' }]);
    }
  }, [initialValues, form]);

  // Load attachments only once when the transaction ID becomes known
  const extTxnId = initialValues?.externalTransactionId;
  useEffect(() => {
    if (!extTxnId) return;
    fetch(`${APEX_BASE}/cash/externaltransactions/${extTxnId}/attachments`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.items)) {
          setAttachments(d.items.map((a: any) => ({
            id: a.id, uid: String(a.id), name: a.fileName, fileType: a.fileType || '', fileSize: a.fileSize || 0, status: 'done' as const,
          })));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extTxnId]);

  const buildPayload = (values: any) => ({
    items: [{
      ExternalTransactionId: initialValues?.externalTransactionId ?? undefined,
      TransactionId:         initialValues?.transactionId ?? values.transactionId ?? undefined,
      BankAccountName:       values.bankAccountName,
      BusinessUnitName:      values.businessUnitName ?? '',
      Amount:                values.amount,
      TransactionDate:       values.transactionDate?.format('YYYY-MM-DD'),
      ValueDate:             values.valueDate?.format('YYYY-MM-DD') ?? null,
      CurrencyCode:          values.currencyCode ?? '',
      ReferenceText:         values.referenceText ?? '',
      TransactionType:       values.transactionType ?? '',
      Description:           values.description ?? '',
      Source:                'ORA_MAN',
      Status:                initialValues?.status ?? 'UNR',
      AccountingFlag:        false,
      CreatedBy:             loggedUser,
      CreationDate:          new Date().toISOString(),
      LastUpdatedBy:         loggedUser,
      LastUpdateDate:        new Date().toISOString(),
      LastUpdateLogin:       '',
      AssetAccountCombination:  values.assetAccountCombination ?? '',
      OffsetAccountCombination: values.offsetAccountCombination ?? '',
      TransactionDirection:  values.transactionDirection ?? txnDirection,
      BankConversionRate:    values.bankConversionRate ?? null,
      BankConversionRateType: values.bankConversionRateType ?? null,
      BankConversionDate:    values.bankConversionDate ? (values.bankConversionDate as Dayjs).format('YYYY-MM-DD') : null,
      ClearedDate:          values.clearedDate ? (values.clearedDate as Dayjs).format('YYYY-MM-DD') : null,
      PaymentMethod:        values.paymentMethod ?? null,
      PaymentDocument:      values.paymentDocument ?? null,
      PaperDocumentNumber:  values.paperDocumentNumber ?? null,
      PayeeName:            values.payeeName ?? null,
      PayeeId:              values.payeeId ?? null,
    }],
  });

  const handlePrintPdf = async () => {
    const values = form.getFieldsValue();

    // Resolve offset account description + sub-account description
    const resolvedLines = await Promise.all(extTxnLines.map(async (l) => {
      if (!l.offsetAccount) return l;
      try {
        const res = await validateAccountCode(l.offsetAccount);
        const segs = Object.values(res.segmentDetails);
        const acctDesc = segs[3]?.description || '';
        const subDesc  = segs[4]?.description || '';
        return { ...l, offsetDesc: acctDesc, offsetSubDesc: subDesc };
      } catch { return l; }
    }));

    // Resolve cash/asset account description
    let assetDesc = assetAcctDesc || '';
    if (!assetDesc && values.assetAccountCombination) {
      try {
        const res = await validateAccountCode(values.assetAccountCombination);
        const segs = Object.values(res.segmentDetails);
        assetDesc = segs[3]?.description || '';
      } catch { /* leave blank */ }
    }

    const txnId = savedExtId ?? savedTxnId ?? initialValues?.externalTransactionId ?? initialValues?.transactionId;

    // Build a record and delegate to the same function used by search results,
    // but for multi-line we generate the PDF directly using the same layout.
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const fmt = (v: any) => v != null && v !== '' ? String(v) : '—';
    const fmtNum = (v: any) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—';
    const fmtAmt = (v: number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = (v: any) => {
      if (!v) return '—';
      try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return String(v); }
    };

    // Header bar — identical to search results voucher
    doc.setFillColor(191, 70, 0);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('External Transaction', 14, 11);
    doc.setFontSize(9);
    doc.text(`Printed: ${new Date().toLocaleString()}`, pageW - 14, 11, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    let y = 26;

    // Transaction ID (always show when available)
    if (txnId) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`Transaction ID: ${txnId}`, 14, y);
      y += 8;
    }

    // Section 1: Organisation & Bank
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Organisation & Bank', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ['Business Unit', fmt(values.businessUnitName), 'Legal Entity', fmt(initialValues?.legalEntityName || derivedCompany)],
        ['Bank Account', fmt(values.bankAccountName), 'Currency', fmt(values.currencyCode)],
        ['Cash / Asset Account', fmt(values.assetAccountCombination), 'Direction', values.transactionDirection === 'DR' ? 'Money In (DR)' : 'Money Out (CR)'],
        ...(assetDesc ? [['Account Description', assetDesc, '', '']] : []),
      ],
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section 2: Transaction Details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Transaction Details', 14, y);
    y += 2;
    const inverseRate = watchedRate && watchedRate > 0 ? Math.round((1 / watchedRate) * 10000000000) / 10000000000 : null;
    autoTable(doc, {
      startY: y,
      body: [
        ['Transaction Date', fmtDate(values.transactionDate), 'Value Date', fmtDate(values.valueDate)],
        ['Transaction Type', fmt(values.transactionType), 'Reference', fmt(values.referenceText)],
        ['Payment Method', fmt(values.paymentMethod), 'Payment Document', fmt(values.paymentDocument)],
        ['Paper Doc #', fmt(values.paperDocumentNumber), 'Conv. Rate Type', fmt(values.bankConversionRateType)],
        [`Conv. Rate (${values.currencyCode || 'FCY'}→AED)`, fmtNum(values.bankConversionRate),
         `Inverse Rate (AED→${values.currencyCode || 'FCY'})`, fmtNum(inverseRate)],
      ],
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section 3: Adhoc Payee (if applicable)
    if (values.transactionType === 'Adhoc Payment' && values.payeeName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Payee Details', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        body: [
          ['Payee Name', fmt(values.payeeName), 'Check #', fmt(values.checkNumber)],
        ],
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
        alternateRowStyles: { fillColor: [247, 247, 247] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // Section 4: Transaction Lines
    const rate = Number(values.bankConversionRate) || 1;
    const txnCcy = values.currencyCode || 'FCY';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Transaction Lines', 14, y);
    y += 2;

    // Amount cell shows entered amount and, when not AED, the AED-accounted amount
    // (entered × conversion rate) stacked right below it.
    const amtStack = (ent: number) => txnCcy === 'AED'
      ? fmtAmt(ent)
      : `${fmtAmt(ent)} ${txnCcy}\nAED ${fmtAmt(Math.round(ent * rate * 100) / 100)}`;
    const totalAmt = resolvedLines.reduce((s, l) => s + Math.abs(l.amount ?? 0), 0);
    autoTable(doc, {
      startY: y,
      head: [['#', 'Offset Account', 'Account Desc', 'Sub-Account Desc', 'Description', 'Amount']],
      body: resolvedLines.map((l, i) => [
        i + 1,
        l.offsetAccount || '—',
        (l as any).offsetDesc || '—',
        (l as any).offsetSubDesc || '—',
        l.description || '—',
        amtStack(Math.abs(l.amount ?? 0)),
      ]),
      foot: [['', '', '', '', 'Total', amtStack(totalAmt)]],
      styles: { fontSize: 8, cellPadding: 2, textColor: [0, 0, 0] },
      headStyles: { fillColor: [58, 58, 58], textColor: [255, 255, 255] },
      footStyles: { fillColor: [255, 255, 255], fontStyle: 'bold', textColor: [0, 0, 0], halign: 'right' },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 40 }, 5: { halign: 'right', cellWidth: 30 } },
      margin: { left: 14, right: 14 },
    });

    // Footer with signature lines
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const sigY = 272;
      const col1 = 14, col2 = 80, col3 = 146;
      const lineLen = 55;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0);
      doc.text(loggedUser, col1, sigY - 3);
      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.line(col1, sigY, col1 + lineLen, sigY);
      doc.line(col2, sigY, col2 + lineLen, sigY);
      doc.line(col3, sigY, col3 + lineLen, sigY);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Created By', col1, sigY + 4);
      doc.text('Approved By', col2, sigY + 4);
      doc.text('Received By', col3, sigY + 4);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 291, { align: 'center' });
      doc.text('Generated by ReactERP', 14, 291);
    }

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    setPdfVisible(true);
  };

  const handleSubmit = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }

    const invalid = extTxnLines.filter(l => !l.amount);
    if (invalid.length > 0) { message.error('All lines must have an amount'); return; }
    const missingOffset = extTxnLines.filter(l => !l.offsetAccount);
    if (missingOffset.length > 0) { message.error('All lines must have an offset account'); return; }

    const dir = values.transactionDirection ?? txnDirection;
    const signViolation = extTxnLines.find(l => l.amount != null && (dir === 'DR' ? l.amount < 0 : l.amount > 0));
    if (signViolation) {
      message.error(
        dir === 'DR'
          ? 'Money In (DR) requires a positive (+ve) amount'
          : 'Money Out (CR) requires a negative (−ve) amount'
      );
      return;
    }

    setSaving(true);

    const effectiveExtId = initialValues?.externalTransactionId ?? savedExtId ?? savedTxnId ?? null;
    if (isEdit || (saved && effectiveExtId)) {
      // Edit: update the transaction via PUT /:id
      const line = extTxnLines[0];
      const updateId = initialValues?.externalTransactionId ?? effectiveExtId;
      try {
        const putPayload = buildPayload({ ...values, amount: line.amount, description: line.description ?? '', offsetAccountCombination: line.offsetAccount ?? '' });
        const res = await fetch(`${APEX_BASE}/cash/externaltransactions/${updateId}/updatetrx`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(putPayload),
        });
        const rawText = await res.text();
        setLastSaveResponse(rawText);
        let data: any = {};
        try { data = JSON.parse(rawText); } catch { /* non-JSON */ }
        if (data.status === 'success') {
          message.success('Transaction updated.');
          setEditingEnabled(false);
          if (isEdit) onSave();
        } else {
          message.error(data.message || `Update failed (HTTP ${res.status}).`);
        }
      } catch (e: any) {
        message.error('Network error: ' + e.message);
      } finally { setSaving(false); }
      return;
    }

    // Create: one POST per line
    const baseRef = values.referenceText?.trim() || '';
    const baseHeader = {
      BankAccountName:         values.bankAccountName,
      BusinessUnitName:        values.businessUnitName ?? '',
      TransactionDate:         values.transactionDate?.format('YYYY-MM-DD'),
      ValueDate:               values.valueDate?.format('YYYY-MM-DD') ?? null,
      CurrencyCode:            values.currencyCode ?? '',
      TransactionType:         values.transactionType ?? '',
      AssetAccountCombination: values.assetAccountCombination ?? '',
      TransactionDirection:    values.transactionDirection ?? txnDirection,
      BankConversionRate:      values.bankConversionRate ?? null,
      BankConversionRateType:  values.bankConversionRateType ?? null,
      BankConversionDate:      values.bankConversionDate ? (values.bankConversionDate as Dayjs).format('YYYY-MM-DD') : null,
      Source: 'ORA_MAN', Status: 'UNR', AccountingFlag: false,
      CreatedBy: loggedUser, CreationDate: new Date().toISOString(),
      LastUpdatedBy: loggedUser, LastUpdateDate: new Date().toISOString(), LastUpdateLogin: '',
      PaymentMethod:        values.paymentMethod ?? null,
      PaymentDocument:      values.paymentDocument ?? null,
      PaperDocumentNumber:  values.paperDocumentNumber ?? null,
      PayeeName:            values.payeeName ?? null,
      PayeeId:              values.payeeId ?? null,
    };
    let successCount = 0;
    let savedId: any = null;
    const allSavedIds: number[] = [];
    for (let i = 0; i < extTxnLines.length; i++) {
      const line = extTxnLines[i];
      const payload = {
        items: [{
          ...baseHeader,
          Amount:                   line.amount,
          ReferenceText:            extTxnLines.length > 1 ? `${baseRef}-${i + 1}` : baseRef,
          Description:              line.description ?? '',
          OffsetAccountCombination: line.offsetAccount ?? '',
        }],
      };
      try {
        const res = await fetch(`${APEX_BASE}/cash/externaltransactions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const rawText = await res.text();
        if (i === 0) setLastSaveResponse(rawText);
        let data: any = {};
        try { data = JSON.parse(rawText); } catch { /* non-JSON */ }
        if (data.status === 'success') {
          successCount++;
          if (i === 0) {
            // Try every field name variant Oracle APEX might return
            const extId =
              data.externalTransactionId ?? data.external_transaction_id ??
              data.EXTERNAL_TRANSACTION_ID ?? data.ExternalTransactionId ??
              data.id ?? data.ID ?? null;
            const txnId =
              data.transactionId ?? data.transaction_id ??
              data.TRANSACTION_ID ?? data.TransactionId ?? null;
            savedId = extId ?? txnId ?? null;
            if (txnId) setSavedTxnId(Number(txnId));
            if (extId) setSavedExtId(Number(extId));
          }
          const extIdForAtt =
            data.externalTransactionId ?? data.external_transaction_id ??
            data.EXTERNAL_TRANSACTION_ID ?? data.id ?? null;
          if (extIdForAtt) allSavedIds.push(extIdForAtt);
          else if (i === 0 && savedId) allSavedIds.push(savedId);
          // Upload attachments on first line
          const attExtId = extIdForAtt ?? savedId;
          if (i === 0 && attExtId && attachments.length > 0) {
            for (const att of attachments.filter(a => !a.id)) {
              try {
                await fetch(`${APEX_BASE}/cash/externaltransactions/${attExtId}/attachments`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileName: att.name, fileType: att.fileType, fileSize: att.fileSize, content: att.content, createdBy: loggedUser }),
                });
              } catch { /* ignore */ }
            }
          }
        } else {
          message.error(`Line ${i + 1}: ${data.message || 'Save failed.'}`);
          setSaving(false);
          return;
        }
      } catch (e: any) {
        message.error(`Line ${i + 1}: Network error: ${e.message}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    message.success(`${successCount} transaction(s) created.`);
    setSaved(true);
    // savedExtId is already set inline per-line above; set fallback here if still null
    if (savedId && !savedExtId) setSavedExtId(Number(savedId));
    setSavedExtIds(allSavedIds);
  };

  const handleApiOpen = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch (e) {
      // Use getFieldsValue so inspector works even with validation errors
      values = form.getFieldsValue();
    }
    const line = extTxnLines[0];
    const merged = { ...values, amount: line?.amount, description: line?.description ?? '', offsetAccountCombination: line?.offsetAccount ?? '' };
    setApiPayload(JSON.stringify(buildPayload(merged), null, 2));
    setApiResponse(null);
    setApiModal(true);
  };

  const handleApiPost = async () => {
    setApiPosting(true);
    setApiResponse(null);
    const updateId = initialValues?.externalTransactionId ?? savedExtId ?? savedTxnId ?? null;
    const url = isEdit && updateId
      ? `${APEX_BASE}/cash/externaltransactions/${updateId}/updatetrx`
      : `${APEX_BASE}/cash/externaltransactions`;
    const method = isEdit && updateId ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: apiPayload,
      });
      const text = await res.text();
      setApiResponse({ status: res.status, body: (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })() });
    } catch (e: any) {
      setApiResponse({ status: 0, body: 'Network error: ' + e.message });
    } finally { setApiPosting(false); }
  };

  const makeBlobUrl = (base64: string, mimeType: string): string => {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mimeType || 'application/octet-stream' }));
  };

  const handlePreviewAttachment = async (file: any) => {
    const att = attachments.find(a => a.uid === file.uid);
    if (!att) return;
    if (att.content) {
      const blobUrl = makeBlobUrl(att.content, att.fileType || 'application/octet-stream');
      setPreviewAtt({ name: att.name, fileType: att.fileType, content: att.content, blobUrl });
      return;
    }
    if (!att.id || !initialValues?.externalTransactionId) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(`${APEX_BASE}/cash/externaltransactions/${initialValues.externalTransactionId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
      const d = await res.json();
      const content = d.content || d.CONTENT || '';
      const fileType = att.fileType || d.fileType || d.FILE_TYPE || 'application/octet-stream';
      if (!content) { message.warning('No content available for preview.'); return; }
      const blobUrl = makeBlobUrl(content, fileType);
      setPreviewAtt({ name: att.name, fileType, content, blobUrl });
    } catch {
      message.error('Failed to load attachment for preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadAttachment = async (file: any) => {
    const att = attachments.find(a => a.uid === file.uid);
    if (!att) return;
    let content = att.content;
    let fileType = att.fileType;
    if (!content && att.id && initialValues?.externalTransactionId) {
      try {
        const res = await fetch(`${APEX_BASE}/cash/externaltransactions/${initialValues.externalTransactionId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
        const d = await res.json();
        content = d.content || d.CONTENT || '';
        fileType = att.fileType || d.fileType || 'application/octet-stream';
      } catch { message.error('Failed to download attachment.'); return; }
    }
    if (!content) { message.warning('No content available for download.'); return; }
    const bytes = atob(content);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([arr], { type: fileType || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = att.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  };

  // Locked = reconciled or accounted — cannot delete, but can still add attachments
  const isLocked = isEdit && (initialValues?.status === 'REC' || initialValues?.accountingFlag === 'Y');

  const handleSaveAttachments = async () => {
    const extId = savedExtId ?? savedTxnId ?? initialValues?.externalTransactionId;
    if (!extId) { message.error('Transaction ID not available'); return; }
    const pending = attachments.filter(a => !a.id);
    if (pending.length === 0) { message.info('No new attachments to save.'); return; }
    setAttSaving(true);
    let savedCount = 0;
    for (const att of pending) {
      if (!att.rawFile && !att.content) { message.warning(`${att.name}: no file data — skipped`); continue; }
      try {
        const base64 = att.content ?? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => { const r = reader.result as string; resolve(r.split(',')[1] ?? r); };
          reader.onerror = reject;
          reader.readAsDataURL(att.rawFile!);
        });
        const payload = JSON.stringify({ fileName: att.name, fileType: att.fileType || '', fileSize: att.fileSize, content: base64, createdBy: loggedUser });
        const postUrl = `${APEX_BASE}/cash/externaltransactions/${extId}/attachments`;
        const res = await fetch(postUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        const txt = await res.text();
        let resp: any = null;
        try { resp = JSON.parse(txt); } catch { /* not JSON */ }
        if (resp?.status === 'success') savedCount++;
        else message.error(`${att.name}: ${resp?.message || txt || `HTTP ${res.status}`}`);
      } catch (e: any) { message.error(`${att.name}: ${e.message}`); }
    }
    // Refresh attachment list from server
    try {
      const r = await fetch(`${APEX_BASE}/cash/externaltransactions/${extId}/attachments`, { headers: { Accept: 'application/json' } });
      const d = await r.json();
      if (Array.isArray(d.items)) {
        setAttachments(d.items.map((a: any) => ({
          id: a.id, uid: String(a.id), name: a.fileName, fileType: a.fileType || '', fileSize: a.fileSize || 0, status: 'done' as const,
        })));
      }
    } catch { /* silent */ }
    message.success(`${savedCount} attachment(s) saved.`);
    setAttSaving(false);
  };

  const handleDelete = async () => {
    const extId = savedExtId ?? initialValues?.externalTransactionId;
    if (!extId) { message.error('Transaction ID not available'); return; }
    const url = `${APEX_BASE}/cash/externaltransactions/${extId}`;
    setDeleteApiUrl(url);
    setDeleting(true);
    try {
      const res = await fetch(url, { method: 'DELETE' });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {
        message.error(`Delete failed (HTTP ${res.status}): server returned non-JSON response`);
        return;
      }
      if (data.status === 'success') {
        message.success('Transaction deleted.');
        onSave();
      } else {
        // Show full detail including receivedId so we can debug bind variable issues
        const detail = data.receivedId ? ` (server received ID: ${data.receivedId})` : '';
        message.error((data.message || `Delete failed (HTTP ${res.status}).`) + detail);
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally { setDeleting(false); }
  };

  // ── Form approval handlers ───────────────────────────────────────────────
  const openFApprovalModal = () => {
    setFSelectedApprover(undefined);
    setFApprovalModalOpen(true);
    setFApprovalLoadingUsers(true);
    getApprovalRules('CASH')
      .then(rules => {
        const matching = rules.filter(r => r.transactionType === 'EXTERNAL_TXN' && r.active === 'Y');
        const seen = new Map<string, ApprovalUser>();
        matching.forEach(rule =>
          rule.approvers.forEach(a => {
            if (!seen.has(a.email)) seen.set(a.email, {
              userId: a.userId, fullName: a.fullName, email: a.email,
              department: a.department, active: 'Y', modules: ['CASH'], currency: 'AED',
            });
          })
        );
        setFApprovalUsers([...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      })
      .catch(() => setFApprovalUsers([]))
      .finally(() => setFApprovalLoadingUsers(false));
  };

  const handleFSendApproval = async () => {
    const approver = fApprovalUsers.find(u => u.email === fSelectedApprover);
    if (!approver) return;
    const txnId = savedExtId ?? savedTxnId ?? initialValues?.externalTransactionId;
    if (!txnId) { message.error('Transaction ID not available — please save first'); return; }
    const values = form.getFieldsValue();
    setFApprovalSending(true);
    setFDebugSteps([]);
    try {
      const result = await sendExternalTxnApproval({
        txnId,
        txnRef:        values.referenceText || String(savedTxnId ?? initialValues?.transactionId ?? txnId),
        txnType:       values.transactionType || '',
        amount:        Math.abs(values.amount ?? initialValues?.amount ?? 0),
        currency:      values.currencyCode || initialValues?.currencyCode || 'AED',
        description:   values.description || initialValues?.description || '',
        approverEmail: approver.email,
        approverName:  approver.fullName,
        sentBy:        loggedUser,
      });
      setFDebugSteps(result.debug ?? []);
      if (result.success) {
        message.success(result.message);
        const ref = `CASH-EXT-${txnId}`;
        setFApprovalStatus('PENDING');
        setFApprovalSentBy(loggedUser);
        setFApprovalSentDate(new Date().toISOString());
        setFApproverName(approver.fullName);
        setFApproverEmail(approver.email);
        setFApprovalRef(ref);
        setFApprovalModalOpen(false);
      } else {
        message.error(result.message);
        setFDebugOpen(true);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send approval');
    } finally {
      setFApprovalSending(false);
    }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const sectionCard = (accent: string) => ({
    borderRadius: 8,
    border: `1px solid ${REDWOOD.neutral200}`,
    borderLeft: `3px solid ${accent}`,
    marginBottom: 16,
    background: REDWOOD.surface,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  });
  const sectionHeader = (color: string) => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  });
  const acctFieldStyle = {
    background: '#f8f9fc',
    border: `1px solid ${REDWOOD.neutral300}`,
    borderRadius: 6,
    padding: '8px 12px',
    fontFamily: 'monospace',
    fontSize: 12,
    flex: 1,
    cursor: 'default',
    color: REDWOOD.neutral900,
    minWidth: 0,
  };

  return (
    <div style={{ padding: '0 0 80px' }}>
      <style>{`
        .direction-dr .ant-segmented-item-selected { background: #1677ff !important; color: #fff !important; }
        .direction-cr .ant-segmented-item-selected { background: #ff4d4f !important; color: #fff !important; }
        .ext-doc-wrap { border: 1px solid #d0d0d0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 16px rgba(0,0,0,0.09); background: #fff; max-width: 1400px; margin: 0 auto; }
        .ext-sec { border-bottom: 2px solid #ddd; }
        .ext-sec-title { font-weight: 700; font-size: 13px; color: #1a1a1a; padding: 9px 14px; border-bottom: 1px solid #e4e4e4; background: #fafafa; letter-spacing: 0.1px; }
        .ext-row { display: grid; grid-template-columns: 180px 1fr 160px 1fr; border-bottom: 1px solid #ebebeb; min-height: 48px; }
        .ext-row:last-child { border-bottom: none; }
        .ext-row-alt { background: #fff; }
        .ext-lbl { font-weight: 600; font-size: 12px; color: #3a3a3a; padding: 8px 12px; background: #efefef; border-right: 1px solid #e0e0e0; display: flex; align-items: center; }
        .ext-val { padding: 4px 10px; border-right: 1px solid #e8e8e8; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; min-height: 48px; }
        .ext-val:last-child { border-right: none; }
        .ext-val .ant-form-item { margin-bottom: 0; width: 100%; }
        .ext-val .ant-select { width: 100%; }
        .ext-val .ant-picker { width: 100%; }
        .ext-val .ant-input-number { width: 100%; }
        .ext-lines-hdr { font-weight: 700; font-size: 13px; color: #1a1a1a; padding: 9px 14px; background: #fafafa; border-bottom: 1px solid #e4e4e4; border-top: 2px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
        .ext-attach { padding: 12px 16px; border-top: 2px solid #ddd; background: #fafafa; }
        .ext-attach-title { font-weight: 700; font-size: 13px; color: #1a1a1a; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
      `}</style>

      <Form form={form} layout="vertical" size="middle">
        <div className="ext-doc-wrap">


          {/* ══════════ SECTION 1: Organisation & Bank ══════════ */}
          <div className="ext-sec">
            <div className="ext-sec-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Organisation &amp; Bank</span>
              {!isEdit && saved && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.success, fontFamily: 'monospace' }}>
                    ✓ Saved{(savedExtId ?? savedTxnId) ? ` — ID: ${savedExtId ?? savedTxnId}` : ''}
                    {savedTxnId && savedExtId && savedTxnId !== savedExtId ? ` · Txn: ${savedTxnId}` : ''}
                  </span>
                  {lastSaveResponse && (
                    <Tooltip title="View POST response">
                      <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info, fontSize: 11, padding: '0 4px' }}
                        onClick={() => Modal.info({ title: 'POST Response (line 1)', width: 600, content: <pre style={{ fontSize: 11, maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>{(() => { try { return JSON.stringify(JSON.parse(lastSaveResponse), null, 2); } catch { return lastSaveResponse; } })()}</pre> })} />
                    </Tooltip>
                  )}
                </span>
              )}
              {isEdit && initialValues?.externalTransactionId && (
                <span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.info, fontFamily: 'monospace' }}>
                  ID: {initialValues.externalTransactionId}
                  {initialValues.transactionId ? ` · Txn: ${initialValues.transactionId}` : ''}
                </span>
              )}
            </div>

            {/* Business Unit | Company Code */}
            <div className="ext-row">
              <div className="ext-lbl">Business Unit</div>
              <div className="ext-val">
                <Form.Item name="businessUnitName" rules={[{ required: !isEdit, message: 'Required' }]}>
                  <Select
                    showSearch optionFilterProp="label" options={businessUnits}
                    placeholder="Select business unit" variant="borderless"
                    disabled={(isEdit && !editingEnabled) || saved || !!selectedBank}
                    className="ext-txn-bu-select"
                    onChange={v => {
                      setSelectedBu(v);
                      setSelectedBank(undefined);
                      if (!isEdit) {
                        const banks = buBankMap[v] || [];
                        const cur = form.getFieldValue('bankAccountName');
                        if (cur && banks.length > 0 && !banks.includes(cur)) {
                          form.setFieldsValue({ bankAccountName: undefined, currencyCode: undefined, assetAccountCombination: '' });
                        }
                      }
                    }}
                    allowClear onClear={() => { setSelectedBu(undefined); setSelectedBank(undefined); }}
                  />
                </Form.Item>
              </div>
              <div className="ext-lbl">Company Code</div>
              <div className="ext-val">
                {derivedCompany
                  ? <Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{derivedCompany}</Tag>
                  : selectedBu
                    ? <Text style={{ fontSize: 12, color: '#cf1322' }}>⚠ Not configured</Text>
                    : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                }
              </div>
            </div>

            {/* Bank Account | Currency */}
            <div className="ext-row ext-row-alt">
              <div className="ext-lbl">Bank Account</div>
              <div className="ext-val">
                <Form.Item name="bankAccountName" rules={[{ required: !isEdit, message: 'Required' }]}>
                  <Select
                    showSearch optionFilterProp="label" optionLabelProp="label" options={filteredBankAccounts}
                    variant="borderless"
                    placeholder={buSelected && !derivedCompany ? 'No company code' : buSelected ? 'Select bank account' : 'Select BU first'}
                    disabled={(isEdit && !editingEnabled) || !buSelected || saved || (!derivedCompany && buSelected)}
                    notFoundContent={<Text type="secondary">No accounts for this BU</Text>}
                    onChange={v => {
                      setSelectedBank(v);
                      if (!isEdit) {
                        const acct = bankAccountMap[v] ?? '';
                        form.setFieldValue('assetAccountCombination', acct);
                        form.setFieldValue('currencyCode', bankAccountCurrencyMap[v] ?? '');
                        setAssetAcctDesc('');
                        if (acct) {
                          validateAccountCode(acct).then(r => {
                            const seg4 = Object.values(r.segmentDetails)[3];
                            setAssetAcctDesc((seg4 as any)?.description || '');
                          }).catch(() => {});
                        }
                      }
                    }}
                  />
                </Form.Item>
              </div>
              <div className="ext-lbl">Currency</div>
              <div className="ext-val">
                <Form.Item name="currencyCode">
                  <Select variant="borderless" placeholder="Auto" allowClear disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}>
                    {['AED', 'USD', 'EUR', 'GBP', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR'].map(c => (
                      <Option key={c} value={c}>{c}</Option>
                    ))}
                  </Select>
                </Form.Item>
              </div>
            </div>

            {/* Cash / Asset Account | Direction */}
            <div className="ext-row">
              <div className="ext-lbl">Cash / Asset Account</div>
              <div className="ext-val" style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
                <div style={{ display: 'flex', width: '100%', gap: 0 }}>
                  <Form.Item name="assetAccountCombination" noStyle>
                    <Input
                      readOnly disabled={(isEdit && !editingEnabled) || (saved && !editingEnabled)} variant="borderless"
                      placeholder={isEdit ? '—' : 'Auto-populated from bank account'}
                      style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }}
                    />
                  </Form.Item>
                  {!isEdit && !saved && (
                    <Button size="small" type="text" icon={<SearchOutlined />}
                      disabled={!bankSelected} onClick={() => setCashAcctOpen(true)} />
                  )}
                </div>
                {assetAcctDesc && <div style={{ fontSize: 11, color: REDWOOD.info, paddingLeft: 4 }}>{assetAcctDesc}</div>}
              </div>
              <div className="ext-lbl">Direction</div>
              <div className="ext-val">
                <Form.Item name="transactionDirection" initialValue="CR" noStyle>
                  <Segmented
                    options={[{ label: 'Money In', value: 'DR' }, { label: 'Money Out', value: 'CR' }]}
                    onChange={v => {
                      const dir = v as 'DR' | 'CR';
                      setTxnDirection(dir);
                      setExtTxnLines(prev => prev.map(l =>
                        l.amount != null
                          ? { ...l, amount: dir === 'DR' ? Math.abs(l.amount) : -Math.abs(l.amount) }
                          : l
                      ));
                    }}
                    disabled={(isEdit && !editingEnabled) || !bankSelected || isAdhocPayment || (saved && !editingEnabled)}
                    style={{ background: txnDirection === 'DR' ? '#e6f4ff' : '#fff1f0', opacity: isAdhocPayment ? 0.7 : 1 }}
                    className={`direction-segmented direction-${txnDirection.toLowerCase()}`}
                  />
                </Form.Item>
              </div>
            </div>
          </div>

          {/* ══════════ SECTION 2: Transaction Details ══════════ */}
          <div className="ext-sec">
            <div className="ext-sec-title">Transaction Details</div>

            {/* Transaction Date | Value Date */}
            <div className="ext-row">
              <div className="ext-lbl">Transaction Date</div>
              <div className="ext-val">
                <Form.Item name="transactionDate" rules={[{ required: !isEdit, message: 'Required' }]}>
                  <DatePicker format="D-MMM-YYYY" variant="borderless" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} style={{ width: '100%' }}
                    onChange={(date: Dayjs | null) => {
                      if (!date || (isEdit && !editingEnabled) || saved) return;
                      // Default the transaction date into conversion, value and cleared dates.
                      form.setFieldsValue({ bankConversionDate: date, valueDate: date, clearedDate: date });
                    }}
                  />
                </Form.Item>
              </div>
              <div className="ext-lbl">Value Date</div>
              <div className="ext-val">
                <Form.Item name="valueDate">
                  <DatePicker format="D-MMM-YYYY" variant="borderless" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            </div>

            {/* Oracle Txn # | Cleared Date */}
            <div className="ext-row">
              <div className="ext-lbl">
                Oracle Txn #
                <Tooltip title="Oracle Fusion Cash Management transaction number"><QuestionCircleOutlined style={{ marginLeft: 4, color: REDWOOD.neutral600, fontSize: 11 }} /></Tooltip>
              </div>
              <div className="ext-val">
                {isEdit
                  ? <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.info }}>{initialValues?.transactionId || '—'}</Text>
                  : saved && savedTxnId
                  ? <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success }}>#{savedTxnId} (auto-assigned)</Text>
                  : (
                    <Form.Item name="transactionId" style={{ marginBottom: 0, width: '100%' }}>
                      <InputNumber
                        variant="borderless" style={{ width: '100%' }} placeholder="Auto-assigned (leave blank)"
                        disabled={!bankSelected || (saved && !editingEnabled)}
                      />
                    </Form.Item>
                  )
                }
              </div>
              <div className="ext-lbl">Cleared Date</div>
              <div className="ext-val">
                <Form.Item name="clearedDate">
                  <DatePicker format="D-MMM-YYYY" variant="borderless" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            </div>

            {/* Transaction Type | Reference */}
            <div className="ext-row ext-row-alt">
              <div className="ext-lbl">Transaction Type</div>
              <div className="ext-val">
                <Form.Item name="transactionType" initialValue="External Transaction" rules={[{ required: true, message: 'Required' }]}>
                  <Select variant="borderless" placeholder="Select type" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                    onChange={(val) => {
                      if (val === 'Adhoc Payment' && extTxnLines.length > 1) {
                        Modal.confirm({
                          title: 'Switch to Adhoc Payment?',
                          content: 'Adhoc Payment supports only one line. All existing lines will be cleared. Continue?',
                          okText: 'Yes, clear lines', cancelText: 'Cancel',
                          onOk: () => {
                            setExtTxnLines([{ key: 0, amount: undefined, description: '', offsetAccount: '', offsetDesc: '' }]);
                            form.setFieldValue('transactionType', val);
                          },
                          onCancel: () => { form.setFieldValue('transactionType', 'External Transaction'); },
                        });
                      }
                    }}
                  >
                    <Option value="External Transaction">External Transaction</Option>
                    <Option value="Adhoc Payment">Adhoc Payment</Option>
                  </Select>
                </Form.Item>
              </div>
              <div className="ext-lbl">Reference</div>
              <div className="ext-val">
                <Form.Item name="referenceText">
                  <Input variant="borderless" placeholder="e.g. STMT-REF-001" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} />
                </Form.Item>
              </div>
            </div>

            {/* Payment Method | Conv. Rate Type */}
            <div className="ext-row">
              <div className="ext-lbl">Payment Method</div>
              <div className="ext-val">
                <Form.Item name="paymentMethod">
                  <Select variant="borderless" placeholder="Select method" allowClear disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}>
                    {['CHECK', 'EFT', 'WIRE', 'CASH', 'MISC'].map(m => <Option key={m} value={m}>{m}</Option>)}
                  </Select>
                </Form.Item>
              </div>
              <div className="ext-lbl">
                Conv. Rate Type{isForeignCurrency && <span style={{ color: '#ff4d4f', marginLeft: 2 }}>*</span>}
              </div>
              <div className="ext-val">
                <Form.Item name="bankConversionRateType"
                  rules={[{ required: isForeignCurrency, message: 'Required' }]}
                >
                  <Select variant="borderless"
                    placeholder={isForeignCurrency ? 'Required' : 'Optional'}
                    allowClear disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                    onChange={(val: string | undefined) => {
                      if (val === 'Corporate') {
                        const convDate = form.getFieldValue('bankConversionDate') as Dayjs | undefined;
                        const dateStr = convDate ? convDate.format('YYYY-MM-DD') : undefined;
                        if (watchedCurrency && watchedCurrency !== 'AED') {
                          fetchAndApplyBmsRate(watchedCurrency, true, dateStr);
                        }
                      } else {
                        form.setFieldsValue({ bankConversionRate: undefined });
                        setInverseRateVal(undefined);
                      }
                    }}
                  >
                    <Option value="Corporate">Corporate</Option>
                    <Option value="Spot">Spot</Option>
                    <Option value="User">User</Option>
                  </Select>
                </Form.Item>
              </div>
            </div>

            {/* Paper Doc # | Conv. Date (right column, below Conv. Rate Type) */}
            <div className="ext-row ext-row-alt">
              <div className="ext-lbl">Paper Doc #</div>
              <div className="ext-val">
                <Form.Item name="paperDocumentNumber">
                  <Input variant="borderless" placeholder="CHQ-00123" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} />
                </Form.Item>
              </div>
              <div className="ext-lbl">Conv. Date</div>
              <div className="ext-val">
                <Form.Item name="bankConversionDate">
                  <DatePicker format="D-MMM-YYYY" variant="borderless" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            </div>

            {/* Payment Document | Conv. Rate */}
            <div className="ext-row">
              <div className="ext-lbl">Payment Document</div>
              <div className="ext-val">
                <Form.Item name="paymentDocument">
                  <Input variant="borderless" placeholder="e.g. Cheque Book Name" disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)} />
                </Form.Item>
              </div>
              <div className="ext-lbl" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                Conv. Rate ({watchedCurrency || 'FCY'}→AED){isForeignCurrency && <span style={{ color: '#ff4d4f', marginLeft: 2 }}>*</span>}
              </div>
              <div className="ext-val">
                <Form.Item name="bankConversionRate"
                  rules={[{ required: isForeignCurrency, message: 'Required' }]}
                  extra={isForeignCurrency && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {bmsRateLoading
                        ? <Text type="secondary" style={{ fontSize: 10 }}>Fetching…</Text>
                        : bmsRate
                          ? <Text
                              style={{ fontSize: 10, color: REDWOOD.info, cursor: (!(isEdit && !editingEnabled) && !saved) ? 'pointer' : 'default' }}
                              onClick={() => {
                                if ((isEdit && !editingEnabled) || saved) return;
                                form.setFieldsValue({ bankConversionRate: bmsRate.rate, bankConversionRateType: bmsRate.rateType || 'Corporate' });
                                setInverseRateVal(bmsRate.inverseRate);
                              }}
                            >
                              {bmsRate.rateType}: <strong>{bmsRate.rate}</strong> (inv: {bmsRate.inverseRate}) — {bmsRate.rateDate}
                              {(!(isEdit && !editingEnabled) && !saved) && <span style={{ marginLeft: 4 }}>(click to apply)</span>}
                            </Text>
                          : <Text type="secondary" style={{ fontSize: 10 }}>No rate — click ↻ to fetch</Text>
                      }
                      {watchedCurrency && watchedCurrency !== 'AED' && (!isEdit || editingEnabled) && !saved && (
                        <Tooltip title="Refresh Corporate rate for the conversion date">
                          <Button
                            type="text" size="small" loading={bmsRateLoading}
                            icon={<ReloadOutlined style={{ fontSize: 12, color: REDWOOD.primary }} />}
                            style={{ padding: '0 4px', height: 18 }}
                            onClick={() => {
                              const convDate = form.getFieldValue('bankConversionDate') as Dayjs | undefined;
                              fetchAndApplyBmsRate(watchedCurrency, true, convDate?.format('YYYY-MM-DD'));
                            }}
                          />
                        </Tooltip>
                      )}
                    </div>
                  )}
                >
                  <InputNumber
                    variant="borderless" precision={10} min={0}
                    placeholder="e.g. 3.6725"
                    disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                    style={{ width: '100%' }}
                    onChange={v => {
                      if (v && v > 0) setInverseRateVal(Math.round((1 / v) * 10000000000) / 10000000000);
                      else setInverseRateVal(undefined);
                    }}
                  />
                </Form.Item>
              </div>
            </div>

            {/* (spacer left) | Inverse Rate */}
            <div className="ext-row ext-row-alt">
              <div className="ext-lbl" />
              <div className="ext-val" />
              <div className="ext-lbl" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                Inverse Rate (AED→{watchedCurrency || 'FCY'}){isForeignCurrency && <span style={{ color: '#ff4d4f', marginLeft: 2 }}>*</span>}
              </div>
              <div className="ext-val">
                <InputNumber
                  variant="borderless" precision={10} min={0}
                  placeholder="e.g. 0.2724"
                  disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                  value={inverseRateVal}
                  style={{ width: '100%' }}
                  onChange={v => {
                    skipInverseSync.current = true;
                    setInverseRateVal(v ?? undefined);
                    if (v && v > 0) form.setFieldValue('bankConversionRate', Math.round((1 / v) * 10000000000) / 10000000000);
                    else form.setFieldValue('bankConversionRate', undefined);
                    // Clear flag after React has flushed the watchedRate effect
                    setTimeout(() => { skipInverseSync.current = false; }, 0);
                  }}
                />
              </div>
            </div>
          </div>

          {/* ══════════ SECTION 3: Payee Details (Adhoc Payment only) ══════════ */}
          {isAdhocPayment && (
            <div className="ext-sec">
              <div className="ext-sec-title">Payee Details</div>

              <div className="ext-row">
                <div className="ext-lbl">Payee Name</div>
                <div className="ext-val">
                  <div style={{ display: 'flex', width: '100%', gap: 4, alignItems: 'center' }}>
                    <Form.Item name="payeeId" rules={[{ required: true, message: 'Select a payee' }]} style={{ flex: 1, marginBottom: 0 }}>
                      <Select showSearch placeholder="Select payee..." variant="borderless"
                        disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                        optionFilterProp="label" options={payeeOptions}
                        onChange={(val: number) => {
                          const p = payeeOptions.find(o => o.value === val);
                          if (p) form.setFieldValue('payeeName', p.payeeName);
                        }}
                      />
                    </Form.Item>
                    {!isEdit && !saved && (
                      <Tooltip title="Create new payee">
                        <Button size="small" icon={<PlusOutlined />}
                          onClick={() => { createPayeeForm.resetFields(); setCreatePayeeVisible(true); }} />
                      </Tooltip>
                    )}
                  </div>
                  <Form.Item name="payeeName" hidden><Input /></Form.Item>
                </div>
                <div className="ext-lbl">Payee Type</div>
                <div className="ext-val"><Text type="secondary" style={{ fontSize: 12 }}>—</Text></div>
              </div>

              <div className="ext-row ext-row-alt">
                <div className="ext-lbl">Payee Account</div>
                <div className="ext-val"><Text type="secondary" style={{ fontSize: 12 }}>—</Text></div>
                <div className="ext-lbl">Bank Name</div>
                <div className="ext-val"><Text type="secondary" style={{ fontSize: 12 }}>—</Text></div>
              </div>

              <div className="ext-row">
                <div className="ext-lbl">IBAN</div>
                <div className="ext-val"><Text type="secondary" style={{ fontSize: 12 }}>—</Text></div>
                <div className="ext-lbl"></div>
                <div className="ext-val"></div>
              </div>
            </div>
          )}

          {/* ══════════ SECTION 4: Transaction Lines ══════════ */}
          <div>
            <div className="ext-lines-hdr">
              <span>Transaction Lines</span>
              <Space>
                <Text type="secondary" style={{ fontSize: 12 }}>{extTxnLines.length} line(s)</Text>
                <Divider type="vertical" />
                <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>
                  {fmtAmount(extTxnLines.reduce((s, l) => s + (l.amount ?? 0), 0), form.getFieldValue('currencyCode'))}
                </Text>
              </Space>
            </div>
            <Table
              size="small"
              dataSource={extTxnLines}
              rowKey="key"
              pagination={false}
              scroll={{ x: 1200 }}
              rowClassName={(_, idx) => idx % 2 === 1 ? 'alt-row' : ''}
              columns={[
                {
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>#</span>,
                  width: 36,
                  render: (_: any, _r: any, idx: number) => (
                    <span style={{ fontSize: 12, color: REDWOOD.neutral600, fontWeight: 600 }}>{idx + 1}</span>
                  ),
                },
                {
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Distribution Set <span style={{ color: '#ff4d4f' }}>*</span></span>,
                  width: 230,
                  render: (_: any, _record: ExtTxnLine, idx: number) => (
                    <Space.Compact style={{ width: '100%' }}>
                      <AutoComplete
                        size="small"
                        value={lineDistSets[idx] || ''}
                        placeholder="Search distribution set…"
                        disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                        style={{ width: '100%' }}
                        options={distCombinations
                          .filter(d => {
                            const q = (lineDistSets[idx] || '').toLowerCase();
                            if (!q) return true;
                            return d.combinationName.toLowerCase().includes(q)
                              || (d.description || '').toLowerCase().includes(q)
                              || (d.glAccountDesc || '').toLowerCase().includes(q);
                          })
                          .map(d => ({
                            value: d.combinationName,
                            label: (
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 600 }}>{d.combinationName}</span>
                                <span style={{ fontSize: 10, color: '#999', fontFamily: 'monospace' }}>{d.glAccountDesc || ''}</span>
                              </div>
                            ),
                            combination: d,
                          }))}
                        onChange={v => setLineDistSets(prev => ({ ...prev, [idx]: v }))}
                        onSelect={(_v, opt) => {
                          const d = (opt as { combination: DistCombination }).combination;
                          setLineDistSets(prev => ({ ...prev, [idx]: d.combinationName }));
                          if (d.glAccountDesc) {
                            const acct = applyCompanySegment(d.glAccountDesc);
                            updateExtLine(idx, 'offsetAccount', acct);
                            validateAccountCode(acct).then(r => {
                              const seg4 = Object.values(r.segmentDetails)[3];
                              updateExtLine(idx, 'offsetDesc', (seg4 as any)?.description || '');
                            }).catch(() => { updateExtLine(idx, 'offsetDesc', ''); });
                          }
                        }}
                        filterOption={false}
                      >
                        <Input size="small" variant="borderless" />
                      </AutoComplete>
                    </Space.Compact>
                  ),
                },
                {
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Offset Account <span style={{ color: '#ff4d4f' }}>*</span></span>,
                  width: 230,
                  render: (_: any, record: ExtTxnLine, idx: number) => (
                    <Space.Compact style={{ width: '100%' }}>
                      <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 10, color: REDWOOD.info, display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden' }}>
                        {record.offsetAccount || <span style={{ color: REDWOOD.neutral300, fontFamily: 'sans-serif', fontSize: 11 }}>—</span>}
                      </div>
                      <Button size="small" icon={<SearchOutlined />}
                        disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                        onClick={() => { setLineCoaIdx(idx); setLineCoaInitial(record.offsetAccount || ''); setLineCoaOpen(true); }} />
                    </Space.Compact>
                  ),
                },
                {
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Account Desc</span>,
                  width: 160,
                  render: (_: any, record: ExtTxnLine) => (
                    <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{record.offsetDesc || '—'}</span>
                  ),
                },
                {
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Description</span>,
                  width: 200,
                  render: (_: any, record: ExtTxnLine, idx: number) => (
                    <Input.TextArea
                      size="small" value={record.description}
                      disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                      placeholder="Optional"
                      autoSize={{ minRows: 1, maxRows: 5 }}
                      style={{ resize: 'none', fontSize: 12 }}
                      onChange={(e) => updateExtLine(idx, 'description', e.target.value)}
                    />
                  ),
                },
                {
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Amount ({watchedCurrency || 'CCY'}) <span style={{ color: '#ff4d4f' }}>*</span></span>,
                  width: 140,
                  align: 'right' as const,
                  render: (_: any, record: ExtTxnLine, idx: number) => (
                    <InputNumber
                      size="small" style={{ width: '100%' }} precision={2}
                      value={record.amount}
                      disabled={(isEdit && !editingEnabled) || !bankSelected || (saved && !editingEnabled)}
                      placeholder={txnDirection === 'DR' ? '+ve' : '-ve'}
                      onChange={(v) => {
                        if (v === null || v === undefined) { updateExtLine(idx, 'amount', v); return; }
                        const signed = txnDirection === 'DR' ? Math.abs(Number(v)) : -Math.abs(Number(v));
                        updateExtLine(idx, 'amount', signed);
                      }}
                    />
                  ),
                },
                ...(isForeignCurrency ? [{
                  title: <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>AED Equiv.</span>,
                  width: 100,
                  align: 'right' as const,
                  render: (_: any, record: ExtTxnLine) => {
                    const rate = form.getFieldValue('bankConversionRate');
                    if (!record.amount || !rate) return <span style={{ fontSize: 11, color: REDWOOD.neutral300 }}>—</span>;
                    const aed = Math.abs(record.amount) * Number(rate);
                    return (
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>
                        {aed.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    );
                  },
                }] : []),
                ...(!isEdit && !saved ? [{
                  title: '',
                  width: 36,
                  render: (_: any, record: ExtTxnLine) => (
                    <Tooltip title="Remove line">
                      <Button size="small" type="text" danger icon={<CloseOutlined />}
                        disabled={extTxnLines.length === 1}
                        onClick={() => setExtTxnLines(prev => prev.filter(l => l.key !== record.key))} />
                    </Tooltip>
                  ),
                }] : []),
              ]}
            />
            {!isEdit && !saved && !isAdhocPayment && (
              <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0' }}>
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  disabled={!bankSelected}
                  onClick={() => setExtTxnLines(prev => [
                    ...prev,
                    { key: Date.now(), amount: undefined, description: '', offsetAccount: '', offsetDesc: '' },
                  ])}
                >
                  Add Line
                </Button>
              </div>
            )}
          </div>

          {/* ══════════ SECTION 5: Attachments ══════════ */}
          <div className="ext-attach">
            <div className="ext-attach-title">
              <PaperClipOutlined style={{ color: REDWOOD.neutral600 }} /> Attachments
            </div>
            <Upload
              fileList={attachments.map(a => ({ uid: a.uid, name: a.name, status: a.status, size: a.fileSize, type: a.fileType }))}
              beforeUpload={(file) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                  const base64 = (e.target?.result as string)?.split(',')[1] || '';
                  setAttachments(prev => [...prev, { uid: `new-${Date.now()}`, name: file.name, fileType: file.type, fileSize: file.size, content: base64, rawFile: file, status: 'done' }]);
                };
                reader.readAsDataURL(file);
                return false;
              }}
              onRemove={(file) => new Promise((resolve) => {
                Modal.confirm({
                  title: 'Delete attachment?',
                  content: `"${file.name}" will be permanently removed.`,
                  okText: 'Delete',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  onOk: async () => {
                    const att = attachments.find(a => a.uid === file.uid);
                    if (att?.id && initialValues?.externalTransactionId) {
                      await fetch(`${APEX_BASE}/cash/externaltransactions/${initialValues.externalTransactionId}/attachments/${att.id}`, { method: 'DELETE' }).catch(() => {});
                    }
                    setAttachments(prev => prev.filter(a => a.uid !== file.uid));
                    resolve(false); // we manage fileList ourselves
                  },
                  onCancel: () => resolve(false),
                });
              })}
              onPreview={handlePreviewAttachment}
              onDownload={handleDownloadAttachment}
              showUploadList={false}
              multiple
              disabled={!isEdit && !saved}
            >
              <Button icon={<UploadOutlined />} disabled={!isEdit && !saved}>Attach Files</Button>
            </Upload>
            {attachments.map(att => {
              const fileObj = { uid: att.uid, name: att.name, status: att.status as any, size: att.fileSize, type: att.fileType };
              return (
                <div key={att.uid} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0', fontSize: 13 }}>
                  <PaperClipOutlined style={{ color: REDWOOD.neutral600, flexShrink: 0 }} />
                  <span style={{ flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={att.name}>{att.name}</span>
                  <Button type="text" size="small" icon={<EyeOutlined />} style={{ flexShrink: 0, padding: '0 4px' }} onClick={() => handlePreviewAttachment(fileObj)} />
                  <Button type="text" size="small" icon={<DownloadOutlined />} style={{ flexShrink: 0, padding: '0 4px' }} onClick={() => handleDownloadAttachment(fileObj)} />
                  <Button type="text" size="small" icon={<DeleteOutlined />} style={{ flexShrink: 0, padding: '0 4px', color: REDWOOD.error }}
                    onClick={() => {
                      Modal.confirm({
                        title: 'Delete attachment?',
                        content: `"${att.name}" will be permanently removed.`,
                        okText: 'Delete', okButtonProps: { danger: true }, cancelText: 'Cancel',
                        onOk: async () => {
                          if (att.id && initialValues?.externalTransactionId) {
                            await fetch(`${APEX_BASE}/cash/externaltransactions/${initialValues.externalTransactionId}/attachments/${att.id}`, { method: 'DELETE' }).catch(() => {});
                          }
                          setAttachments(prev => prev.filter(a => a.uid !== att.uid));
                        },
                      });
                    }}
                  />
                </div>
              );
            })}
            {previewLoading && <Spin size="small" style={{ marginTop: 8 }} />}
            {attachments.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>No attachments</Text>
            )}
          </div>

        </div>
      </Form>

      {/* ── Create Payee Modal ── */}
      <Modal
        title="Create New Payee"
        open={createPayeeVisible}
        onCancel={() => setCreatePayeeVisible(false)}
        confirmLoading={createPayeeSaving}
        onOk={async () => {
          try {
            const vals = await createPayeeForm.validateFields();
            setCreatePayeeSaving(true);
            const res = await fetch(`${APEX_BASE}/cash/payees`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ payeeName: vals.payeeName, taxRegistrationNumber: vals.taxRegistrationNumber || null, description: vals.description || null, active: 'Y' }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
            const newId = data.payee_id ?? data.payeeId ?? data.id;
            const newName = vals.payeeName;
            const newOption: PayeeOption = { label: newName, value: newId, payeeName: newName };
            onPayeeCreated(newOption);
            form.setFieldsValue({ payeeId: newId, payeeName: newName });
            setCreatePayeeVisible(false);
            message.success(`Payee "${newName}" created`);
          } catch (err: any) {
            if (err?.errorFields) return;
            message.error(`Failed to create payee: ${err?.message ?? err}`);
          } finally { setCreatePayeeSaving(false); }
        }}
        okText="Create Payee"
        width={480}
      >
        <Form form={createPayeeForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="Payee Name" name="payeeName" rules={[{ required: true, message: 'Payee name is required' }]}>
            <Input placeholder="Enter payee name" />
          </Form.Item>
          <Form.Item label="Tax Registration Number" name="taxRegistrationNumber">
            <Input placeholder="Optional" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={3} placeholder="Optional" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Sticky footer ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: REDWOOD.surface, borderTop: `1px solid ${REDWOOD.neutral200}`,
        padding: '12px 28px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', zIndex: 100, boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
      }}>
        <Space size={8}>
          {!isEdit && !saved && (
            <Button icon={<ApiOutlined />} onClick={handleApiOpen}
              style={{ color: REDWOOD.neutral600, borderColor: REDWOOD.neutral300 }}>
              API Inspector
            </Button>
          )}
          {(saved || isEdit || bankSelected) && (
            <Button icon={<PrinterOutlined />} onClick={handlePrintPdf}>
              Print PDF
            </Button>
          )}
          {saved && (
            <Space size={4}>
              <LockOutlined style={{ color: REDWOOD.success }} />
              <span style={{ fontSize: 13, color: REDWOOD.success, fontWeight: 600 }}>Saved &amp; Locked</span>
            </Space>
          )}
        </Space>
        <Space size={8}>
          {(isEdit ? (!isLocked && !editingEnabled) : (saved && !!(savedExtId ?? savedTxnId) && !editingEnabled && extTxnLines.length <= 1)) && (
            <Button
              size="large"
              icon={<EditOutlined />}
              onClick={() => setEditingEnabled(true)}
            >
              Edit
            </Button>
          )}
          {((isEdit && editingEnabled) || (!isEdit && saved && editingEnabled)) && (
            <Button
              size="large"
              type="primary"
              loading={saving}
              icon={<EditOutlined />}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={handleSubmit}
            >
              Save Changes
            </Button>
          )}
          {editingEnabled && (
            <Button size="large" onClick={() => setEditingEnabled(false)}>
              Cancel Edit
            </Button>
          )}
          {(() => {
            const extId = savedExtId ?? savedTxnId ?? initialValues?.externalTransactionId ?? null;
            const hasId = !!extId;
            return (
              <Tooltip title={!hasId ? 'Save the transaction first to enable attachments' : 'Save queued attachments'}>
                <Button
                  size="large"
                  icon={<PaperClipOutlined />}
                  loading={attSaving}
                  disabled={!hasId}
                  onClick={handleSaveAttachments}
                >
                  Save Attachments
                </Button>
              </Tooltip>
            );
          })()}
          {(saved || isEdit) && (() => {
            const txnId = savedExtId ?? savedTxnId ?? initialValues?.externalTransactionId;
            const hasPending = fApprovalStatus && fApprovalStatus !== 'NONE';
            return hasPending ? (
              <Button
                size="large"
                icon={<AuditOutlined />}
                style={{
                  color: fApprovalStatus === 'APPROVED' ? REDWOOD.success
                       : fApprovalStatus === 'REJECTED' ? REDWOOD.error
                       : REDWOOD.warning,
                  borderColor: fApprovalStatus === 'APPROVED' ? REDWOOD.success
                             : fApprovalStatus === 'REJECTED' ? REDWOOD.error
                             : REDWOOD.warning,
                }}
                onClick={() => setFApprovalStatusOpen(true)}
              >
                {fApprovalStatus === 'APPROVED' ? 'Approved'
               : fApprovalStatus === 'REJECTED' ? 'Rejected'
               : 'Approval Pending'}
              </Button>
            ) : (
              <Button
                size="large"
                icon={<SendOutlined />}
                style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={openFApprovalModal}
              >
                Send for Approval
              </Button>
            );
          })()}
          {(saved || (isEdit && !isLocked)) && onCreateAccounting && (
            <Button
              size="large"
              icon={<AccountBookOutlined />}
              style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
              onClick={() => {
                const values = form.getFieldsValue();
                const ids = savedExtIds.length > 0 ? savedExtIds : (savedExtId ? [savedExtId] : (initialValues?.externalTransactionId ? [initialValues.externalTransactionId] : []));
                const records: ExternalTxnRecord[] = ids.map((extId, i) => ({
                  externalTransactionId: extId,
                  transactionId:         initialValues?.transactionId ?? 0,
                  transactionDate:       values.transactionDate?.format('YYYY-MM-DD') ?? '',
                  valueDate:             values.valueDate?.format('YYYY-MM-DD') ?? '',
                  clearedDate:           '',
                  amount:                extTxnLines[i]?.amount ?? 0,
                  currencyCode:          values.currencyCode ?? '',
                  description:           extTxnLines[i]?.description ?? '',
                  referenceText:         values.referenceText ?? '',
                  source:                'ORA_MAN',
                  status:                initialValues?.status ?? 'UNR',
                  transactionType:       values.transactionType ?? '',
                  accountingFlag:        initialValues?.accountingFlag ?? '',
                  bankAccountName:       values.bankAccountName ?? '',
                  businessUnitName:      values.businessUnitName ?? '',
                  legalEntityName:       initialValues?.legalEntityName ?? '',
                  assetAccountCombination:  values.assetAccountCombination ?? '',
                  offsetAccountCombination: extTxnLines[i]?.offsetAccount ?? '',
                  bankConversionRate:    values.bankConversionRate ?? 0,
                  bankConversionRateType: values.bankConversionRateType ?? '',
                  transferId:            0,
                  checkNumber:           '',
                  reconReference:        '',
                  createdBy:             loggedUser,
                  creationDate:          new Date().toISOString(),
                  lastUpdateDate:        new Date().toISOString(),
                  syncDate:              '',
                  transactionDirection:  values.transactionDirection ?? txnDirection,
                  paymentMethod:         values.paymentMethod,
                  paymentDocument:       values.paymentDocument,
                  paperDocumentNumber:   values.paperDocumentNumber,
                  payeeName:             values.payeeName,
                  payeeId:               values.payeeId,
                }));
                onCreateAccounting(records);
              }}
            >
              Create Accounting
            </Button>
          )}
          {(saved || (isEdit && !isLocked)) && (
            <Space size={4}>
              <Popconfirm title="Delete this transaction?" description="This action cannot be undone."
                onConfirm={handleDelete} okText="Delete" okButtonProps={{ danger: true }}>
                <Button size="large" danger loading={deleting} icon={<DeleteOutlined />} style={{ minWidth: 110 }}>
                  Delete
                </Button>
              </Popconfirm>
              <Tooltip title="Show API Inspector (PUT / DELETE)">
                <Button size="large" icon={<ApiOutlined />} style={{ color: REDWOOD.neutral600 }}
                  onClick={async () => {
                    const extId = savedExtId ?? initialValues?.externalTransactionId;
                    const baseUrl = `${APEX_BASE}/cash/externaltransactions/${extId}`;
                    let values: any;
                    try { values = await form.validateFields(); } catch { values = form.getFieldsValue(); }
                    const line = extTxnLines[0];
                    const merged = { ...values, amount: line?.amount, description: line?.description ?? '', offsetAccountCombination: line?.offsetAccount ?? '' };
                    const putBody = JSON.stringify(buildPayload(merged), null, 2);
                    setApiPayload(putBody);
                    setApiResponse(null);
                    setApiModal(true);
                  }}
                />
              </Tooltip>
            </Space>
          )}
          {!isEdit && (
            <Button size="large"
              onClick={() => {
                form.resetFields();
                setSelectedBu(undefined);
                setSelectedBank(undefined);
                setSaved(false);
                setSavedExtId(null);
                setSavedExtIds([]);
                setExtTxnLines([{ key: 0, amount: undefined, description: '', offsetAccount: '', offsetDesc: '' }]);
                setAttachments([]);
                setTimeout(() => {
                  const sel = document.querySelector('.ext-txn-bu-select .ant-select-selector');
                  if (sel) (sel as HTMLElement).click();
                }, 100);
              }}
              style={{ minWidth: 110 }}
            >
              Clear Data
            </Button>
          )}
          <Button size="large" onClick={onCancel} style={{ minWidth: 100 }}>
            {isEdit || saved ? 'Close' : 'Cancel'}
          </Button>
          {!isEdit && !saved && (
            <Tooltip title={selectedBu && !derivedCompany ? 'No company code configured for this Business Unit. Cannot save.' : undefined}>
              <Button size="large" type="primary" loading={saving}
                disabled={!!(selectedBu && !derivedCompany)}
                onClick={handleSubmit} icon={<PlusOutlined />}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, minWidth: 180 }}
              >
                {extTxnLines.length > 1
                  ? `Save ${extTxnLines.length} Transaction${extTxnLines.length !== 1 ? 's' : ''}`
                  : 'Save'}
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>

      {/* ── Account Selector Modals ── */}
      <AccountSelector
        visible={cashAcctOpen}
        onCancel={() => setCashAcctOpen(false)}
        initialValue={form.getFieldValue('assetAccountCombination') || ''}
        onSelect={(code: string) => {
          form.setFieldValue('assetAccountCombination', code);
          setCashAcctOpen(false);
          validateAccountCode(code).then(r => {
            const seg4 = Object.values(r.segmentDetails)[3];
            setAssetAcctDesc((seg4 as any)?.description || '');
          }).catch(() => {});
        }}
      />
      <AccountSelector
        visible={offsetAcctOpen}
        onCancel={() => setOffsetAcctOpen(false)}
        initialValue={form.getFieldValue('offsetAccountCombination') || ''}
        lockedFirstSegment={derivedCompany || undefined}
        onSelect={(code: string) => {
          form.setFieldValue('offsetAccountCombination', code);
          setOffsetAcctOpen(false);
          validateAccountCode(code).then(r => {
            const seg4 = Object.values(r.segmentDetails)[3];
            setOffsetAcctDesc((seg4 as any)?.description || '');
          }).catch(() => {});
        }}
      />
      <AccountSelector
        visible={lineCoaOpen}
        onCancel={() => setLineCoaOpen(false)}
        initialValue={lineCoaInitial}
        lockedFirstSegment={derivedCompany || undefined}
        onSelect={(code: string) => {
          updateExtLine(lineCoaIdx, 'offsetAccount', code);
          validateAccountCode(code).then(r => {
            const seg4 = Object.values(r.segmentDetails)[3];
            updateExtLine(lineCoaIdx, 'offsetDesc', (seg4 as any)?.description || '');
          }).catch(() => {});
          setLineCoaOpen(false);
        }}
      />

      {/* ── API Inspector Modal ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — {isEdit ? 'PUT' : 'POST'} /cash/externaltransactions{isEdit && initialValues?.externalTransactionId ? `/${initialValues.externalTransactionId}` : ''}</span></Space>}
        open={apiModal} onCancel={() => setApiModal(false)} width={780} footer={null}
        styles={{ body: { padding: '16px 24px' } }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Endpoint: <Text code copyable style={{ fontSize: 12 }}>
            {isEdit && initialValues?.externalTransactionId
              ? `${APEX_BASE}/cash/externaltransactions/${initialValues.externalTransactionId}/updatetrx`
              : `${APEX_BASE}/cash/externaltransactions`}
          </Text>
          <Tag color={isEdit ? 'orange' : 'green'} style={{ marginLeft: 8 }}>{isEdit ? 'PUT' : 'POST'}</Tag>
        </Text>
        <div style={{ marginTop: 12, marginBottom: 8 }}><Text strong>Request Body (JSON)</Text></div>
        <pre style={{ background: '#1e1e2e', color: '#cdd6f4', padding: 16, borderRadius: 6, fontSize: 12, overflowX: 'auto', maxHeight: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
          {apiPayload}
        </pre>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<ApiOutlined />} loading={apiPosting} onClick={handleApiPost}
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
            {isEdit ? 'PUT Request' : 'POST Request'}
          </Button>
        </div>
        {apiResponse && (
          <>
            <Divider style={{ margin: '16px 0 12px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Text strong>Response</Text>
              <Tag color={apiResponse.status >= 200 && apiResponse.status < 300 ? 'success' : 'error'}>
                HTTP {apiResponse.status || 'Error'}
              </Tag>
            </div>
            <pre style={{
              background: apiResponse.status >= 200 && apiResponse.status < 300 ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${apiResponse.status >= 200 && apiResponse.status < 300 ? '#b7eb8f' : '#ffccc7'}`,
              color: REDWOOD.neutral900, padding: 16, borderRadius: 6, fontSize: 12,
              overflowX: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
            }}>
              {apiResponse.body}
            </pre>
          </>
        )}
      </Modal>

      {/* ── PDF Preview Modal ── */}
      <Modal
        open={pdfVisible}
        onCancel={() => { setPdfVisible(false); setPdfUrl(null); }}
        title={<Space><PrinterOutlined style={{ color: REDWOOD.primary }} /><span>External Transaction — PDF Preview</span></Space>}
        width="85vw"
        style={{ top: 20 }}
        footer={
          <Space>
            <Button onClick={() => { setPdfVisible(false); setPdfUrl(null); }}>Close</Button>
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              onClick={() => {
                if (pdfUrl) {
                  const a = document.createElement('a');
                  a.href = pdfUrl;
                  a.download = `external-transaction${savedExtId ? `-${savedExtId}` : ''}.pdf`;
                  a.click();
                }
              }}
            >
              Download PDF
            </Button>
          </Space>
        }
        destroyOnClose
      >
        {pdfUrl && (
          <iframe src={pdfUrl} style={{ width: '100%', height: '75vh', border: 'none' }} title="PDF Preview" />
        )}
      </Modal>

      {/* ── Attachment Preview Modal ──────────────────────────────────── */}
      <Modal
        title={<Space><PaperClipOutlined style={{ color: REDWOOD.info }} /><span>{previewAtt?.name}</span></Space>}
        open={!!previewAtt}
        onCancel={() => { if (previewAtt?.blobUrl) URL.revokeObjectURL(previewAtt.blobUrl); setPreviewAtt(null); }}
        footer={[
          <Button key="download" icon={<DownloadOutlined />} type="primary"
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
            onClick={() => {
              if (!previewAtt) return;
              const a = document.createElement('a');
              a.href = previewAtt.blobUrl || `data:${previewAtt.fileType};base64,${previewAtt.content}`;
              a.download = previewAtt.name;
              a.click();
            }}>
            Download
          </Button>,
          <Button key="close" onClick={() => { if (previewAtt?.blobUrl) URL.revokeObjectURL(previewAtt.blobUrl); setPreviewAtt(null); }}>Close</Button>,
        ]}
        width={860}
        styles={{ body: { padding: 0, minHeight: 200 } }}
      >
        {previewAtt && (() => {
          if (previewAtt.fileType?.startsWith('image/')) {
            return (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <img src={previewAtt.blobUrl} alt={previewAtt.name} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
              </div>
            );
          }
          if (previewAtt.fileType?.includes('pdf')) {
            return <iframe src={previewAtt.blobUrl} style={{ width: '100%', height: '70vh', border: 'none' }} title={previewAtt.name} />;
          }
          return (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <PaperClipOutlined style={{ fontSize: 48, color: REDWOOD.neutral600, marginBottom: 12 }} />
              <div><Text type="secondary">Preview not available for this file type ({previewAtt.fileType || 'unknown'}).</Text></div>
              <Button
                icon={<DownloadOutlined />}
                style={{ marginTop: 16 }}
                onClick={() => {
                  if (!previewAtt) return;
                  const a = document.createElement('a');
                  a.href = previewAtt.blobUrl || `data:${previewAtt.fileType};base64,${previewAtt.content}`;
                  a.download = previewAtt.name;
                  a.click();
                }}
              >
                Download to view
              </Button>
            </div>
          );
        })()}
      </Modal>

      {/* ── Send for Approval (form) ─────────────────────────────── */}
      <Modal
        title={<Space><SendOutlined style={{ color: REDWOOD.primary }} /><span>Send for Approval</span></Space>}
        open={fApprovalModalOpen}
        onCancel={() => { setFApprovalModalOpen(false); setFSelectedApprover(undefined); setFDebugOpen(false); }}
        footer={[
          <Button key="debug" icon={<BugOutlined />}
            style={{ float: 'left', color: fDebugSteps.length > 0 ? '#fa8c16' : REDWOOD.neutral600 }}
            onClick={() => setFDebugOpen(v => !v)}
            title="Show API debug info"
          >
            {fDebugOpen ? 'Hide' : 'Debug'}
          </Button>,
          <Button key="cancel" onClick={() => { setFApprovalModalOpen(false); setFSelectedApprover(undefined); setFDebugOpen(false); }}>Cancel</Button>,
          <Button key="send" type="primary" icon={<SendOutlined />} loading={fApprovalSending}
            disabled={!fSelectedApprover}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={handleFSendApproval}
          >Send</Button>,
        ]}
        width={580}
      >
        <div style={{ background: REDWOOD.neutral100, borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
          {[
            { label: 'Reference', value: form.getFieldValue('referenceText') || initialValues?.referenceText || '—' },
            { label: 'Amount',    value: (() => { const v = form.getFieldValue('amount') ?? initialValues?.amount; const c = form.getFieldValue('currencyCode') ?? initialValues?.currencyCode ?? ''; return v != null ? `${c} ${Math.abs(v).toLocaleString('en-AE', { minimumFractionDigits: 2 })}` : '—'; })() },
            { label: 'Type',      value: form.getFieldValue('transactionType') || initialValues?.transactionType || '—' },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text type="secondary">{row.label}</Text>
              <Text strong>{row.value}</Text>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 8 }}><Text strong style={{ fontSize: 13 }}>Select Approver</Text></div>
        <Select
          showSearch placeholder={fApprovalLoadingUsers ? 'Loading approvers...' : 'Select an approver'}
          loading={fApprovalLoadingUsers} style={{ width: '100%' }} optionFilterProp="label"
          value={fSelectedApprover} onChange={setFSelectedApprover}
          options={fApprovalUsers.map(u => ({
            label: `${u.fullName} — ${u.email}${u.department ? ` (${u.department})` : ''}`,
            value: u.email,
          }))}
        />
        {fApprovalUsers.length === 0 && !fApprovalLoadingUsers && (
          <Alert type="warning" style={{ marginTop: 12 }} showIcon
            message="No approvers found. Create an approval rule for module CASH, transaction type EXTERNAL_TXN in the Approval Engine." />
        )}
        {/* ── Debug Panel ── */}
        {fDebugOpen && (
          <div style={{ marginTop: 16, background: '#1a1a2e', borderRadius: 8, padding: 12, maxHeight: 340, overflowY: 'auto' }}>
            {fDebugSteps.length === 0 ? (
              <Text style={{ color: '#888', fontSize: 12 }}>No debug data yet — click Send to capture requests.</Text>
            ) : fDebugSteps.map((s, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Tag color={typeof s.status === 'number' && s.status >= 200 && s.status < 300 ? 'green' : 'red'} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {s.method} {s.status}
                  </Tag>
                  <Text style={{ color: '#a0cfff', fontSize: 11, fontFamily: 'monospace' }}>{s.step}</Text>
                </div>
                <div style={{ color: '#ffd580', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 2 }}>
                  URL: {s.url}
                </div>
                {!!s.payload && (
                  <pre style={{ color: '#b8f5c8', fontSize: 10, fontFamily: 'monospace', margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    PAYLOAD: {JSON.stringify(s.payload, null, 2)}
                  </pre>
                )}
                <pre style={{ color: '#f5c2c7', fontSize: 10, fontFamily: 'monospace', margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  RESPONSE: {JSON.stringify(s.response, null, 2)}
                </pre>
                {i < fDebugSteps.length - 1 && <div style={{ borderBottom: '1px solid #333', marginTop: 8 }} />}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ── View Approval Status (form) ──────────────────────────── */}
      <Modal
        title={<Space><AuditOutlined style={{ color: REDWOOD.info }} /><span>Approval Status</span></Space>}
        open={fApprovalStatusOpen}
        onCancel={() => setFApprovalStatusOpen(false)}
        footer={<Button onClick={() => setFApprovalStatusOpen(false)}>Close</Button>}
        width={460}
      >
        <div>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            {fApprovalStatus === 'APPROVED' && <Tag color="green"  style={{ fontSize: 14, padding: '4px 16px' }}>Approved</Tag>}
            {fApprovalStatus === 'REJECTED' && <Tag color="red"    style={{ fontSize: 14, padding: '4px 16px' }}>Rejected</Tag>}
            {fApprovalStatus === 'PENDING'  && <Tag color="orange" style={{ fontSize: 14, padding: '4px 16px' }}>Pending Approval</Tag>}
          </div>
          <div style={{ background: REDWOOD.neutral100, borderRadius: 8, padding: '12px 16px', fontSize: 13 }}>
            {[
              { label: 'Approval Ref',   value: fApprovalRef },
              { label: 'Sent By',        value: fApprovalSentBy },
              { label: 'Sent Date',      value: fApprovalSentDate ? dayjs(fApprovalSentDate).format('D MMM YYYY HH:mm') : undefined },
              { label: 'Approver',       value: fApproverName },
              { label: 'Approver Email', value: fApproverEmail },
              { label: 'Approved Date',  value: fApprovedDate ? dayjs(fApprovedDate).format('D MMM YYYY HH:mm') : undefined },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text type="secondary">{row.label}</Text>
                <Text strong>{row.value || '—'}</Text>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────────────────
const ManageExternalTransactions: React.FC<{ module?: 'ap' | 'cash' }> = ({ module = 'cash' }) => {
  const { user } = useAuth();
  const currentUser = user?.email ?? user?.username ?? 'SYSTEM';
  const { addSessionEntry } = useGlValidation();

  const [transactions, setTransactions]   = useState<ExternalTxnRecord[]>([]);
  const [loading, setLoading]             = useState(false);
  const [hasSearched, setHasSearched]     = useState(false);
  const [totalRecords, setTotalRecords]   = useState(0);
  const [pageNum, setPageNum]             = useState(1);
  const [pageSize, setPageSize]           = useState(25);
  const [allBankAccounts, setAllBankAccounts] = useState<BankAccountOption[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BUOption[]>([]);
  const [bankAccountMap, setBankAccountMap] = useState<Record<string, string>>({});
  const [bankAccountCurrencyMap, setBankAccountCurrencyMap] = useState<Record<string, string>>({});
  const [buLeMap, setBuLeMap]             = useState<Record<string, string>>({});
  const [buCompanyMap, setBuCompanyMap]   = useState<Record<string, string>>({});
  const [buBankMap, setBuBankMap]         = useState<Record<string, string[]>>({});
  const [payeeOptions, setPayeeOptions]   = useState<PayeeOption[]>([]);
  const [selectedBU, setSelectedBU]       = useState<string>('');
  const [derivedLE, setDerivedLE]         = useState<string>('');
  const [activeTabKey, setActiveTabKey]   = useState('search');
  const [tabs, setTabs]                   = useState<{ key: string; label: string; record?: ExternalTxnRecord }[]>([]);
  const [lastApiUrl, setLastApiUrl]       = useState('');
  const [showApiModal, setShowApiModal]   = useState(false);
  const [searchForm] = Form.useForm();

  // Bank accounts filtered by selected BU (or all if no BU selected)
  const filteredBankAccounts = selectedBU && buBankMap[selectedBU]
    ? buBankMap[selectedBU].sort().map(n => ({ label: n, value: n }))
    : allBankAccounts;

  // ── Account combinations (for description lookup in Create Accounting) ──────
  const [acctCombinations, setAcctCombinations] = useState<import('../../services/distCombinations.service').DistCombination[]>([]);
  useEffect(() => { searchCombinations({}).then(setAcctCombinations).catch(() => {}); }, []);

  // ── Accounting state ─────────────────────────────────────────────────────
  const [selectedRowKeys, setSelectedRowKeys]   = useState<number[]>([]);
  const [acctModalOpen, setAcctModalOpen]       = useState(false);
  const [acctProgress, setAcctProgress]         = useState<BankAcctProgressRow[]>([]);
  const [acctRunning, setAcctRunning]           = useState(false);
  const [acctDone, setAcctDone]                 = useState(false);

  // ── Single-row Create Accounting state ───────────────────────────────────
  const [singleAcctModalOpen, setSingleAcctModalOpen] = useState(false);
  const [singleAcctProgress, setSingleAcctProgress]   = useState<BankAcctProgressRow[]>([]);
  const [singleAcctRunning, setSingleAcctRunning]     = useState(false);
  const [singleAcctDone, setSingleAcctDone]           = useState(false);
  const [singleAcctTxnRecords, setSingleAcctTxnRecords] = useState<ExternalTxnRecord[]>([]);

  // ── View Accounting modal state ───────────────────────────────────────────
  const [viewAcctOpen, setViewAcctOpen]   = useState(false);
  const [viewAcctTxn, setViewAcctTxn]     = useState<ExternalTxnRecord | null>(null);
  const [viewAcctHeader, setViewAcctHeader] = useState<any>(null);
  const [viewAcctLines,  setViewAcctLines]  = useState<any[]>([]);
  const [viewAcctLoading, setViewAcctLoading] = useState(false);

  // ── Approval modal state ──────────────────────────────────────────────────
  const [approvalModalOpen, setApprovalModalOpen]       = useState(false);
  const [approvalTargetTxn, setApprovalTargetTxn]       = useState<ExternalTxnRecord | null>(null);
  const [approvalUsers, setApprovalUsers]               = useState<ApprovalUser[]>([]);
  const [approvalLoadingUsers, setApprovalLoadingUsers] = useState(false);
  const [approvalSending, setApprovalSending]           = useState(false);
  const [selectedApproverEmail, setSelectedApproverEmail] = useState<string | undefined>(undefined);
  const [approvalStatusOpen, setApprovalStatusOpen]     = useState(false);
  const [approvalStatusTxn, setApprovalStatusTxn]       = useState<ExternalTxnRecord | null>(null);
  const [approvalDebugSteps, setApprovalDebugSteps]     = useState<import('../../services/approvals.service').ApprovalDebugStep[]>([]);
  const [approvalDebugOpen, setApprovalDebugOpen]       = useState(false);

  // ── Accounting for all transactions ────────────────────────────────────────
  const [accountingAllModalOpen, setAccountingAllModalOpen] = useState(false);
  const [accountingAllData, setAccountingAllData] = useState<Array<{
    transactionId: number;
    transactionNumber: string;
    transactionDate: string;
    transactionAmount: number;
    debits: number;
    credits: number;
    debitAccount: string;
    debitAccountDesc: string;
    creditAccount: string;
    creditAccountDesc: string;
    glBatchId: number | null;
    glHeaderId: number | null;
    glStatus: string;
    isBalanced: boolean;
    hasMissingAccounts: boolean;
    hasAmountMismatch: boolean;
    hasAccounting: boolean;
    reference1: string;
    reference2: string;
    reference3: string;
    reference4: string;
    reference5: string;
    lines: any[];
  }>>([]);
  const [accountingAllLoading, setAccountingAllLoading] = useState(false);
  const [accountingApiUrls, setAccountingApiUrls] = useState<Array<{ url: string; status?: number; error?: string }>>([]);
  const [accountingApiModalOpen, setAccountingApiModalOpen] = useState(false);
  const [accountingSearchTerm, setAccountingSearchTerm] = useState('');
  const [accountingPageNum, setAccountingPageNum] = useState(1);
  const [accountingPageSize, setAccountingPageSize] = useState(10);

  const modulePrefix = module === 'ap' ? '/ap' : '/cash';

  const exportToExcel = () => {
    const rows = transactions.map(t => ({
      'Txn Number':       t.transactionId ?? '',
      'Bank Account':     t.bankAccountName ?? '',
      'Business Unit':    t.businessUnitName ?? '',
      'Date':             t.transactionDate ?? '',
      'Value Date':       t.valueDate ?? '',
      'Cleared Date':     t.clearedDate ?? '',
      'Amount':           t.amount ?? '',
      'Currency':         t.currencyCode ?? '',
      'Reference':        t.referenceText ?? '',
      'Description':      t.description ?? '',
      'Cash Account':     t.assetAccountCombination ?? '',
      'Offset Account':   t.offsetAccountCombination ?? '',
      'Transaction Type': t.transactionType ?? '',
      'Status':           t.status ?? '',
      'Origin':           t.source ?? '',
      'Legal Entity':     t.legalEntityName ?? '',
      'Accounting Flag':  t.accountingFlag ?? '',
      'Check Number':     t.checkNumber ?? '',
      'Recon Reference':  t.reconReference ?? '',
      'Created By':       t.createdBy ?? '',
      'Creation Date':    t.creationDate ?? '',
      'Last Update Date': t.lastUpdateDate ?? '',
      'Sync Date':        t.syncDate ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'External Transactions');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `external_transactions_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
  };

  const exportToPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const fmtDt = (v: any) => v ? dayjs(v).format('D-MMM-YYYY') : '—';
    const fmtAmt = (v: any) => v != null ? Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

    doc.setFillColor(191, 70, 0);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('External Transactions', 14, 10);
    doc.setFontSize(9);
    doc.text(`Printed: ${new Date().toLocaleString()}  |  Records: ${transactions.length}`, pageW - 14, 10, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    autoTable(doc, {
      startY: 20,
      head: [['Txn #', 'Bank Account', 'Business Unit', 'Date', 'Currency', 'Amount', 'Reference', 'Type', 'Status', 'Accounted']],
      body: transactions.map(t => {
        const rate = Number(t.bankConversionRate) || 1;
        const ccy = t.currencyCode || '';
        // Same layout as the vouchers: entered amount with the AED-accounted amount
        // (entered × rate) stacked below when the txn is not already in AED.
        const amtCell = (!ccy || ccy === 'AED')
          ? fmtAmt(t.amount)
          : `${fmtAmt(t.amount)} ${ccy}\nAED ${fmtAmt(Math.round((t.amount ?? 0) * rate * 100) / 100)}`;
        return [
          t.transactionId ?? '',
          t.bankAccountName ?? '',
          t.businessUnitName ?? '',
          fmtDt(t.transactionDate),
          ccy,
          amtCell,
          t.referenceText ?? '',
          t.transactionType ?? '',
          statusLabel(t.status),
          t.accountingFlag === 'Y' ? 'Posted' : 'No',
        ];
      }),
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [58, 58, 58] },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      columnStyles: {
        0: { cellWidth: 20 },
        3: { cellWidth: 24 },
        4: { cellWidth: 16 },
        5: { halign: 'right', cellWidth: 30 },
        8: { cellWidth: 24 },
        9: { cellWidth: 18 },
      },
      margin: { left: 14, right: 14 },
    });

    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 205, { align: 'center' });
      doc.text('Generated by ReactERP', 14, 205);
      doc.setTextColor(0);
    }

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // ── Load LOVs ─────────────────────────────────────────────────────────────
  const loadLovs = useCallback(async () => {
    const buLeMapping: Record<string, string> = {};
    const buCompanyMapping: Record<string, string> = {};
    const buSet = new Set<string>();

    // Step 1: BUs from gl/businessunits
    try {
      const buRes = await fetch(`${APEX_BASE}/gl/businessunits`, { headers: { Accept: 'application/json' } });
      const buData = buRes.ok ? await buRes.json() : null;
      if (buData?.items) {
        (buData.items as any[]).forEach(i => {
          const buName = i.business_unit_name || i.businessUnitName || '';
          const leName = i.legal_entity_name  || i.legalEntityName  || '';
          const company = i.company || '';
          if (buName) { buSet.add(buName); buLeMapping[buName] = leName; buCompanyMapping[buName] = company; }
        });
      }
    } catch { /* silent */ }

    setBuLeMap({ ...buLeMapping });
    setBuCompanyMap({ ...buCompanyMapping });
    setBusinessUnits([...buSet].sort().map(n => ({ label: n, value: n })));

    // Step 2: Payees from cash/payees
    try {
      const pyRes = await fetch(`${APEX_BASE}/cash/payees`, { headers: { Accept: 'application/json' } });
      const pyData = pyRes.ok ? await pyRes.json() : null;
      if (pyData?.items) {
        const opts: PayeeOption[] = (pyData.items as any[])
          .filter((i: any) => i.active !== 'N')
          .map((i: any) => ({
            label: i.payee_name || '',
            value: i.payee_id,
            payeeName: i.payee_name || '',
          }))
          .sort((a: PayeeOption, b: PayeeOption) => a.label.localeCompare(b.label));
        setPayeeOptions(opts);
      }
    } catch { /* silent */ }

    // Step 3: Bank accounts from banks/bankaccounts (same source as AP / Bank Recon)
    try {
      const baRes = await fetch(`${APEX_BASE}/banks/bankaccounts`, { headers: { Accept: 'application/json' } });
      const baData = baRes.ok ? await baRes.json() : null;
      if (baData?.items) {
        const acctMap: Record<string, string> = {};
        const ccyMap:  Record<string, string> = {};
        const allAccts: string[] = [];
        // Map: legal entity name → list of bank account names
        const leBankMap: Record<string, string[]> = {};
        (baData.items as any[]).forEach((i: any) => {
          const name = i.bank_account_name || '';
          if (!name) return;
          allAccts.push(name);
          if (i.cash_account_combination) acctMap[name] = i.cash_account_combination;
          if (i.currency_code)            ccyMap[name]  = i.currency_code;
          const le = (i.legal_entity_name || '').trim();
          if (le) {
            if (!leBankMap[le]) leBankMap[le] = [];
            leBankMap[le].push(name);
          }
        });
        setAllBankAccounts(allAccts.sort().map(n => ({ label: n, value: n })));
        setBankAccountMap(acctMap);
        setBankAccountCurrencyMap(ccyMap);

        // Build BU → bank accounts from bank master via legal entity
        const buBanksFromMaster: Record<string, string[]> = {};
        Object.entries(buLeMapping).forEach(([buName, leName]) => {
          const banks = leBankMap[leName] || [];
          if (banks.length > 0) buBanksFromMaster[buName] = banks;
        });
        if (Object.keys(buBanksFromMaster).length > 0) {
          setBuBankMap(buBanksFromMaster);
        }
      }
    } catch { /* silent */ }

    // Step 3: Scan existing transactions to build BU → bank-account mapping
    // and enrich acctMap / ccyMap with values from actual transaction records.
    try {
      const res = await fetch(`${APEX_BASE}/cash/externaltransactions?row_limit=2000`);
      const data = await parseApexJson(res);
      if (data.success && data.items) {
        const items: ExternalTxnRecord[] = data.items;
        const acctMap: Record<string, string>      = {};
        const ccyMap:  Record<string, string>      = {};
        const buBanks: Record<string, Set<string>> = {};
        // Build LE → bank map from transaction data as well
        const leBankMapFromTxn: Record<string, Set<string>> = {};

        items.forEach(i => {
          if (i.bankAccountName) {
            if (i.businessUnitName) {
              if (!buBanks[i.businessUnitName]) buBanks[i.businessUnitName] = new Set();
              buBanks[i.businessUnitName].add(i.bankAccountName);
              buSet.add(i.businessUnitName);
            }
            if (i.legalEntityName) {
              if (!leBankMapFromTxn[i.legalEntityName]) leBankMapFromTxn[i.legalEntityName] = new Set();
              leBankMapFromTxn[i.legalEntityName].add(i.bankAccountName);
            }
          }
          if (i.bankAccountName && i.assetAccountCombination)
            acctMap[i.bankAccountName] = i.assetAccountCombination;
          if (i.bankAccountName && i.currencyCode)
            ccyMap[i.bankAccountName] = i.currencyCode;
          if (i.businessUnitName && i.legalEntityName && !buLeMapping[i.businessUnitName])
            buLeMapping[i.businessUnitName] = i.legalEntityName;
        });

        // Merge transaction-derived account/currency hints (don't overwrite bank master)
        setBankAccountMap(prev => ({ ...prev, ...acctMap }));
        setBankAccountCurrencyMap(prev => ({ ...prev, ...ccyMap }));
        setBuLeMap({ ...buLeMapping });
        // Only fill buBankMap from transaction history for BUs not covered by bank master data
        // Build BU→bank via LE chain from transaction data (most reliable source)
        const buBanksViaLe: Record<string, string[]> = {};
        Object.entries(buLeMapping).forEach(([buName, leName]) => {
          const leSet = leBankMapFromTxn[leName];
          if (leSet?.size) buBanksViaLe[buName] = [...leSet];
        });

        setBuBankMap(prev => {
          const merged = { ...prev };
          // First layer: history-based BU → bank (direct)
          Object.entries(buBanks).forEach(([bu, set]) => {
            if (!merged[bu]) merged[bu] = [...set];
          });
          // Second layer: LE-chain derived (overrides if present, more accurate)
          Object.entries(buBanksViaLe).forEach(([bu, banks]) => {
            const existing = new Set(merged[bu] || []);
            banks.forEach(b => existing.add(b));
            merged[bu] = [...existing].sort();
          });
          return merged;
        });
        setBusinessUnits([...buSet].sort().map(n => ({ label: n, value: n })));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadLovs(); }, [loadLovs]);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const values = searchForm.getFieldsValue();

    // Resolve date range from preset
    let dateFrom: Dayjs | undefined;
    let dateTo: Dayjs | undefined;
    const preset = values.datePreset as string | undefined;
    if (preset === 'today') {
      dateFrom = dayjs(); dateTo = dayjs();
    } else if (preset === 'last5') {
      dateFrom = dayjs().subtract(4, 'day'); dateTo = dayjs();
    } else if (preset === 'last10') {
      dateFrom = dayjs().subtract(9, 'day'); dateTo = dayjs();
    } else if (preset === 'last30') {
      dateFrom = dayjs().subtract(29, 'day'); dateTo = dayjs();
    } else if (preset === 'range') {
      const range = values.dateRange as [Dayjs, Dayjs] | undefined;
      dateFrom = range?.[0];
      dateTo   = range?.[1];
    }
    if (!dateFrom || !dateTo) {
      message.warning('Please select a date filter before searching.');
      return;
    }

    const params = new URLSearchParams();
    if (values.transactionNumber)  params.set('transaction_number', values.transactionNumber);
    if (values.bankAccount)        params.set('bank_account',       values.bankAccount);
    if (values.businessUnit)       params.set('business_unit',      values.businessUnit);
    if (values.currencyCode)       params.set('currency_code',      values.currencyCode);
    if (values.transactionType)    params.set('transaction_type',   values.transactionType);
    if (values.source)             params.set('source',             values.source);
    if (values.status)             params.set('status',             values.status);
    if (values.reference)          params.set('reference',          values.reference);
    params.set('date_from', dateFrom.format('YYYY-MM-DD'));
    params.set('date_to',   dateTo.format('YYYY-MM-DD'));
    if (values.amountFrom != null) params.set('amount_from', String(values.amountFrom));
    if (values.amountTo   != null) params.set('amount_to',   String(values.amountTo));

    // Created date filter — resolve preset or explicit range
    const crPreset = values.createdPreset as string | undefined;
    if (crPreset === 'today') {
      params.set('creation_date_from', dayjs().format('YYYY-MM-DD'));
      params.set('creation_date_to',   dayjs().format('YYYY-MM-DD'));
    } else if (crPreset === 'last7') {
      params.set('creation_date_from', dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
      params.set('creation_date_to',   dayjs().format('YYYY-MM-DD'));
    } else if (crPreset === 'last10') {
      params.set('creation_date_from', dayjs().subtract(9, 'day').format('YYYY-MM-DD'));
      params.set('creation_date_to',   dayjs().format('YYYY-MM-DD'));
    } else {
      if (values.createdFrom) params.set('creation_date_from', (values.createdFrom as Dayjs).format('YYYY-MM-DD'));
      if (values.createdTo)   params.set('creation_date_to',   (values.createdTo   as Dayjs).format('YYYY-MM-DD'));
    }

    params.set('row_limit', '5000'); // fetch all, client-side pagination handles display

    const url = `${APEX_BASE}/cash/externaltransactions?${params.toString()}`;
    setLastApiUrl(url);
    setLoading(true);
    setHasSearched(true);
    try {
      const res  = await fetch(url);
      const data = await parseApexJson(res);
      if (data.success) {
        const items = data.items ?? [];
        setTransactions(items);
        setTotalRecords(items.length);
        const users = [...new Set(items.map((t: any) => t.createdBy).filter(Boolean))] as string[];
        setKnownUsers(prev => [...new Set([currentUser, ...prev, ...users])].filter(Boolean).sort());
        setPageNum(1);
        if (items.length === 0) message.info('No transactions found for the selected criteria.');
      } else {
        message.error(data.message || 'Search failed.');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally { setLoading(false); }
  }, [searchForm]);

  const handleBUChange = (bu: string) => {
    setSelectedBU(bu || '');
    setDerivedLE(bu ? (buLeMap[bu] || '') : '');
    // Clear bank account if it doesn't belong to this BU
    const banks = bu ? (buBankMap[bu] || []) : [];
    const currentBank = searchForm.getFieldValue('bankAccount');
    if (currentBank && banks.length > 0 && !banks.includes(currentBank)) {
      searchForm.setFieldValue('bankAccount', undefined);
    }
  };

  const handleReset = () => {
    searchForm.resetFields();
    searchForm.setFieldsValue({ datePreset: 'last5', dateRange: undefined, createdPreset: undefined, createdFrom: undefined, createdTo: undefined });
    setTransactions([]);
    setHasSearched(false);
    setSelectedRowKeys([]);
    setSelectedBU('');
    setDerivedLE('');
    setTotalRecords(0);
    setPageNum(1);
  };

  // ── Create Accounting ─────────────────────────────────────────────────────
  const fetchAccountDesc = async (code: string): Promise<string> => {
    if (!code) return '';
    try {
      const r = await validateAccountCode(code);
      const seg4 = Object.values(r.segmentDetails)[3];
      return (seg4 as any)?.description || '';
    } catch { return ''; }
  };

  const openCreateAccountingModal = async () => {
    const selected = transactions.filter(t => selectedRowKeys.includes(t.externalTransactionId));
    const noAccounts = selected.filter(t => !t.assetAccountCombination || !t.offsetAccountCombination);
    if (noAccounts.length > 0) {
      message.warning(`${noAccounts.length} row(s) have missing cash/offset account — they will be skipped.`);
    }

    // ── Check for existing GL journals ────────────────────────────────────
    const journalsExistList: { txn: ExternalTxnRecord; hasJournal: boolean }[] = [];
    for (const txn of selected) {
      try {
        const glResult = await getGlJournalLines({
          reference2: String(txn.externalTransactionId),
          reference5: 'BANK_EXTERNAL_TRANSACTIONS',
        });
        journalsExistList.push({
          txn,
          hasJournal: glResult.items && glResult.items.length > 0,
        });
      } catch (err) {
        journalsExistList.push({ txn, hasJournal: false });
      }
    }

    const withJournals = journalsExistList.filter(j => j.hasJournal);
    if (withJournals.length > 0) {
      Modal.confirm({
        title: 'Journals Already Exist',
        content: (
          <div>
            <p>
              The following {withJournals.length} transaction(s) already have GL journals posted:
            </p>
            <ul style={{ marginTop: 8 }}>
              {withJournals.slice(0, 5).map(j => (
                <li key={j.txn.externalTransactionId}>
                  Transaction {j.txn.transactionId} (Ext ID: {j.txn.externalTransactionId})
                </li>
              ))}
              {withJournals.length > 5 && <li>... and {withJournals.length - 5} more</li>}
            </ul>
            <p style={{ marginTop: 12, marginBottom: 0, fontWeight: 500 }}>
              Mark these as accounted and skip from create accounting?
            </p>
          </div>
        ),
        okText: 'Mark as Accounted',
        cancelText: 'Cancel',
        onOk: async () => {
          const flagErrors: string[] = [];

          for (const item of withJournals) {
            try {
              const flagUrl = `${APEX_BASE}/cash/externaltransactions/${item.txn.externalTransactionId}/acctflag?updated_by=${encodeURIComponent(currentUser)}`;
              const flagRes = await fetch(flagUrl, {
                method: 'PUT',
                headers: { Accept: 'application/json' },
              });
              const flagData = (await flagRes.json().catch(() => ({}))) as { success?: boolean; message?: string };
              if (!flagRes.ok || !flagData.success) {
                flagErrors.push(`Transaction ${item.txn.externalTransactionId}: ${flagData.message || `HTTP ${flagRes.status}`}`);
              } else {
                // Update local state
                setTransactions(prev => prev.map(t =>
                  t.externalTransactionId === item.txn.externalTransactionId
                    ? { ...t, accountingFlag: 'Y' }
                    : t
                ));
              }
            } catch (e: any) {
              flagErrors.push(`Transaction ${item.txn.externalTransactionId}: ${e.message}`);
            }
          }

          if (flagErrors.length > 0) {
            message.error(`Failed to mark ${flagErrors.length} transaction(s) as accounted. Check console for details.`);
            console.error('Flag update errors:', flagErrors);
          } else {
            message.success(`${withJournals.length} transaction(s) marked as accounted.`);
          }

          // Continue with remaining pending transactions
          const remainingSelected = selected.filter(
            t => !withJournals.some(j => j.txn.externalTransactionId === t.externalTransactionId)
          );
          if (remainingSelected.length === 0) {
            message.info('No pending transactions to create accounting for.');
            return;
          }
          proceedToAcctModal(remainingSelected);
        },
      });
    } else {
      // No existing journals, proceed directly
      proceedToAcctModal(selected);
    }
  };

  // Helper to proceed with Create Accounting modal for selected transactions
  const proceedToAcctModal = (selected: ExternalTxnRecord[]) => {
    const acctDesc = (code: string) =>
      acctCombinations.find(c => c.glAccountDesc === code)?.description ?? '';
    const rows: BankAcctProgressRow[] = selected.map(t => {
      const missingAccounts = !t.assetAccountCombination || !t.offsetAccountCombination;
      const alreadyAccounted = t.accountingFlag === 'Y';
      const date = t.transactionDate || t.valueDate || dayjs().format('YYYY-MM-DD');
      const absAmount = Math.abs(t.amount ?? 0);
      const direction = t.transactionDirection ?? ((t.amount ?? 0) >= 0 ? 'DR' : 'CR');
      const drAccount = direction === 'DR' ? t.assetAccountCombination : t.offsetAccountCombination;
      const crAccount = direction === 'DR' ? t.offsetAccountCombination : t.assetAccountCombination;
      return {
        extTxnId:      t.externalTransactionId,
        txnNumber:     t.transactionId,
        txnDate:       date,
        periodName:    derivePeriodName(new Date(date)),
        amount:        absAmount,
        currency:      t.currencyCode || 'AED',
        drAccount,
        drAccountDesc: acctDesc(drAccount),
        crAccount,
        crAccountDesc: acctDesc(crAccount),
        bu:            t.businessUnitName || '',
        rate:          t.bankConversionRate || 1,
        enteredCurrency: t.currencyCode || 'AED',
        ledgerCurrency:  'AED',
        status:        alreadyAccounted ? 'skipped' : missingAccounts ? 'error' : 'pending',
        message:       alreadyAccounted ? 'Already accounted — skipped' : missingAccounts ? 'Missing asset/offset account' : undefined,
      };
    });
    setAcctProgress(rows);
    setAcctDone(false);
    setAcctModalOpen(true);
    // Fetch descriptions asynchronously and patch rows
    rows.forEach(async (row) => {
      const [drDesc, crDesc] = await Promise.all([
        fetchAccountDesc(row.drAccount),
        fetchAccountDesc(row.crAccount),
      ]);
      setAcctProgress(prev => prev.map(r =>
        r.extTxnId === row.extTxnId ? { ...r, drAccountDesc: drDesc, crAccountDesc: crDesc } : r
      ));
    });
  };

  const fetchAccountingForAllTransactions = async () => {
    setAccountingAllLoading(true);
    setAccountingApiUrls([]);
    const data: typeof accountingAllData = [];
    const apiUrls: typeof accountingApiUrls = [];

    // Fetch accounting for ALL transactions (ignore main search filters)
    // Only apply text search if gridSearch is set
    const q = gridSearch.trim().toLowerCase();
    let base = transactions;
    const filtered = !q ? base : base.filter(r =>
      [r.externalTransactionId, r.transactionId, r.bankAccountName, r.businessUnitName,
       r.referenceText, r.description, r.status, r.source, r.transactionType,
       r.currencyCode, r.assetAccountCombination, r.offsetAccountCombination,
       r.transactionDate, r.payeeName, r.checkNumber, r.reconReference]
      .some(v => String(v ?? '').toLowerCase().includes(q))
    );

    for (const txn of filtered) {
      try {
        const glUrl = `${APEX_BASE}/gl/journals/lines?reference2=${txn.externalTransactionId}&reference5=BANK_EXTERNAL_TRANSACTIONS`;
        apiUrls.push({ url: glUrl });
        const glResult = await getGlJournalLines({
          reference2: String(txn.externalTransactionId),
          reference5: 'BANK_EXTERNAL_TRANSACTIONS',
        });

        const lines = glResult.items || (Array.isArray(glResult) ? glResult : []);
        const hasAccounting = lines && lines.length > 0;

        let totalDebits = 0;
        let totalCredits = 0;
        let debitAccount = '';
        let creditAccount = '';
        let glBatchId: number | null = null;
        let glHeaderId: number | null = null;
        let glStatus = '';
        let reference1 = '';
        let reference2 = '';
        let reference3 = '';
        let reference4 = '';
        let reference5 = '';

        if (hasAccounting) {
          lines.forEach((line: any, idx: number) => {
            const dr = line.entered_dr || line.enteredDr || 0;
            const cr = line.entered_cr || line.enteredCr || 0;
            totalDebits += Number(dr) || 0;
            totalCredits += Number(cr) || 0;

            if (idx === 0) {
              const account = line.account || line.accountCombination || '';
              if (dr > 0) debitAccount = account;
              if (cr > 0) creditAccount = account;
              glBatchId = line.je_batch_id || line.gl_batch_id || line.glBatchId || null;
              glHeaderId = line.je_header_id || line.gl_header_id || line.glHeaderId || null;
              glStatus = line.je_status || line.gl_status || line.glStatus || '';
              reference1 = line.reference1 || '';
              reference2 = line.reference2 || '';
              reference3 = line.reference3 || '';
              reference4 = line.reference4 || '';
              reference5 = line.reference5 || '';
            } else {
              const account = line.account || line.accountCombination || '';
              if (dr > 0 && !debitAccount) debitAccount = account;
              if (cr > 0 && !creditAccount) creditAccount = account;
            }
          });
        }

        // Fetch account descriptions if accounting exists
        let debitAccountDesc = '';
        let creditAccountDesc = '';
        if (hasAccounting) {
          try {
            if (debitAccount) {
              const drDesc = await fetchAccountDesc(debitAccount);
              debitAccountDesc = drDesc;
            }
            if (creditAccount) {
              const crDesc = await fetchAccountDesc(creditAccount);
              creditAccountDesc = crDesc;
            }
          } catch (e) {
            console.error('Error fetching account descriptions:', e);
          }
        }

        // Calculate validation flags
        const isBalanced = totalDebits > 0 ? Math.abs(totalDebits - totalCredits) < 0.01 : false;
        const hasMissingAccounts = hasAccounting && (!debitAccount || !creditAccount);
        const transactionAmount = Math.abs(txn.amount ?? 0);
        const hasAmountMismatch = hasAccounting && Math.abs(transactionAmount - totalDebits) > 0.01;

        data.push({
          transactionId: txn.transactionId,
          transactionNumber: String(txn.transactionId),
          transactionDate: txn.transactionDate,
          transactionAmount,
          debits: totalDebits,
          credits: totalCredits,
          debitAccount,
          debitAccountDesc,
          creditAccount,
          creditAccountDesc,
          glBatchId,
          glHeaderId,
          glStatus,
          isBalanced,
          hasMissingAccounts,
          hasAmountMismatch,
          hasAccounting,
          reference1,
          reference2,
          reference3,
          reference4,
          reference5,
          lines: hasAccounting ? lines : [],
        });
      } catch (err) {
        const glUrl = `${APEX_BASE}/gl/journals/lines?reference2=${txn.externalTransactionId}&reference5=BANK_EXTERNAL_TRANSACTIONS`;
        apiUrls.push({ url: glUrl, error: String(err) });
        // Add transaction with error flag
        data.push({
          transactionId: txn.transactionId,
          transactionNumber: String(txn.transactionId),
          transactionDate: txn.transactionDate,
          transactionAmount: Math.abs(txn.amount ?? 0),
          debits: 0,
          credits: 0,
          debitAccount: '',
          debitAccountDesc: '',
          creditAccount: '',
          creditAccountDesc: '',
          glBatchId: null,
          glHeaderId: null,
          glStatus: 'ERROR',
          isBalanced: false,
          hasMissingAccounts: false,
          hasAmountMismatch: false,
          hasAccounting: false,
          reference1: '',
          reference2: '',
          reference3: '',
          reference4: '',
          reference5: '',
          lines: [],
        });
        console.error(`Error fetching accounting for transaction ${txn.externalTransactionId}:`, err);
      }
    }

    setAccountingAllData(data);
    setAccountingApiUrls(apiUrls);
    setAccountingAllLoading(false);
  };

  // Full journal preview for a transaction row — the two balanced lines (DR/CR)
  // with entered (txn currency) and accounted (ledger currency = entered × rate).
  const renderAcctJournal = (r: BankAcctProgressRow) => {
    const rate = r.rate ?? 1;
    const entCcy = r.enteredCurrency ?? r.currency;
    const ledCcy = r.ledgerCurrency ?? 'AED';
    const acc = Math.round(r.amount * rate * 100) / 100;
    const cell: React.CSSProperties = { border: '1px solid #e5e7eb', padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' };
    const hd: React.CSSProperties = { border: '1px solid #e5e7eb', padding: '3px 8px', fontSize: 10, fontWeight: 600 };
    const lines = [
      { dc: 'DR', account: r.drAccount, desc: r.drAccountDesc, entDr: r.amount, entCr: 0, accDr: acc, accCr: 0 },
      { dc: 'CR', account: r.crAccount, desc: r.crAccountDesc, entDr: 0, entCr: r.amount, accDr: 0, accCr: acc },
    ];
    return (
      <div>
        {/* References Section */}
        <div style={{ background: '#f0f5ff', border: '1px solid #91caff', borderRadius: 4, padding: 10, marginBottom: 12 }}>
          <Typography.Text style={{ fontSize: 11, fontWeight: 600, color: '#0572CE', display: 'block', marginBottom: 8 }}>GL References</Typography.Text>
          <Row gutter={[12, 8]}>
            <Col xs={12} md={6}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Reference1 (Trx #)</Typography.Text>
              <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{r.txnNumber || r.extTxnId}</div>
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Reference2 (Ext Txn ID)</Typography.Text>
              <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{r.extTxnId}</div>
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Reference4 (Business Unit)</Typography.Text>
              <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{r.bu || '—'}</div>
            </Col>
            <Col xs={12} md={6}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Reference5 (Source)</Typography.Text>
              <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>BANK_EXTERNAL_TRANSACTIONS</div>
            </Col>
          </Row>
        </div>

        {/* Journal Lines Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '2px 0' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ ...hd, textAlign: 'left', width: 44 }}>Dr/Cr</th>
            <th style={{ ...hd, textAlign: 'left' }}>Account</th>
            <th style={{ ...hd, textAlign: 'right', background: '#e6f4ff', color: '#0572CE' }}>Entered DR ({entCcy})</th>
            <th style={{ ...hd, textAlign: 'right', background: '#e6f4ff', color: '#389e0d' }}>Entered CR ({entCcy})</th>
            <th style={{ ...hd, textAlign: 'right', background: '#f6ffed', color: '#0572CE' }}>Accounted DR ({ledCcy})</th>
            <th style={{ ...hd, textAlign: 'right', background: '#f6ffed', color: '#389e0d' }}>Accounted CR ({ledCcy})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) => (
            <tr key={i}>
              <td style={{ ...cell, color: ln.dc === 'DR' ? '#c74634' : '#1d7b4d', fontWeight: 600 }}>{ln.dc}</td>
              <td style={cell}><div>{ln.account || '—'}</div>{ln.desc && <div style={{ fontSize: 9, color: REDWOOD.neutral600 }}>{ln.desc}</div>}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{ln.entDr ? fmtAmount(ln.entDr, entCcy) : '—'}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{ln.entCr ? fmtAmount(ln.entCr, entCcy) : '—'}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{ln.accDr ? fmtAmount(ln.accDr, ledCcy) : '—'}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{ln.accCr ? fmtAmount(ln.accCr, ledCcy) : '—'}</td>
            </tr>
          ))}
          <tr style={{ background: '#fafafa', fontWeight: 700 }}>
            <td style={cell} colSpan={2}>Totals · rate {rate}{ledCcy !== entCcy ? ` · period ${r.periodName}` : ''}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{fmtAmount(r.amount, entCcy)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{fmtAmount(r.amount, entCcy)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{fmtAmount(acc, ledCcy)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{fmtAmount(acc, ledCcy)}</td>
          </tr>
        </tbody>
      </table>
      </div>
    );
  };

  const runCreateAccounting = async () => {
    setAcctRunning(true);

    const updateRow = (extTxnId: number, partial: Partial<BankAcctProgressRow>) =>
      setAcctProgress(prev => prev.map(r => r.extTxnId === extTxnId ? { ...r, ...partial } : r));

    for (const row of acctProgress) {
      if (row.status === 'skipped' || row.status === 'error') continue;

      updateRow(row.extTxnId, { status: 'running' });
      const txn = transactions.find(t => t.externalTransactionId === row.extTxnId);
      if (!txn) { updateRow(row.extTxnId, { status: 'error', message: 'Transaction not found' }); continue; }

      try {
        // 1. Resolve ledger dynamically
        const ledger = await fetchLedgerByBusinessUnit(txn.businessUnitName);
        if (!ledger) { updateRow(row.extTxnId, { status: 'error', message: 'Could not resolve ledger for BU' }); continue; }

        const direction = txn.transactionDirection ?? ((txn.amount ?? 0) >= 0 ? 'DR' : 'CR');
        const absAmount = Math.abs(txn.amount ?? 0);

        // DR = money in: DR bank/asset, CR offset
        // CR = money out: DR offset, CR bank/asset
        const drAccount = direction === 'DR' ? txn.assetAccountCombination : txn.offsetAccountCombination;
        const crAccount = direction === 'DR' ? txn.offsetAccountCombination : txn.assetAccountCombination;

        // Validate company codes match between DR and CR
        const drCompany = (drAccount || '').split('-')[0]?.trim();
        const crCompany = (crAccount || '').split('-')[0]?.trim();
        if (!drCompany || !crCompany) {
          updateRow(row.extTxnId, { status: 'error', message: `Company code not found for Business Unit '${txn.businessUnitName}'. Cannot create accounting without a valid company code.` });
          continue;
        }
        if (drCompany !== crCompany) {
          updateRow(row.extTxnId, { status: 'error', message: `Company code mismatch: DR account starts with '${drCompany}' but CR account starts with '${crCompany}'. Both must use the same company code.` });
          continue;
        }

        // buildPcBankTxnSlaPayload always makes offsetAccount the DR line and assetAccount the CR line
        const slaPayload = buildPcBankTxnSlaPayload({
          externalTransactionId:   txn.externalTransactionId,
          referenceText:           txn.referenceText || String(txn.externalTransactionId),
          transactionDate:         row.txnDate,
          accountingDate:          row.txnDate,
          periodName:              row.periodName,
          currency:                txn.currencyCode || 'AED',
          amount:                  absAmount,
          assetAccountCombination: crAccount,   // CR side goes to assetAccountCombination param
          offsetAccountCombination: drAccount,  // DR side goes to offsetAccountCombination param
          description:             txn.description || undefined,
          businessUnit:            txn.businessUnitName || undefined,
          legalEntity:             txn.legalEntityName  || undefined,
          ledgerId:                ledger.ledgerId,
          ledgerName:              ledger.ledgerName,
          // Apply the bank conversion rate so accounted (ledger currency) amounts are
          // entered × rate — otherwise accountedDr/Cr defaulted to the entered amount.
          exchangeRate:            txn.bankConversionRate ?? 1,
          ledgerCurrency:          'AED',
          createdBy:               currentUser,
        });

        // 2. Create SLA entry
        const slaResult = await createAccounting(slaPayload);

        // 3. Create GL journal
        const batchName = `BANK-${txn.externalTransactionId}-${Date.now()}`;
        const glPayload = {
          batch: {
            batchName, batchDescription: `Bank External Txn ${txn.externalTransactionId}`,
            ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
            accountingPeriod: row.periodName, controlTotal: absAmount,
            runningTotalDr: absAmount, runningTotalCr: absAmount,
            batchSource: 'Cash Management', createdBy: currentUser,
          },
          header: {
            ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
            jeCategory: 'Cash Management', jeSource: 'Cash Management',
            periodName: row.periodName,
            journalName: `BANK-EXT-${txn.externalTransactionId}`,
            description: `${txn.transactionType || 'Bank Txn'} – ${txn.referenceText || txn.externalTransactionId}`,
            currencyCode: txn.currencyCode || 'AED',
            currencyConversionType: 'User', currencyConversionDate: row.txnDate,
            currencyConversionRate: txn.bankConversionRate || 1,
            defaultEffectiveDate: row.txnDate,
            status: 'NEW', runningTotalDr: absAmount, runningTotalCr: absAmount,
            createdBy: currentUser,
          },
          lines: slaPayload.lines.map(l => ({
            enteredDr: l.lineType === 'DR' ? l.enteredDr : null,
            enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
            accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null,
            statAmount: null, description: l.description,
            currencyCode: l.currencyCode || txn.currencyCode || 'AED',
            currencyConversionDate: row.txnDate,
            currencyConversionRate: txn.bankConversionRate || 1,
            userCurrencyConversionType: 'User',
            accountCombination: l.accountCombination,
            chartOfAccountsName: 'Chart of Accounts',
            reference1: String(txn.transactionId),
            reference2: String(txn.externalTransactionId),
            reference3: l.accountingClass || null,
            reference4: txn.businessUnitName || null,
            reference5: 'BANK_EXTERNAL_TRANSACTIONS', createdBy: currentUser,
          })),
        };

        // GL pre-flight validation + session logging
        const validationPayload: GlJournalPayload = {
          batch: { batchName, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName, accountingPeriod: row.periodName, controlTotal: absAmount, runningTotalDr: absAmount, runningTotalCr: absAmount },
          header: { periodName: row.periodName, currencyCode: txn.currencyCode || 'AED', currencyConversionDate: row.txnDate, journalName: `BANK-EXT-${txn.externalTransactionId}` },
          lines: glPayload.lines.map((l: any) => ({ enteredDr: l.enteredDr, enteredCr: l.enteredCr, accountCombination: l.accountCombination, description: l.description, reference1: l.reference1 })),
        };
        const validation = validateGlPayload(validationPayload, { module: 'CASH', referenceNo: txn.referenceText || String(txn.externalTransactionId) });
        const logId = await persistValidationLog('CASH', txn.referenceText || String(txn.externalTransactionId), batchName, validation.valid ? 'PASSED' : 'FAILED', validation.errors, validationPayload, currentUser);
        addSessionEntry({
          logId: logId ?? Date.now(),
          module: 'CASH',
          referenceNo: txn.referenceText || String(txn.externalTransactionId),
          batchName,
          result: validation.valid ? 'PASSED' : 'FAILED',
          errorCount: validation.errors.filter(e => e.severity === 'ERROR').length,
          warningCount: validation.errors.filter(e => e.severity === 'WARNING').length,
          errorCategories: [...new Set(validation.errors.map(e => e.category))].join(',') || null,
          errorSummary: validation.errors.filter(e => e.severity === 'ERROR').map(e => `[${e.category}] ${e.message}`).join(' | ') || null,
          errorDetail: validation.errors,
          createdBy: currentUser,
          creationDate: new Date().toISOString(),
        });
        if (!validation.valid) {
          updateRow(row.extTxnId, { status: 'error', message: `GL validation failed: ${validation.errors.filter(e => e.severity === 'ERROR').map(e => e.category).join(', ')}` });
          continue;
        }

        const glRes = await fetch(`${APEX_BASE}/journals/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(glPayload),
        });

        let glMsg = '';
        if (glRes.ok) {
          const glData = await glRes.json();
          await fetch(`${APEX_BASE}/sla/accounting/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              headerId: slaResult.headerId,
              glBatchId: glData.batchId || 0,
              glBatchName: batchName,
              glHeaderId: glData.headerId || 0,
              postedBy: currentUser,
            }),
          });
          // 4. Stamp accounting flag via dedicated endpoint (no body parsing — URL params only)
          const flagUrl = `${APEX_BASE}/cash/externaltransactions/${txn.externalTransactionId}/acctflag?updated_by=${encodeURIComponent(currentUser)}`;
          const flagRes = await fetch(flagUrl, { method: 'PUT', headers: { Accept: 'application/json' } });
          const flagData = await flagRes.json().catch(() => ({})) as { success?: boolean; message?: string };
          if (!flagRes.ok || !flagData.success) {
            throw new Error(flagData.message || `Accounting flag update failed (HTTP ${flagRes.status})`);
          }
          // Update local state so the table reflects the change immediately
          setTransactions(prev => prev.map(t =>
            t.externalTransactionId === txn.externalTransactionId ? { ...t, accountingFlag: 'Y' } : t
          ));
          glMsg = `GL: ${batchName}`;
        } else {
          glMsg = 'GL journal failed — SLA is Draft';
        }

        updateRow(row.extTxnId, { status: 'success', message: `SLA ${slaResult.headerId} — ${glMsg}` });
      } catch (e: any) {
        updateRow(row.extTxnId, { status: 'error', message: e?.message || 'Unexpected error' });
      }
    }

    setAcctRunning(false);
    setAcctDone(true);
    setSelectedRowKeys([]);
  };

  // ── Single-row Create Accounting ──────────────────────────────────────────
  const openSingleAcctModal = async (txnOrTxns: ExternalTxnRecord | ExternalTxnRecord[]) => {
    const txnArray = Array.isArray(txnOrTxns) ? txnOrTxns : [txnOrTxns];
    const missing = txnArray.filter(t => !t.assetAccountCombination || !t.offsetAccountCombination);
    if (missing.length > 0) {
      message.warning('Some transactions are missing cash/offset accounts — cannot create accounting.');
      return;
    }

    // ── Check for existing GL journals ────────────────────────────────────
    const journalsExistList: { txn: ExternalTxnRecord; hasJournal: boolean }[] = [];
    for (const txn of txnArray) {
      try {
        const glResult = await getGlJournalLines({
          reference2: String(txn.externalTransactionId),
          reference5: 'BANK_EXTERNAL_TRANSACTIONS',
        });
        journalsExistList.push({
          txn,
          hasJournal: glResult.items && glResult.items.length > 0,
        });
      } catch (err) {
        journalsExistList.push({ txn, hasJournal: false });
      }
    }

    const withJournals = journalsExistList.filter(j => j.hasJournal);
    if (withJournals.length > 0) {
      Modal.confirm({
        title: 'Journals Already Exist',
        content: (
          <div>
            <p>
              The following {withJournals.length} transaction(s) already have GL journals posted:
            </p>
            <ul style={{ marginTop: 8 }}>
              {withJournals.map(j => (
                <li key={j.txn.externalTransactionId}>
                  Transaction {j.txn.transactionId} (Ext ID: {j.txn.externalTransactionId})
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 12, marginBottom: 0, fontWeight: 500 }}>
              Mark these as accounted and skip from create accounting?
            </p>
          </div>
        ),
        okText: 'Mark as Accounted',
        cancelText: 'Cancel',
        onOk: async () => {
          const flagErrors: string[] = [];

          for (const item of withJournals) {
            try {
              const flagUrl = `${APEX_BASE}/cash/externaltransactions/${item.txn.externalTransactionId}/acctflag?updated_by=${encodeURIComponent(currentUser)}`;
              const flagRes = await fetch(flagUrl, {
                method: 'PUT',
                headers: { Accept: 'application/json' },
              });
              const flagData = (await flagRes.json().catch(() => ({}))) as { success?: boolean; message?: string };
              if (!flagRes.ok || !flagData.success) {
                flagErrors.push(`Transaction ${item.txn.externalTransactionId}: ${flagData.message || `HTTP ${flagRes.status}`}`);
              } else {
                // Update local state
                setTransactions(prev => prev.map(t =>
                  t.externalTransactionId === item.txn.externalTransactionId
                    ? { ...t, accountingFlag: 'Y' }
                    : t
                ));
              }
            } catch (e: any) {
              flagErrors.push(`Transaction ${item.txn.externalTransactionId}: ${e.message}`);
            }
          }

          if (flagErrors.length > 0) {
            message.error(`Failed to mark ${flagErrors.length} transaction(s) as accounted. Check console for details.`);
            console.error('Flag update errors:', flagErrors);
          } else {
            message.success(`${withJournals.length} transaction(s) marked as accounted.`);
          }

          // Continue with remaining pending transactions
          const remainingTxns = txnArray.filter(
            t => !withJournals.some(j => j.txn.externalTransactionId === t.externalTransactionId)
          );
          if (remainingTxns.length === 0) {
            message.info('No pending transactions to create accounting for.');
            return;
          }
          proceedToSingleAcctModal(remainingTxns);
        },
      });
    } else {
      // No existing journals, proceed directly
      proceedToSingleAcctModal(txnArray);
    }
  };

  // Helper to proceed with single-row Create Accounting modal for selected transactions
  const proceedToSingleAcctModal = (txnArray: ExternalTxnRecord[]) => {
    const acctDesc = (code: string) =>
      acctCombinations.find(c => c.glAccountDesc === code)?.description ?? '';
    const rows: BankAcctProgressRow[] = txnArray.map(txn => {
      const date = txn.transactionDate || txn.valueDate || dayjs().format('YYYY-MM-DD');
      const absAmount = Math.abs(txn.amount ?? 0);
      const direction = txn.transactionDirection ?? ((txn.amount ?? 0) >= 0 ? 'DR' : 'CR');
      const drAccount = direction === 'DR' ? txn.assetAccountCombination : txn.offsetAccountCombination;
      const crAccount = direction === 'DR' ? txn.offsetAccountCombination : txn.assetAccountCombination;
      return {
        extTxnId:      txn.externalTransactionId,
        txnNumber:     txn.transactionId,
        txnDate:       date,
        periodName:    derivePeriodName(new Date(date)),
        amount:        absAmount,
        currency:      txn.currencyCode || 'AED',
        drAccount,
        drAccountDesc: acctDesc(drAccount),
        crAccount,
        crAccountDesc: acctDesc(crAccount),
        bu:            txn.businessUnitName || '',
        rate:          txn.bankConversionRate || 1,
        enteredCurrency: txn.currencyCode || 'AED',
        ledgerCurrency:  'AED',
        status:        'pending' as const,
      };
    });
    setSingleAcctProgress(rows);
    setSingleAcctDone(false);
    setSingleAcctTxnRecords(txnArray);
    setSingleAcctModalOpen(true);
    // Fetch descriptions asynchronously and patch rows
    rows.forEach(async (row) => {
      const [drDesc, crDesc] = await Promise.all([
        fetchAccountDesc(row.drAccount),
        fetchAccountDesc(row.crAccount),
      ]);
      setSingleAcctProgress(prev => prev.map(r =>
        r.extTxnId === row.extTxnId ? { ...r, drAccountDesc: drDesc, crAccountDesc: crDesc } : r
      ));
    });
  };

  const runSingleAccounting = async () => {
    setSingleAcctRunning(true);
    const updateRow = (extTxnId: number, partial: Partial<BankAcctProgressRow>) =>
      setSingleAcctProgress(prev => prev.map(r => r.extTxnId === extTxnId ? { ...r, ...partial } : r));

    for (const row of singleAcctProgress) {
      if (row.status === 'skipped' || row.status === 'error') continue;
      updateRow(row.extTxnId, { status: 'running' });
      const txn = transactions.find(t => t.externalTransactionId === row.extTxnId)
        ?? singleAcctTxnRecords.find(t => t.externalTransactionId === row.extTxnId)
        ?? null;
      if (!txn) { updateRow(row.extTxnId, { status: 'error', message: 'Transaction not found' }); continue; }
      try {
        const ledger = await fetchLedgerByBusinessUnit(txn.businessUnitName);
        if (!ledger) { updateRow(row.extTxnId, { status: 'error', message: 'Could not resolve ledger for BU' }); continue; }
        const direction = txn.transactionDirection ?? ((txn.amount ?? 0) >= 0 ? 'DR' : 'CR');
        const absAmount = Math.abs(txn.amount ?? 0);
        const drAccount = direction === 'DR' ? txn.assetAccountCombination : txn.offsetAccountCombination;
        const crAccount = direction === 'DR' ? txn.offsetAccountCombination : txn.assetAccountCombination;

        // Validate company codes match between DR and CR
        const drCompany = (drAccount || '').split('-')[0]?.trim();
        const crCompany = (crAccount || '').split('-')[0]?.trim();
        if (!drCompany || !crCompany) {
          updateRow(row.extTxnId, { status: 'error', message: `Company code not found for Business Unit '${txn.businessUnitName}'. Cannot create accounting without a valid company code.` });
          continue;
        }
        if (drCompany !== crCompany) {
          updateRow(row.extTxnId, { status: 'error', message: `Company code mismatch: DR account starts with '${drCompany}' but CR account starts with '${crCompany}'. Both must use the same company code.` });
          continue;
        }

        const slaPayload = buildPcBankTxnSlaPayload({
          externalTransactionId:   txn.externalTransactionId,
          referenceText:           txn.referenceText || String(txn.externalTransactionId),
          transactionDate:         row.txnDate,
          accountingDate:          row.txnDate,
          periodName:              row.periodName,
          currency:                txn.currencyCode || 'AED',
          amount:                  absAmount,
          assetAccountCombination: crAccount,
          offsetAccountCombination: drAccount,
          description:             txn.description || undefined,
          businessUnit:            txn.businessUnitName || undefined,
          legalEntity:             txn.legalEntityName  || undefined,
          ledgerId:                ledger.ledgerId,
          ledgerName:              ledger.ledgerName,
          // Apply the bank conversion rate so accounted (ledger currency) amounts are
          // entered × rate — otherwise accountedDr/Cr defaulted to the entered amount.
          exchangeRate:            txn.bankConversionRate ?? 1,
          ledgerCurrency:          'AED',
          createdBy:               currentUser,
        });
        const slaResult = await createAccounting(slaPayload);
        const batchName = `BANK-${txn.externalTransactionId}-${Date.now()}`;
        const glPayload = {
          batch: {
            batchName, batchDescription: `Bank External Txn ${txn.externalTransactionId}`,
            ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
            accountingPeriod: row.periodName, controlTotal: absAmount,
            runningTotalDr: absAmount, runningTotalCr: absAmount,
            batchSource: 'Cash Management', createdBy: currentUser,
          },
          header: {
            ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
            jeCategory: 'Cash Management', jeSource: 'Cash Management',
            periodName: row.periodName,
            journalName: `BANK-EXT-${txn.externalTransactionId}`,
            description: `${txn.transactionType || 'Bank Txn'} – ${txn.referenceText || txn.externalTransactionId}`,
            currencyCode: txn.currencyCode || 'AED',
            currencyConversionType: 'User', currencyConversionDate: row.txnDate,
            currencyConversionRate: txn.bankConversionRate || 1,
            defaultEffectiveDate: row.txnDate,
            status: 'NEW', runningTotalDr: absAmount, runningTotalCr: absAmount,
            createdBy: currentUser,
          },
          lines: slaPayload.lines.map(l => ({
            enteredDr: l.lineType === 'DR' ? l.enteredDr : null,
            enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
            accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null,
            statAmount: null, description: l.description,
            currencyCode: l.currencyCode || txn.currencyCode || 'AED',
            currencyConversionDate: row.txnDate,
            currencyConversionRate: txn.bankConversionRate || 1,
            userCurrencyConversionType: 'User',
            accountCombination: l.accountCombination,
            chartOfAccountsName: 'Chart of Accounts',
            reference1: String(txn.transactionId),
            reference2: String(txn.externalTransactionId),
            reference3: l.accountingClass || null,
            reference4: txn.businessUnitName || null,
            reference5: 'BANK_EXTERNAL_TRANSACTIONS', createdBy: currentUser,
          })),
        };
        // GL pre-flight validation + session logging
        const validationPayload: GlJournalPayload = {
          batch: { batchName, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName, accountingPeriod: row.periodName, controlTotal: absAmount, runningTotalDr: absAmount, runningTotalCr: absAmount },
          header: { periodName: row.periodName, currencyCode: txn.currencyCode || 'AED', currencyConversionDate: row.txnDate, journalName: `BANK-EXT-${txn.externalTransactionId}` },
          lines: glPayload.lines.map((l: any) => ({ enteredDr: l.enteredDr, enteredCr: l.enteredCr, accountCombination: l.accountCombination, description: l.description, reference1: l.reference1 })),
        };
        const validation = validateGlPayload(validationPayload, { module: 'CASH', referenceNo: txn.referenceText || String(txn.externalTransactionId) });
        const logId = await persistValidationLog('CASH', txn.referenceText || String(txn.externalTransactionId), batchName, validation.valid ? 'PASSED' : 'FAILED', validation.errors, validationPayload, currentUser);
        addSessionEntry({
          logId: logId ?? Date.now(),
          module: 'CASH',
          referenceNo: txn.referenceText || String(txn.externalTransactionId),
          batchName,
          result: validation.valid ? 'PASSED' : 'FAILED',
          errorCount: validation.errors.filter(e => e.severity === 'ERROR').length,
          warningCount: validation.errors.filter(e => e.severity === 'WARNING').length,
          errorCategories: [...new Set(validation.errors.map(e => e.category))].join(',') || null,
          errorSummary: validation.errors.filter(e => e.severity === 'ERROR').map(e => `[${e.category}] ${e.message}`).join(' | ') || null,
          errorDetail: validation.errors,
          createdBy: currentUser,
          creationDate: new Date().toISOString(),
        });
        if (!validation.valid) {
          updateRow(row.extTxnId, { status: 'error', message: `GL validation failed: ${validation.errors.filter(e => e.severity === 'ERROR').map(e => e.category).join(', ')}` });
          continue;
        }
        const glRes = await fetch(`${APEX_BASE}/journals/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(glPayload),
        });
        let glMsg = '';
        if (glRes.ok) {
          const glData = await glRes.json();
          await fetch(`${APEX_BASE}/sla/accounting/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              headerId: slaResult.headerId,
              glBatchId: glData.batchId || 0,
              glBatchName: batchName,
              glHeaderId: glData.headerId || 0,
              postedBy: currentUser,
            }),
          });
          const flagUrl = `${APEX_BASE}/cash/externaltransactions/${txn.externalTransactionId}/acctflag?updated_by=${encodeURIComponent(currentUser)}`;
          const flagRes = await fetch(flagUrl, { method: 'PUT', headers: { Accept: 'application/json' } });
          const flagData = await flagRes.json().catch(() => ({})) as { success?: boolean; message?: string };
          if (!flagRes.ok || !flagData.success) {
            throw new Error(flagData.message || `Accounting flag update failed (HTTP ${flagRes.status})`);
          }
          setTransactions(prev => prev.map(t =>
            t.externalTransactionId === txn.externalTransactionId ? { ...t, accountingFlag: 'Y' } : t
          ));
          glMsg = `GL: ${batchName}`;
        } else {
          glMsg = 'GL journal failed — SLA is Draft';
        }
        updateRow(row.extTxnId, { status: 'success', message: `SLA ${slaResult.headerId} — ${glMsg}` });
      } catch (e: any) {
        updateRow(row.extTxnId, { status: 'error', message: e?.message || 'Unexpected error' });
      }
    }
    setSingleAcctRunning(false);
    setSingleAcctDone(true);
  };

  // ── Tab management ────────────────────────────────────────────────────────
  const openCreateTab = () => {
    const key   = newTabKey();
    const label = 'New Transaction';
    setTabs(prev => [...prev, { key, label }]);
    setActiveTabKey(key);
  };

  const openEditTab = (record: ExternalTxnRecord) => {
    const existing = tabs.find(t => t.record?.externalTransactionId === record.externalTransactionId);
    if (existing) { setActiveTabKey(existing.key); return; }
    const key   = newTabKey();
    const label = `Txn #${record.transactionId ?? record.externalTransactionId}`;
    setTabs(prev => [...prev, { key, label, record }]);
    setActiveTabKey(key);
  };

  const openReverseTab = (record: ExternalTxnRecord) => {
    const origDir  = record.transactionDirection ?? (record.amount >= 0 ? 'DR' : 'CR');
    const newDir   = origDir === 'DR' ? 'CR' : 'DR';
    const origRef  = record.referenceText   || String(record.transactionId ?? record.externalTransactionId);
    const origDoc  = record.paymentDocument || '';
    const reversed: Partial<ExternalTxnRecord> = {
      ...record,
      externalTransactionId: undefined as any,  // omit so form treats as new creation
      transactionId:         undefined as any,
      transactionDirection:  newDir,
      amount:                -(record.amount ?? 0),  // negate: +ve In → -ve Out and vice-versa
      referenceText:         `Reverse:${origRef}`,
      paymentDocument:       origDoc ? `Reverse:${origDoc}` : record.paymentDocument,
      accountingFlag:        'N',
      status:                'UNR',
      creationDate:          undefined as any,
      lastUpdateDate:        undefined as any,
      syncDate:              undefined as any,
    };
    const key   = newTabKey();
    const label = `Reverse: Txn #${record.transactionId ?? record.externalTransactionId}`;
    setTabs(prev => [...prev, { key, label, record: reversed as ExternalTxnRecord }]);
    setActiveTabKey(key);
  };

  const openCopyTab = (record: ExternalTxnRecord) => {
    const origRef = record.referenceText   || String(record.transactionId ?? record.externalTransactionId);
    const origDoc = record.paymentDocument || '';
    const copied: Partial<ExternalTxnRecord> = {
      ...record,
      externalTransactionId: undefined as any,
      transactionId:         undefined as any,
      referenceText:         `Copy:${origRef}`,
      paymentDocument:       origDoc ? `Copy:${origDoc}` : record.paymentDocument,
      accountingFlag:        'N',
      status:                'UNR',
      creationDate:          undefined as any,
      lastUpdateDate:        undefined as any,
      syncDate:              undefined as any,
    };
    const key   = newTabKey();
    const label = `Copy: Txn #${record.transactionId ?? record.externalTransactionId}`;
    setTabs(prev => [...prev, { key, label, record: copied as ExternalTxnRecord }]);
    setActiveTabKey(key);
  };

  const closeTab = (key: string) => {
    setTabs(prev => prev.filter(t => t.key !== key));
    if (activeTabKey === key) setActiveTabKey('search');
  };

  // ── Voucher PDF ──────────────────────────────────────────────────────────
  const [voucherPdfUrl, setVoucherPdfUrl] = useState<string | null>(null);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);

  const generateVoucherPdf = async (r: ExternalTxnRecord) => {
    // Resolve offset account description + sub-account description
    let offsetAcctDesc = '';
    let offsetSubDesc = '';
    if (r.offsetAccountCombination) {
      try {
        const res = await validateAccountCode(r.offsetAccountCombination);
        const segs = Object.values(res.segmentDetails);
        offsetAcctDesc = segs[3]?.description || '';
        offsetSubDesc  = segs[4]?.description || '';
      } catch { /* leave blank */ }
    }

    // Resolve cash/asset account description
    let assetDesc = '';
    if (r.assetAccountCombination) {
      try {
        const res = await validateAccountCode(r.assetAccountCombination);
        assetDesc = Object.values(res.segmentDetails)[3]?.description || '';
      } catch { /* leave blank */ }
    }
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const fmt = (v: any) => v != null && v !== '' ? String(v) : '—';
    const fmtNum = (v: any) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—';
    const fmtDt = (v: any) => {
      if (!v) return '—';
      try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return String(v); }
    };

    // Header bar
    doc.setFillColor(191, 70, 0);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('External Transaction', 14, 11);
    doc.setFontSize(9);
    doc.text(`Printed: ${new Date().toLocaleString()}`, pageW - 14, 11, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    let y = 26;

    // Transaction ID
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`Transaction ID: ${r.transactionId || r.externalTransactionId}`, 14, y);
    y += 8;

    // Section 1: Organisation & Bank
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Organisation & Bank', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ['Business Unit', fmt(r.businessUnitName), 'Legal Entity', fmt(r.legalEntityName)],
        ['Bank Account', fmt(r.bankAccountName), 'Currency', fmt(r.currencyCode)],
        ['Cash / Asset Account', fmt(r.assetAccountCombination), 'Direction', r.transactionDirection === 'DR' ? 'Money In (DR)' : 'Money Out (CR)'],
        ...(assetDesc ? [['Account Description', assetDesc, '', '']] : []),
      ],
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section 2: Transaction Details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Transaction Details', 14, y);
    y += 2;
    const inverseRate = r.bankConversionRate && r.bankConversionRate > 0
      ? Math.round((1 / r.bankConversionRate) * 10000000000) / 10000000000
      : null;
    autoTable(doc, {
      startY: y,
      body: [
        ['Transaction Date', fmtDt(r.transactionDate), 'Value Date', fmtDt(r.valueDate)],
        ['Transaction Type', fmt(r.transactionType), 'Reference', fmt(r.referenceText)],
        ['Payment Method', fmt(r.paymentMethod), 'Payment Document', fmt(r.paymentDocument)],
        ['Paper Doc #', fmt(r.paperDocumentNumber), 'Conv. Rate Type', fmt(r.bankConversionRateType)],
        [`Conv. Rate (${r.currencyCode || 'FCY'}→AED)`, fmtNum(r.bankConversionRate),
         `Inverse Rate (AED→${r.currencyCode || 'FCY'})`, fmtNum(inverseRate)],
      ],
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section 3: Payee Details (if adhoc)
    if (r.transactionType === 'Adhoc Payment' && r.payeeName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Payee Details', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        body: [
          ['Payee Name', fmt(r.payeeName), 'Check #', fmt(r.checkNumber)],
        ],
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
        alternateRowStyles: { fillColor: [247, 247, 247] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // Section 4: Transaction Lines
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Transaction Lines', 14, y);
    y += 2;
    const fmtAmt = (v: number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Amount cell shows the entered amount and, when the txn is not in AED, the
    // AED-accounted amount (entered × conversion rate) stacked right below it.
    const vRate = Number(r.bankConversionRate) || 1;
    const vCcy = r.currencyCode || 'FCY';
    const entered = Math.abs(r.amount);
    const accounted = Math.round(entered * vRate * 100) / 100;
    const amtCell = vCcy === 'AED'
      ? fmtAmt(entered)
      : `${fmtAmt(entered)} ${vCcy}\nAED ${fmtAmt(accounted)}`;
    autoTable(doc, {
      startY: y,
      head: [['#', 'Offset Account', 'Account Desc', 'Sub-Account Desc', 'Description', 'Amount']],
      body: [[1, r.offsetAccountCombination || '—', offsetAcctDesc || '—', offsetSubDesc || '—', r.description || '—', amtCell]],
      foot: [['', '', '', '', 'Total', amtCell]],
      styles: { fontSize: 8, cellPadding: 2, textColor: [0, 0, 0] },
      headStyles: { fillColor: [58, 58, 58], textColor: [255, 255, 255] },
      footStyles: { fillColor: [255, 255, 255], fontStyle: 'bold', textColor: [0, 0, 0], halign: 'right' },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 40 }, 5: { halign: 'right', cellWidth: 30 } },
      margin: { left: 14, right: 14 },
    });

    // Footer with signature lines — same as edit-screen print
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const sigY = 272;
      const col1 = 14, col2 = 80, col3 = 146;
      const lineLen = 55;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0);
      doc.text(currentUser, col1, sigY - 3);
      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.line(col1, sigY, col1 + lineLen, sigY);
      doc.line(col2, sigY, col2 + lineLen, sigY);
      doc.line(col3, sigY, col3 + lineLen, sigY);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Created By', col1, sigY + 4);
      doc.text('Approved By', col2, sigY + 4);
      doc.text('Received By', col3, sigY + 4);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 291, { align: 'center' });
      doc.text('Generated by ReactERP', 14, 291);
    }

    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    setVoucherPdfUrl(url);
    setVoucherModalOpen(true);
  };

  // ── Approval handlers ────────────────────────────────────────────────────
  const openApprovalModal = (txn: ExternalTxnRecord) => {
    setApprovalTargetTxn(txn);
    setSelectedApproverEmail(undefined);
    setApprovalModalOpen(true);
    setApprovalLoadingUsers(true);
    getApprovalRules('CASH')
      .then(rules => {
        const matching = rules.filter(r => r.transactionType === 'EXTERNAL_TXN' && r.active === 'Y');
        const seen = new Map<string, ApprovalUser>();
        matching.forEach(rule =>
          rule.approvers.forEach(a => {
            if (!seen.has(a.email)) seen.set(a.email, {
              userId: a.userId, fullName: a.fullName, email: a.email,
              department: a.department, active: 'Y', modules: ['CASH'], currency: 'AED',
            });
          })
        );
        setApprovalUsers([...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      })
      .catch(() => setApprovalUsers([]))
      .finally(() => setApprovalLoadingUsers(false));
  };

  const handleSendApproval = async () => {
    if (!approvalTargetTxn || !selectedApproverEmail) return;
    const approver = approvalUsers.find(u => u.email === selectedApproverEmail);
    if (!approver) return;
    setApprovalSending(true);
    setApprovalDebugSteps([]);
    try {
      const result = await sendExternalTxnApproval({
        txnId:         approvalTargetTxn.externalTransactionId,
        txnRef:        approvalTargetTxn.referenceText || String(approvalTargetTxn.transactionId),
        txnType:       approvalTargetTxn.transactionType || '',
        amount:        Math.abs(approvalTargetTxn.amount),
        currency:      approvalTargetTxn.currencyCode,
        description:   approvalTargetTxn.description || '',
        approverEmail: approver.email,
        approverName:  approver.fullName,
        sentBy:        currentUser,
      });
      setApprovalDebugSteps(result.debug ?? []);
      if (result.success) {
        message.success(result.message);
        setTransactions(prev => prev.map(t =>
          t.externalTransactionId === approvalTargetTxn.externalTransactionId
            ? {
                ...t,
                approvalStatus:        'PENDING',
                approvalSentBy:        currentUser,
                approvalSentDate:      new Date().toISOString(),
                approvalApproverName:  approver.fullName,
                approvalApproverEmail: approver.email,
                approvalRef:           `CASH-EXT-${approvalTargetTxn.externalTransactionId}`,
              }
            : t
        ));
        setApprovalModalOpen(false);
        setApprovalDebugOpen(false);
      } else {
        message.error(result.message);
        setApprovalDebugOpen(true);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to send approval');
    } finally {
      setApprovalSending(false);
    }
  };

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns: ColumnsType<ExternalTxnRecord> = [
    {
      title: 'Actions', key: 'actions', width: 160, align: 'center', fixed: 'left',
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditTab(r)} /></Tooltip>
          <Tooltip title="Reverse — create opposite-direction entry">
            <Button type="text" size="small" icon={<RollbackOutlined />}
              style={{ color: REDWOOD.warning }}
              onClick={() => openReverseTab(r)} />
          </Tooltip>
          <Tooltip title="Copy — duplicate this transaction">
            <Button type="text" size="small" icon={<CopyOutlined />}
              style={{ color: REDWOOD.neutral600 }}
              onClick={() => openCopyTab(r)} />
          </Tooltip>
          <Tooltip title="Print Voucher">
            <Button type="text" size="small" icon={<PrinterOutlined />}
              style={{ color: REDWOOD.info }}
              onClick={() => generateVoucherPdf(r)} />
          </Tooltip>
          {r.accountingFlag !== 'Y' && (
            <Tooltip title="Create Accounting">
              <Button type="text" size="small" icon={<AccountBookOutlined />}
                style={{ color: REDWOOD.info }}
                onClick={() => openSingleAcctModal(r)} />
            </Tooltip>
          )}
          {r.accountingFlag === 'Y' && (
            <Tooltip title="View Accounting">
              <Button type="text" size="small" icon={<EyeOutlined />}
                style={{ color: REDWOOD.success }}
                onClick={() => {
                  setViewAcctTxn(r);
                  setViewAcctHeader(null);
                  setViewAcctLines([]);
                  setViewAcctOpen(true);
                  setViewAcctLoading(true);
                  getGlJournalLines({
                    reference2: r.externalTransactionId,
                    reference5: 'BANK_EXTERNAL_TRANSACTIONS',
                  }).then((res) => {
                    console.log('GL Journal Lines Response:', res);
                    const items = res.items || [];
                    if (items.length > 0) {
                      const firstLine = items[0];
                      const hdr = {
                        glBatchName: firstLine.batch_name,
                        glBatchId: firstLine.je_batch_id,
                        glHeaderId: firstLine.je_header_id,
                        periodName: firstLine.period_name,
                        accountingDate: firstLine.accounting_date,
                        moduleName: firstLine.je_category || 'Cash Management',
                        postingStatus: firstLine.journal_status || 'POSTED',
                      };
                      const formattedLines = items.map((line: any) => ({
                        lineId: line.line_id,
                        lineNumber: line.line_num,
                        lineType: line.entered_dr ? 'DR' : 'CR',
                        accountCombination: line.account,
                        accountDescription: line.description,
                        enteredDr: line.entered_dr,
                        enteredCr: line.entered_cr,
                        accountedDr: line.accounted_dr,
                        accountedCr: line.accounted_cr,
                        currency: line.currency_code,
                        reference1: line.reference1,
                        reference2: line.reference2,
                        reference3: line.reference3,
                        reference4: line.reference4,
                        reference5: line.reference5,
                      }));
                      console.log('Formatted Header:', hdr);
                      console.log('Formatted Lines:', formattedLines);
                      setViewAcctHeader(hdr);
                      setViewAcctLines(formattedLines);
                    }
                  }).catch(e => {
                    console.error('API Error:', e);
                  }).finally(() => setViewAcctLoading(false));
                }} />
            </Tooltip>
          )}
          {(!r.approvalStatus || r.approvalStatus === 'NONE') && (
            <Tooltip title="Send for Approval">
              <Button type="text" size="small" icon={<SendOutlined />}
                style={{ color: REDWOOD.primary }}
                onClick={() => openApprovalModal(r)} />
            </Tooltip>
          )}
          {r.approvalStatus && r.approvalStatus !== 'NONE' && (
            <Tooltip title="View Approval Status">
              <Button type="text" size="small" icon={<AuditOutlined />}
                style={{ color: r.approvalStatus === 'APPROVED' ? REDWOOD.success : r.approvalStatus === 'REJECTED' ? REDWOOD.error : REDWOOD.warning }}
                onClick={() => { setApprovalStatusTxn(r); setApprovalStatusOpen(true); }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'ID', dataIndex: 'externalTransactionId', width: 70, fixed: 'left',
      render: (v) => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v}</Text>,
    },
    {
      title: 'Txn Number', dataIndex: 'transactionId', width: 105,
      render: (v, r) => (
        <Button type="link" size="small" style={{ padding: 0, color: REDWOOD.info }} onClick={() => openEditTab(r)}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Bank Account', dataIndex: 'bankAccountName', ellipsis: true, width: 220,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v || '—'}</Text></Tooltip>,
    },
    { title: 'Business Unit', dataIndex: 'businessUnitName', ellipsis: true, width: 160,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Date', dataIndex: 'transactionDate', width: 105, render: fmtDate,
      sorter: (a: any, b: any) => (a.transactionDate ?? '').localeCompare(b.transactionDate ?? ''),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'Amount', dataIndex: 'amount', width: 150, align: 'right',
      render: (v, r) => {
        const isOut = v < 0 || r.transactionDirection === 'CR';
        return (
          <Space size={4} style={{ justifyContent: 'flex-end' }}>
            <Text style={{ fontSize: 12, color: isOut ? REDWOOD.error : REDWOOD.success, fontWeight: 500 }}>
              {fmtAmount(Math.abs(v), r.currencyCode)}
            </Text>
            <Tag
              color={isOut ? 'red' : 'green'}
              icon={isOut ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
              style={{ fontSize: 10, margin: 0, padding: '0 4px' }}
            >
              {isOut ? 'Out' : 'In'}
            </Tag>
          </Space>
        );
      },
    },
    { title: 'Reference', dataIndex: 'referenceText', ellipsis: true, width: 140,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    {
      title: 'Description', dataIndex: 'description', ellipsis: true, width: 180,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v || '—'}</Text></Tooltip>,
    },
    {
      title: 'Pmt Method', dataIndex: 'paymentMethod', width: 110,
      render: v => v
        ? <Tag style={{ fontSize: 11, margin: 0 }}>{v}</Tag>
        : <Text style={{ fontSize: 12, color: '#bbb' }}>—</Text>,
    },
    {
      title: 'Pmt Document', dataIndex: 'paymentDocument', ellipsis: true, width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Cash Account', dataIndex: 'assetAccountCombination', ellipsis: true, width: 180,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text></Tooltip>,
    },
    {
      title: 'Offset Account', dataIndex: 'offsetAccountCombination', ellipsis: true, width: 180,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text></Tooltip>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 110,
      render: v => <Badge status={statusColor(v) as any} text={<Text style={{ fontSize: 12 }}>{statusLabel(v)}</Text>} />,
    },
    {
      title: 'Origin', dataIndex: 'source', width: 90,
      render: v => <Text style={{ fontSize: 12 }}>{(SOURCE_LABELS[v] ?? v) || '—'}</Text>,
    },
    {
      title: 'Accounted', dataIndex: 'accountingFlag', width: 80, align: 'center',
      render: (v) => v === 'Y'
        ? <Tag color="green" style={{ fontSize: 11, margin: 0 }}>Posted</Tag>
        : <Tag color="default" style={{ fontSize: 11, margin: 0 }}>No</Tag>,
    },
    {
      title: 'Dir', dataIndex: 'transactionDirection', width: 60, align: 'center',
      render: v => v
        ? <Tag color={v === 'DR' ? 'blue' : 'volcano'} style={{ fontSize: 11, margin: 0 }}>{v}</Tag>
        : <Text style={{ fontSize: 12, color: '#bbb' }}>—</Text>,
    },
    {
      title: 'Type', dataIndex: 'transactionType', ellipsis: true, width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Payee', dataIndex: 'payeeName', ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Approval', dataIndex: 'approvalStatus', width: 105,
      render: (v) => {
        if (!v || v === 'NONE') return <Text style={{ fontSize: 11, color: '#bbb' }}>—</Text>;
        if (v === 'PENDING')  return <Tag color="orange"  style={{ fontSize: 11, margin: 0 }}>Pending</Tag>;
        if (v === 'APPROVED') return <Tag color="green"   style={{ fontSize: 11, margin: 0 }}>Approved</Tag>;
        if (v === 'REJECTED') return <Tag color="red"     style={{ fontSize: 11, margin: 0 }}>Rejected</Tag>;
        return <Tag style={{ fontSize: 11, margin: 0 }}>{v}</Tag>;
      },
    },
    { title: 'Created By', dataIndex: 'createdBy', ellipsis: true, width: 160,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
  ];

  const [searchOpen, setSearchOpen] = useState(true);
  const [gridSearch, setGridSearch] = useState('');
  const [reconStatusFilter, setReconStatusFilter] = useState<'ALL' | 'UNR' | 'REC'>('ALL');
  const [acctStatusFilter,  setAcctStatusFilter]  = useState<'ALL' | 'POSTED' | 'NOT_POSTED'>('ALL');
  const [createdByFilter,   setCreatedByFilter]   = useState<string>('');
  const [knownUsers,        setKnownUsers]        = useState<string[]>([]);

  // Set created-by filter to logged user once auth context resolves
  useEffect(() => {
    if (currentUser && currentUser !== 'SYSTEM' && createdByFilter === '') {
      setCreatedByFilter(currentUser);
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tab items ─────────────────────────────────────────────────────────────
  const searchPane = (
    <div style={{ padding: '16px 0' }}>
      {/* Collapsible Search Form */}
      <Collapse
        activeKey={searchOpen ? ['search'] : []}
        onChange={(keys: string | string[]) => setSearchOpen((Array.isArray(keys) ? keys : [keys]).includes('search'))}
        style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface }}
        items={[{
          key: 'search',
          label: <Text strong style={{ fontSize: 13 }}>Search</Text>,
          extra: (
            <Space size={8} onClick={e => e.stopPropagation()}>
              <Button size="small" onClick={e => { e.stopPropagation(); handleReset(); }} icon={<ReloadOutlined />}>Reset</Button>
              <Button size="small" icon={<ApiOutlined />} onClick={e => { e.stopPropagation(); setShowApiModal(true); }} style={{ color: REDWOOD.neutral600 }}>API</Button>
              <Button size="small" type="primary" icon={<SearchOutlined />} loading={loading} onClick={e => { e.stopPropagation(); handleSearch(); }}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Search
              </Button>
            </Space>
          ),
          children: (
        <Form form={searchForm} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }}
          initialValues={{ datePreset: 'last5', createdPreset: 'last7' }}>
          <Row gutter={[16, 0]}>

            <Col xs={24} md={12}>
              <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 4 }}>
                <Select showSearch placeholder="Select Business Unit" optionFilterProp="label" options={businessUnits}
                  allowClear style={{ width: '100%' }} onChange={handleBUChange} onClear={() => handleBUChange('')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Legal Entity" style={{ marginBottom: 4 }}>
                <Input value={derivedLE || (selectedBU ? '—' : '')} readOnly placeholder="Auto-derived from BU"
                  style={{ background: '#f5f5f5', color: derivedLE ? REDWOOD.info : REDWOOD.neutral600, cursor: 'default' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Bank Account" name="bankAccount" style={{ marginBottom: 4 }}>
                <Select showSearch placeholder={selectedBU ? `Banks for ${selectedBU}` : 'Select account'}
                  optionFilterProp="label" options={filteredBankAccounts} allowClear style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12} style={{ overflow: 'hidden' }}>
              <Form.Item label="Transaction Date" name="datePreset" style={{ marginBottom: 4 }} rules={[{ required: true, message: 'Select a date filter' }]}>
                <Select placeholder="Select date filter"
                  onChange={(val: string) => {
                    if (val !== 'range') searchForm.setFieldsValue({ dateRange: undefined });
                  }}>
                  <Option value="today">Date = Today</Option>
                  <Option value="last5">Last 5 days</Option>
                  <Option value="last10">Last 10 days</Option>
                  <Option value="last30">Last 30 days</Option>
                  <Option value="range">Range…</Option>
                </Select>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.datePreset !== cur.datePreset}>
                {({ getFieldValue }) => getFieldValue('datePreset') === 'range' && (
                  <Form.Item name="dateRange" label=" " colon={false} style={{ marginBottom: 4 }} rules={[{ required: true, message: 'Select date range' }]}>
                    <DatePicker.RangePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
                  </Form.Item>
                )}
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Status" name="status" style={{ marginBottom: 4 }}>
                <Select placeholder="Select status" allowClear>
                  <Option value="REC">Reconciled</Option>
                  <Option value="UNR">Unreconciled</Option>
                  <Option value="CLR">Cleared</Option>
                  <Option value="CAN">Cancelled</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Transaction #" name="transactionNumber" style={{ marginBottom: 4 }}>
                <Input placeholder="Transaction number" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Reference" name="reference" style={{ marginBottom: 4 }}>
                <Input placeholder="Reference text" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Transaction Type" name="transactionType" style={{ marginBottom: 4 }}>
                <Select placeholder="Select type" allowClear>
                  <Option value="External Transaction">External Transaction</Option>
                  <Option value="Adhoc Payment">Adhoc Payment</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Currency" name="currencyCode" style={{ marginBottom: 4 }}>
                <Select placeholder="Select currency" allowClear>
                  {['AED','USD','EUR','GBP','SAR','QAR','KWD','BHD','OMR'].map(c => <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Amount From" name="amountFrom" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} placeholder="Min amount" precision={2} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Amount To" name="amountTo" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} placeholder="Max amount" precision={2} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Origin" name="source" style={{ marginBottom: 4 }}>
                <Select placeholder="Select origin" allowClear>
                  <Option value="ORA_BAT">Bank</Option>
                  <Option value="ORA_MAN">Manual</Option>
                  <Option value="ORA_STA">Statement</Option>
                  <Option value="MANUAL">Manual (Legacy)</Option>
                </Select>
              </Form.Item>
            </Col>


          </Row>
          <Text type="secondary" style={{ fontSize: 11 }}>Select a Business Unit to filter banks and legal entity</Text>
        </Form>
          ),
        }]}
      />

      {/* Results */}
      {hasSearched && (() => {
        const q = gridSearch.trim().toLowerCase();
        const filtered = (() => {
          let base = transactions;
          if (reconStatusFilter === 'REC') base = base.filter(t => t.status === 'REC');
          if (reconStatusFilter === 'UNR') base = base.filter(t => t.status !== 'REC');
          if (acctStatusFilter === 'POSTED')     base = base.filter(t => t.accountingFlag === 'Y');
          if (acctStatusFilter === 'NOT_POSTED') base = base.filter(t => t.accountingFlag !== 'Y');
          if (createdByFilter) base = base.filter(t => t.createdBy === createdByFilter);
          if (!q) return base;
          return base.filter(r =>
            [r.externalTransactionId, r.transactionId, r.bankAccountName, r.businessUnitName,
             r.referenceText, r.description, r.status, r.source, r.transactionType,
             r.currencyCode, r.assetAccountCombination, r.offsetAccountCombination,
             r.transactionDate, r.payeeName, r.checkNumber, r.reconReference]
            .some(v => String(v ?? '').toLowerCase().includes(q))
          );
        })();
        return (
          <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
            styles={{ body: { padding: 0 } }}
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Space wrap>
                  <Text strong>
                    Search Results{' '}
                    <Tag color="blue">{filtered.length}{filtered.length !== transactions.length ? ` / ${transactions.length}` : ''}</Tag>
                  </Text>
                  {/* Recon status toggle */}
                  <Space size={2}>
                    {([
                      { label: 'All',     value: 'ALL', color: '#1677ff' },
                      { label: 'Unrecon', value: 'UNR', color: '#fa8c16' },
                      { label: 'Recon',   value: 'REC', color: '#52c41a' },
                    ] as { label: string; value: 'ALL' | 'UNR' | 'REC'; color: string }[]).map(opt => {
                      const active = reconStatusFilter === opt.value;
                      return (
                        <Button key={opt.value} size="small"
                          style={{ fontSize: 11, padding: '0 8px', height: 24, background: active ? opt.color : undefined, borderColor: active ? opt.color : undefined, color: active ? '#fff' : opt.color, fontWeight: active ? 600 : 400 }}
                          onClick={() => setReconStatusFilter(opt.value)}>
                          {opt.label}
                        </Button>
                      );
                    })}
                  </Space>
                  {/* Accounting status toggle */}
                  <Space size={2}>
                    {([
                      { label: 'All',        value: 'ALL',        color: '#1677ff' },
                      { label: 'Posted',     value: 'POSTED',     color: '#52c41a' },
                      { label: 'Not Posted', value: 'NOT_POSTED', color: '#fa8c16' },
                    ] as { label: string; value: 'ALL' | 'POSTED' | 'NOT_POSTED'; color: string }[]).map(opt => {
                      const active = acctStatusFilter === opt.value;
                      return (
                        <Button key={opt.value} size="small"
                          style={{ fontSize: 11, padding: '0 8px', height: 24, background: active ? opt.color : undefined, borderColor: active ? opt.color : undefined, color: active ? '#fff' : opt.color, fontWeight: active ? 600 : 400 }}
                          onClick={() => setAcctStatusFilter(opt.value)}>
                          {opt.label}
                        </Button>
                      );
                    })}
                  </Space>
                  {/* Created-by filter */}
                  <Select
                    size="small"
                    style={{ width: 200, fontSize: 11 }}
                    value={createdByFilter || undefined}
                    onChange={v => setCreatedByFilter(v ?? '')}
                    allowClear
                    showSearch
                    placeholder="All users"
                    options={[...new Set([currentUser, ...knownUsers])].filter(Boolean).map(u => ({ value: u, label: u }))}
                  />
                  {selectedRowKeys.length > 0 && (
                    <Button
                      size="small" type="primary" icon={<CheckCircleOutlined />}
                      style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                      onClick={openCreateAccountingModal}>
                      Create Accounting ({selectedRowKeys.length})
                    </Button>
                  )}
                  <Button
                    size="small"
                    icon={<AccountBookOutlined />}
                    style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                    loading={accountingAllLoading}
                    onClick={async () => {
                      setAccountingAllModalOpen(true);
                      await fetchAccountingForAllTransactions();
                    }}
                  >
                    Show Accounting for All Trx
                  </Button>
                </Space>
                <Space size={8}>
                  <Input
                    prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                    placeholder="Search ID, txn#, account, reference…"
                    allowClear
                    size="small"
                    style={{ width: 260 }}
                    value={gridSearch}
                    onChange={e => setGridSearch(e.target.value)}
                  />
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    disabled={filtered.length === 0}
                    onClick={exportToExcel}
                    title="Export to Excel"
                  >
                    Excel
                  </Button>
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    disabled={filtered.length === 0}
                    onClick={exportToPdf}
                    title="Export to PDF"
                  >
                    PDF
                  </Button>
                </Space>
              </div>
            }
          >
            <Table
              dataSource={filtered} columns={columns} rowKey="externalTransactionId"
              loading={loading} size="small" pagination={{
                current: pageNum,
                pageSize,
                total: filtered.length,
                showSizeChanger: true,
                pageSizeOptions: ['25', '50', '100', '200', '500'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} records`,
                onChange: (p, s) => { setPageNum(p); setPageSize(s); },
              }}
              locale={{ emptyText: <Empty description="No transactions found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              scroll={{ x: 1600 }}
              rowSelection={{
                type: 'checkbox',
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as number[]),
                getCheckboxProps: (r) => ({ disabled: r.accountingFlag === 'Y' }),
              }}
            />
          </Card>
        );
      })()}
    </div>
  );

  const tabItems = [
    { key: 'search', label: <span><SearchOutlined /> Search</span>, children: searchPane, closable: false },
    ...tabs.map(t => ({
      key: t.key,
      label: (
        <span>
          {t.record ? <EditOutlined style={{ marginRight: 4 }} /> : <PlusOutlined style={{ marginRight: 4 }} />}
          {t.label}
          <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }} onClick={e => { e.stopPropagation(); closeTab(t.key); }} />
        </span>
      ),
      children: (
        <ExternalTxnForm
          initialValues={t.record}
          bankAccounts={allBankAccounts}
          businessUnits={businessUnits}
          bankAccountMap={bankAccountMap}
          bankAccountCurrencyMap={bankAccountCurrencyMap}
          buBankMap={buBankMap}
          buCompanyMap={buCompanyMap}
          payeeOptions={payeeOptions}
          onPayeeCreated={(newOpt) => setPayeeOptions(prev => [...prev, newOpt].sort((a, b) => a.label.localeCompare(b.label)))}
          onSave={() => { closeTab(t.key); handleSearch(); loadLovs(); }}
          onCancel={() => closeTab(t.key)}
          onCreateAccounting={(txns) => openSingleAcctModal(txns)}
        />
      ),
      closable: false,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Header */}
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to={modulePrefix}>{module === 'ap' ? 'Payables' : 'Cash Management'}</Link> },
            { title: 'Manage External Transactions' },
          ]} />
          <Button icon={<PlusOutlined />} type="primary"
            onClick={openCreateTab}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
            Create Transaction
          </Button>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          <div style={{ height: 12 }} />

          <Tabs
            type="card"
            activeKey={activeTabKey}
            onChange={setActiveTabKey}
            items={tabItems}
            style={{ marginTop: 8 }}
          />
        </div>

        {/* ── Create Accounting Modal ──────────────────────────── */}
        <Modal
          title={<Space><CheckCircleOutlined style={{ color: REDWOOD.info }} />Create Accounting — Bank Transactions</Space>}
          open={acctModalOpen}
          onCancel={() => { if (!acctRunning) setAcctModalOpen(false); }}
          footer={
            acctDone
              ? <Button onClick={() => setAcctModalOpen(false)}>Close</Button>
              : [
                  <Button key="cancel" onClick={() => setAcctModalOpen(false)} disabled={acctRunning}>Cancel</Button>,
                  <Button key="run" type="primary" loading={acctRunning}
                    disabled={acctProgress.every(r => r.status === 'skipped' || r.status === 'error')}
                    style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                    onClick={runCreateAccounting}>
                    {acctRunning ? 'Processing…' : 'Run Create Accounting'}
                  </Button>,
                ]
          }
          width={900}
          destroyOnClose
        >
          {acctProgress.length > 0 && (() => {
            const periods = [...new Set(acctProgress.map(r => r.periodName))].filter(Boolean);
            return (
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Accounting Period{periods.length > 1 ? 's' : ''}:</Text>
                {periods.map(p => <Tag key={p} color="blue" style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{p}</Tag>)}
              </div>
            );
          })()}
          <Table<BankAcctProgressRow>
            dataSource={acctProgress}
            rowKey="extTxnId"
            size="small"
            pagination={false}
            expandable={{ expandedRowRender: renderAcctJournal, defaultExpandAllRows: true, rowExpandable: (r) => !!(r.drAccount && r.crAccount) }}
            columns={[
              { title: 'Ext Txn ID', dataIndex: 'extTxnId', width: 90,
                render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
              { title: 'Date', dataIndex: 'txnDate', width: 95,
                render: v => <Text style={{ fontSize: 11 }}>{v}</Text> },
              { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right' as const,
                render: (v, r) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{fmtAmount(v, r.currency)}</Text> },
              { title: 'DR Account', dataIndex: 'drAccount',
                render: (v, r) => (
                  <div>
                    <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#c74634' }}>{v || '—'}</Text>
                    {r.drAccountDesc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>{r.drAccountDesc}</div>}
                  </div>
                )},
              { title: 'CR Account', dataIndex: 'crAccount',
                render: (v, r) => (
                  <div>
                    <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#1d7b4d' }}>{v || '—'}</Text>
                    {r.crAccountDesc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>{r.crAccountDesc}</div>}
                  </div>
                )},
              { title: 'Status', dataIndex: 'status', width: 140,
                render: (v, r) => {
                  if (v === 'pending') return <Tag color="default" style={{ fontSize: 11 }}>Pending</Tag>;
                  if (v === 'running') return <Tag icon={<SyncOutlined spin />} color="processing" style={{ fontSize: 11 }}>Running</Tag>;
                  if (v === 'success') return <><Tag color="success" style={{ fontSize: 11 }}>Done</Tag>
                    {r.message && <div style={{ fontSize: 10, color: '#1d7b4d', marginTop: 2 }}>{r.message}</div>}</>;
                  if (v === 'error')   return <><Tag color="error" style={{ fontSize: 11 }}>Error</Tag>
                    {r.message && <div style={{ fontSize: 10, color: '#c74634', marginTop: 2 }}>{r.message}</div>}</>;
                  if (v === 'skipped') return <Tag color="warning" style={{ fontSize: 11 }}>Already Posted</Tag>;
                  return null;
                }},
            ]}
          />
          {acctDone && (
            <Alert
              type={acctProgress.some(r => r.status === 'error') ? 'warning' : 'success'}
              showIcon
              message={acctProgress.some(r => r.status === 'error')
                ? 'Accounting completed with some errors'
                : 'Accounting created and posted successfully'}
              style={{ marginTop: 12 }}
            />
          )}
        </Modal>

        {/* ── Single-Row Create Accounting Modal ──────────────────── */}
        <Modal
          title={<Space><AccountBookOutlined style={{ color: REDWOOD.info }} />Create Accounting</Space>}
          open={singleAcctModalOpen}
          onCancel={() => { if (!singleAcctRunning) setSingleAcctModalOpen(false); }}
          footer={
            singleAcctDone
              ? <Button onClick={() => setSingleAcctModalOpen(false)}>Close</Button>
              : [
                  <Button key="cancel" onClick={() => setSingleAcctModalOpen(false)} disabled={singleAcctRunning}>Cancel</Button>,
                  <Button key="run" type="primary" loading={singleAcctRunning}
                    disabled={singleAcctProgress.every(r => r.status === 'skipped' || r.status === 'error')}
                    style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                    onClick={runSingleAccounting}>
                    {singleAcctRunning ? 'Processing…' : 'Run Create Accounting'}
                  </Button>,
                ]
          }
          width={800}
          destroyOnClose
        >
          <Table<BankAcctProgressRow>
            dataSource={singleAcctProgress}
            rowKey="extTxnId"
            size="small"
            pagination={false}
            expandable={{ expandedRowRender: renderAcctJournal, defaultExpandAllRows: true, rowExpandable: (r) => !!(r.drAccount && r.crAccount) }}
            columns={[
              { title: 'Ext Txn ID', dataIndex: 'extTxnId', width: 90,
                render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
              { title: 'Date', dataIndex: 'txnDate', width: 95,
                render: v => <Text style={{ fontSize: 11 }}>{v}</Text> },
              { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right' as const,
                render: (v, r) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{fmtAmount(v, r.currency)}</Text> },
              { title: 'DR Account', dataIndex: 'drAccount',
                render: (v, r) => (
                  <div>
                    <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.info }}>{v || '—'}</Text>
                    {r.drAccountDesc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>{r.drAccountDesc}</div>}
                  </div>
                )},
              { title: 'CR Account', dataIndex: 'crAccount',
                render: (v, r) => (
                  <div>
                    <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.success }}>{v || '—'}</Text>
                    {r.crAccountDesc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>{r.crAccountDesc}</div>}
                  </div>
                )},
              { title: 'Status', dataIndex: 'status', width: 140,
                render: (v, r) => {
                  if (v === 'pending') return <Tag color="default" style={{ fontSize: 11 }}>Pending</Tag>;
                  if (v === 'running') return <Tag icon={<SyncOutlined spin />} color="processing" style={{ fontSize: 11 }}>Running</Tag>;
                  if (v === 'success') return <><Tag color="success" style={{ fontSize: 11 }}>Done</Tag>
                    {r.message && <div style={{ fontSize: 10, color: '#1d7b4d', marginTop: 2 }}>{r.message}</div>}</>;
                  if (v === 'error')   return <><Tag color="error" style={{ fontSize: 11 }}>Error</Tag>
                    {r.message && <div style={{ fontSize: 10, color: '#c74634', marginTop: 2 }}>{r.message}</div>}</>;
                  if (v === 'skipped') return <Tag color="warning" style={{ fontSize: 11 }}>Already Posted</Tag>;
                  return null;
                }},
            ]}
          />
          {singleAcctDone && (
            <Alert
              type={singleAcctProgress.some(r => r.status === 'error') ? 'warning' : 'success'}
              showIcon
              message={singleAcctProgress.some(r => r.status === 'error')
                ? 'Accounting completed with some errors'
                : 'Accounting created and posted successfully'}
              style={{ marginTop: 12 }}
            />
          )}
        </Modal>

        {/* ── View Accounting Modal ────────────────────────────────── */}
        <ViewAcctModal
          open={viewAcctOpen}
          txn={viewAcctTxn}
          hdr={viewAcctHeader}
          lines={viewAcctLines}
          loading={viewAcctLoading}
          onClose={() => setViewAcctOpen(false)}
        />

        {/* API Info Modal */}
        <Modal title={<Space><ApiOutlined /><span>API Endpoint Info</span></Space>}
          open={showApiModal} onCancel={() => setShowApiModal(false)} footer={null} width={600}>
          <div style={{ padding: 8 }}>
            <Text strong>GET (Query)</Text>
            <Text code copyable style={{ display: 'block', marginTop: 4, fontSize: 11, wordBreak: 'break-all' }}>
              {lastApiUrl || `${APEX_BASE}/cash/externaltransactions?bank_account=&status=&date_from=&date_to=`}
            </Text>
            <Divider />
            <Text strong>POST (Sync)</Text>
            <Text code copyable style={{ display: 'block', marginTop: 4, fontSize: 11 }}>
              {APEX_BASE}/cash/externaltransactions
            </Text>
          </div>
        </Modal>

        {/* ── Payment Voucher PDF Preview ──────────────────────────── */}
        <Modal
          title={<Space><PrinterOutlined style={{ color: REDWOOD.info }} /><span>Payment Voucher</span></Space>}
          open={voucherModalOpen}
          onCancel={() => { setVoucherModalOpen(false); if (voucherPdfUrl) URL.revokeObjectURL(voucherPdfUrl); setVoucherPdfUrl(null); }}
          footer={[
            <Button key="download" type="primary" icon={<DownloadOutlined />}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
              onClick={() => {
                if (!voucherPdfUrl) return;
                const a = document.createElement('a');
                a.href = voucherPdfUrl;
                a.download = 'payment-voucher.pdf';
                a.click();
              }}>
              Download PDF
            </Button>,
            <Button key="close" onClick={() => { setVoucherModalOpen(false); if (voucherPdfUrl) URL.revokeObjectURL(voucherPdfUrl); setVoucherPdfUrl(null); }}>
              Close
            </Button>,
          ]}
          width={820}
          styles={{ body: { padding: 0 } }}
        >
          {voucherPdfUrl && (
            <iframe
              src={voucherPdfUrl}
              style={{ width: '100%', height: '70vh', border: 'none' }}
              title="Payment Voucher Preview"
            />
          )}
        </Modal>

        {/* ── Send for Approval Modal ─────────────────────────────── */}
        <Modal
          title={<Space><SendOutlined style={{ color: REDWOOD.primary }} /><span>Send for Approval</span></Space>}
          open={approvalModalOpen}
          onCancel={() => { setApprovalModalOpen(false); setSelectedApproverEmail(undefined); setApprovalDebugOpen(false); }}
          footer={[
            <Button key="debug" icon={<BugOutlined />}
              style={{ float: 'left', color: approvalDebugSteps.length > 0 ? '#fa8c16' : undefined }}
              onClick={() => setApprovalDebugOpen(v => !v)}
              title="Show API debug info"
            >
              {approvalDebugOpen ? 'Hide Debug' : 'Debug'}
            </Button>,
            <Button key="cancel" onClick={() => { setApprovalModalOpen(false); setSelectedApproverEmail(undefined); setApprovalDebugOpen(false); }}>
              Cancel
            </Button>,
            <Button
              key="send"
              type="primary"
              icon={<SendOutlined />}
              loading={approvalSending}
              disabled={!selectedApproverEmail}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={handleSendApproval}
            >
              Send
            </Button>,
          ]}
          width={580}
        >
          {approvalTargetTxn && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ background: REDWOOD.neutral100, borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text type="secondary">Transaction</Text>
                  <Text strong>#{approvalTargetTxn.transactionId}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text type="secondary">Reference</Text>
                  <Text strong>{approvalTargetTxn.referenceText || '—'}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text type="secondary">Amount</Text>
                  <Text strong style={{ color: REDWOOD.primary }}>
                    {approvalTargetTxn.currencyCode} {Math.abs(approvalTargetTxn.amount).toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Type</Text>
                  <Text>{approvalTargetTxn.transactionType || '—'}</Text>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>Select Approver</Text>
              </div>
              <Select
                showSearch
                placeholder={approvalLoadingUsers ? 'Loading approvers...' : 'Select an approver'}
                loading={approvalLoadingUsers}
                style={{ width: '100%' }}
                optionFilterProp="label"
                value={selectedApproverEmail}
                onChange={setSelectedApproverEmail}
                options={approvalUsers.map(u => {
                  const nameLabel = u.fullName && u.fullName !== u.email ? u.fullName : '';
                  const deptLabel = u.department ? ` (${u.department})` : '';
                  const label = nameLabel ? `${nameLabel} — ${u.email}${deptLabel}` : `${u.email}${deptLabel}`;
                  return { label, value: u.email };
                })}
              />
              {approvalUsers.length === 0 && !approvalLoadingUsers && (
                <Alert
                  type="warning"
                  style={{ marginTop: 12 }}
                  message="No approvers found. Create an approval rule in the Approval Engine for module CASH, transaction type EXTERNAL_TXN."
                  showIcon
                />
              )}
              {/* ── Debug Panel ── */}
              {approvalDebugOpen && (
                <div style={{ marginTop: 16, background: '#1a1a2e', borderRadius: 8, padding: 12, maxHeight: 340, overflowY: 'auto' }}>
                  {approvalDebugSteps.length === 0 ? (
                    <Text style={{ color: '#888', fontSize: 12 }}>No debug data yet — click Send to capture requests.</Text>
                  ) : approvalDebugSteps.map((s, i) => (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Tag color={typeof s.status === 'number' && s.status >= 200 && s.status < 300 ? 'green' : 'red'} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {s.method} {s.status}
                        </Tag>
                        <Text style={{ color: '#a0cfff', fontSize: 11, fontFamily: 'monospace' }}>{s.step}</Text>
                      </div>
                      <div style={{ color: '#ffd580', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 2 }}>
                        URL: {s.url}
                      </div>
                      {!!s.payload && (
                        <pre style={{ color: '#b8f5c8', fontSize: 10, fontFamily: 'monospace', margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          PAYLOAD: {JSON.stringify(s.payload, null, 2)}
                        </pre>
                      )}
                      <pre style={{ color: '#f5c2c7', fontSize: 10, fontFamily: 'monospace', margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        RESPONSE: {JSON.stringify(s.response, null, 2)}
                      </pre>
                      {i < approvalDebugSteps.length - 1 && <div style={{ borderBottom: '1px solid #333', marginTop: 8 }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* ── View Approval Status Modal ──────────────────────────── */}
        <Modal
          title={<Space><AuditOutlined style={{ color: REDWOOD.info }} /><span>Approval Status</span></Space>}
          open={approvalStatusOpen}
          onCancel={() => setApprovalStatusOpen(false)}
          footer={<Button onClick={() => setApprovalStatusOpen(false)}>Close</Button>}
          width={480}
        >
          {approvalStatusTxn && (() => {
            const st = approvalStatusTxn.approvalStatus;
            return (
              <div>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  {st === 'APPROVED' && <Tag color="green"  style={{ fontSize: 14, padding: '4px 16px' }}>Approved</Tag>}
                  {st === 'REJECTED' && <Tag color="red"    style={{ fontSize: 14, padding: '4px 16px' }}>Rejected</Tag>}
                  {st === 'PENDING'  && <Tag color="orange" style={{ fontSize: 14, padding: '4px 16px' }}>Pending Approval</Tag>}
                </div>
                <div style={{ background: REDWOOD.neutral100, borderRadius: 8, padding: '12px 16px', fontSize: 13 }}>
                  {[
                    { label: 'Approval Ref',  value: approvalStatusTxn.approvalRef },
                    { label: 'Sent By',       value: approvalStatusTxn.approvalSentBy },
                    { label: 'Sent Date',     value: approvalStatusTxn.approvalSentDate ? dayjs(approvalStatusTxn.approvalSentDate).format('D MMM YYYY HH:mm') : undefined },
                    { label: 'Approver',      value: approvalStatusTxn.approvalApproverName },
                    { label: 'Approver Email',value: approvalStatusTxn.approvalApproverEmail },
                    { label: 'Approved Date', value: approvalStatusTxn.approvedDate ? dayjs(approvalStatusTxn.approvedDate).format('D MMM YYYY HH:mm') : undefined },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text type="secondary">{row.label}</Text>
                      <Text strong>{row.value || '—'}</Text>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Modal>

        {/* ── Show Accounting for All Transactions Modal ──────────────────── */}
        <Modal
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <AccountBookOutlined style={{ color: REDWOOD.success }} />
                <span>Show Accounting for All Trx</span>
              </Space>
              <Button
                size="small"
                icon={<ApiOutlined />}
                onClick={() => setAccountingApiModalOpen(true)}
                style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
              >
                API Inspector
              </Button>
            </div>
          }
          open={accountingAllModalOpen}
          onCancel={() => setAccountingAllModalOpen(false)}
          footer={<Button onClick={() => setAccountingAllModalOpen(false)}>Close</Button>}
          width={1200}
          destroyOnClose
        >
          <Spin spinning={accountingAllLoading}>
            {accountingAllData.length === 0 ? (
              <Empty description="No accounting records found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (() => {
              // Filter data based on search term
              const q = accountingSearchTerm.trim().toLowerCase();
              const filtered = !q ? accountingAllData : accountingAllData.filter(r =>
                [r.transactionId, r.transactionNumber, r.transactionDate, r.debitAccount, r.creditAccount,
                 r.debitAccountDesc, r.creditAccountDesc, r.glBatchId, r.glStatus, r.reference1, r.reference2,
                 r.reference3, r.reference4, r.reference5]
                .some(v => String(v ?? '').toLowerCase().includes(q))
              );

              const withAccounting = filtered.filter(r => r.hasAccounting).length;
              const noAccounting = filtered.filter(r => !r.hasAccounting).length;
              const balanced = filtered.filter(r => r.hasAccounting && r.isBalanced).length;
              const unbalanced = filtered.filter(r => r.hasAccounting && !r.isBalanced).length;
              const missingAccounts = filtered.filter(r => r.hasMissingAccounts).length;
              const amountMismatch = filtered.filter(r => r.hasAmountMismatch).length;

              return (
                <>
                  {/* Search Box */}
                  <div style={{ marginBottom: 16 }}>
                    <Input
                      prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                      placeholder="Search by Txn ID, Date, Account, GL Batch, Status, or any field…"
                      allowClear
                      value={accountingSearchTerm}
                      onChange={e => {
                        setAccountingSearchTerm(e.target.value);
                        setAccountingPageNum(1);
                      }}
                      style={{ width: '100%' }}
                    />
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      Found {filtered.length} of {accountingAllData.length} records
                    </Text>
                  </div>

                  {/* KPI Summary */}
                  <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                    <Col xs={12} sm={6}>
                      <Card size="small" style={{ textAlign: 'center', background: '#f6ffed', borderColor: REDWOOD.success }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: REDWOOD.success }}>{withAccounting}</div>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>With Accounting</div>
                      </Card>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Card size="small" style={{ textAlign: 'center', background: '#f0f0f0', borderColor: REDWOOD.neutral600 }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: REDWOOD.neutral600 }}>{noAccounting}</div>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>No Accounting</div>
                      </Card>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Card size="small" style={{ textAlign: 'center', background: '#fff1f0', borderColor: REDWOOD.error }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: REDWOOD.error }}>{unbalanced}</div>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Unbalanced (DR ≠ CR)</div>
                      </Card>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Card size="small" style={{ textAlign: 'center', background: '#fff7e6', borderColor: REDWOOD.warning }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: REDWOOD.warning }}>{missingAccounts}</div>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Missing Accounts</div>
                      </Card>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Card size="small" style={{ textAlign: 'center', background: '#e6f7ff', borderColor: REDWOOD.info }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: REDWOOD.info }}>{amountMismatch}</div>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Amount Mismatch</div>
                      </Card>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Card size="small" style={{ textAlign: 'center', background: '#f0f5ff', borderColor: REDWOOD.info }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: REDWOOD.info }}>{balanced}</div>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Balanced (DR = CR)</div>
                      </Card>
                    </Col>
                  </Row>

                  {/* Data Table */}
                  <Table<typeof accountingAllData[number]>
                    dataSource={filtered}
                    rowKey="transactionId"
                    size="small"
                    pagination={{
                      current: accountingPageNum,
                      pageSize: accountingPageSize,
                      total: filtered.length,
                      showSizeChanger: true,
                      pageSizeOptions: ['10', '20', '50', '100'],
                      showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} records`,
                      onChange: (p, s) => { setAccountingPageNum(p); setAccountingPageSize(s); },
                    }}
                    columns={[
                      {
                        title: 'Txn ID / #',
                        dataIndex: 'transactionId',
                        width: 100,
                        render: (v, r) => (
                          <div>
                            <Text style={{ fontWeight: 600, fontSize: 12, display: 'block' }}>ID: {v}</Text>
                            <Text style={{ color: REDWOOD.neutral600, fontSize: 11 }}># {r.transactionNumber}</Text>
                          </div>
                        ),
                      },
                      {
                        title: 'Date',
                        dataIndex: 'transactionDate',
                        width: 100,
                        render: v => <Text>{dayjs(v).format('DD MMM YYYY')}</Text>,
                      },
                      {
                        title: 'Txn Amount',
                        dataIndex: 'transactionAmount',
                        width: 110,
                        align: 'right' as const,
                        render: v => <Text style={{ fontWeight: 600, color: REDWOOD.primary }}>{fmtAmount(v, 'AED')}</Text>,
                      },
                      {
                        title: 'Debits',
                        dataIndex: 'debits',
                        width: 110,
                        align: 'right' as const,
                        render: (v, r) => (
                          <div>
                            <Text style={{ color: REDWOOD.info, fontWeight: 600 }}>{fmtAmount(v, 'AED')}</Text>
                            {r.hasAmountMismatch && <div style={{ fontSize: 10, color: REDWOOD.error, marginTop: 2 }}>✗ Mismatch</div>}
                          </div>
                        ),
                      },
                      {
                        title: 'Credits',
                        dataIndex: 'credits',
                        width: 110,
                        align: 'right' as const,
                        render: (v, r) => (
                          <div>
                            <Text style={{ color: REDWOOD.success, fontWeight: 600 }}>{fmtAmount(v, 'AED')}</Text>
                            {!r.isBalanced && <div style={{ fontSize: 10, color: REDWOOD.error, marginTop: 2 }}>✗ Unbalanced</div>}
                          </div>
                        ),
                      },
                      {
                        title: 'DR Account',
                        dataIndex: 'debitAccount',
                        width: 140,
                        render: (v, r) => (
                          <div>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.info, fontWeight: 600 }}>{v || '—'}</Text>
                            {!v && <div style={{ fontSize: 10, color: REDWOOD.error, marginTop: 2 }}>✗ Missing</div>}
                            {v && r.debitAccountDesc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 2 }}>{r.debitAccountDesc}</div>}
                          </div>
                        ),
                      },
                      {
                        title: 'CR Account',
                        dataIndex: 'creditAccount',
                        width: 140,
                        render: (v, r) => (
                          <div>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.success, fontWeight: 600 }}>{v || '—'}</Text>
                            {!v && <div style={{ fontSize: 10, color: REDWOOD.error, marginTop: 2 }}>✗ Missing</div>}
                            {v && r.creditAccountDesc && <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 2 }}>{r.creditAccountDesc}</div>}
                          </div>
                        ),
                      },
                      {
                        title: 'Status',
                        dataIndex: 'glStatus',
                        width: 120,
                        render: (v, r) => {
                          if (!r.hasAccounting) {
                            return <Tag color="default" style={{ fontSize: 11 }}>No Accounting</Tag>;
                          }
                          if (v === 'ERROR') {
                            return <Tag color="error" style={{ fontSize: 11 }}>ERROR</Tag>;
                          }
                          return (
                            <Tag color={v === 'POSTED' ? 'green' : 'processing'} style={{ fontSize: 11 }}>
                              {v || 'UNKNOWN'}
                            </Tag>
                          );
                        },
                      },
                      {
                        title: 'GL Batch',
                        dataIndex: 'glBatchId',
                        width: 100,
                        render: v => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
                      },
                    ]}
                    scroll={{ x: 1400 }}
                  />
                </>
              );
            })()}
          </Spin>
        </Modal>

        {/* ── API Inspector Modal for Accounting ──────────────────── */}
        <Modal
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector</span></Space>}
          open={accountingApiModalOpen}
          onCancel={() => setAccountingApiModalOpen(false)}
          footer={[
            <Button key="close" onClick={() => setAccountingApiModalOpen(false)}>Close</Button>,
            <Button
              key="test"
              type="primary"
              icon={<SendOutlined />}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
              onClick={async () => {
                const testUrl = accountingApiUrls[0]?.url;
                if (!testUrl) {
                  message.warning('No API URLs to test');
                  return;
                }
                try {
                  message.loading({ content: 'Testing API endpoint...', key: 'test' });
                  const response = await fetch(testUrl);
                  const data = await response.json();
                  message.success({ content: `API test successful (${response.status})`, key: 'test' });
                  console.log('API Response:', data);
                } catch (err) {
                  message.error({ content: `API test failed: ${String(err)}`, key: 'test' });
                  console.error('API Error:', err);
                }
              }}
            >
              Test First URL
            </Button>,
          ]}
          width={900}
        >
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 13 }}>Total API Calls: {accountingApiUrls.length}</Text>
          </div>
          <div style={{ maxHeight: 600, overflowY: 'auto', background: '#f5f5f5', borderRadius: 4, padding: 12 }}>
            {accountingApiUrls.length === 0 ? (
              <Text type="secondary">No API calls recorded yet</Text>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {accountingApiUrls.map((item, idx) => (
                  <div key={idx} style={{ background: '#fff', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 4, padding: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Badge color={item.error ? REDWOOD.error : REDWOOD.success} />
                      <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Call #{idx + 1}</Text>
                      {item.error && <Tag color="error" style={{ fontSize: 10 }}>Error</Tag>}
                    </div>
                    <Text
                      code
                      copyable
                      style={{
                        display: 'block',
                        fontSize: 11,
                        wordBreak: 'break-all',
                        background: '#f9f9f9',
                        padding: 6,
                        borderRadius: 2,
                        marginBottom: 4,
                      }}
                    >
                      {item.url}
                    </Text>
                    {item.error && (
                      <Text type="danger" style={{ fontSize: 10, display: 'block' }}>
                        Error: {item.error}
                      </Text>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

      </Content>
    </Layout>
  );
};

export default ManageExternalTransactions;
