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

function SiteResultsTable({ data, columns, loading }: {
  data: Row[]; columns: ColumnsType<Row>; loading?: boolean;
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
        <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input prefix={<SearchOutlined style={{ color: '#aaa' }} />} placeholder="Filter results..."
            value={filter} onChange={e => setFilter(e.target.value)}
            allowClear style={{ width: 280 }} size="small" />
          <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} / {data.length} rows</Text>
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
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200, 500, 1000],
          showTotal: t => `Total ${t} sites`,
        }}
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

  const [detailsTabs, setDetailsTabs] = useState<Array<{ key: string; site: Row }>>([]);
  const [activeDetailTab, setActiveDetailTab] = useState<string>('');
  const [childStates, setChildStates] = useState<Record<string, Record<string, ChildState>>>({});
  const [balanceFilter, setBalanceFilter] = useState<Record<string, boolean>>({});

  const [apiDebug, setApiDebug] = useState<ApiDebug | null>(null);
  const [apiDebugVisible, setApiDebugVisible] = useState(false);

  // ── Search Fusion ────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const values = form.getFieldsValue();
    const filters: string[] = [];
    if (values.CustomerName)    filters.push(`CustomerName like "%${values.CustomerName}%"`);
    if (values.AccountNumber)   filters.push(`AccountNumber like "%${values.AccountNumber}%"`);
    if (values.BillToSiteNumber) filters.push(`BillToSiteNumber like "%${values.BillToSiteNumber}%"`);

    const LIMIT = 500;
    const fusionBase = getFusionBase();
    const baseUrl = `${fusionBase}?onlyData=true&limit=${LIMIT}${filters.length ? `&q=${encodeURIComponent(filters.join(' AND '))}` : ''}`;
    const firstUrl = `${baseUrl}&offset=0`;

    setApiDebug({ url: firstUrl, status: null, response: '' });
    setSearchLoading(true);
    try {
      let offset = 0;
      let hasMore = true;
      let allItems: Row[] = [];
      let lastStatus = 0;
      let lastJson: unknown = null;

      while (hasMore) {
        const url = `${baseUrl}&offset=${offset}`;
        const res = await fetch(url, { headers: getFusionAuthHeaders() });
        const text = await res.text();
        let json: { items?: Row[]; hasMore?: boolean };
        try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON (HTTP ${res.status}): ${text.substring(0, 300)}`); }
        lastStatus = res.status;
        lastJson = json;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const page = (json.items || []).map(item => {
          const r: Row = {};
          Object.keys(item).filter(k => k !== 'links').forEach(k => { r[k] = item[k]; });
          return r;
        });
        allItems = allItems.concat(page);
        hasMore = !!json.hasMore && page.length === LIMIT;
        offset += LIMIT;
      }

      setApiDebug({ url: firstUrl, status: lastStatus, response: JSON.stringify(lastJson, null, 2) });
      setFusionData(allItems);

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
      if (!allItems.length) message.info('No results found');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiDebug(prev => prev ? { ...prev, status: -1, response: msg } : null);
      message.error(`Search failed: ${msg}`);
    } finally {
      setSearchLoading(false);
    }
  }, [form]);

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

          while (hasMore) {
            const url = `${fusionBase}/${siteId}/child/${childName}?limit=${LIMIT}&offset=${offset}`;
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
          allResults[childName].push(...allItems);
        } catch { /* skip */ }
      })
    );

    const finalStates: Record<string, ChildState> = {};
    CHILD_NAMES.forEach(cn => {
      const data = allResults[cn];
      finalStates[cn] = { loading: false, data, columns: buildColumns(data) };
    });
    setChildStates(prev => ({ ...prev, [tabKey]: finalStates }));
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

  const buildDetailsTabItems = () => {
    return detailsTabs.map(({ key, site }) => {
      const siteChildStates = childStates[key] || {};
      const filterBalances = balanceFilter[key] !== false; // default true

      // Build child activity tabs
      const childTabItems = CHILD_NAMES.map(cn => {
        const state = siteChildStates[cn] || { loading: false, data: [], columns: [] };

        // Filter data by balance if enabled
        const filteredData = filterBalances
          ? state.data.filter(row => {
              const balance = row['TotalOpenReceivablesForSite'];
              return balance !== null && balance !== undefined && balance !== 0;
            })
          : state.data;

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
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Checkbox
                    checked={filterBalances}
                    onChange={(e) => setBalanceFilter(prev => ({ ...prev, [key]: e.target.checked }))}
                  >
                    Records with Balances
                  </Checkbox>
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

      return {
        key,
        label: (
          <span>
            {site['CustomerName']?.substring(0, 20)}
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
    </Layout>
  );
};

export default CustomerSiteActivities;
