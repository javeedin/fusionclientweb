import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Typography, Card, Table, Button, Form, Input, Space, Tabs,
  Tooltip, Row, Col, Tag, Select, Segmented, Empty, Spin, DatePicker, Progress,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  HomeOutlined, ReconciliationOutlined, SearchOutlined, ReloadOutlined,
  FilterOutlined, ApiOutlined, ClearOutlined, BarChartOutlined,
  DashboardOutlined, AppstoreOutlined, ApartmentOutlined, DatabaseOutlined,
  TagsOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, LabelList, PieChart, Pie, Legend,
} from 'recharts';
import { Link } from 'react-router-dom';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
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
const BASE_URL = `${getFusionBase()}`;
const AUTH_HEADER = FUSION_POD_AUTH;
const HEADERS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
// Small pages fetched in parallel are far faster than one large sequential page:
// Fusion computes a 500-row page slowly, whereas ten 50-row pages return quickly
// and can run concurrently. CONCURRENCY caps how many are in flight at once.
const PAGE_LIMIT = 50;
const CONCURRENCY = 8;

// ── Helpers ───────────────────────────────────────────────────────────────────
const numFmt = (v: any) =>
  v == null || v === '' || isNaN(Number(v)) ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(v));

const money = (v: number, ccy?: string) =>
  (v == null || isNaN(v)) ? '—'
    : `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}${ccy ? ' ' + ccy : ''}`;

const compact = (v: number) => {
  if (v == null || isNaN(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);
};

const fmtDate = (d?: string) => {
  if (!d || typeof d !== 'string' || d.length < 10) return d ?? '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const matchesFilter = (row: any, q: string) => {
  const needle = q.toLowerCase();
  return Object.values(row).some(v => v != null && String(v).toLowerCase().includes(needle));
};

// Split a ValuationUnit like "COSTORG-INVORG-SUBINV-LOT\-2026020223" into parts.
const parseValuationUnit = (vu?: string) => {
  if (!vu) return { costOrg: '', invOrg: '', subinv: '', lot: '' };
  const parts = String(vu).split(/(?<!\\)-/);
  return {
    costOrg: parts[0] || '',
    invOrg:  parts[1] || '',
    subinv:  parts[2] || '',
    lot:     parts.slice(3).join('-').replace(/\\-/g, '-'),
  };
};

const vuCols: ColumnsType<any> = [
  { title: 'Cost Org',      key: '_vu_costOrg', width: 150, ellipsis: true, render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return <Text strong style={{ fontSize: 12 }}>{p.costOrg || '—'}</Text>; } },
  { title: 'Inventory Org', key: '_vu_invOrg',  width: 150, ellipsis: true, render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return <Text style={{ fontSize: 12 }}>{p.invOrg || '—'}</Text>; } },
  { title: 'Subinventory',  key: '_vu_subinv',  width: 130,                 render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return p.subinv ? <Tag color="cyan">{p.subinv}</Tag> : '—'; } },
  { title: 'Lot',           key: '_vu_lot',     width: 180, ellipsis: true, render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return p.lot ? <Tag color="geekblue">{p.lot}</Tag> : '—'; } },
];

// Clean columns: drop links/object/all-null/*Id; break ValuationUnit into 4 cols.
const buildCols = (rows: any[]): ColumnsType<any> => {
  const keys: string[] = [];
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (k === 'links') return;
    if (/id$/i.test(k)) return;
    if (keys.includes(k)) return;
    const hasValue = rows.some(row => { const v = row[k]; return v != null && v !== '' && !(typeof v === 'object'); });
    if (hasValue) keys.push(k);
  }));
  const cols: ColumnsType<any> = [];
  keys.forEach(k => {
    if (/^valuationunit$/i.test(k)) { cols.push(...vuCols); return; }
    cols.push({
      title: k, dataIndex: k, key: k, ellipsis: true,
      width: /description|name/i.test(k) ? 220 : 150,
      render: (v: any) => {
        if (v == null || v === '') return <span style={{ color: REDWOOD.neutral300 }}>—</span>;
        if (/date/i.test(k) && typeof v === 'string' && v.length >= 10) return <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>;
        if (/cost|amount|price|qty|quantity|value/i.test(k) && !isNaN(Number(v)))
          return <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text>;
        return <Text style={{ fontSize: 12 }}>{String(v)}</Text>;
      },
    });
  });
  return cols;
};

// Pull all receiptCosts — capped so a broad search can't run away.
// Strategy: fetch page 0 with totalResults=true to learn the row count, then
// fan the remaining offsets out in parallel (CONCURRENCY at a time) using small
// PAGE_LIMIT pages. Pages are reassembled in offset order so results stay stable.
// onProgress(loaded, total) fires as each page lands so the UI can show a bar.
const fetchAllReceiptCosts = async (
  baseUrl: string,
  onProgress?: (loaded: number, total: number) => void,
  cap = 5000,
): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const sep = stripped.includes('?') ? '&' : '?';
  const pageUrl = (offset: number) => `${stripped}${sep}limit=${PAGE_LIMIT}&offset=${offset}`;

  // First page also asks Fusion for the total count.
  const r0 = await fetch(`${pageUrl(0)}&totalResults=true`, { headers: HEADERS });
  if (!r0.ok) throw new Error(`HTTP ${r0.status}: ${r0.statusText}`);
  const d0 = await r0.json();
  const first: any[] = Array.isArray(d0) ? d0 : (d0.items ?? []);
  const total = Math.min(
    typeof d0.totalResults === 'number' && d0.totalResults > 0 ? d0.totalResults : first.length,
    cap,
  );

  let loaded = first.length;
  onProgress?.(loaded, total);
  if (first.length < PAGE_LIMIT || loaded >= total) return first.slice(0, cap);

  // Remaining offsets to fetch.
  const offsets: number[] = [];
  for (let off = PAGE_LIMIT; off < total; off += PAGE_LIMIT) offsets.push(off);

  const pages: any[][] = new Array(offsets.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const my = next++;
      if (my >= offsets.length) return;
      const r = await fetch(pageUrl(offsets[my]), { headers: HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      const d = await r.json();
      const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
      pages[my] = items;
      loaded += items.length;
      onProgress?.(Math.min(loaded, total), total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker));
  return [first, ...pages].flat().slice(0, cap);
};

// ── Shared search params ──────────────────────────────────────────────────────
type DateOp = '=' | '>' | '>=' | '<' | '<=';
interface SearchVals {
  inventoryOrg?: string;   // InventoryOrganizationName (exact, from dropdown)
  reference?: string;      // ReferenceNumber (exact)
  item?: string;           // Item (like)
  costDateOp?: DateOp;     // comparison operator for CostDate
  costDate?: any;          // Dayjs from the DatePicker (or ISO string)
}

const buildQueryUrl = (vals: SearchVals): string => {
  const clauses: string[] = [];
  if (vals.inventoryOrg) clauses.push(`InventoryOrganizationName=${vals.inventoryOrg}`);
  if (vals.reference)    clauses.push(`ReferenceNumber=${vals.reference}`);
  // Exact item match (Item=<value>), not a LIKE prefix.
  if (vals.item)         clauses.push(`Item=${String(vals.item).trim()}`);
  if (vals.costDate) {
    const op = vals.costDateOp || '=';
    const d = typeof vals.costDate === 'string' ? vals.costDate : dayjs(vals.costDate).format('YYYY-MM-DD');
    clauses.push(`CostDate${op}${d}`);
  }
  const qs = clauses.length ? `?q=${encodeURIComponent(clauses.join(';'))}` : '';
  return `${BASE_URL}/receiptCosts${qs}`;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Search results table
// ═══════════════════════════════════════════════════════════════════════════════
// Grouped-by-ValuationUnit columns — mirrors the on-hand Receipt Costs tab:
// split the VU, show Total Unit Cost, and sum Receipt + On-hand quantities.
const groupedCols: ColumnsType<any> = [
  { title: 'Cost Org',      dataIndex: 'costOrg', key: 'costOrg', width: 150, ellipsis: true, render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v || '—'}</Text> },
  { title: 'Inventory Org', dataIndex: 'invOrg',  key: 'invOrg',  width: 150, ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
  { title: 'Item',          dataIndex: 'item',    key: 'item',    width: 140, ellipsis: true, render: (v: string) => v ? <Text strong style={{ fontSize: 12 }}>{v}</Text> : <span style={{ color: REDWOOD.neutral300 }}>—</span> },
  { title: 'Transaction Type', dataIndex: 'transactionType', key: 'transactionType', width: 180, ellipsis: true, render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <span style={{ color: REDWOOD.neutral300 }}>—</span> },
  { title: 'Subinventory',  dataIndex: 'subinv',  key: 'subinv',  width: 130, render: (v: string) => v ? <Tag color="cyan">{v}</Tag> : '—' },
  { title: 'Lot',           dataIndex: 'lot',     key: 'lot',     width: 180, ellipsis: true, render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : '—' },
  { title: 'Receipt #',     dataIndex: 'receiptNumber',   key: 'receiptNumber',   width: 130, ellipsis: true, render: (v: string) => v || <span style={{ color: REDWOOD.neutral300 }}>—</span> },
  { title: 'Reference # (PO)', dataIndex: 'referenceNumber', key: 'referenceNumber', width: 150, ellipsis: true, render: (v: string) => v || <span style={{ color: REDWOOD.neutral300 }}>—</span> },
  { title: 'Total Unit Cost', dataIndex: 'totalUnitCost', key: 'totalUnitCost', width: 140, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
  { title: 'Receipt Qty',   dataIndex: 'receiptQty', key: 'receiptQty', width: 120, align: 'right' as const, render: (v: any) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
  { title: 'On-hand Qty',   dataIndex: 'onhandQty',  key: 'onhandQty',  width: 120, align: 'right' as const, render: (v: any) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: Number(v) > 0 ? REDWOOD.success : undefined }}>{numFmt(v)}</Text> },
  { title: '# Receipts',    dataIndex: 'count',      key: 'count',      width: 90, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 12 }}>{v}</Text> },
];

const SearchTable: React.FC<{ rows: any[]; loading: boolean; err: string; ran: boolean; url: string; onRefresh: () => void }> =
({ rows, loading, err, ran, url, onRefresh }) => {
  const [filter, setFilter] = useState('');

  const hasVU = rows.some(r => r.ValuationUnit != null);

  // Group by ValuationUnit → split parts, keep unit cost, sum quantities.
  const grouped = React.useMemo(() => {
    const map = new Map<string, any>();
    rows.forEach(r => {
      const vu = String(r.ValuationUnit ?? '');
      let g = map.get(vu);
      if (!g) { g = { vu, ...parseValuationUnit(vu), totalUnitCost: null, receiptQty: 0, onhandQty: 0, count: 0, _recpt: new Set<string>(), _ref: new Set<string>(), _item: new Set<string>(), _txn: new Set<string>() }; map.set(vu, g); }
      g.receiptQty += Number(r.ReceiptQuantity) || 0;
      g.onhandQty  += Number(r.QuantityOnhand)  || 0;
      g.count      += 1;
      if (r.TotalUnitCost != null && r.TotalUnitCost !== '') g.totalUnitCost = r.TotalUnitCost;
      if (r.ReceiptNumber)        g._recpt.add(String(r.ReceiptNumber));
      if (r.ReferenceNumber)      g._ref.add(String(r.ReferenceNumber));
      if (r.Item)                 g._item.add(String(r.Item));
      if (r.TransactionTypeName)  g._txn.add(String(r.TransactionTypeName));
    });
    return Array.from(map.values()).map(g => ({
      ...g,
      receiptNumber: Array.from(g._recpt).join(', '),
      referenceNumber: Array.from(g._ref).join(', '),
      item: Array.from(g._item).join(', '),
      transactionType: Array.from(g._txn).join(', '),
    }));
  }, [rows]);

  const dataSource = hasVU ? grouped : rows;
  const columns = hasVU ? groupedCols : buildCols(rows);
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
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} disabled={!ran}>Refresh</Button>
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
        pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} ${hasVU ? 'valuation units' : 'rows'}` }}
        locale={{ emptyText: loading ? 'Loading…' : (ran ? (err ? 'Error' : 'No receipt costs found') : 'Set your criteria above and click Search') }}
        summary={() => (hasVU && filtered.length > 0) ? (
          <Table.Summary fixed>
            <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
              <Table.Summary.Cell index={0} colSpan={9}><Text strong>Total ({filtered.length})</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{numFmt(filtered.reduce((s: number, g: any) => s + g.receiptQty, 0))}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={10} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{numFmt(filtered.reduce((s: number, g: any) => s + g.onhandQty, 0))}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={11} />
            </Table.Summary.Row>
          </Table.Summary>
        ) : null}
      />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Analytics
// ═══════════════════════════════════════════════════════════════════════════════
const VIZ = {
  blue: '#2a78d6',
  cat: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  other: '#898781',
  grid: '#e1e0d9', axis: '#898781', sub: '#52514e',
};

type DimKey = 'invOrg' | 'subinv' | 'item' | 'reference';
type MeasureKey = 'avg' | 'totalCost' | 'receiptQty' | 'onhandQty' | 'count';

const DIMS: { key: DimKey; label: string; icon: React.ReactNode }[] = [
  { key: 'invOrg',    label: 'Inventory Org', icon: <ApartmentOutlined /> },
  { key: 'subinv',    label: 'Subinventory',  icon: <DatabaseOutlined /> },
  { key: 'item',      label: 'Item',          icon: <AppstoreOutlined /> },
  { key: 'reference', label: 'Reference (PO)',icon: <TagsOutlined /> },
];
const MEASURES: { key: MeasureKey; label: string; money: boolean }[] = [
  { key: 'avg',        label: 'Avg Unit Cost',    money: true },
  { key: 'totalCost',  label: 'Total Unit Cost',  money: true },
  { key: 'receiptQty', label: 'Receipt Qty',      money: false },
  { key: 'onhandQty',  label: 'On-hand Qty',      money: false },
  { key: 'count',      label: 'Record Count',     money: false },
];

const StatTile: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({ label, value, accent }) => (
  <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, borderLeft: `3px solid ${accent ?? REDWOOD.teal}` }} styles={{ body: { padding: '10px 14px' } }}>
    <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>{label}</Text>
    <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.neutral900, lineHeight: 1.25, marginTop: 2 }}>{value}</div>
  </Card>
);

const AnalyticsTab: React.FC<{ rows: any[]; loading: boolean; err: string; ran: boolean; onRefresh: () => void }> =
({ rows, loading, err, ran, onRefresh }) => {
  const [dim, setDim]         = useState<DimKey>('invOrg');
  const [measure, setMeasure] = useState<MeasureKey>('avg');
  const [topN, setTopN]       = useState(12);
  const [drill, setDrill]     = useState<{ dim: DimKey; value: string } | null>(null);

  // Normalise each receiptCost row.
  const recs = useMemo(() => rows.map(r => {
    const p = parseValuationUnit(r.ValuationUnit);
    const cost = Number(r.TotalUnitCost);
    return {
      item:      r.Item ?? '—',
      invOrg:    r.InventoryOrganizationName || p.invOrg || '—',
      subinv:    p.subinv || r.Subinventory || '—',
      reference: r.ReferenceNumber ?? '—',
      cost:      isNaN(cost) ? null : cost,
      receiptQty: Number(r.ReceiptQuantity) || 0,
      onhandQty:  Number(r.QuantityOnhand) || 0,
      ccy:       r.CurrencyCode ?? r.Currency ?? '',
    };
  }), [rows]);

  const ccy = useMemo(() => {
    const set = new Set(recs.map(r => r.ccy).filter(Boolean));
    return set.size === 1 ? Array.from(set)[0] as string : '';
  }, [recs]);

  const scoped = useMemo(() => drill ? recs.filter(r => (r as any)[drill.dim] === drill.value) : recs, [recs, drill]);

  const aggregate = (data: typeof recs, key: DimKey) => {
    const m = new Map<string, { key: string; count: number; sum: number; max: number; n: number; receiptQty: number; onhandQty: number }>();
    data.forEach(r => {
      const k = String((r as any)[key] ?? '—');
      let g = m.get(k);
      if (!g) { g = { key: k, count: 0, sum: 0, max: 0, n: 0, receiptQty: 0, onhandQty: 0 }; m.set(k, g); }
      g.count += 1; g.receiptQty += r.receiptQty; g.onhandQty += r.onhandQty;
      if (r.cost != null) { g.sum += r.cost; g.max = Math.max(g.max, r.cost); g.n += 1; }
    });
    return Array.from(m.values()).map(g => ({
      key: g.key, count: g.count, totalCost: g.sum, max: g.max,
      avg: g.n ? g.sum / g.n : 0, receiptQty: g.receiptQty, onhandQty: g.onhandQty,
    }));
  };

  const activeMeasure = MEASURES.find(x => x.key === measure)!;
  const measureVal = (row: any) => row[measure] as number;

  const barData = useMemo(() =>
    aggregate(recs, dim).sort((a, b) => measureVal(b) - measureVal(a)).slice(0, topN),
    [recs, dim, measure, topN]);

  const donutData = useMemo(() => {
    const agg = aggregate(scoped, 'invOrg').sort((a, b) => b.totalCost - a.totalCost);
    const top = agg.slice(0, 5);
    const rest = agg.slice(5).reduce((s, g) => s + g.totalCost, 0);
    const out = top.map(g => ({ name: g.key, value: g.totalCost }));
    if (rest > 0) out.push({ name: 'Other', value: rest });
    return out;
  }, [scoped]);

  const kpi = useMemo(() => {
    const costs = scoped.map(r => r.cost).filter((v): v is number => v != null);
    const avg = costs.length ? costs.reduce((s, v) => s + v, 0) / costs.length : 0;
    return {
      records: scoped.length,
      items:   new Set(scoped.map(r => r.item)).size,
      orgs:    new Set(scoped.map(r => r.invOrg)).size,
      receiptQty: scoped.reduce((s, r) => s + r.receiptQty, 0),
      onhandQty:  scoped.reduce((s, r) => s + r.onhandQty, 0),
      avg,
    };
  }, [scoped]);

  const dimLabel = DIMS.find(d => d.key === dim)!.label;
  const fmtMeasure = (v: number) => activeMeasure.money ? money(v, ccy) : new Intl.NumberFormat('en-US').format(v);

  if (!ran)    return <div style={{ padding: 48 }}><Empty description="Set your criteria above and click Search to build analytics" /></div>;
  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large"><div style={{ height: 40 }} /></Spin></div>;
  if (err)     return <div style={{ padding: 24 }}><Empty description={`Failed to load: ${err}`} /><div style={{ textAlign: 'center', marginTop: 12 }}><Button icon={<ReloadOutlined />} onClick={onRefresh}>Retry</Button></div></div>;
  if (recs.length === 0) return <div style={{ padding: 48 }}><Empty description="No receipt costs for these criteria" /></div>;

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Cost Records" value={kpi.records} accent={REDWOOD.teal} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Items" value={kpi.items} accent={REDWOOD.info} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Inventory Orgs" value={kpi.orgs} accent={VIZ.cat[2]} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Avg Unit Cost" value={money(kpi.avg, ccy)} accent={REDWOOD.primary} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Receipt Qty" value={compact(kpi.receiptQty)} accent={VIZ.cat[1]} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="On-hand Qty" value={compact(kpi.onhandQty)} accent={REDWOOD.success} /></Col>
      </Row>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <Space size={6}>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Group by</Text>
          <Segmented size="small" value={dim} onChange={(v) => { setDim(v as DimKey); setDrill(null); }}
            options={DIMS.map(d => ({ label: <Space size={4}>{d.icon}{d.label}</Space>, value: d.key }))} />
        </Space>
        <Space size={6}>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Measure</Text>
          <Select size="small" value={measure} onChange={setMeasure} style={{ width: 160 }}
            options={MEASURES.map(m => ({ label: m.label, value: m.key }))} />
        </Space>
        <Space size={6}>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Top</Text>
          <Select size="small" value={topN} onChange={setTopN} style={{ width: 90 }}
            options={[8, 12, 15, 20, 30].map(n => ({ label: `Top ${n}`, value: n }))} />
        </Space>
        {drill && (
          <Tag color="volcano" closable onClose={() => setDrill(null)} icon={<CloseCircleOutlined />} style={{ fontSize: 12 }}>
            {DIMS.find(d => d.key === drill.dim)!.label}: {drill.value}
          </Tag>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>Refresh</Button>
        </div>
      </div>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={15}>
          <Card size="small" title={<Space><BarChartOutlined style={{ color: VIZ.blue }} /><span style={{ fontSize: 13 }}>{activeMeasure.label} by {dimLabel} — Top {topN}</span></Space>}
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: '8px 8px 4px' } }}>
            {barData.length === 0 ? <Empty description="No data" style={{ padding: 24 }} /> : (
              <ResponsiveContainer width="100%" height={Math.max(240, barData.length * 30 + 40)}>
                <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={VIZ.grid} />
                  <XAxis type="number" tickFormatter={(v) => activeMeasure.money ? compact(v) : String(v)}
                    tick={{ fontSize: 11, fill: VIZ.axis }} axisLine={{ stroke: VIZ.grid }} tickLine={false} />
                  <YAxis type="category" dataKey="key" width={150} tick={{ fontSize: 11, fill: VIZ.sub }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 19) + '…' : v} />
                  <RTooltip cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                    formatter={(v: any) => [fmtMeasure(Number(v)), activeMeasure.label]}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${REDWOOD.neutral200}` }} />
                  <Bar dataKey={measure} radius={[0, 4, 4, 0]} maxBarSize={22} cursor="pointer"
                    onClick={(d: any) => setDrill(prev => prev && prev.value === d.key && prev.dim === dim ? null : { dim, value: d.key })}>
                    {barData.map((d) => (
                      <Cell key={d.key}
                        fill={drill && drill.dim === dim && drill.value === d.key ? REDWOOD.primary : VIZ.blue}
                        fillOpacity={drill && drill.dim === dim && drill.value !== d.key ? 0.35 : 1} />
                    ))}
                    <LabelList dataKey={measure} position="right"
                      formatter={(v: any) => activeMeasure.money ? compact(Number(v)) : String(v)}
                      style={{ fontSize: 10, fill: VIZ.sub, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <Text type="secondary" style={{ fontSize: 11, paddingLeft: 8 }}>Tip: click a bar to filter the analytics by that {dimLabel.toLowerCase()}.</Text>
          </Card>
        </Col>

        <Col xs={24} lg={9}>
          <Card size="small" title={<Space><DashboardOutlined style={{ color: VIZ.cat[2] }} /><span style={{ fontSize: 13 }}>Total Cost Share by Inventory Org</span></Space>}
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: 8 } }}>
            {donutData.length === 0 ? <Empty description="No data" style={{ padding: 24 }} /> : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={90}
                    paddingAngle={2} stroke="#fff" strokeWidth={2}
                    label={(e: any) => `${(e.percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 11 }}>
                    {donutData.map((d, i) => <Cell key={d.name} fill={d.name === 'Other' ? VIZ.other : VIZ.cat[i % VIZ.cat.length]} />)}
                  </Pie>
                  <RTooltip formatter={(v: any, n: any) => [money(Number(v), ccy), n]}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${REDWOOD.neutral200}` }} />
                  <Legend verticalAlign="bottom" height={64} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={<Space><BarChartOutlined /><span style={{ fontSize: 13 }}>Breakdown by {dimLabel}</span></Space>}
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginTop: 14 }} styles={{ body: { padding: 0 } }}>
        <Table
          size="small"
          rowKey="key"
          dataSource={aggregate(recs, dim).sort((a, b) => measureVal(b) - measureVal(a))}
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '25', '50'], showTotal: (t) => `${t} ${dimLabel.toLowerCase()}(s)` }}
          onRow={(r) => ({ onClick: () => setDrill(prev => prev && prev.value === r.key && prev.dim === dim ? null : { dim, value: r.key }), style: { cursor: 'pointer' } })}
          columns={[
            { title: dimLabel, dataIndex: 'key', ellipsis: true, render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
            { title: 'Records', dataIndex: 'count', width: 90, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text> },
            { title: 'Avg Unit Cost', dataIndex: 'avg', width: 130, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v, ccy)}</Text> },
            { title: 'Receipt Qty', dataIndex: 'receiptQty', width: 120, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
            { title: 'On-hand Qty', dataIndex: 'onhandQty', width: 120, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
            { title: 'Total Unit Cost', dataIndex: 'totalCost', width: 140, align: 'right', render: (v: number) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v, ccy)}</Text> },
          ]}
        />
      </Card>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Page — shared search form drives both the Search table and the Analytics tab
// ═══════════════════════════════════════════════════════════════════════════════
const ManageReceiptCost: React.FC = () => {
  const [form] = Form.useForm();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [ran, setRan]         = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  // Inventory Organization options — from inventoryOrganizations.
  const [orgs, setOrgs] = useState<{ name: string; code: string }[]>([]);
  useEffect(() => {
    fetch(`${BASE_URL}/inventoryOrganizations?limit=500&onlyData=true&fields=OrganizationCode,OrganizationName`, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        const seen = new Set<string>();
        const list = items
          .map(o => ({ name: o.OrganizationName as string, code: o.OrganizationCode as string }))
          .filter(o => o.name && !seen.has(o.name) && seen.add(o.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        setOrgs(list);
      })
      .catch(() => { /* free-typing fallback via combobox */ });
  }, []);

  const search = useCallback(() => {
    const vals = form.getFieldsValue() as SearchVals;
    setLoading(true); setErr(''); setRan(true); setProgress({ loaded: 0, total: 0 });
    fetchAllReceiptCosts(buildQueryUrl(vals), (loaded, total) => setProgress({ loaded, total }))
      .then(d => setRows(d))
      .catch(e => { setErr(e.message); setRows([]); })
      .finally(() => setLoading(false));
  }, [form]);

  const reset = () => { form.resetFields(); setRows([]); setRan(false); setErr(''); setProgress(null); };

  const vals = form.getFieldsValue() as SearchVals;
  const previewUrl = `${buildQueryUrl(vals)}${buildQueryUrl(vals).includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}`;

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb — back to Procurement (Purchasing) only */}
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Space>
            <Link to="/home"><HomeOutlined /> Home</Link>
            <Text type="secondary">/</Text>
            <Link to="/procurement">Fusion Supply Chain</Link>
            <Text type="secondary">/</Text>
            <Text>Manage Receipt Cost</Text>
          </Space>
        </div>

        <div style={{ padding: 20 }}>
          {/* Page header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.teal} 0%, ${REDWOOD.tealDark} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 14px ${REDWOOD.teal}40`,
            }}>
              <ReconciliationOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Manage Receipt Cost</Title>
              <Text type="secondary">Receipt costs from Oracle Fusion (receiptCosts)</Text>
            </div>
          </div>

          {/* Shared search form — drives both tabs */}
          <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }} styles={{ body: { padding: '14px 16px 2px' } }}>
            <Form form={form} layout="vertical" onFinish={search} initialValues={{ costDateOp: '=' }}>
              <Row gutter={12}>
                <Col xs={24} sm={12} md={7}>
                  <Form.Item name="inventoryOrg" label="Inventory Organization" style={{ marginBottom: 12 }}>
                    <Select allowClear showSearch placeholder="Select inventory organization"
                      optionFilterProp="label"
                      options={orgs.map(o => ({ label: `${o.name} (${o.code})`, value: o.name }))}
                      notFoundContent={orgs.length === 0 ? 'Loading…' : 'No match'} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={4}>
                  <Form.Item name="reference" label="Reference # (PO)" style={{ marginBottom: 12 }}>
                    <Input allowClear placeholder="e.g. 2026020095" onPressEnter={search} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={4}>
                  <Form.Item name="item" label="Item" style={{ marginBottom: 12 }}>
                    <Input allowClear placeholder="e.g. TECNO-AE10-BU" onPressEnter={search} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item label="Cost Date" style={{ marginBottom: 12 }}>
                    <Space.Compact block>
                      <Form.Item name="costDateOp" noStyle>
                        <Select style={{ width: 76 }}
                          options={(['=', '>', '>=', '<', '<='] as DateOp[]).map(o => ({ label: o, value: o }))} />
                      </Form.Item>
                      <Form.Item name="costDate" noStyle>
                        <DatePicker allowClear format="YYYY-MM-DD" style={{ width: '100%' }} placeholder="Select date" />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={3}>
                  <Form.Item label=" " style={{ marginBottom: 12 }}>
                    <Space size={4}>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                        style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                        Search
                      </Button>
                      <Button icon={<ClearOutlined />} onClick={reset} />
                      <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>GET {previewUrl}</span>} placement="bottomRight">
                        <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 16 }} />
                      </Tooltip>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* Live paging progress — parallel small pages fetched via totalResults */}
          {loading && progress && (
            <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }} styles={{ body: { padding: '10px 16px' } }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Progress
                  style={{ flex: 1, marginBottom: 0 }}
                  percent={progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0}
                  status="active"
                  strokeColor={REDWOOD.teal}
                  size="small"
                />
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {progress.total > 0
                    ? `Loaded ${numFmt(progress.loaded)} of ${numFmt(progress.total)} receipt cost records…`
                    : 'Counting records…'}
                </Text>
              </div>
            </Card>
          )}

          <Card styles={{ body: { padding: 0 } }}
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <Tabs
              size="small"
              style={{ paddingLeft: 16, paddingRight: 16 }}
              tabBarStyle={{ marginBottom: 0, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
              items={[{
                key: 'search',
                label: <Space size={4}><SearchOutlined />Search</Space>,
                children: <SearchTable rows={rows} loading={loading} err={err} ran={ran} url={previewUrl} onRefresh={search} />,
              }, {
                key: 'analytics',
                label: <Space size={4}><DashboardOutlined />Analytics</Space>,
                children: <AnalyticsTab rows={rows} loading={loading} err={err} ran={ran} onRefresh={search} />,
              }]}
            />
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default ManageReceiptCost;
