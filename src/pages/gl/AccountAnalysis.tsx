import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { SearchTabPanel } from './SearchTabPanel';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  Layout,
  Typography,
  Card,
  Breadcrumb,
  Button,
  Select,
  Input,
  Table,
  Space,
  Tooltip,
  Row,
  Col,
  Tag,
  Tabs,
  Spin,
  Empty,
  Divider,
  message,
  Modal,
  Checkbox,
  DatePicker,
  Switch,
} from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  FundOutlined,
  FilterOutlined,
  CloseOutlined,
  CheckSquareOutlined,
  BarChartOutlined,
  ReloadOutlined,
  PlusOutlined,
  DownloadOutlined,
  TableOutlined,
  DragOutlined,
  UnorderedListOutlined,
  PieChartOutlined,
  LoadingOutlined,
  BugOutlined,
  AuditOutlined,
  LinkOutlined,
  ApiOutlined,
  CopyOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';


const { Content } = Layout;
const { Text } = Typography;
const { Option } = Select;

// API Base URL
const API_BASE_URL = buildApexUrl('gl');

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
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  taskBlue: '#0572CE',
  reportGreen: '#1D7B4D',
};

// Types matching API response
interface JournalLineSegment {
  key: string;
  batchId: number;
  jeHeaderId: number;
  jeLineNumber: number;
  currencyCode: string;
  company: string;
  lob: string;
  department: string;
  account: string;
  subAccount: string;
  analysis: string;
  intercompany: string;
  future1: string;
  isOpeningBalance?: boolean;
  isClosingBalance?: boolean;
  accountType?: string;
  future2: string;
  enteredDr: number;
  enteredCr: number;
  accountedDr: number;
  accountedCr: number;
  chartOfAccountsName: string;
  accountingDate?: string;
  defaultPeriodName: string;
  batchName: string;
  actualFlagMeaning: string;
  approvalStatusMeaning: string;
  userPeriodSetName: string;
  userJeSourceName: string;
  ledgerName: string;
  legalEntityName: string;
  userJeCategoryName: string;
  jeLineDescription?: string;
  concatenatedSegments?: string;
  accountDescription?: string;
}

interface PivotDataRow {
  key: string;
  account: string;
  company: string;
  lob: string;
  department: string;
  subAccount: string;
  analysis: string;
  intercompany: string;
  currencyCode: string | number;
  concatenatedSegments: string;
  [key: string]: string | number;
}

interface AccountTab {
  key: string;
  account: string;
  company: string;
  concatenatedSegments: string;
  selectedPeriods: string[];
  data: JournalLineSegment[];
  loading: boolean;
}

interface SegmentFilter {
  segment: string;
  label: string;
  values: string[];
  selected: string | null;
  isDropped: boolean;
}

// Menu item type
interface MenuItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  color?: string;
  path?: string;
}

// Task menu items
const taskMenuItems: MenuItemType[] = [
  { key: 'manage-journals', icon: <FundOutlined />, label: 'Manage Journals', description: 'Search and manage journal entries', color: REDWOOD.primary, path: '/gl/manage-journals' },
  { key: 'account-analysis', icon: <FundOutlined />, label: 'Account Analysis', description: 'Analyze account balances', color: REDWOOD.taskBlue, path: '/gl/account-analysis' },
];

// Report menu items
const reportMenuItems: MenuItemType[] = [
  { key: 'trial-balance', icon: <BarChartOutlined />, label: 'Trial Balance', description: 'View trial balance report', color: REDWOOD.reportGreen },
  { key: 'account-analysis', icon: <FundOutlined />, label: 'Account Analysis', description: 'Account detail analysis', color: REDWOOD.warning, path: '/gl/account-analysis' },
];

const VALUES_API = buildApexUrl('valuesets/getvalues');
const COMPANY_VALUESET = 'BUIMERC_FIN_GLB_COA_CO';
const COMPANY_LOV_URL  = `${VALUES_API}/${COMPANY_VALUESET}`;

// Period status response interface (from periodsstatus/create endpoint)
interface PeriodStatusItem {
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

// Account item interface (from glaccountslist endpoint)
interface AccountItem {
  account: string;
  description: string;
  account_type: string;
}

interface SegmentValues {
  companies: string[];
  lobs: string[];
  departments: string[];
  subAccounts: string[];
  analyses: string[];
  intercompanies: string[];
  sources: string[];
  categories: string[];
}

// Helper to parse period string to sortable date
const parsePeriodToDate = (period: string): Date => {
  const monthMap: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  const parts = period.split('-');
  if (parts.length === 2) {
    const month = monthMap[parts[0]] ?? 0;
    const year = 2000 + parseInt(parts[1], 10);
    return new Date(year, month, 1);
  }
  return new Date();
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const getPreviousPeriod = (period: string): string => {
  const parts = period.split('-');
  if (parts.length !== 2) return period;
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  if (monthIdx === -1) return period;
  const year = parseInt(parts[1], 10);
  if (monthIdx === 0) return `Dec-${String(year - 1).padStart(2, '0')}`;
  return `${MONTH_NAMES[monthIdx - 1]}-${parts[1]}`;
};

const AccountAnalysis: React.FC = () => {
  // State
  const [activeTabKey, setActiveTabKey] = useState('search-1');
  const [accountTabs, setAccountTabs] = useState<AccountTab[]>([]);
  const [searchTabInstances, setSearchTabInstances] = useState<Array<{ key: string; label: string }>>([
    { key: 'search-1', label: 'Analysis 1' },
  ]);
  const [loading, setLoading] = useState(false);
  const [searchData, setSearchData] = useState<JournalLineSegment[]>([]);
  const [openingBalanceRow, setOpeningBalanceRow] = useState<JournalLineSegment | null>(null);
  const [closingBalanceRow, setClosingBalanceRow] = useState<JournalLineSegment | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Periods state - loaded from API
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  // Search filters
  const [selectedLedger, setSelectedLedger] = useState<string>('BUIMERC LEDGER');
  const [ledgerOptions, setLedgerOptions] = useState<string[]>(['BUIMERC LEDGER']);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState<Dayjs | null>(null);
  const [toDate, setToDate] = useState<Dayjs | null>(null);
  // Account combination segment filters
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [lobFilter, setLobFilter] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [subAccountFilter, setSubAccountFilter] = useState<string>('');
  const [analysisFilter, setAnalysisFilter] = useState<string>('');
  const [intercompanyFilter, setIntercompanyFilter] = useState<string>('');
  const [jeSourceFilter, setJeSourceFilter] = useState<string>('');
  const [jeCategoryFilter, setJeCategoryFilter] = useState<string>('');

  // Segment LOV state
  const [segmentValues, setSegmentValues] = useState<SegmentValues>({
    companies: [],
    lobs: [], departments: [], subAccounts: [],
    analyses: [], intercompanies: [], sources: [], categories: [],
  });
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});

  // Account lookup modal state
  const [accountLookupVisible, setAccountLookupVisible] = useState(false);
  const [accountsList, setAccountsList] = useState<AccountItem[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountSearchText, setAccountSearchText] = useState('');
  const [accountFilterDesc, setAccountFilterDesc] = useState<string>('');

  // Pivot view options
  const [showDrCrColumns, setShowDrCrColumns] = useState(false);
  const [showEntered, setShowEntered] = useState(false);
  // Per-currency opening balances keyed by `${account}||${currencyCode}`
  const [currencyOpenings, setCurrencyOpenings] = useState<Map<string, { accountedDr: number; accountedCr: number }>>(new Map());

  // Segment filters for pivot
  const [segmentFilters, setSegmentFilters] = useState<SegmentFilter[]>([
    { segment: 'company', label: 'Company', values: [], selected: null, isDropped: false },
    { segment: 'lob', label: 'LOB', values: [], selected: null, isDropped: false },
    { segment: 'department', label: 'Department', values: [], selected: null, isDropped: false },
    { segment: 'account', label: 'Account', values: [], selected: null, isDropped: false },
    { segment: 'subAccount', label: 'Sub Account', values: [], selected: null, isDropped: false },
    { segment: 'analysis', label: 'Analysis', values: [], selected: null, isDropped: false },
    { segment: 'intercompany', label: 'Intercompany', values: [], selected: null, isDropped: false },
    { segment: 'currencyCode', label: 'Currency', values: [], selected: null, isDropped: false },
  ]);

  // Floating panel state
  const [activePanel, setActivePanel] = useState<'none' | 'tasks' | 'reports'>('none');
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatingIconsRef = useRef<HTMLDivElement>(null);
  const [searchPageSize, setSearchPageSize] = useState(20);

  // Pivot view state - segments before and after Account column
  const [segmentsBeforeAccount, setSegmentsBeforeAccount] = useState<string[]>([]);
  const [segmentsAfterAccount, setSegmentsAfterAccount] = useState<string[]>([]);

  // Journal detail modal state
  const [journalModalVisible, setJournalModalVisible] = useState(false);
  const [journalModalData, setJournalModalData] = useState<JournalLineSegment[]>([]);
  const [journalModalTitle, setJournalModalTitle] = useState('');
  const [journalModalFilters, setJournalModalFilters] = useState<Record<string, string>>({});

  // Journal drill-down modal state
  const [journalDrillVisible, setJournalDrillVisible] = useState(false);
  const [journalDrillRecord, setJournalDrillRecord] = useState<JournalLineSegment | null>(null);

  // Full journal modal (all lines for a specific journal from API)
  const [fullJournalVisible, setFullJournalVisible] = useState(false);
  const [fullJournalLoading, setFullJournalLoading] = useState(false);
  const [fullJournalLines, setFullJournalLines] = useState<any[]>([]);
  const [fullJournalMeta, setFullJournalMeta] = useState<{ batchName: string; jeHeaderId: number; period: string } | null>(null);

  // All accounts pivot tab state
  const [allAccountsPivotOpen, setAllAccountsPivotOpen] = useState(false);
  const [allAccountsPivotSegmentsBefore, setAllAccountsPivotSegmentsBefore] = useState<string[]>([]);
  const [allAccountsPivotSegmentsAfter, setAllAccountsPivotSegmentsAfter] = useState<string[]>([]);

  // Click outside handler for floating panel
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

  // Helper to extract period name from PeriodNameId (format: "PERIODSET_Jan-24_101_300000000774004")
  const extractPeriodName = (periodNameId: string): string | null => {
    if (!periodNameId) return null;
    const parts = periodNameId.split('_');
    // Format is typically: PERIODSET_Jan-24_101_300000000774004
    if (parts.length >= 2) {
      return parts[1];
    }
    return null;
  };

  // Fetch all periods from APEX periodsstatus/create endpoint
  const fetchPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('P_APPLICATION_NAME', 'General Ledger');
      params.append('P_LEDGER_NAME', selectedLedger);

      const url = `${buildApexUrl("periodsstatus/create?${params.toString()}")}`;
      console.log('Fetching all periods from:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const items = result.items || result || [];

      console.log('Period status response:', result);
      console.log('Period status items count:', items.length);
      if (items.length > 0) {
        console.log('First item structure:', JSON.stringify(items[0], null, 2));
      }

      // Extract unique period names from period_name_id field
      const periodSet = new Set<string>();
      items.forEach((item: any) => {
        // Handle both lowercase and uppercase field names
        const periodNameId = item.period_name_id || item.PERIOD_NAME_ID || item.periodNameId;
        if (periodNameId) {
          // Check if it contains underscore (compound format)
          if (periodNameId.includes('_')) {
            const periodName = extractPeriodName(periodNameId);
            if (periodName) {
              periodSet.add(periodName);
            }
          } else {
            // Direct period name format (e.g., "Jan-24")
            periodSet.add(periodNameId);
          }
        }
      });

      // Convert to array and sort chronologically
      const sortedPeriods = Array.from(periodSet).sort((a, b) => {
        return parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime();
      });

      console.log('Fetched periods:', sortedPeriods.length, sortedPeriods);
      setAvailablePeriods(sortedPeriods);
    } catch (error) {
      console.error('Error fetching periods:', error);
      message.error('Failed to load periods. Please refresh the page.');
    } finally {
      setPeriodsLoading(false);
    }
  }, [selectedLedger]);

  // Load periods on mount
  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  // Fetch distinct segment LOV values
  const fetchSegmentValues = useCallback(async () => {
    // Fetch other segment values (lobs, departments, etc.) from segment-values endpoint
    try {
      const params = new URLSearchParams({ ledger_name: selectedLedger });
      const res = await fetch(`${API_BASE_URL}/segment-values?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSegmentValues(prev => ({
          ...prev,
          lobs:           data.lobs           || [],
          departments:    data.departments    || [],
          subAccounts:    data.subAccounts    || [],
          analyses:       data.analyses       || [],
          intercompanies: data.intercompanies || [],
          sources:        data.sources        || [],
          categories:     data.categories     || [],
        }));
      }
    } catch {
      // silently ignore
    }

    // Fetch companies + names directly from BUIMERC_FIN_GLB_COA_CO value set
    try {
      const valRes = await fetch(COMPANY_LOV_URL);
      if (valRes.ok) {
        const valData = await valRes.json();
        const items: any[] = valData.items || [];
        const codes = items.map((i: any) => i.value || i.Value).filter(Boolean);
        const nameMap: Record<string, string> = {};
        items.forEach((i: any) => {
          const code = i.value || i.Value;
          if (code) nameMap[code] = i.description || i.Description || code;
        });
        setSegmentValues(prev => ({ ...prev, companies: codes }));
        setCompanyNames(nameMap);
      }
    } catch {
      // company names unavailable
    }
  }, [selectedLedger]);

  useEffect(() => { fetchSegmentValues(); }, [fetchSegmentValues]);

  // Fetch ledgers dynamically
  useEffect(() => {
    fetch(`${API_BASE_URL}/getledgername`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const names: string[] = [...new Set((data.items || []).map((i: any) => i.ledger_name).filter(Boolean) as string[])];
        if (names.length > 0) {
          setLedgerOptions(names);
          if (!names.includes(selectedLedger)) setSelectedLedger(names[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Populate per-currency opening balances when currencyCode is a grouping dimension in the all-accounts pivot
  useEffect(() => {
    const currencyIsGrouped =
      allAccountsPivotSegmentsBefore.includes('currencyCode') ||
      allAccountsPivotSegmentsAfter.includes('currencyCode');

    if (!currencyIsGrouped || searchData.length === 0) {
      setCurrencyOpenings(new Map());
      return;
    }

    // Collect unique (account, company) pairs
    const uniquePairs = new Map<string, { account: string; company: string }>();
    for (const row of searchData) {
      const k = `${row.account}||${row.company}`;
      if (!uniquePairs.has(k)) uniquePairs.set(k, { account: row.account, company: row.company });
    }

    // Use the earliest selected period (or first period in data) as the opening balance period
    const earliestPeriod = selectedPeriods.length > 0 ? selectedPeriods[0] : (searchData[0]?.defaultPeriodName || '');

    const fetch_ = async () => {
      const newMap = new Map<string, { accountedDr: number; accountedCr: number }>();
      await Promise.all(
        Array.from(uniquePairs.values()).map(async ({ account, company }) => {
          const byCurrency = await fetchOpeningByCurrency(account, company, earliestPeriod);
          for (const [ccy, vals] of byCurrency) {
            newMap.set(`${account}||${ccy}`, { accountedDr: vals.accountedDr, accountedCr: vals.accountedCr });
          }
        })
      );
      setCurrencyOpenings(newMap);
    };

    fetch_().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchData, allAccountsPivotSegmentsBefore, allAccountsPivotSegmentsAfter]);

  // Fetch accounts list from APEX glaccountslist endpoint
  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const url = `${buildApexUrl("glaccountslist")}`;
      console.log('Fetching accounts from:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const items: AccountItem[] = result.items || result || [];
      console.log('Fetched accounts:', items.length);
      setAccountsList(items);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      message.error('Failed to load accounts list.');
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  // Open account lookup modal
  const openAccountLookup = () => {
    setAccountLookupVisible(true);
    setAccountSearchText('');
    if (accountsList.length === 0) {
      fetchAccounts();
    }
  };

  // Select account from lookup
  const handleAccountSelect = (account: string, description?: string) => {
    setAccountFilter(account);
    setAccountFilterDesc(description || '');
    setAccountLookupVisible(false);
  };

  // Drill down — group searchData by journal (no extra API call)
  const openJournalDrill = (record: JournalLineSegment) => {
    setJournalDrillRecord(record);
    setJournalDrillVisible(true);
  };

  // Group searchData by jeHeaderId for the drill popup — filtered to the clicked account
  const journalGroups = useMemo(() => {
    // Only show the specific journal header that was drilled into
    const baseLines = journalDrillRecord
      ? searchData.filter(l => l.jeHeaderId === journalDrillRecord.jeHeaderId)
      : searchData;

    const map = new Map<number, {
      key: string;
      jeHeaderId: number;
      batchName: string;
      defaultPeriodName: string;
      userJeSourceName: string;
      userJeCategoryName: string;
      lines: JournalLineSegment[];
      totalEnteredDr: number;
      totalEnteredCr: number;
      totalAccountedDr: number;
      totalAccountedCr: number;
    }>();

    baseLines.forEach(line => {
      if (!map.has(line.jeHeaderId)) {
        map.set(line.jeHeaderId, {
          key: `jg-${line.jeHeaderId}`,
          jeHeaderId: line.jeHeaderId,
          batchName: line.batchName || '',
          defaultPeriodName: line.defaultPeriodName,
          userJeSourceName: line.userJeSourceName,
          userJeCategoryName: line.userJeCategoryName,
          lines: [],
          totalEnteredDr: 0,
          totalEnteredCr: 0,
          totalAccountedDr: 0,
          totalAccountedCr: 0,
        });
      }
      const g = map.get(line.jeHeaderId)!;
      // Deduplicate lines within the same journal group
      if (!g.lines.find(existing => existing.jeLineNumber === line.jeLineNumber)) {
        g.lines.push(line);
        g.totalEnteredDr   += line.enteredDr   || 0;
        g.totalEnteredCr   += line.enteredCr   || 0;
        g.totalAccountedDr += line.accountedDr || 0;
        g.totalAccountedCr += line.accountedCr || 0;
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.defaultPeriodName.localeCompare(b.defaultPeriodName) ||
      a.batchName.localeCompare(b.batchName)
    );
  }, [searchData, journalDrillRecord]);

  // Open full journal — fetch ALL lines for a jeHeaderId (not just the filtered account)
  const openFullJournal = async (jeHeaderId: number, batchName: string, period: string) => {
    setFullJournalMeta({ batchName, jeHeaderId, period });
    setFullJournalLines([]);
    setFullJournalVisible(true);
    setFullJournalLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/journals/${jeHeaderId}/lines`);
      const data = await res.json();
      setFullJournalLines(data.items || []);
    } catch {
      message.error('Failed to load journal lines');
    } finally {
      setFullJournalLoading(false);
    }
  };

  // Filter accounts based on search text
  const filteredAccounts = accountsList.filter((item) => {
    const searchLower = accountSearchText.toLowerCase();
    return (
      item.account.toLowerCase().includes(searchLower) ||
      item.description.toLowerCase().includes(searchLower)
    );
  });

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

  // Search function - calls real API
  const handleSearch = async () => {
    if (selectedPeriods.length === 0 && !fromDate && !toDate) {
      message.warning('Please select at least one period or specify accounting date range');
      return;
    }

    setLoading(true);
    try {
      // Build query parameters
      const params = new URLSearchParams();
      params.append('ledger_name', selectedLedger);
      if (selectedPeriods.length > 0) params.append('period_names', selectedPeriods.join(','));
      if (fromDate) params.append('from_date', fromDate.format('YYYY-MM-DD'));
      if (toDate)   params.append('to_date',   toDate.format('YYYY-MM-DD'));
      if (selectedCompany)   params.append('company',      selectedCompany);
      if (lobFilter)         params.append('lob',          lobFilter);
      if (departmentFilter)  params.append('department',   departmentFilter);
      if (accountFilter)     params.append('account',      accountFilter);
      if (subAccountFilter)  params.append('sub_account',  subAccountFilter);
      if (analysisFilter)    params.append('analysis',     analysisFilter);
      if (intercompanyFilter) params.append('intercompany', intercompanyFilter);
      if (jeSourceFilter)    params.append('je_source',    jeSourceFilter);
      if (jeCategoryFilter)  params.append('je_category',  jeCategoryFilter);

      // Fetch journal lines — treat non-OK (e.g. 404 when period has no entries) as empty
      let items: JournalLineSegment[] = [];
      let totalCountFromApi = 0;
      try {
        const response = await fetch(`${API_BASE_URL}/accountanalysis?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          const seen = new Set<string>();
          items = (data.items || []).flatMap((item: any, index: number) => {
            const dedupKey = `${item.jeHeaderId ?? item.je_header_id}-${item.jeLineNumber ?? item.je_line_number}`;
            if (seen.has(dedupKey)) return [];
            seen.add(dedupKey);
            return [{
              ...item,
              key: `${index}`,
              concatenatedSegments: item.accountCombination || item.account_combination ||
                `${item.company}-${item.lob}-${item.department}-${item.account}-${item.subAccount}-${item.analysis}-${item.intercompany}`,
              accountDescription: item.accountDescription || item.account_description || item.ACCOUNT_DESCRIPTION || '',
              jeLineDescription: item.description || item.DESCRIPTION || '',
            }];
          });
          totalCountFromApi = data.totalCount || items.length;
        }
      } catch (journalErr) {
        console.error('Journal lines fetch error:', journalErr);
      }

      // Always fetch opening/closing balance when an account is selected — even if no journal lines exist
      const finalItems: JournalLineSegment[] = [...items];
      let newClosingRow: JournalLineSegment | null = null;
      if (accountFilter && selectedPeriods.length > 0) {
        const sortedPeriods = [...selectedPeriods].sort(
          (a, b) => parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime()
        );
        const { opening: openingRow, closing: closingRow } = await fetchBalanceRows(accountFilter, selectedCompany, sortedPeriods[0]);
        if (openingRow) finalItems.unshift(openingRow);
        newClosingRow = closingRow;
        setOpeningBalanceRow(openingRow);
      }

      setClosingBalanceRow(newClosingRow);
      setSearchData(finalItems);
      setTotalCount(totalCountFromApi);
      message.success(`Found ${items.length} journal line(s)`);
    } catch (error) {
      console.error('Error fetching data:', error);
      message.error('Failed to fetch data. Please try again.');
      setSearchData([]);
      setOpeningBalanceRow(null);
      setClosingBalanceRow(null);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  // Show search API URL in modal
  const showSearchApiUrl = () => {
    const params = new URLSearchParams();
    params.append('ledger_name', selectedLedger);
    if (selectedPeriods.length > 0) params.append('period_names', selectedPeriods.join(','));
    if (fromDate) params.append('from_date', fromDate.format('YYYY-MM-DD'));
    if (toDate)   params.append('to_date',   toDate.format('YYYY-MM-DD'));
    if (selectedCompany)   params.append('company',      selectedCompany);
    if (lobFilter)         params.append('lob',          lobFilter);
    if (departmentFilter)  params.append('department',   departmentFilter);
    if (accountFilter)     params.append('account',      accountFilter);
    if (subAccountFilter)  params.append('sub_account',  subAccountFilter);
    if (analysisFilter)    params.append('analysis',     analysisFilter);
    if (intercompanyFilter) params.append('intercompany', intercompanyFilter);
    if (jeSourceFilter)    params.append('je_source',    jeSourceFilter);
    if (jeCategoryFilter)  params.append('je_category',  jeCategoryFilter);
    const url = `${API_BASE_URL}/accountanalysis?${params.toString()}`;

    // Opening balance API URL
    let openingBalUrl = '';
    if (accountFilter && selectedPeriods.length > 0) {
      const sortedPeriods = [...selectedPeriods].sort(
        (a, b) => parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime()
      );
      const obParams = new URLSearchParams();
      obParams.append('account', accountFilter);
      obParams.append('period_name', sortedPeriods[0]);
      if (selectedCompany) obParams.append('company', selectedCompany);
      openingBalUrl = `${API_BASE_URL}/rr-trialbalance/standard?ledger_name=${encodeURIComponent(selectedLedger)}&period_name=${encodeURIComponent(sortedPeriods[0])}&account=${encodeURIComponent(accountFilter)}${selectedCompany ? '&company=' + selectedCompany : ''}`;
    }

    Modal.info({
      title: 'API Endpoints',
      width: 800,
      content: (
        <div style={{ fontFamily: 'monospace', fontSize: 12, padding: '8px 0' }}>
          <div style={{ marginBottom: 8, fontWeight: 'bold', color: '#555' }}>Journal Lines:</div>
          <div style={{ wordBreak: 'break-all', background: '#f5f5f5', padding: 8, borderRadius: 4, marginBottom: 16 }}>
            {url}
          </div>
          {openingBalUrl && (
            <>
              <div style={{ marginBottom: 8, fontWeight: 'bold', color: '#555' }}>Opening Balance:</div>
              <div style={{ wordBreak: 'break-all', background: '#fff8e1', padding: 8, borderRadius: 4 }}>
                {openingBalUrl}
              </div>
            </>
          )}
        </div>
      ),
    });
  };

  // Fetch opening + closing balance rows from the trial balance API.
  // If the requested period has no data (account had no activity), walk back up to
  // 24 months to find the most recent period with a balance and use that as the
  // carried-forward opening/closing for the requested period.
  const fetchBalanceRows = async (
    account: string,
    company: string,
    period: string
  ): Promise<{ opening: JournalLineSegment | null; closing: JournalLineSegment | null }> => {
    const none = { opening: null, closing: null };
    try {
      let tryPeriod = period;
      let allItems: any[] = [];

      for (let attempt = 0; attempt < 24; attempt++) {
        const params = new URLSearchParams();
        params.append('ledger_name', selectedLedger);
        params.append('period_name', tryPeriod);
        params.append('account', account);
        if (company) params.append('company', company);
        const url = `${API_BASE_URL}/rr-trialbalance/standard?${params.toString()}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          allItems = (data.items || []).filter((i: any) => String(i.account) === String(account));
        }
        if (allItems.length > 0) break;
        // No data for this period — try one month earlier
        tryPeriod = getPreviousPeriod(tryPeriod);
      }

      const items = allItems;
      if (items.length === 0) return none;

      const accountType: string = items[0].account_type || '';
      const isRetainedEarnings = accountType === 'O';
      const isDebitNormal = accountType === 'A' || accountType === 'E';
      const currencyCode = items[0].currency_code || 'AED';
      const accountDesc = items[0].account_desc || '';

      const openingAmt:    number = items.reduce((s: number, i: any) => s + (i.opening          || 0), 0);
      const closingAmt:    number = items.reduce((s: number, i: any) => s + (i.closing          || 0), 0);
      const entOpeningAmt: number = items.reduce((s: number, i: any) => s + (i.entered_opening  || 0), 0);
      const entClosingAmt: number = items.reduce((s: number, i: any) => s + (i.entered_closing  || 0), 0);

      const toDrCr = (amt: number) => ({
        dr: isDebitNormal && amt > 0 ? amt : (!isDebitNormal && amt < 0 ? Math.abs(amt) : 0),
        cr: !isDebitNormal && amt > 0 ? amt : (isDebitNormal && amt < 0 ? Math.abs(amt) : 0),
      });

      const makeRow = (accAmt: number, entAmt: number, label: string, key: string, isOpen: boolean): JournalLineSegment | null => {
        const effAccAmt = isRetainedEarnings && isOpen ? closingAmt    : accAmt;
        const effEntAmt = isRetainedEarnings && isOpen ? entClosingAmt : entAmt;
        if (effAccAmt === 0 && effEntAmt === 0) return null;
        const acc = toDrCr(effAccAmt);
        const ent = toDrCr(effEntAmt);
        if (acc.dr === 0 && acc.cr === 0 && ent.dr === 0 && ent.cr === 0) return null;
        return {
          key,
          batchId: 0, jeHeaderId: 0, jeLineNumber: 0,
          currencyCode, company: items[0].company || company,
          lob: '', department: '', account, subAccount: '', analysis: '', intercompany: '', future1: '', future2: '',
          enteredDr: ent.dr, enteredCr: ent.cr, accountedDr: acc.dr, accountedCr: acc.cr,
          chartOfAccountsName: '', accountingDate: '', defaultPeriodName: period,
          batchName: '', actualFlagMeaning: '', approvalStatusMeaning: '', userPeriodSetName: '',
          userJeSourceName: '', ledgerName: selectedLedger, legalEntityName: '', userJeCategoryName: '',
          jeLineDescription: label, concatenatedSegments: account, accountDescription: accountDesc,
          isOpeningBalance: isOpen,
          isClosingBalance: !isOpen,
          accountType,
        };
      };

      const openingLabel = isRetainedEarnings ? 'Current Year Balance' : 'Opening Balance';
      return {
        opening: makeRow(openingAmt, entOpeningAmt, openingLabel, 'opening-balance', true),
        closing: makeRow(closingAmt, entClosingAmt, 'Closing Balance', 'closing-balance', false),
      };
    } catch {
      return none;
    }
  };

  // Kept as alias so existing call sites work
  const fetchOpeningBalance = async (account: string, company: string, period: string) =>
    (await fetchBalanceRows(account, company, period)).opening;

  // Fetch opening balance broken down per currency for the all-accounts pivot
  const fetchOpeningByCurrency = async (
    account: string,
    company: string,
    period: string
  ): Promise<Map<string, { accountedDr: number; accountedCr: number; enteredDr: number; enteredCr: number }>> => {
    const result = new Map<string, { accountedDr: number; accountedCr: number; enteredDr: number; enteredCr: number }>();
    try {
      let tryPeriod = period;
      let allItems: any[] = [];
      for (let attempt = 0; attempt < 24; attempt++) {
        const params = new URLSearchParams();
        params.append('ledger_name', selectedLedger);
        params.append('period_name', tryPeriod);
        params.append('account', account);
        if (company) params.append('company', company);
        const url = `${API_BASE_URL}/rr-trialbalance/standard?${params.toString()}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          allItems = (data.items || []).filter((i: any) => String(i.account) === String(account));
        }
        if (allItems.length > 0) break;
        tryPeriod = getPreviousPeriod(tryPeriod);
      }
      for (const item of allItems) {
        const ccy = item.currency_code || 'AED';
        const accountType = item.account_type || '';
        const isDebitNormal = accountType === 'A' || accountType === 'E';
        const openAmt = Number(item.opening || 0);
        const entOpenAmt = Number(item.entered_opening || 0);
        const toDrCr = (amt: number) => ({
          dr: isDebitNormal && amt > 0 ? amt : (!isDebitNormal && amt < 0 ? Math.abs(amt) : 0),
          cr: !isDebitNormal && amt > 0 ? amt : (isDebitNormal && amt < 0 ? Math.abs(amt) : 0),
        });
        const acc = toDrCr(openAmt);
        const ent = toDrCr(entOpenAmt);
        if (!result.has(ccy)) {
          result.set(ccy, { accountedDr: 0, accountedCr: 0, enteredDr: 0, enteredCr: 0 });
        }
        const r = result.get(ccy)!;
        r.accountedDr += acc.dr;
        r.accountedCr += acc.cr;
        r.enteredDr += ent.dr;
        r.enteredCr += ent.cr;
      }
    } catch { /* silent */ }
    return result;
  };

  // Fetch account data for drill-down
  const fetchAccountData = async (account: string, company: string, selectedPeriods: string[]): Promise<JournalLineSegment[]> => {
    try {
      // Fetch data for each period using the byaccount endpoint
      const allItems: JournalLineSegment[] = [];

      for (const period of selectedPeriods) {
        const params = new URLSearchParams();
        params.append('P_ACCOUNT', account);
        params.append('P_PERIOD_NAME', period);
        params.append('P_CURRENCY_CODE', 'AED'); // Default currency, could be made configurable

        const url = `${API_BASE_URL}/accountanalysis/byaccount?${params.toString()}`;
        console.log('Fetching account data from:', url);

        const response = await fetch(url);

        if (!response.ok) {
          console.error(`HTTP error for period ${period}: ${response.status}`);
          continue; // Skip this period if there's an error
        }

        const data = await response.json();
        const items = (data.items || []).map((item: any, index: number) => ({
          key: `${period}-${index}`,
          batchId: item.batch_id,
          jeHeaderId: item.je_header_id,
          jeLineNumber: item.je_line_number,
          currencyCode: item.currency_code,
          company: item.company,
          lob: item.lob,
          department: item.department,
          account: item.account,
          subAccount: item.sub_account,
          analysis: item.analysis,
          intercompany: item.intercompany,
          future1: item.future1,
          future2: item.future2,
          enteredDr: item.entered_dr || 0,
          enteredCr: item.entered_cr || 0,
          accountedDr: item.accounted_dr || 0,
          accountedCr: item.accounted_cr || 0,
          chartOfAccountsName: item.chart_of_accounts_name,
          accountingDate: item.accounting_date || item.accountingDate || '',
          defaultPeriodName: item.default_period_name,
          batchName: item.batch_name,
          actualFlagMeaning: item.actual_flag_meaning,
          approvalStatusMeaning: item.approval_status_meaning,
          userPeriodSetName: item.user_period_set_name,
          userJeSourceName: item.user_je_source_name,
          ledgerName: item.ledger_name,
          legalEntityName: item.legal_entity_name,
          userJeCategoryName: item.user_je_category_name,
          concatenatedSegments: item.account_combination || `${item.company}-${item.lob}-${item.department}-${item.account}-${item.sub_account}-${item.analysis}-${item.intercompany}`,
          accountDescription: item.account_description || '',
          jeLineDescription: item.description || item.DESCRIPTION || '',
        }));

        allItems.push(...items);
      }

      // Prepend opening balance and append closing balance using the earliest selected period
      const sortedPeriods = [...selectedPeriods].sort(
        (a, b) => parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime()
      );
      const earliestPeriod = sortedPeriods[0];
      if (earliestPeriod) {
        const { opening: openingRow, closing: closingRow } = await fetchBalanceRows(account, company, earliestPeriod);
        if (openingRow) allItems.unshift(openingRow);
        if (closingRow) allItems.push(closingRow);
      }

      console.log('Fetched total items:', allItems.length);
      return allItems;
    } catch (error) {
      console.error('Error fetching account data:', error);
      message.error('Failed to fetch account data');
      return [];
    }
  };

  // Reset filters
  const handleReset = () => {
    setSelectedLedger('BUIMERC LEDGER');
    setSelectedCompany('');
    setSelectedPeriods([]);
    setFromDate(null);
    setToDate(null);
    setAccountFilter('');
    setAccountFilterDesc('');
    setLobFilter('');
    setDepartmentFilter('');
    setSubAccountFilter('');
    setAnalysisFilter('');
    setIntercompanyFilter('');
    setJeSourceFilter('');
    setJeCategoryFilter('');
    setSearchData([]);
    setTotalCount(0);
  };

  // Open account in new tab - re-query API
  const openAccountTab = async (record: JournalLineSegment, tabSelectedPeriods: string[]) => {
    const concatenatedSegments = record.concatenatedSegments ||
      `${record.company}-${record.lob}-${record.department}-${record.account}-${record.subAccount}-${record.analysis}-${record.intercompany}`;

    const existingTab = accountTabs.find(
      (tab) => tab.account === record.account && tab.company === record.company
    );

    if (existingTab) {
      setActiveTabKey(existingTab.key);
    } else {
      const tabKey = `account-${Date.now()}`;
      const newTab: AccountTab = {
        key: tabKey,
        account: record.account,
        company: record.company,
        concatenatedSegments,
        selectedPeriods: tabSelectedPeriods,
        data: [],
        loading: true,
      };
      setAccountTabs(prev => [...prev, newTab]);
      setActiveTabKey(tabKey);

      // Fetch fresh data for this account
      const freshData = await fetchAccountData(record.account, record.company, tabSelectedPeriods);
      setAccountTabs((prev) =>
        prev.map((tab) =>
          tab.key === tabKey ? { ...tab, data: freshData, loading: false } : tab
        )
      );
    }
  };

  // Add a new search tab
  const addSearchTab = () => {
    const idx = searchTabInstances.length + 1;
    const key = `search-${Date.now()}`;
    setSearchTabInstances(prev => [...prev, { key, label: `Analysis ${idx}` }]);
    setActiveTabKey(key);
  };

  // Close account tab
  const closeAccountTab = (targetKey: string) => {
    const newTabs = accountTabs.filter((tab) => tab.key !== targetKey);
    setAccountTabs(newTabs);

    if (activeTabKey === targetKey) {
      const lastSearch = searchTabInstances[searchTabInstances.length - 1];
      setActiveTabKey(newTabs.length > 0 ? newTabs[newTabs.length - 1].key : (lastSearch?.key ?? 'search-1'));
    }
  };

  // Close search tab
  const closeSearchTab = (targetKey: string) => {
    if (searchTabInstances.length <= 1) return; // always keep at least one
    const newInstances = searchTabInstances.filter(t => t.key !== targetKey);
    setSearchTabInstances(newInstances);
    if (activeTabKey === targetKey) {
      setActiveTabKey(newInstances[newInstances.length - 1]?.key ?? 'search-1');
    }
  };

  // Tab change handler
  const onTabChange = (key: string) => {
    setActiveTabKey(key);
  };

  // Tab edit handler
  const onTabEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove' && typeof targetKey === 'string') {
      if (searchTabInstances.some(t => t.key === targetKey)) {
        closeSearchTab(targetKey);
      } else {
        closeAccountTab(targetKey);
      }
    }
  };

  // Handle segment drop (for pivot refresh)
  const handleSegmentDrop = (segment: string, position: 'before' | 'after') => {
    // Remove from both arrays first if it exists
    const newBefore = segmentsBeforeAccount.filter((s) => s !== segment);
    const newAfter = segmentsAfterAccount.filter((s) => s !== segment);

    if (position === 'before') {
      setSegmentsBeforeAccount([...newBefore, segment]);
      setSegmentsAfterAccount(newAfter);
    } else {
      setSegmentsBeforeAccount(newBefore);
      setSegmentsAfterAccount([...newAfter, segment]);
    }

    setSegmentFilters(
      segmentFilters.map((f) =>
        f.segment === segment ? { ...f, isDropped: true } : f
      )
    );
  };

  // Remove dropped segment
  const removeDroppedSegment = (segment: string) => {
    setSegmentsBeforeAccount(segmentsBeforeAccount.filter((s) => s !== segment));
    setSegmentsAfterAccount(segmentsAfterAccount.filter((s) => s !== segment));
    setSegmentFilters(
      segmentFilters.map((f) =>
        f.segment === segment ? { ...f, isDropped: false } : f
      )
    );
  };

  // Format number
  const formatNumber = (value: number | undefined | null): string => {
    if (value === undefined || value === null || value === 0) return '';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Calculate totals (excludes opening/closing balance rows to avoid double-counting)
  const calculateTotals = (data: JournalLineSegment[]) => {
    return data.filter(row => !row.isOpeningBalance && !row.isClosingBalance).reduce(
      (acc, row) => ({
        enteredDr: acc.enteredDr + (row.enteredDr || 0),
        enteredCr: acc.enteredCr + (row.enteredCr || 0),
        accountedDr: acc.accountedDr + (row.accountedDr || 0),
        accountedCr: acc.accountedCr + (row.accountedCr || 0),
      }),
      { enteredDr: 0, enteredCr: 0, accountedDr: 0, accountedCr: 0 }
    );
  };

  // Export to Excel
  const exportToExcel = async (data: JournalLineSegment[], title: string) => {
    if (data.length === 0) { message.warning('No data to export'); return; }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ReactERP';
    wb.created = new Date();
    const ws = wb.addWorksheet('Account Analysis');

    // ── Style helpers ────────────────────────────────────────────────
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    const filterLabelFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0D6' } };
    const columnHeaderFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D3D3D' } };
    const accHeaderFill: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4FF' } }; // light blue
    const entHeaderFill: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F7BE' } }; // light green
    const totalFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    const white = { argb: 'FFFFFFFF' };
    const numFmt = '#,##0.00';
    const COLS = 15; // 8 descriptive + 3 Accounted + 3 Entered + 1 JE Header

    const mergeFull = (row: number) => ws.mergeCells(row, 1, row, COLS);

    // ── Title row ─────────────────────────────────────────────────────
    mergeFull(1);
    const titleCell = ws.getCell('A1');
    titleCell.value = title;
    titleCell.font = { bold: true, size: 13, color: white };
    titleCell.fill = headerFill;
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 22;

    // ── Filters section ────────────────────────────────────────────────
    const filterRows: [string, string][] = [
      ['Ledger',   selectedLedger || '—'],
      ['Company',  selectedCompany || '—'],
      ['Periods',  selectedPeriods.length ? selectedPeriods.join(', ') : '—'],
      ['Account',  accountFilter ? `${accountFilter}${accountFilterDesc ? ' — ' + accountFilterDesc : ''}` : '—'],
      ['Exported', new Date().toLocaleString()],
      ['Records',  String(data.length)],
    ];

    let rowIdx = 2;
    for (const [label, val] of filterRows) {
      ws.mergeCells(rowIdx, 1, rowIdx, 3);
      ws.mergeCells(rowIdx, 4, rowIdx, COLS);
      const lc = ws.getCell(rowIdx, 1);
      const vc = ws.getCell(rowIdx, 4);
      lc.value = label;
      vc.value = val;
      lc.font = { bold: true, size: 10 };
      vc.font = { size: 10 };
      lc.fill = filterLabelFill;
      lc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.getRow(rowIdx).height = 16;
      rowIdx++;
    }

    // blank separator row
    rowIdx++;

    // ── Group header row (Accounted / Entered bands) ───────────────────
    const grpRow = ws.getRow(rowIdx);
    grpRow.height = 16;
    // columns 1-8: descriptive — leave blank
    for (let c = 1; c <= 8; c++) ws.getCell(rowIdx, c).fill = columnHeaderFill;
    // columns 9-11: Accounted
    ws.mergeCells(rowIdx, 9, rowIdx, 11);
    const accGrpCell = ws.getCell(rowIdx, 9);
    accGrpCell.value = 'Accounted';
    accGrpCell.font = { bold: true, size: 10, color: { argb: 'FF1677FF' } };
    accGrpCell.fill = accHeaderFill;
    accGrpCell.alignment = { horizontal: 'center', vertical: 'middle' };
    accGrpCell.border = { left: { style: 'medium', color: { argb: 'FF888888' } }, right: { style: 'medium', color: { argb: 'FF888888' } } };
    // columns 12-14: Entered
    ws.mergeCells(rowIdx, 12, rowIdx, 14);
    const entGrpCell = ws.getCell(rowIdx, 12);
    entGrpCell.value = 'Entered';
    entGrpCell.font = { bold: true, size: 10, color: { argb: 'FF52C41A' } };
    entGrpCell.fill = entHeaderFill;
    entGrpCell.alignment = { horizontal: 'center', vertical: 'middle' };
    entGrpCell.border = { left: { style: 'medium', color: { argb: 'FF888888' } }, right: { style: 'medium', color: { argb: 'FF888888' } } };
    // column 15: JE Header — blank
    ws.getCell(rowIdx, 15).fill = columnHeaderFill;
    rowIdx++;

    // ── Column headers ─────────────────────────────────────────────────
    const headers = [
      'Account Combination', 'Account Description', 'Line Description',
      'Period', 'Batch / Journal', 'Source', 'Category', 'Currency',
      'Acc Dr', 'Acc Cr', 'Acc Balance',
      'Ent Dr', 'Ent Cr', 'Ent Balance',
      'JE Header ID',
    ];
    const colWidths = [30, 28, 32, 12, 30, 14, 16, 10, 16, 16, 16, 16, 16, 16, 14];

    const hRow = ws.getRow(rowIdx);
    hRow.height = 18;
    headers.forEach((h, i) => {
      const cell = ws.getCell(rowIdx, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: white };
      const isAcc = i >= 8 && i <= 10;
      const isEnt = i >= 11 && i <= 13;
      cell.fill = isAcc ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5FCC' } }
                : isEnt ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF389E0D' } }
                : columnHeaderFill;
      cell.alignment = { horizontal: i >= 8 && i <= 13 ? 'right' : 'left', vertical: 'middle', indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF888888' } } };
      if (i === 8 || i === 11) cell.border = { ...cell.border, left: { style: 'medium', color: { argb: 'FF888888' } } };
      if (i === 10 || i === 13) cell.border = { ...cell.border, right: { style: 'medium', color: { argb: 'FF888888' } } };
      ws.getColumn(i + 1).width = colWidths[i];
    });
    rowIdx++;

    // ── Data rows ─────────────────────────────────────────────────────
    const altFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
    let accRunning = 0;
    let entRunning = 0;
    data.forEach((r, idx) => {
      accRunning += (r.accountedDr || 0) - (r.accountedCr || 0);
      entRunning += (r.enteredDr   || 0) - (r.enteredCr   || 0);

      const dr = ws.getRow(rowIdx);
      dr.height = 15;
      const isAlt = idx % 2 === 1;
      const vals: (string | number)[] = [
        r.concatenatedSegments || `${r.company}-${r.lob}-${r.department}-${r.account}-${r.subAccount}-${r.analysis}-${r.intercompany}`,
        r.accountDescription || '',
        r.jeLineDescription || '',
        r.defaultPeriodName || '',
        r.batchName || `JE Header #${r.jeHeaderId}`,
        r.userJeSourceName || '',
        r.userJeCategoryName || '',
        r.currencyCode || '',
        r.accountedDr || 0,
        r.accountedCr || 0,
        accRunning,
        r.enteredDr || 0,
        r.enteredCr || 0,
        entRunning,
        r.jeHeaderId,
      ];
      vals.forEach((v, i) => {
        const cell = ws.getCell(rowIdx, i + 1);
        cell.value = v;
        cell.font = { size: 10 };
        if (isAlt) cell.fill = altFill;
        const isNumeric = i >= 8 && i <= 13;
        cell.alignment = { horizontal: isNumeric ? 'right' : 'left', vertical: 'middle', indent: 1 };
        if (isNumeric) cell.numFmt = numFmt;
        if (i === 8 || i === 11) cell.border = { left: { style: 'medium', color: { argb: 'FF888888' } } };
        if (i === 10 || i === 13) cell.border = { right: { style: 'medium', color: { argb: 'FF888888' } } };
        // colour running balance cells
        if (i === 10 || i === 13) {
          const bal = i === 10 ? accRunning : entRunning;
          cell.font = { size: 10, bold: true, color: { argb: bal < 0 ? 'FFC41C00' : 'FF237804' } };
        }
      });
      rowIdx++;
    });

    // ── Totals row ─────────────────────────────────────────────────────
    const totals = calculateTotals(data);
    const tRow = ws.getRow(rowIdx);
    tRow.height = 16;
    ws.mergeCells(rowIdx, 1, rowIdx, 8);
    const tLabel = ws.getCell(rowIdx, 1);
    tLabel.value = `PTD Totals  (${data.length} lines)`;
    tLabel.font = { bold: true, size: 10 };
    tLabel.fill = totalFill;
    tLabel.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

    // Acc Dr, Acc Cr, Acc Balance(final), Ent Dr, Ent Cr, Ent Balance(final)
    const totVals: (number | string)[] = [
      totals.accountedDr, totals.accountedCr, accRunning,
      totals.enteredDr,   totals.enteredCr,   entRunning,
    ];
    totVals.forEach((v, i) => {
      const col = 9 + i;
      const cell = ws.getCell(rowIdx, col);
      cell.value = v;
      cell.font = { bold: true, size: 10 };
      cell.fill = totalFill;
      cell.numFmt = numFmt;
      cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      if (col === 9 || col === 12) cell.border = { left: { style: 'medium', color: { argb: 'FF888888' } } };
      if (col === 11 || col === 14) cell.border = { right: { style: 'medium', color: { argb: 'FF888888' } } };
    });
    ws.getCell(rowIdx, 15).fill = totalFill;

    // ── Freeze panes & auto-filter ─────────────────────────────────────
    const dataStart = rowIdx - data.length; // first data row
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: dataStart - 1 }];
    ws.autoFilter = { from: { row: dataStart - 1, column: 1 }, to: { row: dataStart - 1 + data.length, column: COLS } };

    // ── Save ───────────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer();
    const safe = title.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    message.success('Excel file downloaded');
  };

  // Show all journals modal
  const showAllJournals = (tab: AccountTab) => {
    setJournalModalData(tab.data);
    setJournalModalTitle(`All Journals - Account: ${tab.account}`);
    setJournalModalFilters({}); // Reset filters
    setJournalModalVisible(true);
  };

  // Handle modal filter change
  const handleModalFilterChange = (column: string, value: string) => {
    setJournalModalFilters((prev) => ({
      ...prev,
      [column]: value,
    }));
  };

  // Clear all modal filters
  const clearModalFilters = () => {
    setJournalModalFilters({});
  };

  // Filter modal data based on filters
  const getFilteredModalData = () => {
    return journalModalData.filter((row) => {
      return Object.entries(journalModalFilters).every(([column, filterValue]) => {
        if (!filterValue) return true;
        const cellValue = (row as any)[column];
        if (cellValue === null || cellValue === undefined) return false;
        return String(cellValue).toLowerCase().includes(filterValue.toLowerCase());
      });
    });
  };

  // Generate pivot data for account tab - groups by dropped segments + account
  const generatePivotData = (data: JournalLineSegment[]): PivotDataRow[] => {
    const pivotMap = new Map<string, PivotDataRow>();

    // Segments to group by: before segments + account + after segments
    const groupBySegments = [...segmentsBeforeAccount, 'account', ...segmentsAfterAccount];

    data.forEach((row) => {
      // Build key from selected segments only
      const keyParts = groupBySegments.map((seg) => (row as any)[seg] || '');
      const key = keyParts.join('-');

      if (!pivotMap.has(key)) {
        const pivotRow: PivotDataRow = {
          key,
          account: row.account,
          company: row.company,
          lob: row.lob,
          department: row.department,
          subAccount: row.subAccount,
          analysis: row.analysis,
          intercompany: row.intercompany,
          currencyCode: row.currencyCode,
          concatenatedSegments: key,
        };
        pivotMap.set(key, pivotRow);
      }

      const pivotRow = pivotMap.get(key)!;
      const periodKey = row.defaultPeriodName;
      // Store Debit and Credit separately for each period
      const drKey = `${periodKey}_Dr`;
      const crKey = `${periodKey}_Cr`;
      pivotRow[drKey] = ((pivotRow[drKey] as number) || 0) + (row.accountedDr || 0);
      pivotRow[crKey] = ((pivotRow[crKey] as number) || 0) + (row.accountedCr || 0);
    });

    return Array.from(pivotMap.values());
  };

  // Open all accounts pivot tab
  const openAllAccountsPivot = () => {
    if (searchData.length === 0) {
      message.warning('Please search for data first');
      return;
    }
    setAllAccountsPivotOpen(true);
    setActiveTabKey('all-accounts-pivot');
  };

  // Close all accounts pivot tab
  const closeAllAccountsPivot = () => {
    setAllAccountsPivotOpen(false);
    setAllAccountsPivotSegmentsBefore([]);
    setAllAccountsPivotSegmentsAfter([]);
    setActiveTabKey('search');
  };

  // Handle segment drop for all accounts pivot
  const handleAllAccountsSegmentDrop = (segment: string, position: 'before' | 'after') => {
    const newBefore = allAccountsPivotSegmentsBefore.filter((s) => s !== segment);
    const newAfter = allAccountsPivotSegmentsAfter.filter((s) => s !== segment);

    if (position === 'before') {
      setAllAccountsPivotSegmentsBefore([...newBefore, segment]);
      setAllAccountsPivotSegmentsAfter(newAfter);
    } else {
      setAllAccountsPivotSegmentsBefore(newBefore);
      setAllAccountsPivotSegmentsAfter([...newAfter, segment]);
    }
  };

  // Remove dropped segment from all accounts pivot
  const removeAllAccountsDroppedSegment = (segment: string) => {
    setAllAccountsPivotSegmentsBefore(allAccountsPivotSegmentsBefore.filter((s) => s !== segment));
    setAllAccountsPivotSegmentsAfter(allAccountsPivotSegmentsAfter.filter((s) => s !== segment));
  };

  // Generate pivot data for all accounts
  const generateAllAccountsPivotData = (): PivotDataRow[] => {
    const pivotMap = new Map<string, PivotDataRow>();
    const groupBySegments = [...allAccountsPivotSegmentsBefore, 'account', ...allAccountsPivotSegmentsAfter];

    searchData.forEach((row) => {
      const keyParts = groupBySegments.map((seg) => (row as any)[seg] || '');
      const key = keyParts.join('-');

      if (!pivotMap.has(key)) {
        const pivotRow: PivotDataRow = {
          key,
          account: row.account,
          accountDescription: row.accountDescription || '',
          company: row.company,
          lob: row.lob,
          department: row.department,
          subAccount: row.subAccount,
          analysis: row.analysis,
          intercompany: row.intercompany,
          currencyCode: row.currencyCode,
          concatenatedSegments: key,
        };
        pivotMap.set(key, pivotRow);
      }

      const pivotRow = pivotMap.get(key)!;
      const periodKey = row.defaultPeriodName;
      // Store Debit and Credit separately for each period
      const drKey = `${periodKey}_Dr`;
      const crKey = `${periodKey}_Cr`;
      pivotRow[drKey] = ((pivotRow[drKey] as number) || 0) + (row.accountedDr || 0);
      pivotRow[crKey] = ((pivotRow[crKey] as number) || 0) + (row.accountedCr || 0);
    });

    return Array.from(pivotMap.values());
  };

  // Get segment label by key
  const getSegmentLabel = (segment: string): string => {
    const filter = segmentFilters.find((f) => f.segment === segment);
    return filter?.label || segment;
  };

  // pivotColumns is now built inside renderAccountTab using tab.selectedPeriods

  // Create column title with filter input
  const createFilterableColumn = (
    title: string,
    dataIndex: string,
    width: number,
    options?: {
      align?: 'left' | 'right' | 'center';
      ellipsis?: boolean;
      render?: (v: any) => React.ReactNode;
    }
  ) => ({
    title: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>{title}</span>
        <Input
          size="small"
          placeholder="Filter..."
          value={journalModalFilters[dataIndex] || ''}
          onChange={(e) => handleModalFilterChange(dataIndex, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 10, padding: '2px 6px' }}
          allowClear
        />
      </div>
    ),
    dataIndex,
    key: dataIndex,
    width,
    align: options?.align,
    ellipsis: options?.ellipsis,
    render: options?.render,
  });

  // Journal detail modal columns with filters
  const journalDetailColumns: ColumnsType<JournalLineSegment> = [
    {
      title: 'Line',
      dataIndex: 'jeLineNumber',
      key: 'jeLineNumber',
      width: 70,
      render: (v: number, record: JournalLineSegment) =>
        record.isOpeningBalance ? (
          <Text strong style={{ color: REDWOOD.warning, fontSize: 11 }}>★</Text>
        ) : record.isClosingBalance ? (
          <Text strong style={{ color: REDWOOD.success, fontSize: 11 }}>★</Text>
        ) : v,
    },
    createFilterableColumn('Description', 'jeLineDescription', 180, { ellipsis: true }),
    createFilterableColumn('Period', 'defaultPeriodName', 90),
    createFilterableColumn('Batch Name', 'batchName', 180, { ellipsis: true }),
    createFilterableColumn('Source', 'userJeSourceName', 100),
    createFilterableColumn('Category', 'userJeCategoryName', 120),
    createFilterableColumn('Status', 'approvalStatusMeaning', 100),
    createFilterableColumn('Actual', 'actualFlagMeaning', 80),
    createFilterableColumn('Currency', 'currencyCode', 90),
    createFilterableColumn('Entered Dr', 'enteredDr', 110, {
      align: 'right',
      render: (v: number) => <span style={{ color: REDWOOD.success }}>{formatNumber(v)}</span>,
    }),
    createFilterableColumn('Entered Cr', 'enteredCr', 110, {
      align: 'right',
      render: (v: number) => <span style={{ color: REDWOOD.primary }}>{formatNumber(v)}</span>,
    }),
    createFilterableColumn('Accounted Dr', 'accountedDr', 110, {
      align: 'right',
      render: (v: number) => <span style={{ color: REDWOOD.success }}>{formatNumber(v)}</span>,
    }),
    createFilterableColumn('Accounted Cr', 'accountedCr', 110, {
      align: 'right',
      render: (v: number) => <span style={{ color: REDWOOD.primary }}>{formatNumber(v)}</span>,
    }),
    createFilterableColumn('Ledger', 'ledgerName', 140),
    createFilterableColumn('Legal Entity', 'legalEntityName', 140),
  ];

  // Floating Action Button component
  const FloatingIcon = ({
    icon,
    label,
    color,
    isActive,
    onClick,
    position,
  }: {
    icon: React.ReactNode;
    label: string;
    color: string;
    isActive: boolean;
    onClick: () => void;
    position: 'top' | 'bottom';
  }) => (
    <Tooltip title={!isActive ? label : ''} placement="left">
      <div
        onClick={onClick}
        style={{
          width: 48,
          height: 48,
          borderRadius: position === 'top' ? '10px 10px 0 0' : '0 0 10px 10px',
          background: isActive ? color : REDWOOD.surface,
          border: `2px solid ${color}`,
          borderBottom: position === 'top' ? 'none' : `2px solid ${color}`,
          borderTop: position === 'bottom' ? 'none' : `2px solid ${color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          boxShadow: isActive ? `0 4px 12px ${color}40` : '0 2px 8px rgba(0,0,0,0.1)',
          color: isActive ? '#fff' : color,
          fontSize: 20,
        }}
      >
        {icon}
      </div>
    </Tooltip>
  );

  // Slide-out Panel component
  const SlidePanel = ({
    title,
    items,
    color,
  }: {
    title: string;
    items: MenuItemType[];
    color: string;
  }) => (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 360,
        background: REDWOOD.surface,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        animation: isClosing
          ? 'slideOut 0.25s ease-in forwards'
          : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          background: color,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <Text strong style={{ color: '#fff', fontSize: 16 }}>
          {title}
        </Text>
        <CloseOutlined
          style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 6 }}
          onClick={closePanel}
        />
      </div>

      <div style={{ padding: 12, flex: 1, overflowY: 'auto' }}>
        {items.map((item, index) => (
          <div
            key={item.key}
            onClick={() => {
              closePanel();
              if (item.path) {
                window.location.href = item.path;
              }
            }}
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              transition: 'all 0.2s ease',
              marginBottom: 6,
              border: `1px solid ${REDWOOD.neutral200}`,
              background: REDWOOD.surface,
              opacity: 0,
              animation: `fadeInItem 0.3s ease-out ${index * 0.05}s forwards`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = REDWOOD.neutral100;
              e.currentTarget.style.borderColor = color;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = REDWOOD.surface;
              e.currentTarget.style.borderColor = REDWOOD.neutral200;
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: `${color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: color,
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              {item.icon}
            </div>
            <div style={{ flex: 1 }}>
              <Text strong style={{ display: 'block', color: REDWOOD.neutral900, fontSize: 13 }}>
                {item.label}
              </Text>
              {item.description && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {item.description}
                </Text>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Render Search tab content
  const renderSearchTab = () => {
    const totals = calculateTotals(searchData); // PTD only (used for balance summary bar)
    // Grid totals include the opening balance row
    const gridTotals = searchData.filter(row => !row.isClosingBalance).reduce(
      (acc, row) => ({
        enteredDr:   acc.enteredDr   + (row.enteredDr   || 0),
        enteredCr:   acc.enteredCr   + (row.enteredCr   || 0),
        accountedDr: acc.accountedDr + (row.accountedDr || 0),
        accountedCr: acc.accountedCr + (row.accountedCr || 0),
      }),
      { enteredDr: 0, enteredCr: 0, accountedDr: 0, accountedCr: 0 }
    );

    // Precompute running balances indexed by position in searchData
    const runningBalances: { accounted: number; entered: number }[] = [];
    let accRun = 0;
    let entRun = 0;
    searchData.forEach(row => {
      accRun += (row.accountedDr || 0) - (row.accountedCr || 0);
      entRun += (row.enteredDr   || 0) - (row.enteredCr   || 0);
      runningBalances.push({ accounted: accRun, entered: entRun });
    });

    // Border helpers for group separators
    const groupBorderLeft  = { borderLeft:  '2px solid #888' };
    const groupBorderRight = { borderRight: '2px solid #888' };
    const labelStyle: React.CSSProperties = { fontSize: 11, color: REDWOOD.neutral600, marginBottom: 3, fontWeight: 500 };
    const headerStyle = (extra?: React.CSSProperties) => ({
      onHeaderCell: () => ({ style: extra }),
      onCell:       () => ({ style: extra }),
    });

    const fmtBalance = (v: number) => {
      const abs = formatNumber(Math.abs(v));
      return v < 0
        ? <span style={{ color: REDWOOD.primary, fontWeight: 600 }}>{abs} Cr</span>
        : <span style={{ color: REDWOOD.success,  fontWeight: 600 }}>{abs}</span>;
    };

    const searchColumns: ColumnsType<JournalLineSegment> = [
      {
        title: 'Account',
        dataIndex: 'concatenatedSegments',
        key: 'concatenatedSegments',
        width: 240,
        fixed: 'left',
        render: (text: string, record: JournalLineSegment) =>
          record.isOpeningBalance ? (
            <Text strong style={{ fontSize: 10, color: REDWOOD.warning }}>
              {record.jeLineDescription}
            </Text>
          ) : record.isClosingBalance ? (
            <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>
              {record.jeLineDescription}
            </Text>
          ) : (
            <a
              onClick={() => openAccountTab(record, selectedPeriods)}
              style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 10 }}
            >
              {text || `${record.company}-${record.lob}-${record.department}-${record.account}-${record.subAccount}-${record.analysis}-${record.intercompany}`}
            </a>
          ),
      },
      {
        title: 'Description',
        dataIndex: 'accountDescription',
        key: 'accountDescription',
        width: 180,
        ellipsis: true,
        render: (text: string) => (
          <Tooltip title={text}>
            <span style={{ fontSize: 10 }}>{text || '-'}</span>
          </Tooltip>
        ),
      },
      {
        title: 'Line Description',
        dataIndex: 'jeLineDescription',
        key: 'jeLineDescription',
        width: 200,
        ellipsis: true,
        render: (text: string, record: JournalLineSegment) => (
          <Tooltip title={text}>
            <span style={{ fontSize: 10, fontWeight: (record.isOpeningBalance || record.isClosingBalance) ? 600 : undefined }}>
              {text || '-'}
            </span>
          </Tooltip>
        ),
      },
      { title: 'Period', dataIndex: 'defaultPeriodName', key: 'defaultPeriodName', width: 80 },
      { title: 'Acctg Date', dataIndex: 'accountingDate', key: 'accountingDate', width: 100 },
      { title: 'Batch', dataIndex: 'batchName', key: 'batchName', width: 150, ellipsis: true },
      { title: 'Source', dataIndex: 'userJeSourceName', key: 'userJeSourceName', width: 100 },
      { title: 'Category', dataIndex: 'userJeCategoryName', key: 'userJeCategoryName', width: 120 },
      { title: 'Currency', dataIndex: 'currencyCode', key: 'currencyCode', width: 90 },
      // Entered group — indices 9-11 when visible (Accounted shifts right when this is shown)
      ...(showEntered ? [{
        title: <span style={{ color: '#52c41a', fontWeight: 600 }}>Entered</span>,
        onHeaderCell: () => ({ style: groupBorderLeft }),
        children: [
          {
            title: 'Dr',
            dataIndex: 'enteredDr',
            key: 'enteredDr',
            width: 120,
            align: 'right' as const,
            ...headerStyle(groupBorderLeft),
            render: (v: number) => <span style={{ color: REDWOOD.success }}>{formatNumber(v)}</span>,
          },
          {
            title: 'Cr',
            dataIndex: 'enteredCr',
            key: 'enteredCr',
            width: 120,
            align: 'right' as const,
            render: (v: number) => <span style={{ color: REDWOOD.primary }}>{formatNumber(v)}</span>,
          },
          {
            title: 'Balance',
            key: 'enteredRunning',
            width: 130,
            align: 'right' as const,
            ...headerStyle(groupBorderRight),
            render: (_: any, __: JournalLineSegment, index: number) =>
              fmtBalance(runningBalances[index]?.entered ?? 0),
          },
        ],
      }] : []),
      // Accounted group — at 9-11 when Entered hidden, shifts to 12-14 when Entered visible
      {
        title: <span style={{ color: '#1677ff', fontWeight: 600 }}>Accounted</span>,
        onHeaderCell: () => ({ style: groupBorderLeft }),
        children: [
          {
            title: 'Dr',
            dataIndex: 'accountedDr',
            key: 'accountedDr',
            width: 120,
            align: 'right' as const,
            ...headerStyle(groupBorderLeft),
            render: (v: number) => <span style={{ color: REDWOOD.success }}>{formatNumber(v)}</span>,
          },
          {
            title: 'Cr',
            dataIndex: 'accountedCr',
            key: 'accountedCr',
            width: 120,
            align: 'right' as const,
            render: (v: number) => <span style={{ color: REDWOOD.primary }}>{formatNumber(v)}</span>,
          },
          {
            title: 'Balance',
            key: 'accountedRunning',
            width: 130,
            align: 'right' as const,
            ...headerStyle(groupBorderRight),
            render: (_: any, __: JournalLineSegment, index: number) =>
              fmtBalance(runningBalances[index]?.accounted ?? 0),
          },
        ],
      },
      {
        title: '',
        key: 'drillDown',
        width: 36,
        fixed: 'right' as const,
        render: (_: any, record: JournalLineSegment) => (
          <Tooltip title={`View Journal (Header ${record.jeHeaderId})`}>
            <Button
              type="text"
              size="small"
              icon={<AuditOutlined style={{ color: REDWOOD.info }} />}
              onClick={(e) => { e.stopPropagation(); openJournalDrill(record); }}
            />
          </Tooltip>
        ),
      },
    ];

    return (
      <div style={{ padding: '12px 16px 16px' }}>

        {/* ── Search Panel ── */}
        <div style={{
          background: REDWOOD.surface,
          borderRadius: 10,
          border: `1px solid ${REDWOOD.neutral200}`,
          marginBottom: 14,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          {/* Panel header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 16px',
            background: `linear-gradient(90deg, ${REDWOOD.primary}12 0%, transparent 100%)`,
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
            borderLeft: `3px solid ${REDWOOD.primary}`,
          }}>
            <Space size={8}>
              <FilterOutlined style={{ color: REDWOOD.primary, fontSize: 13 }} />
              <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900 }}>Search Parameters</Text>
            </Space>
            <Space size={6}>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleSearch}
                loading={loading}
                size="small"
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, fontSize: 11 }}
              >
                Search
              </Button>
              <Button icon={<ReloadOutlined />} size="small" onClick={handleReset} style={{ fontSize: 11 }}>Reset</Button>
              <Tooltip title="Log API URL">
                <Button
                  icon={<BugOutlined />}
                  size="small"
                  onClick={showSearchApiUrl}
                  style={{ background: '#f0f5ff', borderColor: '#adc6ff', color: '#1d39c4', fontSize: 11 }}
                />
              </Tooltip>
            </Space>
          </div>

          <div style={{ padding: '12px 16px 10px' }}>
            {/* Row 1: Ledger | Periods | Date range */}
            <Row gutter={[12, 8]} align="bottom">
              <Col xs={24} md={5}>
                <div style={labelStyle}>Ledger</div>
                <Select
                  value={selectedLedger}
                  onChange={setSelectedLedger}
                  style={{ width: '100%' }}
                  size="small"
                >
                  {ledgerOptions.map((l) => <Option key={l} value={l}>{l}</Option>)}
                </Select>
              </Col>
              <Col xs={24} md={8}>
                <div style={labelStyle}>Periods</div>
                <Select
                  mode="multiple"
                  value={selectedPeriods}
                  onChange={setSelectedPeriods}
                  style={{ width: '100%' }}
                  size="small"
                  maxTagCount={4}
                  placeholder={periodsLoading ? 'Loading…' : 'Select periods'}
                  loading={periodsLoading}
                  notFoundContent={periodsLoading ? <Spin size="small" indicator={<LoadingOutlined />} /> : 'No periods'}
                  disabled={periodsLoading}
                  allowClear
                >
                  {availablePeriods.map((p) => <Option key={p} value={p}>{p}</Option>)}
                </Select>
              </Col>
              <Col xs={12} md={3}>
                <div style={labelStyle}>Date From</div>
                <DatePicker
                  value={fromDate}
                  onChange={setFromDate}
                  style={{ width: '100%' }}
                  size="small"
                  format="DD-MMM-YYYY"
                  placeholder="From"
                  allowClear
                />
              </Col>
              <Col xs={12} md={3}>
                <div style={labelStyle}>Date To</div>
                <DatePicker
                  value={toDate}
                  onChange={setToDate}
                  style={{ width: '100%' }}
                  size="small"
                  format="DD-MMM-YYYY"
                  placeholder="To"
                  allowClear
                  disabledDate={(d) => !!fromDate && d.isBefore(fromDate, 'day')}
                />
              </Col>
            </Row>

            {/* Account Combination Segments */}
            <div style={{
              margin: '10px 0 8px',
              padding: '6px 10px',
              background: REDWOOD.neutral100,
              borderRadius: 6,
              border: `1px solid ${REDWOOD.neutral200}`,
            }}>
              <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
                Account Segments
              </Text>
            </div>

            <Row gutter={[10, 8]} align="bottom">
              <Col xs={12} sm={8} md={3}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                  <span style={labelStyle}>Company</span>
                  <Tooltip title={`API: ${COMPANY_LOV_URL}`}>
                    <ApiOutlined
                      style={{ fontSize: 10, color: REDWOOD.info, cursor: 'pointer' }}
                      onClick={() => { navigator.clipboard.writeText(COMPANY_LOV_URL); message.info('Copied'); }}
                    />
                  </Tooltip>
                </div>
                <Select
                  value={selectedCompany || undefined}
                  onChange={(v) => setSelectedCompany(v ?? '')}
                  style={{ width: '100%' }}
                  size="small"
                  placeholder="All"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                >
                  {segmentValues.companies.map((c) => (
                    <Option key={c} value={c} label={companyNames[c] ? `${c} - ${companyNames[c]}` : c}>
                      {companyNames[c] ? `${c} - ${companyNames[c]}` : c}
                    </Option>
                  ))}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <div style={labelStyle}>LOB</div>
                <Select value={lobFilter || undefined} onChange={(v) => setLobFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.lobs.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <div style={labelStyle}>Department</div>
                <Select value={departmentFilter || undefined} onChange={(v) => setDepartmentFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.departments.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={4}>
                <div style={labelStyle}>Account</div>
                <Input.Search
                  allowClear
                  value={accountFilter}
                  onChange={(e) => { setAccountFilter(e.target.value); if (!e.target.value) setAccountFilterDesc(''); }}
                  style={{ width: '100%' }}
                  size="small"
                  placeholder="e.g. 1116100"
                  enterButton={<SearchOutlined />}
                  onSearch={openAccountLookup}
                />
                {accountFilterDesc && (
                  <Text style={{ fontSize: 10, color: REDWOOD.info, display: 'block', marginTop: 2 }}>{accountFilterDesc}</Text>
                )}
              </Col>
              <Col xs={12} sm={8} md={3}>
                <div style={labelStyle}>Sub Account</div>
                <Select value={subAccountFilter || undefined} onChange={(v) => setSubAccountFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.subAccounts.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <div style={labelStyle}>Analysis</div>
                <Select value={analysisFilter || undefined} onChange={(v) => setAnalysisFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.analyses.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <div style={labelStyle}>Intercompany</div>
                <Select value={intercompanyFilter || undefined} onChange={(v) => setIntercompanyFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.intercompanies.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={2}>
                <div style={labelStyle}>Source</div>
                <Select value={jeSourceFilter || undefined} onChange={(v) => setJeSourceFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.sources.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
              <Col xs={12} sm={8} md={2}>
                <div style={labelStyle}>Category</div>
                <Select value={jeCategoryFilter || undefined} onChange={(v) => setJeCategoryFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                  {segmentValues.categories.map((v) => <Option key={v} value={v}>{v}</Option>)}
                </Select>
              </Col>
            </Row>
          </div>
        </div>

        {/* ── Results Table ── */}
        <div style={{
          background: REDWOOD.surface,
          borderRadius: 10,
          border: `1px solid ${REDWOOD.neutral200}`,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            padding: '8px 14px',
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: `linear-gradient(90deg, ${REDWOOD.info}10 0%, transparent 100%)`,
            borderLeft: `3px solid ${REDWOOD.info}`,
          }}>
            <Space size={8}>
              <TableOutlined style={{ color: REDWOOD.info, fontSize: 13 }} />
              <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900 }}>
                Journal Lines
              </Text>
              {searchData.length > 0 && (
                <Tag color="blue" style={{ fontSize: 10, padding: '0 6px', lineHeight: '18px' }}>
                  {totalCount.toLocaleString()} records
                </Tag>
              )}
            </Space>
            <Space size={6}>
              <Tooltip title={showEntered ? 'Hide Entered amounts' : 'Show Entered amounts alongside Accounted'}>
                <Button
                  size="small"
                  onClick={() => setShowEntered(v => !v)}
                  style={{
                    fontSize: 11,
                    borderColor: showEntered ? '#52c41a' : undefined,
                    color:       showEntered ? '#52c41a' : undefined,
                    background:  showEntered ? '#f6ffed' : undefined,
                    fontWeight:  showEntered ? 600 : undefined,
                  }}
                >
                  <Switch size="small" checked={showEntered} style={{ marginRight: 5, pointerEvents: 'none' }} />
                  Entered
                </Button>
              </Tooltip>
              <Button
                size="small"
                icon={<PieChartOutlined />}
                onClick={openAllAccountsPivot}
                disabled={searchData.length === 0}
                style={{ fontSize: 11 }}
              >
                View Pivot
              </Button>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled={searchData.length === 0}
                onClick={() => exportToExcel(searchData, `GL_Account_Analysis_${selectedPeriods.join('_') || 'All_Periods'}`)}
                style={{ fontSize: 11 }}
              >
                Export
              </Button>
            </Space>
          </div>

          <Spin spinning={loading}>
            <Table
              key={showEntered ? 'entered' : 'no-entered'}
              columns={searchColumns}
              dataSource={searchData}
              pagination={{ pageSize: searchPageSize, size: 'small', showSizeChanger: true, pageSizeOptions: ['10','20','50','100','200'], onShowSizeChange: (_current, size) => setSearchPageSize(size), onChange: (_page, size) => size && setSearchPageSize(size), showTotal: (total) => `Total ${total} records` }}
              scroll={{ x: 1800 }}
              size="small"
              className="compact-table aa-grid"
              rowClassName={(record: JournalLineSegment) =>
                record.isOpeningBalance ? 'opening-balance-row' : ''
              }
              locale={{ emptyText: <Empty description="Click Search to load data" /> }}
              summary={() => {
                if (searchData.length === 0) return null;
                const entBal = gridTotals.enteredDr - gridTotals.enteredCr;
                const accBal = gridTotals.accountedDr - gridTotals.accountedCr;
                const fmtTot = (v: number) =>
                  v < 0
                    ? <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(Math.abs(v))} Cr</Text>
                    : <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(v)}</Text>;
                // One explicit cell per leaf column — guaranteed alignment regardless of fixed columns.
                // showEntered=false: [0..8 static] [9=AccDr] [10=AccCr] [11=AccBal] [12=Drill]   = 13 cols
                // showEntered=true:  [0..8 static] [9=EntDr] [10=EntCr] [11=EntBal] [12=AccDr] [13=AccCr] [14=AccBal] [15=Drill] = 16 cols
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                      <Table.Summary.Cell index={0}><Text strong style={{ fontSize: 10 }}>Totals</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={1} />
                      <Table.Summary.Cell index={2} />
                      <Table.Summary.Cell index={3} />
                      <Table.Summary.Cell index={4} />
                      <Table.Summary.Cell index={5} />
                      <Table.Summary.Cell index={6} />
                      <Table.Summary.Cell index={7} />
                      <Table.Summary.Cell index={8} />
                      {showEntered ? (
                        <>
                          {/* Entered at 9-11 */}
                          {/* @ts-expect-error antd6 SummaryCell lacks style */}
                          <Table.Summary.Cell index={9} align="right" style={groupBorderLeft}>
                            <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(gridTotals.enteredDr)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={10} align="right">
                            <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(gridTotals.enteredCr)}</Text>
                          </Table.Summary.Cell>
                          {/* @ts-expect-error antd6 SummaryCell lacks style */}
                          <Table.Summary.Cell index={11} align="right" style={groupBorderRight}>{fmtTot(entBal)}</Table.Summary.Cell>
                          {/* Accounted shifts to 12-14 */}
                          {/* @ts-expect-error antd6 SummaryCell lacks style */}
                          <Table.Summary.Cell index={12} align="right" style={groupBorderLeft}>
                            <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(gridTotals.accountedDr)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={13} align="right">
                            <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(gridTotals.accountedCr)}</Text>
                          </Table.Summary.Cell>
                          {/* @ts-expect-error antd6 SummaryCell lacks style */}
                          <Table.Summary.Cell index={14} align="right" style={groupBorderRight}>{fmtTot(accBal)}</Table.Summary.Cell>
                          <Table.Summary.Cell index={15} />
                        </>
                      ) : (
                        <>
                          {/* Accounted at 9-11 when Entered hidden */}
                          {/* @ts-expect-error antd6 SummaryCell lacks style */}
                          <Table.Summary.Cell index={9} align="right" style={groupBorderLeft}>
                            <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(gridTotals.accountedDr)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={10} align="right">
                            <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(gridTotals.accountedCr)}</Text>
                          </Table.Summary.Cell>
                          {/* @ts-expect-error antd6 SummaryCell lacks style */}
                          <Table.Summary.Cell index={11} align="right" style={groupBorderRight}>{fmtTot(accBal)}</Table.Summary.Cell>
                          <Table.Summary.Cell index={12} />
                        </>
                      )}
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Spin>

          {/* Balance Summary Section */}
          {searchData.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* ── Accounted section ── */}
              <div style={{
                padding: '10px 16px',
                background: '#f0f5ff',
                borderRadius: 8,
                border: '1px solid #adc6ff',
              }}>
                <Text strong style={{ fontSize: 11, color: '#1677ff', display: 'block', marginBottom: 8 }}>
                  Accounted
                </Text>
                <Row gutter={0} align="middle">
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: `1px solid #adc6ff` }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Opening Balance</Text>
                    <Text strong style={{ fontSize: 14, color: REDWOOD.warning }}>
                      {openingBalanceRow
                        ? formatNumber((openingBalanceRow.accountedDr || 0) - (openingBalanceRow.accountedCr || 0))
                        : '—'}
                    </Text>
                  </Col>
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: `1px solid #adc6ff` }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>PTD Debits</Text>
                    <Text strong style={{ fontSize: 14, color: REDWOOD.success }}>{formatNumber(totals.accountedDr)}</Text>
                  </Col>
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: `1px solid #adc6ff` }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>PTD Credits</Text>
                    <Text strong style={{ fontSize: 14, color: REDWOOD.primary }}>{formatNumber(totals.accountedCr)}</Text>
                  </Col>
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Closing Balance</Text>
                    <Text strong style={{ fontSize: 14, color: closingBalanceRow
                      ? ((closingBalanceRow.accountedDr || 0) - (closingBalanceRow.accountedCr || 0)) >= 0 ? REDWOOD.success : REDWOOD.primary
                      : REDWOOD.neutral600 }}>
                      {closingBalanceRow
                        ? formatNumber((closingBalanceRow.accountedDr || 0) - (closingBalanceRow.accountedCr || 0))
                        : '—'}
                    </Text>
                  </Col>
                </Row>
              </div>

              {/* ── Entered section — only when toggle is on ── */}
              {showEntered && (
              <div style={{
                padding: '10px 16px',
                background: '#f6ffed',
                borderRadius: 8,
                border: '1px solid #b7eb8f',
              }}>
                <Text strong style={{ fontSize: 11, color: '#52c41a', display: 'block', marginBottom: 8 }}>
                  Entered
                </Text>
                <Row gutter={0} align="middle">
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: `1px solid #b7eb8f` }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Opening Balance</Text>
                    <Text strong style={{ fontSize: 14, color: REDWOOD.warning }}>
                      {openingBalanceRow
                        ? formatNumber((openingBalanceRow.enteredDr || 0) - (openingBalanceRow.enteredCr || 0))
                        : '—'}
                    </Text>
                  </Col>
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: `1px solid #b7eb8f` }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>PTD Debits</Text>
                    <Text strong style={{ fontSize: 14, color: REDWOOD.success }}>{formatNumber(totals.enteredDr)}</Text>
                  </Col>
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: `1px solid #b7eb8f` }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>PTD Credits</Text>
                    <Text strong style={{ fontSize: 14, color: REDWOOD.primary }}>{formatNumber(totals.enteredCr)}</Text>
                  </Col>
                  <Col flex="1" style={{ textAlign: 'center', padding: '4px 12px' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Closing Balance</Text>
                    <Text strong style={{ fontSize: 14, color: closingBalanceRow
                      ? ((closingBalanceRow.enteredDr || 0) - (closingBalanceRow.enteredCr || 0)) >= 0 ? REDWOOD.success : REDWOOD.primary
                      : REDWOOD.neutral600 }}>
                      {closingBalanceRow
                        ? formatNumber((closingBalanceRow.enteredDr || 0) - (closingBalanceRow.enteredCr || 0))
                        : '—'}
                    </Text>
                  </Col>
                </Row>
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render Account Detail tab with pivot view
  const renderAccountTab = (tab: AccountTab) => {
    const periods = tab.selectedPeriods;
    const pivotData = generatePivotData(tab.data);
    const totals = calculateTotals(tab.data);

    // Build pivot columns using this tab's periods
    const pivotColumns: ColumnsType<PivotDataRow> = [
      ...segmentsBeforeAccount.map((segment) => ({
        title: getSegmentLabel(segment),
        dataIndex: segment,
        key: segment,
        width: segment === 'company' ? 160 : 100,
        fixed: 'left' as const,
        render: segment === 'company'
          ? (v: string) => companyNames[v] ? `${v} – ${companyNames[v]}` : v
          : undefined,
      })),
      { title: 'Account', dataIndex: 'account', key: 'account', width: 100, fixed: 'left' as const },
      ...segmentsAfterAccount.map((segment) => ({
        title: getSegmentLabel(segment),
        dataIndex: segment,
        key: segment,
        width: segment === 'company' ? 160 : 100,
        fixed: 'left' as const,
        render: segment === 'company'
          ? (v: string) => companyNames[v] ? `${v} – ${companyNames[v]}` : v
          : undefined,
      })),
      ...(showDrCrColumns
        ? periods.flatMap((period) => [
            { title: `${period} Dr`, dataIndex: `${period}_Dr`, key: `${period}_Dr`, width: 100, align: 'right' as const,
              render: (v: number) => <span style={{ color: REDWOOD.success }}>{formatNumber(v || 0)}</span> },
            { title: `${period} Cr`, dataIndex: `${period}_Cr`, key: `${period}_Cr`, width: 100, align: 'right' as const,
              render: (v: number) => <span style={{ color: REDWOOD.primary }}>{formatNumber(v || 0)}</span> },
          ])
        : periods.map((period) => ({
            title: period, key: `${period}_Balance`, width: 110, align: 'right' as const,
            render: (_: any, record: PivotDataRow) => {
              const balance = ((record[`${period}_Dr`] as number) || 0) - ((record[`${period}_Cr`] as number) || 0);
              return <span style={{ color: balance >= 0 ? REDWOOD.success : REDWOOD.primary }}>{formatNumber(balance)}</span>;
            },
          }))),
      ...(showDrCrColumns
        ? [
            { title: 'Total Dr', key: 'totalDr', width: 110, align: 'right' as const, fixed: 'right' as const,
              render: (_: any, record: PivotDataRow) => <Text strong style={{ color: REDWOOD.success }}>{formatNumber(periods.reduce((s, p) => s + ((record[`${p}_Dr`] as number) || 0), 0))}</Text> },
            { title: 'Total Cr', key: 'totalCr', width: 110, align: 'right' as const, fixed: 'right' as const,
              render: (_: any, record: PivotDataRow) => <Text strong style={{ color: REDWOOD.primary }}>{formatNumber(periods.reduce((s, p) => s + ((record[`${p}_Cr`] as number) || 0), 0))}</Text> },
          ]
        : [
            { title: 'Total Balance', key: 'totalBalance', width: 120, align: 'right' as const, fixed: 'right' as const,
              render: (_: any, record: PivotDataRow) => {
                const bal = periods.reduce((s, p) => s + ((record[`${p}_Dr`] as number) || 0) - ((record[`${p}_Cr`] as number) || 0), 0);
                return <Text strong style={{ color: bal >= 0 ? REDWOOD.success : REDWOOD.primary }}>{formatNumber(bal)}</Text>;
              } },
          ]),
    ];

    return (
      <div style={{ padding: 16 }}>
        {/* Account Header */}
        <Card
          style={{ marginBottom: 16, borderRadius: 8 }}
          bodyStyle={{ padding: 12 }}
        >
          <Row gutter={[16, 8]} align="middle">
            <Col flex="auto">
              <Space split={<Divider type="vertical" />}>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Account</Text>
                  <Text strong style={{ fontSize: 12, display: 'block' }}>{tab.account}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Company</Text>
                  <Text style={{ fontSize: 12, display: 'block' }}>{tab.company}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Records</Text>
                  <Text style={{ fontSize: 12, display: 'block' }}>{tab.data.length}</Text>
                </div>
              </Space>
            </Col>
            <Col>
              <Space size="small">
                <Button
                  size="small"
                  icon={<UnorderedListOutlined />}
                  onClick={() => showAllJournals(tab)}
                >
                  Show All Journals
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const endpoints = periods.map((period) => {
                      const params = new URLSearchParams();
                      params.append('P_ACCOUNT', tab.account);
                      params.append('P_PERIOD_NAME', period);
                      params.append('P_CURRENCY_CODE', 'AED');
                      return `${API_BASE_URL}/accountanalysis/byaccount?${params.toString()}`;
                    });
                    console.log('API Endpoints:', endpoints);
                    message.info(
                      <div style={{ maxWidth: 600, wordBreak: 'break-all' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>API Endpoints:</div>
                        {endpoints.map((url, i) => (
                          <div key={i} style={{ fontSize: 11, marginBottom: 4 }}>{url}</div>
                        ))}
                      </div>,
                      10
                    );
                  }}
                >
                  Log
                </Button>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={tab.data.length === 0}
                  onClick={() => exportToExcel(tab.data, `GL_Account_${tab.account}_${periods.join('_') || 'All_Periods'}`)}
                >
                  Export
                </Button>
                <Checkbox
                  checked={showDrCrColumns}
                  onChange={(e) => setShowDrCrColumns(e.target.checked)}
                  style={{ fontSize: 11 }}
                >
                  Show Dr/Cr
                </Checkbox>
              </Space>
            </Col>
          </Row>

          {/* PTD Totals Summary */}
          <Divider style={{ margin: '12px 0' }} />
          <Text strong style={{ fontSize: 11, color: '#6B6B6B' }}>PTD Totals</Text>
          <Row gutter={[24, 8]}>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Entered Dr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.success }}>
                {formatNumber(totals.enteredDr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Entered Cr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.primary }}>
                {formatNumber(totals.enteredCr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Accounted Dr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.success }}>
                {formatNumber(totals.accountedDr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Accounted Cr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.primary }}>
                {formatNumber(totals.accountedCr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Net Balance</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: (totals.accountedDr - totals.accountedCr) >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                {formatNumber(totals.accountedDr - totals.accountedCr)}
              </Text>
            </Col>
          </Row>

          {/* Draggable Segment Filters */}
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
              <FilterOutlined /> Segments (drag to pivot):
            </Text>
            {segmentFilters.map((filter) => (
              <Tag
                key={filter.segment}
                style={{
                  cursor: 'grab',
                  padding: '4px 8px',
                  fontSize: 11,
                  background: filter.isDropped ? `${REDWOOD.info}15` : REDWOOD.neutral100,
                  borderColor: filter.isDropped ? REDWOOD.info : REDWOOD.neutral300,
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('segment', filter.segment);
                }}
              >
                <DragOutlined style={{ marginRight: 4 }} />
                {filter.label}
              </Tag>
            ))}
          </div>

          {/* Dropped segments with drop zones */}
          <div
            style={{
              marginTop: 12,
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
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Pivot columns:</Text>

            {/* Drop zone BEFORE Account */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const segment = e.dataTransfer.getData('segment');
                if (segment) handleSegmentDrop(segment, 'before');
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
              {segmentsBeforeAccount.length === 0 && (
                <Text type="secondary" style={{ fontSize: 10 }}>Drop here (before)</Text>
              )}
              {segmentsBeforeAccount.map((segment) => (
                <Tag
                  key={segment}
                  closable
                  onClose={() => removeDroppedSegment(segment)}
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

            {/* Drop zone AFTER Account */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const segment = e.dataTransfer.getData('segment');
                if (segment) handleSegmentDrop(segment, 'after');
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
              {segmentsAfterAccount.length === 0 && (
                <Text type="secondary" style={{ fontSize: 10 }}>Drop here (after)</Text>
              )}
              {segmentsAfterAccount.map((segment) => (
                <Tag
                  key={segment}
                  closable
                  onClose={() => removeDroppedSegment(segment)}
                  style={{ fontSize: 11, margin: 0 }}
                  color="cyan"
                >
                  {getSegmentLabel(segment)}
                </Tag>
              ))}
            </div>

            {/* Period columns indicator */}
            <Tag style={{ fontSize: 11, margin: 0 }} color="green">
              Periods ({selectedPeriods.length})
            </Tag>
            <Tag style={{ fontSize: 11, margin: 0 }} color="orange">
              Total
            </Tag>
          </div>
        </Card>

        {/* Pivot Table */}
        <Card
          style={{ borderRadius: 8 }}
          bodyStyle={{ padding: 0 }}
        >
          <div
            style={{
              padding: '10px 16px',
              background: REDWOOD.neutral100,
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Space>
              <TableOutlined style={{ color: REDWOOD.info }} />
              <Text strong style={{ fontSize: 12 }}>Pivot View - Period Analysis</Text>
            </Space>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Periods: {periods.join(', ')}
            </Text>
          </div>

          <Spin spinning={tab.loading}>
            <Table
              columns={pivotColumns}
              dataSource={pivotData}
              pagination={false}
              scroll={{ x: 800 }}
              size="small"
              className="compact-table aa-grid"
              summary={() => {
                const periodTotals: { [key: string]: number } = {};
                periods.forEach((period) => {
                  periodTotals[period] = pivotData.reduce(
                    (sum, row) => sum + ((row[period] as number) || 0),
                    0
                  );
                });
                const grandTotal = Object.values(periodTotals).reduce((a, b) => a + b, 0);

                // Calculate number of segment columns (before + account + after)
                const segmentColCount = segmentsBeforeAccount.length + 1 + segmentsAfterAccount.length;

                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                      <Table.Summary.Cell index={0} colSpan={segmentColCount}>
                        <Text strong style={{ fontSize: 11 }}>PTD Totals</Text>
                      </Table.Summary.Cell>
                      {periods.map((period, idx) => (
                        <Table.Summary.Cell key={period} index={segmentColCount + idx} align="right">
                          <Text strong style={{ fontSize: 11, color: periodTotals[period] >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                            {formatNumber(periodTotals[period])}
                          </Text>
                        </Table.Summary.Cell>
                      ))}
                      <Table.Summary.Cell index={segmentColCount + periods.length} align="right">
                        <Text strong style={{ fontSize: 11, color: grandTotal >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                          {formatNumber(grandTotal)}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Spin>
        </Card>
      </div>
    );
  };

  // Render All Accounts Pivot tab
  const renderAllAccountsPivotTab = () => {
    const allPivotData = generateAllAccountsPivotData();
    const totals = calculateTotals(searchData);
    const currencyIsGrouped =
      allAccountsPivotSegmentsBefore.includes('currencyCode') ||
      allAccountsPivotSegmentsAfter.includes('currencyCode');

    // Dynamic columns for all accounts pivot
    const allAccountsPivotColumns: ColumnsType<PivotDataRow> = [
      ...allAccountsPivotSegmentsBefore.map((segment) => ({
        title: getSegmentLabel(segment),
        dataIndex: segment,
        key: segment,
        width: segment === 'company' ? 160 : 100,
        fixed: 'left' as const,
        render: segment === 'company'
          ? (v: string) => companyNames[v] ? `${v} – ${companyNames[v]}` : v
          : undefined,
      })),
      {
        title: 'Account',
        dataIndex: 'account',
        key: 'account',
        width: 100,
        fixed: 'left' as const,
      },
      {
        title: 'Description',
        dataIndex: 'accountDescription',
        key: 'accountDescription',
        width: 180,
        fixed: 'left' as const,
        ellipsis: true,
      },
      ...allAccountsPivotSegmentsAfter.map((segment) => ({
        title: getSegmentLabel(segment),
        dataIndex: segment,
        key: segment,
        width: segment === 'company' ? 160 : 100,
        fixed: 'left' as const,
        render: segment === 'company'
          ? (v: string) => companyNames[v] ? `${v} – ${companyNames[v]}` : v
          : undefined,
      })),
      // Dynamic period columns - grouped by month with Debit, Credit, Balance
      ...selectedPeriods.map((period) => ({
        title: period,
        key: period,
        children: [
          {
            title: 'Debit',
            dataIndex: `${period}_Dr`,
            key: `${period}_Dr`,
            width: 100,
            align: 'right' as const,
            render: (v: number) => (
              <span style={{ color: REDWOOD.success }}>
                {formatNumber(v || 0)}
              </span>
            ),
          },
          {
            title: 'Credit',
            dataIndex: `${period}_Cr`,
            key: `${period}_Cr`,
            width: 100,
            align: 'right' as const,
            render: (v: number) => (
              <span style={{ color: REDWOOD.primary }}>
                {formatNumber(v || 0)}
              </span>
            ),
          },
          {
            title: 'Balance',
            key: `${period}_Balance`,
            width: 100,
            align: 'right' as const,
            render: (_: any, record: PivotDataRow) => {
              const dr = (record[`${period}_Dr`] as number) || 0;
              const cr = (record[`${period}_Cr`] as number) || 0;
              const balance = dr - cr;
              return (
                <span style={{ color: balance >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                  {formatNumber(balance)}
                </span>
              );
            },
          },
        ],
      })),
      // Opening Balance column — only shown when currency is a grouping dimension
      ...(currencyIsGrouped ? [{
        title: 'Opening Bal',
        key: 'openingBal',
        width: 120,
        align: 'right' as const,
        render: (_: any, record: PivotDataRow) => {
          const k = `${record.account}||${record.currencyCode}`;
          const ob = currencyOpenings.get(k);
          if (!ob) return <span style={{ color: '#bbb' }}>—</span>;
          const bal = ob.accountedDr - ob.accountedCr;
          return <span style={{ color: bal >= 0 ? REDWOOD.success : REDWOOD.primary }}>{formatNumber(bal)}</span>;
        },
      }] : []),
      // Total Balance column only
      {
        title: 'Total Balance',
        key: 'totalBalance',
        width: 120,
        align: 'right' as const,
        fixed: 'right' as const,
        render: (_: any, record: PivotDataRow) => {
          const totalBalance = selectedPeriods.reduce((sum, period) => {
            const dr = (record[`${period}_Dr`] as number) || 0;
            const cr = (record[`${period}_Cr`] as number) || 0;
            return sum + (dr - cr);
          }, 0);
          return (
            <Text strong style={{ color: totalBalance >= 0 ? REDWOOD.success : REDWOOD.primary }}>
              {formatNumber(totalBalance)}
            </Text>
          );
        },
      },
    ];

    return (
      <div style={{ padding: 16 }}>
        {/* Header */}
        <Card
          style={{ marginBottom: 16, borderRadius: 8 }}
          bodyStyle={{ padding: 12 }}
        >
          <Row gutter={[16, 8]} align="middle">
            <Col flex="auto">
              <Space split={<Divider type="vertical" />}>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Ledger</Text>
                  <Text strong style={{ fontSize: 12, display: 'block' }}>{selectedLedger}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Company</Text>
                  <Text style={{ fontSize: 12, display: 'block' }}>{selectedCompany}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Periods</Text>
                  <Text style={{ fontSize: 12, display: 'block' }}>{selectedPeriods.join(', ')}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Total Records</Text>
                  <Text style={{ fontSize: 12, display: 'block' }}>{searchData.length}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 10 }}>Unique Accounts</Text>
                  <Text style={{ fontSize: 12, display: 'block' }}>{allPivotData.length}</Text>
                </div>
              </Space>
            </Col>
            <Col>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled={searchData.length === 0}
                onClick={() => exportToExcel(searchData, `GL_All_Accounts_Pivot_${selectedPeriods.join('_') || 'All_Periods'}`)}
              >
                Export
              </Button>
            </Col>
          </Row>

          {/* PTD Totals Summary */}
          <Divider style={{ margin: '12px 0' }} />
          <Text strong style={{ fontSize: 11, color: '#6B6B6B' }}>PTD Totals</Text>
          <Row gutter={[24, 8]}>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Entered Dr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.success }}>
                {formatNumber(totals.enteredDr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Entered Cr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.primary }}>
                {formatNumber(totals.enteredCr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Accounted Dr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.success }}>
                {formatNumber(totals.accountedDr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Accounted Cr</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: REDWOOD.primary }}>
                {formatNumber(totals.accountedCr)}
              </Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 10 }}>Net Balance</Text>
              <Text strong style={{ fontSize: 12, display: 'block', color: (totals.accountedDr - totals.accountedCr) >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                {formatNumber(totals.accountedDr - totals.accountedCr)}
              </Text>
            </Col>
          </Row>

          {/* Draggable Segment Filters */}
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
              <FilterOutlined /> Segments (drag to pivot):
            </Text>
            {segmentFilters.map((filter) => (
              <Tag
                key={filter.segment}
                style={{
                  cursor: 'grab',
                  padding: '4px 8px',
                  fontSize: 11,
                  background: (allAccountsPivotSegmentsBefore.includes(filter.segment) || allAccountsPivotSegmentsAfter.includes(filter.segment))
                    ? `${REDWOOD.info}15`
                    : REDWOOD.neutral100,
                  borderColor: (allAccountsPivotSegmentsBefore.includes(filter.segment) || allAccountsPivotSegmentsAfter.includes(filter.segment))
                    ? REDWOOD.info
                    : REDWOOD.neutral300,
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('segment', filter.segment);
                }}
              >
                <DragOutlined style={{ marginRight: 4 }} />
                {filter.label}
              </Tag>
            ))}
          </div>

          {/* Dropped segments with drop zones */}
          <div
            style={{
              marginTop: 12,
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
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Pivot columns:</Text>

            {/* Drop zone BEFORE Account */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const segment = e.dataTransfer.getData('segment');
                if (segment) handleAllAccountsSegmentDrop(segment, 'before');
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
              {allAccountsPivotSegmentsBefore.length === 0 && (
                <Text type="secondary" style={{ fontSize: 10 }}>Drop here (before)</Text>
              )}
              {allAccountsPivotSegmentsBefore.map((segment) => (
                <Tag
                  key={segment}
                  closable
                  onClose={() => removeAllAccountsDroppedSegment(segment)}
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

            {/* Drop zone AFTER Account */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const segment = e.dataTransfer.getData('segment');
                if (segment) handleAllAccountsSegmentDrop(segment, 'after');
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
              {allAccountsPivotSegmentsAfter.length === 0 && (
                <Text type="secondary" style={{ fontSize: 10 }}>Drop here (after)</Text>
              )}
              {allAccountsPivotSegmentsAfter.map((segment) => (
                <Tag
                  key={segment}
                  closable
                  onClose={() => removeAllAccountsDroppedSegment(segment)}
                  style={{ fontSize: 11, margin: 0 }}
                  color="cyan"
                >
                  {getSegmentLabel(segment)}
                </Tag>
              ))}
            </div>

            {/* Period columns indicator */}
            <Tag style={{ fontSize: 11, margin: 0 }} color="green">
              Periods ({selectedPeriods.length})
            </Tag>
            <Tag style={{ fontSize: 11, margin: 0 }} color="orange">
              Total
            </Tag>
          </div>
        </Card>

        {/* Pivot Table */}
        <Card
          style={{ borderRadius: 8 }}
          bodyStyle={{ padding: 0 }}
        >
          <div
            style={{
              padding: '10px 16px',
              background: REDWOOD.neutral100,
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Space>
              <PieChartOutlined style={{ color: REDWOOD.info }} />
              <Text strong style={{ fontSize: 12 }}>All Accounts Pivot - Period Analysis</Text>
            </Space>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {allPivotData.length} accounts | Periods: {selectedPeriods.join(', ')}
            </Text>
          </div>

          <Table
            columns={allAccountsPivotColumns}
            dataSource={allPivotData}
            pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: (total) => `${total} accounts` }}
            scroll={{ x: 800 }}
            size="small"
            className="compact-table"
            summary={() => {
              // Calculate totals for Dr and Cr for each period
              const periodDrTotals: { [key: string]: number } = {};
              const periodCrTotals: { [key: string]: number } = {};
              selectedPeriods.forEach((period) => {
                periodDrTotals[period] = allPivotData.reduce(
                  (sum, row) => sum + ((row[`${period}_Dr`] as number) || 0),
                  0
                );
                periodCrTotals[period] = allPivotData.reduce(
                  (sum, row) => sum + ((row[`${period}_Cr`] as number) || 0),
                  0
                );
              });

              // Grand totals
              const grandTotalDr = Object.values(periodDrTotals).reduce((a, b) => a + b, 0);
              const grandTotalCr = Object.values(periodCrTotals).reduce((a, b) => a + b, 0);
              const grandBalance = grandTotalDr - grandTotalCr;

              const segmentColCount = allAccountsPivotSegmentsBefore.length + 2 + allAccountsPivotSegmentsAfter.length; // +2 for Account + Description

              return (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0} colSpan={segmentColCount}>
                      <Text strong style={{ fontSize: 11 }}>PTD Totals</Text>
                    </Table.Summary.Cell>
                    {/* Period columns: Debit, Credit, Balance for each period */}
                    {selectedPeriods.flatMap((period, idx) => {
                      const periodBalance = periodDrTotals[period] - periodCrTotals[period];
                      return [
                        <Table.Summary.Cell key={`${period}_Dr`} index={segmentColCount + idx * 3} align="right">
                          <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>
                            {formatNumber(periodDrTotals[period])}
                          </Text>
                        </Table.Summary.Cell>,
                        <Table.Summary.Cell key={`${period}_Cr`} index={segmentColCount + idx * 3 + 1} align="right">
                          <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>
                            {formatNumber(periodCrTotals[period])}
                          </Text>
                        </Table.Summary.Cell>,
                        <Table.Summary.Cell key={`${period}_Bal`} index={segmentColCount + idx * 3 + 2} align="right">
                          <Text strong style={{ fontSize: 11, color: periodBalance === 0 ? REDWOOD.success : (periodBalance > 0 ? REDWOOD.success : REDWOOD.primary) }}>
                            {formatNumber(periodBalance)} {periodBalance === 0 ? '✓' : ''}
                          </Text>
                        </Table.Summary.Cell>,
                      ];
                    })}
                    {/* Total Balance only */}
                    <Table.Summary.Cell key="totalBal" index={segmentColCount + selectedPeriods.length * 3} align="right">
                      <Text strong style={{ fontSize: 11, color: grandBalance === 0 ? REDWOOD.success : (grandBalance > 0 ? REDWOOD.success : REDWOOD.primary) }}>
                        {formatNumber(grandBalance)} {grandBalance === 0 ? '✓' : ''}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
        </Card>
      </div>
    );
  };

  // Build tabs
  const tabItems = [
    ...searchTabInstances.map((instance) => ({
      key: instance.key,
      label: (
        <span style={{ fontSize: 12 }}>
          <SearchOutlined style={{ marginRight: 6 }} />
          {instance.label}
        </span>
      ),
      children: (
        <SearchTabPanel
          key={instance.key}
          ledgerOptions={ledgerOptions}
          onOpenAccountTab={openAccountTab}
        />
      ),
      closable: searchTabInstances.length > 1,
    })),
    ...accountTabs.map((tab) => ({
      key: tab.key,
      label: (
        <span style={{ fontSize: 12 }}>
          <FundOutlined style={{ marginRight: 6 }} />
          {tab.account}
        </span>
      ),
      children: renderAccountTab(tab),
      closable: true,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div
          style={{
            padding: '10px 24px',
            background: REDWOOD.surface,
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <Breadcrumb
              style={{ marginBottom: 2 }}
              items={[
                { title: <Link to="/home"><HomeOutlined /> Home</Link> },
                { title: <Link to="/gl">General Ledger</Link> },
                { title: 'Account Analysis' },
              ]}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <FundOutlined style={{ color: REDWOOD.primary, fontSize: 16 }} />
              <Text strong style={{ fontSize: 16, color: REDWOOD.neutral900 }}>Account Analysis</Text>
            </div>
          </div>
        </div>

        {/* Tabbed Content */}
        <div style={{ padding: '0 16px 16px 16px' }}>
          <Tabs
            type="editable-card"
            activeKey={activeTabKey}
            onChange={onTabChange}
            onEdit={onTabEdit}
            hideAdd
            items={tabItems}
            style={{ marginTop: 8 }}
            tabBarExtraContent={{
              right: (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={addSearchTab}
                  style={{ marginRight: 8, fontSize: 12 }}
                >
                  New Analysis
                </Button>
              ),
            }}
          />
        </div>

        {/* Journal Detail Modal */}
        <Modal
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 24 }}>
              <span>{journalModalTitle}</span>
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Showing {getFilteredModalData().length} of {journalModalData.length} records
                </Text>
                {Object.keys(journalModalFilters).some(k => journalModalFilters[k]) && (
                  <Button size="small" onClick={clearModalFilters}>
                    Clear Filters
                  </Button>
                )}
              </Space>
            </div>
          }
          open={journalModalVisible}
          onCancel={() => setJournalModalVisible(false)}
          footer={null}
          width={1400}
          style={{ top: 20 }}
        >
          <Table
            columns={journalDetailColumns}
            dataSource={getFilteredModalData()}
            pagination={{ pageSize: 15, size: 'small', showTotal: (total) => `${total} records` }}
            scroll={{ x: 1700 }}
            size="small"
            className="compact-table"
            rowClassName={(record: JournalLineSegment) =>
              record.isOpeningBalance ? 'opening-balance-row' : ''
            }
            summary={() => {
              const filteredData = getFilteredModalData();
              const totals = calculateTotals(filteredData);
              return (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0} colSpan={9}>
                      <Text strong style={{ fontSize: 11 }}>PTD Totals (filtered)</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>
                        {formatNumber(totals.enteredDr)}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={10} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>
                        {formatNumber(totals.enteredCr)}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={11} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>
                        {formatNumber(totals.accountedDr)}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={12} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>
                        {formatNumber(totals.accountedCr)}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={13} colSpan={2} />
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
        </Modal>

        {/* Journal Drill-Down Modal — grouped by journal */}
        <Modal
          title={
            <Space>
              <AuditOutlined style={{ color: REDWOOD.info }} />
              <Text strong>Journal Breakdown</Text>
              {journalDrillRecord && (
                <>
                  <Tag color="blue">{journalDrillRecord.account}</Tag>
                  {journalDrillRecord.accountDescription && (
                    <Text type="secondary" style={{ fontSize: 11 }}>{journalDrillRecord.accountDescription}</Text>
                  )}
                </>
              )}
              <Tag color="geekblue" style={{ fontSize: 11 }}>
                {journalGroups.length} journal{journalGroups.length !== 1 ? 's' : ''}
              </Tag>
              <Tooltip title="Show search API URL">
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  style={{ color: REDWOOD.info, fontSize: 11 }}
                  onClick={() => showSearchApiUrl()}
                />
              </Tooltip>
            </Space>
          }
          open={journalDrillVisible}
          onCancel={() => setJournalDrillVisible(false)}
          footer={null}
          width={1200}
          style={{ top: 20 }}
        >
          <Table
            dataSource={journalGroups}
            rowKey="key"
            size="small"
            pagination={false}
            scroll={{ x: 900 }}
            expandable={{
              defaultExpandedRowKeys: journalDrillRecord
                ? [`jg-${journalDrillRecord.jeHeaderId}`]
                : [],
              expandedRowRender: (group) => {
                // Deduplicate by jeLineNumber within the group (safety net)
                const seenLines = new Set<number>();
                const uniqueLines = group.lines.filter(l => {
                  if (seenLines.has(l.jeLineNumber)) return false;
                  seenLines.add(l.jeLineNumber);
                  return true;
                });
                return (
                  <Table
                    dataSource={uniqueLines.map((l, i) => ({ ...l, key: `${group.jeHeaderId}-${i}` }))}
                    size="small"
                    pagination={false}
                    style={{ margin: '4px 0' }}
                    columns={[
                      { title: '#', dataIndex: 'jeLineNumber', key: 'jeLineNumber', width: 40 },
                      {
                        title: 'Line Description',
                        dataIndex: 'jeLineDescription',
                        key: 'jeLineDescription',
                        ellipsis: true,
                        render: (v: string) => (
                          <Tooltip title={v}>
                            <span style={{ fontSize: 11 }}>{v || '-'}</span>
                          </Tooltip>
                        ),
                      },
                      {
                        title: 'Account',
                        dataIndex: 'concatenatedSegments',
                        key: 'concatenatedSegments',
                        width: 200,
                        render: (v: string) => <Text code style={{ fontSize: 10 }}>{v}</Text>,
                      },
                      {
                        title: 'Account Desc',
                        dataIndex: 'accountDescription',
                        key: 'accountDescription',
                        width: 150,
                        ellipsis: true,
                        render: (v: string) => (
                          <Tooltip title={v}>
                            <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '-'}</span>
                          </Tooltip>
                        ),
                      },
                      {
                        title: 'Entered Dr',
                        dataIndex: 'enteredDr',
                        key: 'enteredDr',
                        width: 105,
                        align: 'right' as const,
                        render: (v: number) => v
                          ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span>
                          : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                      },
                      {
                        title: 'Entered Cr',
                        dataIndex: 'enteredCr',
                        key: 'enteredCr',
                        width: 105,
                        align: 'right' as const,
                        render: (v: number) => v
                          ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span>
                          : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                      },
                      {
                        title: 'Accounted Dr',
                        dataIndex: 'accountedDr',
                        key: 'accountedDr',
                        width: 110,
                        align: 'right' as const,
                        render: (v: number) => v
                          ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span>
                          : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                      },
                      {
                        title: 'Accounted Cr',
                        dataIndex: 'accountedCr',
                        key: 'accountedCr',
                        width: 110,
                        align: 'right' as const,
                        render: (v: number) => v
                          ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span>
                          : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                      },
                      {
                        title: 'Ccy',
                        dataIndex: 'currencyCode',
                        key: 'currencyCode',
                        width: 50,
                        render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag>,
                      },
                    ]}
                  />
                );
              },
            }}
            columns={[
              {
                title: 'Period',
                dataIndex: 'defaultPeriodName',
                key: 'defaultPeriodName',
                width: 80,
                render: (v: string) => <Tag color="geekblue" style={{ fontSize: 11 }}>{v}</Tag>,
              },
              {
                title: 'Batch / Journal',
                dataIndex: 'batchName',
                key: 'batchName',
                ellipsis: true,
                render: (v: string, rec) => (
                  <Tooltip title={v || `JE Header #${rec.jeHeaderId}`}>
                    <div style={{ lineHeight: 1.3 }}>
                      <Text strong style={{ fontSize: 11, display: 'block' }}>
                        {v || <Text type="secondary" style={{ fontSize: 11 }}>JE Header #{rec.jeHeaderId}</Text>}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 10 }}>ID: {rec.jeHeaderId}</Text>
                    </div>
                  </Tooltip>
                ),
              },
              {
                title: 'Source',
                dataIndex: 'userJeSourceName',
                key: 'userJeSourceName',
                width: 110,
                render: (v: string) => <span style={{ fontSize: 11 }}>{v}</span>,
              },
              {
                title: 'Category',
                dataIndex: 'userJeCategoryName',
                key: 'userJeCategoryName',
                width: 110,
                render: (v: string) => <span style={{ fontSize: 11 }}>{v}</span>,
              },
              {
                title: 'Lines',
                key: 'lineCount',
                width: 50,
                align: 'center' as const,
                render: (_: any, rec) => <Tag style={{ fontSize: 10 }}>{rec.lines.length}</Tag>,
              },
              {
                title: 'Entered Dr',
                key: 'totalEnteredDr',
                width: 110,
                align: 'right' as const,
                render: (_: any, rec) => rec.totalEnteredDr
                  ? <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(rec.totalEnteredDr)}</Text>
                  : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
              },
              {
                title: 'Entered Cr',
                key: 'totalEnteredCr',
                width: 110,
                align: 'right' as const,
                render: (_: any, rec) => rec.totalEnteredCr
                  ? <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(rec.totalEnteredCr)}</Text>
                  : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
              },
              {
                title: 'Accounted Dr',
                key: 'totalAccountedDr',
                width: 110,
                align: 'right' as const,
                render: (_: any, rec) => rec.totalAccountedDr
                  ? <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(rec.totalAccountedDr)}</Text>
                  : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
              },
              {
                title: 'Accounted Cr',
                key: 'totalAccountedCr',
                width: 110,
                align: 'right' as const,
                render: (_: any, rec) => rec.totalAccountedCr
                  ? <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(rec.totalAccountedCr)}</Text>
                  : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
              },
              {
                title: '',
                key: 'fullJournal',
                width: 130,
                render: (_: any, rec) => (
                  <Space size={4}>
                    <Tooltip title="View full journal (all lines)">
                      <Button
                        size="small"
                        type="link"
                        icon={<AuditOutlined />}
                        style={{ fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openFullJournal(rec.jeHeaderId, rec.batchName, rec.defaultPeriodName);
                        }}
                      >
                        Full Journal
                      </Button>
                    </Tooltip>
                    <Tooltip title={`${API_BASE_URL}/journals/${rec.jeHeaderId}/lines`} placement="topRight">
                      <Button
                        size="small"
                        type="text"
                        icon={<LinkOutlined />}
                        style={{ color: REDWOOD.info, fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          Modal.info({
                            title: 'Drill API Endpoint',
                            width: 680,
                            content: (
                              <div style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 12, padding: '8px 0' }}>
                                {`${API_BASE_URL}/journals/${rec.jeHeaderId}/lines`}
                              </div>
                            ),
                          });
                        }}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
            ]}
            summary={() => {
              const totEntDr  = journalGroups.reduce((s, g) => s + g.totalEnteredDr,   0);
              const totEntCr  = journalGroups.reduce((s, g) => s + g.totalEnteredCr,   0);
              const totAccDr  = journalGroups.reduce((s, g) => s + g.totalAccountedDr, 0);
              const totAccCr  = journalGroups.reduce((s, g) => s + g.totalAccountedCr, 0);
              return (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0} colSpan={6}>
                      <Text strong style={{ fontSize: 11 }}>
                        Grand Total ({journalGroups.length} journal{journalGroups.length !== 1 ? 's' : ''})
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(totEntDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(totEntCr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(totAccDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="right">
                      <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(totAccCr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={10} />
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
        </Modal>

        {/* Full Journal Modal — all lines for a specific journal header */}
        <Modal
          title={
            fullJournalMeta && (
              <Space>
                <AuditOutlined style={{ color: REDWOOD.success }} />
                <Text strong>Full Journal</Text>
                <Tag color="geekblue">{fullJournalMeta.period}</Tag>
                <Tooltip title={fullJournalMeta.batchName}>
                  <Text style={{ fontSize: 12, maxWidth: 400 }} ellipsis>{fullJournalMeta.batchName}</Text>
                </Tooltip>
                <Text type="secondary" style={{ fontSize: 11 }}>#{fullJournalMeta.jeHeaderId}</Text>
              </Space>
            )
          }
          open={fullJournalVisible}
          onCancel={() => setFullJournalVisible(false)}
          footer={null}
          width={1100}
          style={{ top: 30 }}
          zIndex={1100}
        >
          <Spin spinning={fullJournalLoading} indicator={<LoadingOutlined />}>
            <Table
              dataSource={fullJournalLines.map((l: any, i: number) => ({ ...l, key: i }))}
              size="small"
              pagination={{ pageSize: 25, size: 'small', showTotal: (t) => `${t} lines` }}
              scroll={{ x: 900 }}
              columns={[
                { title: '#', dataIndex: 'lineNum', key: 'lineNum', width: 44 },
                {
                  title: 'Account',
                  dataIndex: 'account',
                  key: 'account',
                  width: 220,
                  render: (v: string) => <Text code style={{ fontSize: 11 }}>{v || '-'}</Text>,
                },
                {
                  title: 'Account Desc',
                  dataIndex: 'accountDescription',
                  key: 'accountDescription',
                  width: 150,
                  ellipsis: true,
                  render: (v: string) => (
                    <Tooltip title={v}>
                      <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '-'}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  ellipsis: true,
                  render: (v: string) => (
                    <Tooltip title={v}>
                      <span style={{ fontSize: 11 }}>{v || '-'}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Entered Dr',
                  dataIndex: 'enteredDr',
                  key: 'enteredDr',
                  width: 115,
                  align: 'right' as const,
                  render: (v: number) => v
                    ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span>
                    : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                },
                {
                  title: 'Entered Cr',
                  dataIndex: 'enteredCr',
                  key: 'enteredCr',
                  width: 115,
                  align: 'right' as const,
                  render: (v: number) => v
                    ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span>
                    : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                },
                {
                  title: 'Accounted Dr',
                  dataIndex: 'accountedDr',
                  key: 'accountedDr',
                  width: 115,
                  align: 'right' as const,
                  render: (v: number) => v
                    ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span>
                    : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                },
                {
                  title: 'Accounted Cr',
                  dataIndex: 'accountedCr',
                  key: 'accountedCr',
                  width: 115,
                  align: 'right' as const,
                  render: (v: number) => v
                    ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span>
                    : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span>,
                },
                {
                  title: 'Ccy',
                  dataIndex: 'currency',
                  key: 'currency',
                  width: 55,
                  render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag>,
                },
              ]}
              summary={(pageData) => {
                const dr = pageData.reduce((s: number, r: any) => s + (r.enteredDr || 0), 0);
                const cr = pageData.reduce((s: number, r: any) => s + (r.enteredCr || 0), 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                      <Table.Summary.Cell index={0} colSpan={4}>
                        <Text strong style={{ fontSize: 11 }}>PTD Totals</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(dr)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(cr)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} colSpan={3} />
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Spin>
        </Modal>

        {/* Account Lookup Modal */}
        <Modal
          title="Select Account"
          open={accountLookupVisible}
          onCancel={() => setAccountLookupVisible(false)}
          footer={null}
          width={700}
          style={{ top: 50 }}
        >
          <div style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="Search by account number or description..."
              value={accountSearchText}
              onChange={(e) => setAccountSearchText(e.target.value)}
              allowClear
              size="middle"
            />
          </div>
          <Table
            dataSource={filteredAccounts}
            loading={accountsLoading}
            size="small"
            pagination={{ pageSize: 10, size: 'small', showTotal: (total) => `${total} accounts` }}
            rowKey="account"
            onRow={(record) => ({
              onClick: () => handleAccountSelect(record.account, record.description),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: 'Account',
                dataIndex: 'account',
                key: 'account',
                width: 120,
                render: (text: string) => <Text code style={{ fontSize: 12 }}>{text}</Text>,
              },
              {
                title: 'Description',
                dataIndex: 'description',
                key: 'description',
                render: (text: string) => <Text style={{ fontSize: 12 }}>{text}</Text>,
              },
              {
                title: 'Type',
                dataIndex: 'account_type',
                key: 'account_type',
                width: 80,
                render: (type: string) => {
                  const typeMap: Record<string, { label: string; color: string }> = {
                    'A': { label: 'Asset', color: 'blue' },
                    'L': { label: 'Liability', color: 'orange' },
                    'E': { label: 'Equity', color: 'purple' },
                    'R': { label: 'Revenue', color: 'green' },
                    'X': { label: 'Expense', color: 'red' },
                  };
                  const info = typeMap[type] || { label: type, color: 'default' };
                  return <Tag color={info.color} style={{ fontSize: 10 }}>{info.label}</Tag>;
                },
              },
            ]}
          />
        </Modal>
      </Content>

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
        .opening-balance-row td {
          background: #FFF8E1 !important;
          font-weight: 600 !important;
          border-top: 2px solid #D4A800 !important;
          border-bottom: 2px solid #D4A800 !important;
        }
        .closing-balance-row td {
          background: #F0FFF4 !important;
          font-weight: 600 !important;
          border-top: 2px solid #1D7B4D !important;
          border-bottom: 2px solid #1D7B4D !important;
        }
      `}</style>
    </Layout>
  );
};

export default AccountAnalysis;
