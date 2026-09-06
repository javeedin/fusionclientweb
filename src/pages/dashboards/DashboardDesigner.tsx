// ── Dashboard Designer ──────────────────────────────────────────────────────
// Company-shared dashboards, stored in RR_DASHBOARDS via ORDS (patch 130).
// Widgets read live data from any of the app's REST endpoints; layout is a
// drag/resize grid (react-grid-layout). Widget visuals reuse the validated
// data-viz palette (KPI tile, bar, line, table).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AutoComplete, Button, Card, Drawer, Input, InputNumber, Modal, Popconfirm, Segmented, Select,
  Space, Table, Tag, Tooltip, Typography, message as antMessage,
} from 'antd';
import {
  AppstoreAddOutlined, BarChartOutlined, DashboardOutlined, DeleteOutlined, EditOutlined,
  LineChartOutlined, NumberOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, TableOutlined,
} from '@ant-design/icons';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { getCurrentCompany } from '../../config/company.config';
import { useAuth } from '../../context/AuthContext';

const { Text } = Typography;
const Grid = WidthProvider(GridLayout);

// categorical slots 1-3 of the validated reference palette (fixed order)
const VIZ_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];

// ── model ───────────────────────────────────────────────────────────────────
interface Widget {
  id: string;
  title: string;
  viz: 'kpi' | 'bar' | 'line' | 'table';
  path: string;             // REST path relative to the APEX base, e.g. /ap/invoices/stats
  query?: string;           // extra query string, e.g. period=Jun-26&limit=50
  labelField?: string;      // x axis / category column
  valueFields?: string[];   // numeric measure columns (max 3)
  agg?: 'sum' | 'count' | 'avg' | 'last'; // KPI aggregation over valueFields[0]
  refreshSec?: number;      // 0/undefined = manual refresh only
}
interface DashDef { widgets: Widget[]; layout: Layout[] }
interface DashListItem { dashboardId: number; name: string; description?: string; createdBy?: string; updatedAt?: string }

const EMPTY_DEF: DashDef = { widgets: [], layout: [] };

// ── API (same renderer-fetch pattern as the rest of the app) ────────────────
const apex = () => getCurrentCompany().apexBaseUrl;

const tryJson = (s: string): unknown => {
  try { return JSON.parse(s); } catch { /* Oracle trailing-dot numbers */ }
  try { return JSON.parse(s.replace(/:(\s*-?\d+)\.(?=\s*[,}\]])/g, ':$1')); } catch { return undefined; }
};

async function fetchWidgetRows(path: string, query?: string): Promise<Record<string, unknown>[]> {
  let p = path.startsWith('/') ? path : `/${path}`;
  const q = (query || '').trim().replace(/^[?&]/, '');
  if (q) p += (p.includes('?') ? '&' : '?') + q;
  // main-process fetch (ORDS token) when available, renderer fetch otherwise
  const eAPI = (window as unknown as {
    electronAPI?: { claudeChatApiGet?: (o: { apexBaseUrl: string; path: string }) => Promise<{ success: boolean; text?: string; error?: string }> };
  }).electronAPI;
  let text: string;
  if (eAPI?.claudeChatApiGet) {
    const r = await eAPI.claudeChatApiGet({ apexBaseUrl: apex(), path: p });
    if (!r.success || !r.text) throw new Error(r.error || 'Request failed');
    text = r.text;
  } else {
    const res = await fetch(`${apex()}${p}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  }
  const j = tryJson(text) as { items?: unknown; rows?: unknown } | unknown[] | undefined;
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  if (j && Array.isArray((j as { items?: unknown }).items)) return (j as { items: Record<string, unknown>[] }).items;
  if (j && Array.isArray((j as { rows?: unknown }).rows)) return (j as { rows: Record<string, unknown>[] }).rows;
  if (j && typeof j === 'object') return [j as Record<string, unknown>]; // single-object stats endpoints
  throw new Error('Response was not tabular JSON');
}

async function apiList(): Promise<DashListItem[]> {
  const res = await fetch(`${apex()}/dashboards`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — run database/dashboards/130_dashboard_designer.sql?`);
  const data = await res.json();
  return (data.items || []) as DashListItem[];
}

async function apiGet(id: number): Promise<{ name: string; description?: string; def: DashDef }> {
  const res = await fetch(`${apex()}/dashboards/${id}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const row = (data.items || [])[0] || {};
  let def: DashDef = EMPTY_DEF;
  const parsed = typeof row.definition === 'string' ? tryJson(row.definition) : row.definition;
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Partial<DashDef>;
    def = { widgets: Array.isArray(p.widgets) ? p.widgets : [], layout: Array.isArray(p.layout) ? p.layout : [] };
  }
  return { name: String(row.name || ''), description: row.description as string | undefined, def };
}

async function apiCreate(name: string, description: string, def: DashDef, user: string): Promise<number> {
  const res = await fetch(`${apex()}/dashboards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name, description, definition: JSON.stringify(def), user }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
  return Number(data.dashboardId);
}

async function apiUpdate(id: number, fields: { name?: string; description?: string; def?: DashDef }, user: string): Promise<void> {
  const body: Record<string, unknown> = { user };
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.def !== undefined) body.definition = JSON.stringify(fields.def);
  const res = await fetch(`${apex()}/dashboards/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
}

async function apiDelete(id: number): Promise<void> {
  const res = await fetch(`${apex()}/dashboards/${id}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
}

// endpoint catalog for the source picker (Electron only; typing works anywhere)
async function loadCatalogPaths(): Promise<string[]> {
  try {
    const eAPI = (window as unknown as {
      electronAPI?: { claudeChatCatalog?: () => Promise<{ success: boolean; markdown: string }> };
    }).electronAPI;
    const r = await eAPI?.claudeChatCatalog?.();
    if (!r?.success) return [];
    return r.markdown.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(p => !p.includes('{'));
  } catch { return []; }
}

// ── widget rendering ────────────────────────────────────────────────────────
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmtNum = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const compact = (v: number) => Intl.NumberFormat('en', { notation: 'compact' }).format(v);

function KpiBody({ w, rows }: { w: Widget; rows: Record<string, unknown>[] }) {
  const field = w.valueFields?.[0];
  const vals = field ? rows.map(r => num(r[field])).filter((v): v is number => v !== null) : [];
  let value: number | null = null;
  const agg = w.agg || 'sum';
  if (agg === 'count') value = rows.length;
  else if (vals.length) {
    value = agg === 'sum' ? vals.reduce((s, v) => s + v, 0)
      : agg === 'avg' ? vals.reduce((s, v) => s + v, 0) / vals.length
        : vals[vals.length - 1];
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <div style={{ fontSize: 34, fontWeight: 700, color: '#0b0b0b', lineHeight: 1.1 }}>
        {value === null ? '—' : fmtNum(value)}
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {agg === 'count' ? `${rows.length} rows` : `${agg} of ${field || '?'} · ${rows.length} rows`}
      </Text>
    </div>
  );
}

function ChartBody({ w, rows }: { w: Widget; rows: Record<string, unknown>[] }) {
  const label = w.labelField || Object.keys(rows[0] || {})[0];
  const series = (w.valueFields || []).slice(0, 3);
  const data = rows.slice(0, w.viz === 'line' ? 400 : 40);
  const axisTick = { fontSize: 10, fill: '#52514e' };
  const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #EDE8E6' };
  if (!series.length) return <Text type="secondary" style={{ fontSize: 12 }}>Pick value fields in the widget editor.</Text>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      {w.viz === 'line' ? (
        <LineChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#EFEAE8" vertical={false} />
          <XAxis dataKey={label} tick={axisTick} tickLine={false} axisLine={{ stroke: '#E0D5D2' }} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
          <ChartTooltip formatter={(v: unknown) => (typeof v === 'number' ? fmtNum(v) : String(v))} contentStyle={tooltipStyle} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {series.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={VIZ_COLORS[i]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />)}
        </LineChart>
      ) : (
        <BarChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#EFEAE8" vertical={false} />
          <XAxis dataKey={label} tick={axisTick} tickLine={false} axisLine={{ stroke: '#E0D5D2' }} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
          <ChartTooltip formatter={(v: unknown) => (typeof v === 'number' ? fmtNum(v) : String(v))} contentStyle={tooltipStyle} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {series.map((s, i) => <Bar key={s} dataKey={s} fill={VIZ_COLORS[i]} maxBarSize={22} radius={[4, 4, 0, 0]} />)}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

function TableBody({ w, rows }: { w: Widget; rows: Record<string, unknown>[] }) {
  const keys = Object.keys(rows[0] || {});
  const cols = (w.valueFields?.length || w.labelField
    ? [w.labelField, ...(w.valueFields || [])].filter((k): k is string => !!k)
    : keys.slice(0, 6));
  return (
    <Table
      size="small"
      dataSource={rows.slice(0, 100).map((r, i) => ({ ...r, __k: i }))}
      rowKey="__k"
      pagination={{ pageSize: 5, size: 'small', showSizeChanger: false }}
      columns={cols.map(k => ({
        title: k, dataIndex: k, key: k, ellipsis: true,
        render: (v: unknown) => (typeof v === 'number' ? <span style={{ display: 'block', textAlign: 'right' }}>{fmtNum(v)}</span> : String(v ?? '')),
      }))}
      scroll={{ x: 'max-content' }}
    />
  );
}

// ── page ────────────────────────────────────────────────────────────────────
const DashboardDesigner: React.FC = () => {
  const { user } = useAuth();
  const currentUser = (user as { username?: string; name?: string } | null)?.username
    ?? (user as { name?: string } | null)?.name ?? 'REERP';

  const [dashList, setDashList] = useState<DashListItem[]>([]);
  const [curId, setCurId] = useState<number | null>(null);
  const [dashName, setDashName] = useState('');
  const [def, setDef] = useState<DashDef>(EMPTY_DEF);
  const [dirty, setDirty] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [listErr, setListErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Record<string, { rows: Record<string, unknown>[]; error?: string; loading?: boolean; at?: number }>>({});
  const [catalog, setCatalog] = useState<string[]>([]);

  // new-dashboard dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // widget editor
  const [edOpen, setEdOpen] = useState(false);
  const [ed, setEd] = useState<Widget | null>(null);
  const [edSample, setEdSample] = useState<Record<string, unknown>[]>([]);
  const [edSampleErr, setEdSampleErr] = useState('');
  const [edLoading, setEdLoading] = useState(false);

  const defRef = useRef(def);
  useEffect(() => { defRef.current = def; }, [def]);

  const refreshList = useCallback(async () => {
    try { setDashList(await apiList()); setListErr(''); }
    catch (e) { setListErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { refreshList(); loadCatalogPaths().then(setCatalog); }, [refreshList]);

  const refreshWidget = useCallback(async (w: Widget) => {
    setData(prev => ({ ...prev, [w.id]: { rows: prev[w.id]?.rows || [], loading: true } }));
    try {
      const rows = await fetchWidgetRows(w.path, w.query);
      setData(prev => ({ ...prev, [w.id]: { rows, at: Date.now() } }));
    } catch (e) {
      setData(prev => ({ ...prev, [w.id]: { rows: [], error: e instanceof Error ? e.message : String(e), at: Date.now() } }));
    }
  }, []);

  const refreshAll = useCallback((d?: DashDef) => {
    for (const w of (d || defRef.current).widgets) refreshWidget(w);
  }, [refreshWidget]);

  // per-widget auto refresh (15s ticker checks what is due)
  useEffect(() => {
    const t = setInterval(() => {
      for (const w of defRef.current.widgets) {
        if (!w.refreshSec) continue;
        const at = data[w.id]?.at || 0;
        if (Date.now() - at >= w.refreshSec * 1000) refreshWidget(w);
      }
    }, 15000);
    return () => clearInterval(t);
  }, [data, refreshWidget]);

  const openDashboard = async (id: number) => {
    try {
      const d = await apiGet(id);
      setCurId(id);
      setDashName(d.name);
      setDef(d.def);
      setDirty(false);
      setData({});
      refreshAll(d.def);
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const id = await apiCreate(name, newDesc.trim(), EMPTY_DEF, currentUser);
      setNewOpen(false);
      setNewName('');
      setNewDesc('');
      await refreshList();
      setCurId(id);
      setDashName(name);
      setDef(EMPTY_DEF);
      setDirty(false);
      setEditMode(true);
      antMessage.success(`Dashboard "${name}" created — add widgets and Save`);
    } catch (e) { antMessage.error(e instanceof Error ? e.message : String(e)); }
  };

  const doSave = async () => {
    if (curId === null) return;
    setSaving(true);
    try {
      await apiUpdate(curId, { def }, currentUser);
      setDirty(false);
      antMessage.success('Dashboard saved — visible to everyone in the company');
    } catch (e) { antMessage.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (curId === null) return;
    try {
      await apiDelete(curId);
      setCurId(null);
      setDef(EMPTY_DEF);
      setDashName('');
      refreshList();
      antMessage.success('Dashboard deleted');
    } catch (e) { antMessage.error(e instanceof Error ? e.message : String(e)); }
  };

  // ── widget editor ─────────────────────────────────────────────────────────
  const newWidget = () => {
    setEd({ id: `w${Date.now()}`, title: 'New widget', viz: 'kpi', path: '', agg: 'sum' });
    setEdSample([]);
    setEdSampleErr('');
    setEdOpen(true);
  };
  const editWidget = (w: Widget) => {
    setEd({ ...w });
    setEdSample(data[w.id]?.rows || []);
    setEdSampleErr('');
    setEdOpen(true);
  };
  const loadSample = async () => {
    if (!ed?.path) return;
    setEdLoading(true);
    setEdSampleErr('');
    try { setEdSample(await fetchWidgetRows(ed.path, ed.query)); }
    catch (e) { setEdSample([]); setEdSampleErr(e instanceof Error ? e.message : String(e)); }
    finally { setEdLoading(false); }
  };
  const sampleKeys = Object.keys(edSample[0] || {});
  const sampleNumeric = sampleKeys.filter(k => edSample.some(r => typeof r[k] === 'number'));
  const sampleText = sampleKeys.filter(k => !sampleNumeric.includes(k));

  const saveWidget = () => {
    if (!ed || !ed.path.trim() || !ed.title.trim()) { antMessage.warning('Widget needs a title and an endpoint'); return; }
    setDef(prev => {
      const exists = prev.widgets.some(w => w.id === ed.id);
      const widgets = exists ? prev.widgets.map(w => (w.id === ed.id ? ed : w)) : [...prev.widgets, ed];
      const layout = prev.layout.some(l => l.i === ed.id)
        ? prev.layout
        : [...prev.layout, { i: ed.id, x: (prev.widgets.length * 4) % 12, y: Infinity as unknown as number, w: 4, h: ed.viz === 'kpi' ? 2 : 4 }];
      return { widgets, layout };
    });
    setDirty(true);
    setEdOpen(false);
    refreshWidget(ed);
  };

  const removeWidget = (id: string) => {
    setDef(prev => ({ widgets: prev.widgets.filter(w => w.id !== id), layout: prev.layout.filter(l => l.i !== id) }));
    setDirty(true);
  };

  const onLayoutChange = (layout: Layout[]) => {
    if (!editMode) return;
    setDef(prev => ({ ...prev, layout }));
    setDirty(true);
  };

  const vizIcon = (v: Widget['viz']) =>
    v === 'kpi' ? <NumberOutlined /> : v === 'bar' ? <BarChartOutlined /> : v === 'line' ? <LineChartOutlined /> : <TableOutlined />;

  const dashOptions = useMemo(() => dashList.map(d => ({
    value: d.dashboardId,
    label: `${d.name}${d.createdBy ? ` · ${d.createdBy}` : ''}`,
  })), [dashList]);

  return (
    <div style={{ padding: 16, minHeight: 'calc(100vh - 92px)', background: '#FAF9F8' }}>
      <Card size="small" styles={{ body: { padding: '10px 14px' } }} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <DashboardOutlined style={{ fontSize: 20, color: '#C74634' }} />
          <Text strong style={{ fontSize: 16 }}>Dashboard Designer</Text>
          <Tag color="green">Company-shared</Tag>
          <Select
            style={{ minWidth: 260 }}
            placeholder="Open a dashboard…"
            options={dashOptions}
            value={curId ?? undefined}
            onChange={openDashboard}
            showSearch
            optionFilterProp="label"
          />
          <Button icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>New</Button>
          <div style={{ flex: 1 }} />
          {curId !== null && (
            <>
              <Segmented
                value={editMode ? 'edit' : 'view'}
                onChange={v => setEditMode(v === 'edit')}
                options={[{ label: 'View', value: 'view' }, { label: 'Design', value: 'edit', icon: <EditOutlined /> }]}
              />
              {editMode && <Button icon={<AppstoreAddOutlined />} onClick={newWidget}>Add widget</Button>}
              <Tooltip title="Refresh all widgets">
                <Button icon={<ReloadOutlined />} onClick={() => refreshAll()} />
              </Tooltip>
              <Button type="primary" icon={<SaveOutlined />} onClick={doSave} loading={saving} disabled={!dirty}
                style={{ background: '#C74634', borderColor: '#C74634' }}>
                Save{dirty ? ' *' : ''}
              </Button>
              {editMode && (
                <Popconfirm title={`Delete dashboard "${dashName}" for everyone?`} onConfirm={doDelete} okText="Delete" okButtonProps={{ danger: true }}>
                  <Button danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </>
          )}
        </div>
      </Card>

      {listErr && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Could not load dashboards" description={listErr} />}

      {curId === null && !listErr && (
        <div style={{ textAlign: 'center', paddingTop: 80, color: '#8B8580' }}>
          <DashboardOutlined style={{ fontSize: 48, color: '#D9CDC9' }} />
          <div style={{ fontSize: 15, marginTop: 10 }}>Open a dashboard above, or create a new one.</div>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Dashboards are saved in the company database — everyone sees the same list.
          </Text>
        </div>
      )}

      {curId !== null && (
        <Grid
          className="layout"
          layout={def.layout}
          cols={12}
          rowHeight={78}
          margin={[12, 12]}
          isDraggable={editMode}
          isResizable={editMode}
          draggableHandle=".dw-head"
          onLayoutChange={onLayoutChange}
        >
          {def.widgets.map(w => {
            const d = data[w.id];
            return (
              <div key={w.id} style={{ background: '#fff', border: '1px solid #EFEAE8', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="dw-head" style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  borderBottom: '1px solid #F3EFED', cursor: editMode ? 'move' : 'default', flexShrink: 0,
                }}>
                  <span style={{ color: '#C74634' }}>{vizIcon(w.viz)}</span>
                  <Text strong style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</Text>
                  {d?.at && !d.loading && (
                    <Text type="secondary" style={{ fontSize: 10 }}>{new Date(d.at).toLocaleTimeString()}</Text>
                  )}
                  <Tooltip title="Refresh">
                    <ReloadOutlined spin={d?.loading} style={{ fontSize: 11, color: '#b9aca7', cursor: 'pointer' }}
                      onClick={() => refreshWidget(w)} />
                  </Tooltip>
                  {editMode && (
                    <>
                      <EditOutlined style={{ fontSize: 11, color: '#b9aca7', cursor: 'pointer' }} onClick={() => editWidget(w)} />
                      <DeleteOutlined style={{ fontSize: 11, color: '#b9aca7', cursor: 'pointer' }} onClick={() => removeWidget(w.id)} />
                    </>
                  )}
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: w.viz === 'table' ? 4 : 8 }}>
                  {d?.error
                    ? <Text type="danger" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>⚠ {d.error}</Text>
                    : !d || !d.rows.length
                      ? <Text type="secondary" style={{ fontSize: 12 }}>{d?.loading ? 'Loading…' : 'No data'}</Text>
                      : w.viz === 'kpi'
                        ? <KpiBody w={w} rows={d.rows} />
                        : w.viz === 'table'
                          ? <TableBody w={w} rows={d.rows} />
                          : <ChartBody w={w} rows={d.rows} />}
                </div>
              </div>
            );
          })}
        </Grid>
      )}

      {curId !== null && editMode && !def.widgets.length && (
        <div style={{ textAlign: 'center', paddingTop: 40, color: '#8B8580' }}>
          <Text type="secondary">No widgets yet — press <b>Add widget</b> and pick any REST endpoint as its data source.</Text>
        </div>
      )}

      <Modal title="New dashboard" open={newOpen} onCancel={() => setNewOpen(false)} onOk={doCreate}
        okText="Create" okButtonProps={{ disabled: !newName.trim() }} width={420}>
        <Space direction="vertical" style={{ width: '100%', paddingTop: 6 }}>
          <Input placeholder="Name, e.g. Cash Overview" value={newName} onChange={e => setNewName(e.target.value)} onPressEnter={doCreate} />
          <Input placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
        </Space>
      </Modal>

      <Drawer
        title={ed && def.widgets.some(w => w.id === ed.id) ? 'Edit widget' : 'Add widget'}
        open={edOpen}
        onClose={() => setEdOpen(false)}
        width={480}
        extra={<Button type="primary" onClick={saveWidget} style={{ background: '#C74634', borderColor: '#C74634' }}>Apply</Button>}
      >
        {ed && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Title</Text>
              <Input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Type</Text>
              <br />
              <Segmented
                value={ed.viz}
                onChange={v => setEd({ ...ed, viz: v as Widget['viz'] })}
                options={[
                  { label: 'KPI', value: 'kpi', icon: <NumberOutlined /> },
                  { label: 'Bar', value: 'bar', icon: <BarChartOutlined /> },
                  { label: 'Line', value: 'line', icon: <LineChartOutlined /> },
                  { label: 'Table', value: 'table', icon: <TableOutlined /> },
                ]}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Data source — any REST endpoint (GET)</Text>
              <AutoComplete
                style={{ width: '100%' }}
                placeholder="/ap/invoices/stats"
                value={ed.path}
                onChange={v => setEd({ ...ed, path: v })}
                options={catalog
                  .filter(p => !ed.path || p.toLowerCase().includes(ed.path.toLowerCase()))
                  .slice(0, 30)
                  .map(p => ({ value: p }))}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Query parameters (optional)</Text>
              <Input placeholder="e.g. period=Jun-26&row_limit=500" value={ed.query || ''}
                onChange={e => setEd({ ...ed, query: e.target.value })} />
            </div>
            <Button onClick={loadSample} loading={edLoading} icon={<ReloadOutlined />}>Load sample data</Button>
            {edSampleErr && <Alert type="error" showIcon message={edSampleErr} />}
            {edSample.length > 0 && (
              <>
                <Text type="secondary" style={{ fontSize: 11.5 }}>{edSample.length} rows · columns detected below</Text>
                {ed.viz !== 'kpi' && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Label / category column</Text>
                    <Select style={{ width: '100%' }} showSearch value={ed.labelField}
                      onChange={v => setEd({ ...ed, labelField: v })}
                      options={(sampleText.length ? sampleText : sampleKeys).map(k => ({ value: k, label: k }))} />
                  </div>
                )}
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {ed.viz === 'kpi' ? 'Value column' : ed.viz === 'table' ? 'Columns to show' : 'Value columns (max 3)'}
                  </Text>
                  <Select
                    style={{ width: '100%' }}
                    mode="multiple"
                    maxCount={ed.viz === 'kpi' ? 1 : ed.viz === 'table' ? 8 : 3}
                    showSearch
                    value={ed.valueFields || []}
                    onChange={v => setEd({ ...ed, valueFields: v })}
                    options={(ed.viz === 'table' ? sampleKeys : sampleNumeric).map(k => ({ value: k, label: k }))}
                  />
                </div>
                {ed.viz === 'kpi' && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Aggregation</Text>
                    <Select style={{ width: 160 }} value={ed.agg || 'sum'} onChange={v => setEd({ ...ed, agg: v })}
                      options={[
                        { value: 'sum', label: 'Sum' }, { value: 'count', label: 'Row count' },
                        { value: 'avg', label: 'Average' }, { value: 'last', label: 'Last value' },
                      ]} />
                  </div>
                )}
              </>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Auto-refresh (seconds, empty = manual)</Text>
              <br />
              <InputNumber min={15} step={15} value={ed.refreshSec} onChange={v => setEd({ ...ed, refreshSec: v || undefined })} />
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
};

export default DashboardDesigner;
