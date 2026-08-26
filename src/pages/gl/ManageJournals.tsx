import { buildApexUrl, buildCurrencyUrl } from '../../config/api.helper';
import React, { useState, useEffect, useRef } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Layout,
  Card,
  Form,
  Select,
  Input,
  InputNumber,
  Button,
  Space,
  Typography,
  Table,
  Tag,
  Row,
  Col,
  Breadcrumb,
  Tooltip,
  Dropdown,
  Collapse,
  message,
  DatePicker,
  Tabs,
  Modal,
  Spin,
  Descriptions,
  Alert,
  Progress,
  Switch,
  Upload,
  Popover,
} from 'antd';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { postJournal, updateJournal, getLookupValues } from '../../services/manage-journals.service';
import type { MenuProps } from 'antd';
import {
  HomeOutlined,
  AccountBookOutlined,
  SearchOutlined,
  ReloadOutlined,
  SaveOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  PrinterOutlined,
  EyeOutlined,
  RollbackOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  FilterOutlined,
  CheckSquareOutlined,
  BarChartOutlined,
  FileTextOutlined,
  SwapOutlined,
  ReconciliationOutlined,
  CalendarOutlined,
  AuditOutlined,
  DollarOutlined,
  ProfileOutlined,
  PieChartOutlined,
  LineChartOutlined,
  FundOutlined,
  CloseOutlined,
  BugOutlined,
  CopyOutlined,
  ApiOutlined,
  CheckOutlined,
  CloudOutlined,
  WarningOutlined,
  LoadingOutlined,
  StopOutlined,
  LockOutlined,
  PaperClipOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  RobotOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FilePdfOutlined,
  FileAddOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import AccountSelector, { validateAccountCode } from '../../components/AccountSelector';
import CreateJournal from './CreateJournal';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const { Content } = Layout;
const { Text } = Typography;
const { Option } = Select;
const { Panel } = Collapse;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral400: '#bfbfbf',
  neutral500: '#8c8c8c',
  error: '#D93025',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  taskBlue: '#0572CE',
  reportGreen: '#1D7B4D',
};

// Menu item type for floating panels
interface FloatingMenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  color?: string;
  path?: string;
}

// Task menu items
const taskMenuItems: FloatingMenuItem[] = [
  { key: 'account-analysis', icon: <FundOutlined />, label: 'Account Analysis', description: 'Account detail analysis', color: REDWOOD.warning, path: '/gl/account-analysis' },
  { key: 'manage-journals', icon: <AccountBookOutlined />, label: 'Manage Journals', description: 'Search and manage journal entries', color: REDWOOD.primary, path: '/gl/manage-journals' },
  { key: 'journal-entry', icon: <FileTextOutlined />, label: 'Create Journal', description: 'Create manual journal entry', color: REDWOOD.taskBlue, path: '/gl/create-journal' },
  { key: 'import-journals', icon: <SwapOutlined />, label: 'Import Journals', description: 'Import from spreadsheet', color: REDWOOD.info },
  { key: 'reverse-journal', icon: <ReconciliationOutlined />, label: 'Reverse Journal', description: 'Reverse posted journals', color: REDWOOD.warning },
  { key: 'open-period', icon: <CalendarOutlined />, label: 'Open Period', description: 'Open accounting period', color: REDWOOD.success },
  { key: 'close-period', icon: <AuditOutlined />, label: 'Close Period', description: 'Close accounting period', color: REDWOOD.primaryDark },
  { key: 'revaluation', icon: <DollarOutlined />, label: 'Run Revaluation', description: 'Foreign currency revaluation', color: REDWOOD.primary },
];

// Report menu items
const reportMenuItems: FloatingMenuItem[] = [
  { key: 'trial-balance', icon: <ProfileOutlined />, label: 'Trial Balance', description: 'View trial balance report', color: REDWOOD.reportGreen },
  { key: 'balance-sheet', icon: <PieChartOutlined />, label: 'Balance Sheet', description: 'Financial position report', color: REDWOOD.info },
  { key: 'income-statement', icon: <LineChartOutlined />, label: 'Income Statement', description: 'Profit and loss report', color: REDWOOD.success },
  { key: 'journal-report', icon: <FileTextOutlined />, label: 'Journal Report', description: 'Posted journals listing', color: REDWOOD.taskBlue },
  { key: 'account-analysis', icon: <FundOutlined />, label: 'Account Analysis', description: 'Account detail analysis', color: REDWOOD.warning },
  { key: 'gl-balances', icon: <BarChartOutlined />, label: 'GL Balances', description: 'General ledger balances', color: REDWOOD.primary },
];

// API Base URL
const API_BASE_URL = buildApexUrl('gl/journals');

// Ledger interface from API
interface Ledger {
  ledger_id: number;
  ledger_name: string;
  description: string;
  ledger_category_code: string;
  currency_code: string;
  chart_of_accounts_id: string;
}

// Period interface from API
interface Period {
  period_name_id: string;
  ledger_name: string;
  app: string;
  application_name: string;
  status: string;
  start_date: string;
  end_date: string;
  period_year: number;
  period_number: number;
  adj_flag: string;
}

// Journal data interface matching API response
interface JournalLine {
  lineId: number;
  lineNum: number;
  account: string;
  description: string;
  enteredDr: number;
  enteredCr: number;
  accountedDr: number;
  accountedCr: number;
  currency: string;
  conversionRate?: number;
  conversionRateType?: string;
  conversionDate?: string;
  accountDescription?: string;
  reference1?: string; reference2?: string; reference3?: string; reference4?: string; reference5?: string;
  reference6?: string; reference7?: string; reference8?: string; reference9?: string; reference10?: string;
}

interface JournalRecord {
  key: string;
  // Batch fields
  batchId: number;
  jeBatchId: number;
  batchName: string;
  batchDescription: string;
  source: string;
  status: string;
  statusMeaning: string;
  approvalStatusMeaning: string;
  postedDate: string | null;
  // Header fields
  headerId: number;
  jeHeaderId: number;
  journalName: string;
  journalDescription: string;
  periodName: string;
  category: string;
  ledgerName: string;
  legalEntityName: string;
  currencyCode: string;
  conversionRate: number;
  conversionRateType: string;
  enteredDebit: number;
  enteredCredit: number;
  accountedDebit: number;
  accountedCredit: number;
  effectiveDate: string;
  externalReference: string;
  creationDate: string;
  balanceType?: string;
  // Lines
  lines: JournalLine[];
}

interface ApiResponse {
  success: boolean;
  totalCount: number;
  offset: number;
  limit: number;
  items: JournalRecord[];
  error?: string;
}

// Note: Ledgers and Periods are now fetched from API dynamically

// Batch statuses
const batchStatuses = ['Posted', 'Unposted', 'NEW', 'Error', 'Pending', 'All'];

// Operators
const operators = ['Starts with', 'Equals', 'Contains', 'Ends with'];

// Session storage key for preserving search data
const STORAGE_KEY = 'manageJournals_searchData';

// Interface for open journal tabs
interface OpenJournalTab {
  key: string;
  journal: JournalRecord;
  sourceUrl?: string;
  isNewDraft?: boolean;
}

// Debug log entry
interface DebugLogEntry {
  timestamp: string;
  type: 'request' | 'response' | 'info' | 'error';
  message: string;
  data?: any;
}

// Bulk post item
type BulkPostStatus = 'pending' | 'posting' | 'posted' | 'validation_failed' | 'failed' | 'skipped';
interface BulkPostItem {
  key: string;
  journal: JournalRecord;
  status: BulkPostStatus;
  validationErrors: string[];
  serverError?: string;
}

const ManageJournals: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [journals, setJournals] = useState<JournalRecord[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchExpanded, setSearchExpanded] = useState<string[]>(['search']);

  // Ledger and Period state
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [selectedLedger, setSelectedLedger] = useState<Ledger | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);

  // GL Categories for search dropdown
  const [glCategories, setGLCategories] = useState<{ jeCategoryName: string; userJeCategoryName: string }[]>([]);

  // Accounting date range filter
  const [acctDatePreset, setAcctDatePreset] = useState<string | null>(null);
  const [acctFromDate, setAcctFromDate] = useState<Dayjs | null>(null);
  const [acctToDate, setAcctToDate] = useState<Dayjs | null>(null);

  const getAcctDateRange = (): { from: Dayjs | null; to: Dayjs | null } => {
    const today = dayjs();
    switch (acctDatePreset) {
      case 'today':  return { from: today, to: today };
      case 'last15': return { from: today.subtract(14, 'day'), to: today };
      case 'last30': return { from: today.subtract(29, 'day'), to: today };
      case 'last60': return { from: today.subtract(59, 'day'), to: today };
      case 'custom': return { from: acctFromDate, to: acctToDate };
      default:       return { from: null, to: null };
    }
  };

  // Debug log state
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [debugModalVisible, setDebugModalVisible] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ loading: boolean; status?: number; body?: string; error?: string } | null>(null);

  // Bulk post state
  const [bulkPostVisible, setBulkPostVisible] = useState(false);
  const [bulkPostItems, setBulkPostItems] = useState<BulkPostItem[]>([]);
  const [bulkPostRunning, setBulkPostRunning] = useState(false);
  const [bulkPostDone, setBulkPostDone] = useState(false);

  // Tab management state
  const [activeTabKey, setActiveTabKey] = useState('search');
  const [openJournalTabs, setOpenJournalTabs] = useState<OpenJournalTab[]>([]);

  // ── Posted-journal period/date correction (pencil edit, works on any status) ──
  // Backed by PUT gl/journals/batches/:batch_id/period which updates
  // RR_GL_JOURNAL_BATCHES.DEFAULT_PERIOD_NAME + all RR_GL_JE_HEADERS rows'
  // PERIOD_NAME / DEFAULT_EFFECTIVE_DATE for the batch.
  const [postedPeriodEdit, setPostedPeriodEdit] = useState<{ tabKey: string; period: string; date: dayjs.Dayjs | null } | null>(null);
  const [postedPeriodUpdating, setPostedPeriodUpdating] = useState(false);
  const [postedPeriods, setPostedPeriods] = useState<Period[]>([]);
  const [createJournalTabOpen, setCreateJournalTabOpen] = useState(false);

  // API indicator — tracks the last URL called during search
  const [lastSearchUrl, setLastSearchUrl] = useState<string | null>(null);
  const [lastSearchStatus, setLastSearchStatus] = useState<number | null>(null);
  const [apiUrlCopied, setApiUrlCopied] = useState(false);
  const [pageApiModalVisible, setPageApiModalVisible] = useState(false);
  const [pageApiExecResults, setPageApiExecResults] = useState<Record<number, { loading: boolean; response: string | null }>>({});

  // Stores the base search params (without offset/limit) for export re-fetch
  const lastBaseParamsRef = React.useRef<URLSearchParams | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [gridFilter, setGridFilter] = useState('');

  // Journal panel expanded/collapsed state per tab (for Show More/Show Less)
  const [journalExpandedState, setJournalExpandedState] = useState<Record<string, boolean>>({});
  const [activeDetailTabState, setActiveDetailTabState] = useState<Record<string, string>>({});

  // Per-tab editable state for unposted journals
  const [editableLines, setEditableLines] = useState<Record<string, JournalLine[]>>({});
  const [editableJournalFields, setEditableJournalFields] = useState<Record<string, {
    batchDescription: string;
    journalDescription: string;
    category: string;
    currencyCode: string;
    conversionRate: number;
    conversionRateType: string;
    effectiveDate: string;
  }>>({});
  const [tabSaving, setTabSaving] = useState<Record<string, boolean>>({});

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [tabPosting, setTabPosting] = useState<Record<string, boolean>>({});
  const [selectedLinesByTab, setSelectedLinesByTab] = useState<Record<string, number[]>>({});
  const [showReferencesByTab, setShowReferencesByTab] = useState<Record<string, boolean>>({});
  const [tabGetUrlCopied, setTabGetUrlCopied] = useState<Record<string, boolean>>({});
  const [tabEditMode, setTabEditMode] = useState<Record<string, boolean>>({});
  const [tabAttachments, setTabAttachments] = useState<Record<string, Array<{
    id?: number; uid: string; name: string; fileType: string; fileSize: number;
    content?: string; rawFile?: File; status: 'done' | 'uploading' | 'error';
  }>>>({});
  const [tabAttSaving, setTabAttSaving] = useState<Record<string, boolean>>({});
  const [bulkDeleteModalVisible, setBulkDeleteModalVisible] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [tabAttPreview, setTabAttPreview] = useState<Record<string, { url: string; name: string; type: string } | null>>({});
  const [tabAttPreviewLoading, setTabAttPreviewLoading] = useState<Record<string, boolean>>({});
  const [tabBmsRate, setTabBmsRate] = useState<Record<string, { rate: number; inverseRate: number; rateType: string } | null>>({});
  const [tabBmsRateLoading, setTabBmsRateLoading] = useState<Record<string, boolean>>({});
  const [journalApiModalVisible, setJournalApiModalVisible] = useState(false);
  const [journalApiTabKey, setJournalApiTabKey] = useState<string | null>(null);
  const [journalApiExecResults, setJournalApiExecResults] = useState<Record<number, { loading: boolean; response: string | null }>>({});

  // Lookup data for journal edit dropdowns
  const [journalCategories, setJournalCategories] = useState<string[]>([]);
  const [currencyList, setCurrencyList] = useState<{ code: string; name: string }[]>([]);

  // Journal Entry view modal state
  const [journalViewModalVisible, setJournalViewModalVisible] = useState(false);
  const [selectedJournalForView, setSelectedJournalForView] = useState<JournalRecord | null>(null);
  // account combo → natural account description (loaded when view modal opens)
  const [accountDescMap, setAccountDescMap] = useState<Record<string, string>>({});

  // AP transaction drill-down modal state
  const [apTransactionModalVisible, setApTransactionModalVisible] = useState(false);
  const [apTransactionLoading, setApTransactionLoading] = useState(false);
  const [apTransactionData, setApTransactionData] = useState<any>(null);
  const [apTransactionType, setApTransactionType] = useState<'invoice' | 'payment' | null>(null);
  const [apTransactionLastUrl, setApTransactionLastUrl] = useState<string | null>(null);
  const [apTransactionCopied, setApTransactionCopied] = useState(false);
  const [apTransactionError, setApTransactionError] = useState<string | null>(null);
  const [apTransactionLines, setApTransactionLines] = useState<any[]>([]);
  const [apTransactionLinesLoading, setApTransactionLinesLoading] = useState(false);
  const [apLineDescMap, setApLineDescMap] = useState<Record<string, string>>({});

  // Delete batch state
  const [deleteBatchModalVisible, setDeleteBatchModalVisible] = useState(false);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState<{ jeBatchId: number; batchId: number; batchName: string; statusMeaning: string } | null>(null);
  const [deleteBatchLoading, setDeleteBatchLoading] = useState(false);
  const [deleteBatchTestResult, setDeleteBatchTestResult] = useState<{ loading: boolean; status?: number; body?: string; error?: string } | null>(null);

  // PDF preview state (shared; last generated)
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState('');

  // Per-tab account selector state (shared singleton; keyed by tabKey)
  const [tabAccSel, setTabAccSel] = useState<{ visible: boolean; tabKey: string; lineIdx: number; initial: string }>(
    { visible: false, tabKey: '', lineIdx: -1, initial: '' }
  );

  // Track modified lines: { "tabKey-lineIdx": newAccountCode }
  const [modifiedLines, setModifiedLines] = useState<Record<string, { original: string; current: string; lineId?: number }>>({});
  const [updatingLineKey, setUpdatingLineKey] = useState<string | null>(null);

  // API payload inspector state
  const [apiPayloadVisible, setApiPayloadVisible] = useState(false);
  const [apiPayload, setApiPayload] = useState<{ url: string; method: string; body: string } | null>(null);
  const [apiTestLoading, setApiTestLoading] = useState(false);
  const [apiTestResponse, setApiTestResponse] = useState<{ status: number; body: string } | null>(null);

  // Floating panel state
  const [activePanel, setActivePanel] = useState<'none' | 'tasks' | 'reports'>('none');
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [floatingCollapsed, setFloatingCollapsed] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatingIconsRef = useRef<HTMLDivElement>(null);

  // Restore search data from sessionStorage on mount
  useEffect(() => {
    const savedData = sessionStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const { journals: savedJournals, totalCount: savedTotal, formValues } = JSON.parse(savedData);
        if (savedJournals && savedJournals.length > 0) {
          setJournals(savedJournals);
          setTotalCount(savedTotal);
          setSearchExpanded([]); // Collapse search when data exists
          if (formValues) {
            form.setFieldsValue(formValues);
          }
        }
      } catch (e) {
        console.error('Error restoring search data:', e);
      }
    }
  }, []);

  // Fetch GL categories on mount for search dropdown
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/categories`)
      .then(r => r.json())
      .then(d => { if (d.items) setGLCategories(d.items); })
      .catch(() => {});
  }, []);

  // Build ledger → legalEntityName map from GL business units (for fallback display)
  const [ledgerLegalEntityMap, setLedgerLegalEntityMap] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        const map: Record<string, string> = {};
        (d.items || d).forEach((i: any) => {
          const ledger = i.ledger || i.ledger_name || '';
          const le = i.legal_entity_name || i.legalEntityName || i.business_unit_name || i.businessUnitName || '';
          if (ledger && le && !map[ledger]) map[ledger] = le;
        });
        setLedgerLegalEntityMap(map);
      })
      .catch(() => {});
  }, []);

  // Fetch ledgers on component mount
  useEffect(() => {
    const fetchLedgers = async () => {
      setLoadingLedgers(true);
      // Use the same endpoint TrialBalance uses successfully; the old hardcoded
      // `/ledgers` path was returning an error, surfacing as "Failed to fetch ledgers".
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.getLedgerName}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        // De-duplicate by ledger_name (the endpoint can return one row per company/COA)
        const seen = new Set<string>();
        const items: Ledger[] = (data.items || []).filter((it: Ledger) => {
          if (!it.ledger_name || seen.has(it.ledger_name)) return false;
          seen.add(it.ledger_name);
          return true;
        });
        if (items.length > 0) {
          setLedgers(items);
          const firstLedger = items[0];
          setSelectedLedger(firstLedger);
          form.setFieldsValue({ ledger: firstLedger.ledger_name });
        } else {
          message.warning('No ledgers returned by the server.');
        }
      } catch (error) {
        console.error('Error fetching ledgers:', error, 'url:', url);
        message.error(`Failed to fetch ledgers: ${error instanceof Error ? error.message : 'unknown error'}`);
      } finally {
        setLoadingLedgers(false);
      }
    };
    fetchLedgers();
  }, []);

  // Fetch periods when ledger changes
  useEffect(() => {
    if (!selectedLedger) return;

    const fetchPeriods = async () => {
      setLoadingPeriods(true);
      try {
        const params = new URLSearchParams();
        params.append('P_APPLICATION_NAME', 'General Ledger');
        params.append('P_LEDGER_NAME', selectedLedger.ledger_name);
        const response = await fetch(
          `${APEX_DB_CONFIG.baseUrl}/periodsstatus/create?${params.toString()}`
        );
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          // Sort periods by year desc, then period_number desc
          const sortedPeriods = data.items.sort((a: Period, b: Period) => {
            if (b.period_year !== a.period_year) return b.period_year - a.period_year;
            return b.period_number - a.period_number;
          });
          setPeriods(sortedPeriods);
          // Auto-select first open period
          const currentPeriod = sortedPeriods.find((p: Period) => p.status === 'Open') || sortedPeriods[0];
          if (currentPeriod) {
            form.setFieldsValue({ accountingPeriod: currentPeriod.period_name_id });
          }
        }
      } catch (error) {
        console.error('Error fetching periods:', error);
        message.error('Failed to fetch periods');
      } finally {
        setLoadingPeriods(false);
      }
    };
    fetchPeriods();
  }, [selectedLedger]);

  // Fetch journal categories for the edit dropdown
  useEffect(() => {
    getLookupValues('categories').then(items => {
      setJournalCategories(items.map(i => i.label));
    }).catch(() => {});
  }, []);

  // Fetch currencies list for the currency select dropdown
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/currencies`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        const items = d.items || d || [];
        setCurrencyList(items.map((c: any) => ({
          code: c.currency_code || c.code || c.CURRENCY_CODE || '',
          name: c.name || c.currency_name || c.NAME || c.CURRENCY_NAME || '',
        })).filter((c: any) => c.code));
      })
      .catch(() => {});
  }, []);

  // Handle ledger selection change
  const handleLedgerChange = (ledgerName: string) => {
    const ledger = ledgers.find(l => l.ledger_name === ledgerName);
    if (ledger) {
      setSelectedLedger(ledger);
      // Clear period selection when ledger changes
      form.setFieldsValue({ accountingPeriod: undefined });
      setPeriods([]);
    }
  };

  // Click outside handler for floating panels
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsidePanel = panelRef.current && !panelRef.current.contains(target);
      const isOutsideFloatingIcons = floatingIconsRef.current && !floatingIconsRef.current.contains(target);

      if (isOutsidePanel && isOutsideFloatingIcons) {
        closePanel();
      }
    };

    if (activePanel !== 'none') {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activePanel]);

  // Load natural account descriptions for AP drill-down invoice lines
  useEffect(() => {
    if (apTransactionLines.length === 0) return;
    const uniqueCombos = [...new Set(
      apTransactionLines.map(l => l.distribution_combination).filter(Boolean)
    )];
    if (uniqueCombos.length === 0) return;

    const newMap: Record<string, string> = {};
    Promise.all(
      uniqueCombos.map(async (combo: string) => {
        try {
          const result = await validateAccountCode(combo);
          const naturalValue = combo.split('-')[3] || '';
          const found = Object.values(result.segmentDetails).find(
            s => s.value === naturalValue && s.name.toLowerCase().includes('account')
          ) || Object.values(result.segmentDetails).find(s => s.value === naturalValue);
          if (found?.description) newMap[combo] = found.description;
        } catch (_) { /* silent */ }
      })
    ).then(() => setApLineDescMap(prev => ({ ...prev, ...newMap })));
  }, [apTransactionLines]);

  // Load natural account descriptions when view modal opens
  useEffect(() => {
    if (!journalViewModalVisible || !selectedJournalForView) return;
    const lines = selectedJournalForView.lines || [];
    const uniqueAccounts = [...new Set(lines.map(l => l.account).filter(Boolean))];
    if (uniqueAccounts.length === 0) return;

    const newMap: Record<string, string> = {};
    Promise.all(
      uniqueAccounts.map(async (account) => {
        try {
          const result = await validateAccountCode(account);
          // Natural account is segment index 3 — find by matching its value to parts[3]
          const naturalValue = account.split('-')[3] || '';
          const found = Object.values(result.segmentDetails).find(
            s => s.value === naturalValue && s.name.toLowerCase().includes('account')
          ) || Object.values(result.segmentDetails).find(s => s.value === naturalValue);
          if (found?.description) newMap[account] = found.description;
        } catch (_) { /* silent */ }
      })
    ).then(() => setAccountDescMap(prev => ({ ...prev, ...newMap })));
  }, [journalViewModalVisible, selectedJournalForView]);

  // Auto-load account descriptions for all open journal tabs
  useEffect(() => {
    const allAccounts = openJournalTabs.flatMap(t =>
      (t.journal.lines || []).map((l: any) => l.account).filter(Boolean)
    );
    const unique = [...new Set(allAccounts)] as string[];
    const missing = unique.filter(a => !accountDescMap[a]);
    if (missing.length === 0) return;
    missing.forEach(async (account) => {
      try {
        const result = await validateAccountCode(account);
        const naturalValue = account.split('-')[3] || '';
        const found = Object.values(result.segmentDetails).find(
          s => s.value === naturalValue && (s.name || '').toLowerCase().includes('account')
        ) || Object.values(result.segmentDetails).find(s => s.value === naturalValue);
        if (found?.description) setAccountDescMap(prev => ({ ...prev, [account]: found!.description }));
      } catch (_) { /* silent */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openJournalTabs]);

  const closePanel = () => {
    setIsClosing(true);
    setTimeout(() => {
      setActivePanel('none');
      setIsClosing(false);
    }, 250);
  };

  const togglePanel = (panel: 'tasks' | 'reports') => {
    if (activePanel === panel) {
      closePanel();
    } else {
      setIsClosing(false);
      setActivePanel(panel);
    }
  };

  const handleMenuItemClick = (_key: string, path?: string) => {
    closePanel();
    if (path) {
      navigate(path);
    }
  };

  // Open journal in a new tab
  const openJournalTab = async (journal: JournalRecord) => {
    const tabKey = `journal-${journal.jeHeaderId}`;

    // Check if tab is already open
    const existingTab = openJournalTabs.find(tab => tab.key === tabKey);
    if (existingTab) {
      setActiveTabKey(tabKey);
      return;
    }

    // Fetch lines with reference columns from the lines endpoint
    let fetchedLines: JournalLine[] = journal.lines || [];
    try {
      const linesRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/${journal.jeHeaderId}/lines`, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
      });
      if (linesRes.ok) {
        const linesData = await linesRes.json();
        const items = linesData.items ?? (Array.isArray(linesData) ? linesData : []);
        if (items.length > 0) {
          fetchedLines = items.map((l: any) => ({
            lineId:            l.lineId ?? l.lineNum ?? 0,
            lineNum:           l.lineNum ?? l.JE_LINE_NUMBER ?? 0,
            account:           l.account ?? l.ACCOUNT_COMBINATION ?? '',
            accountDescription: l.accountDescription ?? '',
            description:       l.description ?? '',
            enteredDr:         l.enteredDr ?? 0,
            enteredCr:         l.enteredCr ?? 0,
            accountedDr:       l.accountedDr ?? 0,
            accountedCr:       l.accountedCr ?? 0,
            currency:          l.currency ?? l.currencyCode ?? '',
            reference1:  l.reference1  ?? undefined,
            reference2:  l.reference2  ?? undefined,
            reference3:  l.reference3  ?? undefined,
            reference4:  l.reference4  ?? undefined,
            reference5:  l.reference5  ?? undefined,
            reference6:  l.reference6  ?? undefined,
            reference7:  l.reference7  ?? undefined,
            reference8:  l.reference8  ?? undefined,
            reference9:  l.reference9  ?? undefined,
            reference10: l.reference10 ?? undefined,
          }));
        }
      }
    } catch { /* use existing lines if fetch fails */ }

    const journalWithLines = { ...journal, lines: fetchedLines };

    // Initialize editable state for unposted journals
    if (journal.statusMeaning !== 'Posted') {
      setEditableLines(prev => ({
        ...prev,
        [tabKey]: JSON.parse(JSON.stringify(fetchedLines)),
      }));
      setEditableJournalFields(prev => ({
        ...prev,
        [tabKey]: {
          batchDescription: journal.batchDescription || '',
          journalDescription: journal.journalDescription || '',
          category: journal.category || '',
          currencyCode: journal.currencyCode || '',
          conversionRate: journal.conversionRate || 1,
          conversionRateType: journal.conversionRateType || 'User',
          effectiveDate: journal.effectiveDate || '',
        },
      }));
    }

    // Add new tab (store the search URL that produced this journal)
    setOpenJournalTabs(prev => [...prev, { key: tabKey, journal: journalWithLines, sourceUrl: lastSearchUrl || undefined }]);
    setActiveTabKey(tabKey);

    // Load attachments for this journal
    fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${journal.jeBatchId}/attachments`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const items = (data.items || []) as any[];
        setTabAttachments(prev => ({
          ...prev,
          [tabKey]: items.map((a: any) => ({
            id: a.id, uid: String(a.id),
            name: a.fileName || a.file_name || 'attachment',
            fileType: a.fileType || a.file_type || 'application/octet-stream',
            fileSize: a.fileSize || a.file_size || 0, status: 'done' as const,
          })),
        }));
      })
      .catch(() => {});
  };

  // Open a pre-filled unsaved draft tab (for Reverse / Copy operations)
  const openDraftJournalTab = (
    draftJournal: JournalRecord,
    draftLines: JournalLine[],
    draftHeaderFields: {
      batchDescription: string; journalDescription: string; category: string;
      currencyCode: string; conversionRate: number; conversionRateType: string; effectiveDate: string;
    },
  ) => {
    const tabKey = `new-journal-${Date.now()}`;
    const journalWithLines = { ...draftJournal, lines: draftLines };
    setEditableLines(prev => ({ ...prev, [tabKey]: JSON.parse(JSON.stringify(draftLines)) }));
    setEditableJournalFields(prev => ({ ...prev, [tabKey]: draftHeaderFields }));
    setTabEditMode(prev => ({ ...prev, [tabKey]: true }));
    setOpenJournalTabs(prev => [...prev, { key: tabKey, journal: journalWithLines, isNewDraft: true }]);
    setActiveTabKey(tabKey);
  };

  // Close journal tab
  const closeJournalTab = (tabKey: string) => {
    const newTabs = openJournalTabs.filter(tab => tab.key !== tabKey);
    setOpenJournalTabs(newTabs);

    // Clean up per-tab state
    setEditableLines(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setEditableJournalFields(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setTabSaving(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setTabPosting(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setSelectedLinesByTab(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setTabEditMode(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setTabAttachments(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
    setTabAttSaving(prev => { const n = { ...prev }; delete n[tabKey]; return n; });

    // If closing active tab, switch to search or last tab
    if (activeTabKey === tabKey) {
      if (newTabs.length > 0) {
        setActiveTabKey(newTabs[newTabs.length - 1].key);
      } else {
        setActiveTabKey('search');
      }
    }
  };

  // Handle tab change
  const onTabChange = (key: string) => {
    setActiveTabKey(key);
  };

  // Handle tab edit (close)
  const onTabEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove' && typeof targetKey === 'string') {
      if (targetKey === 'create-journal') {
        setCreateJournalTabOpen(false);
        setActiveTabKey('search');
      } else {
        closeJournalTab(targetKey);
      }
    }
  };

  // Open the Create Journal in-app tab
  const openCreateJournalTab = () => {
    setCreateJournalTabOpen(true);
    setActiveTabKey('create-journal');
  };

  // Page APIs definition
  const selectedLedgerName = selectedLedger?.ledger_name || '';
  const PAGE_APIS = [
    {
      name: 'Fetch Ledgers',
      method: 'GET',
      url: `${APEX_DB_CONFIG.baseUrl}/ledgers`,
      description: 'Populates the Ledger dropdown on page load',
    },
    {
      name: 'Fetch Periods',
      method: 'GET',
      url: `${APEX_DB_CONFIG.baseUrl}/periodsstatus/create?P_APPLICATION_NAME=General+Ledger&P_LEDGER_NAME=${encodeURIComponent(selectedLedgerName || '{select a ledger}')}`,
      description: 'Populates the Accounting Period LOV when a ledger is selected',
    },
    {
      name: 'Search Journals',
      method: 'GET',
      url: lastSearchUrl || `${APEX_DB_CONFIG.baseUrl}/gl/journals/headers?ledger_name=${encodeURIComponent(selectedLedgerName || '{ledger}')}&period_name={period}&...`,
      description: 'Fetches journal headers matching the search filters',
    },
    {
      name: 'Post Journal',
      method: 'PUT',
      url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/{batchId}/post`,
      description: 'Posts a journal batch',
    },
    {
      name: 'Update Journal Lines',
      method: 'PUT',
      url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/{headerId}`,
      description: 'Saves edits to journal lines',
    },
  ];

  const executePageApi = async (index: number, url: string) => {
    setPageApiExecResults(prev => ({ ...prev, [index]: { loading: true, response: null } }));
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let formatted = text;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setPageApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `HTTP ${res.status}\n\n${formatted}` } }));
    } catch (e: any) {
      setPageApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `Error: ${e.message}` } }));
    }
  };

  const executeJournalApi = async (index: number, url: string) => {
    setJournalApiExecResults(prev => ({ ...prev, [index]: { loading: true, response: null } }));
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let formatted = text;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setJournalApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `HTTP ${res.status}\n\n${formatted}` } }));
    } catch (e: any) {
      setJournalApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `Error: ${e.message}` } }));
    }
  };

  const openJournalApiModal = (tabKey: string) => {
    setJournalApiTabKey(tabKey);
    setJournalApiExecResults({});
    setJournalApiModalVisible(true);
  };

  // Add debug log helper
  const addDebugLog = (type: DebugLogEntry['type'], message: string, data?: any) => {
    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data,
    };
    setDebugLogs(prev => [...prev, entry]);
    console.log(`[DEBUG ${type.toUpperCase()}] ${message}`, data || '');
  };

  // Helper: operator label → single-char code used by the API
  const opToCode = (op: string) => {
    if (op === 'Starts with') return 'S';
    if (op === 'Ends with')   return 'E';
    if (op === 'Equals')      return 'X';
    return 'C';
  };

  // Build the full search URL from current form values (no offset/limit)
  const buildSearchUrl = (offsetVal = 0, limitVal = 500) => {
    const values = form.getFieldsValue();
    const p = new URLSearchParams();
    if (values.ledger)           p.append('ledger',  values.ledger);
    if (values.accountingPeriod) p.append('period',  values.accountingPeriod);
    if (values.journalBatch) {
      p.append('batchName', values.journalBatch);
      p.append('batchOp',   opToCode(values.batchOperator || 'Contains'));
    }
    if (values.batchDescription) {
      p.append('batchDesc', values.batchDescription);
      p.append('batchDescOp', opToCode(values.batchDescOperator || 'Contains'));
    }
    if (values.journalName) {
      p.append('journalName', values.journalName);
      p.append('journalNameOp', opToCode(values.journalNameOperator || 'Contains'));
    }
    if (values.journalDescription) {
      p.append('journalDesc', values.journalDescription);
      p.append('journalOp',   opToCode(values.journalOperator || 'Contains'));
    }
    if (values.category)   p.append('category',     values.category);
    if (values.source)     p.append('source',        values.source);
    if (values.batchStatus && values.batchStatus !== 'All') p.append('statusMeaning', values.batchStatus);
    const { from: acctFrom, to: acctTo } = getAcctDateRange();
    if (acctFrom) p.append('from_date', acctFrom.format('YYYY-MM-DD'));
    if (acctTo)   p.append('to_date',   acctTo.format('YYYY-MM-DD'));
    p.append('offset', offsetVal.toString());
    p.append('limit',  limitVal.toString());
    return `${API_BASE_URL}/headers?${p.toString()}`;
  };

  // Search handler - calls the API with pagination to get ALL records
  const handleSearch = async () => {
    const values = form.getFieldsValue();

    // Clear previous debug logs
    setDebugLogs([]);

    // Validate required fields
    if (!values.ledger) {
      message.error('Ledger is required');
      return;
    }
    if (!values.accountingPeriod) {
      message.error('Accounting Period is required');
      return;
    }

    setLoading(true);
    setJournals([]); // Clear existing data
    setCurrentPage(1); // Reset to first page on new search
    setPageSize(25); // Reset to default page size

    addDebugLog('info', 'Starting search...', values);

    try {
      // Build base query parameters
      const baseParams = new URLSearchParams();
      baseParams.append('ledger', values.ledger);
      baseParams.append('period', values.accountingPeriod);

      if (values.journalBatch) {
        baseParams.append('batchName', values.journalBatch);
        baseParams.append('batchOp', opToCode(values.batchOperator || 'Contains'));
      }
      if (values.batchDescription) {
        baseParams.append('batchDesc', values.batchDescription);
        baseParams.append('batchDescOp', opToCode(values.batchDescOperator || 'Contains'));
      }
      if (values.journalName) {
        baseParams.append('journalName', values.journalName);
        baseParams.append('journalNameOp', opToCode(values.journalNameOperator || 'Contains'));
      }
      if (values.journalDescription) {
        baseParams.append('journalDesc', values.journalDescription);
        baseParams.append('journalOp', opToCode(values.journalOperator || 'Contains'));
      }
      if (values.category)   baseParams.append('category',      values.category);
      if (values.source)     baseParams.append('source',         values.source);
      if (values.batchStatus && values.batchStatus !== 'All') {
        baseParams.append('statusMeaning', values.batchStatus);
      }
      const { from: acctFrom, to: acctTo } = getAcctDateRange();
      if (acctFrom) baseParams.append('from_date', acctFrom.format('YYYY-MM-DD'));
      if (acctTo)   baseParams.append('to_date',   acctTo.format('YYYY-MM-DD'));

      // Save for export re-fetch
      lastBaseParamsRef.current = new URLSearchParams(baseParams.toString());

      // Fetch with pagination - get ALL records
      const PAGE_SIZE = 500; // ORDS default max
      let offset = 0;
      let allItems: JournalRecord[] = [];
      let hasMore = true;
      let pageCount = 0;

      addDebugLog('info', `Starting paginated fetch with PAGE_SIZE=${PAGE_SIZE}`);

      while (hasMore) {
        pageCount++;
        // Add pagination params
        const params = new URLSearchParams(baseParams);
        params.append('offset', offset.toString());
        params.append('limit', PAGE_SIZE.toString());

        const url = `${API_BASE_URL}/headers?${params.toString()}`;

        // Always expose the first-page URL in the API indicator
        if (pageCount === 1) {
          setLastSearchUrl(url);
          setLastSearchStatus(null);
        }

        addDebugLog('request', `Page ${pageCount} - GET Request`, { url, offset, limit: PAGE_SIZE });

        const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        const responseText = await response.text();

        setLastSearchStatus(response.status);

        addDebugLog('response', `Page ${pageCount} - Raw response`, {
          responseLength: responseText.length,
          first500Chars: responseText.substring(0, 500),
          last200Chars: responseText.substring(responseText.length - 200),
        });

        // Guard: ORDS returns an HTML error page when the endpoint doesn't exist
        if (!response.ok || responseText.trimStart().startsWith('<')) {
          addDebugLog('error', `Page ${pageCount} - Non-JSON response (HTTP ${response.status})`, {
            url,
            first300: responseText.substring(0, 300),
          });
          message.error(`API error (HTTP ${response.status}): endpoint returned HTML instead of JSON. Check the ORDS route exists.`);
          hasMore = false;
          break;
        }

        const data: ApiResponse = JSON.parse(responseText);

        // Log first 3 items to see the data structure
        const sampleItems = (data.items || []).slice(0, 3).map((item: any) => ({
          batchId: item.batchId,
          jeBatchId: item.jeBatchId,
          headerId: item.headerId,
          jeHeaderId: item.jeHeaderId,
          batchName: item.batchName,
          journalName: item.journalName,
        }));

        addDebugLog('response', `Page ${pageCount} - Response received`, {
          success: data.success,
          itemsReturnedFromApi: data.items?.length || 0,
          apiTotalCount: data.totalCount,
          apiOffset: data.offset,
          apiLimit: data.limit,
          sampleItems: sampleItems,
          note: 'API totalCount may be wrong - we count actual items instead',
        });

        if (data.success) {
          const items = data.items || [];

          // Count actual items returned (not trusting API totalCount)
          const actualItemCount = items.length;

          // Group items by source to see distribution
          const sourceGroups: Record<string, number> = {};
          items.forEach((item: any) => {
            const source = item.source || 'UNKNOWN';
            sourceGroups[source] = (sourceGroups[source] || 0) + 1;
          });

          addDebugLog('info', `Page ${pageCount} - Items by Source`, {
            totalItems: actualItemCount,
            bySource: sourceGroups,
          });

          // Generate unique keys - use combination of fields to ensure uniqueness
          const mappedItems = items.map((item: any, index: number) => {
            // Try multiple ID fields for uniqueness
            const uniqueKey = item.headerId || item.jeHeaderId || item.batchId || item.jeBatchId || `page${pageCount}_idx${index}`;
            return {
              ...item,
              key: `${uniqueKey}_${offset + index}`, // Always append index to guarantee uniqueness
            };
          });

          allItems = [...allItems, ...mappedItems];

          // Check for duplicate keys
          const keys = allItems.map(item => item.key);
          const uniqueKeys = new Set(keys);
          const hasDuplicates = keys.length !== uniqueKeys.size;

          addDebugLog('info', `Page ${pageCount} processed`, {
            actualItemsThisPage: actualItemCount,
            totalItemsSoFar: allItems.length,
            uniqueKeysCount: uniqueKeys.size,
            hasDuplicateKeys: hasDuplicates,
            apiReportedTotal: data.totalCount,
            note: hasDuplicates ? 'WARNING: Duplicate keys detected!' : 'Keys are unique',
          });

          // Check if there are more pages
          // ONLY stop if we got LESS than PAGE_SIZE items (meaning no more data)
          if (actualItemCount < PAGE_SIZE) {
            hasMore = false;
            addDebugLog('info', `Pagination complete - no more pages`, {
              reason: `Got ${actualItemCount} items (less than PAGE_SIZE=${PAGE_SIZE})`,
              finalCount: allItems.length,
            });
          } else {
            // Got full page, there might be more
            offset += PAGE_SIZE;
            addDebugLog('info', `Got full page (${actualItemCount} items), fetching more at offset: ${offset}`);
          }
        } else {
          addDebugLog('error', 'API returned error', { error: data.error });
          message.error(data.error || 'Failed to fetch journals');
          hasMore = false;
        }
      }

      // Final check for unique keys before setting state
      const finalKeys = allItems.map(item => item.key);
      const finalUniqueKeys = new Set(finalKeys);

      // Final summary by source
      const finalSourceGroups: Record<string, number> = {};
      allItems.forEach((item: any) => {
        const source = item.source || 'UNKNOWN';
        finalSourceGroups[source] = (finalSourceGroups[source] || 0) + 1;
      });

      addDebugLog('info', `FINAL SUMMARY - All items by Source`, {
        totalItems: allItems.length,
        bySource: finalSourceGroups,
      });

      addDebugLog('info', `Setting state with data`, {
        totalItemsToSet: allItems.length,
        uniqueKeys: finalUniqueKeys.size,
        hasDuplicates: finalKeys.length !== finalUniqueKeys.size,
        firstFewKeys: finalKeys.slice(0, 5),
        lastFewKeys: finalKeys.slice(-3),
      });

      // Set all fetched data
      setJournals(allItems);
      setTotalCount(allItems.length);

      addDebugLog('info', `Search complete`, {
        totalPages: pageCount,
        actualTotalRecords: allItems.length,
        note: 'Data set to state - check React DevTools if UI shows fewer rows',
      });

      // Save to sessionStorage for persistence
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        journals: allItems,
        totalCount: allItems.length,
        formValues: values,
      }));

      message.success(`Found ${allItems.length} journals`);

    } catch (error) {
      addDebugLog('error', 'Fetch error', { error: String(error) });
      console.error('Error fetching journals:', error);
      message.error('Failed to connect to server');
      setJournals([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  // Reset handler
  const handleReset = () => {
    form.resetFields();
    setJournals([]);
    setTotalCount(0);
    setSelectedRowKeys([]);
    setAcctDatePreset(null);
    setAcctFromDate(null);
    setAcctToDate(null);
    setCurrentPage(1);
    setPageSize(25);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  // Table pagination/sort/filter change handler
  const handleTableChange = (pagination: any, filters: any, sorter: any) => {
    setCurrentPage(pagination.current);
    setPageSize(pagination.pageSize);
  };

  // Open Journal Entry modal
  const handleViewJournalEntry = (journal: JournalRecord) => {
    setSelectedJournalForView(journal);
    setJournalViewModalVisible(true);
  };

  // AP transaction drill-down: fetch invoice or payment by reference
  const handleTransactionDrilldown = async (journal: JournalRecord, line: JournalLine) => {
    const category = (journal.category || '').toLowerCase();

    // Build reference: prefer externalReference, fall back to extracting from journalName, then line.description
    let reference = journal.externalReference || '';
    if (!reference) {
      // Try to extract invoice number from journalName (format: "AP Invoice {number}")
      const nameMatch = (journal.journalName || '').match(/^AP\s+(?:Invoice|Payment)\s+(.+)$/i);
      if (nameMatch) reference = nameMatch[1].trim();
    }
    if (!reference) reference = line.description || '';

    console.log('[View Transaction] Debug info:', {
      journalName: journal.journalName,
      source: journal.source,
      category: journal.category,
      externalReference: journal.externalReference,
      lineDescription: line.description,
      resolvedReference: reference,
    });

    // Always open the modal so the user can see what's happening
    setApTransactionData(null);
    setApTransactionError(null);
    setApTransactionLastUrl(null);
    setApTransactionLoading(true);
    setApTransactionModalVisible(true);

    if (!reference) {
      setApTransactionLoading(false);
      setApTransactionError(
        `No reference found. Check: externalReference="${journal.externalReference}", journalName="${journal.journalName}", lineDescription="${line.description}"`
      );
      return;
    }

    try {
      let url: string;
      let transType: 'invoice' | 'payment';

      if (category.includes('payment')) {
        transType = 'payment';
        url = `${APEX_DB_CONFIG.baseUrl}/ap/payments?payment_number=${encodeURIComponent(reference)}`;
      } else {
        transType = 'invoice';
        url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice?invoice_number=${encodeURIComponent(reference)}`;
      }

      console.log('[View Transaction] API call:', { transType, url });

      setApTransactionType(transType);
      setApTransactionLastUrl(url);
      const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store' });
      const data = await response.json();
      const items = data.items || (Array.isArray(data) ? data : [data]);

      console.log('[View Transaction] API response:', { itemCount: items.length, firstItem: items[0] });

      if (items.length > 0) {
        const header = items[0];
        setApTransactionData(header);

        // Fetch invoice lines if this is an invoice (not a payment)
        if (transType === 'invoice') {
          const invoiceId = header.invoice_id || header.invoiceId;
          if (invoiceId) {
            setApTransactionLinesLoading(true);
            try {
              const linesUrl = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${invoiceId}`;
              console.log('[View Transaction] Fetching lines:', linesUrl);
              const linesRes = await fetch(linesUrl, { headers: { Accept: 'application/json' } });
              const linesData = await linesRes.json();
              const lineItems = linesData.items || (Array.isArray(linesData) ? linesData : []);
              console.log('[View Transaction] Lines response:', { count: lineItems.length, sample: lineItems[0] });
              setApTransactionLines(lineItems);
            } catch (lineErr) {
              console.error('[View Transaction] Lines fetch error:', lineErr);
            } finally {
              setApTransactionLinesLoading(false);
            }
          }
        }
      } else {
        setApTransactionError(`No AP transaction found for reference: "${reference}"`);
      }
    } catch (err) {
      console.error('[View Transaction] Fetch error:', err);
      setApTransactionError(`Failed to load transaction: ${String(err)}`);
    } finally {
      setApTransactionLoading(false);
    }
  };

  // Get status tag color
  const getBatchStatusTag = (status: string) => {
    const statusLower = status?.toLowerCase() || '';
    const config: Record<string, { color: string; icon: React.ReactNode }> = {
      posted: { color: REDWOOD.success, icon: <CheckCircleOutlined /> },
      unposted: { color: REDWOOD.warning, icon: <ClockCircleOutlined /> },
      new: { color: REDWOOD.info, icon: <FileAddOutlined /> },
      error: { color: REDWOOD.primary, icon: <CloseCircleOutlined /> },
      pending: { color: REDWOOD.info, icon: <ClockCircleOutlined /> },
    };
    const cfg = config[statusLower] || { color: REDWOOD.neutral600, icon: null };
    return (
      <Tag color={cfg.color} icon={cfg.icon} style={{ borderRadius: 4 }}>
        {status || 'Unknown'}
      </Tag>
    );
  };

  // Get approval status tag
  const getApprovalStatusTag = (status: string) => {
    const config: Record<string, string> = {
      'Approved': REDWOOD.success,
      'Pending': REDWOOD.warning,
      'Rejected': REDWOOD.primary,
      'Not required': REDWOOD.neutral600,
    };
    return (
      <Tag color={config[status] || REDWOOD.neutral600} style={{ borderRadius: 4 }}>
        {status || 'Not required'}
      </Tag>
    );
  };

  // Format currency
  const formatCurrency = (value: number, currency: string = 'AED') => {
    if (value === null || value === undefined) return '-';
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`;
  };

  // Helper: column text-search filter dropdown
  const getColumnSearchProps = (dataIndex: keyof JournalRecord, placeholder = 'Search') => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <div style={{ padding: 8, minWidth: 200 }}>
        <Input
          placeholder={placeholder}
          value={selectedKeys[0] as string}
          onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => confirm()}
          style={{ marginBottom: 8, display: 'block' }}
          autoFocus
        />
        <Space>
          <Button
            type="primary"
            onClick={() => confirm()}
            icon={<SearchOutlined />}
            size="small"
            style={{ width: 90 }}
          >
            Filter
          </Button>
          <Button
            onClick={() => { clearFilters?.(); confirm(); }}
            size="small"
            style={{ width: 70 }}
          >
            Reset
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => (
      <SearchOutlined style={{ color: filtered ? REDWOOD.info : undefined }} />
    ),
    onFilter: (value: any, record: JournalRecord) =>
      String(record[dataIndex] ?? '').toLowerCase().includes(String(value).toLowerCase()),
  });

  // Table columns — mirrors the JSON fields exactly
  const columns: ColumnsType<JournalRecord> = [
    {
      title: 'Batch Name',
      dataIndex: 'batchName',
      key: 'batchName',
      width: 200,
      fixed: 'left',
      ellipsis: true,
      render: (text, record) => (
        <Tooltip title={record.batchDescription || text}>
          <a style={{ color: REDWOOD.info, fontWeight: 500 }} onClick={() => openJournalTab(record)}>
            {text || '-'}
          </a>
        </Tooltip>
      ),
      sorter: (a, b) => (a.batchName || '').localeCompare(b.batchName || ''),
      ...getColumnSearchProps('batchName', 'Search batch name'),
    },
    {
      title: 'Batch Description',
      dataIndex: 'batchDescription',
      key: 'batchDescription',
      width: 240,
      ellipsis: true,
      render: (text) => <Tooltip title={text}><span>{text || '-'}</span></Tooltip>,
      ...getColumnSearchProps('batchDescription', 'Search batch description'),
    },
    {
      title: 'Journal Name',
      dataIndex: 'journalName',
      key: 'journalName',
      width: 200,
      ellipsis: true,
      render: (text, record) => (
        record.statusMeaning === 'Posted' ? (
          <Tooltip title={`Posted — ${text}`}>
            <a style={{ color: REDWOOD.neutral600, fontWeight: 500 }} onClick={() => openJournalTab(record)}>
              {text || '-'}
            </a>
          </Tooltip>
        ) : (
          <a style={{ color: REDWOOD.info, fontWeight: 500 }} onClick={() => openJournalTab(record)}>
            {text || '-'}
          </a>
        )
      ),
      sorter: (a, b) => (a.journalName || '').localeCompare(b.journalName || ''),
      ...getColumnSearchProps('journalName', 'Search journal name'),
    },
    {
      title: 'Journal Description',
      dataIndex: 'journalDescription',
      key: 'journalDescription',
      width: 240,
      ellipsis: true,
      render: (text) => <Tooltip title={text}><span>{text || '-'}</span></Tooltip>,
      ...getColumnSearchProps('journalDescription', 'Search journal description'),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (text) => text ? <Tag color="blue" style={{ fontSize: 11 }}>{text}</Tag> : '-',
      filters: [...new Set(journals.map(j => j.category).filter(Boolean))].map(c => ({ text: c, value: c })),
      onFilter: (value, record) => record.category === value,
    },
    {
      title: 'Period',
      dataIndex: 'periodName',
      key: 'periodName',
      width: 90,
      sorter: (a, b) => (a.periodName || '').localeCompare(b.periodName || ''),
      filters: [...new Set(journals.map(j => j.periodName).filter(Boolean))].map(p => ({ text: p, value: p })),
      onFilter: (value, record) => record.periodName === value,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      ellipsis: true,
      render: (text) => text || '-',
      filters: [...new Set(journals.map(j => j.source).filter(Boolean))].map(s => ({ text: s, value: s })),
      onFilter: (value, record) => record.source === value,
    },
    {
      title: 'Status',
      dataIndex: 'statusMeaning',
      key: 'statusMeaning',
      width: 100,
      render: (status) => getBatchStatusTag(status),
      filters: batchStatuses.filter(s => s !== 'All').map(s => ({ text: s, value: s })),
      onFilter: (value, record) => record.statusMeaning === value,
    },
    {
      title: 'Ccy',
      dataIndex: 'currencyCode',
      key: 'currencyCode',
      width: 60,
      render: (text) => text || '-',
    },
    {
      title: 'Entered Dr',
      dataIndex: 'enteredDebit',
      key: 'enteredDebit',
      width: 130,
      align: 'right',
      render: (value, record) => formatCurrency(value, record.currencyCode),
      sorter: (a, b) => (a.enteredDebit || 0) - (b.enteredDebit || 0),
    },
    {
      title: 'Entered Cr',
      dataIndex: 'enteredCredit',
      key: 'enteredCredit',
      width: 130,
      align: 'right',
      render: (value, record) => formatCurrency(value, record.currencyCode),
      sorter: (a, b) => (a.enteredCredit || 0) - (b.enteredCredit || 0),
    },
    {
      title: 'Acctg Date',
      dataIndex: 'effectiveDate',
      key: 'effectiveDate',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: 'Posted Date',
      dataIndex: 'postedDate',
      key: 'postedDate',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: 'Approval',
      dataIndex: 'approvalStatusMeaning',
      key: 'approvalStatusMeaning',
      width: 110,
      render: (status) => getApprovalStatusTag(status),
    },
    {
      title: 'JE Batch ID',
      dataIndex: 'jeBatchId',
      key: 'jeBatchId',
      width: 110,
      render: (text) => <Text code style={{ fontSize: 11 }}>{text || '-'}</Text>,
    },
  ];

  // Actions dropdown menu
  const actionsMenu: MenuProps['items'] = [
    { key: 'view', label: 'View', icon: <EyeOutlined /> },
    { key: 'edit', label: 'Edit', icon: <EditOutlined /> },
    { type: 'divider' },
    { key: 'post', label: 'Post Batch', icon: <CheckCircleOutlined /> },
    { key: 'reverse', label: 'Reverse Batch', icon: <RollbackOutlined /> },
    { type: 'divider' },
    { key: 'export', label: 'Export', icon: <ExportOutlined /> },
    { key: 'print', label: 'Print', icon: <PrinterOutlined /> },
  ];

  // Row selection
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // ── Bulk Post helpers ──────────────────────────────────────────────────────

  // Client-side validation for a single journal before bulk posting
  const validateForBulkPost = (journal: JournalRecord): string[] => {
    const errors: string[] = [];
    const lines = journal.lines || [];
    const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (lines.length === 0) {
      errors.push('No journal lines found.');
    } else {
      const dr = lines.reduce((s, l) => s + (l.enteredDr || 0), 0);
      const cr = lines.reduce((s, l) => s + (l.enteredCr || 0), 0);
      if (Math.abs(dr - cr) > 0.01) {
        errors.push(`Out of balance — Debit ${fmt(dr)} ≠ Credit ${fmt(cr)} (diff ${fmt(Math.abs(dr - cr))}).`);
      }
      const blank = lines.filter(l => !l.account?.trim()).length;
      if (blank > 0) errors.push(`${blank} line(s) have no account code.`);
      const zero = lines.filter(l => (l.enteredDr || 0) === 0 && (l.enteredCr || 0) === 0).length;
      if (zero > 0) errors.push(`${zero} line(s) have zero Debit and Credit.`);
    }

    const periodRecord = periods.find(p => p.period_name_id === journal.periodName);
    if (periodRecord && periodRecord.status !== 'Open') {
      errors.push(`Period "${journal.periodName}" is ${periodRecord.status} — must be Open.`);
    }
    return errors;
  };

  // Open the bulk post modal for the selected journals
  const promptDeleteBatch = (journal: JournalRecord) => {
    setDeleteBatchTarget({
      jeBatchId:    journal.jeBatchId,
      batchId:      journal.batchId,
      batchName:    journal.batchName,
      statusMeaning: journal.statusMeaning,
    });
    setDeleteBatchTestResult(null);
    setDeleteBatchModalVisible(true);
  };

  const handleDeleteBatch = async () => {
    if (!deleteBatchTarget) return;
    setDeleteBatchLoading(true);
    try {
      // Use jeBatchId — the DELETE handler queries by JE_BATCH_ID in RR_GL_JOURNAL_BATCHES
      const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${deleteBatchTarget.jeBatchId}`;
      const res = await fetch(url, { method: 'DELETE' });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { status: 'ERROR', message: text.substring(0, 200) }; }
      if (res.ok && data.status === 'SUCCESS') {
        message.success(`Batch "${deleteBatchTarget.batchName}" deleted (${data.headersDeleted} header(s), ${data.linesDeleted} line(s))`);
        setDeleteBatchModalVisible(false);
        setDeleteBatchTarget(null);
        setDeleteBatchTestResult(null);
        setSelectedRowKeys([]);
        setOpenJournalTabs(prev => prev.filter(t => t.journal.jeBatchId !== deleteBatchTarget.jeBatchId));
        setActiveTabKey('search');
        setTimeout(() => {
          const searchBtn = document.querySelector<HTMLElement>('.mj-search-btn');
          if (searchBtn) searchBtn.click();
        }, 100);
      } else {
        message.error(data.message || data.error || `HTTP ${res.status} — delete failed`);
      }
    } catch (e: any) {
      message.error(`Delete failed: ${e.message}`);
    } finally {
      setDeleteBatchLoading(false);
    }
  };

  // Bulk delete — only Manual + Unposted batches
  const handleBulkDelete = async () => {
    const targets = journals.filter(j =>
      selectedRowKeys.includes(j.key) &&
      (j.source || '').trim().toUpperCase() === 'MANUAL' &&
      j.statusMeaning !== 'Posted'
    );
    if (!targets.length) return;
    setBulkDeleteLoading(true);
    let deleted = 0;
    for (const j of targets) {
      try {
        const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${j.jeBatchId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === 'SUCCESS') {
          deleted++;
          setOpenJournalTabs(prev => prev.filter(t => t.journal.jeBatchId !== j.jeBatchId));
        }
      } catch { /* continue with next */ }
    }
    setBulkDeleteLoading(false);
    setBulkDeleteModalVisible(false);
    setSelectedRowKeys([]);
    if (deleted > 0) {
      message.success(`${deleted} batch(es) deleted.`);
      setTimeout(() => {
        const btn = document.querySelector<HTMLElement>('.mj-search-btn');
        if (btn) btn.click();
      }, 100);
    }
  };

  // Export journals to Excel — fetches ALL pages fresh from the API
  const handleExportExcel = async () => {
    if (!lastBaseParamsRef.current) {
      message.warning('No search results to export. Run a search first.');
      return;
    }

    setExportLoading(true);
    const key = 'excel-export';
    message.loading({ content: 'Fetching all journals for export…', key, duration: 0 });

    try {
      const PAGE_SIZE = 1000;
      let offset = 0;
      let allRows: JournalRecord[] = [];
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams(lastBaseParamsRef.current.toString());
        params.set('offset', offset.toString());
        params.set('limit', PAGE_SIZE.toString());
        const url = `${API_BASE_URL}/headers?${params.toString()}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.trimStart().startsWith('<')) throw new Error('ORDS returned HTML — endpoint error');
        const data: ApiResponse = JSON.parse(text);
        if (!data.success) throw new Error(data.error || 'API returned success=false');

        const items: JournalRecord[] = (data.items || []).map((item: any, idx: number) => ({
          key: `export-${offset}-${idx}`,
          batchId: item.batchId, jeBatchId: item.jeBatchId,
          batchName: item.batchName, batchDescription: item.batchDescription || '',
          source: item.source || '', status: item.status || '',
          statusMeaning: item.statusMeaning || '', approvalStatusMeaning: item.approvalStatusMeaning || '',
          postedDate: item.postedDate || null, headerId: item.headerId, jeHeaderId: item.jeHeaderId,
          journalName: item.journalName || '', journalDescription: item.journalDescription || '',
          periodName: item.periodName || '', category: item.category || '',
          ledgerName: item.ledgerName || '', legalEntityName: item.legalEntityName || '',
          currencyCode: item.currencyCode || '', conversionRate: item.conversionRate ?? 1,
          conversionRateType: item.conversionRateType || '',
          enteredDebit: item.enteredDebit ?? 0, enteredCredit: item.enteredCredit ?? 0,
          accountedDebit: item.accountedDebit ?? 0, accountedCredit: item.accountedCredit ?? 0,
          effectiveDate: item.effectiveDate || '', externalReference: item.externalReference || '',
          creationDate: item.creationDate || '', lines: [],
        }));

        allRows = [...allRows, ...items];
        message.loading({ content: `Fetching… ${allRows.length} journals loaded`, key, duration: 0 });

        if (items.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }
      }

      if (allRows.length === 0) {
        message.warning({ content: 'No data returned from API.', key });
        return;
      }

      const rows = allRows.map(j => ({
        'JE Batch ID':         j.jeBatchId,
        'Batch Name':          j.batchName,
        'Batch Description':   j.batchDescription,
        'Status':              j.statusMeaning,
        'Source':              j.source,
        'Period':              j.periodName,
        'Ledger':              j.ledgerName,
        'Journal Name':        j.journalName,
        'Journal Description': j.journalDescription,
        'Category':            j.category,
        'Currency':            j.currencyCode,
        'Conversion Rate':     j.conversionRate,
        'Accounting Date':     j.effectiveDate,
        'Posted Date':         j.postedDate || '',
        'Creation Date':       j.creationDate,
        'Entered Debit':       j.enteredDebit,
        'Entered Credit':      j.enteredCredit,
        'Accounted Debit':     j.accountedDebit,
        'Accounted Credit':    j.accountedCredit,
        'Legal Entity':        j.legalEntityName,
        'External Reference':  j.externalReference,
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const colWidths = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length + 2, 14) }));
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Journals');
      const period = (lastBaseParamsRef.current.get('period') || 'export').replace(/[^a-zA-Z0-9-]/g, '_');
      const fileName = `Journals_${period}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      message.success({ content: `Exported ${allRows.length} journals to ${fileName}`, key, duration: 4 });
    } catch (e: any) {
      message.error({ content: `Export failed: ${e.message}`, key, duration: 5 });
    } finally {
      setExportLoading(false);
    }
  };

  const handleOpenBulkPost = () => {
    const selectedJournals = journals.filter(j => selectedRowKeys.includes(j.key));
    const items: BulkPostItem[] = selectedJournals.map(j => ({
      key: j.key,
      journal: j,
      status: j.statusMeaning === 'Posted' ? 'skipped' : 'pending',
      validationErrors: j.statusMeaning === 'Posted' ? ['Already posted — will be skipped.'] : [],
    }));
    setBulkPostItems(items);
    setBulkPostRunning(false);
    setBulkPostDone(false);
    setBulkPostVisible(true);
  };

  // Run the bulk post sequentially
  const handleBulkPost = async () => {
    setBulkPostRunning(true);
    setBulkPostDone(false);

    // Step 1: validate all pending items
    let results: BulkPostItem[] = bulkPostItems.map(item => {
      if (item.status === 'skipped') return item;
      const errors = validateForBulkPost(item.journal);
      return {
        ...item,
        validationErrors: errors,
        status: errors.length > 0 ? 'validation_failed' : 'pending',
      } as BulkPostItem;
    });
    setBulkPostItems([...results]);

    // Small pause so UI updates before API calls start
    await new Promise(r => setTimeout(r, 80));

    // Step 2: post eligible items one by one
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'pending') continue;

      results[i] = { ...results[i], status: 'posting' };
      setBulkPostItems([...results]);

      try {
        const resp = await postJournal(results[i].journal.jeBatchId);
        if (resp.success) {
          results[i] = { ...results[i], status: 'posted' };
        } else {
          const serverErrors = resp.errors || [];
          results[i] = {
            ...results[i],
            status: 'failed',
            validationErrors: [...results[i].validationErrors, ...serverErrors],
            serverError: resp.error,
          };
        }
      } catch (err) {
        results[i] = {
          ...results[i],
          status: 'failed',
          serverError: err instanceof Error ? err.message : 'Network error',
        };
      }
      setBulkPostItems([...results]);
    }

    // Step 3: update the main journals table for successfully posted batches
    const postedBatchIds = new Set(
      results.filter(r => r.status === 'posted').map(r => r.journal.jeBatchId)
    );
    if (postedBatchIds.size > 0) {
      setJournals(prev =>
        prev.map(j =>
          postedBatchIds.has(j.jeBatchId)
            ? { ...j, statusMeaning: 'Posted', status: 'P' }
            : j
        )
      );
    }

    setBulkPostRunning(false);
    setBulkPostDone(true);
  };

  // Helper function to get currency name
  const getCurrencyName = (code: string) => {
    const currencies: Record<string, string> = {
      'INR': 'Indian Rupee',
      'USD': 'US Dollar',
      'AED': 'UAE Dirham',
      'EUR': 'Euro',
      'GBP': 'British Pound',
    };
    return currencies[code] || code;
  };

  // Render Journal Edit Panel (for tab content)
  const renderJournalEditPanel = (journal: JournalRecord, tabKey: string, sourceUrl?: string) => {
    const formatNumber = (num: number | null | undefined) => {
      if (num === null || num === undefined) return '';
      return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Source / posted flags
    const isNewDraft   = journal.jeBatchId === 0;
    const isManual     = isNewDraft || (journal.source || '').trim().toUpperCase() === 'MANUAL';
    const isPosted     = journal.statusMeaning === 'Posted';
    const isInEditMode = !isPosted && isManual && !!(tabEditMode[tabKey]);
    const isEditable   = isInEditMode; // alias used throughout

    // ── Pencil-edit for Accounting Period + Date (any status, incl. Posted) ──
    const postedEditActive = postedPeriodEdit?.tabKey === tabKey;
    const postedPeriodsList = postedPeriods.length ? postedPeriods : periods;
    const postedInfo = postedPeriodsList.find(p => p.period_name_id === postedPeriodEdit?.period);
    const postedDateOk = (d: dayjs.Dayjs | null): boolean => {
      if (!d || !postedInfo) return true;
      const s = dayjs(String(postedInfo.start_date).slice(0, 10));
      const e = dayjs(String(postedInfo.end_date).slice(0, 10));
      return !d.isBefore(s, 'day') && !d.isAfter(e, 'day');
    };
    const startPostedPeriodEdit = async () => {
      const d = dayjs(String(journal.effectiveDate || '').slice(0, 10));
      setPostedPeriodEdit({ tabKey, period: journal.periodName || '', date: d.isValid() ? d : null });
      if (!postedPeriodsList.length) {
        try {
          const url = `${APEX_DB_CONFIG.baseUrl}/gl/rr-trialbalance/periods?ledger_name=${encodeURIComponent(journal.ledgerName || '')}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          const data = await res.json();
          setPostedPeriods((data.items || []) as Period[]);
        } catch { message.warning('Could not load periods list'); }
      }
    };
    const onPostedPeriodChange = (p: string) => {
      setPostedPeriodEdit(prev => {
        if (!prev) return prev;
        const info = postedPeriodsList.find(x => x.period_name_id === p);
        let date = prev.date;
        if (info) {
          const s = dayjs(String(info.start_date).slice(0, 10));
          const e = dayjs(String(info.end_date).slice(0, 10));
          if (!date || date.isBefore(s, 'day') || date.isAfter(e, 'day')) date = s;
        }
        return { ...prev, period: p, date };
      });
    };
    const postedEditChanged = postedEditActive && !!postedPeriodEdit && (
      postedPeriodEdit.period !== (journal.periodName || '') ||
      (postedPeriodEdit.date ? postedPeriodEdit.date.format('YYYY-MM-DD') : '') !== String(journal.effectiveDate || '').slice(0, 10)
    );
    const savePostedPeriodEdit = async () => {
      if (!postedPeriodEdit || !journal.jeBatchId || !postedPeriodEdit.period || !postedPeriodEdit.date) return;
      if (!postedDateOk(postedPeriodEdit.date)) {
        message.error(`Accounting date must be within ${postedPeriodEdit.period}`);
        return;
      }
      setPostedPeriodUpdating(true);
      try {
        const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${journal.jeBatchId}/period`;
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            jeBatchId: journal.jeBatchId,
            periodName: postedPeriodEdit.period,
            accountingDate: postedPeriodEdit.date.format('YYYY-MM-DD'),
            updatedBy: localStorage.getItem('username') || 'REERP',
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
        const newPeriod = postedPeriodEdit.period;
        const newDate   = postedPeriodEdit.date.format('YYYY-MM-DD');
        setOpenJournalTabs(prev => prev.map(tab =>
          tab.journal.jeBatchId === journal.jeBatchId
            ? { ...tab, journal: { ...tab.journal, periodName: newPeriod, effectiveDate: newDate } }
            : tab
        ));
        setJournals(prev => prev.map(j =>
          j.jeBatchId === journal.jeBatchId ? { ...j, periodName: newPeriod, effectiveDate: newDate } : j
        ));
        message.success(`Period updated to ${newPeriod} (${data.headersUpdated} journal${data.headersUpdated !== 1 ? 's' : ''} updated)`);
        setPostedPeriodEdit(null);
      } catch (e: any) {
        message.error(`Update failed: ${e.message}`);
      } finally {
        setPostedPeriodUpdating(false);
      }
    };
    // Rows for the non-edit-mode layouts: view with pencil, or inline editor.
    const renderPeriodDateRows = (labelSpan: number, valueSpan: number) => (
      <>
        <Col span={labelSpan}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Accounting Period</Text></Col>
        <Col span={valueSpan}>
          {postedEditActive ? (
            <Select
              size="small"
              style={{ width: 160 }}
              showSearch
              value={postedPeriodEdit?.period || undefined}
              loading={!postedPeriodsList.length}
              onChange={onPostedPeriodChange}
              options={postedPeriodsList.map(p => ({ value: p.period_name_id, label: p.period_name_id }))}
            />
          ) : (
            <Space size={4}>
              <Text style={{ fontSize: 13 }}>{journal.periodName}</Text>
              <Tooltip title="Edit period and accounting date">
                <Button size="small" type="text" icon={<EditOutlined />} style={{ color: REDWOOD.info }} onClick={startPostedPeriodEdit} />
              </Tooltip>
            </Space>
          )}
        </Col>
        <Col span={labelSpan}><Text type="secondary" style={{ fontSize: 13 }}>Accounting Date</Text></Col>
        <Col span={valueSpan}>
          {postedEditActive ? (
            <DatePicker
              size="small"
              style={{ width: 160 }}
              format="YYYY-MM-DD"
              value={postedPeriodEdit?.date || null}
              onChange={(d) => setPostedPeriodEdit(prev => prev ? { ...prev, date: d } : prev)}
              disabledDate={(d) => !postedDateOk(d)}
            />
          ) : (
            <Text style={{ fontSize: 13 }}>{journal.effectiveDate}</Text>
          )}
        </Col>
        {postedEditActive && (
          <>
            <Col span={labelSpan} />
            <Col span={valueSpan}>
              <Space size={6}>
                <Button size="small" type="primary" loading={postedPeriodUpdating}
                  disabled={!postedEditChanged || !postedPeriodEdit?.date} onClick={savePostedPeriodEdit}>
                  Update
                </Button>
                <Button size="small" onClick={() => setPostedPeriodEdit(null)} disabled={postedPeriodUpdating}>Cancel</Button>
                <Popover
                  trigger="click"
                  placement="right"
                  title="Update Period — API"
                  content={(() => {
                    const apiUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${journal.jeBatchId}/period`;
                    const apiBody = {
                      jeBatchId: journal.jeBatchId,
                      periodName: postedPeriodEdit?.period || '',
                      accountingDate: postedPeriodEdit?.date ? postedPeriodEdit.date.format('YYYY-MM-DD') : '',
                      updatedBy: localStorage.getItem('username') || 'REERP',
                    };
                    return (
                      <div style={{ maxWidth: 560 }}>
                        <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                          <Tag color="orange" style={{ fontSize: 10 }}>PUT</Tag>URL
                        </Text>
                        <Typography.Paragraph copyable={{ text: apiUrl }}
                          style={{ fontFamily: 'monospace', fontSize: 11, margin: '0 0 8px', wordBreak: 'break-all' }}>
                          {apiUrl}
                        </Typography.Paragraph>
                        <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Request body (JSON)</Text>
                        <Typography.Paragraph copyable={{ text: JSON.stringify(apiBody, null, 2) }}
                          style={{ fontFamily: 'monospace', fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(apiBody, null, 2)}
                        </Typography.Paragraph>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                          Updates RR_GL_JOURNAL_BATCHES.DEFAULT_PERIOD_NAME and every RR_GL_JE_HEADERS
                          row&apos;s PERIOD_NAME + DEFAULT_EFFECTIVE_DATE for JE_BATCH_ID {journal.jeBatchId}.
                        </Text>
                      </div>
                    );
                  })()}
                >
                  <Button size="small" icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }} />
                </Popover>
              </Space>
            </Col>
          </>
        )}
      </>
    );

    // Derive locked company segment from the first line that already has an account code
    const lockedCompanySegment = (() => {
      const allLines = (editableLines[tabKey] || journal.lines || []).filter(Boolean);
      for (const l of allLines) {
        if (l?.account && l.account.includes('-')) return l.account.split('-')[0];
      }
      return undefined;
    })();

    // Company segment consistency check — true when all coded lines share the same first segment
    const companySegmentErrors = (() => {
      const allLines = (editableLines[tabKey] || journal.lines || []).filter(Boolean);
      const coded = allLines.map(l => l?.account?.split('-')[0]).filter(Boolean) as string[];
      const unique = [...new Set(coded)];
      return unique.length > 1 ? unique : [];
    })();

    // Attachment helpers for this tab
    const attachments      = tabAttachments[tabKey]      || [];
    const attSaving        = tabAttSaving[tabKey]        || false;
    const attPreview       = tabAttPreview[tabKey]       ?? null;
    const attPreviewLoading = tabAttPreviewLoading[tabKey] || false;
    const setAttPreview = (val: { url: string; name: string; type: string } | null) =>
      setTabAttPreview(prev => ({ ...prev, [tabKey]: val }));
    const setAttPreviewLoading = (val: boolean) =>
      setTabAttPreviewLoading(prev => ({ ...prev, [tabKey]: val }));

    const loadAttachments = () => {
      fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${journal.jeBatchId}/attachments`, { headers: { Accept: 'application/json' } })
        .then(r => r.json())
        .then(data => {
          const items = (data.items || []) as any[];
          setTabAttachments(prev => ({
            ...prev,
            [tabKey]: items.map((a: any) => ({
              id: a.id, uid: String(a.id),
              name: a.fileName || a.file_name || 'attachment',
              fileType: a.fileType || a.file_type || 'application/octet-stream',
              fileSize: a.fileSize || a.file_size || 0,
              status: 'done' as const,
            })),
          }));
        })
        .catch(() => {});
    };

    const handleAttachmentUpload = (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        setTabAttachments(prev => ({
          ...prev,
          [tabKey]: [...(prev[tabKey] || []), {
            uid: `new-${Date.now()}`, name: file.name,
            fileType: file.type || 'application/octet-stream',
            fileSize: file.size, content: base64, rawFile: file, status: 'done',
          }],
        }));
      };
      reader.readAsDataURL(file);
      return false;
    };

    const handleSaveAttachments = async () => {
      const pending = attachments.filter(a => !a.id);
      if (!pending.length) { message.info('No new attachments to save.'); return; }
      setTabAttSaving(prev => ({ ...prev, [tabKey]: true }));
      let saved = 0;
      const url = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${journal.jeBatchId}/attachments`;
      for (const att of pending) {
        try {
          const content = att.content || await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = (e) => res((e.target?.result as string).split(',')[1]);
            r.onerror = rej; r.readAsDataURL(att.rawFile!);
          });
          const payload = { fileName: att.name, fileType: att.fileType, fileSize: att.fileSize, content: content?.substring(0, 40) + '…[base64]', createdBy: 'User' };
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ ...payload, content }),
          });
          const respText = await resp.text();
          if (resp.ok) {
            saved++;
          } else {
            Modal.error({
              title: <span>Upload Failed — {att.name}</span>,
              width: 620,
              content: (
                <div style={{ fontSize: 12 }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>POST URL:</strong>
                    <pre style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, margin: '4px 0', wordBreak: 'break-all', fontSize: 11 }}>{url}</pre>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Payload (content truncated):</strong>
                    <pre style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, margin: '4px 0', fontSize: 11, maxHeight: 120, overflow: 'auto' }}>{JSON.stringify(payload, null, 2)}</pre>
                  </div>
                  <div>
                    <strong>Server Response (HTTP {resp.status}):</strong>
                    <pre style={{ background: '#fff2f0', padding: '4px 8px', borderRadius: 4, margin: '4px 0', fontSize: 11, maxHeight: 150, overflow: 'auto' }}>{respText}</pre>
                  </div>
                </div>
              ),
            });
          }
        } catch (err: any) {
          Modal.error({
            title: <span>Network Error — {att.name}</span>,
            width: 520,
            content: (
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 8 }}><strong>POST URL:</strong>
                  <pre style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, margin: '4px 0', wordBreak: 'break-all', fontSize: 11 }}>{url}</pre>
                </div>
                <div><strong>Error:</strong> {err?.message || String(err)}</div>
              </div>
            ),
          });
        }
      }
      setTabAttSaving(prev => ({ ...prev, [tabKey]: false }));
      if (saved > 0) { message.success(`${saved} attachment(s) saved.`); loadAttachments(); }
    };

    const handleDeleteAttachment = (att: { id?: number; uid: string; name: string }) => {
      Modal.confirm({
        title: 'Delete Attachment', content: `Delete "${att.name}"?`, okText: 'Delete', okType: 'danger',
        onOk: async () => {
          if (att.id) {
            try {
              await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${journal.jeBatchId}/attachments/${att.id}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
            } catch { message.error('Failed to delete attachment.'); return; }
          }
          setTabAttachments(prev => ({ ...prev, [tabKey]: (prev[tabKey] || []).filter(a => a.uid !== att.uid) }));
        },
      });
    };

    const handleDownloadAttachment = async (att: { id?: number; uid: string; name: string; fileType: string; content?: string }) => {
      let content = att.content;
      let fileType = att.fileType;
      if (!content && att.id) {
        const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${journal.jeBatchId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        content = data.content || data.CONTENT || ''; fileType = data.fileType || data.FILE_TYPE || fileType;
      }
      if (!content) return;
      const blob = new Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))], { type: fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = att.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    const handlePreviewAttachment = async (att: { id?: number; uid: string; name: string; fileType: string; content?: string }) => {
      if (att.content) {
        const blob = new Blob([Uint8Array.from(atob(att.content), c => c.charCodeAt(0))], { type: att.fileType });
        setAttPreview({ url: URL.createObjectURL(blob), name: att.name, type: att.fileType });
        return;
      }
      if (!att.id) return;
      setAttPreviewLoading(true);
      try {
        const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${journal.jeBatchId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        const content = data.content || data.CONTENT || '';
        const fileType = data.fileType || data.FILE_TYPE || att.fileType;
        const blob = new Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))], { type: fileType });
        setAttPreview({ url: URL.createObjectURL(blob), name: att.name, type: fileType });
      } catch { message.error('Failed to load preview.'); }
      finally { setAttPreviewLoading(false); }
    };

    // Per-tab editable state helpers
    const lines = isEditable ? (editableLines[tabKey] || []) : (journal.lines || []);
    // Use per-field fallback so each field independently falls back to journal value
    // (|| on the whole object would break when the saved state is a partial object)
    const _saved = editableJournalFields[tabKey];
    const headerFields = {
      batchDescription:    _saved?.batchDescription    ?? journal.batchDescription    ?? '',
      journalDescription:  _saved?.journalDescription  ?? journal.journalDescription  ?? '',
      category:            _saved?.category            ?? journal.category            ?? '',
      currencyCode:        _saved?.currencyCode        ?? journal.currencyCode        ?? '',
      conversionRate:      _saved?.conversionRate      ?? journal.conversionRate      ?? 1,
      conversionRateType:  _saved?.conversionRateType  ?? journal.conversionRateType  ?? 'User',
      effectiveDate:       _saved?.effectiveDate       ?? journal.effectiveDate       ?? '',
      periodName:          _saved?.periodName          ?? journal.periodName          ?? '',
    };
    const isSaving = tabSaving[tabKey] || false;
    const isPosting = tabPosting[tabKey] || false;
    const selectedLineIndices = selectedLinesByTab[tabKey] || [];

    const handlePrintJournalPDF = () => {
      const doc = new jsPDF('landscape', 'mm', 'a4');
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();

      const RED:   [number,number,number] = [199, 70, 52];
      const DARK:  [number,number,number] = [26, 26, 26];
      const GREY:  [number,number,number] = [107, 107, 107];
      const LGREY: [number,number,number] = [247, 247, 247];
      const WHITE: [number,number,number] = [255, 255, 255];
      const NAVY:  [number,number,number] = [30, 50, 100];
      const M = 14;
      const mid = W / 2;

      // Header bar
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, 22, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...WHITE);
      doc.text('JOURNAL VOUCHER', mid, 10, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(200, 200, 220);
      doc.text(`Batch: ${journal.batchName}`, mid, 16, { align: 'center' });
      doc.text(`Generated: ${dayjs().format('DD-MMM-YYYY HH:mm')}`, mid, 20, { align: 'center' });

      // Status badge
      const statusLabel = isPosted ? 'POSTED' : 'UNPOSTED';
      const statusColor: [number,number,number] = isPosted ? [29, 123, 77] : [212, 168, 0];
      doc.setFillColor(...statusColor);
      doc.roundedRect(W - M - 28, 5, 28, 12, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...WHITE);
      doc.text(statusLabel, W - M - 14, 12.5, { align: 'center' });

      let y = 28;

      // Two-column info panels
      doc.setFillColor(...LGREY);
      doc.rect(M, y, (W - 2 * M) / 2 - 3, 38, 'F');
      doc.setDrawColor(...RED);
      doc.setLineWidth(0.6);
      doc.line(M, y, M, y + 38);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...RED);
      doc.text('BATCH INFORMATION', M + 3, y + 5);
      doc.setTextColor(...DARK);
      ([
        ['Batch Name',        journal.batchName || '-'],
        ['Accounting Period', journal.periodName || '-'],
        ['Balance Type',      journal.balanceType || '-'],
        ['Batch Description', journal.batchDescription || '-'],
      ] as [string,string][]).forEach(([lbl, val], i) => {
        const fy = y + 11 + i * 7;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(lbl.toUpperCase(), M + 3, fy);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...DARK);
        doc.text(String(val).substring(0, 50), M + 3, fy + 4);
      });

      const rX = mid + 3;
      doc.setFillColor(...LGREY);
      doc.rect(rX, y, (W - 2 * M) / 2 - 3, 38, 'F');
      doc.setDrawColor(...RED);
      doc.line(rX, y, rX, y + 38);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...RED);
      doc.text('JOURNAL INFORMATION', rX + 3, y + 5);
      doc.setTextColor(...DARK);
      ([
        ['Journal Name', journal.journalName || '-'],
        ['Ledger',       journal.ledgerName || '-'],
        ['Legal Entity', journal.legalEntityName || '-'],
        ['Category',     headerFields.category || journal.category || '-'],
      ] as [string,string][]).forEach(([lbl, val], i) => {
        const fy = y + 11 + i * 7;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(lbl.toUpperCase(), rX + 3, fy);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...DARK);
        doc.text(String(val).substring(0, 50), rX + 3, fy + 4);
      });

      y += 41;

      // Row 1: Currency / Accounting Date / Source
      const colW3 = (W - 2 * M) / 3;
      ([
        ['Currency',        headerFields.currencyCode || journal.currencyCode || '-'],
        ['Accounting Date', headerFields.effectiveDate || journal.effectiveDate || '-'],
        ['Source',          journal.source || '-'],
      ] as [string,string][]).forEach(([lbl, val], ci) => {
        const cx = M + ci * colW3;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(lbl.toUpperCase(), cx, y + 3);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
        doc.text(val, cx, y + 8);
      });
      y += 13;

      // Row 2: Conv rate type / conv rate
      const colW4 = (W - 2 * M) / 4;
      ([
        ['Conv. Rate Type', headerFields.conversionRateType || journal.conversionRateType || '-'],
        ['Conv. Rate',      String(headerFields.conversionRate ?? journal.conversionRate ?? 1)],
        ['Journal ID',      String(journal.jeHeaderId || '-')],
        ['Batch ID',        String(journal.jeBatchId || '-')],
      ] as [string,string][]).forEach(([lbl, val], ci) => {
        const cx = M + ci * colW4;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(lbl.toUpperCase(), cx, y + 3);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
        doc.text(val, cx, y + 8);
      });
      y += 13;

      doc.setDrawColor(...RED);
      doc.setLineWidth(0.4);
      doc.line(M, y, W - M, y);
      y += 4;

      // Journal lines table
      const fmt = (n: number | null | undefined) =>
        n == null ? '' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const totalDr = lines.reduce((s, l) => s + (l.enteredDr || 0), 0);
      const totalCr = lines.reduce((s, l) => s + (l.enteredCr || 0), 0);
      const totalADr = lines.reduce((s, l) => s + (l.accountedDr || 0), 0);
      const totalACr = lines.reduce((s, l) => s + (l.accountedCr || 0), 0);
      const balanced = Math.abs(totalDr - totalCr) < 0.01;

      const tableData = lines.map(l => [
        String(l.lineNum ?? ''),
        l.account || '-',
        l.accountDescription || '-',
        l.currency || headerFields.currencyCode || '',
        fmt(l.enteredDr),
        fmt(l.enteredCr),
        fmt(l.accountedDr),
        fmt(l.accountedCr),
        l.description || '',
      ]);
      tableData.push([
        '', 'TOTAL', '', '',
        fmt(totalDr), fmt(totalCr), fmt(totalADr), fmt(totalACr),
        balanced ? '✓ Balanced' : '✗ UNBALANCED',
      ]);

      const cur = headerFields.currencyCode || journal.currencyCode || '';
      autoTable(doc, {
        startY: y,
        head: [['#', 'Account Code', 'Account Description', 'Cur',
                `Entered Dr (${cur})`, `Entered Cr (${cur})`,
                'Acctd Dr', 'Acctd Cr', 'Description']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: NAVY, textColor: WHITE, fontSize: 7.5, fontStyle: 'bold', halign: 'center', cellPadding: 2.5 },
        bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
        alternateRowStyles: { fillColor: [240, 243, 250] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 42, font: 'courier' },
          2: { cellWidth: 42 },
          3: { cellWidth: 11, halign: 'center' },
          4: { cellWidth: 26, halign: 'right' },
          5: { cellWidth: 26, halign: 'right' },
          6: { cellWidth: 26, halign: 'right' },
          7: { cellWidth: 26, halign: 'right' },
          8: { cellWidth: 'auto' },
        },
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fontSize = 8.5;
            data.cell.styles.fillColor = [230, 235, 245];
            if (data.column.index === 8) data.cell.styles.textColor = balanced ? [29, 123, 77] : RED;
          }
        },
        didDrawPage: () => {
          doc.setFillColor(...NAVY);
          doc.rect(0, 0, W, 6, 'F');
          doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...WHITE);
          doc.text(`Journal Voucher — ${journal.batchName}`, mid, 4.5, { align: 'center' });
          const pg = (doc as any).internal.getCurrentPageInfo().pageNumber;
          doc.setFontSize(7); doc.setTextColor(...GREY);
          doc.text(`Page ${pg}`, W - M, H - 4, { align: 'right' });
        },
        margin: { left: M, right: M, top: 8 },
      });

      const tableEndY = (doc as any).lastAutoTable.finalY;
      let fy = tableEndY + 8;
      if (fy + 40 > H - 8) { doc.addPage(); fy = 20; }

      doc.setDrawColor(...NAVY); doc.setLineWidth(0.4);
      doc.line(M, fy, W - M, fy);
      fy += 5;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NAVY);
      doc.text('APPROVAL & AUTHORISATION', M, fy);
      fy += 8;

      const sigBoxW = (W - 2 * M - 9) / 4;
      ['Prepared By', 'Checked By', 'Approved By', 'Posted By'].forEach((lbl, i) => {
        const sx = M + i * (sigBoxW + 3);
        doc.setDrawColor(...GREY); doc.setLineWidth(0.3); doc.setFillColor(252, 252, 255);
        doc.roundedRect(sx, fy, sigBoxW, 28, 1.5, 1.5, 'FD');
        doc.setFillColor(...NAVY);
        doc.roundedRect(sx, fy, sigBoxW, 7, 1.5, 1.5, 'F');
        doc.rect(sx, fy + 4, sigBoxW, 3, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...WHITE);
        doc.text(lbl.toUpperCase(), sx + sigBoxW / 2, fy + 5, { align: 'center' });
        doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY);
        doc.text('Date: _______________', sx + sigBoxW / 2, fy + 26.5, { align: 'center' });
      });
      fy += 32;

      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GREY);
      doc.text(
        `Batch ID: ${journal.jeBatchId}   |   Ledger: ${journal.ledgerName}   |   Period: ${journal.periodName}   |   Lines: ${lines.length}   |   Printed: ${dayjs().format('DD-MMM-YYYY HH:mm')}`,
        mid, fy, { align: 'center' }
      );

      const fileName = `JournalVoucher_${journal.batchName}_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`;
      const blobUrl = URL.createObjectURL(doc.output('blob'));
      setPdfDataUrl(blobUrl);
      setPdfFileName(fileName);
      setPdfPreviewVisible(true);
    };

    // Get expanded state for this tab
    const isJournalExpanded = journalExpandedState[tabKey] || false;
    const activeDetailTab = activeDetailTabState[tabKey] || 'journal';

    // Toggle expanded state for this tab
    const toggleJournalExpanded = () => {
      setJournalExpandedState(prev => ({ ...prev, [tabKey]: !prev[tabKey] }));
    };

    // Set active detail tab for this tab
    const setActiveDetailTab = (tab: string) => {
      setActiveDetailTabState(prev => ({ ...prev, [tabKey]: tab }));
    };

    // Update any header / batch field
    const handleHeaderFieldChange = (field: string, value: any) => {
      setEditableJournalFields(prev => ({
        ...prev,
        [tabKey]: { ...prev[tabKey], [field]: value },
      }));
    };

    // Changing the accounting period invalidates the accounting date (it must fall inside
    // the period). Set the new period and clear the date so the user re-picks it.
    const handlePeriodChange = (newPeriod: string) => {
      setEditableJournalFields(prev => ({
        ...prev,
        [tabKey]: { ...prev[tabKey], periodName: newPeriod || '', effectiveDate: '' },
      }));
    };

    // BMS rate helpers for this tab
    const bmsRate = tabBmsRate[tabKey] ?? null;
    const bmsRateLoading = tabBmsRateLoading[tabKey] || false;

    const updateLinesCurrency = (currencyCode: string) => {
      setEditableLines(prev => {
        const cur = prev[tabKey] || journal.lines || [];
        return { ...prev, [tabKey]: cur.map(l => ({ ...l, currency: currencyCode })) };
      });
    };

    const recalcLinesAccounted = (rate: number) => {
      setEditableLines(prev => {
        const cur = prev[tabKey] || journal.lines || [];
        return {
          ...prev,
          [tabKey]: cur.map(l => ({
            ...l,
            accountedDr: (l.enteredDr || 0) * rate,
            accountedCr: (l.enteredCr || 0) * rate,
          })),
        };
      });
    };

    const fetchBmsRate = async (currencyCode: string) => {
      const effectiveDate = (editableJournalFields[tabKey]?.effectiveDate || journal.effectiveDate || '');
      updateLinesCurrency(currencyCode || journal.currencyCode);
      if (!currencyCode || currencyCode === 'AED') {
        setTabBmsRate(prev => ({ ...prev, [tabKey]: { rate: 1, inverseRate: 1, rateType: 'User' } }));
        setEditableJournalFields(prev => ({
          ...prev,
          [tabKey]: { ...prev[tabKey], currencyCode, conversionRate: 1, conversionRateType: 'User' },
        }));
        recalcLinesAccounted(1);
        return;
      }
      setTabBmsRateLoading(prev => ({ ...prev, [tabKey]: true }));
      try {
        const dateParam = effectiveDate ? `&rate_date=${effectiveDate}` : '';
        const res = await fetch(
          `${buildCurrencyUrl('currencies/bmsrate')}?source_cur=${currencyCode}&target_cur=AED${dateParam}`,
          { headers: { Accept: 'application/json' } }
        );
        const data = await res.json();
        if (res.ok && data.rate) {
          const rate = parseFloat(data.rate);
          const inverseRate = rate > 0 ? 1 / rate : 1;
          const rateType = data.rate_type || 'Spot';
          setTabBmsRate(prev => ({ ...prev, [tabKey]: { rate, inverseRate, rateType } }));
          setEditableJournalFields(prev => ({
            ...prev,
            [tabKey]: { ...prev[tabKey], currencyCode, conversionRate: rate, conversionRateType: rateType },
          }));
          recalcLinesAccounted(rate);
        } else {
          setTabBmsRate(prev => ({ ...prev, [tabKey]: null }));
          setEditableJournalFields(prev => ({
            ...prev,
            [tabKey]: { ...prev[tabKey], currencyCode },
          }));
        }
      } catch {
        setTabBmsRate(prev => ({ ...prev, [tabKey]: null }));
        setEditableJournalFields(prev => ({
          ...prev,
          [tabKey]: { ...prev[tabKey], currencyCode },
        }));
      } finally {
        setTabBmsRateLoading(prev => ({ ...prev, [tabKey]: false }));
      }
    };

    // Update a line field
    const handleLineChange = (lineIdx: number, field: string, value: any) => {
      const rate = headerFields.conversionRate || 1;
      setEditableLines(prev => {
        const currentLines = [...(prev[tabKey] || [])];
        const updated = { ...currentLines[lineIdx], [field]: value };
        if (field === 'enteredDr') updated.accountedDr = (value || 0) * rate;
        if (field === 'enteredCr') updated.accountedCr = (value || 0) * rate;
        currentLines[lineIdx] = updated;
        return { ...prev, [tabKey]: currentLines };
      });
    };

    // Add a new blank line
    const handleAddLine = () => {
      const currentLines = editableLines[tabKey] || [];
      const newLine: JournalLine = {
        lineId: 0,
        lineNum: currentLines.length + 1,
        account: '',
        description: '',
        enteredDr: 0,
        enteredCr: 0,
        accountedDr: 0,
        accountedCr: 0,
        currency: journal.currencyCode,
      };
      setEditableLines(prev => ({
        ...prev,
        [tabKey]: [...(prev[tabKey] || []), newLine],
      }));
    };

    // Delete a specific line by index
    const handleDeleteLine = (lineIdx: number) => {
      setEditableLines(prev => {
        const newLines = (prev[tabKey] || []).filter((_, i) => i !== lineIdx);
        return { ...prev, [tabKey]: newLines.map((l, i) => ({ ...l, lineNum: i + 1 })) };
      });
      // Remove from selection if present
      setSelectedLinesByTab(prev => ({
        ...prev,
        [tabKey]: (prev[tabKey] || []).filter(i => i !== lineIdx).map(i => i > lineIdx ? i - 1 : i),
      }));
    };

    // Delete selected lines
    const handleDeleteSelectedLines = () => {
      if (selectedLineIndices.length === 0) return;
      setEditableLines(prev => {
        const newLines = (prev[tabKey] || []).filter((_, i) => !selectedLineIndices.includes(i));
        return { ...prev, [tabKey]: newLines.map((l, i) => ({ ...l, lineNum: i + 1 })) };
      });
      setSelectedLinesByTab(prev => ({ ...prev, [tabKey]: [] }));
    };

    // Update single journal line account combination in DB via RR_P_UPDATE_GL_LINES_CC
    const handleUpdateJournalLineAccount = async (modKey: string, modifiedInfo: { original: string; current: string; lineId?: number }) => {
      setUpdatingLineKey(modKey);
      try {
        const [, lineIdx] = modKey.split('-');
        const lineIdxNum = parseInt(lineIdx);
        const currentLine = lines[lineIdxNum];

        const actualLineId = modifiedInfo.lineId || currentLine?.lineId;

        console.log('[Update Account] Full Debug Info:', {
          modKey,
          lineIdx: lineIdxNum,
          currentLine,
          modifiedInfo,
          lineIdFromModified: modifiedInfo.lineId,
          lineIdFromCurrentLine: currentLine?.lineId,
          actualLineIdToUse: actualLineId,
          jeHeaderId: journal.jeHeaderId,
          newAccountCombination: modifiedInfo.current,
        });

        if (!currentLine) {
          message.error('Line not found in current lines array');
          console.error('[Update Account] ERROR: currentLine is null/undefined');
          return;
        }

        if (!actualLineId) {
          message.error('Line ID is missing. Cannot update without lineId.');
          console.error('[Update Account] ERROR: lineId is missing from both modifiedInfo and currentLine');
          return;
        }

        // Payload with lineId from API response
        const payload = {
          jeHeaderId: journal.jeHeaderId,
          lineId: actualLineId,
          accountCombination: modifiedInfo.current,
        };

        const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines/update-account`;
        const payloadStr = JSON.stringify(payload, null, 2);

        console.log('[Update Account] Payload being sent:', payload);

        // Show API payload inspector
        setApiPayload({
          url,
          method: 'POST',
          body: payloadStr,
        });
        setApiPayloadVisible(true);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: payloadStr,
        });

        const result = await response.json();

        console.log('[Update Account] Response:', {
          status: response.status,
          ok: response.ok,
          result,
        });

        if (response.ok && result.status === 'SUCCESS') {
          message.success(`Account combination updated successfully to ${modifiedInfo.current}`);
          setModifiedLines(prev => {
            const updated = { ...prev };
            delete updated[modKey];
            return updated;
          });
        } else {
          message.error(`Update failed: ${result.message || result.error || 'Unknown error'}`);
          console.error('[Update Account] Update failed with response:', result);
        }
      } catch (error) {
        console.error('[Update Account] Exception Error:', error);
        message.error(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setUpdatingLineKey(null);
      }
    };

    // Save handler — calls PUT gl/journals/:jeHeaderId
    const handleSave = async (): Promise<boolean> => {
      if (!headerFields.effectiveDate) {
        message.error('Accounting Date is required.');
        return false;
      }
      if (!headerFields.category) {
        message.error('Category is required.');
        return false;
      }
      if (!headerFields.currencyCode) {
        message.error('Currency is required.');
        return false;
      }
      const totalDr = lines.reduce((s, l) => s + (l.enteredDr || 0), 0);
      const totalCr = lines.reduce((s, l) => s + (l.enteredCr || 0), 0);
      if (Math.abs(totalDr - totalCr) > 0.01) {
        message.error('Journal is out of balance. Debit must equal Credit before saving.');
        return false;
      }
      if (lines.length === 0) {
        message.error('Journal must have at least one line before saving.');
        return false;
      }
      if (companySegmentErrors.length > 1) {
        message.error(`All lines must share the same company segment. Found: ${companySegmentErrors.join(', ')}`);
        return false;
      }

      setTabSaving(prev => ({ ...prev, [tabKey]: true }));
      try {
        const convRate = headerFields.conversionRate || 1;
        const totalDr = lines.reduce((s, l) => s + (l.enteredDr || 0), 0);
        const totalCr = lines.reduce((s, l) => s + (l.enteredCr || 0), 0);

        // Nested payload matching RR_UPDATE_JOURNALS procedure format
        const payload = {
          batch: {
            batchName:        journal.batchName,
            batchDescription: headerFields.batchDescription,
            ledgerName:       journal.ledgerName,
            ledgerId:         '',
            accountingPeriod: headerFields.periodName || journal.periodName,
            status:           'NEW',
            controlTotal:     totalDr,
            runningTotalDr:   totalDr,
            runningTotalCr:   totalCr,
            batchSource:      journal.source || 'Manual',
            createdBy:        'ERP_USER',
          },
          header: {
            journalName:             journal.journalName,
            description:             headerFields.journalDescription,
            periodName:              headerFields.periodName || journal.periodName,
            jeCategory:              headerFields.category,
            jeSource:                journal.source || 'Manual',
            defaultEffectiveDate:    headerFields.effectiveDate || journal.effectiveDate,
            currencyCode:            headerFields.currencyCode,
            currencyConversionRate:  convRate,
            currencyConversionType:  headerFields.conversionRateType || 'User',
            legalEntityName:         journal.legalEntityName,
            ledgerName:              journal.ledgerName,
            ledgerId:                undefined,
            runningTotalDr:          totalDr,
            runningTotalCr:          totalCr,
            createdBy:               'ERP_USER',
          },
          lines: lines.map(l => ({
            description:                 l.description,
            accountCombination:          l.account,
            enteredDr:                   l.enteredDr || 0,
            enteredCr:                   l.enteredCr || 0,
            accountedDr:                 (l.enteredDr || 0) * convRate,
            accountedCr:                 (l.enteredCr || 0) * convRate,
            currencyCode:                l.currency || headerFields.currencyCode || journal.currencyCode,
            currencyConversionRate:      convRate,
            userCurrencyConversionType:  headerFields.conversionRateType || 'User',
            chartOfAccountsName:         'Chart of Accounts',
            createdBy:                   'ERP_USER',
          })),
        };

        let response: Response;
        let result: any;

        if (isNewDraft) {
          // New draft (Reverse / Copy) — create via POST
          const createPayload = {
            batch: {
              ...payload.batch,
              batchName:   journal.batchName,
              status:      'Unposted',
              batchSource: 'Manual',
            },
            header: {
              ...payload.header,
              journalName: journal.journalName,
              jeSource:    'Manual',
            },
            lines: payload.lines,
          };
          response = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createPayload),
          });
          result = await response.json().catch(() => ({}));
          const createOk = response.ok && result?.status === 'SUCCESS';
          const createErr = !createOk ? (result?.message || result?.error || `HTTP ${response.status}`) : undefined;
          if (createErr) {
            message.error(`Save failed: ${createErr}`);
            return false;
          }
          message.success(`Journal created: ${result.batchName || journal.batchName}`);
          // Promote the draft tab to a real journal tab with the new IDs
          setOpenJournalTabs(prev =>
            prev.map(tab =>
              tab.key === tabKey
                ? {
                    ...tab,
                    isNewDraft: false,
                    journal: {
                      ...tab.journal,
                      jeBatchId:          result.jeBatchId ?? 0,
                      batchId:            result.jeBatchId ?? 0,
                      jeHeaderId:         result.jeHeaderId ?? 0,
                      headerId:           result.jeHeaderId ?? 0,
                      batchName:          result.batchName || journal.batchName,
                      journalName:        result.batchName || journal.batchName,
                      batchDescription:   headerFields.batchDescription,
                      journalDescription: headerFields.journalDescription,
                      category:           headerFields.category,
                      currencyCode:       headerFields.currencyCode,
                      conversionRate:     convRate,
                      conversionRateType: headerFields.conversionRateType,
                      effectiveDate:      headerFields.effectiveDate || journal.effectiveDate,
                      periodName:         headerFields.periodName || journal.periodName,
                      statusMeaning:      'Unposted',
                      lines:              lines.map(l => ({ ...l })),
                    },
                  }
                : tab
            )
          );
          setTabEditMode(prev => ({ ...prev, [tabKey]: false }));
        } else {
          // Existing journal — update via PUT
          response = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/update/${journal.jeBatchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          result = await response.json().catch(() => ({}));
          const saveOk = response.ok && (result?.success === true || result?.jeBatchId);
          const saveErr = !saveOk ? (result?.message || result?.error || `HTTP ${response.status}`) : undefined;
          if (saveErr) {
            message.error(`Save failed: ${saveErr}`);
            return false;
          }
          message.success('Journal saved successfully');
          setOpenJournalTabs(prev =>
            prev.map(tab =>
              tab.key === tabKey
                ? {
                    ...tab,
                    journal: {
                      ...tab.journal,
                      batchDescription:   headerFields.batchDescription,
                      journalDescription: headerFields.journalDescription,
                      category:           headerFields.category,
                      currencyCode:       headerFields.currencyCode,
                      conversionRate:     convRate,
                      conversionRateType: headerFields.conversionRateType,
                      effectiveDate:      headerFields.effectiveDate || journal.effectiveDate,
                      lines:              lines.map(l => ({ ...l })),
                    },
                  }
                : tab
            )
          );
          setJournals(prev =>
            prev.map(j =>
              j.jeHeaderId === journal.jeHeaderId
                ? {
                    ...j,
                    batchDescription:   headerFields.batchDescription,
                    journalDescription: headerFields.journalDescription,
                    category:           headerFields.category,
                    currencyCode:       headerFields.currencyCode,
                    conversionRate:     convRate,
                    conversionRateType: headerFields.conversionRateType,
                    effectiveDate:      headerFields.effectiveDate || journal.effectiveDate,
                  }
                : j
            )
          );
        }
        return true;
      } catch (err) {
        message.error('Failed to save journal');
        return false;
      } finally {
        setTabSaving(prev => ({ ...prev, [tabKey]: false }));
      }
    };

    // Open a pre-filled draft tab for Reverse or Copy (no DB call until user clicks Save)
    const openReverseCopyDraft = (reversed: boolean) => {
      const srcLines = (editableLines[tabKey] || journal.lines || []);
      const convRate = journal.conversionRate || 1;
      const label = reversed ? 'Reversal' : 'Copy';
      // Tab label: "Reversal (Draft)" / "Copy (Draft)" — DB will assign the real name on save
      const draftDisplayName = `${label} (Draft)`;
      // Description references the original batch so it's traceable
      const originRef = `${label} of: ${journal.journalName} (Batch ID: ${journal.jeBatchId})`;
      const draftLines: JournalLine[] = srcLines.map((l, i) => ({
        ...l,
        lineId:      -(i + 1),
        lineNum:     i + 1,
        enteredDr:   reversed ? (l.enteredCr || 0) : (l.enteredDr || 0),
        enteredCr:   reversed ? (l.enteredDr || 0) : (l.enteredCr || 0),
        accountedDr: reversed ? (l.enteredCr || 0) * convRate : (l.enteredDr || 0) * convRate,
        accountedCr: reversed ? (l.enteredDr || 0) * convRate : (l.enteredCr || 0) * convRate,
      }));
      const draftJournal: JournalRecord = {
        key:                   `draft-${Date.now()}`,
        jeBatchId:             0,
        batchId:               0,
        jeHeaderId:            0,
        headerId:              0,
        batchName:             draftDisplayName,
        batchDescription:      originRef,
        journalName:           draftDisplayName,
        journalDescription:    originRef,
        source:                'Manual',
        status:                'U',
        statusMeaning:         'Unposted',
        approvalStatusMeaning: '',
        postedDate:            null,
        periodName:            journal.periodName,
        category:              journal.category || 'Manual',
        ledgerName:            journal.ledgerName,
        legalEntityName:       journal.legalEntityName || '',
        currencyCode:          journal.currencyCode,
        conversionRate:        convRate,
        conversionRateType:    journal.conversionRateType || 'User',
        enteredDebit:          0,
        enteredCredit:         0,
        accountedDebit:        0,
        accountedCredit:       0,
        effectiveDate:         journal.effectiveDate || '',
        externalReference:     '',
        creationDate:          '',
        lines:                 draftLines,
      };
      openDraftJournalTab(draftJournal, draftLines, {
        batchDescription:   originRef,
        journalDescription: originRef,
        category:           journal.category || 'Manual',
        currencyCode:       journal.currencyCode,
        conversionRate:     convRate,
        conversionRateType: journal.conversionRateType || 'User',
        effectiveDate:      journal.effectiveDate || '',
      });
    };

    const handleReverseJournal = () => openReverseCopyDraft(true);
    const handleCopyJournal    = () => openReverseCopyDraft(false);

    // Post handler — validates, confirms, posts, then stays on page in read-only mode
    const handlePostJournal = () => {
      const totalDr = lines.reduce((s, l) => s + (l.enteredDr || 0), 0);
      const totalCr = lines.reduce((s, l) => s + (l.enteredCr || 0), 0);

      // ── Collect all validation errors ─────────────────────────────────────
      const errors: string[] = [];

      if (lines.length === 0) {
        errors.push('Journal must have at least one line.');
      }

      if (Math.abs(totalDr - totalCr) > 0.01) {
        errors.push(
          `Journal is out of balance — Debit ${formatNumber(totalDr)} ≠ Credit ${formatNumber(totalCr)} ` +
          `(difference: ${formatNumber(Math.abs(totalDr - totalCr))}).`
        );
      }

      const blankAccounts = lines.filter(l => !l.account?.trim());
      if (blankAccounts.length > 0) {
        errors.push(`${blankAccounts.length} line(s) have no account code.`);
      }

      const zeroLines = lines.filter(l => (l.enteredDr || 0) === 0 && (l.enteredCr || 0) === 0);
      if (zeroLines.length > 0) {
        errors.push(`${zeroLines.length} line(s) have both Debit and Credit as zero.`);
      }

      const bothSides = lines.filter(l => (l.enteredDr || 0) > 0 && (l.enteredCr || 0) > 0);
      if (bothSides.length > 0) {
        errors.push(`${bothSides.length} line(s) have both Debit and Credit filled — each line should use only one side.`);
      }

      // Period open check — use periods already fetched for the search form
      const journalPeriod = journal.periodName;
      const periodRecord = periods.find(p => p.period_name_id === journalPeriod);
      if (periodRecord && periodRecord.status !== 'Open') {
        errors.push(`Accounting period "${journalPeriod}" is "${periodRecord.status}". Only Open periods can be posted.`);
      }

      if (!journal.jeBatchId) {
        errors.push('No Batch ID found — cannot post.');
      }

      if (companySegmentErrors.length > 1) {
        errors.push(
          `All journal lines must share the same company segment. ` +
          `Found mixed values: ${companySegmentErrors.join(', ')}. ` +
          `Correct the account combinations before posting.`
        );
      }

      // ── Show errors and stop ───────────────────────────────────────────────
      if (errors.length > 0) {
        Modal.error({
          title: 'Cannot Post Journal',
          width: 540,
          content: (
            <ul style={{ paddingLeft: 20, margin: '8px 0 0', lineHeight: 1.8 }}>
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          ),
        });
        return;
      }

      // ── Confirmation dialog ────────────────────────────────────────────────
      Modal.confirm({
        title: 'Post Journal Batch',
        width: 480,
        okText: 'Post',
        cancelText: 'Cancel',
        okButtonProps: { style: { background: REDWOOD.warning, borderColor: REDWOOD.warning } },
        content: (
          <div style={{ fontSize: 13 }}>
            <p style={{ margin: '8px 0' }}>Are you sure you want to post this journal batch?</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <tbody>
                {[
                  ['Batch', journal.batchName],
                  ['Journal', journal.journalName],
                  ['Period', journal.periodName],
                  ['Currency', headerFields.currencyCode || journal.currencyCode],
                  ['Total Debit', formatNumber(totalDr)],
                  ['Total Credit', formatNumber(totalCr)],
                  ['Lines', String(lines.length)],
                ].map(([label, val]) => (
                  <tr key={label}>
                    <td style={{ color: '#888', paddingBottom: 4, width: '40%' }}>{label}</td>
                    <td style={{ fontWeight: 500, paddingBottom: 4 }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12, padding: '6px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}>
              <Text type="secondary" style={{ fontSize: 10 }}>API — no request body</Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>PUT</Tag>
                <code style={{ fontSize: 11, wordBreak: 'break-all', flex: 1 }}>{`${APEX_DB_CONFIG.baseUrl}/gl/journals/${journal.jeBatchId}/post`}</code>
                <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(`${APEX_DB_CONFIG.baseUrl}/gl/journals/${journal.jeBatchId}/post`); message.success('URL copied'); }} />
              </div>
            </div>
            <p style={{ marginTop: 12, color: REDWOOD.warning, fontSize: 12 }}>
              ⚠ Posted journals cannot be modified.
            </p>
          </div>
        ),
        onOk: async () => {
          // Step 1: save all current edits first so no lines are lost
          const saved = await handleSave();
          if (!saved) return; // save failed — abort post, error already shown

          setTabPosting(prev => ({ ...prev, [tabKey]: true }));
          try {
            const result = await postJournal(journal.jeBatchId);
            if (result.success) {
              message.success('Journal posted successfully');
              // Stay on page — flip tab journal to read-only Posted state
              setOpenJournalTabs(prev =>
                prev.map(tab =>
                  tab.key === tabKey
                    ? { ...tab, journal: { ...tab.journal, statusMeaning: 'Posted', status: 'P' } }
                    : tab
                )
              );
              // Clear editable state — panel becomes read-only
              setEditableLines(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
              setEditableJournalFields(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
              setSelectedLinesByTab(prev => { const n = { ...prev }; delete n[tabKey]; return n; });
            } else {
              // Server returned validation errors or system error
              const serverErrors: string[] = result.errors || [];
              Modal.error({
                title: 'Post Failed',
                width: 540,
                content: serverErrors.length > 0 ? (
                  <div>
                    <p style={{ marginBottom: 8 }}>{result.error}</p>
                    <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
                      {serverErrors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                ) : (result.error || 'An unexpected error occurred.'),
              });
            }
          } catch {
            Modal.error({ title: 'Post Failed', content: 'Could not connect to server.' });
          } finally {
            setTabPosting(prev => ({ ...prev, [tabKey]: false }));
          }
        },
      });
    };

    // Render expanded tabs (full details)
    const renderDetailTabs = () => (
      <Tabs
        activeKey={activeDetailTab}
        onChange={setActiveDetailTab}
        style={{ padding: '0 12px' }}
        size="small"
        items={[
          {
            key: 'journal',
            label: <span style={{ fontSize: 14 }}>Journal</span>,
            children: (
              <div style={{ padding: '12px 0' }}>
                <Row gutter={[32, 8]}>
                  <Col span={12}>
                    <Row gutter={[6, 8]}>
                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Journal</Text></Col>
                      <Col span={14}><Text strong style={{ fontSize: 13 }}>{journal.journalName}</Text></Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Description</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <Input
                            size="small"
                            style={{ fontSize: 13 }}
                            value={headerFields.journalDescription}
                            onChange={e => handleHeaderFieldChange('journalDescription', e.target.value)}
                            placeholder="Journal description"
                          />
                        ) : (
                          <Text style={{ fontSize: 13 }}>{journal.journalDescription || '-'}</Text>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Ledger</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>{journal.ledgerName}</Text></Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Legal Entity</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>{journal.legalEntityName || ledgerLegalEntityMap[journal.ledgerName] || '-'}</Text></Col>

                      {isEditable ? (
                        <>
                          <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Accounting Period</Text></Col>
                          <Col span={14}>
                            <Select
                              size="small"
                              style={{ width: '100%', fontSize: 13 }}
                              showSearch
                              optionFilterProp="children"
                              value={headerFields.periodName || undefined}
                              placeholder="Select period"
                              onChange={v => handlePeriodChange(v)}
                            >
                              {periods.map(p => (
                                <Option key={p.period_name_id} value={p.period_name_id}>
                                  {p.period_name_id} ({p.status})
                                </Option>
                              ))}
                            </Select>
                          </Col>

                          <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Accounting Date</Text></Col>
                          <Col span={14}>
                            {(() => {
                              const p = periods.find(pr => pr.period_name_id === (headerFields.periodName || journal.periodName));
                              const pStart = p?.start_date ? dayjs(p.start_date) : null;
                              const pEnd   = p?.end_date   ? dayjs(p.end_date)   : null;
                              return (
                                <DatePicker
                                  size="small"
                                  style={{ width: '100%' }}
                                  format="DD-MMM-YYYY"
                                  value={headerFields.effectiveDate ? dayjs(headerFields.effectiveDate) : null}
                                  placeholder={headerFields.periodName ? 'Select date in period' : 'Select a period first'}
                                  onChange={v => handleHeaderFieldChange('effectiveDate', v ? v.format('YYYY-MM-DD') : '')}
                                  disabledDate={current => {
                                    if (!pStart || !pEnd) return false;
                                    return current.isBefore(pStart, 'day') || current.isAfter(pEnd, 'day');
                                  }}
                                />
                              );
                            })()}
                          </Col>
                        </>
                      ) : renderPeriodDateRows(10, 14)}

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Category</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            value={headerFields.category}
                            onChange={v => handleHeaderFieldChange('category', v)}
                            showSearch
                            allowClear
                            placeholder="Select category"
                          >
                            {journalCategories.map(c => <Option key={c} value={c}>{c}</Option>)}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{journal.category}</Text>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Journal Source</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>{journal.source || 'Manual'}</Text></Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <Row gutter={[6, 8]}>
                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Currency</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            showSearch
                            allowClear
                            loading={bmsRateLoading}
                            value={headerFields.currencyCode || undefined}
                            placeholder="Select currency"
                            onChange={v => fetchBmsRate(v || '')}
                            optionFilterProp="children"
                            filterOption={(input, option) =>
                              (option?.value as string || '').toLowerCase().includes(input.toLowerCase()) ||
                              (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                            }
                          >
                            {currencyList.map(c => (
                              <Option key={c.code} value={c.code} label={`${c.code} ${c.name}`}>
                                <span style={{ fontWeight: 600 }}>{c.code}</span>
                                {c.name ? <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>{c.name}</span> : null}
                              </Option>
                            ))}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{headerFields.currencyCode || journal.currencyCode} {getCurrencyName(headerFields.currencyCode || journal.currencyCode)}</Text>
                        )}
                        {isEditable && bmsRate && (
                          <div style={{ fontSize: 10, color: '#52c41a', marginTop: 2 }}>
                            BMS Rate: {bmsRate.rate.toFixed(6)} ({bmsRate.rateType})
                          </div>
                        )}
                        {isEditable && bmsRateLoading && (
                          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Fetching BMS rate…</div>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Conversion Date</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>{journal.effectiveDate}</Text></Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Conversion Rate Type</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            value={headerFields.conversionRateType}
                            onChange={v => handleHeaderFieldChange('conversionRateType', v)}
                          >
                            {['User', 'Spot', 'Corporate', 'Fixed', 'Period Average'].map(t => (
                              <Option key={t} value={t}>{t}</Option>
                            ))}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{headerFields.conversionRateType || journal.conversionRateType || 'User'}</Text>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Conversion Rate</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <InputNumber
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            value={headerFields.conversionRate}
                            min={0}
                            precision={6}
                            onChange={v => { const r = v || 1; handleHeaderFieldChange('conversionRate', r); recalcLinesAccounted(r); }}
                          />
                        ) : (
                          <Text style={{ fontSize: 13 }}>{headerFields.conversionRate ?? journal.conversionRate ?? 1}</Text>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Inverse Rate</Text></Col>
                      <Col span={14}>
                        <Text style={{ fontSize: 13 }}>
                          {(() => {
                            const rate = headerFields.conversionRate ?? journal.conversionRate;
                            return rate && rate > 0 ? (1 / rate).toFixed(6) : '1';
                          })()}
                        </Text>
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Reference</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>{journal.externalReference || '-'}</Text></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'controlTotal',
            label: <span style={{ fontSize: 14 }}>Control Total</span>,
            children: (
              <div style={{ padding: '12px 0' }}>
                <Row gutter={[32, 12]}>
                  <Col span={12}>
                    <Text strong style={{ fontSize: 14, marginBottom: 8, display: 'block' }}>Control Total</Text>
                    <Row gutter={[6, 8]}>
                      <Col span={12}><Text type="secondary" style={{ fontSize: 13 }}>Total Entered Debit</Text></Col>
                      <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.enteredDebit)}</Text></Col>

                      <Col span={12}><Text type="secondary" style={{ fontSize: 13 }}>Total Entered Credit</Text></Col>
                      <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.enteredCredit)}</Text></Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <div style={{ marginTop: 20 }}>
                      <Row gutter={[6, 8]}>
                        <Col span={12}><a style={{ color: REDWOOD.info, fontSize: 13 }}>Total Accounted Debit</a></Col>
                        <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.accountedDebit)}</Text></Col>

                        <Col span={12}><a style={{ color: REDWOOD.info, fontSize: 13 }}>Total Accounted Credit</a></Col>
                        <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.accountedCredit)}</Text></Col>
                      </Row>
                    </div>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'sequencing',
            label: <span style={{ fontSize: 14 }}>Sequencing</span>,
            children: (
              <div style={{ padding: '12px 0' }}>
                <Row gutter={[32, 12]}>
                  <Col span={12}>
                    <a style={{ color: REDWOOD.info, fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 8 }}>Accounting Sequence</a>
                    <Row gutter={[6, 8]}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Name</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Number</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <a style={{ color: REDWOOD.info, fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 8 }}>Reporting Sequence</a>
                    <Row gutter={[6, 8]}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Name</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Number</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'reversal',
            label: <span style={{ fontSize: 14 }}>Reversal</span>,
            children: (
              <div style={{ padding: '12px 0' }}>
                <Row gutter={[32, 12]}>
                  <Col span={12}>
                    <Row gutter={[6, 8]}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Reversal Period</Text></Col>
                      <Col span={16}>
                        <Select placeholder="Select period" style={{ width: 160, fontSize: 13 }} size="small" allowClear>
                          <Option value="Feb-25">Feb-25</Option>
                          <Option value="Mar-25">Mar-25</Option>
                        </Select>
                      </Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Reversal Method</Text></Col>
                      <Col span={16}>
                        <Select defaultValue="switchDrCr" style={{ width: 160, fontSize: 13 }} size="small">
                          <Option value="switchDrCr">Switch DR or CR</Option>
                          <Option value="changeSign">Change Sign</Option>
                        </Select>
                      </Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <Row gutter={[6, 8]}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Reversal Status</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>Not reversed</Text></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
        ]}
      />
    );

    // Render collapsed tabs (compact view)
    const renderCollapsedJournal = () => (
      <Tabs
        activeKey={activeDetailTab}
        onChange={setActiveDetailTab}
        size="small"
        style={{ padding: '0 10px' }}
        items={[
          {
            key: 'journal',
            label: <span style={{ fontSize: 13 }}>Journal</span>,
            children: (
              <div style={{ padding: '6px 0' }}>
                <Row gutter={[16, 5]}>
                  <Col span={12}>
                    <Row gutter={[6, 5]}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Journal</Text></Col>
                      <Col span={16}><Text strong style={{ fontSize: 13 }}>{journal.journalName}</Text></Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Description</Text></Col>
                      <Col span={16}>
                        {isEditable ? (
                          <Input
                            size="small"
                            style={{ fontSize: 13 }}
                            value={headerFields.journalDescription}
                            onChange={e => handleHeaderFieldChange('journalDescription', e.target.value)}
                            placeholder="Journal description"
                          />
                        ) : (
                          <Text style={{ fontSize: 13 }}>{journal.journalDescription || '-'}</Text>
                        )}
                      </Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Ledger</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>{journal.ledgerName}</Text></Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Legal Entity</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>{journal.legalEntityName || ledgerLegalEntityMap[journal.ledgerName] || '-'}</Text></Col>

                      {!isEditable && renderPeriodDateRows(8, 16)}
                      {isEditable && (<>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Accounting Period</Text></Col>
                      <Col span={16}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            showSearch
                            optionFilterProp="children"
                            value={headerFields.periodName || undefined}
                            placeholder="Select period"
                            onChange={v => handlePeriodChange(v)}
                          >
                            {periods.map(p => (
                              <Option key={p.period_name_id} value={p.period_name_id}>
                                {p.period_name_id} ({p.status})
                              </Option>
                            ))}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{journal.periodName}</Text>
                        )}
                      </Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Accounting Date</Text></Col>
                      <Col span={16}>
                        {isEditable ? (() => {
                          const p = periods.find(pr => pr.period_name_id === (headerFields.periodName || journal.periodName));
                          const pStart = p?.start_date ? dayjs(p.start_date) : null;
                          const pEnd   = p?.end_date   ? dayjs(p.end_date)   : null;
                          return (
                            <DatePicker
                              size="small"
                              style={{ width: '100%' }}
                              format="DD-MMM-YYYY"
                              value={headerFields.effectiveDate ? dayjs(headerFields.effectiveDate) : null}
                              placeholder={headerFields.periodName ? 'Select date in period' : 'Select a period first'}
                              onChange={v => handleHeaderFieldChange('effectiveDate', v ? v.format('YYYY-MM-DD') : '')}
                              disabledDate={current => {
                                if (!pStart || !pEnd) return false;
                                return current.isBefore(pStart, 'day') || current.isAfter(pEnd, 'day');
                              }}
                            />
                          );
                        })() : (
                          <Text style={{ fontSize: 13 }}>{journal.effectiveDate}</Text>
                        )}
                      </Col>
                      </>)}

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Category</Text></Col>
                      <Col span={16}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            value={headerFields.category}
                            onChange={v => handleHeaderFieldChange('category', v)}
                            showSearch
                            allowClear
                            placeholder="Select category"
                          >
                            {journalCategories.map(c => <Option key={c} value={c}>{c}</Option>)}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{journal.category}</Text>
                        )}
                      </Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <Row gutter={[6, 5]}>
                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Currency</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            showSearch
                            allowClear
                            loading={bmsRateLoading}
                            value={headerFields.currencyCode || undefined}
                            placeholder="Select currency"
                            onChange={v => fetchBmsRate(v || '')}
                            optionFilterProp="children"
                            filterOption={(input, option) =>
                              (option?.value as string || '').toLowerCase().includes(input.toLowerCase()) ||
                              (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                            }
                          >
                            {currencyList.map(c => (
                              <Option key={c.code} value={c.code} label={`${c.code} ${c.name}`}>
                                <span style={{ fontWeight: 600 }}>{c.code}</span>
                                {c.name ? <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>{c.name}</span> : null}
                              </Option>
                            ))}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{headerFields.currencyCode || journal.currencyCode} {getCurrencyName(headerFields.currencyCode || journal.currencyCode)}</Text>
                        )}
                        {isEditable && bmsRate && (
                          <div style={{ fontSize: 10, color: '#52c41a', marginTop: 2 }}>
                            BMS Rate: {bmsRate.rate.toFixed(6)} ({bmsRate.rateType})
                          </div>
                        )}
                        {isEditable && bmsRateLoading && (
                          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Fetching BMS rate…</div>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Conversion Date</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>{journal.effectiveDate}</Text></Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Conversion Rate Type</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <Select
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            value={headerFields.conversionRateType}
                            onChange={v => handleHeaderFieldChange('conversionRateType', v)}
                          >
                            {['User', 'Spot', 'Corporate', 'Fixed', 'Period Average'].map(t => (
                              <Option key={t} value={t}>{t}</Option>
                            ))}
                          </Select>
                        ) : (
                          <Text style={{ fontSize: 13 }}>{headerFields.conversionRateType || journal.conversionRateType || 'User'}</Text>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Conversion Rate</Text></Col>
                      <Col span={14}>
                        {isEditable ? (
                          <InputNumber
                            size="small"
                            style={{ width: '100%', fontSize: 13 }}
                            value={headerFields.conversionRate}
                            min={0}
                            precision={6}
                            onChange={v => { const r = v || 1; handleHeaderFieldChange('conversionRate', r); recalcLinesAccounted(r); }}
                          />
                        ) : (
                          <Text style={{ fontSize: 13 }}>{headerFields.conversionRate ?? journal.conversionRate ?? 1}</Text>
                        )}
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Inverse Rate</Text></Col>
                      <Col span={14}>
                        <Text style={{ fontSize: 13 }}>
                          {(() => {
                            const rate = headerFields.conversionRate ?? journal.conversionRate;
                            return rate && rate > 0 ? (1 / rate).toFixed(6) : '1';
                          })()}
                        </Text>
                      </Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'controlTotal',
            label: <span style={{ fontSize: 13 }}>Control Total</span>,
            children: (
              <div style={{ padding: '6px 0' }}>
                <Row gutter={[24, 5]}>
                  <Col span={12}>
                    <Row gutter={[6, 5]}>
                      <Col span={12}><Text type="secondary" style={{ fontSize: 13 }}>Total Entered Debit</Text></Col>
                      <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.enteredDebit)}</Text></Col>

                      <Col span={12}><Text type="secondary" style={{ fontSize: 13 }}>Total Entered Credit</Text></Col>
                      <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.enteredCredit)}</Text></Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <Row gutter={[6, 5]}>
                      <Col span={12}><a style={{ color: REDWOOD.info, fontSize: 13 }}>Total Accounted Debit</a></Col>
                      <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.accountedDebit)}</Text></Col>

                      <Col span={12}><a style={{ color: REDWOOD.info, fontSize: 13 }}>Total Accounted Credit</a></Col>
                      <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(journal.accountedCredit)}</Text></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'sequencing',
            label: <span style={{ fontSize: 13 }}>Sequencing</span>,
            children: (
              <div style={{ padding: '6px 0' }}>
                <Row gutter={[24, 5]}>
                  <Col span={12}>
                    <Text strong style={{ fontSize: 13, color: REDWOOD.info }}>Accounting Sequence</Text>
                    <Row gutter={[6, 5]} style={{ marginTop: 4 }}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Name</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Number</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <Text strong style={{ fontSize: 13, color: REDWOOD.info }}>Reporting Sequence</Text>
                    <Row gutter={[6, 5]} style={{ marginTop: 4 }}>
                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Name</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>

                      <Col span={8}><Text type="secondary" style={{ fontSize: 13 }}>Number</Text></Col>
                      <Col span={16}><Text style={{ fontSize: 13 }}>-</Text></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'reversal',
            label: <span style={{ fontSize: 13 }}>Reversal</span>,
            children: (
              <div style={{ padding: '6px 0' }}>
                <Row gutter={[24, 5]}>
                  <Col span={12}>
                    <Row gutter={[6, 5]}>
                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Reversal Period</Text></Col>
                      <Col span={14}>
                        <Select placeholder="Select" size="small" style={{ width: 130, fontSize: 13 }} allowClear>
                          <Option value="Feb-25">Feb-25</Option>
                          <Option value="Mar-25">Mar-25</Option>
                        </Select>
                      </Col>

                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Reversal Method</Text></Col>
                      <Col span={14}>
                        <Select defaultValue="switchDrCr" size="small" style={{ width: 130, fontSize: 13 }}>
                          <Option value="switchDrCr">Switch DR or CR</Option>
                          <Option value="changeSign">Change Sign</Option>
                        </Select>
                      </Col>
                    </Row>
                  </Col>
                  <Col span={12}>
                    <Row gutter={[6, 5]}>
                      <Col span={10}><Text type="secondary" style={{ fontSize: 13 }}>Reversal Status</Text></Col>
                      <Col span={14}><Text style={{ fontSize: 13 }}>Not reversed</Text></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            ),
          },
        ]}
      />
    );

    return (
      <div style={{ padding: 16 }}>
        {journal.statusMeaning === 'Posted' && (
          <Alert
            message="This journal is Posted and cannot be modified."
            type="info"
            showIcon
            style={{ marginBottom: 12, fontSize: 12 }}
            banner
          />
        )}
        {/* Journal Batch Card */}
        <Card
          style={{ marginBottom: 12, borderRadius: 6 }}
          bodyStyle={{ padding: 0 }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: REDWOOD.neutral100,
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Space>
              <Text strong style={{ fontSize: 11 }}>
                Journal Batch: {journal.batchName}
              </Text>
              <Text code style={{ fontSize: 10, background: '#e6e6e6', padding: '2px 8px', borderRadius: 3 }}>
                {journal.batchId || journal.jeBatchId}
              </Text>
              <Tooltip title="Copy Batch ID">
                <Button
                  size="small"
                  type="text"
                  style={{ fontSize: 10, height: 22, padding: '0 4px' }}
                  icon={<FileTextOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(String(journal.batchId || journal.jeBatchId));
                    message.success('Batch ID copied');
                  }}
                />
              </Tooltip>
              <Tag
                style={{ fontSize: 10 }}
                color={journal.statusMeaning === 'Posted' ? REDWOOD.success : REDWOOD.warning}
              >
                {journal.statusMeaning}
              </Tag>
              <Tooltip title="View all API calls for this journal">
                <Button
                  size="small"
                  icon={<ApiOutlined />}
                  style={{ fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}
                  onClick={() => openJournalApiModal(tabKey)}
                >
                  APIs
                </Button>
              </Tooltip>
            </Space>
            <Space size="small">
              {/* Reverse and Copy — hidden for unsaved drafts */}
              {!isNewDraft && (
                <>
                  <Tooltip title="Create a new reversal journal (DR ↔ CR swapped)">
                    <Button
                      size="small"
                      icon={<RollbackOutlined />}
                      onClick={handleReverseJournal}
                      style={{ fontSize: 11 }}
                    >
                      Reverse
                    </Button>
                  </Tooltip>
                  <Tooltip title="Create a new draft copy of this journal">
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={handleCopyJournal}
                      style={{ fontSize: 11 }}
                    >
                      Copy
                    </Button>
                  </Tooltip>
                </>
              )}

              {/* Edit button — view mode → edit mode for manual unposted */}
              {isManual && !isPosted && !isInEditMode && (
                <Button
                  size="small"
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setTabEditMode(prev => ({ ...prev, [tabKey]: true }));
                    setEditableJournalFields(prev => {
                      const ex = prev[tabKey] || {};
                      return {
                        ...prev,
                        [tabKey]: {
                          batchDescription:   ex.batchDescription   ?? journal.batchDescription   ?? '',
                          journalDescription: ex.journalDescription ?? journal.journalDescription ?? '',
                          category:           ex.category           ?? journal.category           ?? '',
                          currencyCode:       ex.currencyCode       ?? journal.currencyCode       ?? '',
                          conversionRate:     ex.conversionRate     ?? journal.conversionRate     ?? 1,
                          conversionRateType: ex.conversionRateType ?? journal.conversionRateType ?? 'User',
                          effectiveDate:      ex.effectiveDate      ?? journal.effectiveDate      ?? '',
                        },
                      };
                    });
                    setEditableLines(prev => ({
                      ...prev,
                      [tabKey]: prev[tabKey] || (journal.lines || []).map(l => ({ ...l })),
                    }));
                  }}
                >
                  Edit
                </Button>
              )}

              {/* Save — only in edit mode */}
              {isInEditMode && (
                <>
                  <Button size="small" type="primary" icon={<SaveOutlined />} loading={isSaving} onClick={handleSave}>
                    Save
                  </Button>
                  <Button size="small" icon={<SaveOutlined />} loading={isSaving} onClick={async () => {
                    await handleSave();
                    closeJournalTab(tabKey);
                  }}>
                    Save and Close
                  </Button>
                </>
              )}

              {/* Post — hidden for unsaved drafts */}
              {!isNewDraft && !isPosted && (
                <Button
                  size="small"
                  style={{ fontSize: 10, background: REDWOOD.warning, color: '#fff', borderColor: REDWOOD.warning }}
                  onClick={handlePostJournal}
                  loading={isPosting}
                  icon={<CheckOutlined />}
                >
                  Post
                </Button>
              )}

              {/* Delete Batch — hidden for unsaved drafts */}
              {!isNewDraft && isManual && !isPosted && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setDeleteBatchTarget({ jeBatchId: journal.jeBatchId, batchId: journal.jeBatchId, batchName: journal.batchName, statusMeaning: journal.statusMeaning });
                    setDeleteBatchModalVisible(true);
                  }}
                >
                  Delete Batch
                </Button>
              )}

              {/* Status badge */}
              {isNewDraft ? (
                <Tag color="purple" style={{ fontSize: 10 }}>New — Not Saved</Tag>
              ) : isPosted ? (
                <Tooltip title="Posted journals cannot be edited">
                  <Tag color="green" style={{ fontSize: 10 }}>
                    <CheckCircleOutlined style={{ marginRight: 4 }} />Posted — Read Only
                  </Tag>
                </Tooltip>
              ) : !isManual ? (
                <Tooltip title="Subledger journals are read-only — make changes in the source module (e.g. Petty Cash, AP)">
                  <Tag color="orange" style={{ fontSize: 10 }}>
                    <LockOutlined style={{ marginRight: 4 }} />Subledger — Read Only
                  </Tag>
                </Tooltip>
              ) : isInEditMode ? (
                <Tag color="blue" style={{ fontSize: 10 }}>Editing</Tag>
              ) : null}

              <Tooltip title="Export Journal to PDF">
                <Button
                  size="small"
                  icon={<FilePdfOutlined />}
                  onClick={handlePrintJournalPDF}
                  style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary, fontSize: 11 }}
                >
                  Print PDF
                </Button>
              </Tooltip>

              <Button size="small" icon={<CloseOutlined />} onClick={() => closeJournalTab(tabKey)}>
                Close
              </Button>
            </Space>
          </div>

          <div style={{ padding: 10 }}>
            <Row gutter={[16, 6]}>
              <Col span={12}>
                <Row gutter={[6, 5]}>
                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Journal Batch</Text></Col>
                  <Col span={16}><Text style={{ fontSize: 11 }}>{journal.batchName}</Text></Col>

                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Description</Text></Col>
                  <Col span={16}>
                    {isEditable ? (
                      <Input
                        size="small"
                        style={{ fontSize: 11 }}
                        value={headerFields.batchDescription}
                        onChange={e => handleHeaderFieldChange('batchDescription', e.target.value)}
                        placeholder="Batch description"
                      />
                    ) : (
                      <Text style={{ fontSize: 11 }}>{journal.batchDescription}</Text>
                    )}
                  </Col>

                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Period</Text></Col>
                  <Col span={16}>
                    {isEditable ? (
                      <Select
                        size="small"
                        style={{ width: '100%', fontSize: 11 }}
                        showSearch
                        optionFilterProp="children"
                        value={headerFields.periodName || undefined}
                        placeholder="Select period"
                        onChange={v => handlePeriodChange(v)}
                      >
                        {periods.map(p => (
                          <Option key={p.period_name_id} value={p.period_name_id}>
                            {p.period_name_id} ({p.status})
                          </Option>
                        ))}
                      </Select>
                    ) : (
                      <Text style={{ fontSize: 11 }}>{journal.periodName}</Text>
                    )}
                  </Col>

                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Source</Text></Col>
                  <Col span={16}><Text style={{ fontSize: 11 }}>{journal.source}</Text></Col>
                </Row>
              </Col>
              <Col span={12}>
                <Row gutter={[6, 5]}>
                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Ledger</Text></Col>
                  <Col span={16}><Text style={{ fontSize: 11 }}>{journal.ledgerName}</Text></Col>

                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Currency</Text></Col>
                  <Col span={16}><Text style={{ fontSize: 11 }}>{headerFields.currencyCode || journal.currencyCode}</Text></Col>

                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Status</Text></Col>
                  <Col span={16}>
                    <Tag style={{ fontSize: 10 }} color={journal.statusMeaning === 'Posted' ? REDWOOD.success : REDWOOD.warning}>
                      {journal.statusMeaning}
                    </Tag>
                  </Col>

                  <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Approval</Text></Col>
                  <Col span={16}><Text style={{ fontSize: 11 }}>{journal.approvalStatusMeaning}</Text></Col>
                </Row>
              </Col>
            </Row>
          </div>
        </Card>

        {/* Journal Section with Show More/Show Less */}
        <Card
          style={{ marginBottom: 12, borderRadius: 6 }}
          bodyStyle={{ padding: 0 }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: REDWOOD.neutral100,
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Space>
              <Text strong style={{ fontSize: 11 }}>Journal</Text>
              <a
                onClick={toggleJournalExpanded}
                style={{ color: REDWOOD.info, fontSize: 10 }}
              >
                {isJournalExpanded ? 'Show Less' : 'Show More'}
              </a>
            </Space>
            <Space size="small">
              <Button size="small" icon={<PlusOutlined />} />
              {journal.statusMeaning !== 'Posted' && (
                <Tooltip title="Delete this batch (lines + headers + batch)">
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => promptDeleteBatch(journal)}
                  />
                </Tooltip>
              )}
              <Dropdown menu={{ items: [{ key: 'copy', label: 'Copy' }, { key: 'reverse', label: 'Reverse' }, { key: 'delete', label: 'Delete' }] }}>
                <Button size="small" style={{ fontSize: 10 }}>
                  Journal Actions <DownOutlined />
                </Button>
              </Dropdown>
            </Space>
          </div>

          {isJournalExpanded ? renderDetailTabs() : renderCollapsedJournal()}
        </Card>

        {/* Company segment mismatch warning */}
        {isEditable && companySegmentErrors.length > 1 && (
          <div style={{
            background: '#fff7e6', border: '1px solid #ffc069', borderRadius: 6,
            padding: '8px 14px', marginBottom: 8, fontSize: 12, color: '#ad6800',
          }}>
            <strong>Company segment mismatch:</strong> Lines have different company codes ({companySegmentErrors.join(', ')}).
            All lines must share the same company segment before you can save or post.
          </div>
        )}

        {/* Journal Lines Card */}
        <Card
          style={{ borderRadius: 6 }}
          bodyStyle={{ padding: 0 }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: REDWOOD.neutral100,
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Space>
              <Text strong style={{ fontSize: 12 }}>Journal Lines</Text>
              {isEditable && lines.length > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>{lines.length} line{lines.length !== 1 ? 's' : ''}</Text>
              )}
              <Space size={6}>
                <Typography.Text style={{ fontSize: 11, color: '#666' }}>Show References</Typography.Text>
                <Switch
                  size="small"
                  checked={!!showReferencesByTab[tabKey]}
                  onChange={v => setShowReferencesByTab(prev => ({ ...prev, [tabKey]: v }))}
                />
              </Space>
            </Space>
            {isEditable && (
              <Space size="small">
                <Dropdown menu={{
                  items: [
                    { key: 'add', label: 'Add Row', icon: <PlusOutlined />, onClick: handleAddLine },
                    { key: 'deleteSelected', label: `Delete Selected (${selectedLineIndices.length})`, icon: <DeleteOutlined />, disabled: selectedLineIndices.length === 0, onClick: handleDeleteSelectedLines },
                  ]
                }}>
                  <Button size="small" style={{ fontSize: 11 }}>Actions <DownOutlined /></Button>
                </Dropdown>
                <Button size="small" icon={<PlusOutlined />} onClick={handleAddLine} style={{ fontSize: 11 }}>
                  Add Line
                </Button>
                <Tooltip title={selectedLineIndices.length > 0 ? `Delete ${selectedLineIndices.length} selected` : 'Select lines to delete'}>
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={selectedLineIndices.length === 0}
                    onClick={handleDeleteSelectedLines}
                    danger={selectedLineIndices.length > 0}
                  />
                </Tooltip>
              </Space>
            )}
          </div>

          <Table
            rowSelection={isEditable ? {
              selectedRowKeys: selectedLineIndices,
              onChange: (keys) => setSelectedLinesByTab(prev => ({ ...prev, [tabKey]: keys as number[] })),
              columnWidth: 32,
            } : undefined}
            columns={[
              { title: '#', dataIndex: 'lineNum', key: 'lineNum', width: 45 },
              {
                title: 'Account',
                dataIndex: 'account',
                key: 'account',
                width: isEditable ? 200 : 220,
                render: (account: string, line: JournalLine, rowIdx: number) => {
                  const desc = accountDescMap[account] || line.accountDescription || (line as any).account_description || '';
                  if (isEditable) {
                    return (
                      <div>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input
                            size="small"
                            readOnly
                            style={{ fontSize: 11, fontFamily: 'monospace', cursor: 'pointer', width: 'calc(100% - 28px)', backgroundColor: '#fafafa' }}
                            value={account}
                            placeholder="Click ⊕ to select"
                            onClick={() => setTabAccSel({ visible: true, tabKey, lineIdx: rowIdx, initial: account })}
                          />
                          <Tooltip title="Select Account Combination">
                            <Button
                              size="small"
                              icon={<SearchOutlined />}
                              style={{ borderColor: REDWOOD.neutral300 }}
                              onClick={() => setTabAccSel({ visible: true, tabKey, lineIdx: rowIdx, initial: account })}
                            />
                          </Tooltip>
                        </Space.Compact>
                        {desc && <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2 }}>{desc}</div>}
                      </div>
                    );
                  }
                  return (
                    <div>
                      <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{account || '-'}</span>
                      {desc && <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2 }}>{desc}</div>}
                    </div>
                  );
                },
              },
              {
                title: 'Description',
                dataIndex: 'description',
                key: 'description',
                width: 200,
                ellipsis: !isEditable,
                render: (text: string, line: JournalLine, rowIdx: number) => {
                  if (isEditable) {
                    return (
                      <Input
                        size="small"
                        style={{ fontSize: 11 }}
                        value={text}
                        onChange={e => handleLineChange(rowIdx, 'description', e.target.value)}
                        placeholder="Line description"
                      />
                    );
                  }
                  const isAP = (journal.source || '').toLowerCase() === 'payables';
                  if (isAP && text) {
                    return (
                      <Tooltip title="Click to view AP transaction">
                        <a style={{ color: REDWOOD.info }} onClick={() => handleTransactionDrilldown(journal, line)}>{text}</a>
                      </Tooltip>
                    );
                  }
                  return text || '-';
                },
              },
              { title: 'Currency', dataIndex: 'currency', key: 'currency', width: 70 },
              {
                title: `Entered Dr (${headerFields.currencyCode || journal.currencyCode || 'Entered'})`,
                dataIndex: 'enteredDr',
                key: 'enteredDr',
                width: isEditable ? 120 : 100,
                align: 'right' as const,
                render: (v: number, _line: JournalLine, rowIdx: number) => {
                  if (isEditable) {
                    return (
                      <InputNumber
                        size="small"
                        style={{ fontSize: 11, width: '100%' }}
                        value={v || 0}
                        min={0}
                        precision={2}
                        onChange={val => handleLineChange(rowIdx, 'enteredDr', val || 0)}
                      />
                    );
                  }
                  return v != null ? formatNumber(v) : '';
                },
              },
              {
                title: `Entered Cr (${headerFields.currencyCode || journal.currencyCode || 'Entered'})`,
                dataIndex: 'enteredCr',
                key: 'enteredCr',
                width: isEditable ? 120 : 100,
                align: 'right' as const,
                render: (v: number, _line: JournalLine, rowIdx: number) => {
                  if (isEditable) {
                    return (
                      <InputNumber
                        size="small"
                        style={{ fontSize: 11, width: '100%' }}
                        value={v || 0}
                        min={0}
                        precision={2}
                        onChange={val => handleLineChange(rowIdx, 'enteredCr', val || 0)}
                      />
                    );
                  }
                  return v != null ? formatNumber(v) : '';
                },
              },
              { title: `Acc Dr (${selectedLedger?.currency_code || 'Accounted'})`, dataIndex: 'accountedDr', key: 'accountedDr', width: 90, align: 'right' as const, render: (v: number) => v != null ? formatNumber(v) : '' },
              { title: `Acc Cr (${selectedLedger?.currency_code || 'Accounted'})`, dataIndex: 'accountedCr', key: 'accountedCr', width: 90, align: 'right' as const, render: (v: number) => v != null ? formatNumber(v) : '' },
              ...(!isEditable && (journal.source || '').toLowerCase() === 'payables' ? [{
                title: 'Transaction',
                key: 'viewTransaction',
                width: 130,
                render: (_: any, line: JournalLine) => (
                  <Button size="small" type="link" style={{ fontSize: 11, padding: '0 4px' }} onClick={() => handleTransactionDrilldown(journal, line)}>
                    View Transaction
                  </Button>
                ),
              }] : []),
              ...(showReferencesByTab[tabKey] ? [
                ...[1,2,3,4,5,6,7,8,9,10].map(n => ({
                  title: `Ref ${n}`,
                  dataIndex: `reference${n}`,
                  key: `reference${n}`,
                  width: 140,
                  ellipsis: true,
                  render: (val: string) => val
                    ? <Tooltip title={val}><span style={{ fontSize: 11 }}>{val}</span></Tooltip>
                    : <span style={{ color: '#bbb' }}>—</span>,
                })),
                {
                  title: 'Acct. Class',
                  dataIndex: 'reference3',
                  key: 'accountingClass',
                  width: 160,
                  ellipsis: true,
                  render: (val: string) => val
                    ? <Tag style={{ fontSize: 10 }}>{val}</Tag>
                    : <span style={{ color: '#bbb' }}>—</span>,
                },
                {
                  title: 'Line ID',
                  dataIndex: 'lineId',
                  key: 'lineId',
                  width: 70,
                  render: (val: number) => (
                    <Text code style={{ fontSize: 10, background: '#f5f5f5', padding: '2px 4px', borderRadius: 2 }}>
                      {val || '-'}
                    </Text>
                  ),
                },
                {
                  title: '',
                  key: 'editAcctComb',
                  width: 130,
                  render: (_: any, _line: JournalLine, rowIdx: number) => {
                    const modKey = `${tabKey}-${rowIdx}`;
                    const isModified = modKey in modifiedLines;
                    const isUpdating = updatingLineKey === modKey;
                    return (
                      <Space size={2}>
                        <Tooltip title="Edit Account Combination">
                          <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => setTabAccSel({ visible: true, tabKey, lineIdx: rowIdx, initial: _line.account || '' })}
                            style={{ fontSize: 11, color: REDWOOD.info }}
                          />
                        </Tooltip>
                        {isModified && (
                          <>
                            <Tooltip title="View API request details">
                              <Button
                                size="small"
                                type="text"
                                icon={<ApiOutlined />}
                                onClick={() => {
                                  const payload = {
                                    jeHeaderId: journal.jeHeaderId,
                                    lineId: modifiedLines[modKey].lineId || _line.lineId,
                                    accountCombination: modifiedLines[modKey].current,
                                  };
                                  setApiPayload({
                                    url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines/update-account`,
                                    method: 'POST',
                                    body: JSON.stringify(payload, null, 2),
                                  });
                                  setApiPayloadVisible(true);
                                }}
                                style={{ fontSize: 11, color: REDWOOD.warning }}
                              />
                            </Tooltip>
                            <Tooltip title="Update this line in database">
                              <Button
                                size="small"
                                type="primary"
                                loading={isUpdating}
                                onClick={() => handleUpdateJournalLineAccount(modKey, modifiedLines[modKey])}
                                style={{ fontSize: 10, height: 20, padding: '0 6px' }}
                              >
                                Update
                              </Button>
                            </Tooltip>
                          </>
                        )}
                      </Space>
                    );
                  },
                },
              ] : []),
              ...(isEditable ? [{
                title: '',
                key: 'deleteLine',
                width: 36,
                render: (_: any, _line: JournalLine, rowIdx: number) => (
                  <Tooltip title="Delete line">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteLine(rowIdx)}
                    />
                  </Tooltip>
                ),
              }] : []),
            ]}
            dataSource={lines.map((line, idx) => ({ ...line, key: idx }))}
            pagination={false}
            scroll={{ x: isEditable ? 1200 : 1000 }}
            size="small"
            bordered
            className="compact-table"
            locale={{ emptyText: isEditable ? 'No lines — click + to add a line' : 'No journal lines' }}
            summary={() => {
              const totals = lines.reduce(
                (acc, line) => ({
                  enteredDr: acc.enteredDr + (line.enteredDr || 0),
                  enteredCr: acc.enteredCr + (line.enteredCr || 0),
                  accountedDr: acc.accountedDr + (line.accountedDr || 0),
                  accountedCr: acc.accountedCr + (line.accountedCr || 0),
                }),
                { enteredDr: 0, enteredCr: 0, accountedDr: 0, accountedCr: 0 }
              );
              const isBalanced = Math.abs(totals.enteredDr - totals.enteredCr) < 0.01;
              // column offset: +1 for row-selection checkbox when editable
              const offset = isEditable ? 1 : 0;

              return (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0 + offset} />
                    <Table.Summary.Cell index={1 + offset}>
                      <Text strong style={{ fontSize: 11 }}>Total</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2 + offset} />
                    <Table.Summary.Cell index={3 + offset} />
                    <Table.Summary.Cell index={4 + offset} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(totals.enteredDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5 + offset} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(totals.enteredCr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6 + offset} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(totals.accountedDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7 + offset} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(totals.accountedCr)}</Text>
                    </Table.Summary.Cell>
                    {isEditable && <Table.Summary.Cell index={8 + offset} />}
                  </Table.Summary.Row>
                  <Table.Summary.Row style={{ background: isBalanced ? '#e6f7e6' : '#fff2f0' }}>
                    <Table.Summary.Cell index={0 + offset} colSpan={4}>
                      <Text strong style={{ fontSize: 11 }}>
                        {isBalanced ? '✓ Balanced' : '⚠ Out of Balance'}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4 + offset} colSpan={2} align="right">
                      <Text style={{ fontSize: 11 }}>
                        Difference: {formatNumber(Math.abs(totals.enteredDr - totals.enteredCr))}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6 + offset} colSpan={isEditable ? 3 : 2} align="right">
                      <Text style={{ fontSize: 11 }}>
                        Difference: {formatNumber(Math.abs(totals.accountedDr - totals.accountedCr))}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
          {isEditable && (
            <div
              style={{
                padding: '8px 12px',
                borderTop: `1px solid ${REDWOOD.neutral200}`,
                background: REDWOOD.neutral100,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={handleAddLine}
                style={{ fontSize: 12 }}
              >
                Add Line
              </Button>
              {lines.length > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {lines.length} line{lines.length !== 1 ? 's' : ''}
                </Text>
              )}
            </div>
          )}
        </Card>

        {/* Attachments Section */}
        <Modal
          open={!!attPreview}
          title={attPreview?.name}
          onCancel={() => { if (attPreview) URL.revokeObjectURL(attPreview.url); setAttPreview(null); }}
          footer={
            <Button icon={<DownloadOutlined />}
              onClick={() => attPreview && handleDownloadAttachment({ uid: '', name: attPreview.name, fileType: attPreview.type })}>
              Download
            </Button>
          }
          width={860}
          styles={{ body: { padding: 0, maxHeight: '75vh', overflow: 'auto' } }}
        >
          {attPreviewLoading && <Spin style={{ display: 'block', margin: '40px auto' }} />}
          {attPreview && !attPreviewLoading && (
            attPreview.type.startsWith('image/') ? (
              <img src={attPreview.url} alt={attPreview.name} style={{ width: '100%' }} />
            ) : attPreview.type === 'application/pdf' ? (
              <iframe src={attPreview.url} title={attPreview.name} style={{ width: '100%', height: '70vh', border: 'none' }} />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: REDWOOD.neutral500 }}>
                Preview not available for this file type. Use Download to view it.
              </div>
            )
          )}
        </Modal>

        <Card style={{ borderRadius: 6, marginTop: 8, maxWidth: 640 }} bodyStyle={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Space size={6}>
              <PaperClipOutlined style={{ color: REDWOOD.neutral600, fontSize: 13 }} />
              <Text strong style={{ fontSize: 12 }}>Attachments</Text>
              {attachments.length > 0 && <Tag color="blue" style={{ fontSize: 10, padding: '0 5px', lineHeight: '16px' }}>{attachments.length}</Tag>}
            </Space>
            <Space size={4}>
              {attachments.some(a => !a.id) && (
                <Button size="small" type="primary" loading={attSaving} onClick={handleSaveAttachments}
                  icon={<CloudUploadOutlined />} style={{ fontSize: 11, height: 24 }}>
                  Save
                </Button>
              )}
              <Upload multiple showUploadList={false} beforeUpload={handleAttachmentUpload} accept="*/*">
                <Button size="small" icon={<PaperClipOutlined />}
                  style={{ borderColor: REDWOOD.info, color: REDWOOD.info, fontSize: 11, height: 24 }}>
                  Attach File
                </Button>
              </Upload>
            </Space>
          </div>
          {attachments.length === 0 ? (
            <div style={{ color: REDWOOD.neutral400, fontSize: 11, paddingLeft: 2 }}>No attachments.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {attachments.map(att => (
                <div key={att.uid} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '2px 8px', borderRadius: 3,
                  background: att.id ? REDWOOD.neutral100 : '#fffbe6',
                  border: `1px solid ${att.id ? REDWOOD.neutral200 : '#ffe58f'}`,
                  fontSize: 11, minHeight: 26,
                }}>
                  <PaperClipOutlined style={{ color: REDWOOD.neutral500, flexShrink: 0, fontSize: 11 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                    {att.name}
                  </span>
                  <span style={{ color: REDWOOD.neutral400, fontSize: 10, flexShrink: 0, marginRight: 2 }}>
                    {att.fileSize ? `${(att.fileSize / 1024).toFixed(1)} KB` : ''}
                  </span>
                  {!att.id && <Tag color="warning" style={{ fontSize: 9, padding: '0 4px', margin: 0, lineHeight: '14px' }}>Pending</Tag>}
                  <Tooltip title="Preview">
                    <Button size="small" type="text" icon={<EyeOutlined />} style={{ padding: '0 4px', height: 22, width: 22 }}
                      loading={attPreviewLoading} onClick={() => handlePreviewAttachment(att)} />
                  </Tooltip>
                  <Tooltip title="Download">
                    <Button size="small" type="text" icon={<DownloadOutlined />} style={{ padding: '0 4px', height: 22, width: 22 }}
                      onClick={() => handleDownloadAttachment(att)} />
                  </Tooltip>
                  <Tooltip title="Delete">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ padding: '0 4px', height: 22, width: 22 }}
                      onClick={() => handleDeleteAttachment(att)} />
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </Card>

      {/* Account Combination Selector for this tab */}
      <AccountSelector
        visible={tabAccSel.visible && tabAccSel.tabKey === tabKey}
        onCancel={() => setTabAccSel(prev => ({ ...prev, visible: false }))}
        onSelect={(code, segments) => {
          const accountSegment = Object.entries(segments).find(([key, detail]) =>
            key.toLowerCase().includes('account') || ((detail as any).name || '').toLowerCase().includes('account')
          );
          const desc = accountSegment
            ? `${accountSegment[1].value} - ${accountSegment[1].description}`
            : '';

          // Track modified line if account changed
          const currentLine = lines[tabAccSel.lineIdx];
          if (currentLine && code !== tabAccSel.initial) {
            const modKey = `${tabAccSel.tabKey}-${tabAccSel.lineIdx}`;
            setModifiedLines(prev => ({
              ...prev,
              [modKey]: {
                original: tabAccSel.initial,
                current: code,
                lineId: (currentLine as any).lineId
              }
            }));
          }

          handleLineChange(tabAccSel.lineIdx, 'account', code);
          handleLineChange(tabAccSel.lineIdx, 'accountDescription', desc);
          if (desc) setAccountDescMap(prev => ({ ...prev, [code]: desc }));
          setTabAccSel(prev => ({ ...prev, visible: false }));
        }}
        initialValue={tabAccSel.initial || undefined}
        lockedFirstSegment={lockedCompanySegment}
      />
      </div>
    );
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div style={{
          padding: '12px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/gl">General Ledger</Link> },
              { title: 'Manage Journals' },
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Text strong style={{ fontSize: 16 }}>Manage Journals</Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={openCreateJournalTab}
            >
              Create Journal
            </Button>
          </div>
        </div>

        {/* Tabbed Content */}
        <Tabs
          type="editable-card"
          activeKey={activeTabKey}
          onChange={onTabChange}
          onEdit={onTabEdit}
          hideAdd
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{
            margin: 0,
            padding: '4px 16px 0',
            background: REDWOOD.neutral200,
            borderBottom: `2px solid ${REDWOOD.info}`,
          }}
          items={[
            {
              key: 'search',
              label: (
                <span style={{
                  fontSize: 12,
                  fontWeight: activeTabKey === 'search' ? 600 : 400,
                  color: activeTabKey === 'search' ? REDWOOD.info : REDWOOD.neutral600,
                  padding: '4px 8px',
                }}>
                  <SearchOutlined style={{ marginRight: 6 }} />
                  Search
                  {totalCount > 0 && (
                    <Tag color={REDWOOD.info} style={{ fontSize: 10, marginLeft: 8 }}>{totalCount}</Tag>
                  )}
                </span>
              ),
              closable: false,
              children: (
                <div style={{ padding: 16 }}>
          {/* Collapsible Search Card */}
          <Collapse
            activeKey={searchExpanded}
            onChange={(keys) => setSearchExpanded(keys as string[])}
            style={{
              marginBottom: 16,
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
              background: REDWOOD.surface,
            }}
            expandIconPosition="end"
          >
            <Panel
              header={
                <Space>
                  <FilterOutlined style={{ color: REDWOOD.info, fontSize: 14 }} />
                  <Text strong style={{ fontSize: 13 }}>Search Parameters</Text>
                  {!searchExpanded.includes('search') && journals.length > 0 && (
                    <Tag color={REDWOOD.info} style={{ fontSize: 11 }}>{totalCount} results</Tag>
                  )}
                </Space>
              }
              key="search"
              style={{ borderRadius: 8 }}
            >
              <style>{`.mj-search-form .ant-form-item { margin-bottom: 8px; } .mj-search-form .ant-form-item-label { padding-bottom: 0; }`}</style>
              <Form
                form={form}
                layout="horizontal"
                labelCol={{ span: 7 }}
                wrapperCol={{ span: 17 }}
                size="small"
                className="mj-search-form"
                style={{ fontSize: 12 }}
                initialValues={{
                  journalOperator: 'Starts with',
                  batchOperator: 'Starts with',
                  batchDescOperator: 'Contains',
                  journalNameOperator: 'Starts with',
                }}
              >
                <Row gutter={12}>
                  <Col span={12}>
                    {/* Ledger - Required */}
                    <Form.Item
                      label={<span><span style={{ color: REDWOOD.primary }}>*</span> Ledger</span>}
                      name="ledger"
                      rules={[{ required: true, message: 'Ledger is required' }]}
                    >
                      <Select
                        placeholder="Select ledger"
                        loading={loadingLedgers}
                        onChange={handleLedgerChange}
                      >
                        {ledgers.map(l => (
                          <Option key={l.ledger_id} value={l.ledger_name}>{l.ledger_name}</Option>
                        ))}
                      </Select>
                    </Form.Item>

                    {/* Accounting Period - Required */}
                    <Form.Item
                      label={<span><span style={{ color: REDWOOD.primary }}>*</span> Period</span>}
                      name="accountingPeriod"
                      rules={[{ required: true, message: 'Period is required' }]}
                    >
                      <Select
                        placeholder="Select period"
                        loading={loadingPeriods}
                      >
                        {periods.map(p => (
                          <Option key={p.period_name_id} value={p.period_name_id}>
                            {p.period_year} - {p.period_name_id} ({p.status})
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>

                    {/* Batch Name */}
                    <Form.Item label="Batch Name">
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="batchOperator" noStyle>
                          <Select style={{ width: 105 }}>
                            {operators.map(op => <Option key={op} value={op}>{op}</Option>)}
                          </Select>
                        </Form.Item>
                        <Form.Item name="journalBatch" noStyle>
                          <Input style={{ flex: 1 }} placeholder="Enter batch name" />
                        </Form.Item>
                      </Space.Compact>
                    </Form.Item>

                    {/* Batch Description */}
                    <Form.Item label="Batch Desc">
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="batchDescOperator" noStyle>
                          <Select style={{ width: 105 }}>
                            {operators.map(op => <Option key={op} value={op}>{op}</Option>)}
                          </Select>
                        </Form.Item>
                        <Form.Item name="batchDescription" noStyle>
                          <Input style={{ flex: 1 }} placeholder="Enter batch description" />
                        </Form.Item>
                      </Space.Compact>
                    </Form.Item>

                    {/* Accounting Date */}
                    <Form.Item label="Accounting Date">
                      <Select
                        placeholder="Select date range"
                        allowClear
                        value={acctDatePreset}
                        onChange={(v) => {
                          setAcctDatePreset(v ?? null);
                          if (v !== 'custom') { setAcctFromDate(null); setAcctToDate(null); }
                        }}
                        style={{ width: '100%' }}
                      >
                        <Option value="today">Today</Option>
                        <Option value="last15">Last 15 Days</Option>
                        <Option value="last30">Last 30 Days</Option>
                        <Option value="last60">Last 60 Days</Option>
                        <Option value="custom">Custom Range</Option>
                      </Select>
                    </Form.Item>
                    {acctDatePreset === 'custom' && (
                      <Form.Item label=" " colon={false}>
                        <Space.Compact style={{ width: '100%' }}>
                          <DatePicker
                            value={acctFromDate}
                            onChange={setAcctFromDate}
                            style={{ width: '50%' }}
                            format="DD-MMM-YYYY"
                            placeholder="From"
                            allowClear
                          />
                          <DatePicker
                            value={acctToDate}
                            onChange={setAcctToDate}
                            style={{ width: '50%' }}
                            format="DD-MMM-YYYY"
                            placeholder="To"
                            allowClear
                            disabledDate={(d) => !!acctFromDate && d.isBefore(acctFromDate, 'day')}
                          />
                        </Space.Compact>
                      </Form.Item>
                    )}
                  </Col>

                  <Col span={12}>
                    {/* Journal Name */}
                    <Form.Item label="Journal Name">
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="journalNameOperator" noStyle>
                          <Select style={{ width: 105 }}>
                            {operators.map(op => <Option key={op} value={op}>{op}</Option>)}
                          </Select>
                        </Form.Item>
                        <Form.Item name="journalName" noStyle>
                          <Input style={{ flex: 1 }} placeholder="Enter journal name" />
                        </Form.Item>
                      </Space.Compact>
                    </Form.Item>

                    {/* Journal Description */}
                    <Form.Item label="Journal Desc">
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="journalOperator" noStyle>
                          <Select style={{ width: 105 }}>
                            {operators.map(op => <Option key={op} value={op}>{op}</Option>)}
                          </Select>
                        </Form.Item>
                        <Form.Item name="journalDescription" noStyle>
                          <Input style={{ flex: 1 }} placeholder="Enter description" />
                        </Form.Item>
                      </Space.Compact>
                    </Form.Item>

                    {/* Category */}
                    <Form.Item label="Category" name="category">
                      <Select placeholder="Select category" allowClear showSearch optionFilterProp="children">
                        {glCategories.map(c => (
                          <Option key={c.jeCategoryName} value={c.userJeCategoryName || c.jeCategoryName}>
                            {c.userJeCategoryName || c.jeCategoryName}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>

                    {/* Source */}
                    <Form.Item label="Source" name="source">
                      <Input placeholder="Enter source" allowClear />
                    </Form.Item>

                    {/* Batch Status */}
                    <Form.Item label="Batch Status" name="batchStatus">
                      <Select placeholder="Select status" allowClear>
                        {batchStatuses.map(s => <Option key={s} value={s}>{s}</Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
                  <Button
                    className="mj-search-btn"
                    icon={<SearchOutlined />}
                    onClick={handleSearch}
                    loading={loading}
                  >
                    Search
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset}>
                    Reset
                  </Button>
                  <Button icon={<SaveOutlined />}>
                    Save...
                  </Button>
                  <Button
                    icon={<ExportOutlined />}
                    onClick={handleExportExcel}
                    loading={exportLoading}
                    disabled={!lastBaseParamsRef.current}
                    style={lastBaseParamsRef.current ? { background: '#1D7B4D', borderColor: '#1D7B4D', color: '#fff' } : {}}
                  >
                    Export Excel {journals.length > 0 ? `(${journals.length})` : ''}
                  </Button>
                  <Button
                    icon={<ApiOutlined />}
                    onClick={() => { setApiTestResult(null); setDebugModalVisible(true); }}
                  >
                    Test API
                  </Button>
                </div>
              </Form>
            </Panel>
          </Collapse>

          {/* Results Table */}
          <Card
            style={{
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
            }}
            bodyStyle={{ padding: 0 }}
          >
            {/* Toolbar */}
            <div style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: REDWOOD.neutral100,
            }}>
              <Space size="small">
                <Dropdown menu={{ items: actionsMenu }}>
                  <Button size="small" style={{ fontSize: 11 }}>
                    Actions <DownOutlined />
                  </Button>
                </Dropdown>
                <Dropdown menu={{ items: [
                  { key: 'columns', label: 'Columns' },
                  { key: 'detach', label: 'Detach' },
                  { key: 'sort', label: 'Sort' },
                ] }}>
                  <Button size="small" style={{ fontSize: 11 }}>
                    View <DownOutlined />
                  </Button>
                </Dropdown>
                <Dropdown menu={{ items: [
                  { key: 'wrap', label: 'Wrap' },
                  { key: 'resize', label: 'Resize Columns' },
                ] }}>
                  <Button size="small" style={{ fontSize: 11 }}>
                    Format <DownOutlined />
                  </Button>
                </Dropdown>
                <Tooltip title="Create Journal">
                  <Button size="small" icon={<PlusOutlined />} onClick={openCreateJournalTab} />
                </Tooltip>
                <Tooltip title={
                  journals.find(j => j.key === selectedRowKeys[0])?.statusMeaning === 'Posted'
                    ? 'Posted journals cannot be edited'
                    : undefined
                }>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    disabled={
                      selectedRowKeys.length !== 1 ||
                      journals.find(j => j.key === selectedRowKeys[0])?.statusMeaning === 'Posted'
                    }
                    onClick={() => {
                      const selectedJournal = journals.find(j => j.key === selectedRowKeys[0]);
                      if (selectedJournal) openJournalTab(selectedJournal);
                    }}
                  >
                    Edit
                  </Button>
                </Tooltip>
                {(() => {
                  const deletable = journals.filter(j =>
                    selectedRowKeys.includes(j.key) &&
                    (j.source || '').trim().toUpperCase() === 'MANUAL' &&
                    j.statusMeaning !== 'Posted'
                  );
                  return (
                    <Tooltip title={deletable.length === 0 ? 'Select Manual unposted journals to delete' : `Delete ${deletable.length} journal(s)`}>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={deletable.length === 0}
                        onClick={() => setBulkDeleteModalVisible(true)}
                      >
                        {deletable.length > 0 ? `Delete (${deletable.length})` : 'Delete'}
                      </Button>
                    </Tooltip>
                  );
                })()}
              </Space>
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {totalCount > 0 ? `${totalCount} journals found` : 'No results'}
                </Text>
                <Button
                  size="small"
                  disabled={
                    selectedRowKeys.length === 0 ||
                    journals.filter(j => selectedRowKeys.includes(j.key) && j.statusMeaning !== 'Posted').length === 0
                  }
                  style={{ fontSize: 11, background: selectedRowKeys.length > 0 ? REDWOOD.warning : undefined, color: selectedRowKeys.length > 0 ? '#fff' : undefined, borderColor: selectedRowKeys.length > 0 ? REDWOOD.warning : undefined }}
                  icon={<CheckCircleOutlined />}
                  onClick={handleOpenBulkPost}
                >
                  Post Batch ({journals.filter(j => selectedRowKeys.includes(j.key) && j.statusMeaning !== 'Posted').length})
                </Button>
                <Button size="small" disabled={selectedRowKeys.length === 0} style={{ fontSize: 11 }}>
                  Reverse Batch
                </Button>
                <Tooltip title="View Page APIs">
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    style={{ color: REDWOOD.info, borderColor: REDWOOD.info, fontSize: 11 }}
                    onClick={() => setPageApiModalVisible(true)}
                  />
                </Tooltip>
                {lastSearchUrl && (
                  <Tooltip
                    title={
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
                          Last API Request
                          {lastSearchStatus && (
                            <span style={{
                              marginLeft: 8,
                              color: lastSearchStatus >= 200 && lastSearchStatus < 300 ? '#52c41a' : '#ff4d4f',
                              fontSize: 11,
                            }}>
                              HTTP {lastSearchStatus}
                            </span>
                          )}
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 460 }}>
                          {lastSearchUrl}
                        </div>
                        <div style={{ marginTop: 6, color: '#aaa', fontSize: 10 }}>Click to copy full URL</div>
                      </div>
                    }
                    overlayStyle={{ maxWidth: 500 }}
                    placement="bottomRight"
                  >
                    <Button
                      size="small"
                      icon={<ApiOutlined />}
                      style={{
                        fontSize: 11,
                        borderColor: lastSearchStatus && lastSearchStatus >= 400 ? REDWOOD.error : REDWOOD.info,
                        color: lastSearchStatus && lastSearchStatus >= 400 ? REDWOOD.error : REDWOOD.info,
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(lastSearchUrl);
                        setApiUrlCopied(true);
                        message.success('API URL copied to clipboard');
                        setTimeout(() => setApiUrlCopied(false), 2000);
                      }}
                    >
                      {apiUrlCopied ? <><CheckOutlined /> Copied</> : 'API'}
                    </Button>
                  </Tooltip>
                )}
              </Space>
            </div>

            {/* Quick filter bar */}
            {journals.length > 0 && (
              <div style={{
                padding: '6px 12px',
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#fff',
              }}>
                <FilterOutlined style={{ color: REDWOOD.neutral600, fontSize: 12 }} />
                <Input
                  size="small"
                  placeholder="Filter results — type to search across Batch Name, Journal Name, Description, Category, Source…"
                  prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                  allowClear
                  value={gridFilter}
                  onChange={e => setGridFilter(e.target.value)}
                  style={{ maxWidth: 520, fontSize: 12 }}
                />
                {gridFilter && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {(() => {
                      const q = gridFilter.toLowerCase();
                      const count = journals.filter(j =>
                        [j.batchName, j.batchDescription, j.journalName, j.journalDescription,
                         j.category, j.source, j.statusMeaning, j.periodName, j.ledgerName,
                         j.currencyCode,
                         j.enteredDebit   != null ? String(j.enteredDebit)   : '',
                         j.enteredCredit  != null ? String(j.enteredCredit)  : '',
                         j.accountedDebit != null ? String(j.accountedDebit) : '',
                         j.accountedCredit!= null ? String(j.accountedCredit): '']
                        .some(v => (v || '').toLowerCase().includes(q))
                      ).length;
                      return `${count} of ${journals.length} shown`;
                    })()}
                  </Text>
                )}
              </div>
            )}

            {/* Table */}
            <Table
              rowSelection={rowSelection}
              columns={columns}
              dataSource={gridFilter
                ? journals.filter(j => {
                    const q = gridFilter.toLowerCase();
                    return [j.batchName, j.batchDescription, j.journalName, j.journalDescription,
                            j.category, j.source, j.statusMeaning, j.periodName, j.ledgerName,
                            j.currencyCode,
                            j.runningTotalDr != null ? String(j.runningTotalDr) : '',
                            j.runningTotalCr != null ? String(j.runningTotalCr) : '',
                            j.enteredDebit  != null ? String(j.enteredDebit)  : '',
                            j.enteredCredit != null ? String(j.enteredCredit) : '']
                      .some(v => (v || '').toLowerCase().includes(q));
                  })
                : journals}
              loading={loading}
              onChange={handleTableChange}
              pagination={{
                current: currentPage,
                pageSize: pageSize,
                total: totalCount,
                pageSizeOptions: ['10', '20', '50', '100', '500', '1000'],
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `Total ${total} journals`,
                size: 'small',
              }}
              scroll={{ x: 1800 }}
              size="small"
              style={{ borderRadius: '0 0 12px 12px', fontSize: 12 }}
              className="compact-table"
              locale={{
                emptyText: 'Click Search to load journals',
              }}
            />
          </Card>
                </div>
              ),
            },
            // Create Journal tab (inline, opens when + or Create Journal button clicked)
            ...(createJournalTabOpen ? [{
              key: 'create-journal',
              label: (
                <span style={{
                  fontSize: 12,
                  fontWeight: activeTabKey === 'create-journal' ? 600 : 400,
                  color: activeTabKey === 'create-journal' ? REDWOOD.primary : REDWOOD.neutral600,
                  padding: '4px 8px',
                }}>
                  <PlusOutlined style={{ marginRight: 6, color: REDWOOD.primary }} />
                  Create Journal
                </span>
              ),
              closable: true,
              children: (
                <CreateJournal
                  embeddedMode
                  onSaved={() => {
                    setCreateJournalTabOpen(false);
                    setActiveTabKey('search');
                  }}
                />
              ),
            }] : []),
            // Dynamic journal edit tabs
            ...openJournalTabs.map(tab => ({
              key: tab.key,
              label: (
                <span style={{
                  fontSize: 12,
                  fontWeight: activeTabKey === tab.key ? 600 : 400,
                  color: activeTabKey === tab.key ? REDWOOD.primary : REDWOOD.neutral600,
                  padding: '4px 8px',
                }}>
                  <FileTextOutlined style={{ marginRight: 6, color: REDWOOD.primary }} />
                  {tab.journal.journalName}
                </span>
              ),
              closable: true,
              children: renderJournalEditPanel(tab.journal, tab.key, tab.sourceUrl),
            })),
          ]}
        />
      </Content>

      {/* Floating Connected Icons */}
      <div
        ref={floatingIconsRef}
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Collapse toggle */}
        <Tooltip title={floatingCollapsed ? 'Show panel' : 'Hide panel'} placement="left">
          <div
            onClick={() => setFloatingCollapsed(v => !v)}
            style={{
              width: 36,
              height: 28,
              borderRadius: '8px 8px 0 0',
              background: REDWOOD.neutral200,
              border: `1px solid ${REDWOOD.neutral300}`,
              borderBottom: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 13,
              color: REDWOOD.neutral600,
              transition: 'all 0.2s',
            }}
          >
            {floatingCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        </Tooltip>

        {/* Icon strip — hidden when collapsed */}
        {!floatingCollapsed && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${REDWOOD.neutral200}`,
            borderRadius: '0 0 8px 8px',
            overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            {/* Tasks */}
            <Tooltip title={activePanel !== 'tasks' ? 'Tasks' : ''} placement="left">
              <div
                onClick={() => togglePanel('tasks')}
                style={{
                  width: 44,
                  height: 44,
                  background: activePanel === 'tasks' ? REDWOOD.taskBlue : REDWOOD.surface,
                  borderBottom: `1px solid ${REDWOOD.neutral200}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.2s',
                  color: activePanel === 'tasks' ? '#fff' : REDWOOD.taskBlue,
                  fontSize: 18,
                }}
              >
                <CheckSquareOutlined />
              </div>
            </Tooltip>

            {/* Reports */}
            <Tooltip title={activePanel !== 'reports' ? 'Reports' : ''} placement="left">
              <div
                onClick={() => togglePanel('reports')}
                style={{
                  width: 44,
                  height: 44,
                  background: activePanel === 'reports' ? REDWOOD.reportGreen : REDWOOD.surface,
                  borderBottom: `1px solid ${REDWOOD.neutral200}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.2s',
                  color: activePanel === 'reports' ? '#fff' : REDWOOD.reportGreen,
                  fontSize: 18,
                }}
              >
                <BarChartOutlined />
              </div>
            </Tooltip>

            {/* Autopilot */}
            <Tooltip title={autopilotOpen ? 'Close Autopilot' : 'Autopilot Assistant'} placement="left">
              <div
                onClick={() => setAutopilotOpen(v => !v)}
                style={{
                  width: 44,
                  height: 44,
                  background: autopilotOpen ? '#6B4EFF' : REDWOOD.surface,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.2s',
                  color: autopilotOpen ? '#fff' : '#6B4EFF',
                  fontSize: 18,
                }}
              >
                <RobotOutlined />
              </div>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Backdrop Overlay */}
      {activePanel !== 'none' && (
        <div
          onClick={closePanel}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 1000,
            animation: isClosing ? 'fadeOut 0.25s ease forwards' : 'fadeIn 0.3s ease forwards',
          }}
        />
      )}

      {/* Slide-out Panels */}
      <div ref={panelRef}>
        {activePanel === 'tasks' && (
          <div
            style={{
              position: 'fixed',
              right: 0,
              top: 0,
              bottom: 0,
              width: 300,
              background: REDWOOD.surface,
              boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
              overflow: 'hidden',
              animation: isClosing ? 'slideOut 0.25s ease-in forwards' : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              zIndex: 1001,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              padding: '10px 14px',
              background: REDWOOD.taskBlue,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              <Text strong style={{ color: '#fff', fontSize: 14 }}>Tasks</Text>
              <CloseOutlined
                style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }}
                onClick={closePanel}
              />
            </div>
            <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
              {taskMenuItems.map((item, index) => (
                <div
                  key={item.key}
                  onClick={() => handleMenuItemClick(item.key, item.path)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s ease',
                    marginBottom: 6,
                    border: `1px solid ${REDWOOD.neutral200}`,
                    background: REDWOOD.surface,
                    opacity: 0,
                    animation: `fadeInItem 0.3s ease-out ${index * 0.05}s forwards`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = REDWOOD.neutral100;
                    e.currentTarget.style.borderColor = item.color || REDWOOD.taskBlue;
                    e.currentTarget.style.transform = 'translateX(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = REDWOOD.surface;
                    e.currentTarget.style.borderColor = REDWOOD.neutral200;
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: `${item.color || REDWOOD.taskBlue}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: item.color || REDWOOD.taskBlue,
                    fontSize: 16,
                    flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ display: 'block', color: REDWOOD.neutral900, fontSize: 12 }}>
                      {item.label}
                    </Text>
                    {item.description && (
                      <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>
                        {item.description}
                      </Text>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activePanel === 'reports' && (
          <div
            style={{
              position: 'fixed',
              right: 0,
              top: 0,
              bottom: 0,
              width: 300,
              background: REDWOOD.surface,
              boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
              overflow: 'hidden',
              animation: isClosing ? 'slideOut 0.25s ease-in forwards' : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              zIndex: 1001,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              padding: '10px 14px',
              background: REDWOOD.reportGreen,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              <Text strong style={{ color: '#fff', fontSize: 14 }}>Reports</Text>
              <CloseOutlined
                style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }}
                onClick={closePanel}
              />
            </div>
            <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
              {reportMenuItems.map((item, index) => (
                <div
                  key={item.key}
                  onClick={() => handleMenuItemClick(item.key, item.path)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s ease',
                    marginBottom: 6,
                    border: `1px solid ${REDWOOD.neutral200}`,
                    background: REDWOOD.surface,
                    opacity: 0,
                    animation: `fadeInItem 0.3s ease-out ${index * 0.05}s forwards`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = REDWOOD.neutral100;
                    e.currentTarget.style.borderColor = item.color || REDWOOD.reportGreen;
                    e.currentTarget.style.transform = 'translateX(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = REDWOOD.surface;
                    e.currentTarget.style.borderColor = REDWOOD.neutral200;
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: `${item.color || REDWOOD.reportGreen}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: item.color || REDWOOD.reportGreen,
                    fontSize: 16,
                    flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ display: 'block', color: REDWOOD.neutral900, fontSize: 12 }}>
                      {item.label}
                    </Text>
                    {item.description && (
                      <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>
                        {item.description}
                      </Text>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideOut {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes fadeInItem {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Autopilot — controlled from floating icons */}
      

      {/* ── Bulk Post Modal ─────────────────────────────────────────────────── */}
      {(() => {
        const posted   = bulkPostItems.filter(i => i.status === 'posted').length;
        const failed   = bulkPostItems.filter(i => i.status === 'failed' || i.status === 'validation_failed').length;
        const skipped  = bulkPostItems.filter(i => i.status === 'skipped').length;
        const pending  = bulkPostItems.filter(i => i.status === 'pending').length;
        const posting  = bulkPostItems.filter(i => i.status === 'posting').length;
        const eligible = bulkPostItems.filter(i => i.status !== 'skipped').length;
        const done     = posted + failed;
        const pct      = eligible > 0 ? Math.round((done / eligible) * 100) : 0;

        const statusIcon = (s: BulkPostStatus) => {
          if (s === 'posted')           return <CheckCircleOutlined style={{ color: REDWOOD.success }} />;
          if (s === 'posting')          return <LoadingOutlined style={{ color: REDWOOD.info }} spin />;
          if (s === 'validation_failed') return <WarningOutlined style={{ color: REDWOOD.warning }} />;
          if (s === 'failed')           return <CloseCircleOutlined style={{ color: REDWOOD.error }} />;
          if (s === 'skipped')          return <StopOutlined style={{ color: REDWOOD.neutral600 }} />;
          return <ClockCircleOutlined style={{ color: REDWOOD.neutral300 }} />;
        };

        const statusLabel = (s: BulkPostStatus) => ({
          posted: <Tag color={REDWOOD.success}>Posted</Tag>,
          posting: <Tag color={REDWOOD.info} icon={<LoadingOutlined />}>Posting…</Tag>,
          validation_failed: <Tag color={REDWOOD.warning}>Validation Failed</Tag>,
          failed: <Tag color={REDWOOD.error}>Error</Tag>,
          skipped: <Tag color={REDWOOD.neutral600}>Skipped</Tag>,
          pending: <Tag color={REDWOOD.neutral300}>Pending</Tag>,
        }[s]);

        return (
          <Modal
            title={
              <Space>
                <CheckCircleOutlined style={{ color: REDWOOD.warning }} />
                <span>Bulk Post Journals</span>
                {bulkPostRunning && <Tag color={REDWOOD.info} icon={<LoadingOutlined />}>Running…</Tag>}
                {bulkPostDone   && <Tag color={REDWOOD.success}>Complete</Tag>}
              </Space>
            }
            open={bulkPostVisible}
            width={960}
            maskClosable={!bulkPostRunning}
            closable={!bulkPostRunning}
            onCancel={() => setBulkPostVisible(false)}
            footer={
              bulkPostDone || !bulkPostRunning ? [
                ...(bulkPostDone ? [] : [
                  <Button
                    key="post"
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    style={{ background: REDWOOD.warning, borderColor: REDWOOD.warning }}
                    disabled={eligible === 0}
                    onClick={handleBulkPost}
                  >
                    Post {eligible} Journal{eligible !== 1 ? 's' : ''}
                  </Button>,
                ]),
                <Button key="close" onClick={() => setBulkPostVisible(false)}>
                  {bulkPostDone ? 'Close' : 'Cancel'}
                </Button>,
              ] : []
            }
          >
            {/* ── Summary stat cards ── */}
            <Row gutter={12} style={{ marginBottom: 16 }}>
              {[
                { label: 'Selected',  value: bulkPostItems.length,  color: REDWOOD.neutral900 },
                { label: 'Eligible',  value: eligible,              color: REDWOOD.info },
                { label: 'Skipped',   value: skipped,               color: REDWOOD.neutral600 },
                { label: 'Posted',    value: posted,                color: REDWOOD.success },
                { label: 'Failed',    value: failed,                color: REDWOOD.error },
              ].map(({ label, value, color }) => (
                <Col key={label} span={4}>
                  <Card
                    size="small"
                    bodyStyle={{ padding: '8px 12px', textAlign: 'center' }}
                    style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{label}</div>
                  </Card>
                </Col>
              ))}
              <Col span={4}>
                <Card
                  size="small"
                  bodyStyle={{ padding: '8px 12px', textAlign: 'center' }}
                  style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700, color: posting > 0 ? REDWOOD.info : REDWOOD.neutral600 }}>
                    {posting > 0 ? <LoadingOutlined /> : (bulkPostDone ? '✓' : '-')}
                  </div>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>In Progress</div>
                </Card>
              </Col>
            </Row>

            {/* ── Progress bar (only while running or after completion) ── */}
            {(bulkPostRunning || bulkPostDone) && eligible > 0 && (
              <Progress
                percent={pct}
                status={bulkPostRunning ? 'active' : failed > 0 ? 'exception' : 'success'}
                format={() => `${done} / ${eligible}`}
                style={{ marginBottom: 12 }}
              />
            )}

            {/* ── Journal list table ── */}
            <Table<BulkPostItem>
              size="small"
              pagination={false}
              scroll={{ y: 320 }}
              dataSource={bulkPostItems}
              rowKey="key"
              bordered
              className="compact-table"
              columns={[
                {
                  title: '',
                  key: 'icon',
                  width: 32,
                  align: 'center' as const,
                  render: (_: any, item: BulkPostItem) => statusIcon(item.status),
                },
                {
                  title: 'Journal',
                  dataIndex: ['journal', 'journalName'],
                  key: 'journal',
                  width: 200,
                  ellipsis: true,
                  render: (text: string) => <Text style={{ fontSize: 11 }}>{text}</Text>,
                },
                {
                  title: 'Batch',
                  dataIndex: ['journal', 'batchName'],
                  key: 'batch',
                  width: 180,
                  ellipsis: true,
                  render: (text: string) => <Text style={{ fontSize: 11 }}>{text}</Text>,
                },
                {
                  title: 'Period',
                  dataIndex: ['journal', 'periodName'],
                  key: 'period',
                  width: 90,
                  render: (text: string) => <Text style={{ fontSize: 11 }}>{text}</Text>,
                },
                {
                  title: 'Debit',
                  dataIndex: ['journal', 'enteredDebit'],
                  key: 'dr',
                  width: 110,
                  align: 'right' as const,
                  render: (v: number, item: BulkPostItem) => (
                    <Text style={{ fontSize: 11 }}>
                      {v?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {item.journal.currencyCode}
                    </Text>
                  ),
                },
                {
                  title: 'Credit',
                  dataIndex: ['journal', 'enteredCredit'],
                  key: 'cr',
                  width: 110,
                  align: 'right' as const,
                  render: (v: number, item: BulkPostItem) => (
                    <Text style={{ fontSize: 11 }}>
                      {v?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {item.journal.currencyCode}
                    </Text>
                  ),
                },
                {
                  title: 'Status',
                  key: 'status',
                  width: 130,
                  render: (_: any, item: BulkPostItem) => statusLabel(item.status),
                },
                {
                  title: 'Issues',
                  key: 'errors',
                  width: 60,
                  align: 'center' as const,
                  render: (_: any, item: BulkPostItem) => {
                    const allErrors = [
                      ...item.validationErrors,
                      ...(item.serverError ? [item.serverError] : []),
                    ];
                    if (allErrors.length === 0) return null;
                    const tooltipContent = (
                      <ul style={{ margin: 0, paddingLeft: 16, maxWidth: 320 }}>
                        {allErrors.map((e, i) => (
                          <li key={i} style={{ fontSize: 12, marginBottom: 2 }}>{e}</li>
                        ))}
                      </ul>
                    );
                    return (
                      <Tooltip title={tooltipContent} color="#fff" overlayInnerStyle={{ color: '#333' }}>
                        <CloseCircleOutlined style={{ fontSize: 16, color: item.status === 'skipped' ? REDWOOD.neutral600 : REDWOOD.error, cursor: 'pointer' }} />
                      </Tooltip>
                    );
                  },
                },
              ]}
              summary={() => {
                const totalDr = bulkPostItems.reduce((s, i) => s + (i.journal.enteredDebit || 0), 0);
                const totalCr = bulkPostItems.reduce((s, i) => s + (i.journal.enteredCredit || 0), 0);
                return (
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0} colSpan={4}>
                      <Text strong style={{ fontSize: 11 }}>Total ({bulkPostItems.length} journals)</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>
                        {totalDr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>
                        {totalCr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} colSpan={2} />
                  </Table.Summary.Row>
                );
              }}
            />

            {/* ── Result message after run ── */}
            {bulkPostDone && (
              <Alert
                style={{ marginTop: 12 }}
                type={failed > 0 ? 'warning' : 'success'}
                showIcon
                message={
                  failed > 0
                    ? `Completed with issues: ${posted} posted, ${failed} failed, ${skipped} skipped.`
                    : `All ${posted} journal${posted !== 1 ? 's' : ''} posted successfully!`
                }
              />
            )}
          </Modal>
        );
      })()}

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        title={<Space><DeleteOutlined style={{ color: '#ff4d4f' }} /><span>Delete Journals</span></Space>}
        open={bulkDeleteModalVisible}
        onCancel={() => setBulkDeleteModalVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setBulkDeleteModalVisible(false)}>Cancel</Button>
            <Button danger type="primary" icon={<DeleteOutlined />} loading={bulkDeleteLoading} onClick={handleBulkDelete}>
              Delete All
            </Button>
          </Space>
        }
        width={520}
      >
        {(() => {
          const targets = journals.filter(j =>
            selectedRowKeys.includes(j.key) &&
            (j.source || '').trim().toUpperCase() === 'MANUAL' &&
            j.statusMeaning !== 'Posted'
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '10px 14px' }}>
                <Text strong style={{ color: '#cf1322' }}>
                  {targets.length} batch(es) will be permanently deleted including all journal headers and lines.
                </Text>
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {targets.map(j => (
                  <div key={j.key} style={{ fontSize: 12, padding: '3px 8px', background: '#fafafa', borderRadius: 4, border: '1px solid #f0f0f0' }}>
                    <Text strong>{j.batchName}</Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>{j.periodName} · {j.ledgerName}</Text>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Delete Batch Confirmation Modal */}
      <Modal
        title={<Space><DeleteOutlined style={{ color: '#ff4d4f' }} /><span>Delete Journal Batch</span></Space>}
        open={deleteBatchModalVisible}
        onCancel={() => { setDeleteBatchModalVisible(false); setDeleteBatchTarget(null); setDeleteBatchTestResult(null); }}
        footer={
          <Space>
            <Button onClick={() => { setDeleteBatchModalVisible(false); setDeleteBatchTarget(null); setDeleteBatchTestResult(null); }}>
              Cancel
            </Button>
            <Button
              danger
              type="primary"
              icon={<DeleteOutlined />}
              loading={deleteBatchLoading}
              onClick={handleDeleteBatch}
            >
              Delete Batch
            </Button>
          </Space>
        }
        width={600}
      >
        {deleteBatchTarget && (() => {
          const deleteUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${deleteBatchTarget.jeBatchId}`;

          const runTest = async () => {
            setDeleteBatchTestResult({ loading: true });
            try {
              // Try a DELETE with a dry-run by checking the endpoint exists via a dummy fetch
              // We send DELETE but catch the response to show what ORDS would return
              const res = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
              });
              const text = await res.text();
              let parsed: any;
              try { parsed = JSON.parse(text); } catch { parsed = null; }
              const preview = parsed
                ? JSON.stringify(parsed, null, 2)
                : text.substring(0, 400);
              setDeleteBatchTestResult({ loading: false, status: res.status, body: preview });
              // If test actually deleted — refresh and close
              if (res.ok && parsed?.status === 'SUCCESS') {
                message.success(`Batch "${deleteBatchTarget.batchName}" deleted via test (${parsed.headersDeleted} headers, ${parsed.linesDeleted} lines)`);
                setDeleteBatchModalVisible(false);
                setDeleteBatchTarget(null);
                setDeleteBatchTestResult(null);
                setSelectedRowKeys([]);
                setOpenJournalTabs(prev => prev.filter(t => t.journal.jeBatchId !== deleteBatchTarget.jeBatchId));
                setActiveTabKey('search');
                setTimeout(() => { const btn = document.querySelector<HTMLElement>('.mj-search-btn'); if (btn) btn.click(); }, 100);
              }
            } catch (e: any) {
              setDeleteBatchTestResult({ loading: false, error: e.message });
            }
          };

          return (
            <div>
              {/* Warning */}
              <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <Typography.Text type="danger" strong>⚠ This action is irreversible. </Typography.Text>
                <Typography.Text>All journal lines and headers belonging to this batch will be permanently deleted.</Typography.Text>
              </div>

              {/* Batch details */}
              <div style={{ background: '#f7f7f7', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 8px' }}>
                  <Typography.Text type="secondary">Batch Name</Typography.Text>
                  <Typography.Text strong>{deleteBatchTarget.batchName}</Typography.Text>
                  <Typography.Text type="secondary">JE Batch ID</Typography.Text>
                  <Typography.Text code>{deleteBatchTarget.jeBatchId}</Typography.Text>
                  <Typography.Text type="secondary">Batch Sync ID</Typography.Text>
                  <Typography.Text code>{deleteBatchTarget.batchId}</Typography.Text>
                  <Typography.Text type="secondary">Status</Typography.Text>
                  <Typography.Text>{deleteBatchTarget.statusMeaning}</Typography.Text>
                </div>
              </div>

              {/* API Endpoint */}
              <div style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  API Endpoint
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tag color="red" style={{ fontFamily: 'monospace', fontSize: 11 }}>DELETE</Tag>
                  <code style={{
                    flex: 1, fontSize: 11, background: '#f5f5f5', border: '1px solid #d9d9d9',
                    borderRadius: 4, padding: '4px 8px', wordBreak: 'break-all',
                  }}>
                    {deleteUrl}
                  </code>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(deleteUrl); message.success('URL copied'); }}
                  />
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                  Cascades: RR_GL_JE_LINES_ALL → RR_GL_JE_HEADERS → RR_GL_JOURNAL_BATCHES (by JE_BATCH_ID = {deleteBatchTarget.jeBatchId})
                </Typography.Text>
              </div>

              {/* Test button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: deleteBatchTestResult ? 10 : 0 }}>
                <Button
                  size="small"
                  icon={<ApiOutlined />}
                  loading={deleteBatchTestResult?.loading}
                  onClick={runTest}
                  style={{ borderRadius: 6 }}
                >
                  Test DELETE Endpoint
                </Button>
                {deleteBatchTestResult && !deleteBatchTestResult.loading && deleteBatchTestResult.status && (
                  <Tag color={deleteBatchTestResult.status === 200 ? 'green' : 'red'}>
                    HTTP {deleteBatchTestResult.status}
                  </Tag>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Sends the actual DELETE request — batch will be removed if successful.
                </Typography.Text>
              </div>

              {/* Test result */}
              {deleteBatchTestResult && !deleteBatchTestResult.loading && (
                <div style={{ marginTop: 8 }}>
                  {deleteBatchTestResult.error ? (
                    <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: 8, fontSize: 12 }}>
                      <Typography.Text type="danger">Error: {deleteBatchTestResult.error}</Typography.Text>
                    </div>
                  ) : (
                    <pre style={{
                      fontSize: 11, background: '#f6ffed', border: '1px solid #b7eb8f',
                      borderRadius: 6, padding: 8, maxHeight: 140, overflow: 'auto', margin: 0,
                    }}>
                      {deleteBatchTestResult.body}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Search API Test Modal */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>Search API — Test Endpoint</span>
          </Space>
        }
        open={debugModalVisible}
        onCancel={() => { setDebugModalVisible(false); setApiTestResult(null); }}
        footer={[
          <Button key="clear" onClick={() => { setDebugLogs([]); setApiTestResult(null); }}>
            Clear
          </Button>,
          <Button key="close" type="primary" onClick={() => { setDebugModalVisible(false); setApiTestResult(null); }}>
            Close
          </Button>,
        ]}
        width={960}
        style={{ top: 40 }}
      >
        {(() => {
          const testUrl = buildSearchUrl(0, 500);
          const params = new URLSearchParams(testUrl.split('?')[1] || '');
          const paramRows: { key: string; value: string }[] = [];
          params.forEach((v, k) => paramRows.push({ key: k, value: v }));

          const runTest = async () => {
            setApiTestResult({ loading: true });
            try {
              const res = await fetch(testUrl);
              const text = await res.text();
              let parsed: any;
              try { parsed = JSON.parse(text); } catch { parsed = null; }
              const preview = parsed
                ? JSON.stringify({ success: parsed.success, totalCount: parsed.totalCount, itemsReturned: (parsed.items || []).length, firstItem: (parsed.items || [])[0] || null, error: parsed.error }, null, 2)
                : text.substring(0, 800);
              setApiTestResult({ loading: false, status: res.status, body: preview });
            } catch (e: any) {
              setApiTestResult({ loading: false, error: e.message });
            }
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── Full URL ── */}
              <div style={{ background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Space>
                    <Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 600 }}>GET</Tag>
                    <Text strong style={{ fontSize: 13 }}>Search API Endpoint</Text>
                  </Space>
                  <Space>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => { navigator.clipboard.writeText(testUrl); message.success('URL copied'); }}
                    >
                      Copy URL
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<SearchOutlined />}
                      loading={apiTestResult?.loading}
                      onClick={runTest}
                    >
                      Test
                    </Button>
                  </Space>
                </div>
                <div style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                  background: '#fff',
                  border: '1px solid #d6e4ff',
                  borderRadius: 4,
                  padding: '8px 10px',
                  userSelect: 'all',
                }}>
                  {testUrl}
                </div>
              </div>

              {/* ── Parameters table ── */}
              <div>
                <Text strong style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>
                  Query Parameters ({paramRows.length})
                </Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ textAlign: 'left', padding: '5px 10px', border: '1px solid #f0f0f0', width: '35%' }}>Parameter</th>
                      <th style={{ textAlign: 'left', padding: '5px 10px', border: '1px solid #f0f0f0' }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paramRows.map(({ key, value }) => (
                      <tr key={key}>
                        <td style={{ padding: '5px 10px', border: '1px solid #f0f0f0', fontFamily: 'monospace', color: '#0572CE' }}>{key}</td>
                        <td style={{ padding: '5px 10px', border: '1px solid #f0f0f0', fontFamily: 'monospace' }}>{decodeURIComponent(value)}</td>
                      </tr>
                    ))}
                    {paramRows.length === 0 && (
                      <tr>
                        <td colSpan={2} style={{ padding: '8px 10px', color: '#aaa', fontStyle: 'italic' }}>
                          Fill in the search form fields above, then re-open this dialog to see the parameters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ── Test result ── */}
              {apiTestResult && !apiTestResult.loading && (
                <div style={{
                  background: apiTestResult.error || (apiTestResult.status && apiTestResult.status >= 400) ? '#fff2f0' : '#f6ffed',
                  border: `1px solid ${apiTestResult.error || (apiTestResult.status && apiTestResult.status >= 400) ? '#ffccc7' : '#b7eb8f'}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Space>
                      <Text strong style={{ fontSize: 13 }}>Test Result</Text>
                      {apiTestResult.status && (
                        <Tag color={apiTestResult.status < 300 ? 'success' : 'error'}>
                          HTTP {apiTestResult.status}
                        </Tag>
                      )}
                    </Space>
                    {apiTestResult.error && <Tag color="error">Error</Tag>}
                  </div>
                  <pre style={{ margin: 0, padding: 8, background: '#fff', borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 300 }}>
                    {apiTestResult.error || apiTestResult.body}
                  </pre>
                </div>
              )}
              {apiTestResult?.loading && (
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <Spin /> <Text type="secondary" style={{ marginLeft: 8 }}>Calling API…</Text>
                </div>
              )}

              {/* ── Debug logs (collapsed, for advanced use) ── */}
              {debugLogs.length > 0 && (
                <Collapse ghost size="small">
                  <Panel header={<Text type="secondary" style={{ fontSize: 12 }}>Raw Debug Logs ({debugLogs.length} entries)</Text>} key="logs">
                    <div style={{ maxHeight: 300, overflow: 'auto' }}>
                      {debugLogs.map((log, index) => (
                        <div
                          key={index}
                          style={{
                            padding: '6px 10px',
                            marginBottom: 6,
                            borderRadius: 4,
                            background: log.type === 'error' ? '#fff2f0' : log.type === 'request' ? '#e6f7ff' : log.type === 'response' ? '#f6ffed' : '#fafafa',
                            border: `1px solid ${log.type === 'error' ? '#ffccc7' : log.type === 'request' ? '#91d5ff' : log.type === 'response' ? '#b7eb8f' : '#d9d9d9'}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Tag color={log.type === 'error' ? 'error' : log.type === 'request' ? 'processing' : log.type === 'response' ? 'success' : 'default'} style={{ fontSize: 10 }}>
                              {log.type.toUpperCase()}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 10 }}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                          </div>
                          <Text strong style={{ display: 'block', marginBottom: 2, fontSize: 12 }}>{log.message}</Text>
                          {log.data && (
                            <pre style={{ margin: 0, padding: 6, background: '#f5f5f5', borderRadius: 4, fontSize: 10, overflow: 'auto', maxHeight: 150 }}>
                              {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </Panel>
                </Collapse>
              )}

            </div>
          );
        })()}
      </Modal>

      {/* ── GL Journal Entry View Modal ──────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <AccountBookOutlined style={{ color: REDWOOD.primary }} />
            <span style={{ fontWeight: 600 }}>
              GL Journal Entry — {selectedJournalForView?.journalName}
            </span>
            {selectedJournalForView && getBatchStatusTag(selectedJournalForView.statusMeaning)}
          </Space>
        }
        open={journalViewModalVisible}
        onCancel={() => setJournalViewModalVisible(false)}
        footer={
          <Button onClick={() => setJournalViewModalVisible(false)}>Close</Button>
        }
        width={1300}
        style={{ top: 16 }}
        styles={{ body: { padding: 0, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
        destroyOnClose
      >
        {selectedJournalForView && renderJournalEditPanel(
          selectedJournalForView,
          `modal-${selectedJournalForView.jeHeaderId}`
        )}
      </Modal>

      {/* ── AP Transaction Drill-Down Modal ──────────────────────────────── */}
      <Modal
        title={
          <Space>
            <FileTextOutlined style={{ color: REDWOOD.info }} />
            <span style={{ fontWeight: 600 }}>
              {apTransactionType === 'payment' ? 'AP Payment' : 'AP Invoice'} — Transaction Detail
            </span>
          </Space>
        }
        open={apTransactionModalVisible}
        onCancel={() => { setApTransactionModalVisible(false); setApTransactionData(null); setApTransactionError(null); setApTransactionLines([]); }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {apTransactionLastUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                <ApiOutlined style={{ color: REDWOOD.info, flexShrink: 0 }} />
                <Tag color="blue" style={{ flexShrink: 0 }}>GET</Tag>
                <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>
                  {apTransactionLastUrl}
                </code>
                <Button
                  size="small"
                  icon={apTransactionCopied ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(apTransactionLastUrl);
                    setApTransactionCopied(true);
                    setTimeout(() => setApTransactionCopied(false), 2000);
                  }}
                />
              </div>
            ) : <span />}
            <Button onClick={() => { setApTransactionModalVisible(false); setApTransactionData(null); setApTransactionError(null); setApTransactionLines([]); }}>Close</Button>
          </div>
        }
        width={900}
        destroyOnClose
      >
        {apTransactionLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: REDWOOD.neutral600 }}>
              Loading {apTransactionType === 'payment' ? 'payment' : 'invoice'} details…
            </div>
          </div>
        ) : apTransactionError ? (
          <div style={{ padding: '32px 16px' }}>
            <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '16px 20px', marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <CloseCircleOutlined style={{ color: REDWOOD.error, fontSize: 16 }} />
                  <Text strong style={{ color: REDWOOD.error }}>Transaction Not Found</Text>
                </Space>
                <Text style={{ fontSize: 12 }}>{apTransactionError}</Text>
              </Space>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Check the browser console (F12) for detailed debug info including the exact API URL called.
              The reference used to look up this transaction is shown in the API URL in the footer below.
            </Text>
          </div>
        ) : apTransactionData ? (
          apTransactionType === 'payment' ? (
            /* ── Payment detail ── */
            <div>
              <Card
                size="small"
                style={{ marginBottom: 12, borderRadius: 6, borderColor: REDWOOD.neutral200 }}
                headStyle={{ background: REDWOOD.neutral100, fontSize: 13, fontWeight: 600 }}
                title="Payment Information"
              >
                <Descriptions size="small" column={2} bordered labelStyle={{ fontWeight: 500, width: 160 }}>
                  <Descriptions.Item label="Payment Number">{apTransactionData.paymentNumber || apTransactionData.payment_number || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Payment Date">{apTransactionData.paymentDate || apTransactionData.payment_date || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Payee">{apTransactionData.payee || apTransactionData.payee_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <Tag color={REDWOOD.success}>{apTransactionData.paymentStatus || apTransactionData.payment_status || '-'}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Payment Amount">{apTransactionData.paymentAmount || apTransactionData.payment_amount || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Currency">{apTransactionData.paymentCurrency || apTransactionData.payment_currency || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Business Unit" span={2}>{apTransactionData.businessUnit || apTransactionData.business_unit || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Payment Method">{apTransactionData.paymentMethod || apTransactionData.payment_method || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Payment Document">{apTransactionData.paymentDocument || apTransactionData.payment_document || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Remit To Address" span={2}>{apTransactionData.remitToAddress || apTransactionData.remit_to_address || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Bank Account">{apTransactionData.remitToAccountNumber || apTransactionData.remit_to_account_number || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Legal Entity">{apTransactionData.legalEntity || apTransactionData.legal_entity || '-'}</Descriptions.Item>
                </Descriptions>
              </Card>
            </div>
          ) : (
            /* ── Invoice detail ── */
            <div>
              <Card
                size="small"
                style={{ marginBottom: 12, borderRadius: 6, borderColor: REDWOOD.neutral200 }}
                headStyle={{ background: REDWOOD.neutral100, fontSize: 13, fontWeight: 600 }}
                title="Invoice Information"
              >
                <Descriptions size="small" column={2} bordered labelStyle={{ fontWeight: 500, width: 160 }}>
                  <Descriptions.Item label="Invoice Number">{apTransactionData.invoice_number || apTransactionData.invoiceNumber || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Invoice Date">{apTransactionData.invoice_date || apTransactionData.invoiceDate || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Supplier">{apTransactionData.supplier || apTransactionData.party || apTransactionData.supplierOrParty || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Supplier Site">{apTransactionData.supplier_site || apTransactionData.supplierSite || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Invoice Amount">{apTransactionData.invoice_amount || apTransactionData.invoiceAmount || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Currency">{apTransactionData.invoice_currency || apTransactionData.invoiceCurrency || apTransactionData.currency_code || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <Tag color={REDWOOD.info}>{apTransactionData.validation_status || apTransactionData.validationStatus || '-'}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Approval Status">
                    <Tag color={REDWOOD.success}>{apTransactionData.approval_status || apTransactionData.approvalStatus || 'N/A'}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Business Unit" span={2}>{apTransactionData.business_unit || apTransactionData.businessUnit || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Unpaid Amount">{apTransactionData.unpaid_amount != null ? apTransactionData.unpaid_amount : (apTransactionData.unpaidAmount ?? '-')}</Descriptions.Item>
                  <Descriptions.Item label="Invoice Type">{apTransactionData.invoice_type || apTransactionData.invoiceType || '-'}</Descriptions.Item>
                </Descriptions>
              </Card>

              {/* Invoice Lines */}
              <Card
                size="small"
                style={{ borderRadius: 6, borderColor: REDWOOD.neutral200 }}
                headStyle={{ background: REDWOOD.neutral100, fontSize: 13, fontWeight: 600 }}
                title={`Invoice Lines${apTransactionLines.length > 0 ? ` (${apTransactionLines.length})` : ''}`}
              >
                {apTransactionLinesLoading ? (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <Spin size="small" />
                    <span style={{ marginLeft: 8, color: REDWOOD.neutral600, fontSize: 12 }}>Loading lines…</span>
                  </div>
                ) : (
                  <Table
                    size="small"
                    bordered
                    pagination={false}
                    scroll={{ x: 800 }}
                    locale={{ emptyText: 'No invoice lines found' }}
                    dataSource={apTransactionLines.map((l, i) => ({ ...l, key: l.line_id ?? i }))}
                    columns={[
                      { title: 'Line', dataIndex: 'line_number', key: 'line_number', width: 55 },
                      { title: 'Type', dataIndex: 'line_type', key: 'line_type', width: 80 },
                      { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
                      {
                        title: 'Account',
                        dataIndex: 'distribution_combination',
                        key: 'dist',
                        width: 220,
                        render: (v: string) => (
                          <div>
                            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || '-'}</span>
                            {v && apLineDescMap[v] && (
                              <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2 }}>{apLineDescMap[v]}</div>
                            )}
                          </div>
                        ),
                      },
                      { title: 'Amount', dataIndex: 'line_amount', key: 'line_amount', width: 110, align: 'right' as const, render: (v: number) => v != null ? <Text strong style={{ color: v >= 0 ? REDWOOD.info : REDWOOD.error }}>{Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text> : '-' },
                      { title: 'Tax', dataIndex: 'tax_classification_code', key: 'tax', width: 100, render: (v: string) => v || '-' },
                    ]}
                  />
                )}
              </Card>
            </div>
          )
        ) : null}
      </Modal>

      {/* Journal APIs Modal — per-journal debug popup */}
      {(() => {
        const tab = openJournalTabs.find(t => t.key === journalApiTabKey);
        if (!tab) return null;
        const j = tab.journal;
        const JOURNAL_APIS = [
          {
            name: 'Search Journals (loaded this record)',
            method: 'GET',
            url: tab.sourceUrl || `${APEX_DB_CONFIG.baseUrl}/gl/journals/headers?ledger_name=${encodeURIComponent(j.ledgerName || '')}`,
            description: `Returned this journal. conversionRate in response: ${j.conversionRate ?? '⚠ undefined — run 32_fix_search_journals_add_conv_rate.sql'}`,
          },
          {
            name: 'Get Journal Lines',
            method: 'GET',
            url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/${j.jeHeaderId}/lines`,
            description: `Lines for jeHeaderId=${j.jeHeaderId}. Should include conversionRate per line.`,
          },
          {
            name: 'Update Journal (Save)',
            method: 'PUT',
            url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/${j.jeHeaderId}`,
            description: `PUT body: { jeBatchId, batchDescription, journalDescription, conversionRate, lines:[...] }`,
          },
          {
            name: 'Post Journal Batch',
            method: 'PUT',
            url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/${j.jeBatchId}/post`,
            description: `Posts batch jeBatchId=${j.jeBatchId}`,
          },
          {
            name: 'Delete Journal Batch',
            method: 'DELETE',
            url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${j.batchId || j.jeBatchId}`,
            description: `Cascades: lines → headers → batch. Blocked if status=Posted.`,
          },
        ];
        return (
          <Modal
            title={
              <Space>
                <ApiOutlined style={{ color: REDWOOD.info }} />
                <span>Journal APIs</span>
                <Tag style={{ fontSize: 10 }}>{j.batchName}</Tag>
                <Tag color={j.statusMeaning === 'Posted' ? 'green' : 'orange'} style={{ fontSize: 10 }}>{j.statusMeaning}</Tag>
              </Space>
            }
            open={journalApiModalVisible}
            onCancel={() => { setJournalApiModalVisible(false); setJournalApiExecResults({}); }}
            footer={<Button onClick={() => { setJournalApiModalVisible(false); setJournalApiExecResults({}); }}>Close</Button>}
            width={780}
            destroyOnClose
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {JOURNAL_APIS.map((api, index) => (
                <div key={index} style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Tag
                      color={api.method === 'GET' ? 'blue' : api.method === 'PUT' ? 'orange' : 'red'}
                      style={{ fontSize: 10, margin: 0 }}
                    >
                      {api.method}
                    </Tag>
                    <Text strong style={{ fontSize: 12 }}>{api.name}</Text>
                  </div>
                  <div style={{ background: '#1e1e1e', borderRadius: 4, padding: '6px 10px', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ fontSize: 10, color: '#9cdcfe', wordBreak: 'break-all', flex: 1 }}>{api.url}</code>
                    <CopyOutlined
                      style={{ color: '#6b6b6b', fontSize: 11, marginLeft: 8, cursor: 'pointer', flexShrink: 0 }}
                      onClick={() => navigator.clipboard.writeText(api.url)}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>{api.description}</Text>
                    {api.method === 'GET' && (
                      <Button
                        size="small"
                        style={{ fontSize: 11, marginLeft: 12, flexShrink: 0 }}
                        loading={journalApiExecResults[index]?.loading}
                        onClick={() => executeJournalApi(index, api.url)}
                      >
                        Test
                      </Button>
                    )}
                  </div>
                  {journalApiExecResults[index]?.response && (
                    <div style={{ marginTop: 8, background: '#1e1e1e', borderRadius: 4, padding: '8px 10px', maxHeight: 260, overflow: 'auto' }}>
                      <pre style={{
                        margin: 0, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        color: journalApiExecResults[index].response!.startsWith('HTTP 2') ? '#4ec9b0' : '#f48771'
                      }}>
                        {journalApiExecResults[index].response}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Modal>
        );
      })()}

      {/* Page APIs Modal */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Page APIs - Manage Journals</span></Space>}
        open={pageApiModalVisible}
        onCancel={() => { setPageApiModalVisible(false); setPageApiExecResults({}); }}
        footer={<Button onClick={() => { setPageApiModalVisible(false); setPageApiExecResults({}); }}>Close</Button>}
        width={700}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PAGE_APIS.map((api, index) => (
            <div key={index} style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Tag color={api.method === 'GET' ? 'blue' : api.method === 'PUT' ? 'orange' : 'green'} style={{ fontSize: 10, margin: 0 }}>{api.method}</Tag>
                <Text strong style={{ fontSize: 12 }}>{api.name}</Text>
              </div>
              <div style={{ background: '#1e1e1e', borderRadius: 4, padding: '6px 10px', marginBottom: 6 }}>
                <code style={{ fontSize: 10, color: '#9cdcfe', wordBreak: 'break-all' }}>{api.url}</code>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{api.description}</Text>
                {api.method === 'GET' && (
                  <Button
                    size="small"
                    style={{ fontSize: 11, marginLeft: 8, flexShrink: 0 }}
                    loading={pageApiExecResults[index]?.loading}
                    onClick={() => executePageApi(index, api.url)}
                  >
                    Execute
                  </Button>
                )}
              </div>
              {pageApiExecResults[index]?.response && (
                <div style={{ marginTop: 8, background: '#1e1e1e', borderRadius: 4, padding: '8px 10px', maxHeight: 200, overflow: 'auto' }}>
                  <pre style={{ margin: 0, fontSize: 10, color: pageApiExecResults[index].response!.startsWith('HTTP 2') ? '#4ec9b0' : '#f48771', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {pageApiExecResults[index].response}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>

      {/* ── PDF Preview Modal ─────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <FilePdfOutlined style={{ color: REDWOOD.primary }} />
            <span>Journal Report Preview</span>
            <Text type="secondary" style={{ fontSize: 12 }}>{pdfFileName}</Text>
          </Space>
        }
        open={pdfPreviewVisible}
        onCancel={() => { setPdfPreviewVisible(false); if (pdfDataUrl) URL.revokeObjectURL(pdfDataUrl); setPdfDataUrl(null); }}
        width="90vw"
        style={{ top: 20 }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Preview generated on {dayjs().format('DD-MMM-YYYY HH:mm:ss')}
            </Text>
            <Space>
              <Button onClick={() => { setPdfPreviewVisible(false); if (pdfDataUrl) URL.revokeObjectURL(pdfDataUrl); setPdfDataUrl(null); }}>
                Close
              </Button>
              <Button
                type="primary"
                icon={<FilePdfOutlined />}
                onClick={() => {
                  if (pdfDataUrl) {
                    const a = document.createElement('a');
                    a.href = pdfDataUrl;
                    a.download = pdfFileName;
                    a.click();
                  }
                }}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              >
                Download PDF
              </Button>
            </Space>
          </div>
        }
        styles={{ body: { padding: 0, height: 'calc(100vh - 200px)', overflow: 'hidden' } }}
      >
        {pdfDataUrl && (
          <iframe src={pdfDataUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF Preview" />
        )}
      </Modal>

      {/* API Payload Inspector Modal */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>API Request Inspector - Update Account Combination</span>
          </Space>
        }
        open={apiPayloadVisible}
        onCancel={() => {
          setApiPayloadVisible(false);
          setApiTestResponse(null);
        }}
        width={900}
        footer={
          <Space>
            <Button onClick={() => {
              setApiPayloadVisible(false);
              setApiTestResponse(null);
            }}>Close</Button>
            <Button
              type="primary"
              loading={apiTestLoading}
              onClick={async () => {
                if (!apiPayload) return;
                setApiTestLoading(true);
                try {
                  const payload = JSON.parse(apiPayload.body);
                  const response = await fetch(apiPayload.url, {
                    method: apiPayload.method,
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: apiPayload.body,
                  });
                  const result = await response.json();
                  setApiTestResponse({
                    status: response.status,
                    body: JSON.stringify(result, null, 2),
                  });
                  console.log('[API Test] Response:', { status: response.status, result });
                } catch (error) {
                  console.error('[API Test] Error:', error);
                  setApiTestResponse({
                    status: 500,
                    body: JSON.stringify({
                      status: 'ERROR',
                      message: error instanceof Error ? error.message : 'Request failed',
                    }, null, 2),
                  });
                } finally {
                  setApiTestLoading(false);
                }
              }}
              icon={<CloudOutlined />}
            >
              Test Request
            </Button>
          </Space>
        }
        destroyOnClose
      >
        {apiPayload && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* URL */}
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Endpoint URL:</Text>
              <div style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: 12, maxHeight: 100, overflow: 'auto' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color="red">{apiPayload.method}</Tag>
                    <Text code style={{ fontSize: 11, flex: 1, wordBreak: 'break-all' }}>
                      {apiPayload.url}
                    </Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(apiPayload.url);
                        message.success('URL copied');
                      }}
                    />
                  </div>
                </Space>
              </div>
            </div>

            {/* Request Body */}
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Request Body (JSON):</Text>
              <div style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: 12, maxHeight: 200, overflow: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {apiPayload.body}
                </pre>
              </div>
              <Button
                size="small"
                style={{ marginTop: 8 }}
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(apiPayload.body);
                  message.success('Payload copied');
                }}
              >
                Copy Payload
              </Button>
            </div>

            {/* Test Response */}
            {apiTestResponse && (
              <div>
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  Test Response {apiTestResponse.status >= 200 && apiTestResponse.status < 300 ? (
                    <Tag color="green">{apiTestResponse.status}</Tag>
                  ) : (
                    <Tag color="red">{apiTestResponse.status}</Tag>
                  )}
                </Text>
                <div style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, padding: 12, maxHeight: 200, overflow: 'auto' }}>
                  <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {apiTestResponse.body}
                  </pre>
                </div>
                <Button
                  size="small"
                  style={{ marginTop: 8 }}
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(apiTestResponse.body);
                    message.success('Response copied');
                  }}
                >
                  Copy Response
                </Button>
              </div>
            )}

            {/* Debug Info */}
            <Alert
              message="Debug Information"
              description="Check the browser console (F12) for detailed debug logs including lineId values and full response from the server."
              type="info"
              showIcon
            />
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default ManageJournals;
