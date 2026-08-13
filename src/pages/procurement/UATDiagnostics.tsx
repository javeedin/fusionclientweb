import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout, Typography, Card, Button, Input, Space, Tag, Spin,
  Row, Col, Menu, Table, Alert, Tabs, Badge, Empty, message,
  Steps, Statistic, Divider, Collapse, Select, Tooltip, Modal, Form,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BugOutlined, SearchOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ApiOutlined, ReloadOutlined, LinkOutlined, FilePdfOutlined,
  ShoppingOutlined, FileTextOutlined, TeamOutlined, InboxOutlined,
  DatabaseOutlined, AuditOutlined, DollarOutlined, CarOutlined,
  ExclamationCircleOutlined, MinusCircleOutlined,
  CloudDownloadOutlined, FileExcelOutlined, PlusOutlined, AppstoreOutlined,
  SyncOutlined, CopyOutlined, BlockOutlined, FunctionOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const BASE_URL    = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
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

// ── Module-level COA cache: coaSegmentCache[valueSetName][value] = description
const coaSegmentCache: Record<string, Record<string, string>> = {};
// backward-compat alias used by BIP "Get Account Description"
const coaAccountCache: Record<string, string> = {};

const COA_BASE = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05/valueSets`;

const COA_SEGMENTS = [
  { key: 'coa-company',          label: 'Company',          valueSet: 'Company_VS'         },
  { key: 'coa-main-account',     label: 'Main_Account',     valueSet: 'Main Account VS'    },
  { key: 'coa-sub-account',      label: 'Sub_Account',      valueSet: 'Sub Account VS'     },
  { key: 'coa-division',         label: 'Division',         valueSet: 'Division VS'        },
  { key: 'coa-department',       label: 'Department',       valueSet: 'Department VS'      },
  { key: 'coa-lob',              label: 'LOB',              valueSet: 'LOB'                },
  { key: 'coa-activity-type',    label: 'Activity_Type',    valueSet: 'Activity Type VS'   },
  { key: 'coa-activity-details', label: 'Activity_Details', valueSet: 'Analysis Details VS'},
  { key: 'coa-analysis-type',    label: 'Analysis_Type',    valueSet: 'Analysis Type VS'   },
  { key: 'coa-analysis-details', label: 'Analysis_Details', valueSet: 'Analysis Details VS'},
  { key: 'coa-ic',               label: 'IC',               valueSet: 'IC VS'              },
  { key: 'coa-emp',              label: 'Emp',              valueSet: 'Emp VS'             },
  { key: 'coa-future-1',         label: 'Future_1',         valueSet: 'Future 1'           },
  { key: 'coa-future-2',         label: 'Future_2',         valueSet: 'Future 2'           },
  { key: 'coa-future-3',         label: 'Future_3',         valueSet: 'Future 3'           },
];

const COA_KEY_SET = new Set(COA_SEGMENTS.map(s => s.key));

const coaSegmentUrl = (valueSet: string) =>
  `${COA_BASE}/${encodeURIComponent(valueSet)}/child/values?limit=500&offset=0`;

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
    key: 'oracle-bip', label: 'Oracle BIP Reports', icon: <AppstoreOutlined />,
    features: [
      { key: 'oracle-bip-reports', label: 'Oracle BIP Reports' },
    ],
  },
  {
    key: 'coa', label: 'COA Segments', icon: <BlockOutlined />,
    features: COA_SEGMENTS.map(s => ({ key: s.key, label: s.label })),
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

// ── COA Segments page — tab-based, one tab per segment ───────────────────────
interface CoaTabState {
  segKey: string;
  label: string;
  valueSet: string;
  loading: boolean;
  error: string;
  rows: any[];
  search: string;
  fetchedAt: string;
}

const COA_GRID_COLS: ColumnsType<any> = [
  { title: 'Value', dataIndex: 'Value', key: 'Value', width: 160,
    render: v => <Text style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v ?? '—'}</Text> },
  { title: 'Description', dataIndex: 'Description', key: 'Description', ellipsis: true,
    render: (v, r) => <Text>{v || r.ValueDescription || r.MeaningDescription || '—'}</Text> },
  { title: 'Enabled', dataIndex: 'EnabledFlag', key: 'EnabledFlag', width: 80,
    render: v => <Tag color={v === 'Y' ? 'green' : 'default'}>{v === 'Y' ? 'Yes' : (v ?? '—')}</Tag> },
  { title: 'Start Date', dataIndex: 'StartDateActive', key: 'StartDateActive', width: 120,
    render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text> },
  { title: 'End Date', dataIndex: 'EndDateActive', key: 'EndDateActive', width: 120,
    render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text> },
];

const COASegmentsPage: React.FC<{ activeSegKey: string }> = ({ activeSegKey }) => {
  const [tabs, setTabs]           = useState<CoaTabState[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string>('');

  const openOrFocusTab = useCallback((segKey: string) => {
    const seg = COA_SEGMENTS.find(s => s.key === segKey);
    if (!seg) return;

    // already open → just focus
    const existing = tabs.find(t => t.segKey === segKey);
    if (existing) { setActiveTabKey(segKey); return; }

    // open new tab (starts loading)
    const newTab: CoaTabState = {
      segKey, label: seg.label, valueSet: seg.valueSet,
      loading: true, error: '', rows: [], search: '', fetchedAt: '',
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabKey(segKey);

    // fetch
    const url = coaSegmentUrl(seg.valueSet);
    (async () => {
      try {
        const all: any[] = [];
        let next: string | null = url;
        while (next) {
          const r = await fetch(next, { headers: HDRS });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
          const d = await r.json();
          (d.items || []).forEach((i: any) => all.push(i));
          const nl = (d.links || []).find((l: any) => l.rel === 'next');
          next = nl?.href ?? null;
        }
        // populate segment cache
        if (!coaSegmentCache[seg.valueSet]) coaSegmentCache[seg.valueSet] = {};
        all.forEach(item => {
          const k = String(item.Value ?? '').trim();
          const v = String(item.Description ?? item.ValueDescription ?? '').trim();
          if (k) coaSegmentCache[seg.valueSet][k] = v;
        });
        // keep Main Account in the alias cache for BIP enrichment
        if (seg.valueSet === 'Main Account VS') {
          Object.assign(coaAccountCache, coaSegmentCache[seg.valueSet]);
        }
        setTabs(prev => prev.map(t =>
          t.segKey === segKey
            ? { ...t, loading: false, rows: all, fetchedAt: new Date().toLocaleString() }
            : t
        ));
        message.success(`${seg.label}: ${all.length} values loaded`);
      } catch (e: any) {
        setTabs(prev => prev.map(t =>
          t.segKey === segKey ? { ...t, loading: false, error: e.message } : t
        ));
      }
    })();
  }, [tabs]);

  // open/focus tab whenever sidebar selection changes to a COA segment
  useEffect(() => {
    if (COA_KEY_SET.has(activeSegKey)) openOrFocusTab(activeSegKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegKey]);

  const refetch = (segKey: string) => {
    setTabs(prev => prev.map(t => t.segKey === segKey ? { ...t, loading: true, error: '', rows: [] } : t));
    const seg = COA_SEGMENTS.find(s => s.key === segKey)!;
    const url = coaSegmentUrl(seg.valueSet);
    (async () => {
      try {
        const all: any[] = [];
        let next: string | null = url;
        while (next) {
          const r = await fetch(next, { headers: HDRS });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
          const d = await r.json();
          (d.items || []).forEach((i: any) => all.push(i));
          const nl = (d.links || []).find((l: any) => l.rel === 'next');
          next = nl?.href ?? null;
        }
        if (!coaSegmentCache[seg.valueSet]) coaSegmentCache[seg.valueSet] = {};
        all.forEach(item => {
          const k = String(item.Value ?? '').trim();
          const v = String(item.Description ?? item.ValueDescription ?? '').trim();
          if (k) coaSegmentCache[seg.valueSet][k] = v;
        });
        if (seg.valueSet === 'Main Account VS') Object.assign(coaAccountCache, coaSegmentCache[seg.valueSet]);
        setTabs(prev => prev.map(t =>
          t.segKey === segKey
            ? { ...t, loading: false, rows: all, fetchedAt: new Date().toLocaleString() }
            : t
        ));
        message.success(`${seg.label}: refreshed ${all.length} values`);
      } catch (e: any) {
        setTabs(prev => prev.map(t => t.segKey === segKey ? { ...t, loading: false, error: e.message } : t));
      }
    })();
  };

  if (tabs.length === 0) return (
    <Card style={{ textAlign: 'center', padding: '40px 0' }}>
      <BlockOutlined style={{ fontSize: 56, color: '#d9d9d9', marginBottom: 16 }} />
      <div style={{ fontSize: 16, color: '#8c8c8c', marginBottom: 8 }}>No segments open</div>
      <div style={{ fontSize: 13, color: '#aaa' }}>
        Click any segment in the left sidebar to open it as a tab
      </div>
    </Card>
  );

  const tabItems = tabs.map(tab => {
    const filtered = tab.search
      ? tab.rows.filter(r => {
          const s = tab.search.toLowerCase();
          return String(r.Value ?? '').toLowerCase().includes(s) ||
                 String(r.Description ?? r.ValueDescription ?? '').toLowerCase().includes(s);
        })
      : tab.rows;

    const cached = coaSegmentCache[tab.valueSet];
    const cachedCount = cached ? Object.keys(cached).length : 0;

    return {
      key: tab.segKey,
      closable: true,
      label: (
        <span style={{ fontSize: 12 }}>
          {tab.loading && <SyncOutlined spin style={{ marginRight: 4 }} />}
          {!tab.loading && tab.rows.length > 0 && (
            <Badge count={tab.rows.length} size="small"
              style={{ marginRight: 4, backgroundColor: tab.error ? '#ff4d4f' : '#52c41a' }} />
          )}
          {tab.label}
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {/* Info bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 6 }}>
            <BlockOutlined style={{ color: REDWOOD.info }} />
            <Text style={{ fontSize: 11, fontWeight: 600, color: REDWOOD.info }}>{tab.label}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>Value Set:</Text>
            <code style={{ fontSize: 11, color: REDWOOD.warning }}>{tab.valueSet}</code>
            <code style={{ flex: 1, fontSize: 10, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {coaSegmentUrl(tab.valueSet)}
            </code>
            {tab.fetchedAt && <Text style={{ fontSize: 10, color: REDWOOD.neutral600, flexShrink: 0 }}>Fetched: {tab.fetchedAt}</Text>}
          </div>

          {tab.loading && (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <Spin size="large" /><div style={{ marginTop: 12, color: '#8c8c8c' }}>Fetching {tab.label} values…</div>
            </div>
          )}
          {tab.error && <Alert type="error" message={tab.error} showIcon />}

          {!tab.loading && !tab.error && tab.rows.length > 0 && (
            <>
              <Row justify="space-between" align="middle">
                <Col>
                  <Space>
                    <Input.Search placeholder={`Search ${tab.label}…`} allowClear style={{ width: 260 }}
                      value={tab.search}
                      onChange={e => setTabs(prev => prev.map(t => t.segKey === tab.segKey ? { ...t, search: e.target.value } : t))} />
                    <Tag color="blue">{filtered.length} / {tab.rows.length}</Tag>
                    {cachedCount > 0 && <Tag icon={<CheckCircleOutlined />} color="green">{cachedCount} cached</Tag>}
                  </Space>
                </Col>
                <Col>
                  <Space>
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => refetch(tab.segKey)}>Refresh</Button>
                    <Button size="small" icon={<FileExcelOutlined />}
                      style={{ borderColor: '#1D6F42', color: '#1D6F42' }}
                      onClick={() => {
                        const ws = XLSX.utils.json_to_sheet(tab.rows);
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, tab.label.slice(0,31));
                        XLSX.writeFile(wb, `COA_${tab.label}_${new Date().toISOString().slice(0,10)}.xlsx`);
                      }}>Export Excel</Button>
                  </Space>
                </Col>
              </Row>
              <Table
                dataSource={filtered.map((r, i) => ({ ...r, _k: i }))}
                rowKey="_k" columns={COA_GRID_COLS} size="small" bordered
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 100, showSizeChanger: true, showTotal: t => `${t} values` }}
              />
            </>
          )}
        </Space>
      ),
    };
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '10px 16px', background: '#fff', borderRadius: 8,
        border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        <BlockOutlined style={{ color: REDWOOD.primary, fontSize: 18 }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>COA Segments</span>
        <Tag color="blue" style={{ fontSize: 11 }}>{tabs.length} open</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>Click any segment in the sidebar to open a new tab</Text>
      </div>
      <Card bodyStyle={{ padding: '8px 12px' }}>
        <Tabs
          type="editable-card"
          hideAdd
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          onEdit={(key, action) => {
            if (action === 'remove') {
              setTabs(prev => prev.filter(t => t.segKey !== key));
              setActiveTabKey(prev => {
                if (prev !== key) return prev;
                const idx = tabs.findIndex(t => t.segKey === key);
                const next = tabs[idx + 1] ?? tabs[idx - 1];
                return next?.segKey ?? '';
              });
            }
          }}
          items={tabItems}
        />
      </Card>
    </div>
  );
};

// ── Oracle BIP Reports helpers ────────────────────────────────────────────────

const BIP_HOST      = FUSION_POD_HOST;
const BIP_BASE_PATH = '/Custom/UAT_disanostic_SCRIPTS/';

const buildBipSoapEnvelope = (reportPath: string, username: string, password: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues><v2:listOfParamNameValues/></v2:parameterNameValues>
        <v2:reportData/><v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${username}</v2:userID>
      <v2:password>${password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;

const parseBipXml = (xmlString: string): { columns: string[]; rows: Record<string, string>[] } => {
  if (!xmlString.trim()) return { columns: [], rows: [] };
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  let elements: NodeListOf<Element> | Element[] = doc.querySelectorAll('G_1');
  if (elements.length === 0) {
    const root = doc.documentElement;
    const counts = new Map<string, number>();
    Array.from(root.children).forEach(c => counts.set(c.tagName, (counts.get(c.tagName) || 0) + 1));
    let best = { tag: '', count: 0 };
    counts.forEach((n, t) => { if (n > best.count) best = { tag: t, count: n }; });
    if (best.tag) elements = doc.querySelectorAll(best.tag);
  }
  if (elements.length === 0) return { columns: [], rows: [] };
  const colSet = new Set<string>(); const colOrder: string[] = [];
  Array.from(elements).forEach(el =>
    Array.from(el.children).forEach(c => { if (!colSet.has(c.tagName)) { colSet.add(c.tagName); colOrder.push(c.tagName); } })
  );
  const rows = Array.from(elements).map(el => {
    const row: Record<string, string> = {};
    colOrder.forEach(col => { row[col] = el.querySelector(col)?.textContent?.trim() || ''; });
    return row;
  });
  return { columns: colOrder, rows };
};

interface BipTabState {
  path: string;
  name: string;
  username: string;
  password: string;
  loading: boolean;
  error: string | null;
  columns: string[];
  rows: Record<string, string>[];
  duration: number | null;
  gridSearch: string;
  envelope: string | null;
  soapUrl: string;
}

interface DrillState {
  col: string;
  val: string;
  rows: Record<string, string>[];
  columns: string[];
}

// columns whose names look like IDs (ends _ID, _NUMBER, _KEY, _BATCH, _HDR etc.)
const isIdColumn = (col: string) =>
  /(_ID|_NUMBER|_KEY|_BATCH|_HDR|_HEADER|_LINE|_SEQ|BATCH_ID|JE_BATCH|JE_HEADER|HEADER_ID|LINE_ID)$/i.test(col);

const APEX_DEFAULT_URL = `${FUSION_POD_HOST}/ords/`;

const OracleBIPReports: React.FC = () => {
  const [tabs, setTabs]           = useState<BipTabState[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [pathModalOpen, setPathModalOpen] = useState(false);
  const [xmlExpanded, setXmlExpanded] = useState<Record<number, boolean>>({});
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [apexModal, setApexModal] = useState(false);
  const [apexUrl, setApexUrl] = useState(APEX_DEFAULT_URL);
  const [apexSyncing, setApexSyncing] = useState(false);
  const [form] = Form.useForm();

  const addReport = async (path: string, name: string, username: string, password: string) => {
    const idx = tabs.length;
    const soapUrl  = `${BIP_HOST}/xmlpserver/services/v2/ReportService`;
    const envelope = buildBipSoapEnvelope(path, username, password);
    const maskedEnvelope = envelope.replace(/<v2:password>[^<]*<\/v2:password>/, '<v2:password>••••••••</v2:password>');
    const newTab: BipTabState = { path, name, username, password, loading: true, error: null, columns: [], rows: [], duration: null, gridSearch: '', envelope: maskedEnvelope, soapUrl };
    setTabs(prev => [...prev, newTab]);
    setActiveIdx(idx);

    try {
      const t0  = Date.now();
      const res = await fetch(soapUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"runReport"' },
        body: envelope,
      });
      const duration = Date.now() - t0;

      if (!res.ok) {
        const txt = await res.text();
        setTabs(prev => prev.map((t, i) => i === idx
          ? { ...t, loading: false, error: `HTTP ${res.status}: ${txt.slice(0, 300)}`, duration }
          : t));
        return;
      }

      const soapText = await res.text();
      const match    = soapText.match(/<reportBytes[^>]*>([^<]+)<\/reportBytes>/);
      if (!match) {
        setTabs(prev => prev.map((t, i) => i === idx
          ? { ...t, loading: false, error: 'No reportBytes in SOAP response — check report path and credentials', duration }
          : t));
        return;
      }

      const bin = atob(match[1].trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const xml = new TextDecoder('utf-8').decode(bytes);
      const { columns, rows } = parseBipXml(xml);

      setTabs(prev => prev.map((t, i) => i === idx
        ? { ...t, loading: false, error: null, columns, rows, duration }
        : t));
    } catch (e: any) {
      setTabs(prev => prev.map((t, i) => i === idx
        ? { ...t, loading: false, error: e.message ?? 'SOAP call failed', duration: null }
        : t));
    }
  };

  const handleNewReport = async () => {
    const vals = await form.validateFields();
    const reportFile = vals.reportName.trim();
    const path = BIP_BASE_PATH + reportFile;
    const name = reportFile.replace(/\.xdo$/i, '');
    setPathModalOpen(false);
    form.resetFields();
    addReport(path, name, vals.username.trim(), vals.password);
  };

  const exportExcel = (tab: BipTabState) => {
    if (!tab.rows.length) return;
    const ws  = XLSX.utils.json_to_sheet(tab.rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tab.name.slice(0, 31));
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${tab.name}.xlsx`);
  };

  // Detect which column in the BIP rows most likely holds account codes
  const detectAccountColumn = (columns: string[]): string | null => {
    const patterns = [/ACCOUNT/i, /ACCT/i, /SEGMENT4/i, /SEG4/i, /COA/i, /NATURAL_ACCOUNT/i];
    for (const pat of patterns) {
      const col = columns.find(c => pat.test(c));
      if (col) return col;
    }
    return null;
  };

  const addAccountDescriptions = (tabIdx: number) => {
    const tab = tabs[tabIdx];
    if (!tab || !tab.rows.length) return;

    const cacheSize = Object.keys(coaAccountCache).length;
    if (cacheSize === 0) {
      message.warning('Account cache is empty — please go to COA Segments → Account and click Fetch Accounts first');
      return;
    }

    const acctCol = detectAccountColumn(tab.columns);
    if (!acctCol) {
      message.warning('No account column detected (expected ACCOUNT, ACCT, SEGMENT4, etc.)');
      return;
    }

    const descCol = `${acctCol}_DESC`;
    const enriched = tab.rows.map(r => {
      const code = String(r[acctCol] ?? '').trim();
      const desc = coaAccountCache[code] ?? '';
      return { ...r, [descCol]: desc };
    });

    const newColumns = tab.columns.includes(descCol)
      ? tab.columns
      : [...tab.columns.slice(0, tab.columns.indexOf(acctCol) + 1), descCol, ...tab.columns.slice(tab.columns.indexOf(acctCol) + 1)];

    setTabs(prev => prev.map((t, i) => i === tabIdx ? { ...t, rows: enriched, columns: newColumns } : t));
    const matched = enriched.filter(r => r[descCol]).length;
    message.success(`Added ${descCol} — ${matched} / ${enriched.length} rows matched`);
  };

  const syncToApex = async (tab: BipTabState) => {
    if (!tab.rows.length) { message.warning('No data to sync'); return; }
    setApexSyncing(true);
    try {
      const res = await fetch(apexUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_HEADER },
        body: JSON.stringify({ reportPath: tab.path, reportName: tab.name, rows: tab.rows }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`Synced ${tab.rows.length.toLocaleString()} rows to APEX`);
      setApexModal(false);
    } catch (e: any) {
      message.error(`Sync failed: ${e.message}`);
    } finally {
      setApexSyncing(false);
    }
  };

  const tabItems = tabs.map((tab, idx) => ({
    key: String(idx),
    closable: true,
    label: (
      <span style={{ fontSize: 12 }}>
        {tab.loading && <SyncOutlined spin style={{ marginRight: 4 }} />}
        {tab.rows.length > 0 && !tab.loading && (
          <Badge count={tab.rows.length} size="small" style={{ marginRight: 4, backgroundColor: '#52c41a' }} />
        )}
        {tab.name}
      </span>
    ),
    children: (() => {
      const payloadPanel = (
        <div style={{ marginBottom: 12 }}>
          <div
            onClick={() => setXmlExpanded(prev => ({ ...prev, [idx]: !(prev[idx] ?? false) }))}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              padding: '5px 10px', borderRadius: 6, background: '#f0f5ff',
              border: '1px solid #adc6ff', fontSize: 12, color: '#2f54eb', userSelect: 'none' }}
          >
            <ApiOutlined style={{ fontSize: 13 }} />
            <span style={{ fontWeight: 600 }}>SOAP Payload</span>
            <Tag color="blue" style={{ fontSize: 10 }}>POST</Tag>
            <code style={{ flex: 1, fontSize: 10, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tab.soapUrl}
            </code>
            <span style={{ fontSize: 11, flexShrink: 0 }}>{(xmlExpanded[idx] ?? false) ? '▲ Hide' : '▼ Show'}</span>
          </div>
          {(xmlExpanded[idx] ?? false) && (
            <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 6, background: '#fafafa', border: '1px solid #d9d9d9' }}>
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Report Path</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, padding: '4px 8px' }}>
                  <code style={{ flex: 1, fontSize: 11, color: '#d46b08' }}>{tab.path}</code>
                  <CopyOutlined style={{ cursor: 'pointer', color: '#595959', flexShrink: 0 }}
                    onClick={() => { navigator.clipboard.writeText(tab.path); message.success('Path copied'); }} />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>XML Payload (password masked)</Text>
                  <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 12 }}
                    onClick={() => { navigator.clipboard.writeText(tab.envelope || ''); message.success('XML copied'); }} />
                </div>
                <pre style={{ margin: 0, padding: '8px 10px', background: '#1e1e1e', color: '#9cdcfe',
                  borderRadius: 4, fontSize: 10, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre', lineHeight: 1.5 }}>
                  {tab.envelope || '—'}
                </pre>
              </div>
            </div>
          )}
        </div>
      );

      if (tab.loading) return (
        <div>
          {payloadPanel}
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#8c8c8c' }}>Running SOAP call to Oracle BIP…<br />
              <code style={{ fontSize: 11 }}>{BIP_HOST}</code>
            </div>
          </div>
        </div>
      );
      if (tab.error) return (
        <div>
          {payloadPanel}
          <Alert type="error" showIcon message="SOAP Call Failed" description={
            <pre style={{ fontSize: 11, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 6 }}>{tab.error}</pre>
          } style={{ marginBottom: 10 }} />
          <Space>
            <Button icon={<CloudDownloadOutlined />} onClick={() => addReport(tab.path, tab.name, tab.username, tab.password)}>Retry</Button>
            <code style={{ fontSize: 11, color: '#8c8c8c' }}>{tab.path}</code>
          </Space>
        </div>
      );

      const search   = tab.gridSearch.toLowerCase();
      const filtered = search ? tab.rows.filter(r => Object.values(r).some(v => v.toLowerCase().includes(search))) : tab.rows;
      const cols     = tab.columns.map(col => {
        const isId = isIdColumn(col);
        return {
          title: isId
            ? <span style={{ color: REDWOOD.info, fontWeight: 700, fontSize: 11 }}>{col} <LinkOutlined style={{ fontSize: 9 }} /></span>
            : <span style={{ fontSize: 11, fontWeight: 600 }}>{col}</span>,
          dataIndex: col, key: col, width: 140, ellipsis: true,
          render: (v: string) => {
            if (!v) return <span style={{ color: '#d9d9d9', fontFamily: 'monospace', fontSize: 11 }}>—</span>;
            if (isId) return (
              <a style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}
                onClick={() => {
                  const drillRows = tab.rows.filter(r => r[col] === v);
                  setDrill({ col, val: v, rows: drillRows, columns: tab.columns });
                }}>
                {v}
              </a>
            );
            return <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text>;
          },
        };
      });

      return (
        <div>
          {payloadPanel}

          <Space style={{ marginBottom: 12 }} wrap>
            <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => addReport(tab.path, tab.name, tab.username, tab.password)}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Re-fetch</Button>
            <Button icon={<FileExcelOutlined />} disabled={!tab.rows.length} onClick={() => exportExcel(tab)}
              style={{ borderColor: '#1D6F42', color: '#1D6F42' }}>Export Excel</Button>
            <Button icon={<SyncOutlined />} disabled={!tab.rows.length} onClick={() => setApexModal(true)}
              style={{ borderColor: REDWOOD.purple, color: REDWOOD.purple }}>Sync to APEX</Button>
            <Button icon={<FunctionOutlined />} disabled={!tab.rows.length}
              onClick={() => addAccountDescriptions(idx)}
              style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}>
              Get Account Description
            </Button>
            <Input.Search placeholder="Search grid…" allowClear size="small" style={{ width: 220 }}
              value={tab.gridSearch}
              onChange={e => setTabs(prev => prev.map((t, i) => i === idx ? { ...t, gridSearch: e.target.value } : t))} />
            {tab.duration !== null && <Tag icon={<ClockCircleOutlined />} color="blue">{(tab.duration / 1000).toFixed(1)}s</Tag>}
            {tab.rows.length > 0 && <Tag icon={<CheckCircleOutlined />} color="green">{filtered.length.toLocaleString()} / {tab.rows.length.toLocaleString()} rows</Tag>}
            {tab.columns.length > 0 && <Tag color="purple">{tab.columns.length} columns</Tag>}
          </Space>

          {tab.rows.length === 0 ? (
            <Empty description="Report returned no data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table dataSource={filtered.map((r, i) => ({ ...r, _key: i }))} rowKey="_key"
              columns={cols} size="small" bordered
              scroll={{ x: tab.columns.length * 140, y: 420 }}
              pagination={{ pageSize: 100, showSizeChanger: true, showQuickJumper: true,
                showTotal: t => `${t} rows` }} />
          )}
        </div>
      );
    })(),
  }));

  return (
    <div style={{ padding: 0 }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '10px 16px', background: '#fff', borderRadius: 8,
        border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        <AppstoreOutlined style={{ color: REDWOOD.primary, fontSize: 18 }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>Oracle BIP Reports</span>
        <Tag color="blue" style={{ fontSize: 11 }}>{BIP_HOST}</Tag>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button type="primary" icon={<PlusOutlined />}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => setPathModalOpen(true)}>
            New Report
          </Button>
        </div>
      </div>

      {tabs.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px 0' }}>
          <AppstoreOutlined style={{ fontSize: 56, color: '#d9d9d9', marginBottom: 16 }} />
          <div style={{ fontSize: 16, color: '#8c8c8c', marginBottom: 8 }}>No reports open</div>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 20 }}>
            Click <strong>New Report</strong> and enter the BIP report path to run it against<br />
            <code style={{ fontSize: 12 }}>{BIP_HOST}</code>
          </div>
          <Button type="primary" icon={<PlusOutlined />}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => setPathModalOpen(true)}>
            New Report
          </Button>
        </Card>
      ) : (
        <Card bodyStyle={{ padding: '8px 12px' }}>
          <Tabs
            type="editable-card"
            hideAdd
            activeKey={String(activeIdx)}
            onChange={k => setActiveIdx(Number(k))}
            onEdit={(key, action) => {
              if (action === 'remove') {
                const i = Number(key);
                setTabs(prev => prev.filter((_, idx) => idx !== i));
                setActiveIdx(prev => Math.max(0, prev >= i ? prev - 1 : prev));
              }
            }}
            items={tabItems}
            tabBarExtraContent={
              <Button size="small" icon={<PlusOutlined />}
                style={{ borderColor: REDWOOD.primary, color: REDWOOD.primary }}
                onClick={() => setPathModalOpen(true)}>
                New Report
              </Button>
            }
          />
        </Card>
      )}

      {/* Drill-down modal */}
      <Modal
        open={!!drill}
        onCancel={() => setDrill(null)}
        footer={[
          <Button key="excel" icon={<FileExcelOutlined />} style={{ borderColor: '#1D6F42', color: '#1D6F42' }}
            onClick={() => {
              if (!drill) return;
              const ws = XLSX.utils.json_to_sheet(drill.rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'DrillDown');
              const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
              saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `DrillDown_${drill.col}_${drill.val}.xlsx`);
            }}>Export Excel</Button>,
          <Button key="close" onClick={() => setDrill(null)}>Close</Button>,
        ]}
        title={
          <Space>
            <LinkOutlined style={{ color: REDWOOD.info }} />
            <span>Drill-down: <code style={{ fontSize: 12 }}>{drill?.col}</code> = <code style={{ fontSize: 12, color: REDWOOD.primary }}>{drill?.val}</code></span>
            <Tag color="blue">{drill?.rows.length} rows</Tag>
          </Space>
        }
        width={960}
        styles={{ body: { padding: '12px 16px' } }}
      >
        {drill && (
          <Table
            dataSource={drill.rows.map((r, i) => ({ ...r, _k: i }))}
            rowKey="_k"
            size="small"
            bordered
            scroll={{ x: drill.columns.length * 140, y: 400 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} rows` }}
            columns={drill.columns.map(col => ({
              title: <span style={{ fontSize: 11, fontWeight: col === drill.col ? 700 : 400, color: col === drill.col ? REDWOOD.primary : undefined }}>{col}</span>,
              dataIndex: col, key: col, width: 140, ellipsis: true,
              render: (v: string) => (
                <Text style={{ fontFamily: 'monospace', fontSize: 11,
                  background: col === drill.col ? '#fff7e6' : undefined,
                  padding: col === drill.col ? '0 3px' : undefined,
                  borderRadius: col === drill.col ? 2 : undefined }}>
                  {v || <span style={{ color: '#d9d9d9' }}>—</span>}
                </Text>
              ),
            }))}
          />
        )}
      </Modal>

      {/* Sync to APEX modal */}
      <Modal
        open={apexModal}
        onCancel={() => setApexModal(false)}
        onOk={() => {
          const tab = tabs[activeIdx];
          if (tab) syncToApex(tab);
        }}
        okText={apexSyncing ? 'Syncing…' : 'Sync Now'}
        okButtonProps={{ style: { background: REDWOOD.purple, borderColor: REDWOOD.purple }, loading: apexSyncing }}
        title={<Space><SyncOutlined style={{ color: REDWOOD.purple }} /><span>Sync to Oracle APEX</span></Space>}
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text style={{ fontSize: 12, fontWeight: 600 }}>APEX REST Endpoint URL</Text>
            <Input
              value={apexUrl}
              onChange={e => setApexUrl(e.target.value)}
              placeholder="https://…/ords/schema/module/endpoint"
              style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}
            />
          </div>
          {tabs[activeIdx] && (
            <Alert type="info" showIcon message={
              <span style={{ fontSize: 12 }}>
                Will POST <strong>{tabs[activeIdx].rows.length.toLocaleString()} rows</strong> from report <code>{tabs[activeIdx].name}</code> as JSON
              </span>
            } />
          )}
        </Space>
      </Modal>

      {/* Path input modal */}
      <Modal
        open={pathModalOpen}
        onCancel={() => { setPathModalOpen(false); form.resetFields(); }}
        onOk={handleNewReport}
        okText="Run Report"
        okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        title={<Space><AppstoreOutlined style={{ color: REDWOOD.primary }} /><span>Oracle BIP Report</span></Space>}
        width={680}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          size="small"
          initialValues={{ username: 'emparun', password: 'Fusion@1234' }}
        >
          <Form.Item
            name="reportName"
            label="Report File Name"
            rules={[{ required: true, message: 'Please enter the report file name' }]}
            extra={<span>Full path: <code style={{ fontSize: 11, color: REDWOOD.warning }}>{BIP_BASE_PATH}<strong>YourReport.xdo</strong></code></span>}
          >
            <Input
              autoFocus
              placeholder="MyReport.xdo"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              addonBefore={
                <code style={{ fontSize: 11, color: REDWOOD.warning, whiteSpace: 'nowrap' }}>
                  {BIP_BASE_PATH}
                </code>
              }
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="Oracle BIP username" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Required' }]}>
                <Input.Password placeholder="Password" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Live XML preview */}
          <Form.Item noStyle shouldUpdate>
            {() => {
              const reportFile = (form.getFieldValue('reportName') || '').trim();
              const u = form.getFieldValue('username') || '';
              if (!reportFile) return (
                <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '10px 14px', fontSize: 11, color: '#555', fontFamily: 'monospace' }}>
                  XML payload will appear here as you type the report file name…
                </div>
              );
              const fullPath = BIP_BASE_PATH + reportFile;
              const preview  = buildBipSoapEnvelope(fullPath, u, '••••••••');
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, color: '#595959', fontWeight: 600 }}>XML Payload Preview</Text>
                    <Tag color="blue" style={{ fontSize: 10 }}>POST {BIP_HOST}/xmlpserver/services/v2/ReportService</Tag>
                    <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 12, marginLeft: 'auto' }}
                      onClick={() => { navigator.clipboard.writeText(preview); message.success('XML copied'); }} />
                  </div>
                  <pre style={{ margin: 0, padding: '8px 12px', background: '#1e1e1e', color: '#9cdcfe',
                    borderRadius: 6, fontSize: 10, maxHeight: 200, overflow: 'auto',
                    whiteSpace: 'pre', lineHeight: 1.6 }}>
                    {preview}
                  </pre>
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
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
          {/* Always-mounted panels — hidden with CSS so tab state is preserved */}
          <div style={{ display: selectedFeature === 'po-360' ? undefined : 'none' }}>
            <PO360Tracker />
          </div>
          <div style={{ display: selectedFeature === 'oracle-bip-reports' ? undefined : 'none' }}>
            <OracleBIPReports />
          </div>
          <div style={{ display: COA_KEY_SET.has(selectedFeature) ? undefined : 'none' }}>
            <COASegmentsPage activeSegKey={selectedFeature} />
          </div>
          {!['po-360', 'oracle-bip-reports'].includes(selectedFeature) && !COA_KEY_SET.has(selectedFeature) && (
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
