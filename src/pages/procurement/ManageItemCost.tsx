import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Typography, Card, Table, Button, Form, Input, Space, Tabs,
  Tooltip, Row, Col, Tag, Select, Segmented, Empty, Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, DollarOutlined, SearchOutlined, ReloadOutlined,
  FilterOutlined, ApiOutlined, ClearOutlined, BarChartOutlined,
  DashboardOutlined, AppstoreOutlined, ApartmentOutlined, TagsOutlined,
  DatabaseOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, LabelList, PieChart, Pie, Legend,
} from 'recharts';
import { Link } from 'react-router-dom';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

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
const LATEST_URL = `${FUSION_POD_HOST}/fscmRestApi/resources/latest`;
const AUTH_HEADER = FUSION_POD_AUTH;
const HEADERS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const PAGE_LIMIT = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────
const numFmt = (v: any) =>
  v == null || v === '' || isNaN(Number(v)) ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(v));

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
// Hyphens escaped as "\-" (inside the lot) are NOT split points.
const parseValuationUnit = (vu?: string) => {
  if (!vu) return { costOrg: '', invOrg: '', subinv: '', lot: '' };
  const parts = String(vu).split(/(?<!\\)-/);   // split on unescaped hyphens
  return {
    costOrg: parts[0] || '',
    invOrg:  parts[1] || '',
    subinv:  parts[2] || '',
    lot:     parts.slice(3).join('-').replace(/\\-/g, '-'),
  };
};

// The four columns a ValuationUnit is broken into (like the on-hand cost tabs).
const vuCols: ColumnsType<any> = [
  { title: 'Cost Org',      key: '_vu_costOrg', width: 150, ellipsis: true, render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return <Text strong style={{ fontSize: 12 }}>{p.costOrg || '—'}</Text>; } },
  { title: 'Inventory Org', key: '_vu_invOrg',  width: 150, ellipsis: true, render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return <Text style={{ fontSize: 12 }}>{p.invOrg || '—'}</Text>; } },
  { title: 'Subinventory',  key: '_vu_subinv',  width: 130,                 render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return p.subinv ? <Tag color="cyan">{p.subinv}</Tag> : '—'; } },
  { title: 'Lot',           key: '_vu_lot',     width: 180, ellipsis: true, render: (_: any, r: any) => { const p = parseValuationUnit(r.ValuationUnit); return p.lot ? <Tag color="geekblue">{p.lot}</Tag> : '—'; } },
];

// Build clean columns: drop links, object-valued and all-null columns, hide *Id.
// A ValuationUnit column is broken into Cost Org / Inventory Org / Subinventory / Lot.
const buildCols = (rows: any[]): ColumnsType<any> => {
  const keys: string[] = [];
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (k === 'links') return;
    if (/id$/i.test(k)) return;                 // hide all *Id columns
    if (keys.includes(k)) return;
    const hasValue = rows.some(row => {
      const v = row[k];
      return v != null && v !== '' && !(typeof v === 'object');
    });
    if (hasValue) keys.push(k);
  }));
  const cols: ColumnsType<any> = [];
  keys.forEach(k => {
    if (/^valuationunit$/i.test(k)) { cols.push(...vuCols); return; }   // break it out
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

interface SearchVals {
  itemNumber?: string;
  organizationCode?: string;
  valuationUnit?: string;
}

// ── Search Tab ────────────────────────────────────────────────────────────────
const SearchTab: React.FC = () => {
  const [form] = Form.useForm();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [filter, setFilter]   = useState('');
  const [ran, setRan]         = useState(false);

  const buildUrl = (vals: SearchVals) => {
    const clauses: string[] = [];
    if (vals.itemNumber)       clauses.push(`ItemNumber like "${vals.itemNumber}*"`);
    if (vals.organizationCode) clauses.push(`OrganizationCode like "${vals.organizationCode}*"`);
    if (vals.valuationUnit)    clauses.push(`ValuationUnit like "${vals.valuationUnit}*"`);
    const qs = clauses.length ? `?q=${encodeURIComponent(clauses.join(';'))}&limit=${PAGE_LIMIT}` : `?limit=${PAGE_LIMIT}`;
    return `${LATEST_URL}/itemCosts${qs}`;
  };

  const currentUrl = buildUrl(form.getFieldsValue());

  const search = useCallback(() => {
    const vals = form.getFieldsValue() as SearchVals;
    const url = buildUrl(vals);
    setLoading(true); setErr(''); setRan(true);
    fetch(url, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}: ${r.statusText}`)))
      .then(d => setRows(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(e => { setErr(e.message); setRows([]); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const reset = () => { form.resetFields(); setRows([]); setRan(false); setErr(''); setFilter(''); };

  const columns = React.useMemo(() => buildCols(rows), [rows]);
  const filtered = filter ? rows.filter(r => matchesFilter(r, filter)) : rows;

  return (
    <div style={{ padding: 16 }}>
      <Form form={form} layout="vertical" onFinish={search}>
        <Row gutter={12}>
          <Col xs={24} sm={8} md={6}>
            <Form.Item name="itemNumber" label="Item Number" style={{ marginBottom: 12 }}>
              <Input allowClear placeholder="e.g. SM-A055FLGDAFB" onPressEnter={search} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Form.Item name="organizationCode" label="Organization Code" style={{ marginBottom: 12 }}>
              <Input allowClear placeholder="e.g. AMS_B2B_GHANA" onPressEnter={search} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Form.Item name="valuationUnit" label="Valuation Unit" style={{ marginBottom: 12 }}>
              <Input allowClear placeholder="Valuation unit" onPressEnter={search} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={24} md={6}>
            <Form.Item label=" " style={{ marginBottom: 12 }}>
              <Space>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                  Search
                </Button>
                <Button icon={<ClearOutlined />} onClick={reset}>Reset</Button>
              </Space>
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 10px', gap: 8, flexWrap: 'wrap' }}>
        <Space>
          <Input size="small" allowClear prefix={<FilterOutlined />} placeholder="Filter results…"
            value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 240 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} row(s)</Text>
        </Space>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={search} loading={loading} disabled={!ran}>Refresh</Button>
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>GET {currentUrl}</span>} placement="bottomRight">
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
        locale={{ emptyText: loading ? 'Loading…' : (ran ? (err ? 'Error' : 'No item costs found') : 'Enter criteria (or leave blank) and click Search') }}
      />
    </div>
  );
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
// Validated categorical palette (dataviz skill) + single-hue blue for the main
// bar. Contrast WARN on the light surface → we ship direct labels + legend as
// the required relief, so identity is never colour-alone.
const VIZ = {
  blue: '#2a78d6',
  cat: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  other: '#898781',
  grid: '#e1e0d9', axis: '#898781', ink: REDWOOD.neutral900, sub: '#52514e',
};

// Pull all itemCosts (paged) — capped so a bad filter can't run away.
const fetchAllItemCosts = async (baseUrl: string, cap = 5000): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  const step = 500;
  while (all.length < cap) {
    const sep = stripped.includes('?') ? '&' : '?';
    const r = await fetch(`${stripped}${sep}limit=${step}&offset=${offset}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < step) break;
    offset += step;
  }
  return all;
};

// Pick the first present value across a list of candidate field names.
const pick = (row: any, names: string[]) => {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
  return undefined;
};
const COST_FIELDS = ['TotalUnitCost', 'UnitCost', 'ItemCost', 'UnitAverageCost', 'AverageUnitCost'];
const CAT_FIELDS  = ['ItemCategory', 'CategoryName', 'Category', 'ItemCategoryCode', 'CategoryCode'];

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

type DimKey = 'invOrg' | 'subinv' | 'item' | 'category';
type MeasureKey = 'avg' | 'total' | 'max' | 'count';

const DIMS: { key: DimKey; label: string; icon: React.ReactNode }[] = [
  { key: 'invOrg',   label: 'Inventory Org', icon: <ApartmentOutlined /> },
  { key: 'subinv',   label: 'Subinventory',  icon: <DatabaseOutlined /> },
  { key: 'item',     label: 'Item',          icon: <AppstoreOutlined /> },
  { key: 'category', label: 'Item Category', icon: <TagsOutlined /> },
];
const MEASURES: { key: MeasureKey; label: string; money: boolean }[] = [
  { key: 'avg',   label: 'Avg Unit Cost',   money: true },
  { key: 'total', label: 'Total Unit Cost', money: true },
  { key: 'max',   label: 'Max Unit Cost',   money: true },
  { key: 'count', label: 'Record Count',    money: false },
];

// StatTile — a hero number, no chart (dataviz: not everything is a chart).
const StatTile: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({ label, value, accent }) => (
  <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, borderLeft: `3px solid ${accent ?? REDWOOD.teal}` }} styles={{ body: { padding: '10px 14px' } }}>
    <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>{label}</Text>
    <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.neutral900, lineHeight: 1.25, marginTop: 2 }}>{value}</div>
  </Card>
);

const DashboardTab: React.FC = () => {
  const [raw, setRaw]         = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [dim, setDim]         = useState<DimKey>('invOrg');
  const [measure, setMeasure] = useState<MeasureKey>('avg');
  const [topN, setTopN]       = useState(12);
  const [drill, setDrill]     = useState<{ dim: DimKey; value: string } | null>(null);

  const url = `${LATEST_URL}/itemCosts`;

  const load = useCallback(() => {
    setLoading(true); setErr(''); setDrill(null);
    fetchAllItemCosts(url)
      .then(d => setRaw(d))
      .catch(e => { setErr(e.message); setRaw([]); })
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => { load(); }, [load]);

  // Normalise every row into the dimensions + cost we care about.
  const recs = useMemo(() => raw.map(r => {
    const p = parseValuationUnit(r.ValuationUnit);
    const cost = Number(pick(r, COST_FIELDS));
    return {
      item:     r.ItemNumber ?? r.Item ?? '—',
      invOrg:   p.invOrg || r.OrganizationCode || r.OrganizationName || '—',
      subinv:   p.subinv || r.Subinventory || '—',
      category: String(pick(r, CAT_FIELDS) ?? 'Uncategorized'),
      cost:     isNaN(cost) ? null : cost,
      ccy:      r.CurrencyCode ?? r.Currency ?? '',
    };
  }), [raw]);

  const ccy = useMemo(() => {
    const set = new Set(recs.map(r => r.ccy).filter(Boolean));
    return set.size === 1 ? Array.from(set)[0] as string : '';
  }, [recs]);

  // Apply drill (click-to-filter) for the KPIs, donut and detail table.
  const scoped = useMemo(() => drill ? recs.filter(r => (r as any)[drill.dim] === drill.value) : recs, [recs, drill]);

  // Aggregate helper.
  const aggregate = (rows: typeof recs, key: DimKey) => {
    const m = new Map<string, { key: string; count: number; sum: number; max: number; n: number }>();
    rows.forEach(r => {
      const k = String((r as any)[key] ?? '—');
      let g = m.get(k);
      if (!g) { g = { key: k, count: 0, sum: 0, max: 0, n: 0 }; m.set(k, g); }
      g.count += 1;
      if (r.cost != null) { g.sum += r.cost; g.max = Math.max(g.max, r.cost); g.n += 1; }
    });
    return Array.from(m.values()).map(g => ({
      key: g.key, count: g.count, total: g.sum, max: g.max,
      avg: g.n ? g.sum / g.n : 0,
    }));
  };

  const measureVal = (row: any) => row[measure] as number;
  const activeMeasure = MEASURES.find(x => x.key === measure)!;

  // Main bar data — group by dim, sort by measure desc, take top N.
  const barData = useMemo(() => {
    const agg = aggregate(recs, dim).sort((a, b) => measureVal(b) - measureVal(a));
    return agg.slice(0, topN);
  }, [recs, dim, measure, topN]);

  // Donut — cost share by Inventory Org (scoped), top 5 + Other.
  const donutData = useMemo(() => {
    const agg = aggregate(scoped, 'invOrg').sort((a, b) => b.total - a.total);
    const top = agg.slice(0, 5);
    const rest = agg.slice(5).reduce((s, g) => s + g.total, 0);
    const out = top.map(g => ({ name: g.key, value: g.total }));
    if (rest > 0) out.push({ name: 'Other', value: rest });
    return out;
  }, [scoped]);

  // KPIs (scoped).
  const kpi = useMemo(() => {
    const costs = scoped.map(r => r.cost).filter((v): v is number => v != null);
    const avg = costs.length ? costs.reduce((s, v) => s + v, 0) / costs.length : 0;
    return {
      records: scoped.length,
      items:   new Set(scoped.map(r => r.item)).size,
      orgs:    new Set(scoped.map(r => r.invOrg)).size,
      subs:    new Set(scoped.map(r => r.subinv)).size,
      cats:    new Set(scoped.map(r => r.category)).size,
      avg, max: costs.length ? Math.max(...costs) : 0,
      total: costs.reduce((s, v) => s + v, 0),
    };
  }, [scoped]);

  const dimLabel = DIMS.find(d => d.key === dim)!.label;
  const fmtMeasure = (v: number) => activeMeasure.money ? money(v, ccy) : new Intl.NumberFormat('en-US').format(v);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin tip="Loading item costs…" size="large"><div style={{ height: 40 }} /></Spin></div>;
  if (err)     return <div style={{ padding: 24 }}><Empty description={`Failed to load: ${err}`} /><div style={{ textAlign: 'center', marginTop: 12 }}><Button icon={<ReloadOutlined />} onClick={load}>Retry</Button></div></div>;

  return (
    <div style={{ padding: 16 }}>
      {/* KPI row */}
      <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Cost Records" value={kpi.records} accent={REDWOOD.teal} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Items" value={kpi.items} accent={REDWOOD.info} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Inventory Orgs" value={kpi.orgs} accent={VIZ.cat[2]} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Subinventories" value={kpi.subs} accent={VIZ.cat[3]} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Avg Unit Cost" value={money(kpi.avg, ccy)} accent={REDWOOD.primary} /></Col>
        <Col xs={12} sm={8} md={6} lg={4}><StatTile label="Max Unit Cost" value={money(kpi.max, ccy)} accent={VIZ.cat[1]} /></Col>
      </Row>

      {/* Prompts / controls */}
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
          <Button size="small" icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        </div>
      </div>

      <Row gutter={[14, 14]}>
        {/* Main bar chart */}
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
            <Text type="secondary" style={{ fontSize: 11, paddingLeft: 8 }}>Tip: click a bar to filter the whole dashboard by that {dimLabel.toLowerCase()}.</Text>
          </Card>
        </Col>

        {/* Donut: cost share by inventory org */}
        <Col xs={24} lg={9}>
          <Card size="small" title={<Space><DashboardOutlined style={{ color: VIZ.cat[2] }} /><span style={{ fontSize: 13 }}>Total Cost Share by Inventory Org</span></Space>}
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: 8 } }}>
            {donutData.length === 0 ? <Empty description="No data" style={{ padding: 24 }} /> : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={90}
                    paddingAngle={2} stroke="#fff" strokeWidth={2}
                    label={(e: any) => `${(e.percent * 100).toFixed(0)}%`} labelLine={false}
                    style={{ fontSize: 11 }}>
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

      {/* Ranked detail table (also the accessible table view of the bar chart) */}
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
            { title: 'Records', dataIndex: 'count', width: 100, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text> },
            { title: 'Avg Unit Cost', dataIndex: 'avg', width: 140, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v, ccy)}</Text> },
            { title: 'Max Unit Cost', dataIndex: 'max', width: 140, align: 'right', render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v, ccy)}</Text> },
            { title: 'Total Unit Cost', dataIndex: 'total', width: 150, align: 'right', render: (v: number) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{money(v, ccy)}</Text> },
          ]}
        />
      </Card>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────
const ManageItemCost: React.FC = () => {
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb — back to Procurement (Purchasing) only */}
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Space>
            <Link to="/home"><HomeOutlined /> Home</Link>
            <Text type="secondary">/</Text>
            <Link to="/procurement">Procurement</Link>
            <Text type="secondary">/</Text>
            <Text>Manage Item Cost</Text>
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
              <DollarOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Manage Item Cost</Title>
              <Text type="secondary">Search item costs from Oracle Fusion (itemCosts)</Text>
            </div>
          </div>

          <Card styles={{ body: { padding: 0 } }}
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <Tabs
              size="small"
              style={{ paddingLeft: 16, paddingRight: 16 }}
              tabBarStyle={{ marginBottom: 0, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
              items={[{
                key: 'search',
                label: <Space size={4}><SearchOutlined />Search</Space>,
                children: <SearchTab />,
              }, {
                key: 'dashboard',
                label: <Space size={4}><DashboardOutlined />Dashboard</Space>,
                children: <DashboardTab />,
              }]}
            />
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default ManageItemCost;
