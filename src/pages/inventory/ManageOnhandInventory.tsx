import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input,
  Row, Col, Space, Tag, Tabs, message, Empty, Modal, Tooltip, Badge,
  Divider, Drawer, Spin, Select, Descriptions,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, DatabaseOutlined, SearchOutlined, ReloadOutlined,
  InfoCircleOutlined, CloseOutlined, AppstoreOutlined, BarcodeOutlined,
  TagsOutlined, ApartmentOutlined, FilterOutlined, InboxOutlined,
  ApiOutlined, DollarOutlined, ReconciliationOutlined, BranchesOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

// ── Palette ───────────────────────────────────────────────────────────────────
const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C',
  teal: '#00918A', tealDark: '#007A74',
  success: '#1D7B4D', warning: '#B07700', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── API ───────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://iacney-test.fa.ocs.oraclecloud.com/fscmRestApi/resources/11.13.18.05';
const LATEST_URL = 'https://iacney-test.fa.ocs.oraclecloud.com/fscmRestApi/resources/latest';
const AUTH_HEADER = 'Basic ' + btoa('emparun:Fusion@1234');
const HEADERS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const PAGE_SIZE = 50;
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
interface RawOnhand {
  ItemNumber: string;
  ItemDescription: string;
  OrganizationCode: string;
  OrganizationId: number;
  InventoryItemId: number;
  SubinventoryCode: string;
  Locator: string;
  LocatorId: number;
  PrimaryQuantity: number;
  ConsignedQuantity: number;
  PrimaryUOMCode: string;
  PrimaryUnitOfMeasure: string;
  MaterialStatus: string;
  MaterialStatusId: number;
  Revision: string | null;
  SummaryLevel: string;
  CreationDate: string;
  LastUpdateDate: string;
  links?: Array<{ rel: string; href: string; name: string; kind: string }>;
  [key: string]: any;
}

interface GroupedItem {
  key: string;
  ItemNumber: string;
  ItemDescription: string;
  OrganizationCode: string;
  TotalQty: number;
  PrimaryUOMCode: string;
  Subinventories: string[];
  LineCount: number;
  MaterialStatus: string;
  LastUpdateDate: string;
  rows: RawOnhand[];
}

interface SearchParams { orgCode: string; itemNumber?: string; subinventory?: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const matchesFilter = (row: any, q: string) => {
  if (!q) return true;
  const low = q.toLowerCase();
  return Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(low));
};

const groupByItem = (rows: RawOnhand[]): GroupedItem[] => {
  const map = new Map<string, GroupedItem>();
  rows.forEach(row => {
    const key = `${row.ItemNumber}::${row.OrganizationCode}`;
    if (map.has(key)) {
      const g = map.get(key)!;
      g.TotalQty += row.PrimaryQuantity;
      if (row.SubinventoryCode && !g.Subinventories.includes(row.SubinventoryCode))
        g.Subinventories.push(row.SubinventoryCode);
      g.LineCount++;
      g.rows.push(row);
      if (row.LastUpdateDate > g.LastUpdateDate) g.LastUpdateDate = row.LastUpdateDate;
    } else {
      map.set(key, {
        key,
        ItemNumber: row.ItemNumber,
        ItemDescription: row.ItemDescription,
        OrganizationCode: row.OrganizationCode,
        TotalQty: row.PrimaryQuantity,
        PrimaryUOMCode: row.PrimaryUOMCode,
        Subinventories: row.SubinventoryCode ? [row.SubinventoryCode] : [],
        LineCount: 1,
        MaterialStatus: row.MaterialStatus,
        LastUpdateDate: row.LastUpdateDate,
        rows: [row],
      });
    }
  });
  return Array.from(map.values());
};

// ── LV field label/value ──────────────────────────────────────────────────────
const LV: React.FC<{ label: string; value?: React.ReactNode; cols?: number }> = ({ label, value, cols = 1 }) => (
  <Col xs={24} sm={12} md={6 * cols}>
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{value ?? <span style={{ color: REDWOOD.neutral300 }}>—</span>}</div>
    </div>
  </Col>
);

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard: React.FC<{ label: string; value: React.ReactNode; color: string }> = ({ label, value, color }) => (
  <Card size="small" style={{ textAlign: 'center', border: `1px solid ${color}30`, background: `${color}08`, borderRadius: 8 }} styles={{ body: { padding: '12px 8px' } }}>
    <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{label}</div>
  </Card>
);

// ── Full-record detail modal ──────────────────────────────────────────────────
const DetailModal: React.FC<{ record: any; onClose: () => void }> = ({ record, onClose }) => (
  <Modal
    title={<Space><InfoCircleOutlined style={{ color: REDWOOD.info }} /><span>Full Record</span></Space>}
    open={!!record}
    onCancel={onClose}
    footer={null}
    width={700}
    styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
  >
    {record && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
        {Object.entries(record).filter(([k]) => k !== 'links' && !k.startsWith('_')).map(([k, v]) => (
          <div key={k} style={{ borderBottom: `1px solid ${REDWOOD.neutral100}`, paddingBottom: 5 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
            <div style={{ fontSize: 12, color: REDWOOD.neutral900, wordBreak: 'break-all' }}>
              {v === null || v === undefined ? <span style={{ color: REDWOOD.neutral300 }}>—</span> : String(v)}
            </div>
          </div>
        ))}
      </div>
    )}
  </Modal>
);

// ── All Lots Tab (aggregates lots from ALL item rows) ─────────────────────────
const AllLotsTab: React.FC<{ allLots: any[]; loading: boolean }> = ({ allLots, loading }) => {
  const [filter, setFilter]           = useState('');
  const [detail, setDetail]           = useState<any | null>(null);
  const [serialDrawer, setSerialDrawer] = useState<{ lot: any; url: string } | null>(null);
  const [lotSerials, setLotSerials]   = useState<any[]>([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [serialFilter, setSerialFilter] = useState('');

  const filtered = allLots.filter(r => matchesFilter(r, filter));

  const handleViewSerials = async (lot: any) => {
    const url = lot.links?.find((l: any) => l.name === 'lotSerials')?.href;
    if (!url) { message.info('No serial numbers linked to this lot'); return; }
    setSerialDrawer({ lot, url });
    setSerialLoading(true);
    setLotSerials([]);
    setSerialFilter('');
    try {
      const serials = await fetchAllPages(url);
      setLotSerials(serials);
    } catch (e: any) {
      message.error(`Failed to load serials: ${e.message}`, 5);
    } finally {
      setSerialLoading(false);
    }
  };

  const cols: ColumnsType<any> = [
    { title: 'Subinventory', dataIndex: '_subinventory', width: 110, render: (v: any) => <Tag color="cyan" style={{ fontWeight: 600 }}>{v}</Tag> },
    { title: 'Locator',      dataIndex: '_locator',      width: 130, ellipsis: true },
    {
      title: 'Lot Number', dataIndex: 'LotNumber', width: 160,
      render: (v: any) => <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Qty', dataIndex: 'PrimaryQuantity', width: 80, align: 'right' as const,
      sorter: (a: any, b: any) => (a.PrimaryQuantity ?? 0) - (b.PrimaryQuantity ?? 0),
      render: (v: any) => <Tag color={v > 0 ? 'green' : 'default'} style={{ fontWeight: 700, minWidth: 36, textAlign: 'center' }}>{v ?? 0}</Tag>,
    },
    { title: 'UOM', dataIndex: 'PrimaryUOMCode', width: 65 },
    {
      title: 'Expiry', dataIndex: 'ExpirationDate', width: 110,
      render: (v: any) => v ? <Tag color="orange">{fmtDate(v)}</Tag> : <span style={{ color: REDWOOD.neutral300 }}>—</span>,
    },
    { title: 'Originated',  dataIndex: 'OriginationDate',  width: 110, render: fmtDate },
    { title: 'Status',      dataIndex: 'MaterialStatus',   width: 90,  render: (v: any) => v ? <Tag color="blue">{v}</Tag> : '—' },
    {
      title: '', key: '_act', width: 100, fixed: 'right' as const,
      render: (_: any, row: any) => {
        const hasSerials = row.links?.some((l: any) => l.name === 'lotSerials');
        return (
          <Space size={4}>
            {hasSerials && (
              <Button size="small" icon={<BarcodeOutlined />}
                style={{ fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={() => handleViewSerials(row)}>
                Serials
              </Button>
            )}
            <Tooltip title="All fields">
              <Button size="small" shape="circle" icon={<InfoCircleOutlined />}
                style={{ color: REDWOOD.info, borderColor: REDWOOD.neutral200 }}
                onClick={() => setDetail(row)} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  const filteredSerials = lotSerials.filter(r => matchesFilter(r, serialFilter));
  const serialCols: ColumnsType<any> = [
    { title: 'Serial Number',  dataIndex: 'SerialNumber',  render: (v: any) => <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.teal }}>{v ?? '—'}</Text> },
    { title: 'Status',         dataIndex: 'CurrentStatus', render: (v: any) => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: 'Lot Number',     dataIndex: 'LotNumber',     render: (v: any) => v ? <Tag color="purple">{v}</Tag> : '—' },
    { title: 'Created',        dataIndex: 'CreationDate',  render: fmtDate },
    { title: 'Last Updated',   dataIndex: 'LastUpdateDate', render: fmtDate },
    {
      title: '', key: '_info', width: 40,
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
      {/* Filter bar */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        <FilterOutlined style={{ color: REDWOOD.neutral600, fontSize: 13 }} />
        <Input size="small" placeholder={`Filter ${allLots.length} lots...`} value={filter}
          onChange={e => setFilter(e.target.value)} allowClear style={{ maxWidth: 300 }} />
        {filter && <Text type="secondary" style={{ fontSize: 11 }}>{filtered.length} match</Text>}
        <div style={{ marginLeft: 'auto' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{allLots.length} lots total</Text>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading lots from all storage locations..." /></div>
      ) : (
        <Table dataSource={filtered} columns={cols} rowKey={(_, i) => String(i)} size="small"
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} lots` }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No lots found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          style={{ fontSize: 12 }}
        />
      )}

      {/* Lot serials drawer */}
      <Drawer
        title={
          <Space>
            <BarcodeOutlined style={{ color: REDWOOD.teal }} />
            <span>Serial Numbers — Lot: <Text strong style={{ color: REDWOOD.info }}>{serialDrawer?.lot?.LotNumber}</Text></span>
            <Tag color="cyan">{serialDrawer?.lot?._subinventory}</Tag>
          </Space>
        }
        open={!!serialDrawer}
        onClose={() => { setSerialDrawer(null); setLotSerials([]); setSerialFilter(''); }}
        width={800}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', gap: 8, alignItems: 'center' }}>
          <FilterOutlined style={{ color: REDWOOD.neutral600, fontSize: 13 }} />
          <Input size="small" placeholder={`Filter ${lotSerials.length} serials...`} value={serialFilter}
            onChange={e => setSerialFilter(e.target.value)} allowClear style={{ maxWidth: 300 }} />
          {serialFilter && <Text type="secondary" style={{ fontSize: 11 }}>{filteredSerials.length} match</Text>}
          <div style={{ marginLeft: 'auto' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>{lotSerials.length} serials</Text>
          </div>
        </div>
        {serialLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading serial numbers..." /></div>
        ) : (
          <Table dataSource={filteredSerials} columns={serialCols} rowKey={(_, i) => String(i)} size="small"
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} serials` }}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No serials" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            style={{ fontSize: 12 }}
          />
        )}
      </Drawer>

      <DetailModal record={detail} onClose={() => setDetail(null)} />
    </>
  );
};

// Split a ValuationUnit like "COSTORG-INVORG-SUBINV-LOT\-2026020223" into parts.
// Hyphens escaped as "\-" (inside the lot) are NOT split points.
const parseValuationUnit = (vu?: string) => {
  if (!vu) return { costOrg: '', invOrg: '', subinv: '', lot: '' };
  const parts = String(vu).split(/(?<!\\)-/);   // split on unescaped hyphens
  const costOrg = parts[0] || '';
  const invOrg  = parts[1] || '';
  const subinv  = parts[2] || '';
  const lot     = parts.slice(3).join('-').replace(/\\-/g, '-');
  return { costOrg, invOrg, subinv, lot };
};

const numFmt = (v: any) =>
  v == null || v === '' || isNaN(Number(v)) ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(v));

// ── Purchase Order drill-down dialog ──────────────────────────────────────────
// Opened from the Reference # (PO) column on a Cost tab. Fetches the PO header +
// lines from Fusion and shows them in a modal — the user stays on the on-hand
// screen. Query mirrors: /purchaseOrders?q=OrderNumber=<ref>&expand=lines
const PurchaseOrderDialog: React.FC<{ orderNumber: string | null; onClose: () => void }> = ({ orderNumber, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [po, setPo]           = useState<any>(null);
  const [lines, setLines]     = useState<any[]>([]);

  const url = orderNumber
    ? `${BASE_URL}/purchaseOrders?q=OrderNumber=${encodeURIComponent(orderNumber)}&expand=lines`
    : '';

  useEffect(() => {
    if (!orderNumber) return;
    let cancelled = false;
    setLoading(true); setErr(''); setPo(null); setLines([]);
    fetch(url, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}: ${r.statusText}`)))
      .then(d => {
        if (cancelled) return;
        const header = (d.items ?? [])[0];
        if (!header) { setErr(`No purchase order found for Order Number ${orderNumber}.`); return; }
        setPo(header);
        setLines(header.lines?.items ?? header.lines ?? []);
      })
      .catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderNumber, url]);

  const money = (v: any, ccy?: string) =>
    v == null || v === '' || isNaN(Number(v)) ? '—'
      : `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}${ccy ? ' ' + ccy : ''}`;

  const lineCols: ColumnsType<any> = [
    { title: 'Line', dataIndex: 'LineNumber', key: 'LineNumber', width: 60, align: 'right' as const, render: (v: any) => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Type', dataIndex: 'LineType', key: 'LineType', width: 90, ellipsis: true, render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : '—' },
    { title: 'Item', dataIndex: 'Item', key: 'Item', width: 130, ellipsis: true, render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <span style={{ color: REDWOOD.neutral300 }}>—</span> },
    { title: 'Description', dataIndex: 'Description', key: 'Description', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'UOM', dataIndex: 'UOM', key: 'UOM', width: 80, ellipsis: true, render: (v: string) => v || '—' },
    { title: 'Qty', dataIndex: 'Quantity', key: 'Quantity', width: 90, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
    { title: 'Price', dataIndex: 'Price', key: 'Price', width: 110, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v)}</Text> },
    { title: 'Ordered', dataIndex: 'Ordered', key: 'Ordered', width: 120, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v)}</Text> },
    { title: 'Need-By', dataIndex: 'NeedByDate', key: 'NeedByDate', width: 110, render: (v: string) => v ? fmtDate(v) : '—' },
    { title: 'Status', dataIndex: 'Status', key: 'Status', width: 110, ellipsis: true, render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '—' },
  ];

  return (
    <Modal
      open={!!orderNumber}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width={1000}
      title={
        <Space>
          <ReconciliationOutlined style={{ color: REDWOOD.primary }} />
          <span>Purchase Order {orderNumber}</span>
        </Space>
      }
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      {loading && <div style={{ textAlign: 'center', padding: 48 }}><Spin tip="Loading purchase order…" /></div>}
      {!loading && err && <Empty description={err} />}
      {!loading && !err && po && (
        <>
          <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}
            labelStyle={{ fontSize: 12, fontWeight: 600, width: 150 }} contentStyle={{ fontSize: 12 }}>
            <Descriptions.Item label="Order Number">{po.OrderNumber ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Status">{po.Status ? <Tag color="green">{po.Status}</Tag> : '—'}</Descriptions.Item>
            <Descriptions.Item label="Supplier">{po.Supplier ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Supplier Site">{po.SupplierSite ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Buyer">{po.BuyerDisplayName ?? po.Buyer ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Procurement BU">{po.ProcurementBU ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Order Date">{po.OrderDate ? fmtDate(po.OrderDate) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Currency">{po.CurrencyCode ?? po.Currency ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Ordered">{money(po.Ordered, po.CurrencyCode)}</Descriptions.Item>
            <Descriptions.Item label="Total">{money(po.Total, po.CurrencyCode)}</Descriptions.Item>
            {po.Description && <Descriptions.Item label="Description" span={2}>{po.Description}</Descriptions.Item>}
          </Descriptions>
          <Divider orientation="left" style={{ fontSize: 13 }}>Lines ({lines.length})</Divider>
          <Table
            size="small"
            rowKey={(r: any) => String(r.POLineId ?? r.LineNumber)}
            columns={lineCols}
            dataSource={lines}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: 'No lines on this purchase order.' }}
          />
        </>
      )}
    </Modal>
  );
};

// ── Cost tab (Receipt Costs / Item Costs) ─────────────────────────────────────
// If the resource returns ValuationUnit rows, group by ValuationUnit — split it
// into Cost Org / Inventory Org / Subinventory / Lot, show TotalUnitCost, and
// sum ReceiptQuantity + QuantityOnhand. Otherwise show a clean table (id/links
// columns removed). The API icon (hover) shows the exact webservice URL.
const CostTab: React.FC<{ url: string; emptyText: string }> = ({ url, emptyText }) => {
  const [poDialog, setPoDialog] = useState<string | null>(null);
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [filter, setFilter]   = useState('');

  const load = useCallback(() => {
    setLoading(true); setErr('');
    fetch(url, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}: ${r.statusText}`)))
      .then(d => setRows(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(e => { setErr(e.message); setRows([]); })
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const hasVU = rows.some(r => r.ValuationUnit != null);

  // Grouped-by-ValuationUnit rows
  const grouped = React.useMemo(() => {
    const map = new Map<string, any>();
    rows.forEach(r => {
      const vu = String(r.ValuationUnit ?? '');
      let g = map.get(vu);
      if (!g) { g = { vu, ...parseValuationUnit(vu), totalUnitCost: null, receiptQty: 0, onhandQty: 0, count: 0, _recpt: new Set<string>(), _ref: new Set<string>() }; map.set(vu, g); }
      g.receiptQty += Number(r.ReceiptQuantity) || 0;
      g.onhandQty  += Number(r.QuantityOnhand)  || 0;
      g.count      += 1;
      if (r.TotalUnitCost != null && r.TotalUnitCost !== '') g.totalUnitCost = r.TotalUnitCost;
      if (r.ReceiptNumber)   g._recpt.add(String(r.ReceiptNumber));
      if (r.ReferenceNumber) g._ref.add(String(r.ReferenceNumber));
    });
    return Array.from(map.values()).map(g => ({
      ...g,
      receiptNumber: Array.from(g._recpt).join(', '),
      referenceNumber: Array.from(g._ref).join(', '),
      referenceList: Array.from(g._ref) as string[],
    }));
  }, [rows]);

  const groupedCols: ColumnsType<any> = [
    { title: 'Cost Org',      dataIndex: 'costOrg', key: 'costOrg', width: 150, ellipsis: true, render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Inventory Org', dataIndex: 'invOrg',  key: 'invOrg',  width: 150, ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Subinventory',  dataIndex: 'subinv',  key: 'subinv',  width: 130, render: (v: string) => v ? <Tag color="cyan">{v}</Tag> : '—' },
    { title: 'Lot',           dataIndex: 'lot',     key: 'lot',     width: 170, ellipsis: true, render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : '—' },
    { title: 'Receipt #',     dataIndex: 'receiptNumber',   key: 'receiptNumber',   width: 130, ellipsis: true, render: (v: string) => v || <span style={{ color: REDWOOD.neutral300 }}>—</span> },
    { title: 'Reference # (PO)', dataIndex: 'referenceNumber', key: 'referenceNumber', width: 150, ellipsis: true,
      render: (_: any, r: any) => {
        const refs: string[] = r.referenceList || [];
        if (refs.length === 0) return <span style={{ color: REDWOOD.neutral300 }}>—</span>;
        return (
          <Space size={4} wrap>
            {refs.map((ref, i) => (
              <Tooltip key={i} title={`Drill down to Purchase Order ${ref}`}>
                <a onClick={() => setPoDialog(ref)}
                  style={{ fontSize: 12, fontWeight: 600 }}>{ref}</a>
              </Tooltip>
            ))}
          </Space>
        );
      } },
    { title: 'Total Unit Cost', dataIndex: 'totalUnitCost', key: 'totalUnitCost', width: 140, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
    { title: 'Receipt Qty',   dataIndex: 'receiptQty', key: 'receiptQty', width: 120, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
    { title: 'On-hand Qty',   dataIndex: 'onhandQty',  key: 'onhandQty',  width: 120, align: 'right' as const, render: (v: any) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: Number(v) > 0 ? REDWOOD.success : undefined }}>{numFmt(v)}</Text> },
    { title: '# Receipts',    dataIndex: 'count',      key: 'count',      width: 90, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 12 }}>{v}</Text> },
  ];

  // Clean flat columns (fallback): drop id + links + object columns.
  const flatCols: ColumnsType<any> = React.useMemo(() => {
    const keys: string[] = [];
    rows.forEach(r => Object.keys(r).forEach(k => {
      if (k === 'links') return;
      if (/id$/i.test(k)) return;                 // drop all *Id columns
      if (typeof (r as any)[k] === 'object' && (r as any)[k] !== null) return;
      if (!keys.includes(k)) keys.push(k);
    }));
    return keys.map(k => ({
      title: k, dataIndex: k, key: k, ellipsis: true, width: 150,
      render: (v: any) => {
        if (v == null || v === '') return <span style={{ color: REDWOOD.neutral300 }}>—</span>;
        if (/date/i.test(k) && typeof v === 'string' && v.length >= 10) return <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>;
        if (/cost|amount|price|qty|quantity/i.test(k) && !isNaN(Number(v)))
          return <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text>;
        return <Text style={{ fontSize: 12 }}>{String(v)}</Text>;
      },
    }));
  }, [rows]);

  const dataSource = hasVU ? grouped : rows;
  const columns = hasVU ? groupedCols : flatCols;
  const filtered = filter ? dataSource.filter((r: any) => matchesFilter(r, filter)) : dataSource;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <Space>
          <Input size="small" allowClear prefix={<FilterOutlined />} placeholder="Filter results…"
            value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 240 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} {hasVU ? 'valuation unit(s)' : 'row(s)'}</Text>
        </Space>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>GET {url}</span>} placement="bottomRight">
            <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 15 }} />
          </Tooltip>
        </Space>
      </div>
      {err && <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 8 }}>Failed to load: {err}</div>}
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={(_, i) => String(i)}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} rows` }}
        locale={{ emptyText: loading ? 'Loading…' : (err ? 'Error' : emptyText) }}
        summary={() => (hasVU && filtered.length > 0) ? (
          <Table.Summary fixed>
            <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
              <Table.Summary.Cell index={0} colSpan={7}><Text strong>Total ({filtered.length})</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{numFmt(filtered.reduce((s: number, g: any) => s + g.receiptQty, 0))}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{numFmt(filtered.reduce((s: number, g: any) => s + g.onhandQty, 0))}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={9} />
            </Table.Summary.Row>
          </Table.Summary>
        ) : null}
      />
      <PurchaseOrderDialog orderNumber={poDialog} onClose={() => setPoDialog(null)} />
    </div>
  );
};

// ── Cost Distributions tab ────────────────────────────────────────────────────
// TransactionIds come from receiptCosts for the item; the Retrieve button then
// pulls costDistributions?q=TransactionId=<id> for the selected (or all) txns.
const CostDistributionsTab: React.FC<{ itemNumber: string }> = ({ itemNumber }) => {
  const [txns, setTxns]         = useState<{ id: string; receipt: string; reference: string }[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState<string>('all');
  const [rows, setRows]         = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');
  const [filter, setFilter]     = useState('');
  const [ran, setRan]           = useState(false);

  const txnSourceUrl = `${LATEST_URL}/itemCosts?q=${encodeURIComponent('ItemNumber=' + itemNumber)}&limit=${CHILD_LIMIT}`;

  // Load the transaction ids (from itemCosts) for the dropdown.
  useEffect(() => {
    setTxnLoading(true);
    fetch(txnSourceUrl, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        const seen = new Set<string>();
        const list: { id: string; receipt: string; reference: string }[] = [];
        items.forEach(r => {
          const id = r.TransactionId != null ? String(r.TransactionId) : '';
          if (id && !seen.has(id)) { seen.add(id); list.push({ id, receipt: String(r.ReceiptNumber ?? ''), reference: String(r.ReferenceNumber ?? '') }); }
        });
        setTxns(list);
      })
      .catch(() => setTxns([]))
      .finally(() => setTxnLoading(false));
  }, [itemNumber]);

  const distUrl = (id: string) => `${BASE_URL}/costDistributions?q=${encodeURIComponent('TransactionId=' + id)}&limit=${CHILD_LIMIT}`;

  const retrieve = async () => {
    const ids = selectedTxn === 'all' ? txns.map(t => t.id) : [selectedTxn];
    if (ids.length === 0) { message.warning('No transaction ids found from receiptCosts for this item'); return; }
    setLoading(true); setErr(''); setRan(true);
    try {
      const results = await Promise.all(ids.map(async id => {
        const r = await fetch(distUrl(id), { headers: HEADERS });
        if (!r.ok) return [];
        const d = await r.json();
        return (d.items ?? []).map((x: any) => ({ ...x, _TransactionId: id }));
      }));
      setRows(results.flat());
    } catch (e: any) {
      setErr(e.message); setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // Clean columns: drop all *Id + object/links.
  const cols: ColumnsType<any> = React.useMemo(() => {
    const keys: string[] = [];
    rows.forEach(r => Object.keys(r).forEach(k => {
      if (k === 'links' || k === '_TransactionId') return;
      if (/id$/i.test(k)) return;                                 // drop all *Id columns
      if (typeof (r as any)[k] === 'object' && (r as any)[k] !== null) return;
      if (!keys.includes(k)) keys.push(k);
    }));
    // Move CostElementCode to right after the Accounted Dr column.
    const ceIdx = keys.findIndex(k => /costelementcode/i.test(k));
    if (ceIdx >= 0) {
      const [ce] = keys.splice(ceIdx, 1);
      const drIdx = keys.findIndex(k => /accounteddr/i.test(k));
      if (drIdx >= 0) keys.splice(drIdx + 1, 0, ce); else keys.push(ce);
    }
    return keys.map(k => ({
      title: k, dataIndex: k, key: k, ellipsis: true, width: 150,
      render: (v: any) => {
        if (v == null || v === '') return <span style={{ color: REDWOOD.neutral300 }}>—</span>;
        if (/date/i.test(k) && typeof v === 'string' && v.length >= 10) return <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>;
        if (/cost|amount|price|qty|quantity|dr$|cr$/i.test(k) && !isNaN(Number(v)))
          return <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text>;
        return <Text style={{ fontSize: 12 }}>{String(v)}</Text>;
      },
    }));
  }, [rows]);

  const filtered = filter ? rows.filter(r => matchesFilter(r, filter)) : rows;
  const activeUrl = selectedTxn === 'all'
    ? distUrl('<each TransactionId>')
    : distUrl(selectedTxn);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <Space wrap>
          <Text style={{ fontSize: 12 }}>Transaction:</Text>
          <Select
            size="small"
            style={{ width: 320 }}
            loading={txnLoading}
            value={selectedTxn}
            onChange={setSelectedTxn}
            showSearch
            optionFilterProp="label"
            options={[
              { value: 'all', label: `All transactions (${txns.length})` },
              ...txns.map(t => ({ value: t.id, label: `${t.id}${t.receipt ? ` · Rcpt ${t.receipt}` : ''}${t.reference ? ` · Ref ${t.reference}` : ''}` })),
            ]}
          />
          <Button type="primary" size="small" icon={<BranchesOutlined />} loading={loading}
            style={{ background: REDWOOD.teal, borderColor: REDWOOD.teal }} onClick={retrieve}>
            Retrieve Distributions
          </Button>
        </Space>
        <Space>
          <Input size="small" allowClear prefix={<FilterOutlined />} placeholder="Filter…"
            value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 200 }} />
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>GET {activeUrl}</span>} placement="bottomRight">
            <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 15 }} />
          </Tooltip>
        </Space>
      </div>
      {err && <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 8 }}>Failed to load: {err}</div>}
      <Table
        dataSource={filtered}
        columns={cols}
        rowKey={(_, i) => String(i)}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} rows` }}
        locale={{ emptyText: ran ? (loading ? 'Loading…' : 'No cost distributions') : 'Pick a transaction and click Retrieve Distributions' }}
      />
    </div>
  );
};

// ── Inventory Transactions tab ────────────────────────────────────────────────
// GET inventoryCompletedTransactions?q=Organization=<org>;Item=<item>
// Columns are built dynamically, dropping any column that is null/empty across
// every row (plus links + object columns). Each transaction row expands to show
// its lots, fetched on demand from the row's `lots` child href.
const buildDynamicCols = (rows: any[], opts?: { dropIds?: boolean }): ColumnsType<any> => {
  const keys: string[] = [];
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (k === 'links' || k.startsWith('_')) return;
    if (opts?.dropIds && /id$/i.test(k)) return;   // drop *Id columns when requested
    if (keys.includes(k)) return;
    // keep a column only if at least one row has a non-null, non-empty, non-object value
    const hasValue = rows.some(row => {
      const v = row[k];
      return v != null && v !== '' && !(typeof v === 'object');
    });
    if (hasValue) keys.push(k);
  }));
  return keys.map(k => ({
    title: k, dataIndex: k, key: k, ellipsis: true,
    width: /description|address|explanation/i.test(k) ? 220 : 150,
    render: (v: any) => {
      if (v == null || v === '') return <span style={{ color: REDWOOD.neutral300 }}>—</span>;
      if (/date/i.test(k) && typeof v === 'string' && v.length >= 10) return <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>;
      if (/quantity|qty|amount|cost|value|price/i.test(k) && !isNaN(Number(v)))
        return <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text>;
      return <Text style={{ fontSize: 12 }}>{String(v)}</Text>;
    },
  }));
};

// Lots for a single transaction — lazy-fetched from the child href.
const TxnLots: React.FC<{ href: string }> = ({ href }) => {
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr('');
    fetchAllPages(href)
      .then(d => { if (!cancelled) setRows(d); })
      .catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [href]);

  if (loading) return <div style={{ padding: 12 }}><Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>Loading lots…</Text></div>;
  if (err)     return <div style={{ padding: 12, color: REDWOOD.error, fontSize: 12 }}>Failed to load lots: {err}</div>;
  if (rows.length === 0) return <div style={{ padding: 12 }}><Text type="secondary" style={{ fontSize: 12 }}>No lots for this transaction.</Text></div>;

  return (
    <div style={{ padding: '4px 8px 8px 8px' }}>
      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        <TagsOutlined style={{ color: REDWOOD.teal, marginRight: 6 }} />Lots ({rows.length})
      </Text>
      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        columns={buildDynamicCols(rows)}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
};

const InventoryTransactionsTab: React.FC<{ organizationCode: string; itemNumber: string }> = ({ organizationCode, itemNumber }) => {
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [filter, setFilter]   = useState('');

  const [ran, setRan] = useState(false);

  const url = `${BASE_URL}/inventoryCompletedTransactions?q=${encodeURIComponent(`Organization=${organizationCode};Item=${itemNumber}`)}&limit=${CHILD_LIMIT}`;

  const load = useCallback(() => {
    setLoading(true); setErr(''); setRan(true);
    fetchAllPages(url)
      .then(d => setRows(d))
      .catch(e => { setErr(e.message); setRows([]); })
      .finally(() => setLoading(false));
  }, [url]);

  const columns = React.useMemo(() => buildDynamicCols(rows), [rows]);
  const filtered = filter ? rows.filter(r => matchesFilter(r, filter)) : rows;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <Space>
          <Input size="small" allowClear prefix={<FilterOutlined />} placeholder="Filter results…"
            value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 240 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} transaction(s)</Text>
        </Space>
        <Space>
          <Button type="primary" size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}
            style={{ background: REDWOOD.teal, borderColor: REDWOOD.teal }}>Refresh</Button>
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>GET {url}</span>} placement="bottomRight">
            <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 15 }} />
          </Tooltip>
        </Space>
      </div>
      {err && <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 8 }}>Failed to load: {err}</div>}
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={(r: any, i) => String(r.TransactionId ?? i)}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} rows` }}
        locale={{ emptyText: loading ? 'Loading…' : (ran ? (err ? 'Error' : `No transactions for ${itemNumber}`) : 'Click Refresh to load transactions') }}
        expandable={{
          expandedRowRender: (r: any) => {
            const lotsHref = r.links?.find((l: any) => l.name === 'lots')?.href
              ?? `${BASE_URL}/inventoryCompletedTransactions/${r.TransactionId}/child/lots`;
            return <TxnLots href={lotsHref} />;
          },
          rowExpandable: (r: any) => r.TransactionId != null || (r.links?.some((l: any) => l.name === 'lots') ?? false),
        }}
      />
    </div>
  );
};

// ── Purchase Order tab ────────────────────────────────────────────────────────
// On Refresh: read receiptCosts for the item → collect distinct Reference # (PO)
// → for each PO run purchaseOrders?q=OrderNumber=<ref> → follow the header's
// `lines` child href → fetch and show all PO lines. Null + *Id columns dropped.
const PurchaseOrderTab: React.FC<{ itemNumber: string }> = ({ itemNumber }) => {
  const [lines, setLines]     = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [filter, setFilter]   = useState('');
  const [ran, setRan]         = useState(false);
  const [poCount, setPoCount] = useState(0);

  const receiptCostsUrl = `${BASE_URL}/receiptCosts?q=${encodeURIComponent('Item=' + itemNumber)}&limit=${CHILD_LIMIT}`;

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setRan(true); setLines([]); setPoCount(0);
    try {
      // 1) receipt costs → distinct reference (PO) numbers
      const receipts = await fetchAllPages(receiptCostsUrl);
      const refs = Array.from(new Set(
        receipts.map(r => r.ReferenceNumber).filter(v => v != null && v !== '').map(String)
      ));
      if (refs.length === 0) { setErr('No Reference # (PO) found on receipt costs for this item.'); return; }
      setPoCount(refs.length);

      // 2+3) per PO: header → lines child href → lines
      const perPo = await Promise.all(refs.map(async (ref) => {
        const headerUrl = `${BASE_URL}/purchaseOrders?q=${encodeURIComponent('OrderNumber=' + ref)}`;
        const hr = await fetch(headerUrl, { headers: HEADERS });
        if (!hr.ok) return [];
        const hd = await hr.json();
        const header = (hd.items ?? [])[0];
        if (!header) return [];
        const linesHref = header.links?.find((l: any) => l.name === 'lines')?.href
          ?? `${BASE_URL}/purchaseOrders/${header.POHeaderId}/child/lines`;
        const poLines = await fetchAllPages(linesHref);
        return poLines.map((ln: any) => ({ ...ln, _orderNumber: ref }));
      }));
      setLines(perPo.flat());
    } catch (e: any) {
      setErr(e.message); setLines([]);
    } finally {
      setLoading(false);
    }
  }, [receiptCostsUrl]);

  useEffect(() => { load(); }, [load]);

  const columns: ColumnsType<any> = React.useMemo(() => {
    const orderCol: ColumnsType<any>[number] = {
      title: 'Order Number', dataIndex: '_orderNumber', key: '_orderNumber', width: 140, fixed: 'left' as const,
      render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v || '—'}</Text>,
    };
    return [orderCol, ...buildDynamicCols(lines, { dropIds: true })];
  }, [lines]);

  const filtered = filter ? lines.filter(r => matchesFilter(r, filter)) : lines;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <Space>
          <Button type="primary" size="small" icon={<ReloadOutlined />} loading={loading}
            style={{ background: REDWOOD.teal, borderColor: REDWOOD.teal }} onClick={load}>
            Refresh
          </Button>
          <Input size="small" allowClear prefix={<FilterOutlined />} placeholder="Filter results…"
            value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 220 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {filtered.length} line(s){poCount > 0 ? ` · ${poCount} PO(s)` : ''}
          </Text>
        </Space>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>Step 1 · GET {receiptCostsUrl}</span>} placement="bottomRight">
          <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 15 }} />
        </Tooltip>
      </div>
      {err && <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={(r: any, i) => `${r._orderNumber}-${r.POLineId ?? r.LineNumber ?? i}`}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} rows` }}
        locale={{ emptyText: loading ? 'Loading…' : (ran ? (err ? 'Error' : `No purchase order lines for ${itemNumber}`) : 'Click Refresh to load') }}
      />
    </div>
  );
};

// ── Item Detail Page ──────────────────────────────────────────────────────────
const OnhandDetailPage: React.FC<{ items: RawOnhand[]; onClose?: () => void }> = ({ items, onClose }) => {
  const [activeTab, setActiveTab] = useState('summary');
  const [allLots, setAllLots]     = useState<any[]>([]);
  const [lotsLoading, setLotsLoading] = useState(true);

  const first = items[0];
  const totalQty       = items.reduce((s, r) => s + (r.PrimaryQuantity ?? 0), 0);
  const totalConsigned = items.reduce((s, r) => s + (r.ConsignedQuantity ?? 0), 0);

  // Fetch lots from ALL rows eagerly so Summary can show lot count
  useEffect(() => {
    setLotsLoading(true);
    setAllLots([]);
    const fetches = items.map(async (item) => {
      const url = item.links?.find(l => l.name === 'lots')?.href;
      if (!url) return [];
      const lots = await fetchAllPages(url);
      return lots.map((l: any) => ({ ...l, _subinventory: item.SubinventoryCode, _locator: item.Locator }));
    });
    Promise.allSettled(fetches).then(results => {
      const combined: any[] = [];
      results.forEach(r => { if (r.status === 'fulfilled') combined.push(...r.value); });
      setAllLots(combined);
    }).catch(() => {}).finally(() => setLotsLoading(false));
  }, [items]);

  const lineTableCols: ColumnsType<RawOnhand> = [
    { title: 'Subinventory', dataIndex: 'SubinventoryCode', width: 120, render: (v: any) => <Tag color="cyan">{v}</Tag> },
    { title: 'Locator',      dataIndex: 'Locator',          width: 140, ellipsis: true },
    {
      title: 'On-Hand Qty', dataIndex: 'PrimaryQuantity', width: 100, align: 'right' as const,
      render: (v: any) => <Tag color={v > 0 ? 'green' : 'default'} style={{ fontWeight: 700 }}>{v}</Tag>,
    },
    { title: 'Consigned',    dataIndex: 'ConsignedQuantity', width: 90, align: 'right' as const },
    { title: 'Status',       dataIndex: 'MaterialStatus',   width: 90, render: (v: any) => <Tag color={v === 'Active' ? 'green' : 'default'}>{v ?? '—'}</Tag> },
    { title: 'Revision',     dataIndex: 'Revision',         width: 80 },
    { title: 'Last Updated', dataIndex: 'LastUpdateDate',   width: 115, render: fmtDate },
  ];

  const summaryTab = {
    key: 'summary',
    label: <Space size={4}><AppstoreOutlined />Summary</Space>,
    children: (
      <div style={{ padding: '20px 24px' }}>
        {/* Aggregate stat cards */}
        <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={6}>
            <StatCard label={`Total Qty (${first.PrimaryUOMCode})`} value={totalQty} color={REDWOOD.teal} />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard label="Storage Locations" value={items.length} color={REDWOOD.info} />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard
              label="Total Lots"
              value={lotsLoading ? <Spin size="small" /> : allLots.length}
              color={REDWOOD.warning}
            />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard label="Consigned Qty" value={totalConsigned} color={REDWOOD.neutral600} />
          </Col>
        </Row>

        {/* Item master fields */}
        <Row gutter={[16, 0]} style={{ marginBottom: 20 }}>
          <LV label="Item Number"     value={<Text strong style={{ fontFamily: 'monospace', color: REDWOOD.info, fontSize: 14 }}>{first.ItemNumber}</Text>} />
          <LV label="Description"     value={first.ItemDescription} cols={2} />
          <LV label="Organization"    value={<Tag style={{ fontWeight: 700 }}>{first.OrganizationCode}</Tag>} />
          <LV label="UOM"             value={first.PrimaryUOMCode} />
          <LV label="Material Status" value={<Tag color={first.MaterialStatus === 'Active' ? 'green' : 'default'}>{first.MaterialStatus ?? '—'}</Tag>} />
          <LV label="Summary Level"   value={first.SummaryLevel} />
          <LV label="Inventory Item ID" value={<Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{first.InventoryItemId}</Text>} />
          <LV label="Organization ID"   value={<Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{first.OrganizationId}</Text>} />
        </Row>

        {/* Lines breakdown */}
        <Divider style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
          Storage Locations ({items.length})
        </Divider>
        <Table
          dataSource={items}
          columns={lineTableCols}
          rowKey={(_, i) => String(i)}
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          style={{ fontSize: 12 }}
          summary={() => (
            <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
              <Table.Summary.Cell index={0} colSpan={2}>
                <Text strong style={{ fontSize: 12 }}>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Tag color="green" style={{ fontWeight: 800 }}>{totalQty}</Tag>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{totalConsigned}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} colSpan={3} />
            </Table.Summary.Row>
          )}
        />
      </div>
    ),
  };

  const lotsTab = {
    key: 'lots',
    label: (
      <Space size={4}>
        <TagsOutlined />
        Lots
        {!lotsLoading && allLots.length > 0 && (
          <Badge count={allLots.length} style={{ background: REDWOOD.teal }} />
        )}
        {lotsLoading && <Spin size="small" />}
      </Space>
    ),
    children: <AllLotsTab allLots={allLots} loading={lotsLoading} />,
  };

  // Check if any row has a serials link (non-lot-controlled items)
  const directSerialsUrl = items.find(r => r.links?.some(l => l.name === 'serials'))
    ?.links?.find(l => l.name === 'serials')?.href;

  const tabItems = [summaryTab, lotsTab];

  if (directSerialsUrl) {
    tabItems.push({
      key: 'serials',
      label: <Space size={4}><BarcodeOutlined />Serials</Space>,
      children: (
        <AllLotsTab
          allLots={[]}
          loading={false}
        />
      ),
    });
  }

  // Receipt Costs — GET receiptCosts?q=Item=<itemNumber>
  const receiptCostsUrl = `${BASE_URL}/receiptCosts?q=${encodeURIComponent('Item=' + first.ItemNumber)}&limit=${CHILD_LIMIT}`;
  tabItems.push({
    key: 'receiptCosts',
    label: <Space size={4}><ReconciliationOutlined />Receipt Costs</Space>,
    children: <CostTab url={receiptCostsUrl} emptyText={`No receipt costs for ${first.ItemNumber}`} />,
  });

  // Item Costs — GET (latest) itemCosts?q=ItemNumber=<itemNumber>
  const itemCostsUrl = `${LATEST_URL}/itemCosts?q=${encodeURIComponent('ItemNumber=' + first.ItemNumber)}&limit=${CHILD_LIMIT}`;
  tabItems.push({
    key: 'itemCosts',
    label: <Space size={4}><DollarOutlined />Item Costs</Space>,
    children: <CostTab url={itemCostsUrl} emptyText={`No item costs for ${first.ItemNumber}`} />,
  });

  // Cost Distributions — GET costDistributions?q=TransactionId=<id from receiptCosts>
  tabItems.push({
    key: 'costDistributions',
    label: <Space size={4}><BranchesOutlined />Cost Distributions</Space>,
    children: <CostDistributionsTab itemNumber={first.ItemNumber} />,
  });

  // Inventory Transactions — GET inventoryCompletedTransactions?q=Organization=<org>;Item=<item>
  tabItems.push({
    key: 'inventoryTransactions',
    label: <Space size={4}><InboxOutlined />Inventory Transactions</Space>,
    children: <InventoryTransactionsTab organizationCode={first.OrganizationCode} itemNumber={first.ItemNumber} />,
  });

  // Purchase Order — receiptCosts reference #(s) → purchaseOrders → lines
  tabItems.push({
    key: 'purchaseOrder',
    label: <Space size={4}><ShoppingOutlined />Purchase Order</Space>,
    children: <PurchaseOrderTab itemNumber={first.ItemNumber} />,
  });

  return (
    <div style={{ background: REDWOOD.neutral100, minHeight: '100%' }}>
      {/* Toolbar */}
      <div style={{ background: REDWOOD.teal, padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <DatabaseOutlined style={{ color: '#fff', fontSize: 16 }} />
          <Text strong style={{ color: '#fff', fontSize: 14 }}>{first.ItemNumber}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{first.ItemDescription}</Text>
          <Tag style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontWeight: 700 }}>{first.OrganizationCode}</Tag>
        </Space>
        {onClose && (
          <Button size="small" icon={<CloseOutlined />}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontWeight: 600 }}
            onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {/* Quick stats bar */}
      <div style={{ background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, padding: '10px 24px', display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Total On-Hand', value: <Text strong style={{ fontSize: 18, color: totalQty > 0 ? REDWOOD.success : REDWOOD.error }}>{totalQty} <span style={{ fontSize: 12, fontWeight: 400, color: REDWOOD.neutral600 }}>{first.PrimaryUOMCode}</span></Text> },
          { label: 'Storage Lines', value: <Text strong style={{ fontSize: 16 }}>{items.length}</Text> },
          { label: 'Total Lots',    value: lotsLoading ? <Spin size="small" /> : <Text strong style={{ fontSize: 16 }}>{allLots.length}</Text> },
          { label: 'Consigned',     value: <Text strong style={{ fontSize: 16 }}>{totalConsigned}</Text> },
          { label: 'Status',        value: <Tag color={first.MaterialStatus === 'Active' ? 'green' : 'default'} style={{ fontWeight: 600 }}>{first.MaterialStatus ?? '—'}</Tag> },
        ].map(s => (
          <div key={s.label}>
            <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>{s.label}</Text>
            {s.value}
          </div>
        ))}
      </div>

      {/* Detail tabs */}
      <div style={{ padding: '16px 20px' }}>
        <Card styles={{ body: { padding: 0 } }}
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="small"
            style={{ paddingLeft: 16, paddingRight: 16 }}
            tabBarStyle={{ marginBottom: 0, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
            items={tabItems}
          />
        </Card>
      </div>
    </div>
  );
};

// ── Search Tab ────────────────────────────────────────────────────────────────
const SearchTab: React.FC<{ onOpen: (items: RawOnhand[]) => void }> = ({ onOpen }) => {
  const [form] = Form.useForm();
  const [rawData, setRawData]   = useState<RawOnhand[]>([]);
  const [loading, setLoading]   = useState(false);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [params, setParams]     = useState<SearchParams | null>(null);
  const [filter, setFilter]     = useState('');
  const [searched, setSearched] = useState(false);

  // Organization Code options — from inventoryOrganizations
  const [orgs, setOrgs]         = useState<{ code: string; name: string; id?: number }[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);

  useEffect(() => {
    setOrgsLoading(true);
    fetch(`${BASE_URL}/inventoryOrganizations?limit=500&onlyData=true&fields=OrganizationCode,OrganizationName,OrganizationId`, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        const seen = new Set<string>();
        const list = items
          .map(o => ({ code: o.OrganizationCode, name: o.OrganizationName, id: o.OrganizationId }))
          .filter(o => o.code && !seen.has(o.code) && seen.add(o.code))
          .sort((a, b) => String(a.code).localeCompare(String(b.code)));
        setOrgs(list);
      })
      .catch(() => { /* fall back to free typing */ })
      .finally(() => setOrgsLoading(false));
  }, []);

  const buildUrl = (p: SearchParams, pg: number) => {
    const parts = [`OrganizationCode=${p.orgCode.trim()}`];
    if (p.itemNumber?.trim()) parts.push(`ItemNumber like "${p.itemNumber.trim()}*"`);
    if (p.subinventory?.trim()) parts.push(`SubinventoryCode=${p.subinventory.trim()}`);
    const up = new URLSearchParams({ q: parts.join(';'), limit: String(PAGE_SIZE), offset: String((pg - 1) * PAGE_SIZE), totalResults: 'true' });
    return `${BASE_URL}/inventoryOnhandBalances?${up}`;
  };

  const fetchData = useCallback(async (p: SearchParams, pg: number) => {
    setLoading(true);
    try {
      const res = await fetch(buildUrl(p, pg), { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      setRawData(json.items ?? []);
      setTotal(json.totalResults ?? json.count ?? (json.items ?? []).length);
    } catch (e: any) {
      message.error(`Failed to load inventory: ${e.message}`, 6);
      setRawData([]); setTotal(0);
    } finally { setLoading(false); }
  }, []);

  const handleSearch = () => {
    const v = form.getFieldsValue();
    if (!v.orgCode?.trim()) { message.warning('Organization Code is required'); return; }
    const p: SearchParams = { orgCode: v.orgCode, itemNumber: v.itemNumber, subinventory: v.subinventory };
    setParams(p); setPage(1); setSearched(true); setFilter('');
    fetchData(p, 1);
  };

  const handleReset = () => {
    form.resetFields();
    setParams(null); setPage(1); setRawData([]); setTotal(0); setSearched(false); setFilter('');
  };

  // Group by item+org for display
  const grouped = groupByItem(rawData);
  const filteredGrouped = grouped.filter(g =>
    !filter || [g.ItemNumber, g.ItemDescription, g.OrganizationCode, ...g.Subinventories].some(v => v?.toLowerCase().includes(filter.toLowerCase()))
  );

  const handleRowClick = (group: GroupedItem) => {
    // Find all raw rows for this item (covers current page; typically all lines for an item appear together)
    const allRows = rawData.filter(r => r.ItemNumber === group.ItemNumber && r.OrganizationCode === group.OrganizationCode);
    onOpen(allRows);
  };

  const columns: ColumnsType<GroupedItem> = [
    {
      title: 'Item Number', dataIndex: 'ItemNumber', fixed: 'left', width: 160, ellipsis: true,
      render: (v: any, rec: any) => (
        <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 13, fontFamily: 'monospace' }}
          onClick={() => handleRowClick(rec)}>{v}</Button>
      ),
    },
    { title: 'Description', dataIndex: 'ItemDescription', ellipsis: true, width: 240 },
    { title: 'Org', dataIndex: 'OrganizationCode', width: 70, render: (v: any) => <Tag style={{ fontWeight: 600 }}>{v}</Tag> },
    {
      title: 'Subinventories', dataIndex: 'Subinventories', width: 180,
      render: (subs: string[]) => (
        <Space size={2} wrap>
          {subs.map(s => <Tag key={s} color="cyan" style={{ fontSize: 11 }}>{s}</Tag>)}
        </Space>
      ),
    },
    { title: 'Lines', dataIndex: 'LineCount', width: 65, align: 'center' as const, render: (v: any) => <Badge count={v} style={{ background: REDWOOD.neutral600 }} /> },
    {
      title: 'Total On-Hand', dataIndex: 'TotalQty', width: 120, align: 'right' as const,
      sorter: (a: any, b: any) => a.TotalQty - b.TotalQty,
      render: (v: any, r: any) => (
        <Space>
          <Tag color={v > 100 ? 'green' : v > 0 ? 'blue' : 'default'} style={{ fontWeight: 700, minWidth: 40, textAlign: 'center' }}>{v}</Tag>
          <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{r.PrimaryUOMCode}</Text>
        </Space>
      ),
    },
    { title: 'Status', dataIndex: 'MaterialStatus', width: 90, render: (v: any) => <Tag color={v === 'Active' ? 'green' : 'default'}>{v ?? '—'}</Tag> },
    { title: 'Last Updated', dataIndex: 'LastUpdateDate', width: 115, render: fmtDate, sorter: (a: any, b: any) => (a.LastUpdateDate ?? '').localeCompare(b.LastUpdateDate ?? '') },
    {
      title: '', key: '_open', width: 46, fixed: 'right' as const,
      render: (_: any, rec: any) => (
        <Tooltip title="Open detail">
          <Button type="text" size="small" icon={<InfoCircleOutlined />}
            style={{ color: REDWOOD.info }} onClick={() => handleRowClick(rec)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      {/* Search form */}
      <Card style={{ borderRadius: 8, marginBottom: 16, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: '16px 20px' } }}>
        <Form form={form} layout="inline" onFinish={handleSearch} style={{ gap: 8, flexWrap: 'wrap' }}>
          <Form.Item name="orgCode" label={<Text strong style={{ fontSize: 12 }}>Organization Code</Text>}
            rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 8 }}>
            <Select
              showSearch
              allowClear
              loading={orgsLoading}
              placeholder="Select organization"
              style={{ width: 260 }}
              optionFilterProp="label"
              options={orgs.map(o => ({ value: o.code, label: `${o.code} — ${o.name}` }))}
              notFoundContent={orgsLoading ? <Spin size="small" /> : 'No organizations'}
            />
          </Form.Item>
          <Form.Item name="itemNumber" label={<Text style={{ fontSize: 12 }}>Item Number</Text>} style={{ marginBottom: 8 }}>
            <Input placeholder="e.g. 6UW42AA  (prefix search)" style={{ width: 220 }} allowClear />
          </Form.Item>
          <Form.Item name="subinventory" label={<Text style={{ fontSize: 12 }}>Subinventory</Text>} style={{ marginBottom: 8 }}>
            <Input placeholder="e.g. S02" style={{ width: 130 }} allowClear />
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
        <Card styles={{ body: { padding: 0 } }}
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          title={
            <Space>
              <DatabaseOutlined style={{ color: REDWOOD.teal }} />
              <Text strong>On-Hand Balances</Text>
              <Badge count={grouped.length} overflowCount={9999} style={{ background: REDWOOD.teal }} />
              {rawData.length !== grouped.length && (
                <Text type="secondary" style={{ fontSize: 11 }}>({rawData.length} storage lines → {grouped.length} items)</Text>
              )}
            </Space>
          }
          extra={
            <Input size="small" prefix={<FilterOutlined style={{ color: REDWOOD.neutral600 }} />}
              placeholder="Filter items..." value={filter} onChange={e => setFilter(e.target.value)}
              allowClear style={{ width: 220 }} />
          }
        >
          <Table
            dataSource={filteredGrouped}
            columns={columns}
            rowKey="key"
            loading={loading}
            size="small"
            scroll={{ x: 1100 }}
            pagination={{
              current: page, pageSize: PAGE_SIZE, total,
              showSizeChanger: false,
              showTotal: (t, [s, e]) => `${s}–${e} of ${t} storage lines (${grouped.length} items)`,
              onChange: (p) => { setPage(p); if (params) fetchData(params, p); },
            }}
            style={{ fontSize: 12 }}
            locale={{ emptyText: <Empty description="No inventory records found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      )}

      {!searched && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <InboxOutlined style={{ fontSize: 52, color: REDWOOD.neutral300, display: 'block', marginBottom: 12 }} />
          <Text type="secondary">Enter an Organization Code and click Search to view on-hand inventory</Text>
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const ManageOnhandInventory: React.FC = () => {
  const [openTabs, setOpenTabs]   = useState<{ key: string; items: RawOnhand[] }[]>([]);
  const [activeKey, setActiveKey] = useState('search');

  const handleOpen = (items: RawOnhand[]) => {
    const key = `${items[0].ItemNumber}::${items[0].OrganizationCode}`;
    if (!openTabs.find(t => t.key === key)) {
      setOpenTabs(prev => [...prev, { key, items }]);
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
          <DatabaseOutlined style={{ fontSize: 11 }} />
          <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', whiteSpace: 'nowrap' }}>
            {t.items[0].ItemNumber}
          </span>
        </Space>
      ),
      children: <OnhandDetailPage key={t.key} items={t.items} onClose={() => handleClose(t.key)} />,
      closable: true,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'On-Hand Inventory' },
          ]} />
        </div>
        <div style={{ background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: `linear-gradient(135deg, ${REDWOOD.teal} 0%, ${REDWOOD.tealDark} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${REDWOOD.teal}40` }}>
            <DatabaseOutlined style={{ fontSize: 22, color: '#fff' }} />
          </div>
          <div>
            <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>On-Hand Inventory</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>Real-time balances · Lots · Serial Numbers — Oracle Fusion</Text>
          </div>
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

export default ManageOnhandInventory;
