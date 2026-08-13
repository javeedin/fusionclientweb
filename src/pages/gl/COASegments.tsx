import { buildApexUrl } from '../config/api.helper';
import React, { useState, useRef, useEffect } from 'react';
import {
  Layout,
  Typography,
  Card,
  Button,
  Table,
  Space,
  message,
  Spin,
  Input,
  Empty,
  Breadcrumb,
  Row,
  Col,
  Badge,
  Tabs,
  Progress,
  Radio,
  Tooltip,
  Modal,
  Form,
  Select,
  DatePicker,
  Switch,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  DatabaseOutlined,
  HomeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  AppstoreOutlined,
  SyncOutlined,
  CloudUploadOutlined,
  CheckSquareOutlined,
  BarChartOutlined,
  CloseOutlined,
  CloudOutlined,
  HddOutlined,
  CodeOutlined,
  ClearOutlined,
  ApiOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { ORACLE_FUSION_CONFIG, PROXY_CONFIG } from '../../config/api.config';
import dayjs from 'dayjs';

// Detect if running in Electron
const isElectron = () => {
  return !!(window as any).electron || navigator.userAgent.toLowerCase().includes('electron');
};

const { Content } = Layout;
const { Text } = Typography;

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

// Interface for Segment
interface Segment {
  key_flex_filed_name_code: string;
  structure_code: string;
  sequence_no: number;
  segment_name: string;
  segment_code: string;
  column_name: string;
  prompt: string;
  enabled: string;
}

// Interface for Value (supports both Fusion and APEX formats)
interface ValueSetValue {
  ValueId: number;
  Value: string;
  Description: string;
  EnabledFlag: string;
  StartDateActive: string;
  EndDateActive: string;
  SortOrder: number;
  SummaryFlag: string | null;
  DetailPostingAllowed: string | null;
  DetailBudgetingAllowed: string | null;
  AccountType: string | null;
  ControlAccount: string | null;
  ReconciliationFlag: string | null;
  FinancialCategory: string | null;
  ExternalDataSource: string | null;
  CreationDate: string | null;
  CreatedBy: string | null;
  LastUpdateDate: string | null;
  LastUpdatedBy: string | null;
}

// Interface for Tab
interface TabItem {
  key: string;
  label: string;
  segment: Segment;
  values: ValueSetValue[];
  loading: boolean;
  syncing: boolean;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
  syncMessage: string;
  syncLogs: string[];
  showLogs: boolean;
  showApiInfo: boolean;
  valueSearch: string;
}

// Menu item interface for flyout
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
  { key: 'coa-segments', icon: <AppstoreOutlined />, label: 'COA Segments', description: 'Browse segment values', color: REDWOOD.info, path: '/gl/coa-segments' },
  { key: 'manage-journals', icon: <DatabaseOutlined />, label: 'Manage Journals', description: 'Search and manage journals', color: REDWOOD.primary, path: '/gl/manage-journals' },
  { key: 'chart-of-accounts', icon: <AppstoreOutlined />, label: 'Chart of Accounts', description: 'Manage COA structure', color: REDWOOD.warning, path: '/gl/chart-of-accounts' },
];

// Report menu items
const reportMenuItems: MenuItemType[] = [
  { key: 'trial-balance', icon: <BarChartOutlined />, label: 'Trial Balance', description: 'View trial balance report', color: REDWOOD.reportGreen },
  { key: 'account-analysis', icon: <BarChartOutlined />, label: 'Account Analysis', description: 'Account detail analysis', color: REDWOOD.warning, path: '/gl/account-analysis' },
];

// APEX endpoints
const APEX_SYNC_URL = buildApexUrl('valuesets/addvalues');
const APEX_GET_VALUES_URL = buildApexUrl('valuesets/getvalues');
const APEX_VALUES_URL = buildApexUrl('valuesets/values');
const APEX_VALUES_CONSTRAINT_URL = `${APEX_VALUES_URL}/constraint-info`;

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'A', label: 'A — Asset' },
  { value: 'L', label: 'L — Liability' },
  { value: 'O', label: "O — Owner's Equity" },
  { value: 'R', label: 'R — Revenue' },
  { value: 'E', label: 'E — Expense' },
];

type DataSource = 'fusion' | 'apex';

const COASegments: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [searchText, setSearchText] = useState('');
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string>('');
  const [dataSource, setDataSource] = useState<DataSource>('apex');
  const [activePanel, setActivePanel] = useState<'none' | 'tasks' | 'reports'>('none');
  const [isClosing, setIsClosing] = useState(false);

  // Sync-all modal state
  const [syncAllVisible, setSyncAllVisible] = useState(false);
  const [syncAllRunning, setSyncAllRunning] = useState(false);
  const [syncAllRows, setSyncAllRows] = useState<{
    code: string; name: string;
    status: 'pending' | 'fetching' | 'syncing' | 'done' | 'error';
    fetched: number; synced: number; message: string;
  }[]>([]);

  // Value create/edit modal
  const [valueForm] = Form.useForm();
  const [valueModalVisible, setValueModalVisible] = useState(false);
  const [valueModalMode, setValueModalMode] = useState<'create' | 'edit'>('create');
  const [valueModalTab, setValueModalTab] = useState<TabItem | null>(null);
  const [editingValue, setEditingValue] = useState<ValueSetValue | null>(null);
  const [valueModalSaving, setValueModalSaving] = useState(false);
  const [valueApiVisible, setValueApiVisible] = useState(false);
  const [valueApiResult, setValueApiResult] = useState('');
  const [valueApiLoading, setValueApiLoading] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const floatingIconsRef = useRef<HTMLDivElement>(null);
  const segmentsCache = useRef<Segment[]>([]);
  const valuesCache = useRef<Map<string, ValueSetValue[]>>(new Map());

  // Click outside handler for flyout
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

  // Returns true only for the Account segment (exact name match, not sub-account)
  const isAccountSegment = (tab: TabItem) =>
    tab.segment.segment_name?.trim().toLowerCase() === 'account';

  // Build the API request preview from current form state
  const buildValueApiPreview = () => {
    const fields = valueForm.getFieldsValue();
    const body: Record<string, any> = {
      description: fields.description,
      enabledFlag: fields.enabledFlag ? 'Y' : 'N',
      accountType: fields.accountType || null,
      startDateActive: fields.startDateActive ? fields.startDateActive.format('YYYY-MM-DD') : null,
      endDateActive: fields.endDateActive ? fields.endDateActive.format('YYYY-MM-DD') : null,
      summaryFlag: fields.summaryFlag ? 'Y' : 'N',
      detailPostingAllowed: fields.detailPostingAllowed !== false ? 'Y' : 'N',
      detailBudgetingAllowed: fields.detailBudgetingAllowed !== false ? 'Y' : 'N',
    };
    if (valueModalMode === 'create') {
      body.valueSetCode = valueModalTab?.key;
      body.value = fields.value;
    }
    const url = valueModalMode === 'create' ? APEX_VALUES_URL : `${APEX_VALUES_URL}/${editingValue?.ValueId}`;
    const method = valueModalMode === 'create' ? 'POST' : 'PUT';
    return { url, method, body };
  };

  // Fire a test request from the API panel
  const testValueApi = async () => {
    setValueApiLoading(true);
    setValueApiResult('');
    try {
      const { url, method, body } = buildValueApiPreview();
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      setValueApiResult(`Status: ${resp.status}\n\n${text}`);
    } catch (e: any) {
      setValueApiResult(`Error: ${e.message}`);
    } finally {
      setValueApiLoading(false);
    }
  };

  // Open create modal for a tab
  const openCreateModal = (tab: TabItem) => {
    setValueModalMode('create');
    setValueModalTab(tab);
    setEditingValue(null);
    valueForm.resetFields();
    valueForm.setFieldsValue({ enabledFlag: true });
    setValueApiVisible(false);
    setValueApiResult('');
    setValueModalVisible(true);
  };

  // Open edit modal for an existing value
  const openEditModal = (tab: TabItem, value: ValueSetValue) => {
    setValueModalMode('edit');
    setValueModalTab(tab);
    setEditingValue(value);
    valueForm.setFieldsValue({
      value: value.Value,
      description: value.Description,
      enabledFlag: value.EnabledFlag === 'Y' || value.EnabledFlag === 'true',
      accountType: value.AccountType || undefined,
      startDateActive: value.StartDateActive ? dayjs(value.StartDateActive) : undefined,
      endDateActive: value.EndDateActive ? dayjs(value.EndDateActive) : undefined,
      summaryFlag: value.SummaryFlag === 'Y',
      detailPostingAllowed: value.DetailPostingAllowed !== 'N',
      detailBudgetingAllowed: value.DetailBudgetingAllowed !== 'N',
    });
    setValueApiVisible(false);
    setValueApiResult('');
    setValueModalVisible(true);
  };

  // Save (create or update)
  const handleSaveValue = async () => {
    if (!valueModalTab) return;
    try {
      const fields = await valueForm.validateFields();
      setValueModalSaving(true);

      const body: Record<string, any> = {
        description: fields.description,
        enabledFlag: fields.enabledFlag ? 'Y' : 'N',
        accountType: fields.accountType || null,
        startDateActive: fields.startDateActive ? fields.startDateActive.format('YYYY-MM-DD') : null,
        endDateActive: fields.endDateActive ? fields.endDateActive.format('YYYY-MM-DD') : null,
        summaryFlag: fields.summaryFlag ? 'Y' : 'N',
        detailPostingAllowed: fields.detailPostingAllowed !== false ? 'Y' : 'N',
        detailBudgetingAllowed: fields.detailBudgetingAllowed !== false ? 'Y' : 'N',
      };

      let resp: Response;
      if (valueModalMode === 'create') {
        body.valueSetCode = valueModalTab.key;
        body.value = fields.value;
        resp = await fetch(APEX_VALUES_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        resp = await fetch(`${APEX_VALUES_URL}/${editingValue!.ValueId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      const json = await resp.json().catch(() => ({ status: 'ERROR', message: 'Invalid response' }));
      if (json.status !== 'SUCCESS') {
        message.error(json.message || 'Save failed');
        return;
      }

      message.success(valueModalMode === 'create' ? 'Value created' : 'Value updated');
      setValueModalVisible(false);

      // Invalidate cache and reload the tab
      valuesCache.current.delete(`apex_${valueModalTab.key}`);
      valuesCache.current.delete(`fusion_${valueModalTab.key}`);
      setTabs(prev => prev.map(t => t.key === valueModalTab.key ? { ...t, loading: true } : t));
      const updated = await fetchValuesFromApex(valueModalTab.key);
      valuesCache.current.set(`apex_${valueModalTab.key}`, updated);
      setTabs(prev => prev.map(t => t.key === valueModalTab.key ? { ...t, values: updated, loading: false } : t));
    } catch (err: any) {
      if (err?.errorFields) return; // validation error, antd shows inline
      message.error(err?.message || 'Save failed');
    } finally {
      setValueModalSaving(false);
    }
  };

  // Fetch segments from API
  const fetchSegments = async () => {
    if (segmentsCache.current.length > 0) {
      setSegments(segmentsCache.current);
      return;
    }

    setLoading(true);
    try {
      const apiUrl = buildApexUrl('chartofaccounts/structuresegments');
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      const segmentData = result.items || [];
      setSegments(segmentData);
      segmentsCache.current = segmentData;
      message.success(`Loaded ${segmentData.length} segments`);
    } catch (error) {
      console.error('Error fetching segments:', error);
      message.error('Failed to fetch segments');
    } finally {
      setLoading(false);
    }
  };

  // Fetch values from Fusion API (with pagination - 500 per page until all fetched)
  const fetchValuesFromFusion = async (segmentCode: string): Promise<ValueSetValue[]> => {
    const runningInElectron = isElectron();
    const limit = 500;
    let offset = 0;
    let allItems: ValueSetValue[] = [];
    let hasMore = true;

    const headers: HeadersInit = runningInElectron
      ? {
          'Authorization': `Basic ${btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`)}`,
          'Content-Type': 'application/json'
        }
      : { 'Content-Type': 'application/json' };

    while (hasMore) {
      const baseUrl = runningInElectron
        ? `https://iaaobn.fa.ocs.oraclecloud.com:443/fscmRestApi/resources/11.13.18.05/valueSets/${segmentCode}/child/values`
        : `${PROXY_CONFIG.baseUrl}/fusion/fscmRestApi/resources/11.13.18.05/valueSets/${segmentCode}/child/values`;

      const apiUrl = `${baseUrl}?limit=${limit}&offset=${offset}`;
      console.log(`[COASegments] Fetching page: offset=${offset}, limit=${limit}`);

      const response = await fetch(apiUrl, { method: 'GET', headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();

      const items = result.items || [];
      console.log(`[COASegments] Got ${items.length} items at offset ${offset}`);

      // Map Fusion response to our format (include all fields for APEX sync)
      const mappedItems = items.map((item: any) => ({
        ValueId: item.ValueId,
        Value: item.Value,
        Description: item.Description,
        EnabledFlag: item.EnabledFlag,
        StartDateActive: item.StartDateActive,
        EndDateActive: item.EndDateActive,
        SortOrder: item.SortOrder,
        SummaryFlag: item.SummaryFlag || null,
        DetailPostingAllowed: item.DetailPostingAllowed || null,
        DetailBudgetingAllowed: item.DetailBudgetingAllowed || null,
        AccountType: item.AccountType || null,
        ControlAccount: item.ControlAccount || null,
        ReconciliationFlag: item.ReconciliationFlag || null,
        FinancialCategory: item.FinancialCategory || null,
        ExternalDataSource: item.ExternalDataSource || null,
        CreationDate: item.CreationDate || null,
        CreatedBy: item.CreatedBy || null,
        LastUpdateDate: item.LastUpdateDate || null,
        LastUpdatedBy: item.LastUpdatedBy || null,
      }));

      allItems = [...allItems, ...mappedItems];

      // Check if there are more pages
      if (items.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    console.log(`[COASegments] Total fetched: ${allItems.length} values for ${segmentCode}`);
    return allItems;
  };

  // Fetch values from APEX API
  const fetchValuesFromApex = async (segmentCode: string): Promise<ValueSetValue[]> => {
    const apiUrl = `${APEX_GET_VALUES_URL}/${segmentCode}`;
    const response = await fetch(apiUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    // Map APEX response (lowercase) to our format
    return (result.items || []).map((item: any) => ({
      ValueId: item.value_id,
      Value: item.value,
      Description: item.description,
      EnabledFlag: item.enabled_flag,
      StartDateActive: item.start_date_active ? item.start_date_active.substring(0, 10) : '',
      EndDateActive: item.end_date_active ? item.end_date_active.substring(0, 10) : '',
      SortOrder: item.sort_order,
      SummaryFlag: item.summary_flag || null,
      DetailPostingAllowed: item.detail_posting_allowed || null,
      DetailBudgetingAllowed: item.detail_budgeting_allowed || null,
      AccountType: item.account_type || null,
      ControlAccount: item.control_account || null,
      ReconciliationFlag: item.reconciliation_flag || null,
      FinancialCategory: item.financial_category || null,
      ExternalDataSource: item.external_data_source || null,
      CreationDate: item.fusion_creation_date || null,
      CreatedBy: item.fusion_created_by || null,
      LastUpdateDate: item.fusion_last_update_date || null,
      LastUpdatedBy: item.fusion_last_updated_by || null,
    }));
  };

  // Fetch values for a segment (based on data source)
  const fetchValues = async (segmentCode: string): Promise<ValueSetValue[]> => {
    const cacheKey = `${dataSource}_${segmentCode}`;
    if (valuesCache.current.has(cacheKey)) {
      return valuesCache.current.get(cacheKey)!;
    }

    try {
      const values = dataSource === 'fusion'
        ? await fetchValuesFromFusion(segmentCode)
        : await fetchValuesFromApex(segmentCode);

      valuesCache.current.set(cacheKey, values);
      return values;
    } catch (error: any) {
      console.error('[COASegments] Error:', error.message);
      if (dataSource === 'fusion' && !isElectron()) {
        message.error('Failed to fetch from Fusion. Start proxy: node server/proxy.cjs');
      } else {
        message.error(`Failed: ${error.message}`);
      }
      return [];
    }
  };

  // Handle segment click - open new tab
  const handleSegmentClick = async (segment: Segment) => {
    const existingTab = tabs.find(t => t.key === segment.segment_code);
    if (existingTab) {
      setActiveTabKey(segment.segment_code);
      return;
    }

    const newTab: TabItem = {
      key: segment.segment_code,
      label: segment.segment_name,
      segment,
      values: [],
      loading: true,
      syncing: false,
      syncStatus: 'idle',
      syncMessage: '',
      syncLogs: [],
      showLogs: false,
      showApiInfo: false,
      valueSearch: '',
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabKey(segment.segment_code);

    const values = await fetchValues(segment.segment_code);
    setTabs(prev => prev.map(t =>
      t.key === segment.segment_code ? { ...t, values, loading: false } : t
    ));

    if (values.length > 0) {
      message.success(`Loaded ${values.length} values from ${dataSource === 'fusion' ? 'Fusion' : 'APEX DB'}`);
    }
  };

  // Handle tab close
  const handleTabClose = (targetKey: string) => {
    const newTabs = tabs.filter(t => t.key !== targetKey);
    setTabs(newTabs);
    if (activeTabKey === targetKey && newTabs.length > 0) {
      setActiveTabKey(newTabs[newTabs.length - 1].key);
    } else if (newTabs.length === 0) {
      setActiveTabKey('');
    }
  };

  // Add log to tab
  const addSyncLog = (tabKey: string, log: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTabs(prev => prev.map(t =>
      t.key === tabKey ? { ...t, syncLogs: [...t.syncLogs, `[${timestamp}] ${log}`] } : t
    ));
  };

  // Toggle log panel
  const toggleLogPanel = (tabKey: string) => {
    setTabs(prev => prev.map(t =>
      t.key === tabKey ? { ...t, showLogs: !t.showLogs } : t
    ));
  };

  // Clear logs
  const clearLogs = (tabKey: string) => {
    setTabs(prev => prev.map(t =>
      t.key === tabKey ? { ...t, syncLogs: [] } : t
    ));
  };

  // Toggle API info panel
  const toggleApiInfo = (tabKey: string) => {
    setTabs(prev => prev.map(t =>
      t.key === tabKey ? { ...t, showApiInfo: !t.showApiInfo } : t
    ));
  };

  // Build the GET values URL for a given tab (for display only)
  const getValuesUrl = (tabKey: string): string => {
    if (dataSource === 'apex') {
      return `${APEX_GET_VALUES_URL}/${tabKey}`;
    }
    const runningInElectron = isElectron();
    const base = runningInElectron
      ? 'https://iaaobn.fa.ocs.oraclecloud.com:443/fscmRestApi/resources/11.13.18.05'
      : `${PROXY_CONFIG.baseUrl}/fusion/fscmRestApi/resources/11.13.18.05`;
    return `${base}/valueSets/${tabKey}/child/values?limit=500&offset=0`;
  };

  // Set value search for a tab
  const setValueSearch = (tabKey: string, search: string) => {
    setTabs(prev => prev.map(t =>
      t.key === tabKey ? { ...t, valueSearch: search } : t
    ));
  };

  // Filter values based on search
  const getFilteredValues = (tab: TabItem) => {
    if (!tab.valueSearch) return tab.values;
    const search = tab.valueSearch.toLowerCase();
    return tab.values.filter(v =>
      v.Value?.toLowerCase().includes(search) ||
      v.Description?.toLowerCase().includes(search) ||
      v.AccountType?.toLowerCase().includes(search)
    );
  };

  // Batch size for sync (APEX has CLOB length limits)
  const BATCH_SIZE = 5;

  // Sync values to APEX database with batching
  // ── Sync all segments from Fusion → APEX ──────────────────────────────────
  const handleSyncAll = async () => {
    if (segments.length === 0) { message.warning('Load segments first'); return; }
    const rows = segments
      .sort((a, b) => a.sequence_no - b.sequence_no)
      .map(s => ({ code: s.segment_code, name: s.segment_name, status: 'pending' as 'pending' | 'fetching' | 'syncing' | 'done' | 'error', fetched: 0, synced: 0, message: '' }));
    setSyncAllRows(rows);
    setSyncAllVisible(true);
    setSyncAllRunning(true);

    const update = (code: string, patch: Partial<typeof rows[0]>) =>
      setSyncAllRows(prev => prev.map(r => r.code === code ? { ...r, ...patch } : r));

    for (const seg of rows) {
      // Fetch from Fusion
      update(seg.code, { status: 'fetching', message: 'Fetching from Fusion…' });
      let values: ValueSetValue[] = [];
      try {
        valuesCache.current.delete(`fusion_${seg.code}`);
        values = await fetchValuesFromFusion(seg.code);
        update(seg.code, { fetched: values.length, message: `Fetched ${values.length} values` });
      } catch (e: any) {
        update(seg.code, { status: 'error', message: `Fetch failed: ${e.message}` });
        continue;
      }
      if (values.length === 0) {
        update(seg.code, { status: 'done', message: 'No values returned from Fusion' });
        continue;
      }

      // Push to APEX in batches
      update(seg.code, { status: 'syncing', message: `Syncing ${values.length} values…` });
      let synced = 0;
      let failed = false;
      const batches = Math.ceil(values.length / BATCH_SIZE);
      for (let b = 0; b < batches && !failed; b++) {
        const batch = values.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        try {
          const resp = await fetch(APEX_SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valueSetCode: seg.code, items: batch }),
          });
          const json = await resp.json().catch(() => ({}));
          if (json.success) { synced += json.insertedCount || batch.length; }
          else { failed = true; update(seg.code, { status: 'error', message: json.error || 'Sync failed' }); }
        } catch (e: any) { failed = true; update(seg.code, { status: 'error', message: e.message }); }
        update(seg.code, { synced });
      }
      if (!failed) update(seg.code, { status: 'done', synced, message: `✅ ${synced} values synced` });
    }
    setSyncAllRunning(false);
  };

  // testLimit: 0 = all, 1 = first 1, 5 = first 5, etc.
  const handleSyncToDb = async (tab: TabItem, testLimit: number = 0) => {
    if (tab.values.length === 0) {
      // Open log panel and explain why nothing ran
      setTabs(prev => prev.map(t =>
        t.key === tab.key ? { ...t, showLogs: true, syncLogs: [
          `❌ No values loaded for "${tab.key}"`,
          `Current source: ${dataSource === 'fusion' ? 'Oracle Fusion' : 'APEX Database'}`,
          dataSource === 'fusion' && !isElectron()
            ? '⚠ Fusion requires the proxy server — run: node server/proxy.cjs'
            : `Try clicking the Reload button to re-fetch from ${dataSource === 'fusion' ? 'Fusion' : 'APEX DB'}`,
        ]} : t
      ));
      message.warning('No values loaded — check the Logs panel for details');
      return;
    }

    // Clear previous logs and start fresh
    setTabs(prev => prev.map(t =>
      t.key === tab.key ? { ...t, syncing: true, syncStatus: 'syncing', syncMessage: 'Preparing data...', syncLogs: [], showLogs: true } : t
    ));

    // Use limited items if testLimit > 0, otherwise all
    const itemsToSync = testLimit > 0 ? tab.values.slice(0, testLimit) : tab.values;
    const testMode = testLimit > 0;

    // Calculate batches
    const totalBatches = Math.ceil(itemsToSync.length / BATCH_SIZE);
    let totalInserted = 0;
    let hasError = false;

    addSyncLog(tab.key, '========== BATCH SYNC REQUEST ==========');
    addSyncLog(tab.key, `POST URL: ${APEX_SYNC_URL}`);
    addSyncLog(tab.key, testMode ? `🧪 TEST MODE: First ${testLimit} items` : '📦 FULL SYNC');
    addSyncLog(tab.key, `Value Set Code: ${tab.key}`);
    addSyncLog(tab.key, `Total Items: ${itemsToSync.length}`);
    addSyncLog(tab.key, `Batch Size: ${BATCH_SIZE}`);
    addSyncLog(tab.key, `Total Batches: ${totalBatches}`);

    try {
      for (let batchNum = 0; batchNum < totalBatches && !hasError; batchNum++) {
        const startIdx = batchNum * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, itemsToSync.length);
        const batchItems = itemsToSync.slice(startIdx, endIdx);

        addSyncLog(tab.key, `---------- BATCH ${batchNum + 1}/${totalBatches} ----------`);
        addSyncLog(tab.key, `Items ${startIdx + 1} to ${endIdx} (${batchItems.length} items)`);

        setTabs(prev => prev.map(t =>
          t.key === tab.key ? { ...t, syncMessage: `Batch ${batchNum + 1}/${totalBatches}: Syncing ${batchItems.length} items...` } : t
        ));

        const postBody = { valueSetCode: tab.key, items: batchItems };
        const bodyJson = JSON.stringify(postBody);

        const response = await fetch(APEX_SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyJson,
        });

        const responseText = await response.text();
        addSyncLog(tab.key, `Response: ${responseText}`);

        let result;
        try {
          result = JSON.parse(responseText);
        } catch {
          result = { success: false, error: responseText };
        }

        if (result.success) {
          const inserted = result.insertedCount || batchItems.length;
          totalInserted += inserted;
          addSyncLog(tab.key, `✅ Batch ${batchNum + 1}: Inserted ${inserted} records`);
        } else {
          hasError = true;
          addSyncLog(tab.key, `❌ Batch ${batchNum + 1} FAILED: ${result.error || 'Unknown error'}`);
          throw new Error(result.error || `Batch ${batchNum + 1} failed`);
        }

        // Small delay between batches to avoid overwhelming the server
        if (batchNum < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      addSyncLog(tab.key, '========== SYNC COMPLETE ==========');
      addSyncLog(tab.key, `✅ Total Inserted: ${totalInserted}/${itemsToSync.length}`);

      setTabs(prev => prev.map(t =>
        t.key === tab.key ? { ...t, syncing: false, syncStatus: 'success', syncMessage: `✓ Synced ${totalInserted}/${itemsToSync.length} values` } : t
      ));
      message.success(`Successfully synced ${totalInserted} values in ${totalBatches} batches`);

    } catch (error: any) {
      addSyncLog(tab.key, `❌ EXCEPTION: ${error.message}`);
      addSyncLog(tab.key, `Partial sync: ${totalInserted} records synced before error`);
      setTabs(prev => prev.map(t =>
        t.key === tab.key ? { ...t, syncing: false, syncStatus: 'error', syncMessage: `✗ Error: ${error.message} (${totalInserted} synced)` } : t
      ));
      message.error(`Sync failed: ${error.message}`);
    }
  };

  // Handle data source change
  const handleDataSourceChange = (source: DataSource) => {
    setDataSource(source);
    valuesCache.current.clear();
    setTabs([]);
    setActiveTabKey('');
    message.info(`Data source changed to ${source === 'fusion' ? 'Oracle Fusion' : 'APEX Database'}`);
  };

  // Handle refresh
  const handleRefresh = () => {
    segmentsCache.current = [];
    valuesCache.current.clear();
    setSegments([]);
    setTabs([]);
    setActiveTabKey('');
    fetchSegments();
  };

  // Filter segments
  const filteredSegments = segments.filter(seg =>
    seg.segment_name?.toLowerCase().includes(searchText.toLowerCase()) ||
    seg.column_name?.toLowerCase().includes(searchText.toLowerCase())
  );

  const isSegmentOpen = (segmentCode: string) => tabs.some(t => t.key === segmentCode);

  // Segment item component
  const SegmentItem = ({ segment }: { segment: Segment }) => {
    const isOpen = isSegmentOpen(segment.segment_code);
    const isActive = activeTabKey === segment.segment_code;

    return (
      <div
        onClick={() => handleSegmentClick(segment)}
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          border: isActive ? `2px solid ${REDWOOD.info}` : isOpen ? `1px solid ${REDWOOD.info}` : `1px solid ${REDWOOD.neutral200}`,
          background: isActive ? `${REDWOOD.info}10` : isOpen ? `${REDWOOD.info}05` : REDWOOD.surface,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = `${REDWOOD.info}08`; e.currentTarget.style.borderColor = REDWOOD.info; }}}
        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = isOpen ? `${REDWOOD.info}05` : REDWOOD.surface; e.currentTarget.style.borderColor = isOpen ? REDWOOD.info : REDWOOD.neutral200; }}}
      >
        <div style={{ width: 24, height: 24, borderRadius: 4, background: isActive ? REDWOOD.info : REDWOOD.neutral200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isActive ? '#fff' : REDWOOD.neutral600, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
          {segment.sequence_no}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ color: REDWOOD.neutral900, fontSize: 12 }}>{segment.segment_name}</Text>
          <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>({segment.column_name})</Text>
        </div>
        {isOpen && <div style={{ width: 6, height: 6, borderRadius: '50%', background: REDWOOD.info }} />}
      </div>
    );
  };

  // Floating Icon component
  const FloatingIcon = ({ icon, label, color, isActive, onClick, position }: { icon: React.ReactNode; label: string; color: string; isActive: boolean; onClick: () => void; position: 'top' | 'bottom' }) => (
    <Tooltip title={!isActive ? label : ''} placement="left">
      <div onClick={onClick} style={{ width: 40, height: 40, borderRadius: position === 'top' ? '8px 8px 0 0' : '0 0 8px 8px', background: isActive ? color : REDWOOD.surface, border: `2px solid ${color}`, borderBottom: position === 'top' ? 'none' : `2px solid ${color}`, borderTop: position === 'bottom' ? 'none' : `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: isActive ? `0 4px 12px ${color}40` : '0 2px 8px rgba(0,0,0,0.1)', color: isActive ? '#fff' : color, fontSize: 18 }}>
        {icon}
      </div>
    </Tooltip>
  );

  // Slide Panel component
  const SlidePanel = ({ title, items, color }: { title: string; items: MenuItemType[]; color: string }) => (
    <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 280, background: REDWOOD.surface, boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', overflow: 'hidden', animation: isClosing ? 'slideOut 0.25s ease-in forwards' : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 14px', background: color, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <Text strong style={{ color: '#fff', fontSize: 14 }}>{title}</Text>
        <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
      </div>
      <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
        {items.map((item, index) => (
          <div key={item.key} onClick={() => handleMenuItemClick(item.key, item.path)} style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s ease', marginBottom: 6, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface, opacity: 0, animation: `fadeInItem 0.3s ease-out ${index * 0.05}s forwards` }}
            onMouseEnter={(e) => { e.currentTarget.style.background = REDWOOD.neutral100; e.currentTarget.style.borderColor = color; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = REDWOOD.surface; e.currentTarget.style.borderColor = REDWOOD.neutral200; }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color, fontSize: 16, flexShrink: 0 }}>{item.icon}</div>
            <div style={{ flex: 1 }}>
              <Text strong style={{ display: 'block', color: REDWOOD.neutral900, fontSize: 12 }}>{item.label}</Text>
              {item.description && <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>{item.description}</Text>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Values table columns — generated per tab so the Edit action has tab context
  const getValueColumns = (tab: TabItem) => [
    { title: 'Value', dataIndex: 'Value', key: 'Value', width: 80, render: (text: string) => <Text strong style={{ fontSize: 12 }}>{text}</Text> },
    { title: 'Description', dataIndex: 'Description', key: 'Description', ellipsis: true, render: (text: string) => <Text style={{ fontSize: 12 }}>{text}</Text> },
    ...(isAccountSegment(tab) ? [{ title: 'Account Type', dataIndex: 'AccountType', key: 'AccountType', width: 100, render: (text: string) => <Text style={{ fontSize: 11 }}>{text || '-'}</Text> }] : []),
    { title: 'Enabled', dataIndex: 'EnabledFlag', key: 'EnabledFlag', width: 60, align: 'center' as const, render: (flag: string) => (flag === 'Y' || flag === 'true' ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 14 }} /> : <CloseCircleOutlined style={{ color: REDWOOD.neutral300, fontSize: 14 }} />) },
    { title: 'Start Date', dataIndex: 'StartDateActive', key: 'StartDateActive', width: 90, render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? date.substring(0, 10) : '-'}</Text> },
    { title: 'End Date', dataIndex: 'EndDateActive', key: 'EndDateActive', width: 90, render: (date: string) => <Text style={{ fontSize: 11 }}>{date ? date.substring(0, 10) : '-'}</Text> },
    {
      title: '',
      key: 'actions',
      width: 40,
      align: 'center' as const,
      render: (_: any, record: ValueSetValue) => (
        <Tooltip title="Edit">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined style={{ fontSize: 12, color: REDWOOD.info }} />}
            onClick={() => openEditModal(tab, record)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Header */}
        <div style={{ padding: '8px 20px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: REDWOOD.info, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AppstoreOutlined style={{ fontSize: 14, color: '#fff' }} />
            </div>
            <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900 }}>COA Segments</Text>
            <Breadcrumb style={{ marginLeft: 8 }} items={[{ title: <Link to="/home"><HomeOutlined /></Link> }, { title: <Link to="/gl">GL</Link> }]} />
          </div>
          <Space size="middle">
            {/* Data Source Toggle */}
            <Radio.Group value={dataSource} onChange={(e) => handleDataSourceChange(e.target.value)} size="small" buttonStyle="solid">
              <Radio.Button value="fusion"><CloudOutlined /> Fusion</Radio.Button>
              <Radio.Button value="apex"><HddOutlined /> APEX DB</Radio.Button>
            </Radio.Group>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh}>Refresh</Button>
            <Button size="small" type="primary" icon={<SyncOutlined />} onClick={handleSyncAll} disabled={segments.length === 0} style={{ background: REDWOOD.success }}>Sync All to DB</Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: REDWOOD.info }}>Add Value Set</Button>
          </Space>
        </div>

        {/* Main Content */}
        <div style={{ padding: 16, paddingRight: 80, height: 'calc(100vh - 120px)' }}>
          <Row gutter={16} style={{ height: '100%' }}>
            {/* Left Panel */}
            <Col xs={24} lg={7} xl={5} style={{ height: '100%' }}>
              <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ padding: 12, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900 }}>Segments</Text>
                    <Badge count={segments.length} style={{ backgroundColor: REDWOOD.info }} />
                  </div>
                  <Input size="small" placeholder="Search..." prefix={<SearchOutlined style={{ color: REDWOOD.neutral300, fontSize: 12 }} />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ borderRadius: 6 }} allowClear />
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
                  {segments.length === 0 && !loading ? (
                    <div style={{ textAlign: 'center', padding: '30px 16px' }}>
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} imageStyle={{ height: 40 }} description={<Text type="secondary" style={{ fontSize: 11 }}>Click to load segments</Text>}>
                        <Button size="small" type="primary" icon={<DatabaseOutlined />} onClick={fetchSegments} style={{ background: REDWOOD.info }}>Fetch Segments</Button>
                      </Empty>
                    </div>
                  ) : (
                    <Spin spinning={loading}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {filteredSegments.sort((a, b) => a.sequence_no - b.sequence_no).map((segment) => (
                          <SegmentItem key={segment.segment_code} segment={segment} />
                        ))}
                      </div>
                    </Spin>
                  )}
                </div>
              </Card>
            </Col>

            {/* Right Panel */}
            <Col xs={24} lg={17} xl={19} style={{ height: '100%' }}>
              <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, height: '100%' }} bodyStyle={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                {tabs.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: REDWOOD.neutral100 }}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} imageStyle={{ height: 60 }} description={
                      <div style={{ textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Click on a segment to open its values</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>Source: <Text strong>{dataSource === 'fusion' ? 'Oracle Fusion' : 'APEX Database'}</Text></Text>
                      </div>
                    } />
                  </div>
                ) : (
                  <Tabs type="editable-card" activeKey={activeTabKey} onChange={setActiveTabKey} onEdit={(targetKey, action) => { if (action === 'remove') handleTabClose(targetKey as string); }} hideAdd style={{ height: '100%' }} tabBarStyle={{ margin: 0, padding: '0 8px', background: REDWOOD.neutral100 }}
                    items={tabs.map(tab => ({
                      key: tab.key,
                      label: (<span style={{ fontSize: 12 }}><Badge count={tab.segment.sequence_no} style={{ backgroundColor: activeTabKey === tab.key ? REDWOOD.info : REDWOOD.neutral300, fontSize: 10, marginRight: 6 }} />{tab.label}</span>),
                      closable: true,
                      children: (
                        <div style={{ height: 'calc(100vh - 220px)', overflow: 'auto' }}>
                          {tab.loading ? (
                            <div style={{ padding: 40, textAlign: 'center' }}><Spin tip="Loading values..." /></div>
                          ) : (
                            <>
                              {/* Toolbar with segment code */}
                              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.neutral100, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Space>
                                  <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{getFilteredValues(tab).length}/{tab.values.length} values</Text>
                                  <Text code style={{ fontSize: 10 }}>{tab.key}</Text>
                                  <Input
                                    size="small"
                                    placeholder="Search values..."
                                    prefix={<SearchOutlined style={{ color: REDWOOD.neutral300, fontSize: 11 }} />}
                                    value={tab.valueSearch}
                                    onChange={(e) => setValueSearch(tab.key, e.target.value)}
                                    style={{ width: 180, fontSize: 11 }}
                                    allowClear
                                  />
                                  {tab.syncStatus === 'success' && <Text style={{ fontSize: 11, color: REDWOOD.success }}>{tab.syncMessage}</Text>}
                                  {tab.syncStatus === 'error' && <Text style={{ fontSize: 11, color: REDWOOD.primary }}>{tab.syncMessage}</Text>}
                                </Space>
                                <Space>
                                  <Button
                                    size="small"
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    onClick={() => openCreateModal(tab)}
                                    style={{ background: REDWOOD.info }}
                                  >
                                    New {tab.label}
                                  </Button>
                                  <Tooltip title={`Reload from ${dataSource === 'fusion' ? 'Oracle Fusion' : 'APEX DB'}`}>
                                    <Button size="small" icon={<ReloadOutlined />} loading={tab.loading}
                                      onClick={async () => {
                                        valuesCache.current.delete(`${dataSource}_${tab.key}`);
                                        setTabs(prev => prev.map(t => t.key === tab.key ? { ...t, loading: true } : t));
                                        const values = await fetchValues(tab.key);
                                        setTabs(prev => prev.map(t => t.key === tab.key ? { ...t, values, loading: false } : t));
                                        message.success(`Reloaded ${values.length} values from ${dataSource === 'fusion' ? 'Fusion' : 'APEX DB'}`);
                                      }}>
                                      Reload
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title={tab.showApiInfo ? 'Hide API Info' : 'Show API Endpoints'}>
                                    <Button size="small" icon={<ApiOutlined />} onClick={() => toggleApiInfo(tab.key)} type={tab.showApiInfo ? 'primary' : 'default'} style={tab.showApiInfo ? { background: REDWOOD.info } : { borderColor: REDWOOD.info, color: REDWOOD.info }}>
                                      API
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title={tab.showLogs ? 'Hide Logs' : 'Show Logs'}>
                                    <Button size="small" icon={<CodeOutlined />} onClick={() => toggleLogPanel(tab.key)} type={tab.showLogs ? 'primary' : 'default'} style={tab.showLogs ? { background: REDWOOD.warning } : {}}>
                                      {tab.syncLogs.length > 0 ? `Logs (${tab.syncLogs.length})` : 'Logs'}
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title={tab.values.length === 0 ? 'No values loaded' : 'Test sync with 1 item only'}>
                                    <Button size="small" onClick={() => handleSyncToDb(tab, 1)} disabled={tab.syncing || tab.values.length === 0} style={{ borderColor: REDWOOD.success, color: REDWOOD.success }}>
                                      Test (1)
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title={tab.values.length === 0 ? 'No values loaded' : 'Test sync with first 5 items'}>
                                    <Button size="small" onClick={() => handleSyncToDb(tab, 5)} disabled={tab.syncing || tab.values.length === 0} style={{ borderColor: REDWOOD.warning, color: REDWOOD.warning }}>
                                      Test (5)
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title={tab.values.length === 0 ? 'No values loaded' : 'Sync all values to APEX DB'}>
                                    <Button type="primary" size="small" icon={tab.syncing ? <SyncOutlined spin /> : <CloudUploadOutlined />} onClick={() => handleSyncToDb(tab, 0)} disabled={tab.syncing || tab.values.length === 0} style={{ background: tab.syncStatus === 'success' ? REDWOOD.success : REDWOOD.info }}>
                                      {tab.syncing ? 'Syncing...' : 'Sync to DB'}
                                    </Button>
                                  </Tooltip>
                                </Space>
                              </div>
                              {/* API Info Panel */}
                              {tab.showApiInfo && (
                                <div style={{ borderBottom: `1px solid ${REDWOOD.neutral200}`, background: '#f0f5ff', padding: '8px 12px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <Text strong style={{ fontSize: 11, color: REDWOOD.info }}>API Endpoints</Text>
                                    <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => toggleApiInfo(tab.key)} style={{ color: REDWOOD.neutral600 }} />
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                      <Text type="secondary" style={{ fontSize: 10, minWidth: 80 }}>APEX GET:</Text>
                                      <Text code style={{ fontSize: 10, wordBreak: 'break-all' }}>{`${APEX_GET_VALUES_URL}/${tab.key}`}</Text>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                      <Text type="secondary" style={{ fontSize: 10, minWidth: 80 }}>Fusion GET:</Text>
                                      <Text code style={{ fontSize: 10, wordBreak: 'break-all' }}>{`https://iaaobn.fa.ocs.oraclecloud.com:443/fscmRestApi/resources/11.13.18.05/valueSets/${tab.key}/child/values?limit=500&offset=0`}</Text>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                      <Text type="secondary" style={{ fontSize: 10, minWidth: 80 }}>POST Sync:</Text>
                                      <Text code style={{ fontSize: 10, wordBreak: 'break-all' }}>{APEX_SYNC_URL}</Text>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Text type="secondary" style={{ fontSize: 10, minWidth: 80 }}>Source:</Text>
                                      <Text style={{ fontSize: 10 }}>{dataSource === 'fusion' ? (isElectron() ? 'Oracle Fusion (Electron — direct)' : 'Oracle Fusion (proxy)') : 'APEX Database (direct)'}</Text>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {/* Sync Progress */}
                              {tab.syncing && (
                                <div style={{ padding: '8px 12px', background: '#E6F7FF', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <Progress percent={100} status="active" showInfo={false} size="small" style={{ flex: 1 }} />
                                    <Text style={{ fontSize: 11, color: REDWOOD.info }}>{tab.syncMessage}</Text>
                                  </div>
                                </div>
                              )}
                              {/* Log Panel */}
                              {tab.showLogs && (
                                <div style={{ borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                                  <div style={{ padding: '6px 12px', background: '#1A1A1A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ color: '#00FF00', fontSize: 11 }}>Sync Log</Text>
                                    <Space size="small">
                                      <Button size="small" type="text" icon={<ClearOutlined />} onClick={() => clearLogs(tab.key)} style={{ color: '#888', fontSize: 10 }}>Clear</Button>
                                      <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => toggleLogPanel(tab.key)} style={{ color: '#888' }} />
                                    </Space>
                                  </div>
                                  <div style={{ background: '#1A1A1A', color: '#00FF00', padding: 12, fontFamily: 'monospace', fontSize: 11, maxHeight: 200, overflowY: 'auto' }}>
                                    {tab.syncLogs.length === 0 ? (
                                      <div style={{ color: '#888' }}>Click "Sync to DB" to see request logs...</div>
                                    ) : (
                                      tab.syncLogs.map((log, i) => (
                                        <div key={i} style={{ marginBottom: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log}</div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              )}
                              <Table columns={getValueColumns(tab)} dataSource={getFilteredValues(tab)} rowKey="Value" size="small" pagination={{ size: 'small', pageSize: 20, showSizeChanger: false, showTotal: (total) => <Text style={{ fontSize: 11 }}>{total} values</Text> }} className="compact-table" />
                            </>
                          )}
                        </div>
                      ),
                    }))}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </div>

        {/* Floating Icons */}
        <div ref={floatingIconsRef} style={{ position: 'fixed', right: 24, top: '50%', transform: 'translateY(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <FloatingIcon icon={<CheckSquareOutlined />} label="Tasks" color={REDWOOD.taskBlue} isActive={activePanel === 'tasks'} onClick={() => togglePanel('tasks')} position="top" />
          <div style={{ width: 40, height: 2, background: REDWOOD.neutral200 }} />
          <FloatingIcon icon={<BarChartOutlined />} label="Reports" color={REDWOOD.reportGreen} isActive={activePanel === 'reports'} onClick={() => togglePanel('reports')} position="bottom" />
        </div>

        {/* Backdrop */}
        {activePanel !== 'none' && (
          <div onClick={closePanel} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000, animation: isClosing ? 'fadeOut 0.25s ease forwards' : 'fadeIn 0.3s ease forwards' }} />
        )}

        {/* Slide Panels */}
        <div ref={panelRef}>
          {activePanel === 'tasks' && <SlidePanel title="Tasks" items={taskMenuItems} color={REDWOOD.taskBlue} />}
          {activePanel === 'reports' && <SlidePanel title="Reports" items={reportMenuItems} color={REDWOOD.reportGreen} />}
        </div>
      </Content>

      

      {/* ── Sync All Modal ─────────────────────────────────────────────── */}
      <Modal
        open={syncAllVisible}
        title={<Space><SyncOutlined spin={syncAllRunning} style={{ color: REDWOOD.success }} /><Text strong>Sync All Segments — Fusion → APEX DB</Text></Space>}
        footer={
          <Button type="primary" disabled={syncAllRunning} onClick={() => setSyncAllVisible(false)}
            style={{ background: REDWOOD.info }}>
            {syncAllRunning ? 'Running…' : 'Close'}
          </Button>
        }
        width={640}
        closable={!syncAllRunning}
        onCancel={() => { if (!syncAllRunning) setSyncAllVisible(false); }}
      >
        {/* Overall progress bar */}
        {syncAllRows.length > 0 && (() => {
          const done = syncAllRows.filter(r => r.status === 'done' || r.status === 'error').length;
          const errors = syncAllRows.filter(r => r.status === 'error').length;
          return (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 11 }}>{done} / {syncAllRows.length} segments</Text>
                {errors > 0 && <Text style={{ fontSize: 11, color: REDWOOD.primary }}>{errors} error{errors > 1 ? 's' : ''}</Text>}
              </div>
              <Progress
                percent={Math.round((done / syncAllRows.length) * 100)}
                status={errors > 0 ? 'exception' : done === syncAllRows.length ? 'success' : 'active'}
                size="small"
              />
            </div>
          );
        })()}

        {/* Per-segment rows */}
        <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {syncAllRows.map(row => {
            const icon = row.status === 'done' ? '✅'
              : row.status === 'error' ? '❌'
              : row.status === 'fetching' ? '⬇'
              : row.status === 'syncing' ? '⬆'
              : '⏳';
            const color = row.status === 'done' ? REDWOOD.success
              : row.status === 'error' ? REDWOOD.primary
              : row.status === 'pending' ? REDWOOD.neutral300
              : REDWOOD.info;
            return (
              <div key={row.code} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px', borderRadius: 6,
                background: row.status === 'pending' ? REDWOOD.neutral100 : row.status === 'error' ? '#fff1f0' : row.status === 'done' ? '#f6ffed' : '#e6f4ff',
                border: `1px solid ${color}22`,
              }}>
                <span style={{ fontSize: 14, minWidth: 20, textAlign: 'center' }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ fontSize: 11 }}>{row.name}</Text>
                    <Text code style={{ fontSize: 10 }}>{row.code}</Text>
                  </div>
                  <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>{row.message}</Text>
                </div>
                {(row.status === 'fetching' || row.status === 'syncing') && (
                  <SyncOutlined spin style={{ color: REDWOOD.info, fontSize: 12 }} />
                )}
                {row.status === 'done' && row.synced > 0 && (
                  <Text style={{ fontSize: 10, color: REDWOOD.success, whiteSpace: 'nowrap' }}>{row.synced.toLocaleString()} rows</Text>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      {/* ── Create / Edit Value Modal ──────────────────────────────────── */}
      <Modal
        open={valueModalVisible}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 32 }}>
            <Space>
              {valueModalMode === 'create' ? <PlusOutlined style={{ color: REDWOOD.info }} /> : <EditOutlined style={{ color: REDWOOD.info }} />}
              <span>{valueModalMode === 'create' ? `New ${valueModalTab?.label ?? 'Value'}` : `Edit ${valueModalTab?.label ?? 'Value'}`}</span>
            </Space>
            <Button
              size="small"
              icon={<ApiOutlined />}
              type={valueApiVisible ? 'primary' : 'default'}
              style={valueApiVisible ? { background: REDWOOD.info, borderColor: REDWOOD.info } : { borderColor: REDWOOD.info, color: REDWOOD.info }}
              onClick={() => { setValueApiVisible(v => !v); setValueApiResult(''); }}
            >
              API
            </Button>
          </div>
        }
        onCancel={() => setValueModalVisible(false)}
        onOk={handleSaveValue}
        okText={valueModalMode === 'create' ? 'Create' : 'Save'}
        okButtonProps={{ loading: valueModalSaving, style: { background: REDWOOD.info } }}
        cancelButtonProps={{ disabled: valueModalSaving }}
        width={520}
        destroyOnClose
      >
        {valueApiVisible && (() => {
          const { url, method, body } = buildValueApiPreview();
          return (
            <div style={{ marginBottom: 12, background: '#1A1A1A', borderRadius: 6, overflow: 'hidden', fontSize: 11 }}>
              <div style={{ padding: '6px 10px', background: '#2A2A2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Space size={6} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <Text style={{ color: method === 'POST' ? '#52c41a' : '#faad14', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{method}</Text>
                  <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{url}</Text>
                </Space>
                <Space size={4} style={{ flexShrink: 0 }}>
                  <Button size="small" loading={valueApiLoading} onClick={testValueApi} style={{ background: REDWOOD.info, color: '#fff', borderColor: REDWOOD.info }}>Test</Button>
                  <Button size="small" onClick={async () => {
                    setValueApiLoading(true);
                    try {
                      const r = await fetch(APEX_VALUES_CONSTRAINT_URL);
                      const t = await r.text();
                      setValueApiResult(`Constraint Info:\n${t}`);
                    } catch (e: any) { setValueApiResult(`Error: ${e.message}`); }
                    finally { setValueApiLoading(false); }
                  }} style={{ borderColor: '#faad14', color: '#faad14' }}>Constraint</Button>
                </Space>
              </div>
              <div style={{ padding: '8px 10px', maxHeight: 160, overflowY: 'auto' }}>
                <pre style={{ color: '#00FF00', fontFamily: 'monospace', fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(body, null, 2)}
                </pre>
              </div>
              {valueApiResult && (
                <div style={{ borderTop: '1px solid #333', padding: '8px 10px' }}>
                  <Text style={{ color: '#FFD700', fontFamily: 'monospace', fontSize: 10 }}>Response:</Text>
                  <pre style={{ color: '#bbb', fontFamily: 'monospace', fontSize: 10, margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {valueApiResult}
                  </pre>
                </div>
              )}
            </div>
          );
        })()}
        <Form form={valueForm} layout="vertical" size="small" style={{ marginTop: 12 }}>
          <Form.Item
            label="Value"
            name="value"
            rules={[{ required: true, message: 'Value is required' }, { max: 150 }]}
          >
            <Input
              disabled={valueModalMode === 'edit'}
              placeholder="Enter segment value code"
              style={{ fontFamily: 'monospace', fontWeight: 600 }}
            />
          </Form.Item>

          <Form.Item
            label="Description"
            name="description"
            rules={[{ required: true, message: 'Description is required' }, { max: 500 }]}
          >
            <Input placeholder="Enter description" />
          </Form.Item>

          {valueModalTab && isAccountSegment(valueModalTab) && (
            <Form.Item
              label="Account Type"
              name="accountType"
              rules={[{ required: true, message: 'Account type is required for Account segment' }]}
            >
              <Select placeholder="Select account type" options={ACCOUNT_TYPE_OPTIONS} />
            </Form.Item>
          )}

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Start Date" name="startDateActive">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="Start date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="End Date" name="endDateActive">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="End date (leave blank = no expiry)" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16} style={{ marginTop: 4 }}>
            <Col span={8}>
              <Form.Item label="Enabled" name="enabledFlag" valuePropName="checked">
                <Switch checkedChildren="Y" unCheckedChildren="N" defaultChecked />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Allow Posting" name="detailPostingAllowed" valuePropName="checked">
                <Switch checkedChildren="Y" unCheckedChildren="N" defaultChecked />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Allow Budgeting" name="detailBudgetingAllowed" valuePropName="checked">
                <Switch checkedChildren="Y" unCheckedChildren="N" defaultChecked />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <style>{`
        .compact-table .ant-table-tbody > tr > td { padding: 6px 8px !important; }
        .compact-table .ant-table-thead > tr > th { padding: 8px !important; background: ${REDWOOD.neutral100} !important; font-size: 11px !important; }
        .ant-tabs-content { height: 100%; }
        .ant-tabs-tabpane { height: 100%; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideOut { from { transform: translateX(0); } to { transform: translateX(100%); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes fadeInItem { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
    </Layout>
  );
};

export default COASegments;
