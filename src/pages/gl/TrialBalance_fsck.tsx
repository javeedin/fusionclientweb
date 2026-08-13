import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dayjs from 'dayjs';
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Breadcrumb,
  Tag,
  Row,
  Col,
  Spin,
  Alert,
  Tabs,
  Select,
  Tooltip,
  Statistic,
  Empty,
  Modal,
  Input,
  AutoComplete,
  message,
  Switch,
  Descriptions,
  Dropdown,
  Drawer,
  Collapse,
  Steps,
  DatePicker,
  Progress,
} from 'antd';
import {
  HomeOutlined,
  TableOutlined,
  ReloadOutlined,
  PlusOutlined,
  CloseOutlined,
  FilterOutlined,
  FileTextOutlined,
  DollarOutlined,
  BankOutlined,
  CalendarOutlined,
  DragOutlined,
  ExpandAltOutlined,
  ApiOutlined,
  CopyOutlined,
  FileExcelOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  BarsOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
  PrinterOutlined,
  SaveOutlined,
  LineChartOutlined,
  DownOutlined,
  CalculatorOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  ReconciliationOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { Divider, Popover } from 'antd';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { exportRrTBToExcel, exportFusionTBToExcel, exportBothTBToExcel } from '../../utils/tbExcelExport';
import AccountSelector from '../../components/AccountSelector';
import { searchCombinations, createCombination, type DistCombination } from '../../services/distCombinations.service';
// antd 6 SummaryCellProps omits style — use this cast helper where needed
const SummaryCell = Table.Summary.Cell as React.ComponentType<React.ComponentProps<typeof Table.Summary.Cell> & { style?: React.CSSProperties }>;
import { createAccounting, checkAccountingExists, type SlaCreatePayload } from '../../services/sla.service';
import { postSlaToGL } from '../../services/glPosting.service';

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
/** Extract clean Mon-YY period from a tab periodName that may include prefix/suffix (e.g. "YTD: Apr-26 · SB" → "Apr-26") */
const cleanPeriodName = (raw: string): string => {
  const m = raw.match(/[A-Z][a-z]{2}-\d{2}/);
  return m ? m[0] : raw.replace(/^(?:ReERP|Dynamic|YTD):\s*/, '').trim();
};

const REDWOOD = {
  primary: '#C74634',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  error: '#C74634',
  info: '#0572CE',
  neutral: '#383838',
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F7F7',
  border: '#E5E5E5',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B6B',
};

// Types
interface GLBalanceRecord {
  period_type: string | null;
  period_name: string;
  actual_flag: string;
  period_year: string;
  period_num: string;
  ledger_id: string;
  company: string;
  lob: string;
  department: string;
  account: string;
  account_desc: string;
  sub_account: string;
  analysis: string;
  intercompany: string;
  future1: string | null;
  future2: string | null;
  account_type: string;
  currency: string;
  opening_balance: number;
  period_activity: number | null;
  closing_balance: number;
  debit: number;
  credit: number;
  currency_code: string | null;
}

interface PeriodInfo {
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

interface SegmentConfig {
  key: string;
  label: string;
}

// Available segments for pivot
const AVAILABLE_SEGMENTS: SegmentConfig[] = [
  { key: 'company', label: 'Company' },
  { key: 'lob', label: 'LOB' },
  { key: 'department', label: 'Department' },
  { key: 'sub_account', label: 'Sub Account' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'intercompany', label: 'Intercompany' },
];

interface RrTBRecord {
  account_combination: string;
  company: string;
  lob: string;
  department: string;
  account: string;
  account_desc: string;
  sub_account: string;
  analysis: string;
  intercompany: string;
  account_type: string;   // A / L / O / R / E
  currency_code: string;
  // PTD columns (from /standard endpoint) — Accounted (functional) currency
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  ytd_net: number;
  // PTD Entered (transaction) currency
  entered_opening: number;
  entered_debit: number;
  entered_credit: number;
  entered_closing: number;
  // YTD columns — Accounted (functional) currency
  ytd_opening: number;
  ytd_debit: number;
  ytd_credit: number;
  // YTD Entered currency
  ytd_entered_opening: number;
  ytd_entered_debit: number;
  ytd_entered_credit: number;
}

interface TabData {
  key: string;
  periodName: string;
  ledgerName: string;
  tabType: 'fusion' | 'reerp' | 'reerp-dynamic' | 'reerp-ytd';
  data: GLBalanceRecord[];
  rrData: RrTBRecord[];
  rrGenerating: boolean;
  loading: boolean;
  error: string | null;
  companies: string[];
  currencies: string[];
  selectedCompany: string | null;
  selectedCurrency: string | null;
  segmentsBefore: string[];
  segmentsAfter: string[];
  gridSearch: string;
  showEntered: boolean;
}

interface ApiCallInfo {
  label: string;
  url: string;
  method: string;
  status: number | null;
  ok: boolean | null;
  durationMs: number | null;
  running: boolean;
  body: string;
}

interface PivotRow {
  key: string;
  account: string;
  account_desc: string;
  opening_balance: number;
  debit: number;
  credit: number;
  closing_balance: number;
  segmentCount: number;
  rawRows: GLBalanceRecord[];
  [key: string]: string | number | GLBalanceRecord[];
}

// Lines Summary types
interface LineSummaryRow {
  seg1_company: string | null;
  seg4_account: string | null;
  ledger_name:  string | null;
  period_name:  string | null;
  currency:     string | null;
  total_dr:     number;
  total_cr:     number;
  net_amount:   number;
  line_count:   number;
}

// ReERP vs Fusion reconciliation row
interface ReconRecord {
  account:      string;
  account_desc: string;
  fusionOpening: number; fusionDebit: number; fusionCredit: number; fusionClosing: number;
  rrOpening:    number; rrDebit:    number; rrCredit:    number; rrClosing:    number;
  diffOpening:  number; diffDebit:  number; diffCredit:  number; diffClosing:  number;
  matched:  boolean;
  inFusion: boolean;
  inRr:     boolean;
}

const TrialBalance: React.FC = () => {
  const { user } = useAuth();
  // Periods list state
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Tabs state
  const [activeTab, setActiveTab] = useState('periods');
  const [tabs, setTabs] = useState<TabData[]>([]);

  // Detail modal state
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailModalData, setDetailModalData] = useState<{ account: string; account_desc: string; rows: GLBalanceRecord[] } | null>(null);

  // Ledger state
  const [ledgerOptions, setLedgerOptions] = useState<string[]>([]);
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [selectedLedger, setSelectedLedger] = useState<string>('BUIMERC LEDGER');

  // API panel state

  // Row selection per tab (for revaluation)
  const [tabSelections, setTabSelections] = useState<Record<string, string[]>>({});

  // Revaluation modal state
  const [revalVisible,         setRevalVisible]         = useState(false);
  const [revalTabKey,          setRevalTabKey]          = useState('');
  const [revalAccount,         setRevalAccount]         = useState('');
  const [revalRates,           setRevalRates]           = useState<Record<string, string>>({});
  const [revalFuncRates,       setRevalFuncRates]       = useState<Record<string, string>>({});
  const [revalGainCombo,       setRevalGainCombo]       = useState('');
  const [revalLossCombo,       setRevalLossCombo]       = useState('');
  const [revalComboPickerOpen, setRevalComboPickerOpen] = useState(false);
  const [revalComboPickerFor,  setRevalComboPickerFor]  = useState<'gain'|'loss'>('gain');
  const [revalComboSearch,     setRevalComboSearch]     = useState('');
  const [revalGainLossAcctOpen, setRevalGainLossAcctOpen] = useState(false);
  const [revalGainLossAcctFor,  setRevalGainLossAcctFor]  = useState<'gain'|'loss'>('gain');
  // Distribution combinations LOV
  const [distComboList,      setDistComboList]      = useState<DistCombination[]>([]);
  const [distComboLoading,   setDistComboLoading]   = useState(false);
  const [distComboNewOpen,   setDistComboNewOpen]   = useState(false);
  const [distComboNewName,   setDistComboNewName]   = useState('');
  const [distComboNewDesc,   setDistComboNewDesc]   = useState('');
  const [distComboNewSaving, setDistComboNewSaving] = useState(false);
  const [distComboAcctOpen,  setDistComboAcctOpen]  = useState(false);
  // Retained Earnings calculator
  const [reCalcVisible, setReCalcVisible] = useState(false);
  const [reCalcTab,     setReCalcTab]     = useState<TabData | null>(null);
  // Multi-year RE rollforward
  const [reYearFrom,      setReYearFrom]      = useState<number | null>(null);
  const [reYearTo,        setReYearTo]        = useState<number | null>(null);
  const [reYearCompany,   setReYearCompany]   = useState<string | null>(null);
  const [reYearRows,      setReYearRows]      = useState<{
    year: number; lastPeriod: string;
    revenue: number; expenses: number; netPL: number;
    reBalance: number; openingRE: number; closingRE: number;
  }[]>([]);
  const [reYearLoading,   setReYearLoading]   = useState(false);
  const [reYearProgress,  setReYearProgress]  = useState('');
  const [reYearError,     setReYearError]     = useState<string | null>(null);
  const [reYearSelected,  setReYearSelected]  = useState<number[]>([]);   // years checked to save
  const [reSaving,        setReSaving]        = useState(false);
  const [reApiDebug,      setReApiDebug]      = useState<{ url: string; body: string; response: string; status: number | null } | null>(null);
  const [reFetchingTabKey, setReFetchingTabKey] = useState<string | null>(null);
  const [reLastUrl, setReLastUrl] = useState<Record<string, string>>({});
  const [revalPreviewRows,     setRevalPreviewRows]     = useState<
    { lineNum: number; combo: string; subAccount: string; desc: string; comment: string; dr: number; cr: number }[]
  >([]);
  const [revalAcctSelectorOpen,    setRevalAcctSelectorOpen]    = useState(false);
  const [revalAcctSelectorLineNum, setRevalAcctSelectorLineNum] = useState<number | null>(null);
  const [revalId,                  setRevalId]                  = useState<number | null>(null);
  const [revalChecking,            setRevalChecking]            = useState(false);
  const [revalStatus,              setRevalStatus]              = useState<string | null>(null);
  const [revalExcludedCombos,      setRevalExcludedCombos]      = useState<Set<string>>(new Set());
  const [revalApiError,            setRevalApiError]            = useState<string | null>(null);
  const [revalLastCall,            setRevalLastCall]            = useState<{ url: string; method: string; payload: object; responseText: string; httpStatus: number } | null>(null);
  const [revalApiDebugOpen,        setRevalApiDebugOpen]        = useState(false);
  const [revalSaving,              setRevalSaving]              = useState(false);
  const [revalRateDate,            setRevalRateDate]            = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [revalBmsFetching,         setRevalBmsFetching]         = useState<Record<string, boolean>>({});
  const [subAcctDescMap,           setSubAcctDescMap]           = useState<Record<string, string>>({});
  const [subAcctFetching,          setSubAcctFetching]          = useState<Record<number, boolean>>({});
  const subAcctDescLoaded = useRef(false);
  const subAcctVsCode = useRef<string | null>(null);
  // Create Accounting flow
  const [acctFlowVisible,  setAcctFlowVisible]  = useState(false);
  const [acctFlowLoading,  setAcctFlowLoading]  = useState(false);
  const [acctFlowDone,     setAcctFlowDone]     = useState(false);
  const [acctFlowError,    setAcctFlowError]    = useState<string | null>(null);
  const [acctFlowLastCall, setAcctFlowLastCall] = useState<{ url: string; method: string; body: object } | null>(null);
  // Bank Recon Status for reval modal
  const [reconStatusOpen,    setReconStatusOpen]    = useState(false);
  const [reconStatusLoading, setReconStatusLoading] = useState(false);
  const [reconStatusData,    setReconStatusData]    = useState<Record<string, any>>({});
  const [reconDrillCombo,    setReconDrillCombo]    = useState<string | null>(null);
  const [postFlowLastCall, setPostFlowLastCall] = useState<{ url: string; method: string; body: object } | null>(null);
  const [acctFlowSteps,    setAcctFlowSteps]    = useState<
    { title: string; status: 'wait'|'process'|'finish'|'error'; desc?: string }[]
  >([]);
  const [apiPanelVisible, setApiPanelVisible] = useState(false);
  const [apiCalls, setApiCalls] = useState<Record<string, ApiCallInfo>>({
    ledgers:      { label: 'GET Ledgers',            url: '', method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '' },
    periods:      { label: 'GET Periods',             url: '', method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '' },
    trialBalance: { label: 'GET Trial Balance',       url: '', method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '' },
    rrGenerate:   { label: 'POST RR TB Generate',     url: '', method: 'POST', status: null, ok: null, durationMs: null, running: false, body: '' },
    rrFetch:      { label: 'GET RR Trial Balance',    url: '', method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '' },
    linesSummary: { label: 'GET Lines Summary',       url: '', method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '' },
    rrDynamic:    { label: 'GET RR Dynamic TB',        url: '', method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '' },
  });

  // Lines Summary state
  const [lsVisible,  setLsVisible]  = useState(false);
  const [lsLoading,  setLsLoading]  = useState(false);
  const [lsData,     setLsData]     = useState<LineSummaryRow[]>([]);
  const [lsPeriod,   setLsPeriod]   = useState<string | null>(null);
  const [lsCompany,  setLsCompany]  = useState<string | null>(null);
  const [lsLedger,   setLsLedger]   = useState<string | null>(null);
  const [lsCurrency, setLsCurrency] = useState<string | null>(null);
  const [lsSearch,   setLsSearch]   = useState('');
  const [lsApiUrl,   setLsApiUrl]   = useState('');
  const [lsError,    setLsError]    = useState<string | null>(null);
  const [lsReconMap,  setLsReconMap]  = useState<Map<string, { tbDr: number; tbCr: number; matched: boolean }>>(new Map());
  const [lsReconDone, setLsReconDone] = useState(false);
  const [lsDetailRow, setLsDetailRow] = useState<{
    account: string; company: string; ledger: string | null;
    accountDesc: string; combinations: string[];
    lsDr: number; lsCr: number; lsNet: number; lsLines: number;
    tbRecords: GLBalanceRecord[];
  } | null>(null);
  const [lsDetailCcy, setLsDetailCcy] = useState<string | null>(null);

  // ── TB Drill-down: Combinations modal ────────────────────
  const [drillComboVisible, setDrillComboVisible] = useState(false);
  const [drillComboRows,    setDrillComboRows]    = useState<RrTBRecord[]>([]);
  const [drillComboAccount, setDrillComboAccount] = useState('');
  const [drillComboSearch,  setDrillComboSearch]  = useState('');
  const [drillComboLedger,  setDrillComboLedger]  = useState('');
  const [drillComboPeriod,  setDrillComboPeriod]  = useState('');
  const [drillComboTabKey,  setDrillComboTabKey]  = useState('');

  // ── YTD Movement Drawer ──────────────────────────────────────
  const [ytdMovVisible,   setYtdMovVisible]   = useState(false);
  const [ytdMovLoading,   setYtdMovLoading]   = useState(false);
  const [ytdMovAccount,   setYtdMovAccount]   = useState('');
  const [ytdMovDesc,      setYtdMovDesc]      = useState('');
  const [ytdMovLedger,    setYtdMovLedger]    = useState('');
  const [ytdMovCompany,   setYtdMovCompany]   = useState<string | null>(null);
  const [ytdMovCurrency,  setYtdMovCurrency]  = useState<string | null>(null);
  const [ytdMovProgress,  setYtdMovProgress]  = useState('');
  const [ytdMovRows,      setYtdMovRows]      = useState<{ period: string; period_year: number; period_number: number; ytd_opening: number; ytd_debit: number; ytd_credit: number; closing: number }[]>([]);
  const [ytdMovError,    setYtdMovError]    = useState<string | null>(null);
  const [ytdMovApiUrls,  setYtdMovApiUrls]  = useState<string[]>([]);
  // Prompt modal state
  const [ytdMovPromptVisible,  setYtdMovPromptVisible]  = useState(false);
  const [ytdMovPromptYear,     setYtdMovPromptYear]     = useState<number | null>(null);
  const [ytdMovPromptPeriod,   setYtdMovPromptPeriod]   = useState<string | null>(null);
  const [ytdMovPendingAccount, setYtdMovPendingAccount] = useState('');
  const [ytdMovPendingDesc,    setYtdMovPendingDesc]    = useState('');
  const [ytdMovPendingLedger,  setYtdMovPendingLedger]  = useState('');
  const [ytdMovPendingCompany, setYtdMovPendingCompany] = useState<string | null>(null);
  const [ytdMovPendingCurrency,setYtdMovPendingCurrency]= useState<string | null>(null);

  // ── All companies from COA value set ────────────────────────
  const [allCompanies, setAllCompanies] = useState<{ value: string; label: string }[]>([]);

  // ── TB Drill-down: Journal Lines modal ───────────────────
  interface JournalLine {
    line_id: number;
    line_num: number;
    je_header_id: number;
    je_name: string;
    je_description: string;
    period_name: string;
    ledger_name: string;
    source: string;
    category: string;
    status: string;
    effective_date: string;
    account_combination: string;
    company: string;
    account: string;
    currency_code: string;
    entered_dr: number;
    entered_cr: number;
    accounted_dr: number;
    accounted_cr: number;
    line_description: string;
  }
  const [drillJnlVisible,  setDrillJnlVisible]  = useState(false);
  const [drillJnlLoading,  setDrillJnlLoading]  = useState(false);
  const [drillJnlData,     setDrillJnlData]     = useState<JournalLine[]>([]);
  const [drillJnlAccount,  setDrillJnlAccount]  = useState('');
  const [drillJnlCombo,    setDrillJnlCombo]    = useState('');
  const [drillJnlPeriod,   setDrillJnlPeriod]   = useState('');
  const [drillJnlLedger,   setDrillJnlLedger]   = useState('');
  const [drillJnlSearch,   setDrillJnlSearch]   = useState('');
  const [drillJnlError,    setDrillJnlError]    = useState<string | null>(null);

  // ReERP ↔ Fusion reconciliation state
  const [reconVisible,  setReconVisible]  = useState(false);
  const [reconData,     setReconData]     = useState<ReconRecord[]>([]);
  const [reconPeriod,   setReconPeriod]   = useState('');
  const [reconFilter,   setReconFilter]   = useState<'all' | 'diff' | 'matched'>('all');
  const [reconSearch,   setReconSearch]   = useState('');

  // Get unique years from periods
  const availableYears = useMemo(() => {
    const years = [...new Set(periods.map(p => p.period_year))].sort((a, b) => b - a);
    return years;
  }, [periods]);

  // Filter periods by year
  const filteredPeriods = useMemo(() => {
    if (!selectedYear) return periods;
    return periods.filter(p => p.period_year === selectedYear);
  }, [periods, selectedYear]);

  // Track an API call for the panel
  const trackCall = (key: string, label: string, url: string) => {
    setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], label, url, method: 'GET', status: null, ok: null, durationMs: null, running: true, body: '' } }));
    return performance.now();
  };
  const resolveCall = (key: string, t0: number, status: number, ok: boolean, body: string) => {
    setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], status, ok, durationMs: Math.round(performance.now() - t0), running: false, body } }));
  };

  // Test an API endpoint directly from the panel
  const testEndpoint = async (key: string) => {
    const call = apiCalls[key];
    if (!call.url) { message.warning('Load a period first to capture the URL'); return; }
    setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], status: null, ok: null, body: '', running: true } }));
    const t0 = performance.now();
    try {
      const res = await fetch(call.url);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}
      setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], status: res.status, ok: res.ok, durationMs: Math.round(performance.now() - t0), running: false, body: pretty.slice(0, 2000) } }));
    } catch (e: any) {
      setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], status: 0, ok: false, durationMs: Math.round(performance.now() - t0), running: false, body: e.message } }));
    }
  };

  // Fetch ledger list from APEX
  const fetchLedgers = useCallback(async () => {
    setLoadingLedgers(true);
    const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.getLedgerName}`;
    const t0 = trackCall('ledgers', 'GET Ledgers', url);
    try {
      const res = await fetch(url);
      const data = await res.json();
      const names: string[] = (data.items || []).map((i: any) => i.ledger_name).filter(Boolean);
      resolveCall('ledgers', t0, res.status, res.ok, `${names.length} ledgers`);
      setLedgerOptions(names);
      if (names.length > 0 && !names.includes(selectedLedger)) {
        setSelectedLedger(names[0]);
      }
    } catch (e: any) {
      resolveCall('ledgers', t0, 0, false, e.message);
    } finally {
      setLoadingLedgers(false);
    }
  }, [selectedLedger]);

  // Fetch periods list from APEX periods status endpoint
  const fetchPeriods = useCallback(async () => {
    setLoadingPeriods(true);
    setPeriodsError(null);

    try {
      const params = new URLSearchParams({
        'P_APPLICATION_NAME': 'General Ledger',
        'P_LEDGER_NAME': selectedLedger,
      });
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.periodsStatus}?${params}`;
      const t0 = trackCall('periods', `GET Periods — ${selectedLedger}`, url);
      const response = await fetch(url);

      if (!response.ok) {
        resolveCall('periods', t0, response.status, false, response.statusText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      resolveCall('periods', t0, response.status, true, `${JSON.parse(text)?.items?.length ?? '?'} periods returned`);
      const data = JSON.parse(text);
      const items: PeriodInfo[] = data.items || [];

      // Sort by year desc, then by period_number desc
      const sortedPeriods = items.sort((a, b) => {
        if (a.period_year !== b.period_year) {
          return b.period_year - a.period_year;
        }
        return b.period_number - a.period_number;
      });

      setPeriods(sortedPeriods);

      // Auto-select most recent year
      if (sortedPeriods.length > 0 && !selectedYear) {
        setSelectedYear(sortedPeriods[0].period_year);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch periods';
      setPeriodsError(errorMsg);
    } finally {
      setLoadingPeriods(false);
    }
  }, [selectedYear, selectedLedger]);

  // Fetch trial balance data for a specific period
  const fetchTrialBalance = useCallback(async (periodName: string) => {
    const tabKey = `tb-${periodName}`;

    // Check if tab already exists
    const existingTab = tabs.find(t => t.key === tabKey);
    if (existingTab) {
      setActiveTab(tabKey);
      return;
    }

    // Create new tab in loading state
    const newTab: TabData = {
      key: tabKey,
      periodName,
      ledgerName: selectedLedger,
      tabType: 'fusion',
      data: [],
      rrData: [],
      rrGenerating: false,
      loading: true,
      error: null,
      companies: [],
      currencies: [],
      selectedCompany: '01',
      selectedCurrency: 'AED',
      segmentsBefore: [],
      segmentsAfter: [],
      gridSearch: '',
      showEntered: false,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTab(tabKey);

    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.glBalances}?p_period_name=${encodeURIComponent(periodName)}`;
      const t0 = trackCall('trialBalance', `GET Trial Balance — ${periodName}`, url);
      const response = await fetch(url);

      if (!response.ok) {
        resolveCall('trialBalance', t0, response.status, false, response.statusText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      const data = JSON.parse(text);
      const items: GLBalanceRecord[] = data.items || [];
      resolveCall('trialBalance', t0, response.status, true, `${items.length} rows returned`);

      // Extract unique companies and currencies from actual JSON result
      const companies = [...new Set(items.map(i => i.company).filter(Boolean))].sort();
      const currencies = [...new Set(items.map(i => i.currency || i.currency_code).filter(Boolean))].sort() as string[];

      setTabs(prev => prev.map(t =>
        t.key === tabKey
          ? { ...t, data: items, loading: false, companies, currencies }
          : t
      ));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch trial balance';
      setTabs(prev => prev.map(t =>
        t.key === tabKey
          ? { ...t, loading: false, error: errorMsg }
          : t
      ));
    }
  }, [tabs]);

  // Fetch + generate ReERP Trial Balance for a period
  const fetchRrTrialBalance = useCallback(async (record: PeriodInfo) => {
    const ledgerShort = record.ledger_name.split(/[\s_]+/)[0];
    const tabKey = `rr-${ledgerShort}-${record.period_name_id}`;

    const existingTab = tabs.find(t => t.key === tabKey);
    if (existingTab) { setActiveTab(tabKey); return; }

    const newTab: TabData = {
      key: tabKey,
      periodName: `ReERP: ${record.period_name_id} · ${ledgerShort}`,
      ledgerName: record.ledger_name,
      tabType: 'reerp',
      data: [],
      rrData: [],
      rrGenerating: true,
      loading: true,
      error: null,
      companies: [],
      currencies: [],
      selectedCompany: null,
      selectedCurrency: null,
      segmentsBefore: [],
      segmentsAfter: [],
      gridSearch: '',
      showEntered: false,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTab(tabKey);

    try {
      // Step 1: Generate TB for this period
      // Pass fiscal_year / fiscal_period from the period record so the
      // ORDS handler can sync RR_GL_FISCAL_PERIODS before calling GENERATE_TB.
      // Do NOT pass p_period_year — GENERATE_TB derives fiscal year from the
      // periods table; passing a fiscal year here would mismatch the calendar
      // fallback if the table isn't populated yet.
      const genUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceGenerate}`;
      const t0gen = trackCall('rrGenerate', `POST RR TB Generate — ${record.period_name_id}`, genUrl);
      setApiCalls(prev => ({ ...prev, rrGenerate: { ...prev.rrGenerate, method: 'POST' } }));
      const genRes = await fetch(genUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          p_ledger_name:   record.ledger_name,
          p_period_name:   record.period_name_id,
          p_fiscal_year:   record.period_year,
          p_fiscal_period: record.period_number,
        }),
      });
      const genData = await genRes.json();
      resolveCall('rrGenerate', t0gen, genRes.status, genRes.ok,
        genData.message || (genData.success === false ? (genData.error_msg || 'Generation failed') : JSON.stringify(genData).slice(0, 300)));
      if (genData.success === false) throw new Error(genData.error_msg || genData.message || 'Generation failed');

      setTabs(prev => prev.map(t =>
        t.key === tabKey ? { ...t, rrGenerating: false } : t
      ));

      // Step 2: Fetch the generated rows in standard TB format
      const fetchUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandard}`
        + `?ledger_name=${encodeURIComponent(record.ledger_name)}`
        + `&period_name=${encodeURIComponent(record.period_name_id)}`
        + `&limit=5000`;
      const t0fetch = trackCall('rrFetch', `GET RR TB Standard — ${record.period_name_id}`, fetchUrl);
      const res = await fetch(fetchUrl, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      resolveCall('rrFetch', t0fetch, res.status, res.ok, `${(data.items || []).length} rows`);
      const items: RrTBRecord[] = (data.items || []) as RrTBRecord[];

      const companies = [...new Set(items.map(i => i.company).filter(Boolean))].sort();
      const currencies = [...new Set(items.map(i => i.currency_code).filter(Boolean))].sort();

      setTabs(prev => prev.map(t =>
        t.key === tabKey
          ? { ...t, rrData: items, loading: false, companies, currencies }
          : t
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate ReERP TB';
      setTabs(prev => prev.map(t =>
        t.key === tabKey ? { ...t, loading: false, rrGenerating: false, error: msg } : t
      ));
    }
  }, [tabs]);

  // Fetch ReERP Dynamic TB — calls /standard directly (no generate step)
  const fetchDynamicTB = useCallback(async (record: PeriodInfo) => {
    const ledgerShort = record.ledger_name.split(/[\s_]+/)[0];
    const tabKey = `rr-dyn-${ledgerShort}-${record.period_name_id}`;

    const existingTab = tabs.find(t => t.key === tabKey);
    if (existingTab) { setActiveTab(tabKey); return; }

    const newTab: TabData = {
      key: tabKey,
      periodName: `Dynamic: ${record.period_name_id} · ${ledgerShort}`,
      ledgerName: record.ledger_name,
      tabType: 'reerp-dynamic',
      data: [],
      rrData: [],
      rrGenerating: false,
      loading: true,
      error: null,
      companies: [],
      currencies: [],
      selectedCompany: null,
      selectedCurrency: null,
      segmentsBefore: [],
      segmentsAfter: [],
      gridSearch: '',
      showEntered: false,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTab(tabKey);

    try {
      // Drop period_year: PeriodInfo.period_year is the calendar year but the
      // view uses FISCAL_YEAR (e.g. Jul-23 → calendar 2023, fiscal 2024).
      // period_name is already unique per month, so filtering by it alone
      // is sufficient and avoids the fiscal/calendar year mismatch.
      const fetchUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandard}`
        + `?ledger_name=${encodeURIComponent(record.ledger_name)}`
        + `&period_name=${encodeURIComponent(record.period_name_id)}`
        + `&limit=10000`;
      const t0 = trackCall('rrDynamic', `GET RR Dynamic TB — ${record.period_name_id}`, fetchUrl);
      const res = await fetch(fetchUrl, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      resolveCall('rrDynamic', t0, res.status, res.ok, `${(data.items || []).length} rows`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const items: RrTBRecord[] = (data.items || []) as RrTBRecord[];

      const companies = [...new Set(items.map(i => i.company).filter(Boolean))].sort();
      const currencies = [...new Set(items.map(i => i.currency_code).filter(Boolean))].sort();

      setTabs(prev => prev.map(t =>
        t.key === tabKey
          ? { ...t, rrData: items, loading: false, companies, currencies }
          : t
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch Dynamic TB';
      setTabs(prev => prev.map(t =>
        t.key === tabKey ? { ...t, loading: false, error: msg } : t
      ));
    }
  }, [tabs]);

  // Fetch Dynamic YTD TB — same /standard endpoint, displayed in YTD columns
  const fetchDynamicYtdTB = useCallback(async (record: PeriodInfo) => {
    const ledgerShort = record.ledger_name.split(/[\s_]+/)[0];
    const tabKey = `rr-ytd-${ledgerShort}-${record.period_name_id}`;
    const existingTab = tabs.find(t => t.key === tabKey);
    if (existingTab) { setActiveTab(tabKey); return; }

    const newTab: TabData = {
      key: tabKey,
      periodName: `YTD: ${record.period_name_id} · ${ledgerShort}`,
      ledgerName: record.ledger_name,
      tabType: 'reerp-ytd',
      data: [], rrData: [], rrGenerating: false, loading: true, error: null,
      companies: [], currencies: [],
      selectedCompany: null, selectedCurrency: null,
      segmentsBefore: [], segmentsAfter: [], gridSearch: '', showEntered: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTab(tabKey);

    try {
      // Fetch TB rows
      const fetchUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandard}`
        + `?ledger_name=${encodeURIComponent(record.ledger_name)}`
        + `&period_name=${encodeURIComponent(record.period_name_id)}`
        + `&limit=10000`;
      const res = await fetch(fetchUrl, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      let items: RrTBRecord[] = (data.items || []) as RrTBRecord[];

      // Auto-fetch RE opening: previous year's closing (period_year - 1, period_number=12)
      try {
        const prevYear = record.period_year - 1;
        const prevLastPeriod = periods.find(
          p => p.ledger_name === record.ledger_name
            && p.period_year === prevYear
            && p.period_number === 12
        );
        const reUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandardRE}`
          + `?ledger_name=${encodeURIComponent(record.ledger_name)}`
          + (prevLastPeriod
            ? `&period_name=${encodeURIComponent(prevLastPeriod.period_name_id)}`
            : `&period_year=${prevYear}`);
        const reRes = await fetch(reUrl, { headers: { Accept: 'application/json' } });
        if (reRes.ok) {
          const reData = await reRes.json();
          const reItems: RrTBRecord[] = (reData.items || []) as RrTBRecord[];
          if (reItems.length > 0) {
            // Replace ytd_opening of the existing RE account row in TB with the
            // closing from standardRE (previous year's closing = this year's opening B/F)
            const reClosing = reItems.reduce((s, r) => s + (r.closing || 0), 0);
            const hasExisting = items.some(i => i.account === reItems[0].account);
            if (hasExisting) {
              // Update existing row — opening and closing both = prev year closing
              items = items.map(i =>
                i.account === reItems[0].account
                  ? {
                      ...i,
                      account_desc:        'Retained Earnings',
                      opening:              reClosing,
                      closing:              reClosing,
                      entered_opening:      reClosing,
                      entered_closing:      reClosing,
                      ytd_opening:          reClosing,
                      ytd_entered_opening:  reClosing,
                    }
                  : i
              );
            } else {
              // No existing row — inject as B/F row
              const merged: RrTBRecord[] = reItems.map(r => ({
                ...r,
                account_desc:       'Retained Earnings',
                opening:             reClosing,
                debit:               0,
                credit:              0,
                closing:             reClosing,
                entered_opening:     reClosing,
                entered_debit:       0,
                entered_credit:      0,
                entered_closing:     reClosing,
                ytd_opening:         reClosing,
                ytd_debit:           0,
                ytd_credit:          0,
                ytd_entered_opening: reClosing,
                ytd_entered_debit:   0,
                ytd_entered_credit:  0,
              }));
              items = [...items, ...merged];
            }
          }
        }
      } catch { /* RE fetch failure is non-fatal — TB still loads */ }

      const companies = [...new Set(items.map(i => i.company).filter(Boolean))].sort();
      const currencies = [...new Set(items.map(i => i.currency_code).filter(Boolean))].sort();
      setTabs(prev => prev.map(t =>
        t.key === tabKey ? { ...t, rrData: items, loading: false, companies, currencies } : t
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch YTD TB';
      setTabs(prev => prev.map(t =>
        t.key === tabKey ? { ...t, loading: false, error: msg } : t
      ));
    }
  }, [tabs]);

  // Open YTD Movement drawer — fetch periods from fromPeriodId onwards for one account
  const openYtdMovement = useCallback(async (
    account: string, accountDesc: string, ledgerName: string,
    company: string | null, currency: string | null,
    fromPeriodId: string,
  ) => {
    setYtdMovAccount(account);
    setYtdMovDesc(accountDesc);
    setYtdMovLedger(ledgerName);
    setYtdMovCompany(company);
    setYtdMovCurrency(currency);
    setYtdMovRows([]);
    setYtdMovError(null);
    setYtdMovApiUrls([]);
    setYtdMovVisible(true);
    setYtdMovLoading(true);

    // Sort all periods oldest → newest, then slice from the chosen start period
    const sortedAll = [...periods].sort((a, b) =>
      a.period_year !== b.period_year ? a.period_year - b.period_year : a.period_number - b.period_number
    );
    const startIdx = sortedAll.findIndex(p => p.period_name_id === fromPeriodId);
    const periodsToUse = startIdx >= 0 ? sortedAll.slice(startIdx) : sortedAll;

    if (periodsToUse.length === 0) {
      setYtdMovError('No periods available. Please load periods first from the Periods tab.');
      setYtdMovLoading(false);
      return;
    }

    try {
      const results: { period: string; period_year: number; period_number: number; ytd_opening: number; ytd_debit: number; ytd_credit: number; closing: number }[] = [];

      for (let i = 0; i < periodsToUse.length; i++) {
        const p = periodsToUse[i];
        setYtdMovProgress(`Fetching ${i + 1} / ${periodsToUse.length} — ${p.period_name_id}`);
        let url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandard}`
          + `?ledger_name=${encodeURIComponent(ledgerName)}`
          + `&period_name=${encodeURIComponent(p.period_name_id)}`
          + `&account=${encodeURIComponent(account)}`;
        if (company)  url += `&company=${encodeURIComponent(company)}`;
        if (currency) url += `&currency_code=${encodeURIComponent(currency)}`;
        url += `&limit=500`;
        setYtdMovApiUrls(prev => [...prev, url]);
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const data = await res.json();
        const items: RrTBRecord[] = (data.items || []) as RrTBRecord[];
        if (items.length > 0) {
          const ytd_opening = items.reduce((s, r) => s + (r.ytd_opening || 0), 0);
          const ytd_debit   = items.reduce((s, r) => s + (r.ytd_debit   || 0), 0);
          const ytd_credit  = items.reduce((s, r) => s + (r.ytd_credit  || 0), 0);
          const closing     = items.reduce((s, r) => s + (r.closing     || 0), 0);
          results.push({ period: p.period_name_id, period_year: p.period_year, period_number: p.period_number, ytd_opening, ytd_debit, ytd_credit, closing });
          setYtdMovRows([...results]);
        }
      }
      setYtdMovProgress('');
      if (results.length === 0) setYtdMovError('No balances found for this account across any period.');
    } catch (err) {
      setYtdMovError(err instanceof Error ? err.message : 'Failed to load YTD movement');
    } finally {
      setYtdMovLoading(false);
      setYtdMovProgress('');
    }
  }, [periods]);

  // Close a tab
  const closeTab = useCallback((tabKey: string) => {
    if (tabKey === 'lines-summary') {
      setLsVisible(false);
      if (activeTab === 'lines-summary') setActiveTab('periods');
      return;
    }
    setTabs(prev => prev.filter(t => t.key !== tabKey));
    if (activeTab === tabKey) setActiveTab('periods');
  }, [activeTab]);

  // ── TB Drill: open Combinations modal ───────────────────
  const openDrillCombo = useCallback((
    account: string,
    rrData: RrTBRecord[],
    ledgerName: string,
    periodName: string,
    tabKey?: string,
  ) => {
    setDrillComboAccount(account);
    setDrillComboRows(rrData.filter(r => r.account === account));
    setDrillComboLedger(ledgerName);
    setDrillComboPeriod(periodName);
    setDrillComboTabKey(tabKey || '');
    setDrillComboSearch('');
    setDrillComboVisible(true);
  }, []);

  // ── TB Drill: fetch Journal Lines for an account + period ─
  const fetchDrillJournalLines = useCallback(async (
    ledgerName: string,
    periodName: string,
    account: string,
    accountCombination: string | null,
  ) => {
    setDrillJnlLedger(ledgerName);
    setDrillJnlPeriod(periodName);
    setDrillJnlAccount(account);
    setDrillJnlCombo(accountCombination || '');
    setDrillJnlSearch('');
    setDrillJnlError(null);
    setDrillJnlData([]);
    setDrillJnlLoading(true);
    setDrillJnlVisible(true);

    try {
      const params = new URLSearchParams({
        ledger_name: ledgerName,
        period_name: periodName,
        account,
        limit: '5000',
      });
      if (accountCombination) params.set('account_combination', accountCombination);
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceLines}?${params}`;
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      setDrillJnlData((data.items || []) as any[]);
    } catch (err) {
      setDrillJnlError(err instanceof Error ? err.message : 'Failed to load journal lines');
    } finally {
      setDrillJnlLoading(false);
    }
  }, []);

  // ── Lines Summary ────────────────────────────────────────
  const fetchLinesSummary = useCallback(async (period: string | null, company: string | null) => {
    if (!period) { message.warning('Select a period first'); return; }
    setLsLoading(true);
    setLsError(null);
    const params = new URLSearchParams({ period_name: period, limit: '5000' });
    if (company) params.set('company', company);
    const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.glLinesSummary}?${params}`;
    setLsApiUrl(url);
    const t0 = trackCall('linesSummary', `GET Lines Summary — ${period}`, url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      resolveCall('linesSummary', t0, res.status, true, `${(json.items || []).length} rows`);
      setLsData(json.items || []);
    } catch (e: any) {
      resolveCall('linesSummary', t0, 0, false, e.message);
      setLsError(e.message);
    } finally {
      setLsLoading(false);
    }
  }, []);

  const handleOpenLinesSummary = useCallback(() => {
    const activeTBTab = tabs.find(t => t.key === activeTab);
    const periodHint  = activeTBTab?.periodName ?? null;
    if (periodHint && !lsPeriod) setLsPeriod(periodHint);
    setLsVisible(true);
    setActiveTab('lines-summary');
  }, [tabs, activeTab, lsPeriod]);

  const handleReconcile = useCallback(() => {
    if (!lsPeriod) { message.warning('Select a period first'); return; }
    if (!lsData.length) { message.warning('Fetch Lines Summary data first'); return; }

    // Find the GL TB tab for this period
    const tbTab = tabs.find(t => t.periodName === lsPeriod);
    if (!tbTab || !tbTab.data.length) {
      message.warning(`Open the GL Trial Balance tab for ${lsPeriod} first`);
      return;
    }

    // Build TB map: company|account → { dr, cr } (sum all rows — TB debit/credit are functional currency)
    const tbMap = new Map<string, { dr: number; cr: number }>();
    for (const rec of tbTab.data) {
      const key  = `${(rec.company || '').trim()}|${(rec.account || '').trim()}`;
      const prev = tbMap.get(key) ?? { dr: 0, cr: 0 };
      tbMap.set(key, { dr: prev.dr + (rec.debit || 0), cr: prev.cr + (rec.credit || 0) });
    }

    // Aggregate LS data (ACCOUNTED_DR/CR are functional currency — sum all currencies)
    const lsAcctMap = new Map<string, { dr: number; cr: number }>();
    for (const row of lsData) {
      const key  = `${(row.seg1_company || '').trim()}|${(row.seg4_account || '').trim()}|${(row.ledger_name || '').trim()}`;
      const prev = lsAcctMap.get(key) ?? { dr: 0, cr: 0 };
      lsAcctMap.set(key, { dr: prev.dr + row.total_dr, cr: prev.cr + row.total_cr });
    }

    // Build recon map keyed by company|account|ledger
    const newMap = new Map<string, { tbDr: number; tbCr: number; matched: boolean }>();
    for (const [key, ls] of lsAcctMap) {
      const [company, account] = key.split('|');
      const tb = tbMap.get(`${company}|${account}`);
      if (!tb) {
        newMap.set(key, { tbDr: 0, tbCr: 0, matched: false });
      } else {
        newMap.set(key, { tbDr: tb.dr, tbCr: tb.cr, matched: Math.abs(tb.dr - ls.dr) < 0.01 && Math.abs(tb.cr - ls.cr) < 0.01 });
      }
    }

    setLsReconMap(newMap);
    setLsReconDone(true);
    const matched   = [...newMap.values()].filter(v => v.matched).length;
    const unmatched = newMap.size - matched;
    message.info(`Reconciliation: ${matched} matched ✓, ${unmatched} unmatched ✗`);
  }, [lsPeriod, lsData, tabs]);

  // ── ReERP ↔ Fusion account-level reconciliation ────────────────────────
  const handleRrReconcile = useCallback((tab: TabData) => {
    const periodName = tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, '');

    // Find the Fusion TB tab for this period
    const fusionTab = tabs.find(t => t.tabType === 'fusion' && t.periodName === periodName);
    if (!fusionTab) {
      message.warning(
        `Open "Fusion TB" for ${periodName} first, then click Reconcile`,
        4,
      );
      return;
    }
    if (!fusionTab.data.length) {
      message.warning('Fusion TB has no data loaded for this period');
      return;
    }

    const TOLERANCE = 0.005;

    // Fusion TB stores everything in functional currency (AED) → filter to AED.
    // Dynamic TB uses ENTERED currency codes (e.g. INR for Indian entries) even
    // though the ACCOUNTED amounts are already in the functional currency (AED).
    // So we must NOT filter the ReERP side by currency — sum all currencies,
    // which gives the same total as Fusion AED.
    const FUSION_CURRENCY = 'AED';

    // Aggregate Fusion TB by account — AED (functional currency) only
    type Agg = { opening: number; debit: number; credit: number; closing: number; desc: string };
    const fusionMap = new Map<string, Agg>();
    fusionTab.data.forEach(r => {
      if (tab.selectedCompany && r.company !== tab.selectedCompany) return;
      if ((r.currency || r.currency_code) !== FUSION_CURRENCY) return;
      const prev = fusionMap.get(r.account) ?? { opening: 0, debit: 0, credit: 0, closing: 0, desc: r.account_desc || '' };
      fusionMap.set(r.account, {
        opening: prev.opening + (r.opening_balance || 0),
        debit:   prev.debit   + (r.debit           || 0),
        credit:  prev.credit  + (r.credit          || 0),
        closing: prev.closing + (r.closing_balance || 0),
        desc:    r.account_desc || prev.desc,
      });
    });

    // Aggregate ReERP TB by account — ALL currencies summed
    // (accounted amounts are already in functional currency regardless of the
    // entered currency code stored on the line)
    const rrMap = new Map<string, Agg>();
    tab.rrData.forEach(r => {
      if (tab.selectedCompany && r.company !== tab.selectedCompany) return;
      const prev = rrMap.get(r.account) ?? { opening: 0, debit: 0, credit: 0, closing: 0, desc: r.account_desc || '' };
      rrMap.set(r.account, {
        opening: prev.opening + (r.opening || 0),
        debit:   prev.debit   + (r.debit   || 0),
        credit:  prev.credit  + (r.credit  || 0),
        closing: prev.closing + (r.closing || 0),
        desc:    r.account_desc || prev.desc,
      });
    });

    const allAccounts = new Set([...fusionMap.keys(), ...rrMap.keys()]);
    const records: ReconRecord[] = Array.from(allAccounts)
      .map(account => {
        const f  = fusionMap.get(account) ?? { opening: 0, debit: 0, credit: 0, closing: 0, desc: '' };
        const rr = rrMap.get(account)     ?? { opening: 0, debit: 0, credit: 0, closing: 0, desc: '' };
        const dO = rr.opening - f.opening;
        const dD = rr.debit   - f.debit;
        const dC = rr.credit  - f.credit;
        const dCl= rr.closing - f.closing;
        return {
          account,
          account_desc:  rr.desc || f.desc,
          fusionOpening: f.opening,  fusionDebit: f.debit,  fusionCredit: f.credit,  fusionClosing: f.closing,
          rrOpening:    rr.opening,  rrDebit:    rr.debit,  rrCredit:    rr.credit,  rrClosing:    rr.closing,
          diffOpening:   dO,  diffDebit: dD,  diffCredit: dC,  diffClosing: dCl,
          matched:  Math.abs(dO) < TOLERANCE && Math.abs(dD) < TOLERANCE &&
                    Math.abs(dC) < TOLERANCE && Math.abs(dCl) < TOLERANCE,
          inFusion: fusionMap.has(account),
          inRr:     rrMap.has(account),
        };
      })
      .sort((a, b) => a.account.localeCompare(b.account));

    setReconData(records);
    setReconPeriod(periodName);
    setReconFilter('all');
    setReconSearch('');
    setReconVisible(true);

    const matchedCount = records.filter(r => r.matched).length;
    const diffCount    = records.length - matchedCount;
    if (diffCount === 0) {
      message.success(`All ${matchedCount} accounts reconcile perfectly ✓`);
    } else {
      message.warning(`${diffCount} account(s) have differences — see reconciliation panel`);
    }
  }, [tabs]);

  // Update tab filter
  const updateTabFilter = useCallback((tabKey: string, field: 'selectedCompany' | 'selectedCurrency', value: string | null) => {
    setTabs(prev => prev.map(t =>
      t.key === tabKey
        ? { ...t, [field]: value }
        : t
    ));
  }, []);

  const updateTabSearch = useCallback((tabKey: string, search: string) => {
    setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, gridSearch: search } : t));
  }, []);

  const updateTabEntered = useCallback((tabKey: string, show: boolean) => {
    setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, showEntered: show } : t));
  }, []);

  // Handle segment drop
  const handleSegmentDrop = useCallback((tabKey: string, segment: string, position: 'before' | 'after') => {
    setTabs(prev => prev.map(t => {
      if (t.key !== tabKey) return t;

      // Remove from both arrays first
      const newBefore = t.segmentsBefore.filter(s => s !== segment);
      const newAfter = t.segmentsAfter.filter(s => s !== segment);

      if (position === 'before') {
        return { ...t, segmentsBefore: [...newBefore, segment], segmentsAfter: newAfter };
      } else {
        return { ...t, segmentsBefore: newBefore, segmentsAfter: [...newAfter, segment] };
      }
    }));
  }, []);

  // Remove dropped segment
  const removeDroppedSegment = useCallback((tabKey: string, segment: string) => {
    setTabs(prev => prev.map(t => {
      if (t.key !== tabKey) return t;
      return {
        ...t,
        segmentsBefore: t.segmentsBefore.filter(s => s !== segment),
        segmentsAfter: t.segmentsAfter.filter(s => s !== segment),
      };
    }));
  }, []);

  // Get segment label
  const getSegmentLabel = (segmentKey: string): string => {
    const segment = AVAILABLE_SEGMENTS.find(s => s.key === segmentKey);
    return segment?.label || segmentKey;
  };

  // Generate pivot data - group by segments + account
  const generatePivotData = (data: GLBalanceRecord[], segmentsBefore: string[], segmentsAfter: string[]): PivotRow[] => {
    const pivotMap = new Map<string, PivotRow>();
    const groupByKeys = [...segmentsBefore, 'account', ...segmentsAfter];

    // Also track raw rows per account (regardless of segments) for the detail popup
    const accountRawRows = new Map<string, GLBalanceRecord[]>();

    data.forEach(row => {
      // Track raw rows by account
      if (!accountRawRows.has(row.account)) {
        accountRawRows.set(row.account, []);
      }
      accountRawRows.get(row.account)!.push(row);

      // Build key from selected segments
      const keyParts = groupByKeys.map(key => (row as any)[key] || '');
      const pivotKey = keyParts.join('|');

      if (!pivotMap.has(pivotKey)) {
        const pivotRow: PivotRow = {
          key: pivotKey,
          account: row.account,
          account_desc: row.account_desc,
          opening_balance: 0,
          debit: 0,
          credit: 0,
          closing_balance: 0,
          segmentCount: 0,
          rawRows: [],
        };

        // Add segment values
        segmentsBefore.forEach(seg => {
          pivotRow[seg] = (row as any)[seg] || '';
        });
        segmentsAfter.forEach(seg => {
          pivotRow[seg] = (row as any)[seg] || '';
        });

        pivotMap.set(pivotKey, pivotRow);
      }

      const pivotRow = pivotMap.get(pivotKey)!;
      pivotRow.opening_balance += row.opening_balance || 0;
      pivotRow.debit += row.debit || 0;
      pivotRow.credit += row.credit || 0;
      pivotRow.closing_balance += row.closing_balance || 0;
      pivotRow.segmentCount += 1;
      (pivotRow.rawRows as GLBalanceRecord[]).push(row);
    });

    // Convert to array and sort by account
    const result = Array.from(pivotMap.values());
    result.sort((a, b) => a.account.localeCompare(b.account));

    return result;
  };

  // Show account detail modal
  const showAccountDetail = (account: string, account_desc: string, rows: GLBalanceRecord[]) => {
    setDetailModalData({ account, account_desc, rows });
    setDetailModalVisible(true);
  };

  // Initial load
  useEffect(() => {
    fetchLedgers();
    fetchPeriods();
    // Fetch all companies from COA value set
    const VALUES_API = buildApexUrl('valuesets/getvalues');
    fetch(`${VALUES_API}/BUIMERC_FIN_GLB_COA_CO`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const items: any[] = data.items || [];
        setAllCompanies(items
          .filter((i: any) => i.value || i.Value)
          .map((i: any) => {
            const code = i.value || i.Value;
            const desc = i.description || i.Description || code;
            return { value: code, label: `${code} - ${desc}` };
          })
        );
      })
      .catch(() => {});
  }, []);

  // Re-fetch periods when ledger changes
  useEffect(() => {
    setPeriods([]);
    setSelectedYear(null);
    fetchPeriods();
  }, [selectedLedger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sub-account segment descriptions once (for revaluation journal preview)
  const loadSubAcctDescs = useCallback(async () => {
    const VS_BASE = `${APEX_DB_CONFIG.baseUrl}/valuesets/getvalues`;
    const STRUCT_URL = `${APEX_DB_CONFIG.baseUrl}/chartofaccounts/structuresegments`;
    try {
      let vsCode = subAcctVsCode.current;
      if (!vsCode) {
        const structRes = await fetch(STRUCT_URL);
        if (!structRes.ok) return;
        const data = await structRes.json();
        const segs: any[] = data.items || [];
        const subAcctSeg = segs.find((s: any) => {
          const p = (s.prompt || s.segment_name || s.name || s.PROMPT || '').toLowerCase();
          return p.includes('sub') && p.includes('account');
        });
        if (!subAcctSeg) return;
        vsCode = subAcctSeg.segment_code || subAcctSeg.SEGMENT_CODE || '';
        if (!vsCode) return;
        subAcctVsCode.current = vsCode;
      }
      const vsRes = await fetch(`${VS_BASE}/${vsCode}`);
      if (!vsRes.ok) return;
      const vsData = await vsRes.json();
      const map: Record<string, string> = {};
      (vsData.items || []).forEach((item: any) => {
        const code = item.value || item.Value || item.VALUE || '';
        const desc = item.description || item.Description || item.DESCRIPTION || item.meaning || '';
        if (code) map[code] = desc;
      });
      setSubAcctDescMap(map);
    } catch { /* silent */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (subAcctDescLoaded.current) return;
    subAcctDescLoaded.current = true;
    loadSubAcctDescs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load GL Revaluation distributions whenever the LOV picker opens
  useEffect(() => {
    if (!revalComboPickerOpen) return;
    setDistComboLoading(true);
    setDistComboNewOpen(false);
    setDistComboNewName('');
    setDistComboNewDesc('');
    searchCombinations({ module: 'GL Revaluation', status: 'ACTIVE' })
      .then(items => setDistComboList(items))
      .catch(() => setDistComboList([]))
      .finally(() => setDistComboLoading(false));
  }, [revalComboPickerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Get status tag color
  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'open': return 'green';
      case 'closed': return 'red';
      case 'future': return 'blue';
      case 'never opened': return 'default';
      default: return 'default';
    }
  };

  // Periods table columns
  const periodColumns = [
    {
      title: '#',
      dataIndex: 'period_number',
      key: 'period_number',
      width: 60,
      align: 'center' as const,
      render: (num: number) => (
        <Text style={{ fontFamily: 'monospace' }}>{num}</Text>
      ),
    },
    {
      title: 'Period',
      dataIndex: 'period_name_id',
      key: 'period_name_id',
      width: 120,
      render: (text: string) => (
        <Text strong style={{ color: REDWOOD.primary }}>{text}</Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={getStatusColor(status)}>{status}</Tag>
      ),
    },
    {
      title: 'Year',
      dataIndex: 'period_year',
      key: 'period_year',
      width: 80,
      render: (year: number) => <Tag color="blue">{year}</Tag>,
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      key: 'start_date',
      width: 120,
      render: (date: string) => (
        <Text type="secondary">{date ? new Date(date).toLocaleDateString() : '-'}</Text>
      ),
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      key: 'end_date',
      width: 120,
      render: (date: string) => (
        <Text type="secondary">{date ? new Date(date).toLocaleDateString() : '-'}</Text>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 200,
      render: (_: unknown, record: PeriodInfo) => (
        <Space size={4}>
          <Button
            type="primary"
            icon={<TableOutlined />}
            size="small"
            onClick={() => fetchTrialBalance(record.period_name_id)}
            style={{
              background: REDWOOD.primary,
              borderColor: REDWOOD.primary,
              borderRadius: 6,
            }}
          >
            Fusion TB
          </Button>
          <Button
            type="primary"
            icon={<BarChartOutlined />}
            size="small"
            onClick={() => fetchRrTrialBalance(record)}
            style={{
              background: REDWOOD.success,
              borderColor: REDWOOD.success,
              borderRadius: 6,
            }}
          >
            ReERP TB
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            size="small"
            onClick={() => fetchDynamicTB(record)}
            style={{
              background: '#722ed1',
              borderColor: '#722ed1',
              borderRadius: 6,
            }}
          >
            Dynamic PTD TB
          </Button>
          <Button
            type="primary"
            icon={<BarChartOutlined />}
            size="small"
            onClick={() => fetchDynamicYtdTB(record)}
            style={{
              background: '#0958d9',
              borderColor: '#0958d9',
              borderRadius: 6,
            }}
          >
            Dynamic YTD TB
          </Button>
        </Space>
      ),
    },
  ];

  // Render periods tab content
  const renderPeriodsTab = () => (
    <Card
      style={{
        borderRadius: 12,
        border: `1px solid ${REDWOOD.border}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Select
            placeholder={loadingLedgers ? 'Loading ledgers...' : 'Select Ledger'}
            value={selectedLedger || undefined}
            onChange={(val) => setSelectedLedger(val)}
            loading={loadingLedgers}
            style={{ width: '100%' }}
            size="large"
            suffixIcon={<BankOutlined />}
          >
            {ledgerOptions.map(l => (
              <Select.Option key={l} value={l}>
                <BankOutlined style={{ marginRight: 8, color: REDWOOD.info }} />
                {l}
              </Select.Option>
            ))}
          </Select>
        </Col>
        <Col span={8}>
          <Select
            placeholder="Filter by Year"
            value={selectedYear}
            onChange={setSelectedYear}
            allowClear
            style={{ width: '100%' }}
            size="large"
          >
            {availableYears.map(year => (
              <Select.Option key={year} value={year}>
                <CalendarOutlined style={{ marginRight: 8 }} />
                {year}
              </Select.Option>
            ))}
          </Select>
        </Col>
        <Col span={8} style={{ textAlign: 'right' }}>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchPeriods}
            loading={loadingPeriods}
            style={{ borderRadius: 6 }}
          >
            Refresh
          </Button>
        </Col>
      </Row>

      {periodsError && (
        <Alert
          message="Error loading periods"
          description={periodsError}
          type="error"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
        />
      )}

      <Table
        columns={periodColumns}
        dataSource={filteredPeriods}
        rowKey="period_name_id"
        loading={loadingPeriods}
        pagination={{
          pageSize: 12,
          showSizeChanger: true,
          pageSizeOptions: ['12', '24', '48'],
          showTotal: (total) => `${total} periods`,
        }}
        size="middle"
        style={{ borderRadius: 8 }}
      />
    </Card>
  );

  // Export Fusion TB — delegates to styled utility
  const exportTabToExcel = async (tab: TabData, pivotData: PivotRow[]) => {
    if (!pivotData.length) { message.warning('No data to export'); return; }
    const segKeys = [...tab.segmentsBefore, ...tab.segmentsAfter];
    const totals  = pivotData.reduce(
      (acc, r) => ({
        opening: acc.opening + (r.opening_balance || 0),
        debit:   acc.debit   + (r.debit || 0),
        credit:  acc.credit  + (r.credit || 0),
        closing: acc.closing + (r.closing_balance || 0),
      }),
      { opening: 0, debit: 0, credit: 0, closing: 0 }
    );
    message.loading({ content: 'Building Excel…', key: 'xl', duration: 0 });
    try {
      await exportFusionTBToExcel({
        ledger:   selectedLedger || 'All',
        company:  tab.selectedCompany  || 'All',
        period:   tab.periodName,
        currency: tab.selectedCurrency || 'All',
        segments: segKeys.map(s => getSegmentLabel(s)),
        segKeys,
        rows:     pivotData as any,
        totals,
      });
      message.success({ content: 'Excel exported', key: 'xl' });
    } catch (e: any) {
      message.error({ content: `Export failed: ${e.message}`, key: 'xl' });
    }
  };

  // Export ReERP standard TB — delegates to styled utility
  const handleRrExport = async (
    tab:       TabData,
    tableRows: { account: string; account_desc: string; account_type: string;
                 opening: number; debit: number; credit: number; closing: number; ytd_net: number;
                 entered_opening: number; entered_debit: number; entered_credit: number; entered_closing: number }[],
    totals:    { opening: number; debit: number; credit: number; closing: number; ytd_net: number;
                 entered_opening: number; entered_debit: number; entered_credit: number; entered_closing: number }
  ) => {
    if (!tableRows.length) { message.warning('No data to export'); return; }
    message.loading({ content: 'Building Excel…', key: 'xl', duration: 0 });
    try {
      await exportRrTBToExcel({
        ledger:   selectedLedger || 'All',
        company:  tab.selectedCompany  || 'All',
        period:   tab.periodName.replace(/^ReERP:\s*/, ''),
        currency: tab.selectedCurrency || 'All',
        rows:     tableRows,
        totals,
      });
      message.success({ content: 'Excel exported', key: 'xl' });
    } catch (e: any) {
      message.error({ content: `Export failed: ${e.message}`, key: 'xl' });
    }
  };

  // Export both Fusion TB + ReERP TB into one workbook (two sheets)
  const handleExportBoth = useCallback(async (rrTab: TabData) => {
    const periodName = rrTab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, '');
    const fusionTab  = tabs.find(t => t.tabType === 'fusion' && t.periodName === periodName);

    if (!fusionTab) {
      message.warning(`Open "Fusion TB" for ${periodName} first, then export both`, 4);
      return;
    }

    // ── Fusion: filter + pivot (flat, no segment grouping) ──
    const fusionFiltered = fusionTab.data.filter(item => {
      if (rrTab.selectedCompany  && item.company !== rrTab.selectedCompany) return false;
      if (rrTab.selectedCurrency && (item.currency || item.currency_code) !== rrTab.selectedCurrency) return false;
      return true;
    });
    const fusionPivot  = generatePivotData(fusionFiltered, [], []);
    const fusionTotals = fusionPivot.reduce(
      (acc, r) => ({
        opening: acc.opening + (r.opening_balance || 0),
        debit:   acc.debit   + (r.debit           || 0),
        credit:  acc.credit  + (r.credit          || 0),
        closing: acc.closing + (r.closing_balance || 0),
      }),
      { opening: 0, debit: 0, credit: 0, closing: 0 },
    );

    // ── ReERP: filter + group by account ──
    const rrFiltered = rrTab.rrData.filter(r => {
      if (rrTab.selectedCompany  && r.company      !== rrTab.selectedCompany)  return false;
      if (rrTab.selectedCurrency && r.currency_code !== rrTab.selectedCurrency) return false;
      return true;
    });
    type GR = { account: string; account_desc: string; account_type: string;
                opening: number; debit: number; credit: number; closing: number; ytd_net: number;
                entered_opening: number; entered_debit: number; entered_credit: number; entered_closing: number };
    const rrMap = new Map<string, GR>();
    rrFiltered.forEach(r => {
      if (!rrMap.has(r.account)) {
        rrMap.set(r.account, { account: r.account, account_desc: r.account_desc,
          account_type: r.account_type, opening: 0, debit: 0, credit: 0, closing: 0, ytd_net: 0,
          entered_opening: 0, entered_debit: 0, entered_credit: 0, entered_closing: 0 });
      }
      const g = rrMap.get(r.account)!;
      g.opening         += r.opening         || 0;
      g.debit           += r.debit           || 0;
      g.credit          += r.credit          || 0;
      g.closing         += r.closing         || 0;
      g.ytd_net         += r.ytd_net         || 0;
      g.entered_opening += r.entered_opening || 0;
      g.entered_debit   += r.entered_debit   || 0;
      g.entered_credit  += r.entered_credit  || 0;
      g.entered_closing += r.entered_closing || 0;
    });
    const rrRows   = Array.from(rrMap.values()).sort((a, b) => a.account.localeCompare(b.account));
    const rrTotals = rrRows.reduce(
      (acc, r) => ({
        opening:         acc.opening         + r.opening,
        debit:           acc.debit           + r.debit,
        credit:          acc.credit          + r.credit,
        closing:         acc.closing         + r.closing,
        ytd_net:         acc.ytd_net         + r.ytd_net,
        entered_opening: acc.entered_opening + r.entered_opening,
        entered_debit:   acc.entered_debit   + r.entered_debit,
        entered_credit:  acc.entered_credit  + r.entered_credit,
        entered_closing: acc.entered_closing + r.entered_closing,
      }),
      { opening: 0, debit: 0, credit: 0, closing: 0, ytd_net: 0,
        entered_opening: 0, entered_debit: 0, entered_credit: 0, entered_closing: 0 },
    );

    message.loading({ content: 'Building combined Excel…', key: 'xl', duration: 0 });
    try {
      await exportBothTBToExcel({
        ledger:   selectedLedger          || 'All',
        company:  rrTab.selectedCompany   || 'All',
        period:   periodName,
        currency: rrTab.selectedCurrency  || 'All',
        fusionRows:   fusionPivot as any,
        fusionTotals,
        rrRows,
        rrTotals,
      });
      message.success({ content: 'Combined Excel exported', key: 'xl' });
    } catch (e: any) {
      message.error({ content: `Export failed: ${e.message}`, key: 'xl' });
    }
  }, [tabs, selectedLedger]);

  // Render trial balance tab content
  const renderTBTab = (tab: TabData) => {
    // Filter data based on selected filters
    const filteredData = tab.data.filter(item => {
      if (tab.selectedCompany && item.company !== tab.selectedCompany) return false;
      if (tab.selectedCurrency && (item.currency || item.currency_code) !== tab.selectedCurrency) return false;
      return true;
    });

    // Generate pivot data
    let pivotData = generatePivotData(filteredData, tab.segmentsBefore, tab.segmentsAfter);

    // Grid search filter
    if (tab.gridSearch.trim()) {
      const lc = tab.gridSearch.toLowerCase();
      pivotData = pivotData.filter(r =>
        r.account.toLowerCase().includes(lc) ||
        (r.account_desc as string)?.toLowerCase().includes(lc) ||
        tab.segmentsBefore.some(s => String(r[s]).toLowerCase().includes(lc)) ||
        tab.segmentsAfter.some(s => String(r[s]).toLowerCase().includes(lc))
      );
    }

    // Calculate totals from pivot data
    const totals = pivotData.reduce(
      (acc, item) => ({
        opening: acc.opening + item.opening_balance,
        debit: acc.debit + item.debit,
        credit: acc.credit + item.credit,
        closing: acc.closing + item.closing_balance,
      }),
      { opening: 0, debit: 0, credit: 0, closing: 0 }
    );

    // Build dynamic columns based on dropped segments
    const dynamicColumns = [
      // Segments before Account
      ...tab.segmentsBefore.map(seg => ({
        title: getSegmentLabel(seg),
        dataIndex: seg,
        key: seg,
        width: 100,
        render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
      })),
      // Account column (fixed) with expand icon for multiple segments
      {
        title: 'Account',
        dataIndex: 'account',
        key: 'account',
        width: 140,
        sorter: (a: PivotRow, b: PivotRow) => a.account.localeCompare(b.account),
        defaultSortOrder: 'ascend' as const,
        render: (text: string, record: PivotRow) => (
          <Space size={4}>
            <Text strong style={{ fontFamily: 'monospace' }}>{text}</Text>
            {record.segmentCount > 1 && (
              <Tooltip title={`${record.segmentCount} segment combinations - click to view details`}>
                <Button
                  type="link"
                  size="small"
                  icon={<ExpandAltOutlined />}
                  onClick={() => showAccountDetail(record.account, record.account_desc as string, record.rawRows as GLBalanceRecord[])}
                  style={{ padding: 0, height: 'auto', color: REDWOOD.info }}
                />
              </Tooltip>
            )}
          </Space>
        ),
      },
      // Account Description
      {
        title: 'Description',
        dataIndex: 'account_desc',
        key: 'account_desc',
        width: 250,
        ellipsis: true,
        render: (text: string) => <Tooltip title={text}><Text>{text}</Text></Tooltip>,
      },
      // Segments after Account
      ...tab.segmentsAfter.map(seg => ({
        title: getSegmentLabel(seg),
        dataIndex: seg,
        key: seg,
        width: 100,
        render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
      })),
      // Amount columns
      {
        title: 'Opening',
        dataIndex: 'opening_balance',
        key: 'opening_balance',
        width: 130,
        align: 'right' as const,
        render: (value: number) => (
          <Text style={{ fontFamily: 'monospace', color: value < 0 ? REDWOOD.error : REDWOOD.textPrimary }}>
            {formatCurrency(value)}
          </Text>
        ),
      },
      {
        title: 'Debit',
        dataIndex: 'debit',
        key: 'debit',
        width: 130,
        align: 'right' as const,
        render: (value: number) => (
          <Text style={{ fontFamily: 'monospace', color: value > 0 ? REDWOOD.info : REDWOOD.textSecondary }}>
            {formatCurrency(value)}
          </Text>
        ),
      },
      {
        title: 'Credit',
        dataIndex: 'credit',
        key: 'credit',
        width: 130,
        align: 'right' as const,
        render: (value: number) => (
          <Text style={{ fontFamily: 'monospace', color: value > 0 ? REDWOOD.success : REDWOOD.textSecondary }}>
            {formatCurrency(value)}
          </Text>
        ),
      },
      {
        title: 'Closing',
        dataIndex: 'closing_balance',
        key: 'closing_balance',
        width: 130,
        align: 'right' as const,
        render: (value: number) => (
          <Text strong style={{ fontFamily: 'monospace', color: value < 0 ? REDWOOD.error : REDWOOD.textPrimary }}>
            {formatCurrency(value)}
          </Text>
        ),
      },
    ];

    // Calculate segment column count for summary row
    const segmentColCount = tab.segmentsBefore.length + 2 + tab.segmentsAfter.length; // +2 for Account + Description

    if (tab.loading) {
      return (
        <Card style={{ borderRadius: 12, textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">Loading Trial Balance for {tab.periodName}...</Text>
          </div>
        </Card>
      );
    }

    if (tab.error) {
      return (
        <Alert
          message="Error loading Trial Balance"
          description={tab.error}
          type="error"
          showIcon
          style={{ borderRadius: 8 }}
        />
      );
    }

    return (
      <Card
        style={{
          borderRadius: 12,
          border: `1px solid ${REDWOOD.border}`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* Filters */}
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }} align="middle">
          <Col xs={24} sm={6}>
            <Select
              placeholder="All Companies"
              value={tab.selectedCompany}
              onChange={(value) => updateTabFilter(tab.key, 'selectedCompany', value)}
              allowClear
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              options={(allCompanies.length > 0 ? allCompanies : tab.companies.map(c => ({ value: c, label: c }))).map(o => ({
                value: o.value,
                label: (
                  <span><BankOutlined style={{ marginRight: 6, color: REDWOOD.info }} />{o.label}</span>
                ),
              }))}
            />
          </Col>
          <Col xs={24} sm={5}>
            <Select
              placeholder="All Currencies"
              value={tab.selectedCurrency}
              onChange={(value) => updateTabFilter(tab.key, 'selectedCurrency', value)}
              allowClear
              style={{ width: '100%' }}
              showSearch
            >
              {tab.currencies.map(currency => (
                <Select.Option key={currency} value={currency}>
                  <DollarOutlined style={{ marginRight: 6, color: REDWOOD.success }} />
                  {currency}
                </Select.Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={7}>
            <Input
              placeholder="Search account, description..."
              prefix={<SearchOutlined style={{ color: REDWOOD.textSecondary }} />}
              value={tab.gridSearch}
              onChange={e => updateTabSearch(tab.key, e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={6} style={{ textAlign: 'right' }}>
            <Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {pivotData.length} / {generatePivotData(filteredData, tab.segmentsBefore, tab.segmentsAfter).length} rows
              </Text>
              <Button
                icon={<FileExcelOutlined />}
                size="small"
                onClick={() => exportTabToExcel(tab, pivotData)}
                style={{ borderColor: REDWOOD.success, color: REDWOOD.success }}
              >
                Excel
              </Button>
            </Space>
          </Col>
        </Row>

        {/* Draggable Segment Filters */}
        <Divider style={{ margin: '12px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
            <FilterOutlined /> Segments (drag to pivot):
          </Text>
          {AVAILABLE_SEGMENTS.map((segment) => {
            const isDropped = tab.segmentsBefore.includes(segment.key) || tab.segmentsAfter.includes(segment.key);
            return (
              <Tag
                key={segment.key}
                style={{
                  cursor: 'grab',
                  padding: '4px 8px',
                  fontSize: 11,
                  background: isDropped ? `${REDWOOD.info}15` : REDWOOD.surfaceSecondary,
                  borderColor: isDropped ? REDWOOD.info : REDWOOD.border,
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('segment', segment.key);
                }}
              >
                <DragOutlined style={{ marginRight: 4 }} />
                {segment.label}
              </Tag>
            );
          })}
        </div>

        {/* Pivot columns drop zones */}
        <div
          style={{
            marginBottom: 16,
            padding: 8,
            background: `${REDWOOD.info}08`,
            borderRadius: 6,
            border: `1px dashed ${REDWOOD.info}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>Pivot columns:</Text>

          {/* Drop zone BEFORE Account */}
          <div
            onDrop={(e) => {
              e.preventDefault();
              const segment = e.dataTransfer.getData('segment');
              if (segment) handleSegmentDrop(tab.key, segment, 'before');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.style.background = `${REDWOOD.info}30`;
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.background = `${REDWOOD.info}10`;
            }}
            style={{
              minWidth: 80,
              minHeight: 28,
              padding: '4px 8px',
              background: `${REDWOOD.info}10`,
              border: `1px dashed ${REDWOOD.info}`,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
            }}
          >
            {tab.segmentsBefore.length === 0 && (
              <Text type="secondary" style={{ fontSize: 10 }}>Drop here (before)</Text>
            )}
            {tab.segmentsBefore.map((segment) => (
              <Tag
                key={segment}
                closable
                onClose={() => removeDroppedSegment(tab.key, segment)}
                style={{ fontSize: 11, margin: 0 }}
                color="blue"
              >
                {getSegmentLabel(segment)}
              </Tag>
            ))}
          </div>

          {/* Account (fixed) */}
          <Tag style={{ fontSize: 11, margin: 0, fontWeight: 'bold' }} color="gold">
            Account
          </Tag>
          <Tag style={{ fontSize: 11, margin: 0 }} color="default">
            Description
          </Tag>

          {/* Drop zone AFTER Account */}
          <div
            onDrop={(e) => {
              e.preventDefault();
              const segment = e.dataTransfer.getData('segment');
              if (segment) handleSegmentDrop(tab.key, segment, 'after');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.style.background = `${REDWOOD.info}30`;
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.background = `${REDWOOD.info}10`;
            }}
            style={{
              minWidth: 80,
              minHeight: 28,
              padding: '4px 8px',
              background: `${REDWOOD.info}10`,
              border: `1px dashed ${REDWOOD.info}`,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
            }}
          >
            {tab.segmentsAfter.length === 0 && (
              <Text type="secondary" style={{ fontSize: 10 }}>Drop here (after)</Text>
            )}
            {tab.segmentsAfter.map((segment) => (
              <Tag
                key={segment}
                closable
                onClose={() => removeDroppedSegment(tab.key, segment)}
                style={{ fontSize: 11, margin: 0 }}
                color="blue"
              >
                {getSegmentLabel(segment)}
              </Tag>
            ))}
          </div>

          {/* Amount columns (fixed) */}
          <Tag style={{ fontSize: 11, margin: 0 }} color="default">Opening</Tag>
          <Tag style={{ fontSize: 11, margin: 0 }} color="default">Debit</Tag>
          <Tag style={{ fontSize: 11, margin: 0 }} color="default">Credit</Tag>
          <Tag style={{ fontSize: 11, margin: 0 }} color="default">Closing</Tag>
        </div>

        {/* Table — all rows, no pagination */}
        <Table
          columns={dynamicColumns}
          dataSource={pivotData}
          rowKey="key"
          pagination={false}
          scroll={{ x: 1000, y: 520 }}
          size="small"
          style={{ borderRadius: 8 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: REDWOOD.surfaceSecondary, fontWeight: 'bold' }}>
                <SummaryCell index={0} colSpan={segmentColCount} style={{ background: REDWOOD.surfaceSecondary }}>
                  <Text strong>TOTAL</Text>
                </SummaryCell>
                <SummaryCell index={segmentColCount} align="right" style={{ textAlign: 'right', background: REDWOOD.surfaceSecondary }}>
                  <Text strong style={{ fontFamily: 'monospace' }}>
                    {formatCurrency(totals.opening)}
                  </Text>
                </SummaryCell>
                <SummaryCell index={segmentColCount + 1} align="right" style={{ textAlign: 'right', background: REDWOOD.surfaceSecondary }}>
                  <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info }}>
                    {formatCurrency(totals.debit)}
                  </Text>
                </SummaryCell>
                <SummaryCell index={segmentColCount + 2} align="right" style={{ textAlign: 'right', background: REDWOOD.surfaceSecondary }}>
                  <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.success }}>
                    {formatCurrency(totals.credit)}
                  </Text>
                </SummaryCell>
                <SummaryCell index={segmentColCount + 3} align="right" style={{ textAlign: 'right', background: REDWOOD.surfaceSecondary }}>
                  <Text strong style={{ fontFamily: 'monospace' }}>
                    {formatCurrency(totals.closing)}
                  </Text>
                </SummaryCell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    );
  };

  // ── Lines Summary Tab ─────────────────────────────────────
  const renderLinesSummaryTab = () => {
    const fmtN = (n: number) =>
      n === 0 ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Distinct values for filter dropdowns
    const companies  = [...new Set(lsData.map(r => r.seg1_company).filter(Boolean) as string[])].sort();
    const ledgers    = [...new Set(lsData.map(r => r.ledger_name).filter(Boolean)  as string[])].sort();
    const currencies = [...new Set(lsData.map(r => r.currency).filter(Boolean)     as string[])].sort();

    // Client-side filter
    const visibleData = lsData.filter(r => {
      if (lsLedger   && (r.ledger_name || '').trim().toLowerCase() !== lsLedger.trim().toLowerCase()) return false;
      if (lsCurrency && (r.currency    || '').toUpperCase() !== lsCurrency.toUpperCase()) return false;
      if (lsSearch) {
        const q = lsSearch.toLowerCase();
        if (!(r.seg4_account || '').toLowerCase().includes(q) &&
            !(r.seg1_company || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // Pull account descriptions from the open TB tab for this period
    const tbDataForPeriod = tabs.find(t => t.periodName === lsPeriod)?.data || [];
    const tbDescMap = new Map<string, string>();
    for (const rec of tbDataForPeriod) {
      const k = `${(rec.company||'').trim()}|${(rec.account||'').trim()}`;
      if (!tbDescMap.has(k) && rec.account_desc) tbDescMap.set(k, rec.account_desc);
    }

    // When no currency selected (All): aggregate ACCOUNTED DR/CR per company+account+ledger
    // When specific currency selected: filter rows to that currency, then show as-is
    let displayData: any[];
    if (!lsCurrency) {
      const aggMap = new Map<string, any>();
      for (const r of visibleData) {
        const key = `${r.seg1_company}|${r.seg4_account}|${r.ledger_name}`;
        if (!aggMap.has(key)) {
          aggMap.set(key, {
            rowKey: key,
            seg1_company: r.seg1_company,
            seg4_account: r.seg4_account,
            ledger_name:  r.ledger_name,
            period_name:  r.period_name,
            account_desc: tbDescMap.get(`${(r.seg1_company||'').trim()}|${(r.seg4_account||'').trim()}`) || '',
            total_dr: 0, total_cr: 0, net_amount: 0, line_count: 0,
          });
        }
        const row = aggMap.get(key)!;
        row.total_dr   += r.total_dr;
        row.total_cr   += r.total_cr;
        row.net_amount += r.net_amount;
        row.line_count += r.line_count;
      }
      displayData = [...aggMap.values()];
    } else {
      displayData = visibleData.map(r => ({
        ...r,
        rowKey: `${r.seg1_company}|${r.seg4_account}|${r.ledger_name}|${r.currency}`,
        account_desc: tbDescMap.get(`${(r.seg1_company||'').trim()}|${(r.seg4_account||'').trim()}`) || '',
      }));
    }

    // KPI totals (always from displayData)
    const totalDr    = displayData.reduce((s: number, r: any) => s + (r.total_dr   || 0), 0);
    const totalCr    = displayData.reduce((s: number, r: any) => s + (r.total_cr   || 0), 0);
    const totalNet   = displayData.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
    const totalLines = displayData.reduce((s: number, r: any) => s + (r.line_count || 0), 0);

    // Open detail popup for a row
    const openDetail = (r: any) => {
      const tbRecs = tbDataForPeriod.filter(t =>
        (t.company || '').trim() === (r.seg1_company || '').trim() &&
        (t.account || '').trim() === (r.seg4_account || '').trim()
      );
      setLsDetailRow({
        account: r.seg4_account || '', company: r.seg1_company || '',
        ledger: r.ledger_name || null,
        accountDesc: r.account_desc || tbDescMap.get(`${(r.seg1_company||'').trim()}|${(r.seg4_account||'').trim()}`) || '',
        combinations: [],
        lsDr: r.total_dr, lsCr: r.total_cr, lsNet: r.net_amount, lsLines: r.line_count,
        tbRecords: tbRecs,
      });
    };

    // Shared columns
    const numCol = (title: React.ReactNode, key: string, color: string) => ({
      title,
      dataIndex: key,
      key,
      align: 'right' as const,
      width: 130,
      sorter: (a: any, b: any) => (a[key] || 0) - (b[key] || 0),
      render: (v: number) => (
        <Text style={{ fontFamily: 'monospace', fontSize: 12, color: v !== 0 ? color : REDWOOD.textSecondary }}>
          {fmtN(v)}
        </Text>
      ),
    });

    const reconCol = lsReconDone ? [{
      title: <Tooltip title="Click to view TB detail"><CheckCircleOutlined style={{ color: REDWOOD.success }} /> Recon</Tooltip>,
      key: 'recon', width: 72, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: any) => {
        const mapKey = `${(r.seg1_company||'').trim()}|${(r.seg4_account||'').trim()}|${(r.ledger_name||'').trim()}`;
        const res = lsReconMap.get(mapKey);
        const icon = !res
          ? <Tag color="orange" style={{ fontSize: 10, cursor: 'pointer' }}>No TB</Tag>
          : res.matched
            ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16, cursor: 'pointer' }} />
            : <CloseCircleOutlined style={{ color: REDWOOD.primary,  fontSize: 16, cursor: 'pointer' }} />;
        return <span onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>{icon}</span>;
      },
    }] : [];

    const columns = [
      { title: 'Co.', dataIndex: 'seg1_company', key: 'seg1_company', width: 55,
        render: (v: string) => <Tag style={{ fontSize: 11 }}>{v || '—'}</Tag>,
        filters: companies.map(c => ({ text: c, value: c })),
        onFilter: (val: any, r: any) => r.seg1_company === val },
      { title: 'Account', dataIndex: 'seg4_account', key: 'seg4_account', width: 100,
        sorter: (a: any, b: any) => (a.seg4_account||'').localeCompare(b.seg4_account||''),
        render: (v: string, r: any) => (
          <span style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
            <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>
          </span>
        ) },
      { title: 'Description', dataIndex: 'account_desc', key: 'account_desc', ellipsis: true,
        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || <Text type="secondary">—</Text>}</Text> },
      { title: 'Ledger', dataIndex: 'ledger_name', key: 'ledger_name', width: 130, ellipsis: true,
        filters: ledgers.map(l => ({ text: l, value: l })),
        onFilter: (val: any, r: any) => r.ledger_name === val,
        render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v||'—'}</Text> },
      numCol(<span style={{ color: REDWOOD.info }}>Total DR</span>,   'total_dr',   REDWOOD.info),
      numCol(<span style={{ color: REDWOOD.primary }}>Total CR</span>, 'total_cr',   REDWOOD.primary),
      numCol('Net (Dr−Cr)', 'net_amount', ''),
      { title: 'Lines', dataIndex: 'line_count', key: 'line_count', align: 'right' as const, width: 60,
        render: (v: number) => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> },
      ...reconCol,
    ];

    return (
      <div>
        {/* Parameter bar */}
        <Card size="small" style={{ marginBottom: 12, borderColor: REDWOOD.border }} bodyStyle={{ padding: '10px 16px' }}>
          <Row gutter={10} align="middle" wrap>
            <Col>
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>Period</Text>
              <Select
                style={{ width: 130 }} size="small" placeholder="Select period"
                value={lsPeriod ?? undefined}
                onChange={v => setLsPeriod(v)}
                showSearch
              >
                {filteredPeriods.map(p => (
                  <Select.Option key={p.period_name_id} value={p.period_name_id}>{p.period_name_id}</Select.Option>
                ))}
              </Select>
            </Col>
            <Col>
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>
                Company (Seg 1)
                <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>type or select</Text>
              </Text>
              <AutoComplete
                style={{ width: 140 }}
                size="small"
                placeholder="All  /  type code"
                value={lsCompany ?? undefined}
                onChange={v => setLsCompany(v || null)}
                allowClear
                options={companies.map(c => ({ value: c, label: c }))}
                filterOption={(input, opt) =>
                  (opt?.value as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />
            </Col>
            {ledgers.length > 0 && (
              <Col>
                <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>
                  Ledger
                </Text>
                <Select
                  style={{ minWidth: 160 }}
                  size="small"
                  placeholder="All ledgers"
                  value={lsLedger ?? undefined}
                  onChange={v => setLsLedger(v || null)}
                  allowClear
                  showSearch
                >
                  {ledgers.map(l => (
                    <Select.Option key={l} value={l}>{l}</Select.Option>
                  ))}
                </Select>
              </Col>
            )}
            {currencies.length > 0 && (
              <Col>
                <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>Currency</Text>
                <Select
                  style={{ width: 90 }} size="small" placeholder="All"
                  value={lsCurrency ?? undefined}
                  onChange={v => setLsCurrency(v || null)}
                  allowClear showSearch
                >
                  {currencies.map(c => (
                    <Select.Option key={c} value={c}>{c}</Select.Option>
                  ))}
                </Select>
              </Col>
            )}
            <Col style={{ marginTop: 18 }}>
              <Button
                type="primary" size="small" icon={<BarChartOutlined />}
                loading={lsLoading}
                onClick={() => fetchLinesSummary(lsPeriod, lsCompany)}
                disabled={!lsPeriod}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primaryDark }}
              >
                Fetch
              </Button>
            </Col>
            {lsData.length > 0 && (
              <Col style={{ marginTop: 18 }}>
                <Tooltip title="Compare Lines Summary PTD DR/CR against GL Trial Balance for the same period">
                  <Button
                    size="small"
                    icon={<CheckCircleOutlined />}
                    onClick={handleReconcile}
                    style={{
                      color: lsReconDone ? REDWOOD.success : REDWOOD.primary,
                      borderColor: lsReconDone ? REDWOOD.success : REDWOOD.primary,
                    }}
                  >
                    Reconcile TB
                  </Button>
                </Tooltip>
              </Col>
            )}
            {lsData.length > 0 && (
              <Col style={{ marginTop: 18 }}>
                <Button
                  size="small" icon={<FileExcelOutlined />}
                  style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                  onClick={() => {
                    if (!visibleData.length) return;
                    const rows = displayData.map((r: any) => ({
                      'Company':  r.seg1_company,
                      'Account':  r.seg4_account,
                      'Description': r.account_desc || '',
                      'Ledger':   r.ledger_name,
                      'Currency': r.currency,
                      'Period':   r.period_name,
                      'PTD DR':   r.total_dr,
                      'PTD CR':   r.total_cr,
                      'Net':      r.net_amount,
                      'Lines':    r.line_count,
                    }));
                    const ws = XLSX.utils.json_to_sheet(rows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Lines Summary');
                    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
                      `LinesSummary_${lsPeriod || 'All'}.xlsx`);
                  }}
                >
                  Excel
                </Button>
              </Col>
            )}
          </Row>
          {/* API URL row — always visible once a period is chosen */}
          {(lsPeriod || lsApiUrl) && (
            <Row style={{ marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8 }} align="middle" gutter={8}>
              <Col flex="none">
                <Tag color="green" style={{ fontFamily: 'monospace', fontSize: 10 }}>GET</Tag>
              </Col>
              <Col flex="auto">
                <Input
                  size="small"
                  readOnly
                  value={lsApiUrl || (() => {
                    const p = new URLSearchParams({ period_name: lsPeriod || '', limit: '5000' });
                    if (lsCompany) p.set('company', lsCompany);
                    return `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.glLinesSummary}?${p}`;
                  })()}
                  style={{ fontFamily: 'monospace', fontSize: 10, color: REDWOOD.textSecondary, background: '#fafafa' }}
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
              </Col>
              <Col flex="none">
                <Button
                  size="small"
                  type="text"
                  style={{ fontSize: 10, color: REDWOOD.info }}
                  onClick={() => {
                    const url = lsApiUrl || (() => {
                      const p = new URLSearchParams({ period_name: lsPeriod || '', limit: '5000' });
                      if (lsCompany) p.set('company', lsCompany);
                      return `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.glLinesSummary}?${p}`;
                    })();
                    navigator.clipboard?.writeText(url).then(() => message.success('URL copied'));
                  }}
                >
                  Copy
                </Button>
              </Col>
            </Row>
          )}
        </Card>

        {/* Error */}
        {lsError && <Alert type="error" message={lsError} style={{ marginBottom: 12 }} />}

        {/* KPI row */}
        {lsData.length > 0 && (
          <Row gutter={10} style={{ marginBottom: 12 }}>
            {[
              { label: 'Accounts',   value: visibleData.length,                 isCcy: false, color: REDWOOD.neutral },
              { label: 'Line Count', value: totalLines,                          isCcy: false, color: REDWOOD.neutral },
              { label: 'Total DR',   value: totalDr,                            isCcy: true,  color: REDWOOD.info        },
              { label: 'Total CR',   value: totalCr,                            isCcy: true,  color: REDWOOD.primary     },
              { label: 'Net (Dr−Cr)',value: totalNet, isCcy: true,
                color: totalNet > 0 ? REDWOOD.info : totalNet < 0 ? REDWOOD.primary : REDWOOD.neutral },
            ].map(k => (
              <Col key={k.label}>
                <Card size="small" bodyStyle={{ padding: '8px 14px', textAlign: 'center' }}
                  style={{ minWidth: 120, borderColor: REDWOOD.border }}>
                  <div style={{ fontSize: 10, color: REDWOOD.textSecondary }}>{k.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: k.color }}>
                    {k.isCcy
                      ? (k.value as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : (k.value as number).toLocaleString()}
                  </div>
                </Card>
              </Col>
            ))}
            <Col flex="auto" style={{ display: 'flex', alignItems: 'center' }}>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.textSecondary }} />}
                placeholder="Search account, combination…"
                size="small" allowClear
                style={{ maxWidth: 280 }}
                value={lsSearch}
                onChange={e => setLsSearch(e.target.value)}
              />
            </Col>
          </Row>
        )}

        {/* Table */}
        <Table
          columns={columns}
          dataSource={displayData}
          rowKey={(r: any) => r.rowKey || `${r.seg1_company}|${r.seg4_account}|${r.ledger_name}|${r.currency}`}
          size="small"
          loading={lsLoading}
          scroll={{ x: 1000 }}
          sticky
          pagination={{ pageSize: 100, showSizeChanger: true, pageSizeOptions: ['50','100','250'],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}` }}
          locale={{ emptyText: lsLoading ? <Spin /> : <Empty description={lsPeriod ? 'Click Fetch to load' : 'Select a period'} /> }}
          summary={() =>
            displayData.length > 0 ? (
              <Table.Summary.Row style={{ background: REDWOOD.surfaceSecondary }}>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <Text strong style={{ fontSize: 11 }}>TOTAL ({displayData.length} rows)</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}>
                    {totalDr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>
                    {totalCr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <Text strong style={{ fontFamily: 'monospace', fontSize: 11,
                    color: totalNet > 0 ? REDWOOD.info : totalNet < 0 ? REDWOOD.primary : REDWOOD.textSecondary }}>
                    {totalNet === 0 ? '—' : (totalNet > 0 ? '+' : '') + totalNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <Text strong style={{ fontSize: 11 }}>{totalLines.toLocaleString()}</Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />

        {/* Account Detail Modal */}
        <Modal
          open={!!lsDetailRow}
          onCancel={() => { setLsDetailRow(null); setLsDetailCcy(null); }}
          footer={[
            <Button key="tb" type="primary"
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primaryDark }}
              onClick={() => {
                setLsDetailRow(null);
                const tbTab = tabs.find(t => t.periodName === lsPeriod);
                if (tbTab) { setActiveTab(tbTab.key); }
                else message.warning(`Open the GL Trial Balance tab for ${lsPeriod} first`);
              }}
            >
              Go to TB Tab — {lsPeriod}
            </Button>,
            <Button key="close" onClick={() => setLsDetailRow(null)}>Close</Button>,
          ]}
          width={760}
          title={
            <span>
              <BarsOutlined style={{ marginRight: 8, color: REDWOOD.primary }} />
              Account {lsDetailRow?.account}
              {lsDetailRow?.accountDesc && <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>{lsDetailRow.accountDesc}</Text>}
              <Tag style={{ marginLeft: 8 }} color="blue">{lsPeriod}</Tag>
            </span>
          }
        >
          {lsDetailRow && (() => {
            const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            // All currencies available in both sources
            const tbCcys = [...new Set(lsDetailRow.tbRecords.map(r => r.currency || r.currency_code).filter(Boolean) as string[])].sort();
            const lsAllRows = lsData.filter(r =>
              (r.seg1_company || '').trim() === lsDetailRow.company.trim() &&
              (r.seg4_account  || '').trim() === lsDetailRow.account.trim() &&
              (!lsDetailRow.ledger || (r.ledger_name || '') === lsDetailRow.ledger)
            );
            const lsCcys = [...new Set(lsAllRows.map(r => r.currency).filter(Boolean) as string[])].sort();
            const allCcys = [...new Set([...tbCcys, ...lsCcys])].sort();

            // Apply currency filter
            const filteredTb = lsDetailCcy
              ? lsDetailRow.tbRecords.filter(r => (r.currency || r.currency_code || '').toUpperCase() === lsDetailCcy.toUpperCase())
              : lsDetailRow.tbRecords;
            const filteredLs = lsDetailCcy
              ? lsAllRows.filter(r => (r.currency || '').toUpperCase() === lsDetailCcy.toUpperCase())
              : lsAllRows;

            // Totals — compare only PTD Debit vs PTD Credit (not balances)
            const tbDr = filteredTb.reduce((s, r) => s + (r.debit  || 0), 0);
            const tbCr = filteredTb.reduce((s, r) => s + (r.credit || 0), 0);
            const lsDr = filteredLs.reduce((s, r) => s + r.total_dr, 0);
            const lsCr = filteredLs.reduce((s, r) => s + r.total_cr, 0);
            const varDr = lsDr - tbDr;
            const varCr = lsCr - tbCr;

            return (
              <div>
                {/* Header: account info + currency filter */}
                <Row align="middle" justify="space-between" style={{ marginBottom: 12 }}>
                  <Col>
                    <Descriptions size="small" column={3} bordered>
                      <Descriptions.Item label="Company">{lsDetailRow.company}</Descriptions.Item>
                      <Descriptions.Item label="Account">{lsDetailRow.account}</Descriptions.Item>
                      <Descriptions.Item label="Ledger">{lsDetailRow.ledger || '—'}</Descriptions.Item>
                    </Descriptions>
                  </Col>
                  {allCcys.length > 0 && (
                    <Col style={{ marginLeft: 16 }}>
                      <Text style={{ fontSize: 11, marginRight: 8 }} type="secondary">Currency:</Text>
                      <Select size="small" style={{ width: 100 }} allowClear placeholder="All"
                        value={lsDetailCcy ?? undefined} onChange={v => setLsDetailCcy(v || null)}>
                        {allCcys.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                      </Select>
                    </Col>
                  )}
                </Row>

                {/* Comparison table — PTD DR/CR only */}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: REDWOOD.surfaceSecondary }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Source</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', color: REDWOOD.info, fontWeight: 600 }}>PTD Debit (DR)</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', color: REDWOOD.primary, fontWeight: 600 }}>PTD Credit (CR)</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Net (Dr−Cr)</th>
                      <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600 }}>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '6px 10px' }}><Text strong>Lines Summary</Text></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: REDWOOD.info }}>{fmt(lsDr)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(lsCr)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(lsDr - lsCr)}</td>
                      <td />
                    </tr>
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '6px 10px' }}><Text strong>GL Trial Balance</Text></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: REDWOOD.info }}>{fmt(tbDr)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(tbCr)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(tbDr - tbCr)}</td>
                      <td />
                    </tr>
                    <tr style={{ background: Math.abs(varDr) < 0.01 && Math.abs(varCr) < 0.01 ? '#f6ffed' : '#fff2f0' }}>
                      <td style={{ padding: '6px 10px' }}><Text strong>Variance</Text></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace',
                        color: Math.abs(varDr) < 0.01 ? REDWOOD.success : '#f5222d', fontWeight: 700 }}>{fmt(varDr)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace',
                        color: Math.abs(varCr) < 0.01 ? REDWOOD.success : '#f5222d', fontWeight: 700 }}>{fmt(varCr)}</td>
                      <td />
                      <td style={{ textAlign: 'center', fontSize: 18 }}>
                        {Math.abs(varDr) < 0.01 && Math.abs(varCr) < 0.01
                          ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                          : <CloseCircleOutlined style={{ color: '#f5222d' }} />}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Lines Summary breakdown */}
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  Lines Summary — {filteredLs.length} row(s)
                  {lsDetailRow.combinations.length > 1 &&
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                      ({lsDetailRow.combinations.length} combinations)
                    </Text>}
                </Text>
                <Table
                  size="small"
                  dataSource={filteredLs}
                  rowKey={(r: LineSummaryRow) => `${r.seg4_account}|${r.ledger_name}|${r.currency}`}
                  pagination={false}
                  style={{ marginBottom: 16 }}
                  columns={[
                    { title: 'Ledger', dataIndex: 'ledger_name', width: 140, ellipsis: true,
                      render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v || '—'}</Text> },
                    { title: 'CCY', dataIndex: 'currency', width: 55,
                      render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
                    { title: 'PTD DR', dataIndex: 'total_dr', align: 'right' as const, width: 120,
                      render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}>{fmt(v)}</Text> },
                    { title: 'PTD CR', dataIndex: 'total_cr', align: 'right' as const, width: 120,
                      render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmt(v)}</Text> },
                    { title: 'Net', dataIndex: 'net_amount', align: 'right' as const, width: 110,
                      render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(v)}</Text> },
                    { title: 'Lines', dataIndex: 'line_count', align: 'right' as const, width: 55,
                      render: (v: number) => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> },
                  ]}
                />

                {/* GL Trial Balance breakdown */}
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  GL Trial Balance — {filteredTb.length} row(s)
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>(PTD Debit / Credit only)</Text>
                </Text>
                {filteredTb.length > 0 ? (
                  <Table
                    size="small"
                    dataSource={filteredTb}
                    rowKey={(r: GLBalanceRecord) => `${r.period_name}|${r.currency}|${r.account_type}`}
                    pagination={false}
                    columns={[
                      { title: 'Period',   dataIndex: 'period_name',  width: 90 },
                      { title: 'CCY', dataIndex: 'currency', width: 55,
                        render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
                      { title: 'Type', dataIndex: 'account_type', width: 50 },
                      { title: 'PTD Debit', dataIndex: 'debit', align: 'right' as const, width: 120,
                        render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}>{fmt(v || 0)}</Text> },
                      { title: 'PTD Credit', dataIndex: 'credit', align: 'right' as const, width: 120,
                        render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmt(v || 0)}</Text> },
                      { title: 'Opening', dataIndex: 'opening_balance', align: 'right' as const, width: 120,
                        render: (v: number) => <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(v || 0)}</Text> },
                      { title: 'Closing', dataIndex: 'closing_balance', align: 'right' as const, width: 120,
                        render: (v: number) => <Text strong style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(v || 0)}</Text> },
                    ]}
                  />
                ) : (
                  <Alert type="warning" message="No GL Trial Balance records found. Open the TB tab for this period first." />
                )}
              </div>
            );
          })()}
        </Modal>
      </div>
    );
  };

  // Render a ReERP TB tab — Standard format: Opening / Debit / Credit / Closing (net)
  // ── Open revaluation modal ───────────────────────────────────
  const openRevalModal = async (tabKey: string, accountKey: string) => {
    const tab = tabs.find(t => t.key === tabKey);
    setRevalTabKey(tabKey);
    setRevalAccount(accountKey);
    setRevalRates({});
    setRevalGainCombo('');
    setRevalLossCombo('');
    setRevalPreviewRows([]);
    setRevalId(null);
    setRevalStatus(null);
    setRevalExcludedCombos(new Set());

    // Set rate date to last day of the selected period's month
    if (tab?.periodName) {
      const periodStr = cleanPeriodName(tab.periodName);
      const parsed = dayjs(periodStr, ['MMM-YYYY', 'MMM-YY', 'MMMM-YYYY', 'MMM YYYY']);
      setRevalRateDate(parsed.isValid() ? parsed.endOf('month').format('YYYY-MM-DD') : dayjs().endOf('month').format('YYYY-MM-DD'));
    } else {
      setRevalRateDate(dayjs().endOf('month').format('YYYY-MM-DD'));
    }

    setRevalVisible(true);

    // Look up existing revaluation for this account + ledger + period
    setRevalChecking(true);
    try {
      const res  = await fetch(`${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.revaluation}`);
      const json = await res.json();
      const rawPeriod = cleanPeriodName(tab?.periodName ?? '');
      const existing  = (json.items || []).find((r: any) =>
        r.account    === accountKey &&
        r.ledgerName === tab?.ledgerName &&
        (r.periodName === rawPeriod || r.periodName === tab?.periodName)
      );
      if (existing) {
        setRevalId(existing.revalueId);
        setRevalGainCombo(existing.gainAccount || '');
        setRevalLossCombo(existing.lossAccount || '');
        setRevalStatus(existing.status || 'DRAFT');

        // Fetch full detail to restore saved new rates per currency
        try {
          const detRes  = await fetch(`${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.revaluation}/${existing.revalueId}`);
          const detJson = await detRes.json();
          if (Array.isArray(detJson.ccyRows) && detJson.ccyRows.length > 0) {
            const rates: Record<string, string> = {};
            detJson.ccyRows.forEach((c: any) => {
              if (c.currencyCode && c.newRate != null) rates[c.currencyCode] = String(c.newRate);
            });
            setRevalRates(rates);
          }
        } catch { /* ignore — rates stay blank */ }

        if (existing.status === 'ACCOUNTED') {
          message.warning({ content: `Revaluation ID: ${existing.revalueId} is already posted — view only`, key: 'reval-check', duration: 4 });
        } else {
          message.info({ content: `Existing revaluation found (ID: ${existing.revalueId}) — editing`, key: 'reval-check', duration: 3 });
        }
      }
    } catch {
      // ignore — proceed as new
    } finally {
      setRevalChecking(false);
    }
  };

  // ── Create Accounting from TB revaluation popup ────────────────
  const handleCreateAccountingFromTB = async () => {
    if (!revalId) return;
    const id = revalId;

    const initSteps: { title: string; status: 'wait'|'process'|'finish'|'error'; desc?: string }[] = [
      { title: 'Load Detail',      status: 'wait' },
      { title: 'Check SLA',        status: 'wait' },
      { title: 'Write SLA',        status: 'wait' },
      { title: 'Post to GL',       status: 'wait' },
      { title: 'Mark Accounted',   status: 'wait' },
    ];
    setAcctFlowSteps(initSteps);
    setAcctFlowDone(false);
    setAcctFlowError(null);
    setAcctFlowLastCall(null);
    setPostFlowLastCall(null);
    setAcctFlowVisible(true);
    setAcctFlowLoading(true);

    const updateStep = (idx: number, status: 'wait'|'process'|'finish'|'error', desc?: string) => {
      setAcctFlowSteps(prev => prev.map((s, i) => i === idx ? { ...s, status, desc: desc ?? s.desc } : s));
    };

    try {
      // Step 0 — Load revaluation detail
      updateStep(0, 'process');
      const res  = await fetch(`${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.revaluation}/${id}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('Empty response from API');
      const r = JSON.parse(text);

      const d = {
        revalueId:     r.revalueId     ?? r.revalue_id,
        ledgerId:      r.ledgerId      ?? r.ledger_id ?? null,
        ledgerName:    r.ledgerName    ?? r.ledger_name ?? '',
        periodName:    r.periodName    ?? r.period_name ?? '',
        account:       r.account       ?? '',
        accountDesc:   r.accountDesc   ?? r.account_desc ?? '',
        functionalCcy: r.baseCurrency  ?? r.base_currency  ?? r.functionalCcy ?? r.functional_ccy ?? '',
        gainAccount:   r.gainAccount   ?? r.gain_account ?? '',
        lossAccount:   r.lossAccount   ?? r.loss_account ?? '',
        status:        r.status        ?? 'DRAFT',
        glBatchId:     r.glBatchId     ?? r.gl_batch_id ?? null,
        glBatchName:   r.glBatchName   ?? r.gl_batch_name ?? null,
        ccyRows: (r.ccyRows || r.ccy_rows || []).map((c: any) => ({
          ccyId:        c.ccyId        ?? c.ccy_id,
          currencyCode: c.currencyCode ?? c.currency_code ?? '',
          entClosing:   Number(c.entClosing  ?? c.ent_closing  ?? 0),
          acctClosing:  Number(c.acctClosing ?? c.acct_closing ?? 0),
          bookRate:     Number(c.bookRate    ?? c.book_rate    ?? 0),
          newRate:      Number(c.newRate     ?? c.new_rate     ?? 0),
          newAcctValue: Number(c.newAcctValue ?? c.new_acct_value ?? 0),
          revalAmt:     Number(c.revalAmt    ?? c.reval_amt    ?? 0),
          isGain:       Number(c.isGain      ?? c.is_gain      ?? 0),
        })),
        lines: (r.lines || []).map((l: any) => ({
          lineId:      l.lineId      ?? l.line_id,
          lineNum:     l.lineNum     ?? l.line_num,
          combo:       l.combo       ?? '',
          description: l.description ?? '',
          drAmount:    Number(l.drAmount ?? l.dr_amount ?? 0),
          crAmount:    Number(l.crAmount ?? l.cr_amount ?? 0),
        })),
      };

      if (!d.lines || d.lines.length === 0)
        throw new Error('No journal lines found on this revaluation');
      updateStep(0, 'finish', `${d.lines.length} lines loaded`);

      // Step 1 — Check SLA
      updateStep(1, 'process');
      const existsRes = await checkAccountingExists('RR_REVALUE_HEADER', id, 'GL_REVALUATION');
      if (existsRes.exists && existsRes.accountingStatus === 'POSTED') {
        updateStep(1, 'error', `Already posted (SLA header ${existsRes.headerId})`);
        throw new Error('SLA accounting already posted for this revaluation');
      }
      updateStep(1, 'finish', existsRes.exists
        ? `Existing DRAFT found (header ${existsRes.headerId}) — will replace`
        : 'No existing SLA entry — creating new');

      // Step 2 — Write SLA
      updateStep(2, 'process');
      // Strip YTD/ReERP prefix AND ledger suffix ("· BUIMERC") from period name
      const periodName = d.periodName
        .replace(/^(?:ReERP|Dynamic|YTD):\s*/, '')
        .replace(/\s*·.*$/, '')
        .trim();
      // Safety: functionalCcy in DB might have been saved as a foreign currency (e.g. INR) from
      // an older code version. Exclude it if it matches one of the ccyRow foreign currencies.
      const foreignCcys = new Set(d.ccyRows.map((c: any) => c.currencyCode).filter(Boolean));
      const currency   = (d.functionalCcy && !foreignCcys.has(d.functionalCcy)) ? d.functionalCcy : 'AED';
      const createdBy  = user?.username || 'SYSTEM';

      const MONTHS: Record<string, number> = {
        Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
        Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
      };
      const [mon, yr] = periodName.split('-');
      const periodLastDay = (mon && yr && MONTHS[mon] !== undefined)
        ? (() => { const year = 2000 + parseInt(yr, 10); return new Date(year, MONTHS[mon] + 1, 0).toISOString().split('T')[0]; })()
        : new Date().toISOString().split('T')[0];

      const slaPayload: SlaCreatePayload = {
        header: {
          moduleName:       'GL',
          sourceTable:      'RR_REVALUE_HEADER',
          sourceId:         id,
          sourceNumber:     `REVAL-${id}`,
          sourceType:       'Revaluation',
          eventTypeCode:    'GL_REVALUATION',
          eventDate:        periodLastDay,
          accountingDate:   periodLastDay,
          periodName,
          ledgerId:         d.ledgerId   || 0,
          ledgerName:       d.ledgerName || '',
          currencyCode:     currency,
          ledgerCurrency:   currency,
          exchangeRate:     1,
          exchangeRateType: 'User',
          description:      `${d.accountDesc || d.account} Revaluation for ${periodName}`,
          createdBy,
        },
        lines: d.lines.map((l: any, idx: number) => {
          const dr = Math.round((l.drAmount || 0) * 100) / 100;
          const cr = Math.round((l.crAmount || 0) * 100) / 100;
          return {
            lineNumber:         l.lineNum || idx + 1,
            lineType:           dr > 0 ? 'DR' : 'CR',
            accountingClass:    'Revaluation',
            accountCombination: l.combo,
            enteredDr:          dr,
            enteredCr:          cr,
            accountedDr:        dr,
            accountedCr:        cr,
            currencyCode:       currency,
            exchangeRate:       1,
            description:        `${d.accountDesc || d.account} Revaluation for ${periodName}`,
            sourceLineId:       l.lineId || idx + 1,
            sourceLineNumber:   l.lineNum || idx + 1,
          };
        }),
      };

      setAcctFlowLastCall({ url: `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.slaAccountingCreate}`, method: 'POST', body: slaPayload });
      const slaResult = await createAccounting(slaPayload);
      updateStep(2, 'finish', `SLA header ${slaResult.headerId} created — ${slaResult.lineCount} lines`);

      // Step 3 — Post to GL
      // Oracle Fusion revaluation: one journal per foreign currency.
      // Journal currency = foreign ccy (e.g. INR), entered = 0, accounted = AED amounts.
      updateStep(3, 'process');
      const journalDesc   = `${d.accountDesc || d.account} Revaluation for ${periodName}`;
      const activeCcyRows = d.ccyRows.filter((c: any) => c.revalAmt !== 0 && c.newRate !== 0);
      const acctLabel     = d.accountDesc || d.account;

      const glResults: { success: boolean; skipped: boolean; batchName: string; batchId: number | null; headerId: number | null; error?: string }[] = [];

      for (let idx = 0; idx < activeCcyRows.length; idx++) {
        const ccyRow = activeCcyRows[idx];
        const l1 = d.lines[idx * 2];
        const l2 = d.lines[idx * 2 + 1];
        if (!l1 || !l2) continue;

        const fCcy    = ccyRow.currencyCode || currency;
        const newRate = ccyRow.newRate || 1;
        const lineDesc = `${acctLabel} Revaluation for ${periodName}`;
        const l1Desc  = lineDesc;
        const l2Desc  = lineDesc;

        const r = await postSlaToGL({
          slaHeaderId:        slaResult.headerId,
          sourceNumber:       `REVAL-${id}-${fCcy}`,
          sourceId:           id,
          eventTypeCode:      'GL_REVALUATION',
          periodName,
          ledgerName:         d.ledgerName || '',
          ledgerId:           d.ledgerId   || 0,
          currency:           fCcy,        // foreign currency (e.g. INR)
          conversionRate:     newRate,      // new revaluation rate
          accountingDate:     periodLastDay,
          legalEntity:        '',
          businessUnit:       '',
          jeCategory:         'Revaluation',
          jeSource:           'General Ledger',
          batchSource:        'General Ledger',
          batchDescription:   journalDesc,
          journalDescription: journalDesc,
          journalName:        `FX REVAL – ${d.account} – ${fCcy} – ${periodName}`,
          createdBy,
          forceCreate:        true,
          lines: [
            {
              lineType:           l1.drAmount > 0 ? 'DR' as const : 'CR' as const,
              enteredDr:          0,
              enteredCr:          0,
              accountedDr:        l1.drAmount > 0 ? l1.drAmount : null,
              accountedCr:        l1.crAmount > 0 ? l1.crAmount : null,
              description:        l1Desc,
              currencyCode:       fCcy,
              accountingDate:     periodLastDay,
              accountCombination: l1.combo,
              accountingClass:    'Revaluation',
              legalEntity:        null,
            },
            {
              lineType:           l2.drAmount > 0 ? 'DR' as const : 'CR' as const,
              enteredDr:          0,
              enteredCr:          0,
              accountedDr:        l2.drAmount > 0 ? l2.drAmount : null,
              accountedCr:        l2.crAmount > 0 ? l2.crAmount : null,
              description:        l2Desc,
              currencyCode:       fCcy,
              accountingDate:     periodLastDay,
              accountCombination: l2.combo,
              accountingClass:    'Revaluation',
              legalEntity:        null,
            },
          ],
        });
        glResults.push(r);
        if (r.postPayload) {
          setPostFlowLastCall({ url: r.postPayload.url, method: 'POST', body: r.postPayload.body });
        }
        if (!r.success) {
          updateStep(3, 'error', `${fCcy}: ${r.error || 'GL posting failed'}`);
          throw new Error(`${fCcy}: ${r.error || 'GL posting failed'}`);
        }
      }

      if (glResults.length === 0) {
        updateStep(3, 'error', 'No active CCY rows to post');
        throw new Error('No active CCY rows to post');
      }
      const lastResult = glResults[glResults.length - 1];
      updateStep(3, 'finish',
        `Posted ${glResults.length} GL batch(es): ${glResults.map(r => r.batchName).join(', ')}`);

      // Step 4 — Mark ACCOUNTED
      updateStep(4, 'process');
      const statusUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.revaluation}/${id}/accounting`;
      const putRes = await fetch(statusUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:        'ACCOUNTED',
          gl_batch_id:   lastResult.batchId   || 0,
          gl_batch_name: lastResult.batchName,
          gl_header_id:  lastResult.headerId  || 0,
        }),
      });
      const putText = await putRes.text();
      let putData: any = {};
      try { putData = JSON.parse(putText); } catch { /* non-JSON */ }

      if (!putRes.ok || putData.status === 'ERROR') {
        updateStep(4, 'error', `HTTP ${putRes.status}${putData.error ? ` — ${putData.error}` : ''}`);
        throw new Error(putData.error || `Status update failed (HTTP ${putRes.status})`);
      }
      updateStep(4, 'finish', 'Status set to ACCOUNTED');
      setAcctFlowDone(true);
      setRevalStatus('ACCOUNTED');
      message.success(`Revaluation #${id} accounted — GL Batch: ${lastResult.batchName}`);
    } catch (e) {
      setAcctFlowError(e instanceof Error ? e.message : String(e));
      message.error('Accounting failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAcctFlowLoading(false);
    }
  };

  // ── BMS rate fetch for revaluation ───────────────────────────
  const fetchRevalBmsRate = useCallback(async (currencies: string[]) => {
    const dateParam = revalRateDate ? `&rate_date=${encodeURIComponent(revalRateDate)}` : '';
    for (const ccy of currencies) {
      if (!ccy || ccy === 'AED') continue;
      setRevalBmsFetching(prev => ({ ...prev, [ccy]: true }));
      try {
        const res  = await fetch(`${APEX_DB_CONFIG.baseUrl}/currencies/bmsrate?source_cur=${encodeURIComponent(ccy)}&target_cur=AED${dateParam}`);
        const data = await res.json();
        if (data.rate) {
          const rateStr = String(data.rate);
          setRevalRates(prev => ({ ...prev, [ccy]: rateStr }));
          const inv = parseFloat(rateStr);
          if (!isNaN(inv) && inv !== 0)
            setRevalFuncRates(prev => ({ ...prev, [ccy]: (1 / inv).toFixed(10) }));
        } else {
          message.warning(`No BMS rate found for ${ccy}${revalRateDate ? ` on ${revalRateDate}` : ''}`);
        }
      } catch {
        message.error(`Failed to fetch BMS rate for ${ccy}`);
      } finally {
        setRevalBmsFetching(prev => ({ ...prev, [ccy]: false }));
      }
    }
  }, [revalRateDate]);

  // ── Revaluation modal renderer ────────────────────────────────
  const renderRevalModal = () => {
    const tab = tabs.find(t => t.key === revalTabKey);
    if (!tab) return null;

    const isPosted = revalStatus === 'ACCOUNTED';

    // All raw rows for this account
    const allRawRows = tab.rrData.filter(r => r.account === revalAccount);
    const accountType = allRawRows[0]?.account_type || 'A';
    const accountDesc = allRawRows[0]?.account_desc || '';
    // Derive the ledger functional currency from the Fusion TB tab for the same period.
    // Fusion TB only stores rows in functional currency, so data[0].currency is the functional ccy.
    // Falls back to 'AED' if no Fusion tab is loaded yet.
    const periodClean = tab.periodName.replace(/^(?:ReERP|Dynamic|YTD):\s*/, '');
    const fusionTabForPeriod = tabs.find(t => t.tabType === 'fusion' && t.periodName === periodClean);
    const functionalCcy = fusionTabForPeriod?.data.find(r => r.currency)?.currency || 'AED';
    // Company for locking the first segment of gain/loss account selectors
    const revalCompany = tab.selectedCompany || allRawRows[0]?.company || '';

    const fmtN = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

    // One row per (combination, currency) pair — the primary table rows
    interface ComboRow {
      rowKey: string; combo: string; ccy: string; subAccount: string;
      entClosing: number; acctClosing: number;
      bookRate: number; newRate: number; newAcctValue: number;
      revalAmt: number; isGain: boolean; excluded: boolean;
    }
    // Group by (combo + ccy) to deduplicate rows that share the same combination and currency
    const comboMap = new Map<string, ComboRow>();
    allRawRows.forEach(r => {
      const ccy        = r.currency_code || '';
      const combo      = r.account_combination || revalAccount;
      const key        = `${combo}-${ccy}`;
      const excluded   = revalExcludedCombos.has(combo);
      const newRate    = excluded ? 0 : (parseFloat(revalRates[ccy] || '') || 0);
      if (comboMap.has(key)) {
        const g = comboMap.get(key)!;
        g.entClosing  += r.entered_closing || 0;
        g.acctClosing += r.closing        || 0;
        g.bookRate     = g.entClosing !== 0 ? g.acctClosing / g.entClosing : 0;
        g.newAcctValue = g.entClosing * g.newRate;
        g.revalAmt     = g.newAcctValue - g.acctClosing;
        g.isGain       = g.revalAmt >= 0;
      } else {
        const entClosing  = r.entered_closing || 0;
        const acctClosing = r.closing         || 0;
        const bookRate    = entClosing !== 0 ? acctClosing / entClosing : 0;
        const newAcctVal  = entClosing * newRate;
        const revalAmt    = newAcctVal - acctClosing;
        comboMap.set(key, {
          rowKey:       key,
          combo,
          ccy,
          subAccount:   (() => {
            if (r.sub_account && !/^0+$/.test(r.sub_account)) return r.sub_account;
            // Extract segment 5 (index 4) from combination, skip if all-zeros
            const seg5 = combo.split('-')[4] || '';
            return /^0+$/.test(seg5) ? '' : seg5;
          })(),
          entClosing,
          acctClosing,
          bookRate,
          newRate,
          newAcctValue: newAcctVal,
          revalAmt,
          isGain:       revalAmt >= 0,
          excluded,
        });
      }
    });
    const comboRows: ComboRow[] = Array.from(comboMap.values());

    // Active rows only (for totals + preview)
    const activeComboRows = comboRows.filter(r => !r.excluded);

    // Currency-aggregated rows — used for save payload (ccy_rows)
    interface CcyRow {
      ccy: string; entClosing: number; acctClosing: number;
      bookRate: number; newRate: number; newAcctValue: number;
      revalAmt: number; isGain: boolean; combos: string[];
    }
    const ccyMap = new Map<string, CcyRow>();
    activeComboRows.forEach(r => {
      if (!ccyMap.has(r.ccy)) ccyMap.set(r.ccy, { ccy: r.ccy, entClosing: 0, acctClosing: 0, bookRate: 0, newRate: r.newRate, newAcctValue: 0, revalAmt: 0, isGain: true, combos: [] });
      const g = ccyMap.get(r.ccy)!;
      g.entClosing  += r.entClosing;
      g.acctClosing += r.acctClosing;
      g.newAcctValue += r.newAcctValue;
      g.revalAmt    += r.revalAmt;
      g.isGain       = g.revalAmt >= 0;
      g.bookRate     = g.entClosing !== 0 ? g.acctClosing / g.entClosing : 0;
      if (!g.combos.includes(r.combo)) g.combos.push(r.combo);
    });
    const ccyRows: CcyRow[] = Array.from(ccyMap.values());

    const totalGain = activeComboRows.filter(r => r.isGain && r.revalAmt !== 0).reduce((s, r) => s + r.revalAmt, 0);
    const totalLoss = activeComboRows.filter(r => !r.isGain).reduce((s, r) => s + Math.abs(r.revalAmt), 0);

    // Extract sub-account from combination string (segment 5, index 4), skip all-zero
    const extractSubAcct = (comboStr: string): string => {
      const seg5 = (comboStr || '').split('-')[4] || '';
      return /^0+$/.test(seg5) ? '' : seg5;
    };

    // Build journal preview — one line pair per active combination
    const buildPreview = () => {
      const rawPeriod = cleanPeriodName(tab.periodName);
      const periodMonth = rawPeriod || tab.periodName;
      const lines: { lineNum: number; combo: string; subAccount: string; desc: string; comment: string; dr: number; cr: number }[] = [];
      let ln = 1;
      const gainSubAcct = extractSubAcct(revalGainCombo);
      const lossSubAcct = extractSubAcct(revalLossCombo);
      activeComboRows.forEach(r => {
        if (r.revalAmt === 0 || r.newRate === 0) return;
        const abs = Math.abs(r.revalAmt);
        const subAcctPart = r.subAccount ? ` - ${r.subAccount}` : '';
        const lineDesc = `${accountDesc}${subAcctPart} - Revaluation (${periodMonth})`;
        if (r.isGain) {
          lines.push({ lineNum: ln++, combo: r.combo,                         subAccount: r.subAccount, desc: lineDesc,                                              comment: '', dr: abs, cr: 0 });
          lines.push({ lineNum: ln++, combo: revalGainCombo || '[Gain Account]', subAccount: gainSubAcct, desc: `Unrealized FX Gain - ${r.ccy} (${periodMonth})`,    comment: '', dr: 0,   cr: abs });
        } else {
          lines.push({ lineNum: ln++, combo: revalLossCombo || '[Loss Account]', subAccount: lossSubAcct, desc: `Unrealized FX Loss - ${r.ccy} (${periodMonth})`,    comment: '', dr: abs, cr: 0 });
          lines.push({ lineNum: ln++, combo: r.combo,                         subAccount: r.subAccount, desc: lineDesc,                                              comment: '', dr: 0,   cr: abs });
        }
      });
      setRevalPreviewRows(lines);

      // Auto-fetch sub-account descriptions and patch descriptions
      const subAccts = [...new Set(lines.map(l => l.subAccount).filter(Boolean))];
      if (subAccts.length === 0) return;
      (async () => {
        try {
          const VS_BASE   = `${APEX_DB_CONFIG.baseUrl}/valuesets/getvalues`;
          const STRUCT_URL = `${APEX_DB_CONFIG.baseUrl}/chartofaccounts/structuresegments`;
          let vsCode = subAcctVsCode.current;
          if (!vsCode) {
            const sr = await fetch(STRUCT_URL);
            if (sr.ok) {
              const sd = await sr.json();
              const seg = (sd.items || []).find((s: any) => {
                const p = (s.prompt || s.segment_name || s.name || s.PROMPT || '').toLowerCase();
                return p.includes('sub') && p.includes('account');
              });
              if (seg) { vsCode = seg.segment_code || seg.SEGMENT_CODE || ''; subAcctVsCode.current = vsCode; }
            }
          }
          if (!vsCode) return;
          const vr = await fetch(`${VS_BASE}/${vsCode}`);
          if (!vr.ok) return;
          const vd = await vr.json();
          const freshMap: Record<string, string> = { ...subAcctDescMap };
          (vd.items || []).forEach((item: any) => {
            const c = item.value || item.Value || item.VALUE || '';
            const d = item.description || item.Description || item.DESCRIPTION || item.meaning || '';
            if (c) freshMap[c] = d;
          });
          setSubAcctDescMap(freshMap);
          // Patch description: replace "- {code} - Revaluation" with "- {code} - {desc} - Revaluation"
          setRevalPreviewRows(prev => prev.map(r => {
            if (!r.subAccount) return r;
            const d = freshMap[r.subAccount];
            if (!d) return r;
            const updated = r.desc.replace(
              ` - ${r.subAccount} - `,
              ` - ${r.subAccount} - ${d} - `
            );
            return updated !== r.desc ? { ...r, desc: updated } : r;
          }));
        } catch { /* silent — user can still use the icon */ }
      })();
    };

    const updatePreviewRow = (lineNum: number, field: string, value: string) => {
      setRevalPreviewRows(prev => prev.map(r => r.lineNum === lineNum ? { ...r, [field]: value } : r));
    };

    // GL Revaluation distributions — loaded from API when LOV opens
    const filteredDistCombos = revalComboSearch
      ? distComboList.filter(c =>
          c.combinationName.toLowerCase().includes(revalComboSearch.toLowerCase()) ||
          (c.description || '').toLowerCase().includes(revalComboSearch.toLowerCase()) ||
          (c.glAccountDesc || '').toLowerCase().includes(revalComboSearch.toLowerCase())
        )
      : distComboList;

    const ccyColumns = [
      { title: '', key: 'action', width: 36,
        render: (_: any, r: ComboRow) => r.excluded
          ? (
            <Tooltip title="Restore this combination">
              <Button
                type="text" size="small" icon={<span style={{ fontSize: 12 }}>↩</span>}
                style={{ color: REDWOOD.info }}
                onClick={() => setRevalExcludedCombos(prev => { const s = new Set(prev); s.delete(r.combo); return s; })}
              />
            </Tooltip>
          ) : (
            <Tooltip title="Exclude this combination">
              <Button
                type="text" size="small" danger disabled={isPosted}
                icon={<span style={{ fontSize: 14, lineHeight: 1 }}>×</span>}
                onClick={() => setRevalExcludedCombos(prev => new Set([...prev, r.combo]))}
              />
            </Tooltip>
          ),
      },
      { title: 'Combination', dataIndex: 'combo', key: 'combo', width: 320, ellipsis: true,
        render: (v: string, r: ComboRow) => (
          <Tooltip title={v}>
            <Text
              style={{
                fontFamily: 'monospace', fontSize: 11,
                opacity: r.excluded ? 0.4 : 1,
                textDecoration: r.excluded ? 'line-through' : 'none',
              }}
            >{v}</Text>
          </Tooltip>
        ),
      },
      { title: 'Ccy', dataIndex: 'ccy', key: 'ccy', width: 60,
        render: (v: string, r: ComboRow) => <Tag color={r.excluded ? 'default' : 'blue'} style={{ opacity: r.excluded ? 0.4 : 1 }}>{v}</Tag> },
      { title: 'Entered Balance', dataIndex: 'entClosing', key: 'entClosing', align: 'right' as const, width: 140,
        render: (v: number, r: ComboRow) => (
          <Text style={{ fontFamily: 'monospace', color: r.excluded ? '#aaa' : (v >= 0 ? '#237804' : REDWOOD.primary) }}>
            {v >= 0 ? fmtN(v) : `(${fmtN(v)})`}
          </Text>
        )},
      { title: 'Acctd Balance', dataIndex: 'acctClosing', key: 'acctClosing', align: 'right' as const, width: 140,
        render: (v: number, r: ComboRow) => (
          <Text style={{ fontFamily: 'monospace', color: r.excluded ? '#aaa' : (v >= 0 ? '#237804' : REDWOOD.primary) }}>
            {v >= 0 ? fmtN(v) : `(${fmtN(v)})`}
          </Text>
        )},
      { title: 'Book Rate', dataIndex: 'bookRate', key: 'bookRate', align: 'right' as const, width: 160,
        render: (v: number, r: ComboRow) => r.excluded
          ? <Text style={{ color: '#aaa', fontFamily: 'monospace' }}>—</Text>
          : (
          <Tooltip
            title={
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Book Rate = Accounted ÷ Entered</div>
                <div style={{ fontFamily: 'monospace', color: '#ffffffa0' }}>
                  {r.acctClosing.toFixed(2)} ÷ {r.entClosing.toFixed(2)}
                </div>
                <div style={{ fontFamily: 'monospace', color: '#ffffffa0', marginTop: 4 }}>
                  Full: {v ? v.toFixed(10) : '—'}
                </div>
              </div>
            }
            color="#1d3557"
          >
            <Text style={{ fontFamily: 'monospace', color: REDWOOD.textSecondary, cursor: 'help', borderBottom: '1px dashed #aaa' }}>
              {v ? v.toFixed(8) : '—'}
            </Text>
          </Tooltip>
        )},
      { title: 'New Rate (FCY→Func)', key: 'newRate', align: 'right' as const, width: 150,
        render: (_: any, r: ComboRow) => r.excluded
          ? <Text style={{ color: '#aaa', fontFamily: 'monospace' }}>—</Text>
          : isPosted
          ? <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{revalRates[r.ccy] || '—'}</Text>
          : (
          <Space.Compact>
            <Input
              size="small"
              style={{ width: 110, fontFamily: 'monospace', textAlign: 'right' }}
              placeholder="e.g. 3.675"
              value={revalRates[r.ccy] || ''}
              onChange={e => {
                const val = e.target.value;
                setRevalRates(prev => ({ ...prev, [r.ccy]: val }));
                const n = parseFloat(val);
                if (!isNaN(n) && n !== 0)
                  setRevalFuncRates(prev => ({ ...prev, [r.ccy]: (1 / n).toFixed(10) }));
                else
                  setRevalFuncRates(prev => ({ ...prev, [r.ccy]: '' }));
              }}
            />
            <Tooltip title={`Fetch BMS rate for ${r.ccy}${revalRateDate ? ` on ${revalRateDate}` : ''}`}>
              <Button
                size="small"
                icon={<SyncOutlined spin={!!revalBmsFetching[r.ccy]} />}
                disabled={!r.ccy || r.ccy === 'AED'}
                onClick={() => fetchRevalBmsRate([r.ccy])}
              />
            </Tooltip>
          </Space.Compact>
        )},
      { title: 'Func. Rate (Func→FCY)', key: 'funcRate', align: 'right' as const, width: 160,
        render: (_: any, r: ComboRow) => r.excluded
          ? <Text style={{ color: '#aaa', fontFamily: 'monospace' }}>—</Text>
          : isPosted
          ? <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {revalRates[r.ccy] && parseFloat(revalRates[r.ccy]) !== 0
                ? (1 / parseFloat(revalRates[r.ccy])).toFixed(10) : '—'}
            </Text>
          : (
          <Input
            size="small"
            style={{ width: 120, fontFamily: 'monospace', textAlign: 'right' }}
            placeholder="e.g. 0.272109"
            value={revalFuncRates[r.ccy] || ''}
            onChange={e => {
              const val = e.target.value;
              setRevalFuncRates(prev => ({ ...prev, [r.ccy]: val }));
              const n = parseFloat(val);
              if (!isNaN(n) && n !== 0)
                setRevalRates(prev => ({ ...prev, [r.ccy]: (1 / n).toFixed(10) }));
              else
                setRevalRates(prev => ({ ...prev, [r.ccy]: '' }));
            }}
          />
        )},
      { title: 'New Acctd Value', dataIndex: 'newAcctValue', key: 'newAcctValue', align: 'right' as const, width: 140,
        render: (v: number, r: ComboRow) => r.excluded || r.newRate === 0
          ? <Text style={{ color: '#aaa' }}>—</Text>
          : <Text style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{v >= 0 ? fmtN(v) : `(${fmtN(v)})`}</Text> },
      { title: 'Adjustment', key: 'revalAmt', align: 'right' as const, width: 140,
        render: (_: any, r: ComboRow) => r.excluded || r.newRate === 0
          ? <Text style={{ color: '#aaa' }}>—</Text>
          : (
          <Tag color={r.isGain ? 'green' : 'red'} style={{ fontFamily: 'monospace', fontWeight: 700 }}>
            {r.isGain ? '+' : '-'}{fmtN(r.revalAmt)} {r.isGain ? '▲' : '▼'}
          </Tag>
        )},
    ];

    const previewColumns = [
      { title: '#', dataIndex: 'lineNum', key: 'lineNum', width: 36 },
      { title: 'Account', dataIndex: 'combo', key: 'combo', width: 290,
        render: (v: string, row: any) => (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="small"
              value={v}
              readOnly
              style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', background: '#fafafa' }}
              onClick={() => { setRevalAcctSelectorLineNum(row.lineNum); setRevalAcctSelectorOpen(true); }}
            />
            <Button
              size="small"
              icon={<ApartmentOutlined />}
              onClick={() => { setRevalAcctSelectorLineNum(row.lineNum); setRevalAcctSelectorOpen(true); }}
            />
          </Space.Compact>
        )},
      { title: 'Description', dataIndex: 'desc', key: 'desc',
        render: (v: string, row: any) => (
          <Input
            size="small"
            value={v}
            onChange={e => updatePreviewRow(row.lineNum, 'desc', e.target.value)}
          />
        )},
      { title: '', key: 'subAcctFetch', width: 34,
        render: (_: any, row: any) => {
          if (!row.subAccount) return null;
          const isFetching = !!subAcctFetching[row.lineNum];
          const rawPeriod = cleanPeriodName(tab.periodName);
          const periodMonth = rawPeriod || tab.periodName;
          const doFetch = async () => {
            setSubAcctFetching(prev => ({ ...prev, [row.lineNum]: true }));
            try {
              const VS_BASE = `${APEX_DB_CONFIG.baseUrl}/valuesets/getvalues`;
              const STRUCT_URL = `${APEX_DB_CONFIG.baseUrl}/chartofaccounts/structuresegments`;
              let vsCode = subAcctVsCode.current;
              if (!vsCode) {
                const sr = await fetch(STRUCT_URL);
                if (sr.ok) {
                  const sd = await sr.json();
                  const seg = (sd.items || []).find((s: any) => {
                    const p = (s.prompt || s.segment_name || s.name || s.PROMPT || '').toLowerCase();
                    return p.includes('sub') && p.includes('account');
                  });
                  if (seg) { vsCode = seg.segment_code || seg.SEGMENT_CODE || ''; subAcctVsCode.current = vsCode; }
                }
              }
              if (!vsCode) { message.warning('Sub-account value set not found'); return; }
              const vr = await fetch(`${VS_BASE}/${vsCode}`);
              if (!vr.ok) { message.error('Failed to load value set'); return; }
              const vd = await vr.json();
              const freshMap: Record<string, string> = { ...subAcctDescMap };
              (vd.items || []).forEach((item: any) => {
                const c = item.value || item.Value || item.VALUE || '';
                const d = item.description || item.Description || item.DESCRIPTION || item.meaning || '';
                if (c) freshMap[c] = d;
              });
              setSubAcctDescMap(freshMap);
              const subDesc = freshMap[row.subAccount];
              if (subDesc) {
                updatePreviewRow(row.lineNum, 'desc', `${accountDesc} - ${row.subAccount} - ${subDesc} - Revaluation (${periodMonth})`);
              } else {
                message.warning(`No description found for sub-account: ${row.subAccount}`);
              }
            } finally {
              setSubAcctFetching(prev => ({ ...prev, [row.lineNum]: false }));
            }
          };
          return (
            <Tooltip title={`Sub-account: ${row.subAccount} — click to fetch description`}>
              <Button
                type="text"
                size="small"
                icon={isFetching ? <LoadingOutlined /> : <SyncOutlined />}
                style={{ color: REDWOOD.info }}
                onClick={() => {
                  Modal.confirm({
                    title: 'Fetch Sub-Account Description',
                    content: (
                      <div>
                        <div style={{ marginBottom: 8, fontSize: 13 }}>Fetch description for sub-account:</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, color: REDWOOD.primary, background: '#fafafa', padding: '6px 10px', borderRadius: 4 }}>
                          {row.subAccount}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: REDWOOD.neutral }}>
                          The description will be inserted into the journal line description.
                        </div>
                      </div>
                    ),
                    okText: 'Fetch & Apply',
                    cancelText: 'Cancel',
                    onOk: doFetch,
                  });
                }}
              />
            </Tooltip>
          );
        }},
      { title: 'Comment', dataIndex: 'comment', key: 'comment', width: 160,
        render: (v: string, row: any) => (
          <Input
            size="small"
            value={v}
            onChange={e => updatePreviewRow(row.lineNum, 'comment', e.target.value)}
            placeholder="Optional comment…"
          />
        )},
      { title: 'Debit', dataIndex: 'dr', key: 'dr', align: 'right' as const, width: 120,
        render: (v: number) => v ? <Text style={{ fontFamily: 'monospace', color: '#237804', fontWeight: 600 }}>{fmtN(v)}</Text> : null },
      { title: 'Credit', dataIndex: 'cr', key: 'cr', align: 'right' as const, width: 120,
        render: (v: number) => v ? <Text style={{ fontFamily: 'monospace', color: REDWOOD.primary, fontWeight: 600 }}>{fmtN(v)}</Text> : null },
    ];

    return (
      <>
        <Modal
          open={revalVisible}
          onCancel={() => { setRevalVisible(false); setRevalPreviewRows([]); }}
          footer={null}
          width={1400}
          title={
            <Space wrap>
              <Tag color={accountType === 'A' ? 'blue' : accountType === 'L' ? 'orange' : 'green'}>
                {accountType === 'A' ? 'Asset' : accountType === 'L' ? 'Liability' : accountType === 'O' ? 'Equity' : accountType}
              </Tag>
              <Text strong style={{ fontFamily: 'monospace' }}>{revalAccount}</Text>
              <Text style={{ color: REDWOOD.textSecondary }}>{accountDesc}</Text>
              <Tag color="purple">{cleanPeriodName(tab.periodName)}</Tag>
              {revalChecking && <Tag icon={<LoadingOutlined />} color="processing">Checking…</Tag>}
              {revalId && !revalChecking && (
                <Tag color="success" style={{ fontFamily: 'monospace' }}>ID: {revalId}</Tag>
              )}
              {!revalId && !revalChecking && (
                <Tag color="default">New</Tag>
              )}
              {revalStatus === 'ACCOUNTED' && (
                <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontWeight: 600 }}>POSTED</Tag>
              )}
              {revalStatus === 'DRAFT' && (
                <Tag color="blue">DRAFT</Tag>
              )}
            </Space>
          }
        >
          {revalStatus === 'ACCOUNTED' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Posted — No Changes Allowed"
              description={`This revaluation (ID: ${revalId}) has already been posted to the General Ledger. The period is locked. To make corrections, reverse the GL batch and create a new revaluation.`}
            />
          )}

          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Oracle Fusion revaluation logic: New Acctd Value = Entered Balance × New Rate.
              Adjustment = New Value − Book Value. Positive → Dr Account / Cr Gain. Negative → Dr Loss / Cr Account.
            </Text>
          </div>

          {/* BMS rate date + fetch controls */}
          {!isPosted && (
            <Space style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>Rate Date:</Text>
              <DatePicker
                size="small"
                format="D-MMM-YYYY"
                value={revalRateDate ? dayjs(revalRateDate) : null}
                onChange={d => setRevalRateDate(d ? d.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'))}
                style={{ width: 130 }}
              />
              <Tooltip title="Fetch BMS rates for all currencies on the selected date">
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={Object.values(revalBmsFetching).some(Boolean)}
                  onClick={() => {
                    const ccys = [...new Set(comboRows.filter(r => !r.excluded && r.ccy && r.ccy !== 'AED').map(r => r.ccy))];
                    if (ccys.length === 0) { message.info('No foreign currency rows to fetch rates for'); return; }
                    fetchRevalBmsRate(ccys);
                  }}
                >
                  Fetch All BMS Rates
                </Button>
              </Tooltip>
              <Popover
                trigger="click"
                title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span style={{ color: REDWOOD.info }}>BMS Rate — GET Endpoint</span></Space>}
                content={
                  <div style={{ maxWidth: 520 }}>
                    <Text style={{ fontSize: 12 }} type="secondary">Called once per foreign currency (skips AED):</Text>
                    <div style={{ marginTop: 6, background: '#f5f8ff', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/currencies/bmsrate?source_cur={CCY}&target_cur=AED`}
                      {revalRateDate ? `&rate_date=${revalRateDate}` : ''}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text style={{ fontSize: 11 }} type="secondary">Parameters:</Text>
                      <table style={{ fontSize: 11, marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
                        <tbody>
                          {[
                            ['source_cur', 'Foreign currency code (e.g. USD, EUR)'],
                            ['target_cur', 'Always AED (functional currency)'],
                            ['rate_date',  revalRateDate ? revalRateDate : '(not set — uses latest rate)'],
                          ].map(([p, d]) => (
                            <tr key={p}>
                              <td style={{ padding: '2px 8px 2px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{p}</td>
                              <td style={{ padding: '2px 0', color: '#555' }}>{d}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                }
              >
                <Button size="small" icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }} />
              </Popover>
            </Space>
          )}

          {/* Per-combination balance + rate table */}
          <Table
            dataSource={comboRows}
            columns={ccyColumns}
            rowKey="rowKey"
            size="small"
            pagination={false}
            scroll={{ x: 1350, y: 300 }}
            style={{ marginBottom: 16 }}
            rowClassName={(r: ComboRow) => r.excluded ? 'reval-row-excluded' : ''}
          />

          {/* Gain / Loss totals */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '8px 12px' }}>
                <Text style={{ color: '#389e0d', fontWeight: 700, fontSize: 13 }}>
                  Total Gain: {fmtN(totalGain)}
                </Text>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ background: '#fff2f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '8px 12px' }}>
                <Text style={{ color: REDWOOD.primary, fontWeight: 700, fontSize: 13 }}>
                  Total Loss: {fmtN(totalLoss)}
                </Text>
              </div>
            </Col>
          </Row>

          {/* Gain / Loss GL account selectors */}
          <Row gutter={12} style={{ marginBottom: 16 }}>
            {(['gain', 'loss'] as const).map(side => {
              const isGainSide = side === 'gain';
              const label      = isGainSide ? 'Unrealised Gain Account' : 'Unrealised Loss Account';
              const color      = isGainSide ? '#389e0d' : REDWOOD.primary;
              const value      = isGainSide ? revalGainCombo : revalLossCombo;
              const setValue   = isGainSide ? setRevalGainCombo : setRevalLossCombo;
              return (
                <Col span={12} key={side}>
                  <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Text strong style={{ fontSize: 12, color }}>{label}</Text>
                    {revalCompany && (
                      <Tag color="default" style={{ fontSize: 10, margin: 0 }}>Co: {revalCompany}</Tag>
                    )}
                  </div>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small"
                      placeholder="Select via segments or LOV…"
                      value={value}
                      disabled={isPosted}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: 11, cursor: isPosted ? 'not-allowed' : 'pointer', background: '#fafafa' }}
                      onClick={() => { if (!isPosted) { setRevalGainLossAcctFor(side); setRevalGainLossAcctOpen(true); } }}
                    />
                    <Tooltip title="Build combination segment by segment">
                      <Button
                        size="small"
                        icon={<ApartmentOutlined />}
                        disabled={isPosted}
                        onClick={() => { setRevalGainLossAcctFor(side); setRevalGainLossAcctOpen(true); }}
                      />
                    </Tooltip>
                    <Tooltip title="Pick from existing TB combinations">
                      <Button
                        size="small"
                        icon={<SearchOutlined />}
                        disabled={isPosted}
                        onClick={() => { setRevalComboPickerFor(side); setRevalComboSearch(''); setRevalComboPickerOpen(true); }}
                      />
                    </Tooltip>
                  </Space.Compact>
                </Col>
              );
            })}
          </Row>

          {/* Preview button + Save + Print row */}
          <Space style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              onClick={buildPreview}
              disabled={isPosted || activeComboRows.every(r => r.newRate === 0)}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
            >
              Preview Journal Entry
            </Button>

            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={isPosted || revalPreviewRows.length === 0}
              loading={revalSaving}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={async () => {
                setRevalSaving(true);
                setRevalApiError(null);
                const rawPeriod = cleanPeriodName(tab.periodName);
                const isUpdate  = revalId != null;
                const payload   = {
                  ledger_id:      Number((allRawRows[0] as any)?.ledger_id) || 0,
                  ledger_name:    tab.ledgerName,
                  period_name:    rawPeriod,
                  account:        revalAccount,
                  account_desc:   accountDesc,
                  functional_ccy: functionalCcy,
                  base_currency:  functionalCcy,   // dedicated column — read back during accounting
                  gain_account:   revalGainCombo,
                  loss_account:   revalLossCombo,
                  total_gain:     totalGain,
                  total_loss:     totalLoss,
                  notes:          '',
                  created_by:     user?.username || 'SYSTEM',
                  ccy_rows: ccyRows.filter(r => r.newRate > 0).map(r => ({
                    currency_code:  r.ccy,
                    ent_closing:    r.entClosing,
                    acct_closing:   r.acctClosing,
                    book_rate:      r.bookRate,
                    new_rate:       r.newRate,
                    new_acct_value: r.newAcctValue,
                    reval_amt:      r.revalAmt,
                    is_gain:        r.isGain ? 1 : 0,
                  })),
                  lines: revalPreviewRows.map(r => ({
                    line_num:     r.lineNum,
                    combo:        r.combo,
                    description:  r.desc,
                    comment_text: r.comment,
                    dr_amount:    r.dr,
                    cr_amount:    r.cr,
                  })),
                };
                // ── Blank account combination validation ──────────────
                const blankCombos = revalPreviewRows.filter(
                  r => !r.combo || r.combo.startsWith('['),
                );
                if (blankCombos.length > 0) {
                  Modal.error({
                    title: 'Missing Account Combination',
                    icon: <ExclamationCircleOutlined style={{ color: REDWOOD.error }} />,
                    content: (
                      <div>
                        <p style={{ marginBottom: 8 }}>
                          {blankCombos.length} journal line{blankCombos.length > 1 ? 's are' : ' is'} missing a
                          valid account combination. Please set the <strong>Gain</strong> and{' '}
                          <strong>Loss</strong> account combinations before saving.
                        </p>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, fontFamily: 'monospace' }}>
                          {blankCombos.map(r => (
                            <li key={r.lineNum} style={{ color: REDWOOD.primary }}>
                              Line {r.lineNum}: {r.combo || '(empty)'} — {r.desc}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                    okText: 'OK',
                  });
                  setRevalSaving(false);
                  return;
                }

                // ── Company segment mismatch validation ───────────────
                if (revalCompany) {
                  const mismatched = revalPreviewRows.filter(r => {
                    const firstSeg = (r.combo || '').split('-')[0];
                    return firstSeg && firstSeg !== revalCompany;
                  });
                  if (mismatched.length > 0) {
                    Modal.error({
                      title: 'Company Segment Mismatch',
                      icon: <ExclamationCircleOutlined style={{ color: REDWOOD.warning }} />,
                      content: (
                        <div>
                          <p style={{ marginBottom: 8 }}>
                            {mismatched.length} journal line{mismatched.length > 1 ? 's have' : ' has'} a company
                            segment that does not match the trial balance company <strong>"{revalCompany}"</strong>:
                          </p>
                          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, fontFamily: 'monospace' }}>
                            {mismatched.map(r => (
                              <li key={r.lineNum} style={{ color: REDWOOD.primary }}>
                                {r.combo} (company: {(r.combo || '').split('-')[0]})
                              </li>
                            ))}
                          </ul>
                          <p style={{ marginTop: 8, marginBottom: 0, color: REDWOOD.error }}>
                            Saving is not allowed until all account combinations use company "{revalCompany}".
                          </p>
                        </div>
                      ),
                      okText: 'OK',
                    });
                    setRevalSaving(false);
                    return;
                  }
                }

                const callUrl = isUpdate
                  ? `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.revaluation}/${revalId}`
                  : `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.revaluation}`;
                const method  = isUpdate ? 'PUT' : 'POST';

                try {
                  const res  = await fetch(callUrl, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                  const text = await res.text();
                  setRevalLastCall({ url: callUrl, method, payload, responseText: text, httpStatus: res.status });

                  let json: any = {};
                  try { json = JSON.parse(text); } catch {
                    setRevalApiError(`HTTP ${res.status} — Server returned non-JSON response. Check the API debug panel for full details.`);
                    return;
                  }

                  if (json.status === 'SUCCESS') {
                    const savedId = json.revalueId ?? revalId;
                    if (!isUpdate) setRevalId(savedId);
                    message.success(`Revaluation ${isUpdate ? 'updated' : 'saved'} (ID: ${savedId})`);
                  } else {
                    setRevalApiError(`API error: ${json.error || json.message || JSON.stringify(json)}`);
                  }
                } catch (e) {
                  setRevalLastCall({ url: callUrl, method, payload, responseText: String(e), httpStatus: 0 });
                  setRevalApiError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setRevalSaving(false);
                }
              }}
            >
              {revalId ? 'Update Revaluation' : 'Save Revaluation'}
            </Button>

            {revalId && revalStatus !== 'ACCOUNTED' && (
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={acctFlowLoading}
                disabled={revalPreviewRows.length === 0}
                style={{ background: '#722ED1', borderColor: '#722ED1' }}
                onClick={handleCreateAccountingFromTB}
              >
                Create Accounting
              </Button>
            )}

            {revalStatus === 'ACCOUNTED' && (
              <Button
                icon={<CheckCircleOutlined />}
                style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                onClick={() => setAcctFlowVisible(true)}
              >
                View Accounting
              </Button>
            )}

            <Button
              icon={<PrinterOutlined />}
              disabled={revalPreviewRows.length === 0}
              onClick={() => {
                try {
                  const doc = new jsPDF('portrait', 'mm', 'a4');
                  const pageW = doc.internal.pageSize.getWidth();
                  doc.setFontSize(16);
                  doc.setFont('helvetica', 'bold');
                  doc.text('FX Revaluation', pageW / 2, 18, { align: 'center' });

                  doc.setFontSize(9);
                  doc.setFont('helvetica', 'normal');
                  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  const hdrRows = [
                    [`Period: ${tab.periodName}`, `Account: ${revalAccount}`],
                    [`Account Desc: ${accountDesc}`, `Functional CCY: ${functionalCcy}`],
                    [`Date: ${today}`, `Status: DRAFT`],
                  ];
                  let y = 26;
                  hdrRows.forEach(([left, right]) => {
                    doc.text(left, 14, y);
                    doc.text(right, pageW / 2 + 4, y);
                    y += 6;
                  });

                  y += 2;
                  doc.setFont('helvetica', 'bold');
                  doc.setFontSize(10);
                  doc.text('Section 1: Currency Rates', 14, y);
                  y += 4;

                  autoTable(doc, {
                    startY: y,
                    head: [['Currency', 'Ent. Balance', 'Acctd Balance', 'Book Rate', 'New Rate', 'Inverse Rate', 'New Acctd Value', 'Adjustment']],
                    body: ccyRows.map(r => [
                      r.ccy,
                      r.entClosing.toLocaleString('en-US', { minimumFractionDigits: 2 }),
                      r.acctClosing.toLocaleString('en-US', { minimumFractionDigits: 2 }),
                      r.bookRate.toFixed(10),
                      r.newRate.toFixed(10),
                      r.newRate !== 0 ? (1 / r.newRate).toFixed(10) : '—',
                      r.newAcctValue.toLocaleString('en-US', { minimumFractionDigits: 2 }),
                      r.revalAmt.toLocaleString('en-US', { minimumFractionDigits: 2 }),
                    ]),
                    styles: { fontSize: 8 },
                    headStyles: { fillColor: [7, 114, 206] },
                    margin: { left: 14, right: 14 },
                  });

                  y = (doc as any).lastAutoTable.finalY + 8;
                  doc.setFont('helvetica', 'bold');
                  doc.setFontSize(10);
                  doc.text('Section 2: Gain / Loss Summary', 14, y);
                  y += 4;

                  autoTable(doc, {
                    startY: y,
                    head: [['', 'Amount']],
                    body: [
                      ['Total Gain', totalGain.toLocaleString('en-US', { minimumFractionDigits: 2 })],
                      ['Total Loss', totalLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })],
                    ],
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [29, 123, 77] },
                    margin: { left: 14, right: 14 },
                    tableWidth: 80,
                  });

                  y = (doc as any).lastAutoTable.finalY + 8;
                  doc.setFont('helvetica', 'bold');
                  doc.setFontSize(10);
                  doc.text('Section 3: Journal Preview Lines', 14, y);
                  y += 4;

                  const totalDr = revalPreviewRows.reduce((s, r) => s + r.dr, 0);
                  const totalCr = revalPreviewRows.reduce((s, r) => s + r.cr, 0);

                  autoTable(doc, {
                    startY: y,
                    head: [['Line#', 'Account Combination', 'Description', 'Comment', 'Debit', 'Credit']],
                    body: [
                      ...revalPreviewRows.map(r => [
                        r.lineNum,
                        r.combo,
                        r.desc,
                        r.comment || '',
                        r.dr > 0 ? r.dr.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '',
                        r.cr > 0 ? r.cr.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '',
                      ]),
                      ['', '', '', 'Totals',
                        totalDr.toLocaleString('en-US', { minimumFractionDigits: 2 }),
                        totalCr.toLocaleString('en-US', { minimumFractionDigits: 2 })],
                    ],
                    styles: { fontSize: 7.5 },
                    headStyles: { fillColor: [58, 58, 58] },
                    margin: { left: 14, right: 14 },
                  });

                  const pageCount = (doc as any).internal.getNumberOfPages();
                  for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(150);
                    doc.text('Generated by ReactERP', pageW / 2, 290, { align: 'center' });
                    doc.setTextColor(0);
                  }

                  const blobUrl = doc.output('bloburl') as unknown as string;
                  window.open(blobUrl, '_blank');
                } catch (e) {
                  message.error('PDF generation failed: ' + (e instanceof Error ? e.message : String(e)));
                }
              }}
            >
              Print PDF
            </Button>

            {/* API Debug button */}
            <Button
              size="small"
              icon={<ApiOutlined />}
              style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
              onClick={() => setRevalApiDebugOpen(true)}
            >
              API {revalLastCall ? `(${revalLastCall.httpStatus})` : ''}
            </Button>

            {/* Bank Recon Status button */}
            <Button
              size="small"
              icon={<ReconciliationOutlined />}
              style={{ color: '#722ed1', borderColor: '#722ed1' }}
              loading={reconStatusLoading}
              onClick={async () => {
                setReconStatusOpen(true);
                setReconStatusLoading(true);
                setReconStatusData({});
                setReconDrillCombo(null);
                const tab = tabs.find(t => t.key === revalTabKey);
                if (!tab) { setReconStatusLoading(false); return; }
                const periodClean = tab.periodName.replace(/^(?:ReERP|Dynamic|YTD):\s*/, '').replace(/\s*·.*$/, '').trim();
                const allRawRows  = tab.rrData.filter((r: any) => r.account === revalAccount);
                const ledgerId    = (allRawRows[0] as any)?.ledger_id || null;
                const combos = [...new Set(allRawRows.map((r: any) => r.account_combination as string).filter(Boolean))];
                const results: Record<string, any> = {};
                await Promise.allSettled(combos.map(async combo => {
                  try {
                    const q = new URLSearchParams({ account_combination: combo, period_name: periodClean });
                    if (ledgerId) q.set('ledger_id', String(ledgerId));
                    const res  = await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/recon-status?${q}`);
                    const data = await res.json();
                    results[combo] = data;
                  } catch (e) { results[combo] = { status: 'error', message: String(e) }; }
                }));
                setReconStatusData(results);
                setReconStatusLoading(false);
              }}
            >
              Bank Recon
            </Button>
          </Space>

          {/* Error alert */}
          {revalApiError && (
            <Alert
              type="error"
              showIcon
              closable
              onClose={() => setRevalApiError(null)}
              style={{ marginTop: 12, marginBottom: 4 }}
              message="Save Failed"
              description={
                <div>
                  <div style={{ marginBottom: 6 }}>{revalApiError}</div>
                  <Button size="small" icon={<ApiOutlined />} onClick={() => setRevalApiDebugOpen(true)}>
                    View API Debug
                  </Button>
                </div>
              }
            />
          )}

          {/* Journal preview table */}
          {revalPreviewRows.length > 0 && (
            <div style={{ border: `1px solid ${REDWOOD.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#1d1d1d', color: '#fff', padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>
                Journal Preview — FX Revaluation &nbsp;
                <Tag color="gold">Preview Only — No journal created</Tag>
              </div>
              <Table
                dataSource={revalPreviewRows}
                columns={previewColumns}
                rowKey="lineNum"
                size="small"
                pagination={false}
                summary={() => (
                  <Table.Summary>
                    <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                      <Table.Summary.Cell index={0} colSpan={4} align="right">
                        <Text strong>Total</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Text strong style={{ fontFamily: 'monospace', color: '#237804' }}>
                          {fmtN(revalPreviewRows.reduce((s, r) => s + r.dr, 0))}
                        </Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>
                          {fmtN(revalPreviewRows.reduce((s, r) => s + r.cr, 0))}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            </div>
          )}
        </Modal>

        {/* ── API Debug Modal ── */}
        <Modal
          open={revalApiDebugOpen}
          onCancel={() => setRevalApiDebugOpen(false)}
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Debug — Revaluation Save</span></Space>}
          width={820}
          footer={
            <Space>
              <Button
                type="primary"
                icon={<ApiOutlined />}
                disabled={!revalLastCall}
                onClick={async () => {
                  if (!revalLastCall) return;
                  setRevalApiError(null);
                  try {
                    const res  = await fetch(revalLastCall.url, { method: revalLastCall.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(revalLastCall.payload) });
                    const text = await res.text();
                    setRevalLastCall(prev => prev ? { ...prev, responseText: text, httpStatus: res.status } : prev);
                    let json: any = {};
                    try { json = JSON.parse(text); } catch { setRevalApiError(`HTTP ${res.status} — non-JSON response`); return; }
                    if (json.status === 'SUCCESS') {
                      const isUpdate = revalLastCall.method === 'PUT';
                      const savedId  = json.revalueId ?? revalId;
                      if (!isUpdate) setRevalId(savedId);
                      message.success(`Revaluation ${isUpdate ? 'updated' : 'saved'} (ID: ${savedId})`);
                      setRevalApiDebugOpen(false);
                    } else {
                      setRevalApiError(`API error: ${json.error || JSON.stringify(json)}`);
                    }
                  } catch (e) {
                    setRevalApiError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }}
              >
                Test / Retry
              </Button>
              <Button onClick={() => setRevalApiDebugOpen(false)}>Close</Button>
            </Space>
          }
        >
          {revalLastCall ? (
            <div style={{ fontSize: 12 }}>
              {/* URL + method */}
              <div style={{ marginBottom: 10 }}>
                <Text strong>URL</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Tag color={revalLastCall.method === 'POST' ? 'green' : 'blue'} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {revalLastCall.method}
                  </Tag>
                  <code style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, fontSize: 12, wordBreak: 'break-all' }}>
                    {revalLastCall.url}
                  </code>
                </div>
              </div>

              {/* HTTP status */}
              <div style={{ marginBottom: 10 }}>
                <Text strong>HTTP Status </Text>
                <Tag color={revalLastCall.httpStatus >= 200 && revalLastCall.httpStatus < 300 ? 'success' : 'error'}>
                  {revalLastCall.httpStatus || 'N/A'}
                </Tag>
              </div>

              {/* Request payload */}
              <div style={{ marginBottom: 10 }}>
                <Text strong>Request Payload</Text>
                <div style={{ position: 'relative', marginTop: 4 }}>
                  <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 10, borderRadius: 6, maxHeight: 220, overflowY: 'auto', fontSize: 11, margin: 0 }}>
                    {JSON.stringify(revalLastCall.payload, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Response */}
              <div>
                <Text strong>Response</Text>
                <pre style={{
                  background: revalLastCall.httpStatus >= 200 && revalLastCall.httpStatus < 300 ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${revalLastCall.httpStatus >= 200 && revalLastCall.httpStatus < 300 ? '#b7eb8f' : '#ffccc7'}`,
                  padding: 10, borderRadius: 6, maxHeight: 160, overflowY: 'auto', fontSize: 11, margin: '4px 0 0',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {(() => { try { return JSON.stringify(JSON.parse(revalLastCall.responseText), null, 2); } catch { return revalLastCall.responseText; } })()}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ color: '#999', padding: 24, textAlign: 'center' }}>
              No API call made yet. Click Save / Update Revaluation first.
            </div>
          )}
        </Modal>

        {/* ── Bank Recon Status Modal ── */}
        <Modal
          open={reconStatusOpen}
          onCancel={() => setReconStatusOpen(false)}
          title={
            <Space>
              <ReconciliationOutlined style={{ color: '#722ed1' }} />
              <span>Bank Reconciliation Status — {revalAccount} · {tabs.find(t => t.key === revalTabKey)?.periodName?.replace(/^(?:ReERP|Dynamic|YTD):\s*/, '')}</span>
            </Space>
          }
          width={900}
          footer={<Button onClick={() => setReconStatusOpen(false)}>Close</Button>}
          destroyOnClose
        >
          <Spin spinning={reconStatusLoading} tip="Loading recon status…">
            {(() => {
              const combos  = Object.keys(reconStatusData);
              const totalAll   = combos.reduce((s, c) => s + (reconStatusData[c]?.totalLines   ?? 0), 0);
              const reconAll   = combos.reduce((s, c) => s + (reconStatusData[c]?.reconLines   ?? 0), 0);
              const unreconAll = combos.reduce((s, c) => s + (reconStatusData[c]?.unreconLines ?? 0), 0);
              const pct = totalAll > 0 ? Math.round((reconAll / totalAll) * 100) : 0;
              return (
                <div>
                  {/* Summary */}
                  {combos.length > 0 && (
                    <div style={{ display: 'flex', gap: 24, marginBottom: 20, padding: '12px 16px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: '#1677ff' }}>{totalAll}</div>
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>Total GL Lines</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: '#1D7B4D' }}>{reconAll}</div>
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>Reconciled</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: '#C74634' }}>{unreconAll}</div>
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>Unreconciled</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>Overall Reconciliation Progress</div>
                        <Progress
                          percent={pct}
                          strokeColor={pct === 100 ? '#1D7B4D' : pct > 50 ? '#D4A800' : '#C74634'}
                          size="default"
                        />
                      </div>
                    </div>
                  )}

                  {/* Per-combination */}
                  {combos.map(combo => {
                    const rs = reconStatusData[combo];
                    const ok = rs?.status === 'success';
                    const comboPct = ok && rs.totalLines > 0 ? Math.round((rs.reconLines / rs.totalLines) * 100) : 0;
                    const apiUrl = `${APEX_DB_CONFIG.baseUrl}/cash/recon-status?account_combination=${encodeURIComponent(combo)}&period_name=${encodeURIComponent((tabs.find(t => t.key === revalTabKey)?.periodName ?? '').replace(/^(?:ReERP|Dynamic|YTD):\s*/, '').replace(/\s*·.*$/, '').trim())}`;

                    return (
                      <div key={combo} style={{ border: '1px solid #e8e8e8', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fafafa' }}>
                          <Text style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }}>{combo}</Text>
                          {ok ? (
                            <>
                              <Tag color="blue"  style={{ fontSize: 10, margin: 0 }}>{rs.totalLines} total</Tag>
                              <Tag color="green" style={{ fontSize: 10, margin: 0 }}>{rs.reconLines} recon</Tag>
                              {rs.unreconLines > 0 && <Tag color="red" style={{ fontSize: 10, margin: 0 }}>{rs.unreconLines} unrecon</Tag>}
                              <Progress percent={comboPct} size="small" style={{ width: 90, margin: 0 }}
                                strokeColor={comboPct === 100 ? '#1D7B4D' : comboPct > 50 ? '#D4A800' : '#C74634'}
                                format={p => <span style={{ fontSize: 10 }}>{p}%</span>}
                              />
                            </>
                          ) : ok === false ? (
                            <Tag color="red" style={{ fontSize: 10 }}>{rs?.message || 'Error'}</Tag>
                          ) : (
                            <Tag color="default" style={{ fontSize: 10 }}>No data</Tag>
                          )}
                          <Tooltip title="Drill down — GL lines with recon details">
                            <Button size="small" icon={<ReconciliationOutlined />}
                              style={{ color: '#722ed1', borderColor: '#722ed1' }}
                              onClick={() => setReconDrillCombo(reconDrillCombo === combo ? null : combo)}
                            />
                          </Tooltip>
                          <Tooltip title="View API endpoint">
                            <Button size="small" icon={<ApiOutlined />}
                              style={{ color: '#8c8c8c', borderColor: '#d9d9d9' }}
                              onClick={() => Modal.info({
                                title: 'Recon Status API',
                                width: 680,
                                content: (
                                  <div>
                                    <div style={{ marginBottom: 8 }}>
                                      <Tag color="blue">GET</Tag>
                                      <Text style={{ fontSize: 11, wordBreak: 'break-all' }}>{apiUrl}</Text>
                                    </div>
                                    {ok && (
                                      <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 8, borderRadius: 4, fontSize: 11, overflowX: 'auto' }}>
                                        {JSON.stringify({ totalLines: rs.totalLines, reconLines: rs.reconLines, unreconLines: rs.unreconLines, reconAmount: rs.reconAmount, unreconAmount: rs.unreconAmount }, null, 2)}
                                      </pre>
                                    )}
                                  </div>
                                ),
                              })}
                            />
                          </Tooltip>
                        </div>

                        {/* Drill-down table */}
                        {reconDrillCombo === combo && ok && rs.lines?.length > 0 && (
                          <Table
                            dataSource={rs.lines}
                            rowKey={(r: any) => `${r.jeHeaderId}-${r.jeLineNumber}`}
                            size="small"
                            pagination={false}
                            scroll={{ x: 750, y: 320 }}
                            style={{ margin: 0 }}
                            columns={[
                              { title: 'JE Header',    dataIndex: 'jeHeaderId',   width: 110, render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text> },
                              { title: 'Line',         dataIndex: 'jeLineNumber', width: 55 },
                              { title: 'Date',         dataIndex: 'effectiveDate', width: 100, render: (v: string) => v?.substring(0, 10) || '—' },
                              { title: 'Category',     dataIndex: 'jeCategory', width: 130, ellipsis: true, render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11 }}>{v || '—'}</span></Tooltip> },
                              { title: 'Debit',        dataIndex: 'debit',  width: 115, align: 'right' as const, render: (v: number) => v > 0 ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#1D7B4D' }}>{v.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : '' },
                              { title: 'Credit',       dataIndex: 'credit', width: 115, align: 'right' as const, render: (v: number) => v > 0 ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#C74634' }}>{v.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : '' },
                              { title: 'Description',  dataIndex: 'description', ellipsis: true, render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11 }}>{v || '—'}</span></Tooltip> },
                              {
                                title: 'Recon Status',
                                key: 'recon',
                                width: 100,
                                render: (_: any, r: any) => r.reconciledFlag === 'Y'
                                  ? <Tag color="green"  icon={<CheckOutlined />}    style={{ fontSize: 10, margin: 0 }}>Reconciled</Tag>
                                  : <Tag color="orange" icon={<CloseOutlined />}    style={{ fontSize: 10, margin: 0 }}>Unreconciled</Tag>,
                              },
                              {
                                title: 'Recon Ref',
                                key: 'reconRef',
                                width: 110,
                                render: (_: any, r: any) => r.reconReference
                                  ? <Tooltip title={`Date: ${r.reconDate || '—'} · By: ${r.lastUpdatedBy || '—'}`}>
                                      <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#0572CE' }}>{r.reconReference}</Text>
                                    </Tooltip>
                                  : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
                              },
                            ]}
                          />
                        )}
                        {reconDrillCombo === combo && ok && rs.lines?.length === 0 && (
                          <div style={{ padding: 16, color: '#8c8c8c', fontSize: 12, textAlign: 'center' }}>No GL lines found for this combination and period.</div>
                        )}
                      </div>
                    );
                  })}

                  {!reconStatusLoading && combos.length === 0 && (
                    <Alert type="info" showIcon message="No data loaded yet. Click 'Bank Recon' button to fetch." />
                  )}
                </div>
              );
            })()}
          </Spin>
        </Modal>

        {/* ── Create Accounting Flow Modal ── */}
        <Modal
          open={acctFlowVisible}
          onCancel={() => setAcctFlowVisible(false)}
          footer={
            <Space>
              {acctFlowLastCall && (
                <Button
                  icon={<ApiOutlined />}
                  style={{ color: REDWOOD.warning, borderColor: REDWOOD.warning }}
                  onClick={() => {
                    Modal.info({
                      title: 'SLA Create — API Payload',
                      width: 860,
                      content: (
                        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <Tag color="blue">{acctFlowLastCall.method}</Tag>
                            <span style={{ wordBreak: 'break-all', color: REDWOOD.info }}>{acctFlowLastCall.url}</span>
                          </div>
                          <div style={{ background: '#1d1d1d', color: '#d4d4d4', borderRadius: 6, padding: '10px 14px', maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>
                            {JSON.stringify(acctFlowLastCall.body, null, 2)}
                          </div>
                        </div>
                      ),
                    });
                  }}
                >
                  SLA Payload
                </Button>
              )}
              {postFlowLastCall && (
                <Button
                  icon={<ApiOutlined />}
                  style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                  onClick={() => {
                    Modal.info({
                      title: 'GL Journal POST — API Payload',
                      width: 960,
                      content: (
                        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <Tag color="blue">POST</Tag>
                            <span style={{ wordBreak: 'break-all', color: REDWOOD.info }}>{postFlowLastCall.url}</span>
                          </div>
                          <div style={{ background: '#1d1d1d', color: '#d4d4d4', borderRadius: 6, padding: '10px 14px', maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>
                            {JSON.stringify(postFlowLastCall.body, null, 2)}
                          </div>
                        </div>
                      ),
                    });
                  }}
                >
                  POST Payload
                </Button>
              )}
              <Button
                type={acctFlowDone ? 'primary' : 'default'}
                onClick={() => setAcctFlowVisible(false)}
              >
                {acctFlowDone ? 'Done' : 'Close'}
              </Button>
            </Space>
          }
          width={560}
          title={
            <Space>
              <ThunderboltOutlined style={{ color: '#722ED1' }} />
              <span>Create Accounting</span>
              {acctFlowLoading && <Tag icon={<LoadingOutlined />} color="processing">Running…</Tag>}
              {acctFlowDone && <Tag color="success" icon={<CheckCircleOutlined />}>Complete</Tag>}
              {acctFlowError && !acctFlowDone && <Tag color="error">Failed</Tag>}
            </Space>
          }
        >
          <Steps
            direction="vertical"
            size="small"
            current={acctFlowSteps.findIndex(s => s.status === 'process')}
            items={acctFlowSteps.map(s => ({
              title: s.title,
              status: s.status,
              description: s.desc,
            }))}
            style={{ marginTop: 8 }}
          />
          {acctFlowError && (
            <Alert
              type="error"
              showIcon
              message="Accounting Failed"
              description={acctFlowError}
              style={{ marginTop: 16 }}
            />
          )}
          {acctFlowDone && (
            <Alert
              type="success"
              showIcon
              message="Revaluation successfully accounted to GL"
              style={{ marginTop: 16 }}
            />
          )}
        </Modal>

        {/* GL Revaluation — Distribution Combinations LOV */}
        <Modal
          open={revalComboPickerOpen}
          onCancel={() => { setRevalComboPickerOpen(false); setDistComboNewOpen(false); }}
          footer={null}
          width={720}
          title={
            <Space>
              <SearchOutlined style={{ color: REDWOOD.info }} />
              <span>
                {revalComboPickerFor === 'gain' ? 'Gain' : 'Loss'} Account — GL Revaluation Distributions
              </span>
              <Tag color="purple">GL Revaluation</Tag>
              {!distComboLoading && <Tag color="default">{filteredDistCombos.length}</Tag>}
            </Space>
          }
        >
          {/* Search + Add New button */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Input.Search
              placeholder="Search combination or description…"
              value={revalComboSearch}
              onChange={e => setRevalComboSearch(e.target.value)}
              allowClear
              autoFocus
              style={{ flex: 1 }}
            />
            <Button
              icon={<PlusOutlined />}
              type={distComboNewOpen ? 'primary' : 'default'}
              onClick={() => {
                setDistComboNewOpen(v => !v);
                setDistComboNewName('');
                setDistComboNewDesc('');
              }}
            >
              New
            </Button>
          </div>

          {/* Inline new combination form */}
          {distComboNewOpen && (
            <div style={{
              border: `1px solid ${REDWOOD.info}`, borderRadius: 6,
              padding: '12px 14px', marginBottom: 12, background: '#e6f7ff11',
            }}>
              <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>New GL Revaluation Distribution</Text>
              <Row gutter={8} style={{ marginTop: 8 }}>
                <Col span={16}>
                  <div style={{ marginBottom: 4 }}>
                    <Text style={{ fontSize: 11 }}>Account Combination <span style={{ color: 'red' }}>*</span></Text>
                  </div>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small"
                      placeholder="Click segments button to select…"
                      value={distComboNewName}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', background: '#fafafa' }}
                      onClick={() => setDistComboAcctOpen(true)}
                    />
                    <Tooltip title="Build combination segment by segment">
                      <Button
                        size="small"
                        icon={<ApartmentOutlined />}
                        onClick={() => setDistComboAcctOpen(true)}
                      />
                    </Tooltip>
                  </Space.Compact>
                </Col>
                <Col span={8}>
                  <div style={{ marginBottom: 4 }}>
                    <Text style={{ fontSize: 11 }}>Description</Text>
                  </div>
                  <Input
                    size="small"
                    placeholder="e.g. FX Gain – AED"
                    value={distComboNewDesc}
                    onChange={e => setDistComboNewDesc(e.target.value)}
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <Button
                  type="primary"
                  size="small"
                  loading={distComboNewSaving}
                  disabled={!distComboNewName.trim()}
                  onClick={async () => {
                    setDistComboNewSaving(true);
                    try {
                      await createCombination({
                        combinationName: distComboNewName.trim(),
                        description:     distComboNewDesc.trim() || undefined,
                        glAccountDesc:   distComboNewName.trim(),
                        module:          'GL Revaluation',
                        status:          'ACTIVE',
                        createdBy:       user?.username || 'SYSTEM',
                      });
                      message.success('Distribution combination created');
                      // Reload list
                      const items = await searchCombinations({ module: 'GL Revaluation', status: 'ACTIVE' });
                      setDistComboList(items);
                      setDistComboNewOpen(false);
                      setDistComboNewName('');
                      setDistComboNewDesc('');
                    } catch (e: any) {
                      message.error(`Failed: ${e.message}`);
                    } finally {
                      setDistComboNewSaving(false);
                    }
                  }}
                >
                  Save &amp; Add
                </Button>
                <Button size="small" onClick={() => setDistComboNewOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* List */}
          {distComboLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          ) : (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {filteredDistCombos.length === 0 && (
                <div style={{ color: '#999', padding: 24, textAlign: 'center' }}>
                  No GL Revaluation distributions found. Use <strong>New</strong> to add one.
                </div>
              )}
              {filteredDistCombos.map(item => {
                const accountCode = item.glAccountDesc || item.combinationName;
                const displayDesc = item.description;
                const currentVal  = revalComboPickerFor === 'gain' ? revalGainCombo : revalLossCombo;
                const selected    = currentVal === accountCode;
                return (
                  <div
                    key={item.combinationId}
                    style={{
                      padding: '8px 12px', cursor: 'pointer', borderRadius: 4,
                      borderBottom: `1px solid ${REDWOOD.border}`,
                      background: selected ? '#e6f7ff' : undefined,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                    onClick={() => {
                      // Auto-set company segment from TB filter
                      const finalCode = revalCompany && accountCode
                        ? revalCompany + accountCode.slice(accountCode.indexOf('-'))
                        : accountCode;
                      if (revalComboPickerFor === 'gain') {
                        setRevalGainCombo(finalCode);
                        if (!revalLossCombo) setRevalLossCombo(finalCode);
                      } else {
                        setRevalLossCombo(finalCode);
                        if (!revalGainCombo) setRevalGainCombo(finalCode);
                      }
                      setRevalComboPickerOpen(false);
                    }}
                    onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#f0f5ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = selected ? '#e6f7ff' : ''; }}
                  >
                    {selected && <CheckCircleOutlined style={{ color: REDWOOD.info, fontSize: 14 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: 'monospace', fontSize: 12, display: 'block' }}>
                        {accountCode}
                      </Text>
                      {displayDesc && (
                        <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>
                          {displayDesc}
                        </Text>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* AccountSelector for the New form */}
          <AccountSelector
            visible={distComboAcctOpen}
            onCancel={() => setDistComboAcctOpen(false)}
            onSelect={(accountCode) => {
              setDistComboNewName(accountCode);
              setDistComboAcctOpen(false);
            }}
            lockedFirstSegment={revalCompany || undefined}
            initialValue={distComboNewName || undefined}
          />
        </Modal>

        <AccountSelector
          visible={revalAcctSelectorOpen}
          onCancel={() => { setRevalAcctSelectorOpen(false); setRevalAcctSelectorLineNum(null); }}
          onSelect={(accountCode) => {
            if (revalAcctSelectorLineNum !== null)
              setRevalPreviewRows(prev => prev.map(r => r.lineNum === revalAcctSelectorLineNum ? { ...r, combo: accountCode } : r));
            setRevalAcctSelectorOpen(false);
            setRevalAcctSelectorLineNum(null);
          }}
          lockedFirstSegment={revalCompany || undefined}
          initialValue={revalAcctSelectorLineNum !== null ? revalPreviewRows.find(r => r.lineNum === revalAcctSelectorLineNum)?.combo : undefined}
        />

        {/* Account Selector for Gain / Loss account — segments popup with company locked */}
        <AccountSelector
          visible={revalGainLossAcctOpen}
          onCancel={() => setRevalGainLossAcctOpen(false)}
          onSelect={(accountCode) => {
            if (revalGainLossAcctFor === 'gain') {
              setRevalGainCombo(accountCode);
              if (!revalLossCombo) setRevalLossCombo(accountCode);
            } else {
              setRevalLossCombo(accountCode);
              if (!revalGainCombo) setRevalGainCombo(accountCode);
            }
            setRevalGainLossAcctOpen(false);
          }}
          lockedFirstSegment={revalCompany || undefined}
          initialValue={revalGainLossAcctFor === 'gain' ? revalGainCombo : revalLossCombo}
        />
      </>
    );
  };

  const renderRrTBTab = (tab: TabData) => {
    if (tab.loading || tab.rrGenerating) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: REDWOOD.textSecondary, fontSize: 13 }}>
            {tab.rrGenerating ? 'Generating ReERP Trial Balance…' : 'Loading…'}
          </div>
        </div>
      );
    }
    if (tab.error) {
      return <Alert type="error" showIcon message="Error" description={tab.error} />;
    }

    const fmtAbs = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

    // Net amount renderer: positive = Dr (blue), negative = Cr shown in brackets (red)
    const fmtNet = (n: number) => {
      if (!n) return <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>0.00</Text>;
      return n > 0
        ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}>{fmtAbs(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>({fmtAbs(n)})</Text>;
    };

    const fmtDr = (n: number) =>
      n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{fmtAbs(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>0.00</Text>;

    const fmtCr = (n: number) =>
      n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmtAbs(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>0.00</Text>;

    const accountTypeColor: Record<string, string> = { A: '#e6f7ff', L: '#fff7e6', O: '#f6ffed', R: '#fff0f6', E: '#f9f0ff' };
    const accountTypeLabel: Record<string, string> = { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' };
    const typeTagColor: Record<string, string> = { A: 'blue', L: 'orange', O: 'green', R: 'magenta', E: 'purple' };

    // Filter
    let rows = tab.rrData.filter(r => {
      if (tab.selectedCompany && r.company !== tab.selectedCompany) return false;
      if (tab.selectedCurrency && r.currency_code !== tab.selectedCurrency) return false;
      return true;
    });

    if (tab.gridSearch.trim()) {
      const lc = tab.gridSearch.toLowerCase();
      rows = rows.filter(r =>
        r.account?.toLowerCase().includes(lc) ||
        r.account_desc?.toLowerCase().includes(lc) ||
        r.account_combination?.toLowerCase().includes(lc) ||
        r.company?.toLowerCase().includes(lc)
      );
    }

    // Group by account — sum net amounts across companies/currencies
    type GroupRow = {
      account: string; account_desc: string; account_type: string;
      opening: number; debit: number; credit: number; closing: number; ytd_net: number;
      entered_opening: number; entered_debit: number; entered_credit: number; entered_closing: number;
    };
    const grouped = new Map<string, GroupRow>();
    rows.forEach(r => {
      const k = r.account;
      if (!grouped.has(k)) {
        grouped.set(k, {
          account: r.account, account_desc: r.account_desc, account_type: r.account_type,
          opening: 0, debit: 0, credit: 0, closing: 0, ytd_net: 0,
          entered_opening: 0, entered_debit: 0, entered_credit: 0, entered_closing: 0,
        });
      }
      const g = grouped.get(k)!;
      g.opening         += r.opening         || 0;
      g.debit           += r.debit           || 0;
      g.credit          += r.credit          || 0;
      g.closing         += r.closing         || 0;
      g.ytd_net         += r.ytd_net         || 0;
      g.entered_opening += r.entered_opening || 0;
      g.entered_debit   += r.entered_debit   || 0;
      g.entered_credit  += r.entered_credit  || 0;
      g.entered_closing += r.entered_closing || 0;
    });

    const tableRows = Array.from(grouped.values()).sort((a, b) => a.account.localeCompare(b.account));

    const totals = tableRows.reduce(
      (acc, r) => ({
        opening:         acc.opening         + r.opening,
        debit:           acc.debit           + r.debit,
        credit:          acc.credit          + r.credit,
        closing:         acc.closing         + r.closing,
        ytd_net:         acc.ytd_net         + r.ytd_net,
        entered_opening: acc.entered_opening + r.entered_opening,
        entered_debit:   acc.entered_debit   + r.entered_debit,
        entered_credit:  acc.entered_credit  + r.entered_credit,
        entered_closing: acc.entered_closing + r.entered_closing,
      }),
      { opening: 0, debit: 0, credit: 0, closing: 0, ytd_net: 0,
        entered_opening: 0, entered_debit: 0, entered_credit: 0, entered_closing: 0 }
    );

    const columns = [
      {
        title: 'Type', dataIndex: 'account_type', key: 'account_type',
        width: 62, align: 'center' as const,
        render: (t: string) => (
          <Tag color={typeTagColor[t] || 'default'} style={{ fontSize: 10, margin: 0 }}>
            {accountTypeLabel[t] || t}
          </Tag>
        ),
      },
      {
        title: 'Account', dataIndex: 'account', key: 'account', width: 160,
        sorter: (a: GroupRow, b: GroupRow) => a.account.localeCompare(b.account),
        defaultSortOrder: 'ascend' as const,
        render: (v: string) => (
          <Space size={4}>
            <Text
              strong
              style={{ fontFamily: 'monospace', cursor: 'pointer', color: REDWOOD.info }}
              onClick={() => openDrillCombo(v, tab.rrData, tab.ledgerName, tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, ''), tab.key)}
            >
              {v}
            </Text>
            <Tooltip title="View combinations">
              <ApartmentOutlined
                style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 13 }}
                onClick={() => openDrillCombo(v, tab.rrData, tab.ledgerName, tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, ''), tab.key)}
              />
            </Tooltip>
            <Tooltip title="View journal lines">
              <UnorderedListOutlined
                style={{ color: '#722ed1', cursor: 'pointer', fontSize: 13 }}
                onClick={() => fetchDrillJournalLines(
                  tab.ledgerName,
                  tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, ''),
                  v,
                  null,
                )}
              />
            </Tooltip>
          </Space>
        ),
      },
      {
        title: 'Description', dataIndex: 'account_desc', key: 'account_desc',
        ellipsis: true,
        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
      },
      {
        title: <span style={{ color: '#1677ff' }}>Accounted</span>,
        children: [
          {
            title: 'Opening', dataIndex: 'opening', key: 'opening',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.opening - b.opening,
            render: fmtNet,
          },
          {
            title: 'Debit', dataIndex: 'debit', key: 'debit',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.debit - b.debit,
            render: fmtDr,
          },
          {
            title: 'Credit', dataIndex: 'credit', key: 'credit',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.credit - b.credit,
            render: fmtCr,
          },
          {
            title: 'Closing', dataIndex: 'closing', key: 'closing',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.closing - b.closing,
            render: fmtNet,
          },
        ],
      },
      {
        title: <span style={{ color: '#52c41a' }}>Entered</span>,
        children: [
          {
            title: 'Opening', dataIndex: 'entered_opening', key: 'entered_opening',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.entered_opening - b.entered_opening,
            render: fmtNet,
          },
          {
            title: 'Debit', dataIndex: 'entered_debit', key: 'entered_debit',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.entered_debit - b.entered_debit,
            render: fmtDr,
          },
          {
            title: 'Credit', dataIndex: 'entered_credit', key: 'entered_credit',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.entered_credit - b.entered_credit,
            render: fmtCr,
          },
          {
            title: 'Closing', dataIndex: 'entered_closing', key: 'entered_closing',
            align: 'right' as const, width: 130,
            sorter: (a: GroupRow, b: GroupRow) => a.entered_closing - b.entered_closing,
            render: fmtNet,
          },
        ],
      },
      {
        title: 'YTD Net', dataIndex: 'ytd_net', key: 'ytd_net',
        align: 'right' as const, width: 130,
        sorter: (a: GroupRow, b: GroupRow) => a.ytd_net - b.ytd_net,
        render: fmtNet,
      },
    ];

    const summaryRow = () => {
      const fmt = (v: number) =>
        new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
      const accValues = [totals.opening, totals.debit, totals.credit, totals.closing];
      const entValues = [totals.entered_opening, totals.entered_debit, totals.entered_credit, totals.entered_closing];
      const bg = '#f0f0f0';
      return (
        <Table.Summary fixed>
          <Table.Summary.Row style={{ background: bg, fontWeight: 700 }}>
            {/* Type col */}
            <SummaryCell index={0} style={{ background: bg }} />
            {/* Account col */}
            <SummaryCell index={1} style={{ background: bg }} />
            {/* Description col — holds the TOTAL label */}
            <SummaryCell index={2} style={{ textAlign: 'right', background: bg }}>
              <Text strong style={{ fontSize: 12 }}>TOTAL ({tableRows.length})</Text>
            </SummaryCell>
            {accValues.map((v, i) => (
              <SummaryCell key={`acc-${i}`} index={i + 3} style={{ textAlign: 'right', background: bg }}>
                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#1677ff' }}>{fmt(v)}</Text>
              </SummaryCell>
            ))}
            {entValues.map((v, i) => (
              <SummaryCell key={`ent-${i}`} index={i + 7} style={{ textAlign: 'right', background: bg }}>
                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#52c41a' }}>{fmt(v)}</Text>
              </SummaryCell>
            ))}
            <SummaryCell index={11} style={{ textAlign: 'right', background: bg }}>
              <Text strong style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(totals.ytd_net)}</Text>
            </SummaryCell>
          </Table.Summary.Row>
        </Table.Summary>
      );
    };

    return (
      <div>
        {/* Ledger / period info bar */}
        <Row gutter={8} style={{ marginBottom: 8 }}>
          <Col>
            <Tag icon={<BankOutlined />} color="geekblue" style={{ fontSize: 12, padding: '2px 8px' }}>
              {tab.ledgerName}
            </Tag>
          </Col>
          <Col>
            <Tag color="purple" style={{ fontSize: 12, padding: '2px 8px' }}>
              {tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, '')}
            </Tag>
          </Col>
          <Col>
            <Tag color="default" style={{ fontSize: 12, padding: '2px 8px' }}>
              {tableRows.length} accounts
            </Tag>
          </Col>
        </Row>

        {/* Filters */}
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={6}>
            <Select placeholder="All Companies" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={tab.selectedCompany}
              onChange={v => updateTabFilter(tab.key, 'selectedCompany', v ?? null)}
              options={allCompanies.length > 0 ? allCompanies : tab.companies.map(c => ({ value: c, label: c }))}
            />
          </Col>
          <Col span={6}>
            <Select placeholder="All Currencies" allowClear style={{ width: '100%' }}
              value={tab.selectedCurrency}
              onChange={v => updateTabFilter(tab.key, 'selectedCurrency', v ?? null)}
              options={tab.currencies.map(c => ({ value: c, label: c }))}
            />
          </Col>
          <Col span={6}>
            <Input.Search placeholder="Search account / description…"
              value={tab.gridSearch}
              onChange={e => updateTabSearch(tab.key, e.target.value)}
              allowClear
            />
          </Col>
          <Col span={6} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              type="primary"
              disabled={(tabSelections[tab.key] || []).length !== 1}
              style={{ background: '#d46b08', borderColor: '#d46b08' }}
              onClick={() => openRevalModal(tab.key, (tabSelections[tab.key] || [])[0])}
            >
              Revalue by Currency
            </Button>
            <Button
              size="small"
              disabled={(tabSelections[tab.key] || []).length !== 1}
              style={{ borderColor: '#d46b08', color: '#d46b08' }}
              onClick={() => {
                const accountKey = (tabSelections[tab.key] || [])[0];
                if (accountKey) openDrillCombo(accountKey, tab.rrData, tab.ledgerName, tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, ''), tab.key);
              }}
            >
              Revalue by Segments
            </Button>
            <Button
              icon={<FileExcelOutlined />}
              size="small"
              onClick={() => handleRrExport(tab, tableRows, totals)}
              style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
            >
              Excel
            </Button>
            <Tooltip title={
              tabs.find(t => t.tabType === 'fusion' && t.periodName === tab.periodName.replace(/^(?:ReERP|Dynamic):\s*/, ''))
                ? 'Export Fusion TB + ReERP TB to one Excel file (2 sheets)'
                : 'Open Fusion TB for this period first'
            }>
              <Button
                icon={<FileExcelOutlined />}
                size="small"
                onClick={() => handleExportBoth(tab)}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success, color: '#fff' }}
              >
                Export Both
              </Button>
            </Tooltip>
            <Button
              icon={<CheckCircleOutlined />}
              size="small"
              onClick={() => handleRrReconcile(tab)}
              style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
            >
              Reconcile
            </Button>
          </Col>
        </Row>

        {/* Account type legend */}
        <Space style={{ marginBottom: 10 }} wrap>
          {Object.entries(accountTypeLabel).map(([k, v]) => (
            <Tag key={k} color={typeTagColor[k]} style={{ fontSize: 11 }}>
              {v}{k === 'R' || k === 'E' ? ' — P&L (resets Jan)' : ' — BS (carries fwd)'}
            </Tag>
          ))}
          <Tag style={{ fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}>positive = Dr balance</Tag>
          <Tag style={{ fontSize: 11, color: REDWOOD.primary, borderColor: REDWOOD.primary }}>(brackets) = Cr balance</Tag>
        </Space>

        <Table
          dataSource={tableRows}
          columns={columns}
          rowKey="account"
          size="small"
          pagination={false}
          scroll={{ x: 1600 }}
          summary={summaryRow}
          onRow={(r: any) => ({ style: { background: accountTypeColor[r.account_type] || '#fff' } })}
        />
      </div>
    );
  };

  // ── Render: Combinations drill-down modal ────────────────
  const renderDrillComboModal = () => {
    const fmtN = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    const lc   = drillComboSearch.toLowerCase();
    const rows = drillComboRows.filter(r =>
      !lc ||
      r.account_combination?.toLowerCase().includes(lc) ||
      r.currency_code?.toLowerCase().includes(lc) ||
      r.company?.toLowerCase().includes(lc)
    );

    const cols = [
      { title: 'Combination', dataIndex: 'account_combination', key: 'account_combination',
        render: (v: string) => (
          <Space size={4}>
            <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>
            <Tooltip title="View journal lines for this combination">
              <UnorderedListOutlined
                style={{ color: '#722ed1', cursor: 'pointer' }}
                onClick={() => {
                  // ledger and period are stored when the combos modal was opened
                  setDrillComboVisible(false);
                  fetchDrillJournalLines(drillComboLedger, drillComboPeriod, drillComboAccount, v);
                }}
              />
            </Tooltip>
          </Space>
        ),
      },
      { title: 'Co', dataIndex: 'company',       key: 'company',       width: 60 },
      { title: 'Ccy', dataIndex: 'currency_code', key: 'currency_code', width: 60 },
      { title: 'Opening', dataIndex: 'opening', key: 'opening', align: 'right' as const, width: 130,
        render: (n: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtN(n ?? 0)}</Text> },
      { title: 'Debit',   dataIndex: 'debit',   key: 'debit',   align: 'right' as const, width: 130,
        render: (n: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12, color: '#237804' }}>{fmtN(n ?? 0)}</Text> },
      { title: 'Credit',  dataIndex: 'credit',  key: 'credit',  align: 'right' as const, width: 130,
        render: (n: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12, color: REDWOOD.primary }}>{fmtN(n ?? 0)}</Text> },
      { title: 'Closing', dataIndex: 'closing', key: 'closing', align: 'right' as const, width: 130,
        render: (n: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtN(n ?? 0)}</Text> },
    ];

    return (
      <Modal
        open={drillComboVisible}
        onCancel={() => setDrillComboVisible(false)}
        footer={null}
        width={1100}
        title={
          <Space>
            <ApartmentOutlined style={{ color: REDWOOD.info }} />
            <span>Combinations — Account <Text strong style={{ fontFamily: 'monospace' }}>{drillComboAccount}</Text></span>
            <Tag color="blue">{rows.length} rows</Tag>
          </Space>
        }
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <Input.Search
            placeholder="Search combination / currency / company…"
            value={drillComboSearch}
            onChange={e => setDrillComboSearch(e.target.value)}
            allowClear
            style={{ flex: 1 }}
          />
          {drillComboTabKey && (
            <Button
              type="primary"
              size="small"
              style={{ background: '#d46b08', borderColor: '#d46b08', whiteSpace: 'nowrap' }}
              onClick={() => {
                setDrillComboVisible(false);
                setRevalExcludedCombos(new Set());
                openRevalModal(drillComboTabKey, drillComboAccount);
              }}
            >
              Revalue by Segments
            </Button>
          )}
        </div>
        <Table
          dataSource={rows}
          columns={cols}
          rowKey={r => `${r.account_combination}-${r.currency_code}`}
          size="small"
          pagination={false}
          scroll={{ x: 800, y: 400 }}
        />
      </Modal>
    );
  };

  // ── Render: Journal Lines drill-down modal ────────────────
  const renderDrillJnlModal = () => {
    const fmtN = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

    const lc   = drillJnlSearch.toLowerCase();
    const rows = drillJnlData.filter(r =>
      !lc ||
      r.je_name?.toLowerCase().includes(lc) ||
      r.account_combination?.toLowerCase().includes(lc) ||
      r.line_description?.toLowerCase().includes(lc) ||
      r.je_description?.toLowerCase().includes(lc) ||
      r.source?.toLowerCase().includes(lc) ||
      r.category?.toLowerCase().includes(lc)
    );

    const totalDr = rows.reduce((s, r) => s + (r.accounted_dr || 0), 0);
    const totalCr = rows.reduce((s, r) => s + (r.accounted_cr || 0), 0);

    const cols = [
      { title: 'Journal Name', dataIndex: 'je_name', key: 'je_name', width: 180, ellipsis: true,
        render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
      { title: 'Source', dataIndex: 'source', key: 'source', width: 100, ellipsis: true },
      { title: 'Category', dataIndex: 'category', key: 'category', width: 100, ellipsis: true },
      { title: 'Date', dataIndex: 'effective_date', key: 'effective_date', width: 100,
        render: (v: string) => v ? new Date(v).toLocaleDateString() : '—' },
      { title: 'Combination', dataIndex: 'account_combination', key: 'account_combination', width: 220,
        render: (v: string) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text> },
      { title: 'Ccy', dataIndex: 'currency_code', key: 'currency_code', width: 55 },
      { title: 'Ent Dr', dataIndex: 'entered_dr', key: 'entered_dr', align: 'right' as const, width: 120,
        render: (n: number) => n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{fmtN(n)}</Text> : <Text style={{ color: '#aaa' }}>0.00</Text> },
      { title: 'Ent Cr', dataIndex: 'entered_cr', key: 'entered_cr', align: 'right' as const, width: 120,
        render: (n: number) => n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmtN(n)}</Text> : <Text style={{ color: '#aaa' }}>0.00</Text> },
      { title: 'Acc Dr', dataIndex: 'accounted_dr', key: 'accounted_dr', align: 'right' as const, width: 130,
        render: (n: number) => n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{fmtN(n)}</Text> : <Text style={{ color: '#aaa' }}>0.00</Text> },
      { title: 'Acc Cr', dataIndex: 'accounted_cr', key: 'accounted_cr', align: 'right' as const, width: 130,
        render: (n: number) => n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmtN(n)}</Text> : <Text style={{ color: '#aaa' }}>0.00</Text> },
      { title: 'Description', dataIndex: 'line_description', key: 'line_description', ellipsis: true,
        render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
    ];

    const summary = () => (
      <Table.Summary>
        <Table.Summary.Row style={{ background: '#f0f0f0', fontWeight: 700 }}>
          <Table.Summary.Cell index={0} colSpan={7} align="right">
            <Text strong style={{ fontSize: 12 }}>TOTAL ({rows.length} lines)</Text>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={7} align="right">
            <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{fmtN(totalDr)}</Text>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={8} align="right">
            <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmtN(totalCr)}</Text>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={9} colSpan={2} />
        </Table.Summary.Row>
      </Table.Summary>
    );

    return (
      <Modal
        open={drillJnlVisible}
        onCancel={() => setDrillJnlVisible(false)}
        footer={null}
        width={1300}
        title={
          <Space>
            <UnorderedListOutlined style={{ color: '#722ed1' }} />
            <span>Journal Lines — Account <Text strong style={{ fontFamily: 'monospace' }}>{drillJnlAccount}</Text></span>
            {drillJnlCombo && <Tag color="purple" style={{ fontFamily: 'monospace', fontSize: 11 }}>{drillJnlCombo}</Tag>}
            <Tag color="blue">{drillJnlPeriod}</Tag>
            {!drillJnlLoading && <Tag color="default">{rows.length} lines</Tag>}
          </Space>
        }
      >
        {drillJnlLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : drillJnlError ? (
          <Alert type="error" showIcon message={drillJnlError} />
        ) : (
          <>
            <Input.Search
              placeholder="Search journal name / description / source / category…"
              value={drillJnlSearch}
              onChange={e => setDrillJnlSearch(e.target.value)}
              allowClear
              style={{ marginBottom: 12 }}
            />
            <Table
              dataSource={rows}
              columns={cols}
              rowKey={r => `${r.line_id}-${r.je_header_id}-${r.line_num}`}
              size="small"
              pagination={false}
              scroll={{ x: 1200, y: 450 }}
              summary={summary}
            />
          </>
        )}
      </Modal>
    );
  };

  // ── Multi-Year Retained Earnings rollforward ─────────────────
  const calcMultiYearRE = async () => {
    if (!reCalcTab || !reYearFrom || !reYearTo || reYearFrom > reYearTo) {
      message.warning('Select a valid year range'); return;
    }
    setReYearLoading(true);
    setReYearRows([]);
    setReYearError(null);

    const ledger = reCalcTab.ledgerName;
    const yearRange: number[] = [];
    for (let y = reYearFrom; y <= reYearTo; y++) yearRange.push(y);

    const rows: { year: number; lastPeriod: string; revenue: number; expenses: number; netPL: number; reBalance: number; openingRE: number; closingRE: number }[] = [];
    let prevClosingRE: number | null = null;  // null = not yet known (will seed from GL)

    for (let i = 0; i < yearRange.length; i++) {
      const year = yearRange[i];
      setReYearProgress(`Fetching year ${year} (${i + 1}/${yearRange.length})…`);

      // Find the last period of this year
      const yearPeriods = periods
        .filter(p => p.period_year === year && p.ledger_name === ledger)
        .sort((a, b) => b.period_number - a.period_number);

      if (yearPeriods.length === 0) {
        const openingRE = prevClosingRE ?? 0;
        rows.push({ year, lastPeriod: '—', revenue: 0, expenses: 0, netPL: 0, reBalance: 0, openingRE, closingRE: openingRE });
        continue;
      }

      const lastPeriod = yearPeriods[0];
      try {
        const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandard}`
          + `?ledger_name=${encodeURIComponent(ledger)}`
          + `&period_name=${encodeURIComponent(lastPeriod.period_name_id)}`
          + `&limit=10000`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const d = await res.json();
        const allItems: RrTBRecord[] = d.items ?? [];
        // Apply company filter client-side (same as the YTD TB tab does)
        const items = reYearCompany ? allItems.filter(r => r.company === reYearCompany) : allItems;

        const revenue  = items.filter(r => r.account_type === 'R').reduce((s, r) => s + (r.closing || 0), 0);
        const expenses = items.filter(r => r.account_type === 'E').reduce((s, r) => s + (r.closing || 0), 0);
        const netPL    = revenue + expenses;  // as-is: negative = profit (Cr revenue dominates)
        const reAcct   = items.filter(r => r.account === RE_ACCOUNT).reduce((s, r) => s + (r.closing || 0), 0);
        // Seed: first year openingRE = RE account GL balance (before this year's P&L)
        // Subsequent years: openingRE = previous year's closingRE (chained rollforward)
        const openingRE: number  = prevClosingRE ?? (reAcct - netPL);
        const closingRE: number  = openingRE + netPL;
        prevClosingRE = closingRE;
        rows.push({ year, lastPeriod: lastPeriod.period_name_id, revenue, expenses, netPL, reBalance: reAcct, openingRE, closingRE });
      } catch (_err) {
        const openingRE = prevClosingRE ?? 0;
        rows.push({ year, lastPeriod: lastPeriod.period_name_id, revenue: 0, expenses: 0, netPL: 0, reBalance: 0, openingRE, closingRE: openingRE });
      }
    }

    setReYearRows(rows);
    setReYearSelected(rows.map(r => r.year));   // auto-select all calculated years
    setReYearProgress('');
    setReYearLoading(false);
  };

  // ── Save selected RE years to RR_GL_RETAINED_EARNINGS ───────
  const RE_ACCOUNT = '3112100';
  const saveRetainedEarnings = async () => {
    if (!reCalcTab || reYearSelected.length === 0) {
      message.warning('Select at least one year to save'); return;
    }
    const rowsToSave = reYearRows
      .filter(r => reYearSelected.includes(r.year))
      .map(r => ({
        ledgerName:   reCalcTab.ledgerName,
        year:         r.year,
        lastPeriod:   r.lastPeriod,
        company:      reYearCompany || null,
        reAccount:    RE_ACCOUNT,
        revenue:      r.revenue,
        expenses:     r.expenses,
        netPL:        r.netPL,
        reBalance:    r.reBalance,
        openingRe:    r.openingRE,
        closingRe:    r.closingRE,
        cumulativeRE: r.closingRE,
      }));
    const url  = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.retainedEarningsSave}`;
    const body = JSON.stringify(rowsToSave, null, 2);
    setReApiDebug({ url, body, response: '', status: null });
    setReSaving(true);
    try {
      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(rowsToSave),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      setReApiDebug(prev => prev ? { ...prev, status: res.status, response: JSON.stringify(data, null, 2) } : null);
      if (res.ok && data.status === 'ok') {
        message.success(`Saved ${data.saved} retained earnings record(s)`);
        setReYearSelected([]);
      } else {
        message.error(`Save failed (HTTP ${res.status}): ${data.message || text.slice(0, 200)}`);
      }
    } catch (e: any) {
      setReApiDebug(prev => prev ? { ...prev, status: 0, response: e.message } : null);
      message.error(`Save error: ${e.message}`);
    } finally {
      setReSaving(false);
    }
  };

  // ── Render: Retained Earnings calculator popup ───────────────

  // ── Export Retained Earnings to Excel ─────────────────────────
  const exportReCalcExcel = () => {
    if (!reCalcTab) return;
    const tab    = reCalcTab;
    const period = tab.periodName.replace(/^YTD:\s*/, '');
    const rows   = tab.rrData;
    const fmtN   = (n: number) => Math.abs(n);

    const revenueRows  = rows.filter(r => r.account_type === 'R');
    const expenseRows  = rows.filter(r => r.account_type === 'E');
    const revenueTotal = revenueRows.reduce((s, r) => s + (r.closing || 0), 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + (r.closing || 0), 0);
    const netPL        = revenueTotal + expenseTotal;
    const reCurrentClosing = rows.filter(r => r.account === RE_ACCOUNT).reduce((s, r) => s + (r.closing || 0), 0);
    const reAdjusted   = reCurrentClosing + netPL;

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Summary ──────────────────────────────────────
    const summaryData = [
      ['Retained Earnings Calculation'],
      ['Ledger', tab.ledgerName],
      ['Period', period],
      [],
      ['Item', 'Amount'],
      ['Total Revenue',                  fmtN(revenueTotal)],
      ['Total Expenses',                 fmtN(expenseTotal)],
      ['Net Profit / (Loss)',            netPL],
      ['RE Account Current Balance',     fmtN(reCurrentClosing)],
      ['Adjusted RE Balance',            reAdjusted],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 32 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // ── Sheet 2: Revenue Accounts ─────────────────────────────
    const revData = [
      ['Account', 'Description', 'Closing Balance'],
      ...revenueRows
        .sort((a, b) => (a.account || '').localeCompare(b.account || ''))
        .map(r => [r.account, r.account_desc || '', r.closing || 0]),
      [],
      ['', 'Total Revenue', fmtN(revenueTotal)],
    ];
    const wsRev = XLSX.utils.aoa_to_sheet(revData);
    wsRev['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsRev, 'Revenue');

    // ── Sheet 3: Expense Accounts ─────────────────────────────
    const expData = [
      ['Account', 'Description', 'Closing Balance'],
      ...expenseRows
        .sort((a, b) => (a.account || '').localeCompare(b.account || ''))
        .map(r => [r.account, r.account_desc || '', r.closing || 0]),
      [],
      ['', 'Total Expenses', fmtN(expenseTotal)],
    ];
    const wsExp = XLSX.utils.aoa_to_sheet(expData);
    wsExp['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

    // ── Sheet 4: Multi-Year (if calculated) ───────────────────
    if (reYearRows.length > 0) {
      const yearData = [
        ['Year', 'Last Period', 'Opening RE', 'Revenue', 'Expenses', 'Net P&L', `RE Acct (${RE_ACCOUNT})`, 'Closing RE'],
        ...reYearRows.map(r => [r.year, r.lastPeriod, r.openingRE, r.revenue, r.expenses, r.netPL, r.reBalance, r.closingRE]),
      ];
      const wsYears = XLSX.utils.aoa_to_sheet(yearData);
      wsYears['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsYears, 'Multi-Year');
    }

    const buf  = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    saveAs(blob, `retained_earnings_${tab.ledgerName.replace(/\s+/g, '_')}_${period.replace(/\s+/g, '_')}.xlsx`);
  };

  const renderReCalcModal = () => {
    const tab = reCalcTab;
    if (!tab) return null;

    const fmtN = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
    // Show actual value as-is (negative for Cr balances like Revenue/RE)
    const fmtRaw = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    const fmtSigned = (n: number) =>
      n >= 0
        ? <Text style={{ fontFamily: 'monospace', color: '#237804' }}>{fmtN(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>({fmtN(n)})</Text>;

    const period = tab.periodName.replace(/^YTD:\s*/, '');
    const rows   = tab.rrData;

    // Revenue rows (type R) — credit balance, stored as negative closing
    const revenueRows = rows.filter(r => r.account_type === 'R');
    const revenueTotal = revenueRows.reduce((s, r) => s + (r.closing || 0), 0);

    // Expense rows (type E) — debit balance, stored as positive closing
    const expenseRows = rows.filter(r => r.account_type === 'E');
    const expenseTotal = expenseRows.reduce((s, r) => s + (r.closing || 0), 0);

    // Net P&L as-is: revenue (Cr, -ve) + expenses (Dr, +ve)
    // negative result = profit (revenue dominates), positive = loss
    const netPL = revenueTotal + expenseTotal;

    // Retained Earnings account current balance
    const reRows = rows.filter(r => r.account === RE_ACCOUNT);
    const reCurrentClosing = reRows.reduce((s, r) => s + (r.closing || 0), 0);
    const reAdjusted = reCurrentClosing + netPL;   // profit (negative netPL) increases Cr RE (makes more negative)

    const isProfit = netPL <= 0;  // negative sum = revenue > expenses = profit

    // Summary table for revenue accounts
    const revSummary = revenueRows.map(r => ({
      key: r.account,
      account: r.account,
      desc: r.account_desc,
      closing: r.closing || 0,
    })).sort((a, b) => a.account.localeCompare(b.account));

    // Summary table for expense accounts
    const expSummary = expenseRows.map(r => ({
      key: r.account,
      account: r.account,
      desc: r.account_desc,
      closing: r.closing || 0,
    })).sort((a, b) => a.account.localeCompare(b.account));

    const acctCol = [
      { title: 'Account', dataIndex: 'account', key: 'account', width: 110,
        render: (v: string) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text> },
      { title: 'Description', dataIndex: 'desc', key: 'desc', ellipsis: true,
        render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
      { title: 'Balance', dataIndex: 'closing', key: 'closing', align: 'right' as const, width: 130,
        render: (v: number) => fmtSigned(v) },
    ];

    return (
      <Modal
        open={reCalcVisible}
        onCancel={() => setReCalcVisible(false)}
        footer={null}
        width={860}
        title={
          <Space>
            <CalculatorOutlined style={{ color: '#722ed1' }} />
            <span>Retained Earnings Calculation</span>
            <Tag color="purple">{period}</Tag>
            <Tag color="geekblue">{tab.ledgerName}</Tag>
          </Space>
        }
      >
        {/* Summary cards */}
        <Row gutter={12} style={{ marginBottom: 20 }}>
          <Col span={6}>
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: '12px 16px', background: '#f6ffed' }}>
              <div style={{ fontSize: 11, color: REDWOOD.textSecondary, marginBottom: 4 }}>Total Revenue</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#237804' }}>
                {fmtRaw(revenueTotal)}
              </div>
              <div style={{ fontSize: 10, color: REDWOOD.textSecondary }}>{revenueRows.length} accounts · Cr (−ve)</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: '12px 16px', background: '#fff1f0' }}>
              <div style={{ fontSize: 11, color: REDWOOD.textSecondary, marginBottom: 4 }}>Total Expenses</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: REDWOOD.primary }}>
                {fmtRaw(expenseTotal)}
              </div>
              <div style={{ fontSize: 10, color: REDWOOD.textSecondary }}>{expenseRows.length} accounts · Dr (+ve)</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ border: `2px solid ${isProfit ? '#52c41a' : REDWOOD.primary}`, borderRadius: 8, padding: '12px 16px', background: isProfit ? '#f6ffed' : '#fff1f0' }}>
              <div style={{ fontSize: 11, color: REDWOOD.textSecondary, marginBottom: 4 }}>Net {isProfit ? 'Income' : 'Loss'}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: isProfit ? '#237804' : REDWOOD.primary }}>
                {fmtRaw(netPL)}
              </div>
              <Tag color={isProfit ? 'success' : 'error'} style={{ marginTop: 4 }}>
                {isProfit ? '▲ PROFIT' : '▼ LOSS'}
              </Tag>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ border: '2px solid #722ed1', borderRadius: 8, padding: '12px 16px', background: '#f9f0ff' }}>
              <div style={{ fontSize: 11, color: REDWOOD.textSecondary, marginBottom: 4 }}>
                RE Account ({RE_ACCOUNT})
              </div>
              <div style={{ fontSize: 10, color: REDWOOD.textSecondary, marginBottom: 2 }}>
                Current: <span style={{ fontFamily: 'monospace' }}>{fmtRaw(reCurrentClosing)}</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#722ed1' }}>
                {fmtRaw(reAdjusted)}
              </div>
              <div style={{ fontSize: 10, color: REDWOOD.textSecondary }}>After closing P&amp;L</div>
            </div>
          </Col>
        </Row>

        {/* Formula note */}
        <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 14px', marginBottom: 16, fontSize: 12, color: REDWOOD.textSecondary }}>
          <strong>Formula:</strong>&nbsp; RE Adjusted = RE Current ({fmtRaw(reCurrentClosing)}) + Net P&amp;L ({fmtRaw(netPL)}) = <strong style={{ color: '#722ed1' }}>{fmtRaw(reAdjusted)}</strong>
          &nbsp;·&nbsp; Revenue and Expense accounts close to zero; balance transfers to Retained Earnings.
        </div>

        {/* Revenue breakdown */}
        <Collapse size="small" style={{ marginBottom: 8 }} items={[{
          key: 'rev',
          label: <span style={{ color: '#237804', fontWeight: 600 }}>Revenue Accounts — {revenueRows.length} accounts, Total: {fmtRaw(revenueTotal)}</span>,
          children: (
            <Table
              dataSource={revSummary}
              columns={acctCol}
              size="small"
              pagination={false}
              scroll={{ y: 200 }}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row style={{ background: '#f6ffed' }}>
                    <Table.Summary.Cell index={0} colSpan={2} align="right">
                      <Text strong style={{ fontSize: 12 }}>Total Revenue</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: '#237804' }}>{fmtRaw(revenueTotal)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          ),
        }]} />

        {/* Expense breakdown */}
        <Collapse size="small" items={[{
          key: 'exp',
          label: <span style={{ color: REDWOOD.primary, fontWeight: 600 }}>Expense Accounts — {expenseRows.length} accounts, Total: {fmtRaw(expenseTotal)}</span>,
          children: (
            <Table
              dataSource={expSummary}
              columns={acctCol}
              size="small"
              pagination={false}
              scroll={{ y: 200 }}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row style={{ background: '#fff1f0' }}>
                    <Table.Summary.Cell index={0} colSpan={2} align="right">
                      <Text strong style={{ fontSize: 12 }}>Total Expenses</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmtRaw(expenseTotal)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          ),
        }]} />

        {/* Multi-Year Retained Earnings Rollforward */}
        <Divider style={{ marginTop: 20, marginBottom: 12 }}>
          <span style={{ color: '#722ed1', fontWeight: 600, fontSize: 13 }}>Multi-Year Retained Earnings Rollforward</span>
        </Divider>

        <Row gutter={8} align="middle" style={{ marginBottom: 12, flexWrap: 'wrap', rowGap: 8 }}>
          <Col>
            <span style={{ fontSize: 12, marginRight: 4 }}>From Year:</span>
            <Select
              size="small"
              style={{ width: 100 }}
              placeholder="From"
              value={reYearFrom ?? undefined}
              onChange={(v: number) => { setReYearFrom(v); setReYearRows([]); }}
              options={[...new Set(periods.filter(p => p.ledger_name === reCalcTab?.ledgerName).map(p => p.period_year))].sort((a, b) => a - b).map(y => ({ label: String(y), value: y }))}
            />
          </Col>
          <Col>
            <span style={{ fontSize: 12, marginRight: 4 }}>To Year:</span>
            <Select
              size="small"
              style={{ width: 100 }}
              placeholder="To"
              value={reYearTo ?? undefined}
              onChange={(v: number) => { setReYearTo(v); setReYearRows([]); }}
              options={[...new Set(periods.filter(p => p.ledger_name === reCalcTab?.ledgerName).map(p => p.period_year))].sort((a, b) => a - b).map(y => ({ label: String(y), value: y }))}
            />
          </Col>
          <Col>
            <span style={{ fontSize: 12, marginRight: 4 }}>Company:</span>
            <Select
              size="small"
              allowClear
              placeholder="All companies"
              style={{ width: 160 }}
              value={reYearCompany ?? undefined}
              onChange={(v: string | undefined) => { setReYearCompany(v ?? null); setReYearRows([]); }}
              options={allCompanies.length > 0
                ? allCompanies
                : [...new Set(tab.rrData.map(r => r.company).filter(Boolean))].sort().map(c => ({ label: c, value: c }))
              }
            />
          </Col>
          <Col>
            <Button
              size="small"
              type="primary"
              style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
              loading={reYearLoading}
              disabled={!reYearFrom || !reYearTo}
              onClick={calcMultiYearRE}
            >
              Calculate
            </Button>
          </Col>
          {reYearProgress && (
            <Col flex="1">
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{reYearProgress}</Text>
            </Col>
          )}
        </Row>
        {reYearCompany && (
          <div style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>
              Filtering by company: <Text strong style={{ color: '#722ed1' }}>{reYearCompany}</Text>
              {' '}— amounts reflect only this company's accounts.
            </Text>
          </div>
        )}

        {reYearError && (
          <Alert type="error" showIcon message={reYearError} style={{ marginBottom: 12 }} />
        )}

        {reYearRows.length > 0 && (() => {
          const totalRevenue  = reYearRows.reduce((s, r) => s + r.revenue,  0);
          const totalExpenses = reYearRows.reduce((s, r) => s + r.expenses, 0);
          const totalNetPL    = reYearRows.reduce((s, r) => s + r.netPL,    0);
          const lastRow       = reYearRows[reYearRows.length - 1];

          const allYears = reYearRows.map(r => r.year);
          const allChecked = allYears.every(y => reYearSelected.includes(y));
          const someChecked = allYears.some(y => reYearSelected.includes(y));

          const multiYearCols = [
            {
              title: (
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                  onChange={e => setReYearSelected(e.target.checked ? allYears : [])}
                  style={{ cursor: 'pointer' }}
                />
              ),
              key: 'select',
              width: 40,
              render: (_: any, r: { year: number }) => (
                <input
                  type="checkbox"
                  checked={reYearSelected.includes(r.year)}
                  onChange={e => setReYearSelected(prev =>
                    e.target.checked ? [...prev, r.year] : prev.filter(y => y !== r.year)
                  )}
                  style={{ cursor: 'pointer' }}
                />
              ),
            },
            {
              title: 'Year',
              dataIndex: 'year',
              key: 'year',
              width: 70,
              render: (v: number) => (
                <Text style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v}</Text>
              ),
            },
            {
              title: 'Last Period',
              dataIndex: 'lastPeriod',
              key: 'lastPeriod',
              width: 120,
              render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag>,
            },
            {
              title: 'Opening RE',
              dataIndex: 'openingRE',
              key: 'openingRE',
              align: 'right' as const,
              width: 150,
              render: (v: number, r: { year: number }) => (
                <input
                  key={`opening-${r.year}-${v}`}
                  type="number"
                  defaultValue={v}
                  onBlur={e => {
                    const newOpening = parseFloat(e.target.value);
                    if (isNaN(newOpening) || newOpening === v) return;
                    setReYearRows(prev => {
                      const updated = [...prev];
                      const idx = updated.findIndex(x => x.year === r.year);
                      if (idx === -1) return prev;
                      for (let i = idx; i < updated.length; i++) {
                        const opening = i === idx ? newOpening : updated[i - 1].closingRE;
                        updated[i] = { ...updated[i], openingRE: opening, closingRE: opening + updated[i].netPL };
                      }
                      return updated;
                    });
                  }}
                  style={{
                    width: '100%', textAlign: 'right', fontFamily: 'monospace',
                    color: v < 0 ? '#722ed1' : '#237804',
                    border: '1px solid #d3adf7', borderRadius: 4,
                    padding: '2px 6px', background: '#faf5ff', fontSize: 12,
                  }}
                />
              ),
            },
            {
              title: 'Revenue (Cr)',
              dataIndex: 'revenue',
              key: 'revenue',
              align: 'right' as const,
              width: 120,
              render: (v: number) => (
                <Text style={{ fontFamily: 'monospace', color: '#237804' }}>{fmtRaw(v)}</Text>
              ),
            },
            {
              title: 'Expenses (Dr)',
              dataIndex: 'expenses',
              key: 'expenses',
              align: 'right' as const,
              width: 120,
              render: (v: number) => (
                <Text style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmtRaw(v)}</Text>
              ),
            },
            {
              title: 'Net P&L',
              dataIndex: 'netPL',
              key: 'netPL',
              align: 'right' as const,
              width: 130,
              render: (v: number) => (
                <Space size={4}>
                  <Text style={{ fontFamily: 'monospace', color: v <= 0 ? '#237804' : REDWOOD.primary }}>
                    {fmtRaw(v)}
                  </Text>
                  <Tag color={v <= 0 ? 'success' : 'error'} style={{ fontSize: 10, marginLeft: 2 }}>
                    {v <= 0 ? '▲' : '▼'}
                  </Tag>
                </Space>
              ),
            },
            {
              title: `RE Acct (${RE_ACCOUNT})`,
              dataIndex: 'reBalance',
              key: 'reBalance',
              align: 'right' as const,
              width: 130,
              render: (v: number) => (
                <Text style={{ fontFamily: 'monospace', color: '#722ed1' }}>{fmtRaw(v)}</Text>
              ),
            },
            {
              title: 'Closing RE',
              dataIndex: 'closingRE',
              key: 'closingRE',
              align: 'right' as const,
              width: 130,
              render: (v: number) => (
                <Text style={{ fontFamily: 'monospace', fontWeight: 700, color: '#722ed1' }}>{fmtRaw(v)}</Text>
              ),
            },
          ];

          return (
            <>
            <div style={{ fontSize: 11, color: REDWOOD.textSecondary, marginBottom: 8, background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6, padding: '6px 12px' }}>
              <strong>Opening RE</strong> = RE account GL balance (seeded from first year) → carried forward each year.&nbsp;
              <strong>Closing RE = Opening RE + Net P&amp;L.</strong>&nbsp;
              Negative = credit balance (normal for equity).
            </div>
            <Table
              dataSource={reYearRows.map(r => ({ ...r, key: r.year }))}
              columns={multiYearCols}
              size="small"
              bordered
              pagination={false}
              scroll={{ x: 1000 }}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row style={{ background: '#f9f0ff' }}>
                    <Table.Summary.Cell index={0} colSpan={3} align="right">
                      <Text strong style={{ fontSize: 12 }}>Totals</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>—</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: '#237804' }}>{fmtRaw(totalRevenue)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmtRaw(totalExpenses)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: totalNetPL <= 0 ? '#237804' : REDWOOD.primary }}>{fmtRaw(totalNetPL)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} />
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: '#722ed1' }}>
                        {lastRow ? fmtRaw(lastRow.closingRE) : '0.00'}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />

            {/* API debug panel */}
            {reApiDebug && (
              <div style={{ marginTop: 12, borderRadius: 6, border: '1px solid #adc6ff', overflow: 'hidden' }}>
                <div style={{ background: '#f0f5ff', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ApiOutlined style={{ color: '#2f54eb' }} />
                  <Text style={{ fontSize: 12, fontWeight: 700, color: '#2f54eb' }}>API Debug — Save Retained Earnings</Text>
                  {reApiDebug.status !== null && (
                    <Tag color={reApiDebug.status >= 200 && reApiDebug.status < 300 ? 'green' : 'red'}>
                      HTTP {reApiDebug.status}
                    </Tag>
                  )}
                  <Button size="small" type="text" style={{ marginLeft: 'auto', fontSize: 11 }}
                    onClick={() => setReApiDebug(null)}>✕</Button>
                </div>
                <div style={{ padding: '8px 12px', background: '#fafafa' }}>
                  <div style={{ marginBottom: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>POST URL</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
                      background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, padding: '4px 8px' }}>
                      <code style={{ flex: 1, fontSize: 11, color: '#d46b08', wordBreak: 'break-all' }}>{reApiDebug.url}</code>
                      <CopyOutlined style={{ cursor: 'pointer', color: '#595959', flexShrink: 0 }}
                        onClick={() => { navigator.clipboard.writeText(reApiDebug.url); message.success('URL copied'); }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: reApiDebug.response ? 6 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Request Body (JSON)</Text>
                      <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 11 }}
                        onClick={() => { navigator.clipboard.writeText(reApiDebug.body); message.success('Body copied'); }} />
                    </div>
                    <pre style={{ margin: 0, padding: '6px 8px', background: '#1e1e1e', color: '#9cdcfe',
                      borderRadius: 4, fontSize: 10, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre' }}>
                      {reApiDebug.body}
                    </pre>
                  </div>
                  {reApiDebug.response && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Response</Text>
                        <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 11 }}
                          onClick={() => { navigator.clipboard.writeText(reApiDebug.response); message.success('Copied'); }} />
                      </div>
                      <pre style={{ margin: 0, padding: '6px 8px', background: '#1e1e1e',
                        color: reApiDebug.status !== null && reApiDebug.status >= 200 && reApiDebug.status < 300 ? '#b5f5a0' : '#ff9999',
                        borderRadius: 4, fontSize: 10, maxHeight: 140, overflow: 'auto', whiteSpace: 'pre' }}>
                        {reApiDebug.response}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Save bar */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', background: '#f9f0ff', borderRadius: 8,
              border: '1px solid #d3adf7' }}>
              <span style={{ fontSize: 12, color: '#722ed1', fontWeight: 600 }}>
                Save to Database
              </span>
              <span style={{ fontSize: 12, color: '#595959' }}>
                {reYearSelected.length} of {reYearRows.length} year(s) selected
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Button size="small" onClick={() => setReYearSelected(allYears)}>Select All</Button>
                <Button size="small" onClick={() => setReYearSelected([])}>Clear</Button>
                <Button
                  size="small"
                  icon={<FileExcelOutlined />}
                  onClick={exportReCalcExcel}
                  style={{ color: '#237804', borderColor: '#237804' }}
                >
                  Export Excel
                </Button>
                <Button
                  size="small" type="primary"
                  style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
                  icon={<SaveOutlined />}
                  loading={reSaving}
                  disabled={reYearSelected.length === 0}
                  onClick={saveRetainedEarnings}
                >
                  Save Retained Earnings
                </Button>
              </div>
            </div>
            </>
          );
        })()}
      </Modal>
    );
  };

  // ── Render: Dynamic YTD Trial Balance tab ─────────────────
  const renderRrYtdTBTab = (tab: TabData) => {
    if (tab.loading) {
      return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
    }
    if (tab.error) {
      return <Alert type="error" showIcon message="Error" description={tab.error} />;
    }

    const fmtAbs = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

    const fmtNet = (n: number) => {
      if (!n) return <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>0.00</Text>;
      return n > 0
        ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}>{fmtAbs(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>({fmtAbs(n)})</Text>;
    };
    const fmtDr = (n: number) =>
      n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{fmtAbs(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>0.00</Text>;
    const fmtCr = (n: number) =>
      n ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.primary }}>{fmtAbs(n)}</Text>
        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.textSecondary }}>0.00</Text>;

    const accountTypeColor: Record<string, string> = { A: '#e6f7ff', L: '#fff7e6', O: '#f6ffed', R: '#fff0f6', E: '#f9f0ff' };
    const accountTypeLabel: Record<string, string> = { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' };
    const typeTagColor: Record<string, string> = { A: 'blue', L: 'orange', O: 'green', R: 'magenta', E: 'purple' };

    let rows = tab.rrData.filter(r => {
      if (tab.selectedCompany && r.company !== tab.selectedCompany) return false;
      if (tab.selectedCurrency && r.currency_code !== tab.selectedCurrency) return false;
      return true;
    });

    if (tab.gridSearch.trim()) {
      const lc = tab.gridSearch.toLowerCase();
      rows = rows.filter(r =>
        r.account?.toLowerCase().includes(lc) ||
        r.account_desc?.toLowerCase().includes(lc) ||
        r.account_combination?.toLowerCase().includes(lc) ||
        r.company?.toLowerCase().includes(lc)
      );
    }

    type YtdGroupRow = {
      account: string; account_desc: string; account_type: string;
      ytd_opening: number; ytd_debit: number; ytd_credit: number; closing: number;
      ytd_entered_opening: number; ytd_entered_debit: number; ytd_entered_credit: number; entered_closing: number;
    };
    const grouped = new Map<string, YtdGroupRow>();
    rows.forEach(r => {
      const k = r.account;
      if (!grouped.has(k)) {
        grouped.set(k, {
          account: r.account, account_desc: r.account_desc, account_type: r.account_type,
          ytd_opening: 0, ytd_debit: 0, ytd_credit: 0, closing: 0,
          ytd_entered_opening: 0, ytd_entered_debit: 0, ytd_entered_credit: 0, entered_closing: 0,
        });
      }
      const g = grouped.get(k)!;
      g.ytd_opening         += r.ytd_opening         || 0;
      g.ytd_debit           += r.ytd_debit           || 0;
      g.ytd_credit          += r.ytd_credit          || 0;
      g.closing             += r.closing             || 0;
      g.ytd_entered_opening += r.ytd_entered_opening || 0;
      g.ytd_entered_debit   += r.ytd_entered_debit   || 0;
      g.ytd_entered_credit  += r.ytd_entered_credit  || 0;
      g.entered_closing     += r.entered_closing     || 0;
    });

    const tableRows = Array.from(grouped.values()).sort((a, b) => a.account.localeCompare(b.account));

    const totals = tableRows.reduce(
      (acc, r) => ({
        ytd_opening:         acc.ytd_opening         + r.ytd_opening,
        ytd_debit:           acc.ytd_debit           + r.ytd_debit,
        ytd_credit:          acc.ytd_credit          + r.ytd_credit,
        closing:             acc.closing             + r.closing,
        ytd_entered_opening: acc.ytd_entered_opening + r.ytd_entered_opening,
        ytd_entered_debit:   acc.ytd_entered_debit   + r.ytd_entered_debit,
        ytd_entered_credit:  acc.ytd_entered_credit  + r.ytd_entered_credit,
        entered_closing:     acc.entered_closing     + r.entered_closing,
      }),
      { ytd_opening: 0, ytd_debit: 0, ytd_credit: 0, closing: 0,
        ytd_entered_opening: 0, ytd_entered_debit: 0, ytd_entered_credit: 0, entered_closing: 0 }
    );

    // Use the outer allCompanies state (loaded from COA value set with descriptions);
    // fall back to codes-only from tab data if the value set hasn't loaded yet.
    const ytdCompanyOptions = allCompanies.length > 0
      ? allCompanies
      : [...new Set(tab.rrData.map(r => r.company).filter(Boolean))].sort().map(c => ({ value: c, label: c }));

    const columns = [
      {
        title: 'Type', dataIndex: 'account_type', key: 'account_type',
        width: 55, align: 'center' as const,
        render: (t: string) => (
          <Tag color={typeTagColor[t] || 'default'} style={{ fontSize: 10, margin: 0 }}>
            {accountTypeLabel[t] || t}
          </Tag>
        ),
      },
      {
        title: <span style={{ color: '#d46b08' }}>Account</span>, dataIndex: 'account', key: 'account', width: 145,
        sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.account.localeCompare(b.account),
        defaultSortOrder: 'ascend' as const,
        render: (v: string) => (
          <Space size={4}>
            <Text strong style={{ fontFamily: 'monospace', color: '#d46b08' }}>{v}</Text>
            <Tooltip title="View combinations">
              <ApartmentOutlined
                style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 13 }}
                onClick={() => openDrillCombo(v, tab.rrData, tab.ledgerName, tab.periodName.replace(/^YTD:\s*/, ''), tab.key)}
              />
            </Tooltip>
          </Space>
        ),
      },
      {
        title: 'Description', dataIndex: 'account_desc', key: 'account_desc',
        width: 180, ellipsis: true,
        render: (v: string) => v === 'Retained Earnings'
          ? (
            <Space size={6}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '50%',
                background: '#13c2c2', color: '#fff',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>M</span>
              <Text style={{ fontSize: 12 }}>Retained Earnings B/F</Text>
            </Space>
          )
          : <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
      },
      {
        title: <span style={{ color: '#1677ff' }}>Accounted (YTD)</span>,
        children: [
          {
            title: 'YTD Opening', dataIndex: 'ytd_opening', key: 'ytd_opening',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.ytd_opening - b.ytd_opening,
            render: fmtNet,
          },
          {
            title: 'YTD Debit', dataIndex: 'ytd_debit', key: 'ytd_debit',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.ytd_debit - b.ytd_debit,
            render: fmtDr,
          },
          {
            title: 'YTD Credit', dataIndex: 'ytd_credit', key: 'ytd_credit',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.ytd_credit - b.ytd_credit,
            render: fmtCr,
          },
          {
            title: 'Closing', dataIndex: 'closing', key: 'closing',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.closing - b.closing,
            render: fmtNet,
          },
        ],
      },
      ...(tab.showEntered ? [{
        title: <span style={{ color: '#08979c' }}>Entered (YTD)</span>,
        onHeaderCell: () => ({ style: { background: '#e6fffb' } }),
        children: [
          {
            title: 'YTD Opening', dataIndex: 'ytd_entered_opening', key: 'ytd_entered_opening',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.ytd_entered_opening - b.ytd_entered_opening,
            render: fmtNet,
            onHeaderCell: () => ({ style: { background: '#e6fffb' } }),
            onCell: () => ({ style: { background: '#f0fffe' } }),
          },
          {
            title: 'YTD Debit', dataIndex: 'ytd_entered_debit', key: 'ytd_entered_debit',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.ytd_entered_debit - b.ytd_entered_debit,
            render: fmtDr,
            onHeaderCell: () => ({ style: { background: '#e6fffb' } }),
            onCell: () => ({ style: { background: '#f0fffe' } }),
          },
          {
            title: 'YTD Credit', dataIndex: 'ytd_entered_credit', key: 'ytd_entered_credit',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.ytd_entered_credit - b.ytd_entered_credit,
            render: fmtCr,
            onHeaderCell: () => ({ style: { background: '#e6fffb' } }),
            onCell: () => ({ style: { background: '#f0fffe' } }),
          },
          {
            title: 'Closing', dataIndex: 'entered_closing', key: 'entered_closing',
            align: 'right' as const, width: 115,
            sorter: (a: YtdGroupRow, b: YtdGroupRow) => a.entered_closing - b.entered_closing,
            render: fmtNet,
            onHeaderCell: () => ({ style: { background: '#e6fffb' } }),
            onCell: () => ({ style: { background: '#f0fffe' } }),
          },
        ],
      }] : []),
    ];

    const fmt = (v: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

    const summaryRow = () => {
      const accValues = [totals.ytd_opening, totals.ytd_debit, totals.ytd_credit, totals.closing];
      const entValues = [totals.ytd_entered_opening, totals.ytd_entered_debit, totals.ytd_entered_credit, totals.entered_closing];
      const bg = '#f0f0f0';
      // rowSelection adds a checkbox col at index 0; Type=1, Account=2, Description=3, accValues start at 4
      return (
        <Table.Summary fixed>
          <Table.Summary.Row style={{ background: bg, fontWeight: 700 }}>
            <SummaryCell index={0} style={{ background: bg }} />
            <SummaryCell index={1} style={{ background: bg }} />
            <SummaryCell index={2} style={{ background: bg }} />
            <SummaryCell index={3} style={{ textAlign: 'right', background: bg }}>
              <Text strong style={{ fontSize: 12 }}>TOTAL ({tableRows.length})</Text>
            </SummaryCell>
            {accValues.map((v, i) => (
              <SummaryCell key={`acc-${i}`} index={i + 4} style={{ textAlign: 'right', background: bg }}>
                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#1677ff' }}>{fmt(v)}</Text>
              </SummaryCell>
            ))}
            {tab.showEntered && entValues.map((v, i) => (
              <SummaryCell key={`ent-${i}`} index={i + 8} style={{ textAlign: 'right', background: bg }}>
                <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#08979c' }}>{fmt(v)}</Text>
              </SummaryCell>
            ))}
          </Table.Summary.Row>
        </Table.Summary>
      );
    };

    return (
      <div>
        <Row gutter={8} style={{ marginBottom: 8 }}>
          <Col>
            <Tag icon={<BankOutlined />} color="geekblue" style={{ fontSize: 12, padding: '2px 8px' }}>
              {tab.ledgerName}
            </Tag>
          </Col>
          <Col>
            <Tag color="blue" style={{ fontSize: 12, padding: '2px 8px' }}>
              {tab.periodName.replace(/^YTD:\s*/, '')}
            </Tag>
          </Col>
          <Col>
            <Tag color="default" style={{ fontSize: 12, padding: '2px 8px' }}>
              {tableRows.length} accounts
            </Tag>
          </Col>
          <Col>
            <Tag color="blue" style={{ fontSize: 12, padding: '2px 8px', fontWeight: 600 }}>
              YTD — cumulative from period 1 of fiscal year
            </Tag>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 6 }}>
          <Col flex="auto" />
          <Col style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              size="small"
              icon={<CalculatorOutlined />}
              style={{ borderColor: '#722ed1', color: '#722ed1' }}
              onClick={() => {
                setReCalcTab(tab);
                setReCalcVisible(true);
                setReYearRows([]);
                setReYearError(null);
                setReYearCompany(null);
                // Auto-set range: earliest available year → current tab's year
                const ledgerYears = [...new Set(periods.filter(p => p.ledger_name === tab.ledgerName).map(p => p.period_year))].sort((a, b) => a - b);
                const tabYear = periods.find(p => tab.periodName.includes(p.period_name_id))?.period_year ?? (ledgerYears[ledgerYears.length - 1] ?? null);
                setReYearFrom(ledgerYears[0] ?? null);
                setReYearTo(tabYear);
              }}
            >
              Retained Earnings
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={reFetchingTabKey === tab.key}
              style={{ borderColor: '#13c2c2', color: '#13c2c2' }}
              onClick={async () => {
                const periodId = tab.periodName.replace(/^YTD:\s*/, '').split('·')[0].trim();
                const periodInfo = periods.find(p => p.period_name_id === periodId && p.ledger_name === tab.ledgerName);
                const currentYear = periodInfo?.period_year;
                if (!currentYear) { message.warning('Could not determine year for this tab'); return; }
                // RE opening = closing of previous year's last period (Mar of year-1)
                const prevYear = currentYear - 1;
                const lastPeriod = periods.find(p =>
                  p.ledger_name === tab.ledgerName &&
                  p.period_year === prevYear &&
                  p.period_number === 12
                );
                const reUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandardRE}`
                  + `?ledger_name=${encodeURIComponent(tab.ledgerName)}`
                  + (lastPeriod ? `&period_name=${encodeURIComponent(lastPeriod.period_name_id)}` : `&period_year=${prevYear}`);
                setReLastUrl(prev => ({ ...prev, [tab.key]: reUrl }));
                if (!lastPeriod) { message.warning(`No closing period found for year ${prevYear} — will try period_year filter`); }
                setReFetchingTabKey(tab.key);
                try {
                  const res = await fetch(reUrl, { headers: { Accept: 'application/json' } });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const data = await res.json();
                  const reItems: RrTBRecord[] = data.items || [];
                  if (reItems.length === 0) {
                    message.info(`No saved RE data found for year ${prevYear} (${lastPeriod?.period_name_id ?? '—'})`);
                    return;
                  }
                  // Transform RE rows: closing becomes the B/F opening balance for current period
                  const mergedItems: RrTBRecord[] = reItems.map(r => ({
                    ...r,
                    account_desc:        'Retained Earnings',
                    opening:              r.closing,
                    debit:                0,
                    credit:               0,
                    closing:              r.closing,
                    entered_opening:      r.closing,
                    entered_debit:        0,
                    entered_credit:       0,
                    entered_closing:      r.closing,
                    ytd_opening:          r.closing,
                    ytd_debit:            0,
                    ytd_credit:           0,
                    ytd_entered_opening:  r.closing,
                    ytd_entered_debit:    0,
                    ytd_entered_credit:   0,
                  }));
                  const reClosing = mergedItems.reduce((s, r) => s + (r.closing || 0), 0);
                  const reAccount = mergedItems[0]?.account;
                  setTabs(prev => prev.map(t => {
                    if (t.key !== tab.key) return t;
                    const hasExisting = t.rrData.some(r => r.account === reAccount);
                    let newData: RrTBRecord[];
                    if (hasExisting) {
                      newData = t.rrData.map(r =>
                        r.account === reAccount
                          ? { ...r, account_desc: 'Retained Earnings', opening: reClosing, closing: reClosing, entered_opening: reClosing, entered_closing: reClosing, ytd_opening: reClosing, ytd_entered_opening: reClosing }
                          : r
                      );
                    } else {
                      newData = [...t.rrData.filter(r => r.account_desc !== 'Retained Earnings'), ...mergedItems];
                    }
                    return { ...t, rrData: newData };
                  }));
                  message.success(`RE opening balance loaded from ${lastPeriod?.period_name_id ?? prevYear} — ${reClosing.toLocaleString('en-US', { minimumFractionDigits: 2 })} set as YTD Opening`);
                } catch (e: any) {
                  message.error(`Fetch RE failed: ${e.message}`);
                } finally {
                  setReFetchingTabKey(null);
                }
              }}
            >
              Fetch RE
            </Button>
            {tab.rrData.some(r => r.account_desc === 'Retained Earnings') && (
              <Tag color="cyan" style={{ fontSize: 10, marginLeft: 0 }}>RE ✓</Tag>
            )}
            {reLastUrl[tab.key] && (
              <Tooltip
                title={
                  <div style={{ maxWidth: 560 }}>
                    <div style={{ fontSize: 11, marginBottom: 4, color: '#91d5ff' }}>RE Endpoint (last fetch)</div>
                    <code style={{ fontSize: 10, wordBreak: 'break-all', color: '#fff' }}>{reLastUrl[tab.key]}</code>
                    <div style={{ marginTop: 6 }}>
                      <Button size="small" icon={<CopyOutlined />} type="link" style={{ color: '#69c0ff', padding: 0, fontSize: 11 }}
                        onClick={() => { navigator.clipboard.writeText(reLastUrl[tab.key]); message.success('URL copied'); }}>
                        Copy
                      </Button>
                    </div>
                  </div>
                }
                overlayStyle={{ maxWidth: 580 }}
                color="#001529"
              >
                <Button size="small" icon={<ApiOutlined />} style={{ borderColor: '#096dd9', color: '#096dd9' }} />
              </Tooltip>
            )}
            <Button
              size="small"
              type="primary"
              disabled={(tabSelections[tab.key] || []).length !== 1}
              style={{ background: '#d46b08', borderColor: '#d46b08' }}
              onClick={() => openRevalModal(tab.key, (tabSelections[tab.key] || [])[0])}
            >
              Revalue by Currency
            </Button>
            <Button
              size="small"
              disabled={(tabSelections[tab.key] || []).length !== 1}
              style={{ borderColor: '#d46b08', color: '#d46b08' }}
              onClick={() => {
                const accountKey = (tabSelections[tab.key] || [])[0];
                if (accountKey) openDrillCombo(accountKey, tab.rrData, tab.ledgerName, tab.periodName.replace(/^YTD:\s*/, ''), tab.key);
              }}
            >
              Revalue by Segments
            </Button>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={5}>
            <Select placeholder="All Companies" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={tab.selectedCompany}
              onChange={v => updateTabFilter(tab.key, 'selectedCompany', v ?? null)}
              options={ytdCompanyOptions}
            />
          </Col>
          <Col span={4}>
            <Select placeholder="All Currencies" allowClear style={{ width: '100%' }}
              value={tab.selectedCurrency}
              onChange={v => updateTabFilter(tab.key, 'selectedCurrency', v ?? null)}
              options={tab.currencies.map(c => ({ value: c, label: c }))}
            />
          </Col>
          <Col span={5}>
            <Input.Search placeholder="Search account / description…"
              value={tab.gridSearch}
              onChange={e => updateTabSearch(tab.key, e.target.value)}
              allowClear
            />
          </Col>
          <Col span={10} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              icon={<FileExcelOutlined />}
              size="small"
              disabled={tableRows.length === 0}
              style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={() => {
                const exportDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const exportTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const period = tab.periodName.replace(/^YTD:\s*/, '');
                const company = tab.selectedCompany || 'All Companies';
                const currency = tab.selectedCurrency || 'All Currencies';

                const ws = XLSX.utils.aoa_to_sheet([]);
                const hasEntered = tab.showEntered;
                const colCount = hasEntered ? 11 : 7;
                const lastCol = String.fromCharCode(64 + colCount);

                const headerRows: (string | number | null)[][] = [
                  ['YTD Trial Balance'],
                  [],
                  ['Ledger',      tab.ledgerName, '', 'Period',    period],
                  ['Company',     company,         '', 'Currency',  currency],
                  ['Export Date', `${exportDate} ${exportTime}`, '', 'Accounts', tableRows.length],
                  [],
                  hasEntered
                    ? ['Type', 'Account', 'Description', 'YTD Opening', 'YTD Debit', 'YTD Credit', 'YTD Closing', 'Ent. YTD Opening', 'Ent. YTD Debit', 'Ent. YTD Credit', 'Ent. Closing']
                    : ['Type', 'Account', 'Description', 'YTD Opening', 'YTD Debit', 'YTD Credit', 'YTD Closing'],
                ];
                XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: 'A1' });

                const dataRows = tableRows.map(r => hasEntered
                  ? [r.account_type, r.account, r.account_desc, r.ytd_opening, r.ytd_debit, r.ytd_credit, r.closing, r.ytd_entered_opening, r.ytd_entered_debit, r.ytd_entered_credit, r.entered_closing]
                  : [r.account_type, r.account, r.account_desc, r.ytd_opening, r.ytd_debit, r.ytd_credit, r.closing]
                );
                XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: `A${headerRows.length + 1}` });

                const dataStart = headerRows.length + 1;
                const dataEnd   = dataStart + tableRows.length - 1;

                const numCols = hasEntered ? ['D','E','F','G','H','I','J','K'] : ['D','E','F','G'];
                const totalRow: (string | object)[] = ['', 'TOTAL', ''];
                numCols.forEach((_, i) => {
                  const col = String.fromCharCode(68 + i);
                  totalRow.push({ f: `SUM(${col}${dataStart}:${col}${dataEnd})` });
                });
                XLSX.utils.sheet_add_aoa(ws, [totalRow], { origin: `A${dataEnd + 1}` });

                // Title style
                ws['A1'] = { v: 'YTD Trial Balance', t: 's', s: { font: { bold: true, sz: 14 } } };
                ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }];

                // Header label bold
                ['A3','A4','A5','D3','D4','D5'].forEach(addr => {
                  if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F0F4FF' } } };
                });

                // Column heading row
                const headingRow = headerRows.length;
                for (let c = 0; c < colCount; c++) {
                  const addr = `${String.fromCharCode(65 + c)}${headingRow}`;
                  if (ws[addr]) ws[addr].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1F4E79' } }, alignment: { horizontal: c < 3 ? 'left' : 'right' } };
                }

                // Data rows: number format + alternate shading
                for (let row = dataStart; row <= dataEnd + 1; row++) {
                  numCols.forEach(col => { const a = `${col}${row}`; if (ws[a]) ws[a].z = '#,##0.00'; });
                  if ((row - dataStart) % 2 === 1)
                    for (let c = 0; c < colCount; c++) { const a = `${String.fromCharCode(65 + c)}${row}`; if (ws[a]) ws[a].s = { ...(ws[a].s || {}), fill: { fgColor: { rgb: 'F7F9FC' } } }; }
                }

                // Totals row
                for (let c = 0; c < colCount; c++) {
                  const a = `${String.fromCharCode(65 + c)}${dataEnd + 1}`;
                  if (ws[a]) ws[a].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8F0FE' } }, ...(c >= 3 ? { z: '#,##0.00', alignment: { horizontal: 'right' } } : {}) };
                }

                ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 28 }, ...Array(colCount - 3).fill({ wch: 18 })];
                ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataEnd + 1, c: colCount - 1 } });

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'YTD TB');
                const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                saveAs(new Blob([buf], { type: 'application/octet-stream' }), `YTD_TB_${tab.ledgerName}_${period}_${tab.selectedCompany || 'All'}.xlsx`);
              }}
            >
              Excel
            </Button>
            <Button
              size="small"
              icon={<LineChartOutlined />}
              disabled={(tabSelections[tab.key] || []).length !== 1}
              onClick={() => {
                const selAccount = (tabSelections[tab.key] || [])[0] as string;
                const row = tableRows.find(r => r.account === selAccount);
                setYtdMovPendingAccount(selAccount);
                setYtdMovPendingDesc(row?.account_desc ?? '');
                setYtdMovPendingLedger(tab.ledgerName);
                setYtdMovPendingCompany(tab.selectedCompany);
                setYtdMovPendingCurrency(tab.selectedCurrency);
                const sorted = [...periods].sort((a, b) =>
                  a.period_year !== b.period_year ? a.period_year - b.period_year : a.period_number - b.period_number
                );
                setYtdMovPromptYear(sorted[0]?.period_year ?? null);
                setYtdMovPromptPeriod(sorted[0]?.period_name_id ?? null);
                setYtdMovPromptVisible(true);
              }}
            >
              Show YTD Balances
            </Button>
            <Switch
              size="small"
              checked={tab.showEntered}
              onChange={v => updateTabEntered(tab.key, v)}
              checkedChildren="Entered ✓"
              unCheckedChildren="Entered"
            />
          </Col>
        </Row>

        <Space style={{ marginBottom: 10 }} wrap>
          {Object.entries(accountTypeLabel).map(([k, v]) => (
            <Tag key={k} color={typeTagColor[k]} style={{ fontSize: 11 }}>
              {v}{k === 'R' || k === 'E' ? ' — P&L (resets each fiscal year)' : ' — BS (carries forward)'}
            </Tag>
          ))}
          <Tag style={{ fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}>positive = Dr balance</Tag>
          <Tag style={{ fontSize: 11, color: REDWOOD.primary, borderColor: REDWOOD.primary }}>(brackets) = Cr balance</Tag>
        </Space>

        <Table
          dataSource={tableRows}
          columns={columns}
          rowKey="account"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          summary={summaryRow}

          rowSelection={{
            type: 'checkbox',
            selectedRowKeys: tabSelections[tab.key] || [],
            onChange: keys => setTabSelections(prev => ({ ...prev, [tab.key]: keys as string[] })),
          }}
          onRow={(r: any) => ({ style: { background: accountTypeColor[r.account_type] || '#fff' } })}
        />
      </div>
    );
  };

  // Build tab items
  const tabItems = [
    {
      key: 'periods',
      label: (
        <span>
          <CalendarOutlined style={{ marginRight: 8 }} />
          Periods
        </span>
      ),
      children: renderPeriodsTab(),
      closable: false,
    },
    ...tabs.map(tab => ({
      key: tab.key,
      label: (
        <span>
          {tab.tabType === 'reerp'
            ? <BarChartOutlined style={{ marginRight: 6, color: REDWOOD.success }} />
            : tab.tabType === 'reerp-dynamic'
            ? <ThunderboltOutlined style={{ marginRight: 6, color: '#722ed1' }} />
            : tab.tabType === 'reerp-ytd'
            ? <BarChartOutlined style={{ marginRight: 6, color: '#0958d9' }} />
            : <TableOutlined style={{ marginRight: 8 }} />}
          {tab.periodName}
        </span>
      ),
      children: tab.tabType === 'reerp-ytd'
        ? renderRrYtdTBTab(tab)
        : (tab.tabType === 'reerp' || tab.tabType === 'reerp-dynamic') ? renderRrTBTab(tab) : renderTBTab(tab),
      closable: true,
    })),
    ...(lsVisible ? [{
      key: 'lines-summary',
      label: (
        <span>
          <BarsOutlined style={{ marginRight: 6, color: REDWOOD.primary }} />
          Lines Summary
          {lsPeriod && <Tag style={{ marginLeft: 6, fontSize: 10 }}>{lsPeriod}</Tag>}
        </span>
      ),
      children: renderLinesSummaryTab(),
      closable: true,
    }] : []),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.surfaceSecondary }}>
      <Content style={{ padding: '24px 48px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Breadcrumb
            items={[
              { title: <Link to="/"><HomeOutlined /> Home</Link> },
              { title: <Link to="/gl">General Ledger</Link> },
              { title: 'Trial Balance' },
            ]}
            style={{ marginBottom: 16 }}
          />

          <Row justify="space-between" align="middle">
            <Col>
              <Title level={2} style={{ margin: 0, color: REDWOOD.textPrimary }}>
                <TableOutlined style={{ marginRight: 12, color: REDWOOD.primary }} />
                Trial Balance
              </Title>
              <Text type="secondary">
                View and analyze trial balance by period with company and currency filters
              </Text>
            </Col>
            <Col>
              <Space>
                <Button
                  icon={<BarsOutlined />}
                  onClick={handleOpenLinesSummary}
                  style={{ borderColor: REDWOOD.primary, color: REDWOOD.primary }}
                >
                  Lines Summary
                </Button>
                <Button
                  icon={<ApiOutlined />}
                  type={apiPanelVisible ? 'primary' : 'default'}
                  style={apiPanelVisible
                    ? { background: REDWOOD.info, borderColor: REDWOOD.info }
                    : { borderColor: REDWOOD.info, color: REDWOOD.info }
                  }
                  onClick={() => setApiPanelVisible(v => !v)}
                >
                  API
                </Button>
              </Space>
            </Col>
          </Row>

          {/* API Panel */}
          {apiPanelVisible && (
            <Card
              size="small"
              style={{ marginTop: 12, background: '#f5f8ff', border: `1px solid ${REDWOOD.info}`, borderRadius: 8 }}
              title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><Text strong style={{ color: REDWOOD.info }}>API Endpoints — Trial Balance</Text></Space>}
            >
              {Object.entries(apiCalls).map(([key, call]) => (
                <div key={key} style={{ marginBottom: 12 }}>
                  <Space align="start" wrap>
                    <Tag color={call.method === 'POST' ? 'blue' : 'green'} style={{ fontFamily: 'monospace' }}>{call.method}</Tag>
                    <Text strong style={{ fontSize: 12 }}>{call.label}</Text>
                    {call.method === 'GET' && (
                      <Button
                        size="small"
                        icon={call.running ? <LoadingOutlined /> : <ApiOutlined />}
                        onClick={() => testEndpoint(key)}
                        disabled={call.running || !call.url}
                      >
                        Test
                      </Button>
                    )}
                    {call.status !== null && (
                      <Tag
                        color={call.ok ? 'success' : 'error'}
                        icon={call.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                      >
                        {call.status} · {call.durationMs}ms
                      </Tag>
                    )}
                  </Space>
                  {call.url && (
                    <div style={{ marginTop: 2 }}>
                      <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>{call.url}</Text>
                    </div>
                  )}
                  {call.body && (
                    <pre style={{ fontSize: 11, background: '#fff', border: '1px solid #e5e5e5', padding: 6, borderRadius: 4, maxHeight: 120, overflow: 'auto', marginTop: 4 }}>
                      {call.body}
                    </pre>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Main Content - Tabs */}
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          type="editable-card"
          hideAdd
          onEdit={(targetKey, action) => {
            if (action === 'remove' && typeof targetKey === 'string') {
              closeTab(targetKey);
            }
          }}
          items={tabItems}
          style={{
            background: REDWOOD.surface,
            padding: 16,
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        />

        {/* Account Detail Modal */}
        <Modal
          title={
            <Space>
              <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>
                {detailModalData?.account}
              </Text>
              <Text type="secondary">-</Text>
              <Text>{detailModalData?.account_desc}</Text>
            </Space>
          }
          open={detailModalVisible}
          onCancel={() => setDetailModalVisible(false)}
          footer={null}
          width={1000}
        >
          {detailModalData && (
            <Table
              dataSource={detailModalData.rows}
              rowKey={(record, index) => `${record.company}-${record.currency}-${record.sub_account}-${index}`}
              size="small"
              pagination={{ pageSize: 20 }}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: 'Company',
                  dataIndex: 'company',
                  key: 'company',
                  width: 80,
                  render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
                },
                {
                  title: 'LOB',
                  dataIndex: 'lob',
                  key: 'lob',
                  width: 60,
                  render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
                },
                {
                  title: 'Dept',
                  dataIndex: 'department',
                  key: 'department',
                  width: 60,
                  render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
                },
                {
                  title: 'Sub Acct',
                  dataIndex: 'sub_account',
                  key: 'sub_account',
                  width: 80,
                  render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
                },
                {
                  title: 'Analysis',
                  dataIndex: 'analysis',
                  key: 'analysis',
                  width: 70,
                  render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
                },
                {
                  title: 'IC',
                  dataIndex: 'intercompany',
                  key: 'intercompany',
                  width: 50,
                  render: (text: string) => <Text style={{ fontFamily: 'monospace' }}>{text}</Text>,
                },
                {
                  title: 'Currency',
                  dataIndex: 'currency',
                  key: 'currency',
                  width: 70,
                  render: (text: string) => <Tag>{text}</Tag>,
                },
                {
                  title: 'Opening',
                  dataIndex: 'opening_balance',
                  key: 'opening_balance',
                  width: 110,
                  align: 'right' as const,
                  render: (value: number) => (
                    <Text style={{ fontFamily: 'monospace', color: value < 0 ? REDWOOD.error : REDWOOD.textPrimary }}>
                      {formatCurrency(value)}
                    </Text>
                  ),
                },
                {
                  title: 'Debit',
                  dataIndex: 'debit',
                  key: 'debit',
                  width: 110,
                  align: 'right' as const,
                  render: (value: number) => (
                    <Text style={{ fontFamily: 'monospace', color: value > 0 ? REDWOOD.info : REDWOOD.textSecondary }}>
                      {formatCurrency(value)}
                    </Text>
                  ),
                },
                {
                  title: 'Credit',
                  dataIndex: 'credit',
                  key: 'credit',
                  width: 110,
                  align: 'right' as const,
                  render: (value: number) => (
                    <Text style={{ fontFamily: 'monospace', color: value > 0 ? REDWOOD.success : REDWOOD.textSecondary }}>
                      {formatCurrency(value)}
                    </Text>
                  ),
                },
                {
                  title: 'Closing',
                  dataIndex: 'closing_balance',
                  key: 'closing_balance',
                  width: 110,
                  align: 'right' as const,
                  render: (value: number) => (
                    <Text strong style={{ fontFamily: 'monospace', color: value < 0 ? REDWOOD.error : REDWOOD.textPrimary }}>
                      {formatCurrency(value)}
                    </Text>
                  ),
                },
              ]}
              summary={(pageData) => {
                const totals = pageData.reduce(
                  (acc, row) => ({
                    opening: acc.opening + (row.opening_balance || 0),
                    debit: acc.debit + (row.debit || 0),
                    credit: acc.credit + (row.credit || 0),
                    closing: acc.closing + (row.closing_balance || 0),
                  }),
                  { opening: 0, debit: 0, credit: 0, closing: 0 }
                );
                return (
                  <Table.Summary.Row style={{ background: REDWOOD.surfaceSecondary }}>
                    <Table.Summary.Cell index={0} colSpan={7}>
                      <Text strong>Page Total</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">
                      <Text strong style={{ fontFamily: 'monospace' }}>{formatCurrency(totals.opening)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{formatCurrency(totals.debit)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="right">
                      <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{formatCurrency(totals.credit)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={10} align="right">
                      <Text strong style={{ fontFamily: 'monospace' }}>{formatCurrency(totals.closing)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          )}
        </Modal>

        {/* ── TB Drill-down modals ─────────────────────────────────────── */}
        {renderDrillComboModal()}
        {renderDrillJnlModal()}

        {/* ── ReERP ↔ Fusion Reconciliation Modal ──────────────────────── */}
        <Modal
          title={
            <Space>
              <CheckCircleOutlined style={{ color: REDWOOD.info }} />
              <span>Reconciliation — Fusion TB vs ReERP TB</span>
              {reconPeriod && <Tag color="blue">{reconPeriod}</Tag>}
              <Tag color="gold">Fusion: AED | ReERP: all currencies</Tag>
            </Space>
          }
          open={reconVisible}
          onCancel={() => setReconVisible(false)}
          footer={null}
          width="96vw"
          style={{ top: 20 }}
          bodyStyle={{ padding: '12px 16px' }}
        >
          {(() => {
            const fmt = (n: number) =>
              new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
            const fmtDiff = (n: number) => {
              if (Math.abs(n) < 0.005) return <Text style={{ color: REDWOOD.success, fontFamily: 'monospace', fontSize: 11 }}>—</Text>;
              return <Text style={{ color: REDWOOD.primary, fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                {n > 0 ? '+' : ''}{fmt(n)}
              </Text>;
            };

            const matchedCount = reconData.filter(r => r.matched).length;
            const diffCount    = reconData.length - matchedCount;

            let visible = reconData;
            if (reconFilter === 'diff')    visible = reconData.filter(r => !r.matched);
            if (reconFilter === 'matched') visible = reconData.filter(r =>  r.matched);
            if (reconSearch.trim()) {
              const lc = reconSearch.toLowerCase();
              visible = visible.filter(r =>
                r.account.toLowerCase().includes(lc) ||
                r.account_desc?.toLowerCase().includes(lc)
              );
            }

            const amtCell = (f: number, r: number) => (
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 10, color: REDWOOD.textSecondary }}>F: {fmt(f)}</Text>
                <Text style={{ fontFamily: 'monospace', fontSize: 10, color: REDWOOD.info }}>R: {fmt(r)}</Text>
                <Divider style={{ margin: '2px 0' }} />
                {fmtDiff(r - f)}
              </Space>
            );

            const reconColumns = [
              {
                title: 'Account', dataIndex: 'account', key: 'account', width: 110, fixed: 'left' as const,
                sorter: (a: ReconRecord, b: ReconRecord) => a.account.localeCompare(b.account),
                defaultSortOrder: 'ascend' as const,
                render: (v: string) => <Text strong style={{ fontFamily: 'monospace' }}>{v}</Text>,
              },
              {
                title: 'Description', dataIndex: 'account_desc', key: 'account_desc', width: 200, ellipsis: true,
                render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
              },
              {
                title: 'Status', key: 'status', width: 80, align: 'center' as const, fixed: 'left' as const,
                filters: [{ text: 'Matched', value: true }, { text: 'Difference', value: false }],
                onFilter: (value: any, record: ReconRecord) => record.matched === value,
                render: (_: any, r: ReconRecord) => r.matched
                  ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontSize: 10 }}>Match</Tag>
                  : <Tag color="error"   icon={<CloseCircleOutlined />} style={{ fontSize: 10 }}>Diff</Tag>,
              },
              {
                title: 'Opening', key: 'opening', width: 140, align: 'center' as const,
                render: (_: any, r: ReconRecord) => amtCell(r.fusionOpening, r.rrOpening),
                sorter: (a: ReconRecord, b: ReconRecord) => Math.abs(a.diffOpening) - Math.abs(b.diffOpening),
              },
              {
                title: 'Debit (PTD)', key: 'debit', width: 140, align: 'center' as const,
                render: (_: any, r: ReconRecord) => amtCell(r.fusionDebit, r.rrDebit),
                sorter: (a: ReconRecord, b: ReconRecord) => Math.abs(a.diffDebit) - Math.abs(b.diffDebit),
              },
              {
                title: 'Credit (PTD)', key: 'credit', width: 140, align: 'center' as const,
                render: (_: any, r: ReconRecord) => amtCell(r.fusionCredit, r.rrCredit),
                sorter: (a: ReconRecord, b: ReconRecord) => Math.abs(a.diffCredit) - Math.abs(b.diffCredit),
              },
              {
                title: 'Closing', key: 'closing', width: 140, align: 'center' as const,
                render: (_: any, r: ReconRecord) => amtCell(r.fusionClosing, r.rrClosing),
                sorter: (a: ReconRecord, b: ReconRecord) => Math.abs(a.diffClosing) - Math.abs(b.diffClosing),
              },
              {
                title: 'In', key: 'in', width: 80, align: 'center' as const,
                render: (_: any, r: ReconRecord) => (
                  <Space direction="vertical" size={0}>
                    <Tag color={r.inFusion ? 'blue'  : 'default'} style={{ fontSize: 9, marginBottom: 2 }}>Fusion</Tag>
                    <Tag color={r.inRr     ? 'green' : 'default'} style={{ fontSize: 9 }}>ReERP</Tag>
                  </Space>
                ),
              },
            ];

            return (
              <>
                {/* Summary bar */}
                <Row gutter={12} style={{ marginBottom: 12 }}>
                  <Col span={4}>
                    <Card size="small" style={{ textAlign: 'center', borderColor: REDWOOD.success, background: '#f6ffed' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.success }}>{matchedCount}</div>
                      <div style={{ fontSize: 11, color: REDWOOD.textSecondary }}>Matched</div>
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card size="small" style={{ textAlign: 'center', borderColor: diffCount ? REDWOOD.error : REDWOOD.border, background: diffCount ? '#fff2f0' : '#fff' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: diffCount ? REDWOOD.error : REDWOOD.textSecondary }}>{diffCount}</div>
                      <div style={{ fontSize: 11, color: REDWOOD.textSecondary }}>Differences</div>
                    </Card>
                  </Col>
                  <Col span={4}>
                    <Card size="small" style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.neutral }}>{reconData.length}</div>
                      <div style={{ fontSize: 11, color: REDWOOD.textSecondary }}>Total Accounts</div>
                    </Card>
                  </Col>
                  <Col span={6} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button size="small" type={reconFilter === 'all'     ? 'primary' : 'default'} onClick={() => setReconFilter('all')}>All</Button>
                    <Button size="small" type={reconFilter === 'diff'    ? 'primary' : 'default'} onClick={() => setReconFilter('diff')}    danger={reconFilter !== 'diff'    && diffCount > 0}>Differences ({diffCount})</Button>
                    <Button size="small" type={reconFilter === 'matched' ? 'primary' : 'default'} onClick={() => setReconFilter('matched')}>Matched ({matchedCount})</Button>
                  </Col>
                  <Col span={6}>
                    <Input.Search
                      placeholder="Search account…"
                      value={reconSearch}
                      onChange={e => setReconSearch(e.target.value)}
                      allowClear
                      size="small"
                    />
                  </Col>
                </Row>

                <div style={{ fontSize: 11, color: REDWOOD.textSecondary, marginBottom: 8 }}>
                  <strong>F</strong> = Fusion TB &nbsp;|&nbsp; <strong>R</strong> = ReERP TB &nbsp;|&nbsp; Diff = R − F &nbsp;|&nbsp; Tolerance: 0.005
                </div>

                <Table
                  dataSource={visible}
                  columns={reconColumns}
                  rowKey="account"
                  size="small"
                  pagination={false}
                  scroll={{ x: 1000, y: 'calc(80vh - 220px)' }}
                  rowClassName={(r: ReconRecord) => r.matched ? '' : 'recon-diff-row'}
                  onRow={(r: ReconRecord) => ({
                    style: { background: r.matched ? '#f6ffed' : '#fff2f0' },
                  })}
                />
              </>
            );
          })()}
        </Modal>
        {renderRevalModal()}
        {renderReCalcModal()}

        {/* ── YTD Movement: Start Period Prompt ── */}
        <Modal
          title={<Space><LineChartOutlined style={{ color: '#0958d9' }} />Show YTD Balances</Space>}
          open={ytdMovPromptVisible}
          onCancel={() => setYtdMovPromptVisible(false)}
          onOk={() => {
            if (!ytdMovPromptPeriod) { message.warning('Please select a start period.'); return; }
            setYtdMovPromptVisible(false);
            openYtdMovement(
              ytdMovPendingAccount, ytdMovPendingDesc, ytdMovPendingLedger,
              ytdMovPendingCompany, ytdMovPendingCurrency,
              ytdMovPromptPeriod,
            );
          }}
          okText="Load Balances"
          width={400}
        >
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            Select the <strong>start year and period</strong> to load YTD balances from:
          </div>
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Select
              placeholder="Select Year"
              style={{ width: '100%' }}
              value={ytdMovPromptYear}
              onChange={(yr: number) => {
                setYtdMovPromptYear(yr);
                // reset period to first period of that year
                const first = [...periods]
                  .filter(p => p.period_year === yr)
                  .sort((a, b) => a.period_number - b.period_number)[0];
                setYtdMovPromptPeriod(first?.period_name_id ?? null);
              }}
            >
              {[...new Set(periods.map(p => p.period_year))].sort((a, b) => a - b).map(yr => (
                <Select.Option key={yr} value={yr}><CalendarOutlined style={{ marginRight: 6 }} />{yr}</Select.Option>
              ))}
            </Select>
            <Select
              placeholder="Select Period"
              style={{ width: '100%' }}
              value={ytdMovPromptPeriod}
              onChange={(v: string) => setYtdMovPromptPeriod(v)}
              disabled={!ytdMovPromptYear}
            >
              {periods
                .filter(p => !ytdMovPromptYear || p.period_year === ytdMovPromptYear)
                .sort((a, b) => a.period_number - b.period_number)
                .map(p => (
                  <Select.Option key={p.period_name_id} value={p.period_name_id}>
                    {p.period_name_id}
                  </Select.Option>
                ))}
            </Select>
          </Space>
          {(ytdMovPendingCompany || ytdMovPendingCurrency) && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
              Filtered to: {ytdMovPendingCompany && <Tag color="orange">{ytdMovPendingCompany}</Tag>}
              {ytdMovPendingCurrency && <Tag color="cyan">{ytdMovPendingCurrency}</Tag>}
            </div>
          )}
        </Modal>

        {/* ── YTD Movement Modal ── */}
        <Modal
          open={ytdMovVisible}
          onCancel={() => setYtdMovVisible(false)}
          footer={<Button onClick={() => setYtdMovVisible(false)}>Close</Button>}
          width={900}
          destroyOnClose
          title={
            <Space wrap>
              <LineChartOutlined style={{ color: '#0958d9' }} />
              <span style={{ fontWeight: 700 }}>YTD Balance Movement</span>
              <Tag color="geekblue" style={{ fontFamily: 'monospace', fontSize: 12 }}>{ytdMovLedger}</Tag>
              {ytdMovCompany  && <Tag color="orange"  style={{ fontSize: 12 }}>{ytdMovCompany}</Tag>}
              {ytdMovCurrency && <Tag color="cyan"    style={{ fontSize: 12 }}>{ytdMovCurrency}</Tag>}
              <Tag color="gold" style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{ytdMovAccount}</Tag>
              {ytdMovDesc && <Tag color="blue" style={{ fontSize: 11 }}>{ytdMovDesc}</Tag>}
            </Space>
          }
        >
          {ytdMovLoading && ytdMovRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <Spin size="large" />
              <div style={{ marginTop: 16, color: '#666', fontSize: 13 }}>{ytdMovProgress || 'Loading...'}</div>
            </div>
          ) : ytdMovError ? (
            <Alert type="error" showIcon message={ytdMovError} />
          ) : (
            <>
              {/* ── Toolbar ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Space wrap>
                  <Tag color="blue">{ytdMovRows.length} period(s) with activity</Tag>
                  {ytdMovLoading && ytdMovProgress && (
                    <Tag icon={<LoadingOutlined />} color="processing">{ytdMovProgress}</Tag>
                  )}
                </Space>
                <Space>
                  <Button
                    icon={<FileExcelOutlined />}
                    size="small"
                    disabled={ytdMovRows.length === 0}
                    style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                    onClick={() => {
                      const exportDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                      const exportTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                      const fromPeriod = ytdMovRows[0]?.period  || '';
                      const toPeriod   = ytdMovRows[ytdMovRows.length - 1]?.period || '';

                      const ws = XLSX.utils.aoa_to_sheet([]);

                      const headerRows: (string | number | null)[][] = [
                        ['YTD Balance Movement'],
                        [],
                        ['Ledger',      ytdMovLedger,                     '', 'Account',      ytdMovAccount],
                        ['Company',     ytdMovCompany || 'All Companies',  '', 'Description',  ytdMovDesc || ''],
                        ['Currency',    ytdMovCurrency || 'All Currencies','', 'Period Range',  `${fromPeriod} – ${toPeriod}`],
                        ['Export Date', `${exportDate} ${exportTime}`,     '', 'Total Periods', ytdMovRows.length],
                        [],
                        ['Period', 'Fiscal Year', 'YTD Opening', 'YTD Debit', 'YTD Credit', 'YTD Closing'],
                      ];
                      XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: 'A1' });

                      const dataRows = ytdMovRows.map(r => [r.period, r.period_year, r.ytd_opening, r.ytd_debit, r.ytd_credit, r.closing]);
                      XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: `A${headerRows.length + 1}` });

                      const dataStartRow = headerRows.length + 1;
                      const dataEndRow   = dataStartRow + ytdMovRows.length - 1;

                      XLSX.utils.sheet_add_aoa(ws, [['TOTAL', '', { f: `SUM(C${dataStartRow}:C${dataEndRow})` }, { f: `SUM(D${dataStartRow}:D${dataEndRow})` }, { f: `SUM(E${dataStartRow}:E${dataEndRow})` }, { f: `SUM(F${dataStartRow}:F${dataEndRow})` }]], { origin: `A${dataEndRow + 1}` });

                      ws['A1'] = { v: 'YTD Balance Movement', t: 's', s: { font: { bold: true, sz: 14 } } };
                      ['A3','A4','A5','A6','D3','D4','D5','D6'].forEach(addr => {
                        if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F0F4FF' } } };
                      });
                      const headingRow = headerRows.length;
                      ['A','B','C','D','E','F'].forEach(col => {
                        const addr = `${col}${headingRow}`;
                        if (ws[addr]) ws[addr].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1F4E79' } }, alignment: { horizontal: col <= 'B' ? 'left' : 'right' } };
                      });
                      for (let row = dataStartRow; row <= dataEndRow + 1; row++) {
                        ['C','D','E','F'].forEach(col => { const addr = `${col}${row}`; if (ws[addr]) ws[addr].z = '#,##0.00'; });
                        if ((row - dataStartRow) % 2 === 1)
                          ['A','B','C','D','E','F'].forEach(col => { const addr = `${col}${row}`; if (ws[addr]) ws[addr].s = { ...(ws[addr].s || {}), fill: { fgColor: { rgb: 'F7F9FC' } } }; });
                      }
                      ['A','B','C','D','E','F'].forEach(col => {
                        const addr = `${col}${dataEndRow + 1}`;
                        if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8F0FE' } }, ...(['C','D','E','F'].includes(col) ? { z: '#,##0.00', alignment: { horizontal: 'right' } } : {}) };
                      });
                      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
                      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
                      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataEndRow + 1, c: 5 } });

                      const wb = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(wb, ws, 'YTD Movement');
                      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                      saveAs(new Blob([buf], { type: 'application/octet-stream' }), `YTD_${ytdMovAccount}_${ytdMovCompany || 'All'}_${ytdMovLedger}_${fromPeriod}.xlsx`);
                    }}
                  >
                    Export to Excel
                  </Button>
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                    onClick={() => {
                      Modal.info({
                        title: <Space><ApiOutlined style={{ color: REDWOOD.info }} />API Calls — YTD Balance Movement</Space>,
                        width: 760,
                        content: (
                          <div>
                            <div style={{ marginBottom: 8, fontSize: 12, color: '#555' }}>
                              <strong>{ytdMovApiUrls.length}</strong> request(s) — one per period, server-filtered by account <Tag style={{ fontFamily: 'monospace' }}>{ytdMovAccount}</Tag>
                              {ytdMovCompany  && <>{', company '}<Tag color="orange">{ytdMovCompany}</Tag></>}
                              {ytdMovCurrency && <>{', currency '}<Tag color="cyan">{ytdMovCurrency}</Tag></>}
                              {ytdMovLoading  && <Tag icon={<LoadingOutlined />} color="processing">loading…</Tag>}
                            </div>
                            <div style={{ maxHeight: 400, overflowY: 'auto', background: '#f5f5f5', padding: 10, borderRadius: 6 }}>
                              {ytdMovApiUrls.length === 0
                                ? <span style={{ color: '#aaa', fontSize: 12 }}>No requests yet.</span>
                                : ytdMovApiUrls.map((u, i) => (
                                  <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', marginBottom: 6, borderBottom: '1px solid #e0e0e0', paddingBottom: 4 }}>
                                    <span style={{ color: '#888', marginRight: 6 }}>{i + 1}.</span>{u}
                                  </div>
                                ))
                              }
                            </div>
                          </div>
                        ),
                      });
                    }}
                  >
                    API ({ytdMovApiUrls.length})
                  </Button>
                </Space>
              </div>
              <Table
                dataSource={ytdMovRows}
                rowKey="period"
                size="small"
                pagination={false}
                scroll={{ y: 'calc(70vh - 160px)' }}
                columns={[
                  {
                    title: 'Period',
                    dataIndex: 'period',
                    key: 'period',
                    width: 140,
                    render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
                  },
                  {
                    title: 'YTD Opening',
                    dataIndex: 'ytd_opening',
                    key: 'ytd_opening',
                    align: 'right' as const,
                    width: 140,
                    render: (n: number) => {
                      const f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
                      return n < 0
                        ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#cf1322' }}>({f})</Text>
                        : <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#1677ff' }}>{f}</Text>;
                    },
                  },
                  {
                    title: 'YTD Debit',
                    dataIndex: 'ytd_debit',
                    key: 'ytd_debit',
                    align: 'right' as const,
                    width: 130,
                    render: (n: number) => (
                      <Text style={{ fontFamily: 'monospace', fontSize: 11, color: n ? '#237804' : '#aaa' }}>
                        {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))}
                      </Text>
                    ),
                  },
                  {
                    title: 'YTD Credit',
                    dataIndex: 'ytd_credit',
                    key: 'ytd_credit',
                    align: 'right' as const,
                    width: 130,
                    render: (n: number) => (
                      <Text style={{ fontFamily: 'monospace', fontSize: 11, color: n ? '#cf1322' : '#aaa' }}>
                        {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))}
                      </Text>
                    ),
                  },
                  {
                    title: 'YTD Closing',
                    dataIndex: 'closing',
                    key: 'closing',
                    align: 'right' as const,
                    width: 140,
                    render: (n: number) => {
                      const f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
                      return n < 0
                        ? <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#cf1322' }}>({f})</Text>
                        : <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{f}</Text>;
                    },
                  },
                ]}
                summary={(data) => {
                  if (!data.length) return null;
                  const last = data[data.length - 1];
                  const fmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
                  return (
                    <Table.Summary>
                      <Table.Summary.Row style={{ background: '#f0f0f0', fontWeight: 700 }}>
                        <Table.Summary.Cell index={0}>
                          <Text strong style={{ fontSize: 11 }}>Latest ({last.period})</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right">
                          <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#1677ff' }}>{last.ytd_opening < 0 ? `(${fmt(last.ytd_opening)})` : fmt(last.ytd_opening)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#237804' }}>{fmt(last.ytd_debit)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right">
                          <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: '#cf1322' }}>{fmt(last.ytd_credit)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">
                          <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: last.closing < 0 ? '#cf1322' : '#237804' }}>
                            {last.closing < 0 ? `(${fmt(last.closing)})` : fmt(last.closing)}
                          </Text>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    </Table.Summary>
                  );
                }}
              />
            </>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default TrialBalance;
