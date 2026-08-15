import React, { useState, useCallback, useMemo } from 'react';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tabs,
  Breadcrumb, Spin, message, Empty, Modal, Tag, Badge,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, DownloadOutlined,
  EyeOutlined, ApiOutlined, CopyOutlined, SyncOutlined, FilterOutlined,
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
  transactionPaymentSchedules:      'Payment Schedules',
  transactionsPaidByOtherCustomers: 'Paid by Others',
};
const CHILD_NAMES = Object.keys(CHILD_LABEL_MAP);

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

function SiteResultsTable({ data, columns, loading, rowSelection }: {
  data: Row[]; columns: ColumnsType<Row>; loading?: boolean; rowSelection?: TableRowSelection<Row>;
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
        rowSelection={rowSelection}
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

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeTab, setActiveTab] = useState('sites');
  const [childStates, setChildStates] = useState<Record<string, ChildState>>({});
  const [loadingActivities, setLoadingActivities] = useState(false);

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
    const baseUrl = `${fusionBase}?limit=${LIMIT}${filters.length ? `&q=${encodeURIComponent(filters.join(' AND '))}` : ''}`;
    const firstUrl = `${baseUrl}&offset=0`;

    setApiDebug({ url: firstUrl, status: null, response: '' });
    setSearchLoading(true);
    setSelectedRowKeys([]);
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
      setFusionColumns(buildColumns(allItems));
      if (!allItems.length) message.info('No results found');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiDebug(prev => prev ? { ...prev, status: -1, response: msg } : null);
      message.error(`Search failed: ${msg}`);
    } finally {
      setSearchLoading(false);
    }
  }, [form]);

  // ── Load child activities for selected rows ──────────────────────
  const handleLoadActivities = useCallback(async () => {
    if (!selectedRowKeys.length) { message.warning('Select at least one customer site first'); return; }
    const selected = fusionData.filter(r => selectedRowKeys.includes(String(r['BillToSiteUseId'])));

    const initStates: Record<string, ChildState> = {};
    CHILD_NAMES.forEach(cn => { initStates[cn] = { loading: true, data: [], columns: [] }; });
    setChildStates(initStates);
    setLoadingActivities(true);
    setActiveTab(CHILD_NAMES[0]);

    const allResults: Record<string, Row[]> = {};
    CHILD_NAMES.forEach(cn => { allResults[cn] = []; });

    const fusionBase = getFusionBase();
    await Promise.all(
      selected.flatMap(site =>
        CHILD_NAMES.map(async childName => {
          try {
            const siteId = site['BillToSiteUseId'];
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
                const r: Row = { _customerName: `${site['CustomerName']} (${site['BillToSiteNumber']})` };
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
      )
    );

    const finalStates: Record<string, ChildState> = {};
    CHILD_NAMES.forEach(cn => {
      const data = allResults[cn];
      finalStates[cn] = { loading: false, data, columns: buildColumns(data, { key: '_customerName', title: 'Customer' }) };
    });
    setChildStates(finalStates);
    setLoadingActivities(false);
  }, [selectedRowKeys, fusionData]);

  const rowSelection: TableRowSelection<Row> = {
    selectedRowKeys,
    onChange: keys => setSelectedRowKeys(keys),
  };

  const childTabItems = CHILD_NAMES.map(cn => {
    const state = childStates[cn] || { loading: false, data: [], columns: [] };
    return {
      key: cn,
      label: (
        <span>
          {CHILD_LABEL_MAP[cn]}
          {state.data.length > 0 && <Badge count={state.data.length} size="small" style={{ marginLeft: 6, background: REDWOOD.info }} />}
          {state.loading && <SyncOutlined spin style={{ marginLeft: 6, fontSize: 11 }} />}
        </span>
      ),
      children: (
        <div>
          {!state.loading && state.data.length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => exportToExcel(state.data, cn)}>Export to Excel</Button>
            </div>
          )}
          <FilteredTable data={state.data} columns={state.columns} loading={state.loading}
            emptyText="Select customers in the first tab and click Load Activities" />
        </div>
      ),
    };
  });

  const tabItems = [
    {
      key: 'sites',
      label: 'Customer Sites',
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

          {selectedRowKeys.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Space>
                <Text type="secondary">{selectedRowKeys.length} site(s) selected</Text>
                <Button type="primary" icon={<EyeOutlined />} loading={loadingActivities}
                  style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                  onClick={handleLoadActivities}>
                  Load Activities
                </Button>
              </Space>
            </div>
          )}

          <Card style={{ borderColor: REDWOOD.border }}>
            <SiteResultsTable
              data={fusionData}
              columns={fusionColumns}
              loading={searchLoading}
              rowSelection={rowSelection}
            />
          </Card>
        </div>
      ),
    },
    ...childTabItems,
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

          <Tabs activeKey={activeTab} onChange={setActiveTab} type="card" items={tabItems}
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
