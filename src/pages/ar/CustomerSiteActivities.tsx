import React, { useState, useCallback, useMemo } from 'react';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tabs,
  Breadcrumb, Spin, message, Empty, Modal, Tag, Badge, Checkbox, Row, Col,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, DownloadOutlined,
  EyeOutlined, ApiOutlined, CopyOutlined, SyncOutlined, FilterOutlined, ShoppingOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType, TableRowSelection, ColumnType } from 'antd/es/table/interface';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
import { getFusionAuthHeaders } from '../../config/api.helper';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
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
      <div style={{ padding: 8, minWidth: 200 }}>
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

function buildColumns(items: Row[], extraFirst?: { key: string; title: string }): ColumnsType<Row> {
  if (!items.length) return [];
  const keys = Object.keys(items[0]).filter(k => k !== 'links' && k !== '_customerName');
  const cols: ColumnsType<Row> = keys.map(key =>
    makeColWithFilter(key, key.replace(/([A-Z])/g, ' $1').trim())
  );
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
        pagination={false}
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

  // ── Load page data ──────────────────────────────────────────────
  const loadPage = useCallback(async (pageNum: number) => {
    const offset = (pageNum - 1) * PAGE_SIZE;
    const filters: string[] = [];
    if (searchFilters.CustomerName) filters.push(`CustomerName LIKE '${searchFilters.CustomerName}%'`);
    if (searchFilters.AccountNumber) filters.push(`AccountNumber LIKE '${searchFilters.AccountNumber}%'`);
    if (searchFilters.BillToSiteNumber) filters.push(`BillToSiteNumber LIKE '${searchFilters.BillToSiteNumber}%'`);

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
    setSearchFilters({
      CustomerName: values.CustomerName || '',
      AccountNumber: values.AccountNumber || '',
      BillToSiteNumber: values.BillToSiteNumber || '',
    });
    setCurrentPage(1);
    setTotalRecords(0);
    setHasMore(false);

    // Load first page with new filters
    await loadPage(1);
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
    await Promise.all(
      CHILD_NAMES.map(async childName => {
        try {
          const LIMIT = 500;
          let offset = 0;
          let hasMore = true;
          const allItems: Row[] = [];
          let lastStatus = 0;
          let lastJson: unknown = null;

          while (hasMore) {
            const url = `${fusionBase}/${siteId}/child/${childName}?limit=${LIMIT}&offset=${offset}`;
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
      finalStates[cn] = { loading: false, data, columns: buildColumns(data) };
    });
    setChildStates(prev => ({ ...prev, [tabKey]: finalStates }));

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

  // ── Receivables Overview Calculations ──────────────────────────
  const computeOverviewData = (customerKey?: string | null) => {
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

    return { openBalance, openInvoiceCount, openCreditBalance, openCreditCount, netOpen, pastDueBalance, ageingBuckets, yearData };
  };

  const buildDetailsTabItems = () => {
    return detailsTabs.map(({ key, site }) => {
      const siteChildStates = childStates[key] || {};

      // Build child activity tabs
      const childTabItems = CHILD_NAMES.map(cn => {
        const state = siteChildStates[cn] || { loading: false, data: [], columns: [] };
        const filteredData = state.data;

        // Build columns with sorting
        let cols = buildColumns(filteredData);

        // Add Aging Bucket column for AR Invoices tab
        if (cn === 'transactionPaymentSchedules') {
          cols.push({
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

        cols = cols.map(col => ({
          ...col,
          sorter: (a: Row, b: Row) => {
            const aVal = a[col.dataIndex as string];
            const bVal = b[col.dataIndex as string];
            if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
            return String(aVal || '').localeCompare(String(bVal || ''));
          },
        }));

        // Calculate totals
        const totals: Record<string, number> = {};
        filteredData.forEach(row => {
          Object.keys(row).forEach(k => {
            if (typeof row[k] === 'number') {
              totals[k] = (totals[k] || 0) + row[k];
            }
          });
        });

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
              {!state.loading && state.data.length > 0 && (
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => exportToExcel(filteredData, cn)}>Export to Excel</Button>
                </div>
              )}
              <Table
                dataSource={filteredData}
                columns={cols}
                rowKey={(_r, i) => String(i)}
                loading={state.loading}
                size="small"
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `Total ${t} records` }}
                footer={() =>
                  Object.keys(totals).length > 0 ? (
                    <div style={{ fontWeight: 600, color: REDWOOD.primary }}>
                      Totals: {Object.entries(totals).map(([k, v]) => `${k}: ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' | ')}
                    </div>
                  ) : undefined
                }
              />
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
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Open Receivables</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.primary, marginTop: 8 }}>
                      {formatVal('amount', site['TotalOpenReceivablesForSite'])}
                    </div>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Transactions Due</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.info, marginTop: 8 }}>
                      {formatVal('amount', site['TotalTransactionsDueForSite'])}
                    </div>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Invoices</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.success, marginTop: 8 }}>
                      {arInvoicesState.data.length}
                    </div>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card style={{ borderColor: REDWOOD.border }}>
                  <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Avg Days Late</Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.warning, marginTop: 8 }}>
                      {arInvoicesState.data.length > 0
                        ? Math.round(arInvoicesState.data.reduce((sum, r) => sum + (Number(r['PaymentDaysLate']) || 0), 0) / arInvoicesState.data.length)
                        : 0}
                    </div>
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
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button type="primary" size="large" onClick={() => { setOverviewCustomerKey(key); setReceivablesOverviewVisible(true); }}
                      style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, width: '100%' }}>
                      📊 RECEIVABLES OVERVIEW
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
            { title: <Link to="/ar">Accounts Receivable</Link> },
            { title: 'Customer Site Activities' },
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
        title="RECEIVABLES OVERVIEW">
        {(() => {
          const overview = computeOverviewData();
          if (!overview) return <Empty description="No data available" />;
          const overviewTabs = [
            {
              key: 'overview',
              label: 'Overview',
              children: (
                <div>
                  <div style={{ marginBottom: 24 }}>
                    <Title level={5} style={{ marginBottom: 16 }}>1 · CURRENT BALANCE POSITION</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                          <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Item</th>
                          <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Amount (MUR)</th>
                          <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 8 }}>Open invoice balance</td>
                          <td style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>{overview.openBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{overview.openInvoiceCount}</td>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ padding: 8 }}>Unapplied credit memos</td>
                          <td style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>{overview.openCreditBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{overview.openCreditCount}</td>
                        </tr>
                        <tr style={{ background: REDWOOD.neutral100 }}>
                          <td style={{ padding: 8, fontWeight: 700 }}>NET OPEN RECEIVABLES</td>
                          <td style={{ textAlign: 'right', padding: 8, fontWeight: 700, color: REDWOOD.primary }}>{overview.netOpen.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8, fontWeight: 700 }}>{overview.openInvoiceCount + overview.openCreditCount}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: 8 }}>— of which past due</td>
                          <td style={{ textAlign: 'right', padding: 8, color: REDWOOD.error }}>{overview.pastDueBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{overview.pastDueBalance > 0 ? overview.ageingBuckets['1-30 days'].count + overview.ageingBuckets['31-60 days'].count + overview.ageingBuckets['61-90 days'].count + overview.ageingBuckets['91-180 days'].count + overview.ageingBuckets['180+ days'].count : 0}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <Title level={5} style={{ marginBottom: 16 }}>2 · AGEING OF OPEN RECEIVABLES</Title>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                          <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Ageing bucket</th>
                          <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Amount (MUR)</th>
                          <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>% of open</th>
                          <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(overview.ageingBuckets).map(([bucket, data]) => (
                          <tr key={bucket} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                            <td style={{ padding: 8 }}>{bucket}</td>
                            <td style={{ textAlign: 'right', padding: 8 }}>{data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right', padding: 8 }}>{((data.amount / overview.openBalance) * 100).toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', padding: 8 }}>{data.count}</td>
                          </tr>
                        ))}
                        <tr style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
                          <td style={{ padding: 8 }}>Total</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{overview.openBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>100.0%</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{overview.openInvoiceCount}</td>
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
                <div>
                  <Title level={5} style={{ marginBottom: 16 }}>YEAR-BY-YEAR TRADING & PAYMENT HISTORY</Title>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${REDWOOD.border}` }}>
                        <th style={{ textAlign: 'center', padding: 8, fontWeight: 600 }}>Year</th>
                        <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Invoices</th>
                        <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Gross invoiced (MUR)</th>
                        <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Avg invoice</th>
                        <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Credit memos</th>
                        <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Credit value (MUR)</th>
                        <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Net sales (MUR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(overview.yearData).sort(([yearA], [yearB]) => parseInt(yearA) - parseInt(yearB)).map(([year, data]) => (
                        <tr key={year} style={{ borderBottom: `1px solid ${REDWOOD.border}` }}>
                          <td style={{ textAlign: 'center', padding: 8, fontWeight: 600 }}>{year}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{data.invoices}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{data.grossAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{data.invoices > 0 ? (data.grossAmount / data.invoices).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{data.creditCount}</td>
                          <td style={{ textAlign: 'right', padding: 8 }}>{data.creditAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>{(data.grossAmount + data.creditAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            },
          ];

          return <Tabs items={overviewTabs} style={{ background: REDWOOD.surface }} />;
        })()}
      </Modal>
    </Layout>
  );
};

export default CustomerSiteActivities;
