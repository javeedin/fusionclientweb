import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Layout, Card, Form, Select, Input, Button, Space, Typography, Table, Tag,
  Row, Col, Breadcrumb, Tooltip, DatePicker, message, Tabs, Divider,
  Badge, Alert, Modal, InputNumber, Radio, Spin, Descriptions, Dropdown, Steps,
} from 'antd';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  HomeOutlined, SearchOutlined, PlusOutlined, CloseOutlined,
  DollarOutlined, SaveOutlined, FilterOutlined, ReloadOutlined,
  DownloadOutlined, UserOutlined, BankOutlined, LockOutlined,
  FileTextOutlined, EyeOutlined, UnorderedListOutlined, InfoCircleOutlined,
  ApiOutlined, DeleteOutlined, CloseCircleOutlined, ExclamationCircleOutlined, SendOutlined, CodeOutlined,
  BookOutlined, CheckCircleOutlined, PaperClipOutlined, UploadOutlined, PrinterOutlined, EditOutlined,
  CopyOutlined, RollbackOutlined, DownOutlined, ScissorOutlined, PlusCircleOutlined, LinkOutlined,
  MinusCircleOutlined, ClockCircleOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import { Upload } from 'antd';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
import { useAuth } from '../../context/AuthContext';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { validateAccountCode } from '../../components/AccountSelector';
import AccountSelector from '../../components/AccountSelector';
import {
  createAccounting, postToLedger, fetchLedgerByBusinessUnit,
  derivePeriodName, checkAccountingExists, getAccounting, checkGLJournalExists, type SlaCreatePayload,
} from '../../services/sla.service';
import { postJournal } from '../../services/manage-journals.service';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
};

const APEX_AR_RECEIPTS     = `${APEX_DB_CONFIG.baseUrl}/ar/receipts`;
const APEX_RECEIPT_APPS    = `${APEX_DB_CONFIG.baseUrl}/ar/receipt-applications`;
const APEX_RECEIPT_METHODS = `${APEX_DB_CONFIG.baseUrl}/ar/receiptmethods`;
const GL_ORDS_BASE         = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';
const APEX_AR_INVOICES     = `${APEX_DB_CONFIG.baseUrl}/ar/invoices`;
const ORDS_RECEIPT_METHOD_ACCOUNTS = `${GL_ORDS_BASE}/ar/receipt-method-accounts`;

// ── Types ────────────────────────────────────────────────────────────────────

interface ReceiptRow {
  key:                   string;
  standardReceiptId:     number;
  receiptNumber:         string;
  documentNumber:        number | null;
  receiptType:           string;
  businessUnit:          string;
  receiptMethod:         string;
  receiptDate:           string;
  accountingDate:        string;
  amount:                number;
  unappliedAmount:       number;
  accountedAmount:       number;
  currency:              string;
  state:                 string;
  status:                string;
  remittanceBankName:          string;
  remittanceBankAccountNumber: string;
  maturityDate:                string;
  customerName:                string;
  customerAccountNumber:       string;
  comments:                    string;
  syncStatus:                  string;
  accountingStatus:            string;
}

interface ReceiptDraft {
  standardReceiptId:              number;
  receiptNumber:                  string;
  documentNumber:                 number | null;
  receiptType:                    string;
  businessUnit:                   string;
  receiptMethod:                  string;
  receiptMethodId:                number | null;
  selectedBankAccountId:          number | null;
  receiptDate:                    string;
  accountingDate:                 string;
  maturityDate:                   string;
  amount:                         number | null;
  unappliedAmount:                number | null;
  accountedAmount:                number | null;
  currency:                       string;
  conversionRateType:             string;
  conversionRate:                 number | null;
  state:                          string;
  status:                         string;
  receiptAtRisk:                  string;
  remittanceBankName:             string;
  remittanceBankBranch:           string;
  remittanceBankAccountNumber:    string;
  remittanceBankDepositDate:      string;
  customerName:                   string;
  customerAccountNumber:          string;
  customerSite:                   string;
  customerBank:                   string;
  customerBankBranch:             string;
  customerBankAccountNumber:      string;
  receivablesSpecialist:          string;
  comments:                       string;
  structuredPaymentReference:     string;
  receiptBatchName:               string;
  drAccount:                      string;
  drAccountDesc:                  string;
  crAccount:                      string;
  crAccountDesc:                  string;
  accountingStatus:               string;
}

interface ReceiptTab {
  key:          string;
  draft:        ReceiptDraft;
  syncStatus:   string;
  slaHeaderId:  number | null;
  slaPosted:    boolean;
}

interface AppRow {
  key:                        string;
  applicationId:              number;
  applicationDate:            string;
  applicationAmount:          number;
  adjustmentAmount:           number;
  applicationStatus:          string;
  accountingDate:             string;
  referenceTransactionNumber: string;
  referenceTransactionId:     number | null;
  referenceTransactionStatus: string;
  activityName:               string;
  standardReceiptId:          number;
  enteredCurrency:            string;
  processStatus:              string;
  isLatestApplication:        string;
  custAccountId:              number | null;
  customerSite:               string;
}

interface AdjSplit {
  id: string;
  amount: number;
  activityName: string;
  accountCombination: string;
  accountDescription: string;
  reason: string;
}

interface PendingAppRow {
  key: string;
  customerTransactionId: number;
  transactionNumber: string;
  installmentId: number;
  sequenceNumber: number;
  applyAmount: number;
  adjustmentAmount: number;
  adjustmentReason: string;
  currency: string;
  balanceDue: number;
  dueDate: string;
  adjSplits?: AdjSplit[];
  _closed?: boolean;
}

interface ReceiptMethodAccount {
  id:                         number;
  receiptMethodId:            number;
  receiptMethodName:          string;
  receiptClass:               string;
  orgId:                      number;
  businessUnitName:           string;
  company:                    string;
  bankAccountId:              number;
  bankAccountName:            string;
  bankAccountNum:             string;
  bankName:                   string;
  bankBranchName:             string;
  bankCurrency:               string;
  primaryFlag:                string;
  startDate:                  string;
  endDate:                    string;
  cashCcid:                   number;
  cashCombination:            string;
  unappliedCcid:              number;
  unappliedCombination:       string;
  unidentifiedCcid:           number;
  unidentifiedCombination:    string;
  onAccountCcid:              number;
  onAccountCombination:       string;
  receiptClearingCcid:        number;
  receiptClearingCombination: string;
  remittanceCcid:             number;
  remittanceCombination:      string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const today = () => dayjs().format('YYYY-MM-DD');

function blankDraft(): ReceiptDraft {
  return {
    standardReceiptId: 0,
    receiptNumber: '', documentNumber: null, receiptType: '',
    businessUnit: '', receiptMethod: '', receiptMethodId: null, selectedBankAccountId: null,
    receiptDate: today(), accountingDate: today(), maturityDate: today(),
    amount: null, unappliedAmount: null, accountedAmount: null,
    currency: 'AED', conversionRateType: '', conversionRate: null,
    state: '', status: '', receiptAtRisk: 'N',
    remittanceBankName: '', remittanceBankBranch: '',
    remittanceBankAccountNumber: '', remittanceBankDepositDate: '',
    customerName: '', customerAccountNumber: '', customerSite: '',
    customerBank: '', customerBankBranch: '', customerBankAccountNumber: '',
    receivablesSpecialist: '', comments: '', structuredPaymentReference: '',
    receiptBatchName: '', drAccount: '', drAccountDesc: '', crAccount: '', crAccountDesc: '',
    accountingStatus: '',
  };
}

function maskAcct(num: string) {
  if (!num) return '';
  const s = num.replace(/[^0-9A-Za-z]/g, '');
  return s.length <= 4 ? num : 'X'.repeat(s.length - 4) + s.slice(-4);
}

function fmt(n: number) {
  return n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function stateColor(s: string) {
  const m: Record<string, string> = {
    Applied: 'green', Unapplied: 'blue', 'On Account': 'purple',
    Reversed: 'red', NSF: 'red', Stop: 'red',
  };
  return m[s] || 'default';
}

function statusColor(s: string) {
  const m: Record<string, string> = {
    Cleared: 'green', Uncleared: 'orange', Reversed: 'red', Remitted: 'blue',
  };
  return m[s] || 'default';
}

function syncStatusColor(s: string) {
  const m: Record<string, string> = { NEW: 'green', UPDATED: 'blue', ERROR: 'red' };
  return m[(s || '').toUpperCase()] || 'default';
}

const LOCKED_SYNC = ['FUSION SYNC'];

// ── Component ─────────────────────────────────────────────────────────────────

const ManageReceipts: React.FC = () => {
  const { user } = useAuth();
  const currentUser = user?.email ?? user?.username ?? 'REERP';
  const [searchForm] = Form.useForm();

  const [businessUnits,   setBusinessUnits]   = useState<{ name: string; companyCode: string }[]>([]);
  // Flat list of all receipt method+bank account rows for the current tab's BU
  const [receiptMethods,           setReceiptMethods]           = useState<{ id: number; name: string; receiptClass: string }[]>([]);
  const [allMethodAccounts,        setAllMethodAccounts]        = useState<ReceiptMethodAccount[]>([]);
  const [allMethodAccountsLoading, setAllMethodAccountsLoading] = useState<Record<string, boolean>>({});
  // ccid → { combination: string; description: string; segmentDescs: Record<string,string> }
  const [acctDescCache, setAcctDescCache] = useState<Record<number, { description: string; segmentDescs: Record<string, string> }>>({});

  const enrichWithDescriptions = useCallback(async (items: ReceiptMethodAccount[]) => {
    const ccidSet = new Set<number>();
    items.forEach(a => {
      [a.cashCcid, a.unappliedCcid, a.unidentifiedCcid, a.onAccountCcid, a.receiptClearingCcid, a.remittanceCcid]
        .filter(id => id > 0)
        .forEach(id => ccidSet.add(id));
    });
    const newCache: Record<number, { description: string; segmentDescs: Record<string, string> }> = {};
    // Build combo→ccid map so we can validate by combo string
    const combos: { ccid: number; combo: string }[] = [];
    items.forEach(a => {
      const pairs: [number, string][] = [
        [a.cashCcid, a.cashCombination], [a.unappliedCcid, a.unappliedCombination],
        [a.unidentifiedCcid, a.unidentifiedCombination], [a.onAccountCcid, a.onAccountCombination],
        [a.receiptClearingCcid, a.receiptClearingCombination], [a.remittanceCcid, a.remittanceCombination],
      ];
      pairs.forEach(([ccid, combo]) => {
        if (ccid > 0 && combo && !newCache[ccid]) combos.push({ ccid, combo });
      });
    });
    // Deduplicate by ccid
    const seen = new Set<number>();
    const unique = combos.filter(x => { if (seen.has(x.ccid)) return false; seen.add(x.ccid); return true; });
    await Promise.all(unique.map(async ({ ccid, combo }) => {
      try {
        const result = await validateAccountCode(combo.replace(/\./g, '-'));
        const segmentDescs: Record<string, string> = {};
        Object.entries(result.segmentDetails ?? {}).forEach(([k, v]) => {
          segmentDescs[k] = v.description || '';
        });
        const description = Object.values(result.segmentDetails ?? {})
          .map(v => v.description).filter(Boolean).join(' · ');
        newCache[ccid] = { description, segmentDescs };
      } catch { /* ignore */ }
    }));
    setAcctDescCache(prev => ({ ...prev, ...newCache }));
  }, []);

  const fetchMethodAccountsByBU = useCallback(async (tabKey: string, businessUnit: string) => {
    if (!businessUnit) return;
    setAllMethodAccountsLoading(prev => ({ ...prev, [tabKey]: true }));
    try {
      const params = new URLSearchParams({ limit: '500', business_unit_name: businessUnit });
      const res  = await fetch(`${ORDS_RECEIPT_METHOD_ACCOUNTS}?${params}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const items = ((data.items ?? []) as any[]).map(mapAccount);

      // Build unique receipt methods list for this tab's dropdown
      const methodMap: Record<number, { id: number; name: string; receiptClass: string }> = {};
      items.forEach(a => {
        if (!methodMap[a.receiptMethodId]) {
          methodMap[a.receiptMethodId] = {
            id:           a.receiptMethodId,
            name:         a.receiptMethodName || `Method ${a.receiptMethodId}`,
            receiptClass: a.receiptClass,
          };
        }
      });
      setReceiptMethods(Object.values(methodMap).sort((a, b) => a.name.localeCompare(b.name)));
      setAllMethodAccounts(items);
      enrichWithDescriptions(items);
    } catch {
      message.error('Failed to load receipt methods for this Business Unit');
    } finally {
      setAllMethodAccountsLoading(prev => ({ ...prev, [tabKey]: false }));
    }
  }, []);
  const [searchRows, setSearchRows]           = useState<ReceiptRow[]>([]);
  const [searching, setSearching]         = useState(false);
  const [tabs, setTabs]                   = useState<ReceiptTab[]>([]);
  const [activeKey, setActiveKey]         = useState<string>('search');
  const [saving, setSaving]               = useState<Record<string, boolean>>({});
  const [deleting, setDeleting]           = useState<Record<string, boolean>>({});
  const [fxRateLoading, setFxRateLoading] = useState<Record<string, boolean>>({});
  const [apiModal, setApiModal]           = useState<{ tabKey: string; testResult: string | null; testing: boolean } | null>(null);
  const [pendingApplications, setPendingApplications] = useState<Record<string, PendingAppRow[]>>({});
  const pendingApplicationsRef = useRef<Record<string, PendingAppRow[]>>({});
  useEffect(() => { pendingApplicationsRef.current = pendingApplications; }, [pendingApplications]);
  const [saveProgress, setSaveProgress] = useState<{
    open: boolean;
    steps: { title: string; status: 'wait' | 'process' | 'finish' | 'error'; detail: string }[];
    current: number;
    done: boolean;
  } | null>(null);
  const [debugModal, setDebugModal] = useState<{
    open: boolean;
    tabKey: string;
    steps: { label: string; method: string; url: string; body: string; response: string; running: boolean; done: boolean }[];
    capturedAppIds: number[]; // application IDs captured from POST receipt-applications steps, in order
  } | null>(null);
  const [apiInfoVisible, setApiInfoVisible] = useState(false);
  const [gridFilter, setGridFilter]       = useState('');
  const [lastSearchUrl, setLastSearchUrl] = useState('');
  const [miscAcctVisible, setMiscAcctVisible] = useState(false);
  const [miscAcctTabKey, setMiscAcctTabKey]   = useState('');
  const [miscAcctField, setMiscAcctField]     = useState<'drAccount' | 'crAccount'>('crAccount');
  const [splitAcctPickerSplitId, setSplitAcctPickerSplitId] = useState<string | null>(null);
  // Per-tab edit mode: false = view/locked, true = editing enabled
  const [editingEnabled, setEditingEnabled]   = useState<Record<string, boolean>>({});
  type AcctLine = { lineType: string; accountingClass: string; accountCombination: string;
                   accountDesc: string; enteredDr: number; enteredCr: number; description: string; ref?: string };
  type AdjItem = {
    adjustmentId: number;
    applicationId: number;
    transactionNumber: string;
    amount: number;
    accountCombination: string;
    accountDesc: string;
    activity: string;
    lines: AcctLine[];   // Dr/Cr preview journal lines for this adjustment
    // GL duplicate-check result
    glExists: boolean;
    glPosted: boolean;
    glBatchId: number | null;
    glStatus: string | null;
    // Post result
    postStatus: 'pending' | 'running' | 'done' | 'skipped' | 'error';
    postDetail?: string;
  };
  type AcctStep = { label: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error'; detail?: string };
  type DebugStep = {
    id: string;
    group: string;         // 'receipt' | 'adj-<id>'
    label: string;
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    payload?: object;
    skipReason?: string;   // set when step will be auto-skipped
    status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
    responseData?: any;
    detail?: string;
    expanded: boolean;
  };
  const [acctModal, setAcctModal] = useState<{
    visible: boolean; tabKey: string; creating: boolean; posting: boolean;
    // Receipt GL duplicate-check
    rcptGlExists: boolean; rcptGlPosted: boolean; rcptGlBatchId: number | null;
    // SLA/batch result for receipt
    slaHeaderId: number | null; slaStatus: string; glBatchId: number | null;
    lines: AcctLine[];
    adjItems: AdjItem[];
    adjLoading: boolean;
    adjApiUrls: string[];
    steps: AcctStep[];
    // Debug panel
    debugSteps: DebugStep[] | null;  // null = not built yet
    showDebug: boolean;
  } | null>(null);

  const [viewAcctModal, setViewAcctModal] = useState<{
    receiptNumber: string; loading: boolean; posting: boolean;
    header: any; lines: any[];          // receipt journal lines
    adjGroups: { adjustmentId: number; batchName: string; lines: any[]; found: boolean }[];  // one per adj
    apiUrls?: string[];                 // GET endpoints used to retrieve the journal
    tabKey?: string;                    // owning receipt tab (to jump to Create Accounting)
  } | null>(null);
  // When set, openAcctModal auto-opens the debug 'API Steps Preview' once loaded.
  const [autoDebugPending, setAutoDebugPending] = useState(false);

  const openViewAccounting = async (draft: ReceiptDraft) => {
    setViewAcctModal({ receiptNumber: draft.receiptNumber, loading: true, posting: false, header: null, lines: [], adjGroups: [] });

    // Build combo→desc map from cached account data
    const comboDescMap: Record<string, string> = {};
    allMethodAccounts.forEach(a => {
      const pairs: [number, string][] = [
        [a.cashCcid, a.cashCombination], [a.unappliedCcid, a.unappliedCombination],
        [a.unidentifiedCcid, a.unidentifiedCombination], [a.onAccountCcid, a.onAccountCombination],
      ];
      pairs.forEach(([ccid, combo]) => {
        if (ccid > 0 && combo && acctDescCache[ccid]) {
          comboDescMap[combo.replace(/\./g, '-').toUpperCase()] = acctDescCache[ccid].description;
        }
      });
    });

    const enrichLines = async (rawLines: any[]) =>
      Promise.all(rawLines.map(async (l: any) => {
        const key = (l.accountCombination || '').toUpperCase();
        if (comboDescMap[key]) return { ...l, accountDesc: comboDescMap[key] };
        try {
          const r = await validateAccountCode(l.accountCombination);
          const desc = Object.values(r.segmentDetails ?? {}).map((v: any) => v.description).filter(Boolean).join(' · ');
          return { ...l, accountDesc: desc };
        } catch { return l; }
      }));

    // Map a flat gl/journals/lines row (FA-style endpoint) to the modal's line shape.
    const mapFlatLine = (l: any) => ({
      accountCombination: l.account ?? l.ACCOUNT ?? l.account_combination ?? '',
      description:        l.description ?? l.DESCRIPTION ?? '',
      enteredDr:          l.entered_dr ?? l.ENTERED_DR ?? 0,
      enteredCr:          l.entered_cr ?? l.ENTERED_CR ?? 0,
      reference2:         l.reference2 ?? l.REFERENCE2 ?? '',
      journalName:        l.journal_name ?? l.JOURNAL_NAME ?? '',
      periodName:         l.period_name ?? l.PERIOD_NAME ?? '',
      postingStatus:      l.posting_status ?? l.POSTING_STATUS ?? '',
      batchId:            l.je_batch_id ?? l.JE_BATCH_ID ?? null,
    });
    // Header derived from the first line of a flat result set.
    const headerFromLines = (rows: any[]) => {
      const f = rows[0] ?? {};
      return {
        found: true,
        batchId: f.batchId,
        batchStatus: (f.postingStatus || '').toUpperCase() === 'POSTED' ? 'Posted' : 'Unposted',
        periodName: f.periodName,
        journalName: f.journalName,
        glBatchName: f.journalName,
      };
    };

    try {
      const BASE = APEX_DB_CONFIG.baseUrl;
      const apiUrls: string[] = [];

      // 1. Receipt journal — retrieve lines by reference2=standardReceiptId + reference5=AR_RECEIPTS,
      //    using the SAME flat endpoint the Fixed Assets / Depreciation module uses:
      //      GET /gl/journals/lines?reference2={id}&reference5={type}
      //    reference1 (the receipt number) is intentionally NOT used — it is a long,
      //    free-text value; reference2 + reference5 uniquely identify the journal.
      const rcptId = String(draft.standardReceiptId);
      const rcptLinesUrl = `${BASE}/gl/journals/lines?reference2=${encodeURIComponent(rcptId)}&reference5=AR_RECEIPTS`;
      apiUrls.push(`GET ${rcptLinesUrl}`);
      let header: any = null;
      let lines: any[] = [];
      const rcptRes  = await fetch(rcptLinesUrl, { headers: { Accept: 'application/json' } });
      const rcptData = await rcptRes.json().catch(() => ({}));
      const rcptRows: any[] = (Array.isArray(rcptData?.items) ? rcptData.items : Array.isArray(rcptData) ? rcptData : []).map(mapFlatLine);
      if (rcptRows.length > 0) {
        lines = await enrichLines(rcptRows);
        header = headerFromLines(rcptRows);
      }

      // 2. Adjustment journals — one per saved adjustment_id, same flat endpoint
      //    (reference2 = adjustment id, reference5 = AR_ADJUSTMENTS).
      const tabKey = tabs.find(t => t.draft.standardReceiptId === draft.standardReceiptId)?.key ?? '';
      const appRows = receiptApplications[tabKey]?.rows ?? [];
      const appIds = appRows.map(a => a.applicationId).filter(Boolean);

      const adjGroups: { adjustmentId: number; batchName: string; lines: any[]; found: boolean }[] = [];
      if (appIds.length > 0) {
        // Fetch all adjustments for these applications
        const adjFetches = appIds.map(appId =>
          fetch(`${BASE}/ar/adjustments?application_id=${appId}&limit=500`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }))
        );
        const adjResults = await Promise.all(adjFetches);
        const allAdjs: any[] = adjResults.flatMap(r => r.items ?? []);

        // For each adjustment, retrieve its lines by reference2 + reference5.
        // Keep ALL adjustments (found or not) so each can show a found/missing tick.
        for (const adj of allAdjs) {
          const adjId = adj.adjustment_id ?? adj.ADJUSTMENT_ID;
          if (!adjId) continue;
          const activity = adj.receivables_activity ?? adj.RECEIVABLES_ACTIVITY ?? 'Adjustment';
          const txnNum   = adj.transaction_number ?? adj.TRANSACTION_NUMBER ?? '';
          const adjLinesUrl = `${BASE}/gl/journals/lines?reference2=${encodeURIComponent(String(adjId))}&reference5=AR_ADJUSTMENTS`;
          apiUrls.push(`GET ${adjLinesUrl}`);
          const adjRes  = await fetch(adjLinesUrl, { headers: { Accept: 'application/json' } });
          const adjData = await adjRes.json().catch(() => ({}));
          const adjRows: any[] = (Array.isArray(adjData?.items) ? adjData.items : Array.isArray(adjData) ? adjData : []).map(mapFlatLine);
          const found = adjRows.length > 0;
          const enriched = found ? await enrichLines(adjRows) : [];
          adjGroups.push({
            adjustmentId: adjId,
            batchName: found
              ? `Batch #${adjRows[0]?.batchId ?? '—'} · ${activity} · ${txnNum}`
              : `${activity} · ${txnNum} — no GL journal`,
            lines: enriched,
            found,
          });
        }
      }

      setViewAcctModal({ receiptNumber: draft.receiptNumber, loading: false, posting: false, header, lines, adjGroups, apiUrls, tabKey });
    } catch (e: any) {
      message.error('Failed to load GL journal: ' + e.message);
      setViewAcctModal(null);
    }
  };


  const [receiptApplications, setReceiptApplications] = useState<
    Record<string, { loading: boolean; rows: AppRow[] }>
  >({});

  // ── Installment picker (per tab) ─────────────────────────────────────────
  interface InstPickerRow {
    key: string;
    customerTransactionId: number;
    transactionNumber: string;
    transactionDate: string;
    dueDate: string;
    sequenceNumber: number;
    installmentId: number;
    originalAmount: number;
    balanceDue: number;
    calculatedBalance: number;
    currency: string;
    applyAmount: number | null;
    adjustmentAmount: number | null;
    adjustmentReason: string;
    transactionClass?: string;
    billToSiteUseId?: number;
  }
  const [instPickerOpen,      setInstPickerOpen]      = useState<Record<string, boolean>>({});
  const [instPickerLoading,   setInstPickerLoading]   = useState<Record<string, boolean>>({});
  const [instPickerSaving,    setInstPickerSaving]    = useState<Record<string, boolean>>({});
  const [instPickerRows,      setInstPickerRows]      = useState<Record<string, InstPickerRow[]>>({});
  const [instPickerSel,       setInstPickerSel]       = useState<Record<string, React.Key[]>>({});
  const [instPickerSearch,    setInstPickerSearch]    = useState<Record<string, string>>({});
  const [instPickerApiOpen,   setInstPickerApiOpen]   = useState(false);
  const [deletingAppId,       setDeletingAppId]       = useState<number | null>(null);

  // ── Adj Split dialog ─────────────────────────────────────────────────────
  interface RecvActivity { name: string; type: string; accountCombination: string; }
  const [recvActivities,        setRecvActivities]        = useState<RecvActivity[]>([]);
  const [recvActivitiesLoading, setRecvActivitiesLoading] = useState(false);
  const [adjSplitModal, setAdjSplitModal] = useState<{
    tabKey: string; pendingKey: string; totalAdj: number; currency: string;
    splits: AdjSplit[];
    apiUrl?: string;           // URL used to fetch splits (for inspector)
    applicationId?: number;    // saved applicationId this dialog is linked to
    adjCreated?: boolean;      // true after "Create Adjustment" completes
    creating?: boolean;        // true while POSTing adjustments
    viewOnly?: boolean;        // true when opened outside edit mode (read-only view)
    // snapshot of key row fields needed to build adjustment POST body
    rowSnap?: {
      customerTransactionId?: number;
      transactionNumber?: string;
      installmentId?: number;
      sequenceNumber?: number;
      balanceDue?: number;
      applyAmount?: number;
      adjustmentAmount?: number;
      transactionClass?: string;
      billToSiteUseId?: number;
    };
  } | null>(null);

  const fetchRecvActivities = useCallback(async (force = false) => {
    if (!force && recvActivities.length > 0) return;
    setRecvActivitiesLoading(true);
    try {
      const res  = await fetch(`${GL_ORDS_BASE}/ar/Receivablesactivities?limit=500`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const items = (data.items ?? data ?? []) as any[];
      setRecvActivities(items.map((a: any) => ({
        name:               a.name               ?? a.ACTIVITY_NAME   ?? a.activity_name   ?? '',
        type:               a.description        ?? a.ACTIVITY_TYPE   ?? a.activity_type   ?? '',
        accountCombination: a.gl_account_combination ?? a.ACCOUNT_COMBINATION ?? a.account_combination ?? '',
      })).filter(a => a.name));
    } catch { message.error('Failed to load receivable activities'); }
    finally { setRecvActivitiesLoading(false); }
  }, [recvActivities.length]);

  const openAdjSplitModal = async (
    tabKey: string,
    pendingKey: string,
    totalAdj: number,
    currency: string,
    existingSplits?: AdjSplit[],
    applicationId?: number,
    rowSnap?: {
      customerTransactionId?: number; transactionNumber?: string;
      installmentId?: number; sequenceNumber?: number;
      balanceDue?: number; applyAmount?: number; adjustmentAmount?: number;
      transactionClass?: string; billToSiteUseId?: number;
    },
    viewOnly?: boolean,
  ) => {
    fetchRecvActivities();
    const adjApiUrl = applicationId
      ? `${APEX_DB_CONFIG.baseUrl}/ar/adjustments?application_id=${applicationId}&limit=500`
      : undefined;
    // If we have a saved applicationId, try to load existing splits from adjustments webservice
    if (applicationId && adjApiUrl && (!existingSplits || existingSplits.length === 0)) {
      try {
        const res  = await fetch(adjApiUrl, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        const items: any[] = data.items ?? [];
        if (items.length > 0) {
          const loadedSplits: AdjSplit[] = await Promise.all(items.map(async (a: any) => {
            const combo = a.account_combination ?? a.ACCOUNT_COMBINATION ?? '';
            let desc = '';
            if (combo) {
              try {
                const r = await validateAccountCode(combo.replace(/\./g, '-'));
                const sd = r.segmentDetails ?? {};
                const acctEntry = Object.values(sd).find((s: any) => { const n = (s.name ?? '').toLowerCase(); return n === 'account' || (n.includes('account') && !n.includes('sub') && !n.includes('chart') && !n.includes('offset')); });
                const subEntry  = Object.values(sd).find((s: any) => (s.name ?? '').toLowerCase().includes('sub'));
                const parts = [acctEntry?.description, subEntry?.description].filter(Boolean);
                desc = parts.length ? parts.join(' · ') : Object.values(sd).map((s: any) => s.description).filter(Boolean).join(' · ');
              } catch { /* silent */ }
            }
            return {
              id:                 `sp-saved-${a.adjustment_id ?? a.ADJUSTMENT_ID ?? Math.random()}`,
              amount:             Math.abs(a.adjustment_amount ?? a.ADJUSTMENT_AMOUNT ?? 0),
              activityName:       a.receivables_activity ?? a.RECEIVABLES_ACTIVITY ?? '',
              accountCombination: combo,
              accountDescription: desc,
              reason:             a.adjustment_reason ?? a.ADJUSTMENT_REASON ?? '',
            };
          }));
          setAdjSplitModal({ tabKey, pendingKey, totalAdj, currency, splits: loadedSplits, apiUrl: adjApiUrl, applicationId, rowSnap, viewOnly });
          return;
        }
      } catch { /* fall through to blank */ }
    }
    const splits = existingSplits?.length
      ? existingSplits
      : [{ id: `sp-${Date.now()}`, amount: totalAdj, activityName: '', accountCombination: '', accountDescription: '', reason: '' }];
    setAdjSplitModal({ tabKey, pendingKey, totalAdj, currency, splits, apiUrl: adjApiUrl, applicationId, rowSnap, viewOnly });
  };

  // Delete a saved receipt application via DELETE /ar/receipt-applications/:id
  const deleteApplication = async (tabKey: string, applicationId: number, pendingKey?: string) => {
    if (pendingKey) {
      // Pending (not yet saved) — just remove from local state
      setPendingApplications(prev => ({
        ...prev,
        [tabKey]: (prev[tabKey] ?? []).filter(p => p.key !== pendingKey),
      }));
      return;
    }
    Modal.confirm({
      title: 'Delete Application',
      width: 500,
      content: (
        <div style={{ fontSize: 13 }}>
          <p style={{ margin: '8px 0' }}>Delete this receipt application? This cannot be undone.</p>
          <div style={{ padding: '6px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}>
            <Text type="secondary" style={{ fontSize: 10 }}>API — no request body</Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Tag color="red" style={{ fontSize: 10, margin: 0 }}>DELETE</Tag>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{`${APEX_RECEIPT_APPS}/${applicationId}`}</code>
            </div>
          </div>
          <p style={{ marginTop: 8, marginBottom: 0, color: REDWOOD.neutral600, fontSize: 11 }}>
            Restores the invoice installment (adds the allocated amount back to the balance due,
            reduces Amount Paid, reopens it) and deletes this application's adjustments.
          </p>
        </div>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeletingAppId(applicationId);
        try {
          const url = `${APEX_RECEIPT_APPS}/${applicationId}`;
          const res = await fetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.success === false) {
            message.error(data?.error || data?.message || `Delete failed (HTTP ${res.status})`);
          } else {
            const restored = data?.amountRestored != null ? ` — ${Number(data.amountRestored).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} restored to installment` : '';
            message.success(`Application deleted${restored}`);
            fetchedAppsRef.current.delete(tabKey);
            fetchApplications(tabKey, tabs.find(t => t.key === tabKey)?.draft.standardReceiptId ?? 0);
          }
        } catch (e: any) {
          message.error(e.message || 'Delete failed');
        } finally {
          setDeletingAppId(null);
        }
      },
    });
  };

  const fetchOpenInstallments = useCallback(async (tabKey: string, customerAccountNumber: string) => {
    if (!customerAccountNumber) return;
    setInstPickerLoading(p => ({ ...p, [tabKey]: true }));
    setInstPickerRows(p => ({ ...p, [tabKey]: [] }));
    try {
      const params = new URLSearchParams({ bill_to_customer: customerAccountNumber, limit: '200' });
      const invRes = await fetch(`${APEX_AR_INVOICES}?${params}`, { headers: { Accept: 'application/json' } });
      if (!invRes.ok) throw new Error(`Invoices HTTP ${invRes.status}`);
      const invData = await invRes.json();
      const invoices: any[] = invData.items ?? [];

      const allRows: InstPickerRow[] = [];
      await Promise.allSettled(invoices.map(async (inv: any) => {
        const txnId  = inv.CustomerTransactionId ?? inv.customer_transaction_id ?? inv.CUSTOMER_TRANSACTION_ID;
        const txnNum = inv.TransactionNumber ?? inv.transaction_number ?? inv.TRANSACTION_NUMBER ?? '';
        const txnDate = (inv.TransactionDate ?? inv.transaction_date ?? inv.TRANSACTION_DATE ?? '').slice(0, 10);
        const ccy    = inv.InvoiceCurrencyCode ?? inv.invoice_currency_code ?? inv.INVOICE_CURRENCY_CODE ?? '';
        const txnClass = inv.TransactionClass ?? inv.transaction_class ?? inv.TRANSACTION_CLASS ?? '';
        const billSiteId = inv.BillToSiteUseId ?? inv.bill_to_site_use_id ?? inv.BILL_TO_SITE_USE_ID ?? null;
        if (!txnId) return;
        const instRes = await fetch(`${APEX_AR_INVOICES}/${txnId}/installments`, { headers: { Accept: 'application/json' } });
        if (!instRes.ok) return;
        const instData = await instRes.json();
        (instData.items ?? []).forEach((x: any) => {
          const bal = x.installment_balance_due ?? x.INSTALLMENT_BALANCE_DUE ?? 0;
          if (bal <= 0) return;
          const calcBal = x.calculated_balance ?? x.CALCULATED_BALANCE ?? bal;
          allRows.push({
            key: `${txnId}-${x.installment_id ?? x.INSTALLMENT_ID}`,
            customerTransactionId: txnId,
            transactionNumber: txnNum,
            transactionDate: txnDate,
            installmentId:   x.installment_id ?? x.INSTALLMENT_ID ?? 0,
            sequenceNumber:  x.installment_sequence_number ?? x.INSTALLMENT_SEQUENCE_NUMBER ?? 0,
            dueDate:         (x.installment_due_date ?? x.INSTALLMENT_DUE_DATE ?? '').slice(0, 10),
            originalAmount:  x.original_amount ?? x.ORIGINAL_AMOUNT ?? 0,
            balanceDue: bal,
            calculatedBalance: calcBal,
            currency: ccy,
            applyAmount: null,
            adjustmentAmount: null,
            adjustmentReason: '',
            transactionClass: txnClass || undefined,
            billToSiteUseId:  billSiteId ?? undefined,
          });
        });
      }));

      allRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      // Restore apply/adj amounts from any already-staged pending rows
      const pendingSnap = pendingApplicationsRef.current[tabKey] ?? [];
      const pendingMap  = Object.fromEntries(pendingSnap.map(r => [r.key, r]));
      const patchedRows = allRows.map(r => pendingMap[r.key]
        ? { ...r, applyAmount: pendingMap[r.key].applyAmount, adjustmentAmount: pendingMap[r.key].adjustmentAmount, adjustmentReason: pendingMap[r.key].adjustmentReason }
        : r);
      setInstPickerRows(p => ({ ...p, [tabKey]: patchedRows }));
    } catch (e: any) {
      message.error(`Failed to load installments: ${e.message}`);
    } finally {
      setInstPickerLoading(p => ({ ...p, [tabKey]: false }));
    }
  }, []);

  // ── Fetch receipt applications ────────────────────────────────────────────
  const fetchApplications = useCallback((tabKey: string, standardReceiptId: number) => {
    if (!standardReceiptId) return;
    fetchedAppsRef.current.add(tabKey);
    setReceiptApplications(prev => ({ ...prev, [tabKey]: { loading: true, rows: [] } }));
    fetch(`${APEX_RECEIPT_APPS}?standard_receipt_id=${standardReceiptId}&limit=200`, {
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        const rows: AppRow[] = ((data.items || []) as any[]).map((a: any) => ({
          key:                        String(a.application_id ?? Math.random()),
          applicationId:              a.application_id              ?? 0,
          applicationDate:            (a.application_date  || '').slice(0, 10),
          applicationAmount:          a.application_amount          ?? 0,
          adjustmentAmount:           a.adjustment_amount           ?? 0,
          applicationStatus:          a.application_status          ?? '',
          accountingDate:             (a.accounting_date   || '').slice(0, 10),
          referenceTransactionNumber: a.reference_transaction_number ?? '',
          referenceTransactionId:     a.reference_transaction_id    ?? null,
          referenceTransactionStatus: a.reference_transaction_status ?? '',
          activityName:               a.activity_name               ?? '',
          standardReceiptId:          a.standard_receipt_id         ?? 0,
          enteredCurrency:            a.entered_currency             ?? '',
          processStatus:              a.process_status               ?? '',
          isLatestApplication:        a.is_latest_application        ?? '',
          custAccountId:              a.cust_account_id              ?? null,
          customerSite:               a.customer_site                ?? '',
        }));
        setReceiptApplications(prev => ({ ...prev, [tabKey]: { loading: false, rows } }));
      })
      .catch(() => {
        setReceiptApplications(prev => ({ ...prev, [tabKey]: { loading: false, rows: [] } }));
      });
  }, []);

  const applySelectedInstallments = useCallback((tabKey: string, _draft: ReceiptDraft) => {
    const allRows = instPickerRows[tabKey] ?? [];
    const selectedKeys = instPickerSel[tabKey] ?? [];
    const selected = allRows.filter(r => selectedKeys.includes(r.key));
    if (!selected.length) return;

    const newPending: PendingAppRow[] = selected.map(row => ({
      key: row.key,
      customerTransactionId: row.customerTransactionId,
      transactionNumber: row.transactionNumber,
      installmentId: row.installmentId,
      sequenceNumber: row.sequenceNumber,
      applyAmount: row.applyAmount ?? row.balanceDue,
      adjustmentAmount: row.adjustmentAmount ?? 0,
      adjustmentReason: row.adjustmentReason || '',
      currency: row.currency,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
    }));

    setPendingApplications(prev => {
      const existing = prev[tabKey] ?? [];
      const newKeys = new Set(newPending.map(r => r.key));
      return { ...prev, [tabKey]: [...existing.filter(r => !newKeys.has(r.key)), ...newPending] };
    });

    setInstPickerOpen(p => ({ ...p, [tabKey]: false }));
    message.success(`${selected.length} installment(s) staged — click Save to post`);
  }, [instPickerRows, instPickerSel]);

  // Attachments (per tab)
  type AttachItem = { id?: number; uid: string; name: string; fileType: string; fileSize: number; content?: string; rawFile?: File; status: 'done' | 'uploading' | 'error' };
  const [tabAttachments, setTabAttachments] = useState<Record<string, AttachItem[]>>({});
  const [attSaving, setAttSaving] = useState<Record<string, boolean>>({});
  const [previewAtt, setPreviewAtt] = useState<{ name: string; fileType: string; blobUrl: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [attApiDebug, setAttApiDebug] = useState<{ url: string; body: string } | null>(null);

  // Helper to map raw API row → ReceiptMethodAccount
  const mapAccount = (r: any): ReceiptMethodAccount => ({
    id:                         r.ID                           ?? r.id                           ?? 0,
    receiptMethodId:            r.RECEIPT_METHOD_ID            ?? r.receipt_method_id            ?? 0,
    receiptMethodName:          r.RECEIPT_METHOD_NAME          ?? r.receipt_method_name          ?? '',
    receiptClass:               r.RECEIPT_CLASS                ?? r.receipt_class                ?? '',
    orgId:                      r.ORG_ID                       ?? r.org_id                       ?? 0,
    businessUnitName:           r.BUSINESS_UNIT_NAME           ?? r.business_unit_name           ?? '',
    company:                    r.COMPANY                      ?? r.company                      ?? '',
    bankAccountId:              r.BANK_ACCOUNT_ID              ?? r.bank_account_id              ?? 0,
    bankAccountName:            r.BANK_ACCOUNT_NAME            ?? r.bank_account_name            ?? '',
    bankAccountNum:             r.BANK_ACCOUNT_NUM             ?? r.bank_account_num             ?? r.bank_account_number ?? '',
    bankName:                   r.BANK_NAME                    ?? r.bank_name                    ?? '',
    bankBranchName:             r.BANK_BRANCH_NAME             ?? r.bank_branch_name             ?? '',
    bankCurrency:               r.BANK_CURRENCY                ?? r.bank_currency                ?? '',
    primaryFlag:                r.PRIMARY_FLAG                 ?? r.primary_flag                 ?? '',
    startDate:                  (r.START_DATE                  ?? r.start_date                   ?? '').slice(0, 10),
    endDate:                    (r.END_DATE                    ?? r.end_date                     ?? '').slice(0, 10),
    cashCcid:                   r.CASH_CCID                    ?? r.cash_ccid                    ?? 0,
    cashCombination:            r.CASH_COMBINATION             ?? r.cash_combination             ?? '',
    unappliedCcid:              r.UNAPPLIED_CCID               ?? r.unapplied_ccid               ?? 0,
    unappliedCombination:       r.UNAPPLIED_COMBINATION        ?? r.unapplied_combination        ?? '',
    unidentifiedCcid:           r.UNIDENTIFIED_CCID            ?? r.unidentified_ccid            ?? 0,
    unidentifiedCombination:    r.UNIDENTIFIED_COMBINATION     ?? r.unidentified_combination     ?? '',
    onAccountCcid:              r.ON_ACCOUNT_CCID              ?? r.on_account_ccid              ?? 0,
    onAccountCombination:       r.ON_ACCOUNT_COMBINATION       ?? r.on_account_combination       ?? '',
    receiptClearingCcid:        r.RECEIPT_CLEARING_CCID        ?? r.receipt_clearing_ccid        ?? 0,
    receiptClearingCombination: r.RECEIPT_CLEARING_COMBINATION ?? r.receipt_clearing_combination ?? '',
    remittanceCcid:             r.REMITTANCE_CCID              ?? r.remittance_ccid              ?? 0,
    remittanceCombination:      r.REMITTANCE_COMBINATION       ?? r.remittance_combination       ?? '',
  });

  // Date preset
  const [datePreset, setDatePreset] = useState<string>('range');

  // Customer LOV — shared between search panel and receipt tabs
  // lovContext = 'search' → updates lovSelected; otherwise = tabKey → updates draft
  interface CustomerOption { custAccountId: number; accountNumber: string; accountName: string; }
  const [lovVisible,  setLovVisible]  = useState(false);
  const [lovSearch,   setLovSearch]   = useState('');
  const [lovAllRows,  setLovAllRows]  = useState<CustomerOption[]>([]);
  const [lovLoading,  setLovLoading]  = useState(false);
  const [lovSelected, setLovSelected] = useState<CustomerOption | null>(null);
  const [lovContext,  setLovContext]  = useState<'search' | string>('search');
  const lovFetched      = useRef(false);
  const fetchedAppsRef  = useRef<Set<string>>(new Set());

  const openLov = (context: 'search' | string, prefill?: string) => {
    setLovContext(context);
    setLovSearch(prefill ?? '');
    setLovVisible(true);
    fetchAllCustomers();
  };

  const onLovSelect = (c: CustomerOption) => {
    if (lovContext === 'search') {
      setLovSelected(c);
    } else {
      updateDraft(lovContext, { customerName: c.accountName, customerAccountNumber: c.accountNumber });
    }
    setLovVisible(false);
  };

  const lovRows = lovSearch.trim()
    ? lovAllRows.filter(c => {
        const q = lovSearch.trim().toUpperCase();
        return c.accountName.toUpperCase().includes(q) || c.accountNumber.toUpperCase().includes(q);
      })
    : lovAllRows;

  const fetchAllCustomers = () => {
    if (lovFetched.current) return;
    setLovLoading(true);
    fetch(`${APEX_DB_CONFIG.baseUrl}/ar/customers`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        setLovAllRows(((data.items ?? []) as any[]).map((c: any) => ({
          custAccountId: c.cust_account_id ?? 0,
          accountNumber: c.account_number  ?? '',
          accountName:   c.account_name    ?? '',
        })));
        lovFetched.current = true;
      })
      .catch(() => {})
      .finally(() => setLovLoading(false));
  };

  useEffect(() => {
    if (!activeKey || activeKey === 'search') return;
    const tab = tabs.find(t => t.key === activeKey);
    if (!tab || !tab.draft.standardReceiptId) return;
    if (fetchedAppsRef.current.has(activeKey)) return;
    fetchedAppsRef.current.add(activeKey);
    fetchApplications(activeKey, tab.draft.standardReceiptId);
  }, [activeKey, tabs, fetchApplications]);

  // ── Load business units + all receipt method accounts from ORDS ──────────
  useEffect(() => {
    // Business units
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        setBusinessUnits(
          ((data.items || []) as any[])
            .map((i: any) => ({ name: i.business_unit_name || '', companyCode: i.company_code ?? i.company ?? '' }))
            .filter(b => b.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => {});

    // Receipt methods are loaded per-tab when Business Unit is selected
  }, []);

  // ── Date preset logic ─────────────────────────────────────────────────────
  const applyDatePreset = (preset: string) => {
    setDatePreset(preset);
    if (preset === 'today') {
      const d = dayjs();
      searchForm.setFieldsValue({ dateRange: [d, d] });
    } else if (preset === 'last7') {
      searchForm.setFieldsValue({ dateRange: [dayjs().subtract(6, 'day'), dayjs()] });
    } else if (preset === 'last30') {
      searchForm.setFieldsValue({ dateRange: [dayjs().subtract(29, 'day'), dayjs()] });
    } else if (preset === 'range') {
      // leave picker open for user input
    }
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    try { await searchForm.validateFields(['businessUnit']); } catch { return; }
    const v = searchForm.getFieldsValue();
    setSearching(true);
    try {
      const p = new URLSearchParams();
      if (v.businessUnit)   p.set('business_unit',    v.businessUnit);
      if (lovSelected)      p.set('customer',          lovSelected.accountName);
      if (v.receiptMethod)  p.set('receipt_number',    v.receiptNumber || '');
      if (v.receiptNumber)  p.set('receipt_number',    v.receiptNumber);
      if (v.receiptType)    p.set('receipt_type',      v.receiptType);
      if (v.state)          p.set('state',             v.state);
      if (v.status)         p.set('status',            v.status);
      if (v.currency)       p.set('currency',          v.currency);
      if (v.dateRange?.[0]) p.set('date_from', v.dateRange[0].format('YYYY-MM-DD'));
      if (v.dateRange?.[1]) p.set('date_to',   v.dateRange[1].format('YYYY-MM-DD'));
      p.set('limit', '200');

      const searchUrl = `${APEX_AR_RECEIPTS}?${p}`;
      setLastSearchUrl(searchUrl);
      const res  = await fetch(searchUrl);
      const data = await res.json();

      const rows: ReceiptRow[] = ((data.items || []) as any[]).map((r: any, i: number) => ({
        key:                   String(r.standard_receipt_id ?? i),
        standardReceiptId:     r.standard_receipt_id     ?? 0,
        receiptNumber:         r.receipt_number          ?? '',
        documentNumber:        r.document_number         ?? null,
        receiptType:           r.receipt_type            ?? '',
        businessUnit:          r.business_unit           ?? '',
        receiptMethod:         r.receipt_method          ?? '',
        receiptDate:           (r.receipt_date    || '').slice(0, 10),
        accountingDate:        (r.accounting_date || '').slice(0, 10),
        amount:                r.amount                  ?? 0,
        unappliedAmount:       r.unapplied_amount        ?? 0,
        accountedAmount:       r.accounted_amount        ?? 0,
        currency:              r.currency                ?? 'AED',
        state:                 r.state                   ?? '',
        status:                r.status                  ?? '',
        remittanceBankName:          r.remittance_bank_name             ?? '',
        remittanceBankAccountNumber: r.remittance_bank_account_number   ?? '',
        maturityDate:                (r.maturity_date || '').slice(0, 10),
        customerName:                r.customer_name                    ?? '',
        customerAccountNumber:       r.customer_account_number          ?? '',
        comments:                    r.comments                         ?? '',
        syncStatus:                  r.sync_status                      ?? '',
        accountingStatus:            r.accounting_status                ?? '',
      }));

      setSearchRows(rows);
      if (rows.length === 0) message.info('No receipts found');
    } catch (e: any) { message.error(`Search failed: ${e.message}`); }
    finally { setSearching(false); }
  };

  // ── Open receipt tab — fetches full record via GET ar/receipts/:id ──────────
  const openReceiptTab = useCallback(async (row: ReceiptRow) => {
    const key = `rcpt-${row.standardReceiptId}`;
    if (tabs.find(t => t.key === key)) { setActiveKey(key); return; }

    // Open tab immediately with search-row data so user sees it right away
    const placeholderDraft: ReceiptDraft = {
      standardReceiptId:           row.standardReceiptId,
      receiptNumber:               row.receiptNumber,
      documentNumber:              row.documentNumber,
      receiptType:                 row.receiptType,
      businessUnit:                row.businessUnit,
      receiptMethod:               row.receiptMethod,
      receiptMethodId:             null,
      selectedBankAccountId:       null,
      receiptDate:                 row.receiptDate,
      accountingDate:              row.accountingDate,
      maturityDate:                '',
      amount:                      row.amount,
      unappliedAmount:             row.unappliedAmount,
      accountedAmount:             row.accountedAmount,
      currency:                    row.currency,
      conversionRateType:          '',
      conversionRate:              null,
      state:                       row.state,
      status:                      row.status,
      receiptAtRisk:               'N',
      remittanceBankName:          row.remittanceBankName,
      remittanceBankBranch:        '',
      remittanceBankAccountNumber: '',
      remittanceBankDepositDate:   '',
      customerName:                row.customerName,
      customerAccountNumber:       row.customerAccountNumber,
      customerSite:                '',
      customerBank:                '',
      customerBankBranch:          '',
      customerBankAccountNumber:   '',
      receivablesSpecialist:       '',
      comments:                    row.comments,
      structuredPaymentReference:  '',
      receiptBatchName:            '',
      drAccount:                   '',
      drAccountDesc:               '',
      crAccount:                   '',
      crAccountDesc:               '',
      accountingStatus:            '',
    };
    setTabs(prev => [...prev, { key, draft: placeholderDraft, syncStatus: row.syncStatus, slaHeaderId: null, slaPosted: false }]);
    setActiveKey(key);

    // Fetch full receipt record — all columns including DR/CR accounts
    try {
      const res  = await fetch(`${APEX_AR_RECEIPTS}/${row.standardReceiptId}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const r    = (data.items ?? [data])[0];
      if (!r) return;

      const fullDraft: ReceiptDraft = {
        standardReceiptId:           r.standard_receipt_id     ?? row.standardReceiptId,
        receiptNumber:               r.receipt_number          ?? row.receiptNumber,
        documentNumber:              r.document_number         ?? row.documentNumber,
        receiptType:                 r.receipt_type            ?? row.receiptType,
        businessUnit:                r.business_unit           ?? row.businessUnit,
        receiptMethod:               r.receipt_method          ?? row.receiptMethod,
        receiptMethodId:             r.receipt_method_id       ?? null,
        selectedBankAccountId:       null,
        receiptDate:                 r.receipt_date            ? r.receipt_date.substring(0, 10) : row.receiptDate,
        accountingDate:              r.accounting_date         ? r.accounting_date.substring(0, 10) : row.accountingDate,
        maturityDate:                r.maturity_date           ? r.maturity_date.substring(0, 10) : '',
        amount:                      r.amount                  ?? row.amount,
        unappliedAmount:             r.unapplied_amount        ?? row.unappliedAmount,
        accountedAmount:             r.accounted_amount        ?? row.accountedAmount,
        currency:                    r.currency                ?? row.currency,
        conversionRateType:          r.conversion_rate_type    ?? '',
        conversionRate:              r.conversion_rate         ?? null,
        state:                       r.state                   ?? row.state,
        status:                      r.status                  ?? row.status,
        receiptAtRisk:               r.receipt_at_risk         ?? 'N',
        remittanceBankName:          r.remittance_bank_name    ?? row.remittanceBankName,
        remittanceBankBranch:        r.remittance_bank_branch  ?? '',
        remittanceBankAccountNumber: r.remittance_bank_account_number ?? '',
        remittanceBankDepositDate:   r.remittance_bank_deposit_date   ? r.remittance_bank_deposit_date.substring(0, 10) : '',
        customerName:                r.customer_name           ?? row.customerName,
        customerAccountNumber:       r.customer_account_number ?? row.customerAccountNumber,
        customerSite:                r.customer_site           ?? '',
        customerBank:                r.customer_bank           ?? '',
        customerBankBranch:          r.customer_bank_branch    ?? '',
        customerBankAccountNumber:   r.customer_bank_account_number ?? '',
        receivablesSpecialist:       r.receivables_specialist  ?? '',
        comments:                    r.comments                ?? row.comments,
        structuredPaymentReference:  r.structured_payment_reference ?? '',
        receiptBatchName:            r.receipt_batch_name      ?? '',
        drAccount:                   r.dr_account              ?? '',
        drAccountDesc:               '',
        crAccount:                   r.cr_account              ?? '',
        crAccountDesc:               '',
        accountingStatus:            r.accounting_status       ?? '',
      };

      setTabs(prev => prev.map(t => t.key === key ? { ...t, draft: fullDraft } : t));

      // Resolve descriptions for saved DR / CR account codes
      const resolveDesc = async (code: string) => {
        if (!code) return '';
        try {
          const result = await validateAccountCode(code);
          return Object.values(result.segmentDetails ?? {}).map((s: any) => s.description).filter(Boolean).join(' · ');
        } catch { return ''; }
      };
      const [drDesc, crDesc] = await Promise.all([
        resolveDesc(fullDraft.drAccount),
        resolveDesc(fullDraft.crAccount),
      ]);
      if (drDesc || crDesc) {
        setTabs(prev => prev.map(t => t.key === key ? {
          ...t, draft: { ...t.draft, drAccountDesc: drDesc, crAccountDesc: crDesc }
        } : t));
      }

      // Auto-load receipt methods for this BU so the dropdown is populated
      if (fullDraft.businessUnit) {
        await fetchMethodAccountsByBU(key, fullDraft.businessUnit);
      }

      // Check if SLA accounting already exists for this receipt
      try {
        const slaCheck = await checkAccountingExists('AR_RECEIPTS', fullDraft.standardReceiptId);
        if (slaCheck?.exists) {
          const slaData = await getAccounting('AR_RECEIPTS', fullDraft.standardReceiptId);
          const headerId = slaData?.items?.[0]?.headerId ?? slaData?.headerId ?? null;
          const posted   = slaData?.items?.[0]?.status === 'POSTED' || slaData?.status === 'POSTED';
          if (headerId) {
            setTabs(prev => prev.map(t => t.key === key ? { ...t, slaHeaderId: headerId, slaPosted: posted } : t));
          }
        }
      } catch { /* SLA check is non-critical */ }
    } catch {
      // Tab already open with placeholder data — silent fail
    }
  }, [tabs, fetchMethodAccountsByBU]);

  // ── New receipt tab ───────────────────────────────────────────────────────
  const openNewTab = () => {
    const key = `new-${Date.now()}`;
    setTabs(prev => [...prev, { key, draft: blankDraft(), syncStatus: '', slaHeaderId: null, slaPosted: false }]);
    setActiveKey(key);
  };

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = (key: string) => {
    fetchedAppsRef.current.delete(key);
    setReceiptApplications(prev => { const n = { ...prev }; delete n[key]; return n; });
    setPendingApplications(prev => { const n = { ...prev }; delete n[key]; return n; });
    setTabAttachments(prev => { const n = { ...prev }; delete n[key]; return n; });
    setEditingEnabled(prev => { const n = { ...prev }; delete n[key]; return n; });
    setTabs(prev => {
      const next = prev.filter(t => t.key !== key);
      if (activeKey === key) setActiveKey(next.length > 0 ? next[next.length - 1].key : 'search');
      return next;
    });
  };

  // ── Load attachments for a receipt tab ───────────────────────────────────
  const loadedAttRef = useRef(new Set<string>());
  const loadAttachments = useCallback(async (tabKey: string, receiptId: number) => {
    if (!receiptId || loadedAttRef.current.has(tabKey)) return;
    loadedAttRef.current.add(tabKey);
    try {
      const res = await fetch(`${APEX_AR_RECEIPTS}/${receiptId}/attachments`, { headers: { Accept: 'application/json' } });
      const d = await res.json();
      if (Array.isArray(d.items)) {
        setTabAttachments(prev => ({
          ...prev,
          [tabKey]: d.items.map((a: any) => ({ id: a.id, uid: String(a.id), name: a.fileName || a.file_name, fileType: a.fileType || a.file_type || '', fileSize: a.fileSize || a.file_size || 0, status: 'done' as const })),
        }));
      }
    } catch { /* silent */ }
  }, []);

  // Trigger load when a tab with an existing receipt is opened
  useEffect(() => {
    tabs.forEach(t => {
      if (t.draft.standardReceiptId > 0) loadAttachments(t.key, t.draft.standardReceiptId);
    });
  }, [tabs, loadAttachments]);

  // After methods load for any tab, restore selectedBankAccountId by matching
  // the saved bank account number or receipt method id.
  // Also auto-fill DR Account from cash combination if blank.
  useEffect(() => {
    if (allMethodAccounts.length === 0) return;
    setTabs(prev => prev.map(t => {
      if (t.draft.selectedBankAccountId != null) return t; // already set
      const { remittanceBankAccountNumber, receiptMethodId, receiptMethod } = t.draft;
      let match = remittanceBankAccountNumber
        ? allMethodAccounts.find(a => a.bankAccountNum === remittanceBankAccountNumber && (receiptMethodId ? a.receiptMethodId === receiptMethodId : a.receiptMethodName === receiptMethod))
        : undefined;
      if (!match && receiptMethodId) {
        match = allMethodAccounts.find(a => a.receiptMethodId === receiptMethodId);
      }
      if (!match && receiptMethod) {
        match = allMethodAccounts.find(a => a.receiptMethodName === receiptMethod);
      }
      if (!match) return t;
      const cashCombo = match.cashCombination ? match.cashCombination.replace(/\./g, '-') : '';
      const cashDesc  = match.cashCcid > 0 ? (acctDescCache[match.cashCcid]?.description ?? '') : '';
      return {
        ...t,
        draft: {
          ...t.draft,
          selectedBankAccountId: match.id,
          // auto-fill DR Account from cash combination only when blank
          ...(cashCombo && !t.draft.drAccount ? { drAccount: cashCombo, drAccountDesc: cashDesc } : {}),
        },
      };
    }));
  }, [allMethodAccounts, acctDescCache]);

  const makeBlobUrl = (base64: string, mimeType: string) => {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mimeType || 'application/octet-stream' }));
  };

  const handlePreviewAtt = async (tabKey: string, att: AttachItem, receiptId: number) => {
    if (att.content) {
      setPreviewAtt({ name: att.name, fileType: att.fileType, blobUrl: makeBlobUrl(att.content, att.fileType) });
      return;
    }
    if (!att.id || !receiptId) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(`${APEX_AR_RECEIPTS}/${receiptId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
      const d = await res.json();
      const content = d.content || d.CONTENT || '';
      const ft = att.fileType || d.fileType || d.FILE_TYPE || 'application/octet-stream';
      if (!content) { message.warning('No content available for preview.'); return; }
      setPreviewAtt({ name: att.name, fileType: ft, blobUrl: makeBlobUrl(content, ft) });
    } catch { message.error('Failed to load attachment for preview.'); }
    finally { setPreviewLoading(false); }
  };

  const handleDownloadAtt = async (tabKey: string, att: AttachItem, receiptId: number) => {
    let content = att.content;
    let ft = att.fileType;
    if (!content && att.id && receiptId) {
      try {
        const res = await fetch(`${APEX_AR_RECEIPTS}/${receiptId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
        const d = await res.json();
        content = d.content || d.CONTENT || '';
        ft = att.fileType || d.fileType || 'application/octet-stream';
      } catch { message.error('Failed to download.'); return; }
    }
    if (!content) { message.warning('No content available.'); return; }
    const blobUrl = makeBlobUrl(content, ft || 'application/octet-stream');
    const a = document.createElement('a'); a.href = blobUrl; a.download = att.name; a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  };

  // ── Copy Receipt ─────────────────────────────────────────────────────────
  const [copyModal, setCopyModal] = useState<{ draft: ReceiptDraft } | null>(null);
  const [copying, setCopying] = useState(false);

  const openCopyModal = (draft: ReceiptDraft) => {
    // Prepare the copy draft — blank out identity fields
    setCopyModal({ draft });
  };

  const handleConfirmCopy = async () => {
    if (!copyModal) return;
    const src = copyModal.draft;
    setCopying(true);
    try {
      const newReceiptNumber = `Copy:${src.receiptNumber}`;
      const body = {
        receipt_number:                  newReceiptNumber,
        receipt_type:                    src.receiptType,
        business_unit:                   src.businessUnit,
        receipt_method:                  src.receiptMethod,
        receipt_method_id:               src.receiptMethodId,
        receipt_date:                    src.receiptDate,
        accounting_date:                 null,           // blank per requirement
        maturity_date:                   src.maturityDate || null,
        amount:                          src.amount,
        currency_code:                   src.currency,
        conversion_rate_type:            src.conversionRateType || null,
        conversion_rate:                 src.conversionRate,
        state:                           src.state || null,
        status:                          src.status || null,
        receipt_at_risk:                 src.receiptAtRisk || 'N',
        remittance_bank_name:            src.remittanceBankName || null,
        remittance_bank_branch:          src.remittanceBankBranch || null,
        remittance_bank_account_number:  src.remittanceBankAccountNumber || null,
        remittance_bank_deposit_date:    null,
        customer_name:                   src.customerName || null,
        customer_account_number:         src.customerAccountNumber || null,
        customer_site:                   src.customerSite || null,
        customer_bank:                   src.customerBank || null,
        customer_bank_branch:            src.customerBankBranch || null,
        customer_bank_account_number:    src.customerBankAccountNumber || null,
        receivables_specialist:          src.receivablesSpecialist || null,
        comments:                        src.comments || null,
        structured_payment_reference:    src.structuredPaymentReference || null,
        receipt_batch_name:              src.receiptBatchName || null,
        dr_account:                      src.drAccount || null,
        cr_account:                      src.crAccount || null,
        accounting_status:               null,           // blank per requirement
        sync_status:                     'NEW',
      };

      const res    = await fetch(APEX_AR_RECEIPTS, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok || (result?.errors ?? 0) > 0) {
        message.error(result?.message || `Copy failed (HTTP ${res.status})`);
        return;
      }

      const newId = result?.receiptId ?? result?.standard_receipt_id;
      if (!newId) { message.error('Copy created but could not retrieve new Receipt ID'); return; }

      message.success(`Receipt copied — new ID: ${newId}`);
      setCopyModal(null);

      // Fetch the new receipt and open it in a new tab
      const fetchRes = await fetch(`${APEX_AR_RECEIPTS}/${newId}`, { headers: { Accept: 'application/json' } });
      const fetchData = await fetchRes.json();
      const r = (fetchData.items ?? [fetchData])[0];
      if (!r) { message.warning('Copied receipt created but could not open it automatically'); return; }

      const newRow: ReceiptRow = {
        key:                         String(newId),
        standardReceiptId:           newId,
        receiptNumber:               r.receipt_number          ?? newReceiptNumber,
        documentNumber:              r.document_number         ?? null,
        receiptType:                 r.receipt_type            ?? src.receiptType,
        businessUnit:                r.business_unit           ?? src.businessUnit,
        receiptMethod:               r.receipt_method          ?? src.receiptMethod,
        receiptDate:                 r.receipt_date            ?? src.receiptDate,
        accountingDate:              r.accounting_date         ?? '',
        amount:                      r.amount                  ?? src.amount ?? 0,
        unappliedAmount:             r.unapplied_amount        ?? 0,
        accountedAmount:             r.accounted_amount        ?? 0,
        currency:                    r.currency_code           ?? src.currency,
        state:                       r.state                   ?? '',
        status:                      r.status                  ?? '',
        remittanceBankName:          r.remittance_bank_name    ?? '',
        remittanceBankAccountNumber: r.remittance_bank_account_number ?? '',
        maturityDate:                r.maturity_date           ?? '',
        customerName:                r.customer_name           ?? src.customerName,
        customerAccountNumber:       r.customer_account_number ?? src.customerAccountNumber,
        comments:                    r.comments                ?? src.comments,
        syncStatus:                  r.sync_status             ?? 'NEW',
        accountingStatus:            '',
      };
      openReceiptTab(newRow);
    } catch (e: any) {
      message.error(`Copy failed: ${e.message}`);
    } finally {
      setCopying(false);
    }
  };

  const handleSaveAttachments = async (tabKey: string, receiptId: number) => {
    if (!receiptId) { message.error('Receipt ID not available — save the receipt first.'); return; }
    const pending = (tabAttachments[tabKey] || []).filter(a => !a.id);
    if (pending.length === 0) { message.info('No new attachments to save.'); return; }
    setAttSaving(prev => ({ ...prev, [tabKey]: true }));
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
        const payload = JSON.stringify({ fileName: att.name, fileType: att.fileType || '', fileSize: att.fileSize, content: base64 });
        const res = await fetch(`${APEX_AR_RECEIPTS}/${receiptId}/attachments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        const txt = await res.text();
        let resp: any = null;
        try { resp = JSON.parse(txt); } catch { /* not JSON */ }
        if (resp?.status === 'success' || res.ok) savedCount++;
        else message.error(`${att.name}: ${resp?.message || txt || `HTTP ${res.status}`}`);
      } catch (e: any) { message.error(`${att.name}: ${e.message}`); }
    }
    // Refresh
    loadedAttRef.current.delete(tabKey);
    await loadAttachments(tabKey, receiptId);
    message.success(`${savedCount} attachment(s) saved.`);
    setAttSaving(prev => ({ ...prev, [tabKey]: false }));
  };

  // ── Receipt PDF ──────────────────────────────────────────────────────────
  const [receiptPdfUrl, setReceiptPdfUrl] = useState<string | null>(null);
  const [receiptPdfModal, setReceiptPdfModal] = useState(false);

  const generateReceiptPdf = (draft: ReceiptDraft) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    const fmt = (v: any) => (v != null && v !== '') ? String(v) : '—';
    const fmtAmt = (v: any) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const fmtDt = (v: any) => {
      if (!v) return '—';
      try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return String(v); }
    };

    // ── Header bar ─────────────────────────────────────────────────────────
    doc.setFillColor(29, 123, 77);   // REDWOOD success green for AR
    doc.rect(0, 0, pageW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('RECEIPT VOUCHER', 14, 13);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Printed: ${new Date().toLocaleString()}`, pageW - 14, 13, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    let y = 28;

    // ── Receipt number + state ──────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(29, 123, 77);
    doc.text(`Receipt #${draft.receiptNumber || '—'}`, 14, y);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(
      `State: ${fmt(draft.state)}   |   Status: ${fmt(draft.status)}   |   Type: ${fmt(draft.receiptType)}`,
      14, y + 6,
    );
    doc.setTextColor(0, 0, 0);
    y += 16;

    // ── Section 1: Receipt Details ─────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Receipt Details', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ['Business Unit',    fmt(draft.businessUnit),          'Receipt Method',    fmt(draft.receiptMethod)],
        ['Receipt Date',     fmtDt(draft.receiptDate),          'Accounting Date',   fmtDt(draft.accountingDate)],
        ['Maturity Date',    fmtDt(draft.maturityDate),         'Receipt at Risk',   fmt(draft.receiptAtRisk)],
        ['Document #',       fmt(draft.documentNumber),         'Receipt ID',        fmt(draft.standardReceiptId || '—')],
        ['Struct. Pay. Ref', fmt(draft.structuredPaymentReference), 'Receipt Batch', fmt(draft.receiptBatchName)],
      ],
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
        2: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── Section 2: Customer ────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Customer', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ['Customer Name',    fmt(draft.customerName),           'Account Number',    fmt(draft.customerAccountNumber)],
        ['Customer Site',    fmt(draft.customerSite),           'Rec. Specialist',   fmt(draft.receivablesSpecialist)],
        ['Customer Bank',    fmt(draft.customerBank),           'Cust. Bank Branch', fmt(draft.customerBankBranch)],
        ['Cust. Bank Acct.', fmt(draft.customerBankAccountNumber), '', ''],
      ],
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
        2: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── Section 3: Amount & Currency ───────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Amount & Currency', 14, y);
    y += 2;
    const amtRows: any[][] = [
      ['Currency',         fmt(draft.currency),                'Entered Amount',   fmtAmt(draft.amount)],
      ['Accounted Amount', fmtAmt(draft.accountedAmount),      'Unapplied Amount', fmtAmt(draft.unappliedAmount)],
    ];
    if (draft.currency && draft.currency !== 'AED') {
      amtRows.push(['Conv. Rate Type', fmt(draft.conversionRateType), 'Conv. Rate', fmt(draft.conversionRate)]);
    }
    autoTable(doc, {
      startY: y,
      body: amtRows,
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
        2: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
        3: { halign: 'right' as const },
        1: { halign: 'right' as const },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── Section 4: Remittance Bank ─────────────────────────────────────────
    if (draft.remittanceBankName || draft.remittanceBankAccountNumber) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Remittance Bank', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        body: [
          ['Bank Name',        fmt(draft.remittanceBankName),    'Branch',          fmt(draft.remittanceBankBranch)],
          ['Account Number',   fmt(draft.remittanceBankAccountNumber), 'Deposit Date', fmtDt(draft.remittanceBankDepositDate)],
        ],
        styles: { fontSize: 9, cellPadding: 2.5 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
          2: { fontStyle: 'bold', cellWidth: 42, fillColor: [245, 245, 245] },
        },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // ── Comments ───────────────────────────────────────────────────────────
    if (draft.comments) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Comments', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        body: [[draft.comments]],
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { fillColor: [250, 250, 250] } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    // ── Signature block ────────────────────────────────────────────────────
    if (y > 230) { doc.addPage(); y = 20; }
    const sigY = Math.max(y + 12, 240);
    const sigLabels = ['Created By', 'Reviewed By', 'Approved By'];
    const sigValues = [fmt(currentUser), '', ''];
    const sigW = (pageW - 28 - (sigLabels.length - 1) * 10) / sigLabels.length;
    doc.setDrawColor(180, 180, 180);
    sigLabels.forEach((label, i) => {
      const sx = 14 + i * (sigW + 10);
      // Box
      doc.setFillColor(249, 249, 249);
      doc.roundedRect(sx, sigY - 14, sigW, 22, 2, 2, 'FD');
      // Value (pre-filled for Created By)
      if (sigValues[i]) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(29, 123, 77);
        doc.text(sigValues[i], sx + sigW / 2, sigY - 4, { align: 'center', maxWidth: sigW - 4 });
      }
      // Signature line
      doc.setDrawColor(120, 120, 120);
      doc.line(sx + 4, sigY + 2, sx + sigW - 4, sigY + 2);
      // Label below line
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(label, sx + sigW / 2, sigY + 7, { align: 'center' });
    });
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);

    // ── Footer on every page ───────────────────────────────────────────────
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150);
      doc.line(14, 286, pageW - 14, 286);
      doc.text('Generated by ReactERP', 14, 291);
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 291, { align: 'center' });
      doc.text(new Date().toLocaleString(), pageW - 14, 291, { align: 'right' });
      doc.setTextColor(0);
    }

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    if (receiptPdfUrl) URL.revokeObjectURL(receiptPdfUrl);
    setReceiptPdfUrl(url);
    setReceiptPdfModal(true);
  };

  // ── Update draft ──────────────────────────────────────────────────────────
  const updateDraft = (key: string, patch: Partial<ReceiptDraft>) => {
    setTabs(prev => prev.map(t => t.key === key ? { ...t, draft: { ...t.draft, ...patch } } : t));
  };

  // ── Fetch FX conversion rate ───────────────────────────────────────────────
  const fetchFxRate = async (tabKey: string, currency: string) => {
    if (!currency || currency === 'AED') {
      updateDraft(tabKey, { conversionRate: 1, conversionRateType: 'User' });
      return;
    }
    setFxRateLoading(prev => ({ ...prev, [tabKey]: true }));
    try {
      const params = new URLSearchParams({ from_currency: currency, to_currency: 'AED' });
      const res  = await fetch(`${GL_ORDS_BASE}/currencies/dailyrates?${params}`, {
        headers: { Accept: 'application/json' },
      });
      const text  = await res.text();
      const fixed = text.replace(/:\s*\./g, ': 0.');
      const data  = JSON.parse(fixed);
      const rates = (data.items ?? []) as any[];
      if (rates.length === 0) { message.warning(`No FX rate found for ${currency} → AED`); return; }
      const latest = rates.reduce((best: any, r: any) =>
        (r.rateDate ?? '') > (best.rateDate ?? '') ? r : best, rates[0]);
      updateDraft(tabKey, {
        conversionRate:     parseFloat(latest.conversionRate ?? latest.rate ?? 0),
        conversionRateType: latest.rateType ?? latest.conversionRateType ?? 'Corporate',
      });
      message.success(`FX rate loaded: 1 ${currency} = ${latest.conversionRate ?? latest.rate} AED`);
    } catch { message.error('Failed to fetch FX rate'); }
    finally { setFxRateLoading(prev => ({ ...prev, [tabKey]: false })); }
  };

  // ── Build POST payload (shared by save and API inspector) ────────────────
  // receiptId = null → new receipt, DB assigns ID via RR_AR_RECEIPTS_LOCAL_SEQ
  const buildPayload = (draft: ReceiptDraft, receiptId: number | null) => {
    const nowIso = new Date().toISOString().slice(0, 19);
    return {
      ...(receiptId != null ? { StandardReceiptId: receiptId } : {}),
      ReceiptNumber:               draft.receiptNumber                || undefined,
      DocumentNumber:              draft.documentNumber               ?? undefined,
      ReceiptType:                 draft.receiptType                  || undefined,
      BusinessUnit:                draft.businessUnit,
      ReceiptMethod:               draft.receiptMethod,
      ReceiptMethodId:             draft.receiptMethodId      ?? undefined,
      ReceiptDate:                 draft.receiptDate,
      MaturityDate:                draft.maturityDate                 || undefined,
      Amount:                      draft.amount,
      UnappliedAmount:             draft.unappliedAmount              ?? draft.amount,
      AccountedAmount:             draft.accountedAmount              ?? undefined,
      Currency:                    draft.currency,
      ConversionRateType:          draft.conversionRateType           || undefined,
      ConversionRate:              draft.conversionRate               ?? undefined,
      State:                       draft.state                        || 'Unapplied',
      Status:                      draft.status                       || 'Uncleared',
      ReceiptAtRisk:               draft.receiptAtRisk                || 'N',
      RemittanceBankName:          draft.remittanceBankName           || undefined,
      RemittanceBankBranch:        draft.remittanceBankBranch         || undefined,
      RemittanceBankAccountNumber: draft.remittanceBankAccountNumber  || undefined,
      RemittanceBankDepositDate:   draft.remittanceBankDepositDate    || undefined,
      CustomerName:                draft.customerName,
      CustomerAccountNumber:       draft.customerAccountNumber,
      CustomerSite:                draft.customerSite                 || undefined,
      CustomerBank:                draft.customerBank                 || undefined,
      CustomerBankBranch:          draft.customerBankBranch           || undefined,
      CustomerBankAccountNumber:   draft.customerBankAccountNumber    || undefined,
      ReceivablesSpecialist:       draft.receivablesSpecialist        || undefined,
      Comments:                    draft.comments                     || undefined,
      StructuredPaymentReference:  draft.structuredPaymentReference   || undefined,
      ReceiptBatchName:            draft.receiptBatchName             || undefined,
      DrAccount:                   draft.drAccount                    || undefined,
      CrAccount:                   draft.crAccount                    || undefined,
      CreatedBy:                   currentUser,
      CreationDate:                nowIso,
      LastUpdatedBy:               currentUser,
      LastUpdateDate:              nowIso,
    };
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (tabKey: string) => {
    const tab = tabs.find(t => t.key === tabKey);
    if (!tab) return;
    const { draft } = tab;

    if (draft.standardReceiptId === 0) {
      closeTab(tabKey);
      return;
    }

    Modal.confirm({
      title:   'Delete Receipt',
      icon:    <ExclamationCircleOutlined style={{ color: REDWOOD.primary }} />,
      content: (
        <div>
          <p>This will permanently delete receipt
            <strong> {draft.receiptNumber || `ID ${draft.standardReceiptId}`}</strong> from the database.</p>
          {draft.standardReceiptId > 0 && (
            <p style={{ color: REDWOOD.warning, fontSize: 12 }}>
              Note: This only deletes the local copy. The receipt still exists in Oracle Fusion.
            </p>
          )}
        </div>
      ),
      okText:    'Delete',
      okType:    'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        setDeleting(prev => ({ ...prev, [tabKey]: true }));
        try {
          const res    = await fetch(`${APEX_AR_RECEIPTS}/${draft.standardReceiptId}`, { method: 'DELETE' });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result?.status === 'ERROR') {
            message.error(result?.message || `Delete failed (HTTP ${res.status})`);
            return;
          }
          message.success(`Receipt deleted`);
          closeTab(tabKey);
          setSearchRows(prev => prev.filter(r => r.standardReceiptId !== draft.standardReceiptId));
        } catch (e: any) {
          message.error(`Delete error: ${e.message}`);
        } finally {
          setDeleting(prev => ({ ...prev, [tabKey]: false }));
        }
      },
    });
  };

  // ── Open Accounting Modal ────────────────────────────────────────────────
  const openAcctModal = async (tabKey: string, autoDebug = false) => {
    const tab = tabs.find(t => t.key === tabKey);
    if (!tab) return;
    if (autoDebug) setAutoDebugPending(true);
    const { draft, slaHeaderId, slaPosted } = tab;
    const acct           = allMethodAccounts.find(a => a.id === draft.selectedBankAccountId);
    const amount         = Math.abs(draft.amount ?? 0);
    const isMisc         = draft.receiptType === 'MISC';
    const cashCombo      = acct?.cashCombination?.replace(/\./g, '-')      || draft.drAccount || '';
    const unappliedCombo = acct?.unappliedCombination?.replace(/\./g, '-') || '';
    const cashDesc       = acct?.cashCcid      ? (acctDescCache[acct.cashCcid]?.description      ?? '') : '';
    const unappliedDesc  = acct?.unappliedCcid ? (acctDescCache[acct.unappliedCcid]?.description ?? '') : '';
    // Credit account comes from the receipt's "Cr Account" (falls back to the
    // method's unapplied combination when the receipt has none).
    const crCombo        = draft.crAccount ? draft.crAccount.replace(/\./g, '-') : unappliedCombo;
    const crDesc         = draft.crAccountDesc || unappliedDesc;
    const drDesc         = `${draft.comments || ''} ${draft.receiptNumber}`.trim();
    const savedApps      = receiptApplications[tabKey]?.rows ?? [];

    // Open modal immediately with loading state
    setAcctModal({ visible: true, tabKey, creating: false, posting: false,
      rcptGlExists: false, rcptGlPosted: false, rcptGlBatchId: null,
      slaHeaderId, slaStatus: slaPosted ? 'POSTED' : (slaHeaderId ? 'CREATED' : ''),
      glBatchId: null, lines: [], adjItems: [], adjLoading: true, adjApiUrls: [], steps: [],
      debugSteps: null, showDebug: false });

    let lines: AcctLine[] = [];
    if (isMisc) {
      lines = [
        { lineType: 'DR', accountingClass: 'CASH', accountCombination: cashCombo, accountDesc: cashDesc || draft.drAccountDesc,
          enteredDr: amount, enteredCr: 0, description: drDesc },
        { lineType: 'CR', accountingClass: 'MISC', accountCombination: draft.crAccount || '', accountDesc: draft.crAccountDesc || '',
          enteredDr: 0, enteredCr: amount, description: `${draft.receiptNumber}` },
      ];
    } else if (savedApps.length > 0) {
      // DR: Bank — full receipt amount
      lines.push({ lineType: 'DR', accountingClass: 'CASH', accountCombination: cashCombo,
        accountDesc: cashDesc || draft.drAccountDesc, enteredDr: amount, enteredCr: 0, description: drDesc });
      // CR: one line per application — booked to the receipt's Cr Account
      for (const app of savedApps) {
        const appAmount = Math.abs(app.applicationAmount);
        if (appAmount === 0) continue;
        const crLineDesc = `${app.referenceTransactionNumber} — App Ref ${app.applicationId}`;
        lines.push({ lineType: 'CR', accountingClass: 'RECEIVABLE', accountCombination: crCombo,
          accountDesc: crDesc, enteredDr: 0, enteredCr: appAmount,
          description: crLineDesc, ref: String(app.applicationId) });
      }
      // If total CR < DR (unapplied remainder), add unapplied line
      const crTotal = lines.filter(l => l.lineType === 'CR').reduce((s, l) => s + l.enteredCr, 0);
      const remainder = Math.round((amount - crTotal) * 100) / 100;
      if (remainder > 0.001) {
        lines.push({ lineType: 'CR', accountingClass: 'UNAPPLIED', accountCombination: crCombo,
          accountDesc: crDesc, enteredDr: 0, enteredCr: remainder,
          description: `${draft.receiptNumber} — Unapplied` });
      }
    } else {
      lines = [
        { lineType: 'DR', accountingClass: 'CASH',      accountCombination: cashCombo, accountDesc: cashDesc || draft.drAccountDesc, enteredDr: amount, enteredCr: 0,      description: drDesc },
        { lineType: 'CR', accountingClass: 'UNAPPLIED', accountCombination: crCombo,   accountDesc: crDesc,                          enteredDr: 0,      enteredCr: amount, description: `${draft.receiptNumber} — Unapplied` },
      ];
    }

    // ── Fetch saved adjustments and check GL for each ────────────────────────
    const appIds = savedApps.map(a => a.applicationId).filter(Boolean);
    const adjApiUrls: string[] = appIds.map(appId =>
      `${APEX_DB_CONFIG.baseUrl}/ar/adjustments?application_id=${appId}&limit=500`
    );

    // Run in parallel: receipt GL check + all adjustment fetches
    const [rcptGlCheck, ...adjResults] = await Promise.all([
      checkGLJournalExists('', String(draft.standardReceiptId), 'AR_RECEIPTS'),
      ...adjApiUrls.map(url =>
        fetch(url).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }))
      ),
    ]);

    // Build adjItems — one entry per saved adjustment_id
    const adjItems: AdjItem[] = [];
    for (const res of adjResults) {
      for (const adj of (res.items ?? [])) {
        const adjId  = adj.adjustment_id ?? adj.ADJUSTMENT_ID ?? 0;
        const adjAmt = Math.abs(adj.adjustment_amount ?? adj.ADJUSTMENT_AMOUNT ?? 0);
        if (adjAmt === 0 || !adjId) continue;
        const txnNum   = adj.transaction_number  ?? adj.TRANSACTION_NUMBER  ?? '';
        const activity = adj.receivables_activity ?? adj.RECEIVABLES_ACTIVITY ?? 'Adjustment';
        const adjCombo = (adj.account_combination ?? adj.ACCOUNT_COMBINATION ?? '').replace(/\./g, '-');
        const appId    = adj.application_id ?? adj.APPLICATION_ID ?? 0;

        // Check if this adjustment already has a GL journal
        const adjGlCheck = await checkGLJournalExists(String(adjId), String(adjId), 'AR_ADJUSTMENTS');
        adjItems.push({
          adjustmentId: adjId, applicationId: appId,
          transactionNumber: txnNum, amount: adjAmt,
          accountCombination: adjCombo, accountDesc: activity, activity,
          // Dr = adjustment/activity account; Cr = receipt Cr Account (same as the receipt).
          lines: [
            { lineType: 'DR', accountingClass: 'ADJUSTMENT', accountCombination: adjCombo,
              accountDesc: activity, enteredDr: adjAmt, enteredCr: 0,
              description: `${txnNum} — ${activity}` },
            { lineType: 'CR', accountingClass: 'RECEIVABLE', accountCombination: crCombo,
              accountDesc: crDesc, enteredDr: 0, enteredCr: adjAmt,
              description: `${txnNum} — Receipt Cr` },
          ],
          glExists: adjGlCheck.exists, glPosted: adjGlCheck.status === 'P',
          glBatchId: adjGlCheck.batchId, glStatus: adjGlCheck.status,
          postStatus: 'pending',
        });
      }
    }

    setAcctModal(prev => prev ? {
      ...prev, lines,
      rcptGlExists: rcptGlCheck.exists, rcptGlPosted: rcptGlCheck.status === 'P',
      rcptGlBatchId: rcptGlCheck.batchId,
      adjItems, adjLoading: false, adjApiUrls,
    } : null);
  };

  const setStep = (steps: AcctStep[], label: string, status: AcctStep['status'], detail?: string): AcctStep[] => {
    const idx = steps.findIndex(s => s.label === label);
    const next = { label, status, detail };
    return idx >= 0 ? steps.map((s, i) => i === idx ? next : s) : [...steps, next];
  };

  // Build debug step list with full URLs + payloads — does NOT execute anything
  const buildDebugSteps = async () => {
    if (!acctModal) return;
    const { tabKey, lines, adjItems, rcptGlPosted, rcptGlBatchId } = acctModal;
    const tab = tabs.find(t => t.key === tabKey);
    if (!tab) return;
    const { draft } = tab;
    const BASE = APEX_DB_CONFIG.baseUrl;
    const ledger = await fetchLedgerByBusinessUnit(draft.businessUnit);
    if (!ledger) { message.error('Could not resolve ledger'); return; }
    const exRate  = draft.conversionRate ?? 1;
    const period  = derivePeriodName(new Date(draft.receiptDate || today()));
    const amount  = Math.abs(draft.amount ?? 0);
    const rcptRef = draft.receiptNumber;
    const rcptId  = String(draft.standardReceiptId);

    const steps: DebugStep[] = [];
    let stepIdx = 0;
    const mkId = (tag: string) => `${tag}-${stepIdx++}`;

    // ── Receipt steps ──
    const rcptSkip = rcptGlPosted ? `Already posted in GL — Batch #${rcptGlBatchId}` : undefined;
    const rcptBatchName = `AR-RECEIPT-${rcptRef}-<timestamp>`;

    const rcptSlaPayload: SlaCreatePayload = {
      header: {
        moduleName: 'AR', sourceTable: 'AR_RECEIPTS',
        sourceId: draft.standardReceiptId, sourceNumber: rcptRef, sourceType: 'Receipt',
        eventTypeCode: draft.receiptType === 'MISC' ? 'AR_MISC_RECEIPT' : 'AR_CASH_RECEIPT',
        eventDate: draft.receiptDate || today(),
        accountingDate: draft.accountingDate || draft.receiptDate || today(),
        periodName: period, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
        currencyCode: draft.currency || 'AED', ledgerCurrency: 'AED',
        exchangeRate: exRate, exchangeRateType: draft.conversionRateType || 'Corporate',
        businessUnit: draft.businessUnit, description: `Receipt ${rcptRef}`, createdBy: currentUser,
      },
      lines: lines.map((l, i) => ({
        lineNumber: i + 1, lineType: l.lineType as 'DR' | 'CR',
        accountingClass: l.accountingClass, accountCombination: l.accountCombination,
        enteredDr: l.lineType === 'DR' ? l.enteredDr : 0,
        enteredCr: l.lineType === 'CR' ? l.enteredCr : 0,
        accountedDr: l.lineType === 'DR' ? l.enteredDr * exRate : 0,
        accountedCr: l.lineType === 'CR' ? l.enteredCr * exRate : 0,
        currencyCode: draft.currency || 'AED', exchangeRate: exRate,
        description: draft.comments || l.description,
      })),
    };
    steps.push({ id: mkId('rcpt-sla'), group: 'receipt', label: 'Receipt — SLA Accounting',
      method: 'POST', url: `${BASE}/sla/accounting/create`,
      payload: rcptSlaPayload, skipReason: rcptSkip,
      status: 'pending', expanded: false });

    const rcptGlPayload = {
      batch: {
        batchName: rcptBatchName, batchDescription: `AR Receipt ${rcptRef}`,
        ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
        accountingPeriod: period, controlTotal: amount,
        runningTotalDr: amount, runningTotalCr: amount,
        batchSource: 'Accounts Receivable', createdBy: currentUser,
      },
      header: {
        ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
        jeCategory: 'Receipts', jeSource: 'Receivables', periodName: period,
        journalName: `AR-${rcptRef}`, description: `Receipt ${rcptRef} — ${draft.customerName || ''}`,
        currencyCode: draft.currency || 'AED', currencyConversionType: draft.conversionRateType || 'Corporate',
        currencyConversionDate: draft.receiptDate || today(), currencyConversionRate: exRate,
        defaultEffectiveDate: draft.receiptDate || today(),
        status: 'NEW', runningTotalDr: amount, runningTotalCr: amount, createdBy: currentUser,
      },
      lines: lines.map(l => ({
        enteredDr: l.lineType === 'DR' ? l.enteredDr : null,
        enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
        accountedDr: l.lineType === 'DR' ? l.enteredDr * exRate : null,
        accountedCr: l.lineType === 'CR' ? l.enteredCr * exRate : null,
        statAmount: null, description: draft.comments || l.description,
        currencyCode: draft.currency || 'AED',
        currencyConversionDate: draft.receiptDate || today(), currencyConversionRate: exRate,
        userCurrencyConversionType: draft.conversionRateType || 'Corporate',
        accountCombination: l.accountCombination, chartOfAccountsName: 'Chart of Accounts',
        reference1: rcptRef, reference2: rcptId, reference3: l.accountingClass,
        reference4: draft.businessUnit, reference5: 'AR_RECEIPTS', createdBy: currentUser,
      })),
    };
    steps.push({ id: mkId('rcpt-gl'), group: 'receipt', label: 'Receipt — GL Journal Create',
      method: 'POST', url: `${BASE}/journals/create`,
      payload: rcptGlPayload, skipReason: rcptSkip,
      status: 'pending', expanded: false });

    steps.push({ id: mkId('rcpt-post'), group: 'receipt', label: 'Receipt — GL Batch Post',
      method: 'PUT', url: `${BASE}/gl/journals/<batchId>/post`,
      skipReason: rcptSkip, status: 'pending', expanded: false });

    steps.push({ id: mkId('rcpt-sla-stamp'), group: 'receipt', label: 'Receipt — SLA Stamp',
      method: 'POST', url: `${BASE}/sla/accounting/post`,
      payload: { headerId: '<slaHeaderId>', glBatchId: '<glBatchId>', glBatchName: rcptBatchName, glHeaderId: '<glHeaderId>', postedBy: currentUser },
      skipReason: rcptSkip, status: 'pending', expanded: false });

    steps.push({ id: mkId('rcpt-acct'), group: 'receipt', label: 'Receipt — Mark Accounted',
      method: 'PUT', url: `${BASE}/ar/receipts/${draft.standardReceiptId}/accounting-status`,
      payload: {}, skipReason: rcptSkip, status: 'pending', expanded: false });

    // ── Per-adjustment steps ──
    for (const adj of adjItems) {
      const adjRef    = String(adj.adjustmentId);
      const adjSkip   = adj.glPosted ? `Already posted in GL — Batch #${adj.glBatchId}` : undefined;
      const adjBatch  = `AR-ADJ-${adjRef}-<timestamp>`;
      const adjLabel  = `Adj #${adj.adjustmentId}`;
      const unappliedCombo = lines.find(l => l.accountingClass === 'RECEIVABLE' || l.accountingClass === 'UNAPPLIED')?.accountCombination || '';

      const adjSlaPayload: SlaCreatePayload = {
        header: {
          moduleName: 'AR', sourceTable: 'AR_ADJUSTMENTS',
          sourceId: adj.adjustmentId, sourceNumber: adjRef, sourceType: 'Adjustment',
          eventTypeCode: 'AR_ADJUSTMENT',
          eventDate: draft.receiptDate || today(),
          accountingDate: draft.accountingDate || draft.receiptDate || today(),
          periodName: period, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
          currencyCode: draft.currency || 'AED', ledgerCurrency: 'AED',
          exchangeRate: exRate, exchangeRateType: draft.conversionRateType || 'Corporate',
          businessUnit: draft.businessUnit, description: `Adjustment ${adjRef}`, createdBy: currentUser,
        },
        lines: [
          { lineNumber: 1, lineType: 'DR', accountingClass: 'ADJUSTMENT',
            accountCombination: adj.accountCombination,
            enteredDr: adj.amount, enteredCr: 0,
            accountedDr: adj.amount * exRate, accountedCr: 0,
            currencyCode: draft.currency || 'AED', exchangeRate: exRate,
            description: `${adj.transactionNumber} — ${adj.activity}` },
          { lineNumber: 2, lineType: 'CR', accountingClass: 'RECEIVABLE',
            accountCombination: unappliedCombo,
            enteredDr: 0, enteredCr: adj.amount,
            accountedDr: 0, accountedCr: adj.amount * exRate,
            currencyCode: draft.currency || 'AED', exchangeRate: exRate,
            description: `${adj.transactionNumber} — AR Receivable` },
        ],
      };
      steps.push({ id: mkId(`adj-${adjRef}-sla`), group: `adj-${adjRef}`, label: `${adjLabel} — SLA Accounting`,
        method: 'POST', url: `${BASE}/sla/accounting/create`,
        payload: adjSlaPayload, skipReason: adjSkip, status: 'pending', expanded: false });

      const adjGlPayload = {
        batch: {
          batchName: adjBatch, batchDescription: `AR Adjustment ${adjRef}`,
          ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
          accountingPeriod: period, controlTotal: adj.amount,
          runningTotalDr: adj.amount, runningTotalCr: adj.amount,
          batchSource: 'Accounts Receivable', createdBy: currentUser,
        },
        header: {
          ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
          jeCategory: 'Adjustments', jeSource: 'Receivables', periodName: period,
          journalName: `AR-ADJ-${adjRef}`, description: `Adjustment ${adjRef} — ${adj.activity}`,
          currencyCode: draft.currency || 'AED', currencyConversionType: draft.conversionRateType || 'Corporate',
          currencyConversionDate: draft.receiptDate || today(), currencyConversionRate: exRate,
          defaultEffectiveDate: draft.receiptDate || today(),
          status: 'NEW', runningTotalDr: adj.amount, runningTotalCr: adj.amount, createdBy: currentUser,
        },
        lines: [
          { enteredDr: adj.amount, enteredCr: null, accountedDr: adj.amount * exRate, accountedCr: null,
            statAmount: null, description: `${adj.transactionNumber} — ${adj.activity}`,
            currencyCode: draft.currency || 'AED',
            currencyConversionDate: draft.receiptDate || today(), currencyConversionRate: exRate,
            userCurrencyConversionType: draft.conversionRateType || 'Corporate',
            accountCombination: adj.accountCombination, chartOfAccountsName: 'Chart of Accounts',
            reference1: adjRef, reference2: adjRef, reference3: 'ADJUSTMENT',
            reference4: draft.businessUnit, reference5: 'AR_ADJUSTMENTS', createdBy: currentUser },
          { enteredDr: null, enteredCr: adj.amount, accountedDr: null, accountedCr: adj.amount * exRate,
            statAmount: null, description: `${adj.transactionNumber} — AR Receivable`,
            currencyCode: draft.currency || 'AED',
            currencyConversionDate: draft.receiptDate || today(), currencyConversionRate: exRate,
            userCurrencyConversionType: draft.conversionRateType || 'Corporate',
            accountCombination: unappliedCombo, chartOfAccountsName: 'Chart of Accounts',
            reference1: adjRef, reference2: adjRef, reference3: 'RECEIVABLE',
            reference4: draft.businessUnit, reference5: 'AR_ADJUSTMENTS', createdBy: currentUser },
        ],
      };
      steps.push({ id: mkId(`adj-${adjRef}-gl`), group: `adj-${adjRef}`, label: `${adjLabel} — GL Journal Create`,
        method: 'POST', url: `${BASE}/journals/create`,
        payload: adjGlPayload, skipReason: adjSkip, status: 'pending', expanded: false });

      steps.push({ id: mkId(`adj-${adjRef}-post`), group: `adj-${adjRef}`, label: `${adjLabel} — GL Batch Post`,
        method: 'PUT', url: `${BASE}/gl/journals/<batchId>/post`,
        skipReason: adjSkip, status: 'pending', expanded: false });

      steps.push({ id: mkId(`adj-${adjRef}-sla-stamp`), group: `adj-${adjRef}`, label: `${adjLabel} — SLA Stamp`,
        method: 'POST', url: `${BASE}/sla/accounting/post`,
        payload: { headerId: '<slaHeaderId>', glBatchId: '<batchId>', glBatchName: adjBatch, glHeaderId: '<headerId>', postedBy: currentUser },
        skipReason: adjSkip, status: 'pending', expanded: false });

      steps.push({ id: mkId(`adj-${adjRef}-acct`), group: `adj-${adjRef}`, label: `${adjLabel} — Mark Accounted`,
        method: 'PUT', url: `${BASE}/ar/adjustments/${adj.adjustmentId}/accounting-status`,
        payload: { accountingStatus: 'Accounted' },
        skipReason: adjSkip, status: 'pending', expanded: false });
    }

    setAcctModal(m => m ? { ...m, debugSteps: steps, showDebug: true } : m);
  };

  // Auto-open the debug 'API Steps Preview' when requested (e.g. jumping here
  // from View Accounting because a GL journal was missing). Waits until the
  // modal has finished loading adjustments so the steps are complete.
  useEffect(() => {
    if (autoDebugPending && acctModal && !acctModal.adjLoading && !acctModal.debugSteps) {
      setAutoDebugPending(false);
      buildDebugSteps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDebugPending, acctModal?.adjLoading, acctModal?.debugSteps]);

  // Run a single debug step on demand (the "Run" button in API Steps Preview).
  // Resolves <timestamp>/<slaHeaderId>/<batchId>/<glHeaderId> placeholders from
  // the responses of already-run steps in the SAME group, then fires the call.
  const [runningStepIdx, setRunningStepIdx] = useState<number | null>(null);
  const runDebugStep = async (si: number) => {
    const stepsSnap = acctModal?.debugSteps;
    if (!stepsSnap) return;
    const step = stepsSnap[si];
    if (!step) return;

    // Gather ids produced by earlier steps in this group
    const ts = Date.now().toString().slice(-6);
    let slaHeaderId: any, glBatchId: any, glHeaderId: any;
    for (let i = 0; i < si; i++) {
      const s = stepsSnap[i];
      if (s.group !== step.group || s.responseData == null) continue;
      const rd: any = s.responseData;
      if (s.label.includes('SLA Accounting'))
        slaHeaderId = rd.headerId ?? rd.header_id ?? rd.slaHeaderId ?? rd.sla_header_id ?? slaHeaderId;
      if (s.label.includes('GL Journal Create')) {
        glBatchId  = rd.jeBatchId  ?? rd.je_batch_id  ?? rd.batchId  ?? rd.batch_id  ?? glBatchId;
        glHeaderId = rd.jeHeaderId ?? rd.je_header_id ?? rd.headerId ?? rd.header_id ?? glHeaderId;
      }
    }
    const tok: Record<string, any> = {
      '<timestamp>':   ts,
      '<batchId>':     glBatchId,
      '<glBatchId>':   glBatchId,
      '<glHeaderId>':  glHeaderId,
      '<headerId>':    glHeaderId,
      '<slaHeaderId>': slaHeaderId,
    };
    // URL substitution (leave token in place if unresolved)
    let url = step.url;
    for (const [k, v] of Object.entries(tok)) if (v != null) url = url.split(k).join(String(v));

    // Body substitution: replace "<token>" with a number when numeric, else string
    let bodyStr: string | undefined;
    if (step.payload !== undefined) {
      let ps = JSON.stringify(step.payload);
      for (const [k, v] of Object.entries(tok)) {
        if (v == null) continue;
        const val = String(v);
        ps = ps.split(`"${k}"`).join(/^\d+$/.test(val) ? val : `"${val}"`);
        ps = ps.split(k).join(val);
      }
      bodyStr = ps;
    }

    setRunningStepIdx(si);
    setAcctModal(m => !m ? m : { ...m, debugSteps: m.debugSteps!.map((s, i) =>
      i === si ? { ...s, status: 'running', expanded: true, url } : s) });
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      // GL Batch Post (and any step without a payload) must NOT send a body —
      // an empty JSON body makes the ORDS post handler fail.
      if (bodyStr !== undefined) headers['Content-Type'] = 'application/json';
      const res  = await fetch(url, { method: step.method, headers, ...(bodyStr !== undefined ? { body: bodyStr } : {}) });
      const data = await res.json().catch(() => ({}));
      setAcctModal(m => !m ? m : { ...m, debugSteps: m.debugSteps!.map((s, i) =>
        i === si ? { ...s, status: res.ok ? 'done' : 'error', detail: `HTTP ${res.status}`, responseData: data, url } : s) });
      if (res.ok) message.success(`${step.label}: HTTP ${res.status}`);
      else message.error(`${step.label}: HTTP ${res.status}`);
    } catch (e: any) {
      setAcctModal(m => !m ? m : { ...m, debugSteps: m.debugSteps!.map((s, i) =>
        i === si ? { ...s, status: 'error', detail: e.message, responseData: { error: e.message }, url } : s) });
      message.error(`${step.label}: ${e.message}`);
    } finally {
      setRunningStepIdx(null);
    }
  };

  const handleCreateAccounting = async () => {
    if (!acctModal) return;
    const { tabKey, lines, adjItems, rcptGlExists, rcptGlPosted, rcptGlBatchId } = acctModal;
    const tab = tabs.find(t => t.key === tabKey);
    if (!tab) return;
    const { draft } = tab;

    const upd = (patch: Partial<typeof acctModal>) =>
      setAcctModal(m => m ? { ...m, ...patch } : m);
    const updStep = (label: string, status: AcctStep['status'], detail?: string) =>
      setAcctModal(m => m ? { ...m, steps: setStep(m.steps, label, status, detail) } : m);
    // Also update matching debugStep by label
    const updDebug = (label: string, status: DebugStep['status'], detail?: string, url?: string, responseData?: any) =>
      setAcctModal(m => !m ? m : { ...m, debugSteps: m.debugSteps
        ? m.debugSteps.map(s => s.label === label ? { ...s, status, detail, ...(url ? { url } : {}), ...(responseData !== undefined ? { responseData } : {}) } : s)
        : m.debugSteps });

    upd({ creating: true, steps: [], showDebug: true });
    try {
      const ledger = await fetchLedgerByBusinessUnit(draft.businessUnit);
      if (!ledger) throw new Error('Could not resolve ledger for Business Unit: ' + draft.businessUnit);
      const exRate  = draft.conversionRate ?? 1;
      const period  = derivePeriodName(new Date(draft.receiptDate || today()));
      const amount  = Math.abs(draft.amount ?? 0);
      const rcptRef = draft.receiptNumber;
      const rcptId  = String(draft.standardReceiptId);

      let finalSlaHeaderId = acctModal.slaHeaderId;
      let finalGlBatchId   = acctModal.glBatchId;

      // ─── RECEIPT ────────────────────────────────────────────────────────────
      if (rcptGlPosted) {
        updStep('Receipt GL Journal', 'skipped', `Already posted — Batch #${rcptGlBatchId}`);
      } else {
        // Step 1: SLA accounting
        updStep('Receipt — SLA Accounting', 'running');
        const slaPayload: SlaCreatePayload = {
          header: {
            moduleName: 'AR', sourceTable: 'AR_RECEIPTS',
            sourceId:     draft.standardReceiptId,
            sourceNumber: draft.receiptNumber,
            sourceType:   'Receipt',
            eventTypeCode: draft.receiptType === 'MISC' ? 'AR_MISC_RECEIPT' : 'AR_CASH_RECEIPT',
            eventDate:        draft.receiptDate || today(),
            accountingDate:   draft.accountingDate || draft.receiptDate || today(),
            periodName:       period,
            ledgerId:         ledger.ledgerId,
            ledgerName:       ledger.ledgerName,
            currencyCode:     draft.currency || 'AED',
            ledgerCurrency:   'AED',
            exchangeRate:     exRate,
            exchangeRateType: draft.conversionRateType || 'Corporate',
            businessUnit:     draft.businessUnit,
            description:      `Receipt ${draft.receiptNumber}`,
            createdBy:        currentUser,
          },
          lines: lines.map((l, i) => ({
            lineNumber:       i + 1,
            lineType:         l.lineType as 'DR' | 'CR',
            accountingClass:  l.accountingClass,
            accountCombination: l.accountCombination,
            enteredDr:        l.lineType === 'DR' ? l.enteredDr : 0,
            enteredCr:        l.lineType === 'CR' ? l.enteredCr : 0,
            accountedDr:      l.lineType === 'DR' ? l.enteredDr * exRate : 0,
            accountedCr:      l.lineType === 'CR' ? l.enteredCr * exRate : 0,
            currencyCode:     draft.currency || 'AED',
            exchangeRate:     exRate,
            description:      draft.comments || l.description,
          })),
        };
        const slaResult = await createAccounting(slaPayload);
        finalSlaHeaderId = slaResult.headerId;
        upd({ slaHeaderId: finalSlaHeaderId, slaStatus: slaResult.status });
        updStep('Receipt — SLA Accounting', 'done', `SLA Header #${finalSlaHeaderId}`);
        updDebug('Receipt — SLA Accounting', 'done', `SLA Header #${finalSlaHeaderId}`, undefined, slaResult);

        // Step 2: Create GL journal
        updStep('Receipt — GL Journal', 'running');
        const batchName = `AR-RECEIPT-${rcptRef}-${Date.now().toString().slice(-6)}`;
        const glPayload = {
          batch: {
            batchName, batchDescription: `AR Receipt ${rcptRef}`,
            ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
            accountingPeriod: period, controlTotal: amount,
            runningTotalDr: amount, runningTotalCr: amount,
            batchSource: 'Accounts Receivable', createdBy: currentUser,
          },
          header: {
            ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
            jeCategory: 'Receipts', jeSource: 'Receivables', periodName: period,
            journalName: `AR-${rcptRef}`,
            description: `Receipt ${rcptRef} — ${draft.customerName || ''}`,
            currencyCode: draft.currency || 'AED',
            currencyConversionType: draft.conversionRateType || 'Corporate',
            currencyConversionDate: draft.receiptDate || today(),
            currencyConversionRate: exRate,
            defaultEffectiveDate: draft.receiptDate || today(),
            status: 'NEW', runningTotalDr: amount, runningTotalCr: amount, createdBy: currentUser,
          },
          lines: lines.map(l => ({
            enteredDr:  l.lineType === 'DR' ? l.enteredDr : null,
            enteredCr:  l.lineType === 'CR' ? l.enteredCr : null,
            accountedDr: l.lineType === 'DR' ? l.enteredDr * exRate : null,
            accountedCr: l.lineType === 'CR' ? l.enteredCr * exRate : null,
            statAmount: null,
            description: draft.comments || l.description,
            currencyCode: draft.currency || 'AED',
            currencyConversionDate: draft.receiptDate || today(),
            currencyConversionRate: exRate,
            userCurrencyConversionType: draft.conversionRateType || 'Corporate',
            accountCombination: l.accountCombination,
            chartOfAccountsName: 'Chart of Accounts',
            reference1: rcptRef,
            reference2: rcptId,
            reference3: l.accountingClass,
            reference4: draft.businessUnit,
            reference5: 'AR_RECEIPTS',
            createdBy: currentUser,
          })),
        };
        const glRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/create`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(glPayload),
        });
        const glBody = await glRes.json();
        if (!glRes.ok) throw new Error(glBody?.message || `GL HTTP ${glRes.status}`);
        finalGlBatchId  = glBody?.jeBatchId  ?? glBody?.je_batch_id  ?? glBody?.batchId  ?? glBody?.batch_id  ?? 0;
        const glHeaderId = glBody?.jeHeaderId ?? glBody?.je_header_id ?? glBody?.headerId ?? glBody?.header_id ?? 0;
        updStep('Receipt — GL Journal', 'done', `Batch #${finalGlBatchId}`);
        updDebug('Receipt — GL Journal Create', 'done', `Batch #${finalGlBatchId}`, undefined, glBody);

        // Step 3: Post GL batch
        updStep('Receipt — GL Batch Post', 'running');
        updDebug('Receipt — GL Batch Post', 'running', undefined, `${APEX_DB_CONFIG.baseUrl}/gl/journals/${finalGlBatchId}/post`);
        const postResult = await postJournal(finalGlBatchId);
        if (!postResult.success) {
          updStep('Receipt — GL Batch Post', 'error', postResult.error || postResult.message);
          updDebug('Receipt — GL Batch Post', 'error', postResult.error || postResult.message, undefined, postResult);
          message.warning(`Receipt journal posting failed: ${postResult.error || postResult.message}`);
        } else {
          updStep('Receipt — GL Batch Post', 'done');
          updDebug('Receipt — GL Batch Post', 'done', `Batch #${finalGlBatchId} posted`, undefined, postResult);
        }

        // Step 4: Stamp SLA
        updStep('Receipt — SLA Stamp', 'running');
        const slaStampPayload = { headerId: finalSlaHeaderId, glBatchId: finalGlBatchId, glBatchName: batchName, glHeaderId, postedBy: currentUser };
        updDebug('Receipt — SLA Stamp', 'running', undefined, undefined, slaStampPayload);
        const slaStampRes = await postToLedger(finalSlaHeaderId!, finalGlBatchId, batchName, glHeaderId, currentUser);
        updStep('Receipt — SLA Stamp', 'done');
        updDebug('Receipt — SLA Stamp', 'done', undefined, undefined, slaStampRes);

        // Step 5: Update receipt accounting status
        updStep('Receipt — Mark Accounted', 'running');
        try {
          const acctRes = await fetch(`${APEX_AR_RECEIPTS}/${draft.standardReceiptId}/accounting-status`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({}),
          });
          const acctBody = await acctRes.json().catch(() => ({}));
          updStep('Receipt — Mark Accounted', 'done');
          updDebug('Receipt — Mark Accounted', 'done', undefined, undefined, acctBody);
        } catch (e: any) {
          updStep('Receipt — Mark Accounted', 'error', 'Non-critical');
          updDebug('Receipt — Mark Accounted', 'error', e.message);
        }

        upd({ glBatchId: finalGlBatchId, slaStatus: 'POSTED' });
      }

      // ─── ADJUSTMENTS (one journal per adjustment_id) ─────────────────────
      for (const adj of adjItems) {
        const adjLabel = `Adj #${adj.adjustmentId} (${adj.transactionNumber || adj.activity})`;

        if (adj.glPosted) {
          setAcctModal(m => m ? { ...m,
            adjItems: m.adjItems.map(a => a.adjustmentId === adj.adjustmentId
              ? { ...a, postStatus: 'skipped', postDetail: `Already posted — Batch #${adj.glBatchId}` } : a),
            steps: setStep(m.steps, adjLabel, 'skipped', `Already posted`),
          } : m);
          continue;
        }

        setAcctModal(m => m ? { ...m,
          adjItems: m.adjItems.map(a => a.adjustmentId === adj.adjustmentId ? { ...a, postStatus: 'running' } : a),
          steps: setStep(m.steps, adjLabel, 'running'),
        } : m);

        try {
          const adjRef    = String(adj.adjustmentId);
          const adjBatch  = `AR-ADJ-${adjRef}-${Date.now().toString().slice(-6)}`;
          const adjLines2 = [
            { lineType: 'DR', accountingClass: 'ADJUSTMENT', accountCombination: adj.accountCombination,
              enteredDr: adj.amount, enteredCr: 0, description: `${adj.transactionNumber} — ${adj.activity}` },
            { lineType: 'CR', accountingClass: 'RECEIVABLE',
              accountCombination: acctModal.lines.find(l => l.accountingClass === 'RECEIVABLE' || l.accountingClass === 'UNAPPLIED')?.accountCombination || '',
              enteredDr: 0, enteredCr: adj.amount, description: `${adj.transactionNumber} — AR Receivable` },
          ];

          // SLA for adjustment
          const adjSlaPayload: SlaCreatePayload = {
            header: {
              moduleName: 'AR', sourceTable: 'AR_ADJUSTMENTS',
              sourceId: adj.adjustmentId, sourceNumber: adjRef,
              sourceType: 'Adjustment',
              eventTypeCode: 'AR_ADJUSTMENT',
              eventDate: draft.receiptDate || today(),
              accountingDate: draft.accountingDate || draft.receiptDate || today(),
              periodName: period, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
              currencyCode: draft.currency || 'AED', ledgerCurrency: 'AED',
              exchangeRate: exRate, exchangeRateType: draft.conversionRateType || 'Corporate',
              businessUnit: draft.businessUnit, description: `Adjustment ${adjRef}`,
              createdBy: currentUser,
            },
            lines: adjLines2.map((l, i) => ({
              lineNumber: i + 1,
              lineType: l.lineType as 'DR' | 'CR',
              accountingClass: l.accountingClass,
              accountCombination: l.accountCombination,
              enteredDr: l.lineType === 'DR' ? l.enteredDr : 0,
              enteredCr: l.lineType === 'CR' ? l.enteredCr : 0,
              accountedDr: l.lineType === 'DR' ? l.enteredDr * exRate : 0,
              accountedCr: l.lineType === 'CR' ? l.enteredCr * exRate : 0,
              currencyCode: draft.currency || 'AED', exchangeRate: exRate,
              description: l.description,
            })),
          };
          const adjSlaResult = await createAccounting(adjSlaPayload);
          const adjSlaHeaderId = adjSlaResult.headerId;
          updDebug(`Adj #${adj.adjustmentId} — SLA Accounting`, 'done', `SLA Header #${adjSlaHeaderId}`, undefined, adjSlaResult);

          // Create GL journal
          const adjGlPayload = {
            batch: {
              batchName: adjBatch, batchDescription: `AR Adjustment ${adjRef}`,
              ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW',
              accountingPeriod: period, controlTotal: adj.amount,
              runningTotalDr: adj.amount, runningTotalCr: adj.amount,
              batchSource: 'Accounts Receivable', createdBy: currentUser,
            },
            header: {
              ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
              jeCategory: 'Adjustments', jeSource: 'Receivables', periodName: period,
              journalName: `AR-ADJ-${adjRef}`,
              description: `Adjustment ${adjRef} — ${adj.activity}`,
              currencyCode: draft.currency || 'AED',
              currencyConversionType: draft.conversionRateType || 'Corporate',
              currencyConversionDate: draft.receiptDate || today(),
              currencyConversionRate: exRate,
              defaultEffectiveDate: draft.receiptDate || today(),
              status: 'NEW', runningTotalDr: adj.amount, runningTotalCr: adj.amount, createdBy: currentUser,
            },
            lines: adjLines2.map(l => ({
              enteredDr:  l.lineType === 'DR' ? l.enteredDr : null,
              enteredCr:  l.lineType === 'CR' ? l.enteredCr : null,
              accountedDr: l.lineType === 'DR' ? l.enteredDr * exRate : null,
              accountedCr: l.lineType === 'CR' ? l.enteredCr * exRate : null,
              statAmount: null,
              description: l.description,
              currencyCode: draft.currency || 'AED',
              currencyConversionDate: draft.receiptDate || today(),
              currencyConversionRate: exRate,
              userCurrencyConversionType: draft.conversionRateType || 'Corporate',
              accountCombination: l.accountCombination,
              chartOfAccountsName: 'Chart of Accounts',
              reference1: adjRef,
              reference2: adjRef,
              reference3: l.accountingClass,
              reference4: draft.businessUnit,
              reference5: 'AR_ADJUSTMENTS',
              createdBy: currentUser,
            })),
          };
          const adjGlRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(adjGlPayload),
          });
          const adjGlBody = await adjGlRes.json();
          if (!adjGlRes.ok) throw new Error(adjGlBody?.message || `GL HTTP ${adjGlRes.status}`);
          const adjBatchId  = adjGlBody?.jeBatchId  ?? adjGlBody?.je_batch_id  ?? adjGlBody?.batchId  ?? adjGlBody?.batch_id  ?? 0;
          const adjHeaderId = adjGlBody?.jeHeaderId ?? adjGlBody?.je_header_id ?? adjGlBody?.headerId ?? adjGlBody?.header_id ?? 0;
          updDebug(`Adj #${adj.adjustmentId} — GL Journal Create`, 'done', `Batch #${adjBatchId}`,
            `${APEX_DB_CONFIG.baseUrl}/journals/create`, adjGlBody);

          // Post GL batch
          updDebug(`Adj #${adj.adjustmentId} — GL Batch Post`, 'running', undefined,
            `${APEX_DB_CONFIG.baseUrl}/gl/journals/${adjBatchId}/post`);
          const adjPostResult = await postJournal(adjBatchId);
          updDebug(`Adj #${adj.adjustmentId} — GL Batch Post`,
            adjPostResult.success ? 'done' : 'error',
            adjPostResult.success ? `Batch #${adjBatchId} posted` : (adjPostResult.error || adjPostResult.message),
            undefined, adjPostResult);

          // Stamp SLA
          updDebug(`Adj #${adj.adjustmentId} — SLA Stamp`, 'running');
          const adjStampRes = await postToLedger(adjSlaHeaderId, adjBatchId, adjBatch, adjHeaderId, currentUser);
          updDebug(`Adj #${adj.adjustmentId} — SLA Stamp`, 'done', undefined, undefined, adjStampRes);

          // Update adjustment accounting status
          const adjAcctUrl = `${APEX_DB_CONFIG.baseUrl}/ar/adjustments/${adj.adjustmentId}/accounting-status`;
          updDebug(`Adj #${adj.adjustmentId} — Mark Accounted`, 'running', undefined, adjAcctUrl);
          try {
            const adjAcctRes = await fetch(adjAcctUrl, {
              method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ accountingStatus: 'Accounted' }),
            });
            const adjAcctBody = await adjAcctRes.json().catch(() => ({}));
            updDebug(`Adj #${adj.adjustmentId} — Mark Accounted`, 'done', undefined, undefined, adjAcctBody);
          } catch (e: any) {
            updDebug(`Adj #${adj.adjustmentId} — Mark Accounted`, 'error', e.message);
          }

          setAcctModal(m => m ? { ...m,
            adjItems: m.adjItems.map(a => a.adjustmentId === adj.adjustmentId
              ? { ...a, postStatus: 'done', postDetail: `Batch #${adjBatchId}` } : a),
            steps: setStep(m.steps, adjLabel, 'done', `Batch #${adjBatchId}`),
          } : m);
        } catch (adjErr: any) {
          updDebug(`Adj #${adj.adjustmentId} — SLA Accounting`, 'error', adjErr.message);
          setAcctModal(m => m ? { ...m,
            adjItems: m.adjItems.map(a => a.adjustmentId === adj.adjustmentId
              ? { ...a, postStatus: 'error', postDetail: adjErr.message } : a),
            steps: setStep(m.steps, adjLabel, 'error', adjErr.message),
          } : m);
          message.warning(`Adjustment #${adj.adjustmentId} failed: ${adjErr.message}`);
        }
      }

      setTabs(prev => prev.map(t => t.key === tabKey
        ? { ...t, slaHeaderId: finalSlaHeaderId, slaPosted: true, draft: { ...t.draft, accountingStatus: 'Accounted' } }
        : t));
      upd({ creating: false, glBatchId: finalGlBatchId, slaStatus: 'POSTED' });
      message.success('Accounting created and posted');
    } catch (e: any) {
      upd({ creating: false });
      message.error('Create Accounting failed: ' + (e?.message || String(e)));
    }
  };


  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (tabKey: string): Promise<boolean> => {
    const tab = tabs.find(t => t.key === tabKey);
    if (!tab) return false;
    const { draft } = tab;
    const pending = pendingApplications[tabKey] ?? [];
    const today = dayjs().format('YYYY-MM-DD');

    // ── Step 1: Mandatory fields ───────────────────────────────────────────────
    const missing: string[] = [];
    if (!draft.businessUnit)                missing.push('Business Unit');
    if (!draft.receiptType)                 missing.push('Receipt Type');
    if (!draft.receiptMethod)               missing.push('Receipt Method');
    if (!draft.receiptDate)                 missing.push('Receipt Date');
    if (!draft.currency)                    missing.push('Currency');
    if (!draft.amount || draft.amount <= 0) missing.push('Amount (must be > 0)');
    if (!draft.customerAccountNumber && !draft.customerName) missing.push('Customer');
    if (!draft.comments)                    missing.push('Comments');
    if (!draft.drAccount)                   missing.push('Dr. Account');
    if (!draft.crAccount)                   missing.push('Cr. Account');

    if (missing.length > 0) {
      message.warning({ content: `Missing required fields: ${missing.join(' · ')}`, duration: 5 });
      return false;
    }

    // ── Step 2a: Split validation — any adj row must have balanced splits ─────
    const unsplitRows = pending.filter(r => {
      if (!r.adjustmentAmount || r.adjustmentAmount === 0) return false;
      if (!r.adjSplits || r.adjSplits.length === 0) return true;
      const splitTotal = r.adjSplits.reduce((s, sp) => s + (sp.amount || 0), 0);
      return Math.abs(splitTotal - Math.abs(r.adjustmentAmount)) > 0.01;
    });
    if (unsplitRows.length > 0) {
      const names = unsplitRows.map(r => `${r.transactionNumber}/#${r.sequenceNumber}`).join(', ');
      message.warning({ content: `Adjustment split required for: ${names}. Open the split dialog (✂) and allocate the full amount before saving.`, duration: 8 });
      return false;
    }

    // ── Step 2b: Amount balance check ─────────────────────────────────────────
    const savedApps = receiptApplications[tabKey]?.rows ?? [];
    const totalPendingApply = pending.reduce((s, r) => s + r.applyAmount, 0);
    const totalSavedApply   = savedApps.reduce((s, r) => s + r.applicationAmount, 0);
    const totalApplied      = totalPendingApply + totalSavedApply;
    const receiptAmt        = draft.amount ?? 0;

    if (pending.length > 0 && Math.abs(totalApplied - receiptAmt) > 0.01) {
      message.warning({
        content: `Receipt amount ${receiptAmt.toLocaleString('en-AE', { minimumFractionDigits: 2 })} ≠ total applied ${totalApplied.toLocaleString('en-AE', { minimumFractionDigits: 2 })}. Apply amounts must equal the receipt amount (adjustments are separate).`,
        duration: 8,
      });
      return false;
    }

    // ── Step 3: Verify live installment balances ───────────────────────────────
    if (pending.length > 0) {
      setSaveProgress({
        open: true, current: 0, done: false,
        steps: [
          { title: 'Checking installment balances', status: 'process', detail: '' },
          { title: 'POST Receipt',                  status: 'wait',    detail: '' },
          { title: 'POST Receipt Applications',     status: 'wait',    detail: '' },
          { title: 'POST Adjustments',              status: 'wait',    detail: '' },
          { title: 'PUT Installments',              status: 'wait',    detail: '' },
        ],
      });

      const closedKeys: string[] = [];
      for (const row of pending) {
        try {
          const res  = await fetch(`${APEX_AR_INVOICES}/${row.customerTransactionId}/installments/${row.installmentId}`, { headers: { Accept: 'application/json' } });
          const inst = await res.json();
          if (!res.ok || !inst) {
            setSaveProgress(p => p ? { ...p, done: true, steps: p.steps.map((s, i) => i === 0 ? { ...s, status: 'error', detail: `Installment ${row.transactionNumber}/#${row.sequenceNumber} not found` } : s) } : p);
            return false;
          }
          const calcStatus = inst.installmentStatus ?? inst.calculatedBalance !== undefined
            ? ((inst.calculatedBalance ?? 1) <= 0 ? 'Closed' : 'Open')
            : null;
          const isClosed = calcStatus === 'Closed' || (inst.calculatedBalance ?? 1) <= 0;
          if (isClosed) {
            closedKeys.push(row.key);
          } else if (row.applyAmount > (inst.calculatedBalance ?? inst.storedBalanceDue ?? 0) + 0.01) {
            setSaveProgress(p => p ? { ...p, done: true, steps: p.steps.map((s, i) => i === 0 ? { ...s, status: 'error', detail: `Apply amount ${row.applyAmount} exceeds live balance for ${row.transactionNumber}/#${row.sequenceNumber}` } : s) } : p);
            message.error(`Apply amount exceeds balance for ${row.transactionNumber}/#${row.sequenceNumber}`);
            return false;
          }
        } catch {
          // non-fatal — proceed if balance check fails (network error)
        }
      }

      // If any installments are already closed — remove them from pending, show error, stop save
      if (closedKeys.length > 0) {
        setPendingApplications(prev => ({
          ...prev,
          [tabKey]: (prev[tabKey] ?? []).map(r => closedKeys.includes(r.key) ? { ...r, _closed: true } as any : r),
        }));
        const closedNames = pending.filter(r => closedKeys.includes(r.key)).map(r => `${r.transactionNumber}/#${r.sequenceNumber}`).join(', ');
        setSaveProgress(p => p ? { ...p, done: true, steps: p.steps.map((s, i) => i === 0 ? { ...s, status: 'error', detail: `Closed installments detected — remove them and retry: ${closedNames}` } : s) } : p);
        message.error({ content: `These installments are already Closed: ${closedNames}. They have been flagged — please remove them.`, duration: 8 });
        return false;
      }

      setSaveProgress(p => p ? { ...p, current: 1, steps: p.steps.map((s, i) => i === 0 ? { ...s, status: 'finish', detail: 'All installments verified' } : i === 1 ? { ...s, status: 'process' } : s) } : p);
    }

    // ── Step 4: POST / PUT Receipt ─────────────────────────────────────────────
    setSaving(prev => ({ ...prev, [tabKey]: true }));
    const isNew = draft.standardReceiptId === 0;
    let newReceiptId = draft.standardReceiptId;

    try {
      const body = buildPayload(draft, isNew ? null : draft.standardReceiptId);
      const url    = isNew ? APEX_AR_RECEIPTS : `${APEX_AR_RECEIPTS}/${draft.standardReceiptId}`;
      const method = isNew ? 'POST' : 'PUT';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || (result?.errors ?? 0) > 0) {
        setSaveProgress(p => p ? { ...p, done: true, steps: p.steps.map((s, i) => i === 1 ? { ...s, status: 'error', detail: result?.message || `HTTP ${res.status}` } : s) } : p);
        message.error(result?.message || `Save failed (HTTP ${res.status})`);
        return false;
      }
      if (isNew && result?.receiptId) {
        newReceiptId = result.receiptId;
        updateDraft(tabKey, { standardReceiptId: result.receiptId });
      }
      setSaveProgress(p => p ? { ...p, current: 2, steps: p.steps.map((s, i) => i === 1 ? { ...s, status: 'finish', detail: `Receipt ID: ${newReceiptId}` } : i === 2 ? { ...s, status: 'process' } : s) } : p);
    } catch (e: any) {
      setSaveProgress(p => p ? { ...p, done: true, steps: p.steps.map((s, i) => i === 1 ? { ...s, status: 'error', detail: e.message } : s) } : p);
      message.error(`Save error: ${e.message}`);
      return false;
    }

    // ── Step 5: POST Receipt Applications ─────────────────────────────────────
    let appErrors: string[] = [];
    const postedAppIds: number[] = [];
    // Map row key → returned application_id so adjustments can link back
    const rowAppIdMap: Record<string, number> = {};
    for (const row of pending) {
      try {
        const appBody = {
          StandardReceiptId:          newReceiptId,
          ApplicationDate:            draft.receiptDate || today,
          AccountingDate:             draft.accountingDate || today,
          ApplicationAmount:          row.applyAmount,
          AdjustmentAmount:           row.adjustmentAmount || undefined,
          ApplicationStatus:          'APP',
          ReferenceTransactionId:     row.customerTransactionId,
          ReferenceTransactionNumber: row.transactionNumber,
          ReferenceInstallmentId:     row.installmentId,
          ActivityName:               'Invoice',
          ProcessStatus:              'PENDING',
          IsLatestApplication:        'Y',
          CustomerSite:               draft.customerSite || '',
          CreatedBy:                  currentUser,
          LastUpdatedBy:              currentUser,
        };
        const res = await fetch(APEX_RECEIPT_APPS, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(appBody) });
        const result = await res.json().catch(() => ({}));
        if (res.ok) {
          const appId = result?.applicationId ?? result?.application_id ?? result?.ApplicationId ?? 0;
          postedAppIds.push(appId);
          if (appId) rowAppIdMap[row.key] = appId;
        } else {
          appErrors.push(`${row.transactionNumber}/#${row.sequenceNumber}: HTTP ${res.status}`);
        }
      } catch (e: any) { appErrors.push(`${row.transactionNumber}: ${e.message}`); }
    }

    setSaveProgress(p => p ? { ...p, current: 3, steps: p.steps.map((s, i) =>
      i === 2 ? { ...s, status: appErrors.length > 0 ? 'error' : 'finish', detail: appErrors.length > 0 ? appErrors.join('; ') : `${pending.length} application(s) posted` }
      : i === 3 ? { ...s, status: 'process' } : s
    ) } : p);

    // ── Step 6: POST Adjustments ───────────────────────────────────────────────
    let adjErrors: string[] = [];
    for (const row of pending) {
      if (row.adjustmentAmount === 0) continue;
      // Use splits if defined, otherwise single adjustment
      const splitsToPost: { amount: number; activityName: string; accountCombination: string; reason: string }[] =
        row.adjSplits && row.adjSplits.length > 0
          ? row.adjSplits.map(sp => ({ amount: sp.amount, activityName: sp.activityName || 'Adjustment', accountCombination: sp.accountCombination, reason: sp.reason || row.adjustmentReason || 'Receipt adjustment' }))
          : [{ amount: row.adjustmentAmount, activityName: 'Adjustment', accountCombination: '', reason: row.adjustmentReason || 'Receipt adjustment' }];
      for (const sp of splitsToPost) {
        try {
          const adjBody = {
            CustomerTransactionId: row.customerTransactionId,
            TransactionNumber:     row.transactionNumber,
            AdjustmentAmount:      -Math.abs(sp.amount),
            AdjustmentDate:        draft.receiptDate || today,
            AccountingDate:        draft.accountingDate || today,
            AdjustmentType:        'LINE',
            Status:                'Approved',
            ReceivablesActivity:   sp.activityName,
            AccountCombination:    sp.accountCombination || undefined,
            BusinessUnit:          draft.businessUnit || '',
            Currency:              row.currency,
            InstallmentNumber:     row.sequenceNumber,
            InstallmentId:         row.installmentId,
            InstallmentBalance:    Math.max(0, row.balanceDue - row.applyAmount - row.adjustmentAmount),
            AdjustmentReason:      sp.reason,
            ApplicationId:         rowAppIdMap[row.key] || undefined,
            Comments:              `Auto-created from receipt ${draft.receiptNumber || ''}`,
            CreatedBy:             currentUser,
            LastUpdatedBy:         currentUser,
          };
          const res  = await fetch(`${APEX_DB_CONFIG.baseUrl}/ar/adjustments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(adjBody) });
          const text = await res.text();
          let ok = res.ok;
          try { const j = JSON.parse(text); if (j && (j.success === false || j.error || (Array.isArray(j.errors) && j.errors.length))) ok = false; } catch { /* non-json ok */ }
          if (!ok) adjErrors.push(`${row.transactionNumber}/#${row.sequenceNumber} (${sp.activityName}): HTTP ${res.status} — ${text.slice(0, 200)}`);
        } catch (e: any) { adjErrors.push(`${row.transactionNumber}: ${e.message}`); }
      }
    }

    setSaveProgress(p => p ? { ...p, current: 4, steps: p.steps.map((s, i) =>
      i === 3 ? { ...s, status: adjErrors.length > 0 ? 'error' : 'finish', detail: adjErrors.length > 0 ? adjErrors.join('; ') : `Adjustments done` }
      : i === 4 ? { ...s, status: 'process' } : s
    ) } : p);

    // ── Step 7: PUT Installments — update AMOUNT_PAID and INSTALLMENT_AMOUNT_ADJUSTED ────
    let instErrors: string[] = [];
    for (const row of pending) {
      if (!row.installmentId || !row.customerTransactionId) continue;
      try {
        const putBody = {
          AmountPaid:                   row.applyAmount,
          // Match the Save & Debug flow — the adjusted amount is written as negative.
          InstallmentAmountAdjusted:    -Math.abs(row.adjustmentAmount ?? 0),
          LastUpdatedBy:                currentUser,
        };
        const url = `${APEX_AR_INVOICES}/${row.customerTransactionId}/installments/${row.installmentId}`;
        const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(putBody) });
        if (!res.ok) instErrors.push(`${row.transactionNumber}/#${row.sequenceNumber}: HTTP ${res.status}`);
      } catch (e: any) { instErrors.push(`${row.transactionNumber}/#${row.sequenceNumber}: ${e.message}`); }
    }

    setSaveProgress(p => p ? { ...p, done: true, steps: p.steps.map((s, i) =>
      i === 4 ? { ...s, status: instErrors.length > 0 ? 'error' : 'finish', detail: instErrors.length > 0 ? instErrors.join('; ') : 'Installments updated' } : s
    ) } : p);

    // ── Cleanup ────────────────────────────────────────────────────────────────
    setPendingApplications(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setEditingEnabled(prev => ({ ...prev, [tabKey]: false }));
    fetchedAppsRef.current.delete(tabKey);
    fetchApplications(tabKey, newReceiptId);

    const allErrors = [...appErrors, ...adjErrors, ...instErrors];
    if (allErrors.length === 0) {
      message.success(isNew ? `Receipt created (ID: ${newReceiptId})` : 'Receipt updated & applications saved');
    } else {
      message.warning(`Saved with some errors: ${allErrors.join(' | ')}`);
    }
    setSaving(prev => ({ ...prev, [tabKey]: false }));
    return true;
  };

  // ── Delete an unaccounted receipt (reverses applications/installments/adjustments) ──
  const handleDeleteReceipt = (tabKey: string, draft: ReceiptDraft) => {
    if (!draft.standardReceiptId) { message.warning('Receipt is not saved yet.'); return; }
    if ((draft.accountingStatus || '').toLowerCase() === 'accounted') {
      message.warning('Accounted receipts cannot be deleted.'); return;
    }
    Modal.confirm({
      title: 'Delete Receipt',
      icon: <ExclamationCircleOutlined style={{ color: REDWOOD.primary }} />,
      width: 480,
      okText: 'Delete', okType: 'danger', cancelText: 'Cancel',
      content: (
        <div style={{ fontSize: 13 }}>
          <p style={{ margin: '8px 0' }}>Delete receipt <strong>{draft.receiptNumber}</strong> (ID {draft.standardReceiptId})?</p>
          <p style={{ color: REDWOOD.warning, fontSize: 12, margin: 0 }}>
            This reverses its receipt applications (restores each installment) and deletes its
            adjustments. This cannot be undone.
          </p>
          <div style={{ marginTop: 8, padding: '6px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}>
            <Text type="secondary" style={{ fontSize: 10 }}>API — no request body</Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Tag color="green" style={{ fontSize: 10, margin: 0 }}>POST</Tag>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{`${APEX_AR_RECEIPTS}/${draft.standardReceiptId}/delete`}</code>
            </div>
          </div>
        </div>
      ),
      onOk: async () => {
        try {
          const res  = await fetch(`${APEX_AR_RECEIPTS}/${draft.standardReceiptId}/delete`, { method: 'POST', headers: { Accept: 'application/json' } });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success === false) {
            message.error(`Delete failed: ${data.error || `HTTP ${res.status}`}`);
            return;
          }
          message.success(`Receipt ${draft.receiptNumber} deleted — ${data.applicationsDeleted ?? 0} application(s), ${data.adjustmentsDeleted ?? 0} adjustment(s), ${data.installmentsRestored ?? 0} installment(s) restored`);
          closeTab(tabKey);
        } catch (e: any) {
          message.error(`Delete failed: ${e.message}`);
        }
      },
    });
  };

  // ── Debug Modal ────────────────────────────────────────────────────────────
  const openDebugModal = (tabKey: string, draft: ReceiptDraft) => {
    const pending = pendingApplications[tabKey] ?? [];
    const savedApps = receiptApplications[tabKey]?.rows ?? [];
    const today = dayjs().format('YYYY-MM-DD');
    const isNewReceipt = !draft.standardReceiptId || draft.standardReceiptId === 0;
    const rcptUrl    = isNewReceipt ? APEX_AR_RECEIPTS : `${APEX_AR_RECEIPTS}/${draft.standardReceiptId}`;
    const rcptMethod = isNewReceipt ? 'POST' : 'PUT';
    const rcptIdPlaceholder = isNewReceipt ? '{from Step 1}' : draft.standardReceiptId;

    // If receipt applications are already saved, skip GET/PUT receipt + POST applications —
    // only show the pending adjustment splits that still need to be posted.
    const appsAlreadySaved = savedApps.length > 0;

    const steps = appsAlreadySaved
      ? [
          // Only show adjustment POSTs for pending rows that have adj amounts
          ...pending.filter(r => r.adjustmentAmount !== 0).flatMap((row) => {
            const splitsToShow = row.adjSplits && row.adjSplits.length > 0
              ? row.adjSplits.map(sp => ({ amount: sp.amount, activityName: sp.activityName || 'Adjustment', accountCombination: sp.accountCombination, reason: sp.reason || row.adjustmentReason || 'Receipt adjustment' }))
              : [{ amount: row.adjustmentAmount, activityName: 'Adjustment', accountCombination: '', reason: row.adjustmentReason || 'Receipt adjustment' }];
            // Find the saved application linked to this installment to get the real applicationId
            const linkedApp = savedApps.find((a: any) => a.referenceTransactionId === row.customerTransactionId);
            const linkedAppId = linkedApp?.applicationId ?? undefined;
            return splitsToShow.map((sp, si) => ({
              label: `POST Adjustment${splitsToShow.length > 1 ? ` (${si + 1}/${splitsToShow.length})` : ''} — ${row.transactionNumber}/#${row.sequenceNumber} [${sp.activityName}]`,
              method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/ar/adjustments`,
              body: JSON.stringify({
                CustomerTransactionId: row.customerTransactionId,
                TransactionNumber:     row.transactionNumber,
                AdjustmentAmount:      -Math.abs(sp.amount),
                AdjustmentDate:        draft.receiptDate || today,
                AccountingDate:        draft.accountingDate || today,
                AdjustmentType:        'LINE',
                Status:                'Approved',
                ReceivablesActivity:   sp.activityName,
                AccountCombination:    sp.accountCombination || undefined,
                BusinessUnit:          draft.businessUnit || '',
                Currency:              row.currency,
                InstallmentNumber:     row.sequenceNumber,
                InstallmentId:         row.installmentId,
                InstallmentBalance:    Math.max(0, row.balanceDue - row.applyAmount - row.adjustmentAmount),
                AdjustmentReason:      sp.reason,
                ApplicationId:         linkedAppId,
                Comments:              `Auto-created from receipt ${draft.receiptNumber || ''}`,
                CreatedBy:             currentUser,
                LastUpdatedBy:         currentUser,
              }, null, 2),
              response: '', running: false, done: false,
            }));
          }),
        ]
      : [
          // Full flow: GET installment checks → PUT/POST receipt → POST applications → POST adjustments → PUT installments
          ...pending.map((row, i) => ({
            label: `${i + 1}. GET Installment Balance — ${row.transactionNumber}/#${row.sequenceNumber}`,
            method: 'GET',
            url: `${APEX_AR_INVOICES}/${row.customerTransactionId}/installments/${row.installmentId}`,
            body: '',
            response: '', running: false, done: false,
          })),
          {
            label: `${pending.length + 1}. ${rcptMethod} Receipt${!isNewReceipt ? ` (ID: ${draft.standardReceiptId})` : ''}`,
            method: rcptMethod, url: rcptUrl,
            body: JSON.stringify(buildPayload(draft, isNewReceipt ? null : draft.standardReceiptId), null, 2),
            response: '', running: false, done: false,
          },
          ...pending.map((row, i) => ({
            label: `${pending.length + i + 2}. POST Receipt Application — ${row.transactionNumber}/#${row.sequenceNumber}`,
            method: 'POST', url: APEX_RECEIPT_APPS,
            body: JSON.stringify({
              StandardReceiptId:          rcptIdPlaceholder,
              ApplicationDate:            draft.receiptDate || today,
              AccountingDate:             draft.accountingDate || today,
              ApplicationAmount:          row.applyAmount,
              AdjustmentAmount:           row.adjustmentAmount || undefined,
              ApplicationStatus:          'APP',
              ReferenceTransactionId:     row.customerTransactionId,
              ReferenceTransactionNumber: row.transactionNumber,
              ReferenceInstallmentId:     row.installmentId,
              ActivityName:               'Invoice',
              ProcessStatus:              'PENDING',
              IsLatestApplication:        'Y',
              CustomerSite:               draft.customerSite || '',
            }, null, 2),
            response: '', running: false, done: false,
          })),
          ...pending.filter(r => r.adjustmentAmount !== 0).flatMap((row) => {
            const splitsToShow = row.adjSplits && row.adjSplits.length > 0
              ? row.adjSplits.map(sp => ({ amount: sp.amount, activityName: sp.activityName || 'Adjustment', accountCombination: sp.accountCombination, reason: sp.reason || row.adjustmentReason || 'Receipt adjustment' }))
              : [{ amount: row.adjustmentAmount, activityName: 'Adjustment', accountCombination: '', reason: row.adjustmentReason || 'Receipt adjustment' }];
            return splitsToShow.map((sp, si) => ({
              label: `Adj. POST Adjustment${splitsToShow.length > 1 ? ` (${si + 1}/${splitsToShow.length})` : ''} — ${row.transactionNumber}/#${row.sequenceNumber} [${sp.activityName}]`,
              method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/ar/adjustments`,
              body: JSON.stringify({
                CustomerTransactionId: row.customerTransactionId,
                TransactionNumber:     row.transactionNumber,
                AdjustmentAmount:      -Math.abs(sp.amount),
                AdjustmentDate:        draft.receiptDate || today,
                AccountingDate:        draft.accountingDate || today,
                AdjustmentType:        'LINE',
                Status:                'Approved',
                ReceivablesActivity:   sp.activityName,
                AccountCombination:    sp.accountCombination || undefined,
                BusinessUnit:          draft.businessUnit || '',
                Currency:              row.currency,
                InstallmentNumber:     row.sequenceNumber,
                InstallmentId:         row.installmentId,
                InstallmentBalance:    Math.max(0, row.balanceDue - row.applyAmount - row.adjustmentAmount),
                AdjustmentReason:      sp.reason,
                ApplicationId:         '{from Application POST}',
                Comments:              `Auto-created from receipt ${draft.receiptNumber || ''}`,
                CreatedBy:             currentUser,
                LastUpdatedBy:         currentUser,
              }, null, 2),
              response: '', running: false, done: false,
            }));
          }),
          ...pending.map((row, i) => ({
            label: `PUT Installment — ${row.transactionNumber}/#${row.sequenceNumber}`,
            method: 'PUT',
            url: `${APEX_AR_INVOICES}/${row.customerTransactionId}/installments/${row.installmentId}`,
            body: JSON.stringify({
              AmountPaid:                row.applyAmount,
              InstallmentAmountAdjusted: -Math.abs(row.adjustmentAmount ?? 0),
              LastUpdatedBy:             currentUser,
            }, null, 2),
            response: '', running: false, done: false,
          })),
        ];
    setDebugModal({ open: true, tabKey, steps, capturedAppIds: [] });
  };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportToExcel = (rows: ReceiptRow[]) => {
    const headers = ['Receipt #', 'Customer', 'Cust #', 'Business Unit', 'Method',
      'Receipt Date', 'Accounting Date', 'Currency', 'Amount', 'Unapplied', 'Accounted',
      'State', 'Status', 'Remittance Bank', 'Sync'];
    const data = rows.map(r => [
      r.receiptNumber, r.customerName, r.customerAccountNumber, r.businessUnit, r.receiptMethod,
      r.receiptDate, r.accountingDate, r.currency,
      r.amount ?? 0, r.unappliedAmount ?? 0, r.accountedAmount ?? 0,
      r.state, r.status, r.remittanceBankName, r.syncStatus,
    ]);
    const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const totals = [`Total (${rows.length})`, '', '', '', '', '', '', '', total, '', '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, totals]);
    ws['!cols'] = [
      { wch: 20 }, { wch: 36 }, { wch: 12 }, { wch: 30 }, { wch: 18 },
      { wch: 14 }, { wch: 14 }, { wch: 8  }, { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 10 },
    ];
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    for (let row = 2; row <= rows.length + 2; row++) {
      ['I', 'J', 'K'].forEach(col => {
        const cell = ws[`${col}${row}`];
        if (cell && typeof cell.v === 'number') { cell.t = 'n'; cell.z = '#,##0.00'; }
      });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AR Receipts');
    XLSX.writeFile(wb, `AR_Receipts_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
  };

  // ── Search columns ────────────────────────────────────────────────────────
  const searchColumns: ColumnsType<ReceiptRow> = [
    { title: '#', key: 'seq', width: 42, fixed: 'left',
      render: (_,__,i) => <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text> },
    { title: 'ID', dataIndex: 'standardReceiptId', width: 100, fixed: 'left',
      render: (v, r) => (
        <Button type="link" style={{ padding: 0, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}
          onClick={() => openReceiptTab(r)}>{v || '—'}</Button>
      ) },
    { title: 'Acctg Status', dataIndex: 'accountingStatus', width: 110, fixed: 'left',
      render: v => v === 'Accounted'
        ? <Tag color="green" style={{ fontSize: 11 }}>Accounted</Tag>
        : v ? <Tag color="blue" style={{ fontSize: 11 }}>{v}</Tag>
            : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    { title: 'Type', dataIndex: 'receiptType', width: 70, fixed: 'left',
      render: v => v
        ? <Tag color={v === 'CASH' ? 'blue' : v === 'MISC' ? 'purple' : 'default'} style={{ fontSize: 11, fontWeight: 600 }}>{v}</Tag>
        : <Text type="secondary">—</Text>,
    },
    { title: 'Receipt #', dataIndex: 'receiptNumber', width: 180, fixed: 'left',
      render: (v, r) => (
        <Button type="link" style={{ padding: 0, fontSize: 12, fontWeight: 600 }}
          onClick={() => openReceiptTab(r)}>{v || '—'}</Button>
      ) },
    { title: 'Doc #', dataIndex: 'documentNumber', width: 100,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v ?? '—'}</Text> },
    { title: 'Customer', dataIndex: 'customerName', width: 220, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Cust #', dataIndex: 'customerAccountNumber', width: 100,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: 'Method', dataIndex: 'receiptMethod', width: 120, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Receipt Date', dataIndex: 'receiptDate', width: 110,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'CCY', dataIndex: 'currency', width: 60,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Amount', dataIndex: 'amount', width: 130, align: 'right',
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{fmt(v || 0)}</Text> },
    { title: 'Unapplied', dataIndex: 'unappliedAmount', width: 110, align: 'right',
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace', color: v > 0 ? REDWOOD.warning : REDWOOD.success }}>{fmt(v || 0)}</Text> },
    { title: 'State', dataIndex: 'state', width: 100,
      render: v => <Tag color={stateColor(v)} style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    { title: 'Status', dataIndex: 'status', width: 100,
      render: v => <Tag color={statusColor(v)} style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    { title: 'Remittance Bank', dataIndex: 'remittanceBankName', width: 180, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Bank Acct #', dataIndex: 'remittanceBankAccountNumber', width: 140,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: 'Maturity Date', dataIndex: 'maturityDate', width: 110,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Business Unit', dataIndex: 'businessUnit', width: 200, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Sync', dataIndex: 'syncStatus', width: 80,
      render: v => v ? <Tag color={syncStatusColor(v)} style={{ fontSize: 11 }}>{v}</Tag>
                     : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    { title: '', key: 'open', width: 46, fixed: 'right',
      render: (_, r) => (
        <Tooltip title="Open receipt">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openReceiptTab(r)} />
        </Tooltip>
      ) },
  ];

  // ── Receipt panel ─────────────────────────────────────────────────────────
  const renderReceiptPanel = (tab: ReceiptTab) => {
    const { key: tabKey, draft, syncStatus } = tab;
    const isNew         = draft.standardReceiptId === 0;
    const hasSavedId    = draft.standardReceiptId > 0;
    const isFusionLocked = LOCKED_SYNC.includes((syncStatus || '').toUpperCase()) && !isNew;
    const isAccounted    = draft.accountingStatus === 'Accounted';
    // isEditing: new records are always editable; saved records require Edit button
    const isEditing     = isNew || (editingEnabled[tabKey] ?? false);
    // isLocked: Fusion-synced records or Accounted receipts cannot be edited
    const isLocked      = isFusionLocked || isAccounted;
    const isSaving = saving[tabKey] || false;
    const apps     = receiptApplications[tabKey];

    const appsApiUrl = draft.standardReceiptId
      ? `${APEX_RECEIPT_APPS}?standard_receipt_id=${draft.standardReceiptId}&limit=200`
      : APEX_RECEIPT_APPS;

    // Field helper: right-aligned label + input (for single-col use)
    const field = (label: string, node: React.ReactNode, required = false) => (
      <Row align="middle" style={{ marginBottom: 5 }}>
        <Col span={9} style={{ textAlign: 'right', paddingRight: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {required && <span style={{ color: REDWOOD.primary, marginRight: 2 }}>*</span>}{label}
          </Text>
        </Col>
        <Col span={15}>{node}</Col>
      </Row>
    );

    const fieldDisabled = isLocked || !isEditing;

    const inp = (f: keyof ReceiptDraft, placeholder = '') => (
      <Input size="small" style={{ fontSize: 12 }} value={draft[f] as string}
        placeholder={placeholder} readOnly={fieldDisabled}
        onChange={e => !fieldDisabled && updateDraft(tabKey, { [f]: e.target.value } as any)} />
    );

    const sel = (f: keyof ReceiptDraft, options: string[]) => (
      <Select size="small" style={{ width: '100%', fontSize: 12 }} value={(draft[f] as string) || undefined}
        allowClear disabled={fieldDisabled}
        onChange={v => updateDraft(tabKey, { [f]: v ?? '' } as any)}>
        {options.map(o => <Option key={o} value={o}>{o}</Option>)}
      </Select>
    );

    const dp = (f: keyof ReceiptDraft) => (
      <DatePicker size="small" style={{ width: '100%', fontSize: 12 }}
        value={draft[f] ? dayjs(draft[f] as string) : null}
        format="DD-MMM-YYYY" disabled={fieldDisabled}
        onChange={d => updateDraft(tabKey, { [f]: d ? d.format('YYYY-MM-DD') : '' } as any)} />
    );

    const num = (f: keyof ReceiptDraft) => (
      <InputNumber size="small" style={{ width: '100%', fontSize: 12 }}
        value={draft[f] as number} precision={2} disabled={fieldDisabled}
        onChange={v => updateDraft(tabKey, { [f]: v } as any)} />
    );

    const amtNum = (f: keyof ReceiptDraft) => (
      <InputNumber size="small" style={{ width: '100%', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}
        value={draft[f] as number} precision={2} disabled={fieldDisabled}
        formatter={v => v !== undefined && v !== null && v !== '' ? Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
        parser={v => parseFloat((v ?? '').replace(/,/g, '')) || 0}
        onChange={v => updateDraft(tabKey, { [f]: v } as any)} />
    );

    const roVal = (v: React.ReactNode, mono = false) => (
      <Text style={{ fontSize: 12, fontFamily: mono ? 'monospace' : undefined }}>{v || '—'}</Text>
    );

    const buSel = () => {
      const selectedBu = businessUnits.find(b => b.name === draft.businessUnit);
      return (
        <div>
          <Select size="small" style={{ width: '100%', fontSize: 12 }}
            value={draft.businessUnit || undefined} allowClear disabled={fieldDisabled} showSearch
            filterOption={(input, opt) => String(opt?.children ?? '').toLowerCase().includes(input.toLowerCase())}
            onChange={v => {
              updateDraft(tabKey, { businessUnit: v ?? '', receiptMethod: '', selectedBankAccountId: null });
              setReceiptMethods([]);
              setAllMethodAccounts([]);
              if (v) fetchMethodAccountsByBU(tabKey, v);
            }}>
            {businessUnits.map(bu => (
              <Option key={bu.name} value={bu.name}>
                {bu.companyCode ? `${bu.name} — ${bu.companyCode}` : bu.name}
              </Option>
            ))}
          </Select>
          {selectedBu?.companyCode && (
            <div style={{ marginTop: 3 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Company Code: </Text>
              <Text style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: REDWOOD.info }}>
                {selectedBu.companyCode}
              </Text>
            </div>
          )}
        </div>
      );
    };

    const custSel = () => {
      const isMisc = draft.receiptType === 'MISC';
      const display = draft.customerAccountNumber
        ? `${draft.customerName} (${draft.customerAccountNumber})`
        : '';

      if (isMisc) {
        // MISC: free-text name with optional popup search
        return (
          <Space.Compact style={{ width: '100%' }}>
            <Input size="small"
              value={draft.customerName}
              placeholder="Type customer name…"
              disabled={fieldDisabled}
              style={{ fontSize: 12 }}
              onChange={e => updateDraft(tabKey, { customerName: e.target.value, customerAccountNumber: '' })}
            />
            <Tooltip title="Search customer">
              <Button size="small" icon={<SearchOutlined />} disabled={fieldDisabled}
                onClick={() => { if (!fieldDisabled) openLov(tabKey, draft.customerName); }} />
            </Tooltip>
            {draft.customerAccountNumber && (
              <Tooltip title="Clear">
                <Button size="small" icon={<CloseOutlined />} disabled={fieldDisabled}
                  onClick={() => { if (!fieldDisabled) updateDraft(tabKey, { customerName: '', customerAccountNumber: '' }); }} />
              </Tooltip>
            )}
          </Space.Compact>
        );
      }

      // CASH (and default): popup only
      return (
        <Input size="small" readOnly
          value={display}
          placeholder={draft.receiptType ? 'Click to search customer…' : 'Select Receipt Type first'}
          style={{ cursor: fieldDisabled ? 'default' : 'pointer', fontSize: 12, background: '#fff' }}
          onClick={() => { if (!fieldDisabled) openLov(tabKey); }}
          suffix={
            draft.customerAccountNumber
              ? <CloseOutlined style={{ fontSize: 10, cursor: 'pointer', color: REDWOOD.neutral600 }}
                  onClick={e => { e.stopPropagation(); if (!fieldDisabled) updateDraft(tabKey, { customerName: '', customerAccountNumber: '' }); }} />
              : <SearchOutlined style={{ color: REDWOOD.info, cursor: fieldDisabled ? 'default' : 'pointer' }}
                  onClick={() => { if (!fieldDisabled) openLov(tabKey); }} />
          }
        />
      );
    };

    const currSel = () => (
      <Space.Compact style={{ width: '100%' }}>
        <Select size="small" style={{ flex: 1, fontSize: 12 }}
          value={draft.currency || undefined} allowClear disabled={fieldDisabled}
          onChange={v => { updateDraft(tabKey, { currency: v ?? '' }); if (v) fetchFxRate(tabKey, v); }}>
          {['AED', 'USD', 'EUR', 'GBP', 'SAR', 'QAR', 'KWD'].map(o => <Option key={o} value={o}>{o}</Option>)}
        </Select>
        {fxRateLoading[tabKey] && <Spin size="small" style={{ marginLeft: 6, alignSelf: 'center' }} />}
      </Space.Compact>
    );

    const appStatusColor = (s: string) => ({ Applied: 'green', Unapplied: 'blue', Reversed: 'red' }[s] || 'default');
    const procStatusColor = (s: string) => ({ Closed: 'green', Open: 'blue', Reversed: 'red' }[s] || 'default');

    type ExtAppRow = AppRow & { _pending?: boolean; _pendingKey?: string; _instSeq?: number; _adjAmount?: number; _origAmt?: number; _balDue?: number; _installmentId?: number; _txnId?: number; _closed?: boolean };

    const pendingRows = pendingApplications[tabKey] ?? [];
    const savedRows   = (receiptApplications[tabKey]?.rows ?? []) as ExtAppRow[];

    // Convert pending rows into AppRow shape so they can share the same table
    const pendingAsAppRows: ExtAppRow[] = pendingRows.map(r => ({
      key:                        `pending-${r.key}`,
      applicationId:              0,
      applicationDate:            draft.receiptDate || dayjs().format('YYYY-MM-DD'),
      applicationAmount:          r.applyAmount,
      adjustmentAmount:           r.adjustmentAmount,
      applicationStatus:          'APP',
      accountingDate:             draft.accountingDate || dayjs().format('YYYY-MM-DD'),
      referenceTransactionNumber: r.transactionNumber,
      referenceTransactionId:     r.customerTransactionId,
      referenceTransactionStatus: 'OP',
      activityName:               'Invoice',
      standardReceiptId:          draft.standardReceiptId,
      enteredCurrency:            r.currency,
      processStatus:              'PENDING',
      isLatestApplication:        'Y',
      custAccountId:              null,
      customerSite:               draft.customerSite || '',
      _pending:                   true,
      _pendingKey:                r.key,
      _instSeq:                   r.sequenceNumber,
      _adjAmount:                 r.adjustmentAmount,
      _origAmt:                   r.balanceDue,
      _balDue:                    r.balanceDue,
      _installmentId:             r.installmentId,
      _txnId:                     r.customerTransactionId,
      _closed:                    r._closed,
    }));

    // Attach _adjAmount to saved rows from the DB adjustment_amount column
    const savedRowsWithAdj = savedRows.map(r => ({ ...r, _adjAmount: r.adjustmentAmount || 0 }));
    const allAppRows = [...pendingAsAppRows, ...savedRowsWithAdj];

    // ── Applied / Unapplied / On-Account summary ──────────────────────────────
    const receiptTotal   = draft.amount ?? 0;
    const totalApplied   = allAppRows.reduce((s, r) => s + (r.applicationAmount || 0), 0);
    const totalAdjAll    = (pendingApplications[tabKey] ?? []).reduce((s, r) => s + (r.adjustmentAmount ?? 0), 0);
    const unapplied        = Math.max(0, receiptTotal - totalApplied);
    const isOnAccount      = totalApplied === 0 && receiptTotal > 0;
    const isFullyApplied   = receiptTotal > 0 && Math.abs(receiptTotal - totalApplied) < 0.01;

    const appColumns: ColumnsType<ExtAppRow> = [
      { title: '', key: 'del', width: 32, fixed: 'left',
        render: (_, r) => {
          if (isAccounted) return null; // locked — no delete
          const appId = r._pending ? 0 : (r.applicationId ?? 0);
          const isDeleting = deletingAppId === appId && appId !== 0;
          return (
            <Tooltip title={r._pending ? 'Remove pending application' : 'Delete application'}>
              <Button size="small" type="text" danger
                icon={isDeleting ? <Spin size="small" /> : <DeleteOutlined style={{ fontSize: 11 }} />}
                style={{ padding: '0 2px', height: 20 }}
                disabled={isDeleting}
                onClick={() => deleteApplication(tabKey, appId, r._pendingKey)} />
            </Tooltip>
          );
        }},
      { title: '#', key: 'seq', width: 36,
        render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text> },
      { title: 'Inst #', key: 'instSeq', width: 60, align: 'center',
        render: (_, r) => r._instSeq != null
          ? <Tag style={{ fontSize: 11, margin: 0 }}>#{r._instSeq}</Tag>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
      { title: 'Application Reference', dataIndex: 'referenceTransactionNumber', width: 185, ellipsis: true,
        render: (v, r) => (
          <Space size={4}>
            {r._closed
              ? <Tag color="red" icon={<CloseCircleOutlined />} style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}>Closed</Tag>
              : r._pending && <Tag color="orange" style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}>Pending</Tag>}
            <Text style={{ fontSize: 12, fontWeight: 600, color: r._closed ? REDWOOD.primary : undefined }}>{v || '—'}</Text>
            {r._closed && r._pendingKey && isEditing && (
              <Tooltip title="Remove this closed installment">
                <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ padding: '0 2px', height: 18 }}
                  onClick={() => setPendingApplications(prev => ({
                    ...prev,
                    [tabKey]: (prev[tabKey] ?? []).filter(p => p.key !== r._pendingKey),
                  }))} />
              </Tooltip>
            )}
          </Space>
        ) },
      { title: 'Receivables Activity', dataIndex: 'activityName', width: 130, ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'Process Status', dataIndex: 'processStatus', width: 100,
        render: v => v ? <Tag color={procStatusColor(v)} style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">—</Text> },
      { title: 'Original Amt', key: 'origAmt', width: 120, align: 'right',
        render: (_, r) => r._origAmt != null
          ? <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{fmt(r._origAmt)}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
      { title: 'Balance Due', key: 'balDue', width: 120, align: 'right',
        render: (_, r) => r._balDue != null
          ? <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(r._balDue)}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
      { title: 'Apply Amount', dataIndex: 'applicationAmount', width: 130, align: 'right',
        render: (v, r) => r._pending && isEditing
          ? <InputNumber size="small" style={{ width: '100%' }} precision={2} min={0}
              value={v}
              formatter={val => val !== undefined && val !== null ? Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
              parser={val => parseFloat((val ?? '').replace(/,/g, '')) || 0}
              onChange={val => {
                if (r._pendingKey) {
                  setPendingApplications(prev => ({
                    ...prev,
                    [tabKey]: (prev[tabKey] ?? []).map(p => p.key === r._pendingKey ? { ...p, applyAmount: val ?? 0 } : p),
                  }));
                }
              }} />
          : <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: v > 0 ? REDWOOD.success : undefined }}>{fmt(v || 0)}</Text> },
      { title: 'Adj Amount', key: 'adjAmount', width: 150, align: 'right',
        render: (_, r) => {
          const pendingRow = r._pendingKey ? (pendingApplications[tabKey] ?? []).find(p => p.key === r._pendingKey) : null;
          const splits = pendingRow?.adjSplits;
          const hasSplits = splits && splits.length > 1;
          if (r._pending && r._pendingKey && isEditing) {
            return (
              <Space size={4} style={{ width: '100%', justifyContent: 'flex-end' }}>
                <InputNumber size="small" style={{ flex: 1, minWidth: 80 }} precision={2}
                  placeholder="±0.00" value={r._adjAmount || undefined}
                  formatter={val => val !== undefined && val !== null && val !== '' ? Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                  parser={val => { const s = (val ?? '').replace(/,/g, ''); const n = parseFloat(s); return isNaN(n) ? (s === '-' ? '-' as any : 0) : n; }}
                  onChange={val => setPendingApplications(prev => {
                    const rows = prev[tabKey] ?? [];
                    return { ...prev, [tabKey]: rows.map(p => p.key === r._pendingKey ? { ...p, adjustmentAmount: val ?? 0, adjSplits: undefined } : p) };
                  })} />
                {(r._adjAmount ?? 0) !== 0 && (
                  <Tooltip title={hasSplits ? `${splits.length} splits — click to edit` : 'Split adjustment into multiple activities'}>
                    <Button size="small" type={hasSplits ? 'primary' : 'text'}
                      icon={<ScissorOutlined style={{ fontSize: 11 }} />}
                      style={{ padding: '0 4px', height: 24, color: hasSplits ? undefined : REDWOOD.warning,
                               borderColor: hasSplits ? undefined : REDWOOD.warning }}
                      onClick={() => {
                        const instRow2 = pendingRow ? (instPickerRows[tabKey] ?? []).find(ir => ir.installmentId === pendingRow.installmentId) : undefined;
                        openAdjSplitModal(tabKey, r._pendingKey!, Math.abs(r._adjAmount ?? 0), r.enteredCurrency || draft.currency, pendingRow?.adjSplits, undefined, pendingRow ? { customerTransactionId: pendingRow.customerTransactionId, transactionNumber: pendingRow.transactionNumber, installmentId: pendingRow.installmentId, sequenceNumber: pendingRow.sequenceNumber, balanceDue: pendingRow.balanceDue, applyAmount: pendingRow.applyAmount, adjustmentAmount: pendingRow.adjustmentAmount, transactionClass: instRow2?.transactionClass, billToSiteUseId: instRow2?.billToSiteUseId } : undefined);
                      }} />
                  </Tooltip>
                )}
              </Space>
            );
          }
          if (r._adjAmount && r._adjAmount !== 0 && r.applicationId) {
            return (
              <Space size={4} style={{ width: '100%', justifyContent: 'flex-end' }}>
                <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
                    color: r._adjAmount < 0 ? REDWOOD.primary : REDWOOD.warning }}>
                  {r._adjAmount > 0 ? '+' : ''}{fmt(r._adjAmount)}
                </Text>
                <Tooltip title={isEditing ? 'View / edit adjustment splits' : 'View adjustment splits'}>
                  <Button size="small" type="text" icon={<ScissorOutlined style={{ fontSize: 11 }} />}
                    style={{ padding: '0 4px', height: 24, color: REDWOOD.warning }}
                    onClick={() => {
                      const savedPending = (pendingApplications[tabKey] ?? []).find(p => p.key === r.key);
                      const instRow = (instPickerRows[tabKey] ?? []).find(ir => ir.customerTransactionId === r.referenceTransactionId);
                      openAdjSplitModal(
                        tabKey, r.key, Math.abs(r._adjAmount!), r.enteredCurrency || draft.currency,
                        savedPending?.adjSplits, r.applicationId,
                        {
                          customerTransactionId: r.referenceTransactionId ?? undefined,
                          transactionNumber:     r.referenceTransactionNumber || undefined,
                          installmentId:         instRow?.installmentId,
                          sequenceNumber:        instRow?.sequenceNumber,
                          balanceDue:            instRow?.balanceDue,
                          applyAmount:           r.applicationAmount,
                          adjustmentAmount:      r.adjustmentAmount,
                          transactionClass:      instRow?.transactionClass,
                          billToSiteUseId:       instRow?.billToSiteUseId,
                        },
                        !isEditing, // viewOnly when not in edit mode
                      );
                    }} />
                </Tooltip>
              </Space>
            );
          }
          return r._adjAmount && r._adjAmount !== 0
            ? <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
                color: r._adjAmount < 0 ? REDWOOD.primary : REDWOOD.warning }}>
                {r._adjAmount > 0 ? '+' : ''}{fmt(r._adjAmount)}
              </Text>
            : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        }},
      { title: 'Balance', key: 'balAfter', width: 130, align: 'right',
        render: (_, r) => {
          if (r._balDue == null) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
          const applyAmt = r.applicationAmount ?? 0;
          const adjAmt   = r._adjAmount ?? 0;
          const balance  = Math.max(0, r._balDue - applyAmt - Math.abs(adjAmt));
          const canPush  = r._pending && r._pendingKey && isEditing && balance > 0.001;
          return (
            <Space size={4} style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
                color: balance === 0 ? REDWOOD.success : REDWOOD.neutral600 }}>
                {fmt(balance)}
              </Text>
              {canPush && (
                <Tooltip title="Move balance to Adjustment">
                  <Button size="small" type="text" icon={<RollbackOutlined style={{ fontSize: 10 }} />}
                    style={{ padding: '0 2px', height: 18, color: REDWOOD.warning }}
                    onClick={() => setPendingApplications(prev => ({
                      ...prev,
                      [tabKey]: (prev[tabKey] ?? []).map(p =>
                        p.key === r._pendingKey ? { ...p, adjustmentAmount: balance } : p
                      ),
                    }))} />
                </Tooltip>
              )}
            </Space>
          );
        }},
      { title: 'CCY', dataIndex: 'enteredCurrency', width: 52,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'App. Status', dataIndex: 'applicationStatus', width: 95,
        render: v => v ? <Tag color={appStatusColor(v)} style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">—</Text> },
      { title: 'Ref Txn Status', dataIndex: 'referenceTransactionStatus', width: 105,
        render: v => v ? <Tag color={procStatusColor(v)} style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">—</Text> },
      { title: 'Latest', dataIndex: 'isLatestApplication', width: 52, align: 'center',
        render: v => v === 'Y'
          ? <Tag color="green" style={{ fontSize: 10, margin: 0 }}>Y</Tag>
          : <Text type="secondary" style={{ fontSize: 11 }}>N</Text> },
      { title: 'Application Date', dataIndex: 'applicationDate', width: 112,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'Accounting Date', dataIndex: 'accountingDate', width: 112,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'Installment ID', key: 'installmentId', width: 100, align: 'right',
        render: (_, r) => r._installmentId
          ? <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{r._installmentId}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
      { title: 'Txn ID', key: 'txnId', width: 90, align: 'right',
        render: (_, r) => r._txnId ?? r.referenceTransactionId
          ? <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{r._txnId ?? r.referenceTransactionId}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    ];

    return (
      <div style={{ background: REDWOOD.neutral100, minHeight: '100%' }}>

        {/* ── Toolbar ── */}
        <div style={{ background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.border}`, padding: '8px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              {isNew
                ? <Badge color="purple" text={<Text style={{ fontSize: 12 }}>New — Not Saved</Text>} />
                : hasSavedId
                  ? <>
                      <Text type="secondary" style={{ fontSize: 12 }}>Receipt ID:</Text>
                      <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.info }}>{draft.standardReceiptId}</Text>
                      {isEditing
                        ? <Badge color="orange" text={<Text style={{ fontSize: 12, color: '#d46b08' }}>Edit Mode</Text>} />
                        : <Badge color="green" text={<Text style={{ fontSize: 12 }}>Saved</Text>} />
                      }
                    </>
                  : <Badge color="blue" text={<Text style={{ fontSize: 12 }}>Saved Locally</Text>} />
              }
              {syncStatus && <Tag color={syncStatusColor(syncStatus)} style={{ fontSize: 11 }}>{syncStatus}</Tag>}
              {draft.accountingStatus === 'Accounted'
                ? <><Tag color="green" style={{ fontSize: 11 }}>Accounted</Tag>
                    <Tag icon={<LockOutlined />} color="red" style={{ fontSize: 11 }}>Read Only</Tag></>
                : tab.slaHeaderId
                  ? <Tag color="blue" style={{ fontSize: 11 }}>SLA Created</Tag>
                  : null
              }
            </Space>
            <Space size="small">
              {/* API Services info */}
              <Tooltip title="API Services">
                <Button size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                  onClick={() => setApiInfoVisible(true)} />
              </Tooltip>
              {/* Payload inspector */}
              <Tooltip title="Inspect POST payload">
                <Button size="small" icon={<CodeOutlined style={{ color: REDWOOD.neutral600 }} />}
                  onClick={() => setApiModal({ tabKey, testResult: null, testing: false })} />
              </Tooltip>

              {/* Print — always visible for saved receipts */}
              {hasSavedId && (
                <Tooltip title="Print Receipt">
                  <Button size="small" icon={<PrinterOutlined />}
                    onClick={() => generateReceiptPdf(draft)}>
                    Print
                  </Button>
                </Tooltip>
              )}

              {/* Delete */}
              {hasSavedId && isEditing && !isLocked && (
                <Tooltip title="Delete receipt">
                  <Button size="small" danger icon={<DeleteOutlined />} loading={deleting[tabKey]}
                    onClick={() => handleDelete(tabKey)} />
                </Tooltip>
              )}

              {/* Accounting buttons — only after receipt is saved */}
              {hasSavedId && (
                isAccounted
                  ? <Button size="small" icon={<EyeOutlined />}
                      style={{ color: '#722ed1', borderColor: '#722ed1' }}
                      onClick={() => openViewAccounting(draft)}>
                      View Accounting
                    </Button>
                  : <Tooltip title={!draft.receiptMethod ? 'Select a Receipt Method first' : 'Create SLA accounting entries'}>
                      <Button size="small" icon={<BookOutlined />}
                        style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                        onClick={() => openAcctModal(tabKey)}>
                        Create Accounting
                      </Button>
                    </Tooltip>
              )}

              {/* Edit / Save / Cancel */}
              {hasSavedId && !isEditing && !isLocked && (
                <Button size="small" icon={<EditOutlined />}
                  style={{ color: REDWOOD.warning, borderColor: REDWOOD.warning }}
                  onClick={() => setEditingEnabled(prev => ({ ...prev, [tabKey]: true }))}>
                  Edit
                </Button>
              )}
              {isEditing && !isLocked && <>
                <Button size="small" type="primary" icon={<SaveOutlined />} loading={isSaving}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                  onClick={() => handleSave(tabKey)}>Save</Button>
                {(pendingApplications[tabKey]?.length ?? 0) > 0 && (
                  <Button size="small" icon={<CodeOutlined />}
                    style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
                    onClick={() => {
                      const m: string[] = [];
                      if (!draft.drAccount) m.push('Dr. Account');
                      if (!draft.crAccount) m.push('Cr. Account');
                      if (m.length > 0) { message.warning(`Missing required fields: ${m.join(' · ')}`); return; }
                      openDebugModal(tabKey, draft);
                    }}>
                    Save &amp; Debug
                  </Button>
                )}
                <Button size="small" icon={<SaveOutlined />} loading={isSaving}
                  onClick={async () => { const ok = await handleSave(tabKey); if (ok) closeTab(tabKey); }}>
                  Save and Close
                </Button>
                {hasSavedId && (
                  <Button size="small" onClick={() => setEditingEnabled(prev => ({ ...prev, [tabKey]: false }))}>
                    Cancel
                  </Button>
                )}
              </>}
              {/* Delete — only for saved, unaccounted receipts */}
              {hasSavedId && (draft.accountingStatus || '').toLowerCase() !== 'accounted' && (
                <Tooltip title="Delete this receipt (only allowed while not accounted)">
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteReceipt(tabKey, draft)}>
                    Delete
                  </Button>
                </Tooltip>
              )}
              {/* Actions dropdown — only for saved receipts */}
              {hasSavedId && (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'copy',
                        icon: <CopyOutlined />,
                        label: 'Copy Receipt',
                        onClick: () => openCopyModal(draft),
                      },
                      {
                        key: 'reverse',
                        icon: <RollbackOutlined />,
                        label: 'Reverse Receipt',
                        disabled: true,
                        title: 'Coming soon',
                      },
                    ],
                  }}
                >
                  <Button size="small">
                    Actions <DownOutlined style={{ fontSize: 10 }} />
                  </Button>
                </Dropdown>
              )}
              <Button size="small" icon={<CloseOutlined />} onClick={() => closeTab(tabKey)}>Close</Button>
            </Space>
          </div>
        </div>

        <div style={{ padding: '12px 16px' }}>

          {/* ── Main tabs ── */}
          <Card size="small" style={{ marginBottom: 10, borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
            <Tabs size="small" style={{ padding: '0 12px' }} defaultActiveKey="geninfo" items={[
              /* ── General Information ── */
              {
                key: 'geninfo',
                label: <span><InfoCircleOutlined style={{ marginRight: 4 }} />General Information</span>,
                children: (
                  <div style={{ padding: '10px 8px 14px' }}>
                    {/* 3-column layout matching Oracle Fusion */}
                    <Row gutter={0}>

                      {/* Col 1: Receipt info */}
                      <Col span={8} style={{ paddingRight: 16, borderRight: `1px solid ${REDWOOD.border}` }}>
                        {field('Business Unit',  buSel(), true)}
                        {field('Receipt Type',
                          <Select size="small" style={{ width: '100%', fontSize: 12 }}
                            value={draft.receiptType || undefined} allowClear disabled={fieldDisabled}
                            onChange={v => updateDraft(tabKey, { receiptType: v ?? '' })}>
                            <Option value="CASH"><Tag color="blue" style={{ fontSize: 11 }}>CASH</Tag></Option>
                            <Option value="MISC"><Tag color="purple" style={{ fontSize: 11 }}>MISC</Tag></Option>
                          </Select>
                        , true)}
                        {field('Receipt Method',
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 6 }}>
                              <Text type="secondary" style={{ fontSize: 10 }}>
                                {allMethodAccountsLoading[tabKey] ? 'Loading…' : `${receiptMethods.length} methods loaded`}
                              </Text>
                              <Tooltip title="Reload methods for this Business Unit">
                                <Button size="small" type="text" icon={<ReloadOutlined spin={!!allMethodAccountsLoading[tabKey]} />}
                                  style={{ fontSize: 11, padding: '0 4px', height: 18, lineHeight: '18px' }}
                                  disabled={!draft.businessUnit}
                                  onClick={() => fetchMethodAccountsByBU(tabKey, draft.businessUnit)} />
                              </Tooltip>
                            </div>
                            <Select
                              size="small"
                              style={{ width: '100%', fontSize: 12 }}
                              value={draft.selectedBankAccountId ?? undefined}
                              allowClear
                              disabled={fieldDisabled}
                              showSearch
                              loading={allMethodAccountsLoading[tabKey]}
                              placeholder={allMethodAccountsLoading[tabKey] ? 'Loading…' : draft.businessUnit ? 'Select method…' : 'Select Business Unit first'}
                              optionLabelProp="label"
                              dropdownStyle={{ minWidth: 620 }}
                              filterOption={(input, opt) =>
                                String(opt?.searchtext ?? '').toLowerCase().includes(input.trim().toLowerCase())
                              }
                              onChange={(v) => {
                                const acct = allMethodAccounts.find(a => a.id === v);
                                const tab  = tabs.find(t => t.key === tabKey);
                                updateDraft(tabKey, {
                                  receiptMethod:               acct?.receiptMethodName ?? '',
                                  receiptMethodId:             acct?.receiptMethodId   ?? null,
                                  selectedBankAccountId:       v ?? null,
                                  remittanceBankName:          acct?.bankName          ?? '',
                                  remittanceBankAccountNumber: acct?.bankAccountNum    ?? '',
                                  // auto-fill DR Account from Cash account if currently blank
                                  ...(acct?.cashCombination && !(tab?.draft.drAccount) ? {
                                    drAccount:     acct.cashCombination.replace(/\./g, '-'),
                                    drAccountDesc: acct.cashCcid > 0 ? (acctDescCache[acct.cashCcid]?.description ?? '') : '',
                                  } : {}),
                                });
                              }}
                            >
                              {allMethodAccounts.map(a => {
                                const masked     = maskAcct(a.bankAccountNum);
                                const searchtext = [a.receiptMethodName, a.receiptClass, a.bankName, a.bankAccountName, a.bankAccountNum].filter(Boolean).join(' ');
                                return (
                                  <Option key={a.id} value={a.id} label={a.receiptMethodName} searchtext={searchtext}>
                                    <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, padding: '2px 0' }}>
                                      <span style={{ fontWeight: 600, minWidth: 160, flexShrink: 0 }}>{a.receiptMethodName}</span>
                                      <span style={{ flex: 1, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 8 }}>
                                        {a.bankAccountName || a.bankName || '—'}
                                      </span>
                                      <span style={{ fontFamily: 'monospace', color: REDWOOD.info, marginLeft: 8, flexShrink: 0, fontSize: 11, minWidth: 100, textAlign: 'right' }}>
                                        {masked}
                                      </span>
                                      <span style={{ color: '#8c8c8c', fontSize: 10, marginLeft: 12, flexShrink: 0, minWidth: 90, textAlign: 'right' }}>
                                        {a.receiptClass || ''}
                                      </span>
                                    </div>
                                  </Option>
                                );
                              })}
                            </Select>
                            {/* Selected: show class + chosen bank account on its own row */}
                            {draft.receiptMethod && (() => {
                              const m     = receiptMethods.find(x => x.name === draft.receiptMethod);
                              const accts = draft.selectedBankAccountId
                                ? allMethodAccounts.filter(a => a.id === draft.selectedBankAccountId)
                                : allMethodAccounts.filter(a => a.receiptMethodName === draft.receiptMethod);
                              return (
                                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                                  {m?.receiptClass && (
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      Class: <strong>{m.receiptClass}</strong>
                                    </Text>
                                  )}
                                  {accts.map(a => (
                                    <Tag key={a.id} color="blue" icon={<BankOutlined />}
                                      style={{ fontSize: 10, margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {a.bankAccountName
                                        ? `${a.bankAccountName}${a.bankAccountNum ? ' · ' + a.bankAccountNum : ''}`
                                        : a.bankAccountNum || `Acct ${a.bankAccountId}`}
                                      {a.primaryFlag === 'Y' ? ' ★' : ''}
                                    </Tag>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        , true)}
                        {field('Dr. Account',
                          <div>
                            <Space.Compact style={{ width: '100%' }}>
                              <Input size="small" readOnly
                                value={draft.drAccount}
                                placeholder="Select GL combination…"
                                style={{ fontSize: 11, fontFamily: draft.drAccount ? 'monospace' : undefined, background: '#fff', cursor: 'pointer', letterSpacing: draft.drAccount ? '0.02em' : undefined }}
                                onClick={() => { if (!fieldDisabled) { setMiscAcctTabKey(tabKey); setMiscAcctField('drAccount'); setMiscAcctVisible(true); } }}
                              />
                              {draft.drAccount
                                ? <Button size="small" icon={<CloseOutlined />} disabled={fieldDisabled}
                                    onClick={() => updateDraft(tabKey, { drAccount: '', drAccountDesc: '' })} />
                                : <Button size="small" icon={<SearchOutlined />} disabled={fieldDisabled}
                                    onClick={() => { setMiscAcctTabKey(tabKey); setMiscAcctField('drAccount'); setMiscAcctVisible(true); }} />
                              }
                            </Space.Compact>
                            {draft.drAccountDesc && (
                              <Text style={{ fontSize: 10, color: REDWOOD.info, display: 'block', marginTop: 2 }}>
                                {draft.drAccountDesc.split(' · ').filter((s: string) => s && s !== 'Default').slice(1).join(' · ') || draft.drAccountDesc}
                              </Text>
                            )}
                          </div>
                        )}
                        {field('Cr. Account',
                          <div>
                            <Space.Compact style={{ width: '100%' }}>
                              <Input size="small" readOnly
                                value={draft.crAccount}
                                placeholder="Select GL combination…"
                                style={{ fontSize: 11, fontFamily: draft.crAccount ? 'monospace' : undefined, background: '#fff', cursor: 'pointer', letterSpacing: draft.crAccount ? '0.02em' : undefined }}
                                onClick={() => { if (!fieldDisabled) { setMiscAcctTabKey(tabKey); setMiscAcctField('crAccount'); setMiscAcctVisible(true); } }}
                              />
                              {draft.crAccount
                                ? <Button size="small" icon={<CloseOutlined />} disabled={fieldDisabled}
                                    onClick={() => updateDraft(tabKey, { crAccount: '', crAccountDesc: '' })} />
                                : <Button size="small" icon={<SearchOutlined />} disabled={fieldDisabled}
                                    onClick={() => { setMiscAcctTabKey(tabKey); setMiscAcctField('crAccount'); setMiscAcctVisible(true); }} />
                              }
                            </Space.Compact>
                            {draft.crAccountDesc && (
                              <Text style={{ fontSize: 10, color: REDWOOD.info, display: 'block', marginTop: 2 }}>
                                {draft.crAccountDesc.split(' · ').filter((s: string) => s && s !== 'Default').slice(1).join(' · ') || draft.crAccountDesc}
                              </Text>
                            )}
                          </div>
                        )}
                        {field('Receipt Number', inp('receiptNumber', 'Auto-generated if blank'), true)}
                        {field('Customer',       custSel())}
                        {field('State',          sel('state', ['Applied', 'Unapplied', 'On Account', 'Reversed', 'NSF', 'Stop']))}
                        {field('Status',         sel('status', ['Cleared', 'Uncleared', 'Reversed', 'Remitted']))}
                      </Col>

                      {/* Col 2: Amounts + specialist */}
                      <Col span={8} style={{ paddingLeft: 16, paddingRight: 16, borderRight: `1px solid ${REDWOOD.border}` }}>
                        {field('Currency',          currSel(), true)}
                        {/* Entered Amount input */}
                        {field('Entered Amount',    amtNum('amount'), true)}
                        {/* Accounted Amount display */}
                        {field('Accounted Amount',
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Text style={{ fontSize: 20, fontFamily: 'monospace', fontWeight: 700, color: '#1a1a1a' }}>
                              {fmt(draft.accountedAmount ?? 0)}
                            </Text>
                          </div>
                        )}
                        {/* Unapplied / Applied / On-Account live breakdown — no label, spans full width */}
                        {(() => {
                          const rAmt    = draft.amount ?? 0;
                          const pndApps = pendingApplications[tabKey] ?? [];
                          const svdApps = receiptApplications[tabKey]?.rows ?? [];
                          const applied = pndApps.reduce((s, r) => s + r.applyAmount, 0)
                                        + svdApps.reduce((s, r) => s + r.applicationAmount, 0);
                          const totalAdj = pndApps.reduce((s, r) => s + (r.adjustmentAmount ?? 0), 0);
                          const unapp   = Math.max(0, rAmt - applied);
                          const onAcct  = applied === 0;
                          return (
                            <Row style={{ marginBottom: 5 }}>
                              <Col span={9} />
                              <Col span={15}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {onAcct && rAmt > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Tag color="purple" style={{ fontSize: 12, margin: 0, minWidth: 88, textAlign: 'center', padding: '1px 6px' }}>On Account</Tag>
                                      <Text style={{ fontSize: 15, fontFamily: 'monospace', color: '#722ed1', fontWeight: 700 }}>{fmt(rAmt)}</Text>
                                    </div>
                                  )}
                                  {!onAcct && unapp > 0.01 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Tag color="orange" style={{ fontSize: 12, margin: 0, minWidth: 88, textAlign: 'center', padding: '1px 6px' }}>Unapplied</Tag>
                                      <Text style={{ fontSize: 15, fontFamily: 'monospace', color: REDWOOD.warning, fontWeight: 700 }}>{fmt(unapp)}</Text>
                                    </div>
                                  )}
                                  {!onAcct && unapp < 0.01 && applied > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Tag color="green" style={{ fontSize: 12, margin: 0, minWidth: 88, textAlign: 'center', padding: '1px 6px' }}>Fully Applied</Tag>
                                    </div>
                                  )}
                                  {applied > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Tag color="green" style={{ fontSize: 12, margin: 0, minWidth: 88, textAlign: 'center', padding: '1px 6px' }}>Applied</Tag>
                                      <Text style={{ fontSize: 15, fontFamily: 'monospace', color: REDWOOD.success, fontWeight: 700 }}>{fmt(applied)}</Text>
                                    </div>
                                  )}
                                  {totalAdj !== 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Tag color={totalAdj < 0 ? 'volcano' : 'orange'} style={{ fontSize: 12, margin: 0, minWidth: 88, textAlign: 'center', padding: '1px 6px' }}>Adjustment</Tag>
                                      <Text style={{ fontSize: 15, fontFamily: 'monospace', color: totalAdj < 0 ? REDWOOD.primary : REDWOOD.warning, fontWeight: 700 }}>
                                        {totalAdj > 0 ? '+' : ''}{fmt(totalAdj)}
                                      </Text>
                                    </div>
                                  )}
                                  {/* Balance row — receipt minus apply only (adj is separate write-off) */}
                                  {applied !== 0 && (() => {
                                    const balance = rAmt - applied;
                                    const over    = balance < -0.01;
                                    const exact   = Math.abs(balance) < 0.01;
                                    return (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${REDWOOD.border}`, paddingTop: 4, marginTop: 2 }}>
                                        <Tag color={over ? 'red' : exact ? 'green' : 'default'}
                                          style={{ fontSize: 12, margin: 0, minWidth: 88, textAlign: 'center', padding: '1px 6px' }}>
                                          {over ? 'Over' : exact ? 'Balanced' : 'Balance'}
                                        </Tag>
                                        <Text style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 700,
                                          color: over ? REDWOOD.primary : exact ? REDWOOD.success : REDWOOD.neutral600 }}>
                                          {over ? '-' : ''}{fmt(Math.abs(balance))}
                                        </Text>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </Col>
                            </Row>
                          );
                        })()}
                        {field('Rec. Specialist',   inp('receivablesSpecialist'))}
                        {field('Comments',
                          <Input.TextArea size="small" style={{ fontSize: 12 }} autoSize={{ minRows: 2 }}
                            value={draft.comments} readOnly={fieldDisabled}
                            onChange={e => !fieldDisabled && updateDraft(tabKey, { comments: e.target.value })} />
                        , true)}
                      </Col>

                      {/* Col 3: Dates + other */}
                      <Col span={8} style={{ paddingLeft: 16 }}>
                        {field('Receipt Date',     dp('receiptDate'),     true)}
                        {field('Accounting Date',  dp('accountingDate'),  true)}
                        {field('Maturity Date',    dp('maturityDate'))}
                        {field('Receipt at Risk',  sel('receiptAtRisk', ['Y', 'N']))}
                        {field('Conv. Rate Type',  inp('conversionRateType'))}
                        {field('Conv. Rate',       num('conversionRate'))}
                        {field('Struct. Pay. Ref', inp('structuredPaymentReference'))}

                        {/* ── Attachments (inline) ── */}
                        <div style={{ marginTop: 10, borderTop: `1px solid ${REDWOOD.border}`, paddingTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <Space size={4}>
                              <PaperClipOutlined style={{ color: REDWOOD.neutral600, fontSize: 12 }} />
                              <Text strong style={{ fontSize: 12 }}>Attachments</Text>
                              {(tabAttachments[tabKey] || []).length > 0 && (
                                <Badge count={(tabAttachments[tabKey] || []).length} style={{ backgroundColor: REDWOOD.info }} />
                              )}
                            </Space>
                            <Space size={4}>
                              <Tooltip title="Show API request details">
                                <Button size="small" icon={<ApiOutlined />} onClick={() => {
                                  const pending = (tabAttachments[tabKey] || []).filter((a: any) => !a.id);
                                  const url = `${APEX_AR_RECEIPTS}/${draft.standardReceiptId}/attachments`;
                                  const body = pending.length > 0
                                    ? JSON.stringify({ fileName: pending[0].name, fileType: pending[0].fileType || '', fileSize: pending[0].fileSize, content: '(base64 omitted)' }, null, 2)
                                    : '(no pending attachments)';
                                  setAttApiDebug({ url, body });
                                }} />
                              </Tooltip>
                              <Tooltip title={!hasSavedId ? 'Save the receipt first' : undefined}>
                                <Button size="small" icon={<UploadOutlined />}
                                  disabled={!hasSavedId} loading={attSaving[tabKey]}
                                  onClick={() => handleSaveAttachments(tabKey, draft.standardReceiptId)}>
                                  Save Attachments
                                </Button>
                              </Tooltip>
                            </Space>
                          </div>
                          <Upload
                            fileList={(tabAttachments[tabKey] || []).map((a: any) => ({ uid: a.uid, name: a.name, status: a.status, size: a.fileSize, type: a.fileType }))}
                            beforeUpload={(file) => {
                              const reader = new FileReader();
                              reader.onload = (e) => {
                                const base64 = (e.target?.result as string)?.split(',')[1] || '';
                                setTabAttachments(prev => ({
                                  ...prev,
                                  [tabKey]: [...(prev[tabKey] || []), { uid: `new-${Date.now()}`, name: file.name, fileType: file.type, fileSize: file.size, content: base64, rawFile: file, status: 'done' }],
                                }));
                              };
                              reader.readAsDataURL(file);
                              return false;
                            }}
                            onRemove={(file) => new Promise((resolve) => {
                              Modal.confirm({
                                title: 'Delete attachment?',
                                content: `"${file.name}" will be permanently removed.`,
                                okText: 'Delete', okButtonProps: { danger: true }, cancelText: 'Cancel',
                                onOk: async () => {
                                  const att = (tabAttachments[tabKey] || []).find((a: any) => a.uid === file.uid);
                                  if ((att as any)?.id && draft.standardReceiptId) {
                                    await fetch(`${APEX_AR_RECEIPTS}/${draft.standardReceiptId}/attachments/${(att as any).id}`, { method: 'DELETE' }).catch(() => {});
                                  }
                                  setTabAttachments(prev => ({ ...prev, [tabKey]: (prev[tabKey] || []).filter((a: any) => a.uid !== file.uid) }));
                                  resolve(false);
                                },
                                onCancel: () => resolve(false),
                              });
                            })}
                            showUploadList={false}
                            multiple
                            disabled={!hasSavedId}
                          >
                            <Tooltip title={!hasSavedId ? 'Save the receipt first to attach files' : undefined}>
                              <Button icon={<UploadOutlined />} disabled={!hasSavedId} size="small">Attach Files</Button>
                            </Tooltip>
                          </Upload>
                          {(tabAttachments[tabKey] || []).length === 0 && (
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>No attachments</Text>
                          )}
                          <div style={{ marginTop: 6 }}>
                            {(tabAttachments[tabKey] || []).map((att: any) => (
                              <div key={att.uid} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', fontSize: 12 }}>
                                <PaperClipOutlined style={{ color: REDWOOD.neutral600, flexShrink: 0, fontSize: 11 }} />
                                <span style={{ flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={att.name}>{att.name}</span>
                                {!att.id && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>Pending</Tag>}
                                <Button type="text" size="small" icon={<EyeOutlined />} style={{ padding: '0 3px' }}
                                  onClick={() => handlePreviewAtt(tabKey, att, draft.standardReceiptId)} />
                                <Button type="text" size="small" icon={<DownloadOutlined />} style={{ padding: '0 3px' }}
                                  onClick={() => handleDownloadAtt(tabKey, att, draft.standardReceiptId)} />
                                <Button type="text" size="small" icon={<DeleteOutlined />} style={{ padding: '0 3px', color: '#ff4d4f' }}
                                  onClick={() => {
                                    Modal.confirm({
                                      title: 'Delete attachment?',
                                      content: `"${att.name}" will be permanently removed.`,
                                      okText: 'Delete', okButtonProps: { danger: true }, cancelText: 'Cancel',
                                      onOk: async () => {
                                        if (att.id && draft.standardReceiptId) {
                                          await fetch(`${APEX_AR_RECEIPTS}/${draft.standardReceiptId}/attachments/${att.id}`, { method: 'DELETE' }).catch(() => {});
                                        }
                                        setTabAttachments(prev => ({ ...prev, [tabKey]: (prev[tabKey] || []).filter((a: any) => a.uid !== att.uid) }));
                                      },
                                    });
                                  }} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </Col>

                    </Row>
                  </div>
                ),
              },

              /* ── Remittance Bank ── */
              {
                key: 'bank',
                label: <span><BankOutlined style={{ marginRight: 4 }} />Remittance Bank</span>,
                children: (
                  <div style={{ padding: '10px 8px 14px' }}>
                    {/* Manual bank fields */}
                    <Row gutter={0} style={{ marginBottom: 16 }}>
                      <Col span={8} style={{ paddingRight: 16, borderRight: `1px solid ${REDWOOD.border}` }}>
                        {field('Bank Name',       inp('remittanceBankName'))}
                        {field('Branch',          inp('remittanceBankBranch'))}
                        {field('Account Number',  inp('remittanceBankAccountNumber'))}
                        {field('Deposit Date',    dp('remittanceBankDepositDate'))}
                      </Col>
                      <Col span={8} style={{ paddingLeft: 16, paddingRight: 16, borderRight: `1px solid ${REDWOOD.border}` }}>
                        {field('Batch Name',      inp('receiptBatchName'))}
                        {field('Struct. Pay. Ref', inp('structuredPaymentReference'))}
                      </Col>
                      <Col span={8} style={{ paddingLeft: 16 }}>
                        {field('Customer Bank',        inp('customerBank'))}
                        {field('Cust. Bank Branch',    inp('customerBankBranch'))}
                        {field('Cust. Bank Acct. No.', inp('customerBankAccountNumber'))}
                      </Col>
                    </Row>

                    {/* GL Accounts from Receipt Method */}
                    <Divider style={{ fontSize: 13, margin: '12px 0' }}>
                      <Space>
                        <BankOutlined style={{ color: REDWOOD.info }} />
                        GL Accounts — Receipt Method
                        {draft.receiptMethod
                          ? <Tag color="blue" style={{ fontSize: 11 }}>{draft.receiptMethod}</Tag>
                          : <Text type="secondary" style={{ fontSize: 12 }}>Select a Receipt Method above to load accounts</Text>
                        }
                      </Space>
                    </Divider>

                    {(() => {
                      const m          = receiptMethods.find(x => x.name === draft.receiptMethod);
                      const acctList   = draft.selectedBankAccountId
                        ? allMethodAccounts.filter(a => a.id === draft.selectedBankAccountId)
                        : allMethodAccounts.filter(a => a.receiptMethodName === draft.receiptMethod);
                      const isLoading  = allMethodAccountsLoading[tabKey];
                      return (
                      <Spin spinning={isLoading} tip="Loading bank accounts…">
                      {!draft.receiptMethod ? (
                        <Alert type="info" showIcon style={{ fontSize: 12 }}
                          message="Select a Receipt Method in the General Information tab to view the associated GL accounts." />
                      ) : acctList.length === 0 && !isLoading ? (
                        <Alert type="warning" showIcon style={{ fontSize: 12 }}
                          message={`No bank accounts found for receipt method "${draft.receiptMethod}".`} />
                      ) : (
                        acctList.map((acct, idx) => (
                          <div key={acct.id} style={{
                            border: `1px solid ${REDWOOD.border}`, borderRadius: 8,
                            marginBottom: 12, overflow: 'hidden',
                          }}>
                            {/* Account header */}
                            <div style={{
                              background: '#e6f4ff', borderBottom: `1px solid #91caff`,
                              padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                            }}>
                              <BankOutlined style={{ color: REDWOOD.info }} />
                              <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>
                                {acct.bankAccountName || `Bank Account #${idx + 1}`}
                              </Text>
                              {acct.bankAccountNum && (
                                <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
                                  {acct.bankAccountNum}
                                </Text>
                              )}
                              {acct.primaryFlag === 'Y' && (
                                <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>Primary</Tag>
                              )}
                              {acct.bankCurrency && (
                                <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>{acct.bankCurrency}</Tag>
                              )}
                              <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                                {acct.businessUnitName && <span>{acct.businessUnitName}</span>}
                                {acct.company          && <span> ({acct.company})</span>}
                                {acct.bankName         && <span> · {acct.bankName}</span>}
                                {acct.bankBranchName   && <span> · {acct.bankBranchName}</span>}
                                {acct.startDate        ? <span> · From: {acct.startDate}</span> : ''}
                                {acct.endDate          ? <span> · To: {acct.endDate}</span> : ''}
                              </Text>
                            </div>

                            {/* GL Combinations grid */}
                            <div style={{ padding: '10px 14px', background: '#fff' }}>
                              <Row gutter={[12, 8]}>
                                {[
                                  { label: 'Cash',              ccid: acct.cashCcid,              combo: acct.cashCombination,              color: '#f6ffed', border: '#b7eb8f', textColor: REDWOOD.success },
                                  { label: 'Unapplied',         ccid: acct.unappliedCcid,         combo: acct.unappliedCombination,         color: '#e6f4ff', border: '#91caff', textColor: REDWOOD.info },
                                  { label: 'Unidentified',      ccid: acct.unidentifiedCcid,      combo: acct.unidentifiedCombination,      color: '#fff7e6', border: '#ffd591', textColor: REDWOOD.warning },
                                  { label: 'On Account',        ccid: acct.onAccountCcid,         combo: acct.onAccountCombination,         color: '#f9f0ff', border: '#d3adf7', textColor: '#722ed1' },
                                  { label: 'Receipt Clearing',  ccid: acct.receiptClearingCcid,   combo: acct.receiptClearingCombination,   color: '#e6fffb', border: '#87e8de', textColor: '#08979c' },
                                  { label: 'Remittance',        ccid: acct.remittanceCcid,        combo: acct.remittanceCombination,        color: '#fff0f6', border: '#ffadd2', textColor: '#c41d7f' },
                                ].map(({ label, ccid, combo, color, border, textColor }) => {
                                  const descInfo = ccid > 0 ? acctDescCache[ccid] : undefined;
                                  return (
                                  <Col xs={24} md={12} lg={8} key={label}>
                                    <div style={{
                                      background: color, border: `1px solid ${border}`,
                                      borderRadius: 6, padding: '6px 10px',
                                    }}>
                                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                                        {label}
                                      </Text>
                                      <Text style={{
                                        fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
                                        color: combo ? textColor : '#bfbfbf', wordBreak: 'break-all',
                                      }}>
                                        {combo || '—'}
                                      </Text>
                                      {descInfo?.description && (
                                        <Text style={{ fontSize: 10, color: textColor, display: 'block', marginTop: 2, opacity: 0.85 }}>
                                          {descInfo.description}
                                        </Text>
                                      )}
                                      {ccid > 0 && (
                                        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
                                          CCID: {ccid}
                                        </Text>
                                      )}
                                    </div>
                                  </Col>
                                  );
                                })}
                              </Row>
                            </div>
                          </div>
                        ))
                      )}
                      </Spin>
                      );
                    })()}
                  </div>
                ),
              },

              /* ── Customer ── */
              {
                key: 'customer',
                label: <span><UserOutlined style={{ marginRight: 4 }} />Customer</span>,
                children: (
                  <div style={{ padding: '10px 8px 14px' }}>
                    <Row gutter={0}>
                      <Col span={8} style={{ paddingRight: 16, borderRight: `1px solid ${REDWOOD.border}` }}>
                        {field('Customer Name',       inp('customerName'), true)}
                        {field('Account Number',      inp('customerAccountNumber'))}
                        {field('Customer Site',       inp('customerSite'))}
                      </Col>
                      <Col span={8} style={{ paddingLeft: 16 }}>
                        {field('Rec. Specialist', inp('receivablesSpecialist'))}
                      </Col>
                    </Row>
                  </div>
                ),
              },

              /* ── Notes ── */
              {
                key: 'notes',
                label: <span><FileTextOutlined style={{ marginRight: 4 }} />Notes</span>,
                children: (
                  <div style={{ padding: '10px 8px 14px' }}>
                    <Input.TextArea autoSize={{ minRows: 3 }} style={{ fontSize: 12 }}
                      value={draft.comments} readOnly={fieldDisabled}
                      placeholder="Enter comments…"
                      onChange={e => !fieldDisabled && updateDraft(tabKey, { comments: e.target.value })} />
                  </div>
                ),
              },
            ]} />
          </Card>

          {/* ── Receipt Applications ── */}
          <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}
            title={
              <Space>
                <UnorderedListOutlined style={{ color: REDWOOD.info }} />
                <Text strong style={{ fontSize: 13 }}>Receipt Applications</Text>
                {(apps || (pendingApplications[tabKey]?.length ?? 0) > 0) && (
                  <Badge count={(apps?.rows?.length ?? 0) + (pendingApplications[tabKey]?.length ?? 0)} style={{ backgroundColor: REDWOOD.info }} overflowCount={9999} />
                )}
              </Space>
            }
            extra={
              <Space size="small">
                {draft.receiptType === 'CASH' && draft.customerAccountNumber && isEditing && (
                  <Tooltip title={isAccounted ? 'Receipt is accounted — locked' : isFullyApplied ? 'Receipt is fully applied' : undefined}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<FileTextOutlined />}
                    disabled={isFullyApplied || isAccounted}
                    style={{ background: isFullyApplied || isAccounted ? undefined : REDWOOD.success, borderColor: isFullyApplied || isAccounted ? undefined : REDWOOD.success, fontSize: 11 }}
                    onClick={() => {
                      if (!draft.amount || draft.amount <= 0) {
                        message.warning('Enter the receipt amount first before selecting installments');
                        return;
                      }
                      setInstPickerOpen(p => ({ ...p, [tabKey]: true }));
                      // Auto-select + restore amounts for already-staged installments
                      const alreadyPending = pendingApplications[tabKey] ?? [];
                      if (alreadyPending.length > 0) {
                        setInstPickerSel(p => ({ ...p, [tabKey]: alreadyPending.map(r => r.key) }));
                        // Patch picker rows with saved apply/adj amounts
                        setInstPickerRows(prev => {
                          const rows = prev[tabKey];
                          if (!rows?.length) return prev;
                          const pendingMap = Object.fromEntries(alreadyPending.map(r => [r.key, r]));
                          return { ...prev, [tabKey]: rows.map(r => pendingMap[r.key]
                            ? { ...r, applyAmount: pendingMap[r.key].applyAmount, adjustmentAmount: pendingMap[r.key].adjustmentAmount, adjustmentReason: pendingMap[r.key].adjustmentReason }
                            : r) };
                        });
                      }
                      if (!instPickerRows[tabKey]?.length) {
                        fetchOpenInstallments(tabKey, draft.customerAccountNumber);
                      }
                    }}
                  >
                    Select Invoices &amp; Installments
                  </Button>
                  </Tooltip>
                )}
                {/* API debug icon — hover to see the URL being called */}
                <Tooltip
                  title={
                    <div style={{ fontSize: 11 }}>
                      <div style={{ marginBottom: 4, fontWeight: 600 }}>GET endpoint:</div>
                      <code style={{ wordBreak: 'break-all', fontSize: 10 }}>{appsApiUrl}</code>
                    </div>
                  }
                  placement="bottomRight"
                >
                  <Button size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />} />
                </Tooltip>
                <Button size="small" icon={<ReloadOutlined />}
                  disabled={!draft.standardReceiptId}
                  onClick={() => {
                    fetchedAppsRef.current.delete(tabKey);
                    fetchApplications(tabKey, draft.standardReceiptId);
                  }}>
                  Refresh
                </Button>
              </Space>
            }
          >
            {(() => {
              return (
                <>
                  {apps?.loading ? (
                    <div style={{ padding: 32, textAlign: 'center' }}>
                      <Spin size="small" />
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>Loading applications…</Text>
                    </div>
                  ) : (
                    <Table
                      dataSource={allAppRows}
                      columns={appColumns}
                      rowKey="key"
                      size="small"
                      pagination={false}
                      scroll={{ x: 1300 }}
                      locale={{ emptyText: 'No applications found for this receipt' }}
                      rowClassName={r => (r as any)._pending ? 'pending-app-row' : ''}
                      onRow={r => ((r as any)._closed
                        ? { style: { background: '#fff1f0', borderLeft: '3px solid #ff4d4f' } }
                        : (r as any)._pending
                          ? { style: { background: '#fffbe6' } }
                          : {})}
                      summary={() => (
                        <Table.Summary fixed>
                          <Table.Summary.Row style={{ background: '#fafafa' }}>
                            <Table.Summary.Cell index={0} colSpan={5} align="right">
                              <Text strong style={{ fontSize: 11 }}>Total Applied</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} />
                            <Table.Summary.Cell index={2} />
                            <Table.Summary.Cell index={3} align="right">
                              <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success }}>
                                {fmt(totalApplied)}
                              </Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">
                              {totalAdjAll !== 0 && (
                                <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: totalAdjAll < 0 ? REDWOOD.primary : REDWOOD.warning }}>
                                  {totalAdjAll > 0 ? '+' : ''}{fmt(totalAdjAll)}
                                </Text>
                              )}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={5} />
                            <Table.Summary.Cell index={6} colSpan={6} />
                          </Table.Summary.Row>
                        </Table.Summary>
                      )}
                    />
                  )}
                </>
              );
            })()}
          </Card>

          {/* ── Open Installments Picker Modal ── */}
          {(() => {
            const allPickerRows  = instPickerRows[tabKey]   ?? [];
            const pickerLoading  = instPickerLoading[tabKey] ?? false;
            const pickerSaving   = instPickerSaving[tabKey]  ?? false;
            const selectedKeys   = instPickerSel[tabKey]    ?? [];
            const searchQ        = (instPickerSearch[tabKey] ?? '').toLowerCase();
            const pickerRows     = searchQ
              ? allPickerRows.filter(r =>
                  r.transactionNumber.toLowerCase().includes(searchQ) ||
                  r.transactionDate.includes(searchQ) ||
                  r.dueDate.includes(searchQ) ||
                  r.currency.toLowerCase().includes(searchQ) ||
                  String(r.sequenceNumber).includes(searchQ) ||
                  String(r.balanceDue).includes(searchQ) ||
                  String(r.originalAmount).includes(searchQ))
              : allPickerRows;
            const totalApply = allPickerRows
              .filter(r => selectedKeys.includes(r.key))
              .reduce((s, r) => s + (r.applyAmount ?? r.balanceDue), 0);
            const totalAdj = allPickerRows
              .filter(r => selectedKeys.includes(r.key))
              .reduce((s, r) => s + (r.adjustmentAmount ?? 0), 0);
            const receiptAmt  = draft.amount ?? 0;
            const remaining   = receiptAmt - totalApply;

            const updateRow = (key: string, patch: Partial<InstPickerRow>) =>
              setInstPickerRows(p => ({
                ...p,
                [tabKey]: (p[tabKey] ?? []).map(r => r.key === key ? { ...r, ...patch } : r),
              }));

            const instPickerCols: ColumnsType<InstPickerRow> = [
              { title: 'Invoice #', dataIndex: 'transactionNumber', width: 120,
                render: v => <Text style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.info }}>{v}</Text> },
              { title: 'Inst #', dataIndex: 'sequenceNumber', width: 55, align: 'center',
                render: v => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
              { title: 'Txn Date', dataIndex: 'transactionDate', width: 95,
                render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
              { title: 'Due Date', dataIndex: 'dueDate', width: 95,
                render: v => {
                  const overdue = v && v < dayjs().format('YYYY-MM-DD');
                  return <Text style={{ fontSize: 12, color: overdue ? REDWOOD.primary : undefined, fontWeight: overdue ? 600 : 400 }}>{v || '—'}</Text>;
                }},
              { title: 'CCY', dataIndex: 'currency', width: 50, align: 'center',
                render: v => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
              { title: 'Original Amt', dataIndex: 'originalAmount', width: 110, align: 'right',
                render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text> },
              { title: 'Balance Due', dataIndex: 'balanceDue', width: 110, align: 'right',
                render: v => <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.primary }}>{Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text> },
              { title: 'Calculated Balance', dataIndex: 'calculatedBalance', width: 130, align: 'right',
                render: (v, rec) => {
                  const mismatch = Math.abs((v ?? 0) - (rec.balanceDue ?? 0)) > 0.001;
                  return (
                    <Tooltip title={mismatch ? 'Differs from stored Balance Due — computed from actual receipt applications & adjustments' : 'Computed from actual receipt applications & adjustments'}>
                      <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: mismatch ? REDWOOD.warning : REDWOOD.success }}>
                        {Number(v ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Tooltip>
                  );
                }},
              { title: 'Apply Amount', dataIndex: 'applyAmount', width: 120, align: 'right',
                render: (v, rec) => (
                  <InputNumber size="small" style={{ width: '100%' }} precision={2} min={0} max={rec.balanceDue}
                    placeholder={Number(rec.balanceDue).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} value={v}
                    formatter={val => val !== undefined && val !== null && val !== '' ? Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                    parser={val => parseFloat((val ?? '').replace(/,/g, '')) || 0}
                    onChange={val => updateRow(rec.key, { applyAmount: val })} />
                )},
              { title: 'Adjustment Amt', dataIndex: 'adjustmentAmount', width: 130, align: 'right',
                render: (v, rec) => (
                  <InputNumber size="small" style={{ width: '100%' }} precision={2}
                    placeholder="±0.00" value={v}
                    formatter={val => val !== undefined && val !== null && val !== '' ? Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                    parser={val => parseFloat((val ?? '').replace(/,/g, '')) || 0}
                    onChange={val => updateRow(rec.key, { adjustmentAmount: val })} />
                )},
              { title: 'Balance After', width: 140, align: 'right',
                render: (_v, rec) => {
                  const apply = rec.applyAmount ?? rec.balanceDue;
                  const after = Math.max(0, rec.balanceDue - apply);
                  const canPush = after > 0.001;
                  return (
                    <Space size={4} style={{ justifyContent: 'flex-end', width: '100%' }}>
                      <Text style={{ fontSize: 11, fontFamily: 'monospace',
                        color: after === 0 ? REDWOOD.success : REDWOOD.neutral600 }}>
                        {after.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                      {canPush && (
                        <Tooltip title="Move remaining balance to Adjustment">
                          <Button size="small" type="text" icon={<RollbackOutlined style={{ fontSize: 10 }} />}
                            style={{ padding: '0 2px', height: 18, color: REDWOOD.warning }}
                            onClick={() => updateRow(rec.key, { adjustmentAmount: after })} />
                        </Tooltip>
                      )}
                    </Space>
                  );
                }},
              { title: 'Adj Reason', dataIndex: 'adjustmentReason', width: 140,
                render: (v, rec) => (
                  <Input size="small" placeholder="Reason…" value={v}
                    onChange={e => updateRow(rec.key, { adjustmentReason: e.target.value })} />
                )},
              { title: 'Installment ID', dataIndex: 'installmentId', width: 100, align: 'right',
                render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v || '—'}</Text> },
              { title: 'Txn ID', dataIndex: 'customerTransactionId', width: 90, align: 'right',
                render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v || '—'}</Text> },
            ];

            return (
              <>
              <Modal
                open={!!instPickerOpen[tabKey]}
                onCancel={() => setInstPickerOpen(p => ({ ...p, [tabKey]: false }))}
                width={1100}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
                    <Space>
                      <FileTextOutlined style={{ color: REDWOOD.success }} />
                      <Text strong>Open Invoices &amp; Installments</Text>
                      <Tag color="blue">{draft.customerName || draft.customerAccountNumber}</Tag>
                      {allPickerRows.length > 0 && <Tag>{allPickerRows.length} open</Tag>}
                    </Space>
                    <Space size={16}>
                      <div style={{ textAlign: 'right' }}>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block' }}>Receipt Amount</Text>
                        <Text strong style={{ fontSize: 14, fontFamily: 'monospace' }}>{receiptAmt.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block' }}>Applied</Text>
                        <Text strong style={{ fontSize: 14, fontFamily: 'monospace', color: REDWOOD.info }}>{totalApply.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block' }}>Remaining</Text>
                        <Text strong style={{ fontSize: 14, fontFamily: 'monospace', color: Math.abs(remaining) < 0.01 ? REDWOOD.success : remaining < 0 ? REDWOOD.primary : REDWOOD.warning }}>{remaining.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text>
                      </div>
                      <Tooltip title="API Inspector — view all webservices and JSON bodies">
                        <Button size="small" icon={<ApiOutlined />}
                          style={{ borderColor: REDWOOD.info, color: REDWOOD.info, fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); setInstPickerApiOpen(true); }}>
                          API
                        </Button>
                      </Tooltip>
                    </Space>
                  </div>
                }
                footer={
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space wrap>
                      <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{selectedKeys.length} selected</Text>
                      {selectedKeys.length > 0 && (
                        <>
                          <Tag color="green">Apply: {totalApply.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {draft.currency}</Tag>
                          {totalAdj !== 0 && <Tag color={totalAdj > 0 ? 'orange' : 'red'}>Adj: {totalAdj > 0 ? '+' : ''}{totalAdj.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {draft.currency}</Tag>}
                        </>
                      )}
                    </Space>
                    <Space>
                      <Button onClick={() => setInstPickerOpen(p => ({ ...p, [tabKey]: false }))}>Cancel</Button>
                      <Button icon={<ReloadOutlined />}
                        onClick={() => { setInstPickerSel(p => ({ ...p, [tabKey]: [] })); fetchOpenInstallments(tabKey, draft.customerAccountNumber); }}>
                        Refresh
                      </Button>
                      <Tooltip title={selectedKeys.length === 0 ? 'Select at least one installment' : remaining < -0.01 ? 'Apply amount exceeds receipt amount' : undefined}>
                        <Button type="primary" loading={pickerSaving} disabled={selectedKeys.length === 0 || remaining < -0.01}
                          style={{ background: selectedKeys.length > 0 && remaining >= -0.01 ? REDWOOD.success : undefined,
                                   borderColor: selectedKeys.length > 0 && remaining >= -0.01 ? REDWOOD.success : undefined }}
                          onClick={() => applySelectedInstallments(tabKey, draft)}>
                          Add to Applications
                        </Button>
                      </Tooltip>
                    </Space>
                  </Space>
                }
              >
                {/* Search bar */}
                {!pickerLoading && allPickerRows.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <Input.Search allowClear placeholder="Filter by invoice #, date, currency, amount…"
                      style={{ width: 340 }} size="small"
                      value={instPickerSearch[tabKey] ?? ''}
                      onChange={e => setInstPickerSearch(p => ({ ...p, [tabKey]: e.target.value }))}
                    />
                    {searchQ && (
                      <Text style={{ fontSize: 11, color: REDWOOD.neutral600, marginLeft: 8 }}>
                        {pickerRows.length} / {allPickerRows.length} shown
                      </Text>
                    )}
                  </div>
                )}
                {pickerLoading ? (
                  <div style={{ textAlign: 'center', padding: 48 }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 12, fontSize: 12, color: REDWOOD.neutral600 }}>
                      Loading open installments for <strong>{draft.customerAccountNumber}</strong>…
                    </div>
                  </div>
                ) : allPickerRows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 48, color: REDWOOD.neutral600, fontSize: 13 }}>
                    No open installments found for this customer.
                  </div>
                ) : (
                  <>
                    <Table<InstPickerRow>
                      columns={instPickerCols} dataSource={pickerRows} rowKey="key"
                      size="small" pagination={false} scroll={{ x: 1000, y: 380 }}
                      rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => {
                          setInstPickerSel(p => ({ ...p, [tabKey]: keys }));
                          const prevKeys = new Set(selectedKeys);
                          const newlySelected = (keys as string[]).filter(k => !prevKeys.has(k));
                          if (newlySelected.length > 0) {
                            setInstPickerRows(p => {
                              const rows = p[tabKey] ?? [];
                              // Calculate already-consumed receipt amount from existing selections
                              const alreadyApplied = rows
                                .filter(r => prevKeys.has(r.key))
                                .reduce((s, r) => s + (r.applyAmount ?? r.balanceDue), 0);
                              let remaining = Math.max(0, receiptAmt - alreadyApplied);
                              const updated = rows.map(r => {
                                if (!newlySelected.includes(r.key) || r.applyAmount !== null) return r;
                                const apply = Math.min(r.balanceDue, remaining);
                                remaining = Math.max(0, Math.round((remaining - apply) * 100) / 100);
                                return { ...r, applyAmount: apply };
                              });
                              return { ...p, [tabKey]: updated };
                            });
                          }
                        },
                      }}
                      summary={() => {
                        const selRows = allPickerRows.filter(r => selectedKeys.includes(r.key));
                        const totalOrig    = pickerRows.reduce((s, r) => s + r.originalAmount, 0);
                        const totalBal     = pickerRows.reduce((s, r) => s + r.balanceDue, 0);
                        const totalApplyS  = selRows.reduce((s, r) => s + (r.applyAmount ?? r.balanceDue), 0);
                        const totalAdjS    = selRows.reduce((s, r) => s + (r.adjustmentAmount ?? 0), 0);
                        return (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#fafafa' }}>
                              {/* checkbox col + Invoice# + Inst# + Txn Date + Due Date + CCY = colSpan 6 */}
                              <Table.Summary.Cell index={0} colSpan={6} align="right">
                                <Text strong style={{ fontSize: 11 }}>Totals</Text>
                              </Table.Summary.Cell>
                              {/* Original Amt */}
                              <Table.Summary.Cell index={1} align="right">
                                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.neutral600 }}>
                                  {totalOrig.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </Text>
                              </Table.Summary.Cell>
                              {/* Balance Due */}
                              <Table.Summary.Cell index={2} align="right">
                                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>
                                  {totalBal.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </Text>
                              </Table.Summary.Cell>
                              {/* Apply Amount (selected only) */}
                              <Table.Summary.Cell index={3} align="right">
                                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.success }}>
                                  {totalApplyS > 0 ? totalApplyS.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                                </Text>
                              </Table.Summary.Cell>
                              {/* Adjustment Amt (selected only) */}
                              <Table.Summary.Cell index={4} align="right">
                                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: totalAdjS < 0 ? REDWOOD.primary : REDWOOD.warning }}>
                                  {totalAdjS !== 0 ? `${totalAdjS > 0 ? '+' : ''}${totalAdjS.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                                </Text>
                              </Table.Summary.Cell>
                              {/* Balance After + Adj Reason */}
                              <Table.Summary.Cell index={5} colSpan={2} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        );
                      }}
                    />
                  </>
                )}
              </Modal>

              {/* ── Adjustment Split Dialog ── */}
              {adjSplitModal && adjSplitModal.tabKey === tabKey && (() => {
                const { pendingKey, totalAdj, currency, splits, applicationId: adjAppId, adjCreated, creating, viewOnly } = adjSplitModal;
                const splitTotal  = splits.reduce((s, r) => s + (r.amount || 0), 0);
                const remaining   = Math.round((totalAdj - splitTotal) * 100) / 100;
                const isBalanced  = Math.abs(remaining) < 0.01;
                const hasAppId    = !!adjAppId;
                const isLiveMode  = hasAppId && !viewOnly; // live POST only when editing
                const isReadOnly  = adjCreated || viewOnly;
                const updateSplit = (id: string, patch: Partial<AdjSplit>) =>
                  setAdjSplitModal(m => m ? { ...m, splits: m.splits.map(s => s.id === id ? { ...s, ...patch } : s) } : m);
                const addSplit = () =>
                  setAdjSplitModal(m => m ? { ...m, splits: [...m.splits, { id: `sp-${Date.now()}`, amount: Math.max(0, remaining), activityName: '', accountCombination: '', accountDescription: '', reason: '' }] } : m);
                const removeSplit = (id: string) =>
                  setAdjSplitModal(m => m ? { ...m, splits: m.splits.filter(s => s.id !== id) } : m);

                // Build POST JSON payloads for preview (one per split)
                const adjPostUrl  = `${APEX_DB_CONFIG.baseUrl}/ar/adjustments`;
                // rowSnap carries the relevant row fields regardless of whether row is pending or saved
                const snap = adjSplitModal.rowSnap
                  ?? (() => { const p = (pendingApplications[tabKey] ?? []).find(r => r.key === pendingKey); return p ? { customerTransactionId: p.customerTransactionId, transactionNumber: p.transactionNumber, installmentId: p.installmentId, sequenceNumber: p.sequenceNumber, balanceDue: p.balanceDue, applyAmount: p.applyAmount, adjustmentAmount: p.adjustmentAmount } : undefined; })();
                const nowIso = new Date().toISOString().slice(0, 19) + 'Z';
                const buildAdjBody = (sp: AdjSplit) => ({
                  CustomerTransactionId: snap?.customerTransactionId,
                  TransactionNumber:     snap?.transactionNumber,
                  TransactionClass:      snap?.transactionClass,
                  AdjustmentAmount:      -(Math.abs(sp.amount)),
                  AccountedAmount:       -(Math.abs(sp.amount)),
                  AdjustmentDate:        draft.receiptDate || today(),
                  AccountingDate:        draft.accountingDate || today(),
                  AdjustmentType:        'LINE',
                  Status:                'Approved',
                  ReceivablesActivity:   sp.activityName,
                  AccountCombination:    sp.accountCombination || undefined,
                  BusinessUnit:          draft.businessUnit || '',
                  Currency:              currency,
                  InstallmentNumber:     snap?.sequenceNumber,
                  InstallmentId:         snap?.installmentId,
                  InstallmentBalance:    snap ? Math.max(0, (snap.balanceDue ?? 0) - (snap.applyAmount ?? 0) - Math.abs(snap.adjustmentAmount ?? 0)) : undefined,
                  AdjustmentReason:      sp.reason,
                  ApprovedBy:            currentUser,
                  BillToSiteUseId:       snap?.billToSiteUseId,
                  ApplicationId:         adjAppId,
                  Comments:              `Auto-created from receipt ${draft.receiptNumber || ''}`,
                  CreatedBy:             currentUser,
                  CreationDate:          nowIso,
                  LastUpdatedBy:         currentUser,
                  LastUpdateDate:        nowIso,
                });

                const doCreateAdjustments = async () => {
                  setAdjSplitModal(m => m ? { ...m, creating: true } : m);
                  let errors: string[] = [];
                  for (const sp of splits) {
                    try {
                      const body = buildAdjBody(sp);
                      const res = await fetch(adjPostUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
                      if (!res.ok) errors.push(`${sp.activityName}: HTTP ${res.status}`);
                    } catch (e: any) { errors.push(`${sp.activityName}: ${e.message}`); }
                  }
                  if (errors.length > 0) {
                    message.error(`Adjustment error(s): ${errors.join('; ')}`);
                    setAdjSplitModal(m => m ? { ...m, creating: false } : m);
                  } else {
                    message.success(`${splits.length} adjustment(s) created successfully`);
                    setAdjSplitModal(m => m ? { ...m, creating: false, adjCreated: true } : m);
                  }
                };

                return (
                  <Modal
                    open
                    width={1020}
                    keyboard={false}
                    maskClosable={false}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <ScissorOutlined style={{ color: REDWOOD.warning }} />
                        <Text strong>{viewOnly ? 'View Adjustments' : 'Split Adjustment'}</Text>
                        <Tag color="orange">{fmt(totalAdj)} {currency}</Tag>
                        {adjAppId && (
                          <Tag color="blue" style={{ fontSize: 10 }}>App ID: {adjAppId}</Tag>
                        )}
                        {adjCreated && (
                          <Tag color="green" style={{ fontSize: 10 }}>Adjustments Created</Tag>
                        )}
                        {!isReadOnly && (
                          <Tooltip title={`Refresh activities (${recvActivities.length} loaded)`}>
                            <Button size="small" icon={<ReloadOutlined />} loading={recvActivitiesLoading}
                              style={{ fontSize: 11 }}
                              onClick={() => fetchRecvActivities(true)}>
                              {recvActivities.length > 0 ? `${recvActivities.length} activities` : 'Load activities'}
                            </Button>
                          </Tooltip>
                        )}
                        {/* GET inspector — only when applicationId present */}
                        {adjSplitModal?.apiUrl && (
                          <Tooltip title={
                            <div style={{ fontSize: 11 }}>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>GET — Adjustments by Application ID</div>
                              <code style={{ wordBreak: 'break-all', fontSize: 10 }}>{adjSplitModal.apiUrl}</code>
                            </div>
                          } placement="bottomLeft">
                            <Button size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />} />
                          </Tooltip>
                        )}
                        {/* POST inspector — shows URL + payload for each split */}
                        {isLiveMode && (
                          <Tooltip
                            overlayStyle={{ maxWidth: 700 }}
                            title={
                              <div style={{ fontSize: 11 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>POST — Create Adjustments</div>
                                <div style={{ marginBottom: 4 }}><Tag color="blue" style={{ fontSize: 10 }}>POST</Tag><code style={{ fontSize: 10, wordBreak: 'break-all' }}>{adjPostUrl}</code></div>
                                {splits.map((sp, i) => (
                                  <div key={sp.id} style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 6 }}>
                                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Line {i + 1}: {sp.activityName || '(no activity)'}</div>
                                    <pre style={{ fontSize: 9, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                      {JSON.stringify(buildAdjBody(sp), null, 2)}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            }
                            placement="bottomLeft"
                          >
                            <Button size="small" icon={<ApiOutlined style={{ color: REDWOOD.warning }} />} />
                          </Tooltip>
                        )}
                      </div>
                    }
                    onCancel={() => setAdjSplitModal(null)}
                    footer={
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <Text style={{ fontSize: 12 }}>
                            Total: <Text strong style={{ fontFamily: 'monospace', color: isBalanced ? REDWOOD.success : REDWOOD.primary }}>
                              {fmt(splitTotal)}
                            </Text>
                            {' / '}{fmt(totalAdj)}
                            {!isBalanced && <Text style={{ color: REDWOOD.primary, marginLeft: 8 }}>({remaining > 0 ? '+' : ''}{fmt(remaining)} remaining)</Text>}
                          </Text>
                        </Space>
                        <Space>
                          <Button onClick={() => setAdjSplitModal(null)}>{adjCreated ? 'Close' : 'Cancel'}</Button>
                          {!isReadOnly && !isLiveMode && (
                            <>
                              <Button icon={<PlusCircleOutlined />} onClick={addSplit}>Add Line</Button>
                              <Button type="primary" disabled={!isBalanced || splits.some(s => !s.activityName)}
                                style={{ background: isBalanced ? REDWOOD.success : undefined, borderColor: isBalanced ? REDWOOD.success : undefined }}
                                onClick={() => {
                                  setPendingApplications(prev => ({
                                    ...prev,
                                    [tabKey]: (prev[tabKey] ?? []).map(p =>
                                      p.key === pendingKey ? { ...p, adjSplits: splits } : p
                                    ),
                                  }));
                                  setAdjSplitModal(null);
                                  message.success(`Adjustment split into ${splits.length} line(s)`);
                                }}>
                                Apply Split
                              </Button>
                            </>
                          )}
                          {!isReadOnly && isLiveMode && (
                            <>
                              <Button icon={<PlusCircleOutlined />} onClick={addSplit}>Add Line</Button>
                              <Button type="primary" loading={creating}
                                disabled={!isBalanced || splits.some(s => !s.activityName)}
                                style={{ background: isBalanced ? REDWOOD.warning : undefined, borderColor: isBalanced ? REDWOOD.warning : undefined }}
                                onClick={doCreateAdjustments}>
                                Create Adjustment{splits.length > 1 ? 's' : ''}
                              </Button>
                            </>
                          )}
                        </Space>
                      </Space>
                    }
                  >
                    {adjCreated ? (
                      <div style={{ textAlign: 'center', padding: '24px 0' }}>
                        <div style={{ fontSize: 40, color: REDWOOD.success, marginBottom: 12 }}>✓</div>
                        <Text strong style={{ fontSize: 14 }}>{splits.length} adjustment{splits.length > 1 ? 's' : ''} created for App ID {adjAppId}</Text>
                        <div style={{ marginTop: 8 }}>
                          {splits.map((sp, i) => (
                            <div key={sp.id} style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                              Line {i + 1}: {fmt(sp.amount)} — {sp.activityName}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ marginBottom: 8, fontSize: 12, color: REDWOOD.neutral600 }}>
                          {isLiveMode
                            ? <>App ID <Text strong style={{ fontFamily: 'monospace' }}>{adjAppId}</Text> is ready. Configure splits then click <Text strong>Create Adjustment{splits.length > 1 ? 's' : ''}</Text> to POST directly.</>
                            : <>Split <Text strong style={{ fontFamily: 'monospace' }}>{fmt(totalAdj)} {currency}</Text> across multiple receivable activities. Total must equal the adjustment amount.</>
                          }
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
                              <th style={{ padding: '6px 8px', textAlign: 'left', width: 36 }}>#</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right', width: 130 }}>Amount</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left', width: 200 }}>Receivable Activity</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left', width: 300 }}>Account Combination</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left', width: 140 }}>Reason</th>
                              <th style={{ width: 32 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {splits.map((sp, idx) => (
                              <tr key={sp.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                <td style={{ padding: '6px 8px', color: REDWOOD.neutral600 }}>{idx + 1}</td>
                                <td style={{ padding: '6px 4px' }}>
                                  <InputNumber size="small" style={{ width: '100%' }} precision={2} min={0}
                                    value={sp.amount}
                                    disabled={isReadOnly}
                                    formatter={v => v !== undefined && v !== null ? Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                                    parser={v => parseFloat((v ?? '').replace(/,/g, '')) || 0}
                                    onChange={val => {
                                      const newAmt = val ?? 0;
                                      setAdjSplitModal(m => {
                                        if (!m) return m;
                                        const updated = m.splits.map(s => s.id === sp.id ? { ...s, amount: newAmt } : s);
                                        if (idx !== 0 && updated.length > 1) {
                                          const othersSum = updated.slice(1).reduce((s, r) => s + (r.amount || 0), 0);
                                          const firstAmt  = Math.round(Math.max(0, totalAdj - othersSum) * 100) / 100;
                                          updated[0] = { ...updated[0], amount: firstAmt };
                                        }
                                        return { ...m, splits: updated };
                                      });
                                    }} />
                                </td>
                                <td style={{ padding: '6px 4px' }}>
                                  <Select size="small" style={{ width: '100%' }} showSearch
                                    placeholder="Select activity…"
                                    loading={recvActivitiesLoading}
                                    value={sp.activityName || undefined}
                                    disabled={isReadOnly}
                                    filterOption={(input, option) =>
                                      String(option?.value ?? '').toLowerCase().includes(input.toLowerCase()) ||
                                      String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                    }
                                    onChange={async val => {
                                      const act = recvActivities.find(a => a.name === val);
                                      let combo = act?.accountCombination || '';
                                      const buName = tabs.find(t => t.key === adjSplitModal!.tabKey)?.draft.businessUnit ?? '';
                                      const coCode = businessUnits.find(b => b.name === buName)?.companyCode ?? '';
                                      if (coCode && combo) {
                                        const segs = combo.split('-');
                                        segs[0] = coCode;
                                        combo = segs.join('-');
                                      }
                                      let desc = '';
                                      if (combo) {
                                        try {
                                          const r = await validateAccountCode(combo.replace(/\./g, '-'));
                                          const sd = r.segmentDetails ?? {};
                                          const acctEntry = Object.values(sd).find((s: any) => { const n = (s.name ?? '').toLowerCase(); return n === 'account' || (n.includes('account') && !n.includes('sub') && !n.includes('chart') && !n.includes('offset')); });
                                          const subEntry  = Object.values(sd).find((s: any) => (s.name ?? '').toLowerCase().includes('sub'));
                                          const parts = [acctEntry?.description, subEntry?.description].filter(Boolean);
                                          desc = parts.length ? parts.join(' · ') : Object.values(sd).map((s: any) => s.description).filter(Boolean).join(' · ');
                                        } catch { /* silent */ }
                                      }
                                      updateSplit(sp.id, { activityName: val, accountCombination: combo, accountDescription: desc });
                                    }}>
                                    {recvActivities.map(a => (
                                      <Option key={a.name} value={a.name} label={a.name}>
                                        <div style={{ lineHeight: 1.3 }}>
                                          <div style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</div>
                                          {a.accountCombination && (
                                            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#8c8c8c' }}>{a.accountCombination}</div>
                                          )}
                                        </div>
                                      </Option>
                                    ))}
                                  </Select>
                                </td>
                                <td style={{ padding: '6px 4px' }}>
                                  <Input.Search size="small"
                                    placeholder="Select from segments popup →"
                                    value={sp.accountCombination}
                                    readOnly
                                    disabled={isReadOnly}
                                    style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'default' }}
                                    enterButton={<SearchOutlined />}
                                    onSearch={() => !isReadOnly && setSplitAcctPickerSplitId(sp.id)}
                                  />
                                  {sp.accountDescription && (
                                    <div style={{ fontSize: 10, color: sp.accountDescription === 'Invalid account' ? REDWOOD.primary : REDWOOD.info, marginTop: 2, lineHeight: 1.3 }}>
                                      {sp.accountDescription}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '6px 4px' }}>
                                  <Input size="small" placeholder="Reason…" value={sp.reason}
                                    disabled={isReadOnly}
                                    onChange={e => updateSplit(sp.id, { reason: e.target.value })} />
                                </td>
                                <td style={{ padding: '6px 4px' }}>
                                  {splits.length > 1 && !isReadOnly && (
                                    <Button size="small" type="text" danger icon={<DeleteOutlined />}
                                      style={{ padding: '0 4px' }}
                                      onClick={() => removeSplit(sp.id)} />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!isBalanced && (
                          <div style={{ marginTop: 8, textAlign: 'right' }}>
                            <Button size="small" type="link" style={{ color: REDWOOD.info }}
                              onClick={() => {
                                if (splits.length > 0) {
                                  const last = splits[splits.length - 1];
                                  updateSplit(last.id, { amount: Math.round((last.amount + remaining) * 100) / 100 });
                                }
                              }}>
                              Auto-fill remaining {fmt(Math.abs(remaining))} to last line
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </Modal>
                );
              })()}

              {/* ── Installment Picker API Inspector ── */}
              <Modal
                open={instPickerApiOpen}
                onCancel={() => setInstPickerApiOpen(false)}
                footer={<Button onClick={() => setInstPickerApiOpen(false)}>Close</Button>}
                width={820}
                title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><Text strong>Open Invoices &amp; Installments — API Inspector</Text></Space>}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* 1. Fetch invoices */}
                  {(() => {
                    const url = `${APEX_AR_INVOICES}?bill_to_customer=${draft.customerAccountNumber || '{customerAccountNumber}'}&limit=200`;
                    return (
                      <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: '12px 14px', background: '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Tag color="blue" style={{ fontWeight: 700 }}>GET</Tag>
                          <Text strong style={{ fontSize: 13 }}>1. Fetch Open Invoices by Customer</Text>
                          <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto', color: REDWOOD.info }}
                            onClick={() => { navigator.clipboard.writeText(url); message.success('URL copied'); }} />
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all', padding: '6px 10px', background: '#f0f5ff', borderRadius: 5, marginBottom: 6 }}>{url}</div>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Returns all AR invoices for the selected customer. Each invoice's <code>CustomerTransactionId</code> is then used to fetch installments.</Text>
                      </div>
                    );
                  })()}

                  {/* 2. Fetch installments */}
                  {(() => {
                    const url = `${APEX_AR_INVOICES}/{CustomerTransactionId}/installments`;
                    return (
                      <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: '12px 14px', background: '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Tag color="blue" style={{ fontWeight: 700 }}>GET</Tag>
                          <Text strong style={{ fontSize: 13 }}>2. Fetch Installments per Invoice</Text>
                          <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto', color: REDWOOD.info }}
                            onClick={() => { navigator.clipboard.writeText(url); message.success('URL copied'); }} />
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all', padding: '6px 10px', background: '#f0f5ff', borderRadius: 5, marginBottom: 6 }}>{url}</div>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Called in parallel for each invoice. Only installments with <code>installment_balance_due &gt; 0</code> are shown.</Text>
                      </div>
                    );
                  })()}

                  {/* 3. POST receipt application */}
                  {(() => {
                    const url = APEX_RECEIPT_APPS;
                    const selKeys = instPickerSel[tabKey] ?? [];
                    const allRows = instPickerRows[tabKey] ?? [];
                    const exRow   = allRows.find(r => selKeys.includes(r.key)) ?? allRows[0];
                    const applyAmt = exRow ? (exRow.applyAmount ?? exRow.balanceDue) : null;
                    const body = JSON.stringify({
                      StandardReceiptId:          draft.standardReceiptId || 0,
                      ApplicationDate:            draft.receiptDate || dayjs().format('YYYY-MM-DD'),
                      AccountingDate:             draft.accountingDate || dayjs().format('YYYY-MM-DD'),
                      ApplicationAmount:          applyAmt ?? '<applyAmount>',
                      AdjustmentAmount:           exRow?.adjustmentAmount || undefined,
                      ApplicationStatus:          'APP',
                      ReferenceTransactionId:     exRow?.customerTransactionId ?? '<customerTransactionId>',
                      ReferenceTransactionNumber: exRow?.transactionNumber      ?? '<transactionNumber>',
                      ReferenceInstallmentId:     exRow?.installmentId          ?? '<installmentId>',
                      ActivityName:               'Invoice',
                      ProcessStatus:              'PENDING',
                      IsLatestApplication:        'Y',
                      CustomerSite:               draft.customerSite || '',
                      CreatedBy:                  currentUser,
                      LastUpdatedBy:              currentUser,
                    }, null, 2);
                    return (
                      <div style={{ border: `1px solid #b7eb8f`, borderRadius: 8, padding: '12px 14px', background: '#f6ffed' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Tag color="green" style={{ fontWeight: 700 }}>POST</Tag>
                          <Text strong style={{ fontSize: 13 }}>3. Create Receipt Application</Text>
                          <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>— called once per selected installment</Text>
                          <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto', color: REDWOOD.info }}
                            onClick={() => { navigator.clipboard.writeText(`${url}\n\n${body}`); message.success('Copied'); }} />
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.success, wordBreak: 'break-all', padding: '4px 10px', background: '#f0fff0', borderRadius: 5, marginBottom: 8 }}>{url}</div>
                        <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre' }}>{body}</div>
                        {exRow && <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>Showing values for installment: {exRow.transactionNumber} / Inst #{exRow.sequenceNumber}</Text>}
                      </div>
                    );
                  })()}

                  {/* 4. POST adjustment */}
                  {(() => {
                    const url = `${APEX_DB_CONFIG.baseUrl}/ar/adjustments`;
                    const selKeys = instPickerSel[tabKey] ?? [];
                    const allRows = instPickerRows[tabKey] ?? [];
                    const exRow   = allRows.find(r => selKeys.includes(r.key)) ?? allRows[0];
                    const applyAmt = exRow ? (exRow.applyAmount ?? exRow.balanceDue) : 0;
                    const adjAmt   = exRow?.adjustmentAmount ?? 0;
                    const body = JSON.stringify({
                      CustomerTransactionId: exRow?.customerTransactionId ?? '<customerTransactionId>',
                      TransactionNumber:     exRow?.transactionNumber      ?? '<transactionNumber>',
                      AdjustmentAmount:      exRow ? adjAmt : '<adjustmentAmount>',
                      AdjustmentDate:        draft.receiptDate || dayjs().format('YYYY-MM-DD'),
                      AccountingDate:        draft.accountingDate || dayjs().format('YYYY-MM-DD'),
                      AdjustmentType:        'LINE',
                      Status:                'Approved',
                      ReceivablesActivity:   'Adjustment',
                      BusinessUnit:          draft.businessUnit || '',
                      Currency:              exRow?.currency || draft.currency || 'AED',
                      InstallmentNumber:     exRow?.sequenceNumber ?? '<sequenceNumber>',
                      InstallmentBalance:    exRow ? Math.max(0, exRow.balanceDue - applyAmt - adjAmt) : '<remaining balance>',
                      AdjustmentReason:      exRow?.adjustmentReason || '<adjustmentReason>',
                      ApplicationId:         '<from Application POST>',
                      Comments:              `Auto-created from receipt ${draft.receiptNumber || ''}`,
                    }, null, 2);
                    return (
                      <div style={{ border: `1px solid #ffd591`, borderRadius: 8, padding: '12px 14px', background: '#fffbe6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Tag color="orange" style={{ fontWeight: 700 }}>POST</Tag>
                          <Text strong style={{ fontSize: 13 }}>4. Create AR Adjustment</Text>
                          <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>— only when Adjustment Amount &gt; 0</Text>
                          <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto', color: REDWOOD.info }}
                            onClick={() => { navigator.clipboard.writeText(`${url}\n\n${body}`); message.success('Copied'); }} />
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#d46b08', wordBreak: 'break-all', padding: '4px 10px', background: '#fff7e6', borderRadius: 5, marginBottom: 8 }}>{url}</div>
                        <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre' }}>{body}</div>
                      </div>
                    );
                  })()}

                </div>
              </Modal>

              {/* ── Save Progress Modal ── */}
              {saveProgress?.open && (
                <Modal
                  open={saveProgress.open}
                  title={<Space><SaveOutlined style={{ color: REDWOOD.success }} /><Text strong>Saving Receipt</Text></Space>}
                  footer={saveProgress.done ? <Button type="primary" onClick={() => setSaveProgress(null)}>Close</Button> : null}
                  closable={saveProgress.done}
                  onCancel={() => saveProgress.done && setSaveProgress(null)}
                  width={500}
                >
                  <Steps
                    direction="vertical"
                    size="small"
                    current={saveProgress.current}
                    items={saveProgress.steps.map(s => ({
                      title: s.title,
                      status: s.status,
                      description: s.detail ? <Text style={{ fontSize: 11, color: s.status === 'error' ? REDWOOD.primary : REDWOOD.neutral600 }}>{s.detail}</Text> : undefined,
                    }))}
                  />
                </Modal>
              )}

              {/* ── Save & Debug Modal ── */}
              {debugModal?.open && (
                <Modal
                  open={debugModal.open}
                  title={<Space><CodeOutlined style={{ color: REDWOOD.info }} /><Text strong>Save &amp; Debug — API Step Runner</Text></Space>}
                  onCancel={() => setDebugModal(null)}
                  footer={<Button onClick={() => setDebugModal(null)}>Close</Button>}
                  width={860}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {debugModal.steps.map((step, idx) => (
                      <div key={idx} style={{ border: `1px solid ${REDWOOD.border}`, borderRadius: 8, padding: '10px 14px', background: step.done ? '#f6ffed' : '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Tag color={step.method === 'POST' ? 'green' : step.method === 'PUT' ? 'orange' : 'blue'} style={{ fontWeight: 700 }}>{step.method}</Tag>
                          <Text strong style={{ fontSize: 12, flex: 1 }}>{step.label}</Text>
                          <Button size="small" type="primary" loading={step.running}
                            disabled={step.done || (debugModal?.steps.slice(0, idx).some(s => s.response?.includes('"installmentStatus":"Closed"') || s.response?.includes('"installmentStatus": "Closed"')))}
                            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                            onClick={async () => {
                              setDebugModal(prev => prev ? { ...prev, steps: prev.steps.map((s, i) => i === idx ? { ...s, running: true } : s) } : prev);
                              try {
                                const url = step.url;
                                // For adjustment POSTs, substitute the captured applicationId placeholder
                                let bodyToSend = step.body;
                                if (step.method !== 'GET' && bodyToSend.includes('"ApplicationId"')) {
                                  const capturedIds = debugModal?.capturedAppIds ?? [];
                                  // Count how many adj steps preceded this one to pick the right appId
                                  const adjStepsBefore = debugModal?.steps.slice(0, idx).filter(s => s.url.includes('/ar/adjustments') && s.method === 'POST').length ?? 0;
                                  const appId = capturedIds[adjStepsBefore] ?? capturedIds[capturedIds.length - 1] ?? 0;
                                  bodyToSend = bodyToSend.replace(/"ApplicationId"\s*:\s*"[^"]*"/, `"ApplicationId": ${appId}`);
                                  bodyToSend = bodyToSend.replace(/"ApplicationId"\s*:\s*<[^>]*>/, `"ApplicationId": ${appId}`);
                                }
                                const res = await fetch(url, {
                                  method: step.method,
                                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                  body: step.method !== 'GET' ? bodyToSend : undefined,
                                });
                                const text = await res.text();
                                // After a successful receipt-application POST, capture the returned applicationId
                                if (step.method === 'POST' && step.url.includes('/ar/receipt-applications') && res.ok) {
                                  try {
                                    const j = JSON.parse(text);
                                    const appId = j.applicationId ?? j.application_id;
                                    if (appId) {
                                      setDebugModal(prev => prev ? { ...prev, capturedAppIds: [...(prev.capturedAppIds ?? []), Number(appId)] } : prev);
                                    }
                                  } catch { /* non-fatal */ }
                                }
                                const isClosed = step.method === 'GET' && (() => {
                                  try { const j = JSON.parse(text); return j.installmentStatus === 'Closed'; } catch { return false; }
                                })();
                                setDebugModal(prev => {
                                  if (!prev) return prev;
                                  const steps = prev.steps.map((s, i) => {
                                    if (i === idx) return { ...s, running: false, done: true, response: `HTTP ${res.status}\n${text}` };
                                    if (isClosed && i > idx) return { ...s, done: true, response: '⛔ Blocked — installment is Closed. Remove it from Receipt Applications and retry.' };
                                    return s;
                                  });
                                  return { ...prev, steps };
                                });
                                if (isClosed) {
                                  message.error({ content: 'Installment is already Closed — all subsequent steps blocked. Remove it from Receipt Applications.', duration: 8 });
                                  if (debugModal?.tabKey) {
                                    const tk = debugModal.tabKey;
                                    setPendingApplications(prev => {
                                      const instId = parseInt(url.split('/installments/')[1]);
                                      return { ...prev, [tk]: (prev[tk] ?? []).map(r => r.installmentId === instId ? { ...r, _closed: true } : r) };
                                    });
                                  }
                                }
                              } catch (e: any) {
                                setDebugModal(prev => prev ? { ...prev, steps: prev.steps.map((s, i) => i === idx ? { ...s, running: false, response: `Error: ${e.message}` } : s) } : prev);
                              }
                            }}>
                            ▶ Run
                          </Button>
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 10, color: REDWOOD.info, wordBreak: 'break-all', padding: '3px 8px', background: '#f0f5ff', borderRadius: 4, marginBottom: 6 }}>{step.url}</div>
                        {step.method !== 'GET' && (
                          <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 5, fontFamily: 'monospace', fontSize: 10, maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre' }}>{step.body}</div>
                        )}
                        {step.response && (
                          <div style={{ marginTop: 6, background: step.response.includes('error') || step.response.includes('Error') ? '#fff1f0' : '#f6ffed', border: `1px solid ${step.response.includes('error') || step.response.includes('Error') ? '#ffccc7' : '#b7eb8f'}`, padding: 6, borderRadius: 4, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre-wrap' }}>
                            {step.response}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Modal>
              )}

              </>
            );
          })()}

        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const q = gridFilter.trim().toLowerCase();
  const filteredRows = q
    ? searchRows.filter(r =>
        [r.receiptNumber, r.customerName, r.customerAccountNumber, r.receiptMethod,
         r.state, r.status, r.remittanceBankName, r.businessUnit, r.currency,
         r.receiptDate, String(r.amount ?? 0), fmt(r.amount ?? 0), r.syncStatus]
          .some(v => (v || '').toLowerCase().includes(q))
      )
    : searchRows;

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 20px' }}>

        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/ar">Accounts Receivable</Link> },
          { title: 'Manage Receipts' },
        ]} />

        <Space style={{ marginBottom: 14 }} align="center">
          <DollarOutlined style={{ fontSize: 22, color: REDWOOD.success }} />
          <Title level={4} style={{ margin: 0 }}>Manage Receipts</Title>
          <Button type="primary" icon={<PlusOutlined />}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success, marginLeft: 16 }}
            onClick={openNewTab}>
            Create New Receipt
          </Button>
        </Space>

        <Tabs type="editable-card" hideAdd activeKey={activeKey} onChange={setActiveKey}
          onEdit={(key, action) => { if (action === 'remove') closeTab(String(key)); }}
          items={[
            // ── Search tab ───────────────────────────────────────────────
            {
              key: 'search',
              label: <span><SearchOutlined style={{ marginRight: 4 }} />Search</span>,
              closable: false,
              children: (
                <div style={{ paddingTop: 4 }}>
                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Form form={searchForm} layout="inline" size="small" onFinish={handleSearch}>
                      <Row gutter={[8, 8]} style={{ width: '100%' }}>
                        {/* Row 1 */}
                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item name="businessUnit" label="Business Unit"
                            rules={[{ required: true, message: 'Required' }]}
                            style={{ marginBottom: 0, width: '100%' }}>
                            <Select style={{ width: '100%' }} placeholder="Select BU" allowClear showSearch
                              filterOption={(input, opt) =>
                                String(opt?.children ?? '').toLowerCase().includes(input.toLowerCase())
                              }>
                              {businessUnits.map(bu => (
                                <Option key={bu.name} value={bu.name}>
                                  {bu.companyCode ? `${bu.name} — ${bu.companyCode}` : bu.name}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                        </Col>

                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item label="Customer" style={{ marginBottom: 0, width: '100%' }}>
                            <Form.Item name="customer" noStyle><Input type="hidden" /></Form.Item>
                            <Input readOnly
                              value={lovSelected ? `${lovSelected.accountName} (${lovSelected.accountNumber})` : ''}
                              placeholder="Click to search…"
                              style={{ cursor: 'pointer', background: '#fff' }}
                              onClick={() => openLov('search')}
                              suffix={lovSelected
                                ? <CloseOutlined style={{ fontSize: 11, cursor: 'pointer' }}
                                    onClick={e => { e.stopPropagation(); setLovSelected(null); }} />
                                : <SearchOutlined style={{ color: REDWOOD.info, cursor: 'pointer' }}
                                    onClick={() => openLov('search')} />
                              }
                            />
                          </Form.Item>
                        </Col>

                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item name="receiptNumber" label="Receipt #" style={{ marginBottom: 0 }}>
                            <Input placeholder="Receipt number" allowClear style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>

                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item name="receiptType" label="Receipt Type" style={{ marginBottom: 0 }}>
                            <Select style={{ width: '100%' }} placeholder="All" allowClear>
                              <Option value="CASH">CASH</Option>
                              <Option value="MISC">MISC</Option>
                            </Select>
                          </Form.Item>
                        </Col>

                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item name="currency" label="Currency" style={{ marginBottom: 0 }}>
                            <Select style={{ width: '100%' }} placeholder="Any" allowClear>
                              {['AED', 'USD', 'EUR', 'GBP', 'SAR', 'QAR', 'KWD'].map(c =>
                                <Option key={c} value={c}>{c}</Option>
                              )}
                            </Select>
                          </Form.Item>
                        </Col>

                        {/* Row 2 */}
                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item name="state" label="State" style={{ marginBottom: 0 }}>
                            <Select style={{ width: '100%' }} placeholder="Any" allowClear>
                              {['Applied', 'Unapplied', 'On Account', 'Reversed', 'NSF', 'Stop'].map(s =>
                                <Option key={s} value={s}>{s}</Option>
                              )}
                            </Select>
                          </Form.Item>
                        </Col>

                        <Col xs={24} sm={12} md={8} lg={6}>
                          <Form.Item name="status" label="Status" style={{ marginBottom: 0 }}>
                            <Select style={{ width: '100%' }} placeholder="Any" allowClear>
                              {['Cleared', 'Uncleared', 'Reversed', 'Remitted'].map(s =>
                                <Option key={s} value={s}>{s}</Option>
                              )}
                            </Select>
                          </Form.Item>
                        </Col>

                        {/* Date preset + picker */}
                        <Col xs={24} sm={24} md={16} lg={12}>
                          <Form.Item label="Receipt Date" style={{ marginBottom: 0 }}>
                            <Space>
                              <Radio.Group size="small" value={datePreset}
                                onChange={e => applyDatePreset(e.target.value)}>
                                <Radio.Button value="today">Today</Radio.Button>
                                <Radio.Button value="last7">Last 7d</Radio.Button>
                                <Radio.Button value="last30">Last 30d</Radio.Button>
                                <Radio.Button value="range">Range</Radio.Button>
                              </Radio.Group>
                              <Form.Item name="dateRange" noStyle>
                                <RangePicker size="small" format="DD-MMM-YYYY" style={{ width: 230 }}
                                  onChange={() => setDatePreset('range')} />
                              </Form.Item>
                            </Space>
                          </Form.Item>
                        </Col>

                        {/* Search button */}
                        <Col xs={24} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <Space>
                            <Button onClick={() => { searchForm.resetFields(); setLovSelected(null); setDatePreset('range'); }}>
                              Clear
                            </Button>
                            <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={searching}
                              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                              Search
                            </Button>
                          </Space>
                        </Col>
                      </Row>
                    </Form>
                  </Card>

                  {/* Results */}
                  <Card size="small" style={{ borderRadius: 8 }}
                    title={
                      <Space wrap>
                        <Badge count={filteredRows.length} style={{ backgroundColor: REDWOOD.primary }} overflowCount={9999} />
                        <Text strong>Receipts</Text>
                        {gridFilter && searchRows.length !== filteredRows.length && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            ({searchRows.length} total, {filteredRows.length} shown)
                          </Text>
                        )}
                      </Space>
                    }
                    extra={
                      <Space size="small">
                        <Input size="small" allowClear
                          prefix={<FilterOutlined style={{ color: REDWOOD.neutral600 }} />}
                          placeholder="Filter results…" style={{ width: 200 }}
                          value={gridFilter} onChange={e => setGridFilter(e.target.value)} />
                        {lastSearchUrl && (
                          <Tooltip title="Show last API request URL">
                            <Button size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                              onClick={() => Modal.info({
                                title: 'Search API Request',
                                width: 720,
                                content: (
                                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                    <div style={{ marginBottom: 6 }}><strong>Method:</strong> GET</div>
                                    <div style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: '8px 10px', wordBreak: 'break-all' }}>
                                      {lastSearchUrl}
                                    </div>
                                    <div style={{ marginTop: 10, color: '#888', fontSize: 11 }}>
                                      Tip: paste this URL in a browser to see the raw ORDS JSON response and verify ACCOUNTING_STATUS is returned.
                                    </div>
                                  </div>
                                ),
                              })} />
                          </Tooltip>
                        )}
                        <Tooltip title="Export to Excel">
                          <Button size="small" icon={<DownloadOutlined />}
                            disabled={filteredRows.length === 0}
                            onClick={() => exportToExcel(filteredRows)}>Excel</Button>
                        </Tooltip>
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => setGridFilter('')} />
                      </Space>
                    }
                  >
                    <Table<ReceiptRow>
                      dataSource={filteredRows} columns={searchColumns} rowKey="key"
                      size="small" loading={searching}
                      pagination={{ pageSize: 50, size: 'small', showSizeChanger: true,
                        showTotal: t => `${t} receipts` }}
                      scroll={{ x: 1800, y: 500 }}
                      onRow={r => ({ onDoubleClick: () => openReceiptTab(r), style: { cursor: 'pointer' } })}
                    />
                  </Card>
                </div>
              ),
            },

            // ── Dynamic receipt tabs ─────────────────────────────────────
            ...tabs.map(tab => ({
              key:      tab.key,
              closable: true,
              label: (
                <span style={{ fontSize: 12 }}>
                  <DollarOutlined style={{ marginRight: 4, color: REDWOOD.success }} />
                  {tab.draft.standardReceiptId === 0
                    ? 'New Receipt'
                    : tab.draft.receiptNumber
                      ? tab.draft.receiptNumber
                      : tab.draft.standardReceiptId > 0
                        ? `ID ${tab.draft.standardReceiptId}`
                        : 'New Receipt'}
                </span>
              ),
              children: renderReceiptPanel(tab),
            })),
          ]}
        />
      </Content>
      <FloatingMenu />

      {/* Receipt PDF Preview Modal */}
      <Modal
        open={receiptPdfModal}
        title={<Space><PrinterOutlined /><span>Receipt Voucher</span></Space>}
        onCancel={() => { setReceiptPdfModal(false); if (receiptPdfUrl) { URL.revokeObjectURL(receiptPdfUrl); setReceiptPdfUrl(null); } }}
        footer={
          <Space>
            <Button icon={<PrinterOutlined />} type="primary"
              onClick={() => { if (receiptPdfUrl) { const w = window.open(receiptPdfUrl); w?.print(); } }}>
              Print
            </Button>
            <Button icon={<DownloadOutlined />}
              onClick={() => { if (receiptPdfUrl) { const a = document.createElement('a'); a.href = receiptPdfUrl; a.download = 'receipt.pdf'; a.click(); } }}>
              Download PDF
            </Button>
            <Button onClick={() => { setReceiptPdfModal(false); if (receiptPdfUrl) { URL.revokeObjectURL(receiptPdfUrl); setReceiptPdfUrl(null); } }}>
              Close
            </Button>
          </Space>
        }
        width={860}
        styles={{ body: { padding: 0, height: '75vh' } }}
      >
        {receiptPdfUrl && (
          <iframe src={receiptPdfUrl} title="Receipt PDF" style={{ width: '100%', height: '100%', border: 'none' }} />
        )}
      </Modal>

      {/* Attachment Preview Modal */}
      {previewAtt && (
        <Modal
          open title={<Space><PaperClipOutlined /><span>{previewAtt.name}</span></Space>}
          onCancel={() => { URL.revokeObjectURL(previewAtt.blobUrl); setPreviewAtt(null); }}
          footer={<Button onClick={() => { URL.revokeObjectURL(previewAtt.blobUrl); setPreviewAtt(null); }}>Close</Button>}
          width={860}
          styles={{ body: { padding: 0, maxHeight: '70vh', overflow: 'auto' } }}
        >
          {previewAtt.fileType.startsWith('image/') ? (
            <img src={previewAtt.blobUrl} alt={previewAtt.name} style={{ width: '100%' }} />
          ) : previewAtt.fileType === 'application/pdf' ? (
            <iframe src={previewAtt.blobUrl} title={previewAtt.name} style={{ width: '100%', height: '65vh', border: 'none' }} />
          ) : (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Text type="secondary">Preview not available for this file type.</Text>
              <br />
              <Button icon={<DownloadOutlined />} style={{ marginTop: 12 }}
                onClick={() => { const a = document.createElement('a'); a.href = previewAtt.blobUrl; a.download = previewAtt.name; a.click(); }}>
                Download
              </Button>
            </div>
          )}
        </Modal>
      )}

      {/* Attachment API Debug Modal */}
      <Modal
        open={!!attApiDebug}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Attachment API Request</span></Space>}
        onCancel={() => setAttApiDebug(null)}
        footer={<Button onClick={() => setAttApiDebug(null)}>Close</Button>}
        width={700}
      >
        {attApiDebug && (
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>Method:</Text> <Text code>POST</Text>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text strong>URL:</Text>
              <div style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: '6px 10px', marginTop: 4, wordBreak: 'break-all' }}>
                {attApiDebug.url}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text strong>Headers:</Text>
              <div style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: '6px 10px', marginTop: 4 }}>
                {`Content-Type: application/json`}
              </div>
            </div>
            <div>
              <Text strong>Body (first pending attachment):</Text>
              <pre style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: '8px 10px', marginTop: 4, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {attApiDebug.body}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* Customer LOV Modal — shared for search panel and receipt tabs */}
      <Modal
        title={
          <Space>
            <UserOutlined style={{ color: REDWOOD.info }} />
            <span>{lovContext === 'search' ? 'Search Customers' : 'Select Customer'}</span>
          </Space>
        }
        open={lovVisible} onCancel={() => setLovVisible(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {lovLoading ? 'Loading…' : `${lovRows.length.toLocaleString()} of ${lovAllRows.length.toLocaleString()} customers`}
            </Text>
            <Button onClick={() => setLovVisible(false)}>Cancel</Button>
          </div>
        }
        width={680} styles={{ body: { padding: '12px 24px' } }}
      >
        <Input autoFocus allowClear
          prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
          placeholder="Filter by name or account number…"
          value={lovSearch} onChange={e => setLovSearch(e.target.value)}
          style={{ marginBottom: 8 }} />
        <Table
          dataSource={lovRows} rowKey="custAccountId" size="small"
          loading={lovLoading}
          pagination={{ pageSize: 15, size: 'small', showTotal: t => `${t} customers` }}
          onRow={c => ({ onClick: () => onLovSelect(c), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Account #', dataIndex: 'accountNumber', width: 130,
              render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{v}</Text> },
            { title: 'Customer Name', dataIndex: 'accountName',
              render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
          ]}
        />
      </Modal>

      {/* ── API Inspector Modal ─────────────────────────────────────────── */}
      {apiModal && (() => {
        const tab = tabs.find(t => t.key === apiModal.tabKey);
        if (!tab) return null;
        const { draft } = tab;
        const isNew     = draft.standardReceiptId === 0;
        const receiptId = isNew ? null : draft.standardReceiptId;
        const payload   = buildPayload(draft, receiptId);
        const bodyJson = JSON.stringify(payload, null, 2);
        const postUrl  = APEX_AR_RECEIPTS;
        const deleteUrl = `${APEX_AR_RECEIPTS}/${draft.standardReceiptId}`;

        const runTest = async () => {
          setApiModal(prev => prev ? { ...prev, testing: true, testResult: null } : null);
          try {
            const res    = await fetch(postUrl, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(payload),
            });
            const text = await res.text();
            setApiModal(prev => prev
              ? { ...prev, testing: false, testResult: `HTTP ${res.status}\n\n${text}` }
              : null);
          } catch (e: any) {
            setApiModal(prev => prev
              ? { ...prev, testing: false, testResult: `Error: ${e.message}` }
              : null);
          }
        };

        return (
          <Modal
            title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — Receipt</span></Space>}
            open onCancel={() => setApiModal(null)}
            width={720}
            footer={
              <Space>
                <Button icon={<SendOutlined />} type="primary" loading={apiModal.testing}
                  style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                  onClick={runTest}>
                  Test POST
                </Button>
                <Button onClick={() => setApiModal(null)}>Close</Button>
              </Space>
            }
            styles={{ body: { padding: '12px 24px' } }}
          >
            {/* POST endpoint */}
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                POST Endpoint
              </Text>
              <div style={{ background: '#f0f7ff', border: '1px solid #bae0ff', borderRadius: 4,
                padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                <Tag color="blue" style={{ fontSize: 11, marginRight: 8 }}>POST</Tag>
                {postUrl}
              </div>
            </div>

            {/* DELETE endpoint (only for saved receipts) */}
            {!isNew && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                  DELETE Endpoint
                </Text>
                <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4,
                  padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  <Tag color="red" style={{ fontSize: 11, marginRight: 8 }}>DELETE</Tag>
                  {deleteUrl}
                </div>
              </div>
            )}

            {/* JSON Payload */}
            <div style={{ marginBottom: apiModal.testResult ? 12 : 0 }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                POST Body (JSON)
              </Text>
              <pre style={{
                background: '#1e1e1e', color: '#d4d4d4', borderRadius: 6,
                padding: '10px 14px', fontSize: 11, maxHeight: 320,
                overflowY: 'auto', margin: 0, lineHeight: 1.5,
              }}>
                {bodyJson}
              </pre>
            </div>

            {/* Test result */}
            {apiModal.testResult && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                  Response
                </Text>
                <pre style={{
                  background: apiModal.testResult.startsWith('HTTP 2')
                    ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${apiModal.testResult.startsWith('HTTP 2') ? '#b7eb8f' : '#ffccc7'}`,
                  borderRadius: 6, padding: '8px 12px', fontSize: 11,
                  maxHeight: 160, overflowY: 'auto', margin: 0, whiteSpace: 'pre-wrap',
                }}>
                  {apiModal.testResult}
                </pre>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ── API Services Info Modal ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Services</span></Space>}
        open={apiInfoVisible} onCancel={() => setApiInfoVisible(false)}
        footer={<Button onClick={() => setApiInfoVisible(false)}>Close</Button>}
        width={760}
      >
        <Table
          size="small" pagination={false}
          dataSource={[
            { key: 1, service: 'AR Receipts',             method: 'GET / POST / PUT', url: APEX_AR_RECEIPTS },
            { key: 2, service: 'AR Receipt Applications', method: 'GET',              url: APEX_RECEIPT_APPS },
            { key: 3, service: 'AR Customers',            method: 'GET',              url: `${APEX_DB_CONFIG.baseUrl}/ar/customers` },
            { key: 4, service: 'Business Units',          method: 'GET',              url: `${APEX_DB_CONFIG.baseUrl}/gl/businessunits` },
            { key: 5, service: 'Receipt Method Accounts', method: 'GET',              url: ORDS_RECEIPT_METHOD_ACCOUNTS },
            { key: 6, service: 'GL Segment Values',       method: 'GET',              url: 'chartofaccounts/structuresegments (via AccountSelector)' },
            { key: 7, service: 'FX Daily Rates',          method: 'GET',              url: `${GL_ORDS_BASE}/currencies/dailyrates` },
            { key: 8, service: 'SLA Create Accounting',   method: 'POST',             url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/create` },
            { key: 9, service: 'SLA Post to Ledger',      method: 'POST',             url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/post` },
            { key: 10, service: 'GL Journals Create',     method: 'POST',             url: `${APEX_DB_CONFIG.baseUrl}/journals/create` },
          ]}
          columns={[
            { title: 'Service', dataIndex: 'service', width: 200, render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
            { title: 'Method', dataIndex: 'method', width: 130,
              render: v => v.split(' / ').map((m: string) => (
                <Tag key={m} color={m === 'GET' ? 'blue' : m === 'POST' ? 'green' : 'orange'} style={{ fontSize: 10, margin: '0 2px' }}>{m}</Tag>
              )) },
            { title: 'URL', dataIndex: 'url', render: v => <Text style={{ fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>{v}</Text> },
          ]}
        />
      </Modal>

      {/* ── AccountSelector for Dr / Cr Account ── */}
      {miscAcctVisible && (() => {
        const miscTab = tabs.find(t => t.key === miscAcctTabKey);
        const companyCode = businessUnits.find(b => b.name === miscTab?.draft.businessUnit)?.companyCode ?? '';
        return (
          <AccountSelector
            visible={miscAcctVisible}
            lockedFirstSegment={companyCode || undefined}
            onSelect={(code, segments) => {
              const desc = Object.values(segments ?? {})
                .map((s: any) => s.description).filter(Boolean).join(' · ');
              const descField = miscAcctField === 'drAccount' ? 'drAccountDesc' : 'crAccountDesc';
              updateDraft(miscAcctTabKey, { [miscAcctField]: code, [descField]: desc } as any);
              setMiscAcctVisible(false);
            }}
            onCancel={() => setMiscAcctVisible(false)}
          />
        );
      })()}

      {/* ── AccountSelector for Adj Split account combination ── */}
      {splitAcctPickerSplitId && adjSplitModal && (() => {
        const splitTab = tabs.find(t => t.key === adjSplitModal.tabKey);
        const splitCompanyCode = businessUnits.find(b => b.name === splitTab?.draft.businessUnit)?.companyCode ?? '';
        const splitCurrentCombo = adjSplitModal.splits.find(s => s.id === splitAcctPickerSplitId)?.accountCombination ?? '';
        return (
          <AccountSelector
            visible
            initialValue={splitCurrentCombo || undefined}
            lockedFirstSegment={splitCompanyCode || undefined}
            onSelect={(code, segments) => {
              const acctEntry  = Object.values(segments ?? {}).find((s: any) => {
                const n = (s.name ?? '').toLowerCase();
                return n === 'account' || (n.includes('account') && !n.includes('sub') && !n.includes('chart') && !n.includes('offset'));
              });
              const subEntry   = Object.values(segments ?? {}).find((s: any) => (s.name ?? '').toLowerCase().includes('sub'));
              const descParts  = [acctEntry?.description, subEntry?.description].filter(Boolean);
              const desc       = descParts.length ? descParts.join(' · ') : Object.values(segments ?? {}).map((s: any) => s.description).filter(Boolean).join(' · ');
              setAdjSplitModal(m => m ? {
                ...m,
                splits: m.splits.map(s => s.id === splitAcctPickerSplitId
                  ? { ...s, accountCombination: code, accountDescription: desc }
                  : s),
              } : m);
              setSplitAcctPickerSplitId(null);
            }}
            onCancel={() => setSplitAcctPickerSplitId(null)}
          />
        );
      })()}

      {/* ── View Accounting Modal ── */}
      {viewAcctModal && (() => {
        const vhdr = viewAcctModal.header;
        const batchStatus: string = vhdr?.batchStatus || '';
        const isPosted = batchStatus.toUpperCase() === 'POSTED' || batchStatus === 'Posted';
        const batchId: number = vhdr?.batchId ?? 0;
        const postUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${batchId}/post`;
        // A journal is missing if the receipt has none, or any adjustment has none.
        const anyMissing = !vhdr || (viewAcctModal.adjGroups ?? []).some(g => !g.found);
        const handleViewPost = async () => {
          if (!batchId) return;
          setViewAcctModal(m => m ? { ...m, posting: true } : m);
          const r = await postJournal(batchId);
          if (r.success) {
            setViewAcctModal(m => m ? { ...m, posting: false, header: { ...m.header, batchStatus: 'Posted' } } : m);
            message.success('Journal posted successfully');
          } else {
            setViewAcctModal(m => m ? { ...m, posting: false } : m);
            message.error('Post failed: ' + (r.error || r.message));
          }
        };
        return (
        <Modal
          open
          title={<Space>
            <EyeOutlined style={{ color: '#722ed1' }} />
            <span>GL Journal — Receipt {viewAcctModal.receiptNumber}</span>
            {(viewAcctModal.apiUrls?.length ?? 0) > 0 && (
              <Tooltip
                title={
                  <div style={{ maxWidth: 520 }}>
                    <div style={{ fontSize: 11, marginBottom: 4, opacity: 0.85 }}>Retrieval endpoints (matched by reference2 + reference5):</div>
                    {viewAcctModal.apiUrls!.map((u, i) => (
                      <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff', wordBreak: 'break-all', marginBottom: 2 }}>{u}</div>
                    ))}
                  </div>
                }>
                <ApiOutlined style={{ color: REDWOOD.info, cursor: 'help', fontSize: 14 }} />
              </Tooltip>
            )}
          </Space>}
          onCancel={() => setViewAcctModal(null)}
          footer={
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                {!isPosted && batchId > 0 && (
                  <>
                    <Tooltip title={<Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', wordBreak: 'break-all' }}>{`PUT ${postUrl}`}</Text>}>
                      <ApiOutlined style={{ color: REDWOOD.info, cursor: 'help' }} />
                    </Tooltip>
                    <Button type="primary" size="small" icon={<BookOutlined />}
                      loading={viewAcctModal.posting}
                      onClick={handleViewPost}>
                      Post to Ledger
                    </Button>
                  </>
                )}
                {/* Any journal (receipt or adjustment) missing → offer Create Accounting with debug */}
                {anyMissing && viewAcctModal.tabKey && (
                  <Tooltip title="A GL journal is missing (receipt or adjustment). Open Create Accounting and show the API Steps Preview so you can create/debug the journal.">
                    <Button danger type="primary" size="small" icon={<BookOutlined />}
                      onClick={() => {
                        const tk = viewAcctModal.tabKey!;
                        setViewAcctModal(null);
                        openAcctModal(tk, true);   // true → auto-open the debug panel
                      }}>
                      Create Accounting
                    </Button>
                  </Tooltip>
                )}
              </Space>
              <Space>
                {/* When everything is found, still allow jumping to Create Accounting
                    + debug (skips already-posted ones). */}
                {!anyMissing && viewAcctModal.tabKey && (
                  <Button size="small" icon={<CodeOutlined />}
                    onClick={() => {
                      const tk = viewAcctModal.tabKey!;
                      setViewAcctModal(null);
                      openAcctModal(tk, true);
                    }}>
                    Create Accounting (Debug)
                  </Button>
                )}
                <Button onClick={() => setViewAcctModal(null)}>Close</Button>
              </Space>
            </Space>
          }
          width={900}
        >
          {viewAcctModal.loading
            ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading journal lines…" /></div>
            : (() => {
                const journalColumns: ColumnsType<any> = [
                  { title: 'Line', dataIndex: 'lineNumber', width: 50, render: (_: any, __: any, i: number) => i + 1 },
                  { title: 'Account', dataIndex: 'accountCombination', width: 180,
                    render: (v: string, r: any) => {
                      const segDesc = r.accountDesc
                        ? r.accountDesc.split(' · ').filter((s: string) => s && s !== 'Default').slice(1).join(' · ')
                        : '';
                      return (
                        <Tooltip title={<><div style={{ fontFamily: 'monospace' }}>{v}</div>{r.accountDesc && <div style={{ fontSize: 11, marginTop: 2 }}>{r.accountDesc}</div>}</>} placement="topLeft">
                          <div style={{ cursor: 'default' }}>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.info, whiteSpace: 'nowrap', display: 'block' }}>{v}</Text>
                            {segDesc && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 1 }}>{segDesc}</div>}
                          </div>
                        </Tooltip>
                      );
                    } },
                  { title: 'Description', dataIndex: 'description', width: 260,
                    render: (v: string) => (
                      <Tooltip title={v} placement="topLeft">
                        <div style={{
                          fontSize: 11, color: REDWOOD.neutral600, cursor: 'default',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden', wordBreak: 'break-word',
                        }}>{v || '—'}</div>
                      </Tooltip>
                    ) },
                  { title: 'Dr', dataIndex: 'enteredDr', width: 130, align: 'right' as const,
                    render: (v: number) => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : <Text type="secondary">—</Text> },
                  { title: 'Cr', dataIndex: 'enteredCr', width: 130, align: 'right' as const,
                    render: (v: number) => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.primary }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : <Text type="secondary">—</Text> },
                  { title: 'Ref2', dataIndex: 'reference2', width: 120, render: (v: string) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
                ];
                return (
                  <>
                    {/* ── Receipt journal ── */}
                    <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag color="blue" style={{ margin: 0 }}>Receipt Journal</Tag>
                      {vhdr
                        ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0 }}>Found in GL</Tag>
                        : <Tag icon={<CloseCircleOutlined />} color="error" style={{ margin: 0 }}>Not in GL</Tag>}
                    </div>
                    {vhdr ? (
                      <>
                        <Descriptions size="small" bordered column={3} style={{ marginBottom: 12 }}>
                          <Descriptions.Item label="Journal Name">{vhdr.description || vhdr.journalName || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Batch">{vhdr.glBatchName || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Status">
                            <Tag color={isPosted ? 'green' : 'orange'}>{batchStatus || 'NEW'}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="Period">{vhdr.periodName || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Acctg Date">{vhdr.accountingDate || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Created By">{vhdr.createdBy || vhdr.postedBy || '—'}</Descriptions.Item>
                        </Descriptions>
                        <Table
                          dataSource={(viewAcctModal.lines || []).map((l: any, i: number) => ({ ...l, key: i }))}
                          size="small" pagination={false} scroll={{ x: 'max-content' }}
                          columns={journalColumns}
                        />
                      </>
                    ) : (
                      <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                        message={`No GL journal found for receipt "${viewAcctModal.receiptNumber}"`} />
                    )}

                    {/* ── Adjustment journals ── */}
                    {(viewAcctModal.adjGroups ?? []).length > 0 && (
                      <>
                        <Divider style={{ margin: '16px 0 8px' }} />
                        <Tag color="purple" style={{ marginBottom: 8 }}>Adjustment Journals</Tag>
                        {viewAcctModal.adjGroups.map((grp, gi) => (
                          <div key={gi} style={{ marginBottom: 16 }}>
                            <div style={{
                              background: grp.found ? '#f5f0ff' : '#fff1f0',
                              border: `1px solid ${grp.found ? '#d3adf7' : '#ffccc7'}`, borderRadius: 4,
                              padding: '4px 10px', marginBottom: 6, fontSize: 12,
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                              <ScissorOutlined style={{ color: '#722ed1' }} />
                              <span style={{ fontWeight: 600, color: '#722ed1' }}>Adj #{grp.adjustmentId}</span>
                              <span style={{ color: '#595959' }}>{grp.batchName}</span>
                              {grp.found
                                ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: '0 0 0 auto' }}>Found in GL</Tag>
                                : <Tag icon={<CloseCircleOutlined />} color="error" style={{ margin: '0 0 0 auto' }}>Not in GL</Tag>}
                            </div>
                            {grp.found ? (
                              <Table
                                dataSource={(grp.lines || []).map((l: any, i: number) => ({ ...l, key: i }))}
                                size="small" pagination={false} scroll={{ x: 'max-content' }}
                                columns={journalColumns}
                              />
                            ) : (
                              <Alert type="warning" showIcon style={{ marginBottom: 4 }}
                                message={`No GL journal found for adjustment #${grp.adjustmentId}`} />
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                );
              })()
          }
        </Modal>
        );
      })()}

      {/* ── Create / Post Accounting Modal ── */}
      {acctModal?.visible && (() => {
        const tab = tabs.find(t => t.key === acctModal.tabKey);
        const draft2 = tab?.draft;
        const amount = Math.abs(draft2?.amount ?? 0);
        const isPosted = acctModal.slaStatus === 'POSTED';
        const exRate = draft2?.conversionRate ?? 1;
        const period = draft2?.receiptDate ? derivePeriodName(new Date(draft2.receiptDate)) : '—';
        const allDone = acctModal.rcptGlPosted &&
          (acctModal.adjItems.length === 0 || acctModal.adjItems.every(a => a.glPosted || a.postStatus === 'done'));
        return (
          <Modal
            title={
              <Space>
                <BookOutlined style={{ color: REDWOOD.success }} />
                <span>Accounting — Receipt {draft2?.receiptNumber}</span>
                {acctModal.slaHeaderId && (
                  <Tag color="green" style={{ fontSize: 11 }}>SLA #{acctModal.slaHeaderId}</Tag>
                )}
                {isPosted && <Tag color="purple" style={{ fontSize: 11 }}>POSTED</Tag>}
              </Space>
            }
            open onCancel={() => setAcctModal(null)}
            width={900}
            styles={{ body: { maxHeight: '75vh', overflowY: 'auto', paddingRight: 4 } }}
            footer={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Button
                    icon={<CodeOutlined />}
                    loading={acctModal.adjLoading}
                    onClick={buildDebugSteps}
                    title="Preview all API steps with full URLs and payloads"
                  >
                    {acctModal.showDebug ? 'Refresh Debug' : 'Debug'}
                  </Button>
                  {acctModal.showDebug && (
                    <Button
                      type="text"
                      size="small"
                      onClick={() => setAcctModal(m => m ? { ...m, showDebug: false } : m)}
                    >
                      Hide
                    </Button>
                  )}
                </Space>
                <Space>
                  <Button
                    type="primary" icon={<BookOutlined />}
                    loading={acctModal.creating}
                    disabled={allDone}
                    style={!allDone ? { background: REDWOOD.success, borderColor: REDWOOD.success } : {}}
                    onClick={handleCreateAccounting}
                  >
                    {allDone ? 'All Accounted' : 'Run / Create Accounting'}
                  </Button>
                  <Button onClick={() => setAcctModal(null)}>Close</Button>
                </Space>
              </div>
            }
          >
            {/* ── Receipt GL status ── */}
            <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 12 }}>Receipt GL:</Text>
              {acctModal.adjLoading
                ? <Tag>Checking…</Tag>
                : acctModal.rcptGlPosted
                  ? <Tag color="green">Already Posted — Batch #{acctModal.rcptGlBatchId}</Tag>
                  : acctModal.rcptGlExists
                    ? <Tag color="orange">Exists (Unposted)</Tag>
                    : <Tag color="blue">Not yet posted</Tag>}
              {acctModal.slaHeaderId && (
                <Tag color="purple">SLA #{acctModal.slaHeaderId}</Tag>
              )}
              {acctModal.glBatchId && (
                <Tag color="cyan">GL Batch #{acctModal.glBatchId}</Tag>
              )}
            </div>

            {/* ── Step progress ── */}
            {acctModal.steps.length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f9f9f9', borderRadius: 6, border: '1px solid #f0f0f0' }}>
                {acctModal.steps.map((s, i) => {
                  const icon = s.status === 'running' ? <Spin size="small" style={{ marginRight: 6 }} />
                    : s.status === 'done' ? <CheckCircleOutlined style={{ color: REDWOOD.success, marginRight: 6 }} />
                    : s.status === 'skipped' ? <MinusCircleOutlined style={{ color: '#bfbfbf', marginRight: 6 }} />
                    : s.status === 'error' ? <CloseCircleOutlined style={{ color: REDWOOD.primary, marginRight: 6 }} />
                    : <ClockCircleOutlined style={{ color: '#bfbfbf', marginRight: 6 }} />;
                  return (
                    <div key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                      {icon}
                      <Text style={{ fontSize: 11 }}>{s.label}</Text>
                      {s.detail && <Text type="secondary" style={{ fontSize: 10, marginLeft: 6 }}>— {s.detail}</Text>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Debug Panel ── */}
            {acctModal.showDebug && acctModal.debugSteps && (
              <div style={{ marginBottom: 16, border: `1px solid ${REDWOOD.border}`, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ background: '#1f1f1f', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CodeOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                  <Text style={{ color: '#e6e6e6', fontSize: 12, fontWeight: 600 }}>API Steps Preview</Text>
                  <Text style={{ color: '#888', fontSize: 11 }}>— {acctModal.debugSteps.length} steps · click a step to expand payload · Run fires that call individually (ids resolve from earlier runs in the same group)</Text>
                </div>
                {acctModal.debugSteps.map((step, si) => {
                  const isGroupHeader = si === 0 || acctModal.debugSteps![si - 1].group !== step.group;
                  const statusColor = step.status === 'done' ? REDWOOD.success
                    : step.status === 'running' ? '#1677ff'
                    : step.status === 'error' ? REDWOOD.primary
                    : step.status === 'skipped' ? '#bfbfbf'
                    : '#8c8c8c';
                  const methodColor = step.method === 'POST' ? '#52c41a' : step.method === 'PUT' ? '#faad14' : '#1677ff';
                  return (
                    <div key={step.id}>
                      {isGroupHeader && (
                        <div style={{ background: '#2a2a2a', padding: '3px 12px', borderTop: '1px solid #333' }}>
                          <Text style={{ color: '#aaa', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                            {step.group === 'receipt' ? '▸ Receipt' : `▸ ${step.group.replace('adj-', 'Adjustment #')}`}
                          </Text>
                          {step.skipReason && (
                            <Text style={{ color: '#faad14', fontSize: 10, marginLeft: 8 }}>⚠ All steps skipped: {step.skipReason}</Text>
                          )}
                        </div>
                      )}
                      <div
                        style={{ borderTop: '1px solid #2a2a2a', background: step.expanded ? '#141414' : '#1a1a1a', cursor: 'pointer' }}
                        onClick={() => setAcctModal(m => !m ? m : {
                          ...m,
                          debugSteps: m.debugSteps!.map((s, i) => i === si ? { ...s, expanded: !s.expanded } : s),
                        })}
                      >
                        <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {step.status === 'running' ? <Spin size="small" />
                            : step.status === 'done' ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 12 }} />
                            : step.status === 'error' ? <CloseCircleOutlined style={{ color: REDWOOD.primary, fontSize: 12 }} />
                            : step.status === 'skipped' ? <MinusCircleOutlined style={{ color: '#555', fontSize: 12 }} />
                            : <ClockCircleOutlined style={{ color: '#555', fontSize: 12 }} />}
                          <Tag style={{ fontSize: 10, fontWeight: 700, padding: '0 4px', margin: 0, background: methodColor, border: 'none', color: '#fff' }}>{step.method}</Tag>
                          <Text style={{ fontSize: 11, fontFamily: 'monospace', color: step.skipReason ? '#555' : '#d4d4d4', flex: 1 }} ellipsis={{ tooltip: step.url }}>
                            {step.url}
                          </Text>
                          {step.detail && <Text style={{ fontSize: 10, color: statusColor }}>{step.detail}</Text>}
                          <Tooltip title={`Run this ${step.method} now`}>
                            <Button
                              size="small"
                              type="primary"
                              ghost
                              icon={<PlayCircleOutlined />}
                              loading={runningStepIdx === si}
                              onClick={(e) => { e.stopPropagation(); runDebugStep(si); }}
                              style={{ height: 22, fontSize: 10, padding: '0 8px', lineHeight: '20px' }}
                            >
                              Run
                            </Button>
                          </Tooltip>
                          <Text style={{ fontSize: 10, color: '#555' }}>{step.expanded ? '▲' : '▼'}</Text>
                        </div>
                        {step.expanded && (
                          <div style={{ padding: '0 12px 10px 32px', display: 'flex', gap: 12 }}>
                            {step.payload && (
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: '#888', fontSize: 10, display: 'block', marginBottom: 4 }}>Request Payload:</Text>
                                <pre style={{
                                  fontSize: 10, lineHeight: 1.5, color: '#a8ff78',
                                  background: '#0d0d0d', borderRadius: 4, padding: '8px 10px',
                                  margin: 0, overflowX: 'auto', maxHeight: 300,
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                }}>
                                  {JSON.stringify(step.payload, null, 2)}
                                </pre>
                              </div>
                            )}
                            {step.responseData !== undefined && (
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: '#888', fontSize: 10, display: 'block', marginBottom: 4 }}>Response:</Text>
                                <pre style={{
                                  fontSize: 10, lineHeight: 1.5, color: '#79c0ff',
                                  background: '#0d0d0d', borderRadius: 4, padding: '8px 10px',
                                  margin: 0, overflowX: 'auto', maxHeight: 300,
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                }}>
                                  {JSON.stringify(step.responseData, null, 2)}
                                </pre>
                              </div>
                            )}
                            {!step.payload && step.responseData === undefined && (
                              <Text style={{ color: '#555', fontSize: 10 }}>No body (URL only)</Text>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SLA Header ── */}
            <div style={{ marginBottom: 10 }}>
              <Text strong style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 6 }}>
                SLA Header
              </Text>
              <Descriptions bordered size="small" column={3}
                labelStyle={{ fontSize: 11, fontWeight: 600, background: '#fafafa', whiteSpace: 'nowrap' }}
                contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
              >
                <Descriptions.Item label="Module">AR</Descriptions.Item>
                <Descriptions.Item label="Source Table">AR_RECEIPTS</Descriptions.Item>
                <Descriptions.Item label="Source ID">{draft2?.standardReceiptId}</Descriptions.Item>
                <Descriptions.Item label="Receipt #">{draft2?.receiptNumber}</Descriptions.Item>
                <Descriptions.Item label="Event Type">{draft2?.receiptType === 'MISC' ? 'AR_MISC_RECEIPT' : 'AR_CASH_RECEIPT'}</Descriptions.Item>
                <Descriptions.Item label="Source Type">Receipt</Descriptions.Item>
                <Descriptions.Item label="Receipt Date">{draft2?.receiptDate || '—'}</Descriptions.Item>
                <Descriptions.Item label="Accounting Date">{draft2?.accountingDate || draft2?.receiptDate || '—'}</Descriptions.Item>
                <Descriptions.Item label="Period">{period}</Descriptions.Item>
                <Descriptions.Item label="Currency">{draft2?.currency || 'AED'}</Descriptions.Item>
                <Descriptions.Item label="Ledger Currency">AED</Descriptions.Item>
                <Descriptions.Item label="Exchange Rate">{exRate !== 1 ? exRate : '1 (functional)'}</Descriptions.Item>
                <Descriptions.Item label="Rate Type">{draft2?.conversionRateType || 'Corporate'}</Descriptions.Item>
                <Descriptions.Item label="Business Unit">{draft2?.businessUnit}</Descriptions.Item>
                <Descriptions.Item label="Created By">{currentUser}</Descriptions.Item>
                <Descriptions.Item label="Description" span={3}>
                  Receipt {draft2?.receiptNumber}
                </Descriptions.Item>
              </Descriptions>
            </div>

            {/* ── GL Batch / Header ── */}
            <div style={{ marginBottom: 10 }}>
              <Text strong style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 6 }}>
                GL Journal Header
              </Text>
              <Descriptions bordered size="small" column={3}
                labelStyle={{ fontSize: 11, fontWeight: 600, background: '#fafafa', whiteSpace: 'nowrap' }}
                contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
              >
                <Descriptions.Item label="Batch Name" span={2}>{`AR-${draft2?.receiptNumber}-<timestamp>`}</Descriptions.Item>
                <Descriptions.Item label="Batch Source">Accounts Receivable</Descriptions.Item>
                <Descriptions.Item label="JE Category">Receipts</Descriptions.Item>
                <Descriptions.Item label="JE Source">Receivables</Descriptions.Item>
                <Descriptions.Item label="Period">{period}</Descriptions.Item>
                <Descriptions.Item label="Journal Name">{`AR-${draft2?.receiptNumber}`}</Descriptions.Item>
                <Descriptions.Item label="Effective Date">{draft2?.receiptDate || '—'}</Descriptions.Item>
                <Descriptions.Item label="Control Total" ><Text style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(amount)}</Text></Descriptions.Item>
              </Descriptions>
            </div>

            {/* ── Journal Lines ── */}
            <div style={{ marginBottom: 6 }}>
              <Text strong style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 6 }}>
                Journal Lines
              </Text>
            </div>
            <Table
              size="small" pagination={false}
              dataSource={acctModal.lines.map((l, i) => ({ ...l, key: i }))}
              scroll={{ x: 900 }}
              columns={[
                { title: 'Type', dataIndex: 'lineType', width: 55,
                  render: v => <Tag color={v === 'DR' ? 'blue' : 'green'} style={{ fontSize: 11, fontWeight: 700 }}>{v}</Tag> },
                { title: 'Class', dataIndex: 'accountingClass', width: 90,
                  render: v => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v}</Text> },
                { title: 'Account', dataIndex: 'accountCombination', width: 150,
                  render: (v, r: any) => {
                    const acctSegDesc = r.accountDesc
                      ? r.accountDesc.split(' · ').filter((s: string) => s && s !== 'Default').slice(1).join(' · ')
                      : '';
                    return (
                      <Tooltip title={<><div>{v}</div>{r.accountDesc && <div style={{ fontSize: 10, marginTop: 2 }}>{r.accountDesc}</div>}</>} placement="topLeft">
                        <div style={{ minWidth: 130, cursor: 'default' }}>
                          <Text style={{ fontSize: 11, fontFamily: 'monospace', color: v ? REDWOOD.info : '#bfbfbf', whiteSpace: 'nowrap', display: 'block' }}>{v || '— not set —'}</Text>
                          {acctSegDesc && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2, whiteSpace: 'nowrap' }}>{acctSegDesc}</div>}
                        </div>
                      </Tooltip>
                    );
                  } },
                { title: 'Line Description', dataIndex: 'description', width: 240,
                  render: (v: any) => (
                    <Tooltip title={v} placement="topLeft">
                      <div style={{ fontSize: 11, color: REDWOOD.neutral600,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', wordBreak: 'break-word', cursor: 'default' }}>{v || '—'}</div>
                    </Tooltip>
                  ) },
                { title: 'App Ref', dataIndex: 'ref', width: 80,
                  render: v => v ? <Text style={{ fontSize: 10, fontFamily: 'monospace', color: '#888' }}>{v}</Text> : <Text type="secondary">—</Text> },
                { title: 'Debit', dataIndex: 'enteredDr', width: 110, align: 'right' as const,
                  render: v => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: REDWOOD.success, whiteSpace: 'nowrap' }}>{fmt(v)}</Text> : <Text type="secondary">—</Text> },
                { title: 'Credit', dataIndex: 'enteredCr', width: 110, align: 'right' as const,
                  render: v => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: REDWOOD.primary, whiteSpace: 'nowrap' }}>{fmt(v)}</Text> : <Text type="secondary">—</Text> },
              ]}
              summary={() => {
                const totalDr = acctModal.lines.reduce((s, l) => s + l.enteredDr, 0);
                const totalCr = acctModal.lines.reduce((s, l) => s + l.enteredCr, 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={5}><Text strong style={{ fontSize: 11 }}>Total</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success }}>{fmt(totalDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">
                      <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(totalCr)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />

            {/* ── Adjustments (one journal per adjustment) ── */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Text strong style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Adjustments</Text>
                {acctModal.adjLoading
                  ? <Tag color="blue" style={{ fontSize: 10 }}>Checking GL…</Tag>
                  : acctModal.adjItems.length > 0
                    ? <Tag color="orange" style={{ fontSize: 10 }}>{acctModal.adjItems.length} adjustment(s) — separate journal per adjustment</Tag>
                    : <Tag style={{ fontSize: 10 }}>No adjustments</Tag>}
                {acctModal.adjApiUrls.length > 0 && (
                  <Tooltip title={<div style={{ fontFamily: 'monospace', fontSize: 11 }}>{acctModal.adjApiUrls.map((u, i) => <div key={i}>{u}</div>)}</div>} placement="topLeft">
                    <LinkOutlined style={{ fontSize: 12, color: REDWOOD.info, cursor: 'pointer' }} />
                  </Tooltip>
                )}
              </div>
              {acctModal.adjLoading
                ? <div style={{ padding: 16, textAlign: 'center' }}><Spin size="small" /></div>
                : acctModal.adjItems.length > 0 && acctModal.adjItems.map((adj, ai) => {
                  const glStatus = adj.postStatus === 'running' ? <Spin size="small" />
                    : adj.postStatus === 'done'  ? <Tag color="green"  style={{ fontSize: 10 }}>Posted — {adj.postDetail}</Tag>
                    : adj.postStatus === 'error' ? <Tag color="red"    style={{ fontSize: 10 }}>{adj.postDetail}</Tag>
                    : adj.glPosted               ? <Tag color="green"  style={{ fontSize: 10 }}>Already Posted — Batch #{adj.glBatchId}</Tag>
                    : adj.glExists               ? <Tag color="orange" style={{ fontSize: 10 }}>Exists (Unposted)</Tag>
                    : <Tag color="blue" style={{ fontSize: 10 }}>Pending</Tag>;
                  return (
                    <div key={ai} style={{ marginBottom: 12, border: `1px solid ${REDWOOD.border}`, borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#fafafa', padding: '5px 10px', borderBottom: '1px solid #f0f0f0' }}>
                        <Text strong style={{ fontSize: 11 }}>Adj #{adj.adjustmentId}</Text>
                        {adj.transactionNumber && <Text style={{ fontSize: 11 }}>· {adj.transactionNumber}</Text>}
                        <Tag color="purple" style={{ fontSize: 10 }}>{adj.activity}</Tag>
                        <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{fmt(adj.amount)}</Text>
                        <span style={{ marginLeft: 'auto' }}>{glStatus}</span>
                        <Text style={{ fontSize: 10, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>
                          ref {adj.adjustmentId} / {adj.adjustmentId} / AR_ADJUSTMENTS
                        </Text>
                      </div>
                      <Table
                        size="small" pagination={false}
                        dataSource={adj.lines.map((l, i) => ({ ...l, key: i }))}
                        scroll={{ x: 720 }}
                        columns={[
                          { title: 'Type', dataIndex: 'lineType', width: 55,
                            render: v => <Tag color={v === 'DR' ? 'blue' : 'green'} style={{ fontSize: 11, fontWeight: 700 }}>{v}</Tag> },
                          { title: 'Class', dataIndex: 'accountingClass', width: 100,
                            render: v => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v}</Text> },
                          { title: 'Account', dataIndex: 'accountCombination',
                            render: (v, r: any) => (
                              <div style={{ minWidth: 130 }}>
                                <Text style={{ fontSize: 11, fontFamily: 'monospace', color: v ? REDWOOD.info : '#bfbfbf', whiteSpace: 'nowrap', display: 'block' }}>{v || '— not set —'}</Text>
                                {r.accountDesc && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>{r.accountDesc}</div>}
                              </div>
                            ) },
                          { title: 'Line Description', dataIndex: 'description',
                            render: (v: any) => <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '—'}</Text> },
                          { title: 'Debit', dataIndex: 'enteredDr', width: 110, align: 'right' as const,
                            render: v => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: REDWOOD.success }}>{fmt(v)}</Text> : <Text type="secondary">—</Text> },
                          { title: 'Credit', dataIndex: 'enteredCr', width: 110, align: 'right' as const,
                            render: v => v ? <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: REDWOOD.primary }}>{fmt(v)}</Text> : <Text type="secondary">—</Text> },
                        ]}
                      />
                    </div>
                  );
                })}
            </div>

            <div style={{ marginTop: 10, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 11 }}>
              <Text type="secondary">
                Currency: <strong>{draft2?.currency || 'AED'}</strong>
                {draft2?.conversionRate && draft2.conversionRate !== 1 && <> · Rate: <strong>{draft2.conversionRate}</strong></>}
                {' · '}BU: <strong>{draft2?.businessUnit}</strong>
                {' · '}DR description: Comments + Receipt# · CR description: Invoice# + App Ref
              </Text>
            </div>
          </Modal>
        );
      })()}

      {/* ── Copy Receipt Modal ── */}
      {copyModal && (
        <Modal
          open
          title={<Space><CopyOutlined style={{ color: REDWOOD.info }} /><span>Copy Receipt — {copyModal.draft.receiptNumber}</span></Space>}
          onCancel={() => { if (!copying) setCopyModal(null); }}
          width={680}
          footer={[
            <Button key="cancel" onClick={() => setCopyModal(null)} disabled={copying}>Cancel</Button>,
            <Button key="copy" type="primary" icon={<CopyOutlined />} loading={copying}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
              onClick={handleConfirmCopy}>
              Copy Receipt
            </Button>,
          ]}
        >
          <Alert
            type="info" showIcon style={{ marginBottom: 16 }}
            message="A new receipt will be created with the data below."
            description={<>Receipt Number will be set to <strong>Copy:{copyModal.draft.receiptNumber}</strong>. Accounting Date and Accounting Status will be blank.</>}
          />
          <Descriptions bordered size="small" column={2} labelStyle={{ fontWeight: 600, fontSize: 12 }} contentStyle={{ fontSize: 12 }}>
            <Descriptions.Item label="New Receipt #" span={2}>
              <Text strong style={{ color: REDWOOD.info }}>Copy:{copyModal.draft.receiptNumber}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Receipt Type">{copyModal.draft.receiptType || '—'}</Descriptions.Item>
            <Descriptions.Item label="Business Unit">{copyModal.draft.businessUnit || '—'}</Descriptions.Item>
            <Descriptions.Item label="Receipt Method">{copyModal.draft.receiptMethod || '—'}</Descriptions.Item>
            <Descriptions.Item label="Currency">{copyModal.draft.currency || '—'}</Descriptions.Item>
            <Descriptions.Item label="Receipt Date">{copyModal.draft.receiptDate || '—'}</Descriptions.Item>
            <Descriptions.Item label="Accounting Date"><Text type="secondary">— (blank)</Text></Descriptions.Item>
            <Descriptions.Item label="Amount" span={2}>
              <Text strong style={{ fontFamily: 'monospace', fontSize: 14 }}>
                {copyModal.draft.amount?.toLocaleString('en-AE', { minimumFractionDigits: 2 }) ?? '0.00'}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Customer" span={2}>{copyModal.draft.customerName || copyModal.draft.customerAccountNumber || '—'}</Descriptions.Item>
            <Descriptions.Item label="Customer Site">{copyModal.draft.customerSite || '—'}</Descriptions.Item>
            <Descriptions.Item label="Customer Account #">{copyModal.draft.customerAccountNumber || '—'}</Descriptions.Item>
            <Descriptions.Item label="Remittance Bank" span={2}>{copyModal.draft.remittanceBankName || '—'}</Descriptions.Item>
            <Descriptions.Item label="Bank Account #">{copyModal.draft.remittanceBankAccountNumber || '—'}</Descriptions.Item>
            <Descriptions.Item label="State">{copyModal.draft.state || '—'}</Descriptions.Item>
            <Descriptions.Item label="Comments" span={2}>{copyModal.draft.comments || '—'}</Descriptions.Item>
            <Descriptions.Item label="DR Account">{copyModal.draft.drAccount || '—'}</Descriptions.Item>
            <Descriptions.Item label="CR Account">{copyModal.draft.crAccount || '—'}</Descriptions.Item>
            <Descriptions.Item label="Accounting Status" span={2}><Text type="secondary">— (blank)</Text></Descriptions.Item>
          </Descriptions>
        </Modal>
      )}

    </Layout>
  );
};

export default ManageReceipts;
