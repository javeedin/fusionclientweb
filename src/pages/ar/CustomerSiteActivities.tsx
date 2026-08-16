import React, { useState, useCallback, useMemo } from 'react';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tabs,
  Breadcrumb, Spin, message, Empty, Modal, Tag, Badge, Divider, Row, Col,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, DownloadOutlined,
  EyeOutlined, ApiOutlined, CopyOutlined, SyncOutlined, FilterOutlined,
  FileTextOutlined, MailOutlined, PrinterOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType, TableRowSelection, ColumnType } from 'antd/es/table/interface';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
import { ORACLE_FUSION_CONFIG } from '../../config/api.config';

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
  neutral600:   '#6B6B6B',
  surface:      '#FFFFFF',
  border:       '#E5E5E5',
};

const FUSION_AUTH = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
const FUSION_BASE = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesCustomerAccountSiteActivities`;

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

// Aging bucket calculator
const getAgingBucket = (days: number | null | undefined): string => {
  if (days === null || days === undefined || days === '') return '-';
  const d = Number(days);
  if (d <= 30) return 'Current';
  if (d <= 60) return '31-60';
  if (d <= 90) return '61-90';
  return '90+';
};

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

  // Filter states for AR Invoices and Credit Memos
  const [arInvoicesFilters, setArInvoicesFilters] = useState<Record<string, 'Open' | 'Closed' | 'ALL'>>({});
  const [creditMemosFilters, setCreditMemosFilters] = useState<Record<string, 'Open' | 'Closed' | 'ALL'>>({});

  // Account Statement modal state
  const [accountStatementVisible, setAccountStatementVisible] = useState(false);
  const [accountStatementData, setAccountStatementData] = useState<Row | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<{ name: string; accountNumber: string } | null>(null);

  // ── Search Fusion ────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const values = form.getFieldsValue();
    const filters: string[] = [];
    if (values.CustomerName)    filters.push(`CustomerName like "%${values.CustomerName}%"`);
    if (values.AccountNumber)   filters.push(`AccountNumber like "%${values.AccountNumber}%"`);
    if (values.BillToSiteNumber) filters.push(`BillToSiteNumber like "%${values.BillToSiteNumber}%"`);

    const LIMIT = 500;
    const baseUrl = `${FUSION_BASE}?limit=${LIMIT}${filters.length ? `&q=${encodeURIComponent(filters.join(' AND '))}` : ''}`;
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
        const res = await fetch(url, { headers: { Authorization: FUSION_AUTH } });
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
              const url = `${FUSION_BASE}/${siteId}/child/${childName}?limit=${LIMIT}&offset=${offset}`;
              const res = await fetch(url, { headers: { Authorization: FUSION_AUTH } });
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

  // ── Handle Account Statement ────────────────────────────────────────
  const handleShowAccountStatement = useCallback(async () => {
    if (!selectedRowKeys.length) { message.warning('Select at least one customer site first'); return; }

    const selected = fusionData.filter(r => selectedRowKeys.includes(String(r['BillToSiteUseId'])));
    if (!selected.length) return;

    const firstSite = selected[0];
    setSelectedCustomer({
      name: firstSite['CustomerName'] as string,
      accountNumber: firstSite['AccountNumber'] as string,
    });

    // Compile statement data from all activities
    const statementData: Row = {
      statementDate: new Date().toISOString().split('T')[0],
      customerName: firstSite['CustomerName'],
      accountNumber: firstSite['AccountNumber'],
      billToSiteNumber: firstSite['BillToSiteNumber'],
      currency: firstSite['Currency'] || 'MUR',
    };

    // Calculate totals from loaded activities - handle different field names
    const invoiceData = childStates['transactionPaymentSchedules']?.data || [];
    const invoiceTotal = invoiceData.reduce((sum: number, row: Row) => {
      const balance = row['TotalBalanceAmount'] as number || row['TotalOriginalAmount'] as number || 0;
      return sum + (typeof balance === 'number' ? balance : 0);
    }, 0);

    const receiptData = childStates['standardReceipts']?.data || [];
    const paymentTotal = receiptData.reduce((sum: number, row: Row) => {
      const amount = row['ReceiptAmount'] as number || row['ApplicationAmount'] as number || 0;
      return sum + (typeof amount === 'number' ? amount : 0);
    }, 0);

    const creditMemoData = childStates['creditMemos']?.data || [];
    const creditMemoTotal = creditMemoData.reduce((sum: number, row: Row) => {
      const amount = row['TotalBalanceAmount'] as number || row['TotalOriginalAmount'] as number || 0;
      return sum + (typeof amount === 'number' ? Math.abs(amount) : 0);
    }, 0);

    const adjustmentData = childStates['transactionAdjustments']?.data || [];
    const adjustmentTotal = adjustmentData.reduce((sum: number, row: Row) => {
      const amount = row['AdjustmentAmount'] as number || 0;
      return sum + (typeof amount === 'number' ? amount : 0);
    }, 0);

    const openBalance = invoiceTotal - paymentTotal - creditMemoTotal + adjustmentTotal;

    statementData.invoiceCount = invoiceData.length;
    statementData.invoiceTotal = invoiceTotal;
    statementData.paymentTotal = paymentTotal;
    statementData.paymentCount = receiptData.length;
    statementData.creditMemoTotal = creditMemoTotal;
    statementData.creditMemoCount = creditMemoData.length;
    statementData.adjustmentTotal = adjustmentTotal;
    statementData.adjustmentCount = adjustmentData.length;
    statementData.balance = openBalance;
    statementData.avgDaysLate = firstSite['AverageDaysLate'] || 0;

    setAccountStatementData(statementData);
    setAccountStatementVisible(true);
  }, [selectedRowKeys, fusionData, childStates]);

  // ── Generate PDF for Account Statement ──────────────────────────────
  const generateAccountStatementPDF = useCallback(() => {
    if (!accountStatementData || !selectedCustomer) return;

    const docWidth = 210;
    const docHeight = 297;
    const margin = 15;
    const lineHeight = 7;
    let yPos = margin;

    const doc: any = {
      content: '',
      addText: (text: string, x: number, y: number, size: number = 12, bold: boolean = false) => {
        doc.content += `${text}\n`;
      },
      save: (filename: string) => {
        const blob = new Blob([doc.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      },
    };

    doc.content = `ACCOUNT STATEMENT\n`;
    doc.content += `=====================================\n\n`;
    doc.content += `Customer: ${selectedCustomer.name}\n`;
    doc.content += `Account Number: ${selectedCustomer.accountNumber}\n`;
    doc.content += `Statement Date: ${new Date(accountStatementData.statementDate as string).toLocaleDateString()}\n\n`;
    doc.content += `SUMMARY\n`;
    doc.content += `-------------------------------------\n`;
    doc.content += `Invoices:        ${formatVal('amount', accountStatementData.invoiceTotal)}\n`;
    doc.content += `Payments:        -${formatVal('amount', accountStatementData.paymentTotal)}\n`;
    doc.content += `Credit Memos:    -${formatVal('amount', accountStatementData.creditMemoTotal)}\n`;
    doc.content += `Adjustments:     ${formatVal('amount', accountStatementData.adjustmentTotal)}\n`;
    doc.content += `-------------------------------------\n`;
    doc.content += `Balance Due:     ${formatVal('amount', accountStatementData.balance)}\n`;

    doc.save(`AccountStatement_${selectedCustomer.accountNumber}.txt`);
    message.success('Account statement downloaded');
  }, [accountStatementData, selectedCustomer]);

  // ── Send Account Statement by Email ───────────────────────────────
  const sendAccountStatementByEmail = useCallback(() => {
    if (!selectedCustomer) return;

    const emailSubject = `Account Statement - ${selectedCustomer.accountNumber}`;
    const emailBody = `
Customer: ${selectedCustomer.name}
Account Number: ${selectedCustomer.accountNumber}
Statement Date: ${new Date(accountStatementData?.statementDate as string).toLocaleDateString()}

SUMMARY:
Invoices: ${formatVal('amount', accountStatementData?.invoiceTotal)}
Payments: -${formatVal('amount', accountStatementData?.paymentTotal)}
Credit Memos: -${formatVal('amount', accountStatementData?.creditMemoTotal)}
Adjustments: ${formatVal('amount', accountStatementData?.adjustmentTotal)}

Balance Due: ${formatVal('amount', accountStatementData?.balance)}
    `;

    const mailtoLink = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoLink;
    message.info('Opening default email client...');
  }, [selectedCustomer, accountStatementData]);

  const rowSelection: TableRowSelection<Row> = {
    selectedRowKeys,
    onChange: keys => setSelectedRowKeys(keys),
  };

  const childTabItems = CHILD_NAMES.map(cn => {
    const state = childStates[cn] || { loading: false, data: [], columns: [] };
    const isArInvoices = cn === 'transactionPaymentSchedules';
    const isCreditMemos = cn === 'creditMemos';
    const arCurrentStatus = arInvoicesFilters[selectedRowKeys[0]?.toString() || ''] || 'Open';
    const cmCurrentStatus = creditMemosFilters[selectedRowKeys[0]?.toString() || ''] || 'Open';

    // Calculate aging data for AR Invoices
    const agingBuckets = isArInvoices ? { Current: 0, '31-60': 0, '61-90': 0, '90+': 0 } : null;
    if (isArInvoices && agingBuckets) {
      state.data.forEach((row: Row) => {
        const days = row['PaymentDaysLate'];
        const amount = (row['TotalBalanceAmount'] || 0) as number;
        const b = getAgingBucket(days);
        if (b !== '-' && agingBuckets.hasOwnProperty(b)) {
          (agingBuckets as Record<string, number>)[b] += amount;
        }
      });
    }

    // Calculate monthly data for AR Invoices
    const monthlyData: Record<string, { count: number; amount: number }> = {};
    if (isArInvoices) {
      state.data.forEach((row: Row) => {
        const dateStr = row['TransactionDate'] as string;
        if (!dateStr) return;
        const monthKey = dateStr.substring(0, 7);
        if (!monthlyData[monthKey]) monthlyData[monthKey] = { count: 0, amount: 0 };
        monthlyData[monthKey].count += 1;
        monthlyData[monthKey].amount += Number(row['TotalOriginalAmount']) || 0;
      });
    }

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

          {(isArInvoices || isCreditMemos) && (
            <div style={{ marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Text strong style={{ fontSize: 13 }}>Filter by Status:</Text>
              <Space size={0}>
                {(['Open', 'Closed', 'ALL'] as const).map(status => (
                  <Button
                    key={status}
                    type={isArInvoices ? (arCurrentStatus === status ? 'primary' : 'default') : (cmCurrentStatus === status ? 'primary' : 'default')}
                    size="small"
                    onClick={() => {
                      if (isArInvoices) setArInvoicesFilters(prev => ({ ...prev, [selectedRowKeys[0]?.toString() || '']: status }));
                      if (isCreditMemos) setCreditMemosFilters(prev => ({ ...prev, [selectedRowKeys[0]?.toString() || '']: status }));
                    }}
                  >
                    {status}
                  </Button>
                ))}
              </Space>
            </div>
          )}

          <FilteredTable data={state.data} columns={state.columns} loading={state.loading}
            emptyText="Select customers in the first tab and click Load Activities" />

          {isArInvoices && state.data.length > 0 && agingBuckets && (
            <Card style={{ borderColor: REDWOOD.border, marginTop: 20, marginBottom: 16 }} title={<Text strong>Aging Analysis</Text>}>
              <Row gutter={[16, 16]}>
                {['Current', '31-60', '61-90', '90+'].map((bucket: string) => {
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
                        <div style={{ fontSize: 18, fontWeight: 700, color: bucketColor }}>
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
          )}

          {isArInvoices && state.data.length > 0 && Object.keys(monthlyData).length > 0 && (
            <Card style={{ borderColor: REDWOOD.border }} title={<Text strong>Monthly Activity Trend</Text>}>
              {(() => {
                const sortedMonths = Object.keys(monthlyData).sort().reverse().slice(0, 12);
                const maxAmount = Math.max(...sortedMonths.map(m => monthlyData[m].amount), 1);
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 200, marginBottom: 20, justifyContent: 'space-around' }}>
                      {sortedMonths.slice(0, 6).map(month => {
                        const pct = (monthlyData[month].amount / maxAmount) * 100;
                        return (
                          <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{
                              width: '100%',
                              height: pct + '%',
                              background: `linear-gradient(180deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                              borderRadius: '4px 4px 0 0',
                              minHeight: 4,
                            }} title={formatVal('amount', monthlyData[month].amount)} />
                            <Text style={{ fontSize: 11, textAlign: 'center' }}>{month}</Text>
                          </div>
                        );
                      })}
                    </div>
                    <Row gutter={[16, 16]}>
                      {sortedMonths.map(month => (
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
                            <Text style={{ fontSize: 12, display: 'block', marginTop: 4, fontWeight: 600, color: REDWOOD.primary }}>
                              {formatVal('amount', monthlyData[month].amount)}
                            </Text>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </div>
                );
              })()}
            </Card>
          )}
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
                <Button icon={<FileTextOutlined />}
                  style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary }}
                  onClick={handleShowAccountStatement}
                  disabled={Object.keys(childStates).every(k => childStates[k].data.length === 0)}>
                  Account Statement
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
            Download PDF
          </Button>,
        ]}
      >
        {accountStatementData && selectedCustomer && (
          <div style={{ fontFamily: 'sans-serif' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Title level={3} style={{ margin: '0 0 12px 0' }}>ACCOUNT STATEMENT</Title>
              <Divider style={{ margin: 0 }} />
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <div>
                  <Text strong>Customer:</Text>
                  <div style={{ color: REDWOOD.neutral600 }}>{selectedCustomer.name}</div>
                </div>
              </Col>
              <Col span={12}>
                <div>
                  <Text strong>Account Number:</Text>
                  <div style={{ color: REDWOOD.neutral600 }}>{selectedCustomer.accountNumber}</div>
                </div>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <div>
                  <Text strong>Statement Date:</Text>
                  <div style={{ color: REDWOOD.neutral600 }}>
                    {new Date(accountStatementData.statementDate as string).toLocaleDateString('en-US', {
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
              {(accountStatementData.avgDaysLate as number) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 8, borderTop: `1px solid ${REDWOOD.border}` }}>
                  <Text type="secondary">Average Days Late:</Text>
                  <Text style={{ color: (accountStatementData.avgDaysLate as number) > 30 ? REDWOOD.warning : REDWOOD.neutral600 }}>
                    {accountStatementData.avgDaysLate} days
                  </Text>
                </div>
              )}
            </Card>

            <div style={{ fontSize: 12, color: REDWOOD.neutral600, textAlign: 'center', borderTop: `1px solid ${REDWOOD.border}`, paddingTop: 12 }}>
              <Text type="secondary">
                This statement reflects all recorded transactions as of the statement date.
              </Text>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default CustomerSiteActivities;
