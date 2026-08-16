import React, { useState, useCallback, useMemo } from 'react';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tabs,
  Breadcrumb, Spin, message, Empty, Modal, Tag, Badge, Checkbox, Row, Col, Divider,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, DownloadOutlined,
  EyeOutlined, ApiOutlined, CopyOutlined, SyncOutlined, FilterOutlined, ShoppingOutlined,
  FileTextOutlined, MailOutlined, PrinterOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType, TableRowSelection, ColumnType } from 'antd/es/table/interface';
import * as XLSX from 'xlsx';
import { Workbook } from 'exceljs';
import FloatingMenu from '../../components/FloatingMenu';
import { getFusionAuthHeaders } from '../../config/api.helper';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:      '#C74634',
  primaryDark:  '#A33B2C',
  success:      '#1D7B4D',
  error:        '#F54545',
  warning:      '#B07700',
  info:         '#0572CE',
  neutral100:   '#F7F7F7',
  neutral200:   '#E5E5E5',
  surface:      '#FFFFFF',
  border:       '#E5E5E5',
};

const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/receivablesCustomerAccountSiteActivities` : '';
};

const CHILD_LABEL_MAP: Record<string, string> = {
  creditMemoApplications:           'CM Applications',
  creditMemos:                      'Credit Memos',
  standardReceiptApplications:      'Receipt Applications',
  standardReceipts:                 'Standard Receipts',
  transactionAdjustments:           'Adjustments',
  transactionPaymentSchedules:      'AR Invoices',
  transactionsPaidByOtherCustomers: 'Paid by Others',
};
const CHILD_NAMES = Object.keys(CHILD_LABEL_MAP);

// Aging bucket calculator
const getAgingBucket = (days: number | null | undefined): string => {
  if (days === null || days === undefined || days === '') return '-';
  const d = Number(days);
  if (d <= 30) return 'Current';
  if (d <= 60) return '31-60';
  if (d <= 90) return '61-90';
  return '90+';
};

type Row = Record<string, unknown>;

interface ChildState {
  loading: boolean;
  data: Row[];
  columns: ColumnsType<Row>;
}

interface ApiDebug { url: string; status: number | null; response: string; }

function formatVal(key: string, val: unknown): React.ReactNode {
  if (val === null || val === undefined || val === '') return '-';
  if (typeof val === 'number') {
    const k = key.toLowerCase();
    if (k.includes('amount') || k.includes('total') || k.includes('balance') || k.includes('receivable') || k.includes('due'))
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return val.toString();
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
  }
  return String(val);
}

function makeColWithFilter(key: string, title: string, extra?: Partial<ColumnType<Row>>): ColumnType<Row> {
  return {
    title,
    dataIndex: key,
    key,
    ellipsis: true,
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div style={{ padding: 6, minWidth: 200 }}>
        <Input
          placeholder={`Filter ${title}...`}
          value={selectedKeys[0] as string}
          onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => confirm()}
          style={{ marginBottom: 8, display: 'block' }}
          autoFocus
        />
        <Space>
          <Button type="primary" onClick={() => confirm()} size="small" icon={<SearchOutlined />} style={{ width: 90 }}>Filter</Button>
          <Button onClick={() => { clearFilters?.(); confirm(); }} size="small" style={{ width: 80 }}>Reset</Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => <FilterOutlined style={{ color: filtered ? '#1677ff' : undefined }} />,
    onFilter: (value, record) => {
      const v = record[key];
      if (v === null || v === undefined) return false;
      return String(v).toLowerCase().includes(String(value).toLowerCase());
    },
    render: (v: unknown) => formatVal(key, v),
    ...extra,
  };
}

function buildColumns(items: Row[], extraFirst?: { key: string; title: string }, filterNulls = false): ColumnsType<Row> {
  if (!items.length) return [];
  let keys = Object.keys(items[0]).filter(k => k !== 'links' && k !== '_customerName');

  // For Standard Receipts, filter out columns that are all null
  if (filterNulls) {
    keys = keys.filter(k => {
      // Keep column if at least one item has a non-null value
      return items.some(item => item[k] !== null && item[k] !== undefined);
    });
  }

  const cols: ColumnsType<Row> = keys.map(key => {
    const title = key.replace(/([A-Z])/g, ' $1').trim();
    const col = makeColWithFilter(key, title);
    // Assign default width based on content type
    if (key.includes('Id') || key.includes('ID')) {
      col.width = 100;
    } else if (key.includes('Date') || key.includes('Number')) {
      col.width = 120;
    } else if (key.includes('Amount') || key.includes('Balance') || key.includes('Total')) {
      col.width = 140;
    } else {
      col.width = 130;
    }
    return col;
  });
  if (extraFirst) {
    cols.unshift(makeColWithFilter(extraFirst.key, extraFirst.title, { width: 180, fixed: 'left' as const }));
  }
  return cols;
}

// Build columns for customer list (hide IDs, specific order)
function buildCustomerListColumns(): ColumnsType<Row> {
  const HIDDEN_KEYS = new Set(['BillToSiteUseId', 'AccountId', 'CustomerId', 'links']);
  const ORDERED_KEYS = [
    'AccountNumber', 'CustomerName', 'TotalOpenReceivablesForSite', 'TotalTransactionsDueForSite',
    'BillToSiteAddress', 'BillToSiteNumber', 'CreationDate'
  ];

  const cols: ColumnsType<Row> = [];

  ORDERED_KEYS.forEach(key => {
    let title = key
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace('For Site', '')
      .trim();

    cols.push({
      title,
      dataIndex: key,
      key,
      ellipsis: true,
      sorter: (a, b) => {
        const aVal = a[key];
        const bVal = b[key];
        if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
        return String(aVal || '').localeCompare(String(bVal || ''));
      },
      render: (v: unknown) => formatVal(key, v),
      width: key.includes('Address') ? 250 : key.includes('Total') ? 180 : 150,
    });
  });

  return cols;
}

function exportToExcel(data: Row[], filename: string) {
  const cleaned = data.map(row => {
    const r: Row = {};
    Object.keys(row).filter(k => k !== 'links').forEach(k => { r[k] = row[k]; });
    return r;
  });
  const ws = XLSX.utils.json_to_sheet(cleaned);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function SiteResultsTable({ data, columns, loading, currentPage = 1, hasMore = false, totalRecords = 0, onPageChange }: {
  data: Row[]; columns: ColumnsType<Row>; loading?: boolean; currentPage?: number; hasMore?: boolean; totalRecords?: number; onPageChange?: (page: number) => void;
}) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter.trim()) return data;
    const q = filter.toLowerCase();
    return data.filter(row => Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q)));
  }, [data, filter]);

  // Calculate totals (exclude ID and Date columns)
  const totals = useMemo(() => {
    const result: Record<string, number> = {};
    const idPatterns = ['Id', 'ID', 'Number', 'Date'];
    filtered.forEach(row => {
      Object.keys(row).forEach(k => {
        if (typeof row[k] === 'number' && !idPatterns.some(pattern => k.includes(pattern))) {
          result[k] = (result[k] || 0) + row[k];
        }
      });
    });
    return result;
  }, [filtered]);

  if (!data.length && !loading) return <Empty description="Enter search criteria and click Search" />;

  return (
    <div>
      {data.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input prefix={<SearchOutlined style={{ color: '#aaa' }} />} placeholder="Filter results..."
              value={filter} onChange={e => setFilter(e.target.value)}
              allowClear style={{ width: 280 }} size="small" />
            <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} / {data.length} rows</Text>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Page {currentPage}</Text>
            <Button size="small" onClick={() => onPageChange?.(currentPage - 1)} disabled={currentPage === 1}>Previous</Button>
            <Button size="small" onClick={() => onPageChange?.(currentPage + 1)} disabled={!hasMore}>Next</Button>
          </div>
        </div>
      )}
      <Table
        key={data.length}
        dataSource={filtered}
        columns={columns}
        rowKey={r => String(r['BillToSiteUseId'] ?? JSON.stringify(r))}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `Total ${t} records` }}
        footer={() =>
          Object.keys(totals).length > 0 ? (
            <div style={{
              display: 'flex',
              padding: '8px 0',
              fontWeight: 600,
              background: '#fafafa',
              borderTop: `1px solid ${REDWOOD.border}`,
              color: REDWOOD.primary,
            }}>
              {columns.map((col, idx) => {
                const dataIndex = col.dataIndex as string;
                const value = totals[dataIndex];
                const isFirstCol = idx === 0;
                const isNumericCol = value !== undefined;

                return (
                  <div
                    key={dataIndex}
                    style={{
                      flex: col.width ? `0 0 ${col.width}px` : 1,
                      padding: '8px 12px',
                      textAlign: isNumericCol ? 'right' : 'left',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {isFirstCol ? 'TOTAL' : (isNumericCol ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')}
                  </div>
                );
              })}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

function FilteredTable({ data, columns, loading, emptyText }: { data: Row[]; columns: ColumnsType<Row>; loading?: boolean; emptyText?: string }) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    if (!filter.trim()) return data;
    const q = filter.toLowerCase();
    return data.filter(row => Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q)));
  }, [data, filter]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>;
  if (!data.length) return <Empty description={emptyText || 'No data'} />;

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input prefix={<SearchOutlined style={{ color: '#aaa' }} />} placeholder="Filter rows..."
          value={filter} onChange={e => setFilter(e.target.value)} allowClear style={{ width: 280 }} size="small" />
        <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} / {data.length} rows</Text>
      </div>
      <Table dataSource={filtered} columns={columns} rowKey={(_r, i) => String(i)}
        size="small" scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `Total ${t} records` }} />
    </div>
  );
}

const CustomerSiteActivities: React.FC = () => {
  const [form] = Form.useForm();

  const [fusionData, setFusionData] = useState<Row[]>([]);
  const [fusionColumns, setFusionColumns] = useState<ColumnsType<Row>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFilters, setSearchFilters] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 50;

  const [detailsTabs, setDetailsTabs] = useState<Array<{ key: string; site: Row }>>([]);
  const [activeDetailTab, setActiveDetailTab] = useState<string>('');
  const [childStates, setChildStates] = useState<Record<string, Record<string, ChildState>>>({});
  const [detailApiDebug, setDetailApiDebug] = useState<Record<string, { urls: string[]; statuses: Record<string, number | null>; responses: Record<string, string> }>>({});
  const [detailApiDebugVisible, setDetailApiDebugVisible] = useState<string | null>(null);

  const [apiDebug, setApiDebug] = useState<ApiDebug | null>(null);
  const [apiDebugVisible, setApiDebugVisible] = useState(false);
  const [recordsWithBalances, setRecordsWithBalances] = useState(true);
  const [receivablesOverviewVisible, setReceivablesOverviewVisible] = useState(false);
  const [overviewCustomerKey, setOverviewCustomerKey] = useState<string | null>(null);
  const [overviewData, setOverviewData] = useState<any>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewProgress, setOverviewProgress] = useState('');
  const [shouldCancelOverview, setShouldCancelOverview] = useState(false);

  // AR Invoices filter state
  const [arInvoicesFilters, setArInvoicesFilters] = useState<Record<string, 'Open' | 'Closed' | 'ALL'>>({});
  const [arInvoicesLoadingStatus, setArInvoicesLoadingStatus] = useState<Record<string, { loading: boolean; progress: string; shouldCancel: boolean }>>({});
  const arInvoicesCancelRef = React.useRef<Record<string, boolean>>({});

  // Credit Memos filter state
  const [creditMemosFilters, setCreditMemosFilters] = useState<Record<string, 'Open' | 'Closed' | 'ALL'>>({});
  const [creditMemosLoadingStatus, setCreditMemosLoadingStatus] = useState<Record<string, { loading: boolean; progress: string; shouldCancel: boolean }>>({});
  const creditMemosCancelRef = React.useRef<Record<string, boolean>>({});

  // Account Statement modal state
  const [accountStatementVisible, setAccountStatementVisible] = useState(false);
  const [accountStatementData, setAccountStatementData] = useState<any>(null);
  const [selectedCustomerForStatement, setSelectedCustomerForStatement] = useState<any>(null);

  // Child tab API debugging
  const [childApiDebugVisible, setChildApiDebugVisible] = useState<{ tabKey: string; childName: string } | null>(null);

  // Column filters for each tab
  const [columnFilters, setColumnFilters] = useState<Record<string, Record<string, string>>>({});

  // ── Load page data ──────────────────────────────────────────────
  const loadPage = useCallback(async (pageNum: number, overrideFilters?: Record<string, string>) => {
    const offset = (pageNum - 1) * PAGE_SIZE;
    const currentFilters = overrideFilters || searchFilters;
    const filters: string[] = [];
    if (currentFilters.CustomerName) filters.push(`CustomerName LIKE '${currentFilters.CustomerName}%'`);
    if (currentFilters.AccountNumber) filters.push(`AccountNumber LIKE '${currentFilters.AccountNumber}%'`);
    if (currentFilters.BillToSiteNumber) filters.push(`BillToSiteNumber LIKE '${currentFilters.BillToSiteNumber}%'`);

    const fusionBase = getFusionBase();
    const url = `${fusionBase}?onlyData=true&limit=${PAGE_SIZE}${filters.length ? `&q=${encodeURIComponent(filters.join(' AND '))}` : ''}&offset=${offset}`;

    setApiDebug({ url, status: null, response: '' });
    setSearchLoading(true);
    try {
      const res = await fetch(url, { headers: getFusionAuthHeaders() });
      const text = await res.text();
      let json: { items?: Row[]; hasMore?: boolean };
      try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON (HTTP ${res.status}): ${text.substring(0, 300)}`); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setApiDebug({ url, status: res.status, response: JSON.stringify(json, null, 2) });

      const items = (json.items || []).map(item => {
        const r: Row = {};
        Object.keys(item).filter(k => k !== 'links').forEach(k => { r[k] = item[k]; });
        return r;
      });

      // Filter by balance if checkbox is checked
      let filteredItems = items;
      if (recordsWithBalances) {
        filteredItems = items.filter(item => {
          const balance = item['TotalOpenReceivablesForSite'];
          return balance !== null && balance !== undefined && balance !== 0;
        });
      }

      setFusionData(filteredItems);
      setCurrentPage(pageNum);
      setHasMore(!!json.hasMore && items.length === PAGE_SIZE);
      setTotalRecords(offset + filteredItems.length + (json.hasMore ? PAGE_SIZE : 0));

      // Build columns with Details action
      const cols = buildCustomerListColumns();
      cols.unshift({
        title: 'Action',
        key: 'action',
        fixed: 'left',
        width: 90,
        render: (_: unknown, record: Row) => (
          <Button
            type="primary"
            size="small"
            onClick={() => openDetailsTab(record)}
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
          >
            Details
          </Button>
        ),
      });
      setFusionColumns(cols);
      if (!items.length) message.info('No results found');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiDebug(prev => prev ? { ...prev, status: -1, response: msg } : null);
      message.error(`Search failed: ${msg}`);
    } finally {
      setSearchLoading(false);
    }
  }, [searchFilters, recordsWithBalances]);

  // ── Search Fusion ────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const values = form.getFieldsValue();
    const newFilters = {
      CustomerName: values.CustomerName || '',
      AccountNumber: values.AccountNumber || '',
      BillToSiteNumber: values.BillToSiteNumber || '',
    };
    setSearchFilters(newFilters);
    setCurrentPage(1);
    setTotalRecords(0);
    setHasMore(false);

    // Load first page with new filters - pass filters directly to avoid async state issue
    await loadPage(1, newFilters);
  }, [form, loadPage]);

  // ── Open details tab for a specific site ──────────────────────
  const openDetailsTab = useCallback(async (site: Row) => {
    const siteId = site['BillToSiteUseId'];
    const tabKey = `detail-${siteId}`;

    // Check if tab already exists
    if (detailsTabs.find(t => t.key === tabKey)) {
      setActiveDetailTab(tabKey);
      return;
    }

    // Create new tab
    setDetailsTabs(prev => [...prev, { key: tabKey, site }]);
    setActiveDetailTab(tabKey);

    // Load activities for this site
    const initStates: Record<string, ChildState> = {};
    CHILD_NAMES.forEach(cn => { initStates[cn] = { loading: true, data: [], columns: [] }; });
    setChildStates(prev => ({ ...prev, [tabKey]: initStates }));

    // Initialize API debug info
    const apiDebugUrls: string[] = [];
    const apiDebugStatuses: Record<string, number | null> = {};
    const apiDebugResponses: Record<string, string> = {};

    const allResults: Record<string, Row[]> = {};
    CHILD_NAMES.forEach(cn => { allResults[cn] = []; });

    const fusionBase = getFusionBase();
    const customerAccountNumber = site['AccountNumber'] || site['CustomerAccountNumber'];

    await Promise.all(
      CHILD_NAMES.map(async childName => {
        try {
          const LIMIT = childName === 'standardReceipts' ? 200 : 500;
          let offset = 0;
          let hasMore = true;
          const allItems: Row[] = [];
          let lastStatus = 0;
          let lastJson: unknown = null;

          while (hasMore) {
            // For Standard Receipts, use CustomerAccountNumber filter
            let url: string;
            if (childName === 'standardReceipts') {
              const company = getCurrentCompany();
              const baseUrl = company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/standardReceipts` : '';
              url = `${baseUrl}?limit=${LIMIT}&offset=${offset}&q=CustomerAccountNumber=${customerAccountNumber}`;
            } else {
              // For AR Invoices and Credit Memos, apply Open filter by default
              let statusFilter = '';
              if (childName === 'transactionPaymentSchedules') {
                statusFilter = `&q=InstallmentStatus='Open'`;
              } else if (childName === 'creditMemos') {
                statusFilter = `&q=CreditMemoStatus='Open'`;
              }
              url = `${fusionBase}/${siteId}/child/${childName}?limit=${LIMIT}&offset=${offset}${statusFilter}`;
            }
            apiDebugUrls.push(url);

            const res = await fetch(url, { headers: getFusionAuthHeaders() });
            lastStatus = res.status;

            if (!res.ok) {
              apiDebugStatuses[childName] = res.status;
              const text = await res.text();
              apiDebugResponses[childName] = `HTTP ${res.status}: ${text.substring(0, 200)}`;
              break;
            }

            const json = await res.json();
            lastJson = json;
            apiDebugStatuses[childName] = res.status;

            const page: Row[] = (json.items || []).map((item: Row) => {
              const r: Row = {};
              Object.keys(item).filter(k => k !== 'links').forEach(k => { r[k] = item[k]; });
              return r;
            });
            allItems.push(...page);
            hasMore = !!json.hasMore && page.length === LIMIT;
            offset += LIMIT;
          }

          if (lastJson) {
            apiDebugResponses[childName] = JSON.stringify({ status: lastStatus, itemsCount: allItems.length, sample: allItems[0] || null }, null, 2);
          }
          allResults[childName].push(...allItems);
        } catch (e) {
          apiDebugStatuses[childName] = -1;
          apiDebugResponses[childName] = String(e);
        }
      })
    );

    const finalStates: Record<string, ChildState> = {};
    CHILD_NAMES.forEach(cn => {
      const data = allResults[cn];
      // Filter null columns for Standard Receipts
      const filterNulls = cn === 'standardReceipts';
      finalStates[cn] = { loading: false, data, columns: buildColumns(data, undefined, filterNulls) };
    });
    setChildStates(prev => ({ ...prev, [tabKey]: finalStates }));

    // Set default filter statuses
    setArInvoicesFilters(prev => ({ ...prev, [tabKey]: 'Open' }));
    setCreditMemosFilters(prev => ({ ...prev, [tabKey]: 'Open' }));

    // Store API debug info
    setDetailApiDebug(prev => ({
      ...prev,
      [tabKey]: { urls: apiDebugUrls, statuses: apiDebugStatuses, responses: apiDebugResponses }
    }));
  }, [detailsTabs]);

  const closeDetailsTab = (tabKey: string) => {
    setDetailsTabs(prev => prev.filter(t => t.key !== tabKey));
    setChildStates(prev => {
      const updated = { ...prev };
      delete updated[tabKey];
      return updated;
    });
    if (activeDetailTab === tabKey) {
      setActiveDetailTab(detailsTabs[0]?.key || 'sites');
    }
  };

  // Reload AR Invoices with status filter
  const reloadArInvoices = useCallback(async (tabKey: string, status: 'Open' | 'Closed' | 'ALL') => {
    const site = detailsTabs.find(t => t.key === tabKey)?.site;
    if (!site) return;

    const siteId = site['BillToSiteUseId'];
    setArInvoicesLoadingStatus(prev => ({ ...prev, [tabKey]: { loading: true, progress: 'Loading AR Invoices...', shouldCancel: false } }));
    arInvoicesCancelRef.current[tabKey] = false;

    try {
      const LIMIT = 500;
      let offset = 0;
      let hasMore = true;
      const allItems: Row[] = [];

      while (hasMore && !arInvoicesCancelRef.current[tabKey]) {
        setArInvoicesLoadingStatus(prev => ({
          ...prev,
          [tabKey]: { ...prev[tabKey], progress: `Loading AR Invoices (${allItems.length} records)...` }
        }));

        const fusionBase = getFusionBase();
        const statusFilter = status === 'ALL' ? '' : `&q=InstallmentStatus='${status}'`;
        const url = `${fusionBase}/${siteId}/child/transactionPaymentSchedules?limit=${LIMIT}&offset=${offset}${statusFilter}`;

        const res = await fetch(url, { headers: getFusionAuthHeaders() });
        if (!res.ok) break;

        const json = await res.json();
        const page: Row[] = (json.items || []).map((item: Row) => {
          const r: Row = {};
          Object.keys(item).filter(k => k !== 'links').forEach(k => { r[k] = item[k]; });
          return r;
        });

        allItems.push(...page);
        hasMore = !!json.hasMore && page.length === LIMIT;
        offset += LIMIT;
      }

      // Only update if not cancelled
      if (!arInvoicesCancelRef.current[tabKey]) {
        // Update child state with new data
        setChildStates(prev => {
          const updated = { ...prev, [tabKey]: { ...prev[tabKey] } };
          updated[tabKey].transactionPaymentSchedules = {
            loading: false,
            data: allItems,
            columns: buildColumns(allItems),
          };
          return updated;
        });

        setArInvoicesFilters(prev => ({ ...prev, [tabKey]: status }));
      }
    } finally {
      if (!arInvoicesCancelRef.current[tabKey]) {
        setArInvoicesLoadingStatus(prev => ({ ...prev, [tabKey]: { loading: false, progress: '', shouldCancel: false } }));
      } else {
        setArInvoicesLoadingStatus(prev => ({ ...prev, [tabKey]: { loading: false, progress: 'Cancelled', shouldCancel: false } }));
      }
    }
  }, [detailsTabs]);

  // Reload Credit Memos with status filter
  const reloadCreditMemos = useCallback(async (tabKey: string, status: 'Open' | 'Closed' | 'ALL') => {
    const site = detailsTabs.find(t => t.key === tabKey)?.site;
    if (!site) return;

    const siteId = site['BillToSiteUseId'];
    setCreditMemosLoadingStatus(prev => ({ ...prev, [tabKey]: { loading: true, progress: 'Loading Credit Memos...', shouldCancel: false } }));
    creditMemosCancelRef.current[tabKey] = false;

    try {
      const LIMIT = 500;
      let offset = 0;
      let hasMore = true;
      const allItems: Row[] = [];

      while (hasMore && !creditMemosCancelRef.current[tabKey]) {
        setCreditMemosLoadingStatus(prev => ({
          ...prev,
          [tabKey]: { ...prev[tabKey], progress: `Loading Credit Memos (${allItems.length} records)...` }
        }));

        const fusionBase = getFusionBase();
        const statusFilter = status === 'ALL' ? '' : `&q=CreditMemoStatus='${status}'`;
        const url = `${fusionBase}/${siteId}/child/creditMemos?limit=${LIMIT}&offset=${offset}${statusFilter}`;

        const res = await fetch(url, { headers: getFusionAuthHeaders() });
        if (!res.ok) break;

        const json = await res.json();
        const page: Row[] = (json.items || []).map((item: Row) => {
          const r: Row = {};
          Object.keys(item).filter(k => k !== 'links').forEach(k => { r[k] = item[k]; });
          return r;
        });

        allItems.push(...page);
        hasMore = !!json.hasMore && page.length === LIMIT;
        offset += LIMIT;
      }

      // Only update if not cancelled
      if (!creditMemosCancelRef.current[tabKey]) {
        // Update child state with new data
        setChildStates(prev => {
          const updated = { ...prev, [tabKey]: { ...prev[tabKey] } };
          updated[tabKey].creditMemos = {
            loading: false,
            data: allItems,
            columns: buildColumns(allItems),
          };
          return updated;
        });

        setCreditMemosFilters(prev => ({ ...prev, [tabKey]: status }));
      }
    } finally {
      if (!creditMemosCancelRef.current[tabKey]) {
        setCreditMemosLoadingStatus(prev => ({ ...prev, [tabKey]: { loading: false, progress: '', shouldCancel: false } }));
      } else {
        setCreditMemosLoadingStatus(prev => ({ ...prev, [tabKey]: { loading: false, progress: 'Cancelled', shouldCancel: false } }));
      }
    }
  }, [detailsTabs]);

  // Compute overview data with progress tracking
  React.useEffect(() => {
    if (!receivablesOverviewVisible || !overviewCustomerKey) return;

    const computeAsync = async () => {
      setShouldCancelOverview(false);
      setOverviewLoading(true);
      setOverviewProgress('Initializing data...');

      await new Promise(resolve => setTimeout(resolve, 100));
      if (shouldCancelOverview) {
        setOverviewLoading(false);
        return;
      }

      try {
        setOverviewProgress('Computing balance positions...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (shouldCancelOverview) return;

        setOverviewProgress('Analyzing aging buckets...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (shouldCancelOverview) return;

        setOverviewProgress('Calculating year-by-year metrics...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (shouldCancelOverview) return;

        setOverviewProgress('Aggregating monthly activity...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (shouldCancelOverview) return;

        setOverviewProgress('Analyzing payment behavior...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (shouldCancelOverview) return;

        setOverviewProgress('Computing key insights...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (shouldCancelOverview) return;

        const data = computeOverviewDataSync(overviewCustomerKey);
        if (!shouldCancelOverview) {
          setOverviewData(data);
          setOverviewProgress('');
        }
      } finally {
        setOverviewLoading(false);
      }
    };

    computeAsync();
  }, [receivablesOverviewVisible, overviewCustomerKey]);

  // ── Receivables Overview Calculations ──────────────────────────
  const computeOverviewDataSync = (customerKey?: string | null) => {
    const key = customerKey || overviewCustomerKey;
    if (!key) return null;

    const allArInvoices = childStates[key]?.transactionPaymentSchedules?.data || [];
    const allCreditMemos = childStates[key]?.creditMemos?.data || [];
    const allAdjustments = childStates[key]?.transactionAdjustments?.data || [];

    const openInvoices = allArInvoices.filter(row => row['InstallmentStatus'] === 'Open');
    const openBalance = openInvoices.reduce((sum, row) => sum + (Number(row['TotalBalanceAmount']) || 0), 0);
    const openInvoiceCount = openInvoices.length;

    const openCredits = allCreditMemos.filter(row => row['CreditMemoStatus'] === 'Open');
    const openCreditBalance = openCredits.reduce((sum, row) => sum + (Number(row['TotalBalanceAmount']) || 0), 0);
    const openCreditCount = openCredits.length;

    const netOpen = openBalance + openCreditBalance;
    const pastDueInvoices = openInvoices.filter(row => {
      const daysLate = Number(row['PaymentDaysLate']) || 0;
      return daysLate > 0;
    });
    const pastDueBalance = pastDueInvoices.reduce((sum, row) => sum + (Number(row['TotalBalanceAmount']) || 0), 0);

    // Ageing buckets
    const ageingBuckets = {
      'Not yet due': { amount: 0, count: 0 },
      '1-30 days': { amount: 0, count: 0 },
      '31-60 days': { amount: 0, count: 0 },
      '61-90 days': { amount: 0, count: 0 },
      '91-180 days': { amount: 0, count: 0 },
      '180+ days': { amount: 0, count: 0 },
    };

    openInvoices.forEach(row => {
      const daysLate = Number(row['PaymentDaysLate']) || 0;
      const balance = Number(row['TotalBalanceAmount']) || 0;
      let bucket = 'Not yet due';
      if (daysLate > 180) bucket = '180+ days';
      else if (daysLate > 90) bucket = '91-180 days';
      else if (daysLate > 60) bucket = '61-90 days';
      else if (daysLate > 30) bucket = '31-60 days';
      else if (daysLate > 0) bucket = '1-30 days';

      ageingBuckets[bucket as keyof typeof ageingBuckets].amount += balance;
      ageingBuckets[bucket as keyof typeof ageingBuckets].count += 1;
    });

    // Year-by-year analysis
    const yearData: Record<number, { invoices: number; grossAmount: number; creditCount: number; creditAmount: number; adjustments: number }> = {};

    allArInvoices.forEach(row => {
      const dateStr = row['TransactionDate'] as string;
      if (!dateStr) return;
      const year = parseInt(dateStr.substring(0, 4));
      if (!yearData[year]) yearData[year] = { invoices: 0, grossAmount: 0, creditCount: 0, creditAmount: 0, adjustments: 0 };
      yearData[year].invoices += 1;
      yearData[year].grossAmount += Number(row['TotalOriginalAmount']) || 0;
    });

    allCreditMemos.forEach(row => {
      const dateStr = row['CreditMemoDate'] as string;
      if (!dateStr) return;
      const year = parseInt(dateStr.substring(0, 4));
      if (!yearData[year]) yearData[year] = { invoices: 0, grossAmount: 0, creditCount: 0, creditAmount: 0, adjustments: 0 };
      yearData[year].creditCount += 1;
      yearData[year].creditAmount += Number(row['TotalOriginalAmount']) || 0;
    });

    // KEY PERFORMANCE INDICATORS
    const totalInvoiced = allArInvoices.reduce((sum, row) => sum + (Number(row['TotalOriginalAmount']) || 0), 0);
    const totalCredits = allCreditMemos.reduce((sum, row) => sum + Math.abs(Number(row['TotalOriginalAmount']) || 0), 0);
    const closedInvoices = allArInvoices.filter(row => row['InstallmentStatus'] === 'Closed').length;
    const totalInvoiceCount = allArInvoices.filter(row => new Set([...new Map(allArInvoices.map(r => [r['InstallmentId'] + '-' + r['InstallmentNumber'], r])).values()]).has(row)).length;
    const paymentRate = totalInvoiceCount > 0 ? closedInvoices / totalInvoiceCount : 0;

    // OPEN ITEMS DETAIL - sorted by due date
    const openItems = allArInvoices.filter(row => row['InstallmentStatus'] === 'Open')
      .sort((a, b) => {
        const dateA = new Date(a['PaymentScheduleDueDate'] as string).getTime();
        const dateB = new Date(b['PaymentScheduleDueDate'] as string).getTime();
        return dateA - dateB;
      });

    // MONTHLY ACTIVITY
    const monthlyData: Record<string, { invoices: number; amount: number; credits: number; creditAmount: number }> = {};
    allArInvoices.forEach(row => {
      const dateStr = row['TransactionDate'] as string;
      if (!dateStr) return;
      const monthKey = dateStr.substring(0, 7); // YYYY-MM
      if (!monthlyData[monthKey]) monthlyData[monthKey] = { invoices: 0, amount: 0, credits: 0, creditAmount: 0 };
      monthlyData[monthKey].invoices += 1;
      monthlyData[monthKey].amount += Number(row['TotalOriginalAmount']) || 0;
    });
    allCreditMemos.forEach(row => {
      const dateStr = row['CreditMemoDate'] as string;
      if (!dateStr) return;
      const monthKey = dateStr.substring(0, 7);
      if (!monthlyData[monthKey]) monthlyData[monthKey] = { invoices: 0, amount: 0, credits: 0, creditAmount: 0 };
      monthlyData[monthKey].credits += 1;
      monthlyData[monthKey].creditAmount += Math.abs(Number(row['TotalOriginalAmount']) || 0);
    });

    // CREDIT TERMS MIX - days between invoice and due date
    const creditTermsBuckets: Record<string, number> = { 'Same day': 0, '1-15 days': 0, '16-30 days': 0, '31-60 days': 0, '60+ days': 0 };
    allArInvoices.forEach(row => {
      const invDate = new Date(row['TransactionDate'] as string);
      const dueDate = new Date(row['PaymentScheduleDueDate'] as string);
      const daysDiff = Math.ceil((dueDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 0) creditTermsBuckets['Same day']++;
      else if (daysDiff <= 15) creditTermsBuckets['1-15 days']++;
      else if (daysDiff <= 30) creditTermsBuckets['16-30 days']++;
      else if (daysDiff <= 60) creditTermsBuckets['31-60 days']++;
      else creditTermsBuckets['60+ days']++;
    });

    // BASKET SIZE - invoice value distribution
    const basketBuckets: Record<string, number> = { '<10k': 0, '10k-50k': 0, '50k-100k': 0, '100k-500k': 0, '500k+': 0 };
    allArInvoices.forEach(row => {
      const amount = Number(row['TotalOriginalAmount']) || 0;
      if (amount < 10000) basketBuckets['<10k']++;
      else if (amount < 50000) basketBuckets['10k-50k']++;
      else if (amount < 100000) basketBuckets['50k-100k']++;
      else if (amount < 500000) basketBuckets['100k-500k']++;
      else basketBuckets['500k+']++;
    });

    // PAYMENT BEHAVIOUR - settlement patterns
    const settledInvoices = allArInvoices.filter(row => row['InstallmentStatus'] === 'Closed');
    const settlementDays: number[] = [];
    settledInvoices.forEach(row => {
      const dueDate = new Date(row['PaymentScheduleDueDate'] as string);
      const updateDate = new Date(row['LastUpdateDate'] as string);
      const daysDiff = Math.ceil((updateDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      settlementDays.push(daysDiff);
    });
    const avgSettlementDays = settlementDays.length > 0 ? Math.round(settlementDays.reduce((a, b) => a + b, 0) / settlementDays.length) : 0;
    const onTimePayments = settlementDays.filter(d => d <= 0).length;
    const onTimeRate = settlementDays.length > 0 ? (onTimePayments / settlementDays.length) * 100 : 0;

    // RETURNS & CREDIT MEMO ANALYSIS
    const returnsRatio = totalInvoiced > 0 ? (totalCredits / totalInvoiced) * 100 : 0;
    const avgCreditMemo = allCreditMemos.length > 0 ? totalCredits / allCreditMemos.length : 0;

    return {
      openBalance, openInvoiceCount, openCreditBalance, openCreditCount, netOpen, pastDueBalance, ageingBuckets, yearData,
      totalInvoiced, totalCredits, closedInvoices, paymentRate, openItems,
      monthlyData, creditTermsBuckets, basketBuckets, avgSettlementDays, onTimeRate,
      returnsRatio, avgCreditMemo, settledInvoices
    };
  };

  // ── Handle Account Statement ────────────────────────────────────────
  const handleShowAccountStatement = useCallback((customerKey: string) => {
    const customerSite = detailsTabs.find(t => t.key === customerKey)?.site;
    if (!customerSite) return;

    setSelectedCustomerForStatement({
      name: customerSite['CustomerName'],
      accountNumber: customerSite['AccountNumber'],
      billToSiteNumber: customerSite['BillToSiteNumber'],
    });

    // Get data from childStates for this customer
    const childData = childStates[customerKey];
    const arInvoices = childData?.transactionPaymentSchedules?.data || [];
    const creditMemos = childData?.creditMemos?.data || [];
    const receipts = childData?.standardReceipts?.data || [];
    const adjustments = childData?.transactionAdjustments?.data || [];

    // Calculate totals
    const invoiceTotal = arInvoices.reduce((sum: number, row: any) => sum + (Number(row['TotalBalanceAmount']) || 0), 0);
    const paymentTotal = receipts.reduce((sum: number, row: any) => sum + (Number(row['ReceiptAmount']) || Number(row['ApplicationAmount']) || 0), 0);
    const creditMemoTotal = creditMemos.reduce((sum: number, row: any) => sum + Math.abs(Number(row['TotalBalanceAmount']) || 0), 0);
    const adjustmentTotal = adjustments.reduce((sum: number, row: any) => sum + (Number(row['AdjustmentAmount']) || 0), 0);

    const balance = invoiceTotal - paymentTotal - creditMemoTotal + adjustmentTotal;

    setAccountStatementData({
      statementDate: new Date().toISOString().split('T')[0],
      invoiceCount: arInvoices.length,
      invoiceTotal,
      paymentCount: receipts.length,
      paymentTotal,
      creditMemoCount: creditMemos.length,
      creditMemoTotal,
      adjustmentCount: adjustments.length,
      adjustmentTotal,
      balance,
    });

    setAccountStatementVisible(true);
  }, [detailsTabs, childStates]);

  // ── Generate PDF for Account Statement ──────────────────────────────
  const generateAccountStatementPDF = useCallback(() => {
    if (!accountStatementData || !selectedCustomerForStatement) return;

    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
          .header { text-align: center; margin-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; color: #C74634; margin-bottom: 10px; }
          .divider { border-top: 2px solid #C74634; margin: 15px 0; }
          .section-title { font-size: 14px; font-weight: bold; background: #F7F7F7; padding: 8px; margin-top: 15px; }
          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #E5E5E5; }
          .label { font-weight: bold; width: 40%; }
          .value { text-align: right; width: 60%; }
          .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px; }
          .summary-box { padding: 12px; background: #FAFAFA; border-left: 3px solid #C74634; }
          .summary-label { font-size: 12px; color: #666; }
          .summary-value { font-size: 18px; font-weight: bold; color: #1A1A1A; }
          .summary-amount { font-size: 12px; color: #666; margin-top: 4px; }
          .balance-section { margin-top: 15px; padding: 12px; background: #fff; border: 1px solid #E5E5E5; }
          .balance-row { display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; }
          .footer { margin-top: 30px; font-size: 11px; color: #999; text-align: center; border-top: 1px solid #E5E5E5; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">ACCOUNT STATEMENT</div>
        </div>

        <div class="divider"></div>

        <div>
          <div class="info-row">
            <div class="label">Customer Name:</div>
            <div class="value">${selectedCustomerForStatement.name}</div>
          </div>
          <div class="info-row">
            <div class="label">Account Number:</div>
            <div class="value">${selectedCustomerForStatement.accountNumber}</div>
          </div>
          <div class="info-row">
            <div class="label">Statement Date:</div>
            <div class="value">${new Date(accountStatementData.statementDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' })}</div>
          </div>
        </div>

        <div class="section-title">ACCOUNT SUMMARY</div>

        <div class="summary-grid">
          <div class="summary-box">
            <div class="summary-label">Total Invoices</div>
            <div class="summary-value">${accountStatementData.invoiceCount}</div>
            <div class="summary-amount">Amount: ${formatVal('amount', accountStatementData.invoiceTotal)}</div>
          </div>
          <div class="summary-box">
            <div class="summary-label">Total Payments</div>
            <div class="summary-value" style="color: #1D7B4D;">${accountStatementData.paymentCount}</div>
            <div class="summary-amount">Amount: ${formatVal('amount', accountStatementData.paymentTotal)}</div>
          </div>
          <div class="summary-box">
            <div class="summary-label">Credit Memos</div>
            <div class="summary-value">${accountStatementData.creditMemoCount}</div>
            <div class="summary-amount">Amount: ${formatVal('amount', accountStatementData.creditMemoTotal)}</div>
          </div>
          <div class="summary-box">
            <div class="summary-label">Adjustments</div>
            <div class="summary-value">${accountStatementData.adjustmentCount}</div>
            <div class="summary-amount">Amount: ${formatVal('amount', accountStatementData.adjustmentTotal)}</div>
          </div>
        </div>

        <div class="balance-section">
          <div class="balance-row" style="color: ${(accountStatementData.balance as number) > 0 ? '#F54545' : '#1D7B4D'};">
            <div>Open Receivables:</div>
            <div>${formatVal('amount', accountStatementData.balance)}</div>
          </div>
        </div>

        <div class="footer">
          <p>This statement reflects all recorded transactions as of the statement date.<br>
          Generated on ${new Date().toLocaleString()}</p>
        </div>
      </body>
      </html>
    `;

    // Convert HTML to PDF by opening in new window for printing
    const printWindow = window.open('', '', 'width=900,height=700');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
        printWindow.close();
      };
    }

    message.success('Opening print dialog for PDF...');
  }, [accountStatementData, selectedCustomerForStatement]);

  // ── Send Account Statement by Email ───────────────────────────────
  const sendAccountStatementByEmail = useCallback(() => {
    if (!selectedCustomerForStatement || !accountStatementData) return;

    const emailSubject = `Account Statement - ${selectedCustomerForStatement.accountNumber}`;
    const emailBody = `
Customer: ${selectedCustomerForStatement.name}
Account Number: ${selectedCustomerForStatement.accountNumber}
Statement Date: ${new Date(accountStatementData.statementDate).toLocaleDateString()}

SUMMARY:
Invoices: ${formatVal('amount', accountStatementData.invoiceTotal)}
Payments: -${formatVal('amount', accountStatementData.paymentTotal)}
Credit Memos: -${formatVal('amount', accountStatementData.creditMemoTotal)}
Adjustments: ${formatVal('amount', accountStatementData.adjustmentTotal)}

Balance Due: ${formatVal('amount', accountStatementData.balance)}
    `;

    const mailtoLink = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoLink;
    message.info('Opening default email client...');
  }, [selectedCustomerForStatement, accountStatementData]);

  const exportOverviewToExcel = async () => {
    if (!overviewData || !overviewCustomerKey) return;
    const overview = overviewData;
    const customerSite = detailsTabs.find(t => t.key === overviewCustomerKey)?.site;
    const customerName = customerSite?.CustomerName || 'Unknown';

    const wb = new Workbook();

    // Define styles
    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E78' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const sectionFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E78' } };
    const sectionFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const tableHeaderFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } };
    const tableHeaderFont = { bold: true, size: 11 };
    const totalFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFFE0' } };
    const totalFont = { bold: true, size: 11 };
    const titleFont = { bold: true, size: 14, color: { argb: 'FF1F4E78' } };
    const subtitleFont = { italic: true, size: 10 };
    const thinBorder = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const }
    };

    // ────── OVERVIEW SHEET ──────
    const ws = wb.addWorksheet('Overview');
    let row = 1;

    // Title
    ws.getCell(row, 1).value = `${customerName} — RECEIVABLES OVERVIEW`;
    ws.getCell(row, 1).font = titleFont as any;
    ws.mergeCells(row, 1, row, 4);
    row += 2;

    // Report date info
    ws.getCell(row, 1).value = 'Report as of';
    ws.getCell(row, 2).value = new Date();
    ws.getCell(row, 2).numFmt = 'dd-mmm-yyyy';
    ws.getCell(row, 4).value = 'Data window';
    ws.getCell(row, 5).value = '01-Jan-2019 to 14-Aug-2026';
    row += 2;

    // 1 · CURRENT BALANCE POSITION
    ws.getCell(row, 1).value = '1 · CURRENT BALANCE POSITION';
    ws.getCell(row, 1).fill = headerFill as any;
    ws.getCell(row, 1).font = sectionFont as any;
    ws.mergeCells(row, 1, row, 4);
    row += 1;

    // Table headers
    const headers1 = ['Item', 'Amount (MUR)', 'Items', 'Comment'];
    headers1.forEach((h, i) => {
      ws.getCell(row, i + 1).value = h;
      ws.getCell(row, i + 1).fill = tableHeaderFill as any;
      ws.getCell(row, i + 1).font = tableHeaderFont as any;
      ws.getCell(row, i + 1).border = thinBorder;
    });
    row += 1;

    // Data rows
    ws.getCell(row, 1).value = 'Open invoice balance (as exported)';
    ws.getCell(row, 2).value = overview.openBalance;
    ws.getCell(row, 2).numFmt = '#,##0.00';
    ws.getCell(row, 3).value = overview.openInvoiceCount;
    ws.getCell(row, 4).value = 'Raw sum of open installments';
    ws.getCell(row, 4).font = subtitleFont as any;
    row += 1;

    ws.getCell(row, 1).value = 'Unapplied credit memos (on account)';
    ws.getCell(row, 2).value = overview.openCreditBalance;
    ws.getCell(row, 2).numFmt = '#,##0.00';
    ws.getCell(row, 3).value = overview.openCreditCount;
    ws.getCell(row, 4).value = 'Credit available to offset';
    ws.getCell(row, 4).font = subtitleFont as any;
    row += 1;

    // Total row
    ws.getCell(row, 1).value = 'NET OPEN RECEIVABLES';
    ws.getCell(row, 1).fill = totalFill as any;
    ws.getCell(row, 1).font = totalFont as any;
    ws.getCell(row, 2).value = overview.netOpen;
    ws.getCell(row, 2).numFmt = '#,##0.00';
    ws.getCell(row, 2).fill = totalFill as any;
    ws.getCell(row, 2).font = totalFont as any;
    ws.getCell(row, 3).value = overview.openInvoiceCount + overview.openCreditCount;
    ws.getCell(row, 3).fill = totalFill as any;
    ws.getCell(row, 3).font = totalFont as any;
    row += 1;

    ws.getCell(row, 1).value = '— of which past due';
    ws.getCell(row, 2).value = overview.pastDueBalance;
    ws.getCell(row, 2).numFmt = '#,##0.00';
    ws.getCell(row, 2).font = { ...totalFont, color: { argb: 'FFFF0000' } } as any;
    row += 2;

    // 2 · AGEING OF OPEN RECEIVABLES
    ws.getCell(row, 1).value = '2 · AGEING OF OPEN RECEIVABLES (by payment-schedule due date)';
    ws.getCell(row, 1).fill = headerFill as any;
    ws.getCell(row, 1).font = sectionFont as any;
    ws.mergeCells(row, 1, row, 4);
    row += 1;

    // Headers
    const headers2 = ['Ageing bucket', 'Amount (MUR)', '% of open', 'Invoices'];
    headers2.forEach((h, i) => {
      ws.getCell(row, i + 1).value = h;
      ws.getCell(row, i + 1).fill = tableHeaderFill as any;
      ws.getCell(row, i + 1).font = tableHeaderFont as any;
    });
    row += 1;

    // Ageing data
    Object.entries(overview.ageingBuckets).forEach(([bucket, data]) => {
      ws.getCell(row, 1).value = bucket;
      ws.getCell(row, 2).value = data.amount;
      ws.getCell(row, 2).numFmt = '#,##0.00';
      const pct = overview.openBalance > 0 ? (data.amount / overview.openBalance) : 0;
      ws.getCell(row, 3).value = pct;
      ws.getCell(row, 3).numFmt = '0.0%';
      ws.getCell(row, 4).value = data.count;
      row += 1;
    });

    // Total
    ws.getCell(row, 1).value = 'Total';
    ws.getCell(row, 1).fill = totalFill as any;
    ws.getCell(row, 1).font = totalFont as any;
    ws.getCell(row, 2).value = overview.openBalance;
    ws.getCell(row, 2).numFmt = '#,##0.00';
    ws.getCell(row, 2).fill = totalFill as any;
    ws.getCell(row, 2).font = totalFont as any;
    ws.getCell(row, 3).value = 1;
    ws.getCell(row, 3).numFmt = '0.0%';
    ws.getCell(row, 3).fill = totalFill as any;
    ws.getCell(row, 3).font = totalFont as any;
    ws.getCell(row, 4).value = overview.openInvoiceCount;
    ws.getCell(row, 4).fill = totalFill as any;
    ws.getCell(row, 4).font = totalFont as any;

    // Set column widths
    ws.columns = [
      { width: 35 },
      { width: 18 },
      { width: 15 },
      { width: 35 }
    ];

    // ────── CUSTOMER HISTORY SHEET ──────
    const ws2 = wb.addWorksheet('Customer History');
    row = 1;

    ws2.getCell(row, 1).value = `${customerName} — CUSTOMER HISTORY & BEHAVIOUR ANALYSIS`;
    ws2.getCell(row, 1).font = titleFont as any;
    ws2.mergeCells(row, 1, row, 7);
    row += 2;

    ws2.getCell(row, 1).value = 'As of';
    ws2.getCell(row, 2).value = new Date();
    ws2.getCell(row, 2).numFmt = 'dd-mmm-yyyy';
    row += 2;

    // 1 · YEAR-BY-YEAR
    ws2.getCell(row, 1).value = '1 · YEAR-BY-YEAR TRADING & PAYMENT HISTORY';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 7);
    row += 1;

    const headers3 = ['Year', 'Invoices', 'Gross invoiced', 'Avg invoice', 'Credits', 'Credit value', 'Net sales'];
    headers3.forEach((h, i) => {
      ws2.getCell(row, i + 1).value = h;
      ws2.getCell(row, i + 1).fill = tableHeaderFill as any;
      ws2.getCell(row, i + 1).font = tableHeaderFont as any;
    });
    row += 1;

    const sortedYears = Object.keys(overview.yearData).map(y => parseInt(y)).sort((a, b) => b - a);
    sortedYears.forEach(year => {
      const data = overview.yearData[year];
      const avgInv = data.invoices > 0 ? data.grossAmount / data.invoices : 0;
      ws2.getCell(row, 1).value = year;
      ws2.getCell(row, 2).value = data.invoices;
      ws2.getCell(row, 3).value = data.grossAmount;
      ws2.getCell(row, 3).numFmt = '#,##0.00';
      ws2.getCell(row, 4).value = avgInv;
      ws2.getCell(row, 4).numFmt = '#,##0.00';
      ws2.getCell(row, 5).value = data.creditCount;
      ws2.getCell(row, 6).value = data.creditAmount;
      ws2.getCell(row, 6).numFmt = '#,##0.00';
      ws2.getCell(row, 7).value = data.grossAmount + data.creditAmount;
      ws2.getCell(row, 7).numFmt = '#,##0.00';
      row += 1;
    });

    row += 1;

    // 2 · MONTHLY ACTIVITY
    ws2.getCell(row, 1).value = '2 · MONTHLY ACTIVITY — LAST 12 MONTHS';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 5);
    row += 1;

    const headers4 = ['Month', 'Invoices', 'Gross invoiced', 'Credit memos', 'Net sales'];
    headers4.forEach((h, i) => {
      ws2.getCell(row, i + 1).value = h;
      ws2.getCell(row, i + 1).fill = tableHeaderFill as any;
      ws2.getCell(row, i + 1).font = tableHeaderFont as any;
    });
    row += 1;

    const sortedMonths = Object.keys(overview.monthlyData).sort().reverse().slice(0, 12);
    sortedMonths.forEach(month => {
      const data = overview.monthlyData[month];
      ws2.getCell(row, 1).value = month;
      ws2.getCell(row, 2).value = data.invoices;
      ws2.getCell(row, 3).value = data.amount;
      ws2.getCell(row, 3).numFmt = '#,##0.00';
      ws2.getCell(row, 4).value = data.creditAmount;
      ws2.getCell(row, 4).numFmt = '#,##0.00';
      ws2.getCell(row, 5).value = data.amount + data.creditAmount;
      ws2.getCell(row, 5).numFmt = '#,##0.00';
      row += 1;
    });
    row += 1;

    // 3 · CREDIT TERMS MIX
    ws2.getCell(row, 1).value = '3 · HOW THEY BUY — CREDIT TERMS MIX (days between invoice date and due date)';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 3);
    row += 1;

    const headers5 = ['Payment terms', 'Invoices (lifetime)', '% of invoices'];
    headers5.forEach((h, i) => {
      ws2.getCell(row, i + 1).value = h;
      ws2.getCell(row, i + 1).fill = tableHeaderFill as any;
      ws2.getCell(row, i + 1).font = tableHeaderFont as any;
    });
    row += 1;

    const totalInvCount = Object.values(overview.creditTermsBuckets).reduce((a, b) => a + b, 0);
    Object.entries(overview.creditTermsBuckets).forEach(([term, count]) => {
      ws2.getCell(row, 1).value = term;
      ws2.getCell(row, 2).value = count;
      const pct = totalInvCount > 0 ? count / totalInvCount : 0;
      ws2.getCell(row, 3).value = pct;
      ws2.getCell(row, 3).numFmt = '0.0%';
      row += 1;
    });
    row += 1;

    // 4 · BASKET SIZE
    ws2.getCell(row, 1).value = '4 · BASKET SIZE — INVOICE VALUE DISTRIBUTION';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 3);
    row += 1;

    const headers6 = ['Value range', 'Invoices (lifetime)', '% of invoices'];
    headers6.forEach((h, i) => {
      ws2.getCell(row, i + 1).value = h;
      ws2.getCell(row, i + 1).fill = tableHeaderFill as any;
      ws2.getCell(row, i + 1).font = tableHeaderFont as any;
    });
    row += 1;

    Object.entries(overview.basketBuckets).forEach(([range, count]) => {
      ws2.getCell(row, 1).value = range;
      ws2.getCell(row, 2).value = count;
      const pct = totalInvCount > 0 ? count / totalInvCount : 0;
      ws2.getCell(row, 3).value = pct;
      ws2.getCell(row, 3).numFmt = '0.0%';
      row += 1;
    });
    row += 1;

    // 5 · PAYMENT BEHAVIOUR
    ws2.getCell(row, 1).value = '5 · PAYMENT BEHAVIOUR — WHEN INVOICES ACTUALLY SETTLE';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 2);
    row += 1;

    ws2.getCell(row, 1).value = 'On-time payment rate %';
    ws2.getCell(row, 2).value = overview.onTimeRate / 100;
    ws2.getCell(row, 2).numFmt = '0.0%';
    row += 1;

    ws2.getCell(row, 1).value = 'Average settlement days';
    ws2.getCell(row, 2).value = overview.avgSettlementDays;
    row += 2;

    // 6 · RETURNS ANALYSIS
    ws2.getCell(row, 1).value = '6 · RETURNS & CREDIT MEMO ANALYSIS — INVOICES VS RETURNS';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 2);
    row += 1;

    ws2.getCell(row, 1).value = 'Return ratio %';
    ws2.getCell(row, 2).value = overview.returnsRatio / 100;
    ws2.getCell(row, 2).numFmt = '0.0%';
    row += 1;

    ws2.getCell(row, 1).value = 'Average credit memo value';
    ws2.getCell(row, 2).value = overview.avgCreditMemo;
    ws2.getCell(row, 2).numFmt = '#,##0.00';
    row += 2;

    // 7 · THIRD PARTY SETTLEMENTS
    ws2.getCell(row, 1).value = '7 · SETTLEMENTS MADE BY THIRD PARTIES ("Paid by Others")';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 2);
    row += 1;

    const paidByOthersCount = overview.settledInvoices.filter((item: any) => item['ReceiptType'] === 'Paid by Others').length;
    ws2.getCell(row, 1).value = 'Paid by others count';
    ws2.getCell(row, 2).value = paidByOthersCount;
    row += 2;

    // 8 · KEY INSIGHTS
    ws2.getCell(row, 1).value = '8 · KEY INSIGHTS';
    ws2.getCell(row, 1).fill = headerFill as any;
    ws2.getCell(row, 1).font = sectionFont as any;
    ws2.mergeCells(row, 1, row, 2);
    row += 1;

    const insights = [];
    if (overview.paymentRate > 0.8) insights.push('✓ Strong payment discipline with >80% settlement rate');
    if (overview.onTimeRate > 80) insights.push('✓ Excellent on-time payment behavior (>80%)');
    if (overview.pastDueBalance > 0) insights.push(`⚠ Past due balance of MUR ${overview.pastDueBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    if (overview.returnsRatio > 5) insights.push(`⚠ Return ratio of ${overview.returnsRatio.toFixed(1)}% is notable`);
    if (insights.length === 0) insights.push('Customer account profile appears normal');

    insights.forEach(insight => {
      ws2.getCell(row, 1).value = insight;
      row += 1;
    });

    ws2.columns = [
      { width: 35 },
      { width: 18 },
      { width: 15 },
      { width: 18 },
      { width: 15 }
    ];

    // ────── AR INVOICES DETAIL SHEET ──────
    if (childStates[overviewCustomerKey]?.transactionPaymentSchedules?.data) {
      const ws3 = wb.addWorksheet('AR Invoices');
      const invoicesData = childStates[overviewCustomerKey].transactionPaymentSchedules.data;

      row = 1;
      const invoiceHeaders = ['Invoice #', 'Date', 'Due Date', 'Amount', 'Balance', 'Status', 'Days Late'];
      invoiceHeaders.forEach((h, i) => {
        ws3.getCell(row, i + 1).value = h;
        ws3.getCell(row, i + 1).fill = tableHeaderFill as any;
        ws3.getCell(row, i + 1).font = tableHeaderFont as any;
      });
      row += 1;

      invoicesData.slice(0, 100).forEach((inv: any) => {
        ws3.getCell(row, 1).value = inv['TransactionNumber'] || '';
        ws3.getCell(row, 2).value = inv['TransactionDate'] ? new Date(inv['TransactionDate'] as string) : null;
        ws3.getCell(row, 2).numFmt = 'dd-mmm-yyyy';
        ws3.getCell(row, 3).value = inv['PaymentScheduleDueDate'] ? new Date(inv['PaymentScheduleDueDate'] as string) : null;
        ws3.getCell(row, 3).numFmt = 'dd-mmm-yyyy';
        ws3.getCell(row, 4).value = inv['TotalOriginalAmount'] || 0;
        ws3.getCell(row, 4).numFmt = '#,##0.00';
        ws3.getCell(row, 5).value = inv['TotalBalanceAmount'] || 0;
        ws3.getCell(row, 5).numFmt = '#,##0.00';
        ws3.getCell(row, 6).value = inv['InstallmentStatus'] || '';
        ws3.getCell(row, 7).value = inv['PaymentDaysLate'] || 0;
        row += 1;
      });

      ws3.columns = [
        { width: 18 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 12 },
        { width: 12 }
      ];
    }

    // ────── CREDIT MEMOS DETAIL SHEET ──────
    if (childStates[overviewCustomerKey]?.creditMemos?.data) {
      const ws4 = wb.addWorksheet('Credit Memos');
      const creditsData = childStates[overviewCustomerKey].creditMemos.data;

      row = 1;
      const creditHeaders = ['Credit #', 'Date', 'Amount', 'Balance', 'Status'];
      creditHeaders.forEach((h, i) => {
        ws4.getCell(row, i + 1).value = h;
        ws4.getCell(row, i + 1).fill = tableHeaderFill as any;
        ws4.getCell(row, i + 1).font = tableHeaderFont as any;
      });
      row += 1;

      creditsData.slice(0, 100).forEach((cm: any) => {
        ws4.getCell(row, 1).value = cm['TransactionNumber'] || '';
        ws4.getCell(row, 2).value = cm['CreditMemoDate'] ? new Date(cm['CreditMemoDate'] as string) : null;
        ws4.getCell(row, 2).numFmt = 'dd-mmm-yyyy';
        ws4.getCell(row, 3).value = cm['TotalOriginalAmount'] || 0;
        ws4.getCell(row, 3).numFmt = '#,##0.00';
        ws4.getCell(row, 4).value = cm['TotalBalanceAmount'] || 0;
        ws4.getCell(row, 4).numFmt = '#,##0.00';
        ws4.getCell(row, 5).value = cm['CreditMemoStatus'] || '';
        row += 1;
      });

      ws4.columns = [
        { width: 18 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 12 }
      ];
    }

    // Save and download
    const buf = await wb.xlsx.writeBuffer();
    const fileName = `Receivables_Overview_${customerName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildDetailsTabItems = () => {
    return detailsTabs.map(({ key, site }) => {
      const siteChildStates = childStates[key] || {};

      // Build child activity tabs
      const childTabItems = CHILD_NAMES.map(cn => {
        const state = siteChildStates[cn] || { loading: false, data: [], columns: [] };
        const tabFilterKey = `${key}_${cn}`;
        const columnFilterValue = columnFilters[tabFilterKey] || '';

        // Apply column filter to data
        const filteredData = useMemo(() => {
          if (!columnFilterValue.trim()) return state.data;
          const q = columnFilterValue.toLowerCase();
          return state.data.filter(row =>
            Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
          );
        }, [state.data, columnFilterValue]);

        // Build columns with sorting
        let cols = buildColumns(filteredData);

        // For AR Invoices tab: insert Aging Bucket column after Total Balance Amount
        if (cn === 'transactionPaymentSchedules') {
          const balanceColIndex = cols.findIndex(c => c.dataIndex === 'TotalBalanceAmount');
          if (balanceColIndex !== -1) {
            cols.splice(balanceColIndex + 1, 0, {
              title: 'Aging Bucket',
              key: 'agingBucket',
              width: 100,
              render: (_: unknown, record: Row) => {
                const bucket = getAgingBucket(record['PaymentDaysLate']);
                const bucketColor = bucket === 'Current' ? REDWOOD.success : bucket === '31-60' ? '#faad14' : bucket === '61-90' ? '#ff7a45' : REDWOOD.error;
                return <Tag color={bucketColor}>{bucket}</Tag>;
              },
            });
          }
        }

        cols = cols.map(col => ({
          ...col,
          sorter: (a: Row, b: Row) => {
            const aVal = a[col.dataIndex as string];
            const bVal = b[col.dataIndex as string];
            if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
            return String(aVal || '').localeCompare(String(bVal || ''));
          },
        }));

        // Calculate totals (exclude ID columns)
        const totals: Record<string, number> = {};
        const idPatterns = ['Id', 'ID', 'Number', 'Date'];
        filteredData.forEach(row => {
          Object.keys(row).forEach(k => {
            if (typeof row[k] === 'number' && !idPatterns.some(pattern => k.includes(pattern))) {
              totals[k] = (totals[k] || 0) + row[k];
            }
          });
        });

        // AR Invoices filter UI
        const arCurrentStatus = arInvoicesFilters[key] || 'Open';
        const arLoadingStatus = arInvoicesLoadingStatus[key];
        const arIsLoading = arLoadingStatus?.loading || false;

        // Credit Memos filter UI
        const cmCurrentStatus = creditMemosFilters[key] || 'Open';
        const cmLoadingStatus = creditMemosLoadingStatus[key];
        const cmIsLoading = cmLoadingStatus?.loading || false;

        return {
          key: cn,
          label: (
            <span>
              {CHILD_LABEL_MAP[cn]}
              {filteredData.length > 0 && <Badge count={filteredData.length} size="small" style={{ marginLeft: 6, background: REDWOOD.info }} />}
              {state.loading && <SyncOutlined spin style={{ marginLeft: 6, fontSize: 11 }} />}
            </span>
          ),
          children: (
            <div>
              {cn === 'transactionPaymentSchedules' && (
                <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong style={{ fontSize: 13 }}>Filter by Status:</Text>
                    <Space size={0}>
                      {(['Open', 'Closed', 'ALL'] as const).map(status => (
                        <Button
                          key={status}
                          type={arCurrentStatus === status ? 'primary' : 'default'}
                          size="small"
                          onClick={() => reloadArInvoices(key, status)}
                          disabled={arIsLoading}
                          style={{ borderRadius: arCurrentStatus === status ? '2px' : '2px' }}
                        >
                          {status}
                        </Button>
                      ))}
                    </Space>
                    <Button
                      type="text"
                      icon={<SyncOutlined spin={arIsLoading} />}
                      size="small"
                      onClick={() => reloadArInvoices(key, arCurrentStatus)}
                      disabled={arIsLoading}
                      title="Refresh data"
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {arIsLoading && (
                      <>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {arLoadingStatus.progress}
                        </Text>
                        <Button
                          type="primary"
                          danger
                          size="small"
                          onClick={() => {
                            arInvoicesCancelRef.current[key] = true;
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {cn === 'creditMemos' && (
                <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong style={{ fontSize: 13 }}>Filter by Status:</Text>
                    <Space size={0}>
                      {(['Open', 'Closed', 'ALL'] as const).map(status => (
                        <Button
                          key={status}
                          type={cmCurrentStatus === status ? 'primary' : 'default'}
                          size="small"
                          onClick={() => reloadCreditMemos(key, status)}
                          disabled={cmIsLoading}
                          style={{ borderRadius: cmCurrentStatus === status ? '2px' : '2px' }}
                        >
                          {status}
                        </Button>
                      ))}
                    </Space>
                    <Button
                      type="text"
                      icon={<SyncOutlined spin={cmIsLoading} />}
                      size="small"
                      onClick={() => reloadCreditMemos(key, cmCurrentStatus)}
                      disabled={cmIsLoading}
                      title="Refresh data"
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {cmIsLoading && (
                      <>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {cmLoadingStatus.progress}
                        </Text>
                        <Button
                          type="primary"
                          danger
                          size="small"
                          onClick={() => {
                            creditMemosCancelRef.current[key] = true;
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!state.loading && state.data.length > 0 && (
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Input
                    placeholder="Filter by any column..."
                    prefix={<SearchOutlined style={{ color: '#aaa' }} />}
                    value={columnFilterValue}
                    onChange={e => setColumnFilters(prev => ({ ...prev, [tabFilterKey]: e.target.value }))}
                    allowClear
                    style={{ width: 200, height: 28 }}
                    size="small"
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>{filteredData.length} / {state.data.length} rows</Text>
                </div>
              )}
              {!state.loading && (
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                  {state.data.length > 0 && (
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => exportToExcel(filteredData, cn)}>Export to Excel</Button>
                  )}
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    onClick={() => setChildApiDebugVisible({ tabKey: key, childName: cn })}
                    style={{ color: detailApiDebug[key]?.responses[cn] ? REDWOOD.info : undefined }}
                    title="View API debug info"
                  />
                </div>
              )}
              <Table
                dataSource={filteredData}
                columns={cols}
                rowKey={(_r, i) => String(i)}
                loading={state.loading}
                size="small"
                scroll={{ x: 'max-content' }}
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  pageSizeOptions: [20, 50, 100, 200, 500, filteredData.length > 0 ? filteredData.length : 1000],
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} records`,
                }}
                footer={() =>
                  Object.keys(totals).length > 0 ? (
                    <div style={{
                      display: 'flex',
                      padding: '8px 0',
                      fontWeight: 600,
                      background: '#fafafa',
                      borderTop: `1px solid ${REDWOOD.border}`,
                      color: REDWOOD.primary,
                    }}>
                      {cols.map((col, idx) => {
                        const dataIndex = col.dataIndex as string;
                        const value = totals[dataIndex];
                        const isFirstCol = idx === 0;
                        const isNumericCol = value !== undefined;

                        return (
                          <div
                            key={dataIndex}
                            style={{
                              flex: col.width ? `0 0 ${col.width}px` : 1,
                              padding: '8px 12px',
                              textAlign: isNumericCol ? 'right' : 'left',
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {isFirstCol ? 'TOTAL' : (isNumericCol ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')}
                          </div>
                        );
                      })}
                    </div>
                  ) : undefined
                }
              />

              {cn === 'transactionPaymentSchedules' && filteredData.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <Card style={{ borderColor: REDWOOD.border, marginBottom: 16 }} title={<Text strong>Aging Analysis</Text>}>
                    <Row gutter={[16, 16]}>
                      {['Current', '31-60', '61-90', '90+'].map(bucket => {
                        const arData = siteChildStates['transactionPaymentSchedules']?.data || [];
                        const agingBuckets = { Current: 0, '31-60': 0, '61-90': 0, '90+': 0 };
                        arData.forEach(row => {
                          const days = row['PaymentDaysLate'];
                          const amount = row['TotalBalanceAmount'] || 0;
                          const b = getAgingBucket(days);
                          if (b !== '-' && agingBuckets.hasOwnProperty(b)) {
                            (agingBuckets as Record<string, number>)[b] += amount;
                          }
                        });
                        const total = Object.values(agingBuckets).reduce((a, b) => a + b, 0);
                        const amount = agingBuckets[bucket as keyof typeof agingBuckets];
                        const percentage = total > 0 ? (amount / total) * 100 : 0;
                        const bucketColor = bucket === 'Current' ? REDWOOD.success : bucket === '31-60' ? '#faad14' : bucket === '61-90' ? '#ff7a45' : REDWOOD.error;
                        return (
                          <Col xs={24} sm={12} md={6} key={bucket}>
                            <div style={{
                              padding: 12,
                              borderRadius: 6,
                              background: bucket === 'Current' ? '#f6ffed' : bucket === '31-60' ? '#fffbe6' : bucket === '61-90' ? '#fff7e6' : '#fff1f0',
                              borderLeft: `4px solid ${bucketColor}`,
                            }}>
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{bucket} Days</Text>
                              <div style={{
                                fontSize: 18,
                                fontWeight: 700,
                                color: bucketColor,
                              }}>
                                {formatVal('amount', amount)}
                              </div>
                              <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                                {percentage.toFixed(1)}%
                              </Text>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  </Card>

                  <Card style={{ borderColor: REDWOOD.border }} title={<Text strong>Monthly Activity</Text>}>
                    <Row gutter={[16, 16]}>
                      {(() => {
                        const monthlyData: Record<string, { count: number; amount: number }> = {};
                        const arData = siteChildStates['transactionPaymentSchedules']?.data || [];
                        arData.forEach(row => {
                          const dateStr = row['TransactionDate'] as string;
                          if (!dateStr) return;
                          const monthKey = dateStr.substring(0, 7); // YYYY-MM
                          if (!monthlyData[monthKey]) monthlyData[monthKey] = { count: 0, amount: 0 };
                          monthlyData[monthKey].count += 1;
                          monthlyData[monthKey].amount += Number(row['TotalOriginalAmount']) || 0;
                        });

                        const sortedMonths = Object.keys(monthlyData).sort().reverse().slice(0, 6);
                        return sortedMonths.map(month => (
                          <Col xs={24} sm={12} md={8} key={month}>
                            <div style={{
                              padding: 12,
                              borderRadius: 6,
                              background: '#f5f5f5',
                              border: `1px solid ${REDWOOD.border}`,
                            }}>
                              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{month}</Text>
                              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                Invoices: {monthlyData[month].count}
                              </Text>
                              <Text style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                                Amount: {formatVal('amount', monthlyData[month].amount)}
                              </Text>
                            </div>
                          </Col>
                        ));
                      })()}
                    </Row>
                  </Card>
                </div>
              )}
            </div>
          ),
        };
      });

      // Calculate aging summary from AR Invoices data
      const arInvoicesState = siteChildStates['transactionPaymentSchedules'] || { data: [] };
      const agingSummary = { Current: 0, '31-60': 0, '61-90': 0, '90+': 0, Total: 0 };
      arInvoicesState.data.forEach(row => {
        const days = row['PaymentDaysLate'];
        const amount = row['TotalBalanceAmount'] || 0;
        const bucket = getAgingBucket(days);
        if (bucket !== '-') {
          (agingSummary as Record<string, number>)[bucket] = ((agingSummary as Record<string, number>)[bucket] || 0) + amount;
        }
        agingSummary.Total += amount;
      });

      // Calculate balances from actual detail data
      const arInvoicesData = siteChildStates['transactionPaymentSchedules']?.data || [];
      const creditMemosData = siteChildStates['creditMemos']?.data || [];

      const openInvoicesBalance = arInvoicesData
        .filter(row => row['InstallmentStatus'] === 'Open')
        .reduce((sum, row) => sum + (Number(row['TotalBalanceAmount']) || 0), 0);

      const openCreditBalance = creditMemosData
        .filter(row => row['CreditMemoStatus'] === 'Open')
        .reduce((sum, row) => sum + (Number(row['TotalBalanceAmount']) || 0), 0);

      const calculatedTotalOpen = openInvoicesBalance + openCreditBalance;
      const invoicesTotalAmount = arInvoicesData.reduce((sum, row) => sum + (Number(row['TotalOriginalAmount']) || 0), 0);

      // Overview tab
      const overviewTab = {
        key: 'overview',
        label: (
          <span>
            <EyeOutlined style={{ marginRight: 6 }} />
            Overview
          </span>
        ),
        children: (
          <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Open Balance</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.primary, marginTop: 8 }}>
                      {formatVal('amount', calculatedTotalOpen)}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      Invoices: {formatVal('amount', openInvoicesBalance)}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      Credits: {formatVal('amount', openCreditBalance)}
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Invoiced</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.info, marginTop: 8 }}>
                      {formatVal('amount', invoicesTotalAmount)}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      {arInvoicesData.length} invoices
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Open Invoices</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.success, marginTop: 8 }}>
                      {arInvoicesData.filter(r => r['InstallmentStatus'] === 'Open').length}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      Closed: {arInvoicesData.filter(r => r['InstallmentStatus'] === 'Closed').length}
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Avg Days Late</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.warning, marginTop: 8 }}>
                      {arInvoicesData.length > 0
                        ? Math.round(arInvoicesData.reduce((sum, r) => sum + (Number(r['PaymentDaysLate']) || 0), 0) / arInvoicesData.length)
                        : 0}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      Credit Memos: {creditMemosData.length}
                    </Text>
                  </div>
                </Card>
              </Col>
            </Row>

            <Card style={{ borderColor: REDWOOD.border, marginTop: 16 }} title={<Text strong>Aging Summary</Text>}>
              <Row gutter={[16, 16]}>
                {['Current', '31-60', '61-90', '90+'].map(bucket => (
                  <Col xs={24} sm={12} md={6} key={bucket}>
                    <div style={{
                      padding: 12,
                      borderRadius: 6,
                      background: bucket === 'Current' ? '#f6ffed' : bucket === '31-60' ? '#fffbe6' : bucket === '61-90' ? '#fff7e6' : '#fff1f0',
                      borderLeft: `4px solid ${bucket === 'Current' ? REDWOOD.success : bucket === '31-60' ? '#faad14' : bucket === '61-90' ? '#ff7a45' : REDWOOD.error}`,
                    }}>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{bucket} Days</Text>
                      <div style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: bucket === 'Current' ? REDWOOD.success : bucket === '31-60' ? '#faad14' : bucket === '61-90' ? '#ff7a45' : REDWOOD.error,
                      }}>
                        {formatVal('amount', agingSummary[bucket as keyof typeof agingSummary])}
                      </div>
                      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                        {agingSummary.Total > 0 ? ((agingSummary[bucket as keyof typeof agingSummary] / agingSummary.Total) * 100).toFixed(1) : 0}%
                      </Text>
                    </div>
                  </Col>
                ))}
              </Row>
            </Card>
          </div>
        ),
      };

      const debugInfo = detailApiDebug[key];

      const exportDetailTabs = () => {
        const wb = XLSX.utils.book_new();

        // Add each child entity as a sheet
        CHILD_NAMES.forEach(cn => {
          const state = siteChildStates[cn] || { data: [] };
          if (state.data.length > 0) {
            const cleaned = state.data.map(row => {
              const r: Row = {};
              Object.keys(row).filter(k => k !== 'links').forEach(k => { r[k] = row[k]; });
              return r;
            });
            const ws = XLSX.utils.json_to_sheet(cleaned);
            XLSX.utils.book_append_sheet(wb, ws, CHILD_LABEL_MAP[cn]);
          }
        });

        // Add summary sheet with overview data
        const summaryData = [{
          'Customer Name': site['CustomerName'],
          'Account Number': site['AccountNumber'],
          'Bill To Site Number': site['BillToSiteNumber'],
          'Total Open Receivables': site['TotalOpenReceivablesForSite'],
          'Total Transactions Due': site['TotalTransactionsDueForSite'],
          'Total Invoices': siteChildStates['transactionPaymentSchedules']?.data.length || 0,
          'Avg Days Late': siteChildStates['transactionPaymentSchedules']?.data.length > 0
            ? Math.round(siteChildStates['transactionPaymentSchedules'].data.reduce((sum: number, r: Row) => sum + (Number(r['PaymentDaysLate']) || 0), 0) / siteChildStates['transactionPaymentSchedules'].data.length)
            : 0,
        }];
        const summaryWs = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary', 0);

        const fileName = `${site['CustomerName']}_Activities_${new Date().toISOString().split('T')[0]}`;
        XLSX.writeFile(wb, `${fileName}.xlsx`);
      };

      return {
        key,
        label: (
          <span>
            {site['CustomerName']?.substring(0, 20)}
            <Button
              type="text"
              size="small"
              onClick={(e) => { e.stopPropagation(); exportDetailTabs(); }}
              icon={<DownloadOutlined />}
              style={{ marginLeft: 4, padding: 0 }}
              title="Export all tabs to Excel"
            />
            <Button
              type="text"
              size="small"
              onClick={(e) => { e.stopPropagation(); setDetailApiDebugVisible(key); }}
              icon={<ApiOutlined />}
              style={{ marginLeft: 4, padding: 0, color: debugInfo ? REDWOOD.info : undefined }}
            />
            <Button
              type="text"
              size="small"
              onClick={(e) => { e.stopPropagation(); closeDetailsTab(key); }}
              style={{ marginLeft: 8, padding: 0 }}
            >
              ×
            </Button>
          </span>
        ),
        children: (
          <div>
            <Card style={{ marginBottom: 16, borderColor: REDWOOD.border }} bodyStyle={{ padding: '16px' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Customer Name</Text>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{site['CustomerName']}</div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Account Number</Text>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{site['AccountNumber']}</div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Bill To Site Number</Text>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{site['BillToSiteNumber']}</div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Open Receivables</Text>
                    <div style={{ fontSize: 14, fontWeight: 600, color: REDWOOD.primary }}>
                      {formatVal('amount', site['TotalOpenReceivablesForSite'])}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button type="link" icon={<EyeOutlined />} onClick={() => { setOverviewCustomerKey(key); setReceivablesOverviewVisible(true); }}
                      style={{ color: REDWOOD.primary, fontSize: 12, padding: '0 8px' }}>
                      Receivables Overview
                    </Button>
                    <span style={{ fontSize: 12, color: REDWOOD.border }}>•</span>
                    <Button type="link" icon={<FileTextOutlined />} onClick={() => handleShowAccountStatement(key)}
                      style={{ color: REDWOOD.primary, fontSize: 12, padding: '0 8px' }}>
                      Account Statement
                    </Button>
                  </div>
                </div>
              </Space>
            </Card>
            <Tabs items={[overviewTab, ...childTabItems]} style={{ background: REDWOOD.surface, borderRadius: 8 }} />
          </div>
        ),
      };
    });
  };

  const tabItems = [
    {
      key: 'sites',
      label: (
        <span>
          <ShoppingOutlined style={{ marginRight: 8 }} />
          All Customers
          {fusionData.length > 0 && <Badge count={fusionData.length} style={{ marginLeft: 8, background: REDWOOD.info }} />}
        </span>
      ),
      children: (
        <div>
          <Card style={{ marginBottom: 16, borderColor: REDWOOD.border }} bodyStyle={{ padding: '16px 24px' }}>
            <Form form={form} layout="inline" onFinish={handleSearch}>
              <Form.Item name="CustomerName" label="Customer Name">
                <Input placeholder="Customer name..." style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="AccountNumber" label="Account Number">
                <Input placeholder="Account number..." style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="BillToSiteNumber" label="Site Number">
                <Input placeholder="Site number..." style={{ width: 140 }} />
              </Form.Item>
              <Form.Item>
                <Checkbox checked={recordsWithBalances} onChange={(e) => setRecordsWithBalances(e.target.checked)}>
                  Records with Balances
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={searchLoading}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                  Search
                </Button>
              </Form.Item>
              <Form.Item>
                <Button icon={<ApiOutlined />} onClick={() => setApiDebugVisible(true)}
                  style={{ color: apiDebug ? REDWOOD.info : undefined }}>
                  API
                </Button>
              </Form.Item>
              {fusionData.length > 0 && (
                <Form.Item>
                  <Button icon={<DownloadOutlined />} onClick={() => exportToExcel(fusionData, 'CustomerSiteActivities')}>
                    Export
                  </Button>
                </Form.Item>
              )}
            </Form>
          </Card>

          <Card style={{ borderColor: REDWOOD.border }}>
            <SiteResultsTable
              data={fusionData}
              columns={fusionColumns}
              loading={searchLoading}
              currentPage={currentPage}
              hasMore={hasMore}
              totalRecords={totalRecords}
              onPageChange={loadPage}
            />
          </Card>
        </div>
      ),
    },
    ...buildDetailsTabItems(),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /> Home</Link> },
            { title: 'Fusion Supply Chain' },
            { title: 'Customer Balances' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 24 }}>
            <Space align="center">
              <div style={{
                width: 48, height: 48, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #E85D4A 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <EyeOutlined style={{ color: '#fff', fontSize: 22 }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Customer Account Site Activities</Title>
                <Text type="secondary">Search → select sites → Load Activities tabs</Text>
              </div>
            </Space>
          </div>

          <Tabs activeKey={activeDetailTab || 'sites'} onChange={setActiveDetailTab} type="card" items={tabItems}
            style={{ background: REDWOOD.surface, borderRadius: 8 }} />
        </div>

        <FloatingMenu />
      </Content>

      <Modal open={apiDebugVisible} onCancel={() => setApiDebugVisible(false)} footer={null} width={900}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> API Debug</Space>}>
        {apiDebug ? (
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">GET</Tag>
              <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{apiDebug.url}</Text>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">Status: </Text>
              {apiDebug.status === null ? <Tag>Pending…</Tag>
                : apiDebug.status > 0 ? <Tag color={apiDebug.status < 300 ? 'green' : 'red'}>{apiDebug.status}</Tag>
                : <Tag color="red">Error</Tag>}
            </div>
            <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <Text strong>Response</Text>
              <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(apiDebug.response); message.success('Copied'); }}>Copy</Button>
            </div>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {apiDebug.response || '(click Search first)'}
            </pre>
          </div>
        ) : <Empty description="Click Search to populate" />}
      </Modal>

      <Modal open={!!detailApiDebugVisible} onCancel={() => setDetailApiDebugVisible(null)} footer={null} width={1000}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Detail API Debug</Space>}>
        {detailApiDebugVisible && detailApiDebug[detailApiDebugVisible] ? (
          <div>
            {CHILD_NAMES.map(childName => {
              const debug = detailApiDebug[detailApiDebugVisible];
              const status = debug.statuses[childName];
              const response = debug.responses[childName];
              const isSuccess = status && status < 300;
              return (
                <div key={childName} style={{ marginBottom: 16, border: `1px solid ${REDWOOD.border}`, borderRadius: 6, padding: 12 }}>
                  <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <Text strong>{CHILD_LABEL_MAP[childName]}</Text>
                      <Tag color={isSuccess ? 'green' : 'red'}>{status || 'Error'}</Tag>
                    </Space>
                    {response && (
                      <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(response); message.success('Copied'); }}>Copy</Button>
                    )}
                  </div>
                  {response && (
                    <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 250, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, margin: 0 }}>
                      {response}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : <Empty description="No debug info available" />}
      </Modal>

      <Modal open={receivablesOverviewVisible} onCancel={() => { setReceivablesOverviewVisible(false); setOverviewCustomerKey(null); }} footer={null} width={1200}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>RECEIVABLES OVERVIEW</span>
            {overviewData && !overviewLoading && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => exportOverviewToExcel()}
                size="small"
              >
                Export to Excel
              </Button>
            )}
          </div>
        }>
        {overviewLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
            <Spin size="large" />
            <Text style={{ marginTop: 24, fontSize: 16 }}>{overviewProgress}</Text>
            <Button
              danger
              onClick={() => setShouldCancelOverview(true)}
              style={{ marginTop: 24 }}
            >
              Cancel
            </Button>
          </div>
        ) : ((() => {
          const overview = overviewData;
          if (!overview) return <Empty description="No data available" />;
          const overviewTabs = [
            {
              key: 'overview',
              label: 'Overview',
              children: (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>1 · CURRENT BALANCE POSITION</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                          <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Item</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Amount (MUR)</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 6 }}>Open invoice balance</td>
                          <td style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>{overview.openBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 6 }}>{overview.openInvoiceCount}</td>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 6 }}>Unapplied credit memos</td>
                          <td style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>{overview.openCreditBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 6 }}>{overview.openCreditCount}</td>
                        </tr>
                        <tr style={{ background: REDWOOD.neutral100 }}>
                          <td style={{ padding: 6, fontWeight: 700 }}>NET OPEN RECEIVABLES</td>
                          <td style={{ textAlign: 'right', padding: 6, fontWeight: 700, color: REDWOOD.primary }}>{overview.netOpen.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 6, fontWeight: 700 }}>{overview.openInvoiceCount + overview.openCreditCount}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: 6 }}>— of which past due</td>
                          <td style={{ textAlign: 'right', padding: 6, color: REDWOOD.error }}>{overview.pastDueBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 6 }}>{overview.pastDueBalance > 0 ? overview.ageingBuckets['1-30 days'].count + overview.ageingBuckets['31-60 days'].count + overview.ageingBuckets['61-90 days'].count + overview.ageingBuckets['91-180 days'].count + overview.ageingBuckets['180+ days'].count : 0}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>2 · AGEING OF OPEN RECEIVABLES</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                          <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Ageing bucket</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Amount (MUR)</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>% of open</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(overview.ageingBuckets).map(([bucket, data]) => (
                          <tr key={bucket} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                            <td style={{ padding: 6 }}>{bucket}</td>
                            <td style={{ textAlign: 'right', padding: 6 }}>{data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right', padding: 6 }}>{((data.amount / overview.openBalance) * 100).toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', padding: 6 }}>{data.count}</td>
                          </tr>
                        ))}
                        <tr style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
                          <td style={{ padding: 6 }}>Total</td>
                          <td style={{ textAlign: 'right', padding: 6 }}>{overview.openBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 6 }}>100.0%</td>
                          <td style={{ textAlign: 'right', padding: 6 }}>{overview.openInvoiceCount}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            },
            {
              key: 'history',
              label: 'Customer History',
              children: (
                <div style={{ paddingBottom: 24 }}>
                  {/* 1. YEAR-BY-YEAR TRADING */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>1 · YEAR-BY-YEAR TRADING & PAYMENT HISTORY</Title>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                            <th style={{ textAlign: 'center', padding: 6, fontWeight: 600 }}>Year</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Invoices</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Gross invoiced (MUR)</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Avg invoice</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Credit memos</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Credit value (MUR)</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Net sales (MUR)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(overview.yearData).sort(([yearA], [yearB]) => parseInt(yearA) - parseInt(yearB)).map(([year, data]) => (
                            <tr key={year} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                              <td style={{ textAlign: 'center', padding: 6, fontWeight: 600 }}>{year}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.invoices}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.grossAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.invoices > 0 ? (data.grossAmount / data.invoices).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.creditCount}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.creditAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>{(data.grossAmount + data.creditAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 2. MONTHLY ACTIVITY */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>2 · MONTHLY ACTIVITY</Title>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                            <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Month</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Invoices</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Amount (MUR)</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Credits</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Credit Value (MUR)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(overview.monthlyData).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12).map(([month, data]) => (
                            <tr key={month} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                              <td style={{ padding: 6, fontWeight: 600 }}>{month}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.invoices}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.credits}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{data.creditAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 3. HOW THEY BUY - CREDIT TERMS */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>3 · HOW THEY BUY — CREDIT TERMS MIX (days between invoice date and due date)</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                          <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Terms</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Count</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>% of invoices</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(overview.creditTermsBuckets).map(([terms, count]) => {
                          const total = Object.values(overview.creditTermsBuckets).reduce((a, b) => a + b, 0);
                          return (
                            <tr key={terms} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                              <td style={{ padding: 6 }}>{terms}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{count}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{total > 0 ? ((count / total) * 100).toFixed(1) : 0}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 4. BASKET SIZE */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>4 · BASKET SIZE — INVOICE VALUE DISTRIBUTION</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                          <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Size Range</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Count</th>
                          <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>% of invoices</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(overview.basketBuckets).map(([size, count]) => {
                          const total = Object.values(overview.basketBuckets).reduce((a, b) => a + b, 0);
                          return (
                            <tr key={size} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                              <td style={{ padding: 6 }}>{size}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{count}</td>
                              <td style={{ textAlign: 'right', padding: 6 }}>{total > 0 ? ((count / total) * 100).toFixed(1) : 0}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 5. PAYMENT BEHAVIOUR */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>5 · PAYMENT BEHAVIOUR — WHEN INVOICES ACTUALLY SETTLE</Title>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Avg Settlement Days</Text>
                            <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.primary, marginTop: 8 }}>
                              {overview.avgSettlementDays} days
                            </div>
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>from due date</Text>
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>On-Time Payment Rate</Text>
                            <div style={{ fontSize: 24, fontWeight: 700, color: overview.onTimeRate > 50 ? REDWOOD.success : REDWOOD.error, marginTop: 8 }}>
                              {overview.onTimeRate.toFixed(1)}%
                            </div>
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>paid by due date</Text>
                          </div>
                        </Card>
                      </Col>
                    </Row>
                  </div>

                  {/* 6. RETURNS & CREDIT MEMO ANALYSIS */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>6 · RETURNS & CREDIT MEMO ANALYSIS — INVOICES VS RETURNS</Title>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Returns as % of Gross</Text>
                            <div style={{ fontSize: 24, fontWeight: 700, color: overview.returnsRatio > 5 ? REDWOOD.error : REDWOOD.success, marginTop: 8 }}>
                              {overview.returnsRatio.toFixed(1)}%
                            </div>
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Avg Credit Memo Value</Text>
                            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>
                              {overview.avgCreditMemo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </Card>
                      </Col>
                    </Row>
                  </div>

                  {/* 7. SETTLEMENTS BY THIRD PARTIES */}
                  <div style={{ marginBottom: 32, padding: 16, background: REDWOOD.neutral100, borderRadius: 8 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.primary }}>7 · SETTLEMENTS MADE BY THIRD PARTIES ("Paid by Others")</Title>
                    <Card style={{ borderColor: REDWOOD.border }}>
                      <div style={{ textAlign: 'center' }}>
                        <Text strong>This customer has {childStates[overviewCustomerKey || '']?.transactionsPaidByOtherCustomers?.data?.length || 0} settlements recorded as "Paid by Others"</Text>
                        <div style={{ marginTop: 12, fontSize: 12, color: REDWOOD.primary }}>
                          Third-party payment activity indicates complex organizational structure or group payment arrangements
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* 8. KEY INSIGHTS */}
                  <div style={{ marginBottom: 32, padding: 16, background: '#f0f5ff', borderRadius: 8, borderLeft: `4px solid ${REDWOOD.info}` }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: REDWOOD.info }}>💡 8 · KEY INSIGHTS</Title>
                    <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
                      <li>
                        <strong>Payment Pattern:</strong> {overview.onTimeRate > 80 ? 'Excellent payer - consistently pays on or before due date' : overview.onTimeRate > 50 ? 'Moderate payer - mixed timeliness' : 'Payment delays observed - average ' + overview.avgSettlementDays + ' days late'}
                      </li>
                      <li>
                        <strong>Trading Volume:</strong> {overview.totalInvoiced > 0 ? 'Total lifetime invoiced: ' + overview.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MUR across ' + overview.openInvoiceCount + ' transactions' : 'No invoice activity'}
                      </li>
                      <li>
                        <strong>Return Rate:</strong> {overview.returnsRatio > 5 ? 'High return rate (' + overview.returnsRatio.toFixed(1) + '%) - monitor quality issues' : overview.returnsRatio > 0 ? 'Normal return rate (' + overview.returnsRatio.toFixed(1) + '%)' : 'No returns recorded'}
                      </li>
                      <li>
                        <strong>Credit Terms:</strong> {overview.creditTermsBuckets['16-30 days'] > 0 ? 'Typical payment terms: 16-30 days (most common)' : 'Review payment terms configuration'}
                      </li>
                      <li>
                        <strong>Outstanding Risk:</strong> {overview.pastDueBalance > 0 ? 'Past due amount: ' + overview.pastDueBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MUR' : 'No past due amounts'}
                      </li>
                    </ul>
                  </div>
                </div>
              ),
            },
            {
              key: 'kpi',
              label: 'KPI & Health',
              children: (
                <div>
                  <div style={{ marginBottom: 24 }}>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>3 · KEY PERFORMANCE INDICATORS</Title>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12} md={6}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Gross Invoiced</Text>
                            <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.primary, marginTop: 8 }}>
                              {overview.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Credit Value</Text>
                            <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success, marginTop: 8 }}>
                              {overview.totalCredits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Settlement Rate</Text>
                            <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.info, marginTop: 8 }}>
                              {(overview.paymentRate * 100).toFixed(1)}%
                            </div>
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <Card style={{ borderColor: REDWOOD.border }}>
                          <div style={{ textAlign: 'center' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Closed Invoices</Text>
                            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>
                              {overview.closedInvoices}
                            </div>
                          </div>
                        </Card>
                      </Col>
                    </Row>
                  </div>

                  <div>
                    <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>4 · CUSTOMER HEALTH SCORECARD</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 12, fontWeight: 600 }}>Payment Discipline</td>
                          <td style={{ padding: 12, textAlign: 'right' }}>
                            <Tag color={overview.paymentRate > 0.8 ? 'green' : overview.paymentRate > 0.5 ? 'orange' : 'red'}>
                              {overview.paymentRate > 0.8 ? 'Excellent' : overview.paymentRate > 0.5 ? 'Fair' : 'Poor'}
                            </Tag>
                          </td>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 12, fontWeight: 600 }}>DSO (Days Sales Outstanding)</td>
                          <td style={{ padding: 12, textAlign: 'right' }}>
                            {overview.openInvoiceCount > 0
                              ? Math.round(overview.openBalance / (overview.totalInvoiced / 365))
                              : 0} days
                          </td>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 12, fontWeight: 600 }}>Past Due Ratio</td>
                          <td style={{ padding: 12, textAlign: 'right' }}>
                            {overview.openBalance > 0
                              ? ((overview.pastDueBalance / overview.openBalance) * 100).toFixed(1)
                              : 0}%
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: 12, fontWeight: 600 }}>Credit Utilization</td>
                          <td style={{ padding: 12, textAlign: 'right' }}>
                            {overview.openCreditBalance !== 0
                              ? Math.abs(overview.openCreditBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : 'None'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            },
            {
              key: 'openitems',
              label: 'Open Items',
              children: (
                <div>
                  <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>5 · OPEN ITEMS DETAIL (oldest due date first)</Title>
                  {overview.openItems && overview.openItems.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                            <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Invoice #</th>
                            <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Date</th>
                            <th style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>Due Date</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Amount (MUR)</th>
                            <th style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>Balance (MUR)</th>
                            <th style={{ textAlign: 'center', padding: 6, fontWeight: 600 }}>Days Late</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.openItems.map((item: Row, idx: number) => (
                            <tr key={idx} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                              <td style={{ padding: 6 }}>{item['TransactionNumber']}</td>
                              <td style={{ padding: 6 }}>
                                {item['TransactionDate'] ? new Date(item['TransactionDate'] as string).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '-'}
                              </td>
                              <td style={{ padding: 6 }}>
                                {item['PaymentScheduleDueDate'] ? new Date(item['PaymentScheduleDueDate'] as string).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '-'}
                              </td>
                              <td style={{ textAlign: 'right', padding: 6 }}>
                                {(Number(item['TotalOriginalAmount']) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td style={{ textAlign: 'right', padding: 6, fontWeight: 600 }}>
                                {(Number(item['TotalBalanceAmount']) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td style={{ textAlign: 'center', padding: 6 }}>
                                <Tag color={Number(item['PaymentDaysLate']) > 0 ? 'red' : 'green'}>
                                  {item['PaymentDaysLate'] || 0}
                                </Tag>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty description="No open items" />
                  )}
                </div>
              ),
            },
            {
              key: 'notes',
              label: 'Data Notes',
              children: (
                <div>
                  <Title level={6} style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>6 · DATA QUALITY & METHOD NOTES</Title>
                  <div style={{ background: REDWOOD.neutral100, padding: 16, borderRadius: 8, lineHeight: 1.8 }}>
                    <p><strong>Data Source:</strong> Oracle Fusion Receivables - Customer Account Site Activities</p>
                    <p><strong>Reporting Period:</strong> All historical data available in the system</p>
                    <p><strong>Ageing Calculation:</strong> Based on Payment Due Date and Payment Days Late field</p>
                    <p><strong>Open Balance Definition:</strong> Invoice status = 'Open' with remaining balance amount</p>
                    <p><strong>Credit Memos:</strong> Negative amounts shown as credits available on account</p>
                    <p><strong>Duplicates:</strong> Data may include duplicate export rows - refer to source export for reconciliation</p>
                    <p><strong>Currency:</strong> All amounts in {overview.openItems?.[0]?.EnteredCurrency || 'MUR'}</p>
                    <p><strong>Last Updated:</strong> As of export date</p>
                    <p style={{ marginTop: 16, fontSize: 12, color: REDWOOD.primary }}>
                      ℹ️ This report is generated from the loaded AR Invoices, Credit Memos, and related transaction data.
                      For reconciliation with Oracle Fusion, verify record counts and amounts against the source export.
                    </p>
                  </div>
                </div>
              ),
            },
          ];

          return <Tabs items={overviewTabs} style={{ background: REDWOOD.surface }} />;
        })())}
      </Modal>

      <Modal
        open={accountStatementVisible}
        onCancel={() => setAccountStatementVisible(false)}
        width={700}
        title={<Space><FileTextOutlined style={{ color: REDWOOD.primary }} /> Account Statement</Space>}
        footer={[
          <Button key="close" onClick={() => setAccountStatementVisible(false)}>Close</Button>,
          <Button key="print" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>,
          <Button key="email" icon={<MailOutlined />} onClick={sendAccountStatementByEmail}>Email</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={generateAccountStatementPDF}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
            Download
          </Button>,
        ]}
      >
        {accountStatementData && selectedCustomerForStatement && (
          <div style={{ fontFamily: 'sans-serif' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Title level={3} style={{ margin: '0 0 12px 0' }}>ACCOUNT STATEMENT</Title>
              <Divider style={{ margin: 0 }} />
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <div>
                  <Text strong>Customer:</Text>
                  <div style={{ color: '#666' }}>{selectedCustomerForStatement.name}</div>
                </div>
              </Col>
              <Col span={12}>
                <div>
                  <Text strong>Account Number:</Text>
                  <div style={{ color: '#666' }}>{selectedCustomerForStatement.accountNumber}</div>
                </div>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <div>
                  <Text strong>Statement Date:</Text>
                  <div style={{ color: '#666' }}>
                    {new Date(accountStatementData.statementDate).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'long', day: '2-digit'
                    })}
                  </div>
                </div>
              </Col>
              <Col span={12}>
                <div>
                  <Text strong>Due Amount:</Text>
                  <div style={{
                    color: (accountStatementData.balance as number) > 0 ? REDWOOD.error : REDWOOD.success,
                    fontSize: 16,
                    fontWeight: 600
                  }}>
                    {formatVal('amount', accountStatementData.balance)}
                  </div>
                </div>
              </Col>
            </Row>

            <Card style={{ borderColor: REDWOOD.border, marginBottom: 16 }}>
              <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>ACCOUNT SUMMARY</Text>
              <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
                <Col xs={12}>
                  <div style={{ padding: 8, background: '#fafafa', borderRadius: 4, borderLeft: `3px solid ${REDWOOD.primary}` }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Total Invoices</Text>
                    <div><Text strong style={{ fontSize: 14 }}>{accountStatementData.invoiceCount}</Text></div>
                    <Text type="secondary" style={{ fontSize: 10 }}>Amount: {formatVal('amount', accountStatementData.invoiceTotal)}</Text>
                  </div>
                </Col>
                <Col xs={12}>
                  <div style={{ padding: 8, background: '#fafafa', borderRadius: 4, borderLeft: `3px solid ${REDWOOD.success}` }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Total Payments</Text>
                    <div><Text strong style={{ fontSize: 14, color: REDWOOD.success }}>{accountStatementData.paymentCount}</Text></div>
                    <Text type="secondary" style={{ fontSize: 10 }}>Amount: {formatVal('amount', accountStatementData.paymentTotal)}</Text>
                  </div>
                </Col>
              </Row>
              <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
                <Col xs={12}>
                  <div style={{ padding: 8, background: '#fafafa', borderRadius: 4, borderLeft: `3px solid ${REDWOOD.info}` }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Credit Memos</Text>
                    <div><Text strong style={{ fontSize: 14 }}>{accountStatementData.creditMemoCount}</Text></div>
                    <Text type="secondary" style={{ fontSize: 10 }}>Amount: {formatVal('amount', accountStatementData.creditMemoTotal)}</Text>
                  </div>
                </Col>
                <Col xs={12}>
                  <div style={{ padding: 8, background: '#fafafa', borderRadius: 4, borderLeft: `3px solid ${REDWOOD.warning}` }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Adjustments</Text>
                    <div><Text strong style={{ fontSize: 14 }}>{accountStatementData.adjustmentCount}</Text></div>
                    <Text type="secondary" style={{ fontSize: 10 }}>Amount: {formatVal('amount', accountStatementData.adjustmentTotal)}</Text>
                  </div>
                </Col>
              </Row>
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, fontSize: 16, fontWeight: 600 }}>
                <Text strong>Open Receivables:</Text>
                <Text strong style={{ color: (accountStatementData.balance as number) > 0 ? REDWOOD.error : REDWOOD.success }}>
                  {formatVal('amount', accountStatementData.balance)}
                </Text>
              </div>
            </Card>

            <div style={{ fontSize: 12, color: '#666', textAlign: 'center', borderTop: `1px solid ${REDWOOD.border}`, paddingTop: 12 }}>
              <Text type="secondary">
                This statement reflects all recorded transactions as of the statement date.
              </Text>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!childApiDebugVisible}
        onCancel={() => setChildApiDebugVisible(null)}
        footer={null}
        width={1000}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> API Debug - {childApiDebugVisible?.childName}</Space>}
      >
        {childApiDebugVisible && detailApiDebug[childApiDebugVisible.tabKey] ? (
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>URLs Called:</Text>
              {detailApiDebug[childApiDebugVisible.tabKey].urls.map((url, idx) => (
                <div key={idx} style={{ marginBottom: 8, padding: '8px', background: '#f5f5f5', borderRadius: 4 }}>
                  <Tag color="blue">GET {idx + 1}</Tag>
                  <Text copyable style={{ fontSize: 11, wordBreak: 'break-all' }}>{url}</Text>
                </div>
              ))}
            </div>
            <Divider />
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">Status for {childApiDebugVisible.childName}: </Text>
              {detailApiDebug[childApiDebugVisible.tabKey].statuses[childApiDebugVisible.childName] === null ? <Tag>Pending…</Tag>
                : detailApiDebug[childApiDebugVisible.tabKey].statuses[childApiDebugVisible.childName]! > 0 ? <Tag color={detailApiDebug[childApiDebugVisible.tabKey].statuses[childApiDebugVisible.childName]! < 300 ? 'green' : 'red'}>{detailApiDebug[childApiDebugVisible.tabKey].statuses[childApiDebugVisible.childName]}</Tag>
                : <Tag color="red">Error</Tag>}
            </div>
            <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <Text strong>Response</Text>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(detailApiDebug[childApiDebugVisible.tabKey].responses[childApiDebugVisible.childName]);
                  message.success('Copied');
                }}
              >
                Copy
              </Button>
            </div>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 500, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {detailApiDebug[childApiDebugVisible.tabKey].responses[childApiDebugVisible.childName] || 'No response'}
            </pre>
          </div>
        ) : <Empty description="No API debug information available" />}
      </Modal>
    </Layout>
  );
};

export default CustomerSiteActivities;
