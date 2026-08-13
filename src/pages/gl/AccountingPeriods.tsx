import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  Progress,
  Statistic,
  Tabs,
  Select,
  DatePicker,
  Tooltip,
  Popover,
  Divider,
  Input,
  message,
  Modal,
} from 'antd';
import {
  HomeOutlined,
  CalendarOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  BookOutlined,
  EditOutlined,
  LockOutlined,
  UnlockOutlined,
  StopOutlined,
  ApiOutlined,
  ArrowLeftOutlined,
  CloseOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
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

// Types - support both uppercase (Oracle APEX) and lowercase field names
interface Application {
  application_id: number;
  application_name: string;
  application_short_name?: string;
}

interface Ledger {
  ledger_id: number;
  ledger_name: string;
  ledger_short_name?: string;
  ledger_category_code?: string; // PRIMARY, SECONDARY, ALC, etc.
  currency_code?: string;
}

// NEW: Current Period Status from APEX (currentperiodstatus endpoint)
interface CurrentPeriodStatusItem {
  ledger_name: string;
  app: string;
  application_name: string;
  prior_period: string | null;
  prior_status: string | null;
  current_period: string | null;
  current_status: string | null;
  next_period: string | null;
  next_status: string | null;
}

// NEW: Period Status Detail from APEX (periodsstatus/create endpoint)
interface PeriodStatusDetailItem {
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

// Normalize API response to handle both UPPERCASE and lowercase field names
const normalizeApplication = (item: Record<string, unknown>): Application => ({
  application_id: (item.application_id ?? item.APPLICATION_ID ?? 0) as number,
  application_name: (item.application_name ?? item.APPLICATION_NAME ?? '') as string,
  application_short_name: (item.application_short_name ?? item.APPLICATION_SHORT_NAME ?? '') as string,
});

const normalizeLedger = (item: Record<string, unknown>): Ledger => ({
  ledger_id: (item.ledger_id ?? item.LEDGER_ID ?? 0) as number,
  ledger_name: (item.ledger_name ?? item.LEDGER_NAME ?? '') as string,
  ledger_short_name: (item.ledger_short_name ?? item.LEDGER_SHORT_NAME ?? '') as string,
  ledger_category_code: (item.ledger_category_code ?? item.LEDGER_CATEGORY_CODE ?? '') as string,
  currency_code: (item.currency_code ?? item.CURRENCY_CODE ?? '') as string,
});

interface AccountingPeriod {
  PeriodNameId: string;
  PeriodSetNameId: string;
  PeriodType: string;
  AdjustmentPeriodFlag: boolean;
  StartDate: string;
  EndDate: string;
  EnteredPeriodName: string;
  PeriodYear: number;
  PeriodNumber: number;
}

interface PeriodStatus {
  PeriodNameId: string;
  PeriodName?: string;
  ApplicationId: number;
  LedgerId: number;
  LedgerName?: string;
  ClosingStatus: string; // O=Open, C=Closed, F=Future, N=Never Opened, P=Permanently Closed
  EndDate: string;
  StartDate: string;
  EffectivePeriodNumber: number;
  PeriodYear: number;
  PeriodNumber: number;
  AdjustmentPeriodFlag: boolean;
}

// Helper to extract period name from PeriodNameId (format: "PERIODSET_PeriodName_AppId_LedgerId")
const extractPeriodName = (periodNameId: string, periodName?: string): string => {
  if (periodName) return periodName;
  if (!periodNameId) return '-';
  const parts = periodNameId.split('_');
  // Format is typically: PERIODSET_Jan-26_101_300000000774004
  if (parts.length >= 2) {
    return parts[1];
  }
  return periodNameId;
};

interface LedgerPeriodSummary {
  LedgerId: number;
  LedgerName: string;
  currentPeriod: PeriodStatus | null;
  priorPeriod: PeriodStatus | null;
  nextPeriod: PeriodStatus | null;
  allPeriods: PeriodStatus[];
}

const FUSION_AUTH = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
const FUSION_HEADERS = { Authorization: FUSION_AUTH, Accept: 'application/json' };

const AccountingPeriods: React.FC = () => {
  const [activeTab, setActiveTab] = useState('status');

  // Applications and Ledgers mapping state
  const [applications, setApplications] = useState<Application[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);

  // NEW: Current Period Status from APEX (replaces Fusion periodStatuses)
  const [currentPeriodStatuses, setCurrentPeriodStatuses] = useState<CurrentPeriodStatusItem[]>([]);
  const [currentStatusLoading, setCurrentStatusLoading] = useState(false);
  const [currentStatusError, setCurrentStatusError] = useState<string>('');

  // NEW: Multiple open tabs for period status details
  const [openTabs, setOpenTabs] = useState<CurrentPeriodStatusItem[]>([]);
  const [tabDetailsMap, setTabDetailsMap] = useState<Record<string, PeriodStatusDetailItem[]>>({});
  const [tabLoadingMap, setTabLoadingMap] = useState<Record<string, boolean>>({});
  const [tabErrorMap, setTabErrorMap] = useState<Record<string, string>>({});
  const [periodActionLoading, setPeriodActionLoading] = useState<string | null>(null);

  // Period Status tab state (legacy - keep for now)
  const [periodStatuses, setPeriodStatuses] = useState<PeriodStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string>('');
  const [selectedApplication, setSelectedApplication] = useState<number | null>(null);
  const [effectiveDate, setEffectiveDate] = useState<dayjs.Dayjs>(dayjs());
  const [selectedLedger, setSelectedLedger] = useState<LedgerPeriodSummary | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodStatus | null>(null);
  const [showApiLog, setShowApiLog] = useState(false);

  // All Periods tab state
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; fetching: boolean }>({
    current: 0,
    total: 0,
    fetching: false,
  });
  const [allPeriodsSearch, setAllPeriodsSearch] = useState('');
  const [allPeriodsPage, setAllPeriodsPage] = useState(1);
  const [allPeriodsPageSize, setAllPeriodsPageSize] = useState(20);

  // Helper function to get application name by ID
  const getApplicationName = useCallback((appId: number): string => {
    const app = applications.find(a => a.application_id === appId);
    return app?.application_name || `Application ${appId}`;
  }, [applications]);

  // Helper function to get ledger name by ID
  const getLedgerName = useCallback((ledgerId: number): string => {
    const ledger = ledgers.find(l => l.ledger_id === ledgerId);
    return ledger?.ledger_name || `Ledger ${ledgerId}`;
  }, [ledgers]);

  // Helper function to check if ledger is a reporting ledger (to be filtered out)
  const isReportingLedger = useCallback((ledgerId: number): boolean => {
    const ledger = ledgers.find(l => l.ledger_id === ledgerId);
    // Filter out SECONDARY and ALC (Average Ledger Currency) ledgers - these are reporting ledgers
    return ledger?.ledger_category_code === 'SECONDARY' || ledger?.ledger_category_code === 'ALC';
  }, [ledgers]);

  // Fetch applications from APEX REST
  const fetchApplications = useCallback(async () => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/applications/getall`;
      console.log('=== FETCHING APPLICATIONS ===');
      console.log('URL:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const rawItems = result.items || result || [];
      console.log('Applications fetched (raw):', rawItems.length, rawItems[0]);

      // Normalize field names (handle both UPPERCASE and lowercase)
      const normalizedItems = rawItems.map((item: Record<string, unknown>) => normalizeApplication(item));
      console.log('Applications normalized:', normalizedItems.length, normalizedItems[0]);
      setApplications(normalizedItems);

      // Set default application - default to "All" (null means all)
      if (selectedApplication === null) {
        setSelectedApplication(null); // Start with "All" selected
      }
    } catch (err) {
      console.error('Error fetching applications:', err);
    }
  }, [selectedApplication]);

  // Fetch ledgers from APEX REST
  const fetchLedgers = useCallback(async () => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ledgers`;
      console.log('=== FETCHING LEDGERS ===');
      console.log('URL:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const rawItems = result.items || result || [];
      console.log('Ledgers fetched (raw):', rawItems.length, rawItems[0]);

      // Normalize field names (handle both UPPERCASE and lowercase)
      const normalizedItems = rawItems.map((item: Record<string, unknown>) => normalizeLedger(item));
      console.log('Ledgers normalized:', normalizedItems.length, normalizedItems[0]);
      setLedgers(normalizedItems);
    } catch (err) {
      console.error('Error fetching ledgers:', err);
    }
  }, []);

  // Fetch applications and ledgers on mount
  useEffect(() => {
    const fetchMappingData = async () => {
      setMappingLoading(true);
      await Promise.all([fetchApplications(), fetchLedgers()]);
      setMappingLoading(false);
    };
    fetchMappingData();
  }, [fetchApplications, fetchLedgers]);

  // NEW: Fetch current period statuses from APEX REST (currentperiodstatus endpoint)
  const fetchCurrentPeriodStatuses = useCallback(async () => {
    setCurrentStatusLoading(true);
    setCurrentStatusError('');
    setCurrentPeriodStatuses([]);

    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/currentperiodstatus`;
      console.log('=== FETCHING CURRENT PERIOD STATUSES ===');
      console.log('URL:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const items = result.items || [];
      console.log('Current period statuses fetched:', items.length);

      setCurrentPeriodStatuses(items);
    } catch (err) {
      console.error('Error fetching current period statuses:', err);
      setCurrentStatusError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCurrentStatusLoading(false);
    }
  }, []);

  // Helper to generate unique tab key
  const getTabKey = (item: CurrentPeriodStatusItem) => `${item.ledger_name}-${item.app}`;

  // NEW: Fetch period status details for a specific application and ledger (stores in map)
  const fetchPeriodStatusDetails = useCallback(async (item: CurrentPeriodStatusItem) => {
    const tabKey = getTabKey(item);

    // Set loading state for this tab
    setTabLoadingMap(prev => ({ ...prev, [tabKey]: true }));
    setTabErrorMap(prev => ({ ...prev, [tabKey]: '' }));

    try {
      const params = new URLSearchParams({
        P_APPLICATION_NAME: item.application_name,
        P_LEDGER_NAME: item.ledger_name,
      });
      const url = `${APEX_DB_CONFIG.baseUrl}/periodsstatus/create?${params.toString()}`;
      console.log('=== FETCHING PERIOD STATUS DETAILS ===');
      console.log('URL:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const items = result.items || [];
      console.log('Period status details fetched:', items.length);

      // Store in map
      setTabDetailsMap(prev => ({ ...prev, [tabKey]: items }));
    } catch (err) {
      console.error('Error fetching period status details:', err);
      setTabErrorMap(prev => ({ ...prev, [tabKey]: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setTabLoadingMap(prev => ({ ...prev, [tabKey]: false }));
    }
  }, []);

  // Fetch current period statuses on mount
  useEffect(() => {
    fetchCurrentPeriodStatuses();
  }, [fetchCurrentPeriodStatuses]);

  // Fetch period statuses with pagination (legacy - keep for All Periods tab)
  const fetchPeriodStatuses = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    setPeriodStatuses([]);

    const allStatuses: PeriodStatus[] = [];
    let offset = 0;
    const limit = 500;
    let hasMore = true;
    let pageCount = 0;

    try {
      while (hasMore) {
        const fusionPath = `fscmRestApi/resources/11.13.18.05/accountingPeriodStatusLOV?limit=${limit}&offset=${offset}`;
        const url = `https://iaaobn.fa.ocs.oraclecloud.com/${fusionPath}`;

        console.log(`=== FETCHING PERIOD STATUS PAGE ${pageCount + 1} ===`);
        console.log('URL:', url);

        const response = await fetch(url, { headers: FUSION_HEADERS });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const items = result.items || [];

        console.log('Items fetched:', items.length);
        allStatuses.push(...items);
        pageCount++;

        hasMore = result.hasMore === true && items.length > 0;
        offset += limit;

        if (pageCount > 50) {
          console.warn('Safety limit reached: 50 pages');
          break;
        }
      }

      console.log('=== FETCH COMPLETE ===');
      console.log('Total statuses fetched:', allStatuses.length);

      setPeriodStatuses(allStatuses);
    } catch (err) {
      console.error('Error fetching period statuses:', err);
      setStatusError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Fetch all accounting periods with pagination
  const fetchAllPeriods = useCallback(async () => {
    setLoading(true);
    setError('');
    setPeriods([]);
    setFetchProgress({ current: 0, total: 0, fetching: true });

    const allPeriods: AccountingPeriod[] = [];
    let offset = 0;
    const limit = 500;
    let hasMore = true;
    let pageCount = 0;

    try {
      while (hasMore) {
        const fusionPath = `fscmRestApi/resources/11.13.18.05/accountingPeriodsLOV?limit=${limit}&offset=${offset}`;
        const url = `https://iaaobn.fa.ocs.oraclecloud.com/${fusionPath}`;

        const response = await fetch(url, { headers: FUSION_HEADERS });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const items = result.items || [];

        allPeriods.push(...items);
        pageCount++;

        setFetchProgress({
          current: allPeriods.length,
          total: result.totalResults || allPeriods.length,
          fetching: true,
        });

        hasMore = result.hasMore === true && items.length > 0;
        offset += limit;

        if (pageCount > 50) break;
      }

      setPeriods(allPeriods);
      setFetchProgress({ current: allPeriods.length, total: allPeriods.length, fetching: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setFetchProgress({ current: 0, total: 0, fetching: false });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchPeriodStatuses();
    fetchAllPeriods();
  }, [fetchPeriodStatuses, fetchAllPeriods]);

  // Get unique applications from period status data (for dropdown options based on data availability)
  const availableApplicationIds = [...new Set(periodStatuses.map(p => p.ApplicationId))].sort();

  // Filter and group period statuses by ledger
  const getLedgerSummaries = useCallback((): LedgerPeriodSummary[] => {
    // Wait for ledgers to be loaded before calculating summaries
    if (ledgers.length === 0) {
      console.log('getLedgerSummaries: Waiting for ledgers to load...');
      return [];
    }

    console.log('getLedgerSummaries: Ledgers loaded:', ledgers.length, 'Period statuses:', periodStatuses.length);

    // If "All" is selected (null), show all applications; otherwise filter by selected application
    const filtered = selectedApplication === null
      ? periodStatuses
      : periodStatuses.filter(p => p.ApplicationId === selectedApplication);
    const effectiveDateStr = effectiveDate.format('YYYY-MM-DD');

    // Group by LedgerId
    const ledgerMap = new Map<number, PeriodStatus[]>();
    filtered.forEach(p => {
      // Filter out reporting ledgers - only if ledger exists in our ledger list
      const ledger = ledgers.find(l => l.ledger_id === p.LedgerId);
      if (ledger && (ledger.ledger_category_code === 'SECONDARY' || ledger.ledger_category_code === 'ALC')) {
        return; // Skip reporting ledgers
      }
      const existing = ledgerMap.get(p.LedgerId) || [];
      existing.push(p);
      ledgerMap.set(p.LedgerId, existing);
    });

    const summaries: LedgerPeriodSummary[] = [];

    ledgerMap.forEach((periods, ledgerId) => {
      // Sort by EffectivePeriodNumber
      const sorted = [...periods].sort((a, b) => a.EffectivePeriodNumber - b.EffectivePeriodNumber);

      // Find current period (period that contains the effective date)
      let currentIdx = sorted.findIndex(p => {
        const start = p.StartDate;
        const end = p.EndDate;
        return effectiveDateStr >= start && effectiveDateStr <= end;
      });

      // If no exact match, find the most recent open period
      if (currentIdx === -1) {
        currentIdx = sorted.findIndex(p => p.ClosingStatus === 'O');
      }

      // If still no match, use the first period
      if (currentIdx === -1) currentIdx = 0;

      const currentPeriod = sorted[currentIdx] || null;
      const priorPeriod = currentIdx > 0 ? sorted[currentIdx - 1] : null;
      const nextPeriod = currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;

      // Get ledger name from ledgers lookup
      const ledgerName = getLedgerName(ledgerId);

      summaries.push({
        LedgerId: ledgerId,
        LedgerName: ledgerName,
        currentPeriod,
        priorPeriod,
        nextPeriod,
        allPeriods: sorted,
      });
    });

    return summaries;
  }, [periodStatuses, selectedApplication, effectiveDate, ledgers, getLedgerName]);

  const ledgerSummaries = getLedgerSummaries();

  // Get status icon and color
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'O': // Open
        return <Tooltip title="Open"><BookOutlined style={{ color: REDWOOD.info, fontSize: 16 }} /></Tooltip>;
      case 'C': // Closed
        return <Tooltip title="Closed"><CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16 }} /></Tooltip>;
      case 'F': // Future Enterable
        return <Tooltip title="Future Enterable"><EditOutlined style={{ color: REDWOOD.warning, fontSize: 16 }} /></Tooltip>;
      case 'N': // Never Opened
        return <Tooltip title="Never Opened"><StopOutlined style={{ color: REDWOOD.info, fontSize: 16 }} /></Tooltip>;
      case 'P': // Permanently Closed
        return <Tooltip title="Permanently Closed"><LockOutlined style={{ color: REDWOOD.textSecondary, fontSize: 16 }} /></Tooltip>;
      default:
        return <Tooltip title={status}><ClockCircleOutlined style={{ color: REDWOOD.textSecondary, fontSize: 16 }} /></Tooltip>;
    }
  };

  // Handle ledger click to show detail in tab (legacy)
  const handleLedgerClick = (ledger: LedgerPeriodSummary) => {
    setSelectedLedger(ledger);
    setSelectedPeriod(null);
    setActiveTab('details'); // Switch to details tab
  };

  // NEW: Handle status item click to open a new tab for drill-down
  const handleStatusItemClick = (item: CurrentPeriodStatusItem) => {
    const tabKey = getTabKey(item);

    // Check if tab already exists
    const existingTab = openTabs.find(t => getTabKey(t) === tabKey);
    if (existingTab) {
      // Just switch to existing tab
      setActiveTab(tabKey);
      return;
    }

    // Add new tab
    setOpenTabs(prev => [...prev, item]);
    setActiveTab(tabKey);

    // Fetch period details for the new tab
    fetchPeriodStatusDetails(item);
  };

  // Close a specific tab
  const handleCloseTab = (tabKey: string) => {
    setOpenTabs(prev => prev.filter(t => getTabKey(t) !== tabKey));
    // Clean up data for closed tab
    setTabDetailsMap(prev => {
      const newMap = { ...prev };
      delete newMap[tabKey];
      return newMap;
    });
    setTabLoadingMap(prev => {
      const newMap = { ...prev };
      delete newMap[tabKey];
      return newMap;
    });
    setTabErrorMap(prev => {
      const newMap = { ...prev };
      delete newMap[tabKey];
      return newMap;
    });
    // Switch to status tab if closing active tab
    if (activeTab === tabKey) {
      setActiveTab('status');
    }
  };

  // Open or Close a period
  const handlePeriodAction = async (
    item: CurrentPeriodStatusItem,
    period: PeriodStatusDetailItem,
    action: 'OPEN' | 'CLOSE',
  ) => {
    const doAction = async () => {
      const key = `${period.period_name_id}-${action}`;
      setPeriodActionLoading(key);
      try {
        const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/periodstatus`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            periodName: period.period_name_id,
            app: item.app,
            action,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
        message.success(`${period.period_name_id} ${action === 'OPEN' ? 'opened' : 'closed'} successfully`);
        fetchPeriodStatusDetails(item);
        fetchCurrentPeriodStatuses();
      } catch (e: any) {
        message.error(e?.message ?? 'Action failed');
      } finally {
        setPeriodActionLoading(null);
      }
    };

    if (action === 'CLOSE') {
      Modal.confirm({
        title: `Close Period ${period.period_name_id}?`,
        content: `Closing this period will prevent new transactions from being posted to ${item.application_name} for ${period.period_name_id}. This can be re-opened later.`,
        okText: 'Close Period',
        okButtonProps: { danger: true },
        onOk: doAction,
      });
    } else {
      doAction();
    }
  };

  // Webservices used on this page
  const webservices = [
    { method: 'GET', url: `${APEX_DB_CONFIG.baseUrl}/applications/getall`, description: 'Fetch applications list' },
    { method: 'GET', url: `${APEX_DB_CONFIG.baseUrl}/ledgers`, description: 'Fetch ledgers list' },
    { method: 'GET', url: `${APEX_DB_CONFIG.baseUrl}/currentperiodstatus`, description: 'Fetch current period status (prior/current/next) per ledger & application' },
    { method: 'GET', url: `${APEX_DB_CONFIG.baseUrl}/periodsstatus/create?P_APPLICATION_NAME=General+Ledger&P_LEDGER_NAME={ledger}`, description: 'Fetch all period statuses for selected ledger/application' },
    { method: 'PUT', url: `${APEX_DB_CONFIG.baseUrl}/gl/periodstatus`, description: 'Open or close a period (body: periodName, app, action)' },
  ];

  // API Log Popover Content
  const apiLogContent = (
    <div style={{ width: 500 }}>
      <Text strong style={{ fontSize: 12 }}>Webservices Used:</Text>
      <Divider style={{ margin: '8px 0' }} />
      {webservices.map((ws, idx) => (
        <div key={idx} style={{ marginBottom: 8, padding: '4px 8px', background: '#f5f5f5', borderRadius: 4 }}>
          <Tag color={ws.method === 'GET' ? 'blue' : 'green'} style={{ fontSize: 10 }}>{ws.method}</Tag>
          <Text code style={{ fontSize: 10 }}>{ws.url}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 10 }}>{ws.description}</Text>
        </div>
      ))}
    </div>
  );

  // Check if actions should be enabled
  const canOpenPeriod = selectedPeriod && (selectedPeriod.ClosingStatus === 'C' || selectedPeriod.ClosingStatus === 'F' || selectedPeriod.ClosingStatus === 'N');
  const canClosePeriod = selectedPeriod && selectedPeriod.ClosingStatus === 'O';

  // NEW: Period Status columns for APEX currentperiodstatus data
  const currentStatusColumns = [
    {
      title: 'Ledger',
      dataIndex: 'ledger_name',
      key: 'ledger_name',
      width: 200,
      render: (name: string, record: CurrentPeriodStatusItem) => (
        <Text
          strong
          style={{ fontSize: 12, color: REDWOOD.info, cursor: 'pointer' }}
          onClick={() => handleStatusItemClick(record)}
        >
          {name}
        </Text>
      ),
    },
    {
      title: 'Application',
      dataIndex: 'application_name',
      key: 'application_name',
      width: 120,
      render: (name: string, record: CurrentPeriodStatusItem) => (
        <Tag color="blue" style={{ fontSize: 10 }}>{record.app}</Tag>
      ),
    },
    {
      title: 'Prior Period',
      children: [
        {
          title: 'Name',
          key: 'priorName',
          width: 100,
          render: (_: unknown, record: CurrentPeriodStatusItem) => (
            <Text style={{ fontSize: 11 }}>{record.prior_period || '-'}</Text>
          ),
        },
        {
          title: 'Status',
          key: 'priorStatus',
          width: 60,
          align: 'center' as const,
          render: (_: unknown, record: CurrentPeriodStatusItem) => (
            record.prior_status ? getStatusIcon(record.prior_status) : '-'
          ),
        },
      ],
    },
    {
      title: 'Current Period',
      children: [
        {
          title: 'Name',
          key: 'currentName',
          width: 100,
          render: (_: unknown, record: CurrentPeriodStatusItem) => (
            <Text style={{ fontSize: 11, fontWeight: 600 }}>{record.current_period || '-'}</Text>
          ),
        },
        {
          title: 'Status',
          key: 'currentStatus',
          width: 60,
          align: 'center' as const,
          render: (_: unknown, record: CurrentPeriodStatusItem) => (
            record.current_status ? getStatusIcon(record.current_status) : '-'
          ),
        },
      ],
    },
    {
      title: 'Next Period',
      children: [
        {
          title: 'Name',
          key: 'nextName',
          width: 100,
          render: (_: unknown, record: CurrentPeriodStatusItem) => (
            <Text style={{ fontSize: 11 }}>{record.next_period || '-'}</Text>
          ),
        },
        {
          title: 'Status',
          key: 'nextStatus',
          width: 60,
          align: 'center' as const,
          render: (_: unknown, record: CurrentPeriodStatusItem) => (
            record.next_status ? getStatusIcon(record.next_status) : '-'
          ),
        },
      ],
    },
  ];

  // Legacy: Period Status columns (keep for reference)
  const statusColumns = [
    {
      title: 'Ledger',
      dataIndex: 'LedgerName',
      key: 'LedgerName',
      width: 250,
      render: (name: string, record: LedgerPeriodSummary) => (
        <Text
          strong
          style={{ fontSize: 12, color: REDWOOD.info, cursor: 'pointer' }}
          onClick={() => handleLedgerClick(record)}
        >
          {name || `Ledger ${record.LedgerId}`}
        </Text>
      ),
    },
    {
      title: 'Current Period',
      children: [
        {
          title: 'Name',
          key: 'currentName',
          width: 120,
          render: (_: unknown, record: LedgerPeriodSummary) => (
            <Text style={{ fontSize: 11 }}>
              {record.currentPeriod ? extractPeriodName(record.currentPeriod.PeriodNameId, record.currentPeriod.PeriodName) : '-'}
            </Text>
          ),
        },
        {
          title: 'Status',
          key: 'currentStatus',
          width: 60,
          align: 'center' as const,
          render: (_: unknown, record: LedgerPeriodSummary) => (
            record.currentPeriod ? getStatusIcon(record.currentPeriod.ClosingStatus) : '-'
          ),
        },
      ],
    },
    {
      title: 'Prior Period',
      children: [
        {
          title: 'Name',
          key: 'priorName',
          width: 120,
          render: (_: unknown, record: LedgerPeriodSummary) => (
            <Text style={{ fontSize: 11 }}>
              {record.priorPeriod ? extractPeriodName(record.priorPeriod.PeriodNameId, record.priorPeriod.PeriodName) : '-'}
            </Text>
          ),
        },
        {
          title: 'Status',
          key: 'priorStatus',
          width: 60,
          align: 'center' as const,
          render: (_: unknown, record: LedgerPeriodSummary) => (
            record.priorPeriod ? getStatusIcon(record.priorPeriod.ClosingStatus) : '-'
          ),
        },
      ],
    },
    {
      title: 'Next Period',
      children: [
        {
          title: 'Name',
          key: 'nextName',
          width: 120,
          render: (_: unknown, record: LedgerPeriodSummary) => (
            <Text style={{ fontSize: 11 }}>
              {record.nextPeriod ? extractPeriodName(record.nextPeriod.PeriodNameId, record.nextPeriod.PeriodName) : '-'}
            </Text>
          ),
        },
        {
          title: 'Status',
          key: 'nextStatus',
          width: 60,
          align: 'center' as const,
          render: (_: unknown, record: LedgerPeriodSummary) => (
            record.nextPeriod ? getStatusIcon(record.nextPeriod.ClosingStatus) : '-'
          ),
        },
      ],
    },
  ];

  // Detail modal period columns
  const detailColumns = [
    {
      title: 'Accounting Period',
      dataIndex: 'PeriodNameId',
      key: 'PeriodNameId',
      width: 180,
      render: (periodNameId: string, record: PeriodStatus) => (
        <Text style={{ fontSize: 11 }}>{extractPeriodName(periodNameId, record.PeriodName)}</Text>
      ),
    },
    {
      title: 'Period Number',
      dataIndex: 'PeriodNumber',
      key: 'PeriodNumber',
      width: 100,
      render: (num: number) => <Text style={{ fontSize: 11 }}>{num}</Text>,
    },
    {
      title: 'Year',
      dataIndex: 'PeriodYear',
      key: 'PeriodYear',
      width: 80,
      render: (year: number) => <Text code style={{ fontSize: 11 }}>{year}</Text>,
    },
    {
      title: 'Start Date',
      dataIndex: 'StartDate',
      key: 'StartDate',
      width: 120,
      render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? dayjs(date).format('D-MMM-YYYY') : '-'}</Text>,
    },
    {
      title: 'End Date',
      dataIndex: 'EndDate',
      key: 'EndDate',
      width: 120,
      render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? dayjs(date).format('D-MMM-YYYY') : '-'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'ClosingStatus',
      key: 'ClosingStatus',
      width: 80,
      align: 'center' as const,
      render: (status: string) => getStatusIcon(status),
    },
  ];

  // All Periods table columns
  const allPeriodsColumns = [
    {
      title: 'Period Name',
      dataIndex: 'EnteredPeriodName',
      key: 'EnteredPeriodName',
      width: 150,
      sorter: (a: AccountingPeriod, b: AccountingPeriod) => a.EnteredPeriodName.localeCompare(b.EnteredPeriodName),
      render: (name: string, record: AccountingPeriod) => (
        <Space size={4}>
          <Text strong style={{ fontSize: 12 }}>{name}</Text>
          {record.AdjustmentPeriodFlag && (
            <Tag color="orange" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>ADJ</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Period Set',
      dataIndex: 'PeriodSetNameId',
      key: 'PeriodSetNameId',
      width: 180,
      ellipsis: true,
      filters: [...new Set(periods.map(p => p.PeriodSetNameId))].map(s => ({ text: s, value: s })),
      onFilter: (value: React.Key | boolean, record: AccountingPeriod) => record.PeriodSetNameId === value,
      render: (name: string) => <Text style={{ fontSize: 11 }}>{name}</Text>,
    },
    {
      title: 'Year',
      dataIndex: 'PeriodYear',
      key: 'PeriodYear',
      width: 80,
      sorter: (a: AccountingPeriod, b: AccountingPeriod) => a.PeriodYear - b.PeriodYear,
      render: (year: number) => <Text code style={{ fontSize: 11 }}>{year}</Text>,
    },
    {
      title: 'Period #',
      dataIndex: 'PeriodNumber',
      key: 'PeriodNumber',
      width: 80,
      sorter: (a: AccountingPeriod, b: AccountingPeriod) => a.PeriodNumber - b.PeriodNumber,
      render: (num: number) => <Text style={{ fontSize: 11 }}>{num}</Text>,
    },
    {
      title: 'Start Date',
      dataIndex: 'StartDate',
      key: 'StartDate',
      width: 120,
      sorter: (a: AccountingPeriod, b: AccountingPeriod) => new Date(a.StartDate).getTime() - new Date(b.StartDate).getTime(),
      render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? dayjs(date).format('D-MMM-YYYY') : '-'}</Text>,
    },
    {
      title: 'End Date',
      dataIndex: 'EndDate',
      key: 'EndDate',
      width: 120,
      sorter: (a: AccountingPeriod, b: AccountingPeriod) => new Date(a.EndDate).getTime() - new Date(b.EndDate).getTime(),
      render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? dayjs(date).format('D-MMM-YYYY') : '-'}</Text>,
    },
    {
      title: 'Period Type',
      dataIndex: 'PeriodType',
      key: 'PeriodType',
      width: 150,
      ellipsis: true,
      render: (type: string) => <Text style={{ fontSize: 10 }}>{type}</Text>,
    },
    {
      title: 'Adjustment',
      dataIndex: 'AdjustmentPeriodFlag',
      key: 'AdjustmentPeriodFlag',
      width: 90,
      filters: [
        { text: 'Yes', value: true },
        { text: 'No', value: false },
      ],
      onFilter: (value: React.Key | boolean, record: AccountingPeriod) => record.AdjustmentPeriodFlag === value,
      render: (flag: boolean) => (
        flag ? <Tag color="orange" style={{ fontSize: 10 }}>Yes</Tag> : <Tag color="default" style={{ fontSize: 10 }}>No</Tag>
      ),
    },
  ];

  // Get unique period years for filtering
  const periodYears = [...new Set(periods.map(p => p.PeriodYear))].sort((a, b) => b - a);
  const adjustmentPeriods = periods.filter(p => p.AdjustmentPeriodFlag).length;
  const regularPeriods = periods.length - adjustmentPeriods;
  const uniquePeriodSets = [...new Set(periods.map(p => p.PeriodSetNameId))].length;

  // Period Status Tab Content - NEW: Using APEX currentperiodstatus endpoint
  const PeriodStatusTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls */}
      <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchCurrentPeriodStatuses}
            loading={currentStatusLoading}
            size="small"
          >
            Refresh
          </Button>
        </Col>
        <Col>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Click on a ledger to view all period details
          </Text>
        </Col>
      </Row>

      {/* Status Error */}
      {currentStatusError && (
        <Alert
          message="Error Loading Period Status"
          description={currentStatusError}
          type="error"
          showIcon
          closable
          onClose={() => setCurrentStatusError('')}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Current Period Status Table - NEW APEX data */}
      <Card
        style={{ flex: 1, borderRadius: 6, border: `1px solid ${REDWOOD.border}` }}
        bodyStyle={{ padding: 0 }}
      >
        <Spin spinning={currentStatusLoading}>
          <Table
            dataSource={currentPeriodStatuses}
            columns={currentStatusColumns}
            rowKey={(record) => `${record.ledger_name}-${record.app}`}
            size="small"
            pagination={false}
            scroll={{ y: 'calc(100vh - 340px)' }}
            bordered
          />
        </Spin>
      </Card>

      {/* Legend */}
      <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 11 }}>Rows: {currentPeriodStatuses.length}</Text>
        <Space size={16}>
          <Space size={4}><BookOutlined style={{ color: REDWOOD.info }} /><Text style={{ fontSize: 10 }}>Open</Text></Space>
          <Space size={4}><CheckCircleOutlined style={{ color: REDWOOD.success }} /><Text style={{ fontSize: 10 }}>Closed</Text></Space>
          <Space size={4}><LockOutlined style={{ color: REDWOOD.textSecondary }} /><Text style={{ fontSize: 10 }}>Permanently Closed</Text></Space>
          <Space size={4}><EditOutlined style={{ color: REDWOOD.warning }} /><Text style={{ fontSize: 10 }}>Future Enterable</Text></Space>
          <Space size={4}><StopOutlined style={{ color: REDWOOD.info }} /><Text style={{ fontSize: 10 }}>Never Opened</Text></Space>
        </Space>
      </div>
    </div>
  );

  // Detail columns — parameterised by tab item so Actions can call handlePeriodAction
  const getPeriodDetailColumns = (item: CurrentPeriodStatusItem) => [
    {
      title: 'Period',
      dataIndex: 'period_name_id',
      key: 'period_name_id',
      width: 120,
      render: (name: string) => <Text style={{ fontSize: 11 }}>{name}</Text>,
    },
    {
      title: 'Year',
      dataIndex: 'period_year',
      key: 'period_year',
      width: 70,
      render: (year: number) => <Text code style={{ fontSize: 11 }}>{year}</Text>,
    },
    {
      title: 'Period #',
      dataIndex: 'period_number',
      key: 'period_number',
      width: 70,
      render: (num: number) => <Text style={{ fontSize: 11 }}>{num}</Text>,
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      key: 'start_date',
      width: 110,
      render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? dayjs(date).format('D-MMM-YYYY') : '-'}</Text>,
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      key: 'end_date',
      width: 110,
      render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? dayjs(date).format('D-MMM-YYYY') : '-'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: string) => {
        const statusCode = status === 'Open' ? 'O' : status === 'Closed' ? 'C' : status === 'Future' ? 'F' : status === 'Never Opened' ? 'N' : status === 'Permanently Closed' ? 'P' : status;
        return (
          <Space>
            {getStatusIcon(statusCode)}
            <Text style={{ fontSize: 10 }}>{status}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Adj',
      dataIndex: 'adj_flag',
      key: 'adj_flag',
      width: 50,
      align: 'center' as const,
      render: (flag: string) => (
        flag === 'Y' ? <Tag color="orange" style={{ fontSize: 9 }}>Y</Tag> : <Text style={{ fontSize: 10 }}>N</Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      align: 'center' as const,
      render: (_: unknown, period: PeriodStatusDetailItem) => {
        const actionKey = `${period.period_name_id}-action`;
        const isLoading = periodActionLoading === actionKey;
        const canOpen  = ['Closed', 'Future', 'Never Opened'].includes(period.status);
        const canClose = period.status === 'Open';

        return (
          <Space size={4}>
            {canOpen && (
              <Button
                size="small"
                icon={<UnlockOutlined />}
                loading={isLoading}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success, color: '#fff', fontSize: 11 }}
                onClick={() => handlePeriodAction(item, period, 'OPEN')}
              >
                Open Period
              </Button>
            )}
            {canClose && (
              <Button
                size="small"
                danger
                icon={<LockOutlined />}
                loading={isLoading}
                style={{ fontSize: 11 }}
                onClick={() => handlePeriodAction(item, period, 'CLOSE')}
              >
                Close Period
              </Button>
            )}
            {!canOpen && !canClose && (
              <Text style={{ fontSize: 10, color: REDWOOD.textSecondary }}>—</Text>
            )}
          </Space>
        );
      },
    },
  ];

  // Tab Content for period status details - reusable for each open tab
  const renderPeriodStatusTabContent = (item: CurrentPeriodStatusItem) => {
    const tabKey = getTabKey(item);
    const details = tabDetailsMap[tabKey] || [];
    const isLoading = tabLoadingMap[tabKey] || false;
    const error = tabErrorMap[tabKey] || '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Ledger Info Card */}
        <Card size="small" style={{ marginBottom: 12, borderRadius: 6 }}>
          <Row gutter={24}>
            <Col span={8}>
              <Text style={{ fontSize: 12 }}>
                <Text strong>Ledger: </Text>
                {item.ledger_name}
              </Text>
            </Col>
            <Col span={8}>
              <Text style={{ fontSize: 12 }}>
                <Text strong>Application: </Text>
                <Tag color="blue">{item.app}</Tag> {item.application_name}
              </Text>
            </Col>
            <Col span={8}>
              <Text style={{ fontSize: 12 }}>
                <Text strong>Current Period: </Text>
                {item.current_period || '-'}
              </Text>
            </Col>
          </Row>
        </Card>

        {/* Error */}
        {error && (
          <Alert
            message="Error Loading Period Details"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setTabErrorMap(prev => ({ ...prev, [tabKey]: '' }))}
            style={{ marginBottom: 12 }}
          />
        )}

        {/* Periods Table - APEX data */}
        <Card
          style={{ flex: 1, borderRadius: 6, border: `1px solid ${REDWOOD.border}` }}
          bodyStyle={{ padding: 0 }}
        >
          <Spin spinning={isLoading}>
            <Table
              dataSource={details}
              columns={getPeriodDetailColumns(item)}
              rowKey="period_name_id"
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true, size: 'small' }}
              scroll={{ x: 900, y: 'calc(100vh - 380px)' }}
            />
          </Spin>
        </Card>

        {/* Legend */}
        <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'center' }}>
          <Text style={{ fontSize: 11 }}>Rows: {details.length}</Text>
          <Space size={16}>
            <Space size={4}><BookOutlined style={{ color: REDWOOD.info }} /><Text style={{ fontSize: 10 }}>Open</Text></Space>
            <Space size={4}><CheckCircleOutlined style={{ color: REDWOOD.success }} /><Text style={{ fontSize: 10 }}>Closed</Text></Space>
            <Space size={4}><LockOutlined style={{ color: REDWOOD.textSecondary }} /><Text style={{ fontSize: 10 }}>Permanently Closed</Text></Space>
            <Space size={4}><EditOutlined style={{ color: REDWOOD.warning }} /><Text style={{ fontSize: 10 }}>Future Enterable</Text></Space>
            <Space size={4}><StopOutlined style={{ color: REDWOOD.info }} /><Text style={{ fontSize: 10 }}>Never Opened</Text></Space>
          </Space>
        </div>
      </div>
    );
  };

  // Memoised filtered list — avoids re-filtering on every unrelated render
  const filteredPeriods = useMemo(() => {
    if (!allPeriodsSearch) return periods;
    const q = allPeriodsSearch.toLowerCase();
    return periods.filter(p =>
      (p.EnteredPeriodName || '').toLowerCase().includes(q) ||
      (p.PeriodSetNameId || '').toLowerCase().includes(q) ||
      String(p.PeriodYear || '').includes(q) ||
      (p.PeriodType || '').toLowerCase().includes(q)
    );
  }, [periods, allPeriodsSearch]);

  // All Periods Tab Content — rendered as JSX (NOT a sub-component) to prevent
  // React treating it as a new component type on each render, which would remount
  // the Table and make the search input feel laggy.
  const allPeriodsTabContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Statistics Cards */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
            <Statistic
              title={<Text style={{ fontSize: 11 }}>Total Periods</Text>}
              value={periods.length}
              prefix={<CalendarOutlined style={{ color: REDWOOD.info }} />}
              valueStyle={{ fontSize: 20, color: REDWOOD.info }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
            <Statistic
              title={<Text style={{ fontSize: 11 }}>Regular Periods</Text>}
              value={regularPeriods}
              prefix={<CheckCircleOutlined style={{ color: REDWOOD.success }} />}
              valueStyle={{ fontSize: 20, color: REDWOOD.success }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
            <Statistic
              title={<Text style={{ fontSize: 11 }}>Adjustment Periods</Text>}
              value={adjustmentPeriods}
              prefix={<ExclamationCircleOutlined style={{ color: REDWOOD.warning }} />}
              valueStyle={{ fontSize: 20, color: REDWOOD.warning }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
            <Statistic
              title={<Text style={{ fontSize: 11 }}>Period Sets</Text>}
              value={uniquePeriodSets}
              prefix={<ClockCircleOutlined style={{ color: REDWOOD.primary }} />}
              valueStyle={{ fontSize: 20, color: REDWOOD.primary }}
            />
          </Card>
        </Col>
      </Row>

      {/* Fetch Progress */}
      {fetchProgress.fetching && (
        <Card size="small" style={{ marginBottom: 12, borderRadius: 6 }} bodyStyle={{ padding: '8px 16px' }}>
          <Space>
            <Spin size="small" />
            <Text style={{ fontSize: 12 }}>Fetching periods... {fetchProgress.current} records loaded</Text>
            {fetchProgress.total > 0 && (
              <Progress percent={Math.round((fetchProgress.current / fetchProgress.total) * 100)} size="small" style={{ width: 150 }} />
            )}
          </Space>
        </Card>
      )}

      {/* Error Alert */}
      {error && (
        <Alert
          message="Error Loading Periods"
          description={error}
          type="error"
          showIcon
          closable
          onClose={() => setError('')}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Search + Periods Table */}
      <Card
        style={{ flex: 1, borderRadius: 6, border: `1px solid ${REDWOOD.border}` }}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${REDWOOD.border}` }}>
          <Input
            placeholder="Search period name, set name, year..."
            prefix={<SearchOutlined style={{ color: REDWOOD.textSecondary }} />}
            value={allPeriodsSearch}
            onChange={e => { setAllPeriodsSearch(e.target.value); setAllPeriodsPage(1); }}
            allowClear
            style={{ maxWidth: 360 }}
            size="small"
          />
        </div>
        <Spin spinning={loading && periods.length === 0}>
          <Table
            dataSource={filteredPeriods}
            columns={allPeriodsColumns}
            rowKey="PeriodNameId"
            size="small"
            pagination={{
              current: allPeriodsPage,
              pageSize: allPeriodsPageSize,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100', '200'],
              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} periods`,
              size: 'small',
              onChange: (page, size) => { setAllPeriodsPage(page); setAllPeriodsPageSize(size); },
            }}
            scroll={{ y: 'calc(100vh - 520px)' }}
          />
        </Spin>
      </Card>
    </div>
  );

  return (
    <Layout style={{ height: 'calc(100vh - 64px)', background: REDWOOD.surfaceSecondary, overflow: 'hidden' }}>
      <Content style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          padding: '8px 16px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.border}`,
          flexShrink: 0,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/gl">General Ledger</Link> },
              { title: 'Accounting Periods' },
            ]}
          />
        </div>

        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Title */}
          <Row justify="space-between" align="middle" style={{ marginBottom: 12, flexShrink: 0 }}>
            <Col>
              <Space align="center">
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: REDWOOD.success,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <CalendarOutlined style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div>
                  <Title level={4} style={{ margin: 0, color: REDWOOD.textPrimary }}>
                    Manage Accounting Periods
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>View and manage accounting period statuses</Text>
                </div>
              </Space>
            </Col>
            <Col>
              <Popover
                content={apiLogContent}
                title="API Services"
                trigger="click"
                open={showApiLog}
                onOpenChange={setShowApiLog}
              >
                <Button
                  icon={<ApiOutlined />}
                  size="small"
                  type={showApiLog ? 'primary' : 'default'}
                >
                  API Log
                </Button>
              </Popover>
            </Col>
          </Row>

          {/* Tabs */}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type="editable-card"
            hideAdd
            onEdit={(targetKey, action) => {
              if (action === 'remove' && typeof targetKey === 'string') {
                handleCloseTab(targetKey);
              }
            }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            items={[
              {
                key: 'status',
                label: 'Period Status',
                children: <PeriodStatusTab />,
                closable: false,
              },
              {
                key: 'all',
                label: 'All Periods',
                children: allPeriodsTabContent,
                closable: false,
              },
              // Dynamically render open tabs for each module
              ...openTabs.map(item => ({
                key: getTabKey(item),
                label: (
                  <span>
                    <Tag color="blue" style={{ fontSize: 9, marginRight: 4 }}>{item.app}</Tag>
                    {item.application_name}
                  </span>
                ),
                children: renderPeriodStatusTabContent(item),
                closable: true,
              })),
            ]}
          />
        </div>
      </Content>

      {/* Autopilot Assistant */}
      
    </Layout>
  );
};

export default AccountingPeriods;
