import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout, Typography, Card, Button, Input, Space, Tag, Spin,
  Row, Col, Menu, Table, Alert, Tabs, Badge, Empty, message,
  Steps, Statistic, Divider, Collapse, Select, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BugOutlined, SearchOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ApiOutlined, ReloadOutlined, LinkOutlined, FilePdfOutlined,
  ShoppingOutlined, FileTextOutlined, TeamOutlined, InboxOutlined,
  DatabaseOutlined, AuditOutlined, DollarOutlined, CarOutlined,
  ExclamationCircleOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { FUSION_POD_AUTH } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';

const { Header, Content, Sider } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;
const { Option } = Select;

const BASE_URL    = `${getFusionBase()}`;
const AUTH_HEADER = FUSION_POD_AUTH;
const HDRS        = { Authorization: AUTH_HEADER, Accept: 'application/json' };

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1a7f37',
  warning:    '#b45309',
  error:      '#dc2626',
  info:       '#0369a1',
  purple:     '#7c3aed',
  neutral100: '#f5f5f5',
  neutral200: '#e5e5e5',
  neutral600: '#525252',
  neutral900: '#171717',
  bg:         '#fafafa',
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
const MODULES = [
  {
    key: 'purchase', label: 'Purchase', icon: <ShoppingOutlined />,
    features: [
      { key: 'po-360',         label: '360° PO Tracker'      },
      { key: 'purchase-orders', label: 'Purchase Orders'      },
      { key: 'receipts',        label: 'Receipts'             },
    ],
  },
  {
    key: 'ap', label: 'Accounts Payable', icon: <FileTextOutlined />,
    features: [
      { key: 'ap-invoices', label: 'Invoices' },
      { key: 'ap-payments', label: 'Payments' },
    ],
  },
  {
    key: 'suppliers', label: 'Suppliers', icon: <TeamOutlined />,
    features: [{ key: 'suppliers-list', label: 'Supplier List' }],
  },
  {
    key: 'inventory', label: 'Inventory', icon: <InboxOutlined />,
    features: [
      { key: 'inv-items',  label: 'Items'    },
      { key: 'inv-onhand', label: 'On-Hand'  },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: any): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const fmtNum = (v: any) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Filter out action/rel links — keep only child resource links
const extractChildLinks = (obj: any) =>
  (obj?.links || []).filter((l: any) =>
    l.rel !== 'self' && l.rel !== 'canonical' && l.rel !== 'describedby' &&
    l.rel !== 'action' && l.href && l.name
  );

const linkLabel = (name: string) =>
  name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();

const fetchAll = async (url: string): Promise<any[]> => {
  const items: any[] = [];
  let next: string | null = url;
  while (next) {
    const r = await fetch(next, { headers: HDRS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    (d.items || []).forEach((i: any) => items.push(i));
    const nextLink = (d.links || []).find((l: any) => l.rel === 'next');
    next = nextLink?.href ?? null;
  }
  return items;
};

// ── PO Header fields ──────────────────────────────────────────────────────────
const PO_HEADER_FIELDS = [
  { key: 'OrderNumber',        label: 'PO Number'        },
  { key: 'POHeaderId',         label: 'PO Header ID'     },
  { key: 'DocumentStatus',     label: 'Status'           },
  { key: 'Supplier',           label: 'Supplier'         },
  { key: 'SupplierNumber',     label: 'Supplier Number'  },
  { key: 'SupplierSite',       label: 'Supplier Site'    },
  { key: 'BuyerEmail',         label: 'Buyer Email'      },
  { key: 'Currency',           label: 'Currency'         },
  { key: 'OrderedAmount',      label: 'Ordered Amount'   },
  { key: 'ApprovedDate',       label: 'Approved Date'    },
  { key: 'CreationDate',       label: 'Creation Date'    },
  { key: 'BusinessUnitName',   label: 'Business Unit'    },
  { key: 'ProcurementBU',      label: 'Procurement BU'   },
  { key: 'ShipToLocation',     label: 'Ship-To Location' },
  { key: 'PaymentTerms',       label: 'Payment Terms'    },
  { key: 'Description',        label: 'Description'      },
  { key: 'FreezeFlagMeaning',  label: 'Frozen'           },
  { key: 'HoldFlagMeaning',    label: 'On Hold'          },
];

// ── Inventory transaction field labels ───────────────────────────────────────
const INV_TXN_FIELDS = [
  { key: 'TransactionId',            label: 'Transaction ID'       },
  { key: 'TransactionType',          label: 'Transaction Type'     },
  { key: 'TransactionDate',          label: 'Transaction Date'     },
  { key: 'Organization',             label: 'Organization'         },
  { key: 'ItemNumber',               label: 'Item Number'          },
  { key: 'ItemDescription',          label: 'Item Description'     },
  { key: 'TransactionQuantity',      label: 'Qty'                  },
  { key: 'TransactionUOM',           label: 'UOM'                  },
  { key: 'TransactionCost',          label: 'Unit Cost'            },
  { key: 'TransactionAmount',        label: 'Amount'               },
  { key: 'PurchaseOrderHeaderId',    label: 'PO Header ID'         },
  { key: 'PurchaseOrderNumber',      label: 'PO Number'            },
  { key: 'PurchaseOrderLineNumber',  label: 'PO Line'              },
  { key: 'ReceiptNumber',            label: 'Receipt Number'       },
  { key: 'Subinventory',             label: 'Subinventory'         },
  { key: 'Locator',                  label: 'Locator'              },
  { key: 'AccountingStatus',         label: 'Accounting Status'    },
  { key: 'TransferOrderHeaderNumber',label: 'Transfer Order'       },
  { key: 'CostGroup',                label: 'Cost Group'           },
  { key: 'ProjectNumber',            label: 'Project'              },
  { key: 'TaskNumber',               label: 'Task'                 },
  { key: 'CreatedBy',                label: 'Created By'           },
];

// ── Generic child tab ─────────────────────────────────────────────────────────
const ChildTab: React.FC<{ href: string; label: string }> = ({ href }) => {
  const [data,    setData]    = useState<any[]>([]);
  const [raw,     setRaw]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const doFetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(href, { headers: HDRS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setRaw(json);
      setData(json.items || (Array.isArray(json) ? json : [json]));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [href]);

  useEffect(() => { doFetch(); }, [doFetch]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin tip="Fetching…" /></div>;
  if (error)   return <Alert type="error" message={error} showIcon />;
  if (!data.length) return <Empty description="No records" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const firstItem = data[0];
  const scalarKeys = Object.keys(firstItem).filter(k =>
    (typeof firstItem[k] !== 'object' || firstItem[k] === null) && k !== 'links'
  );
  const cols: ColumnsType<any> = scalarKeys.slice(0, 14).map(k => ({
    title: <Text style={{ fontSize: 11, fontWeight: 600 }}>{k}</Text>,
    dataIndex: k, key: k, ellipsis: true, width: 150,
    render: (v: any) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmt(v)}</Text>,
  }));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={10}>
      <Row justify="space-between" align="middle">
        <Col><Text code style={{ fontSize: 10, wordBreak: 'break-all' }}>{href}</Text></Col>
        <Col>
          <Space>
            <Badge count={data.length} showZero color={REDWOOD.primary} />
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>records</Text>
            <Button size="small" icon={<ReloadOutlined />} onClick={doFetch}>Refresh</Button>
          </Space>
        </Col>
      </Row>
      <Table dataSource={data.map((i, x) => ({ ...i, _k: x }))} columns={cols} rowKey="_k"
        size="small" scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['50','200','500'] }} />
      <Collapse ghost items={[{ key: 'r', label: <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Raw JSON</Text>,
        children: <pre style={{ fontSize: 10, background: '#1e1e2e', color: '#cdd6f4', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: 320 }}>{JSON.stringify(raw, null, 2)}</pre> }]} />
    </Space>
  );
};

// ── Inventory Transactions section ────────────────────────────────────────────
const InvTxnSection: React.FC<{ items: any[]; loading: boolean; error: string; org: string }> = ({ items, loading, error, org }) => {
  if (loading) return <div style={{ textAlign: 'center', padding: 32 }}><Spin tip="Fetching inventory transactions…" /></div>;
  if (error)   return <Alert type="error" message={error} showIcon />;
  if (!items.length) return <Empty description="No inventory transactions found for this PO" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const totalQty    = items.reduce((s, i) => s + (Number(i.TransactionQuantity) || 0), 0);
  const totalAmt    = items.reduce((s, i) => s + (Number(i.TransactionAmount)   || 0), 0);
  const byType: Record<string, number> = {};
  items.forEach(i => { byType[i.TransactionType] = (byType[i.TransactionType] || 0) + 1; });

  const cols: ColumnsType<any> = INV_TXN_FIELDS.map(f => ({
    title: <Text style={{ fontSize: 11, fontWeight: 600 }}>{f.label}</Text>,
    dataIndex: f.key, key: f.key, ellipsis: true, width: 140,
    render: (v: any) => {
      if (f.key === 'TransactionAmount' || f.key === 'TransactionCost')
        return <Text style={{ fontSize: 11, fontFamily: 'monospace', textAlign: 'right', display: 'block' }}>{fmtNum(v)}</Text>;
      return <Text style={{ fontSize: 11 }}>{fmt(v)}</Text>;
    },
  }));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {/* KPI strip */}
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <Statistic title={<Text style={{ fontSize: 11 }}>Transactions</Text>} value={items.length} valueStyle={{ fontSize: 20, color: REDWOOD.info }} />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
            <Statistic title={<Text style={{ fontSize: 11 }}>Total Qty Received</Text>} value={totalQty} valueStyle={{ fontSize: 20, color: REDWOOD.success }} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" style={{ background: '#fefce8', border: '1px solid #fde68a' }}>
            <Statistic title={<Text style={{ fontSize: 11 }}>Total Amount</Text>} value={totalAmt} precision={2} valueStyle={{ fontSize: 20, color: REDWOOD.warning }} />
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small">
            <Text style={{ fontSize: 11, fontWeight: 600, color: REDWOOD.neutral600 }}>By Type</Text>
            <div style={{ marginTop: 4 }}>
              {Object.entries(byType).map(([t, c]) => (
                <Tag key={t} style={{ marginBottom: 2, fontSize: 11 }}>{t}: {c}</Tag>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
      <Table
        dataSource={items.map((i, x) => ({ ...i, _k: x }))}
        columns={cols} rowKey="_k" size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['50','200','500'], showTotal: t => `${t} transactions` }}
      />
    </Space>
  );
};

// ── 360° PO Tracker ───────────────────────────────────────────────────────────
const PO360Tracker: React.FC = () => {
  const [poNumber,  setPoNumber]  = useState('');
  const [org,       setOrg]       = useState('AMS');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [po,        setPo]        = useState<any>(null);
  const [childLinks,setChildLinks]= useState<any[]>([]);
  const [apiUrl,    setApiUrl]    = useState('');
  const [fetchedAt, setFetchedAt] = useState('');
  const [activeTab, setActiveTab] = useState('header');

  // Inventory transactions state
  const [invTxns,    setInvTxns]    = useState<any[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invError,   setInvError]   = useState('');
  const [invApiUrl,  setInvApiUrl]  = useState('');

  const fetchPO = useCallback(async () => {
    if (!poNumber.trim()) { message.warning('Enter a PO number'); return; }
    setLoading(true); setError('');
    setPo(null); setChildLinks([]); setInvTxns([]); setInvError('');
    setActiveTab('header');

    const q   = `OrderNumber="${poNumber.trim()}"`;
    const url = `${BASE_URL}/purchaseOrders?q=${encodeURIComponent(q)}&limit=1`;
    setApiUrl(url);

    try {
      const res  = await fetch(url, { headers: HDRS });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      const items: any[] = data.items || [];
      if (!items.length) { setError(`No PO found for "${poNumber.trim()}"`); setLoading(false); return; }

      const poData = items[0];
      setPo(poData);
      setFetchedAt(new Date().toLocaleString());
      setChildLinks(extractChildLinks(poData));

      // Now fetch inventory transactions using POHeaderId
      const headerId = poData.POHeaderId;
      if (headerId) {
        setInvLoading(true);
        const invUrl = `${BASE_URL}/inventoryCompletedTransactions?q=Organization=${encodeURIComponent(org)};PurchaseOrderHeaderId=${headerId};TransactionDate>=2010-01-01`;
        setInvApiUrl(invUrl);
        try {
          const invItems = await fetchAll(invUrl);
          setInvTxns(invItems);
        } catch (e: any) {
          setInvError(e.message);
        } finally {
          setInvLoading(false);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [poNumber, org]);

  // ── Lifecycle stage detection ────────────────────────────────────────────
  const stages = po ? [
    { title: 'Created',   status: 'finish'  as const, icon: <CheckCircleOutlined /> },
    { title: 'Approved',  status: po.ApprovedDate ? 'finish' as const : 'wait' as const, icon: po.ApprovedDate ? <CheckCircleOutlined /> : <ClockCircleOutlined /> },
    { title: 'Received',  status: invTxns.length  ? 'finish' as const : 'wait' as const, icon: invTxns.length  ? <CheckCircleOutlined /> : <ClockCircleOutlined /> },
    { title: 'Invoiced',  status: 'wait'    as const, icon: <ClockCircleOutlined /> },
    { title: 'Paid',      status: 'wait'    as const, icon: <ClockCircleOutlined /> },
    { title: 'GL Posted', status: 'wait'    as const, icon: <ClockCircleOutlined /> },
  ] : [];

  // ── Variance summary ────────────────────────────────────────────────────
  const orderedAmt  = Number(po?.OrderedAmount || 0);
  const receivedAmt = invTxns.reduce((s, i) => s + (Number(i.TransactionAmount) || 0), 0);
  const receiptVariance = orderedAmt - receivedAmt;

  // ── Tab items ────────────────────────────────────────────────────────────
  const tabItems = po ? [
    // ── Tab 1: Header ──────────────────────────────────────────────────
    {
      key: 'header',
      label: <Space size={4}><DatabaseOutlined />Header</Space>,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {/* Summary strip */}
          <Card size="small" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
            <Row gutter={24} align="middle">
              <Col><CheckCircleOutlined style={{ fontSize: 20, color: REDWOOD.success }} /></Col>
              <Col flex="auto">
                <Text strong style={{ fontSize: 14, color: REDWOOD.success }}>PO {po.OrderNumber}</Text>
                <br />
                <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                  {po.Supplier} · {po.BusinessUnitName} · {po.Currency} {fmtNum(po.OrderedAmount)}
                </Text>
              </Col>
              <Col>
                <Tag color={po.DocumentStatus === 'OPEN' ? 'green' : po.DocumentStatus === 'CLOSED' ? 'default' : 'orange'} style={{ fontSize: 12 }}>
                  {po.DocumentStatus}
                </Tag>
              </Col>
            </Row>
          </Card>
          <Table
            dataSource={PO_HEADER_FIELDS.map(f => ({ key: f.key, label: f.label, value: fmt(po[f.key]), raw: po[f.key] }))}
            columns={[
              { title: 'Field', dataIndex: 'label', width: 200,
                render: (v, r) => <Space direction="vertical" size={0}><Text style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral600 }}>{v}</Text><Text code style={{ fontSize: 10 }}>{r.key}</Text></Space> },
              { title: 'Value (from Fusion)', dataIndex: 'value',
                render: (v, r: any) => <Text style={{ fontSize: 12, color: r.raw == null ? '#aaa' : REDWOOD.neutral900, fontFamily: r.raw == null ? 'inherit' : 'monospace' }}>{v}</Text> },
            ]}
            size="small" pagination={false} rowKey="key"
          />
        </Space>
      ),
    },

    // ── Tab 2: Inventory / Receipts ────────────────────────────────────
    {
      key: 'inventory',
      label: (
        <Space size={4}>
          <CarOutlined />
          Receipts / Inventory
          {invTxns.length > 0 && <Badge count={invTxns.length} color={REDWOOD.success} size="small" />}
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {invApiUrl && (
            <div style={{ padding: '5px 10px', background: REDWOOD.neutral100, borderRadius: 4 }}>
              <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>API: </Text>
              <Text code style={{ fontSize: 10, wordBreak: 'break-all' }}>{invApiUrl}</Text>
            </div>
          )}
          <InvTxnSection items={invTxns} loading={invLoading} error={invError} org={org} />
        </Space>
      ),
    },

    // ── Child resource tabs (lines, schedules, distributions, attachments…) ──
    ...childLinks.map(cl => ({
      key:   cl.name,
      label: <Space size={4}><LinkOutlined />{linkLabel(cl.name)}</Space>,
      children: <ChildTab href={cl.href} label={cl.name} />,
    })),

    // ── Variance tab ────────────────────────────────────────────────────
    {
      key: 'variance',
      label: (
        <Space size={4}>
          <ExclamationCircleOutlined style={{ color: receiptVariance !== 0 && !invLoading ? REDWOOD.warning : 'inherit' }} />
          Variance
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Row gutter={16}>
            <Col span={8}>
              <Card size="small" title={<Text style={{ fontSize: 12, fontWeight: 600 }}>PO vs Receipt</Text>}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Row justify="space-between"><Col><Text style={{ fontSize: 12 }}>PO Ordered Amount</Text></Col><Col><Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtNum(orderedAmt)}</Text></Col></Row>
                  <Row justify="space-between"><Col><Text style={{ fontSize: 12 }}>Received Amount</Text></Col><Col><Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtNum(receivedAmt)}</Text></Col></Row>
                  <Divider style={{ margin: '4px 0' }} />
                  <Row justify="space-between">
                    <Col><Text style={{ fontSize: 12, fontWeight: 600 }}>Variance</Text></Col>
                    <Col>
                      <Text style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: receiptVariance === 0 ? REDWOOD.success : REDWOOD.warning }}>
                        {fmtNum(receiptVariance)}
                      </Text>
                    </Col>
                  </Row>
                  {!invLoading && (
                    <Tag color={receiptVariance === 0 ? 'green' : 'orange'} style={{ marginTop: 4 }}>
                      {receiptVariance === 0 ? 'Fully Received' : receiptVariance > 0 ? 'Under-received' : 'Over-received'}
                    </Tag>
                  )}
                </Space>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" title={<Text style={{ fontSize: 12, fontWeight: 600 }}>Receipt vs Invoice</Text>}>
                <Empty description="Invoice data coming soon" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 12 }} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" title={<Text style={{ fontSize: 12, fontWeight: 600 }}>Invoice vs Payment</Text>}>
                <Empty description="Payment data coming soon" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 12 }} />
              </Card>
            </Col>
          </Row>

          {/* Receipt quantity breakdown */}
          {invTxns.length > 0 && (
            <Card size="small" title={<Text style={{ fontSize: 12, fontWeight: 600 }}>Receipt Detail</Text>}>
              <Table
                dataSource={invTxns.map((i, x) => ({ ...i, _k: x }))}
                rowKey="_k" size="small" pagination={false}
                columns={[
                  { title: 'Date',       dataIndex: 'TransactionDate',     width: 120, render: v => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text> },
                  { title: 'Type',       dataIndex: 'TransactionType',     width: 160, render: v => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
                  { title: 'Item',       dataIndex: 'ItemNumber',          width: 160, render: v => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text> },
                  { title: 'Qty',        dataIndex: 'TransactionQuantity', width: 80,  render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmt(v)}</Text> },
                  { title: 'UOM',        dataIndex: 'TransactionUOM',      width: 60,  render: v => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text> },
                  { title: 'Unit Cost',  dataIndex: 'TransactionCost',     width: 110, render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmtNum(v)}</Text> },
                  { title: 'Amount',     dataIndex: 'TransactionAmount',   width: 120, render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{fmtNum(v)}</Text> },
                  { title: 'Receipt #',  dataIndex: 'ReceiptNumber',       render: v => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text> },
                  { title: 'Subinv',     dataIndex: 'Subinventory',        render: v => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text> },
                ]}
                scroll={{ x: 'max-content' }}
              />
            </Card>
          )}
        </Space>
      ),
    },

    // ── Raw JSON ────────────────────────────────────────────────────────
    {
      key: 'raw-json',
      label: <Space size={4}><ApiOutlined />Raw JSON</Space>,
      children: (
        <pre style={{ fontSize: 10, background: '#1e1e2e', color: '#cdd6f4', padding: 16, borderRadius: 6, overflow: 'auto', maxHeight: 600 }}>
          {JSON.stringify(po, null, 2)}
        </pre>
      ),
    },
  ] : [];

  // ── Export to Excel ──────────────────────────────────────────────────
  const exportExcel = useCallback(() => {
    if (!po) return;
    const wb = XLSX.utils.book_new();
    // Header sheet
    const headerSheet = XLSX.utils.json_to_sheet(
      PO_HEADER_FIELDS.map(f => ({ Field: f.label, 'API Key': f.key, Value: fmt(po[f.key]) }))
    );
    XLSX.utils.book_append_sheet(wb, headerSheet, 'PO Header');
    // Inv transactions sheet
    if (invTxns.length) {
      const invSheet = XLSX.utils.json_to_sheet(
        invTxns.map(i => ({
          'Transaction ID':   i.TransactionId,
          'Type':             i.TransactionType,
          'Date':             i.TransactionDate,
          'Item':             i.ItemNumber,
          'Description':      i.ItemDescription,
          'Qty':              i.TransactionQuantity,
          'UOM':              i.TransactionUOM,
          'Unit Cost':        i.TransactionCost,
          'Amount':           i.TransactionAmount,
          'Receipt #':        i.ReceiptNumber,
          'Subinventory':     i.Subinventory,
          'PO Line':          i.PurchaseOrderLineNumber,
          'Acctg Status':     i.AccountingStatus,
        }))
      );
      XLSX.utils.book_append_sheet(wb, invSheet, 'Receipts & Inventory');
    }
    XLSX.writeFile(wb, `PO_360_${po.OrderNumber}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }, [po, invTxns]);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>

      {/* Search bar */}
      <Card
        size="small"
        title={<Space><AuditOutlined style={{ color: REDWOOD.purple }} /><Text strong style={{ fontSize: 13 }}>360° PO Audit Tracker</Text></Space>}
        extra={fetchedAt && <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Fetched: {fetchedAt}</Text>}
      >
        <Row gutter={12} align="middle" wrap={false}>
          <Col>
            <Text style={{ fontSize: 12, fontWeight: 600 }}>PO Number</Text>
          </Col>
          <Col flex="auto" style={{ maxWidth: 280 }}>
            <Input
              placeholder="e.g. PO-2024-001234"
              value={poNumber}
              onChange={e => setPoNumber(e.target.value)}
              onPressEnter={fetchPO}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              allowClear
            />
          </Col>
          <Col>
            <Text style={{ fontSize: 12, fontWeight: 600 }}>Org</Text>
          </Col>
          <Col style={{ width: 100 }}>
            <Input value={org} onChange={e => setOrg(e.target.value)} style={{ fontFamily: 'monospace' }} placeholder="AMS" />
          </Col>
          <Col>
            <Button
              type="primary"
              icon={loading ? <ReloadOutlined spin /> : <SearchOutlined />}
              onClick={fetchPO}
              loading={loading}
              style={{ background: REDWOOD.purple, borderColor: REDWOOD.purple }}
            >
              Fetch 360°
            </Button>
          </Col>
          {po && (
            <Col>
              <Button icon={<FilePdfOutlined />} onClick={exportExcel} size="middle">
                Export Excel
              </Button>
            </Col>
          )}
        </Row>
        {apiUrl && (
          <div style={{ marginTop: 10, padding: '5px 10px', background: REDWOOD.neutral100, borderRadius: 4 }}>
            <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>PO API: </Text>
            <Text code style={{ fontSize: 10, wordBreak: 'break-all' }}>{apiUrl}</Text>
          </div>
        )}
      </Card>

      {error && <Alert type="error" message={error} showIcon />}

      {loading && (
        <Card><div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" tip="Fetching PO from Fusion…" /></div></Card>
      )}

      {/* Lifecycle steps */}
      {!loading && po && (
        <Card size="small">
          <Steps size="small" items={stages} style={{ padding: '4px 0' }} />
        </Card>
      )}

      {/* KPI row */}
      {!loading && po && (
        <Row gutter={12}>
          <Col span={5}>
            <Card size="small" style={{ background: '#f5f3ff', border: '1px solid #c4b5fd' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>PO Amount</Text>}
                value={Number(po.OrderedAmount || 0)} precision={2}
                valueStyle={{ fontSize: 18, color: REDWOOD.purple }} prefix={po.Currency} />
            </Card>
          </Col>
          <Col span={5}>
            <Card size="small" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Received Amount</Text>}
                value={invTxns.reduce((s, i) => s + (Number(i.TransactionAmount) || 0), 0)} precision={2}
                valueStyle={{ fontSize: 18, color: REDWOOD.success }}
                suffix={invLoading ? <Spin size="small" /> : undefined} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Receipts</Text>}
                value={invTxns.length}
                valueStyle={{ fontSize: 18, color: REDWOOD.info }}
                suffix={invLoading ? <Spin size="small" /> : undefined} />
            </Card>
          </Col>
          <Col span={5}>
            <Card size="small" style={{ background: '#fefce8', border: '1px solid #fde68a' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Invoiced Amount</Text>}
                value={0} precision={2} valueStyle={{ fontSize: 18, color: REDWOOD.warning }}
                suffix={<Text style={{ fontSize: 10, color: '#aaa' }}>coming soon</Text>} />
            </Card>
          </Col>
          <Col span={5}>
            <Card size="small" style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Paid Amount</Text>}
                value={0} precision={2} valueStyle={{ fontSize: 18, color: REDWOOD.error }}
                suffix={<Text style={{ fontSize: 10, color: '#aaa' }}>coming soon</Text>} />
            </Card>
          </Col>
        </Row>
      )}

      {/* Main tabs */}
      {!loading && po && (
        <Card
          size="small"
          bodyStyle={{ padding: 0 }}
          title={
            <Space>
              <Text strong style={{ fontSize: 13 }}>PO {po.OrderNumber}</Text>
              <Tag color={po.DocumentStatus === 'OPEN' ? 'green' : 'default'}>{po.DocumentStatus}</Tag>
              <Tag color="blue">{childLinks.length} child resources</Tag>
              {invTxns.length > 0 && <Tag color="green">{invTxns.length} inventory transactions</Tag>}
            </Space>
          }
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="small"
            style={{ padding: '0 16px' }}
            items={tabItems}
          />
        </Card>
      )}

      {!loading && !error && !po && (
        <Card>
          <Empty
            description={
              <Space direction="vertical" align="center">
                <Text strong>Enter a PO Number to start the 360° audit</Text>
                <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                  Fetches PO header, all child resources, inventory transactions, and variance analysis
                </Text>
              </Space>
            }
            image={<AuditOutlined style={{ fontSize: 64, color: REDWOOD.neutral200 }} />}
          />
        </Card>
      )}
    </Space>
  );
};

// ── Main page wrapper ─────────────────────────────────────────────────────────
const UATDiagnostics: React.FC = () => {
  const [selectedFeature, setSelectedFeature] = useState('po-360');
  const [openKeys, setOpenKeys]               = useState(['purchase']);

  const menuItems = MODULES.map(mod => ({
    key: mod.key, icon: mod.icon, label: mod.label,
    children: mod.features.map(f => ({ key: f.key, label: f.label })),
  }));

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.bg }}>
      <Header style={{ background: '#fff', borderBottom: `1px solid ${REDWOOD.neutral200}`, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
        <BugOutlined style={{ fontSize: 18, color: REDWOOD.primary }} />
        <Title level={5} style={{ margin: 0 }}>UAT / Diagnostics</Title>
        <Tag color="orange">Beta</Tag>
      </Header>

      <Layout>
        <Sider width={220} collapsible style={{ background: '#fff', borderRight: `1px solid ${REDWOOD.neutral200}` }}>
          <div style={{ padding: '12px 16px 4px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Test Modules
            </Text>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedFeature]}
            openKeys={openKeys}
            onOpenChange={k => setOpenKeys(k as string[])}
            onSelect={({ key }) => setSelectedFeature(key)}
            items={menuItems}
            style={{ border: 'none', fontSize: 13 }}
          />
        </Sider>

        <Content style={{ padding: 24 }}>
          {selectedFeature === 'po-360' ? (
            <PO360Tracker />
          ) : (
            <Card>
              <Empty
                image={<BugOutlined style={{ fontSize: 48, color: REDWOOD.neutral200 }} />}
                description={
                  <Space direction="vertical" align="center">
                    <Text strong>Coming Soon</Text>
                    <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>UAT scripts for this feature are under development</Text>
                  </Space>
                }
              />
            </Card>
          )}
        </Content>
      </Layout>
    </Layout>
  );
};

export default UATDiagnostics;
