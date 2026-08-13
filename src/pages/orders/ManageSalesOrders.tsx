import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  Row, Col, Space, Tag, Tabs, message, Empty, Modal, Tooltip, Badge,
  Divider, DatePicker, Spin, Statistic,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ShoppingOutlined, SearchOutlined, ReloadOutlined,
  InfoCircleOutlined, CloseOutlined, AppstoreOutlined, UnorderedListOutlined,
  FilterOutlined, CalendarOutlined, UserOutlined, DollarOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PauseCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

// ── Palette ───────────────────────────────────────────────────────────────────
const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C',
  teal: '#00918A', tealDark: '#007A74',
  success: '#1D7B4D', warning: '#B07700', info: '#0572CE', error: '#D93025',
  orange: '#C25700',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── API ───────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://iacney-test.fa.ocs.oraclecloud.com/fscmRestApi/resources/11.13.18.05';
const AUTH_HEADER = 'Basic ' + btoa('emparun:Fusion@1234');
const HEADERS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const PAGE_SIZE = 25;
const CHILD_LIMIT = 500;

const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
  const stripped = baseUrl
    .replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '')
    .replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = stripped.includes('?') ? '&' : '?';
    const r = await fetch(`${stripped}${sep}limit=${CHILD_LIMIT}&offset=${offset}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < CHILD_LIMIT) break;
    offset += CHILD_LIMIT;
  }
  return all;
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawOrder {
  HeaderId: number;
  OrderNumber: string;
  OrderKey: string;
  SourceTransactionNumber: string;
  BusinessUnitName: string;
  TransactionOn: string;
  BuyingPartyName: string;
  BuyingPartyNumber: string;
  CustomerPONumber?: string;
  Status: string;
  StatusCode: string;
  TransactionalCurrencyCode: string;
  TransactionalCurrencyName: string;
  PaymentTerms: string;
  RequestedShipDate?: string;
  SubmittedDate?: string;
  SubmittedBy?: string;
  OnHoldFlag: boolean;
  CanceledFlag: boolean;
  OpenFlag: boolean;
  SubmittedFlag: boolean;
  FreezePriceFlag: boolean;
  RequestingLegalEntity?: string;
  Salesperson?: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
  links?: Array<{ rel: string; href: string; name: string; kind: string }>;
  [key: string]: any;
}

interface SearchParams {
  orderNumber?: string;
  customer?: string;
  status?: string;
  currency?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtDateTime = (d?: string) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const matchesFilter = (row: any, q: string) => {
  if (!q) return true;
  const low = q.toLowerCase();
  return Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(low));
};

const statusTag = (status: string, code: string) => {
  const cfg: Record<string, { color: string; icon: React.ReactNode }> = {
    OPEN:      { color: 'blue',    icon: <CheckCircleOutlined /> },
    CLOSED:    { color: 'default', icon: <CloseCircleOutlined /> },
    CANCELED:  { color: 'red',     icon: <CloseCircleOutlined /> },
    ON_HOLD:   { color: 'orange',  icon: <PauseCircleOutlined /> },
  };
  const c = cfg[code] ?? { color: 'default', icon: null };
  return <Tag color={c.color} icon={c.icon} style={{ fontWeight: 600 }}>{status || code}</Tag>;
};

// ── LV field ─────────────────────────────────────────────────────────────────
const LV: React.FC<{ label: string; value?: React.ReactNode; cols?: number }> = ({ label, value, cols = 1 }) => (
  <Col xs={24} sm={12} md={6 * cols}>
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{value ?? <span style={{ color: REDWOOD.neutral300 }}>—</span>}</div>
    </div>
  </Col>
);

// ── Detail modal ──────────────────────────────────────────────────────────────
const DetailModal: React.FC<{ record: any; onClose: () => void }> = ({ record, onClose }) => (
  <Modal
    title={<Space><InfoCircleOutlined style={{ color: REDWOOD.info }} />Full Record</Space>}
    open={!!record} onCancel={onClose} footer={null} width={720}
    styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
  >
    {record && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
        {Object.entries(record).filter(([k]) => k !== 'links').map(([k, v]) => (
          <div key={k} style={{ borderBottom: `1px solid ${REDWOOD.neutral100}`, paddingBottom: 5 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
            <div style={{ fontSize: 12, color: REDWOOD.neutral900, wordBreak: 'break-all' }}>
              {v === null || v === undefined ? <span style={{ color: REDWOOD.neutral300 }}>—</span>
                : typeof v === 'boolean' ? (v ? 'Yes' : 'No')
                : String(v)}
            </div>
          </div>
        ))}
      </div>
    )}
  </Modal>
);

// ── Lines Tab ─────────────────────────────────────────────────────────────────
const LinesTab: React.FC<{ lines: any[]; loading: boolean }> = ({ lines, loading }) => {
  const [filter, setFilter]   = useState('');
  const [detail, setDetail]   = useState<any | null>(null);

  const filtered = lines.filter(r => matchesFilter(r, filter));

  const fmtAmt = (v: any) =>
    v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  const cols: ColumnsType<any> = [
    { title: '#', dataIndex: 'LineNumber', width: 50, render: (v: any) => <Text style={{ fontFamily: 'monospace' }}>{v}</Text> },
    {
      title: 'Product #', dataIndex: 'ProductNumber', width: 130, ellipsis: true,
      render: (v: any) => <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Item', dataIndex: 'OrderedItem', width: 150, ellipsis: true,
      render: (v: any) => <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{v ?? '—'}</Text>,
    },
    { title: 'Description', dataIndex: 'ProductDescription', width: 220, ellipsis: true },
    {
      title: 'Qty', dataIndex: 'OrderedQuantity', width: 75, align: 'right' as const,
      render: (v: any) => <Tag color="blue" style={{ fontWeight: 700 }}>{v ?? 0}</Tag>,
    },
    { title: 'UOM', dataIndex: 'OrderedUOM', width: 65 },
    {
      title: 'Unit Price', dataIndex: 'UnitSellingPrice', width: 110, align: 'right' as const,
      render: (v: any) => <Text style={{ fontFamily: 'monospace' }}>{fmtAmt(v)}</Text>,
    },
    {
      title: 'Ext. Amount', key: 'extAmt', width: 120, align: 'right' as const,
      render: (_: any, r: any) => {
        const ext = (r.OrderedQuantity ?? 0) * (r.UnitSellingPrice ?? 0);
        return <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{fmtAmt(ext)}</Text>;
      },
    },
    { title: 'Status', dataIndex: 'Status', width: 110, render: (v: any, r: any) => statusTag(v, r.StatusCode ?? '') },
    { title: 'Ship Date', dataIndex: 'RequestedShipDate', width: 110, render: fmtDate },
    { title: 'Sched. Ship', dataIndex: 'ScheduledShipDate', width: 110, render: fmtDate },
    { title: 'Fulfillment Org', dataIndex: 'RequestedFulfillmentOrganizationCode', width: 120, render: (v: any) => v ? <Tag color="cyan">{v}</Tag> : '—' },
    { title: 'Subinventory', dataIndex: 'SubinventoryCode', width: 120, render: (v: any) => v ? <Tag>{v}</Tag> : '—' },
    {
      title: '', key: '_info', width: 42, fixed: 'right' as const,
      render: (_: any, row: any) => (
        <Tooltip title="All fields">
          <Button size="small" shape="circle" icon={<InfoCircleOutlined />}
            style={{ color: REDWOOD.info, borderColor: REDWOOD.neutral200 }}
            onClick={() => setDetail(row)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        <FilterOutlined style={{ color: REDWOOD.neutral600, fontSize: 13 }} />
        <Input size="small" placeholder={`Filter ${lines.length} lines...`} value={filter}
          onChange={e => setFilter(e.target.value)} allowClear style={{ maxWidth: 300 }} />
        {filter && <Text type="secondary" style={{ fontSize: 11 }}>{filtered.length} match</Text>}
        <div style={{ marginLeft: 'auto' }}>
          {!loading && <Text type="secondary" style={{ fontSize: 11 }}>{lines.length} lines total</Text>}
        </div>
      </div>
      {loading
        ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading order lines..." /></div>
        : (
          <Table dataSource={filtered} columns={cols} rowKey={(_, i) => String(i)} size="small"
            scroll={{ x: 1050 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} lines` }}
            style={{ fontSize: 12 }}
            locale={{ emptyText: <Empty description="No lines found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            summary={rows => {
              const totalExt = rows.reduce((s: number, r: any) => s + (r.OrderedQuantity ?? 0) * (r.UnitSellingPrice ?? 0), 0);
              return (
                <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                  <Table.Summary.Cell index={0} colSpan={6}>
                    <Text strong style={{ fontSize: 12 }}>Total</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info }}>
                      {totalExt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} colSpan={4} />
                </Table.Summary.Row>
              );
            }}
          />
        )
      }
      <DetailModal record={detail} onClose={() => setDetail(null)} />
    </>
  );
};

// ── Order Detail Page ─────────────────────────────────────────────────────────
const OrderDetailPage: React.FC<{ order: RawOrder; onClose?: () => void }> = ({ order, onClose }) => {
  const [activeTab, setActiveTab]   = useState('summary');
  const [detail, setDetail]         = useState<any | null>(null);
  const [lines, setLines]           = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  const linesUrl = order.links?.find(l => l.name === 'lines')?.href;

  // Fetch lines eagerly so totals are available in the header
  useEffect(() => {
    if (!linesUrl) return;
    setLinesLoading(true);
    fetchAllPages(linesUrl)
      .then(setLines)
      .catch(e => message.error(`Lines load failed: ${e.message}`, 5))
      .finally(() => setLinesLoading(false));
  }, [linesUrl]);

  const orderTotal = lines.reduce((s, l) => s + (l.OrderedQuantity ?? 0) * (l.UnitSellingPrice ?? 0), 0);
  const fmtAmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const flags: { label: string; on: boolean; color: string }[] = [
    { label: 'Open',      on: order.OpenFlag,      color: 'green' },
    { label: 'Submitted', on: order.SubmittedFlag,  color: 'blue' },
    { label: 'On Hold',   on: order.OnHoldFlag,     color: 'orange' },
    { label: 'Canceled',  on: order.CanceledFlag,   color: 'red' },
    { label: 'Freeze Price', on: order.FreezePriceFlag, color: 'purple' },
  ];

  const tabs = [
    {
      key: 'summary',
      label: <Space size={4}><AppstoreOutlined />Summary</Space>,
      children: (
        <div style={{ padding: '20px 24px' }}>
          {/* Flag chips */}
          <Space wrap style={{ marginBottom: 20 }}>
            {flags.map(f => f.on && (
              <Tag key={f.label} color={f.color} style={{ fontWeight: 600 }}>{f.label}</Tag>
            ))}
          </Space>
          <Row gutter={[16, 0]}>
            <LV label="Order Number"    value={<Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info, fontSize: 14 }}>{order.OrderNumber}</Text>} />
            <LV label="Status"          value={statusTag(order.Status, order.StatusCode)} />
            <LV label="Business Unit"   value={order.BusinessUnitName} cols={2} />
            <LV label="Customer"        value={<Text strong>{order.BuyingPartyName}</Text>} cols={2} />
            <LV label="Customer #"      value={<Text style={{ fontFamily: 'monospace' }}>{order.BuyingPartyNumber}</Text>} />
            <LV label="Customer PO"     value={order.CustomerPONumber} />
            <LV label="Currency"        value={<Tag color="gold">{order.TransactionalCurrencyCode} – {order.TransactionalCurrencyName}</Tag>} cols={2} />
            <LV label="Payment Terms"   value={order.PaymentTerms} />
            <LV label="Salesperson"     value={order.Salesperson} />
            <LV label="Legal Entity"    value={order.RequestingLegalEntity} cols={2} />
            <LV label="Order Date"      value={fmtDateTime(order.TransactionOn)} />
            <LV label="Requested Ship"  value={fmtDate(order.RequestedShipDate)} />
            <LV label="Submitted"       value={fmtDateTime(order.SubmittedDate)} />
            <LV label="Submitted By"    value={order.SubmittedBy} />
            <LV label="Created By"      value={order.CreatedBy} />
            <LV label="Created"         value={fmtDateTime(order.CreationDate)} />
            <LV label="Last Updated"    value={fmtDateTime(order.LastUpdateDate)} />
            <LV label="Source Txn #"    value={<Text style={{ fontFamily: 'monospace' }}>{order.SourceTransactionNumber}</Text>} />
            <LV label="Order Key"       value={<Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{order.OrderKey}</Text>} cols={2} />
          </Row>
          <Divider style={{ margin: '8px 0 12px' }} />
          <Button size="small" icon={<InfoCircleOutlined />} onClick={() => setDetail(order)}
            style={{ color: REDWOOD.info }}>View all Oracle fields</Button>
        </div>
      ),
    },
    linesUrl && {
      key: 'lines',
      label: (
        <Space size={4}>
          <UnorderedListOutlined />Order Lines
          {!linesLoading && lines.length > 0 && <Badge count={lines.length} style={{ background: REDWOOD.teal }} />}
          {linesLoading && <Spin size="small" />}
        </Space>
      ),
      children: <LinesTab lines={lines} loading={linesLoading} />,
    },
  ].filter(Boolean) as any[];

  return (
    <div style={{ background: REDWOOD.neutral100, minHeight: '100%' }}>
      {/* Toolbar */}
      <div style={{ background: REDWOOD.teal, padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <ShoppingOutlined style={{ color: '#fff', fontSize: 16 }} />
          <Text strong style={{ color: '#fff', fontSize: 14 }}>Order #{order.OrderNumber}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{order.BuyingPartyName}</Text>
          {statusTag(order.Status, order.StatusCode)}
        </Space>
        {onClose && (
          <Button size="small" icon={<CloseOutlined />}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontWeight: 600 }}
            onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {/* Quick stats */}
      <div style={{ background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, padding: '10px 24px', display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Customer',         val: order.BuyingPartyName },
          { label: 'Business Unit',    val: order.BusinessUnitName },
          { label: 'Transaction Type', val: order.TransactionTypeCode || order.TransactionType },
          { label: 'Currency',         val: order.TransactionalCurrencyCode },
          { label: 'Order Date',       val: fmtDate(order.TransactionOn) },
          { label: 'Ship Date',        val: fmtDate(order.RequestedShipDate) },
          { label: 'Payment Terms',    val: order.PaymentTerms },
        ].map(s => (
          <div key={s.label}>
            <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>{s.label}</Text>
            <Text strong style={{ fontSize: 13 }}>{s.val || '—'}</Text>
          </div>
        ))}
        {/* Order total */}
        <div style={{ marginLeft: 'auto', borderLeft: `2px solid ${REDWOOD.neutral200}`, paddingLeft: 24 }}>
          <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>Order Total</Text>
          {linesLoading
            ? <Spin size="small" />
            : <Text strong style={{ fontSize: 18, color: REDWOOD.teal, fontFamily: 'monospace' }}>
                {order.TransactionalCurrencyCode} {fmtAmt(orderTotal)}
              </Text>
          }
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{lines.length} line{lines.length !== 1 ? 's' : ''}</Text>
        </div>
        {order.OnHoldFlag && <Tag color="orange" style={{ fontWeight: 600 }}>ON HOLD</Tag>}
        {order.CanceledFlag && <Tag color="red" style={{ fontWeight: 600 }}>CANCELED</Tag>}
      </div>

      {/* Tabs */}
      <div style={{ padding: '16px 20px' }}>
        <Card styles={{ body: { padding: 0 } }}
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab} size="small"
            style={{ paddingLeft: 16, paddingRight: 16 }}
            tabBarStyle={{ marginBottom: 0, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
            items={tabs} />
        </Card>
      </div>

      <DetailModal record={detail} onClose={() => setDetail(null)} />
    </div>
  );
};

// ── Search Tab ────────────────────────────────────────────────────────────────
const SearchTab: React.FC<{ onOpen: (order: RawOrder) => void }> = ({ onOpen }) => {
  const [form] = Form.useForm();
  const [data, setData]         = useState<RawOrder[]>([]);
  const [loading, setLoading]   = useState(false);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [params, setParams]     = useState<SearchParams | null>(null);
  const [filter, setFilter]     = useState('');
  const [searched, setSearched] = useState(false);

  const buildUrl = (p: SearchParams, pg: number) => {
    const parts: string[] = [];
    if (p.orderNumber?.trim()) parts.push(`OrderNumber=${p.orderNumber.trim()}`);
    if (p.customer?.trim())    parts.push(`BuyingPartyName like "${p.customer.trim()}*"`);
    if (p.status)              parts.push(`StatusCode=${p.status}`);
    if (p.currency)            parts.push(`TransactionalCurrencyCode=${p.currency}`);
    if (p.dateFrom)            parts.push(`TransactionOn>="${p.dateFrom}T00:00:00+00:00"`);
    if (p.dateTo)              parts.push(`TransactionOn<="${p.dateTo}T23:59:59+00:00"`);
    const up = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((pg - 1) * PAGE_SIZE),
      totalResults: 'true',
    });
    if (parts.length) up.set('q', parts.join(';'));
    return `${BASE_URL}/salesOrdersForOrderHub?${up}`;
  };

  const fetchData = useCallback(async (p: SearchParams, pg: number) => {
    setLoading(true);
    try {
      const res = await fetch(buildUrl(p, pg), { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      setData(json.items ?? []);
      setTotal(json.totalResults ?? json.count ?? (json.items ?? []).length);
    } catch (e: any) {
      message.error(`Failed to load orders: ${e.message}`, 6);
      setData([]); setTotal(0);
    } finally { setLoading(false); }
  }, []);

  const handleSearch = () => {
    const v = form.getFieldsValue();
    const p: SearchParams = {
      orderNumber: v.orderNumber,
      customer:    v.customer,
      status:      v.status,
      currency:    v.currency,
      dateFrom:    v.dateRange?.[0]?.format('YYYY-MM-DD'),
      dateTo:      v.dateRange?.[1]?.format('YYYY-MM-DD'),
    };
    setParams(p); setPage(1); setSearched(true); setFilter('');
    fetchData(p, 1);
  };

  const handleReset = () => {
    form.resetFields();
    setParams(null); setPage(1); setData([]); setTotal(0); setSearched(false); setFilter('');
  };

  const filtered = data.filter(r => matchesFilter(r, filter));

  const columns: ColumnsType<RawOrder> = [
    {
      title: 'Source Txn #', dataIndex: 'SourceTransactionNumber', fixed: 'left', width: 110,
      render: (v: any, rec: any) => (
        <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontFamily: 'monospace' }}
          onClick={() => onOpen(rec)}>{v}</Button>
      ),
    },
    {
      title: 'Order #', dataIndex: 'OrderNumber', width: 85,
      render: (v: any) => <Text style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: 'Customer', dataIndex: 'BuyingPartyName', ellipsis: true, width: 220,
      render: (v: any, r: any) => (
        <div>
          <Text strong style={{ fontSize: 12 }}>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{r.BuyingPartyNumber}</Text>
        </div>
      ),
    },
    { title: 'Business Unit', dataIndex: 'BusinessUnitName', ellipsis: true, width: 200 },
    {
      title: 'Order Date', dataIndex: 'TransactionOn', width: 105,
      render: fmtDate, sorter: (a: any, b: any) => (a.TransactionOn ?? '').localeCompare(b.TransactionOn ?? ''),
    },
    { title: 'Currency', dataIndex: 'TransactionalCurrencyCode', width: 80, render: (v: any) => <Tag color="gold">{v}</Tag> },
    { title: 'Payment', dataIndex: 'PaymentTerms', width: 110 },
    {
      title: 'Status', dataIndex: 'Status', width: 110,
      render: (v: any, r: any) => statusTag(v, r.StatusCode),
      filters: [
        { text: 'Open', value: 'OPEN' },
        { text: 'Closed', value: 'CLOSED' },
        { text: 'Canceled', value: 'CANCELED' },
      ],
      onFilter: (value: any, record: any) => record.StatusCode === value,
    },
    {
      title: 'Flags', key: '_flags', width: 120,
      render: (_: any, r: any) => (
        <Space size={2}>
          {r.OnHoldFlag    && <Tag color="orange" style={{ fontSize: 10 }}>Hold</Tag>}
          {r.CanceledFlag  && <Tag color="red"    style={{ fontSize: 10 }}>Canceled</Tag>}
          {r.SubmittedFlag && <Tag color="green"  style={{ fontSize: 10 }}>Submitted</Tag>}
        </Space>
      ),
    },
    { title: 'Customer PO', dataIndex: 'CustomerPONumber', width: 110 },
    { title: 'Ship Date', dataIndex: 'RequestedShipDate', width: 105, render: fmtDate },
    {
      title: '', key: '_open', width: 42, fixed: 'right' as const,
      render: (_: any, rec: any) => (
        <Tooltip title="Open order">
          <Button type="text" size="small" icon={<InfoCircleOutlined />}
            style={{ color: REDWOOD.info }} onClick={() => onOpen(rec)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      {/* Search form */}
      <Card style={{ borderRadius: 8, marginBottom: 16, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: '16px 20px' } }}>
        <Form form={form} layout="inline" onFinish={handleSearch} style={{ flexWrap: 'wrap', gap: 8 }}>
          <Form.Item name="orderNumber" label={<Text style={{ fontSize: 12 }}>Order #</Text>} style={{ marginBottom: 8 }}>
            <Input placeholder="e.g. 100" style={{ width: 130 }} allowClear />
          </Form.Item>
          <Form.Item name="customer" label={<Text style={{ fontSize: 12 }}>Customer</Text>} style={{ marginBottom: 8 }}>
            <Input placeholder="Name prefix..." style={{ width: 200 }} allowClear prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="status" label={<Text style={{ fontSize: 12 }}>Status</Text>} style={{ marginBottom: 8 }}>
            <Select placeholder="Any" allowClear style={{ width: 130 }}>
              <Option value="OPEN">Open</Option>
              <Option value="CLOSED">Closed</Option>
              <Option value="CANCELED">Canceled</Option>
              <Option value="ON_HOLD">On Hold</Option>
            </Select>
          </Form.Item>
          <Form.Item name="currency" label={<Text style={{ fontSize: 12 }}>Currency</Text>} style={{ marginBottom: 8 }}>
            <Select placeholder="Any" allowClear style={{ width: 100 }}>
              <Option value="AED">AED</Option>
              <Option value="USD">USD</Option>
              <Option value="EUR">EUR</Option>
              <Option value="INR">INR</Option>
            </Select>
          </Form.Item>
          <Form.Item name="dateRange" label={<Text style={{ fontSize: 12 }}>Order Date</Text>} style={{ marginBottom: 8 }}>
            <RangePicker size="small" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Search
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* Results */}
      {searched && (
        <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          title={
            <Space>
              <ShoppingOutlined style={{ color: REDWOOD.teal }} />
              <Text strong>Sales Orders</Text>
              <Badge count={total} overflowCount={99999} style={{ background: REDWOOD.teal }} />
            </Space>
          }
          extra={
            <Input size="small" prefix={<FilterOutlined style={{ color: REDWOOD.neutral600 }} />}
              placeholder="Filter results..." value={filter}
              onChange={e => setFilter(e.target.value)} allowClear style={{ width: 220 }} />
          }
        >
          <Table dataSource={filtered} columns={columns} rowKey="HeaderId" loading={loading}
            size="small" scroll={{ x: 1100 }}
            pagination={{
              current: page, pageSize: PAGE_SIZE, total,
              showSizeChanger: false,
              showTotal: (t, [s, e]) => `${s}–${e} of ${t} orders`,
              onChange: p => { setPage(p); if (params) fetchData(params, p); },
            }}
            style={{ fontSize: 12 }}
            locale={{ emptyText: <Empty description="No orders found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      )}

      {!searched && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <ShoppingOutlined style={{ fontSize: 52, color: REDWOOD.neutral300, display: 'block', marginBottom: 12 }} />
          <Text type="secondary">Use the filters above to search for sales orders</Text>
        </div>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const ManageSalesOrders: React.FC = () => {
  const [openTabs, setOpenTabs]   = useState<{ key: string; order: RawOrder }[]>([]);
  const [activeKey, setActiveKey] = useState('search');

  const handleOpen = (order: RawOrder) => {
    const key = String(order.HeaderId);
    if (!openTabs.find(t => t.key === key)) {
      setOpenTabs(prev => [...prev, { key, order }]);
    }
    setActiveKey(key);
  };

  const handleClose = (key: string) => {
    const idx = openTabs.findIndex(t => t.key === key);
    setOpenTabs(prev => prev.filter(t => t.key !== key));
    if (activeKey === key) setActiveKey(openTabs[idx - 1]?.key ?? 'search');
  };

  const tabItems = [
    {
      key: 'search',
      label: <Space size={4}><SearchOutlined />Search</Space>,
      children: <SearchTab onOpen={handleOpen} />,
      closable: false,
    },
    ...openTabs.map(t => ({
      key: t.key,
      label: (
        <Space size={4}>
          <ShoppingOutlined style={{ fontSize: 11 }} />
          <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', whiteSpace: 'nowrap' }}>
            Order #{t.order.OrderNumber}
          </span>
        </Space>
      ),
      children: <OrderDetailPage key={t.key} order={t.order} onClose={() => handleClose(t.key)} />,
      closable: true,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/om">Order Management</Link> },
            { title: 'Sales Orders' },
          ]} />
          <Text type="secondary" style={{ fontSize: 11 }}>Oracle Fusion Order Hub · Real-time order data</Text>
        </div>
        <Tabs type="editable-card" hideAdd activeKey={activeKey} onChange={setActiveKey}
          onEdit={(key, action) => { if (action === 'remove') handleClose(String(key)); }}
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{ margin: 0, paddingLeft: 16, background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
          items={tabItems}
        />
      </Content>
    </Layout>
  );
};

export default ManageSalesOrders;
