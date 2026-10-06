// Portfolio Management System — Group Portfolio Dashboard (live).
// Port of APEX P_RENDER_STOCK_PORTFOLIO_R5: group KPIs + company cards, and per company the holdings with
// an Original WAC / Revalued (last RE-CAL) / Compare cost basis switch, search and gainers / losers filter.
// Three looks (Classic / Midnight / Aurora) share the same data; the choice is remembered per browser.
// Data: PMS_V_PORTFOLIO_POSTION via POST {base}/ai/executequery (src/services/pms.service.ts).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Breadcrumb, Button, Col, ConfigProvider, Dropdown, Empty, Input, Row, Segmented, Space, Spin, Table, Tag, Tooltip, theme as antTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ReloadOutlined, ArrowLeftOutlined, AppstoreOutlined, SearchOutlined, DownloadOutlined,
  CaretUpFilled, CaretDownFilled, BankOutlined, EyeOutlined, PieChartOutlined, SwapOutlined, CalendarOutlined,
  TeamOutlined, ThunderboltOutlined, SafetyCertificateOutlined, SettingOutlined, LineChartOutlined, DollarOutlined,
  FileTextOutlined, BarChartOutlined, RobotOutlined, BgColorsOutlined, MoonOutlined, LayoutOutlined, TableOutlined, BlockOutlined, RightOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  loadPortfolio, totals, fmtShort, fmtPct, fmtNum, curSym, tone, type PmsData, type PmsPosition,
} from '../../services/pms.service';
import { THEMES, colorMap, surfaceStyle, Donut, Movers, type Look, type Theme, type Slice, type Mover } from './pmsVisuals';

type Basis = 'ORIGINAL' | 'REVALUED' | 'COMPARE';
type Filter = 'ALL' | 'GAIN' | 'LOSS';
type HoldView = 'table' | 'cards';

const LOOK_KEY = 'pms.dashboard.look';
const VIEW_KEY = 'pms.dashboard.holdings';
const readPref = <T extends string>(k: string, ok: readonly T[], d: T): T => {
  try { const v = localStorage.getItem(k) as T | null; return v && ok.includes(v) ? v : d; } catch { return d; }
};
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const MODULES = [
  { key: '/pms/funds', icon: <BankOutlined />, label: 'Fund Management' },
  { key: '/pms/watchlist', icon: <EyeOutlined />, label: 'Watchlist' },
  { key: '/pms/portfolio', icon: <PieChartOutlined />, label: 'Portfolio' },
  { key: '/pms/investment-holdings', icon: <BarChartOutlined />, label: 'Investment Holdings' },
  { key: '/pms/orders', icon: <SwapOutlined />, label: 'Order Management' },
  { key: '/pms/transactions', icon: <CalendarOutlined />, label: 'Transactions' },
  { key: '/pms/investors', icon: <TeamOutlined />, label: 'Investors' },
  { key: '/pms/risk', icon: <ThunderboltOutlined />, label: 'Risk Analytics' },
  { key: '/pms/compliance', icon: <SafetyCertificateOutlined />, label: 'Compliance' },
  { key: '/pms/model-portfolio', icon: <SettingOutlined />, label: 'Model Portfolio' },
  { key: '/pms/benchmark', icon: <LineChartOutlined />, label: 'Benchmark' },
  { key: '/pms/fees', icon: <DollarOutlined />, label: 'Fee Management' },
  { key: '/pms/reports', icon: <FileTextOutlined />, label: 'Reports' },
  { key: '/pms/ai-analysis', icon: <RobotOutlined />, label: 'AI Stock Analysis' },
];

// ── small building blocks (all themed) ────────────────────────────────────────
const toneColor = (t: Theme, v: number) => ({ pos: t.pos, neg: t.neg, neu: t.neu }[tone(v)]);
const labelStyle = (t: Theme, onHero = false): React.CSSProperties =>
  ({ fontSize: 10, color: onHero ? t.heroMuted : t.muted, textTransform: 'uppercase', letterSpacing: 0.6 });

const Kpi: React.FC<{ t: Theme; label: React.ReactNode; value?: React.ReactNode; note?: React.ReactNode; color?: string; accent?: string; children?: React.ReactNode }> =
  ({ t, label, value, note, color, accent, children }) => (
    <div style={surfaceStyle(t, { padding: 18, minHeight: 105, flex: 1, position: 'relative', overflow: 'hidden' })}>
      {accent && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />}
      <div style={labelStyle(t)}>{label}</div>
      {value !== undefined && <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: color || t.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>}
      {note && <div style={{ fontSize: 11, color: color || t.muted, marginTop: 6 }}>{note}</div>}
      {children}
    </div>
  );

const CompareRow: React.FC<{ t: Theme; label: string; value: string; color?: string; onHero?: boolean }> = ({ t, label, value, color, onHero }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7, fontSize: 11, color: onHero ? t.heroMuted : t.ink }}>
    <span>{label}</span><strong style={{ fontSize: 13, color: color || (onHero ? t.heroInk : t.ink) }}>{value}</strong>
  </div>
);

const Gain: React.FC<{ t: Theme; v: number; cur: string }> = ({ t, v, cur }) => (
  <span style={{ color: toneColor(t, v), whiteSpace: 'nowrap' }}>
    {v > 0 ? <CaretUpFilled /> : v < 0 ? <CaretDownFilled /> : null} {curSym(cur)}{fmtShort(v)}
  </span>
);

/** pill with sign + arrow (works on gradients too) */
const Pill: React.FC<{ t: Theme; v: number; text: string; onHero?: boolean }> = ({ t, v, text, onHero }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
    background: onHero ? 'rgba(255,255,255,.18)' : `${toneColor(t, v)}1a`, color: onHero ? t.heroInk : toneColor(t, v), whiteSpace: 'nowrap',
  }}>{v > 0 ? <CaretUpFilled /> : v < 0 ? <CaretDownFilled /> : null}{text}</span>
);

const Section: React.FC<{ t: Theme; title: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }> =
  ({ t, title, extra, children, style }) => (
    <div style={surfaceStyle(t, { padding: 18, ...style })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.ink }}>{title}</div>{extra}
      </div>
      {children}
    </div>
  );

const PMSModule: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const company = params.get('company');
  const [data, setData] = useState<PmsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [basis, setBasis] = useState<Basis>('ORIGINAL');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [shareType, setShareType] = useState<string>('ALL');
  const [look, setLook] = useState<Look>(() => readPref<Look>(LOOK_KEY, ['classic', 'midnight', 'aurora'], 'aurora'));
  const [holdView, setHoldView] = useState<HoldView>(() => readPref<HoldView>(VIEW_KEY, ['table', 'cards'], 'table'));
  const t = THEMES[look];
  const changeLook = (l: Look) => { setLook(l); writePref(LOOK_KEY, l); };
  const changeView = (v: HoldView) => { setHoldView(v); writePref(VIEW_KEY, v); };

  const load = useCallback(() => {
    setLoading(true); setError(null);
    loadPortfolio()
      .then(d => { setData(d); setLoadedAt(new Date()); })
      .catch(e => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setBasis('ORIGINAL'); setFilter('ALL'); setSearch(''); setShareType('ALL'); }, [company]);

  const nameOf = useCallback((code: string) => data?.companyNames.get(code) || code, [data]);
  const group = useMemo(() => (data ? totals(data.positions) : null), [data]);
  const openCompany = useCallback((code: string) => setParams({ company: code }), [setParams]);

  // ── landing: one entry per company; colour follows the company code ─────────
  const companies = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, PmsPosition[]>();
    data.positions.forEach(p => by.set(p.company, [...(by.get(p.company) || []), p]));
    return [...by.entries()].map(([code, ps]) => ({ code, name: nameOf(code), ...totals(ps) }))
      .sort((a, b) => b.market - a.market);
  }, [data, nameOf]);
  const colors = useMemo(() => colorMap(companies.map(c => c.code), t), [companies, t]);
  const slices = useMemo<Slice[]>(() => {
    const own = companies.filter(c => colors.get(c.code) !== t.other && c.market > 0)
      .map(c => ({ key: c.code, label: c.name, value: c.market, color: colors.get(c.code)! }));
    const rest = companies.filter(c => colors.get(c.code) === t.other).reduce((s, c) => s + Math.max(c.market, 0), 0);
    return rest > 0 ? [...own, { key: '__other', label: 'Other companies', value: rest, color: t.other }] : own;
  }, [companies, colors, t]);
  const movers = useMemo<Mover[]>(() => {
    if (!data) return [];
    const ps = data.positions.filter(p => p.originalValue > 0);
    const sorted = [...ps].sort((a, b) => b.originalReturn - a.originalReturn);
    const top = sorted.slice(0, 4).filter(p => p.originalReturn > 0);
    const bottom = sorted.slice(-4).reverse().filter(p => p.originalReturn < 0 && !top.includes(p));
    return [...top, ...bottom.reverse()].map(p => ({
      key: `${p.company}-${p.symbol}-${p.shareType}`, label: p.symbolName, sub: `${p.symbol} · ${nameOf(p.company)}`,
      ret: p.originalReturn, gainText: `${curSym(p.currency)}${fmtShort(p.originalGain)}`, company: p.company,
    }));
  }, [data, nameOf]);

  // ── company detail ─────────────────────────────────────────────────────────
  const holdings = useMemo(() => (data && company ? data.positions.filter(p => p.company === company.trim())
    .sort((a, b) => b.marketAed - a.marketAed) : []), [data, company]);
  const co = useMemo(() => {
    const tt = totals(holdings);
    const revAed = holdings.reduce((s, p) => s + p.revaluedAed, 0);
    const revGain = tt.market - revAed;
    return { ...tt, revAed, revGain, revRet: revAed ? (revGain / revAed) * 100 : 0 };
  }, [holdings]);
  const revDate = company ? data?.revaluedDates.get(company.trim()) : undefined;
  const revDateText = revDate ? new Date(`${revDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not Available';
  const shareTypes = useMemo(() => [...new Set(holdings.map(h => h.shareType).filter(Boolean))].sort(), [holdings]);
  const gainOf = useCallback((p: PmsPosition) => (basis === 'REVALUED' ? p.revaluedGain : p.originalGain), [basis]);
  const retOf = useCallback((p: PmsPosition) => (basis === 'REVALUED' ? p.revaluedReturn : p.originalReturn), [basis]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return holdings.filter(p => (shareType === 'ALL' || p.shareType === shareType)
      && (!q || `${p.symbolName} ${p.symbol} ${p.exchange} ${p.currency}`.toLowerCase().includes(q))
      && (filter === 'ALL' || (filter === 'GAIN' ? gainOf(p) > 0 : gainOf(p) < 0)));
  }, [holdings, search, filter, shareType, gainOf]);
  const gainers = holdings.filter(p => gainOf(p) > 0).length;
  const losers = holdings.filter(p => gainOf(p) < 0).length;

  const exportExcel = () => {
    const rows = visible.map(p => ({
      Stock: p.symbolName, Symbol: p.symbol, Exchange: p.exchange, 'Share type': p.shareType, Currency: p.currency, Quantity: p.qty,
      'Original WAC': p.originalWac, 'Revalued rate': p.recalRate, CMP: p.cmp,
      'Invested (original)': p.originalValue, 'Revalued value': p.revaluedValue, 'Market value': p.valueAtCmp,
      'Gain / loss': p.originalGain, 'Return %': p.originalReturn,
      'Gain / loss since reval.': p.revaluedGain, 'Return since reval. %': p.revaluedReturn,
      'Market value AED': p.marketAed, 'Market value USD': p.marketUsd,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Holdings');
    XLSX.writeFile(wb, `Portfolio_${company}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const showOrig = basis !== 'REVALUED';
  const showRev = basis !== 'ORIGINAL';
  const revCell = { style: { background: t.reval } };
  const columns: ColumnsType<PmsPosition> = [
    { title: 'Stock', key: 'stock', fixed: 'left', width: 230, sorter: (a, b) => a.symbolName.localeCompare(b.symbolName), render: (_, p) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{p.symbolName}</div>
        <div style={{ color: t.accent, fontSize: 10, marginTop: 2 }}>{p.symbol}</div>
        <Space size={4} style={{ marginTop: 4 }}>
          {p.exchange && <Tag style={{ fontSize: 9, lineHeight: '14px', marginInlineEnd: 0 }}>{p.exchange}</Tag>}
          {p.shareType && <Tag color={p.shareType === 'NRE' ? 'blue' : 'purple'} style={{ fontSize: 9, lineHeight: '14px', marginInlineEnd: 0 }}>{p.shareType}</Tag>}
        </Space>
      </div>) },
    { title: 'Currency', dataIndex: 'currency', width: 80, align: 'right' },
    { title: 'Quantity', dataIndex: 'qty', width: 110, align: 'right', sorter: (a, b) => a.qty - b.qty, render: v => fmtNum(v) },
    ...(showOrig ? [{ title: 'Original WAC', key: 'wac', width: 120, align: 'right' as const, render: (_: unknown, p: PmsPosition) => `${curSym(p.currency)}${fmtNum(p.originalWac)}` }] : []),
    ...(showRev ? [{ title: 'Revalued rate', key: 'rr', width: 120, align: 'right' as const, onHeaderCell: () => revCell, onCell: () => revCell,
      render: (_: unknown, p: PmsPosition) => `${curSym(p.currency)}${fmtNum(p.recalRate)}` }] : []),
    { title: 'CMP', key: 'cmp', width: 110, align: 'right', render: (_, p) => <strong>{curSym(p.currency)}{fmtNum(p.cmp)}</strong> },
    ...(showOrig ? [{ title: 'Invested (original)', key: 'ov', width: 140, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.originalValue - b.originalValue,
      render: (_: unknown, p: PmsPosition) => `${curSym(p.currency)}${fmtShort(p.originalValue)}` }] : []),
    ...(showRev ? [{ title: 'Revalued value', key: 'rv', width: 140, align: 'right' as const, onHeaderCell: () => revCell, onCell: () => revCell,
      sorter: (a: PmsPosition, b: PmsPosition) => a.revaluedValue - b.revaluedValue, render: (_: unknown, p: PmsPosition) => `${curSym(p.currency)}${fmtShort(p.revaluedValue)}` }] : []),
    { title: 'Market value', key: 'mv', width: 140, align: 'right', sorter: (a, b) => a.marketAed - b.marketAed,
      render: (_, p) => <Tooltip title={`AED ${fmtShort(p.marketAed)} · $ ${fmtShort(p.marketUsd)}`}><strong>{curSym(p.currency)}{fmtShort(p.valueAtCmp)}</strong></Tooltip> },
    ...(showOrig ? [
      { title: 'Gain / loss', key: 'og', width: 140, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.originalGain - b.originalGain,
        render: (_: unknown, p: PmsPosition) => <Gain t={t} v={p.originalGain} cur={p.currency} /> },
      { title: 'Return %', key: 'or', width: 110, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.originalReturn - b.originalReturn,
        render: (_: unknown, p: PmsPosition) => <span style={{ color: toneColor(t, p.originalGain), fontWeight: 600 }}>{fmtPct(p.originalReturn)}</span> },
    ] : []),
    ...(showRev ? [
      { title: 'Gain / loss since reval.', key: 'rg', width: 160, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.revaluedGain - b.revaluedGain,
        render: (_: unknown, p: PmsPosition) => <Gain t={t} v={p.revaluedGain} cur={p.currency} /> },
      { title: 'Return since reval.', key: 'rr2', width: 130, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.revaluedReturn - b.revaluedReturn,
        render: (_: unknown, p: PmsPosition) => <span style={{ color: toneColor(t, p.revaluedGain), fontWeight: 600 }}>{fmtPct(p.revaluedReturn)}</span> },
    ] : []),
  ];

  const modulesMenu = { items: MODULES.map(m => ({ key: m.key, icon: m.icon, label: m.label })), onClick: ({ key }: { key: string }) => navigate(key) };
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const modern = look !== 'classic';
  const basisBadge = basis === 'ORIGINAL' ? 'Cost basis: Original WAC' : basis === 'REVALUED' ? `Cost basis: Revalued ${revDateText}` : 'Comparing both bases';

  // ── hero banner (modern looks) ───────────────────────────────────────────────
  const Hero: React.FC<{ eyebrow: string; title: string; value: string; sub: React.ReactNode; pill?: React.ReactNode; stats: [string, React.ReactNode][]; right?: React.ReactNode }> =
    ({ eyebrow, title, value, sub, pill, stats, right }) => (
      <div style={{ background: t.heroBg, color: t.heroInk, borderRadius: t.radius + 4, padding: '24px 28px', marginBottom: 18, position: 'relative', overflow: 'hidden',
        boxShadow: look === 'aurora' ? '0 20px 50px rgba(124,58,237,.28)' : t.shadow, border: look === 'midnight' ? `1px solid ${t.line}` : 'none' }}>
        {look === 'aurora' && <>
          <div style={{ position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: 'rgba(255,255,255,.10)', right: -90, top: -150 }} />
          <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,.08)', right: 160, bottom: -140 }} />
        </>}
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div style={labelStyle(t, true)}>{eyebrow}</div>
            <div style={{ fontSize: 13, color: t.heroMuted, marginTop: 4 }}>{title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
              {pill}
            </div>
            <div style={{ fontSize: 12, color: t.heroMuted, marginTop: 4 }}>{sub}</div>
          </div>
          {right}
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${stats.length}, minmax(120px, 1fr))`, gap: 10, marginTop: 20 }}>
          {stats.map(([l, v]) => (
            <div key={l} style={{ background: t.heroChip, borderRadius: t.radius - 6, padding: '10px 14px' }}>
              <div style={labelStyle(t, true)}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );

  const lookSwitch = (
    <Segmented size="small" value={look} onChange={v => changeLook(v as Look)} options={[
      { value: 'aurora', label: <Tooltip title="Gradient hero, glass cards, charts"><span><BgColorsOutlined /> Aurora</span></Tooltip> },
      { value: 'midnight', label: <Tooltip title="Dark trading-desk look"><span><MoonOutlined /> Midnight</span></Tooltip> },
      { value: 'classic', label: <Tooltip title="Light cards (APEX layout)"><span><LayoutOutlined /> Classic</span></Tooltip> },
    ]} />
  );

  // ── company cards / rows ────────────────────────────────────────────────────
  const companyGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
      {companies.map(c => (
        <div key={c.code} className="pf-company-card" role="button" tabIndex={0}
          onClick={() => openCompany(c.code)} onKeyDown={e => e.key === 'Enter' && openCompany(c.code)}
          style={surfaceStyle(t, { padding: 19, cursor: 'pointer', borderTop: `3px solid ${colors.get(c.code)}` })}>
          <div style={{ color: t.faint, fontSize: 10 }}>{c.code}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3, color: t.ink }}>{c.name}</div>
          <div style={{ marginTop: 20, ...labelStyle(t) }}>Current market value</div>
          <div style={{ fontSize: 25, fontWeight: 700, marginTop: 4, color: t.ink }}>AED {fmtShort(c.market)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16, borderTop: `1px solid ${t.line}` }}>
            {([['Cost', `AED ${fmtShort(c.cost)}`, t.ink], ['Gain / loss', fmtShort(c.gain), toneColor(t, c.gain)], ['Return', fmtPct(c.ret), toneColor(t, c.gain)]] as const).map(([l, v, col]) => (
              <div key={l} style={{ paddingTop: 12 }}>
                <div style={{ fontSize: 9, color: t.faint, textTransform: 'uppercase' }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: col }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, fontSize: 10, color: t.muted, display: 'flex', justifyContent: 'space-between' }}>
            <span>{c.stocks} Stocks</span>
            <span>{group?.market ? ((c.market / group.market) * 100).toFixed(1) : '0.0'}% of group</span>
          </div>
        </div>
      ))}
    </div>
  );
  const companyRows = (
    <div style={{ display: 'grid', gap: 10 }}>
      {companies.map(c => {
        const share = group?.market ? (c.market / group.market) * 100 : 0;
        return (
          <div key={c.code} className="pf-company-card" role="button" tabIndex={0}
            onClick={() => openCompany(c.code)} onKeyDown={e => e.key === 'Enter' && openCompany(c.code)}
            style={surfaceStyle(t, { padding: '14px 18px', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(180px,1.6fr) 1fr 1.4fr 1fr 110px 20px', alignItems: 'center', gap: 16 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: colors.get(c.code), color: '#fff', fontWeight: 800, display: 'grid', placeItems: 'center', flex: 'none', fontSize: 13 }}>
                {c.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: t.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: t.faint }}>{c.code} · {c.stocks} stocks</div>
              </div>
            </div>
            <div>
              <div style={labelStyle(t)}>Market value</div>
              <div style={{ fontWeight: 700, color: t.ink, fontVariantNumeric: 'tabular-nums' }}>AED {fmtShort(c.market)}</div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', ...labelStyle(t) }}><span>Share of group</span><span>{share.toFixed(1)}%</span></div>
              <div style={{ height: 6, borderRadius: 4, background: t.dark ? '#1b2540' : '#eceef5', marginTop: 6, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(share, 100)}%`, height: '100%', borderRadius: 4, background: colors.get(c.code) }} />
              </div>
            </div>
            <div>
              <div style={labelStyle(t)}>Cost</div>
              <div style={{ color: t.ink, fontVariantNumeric: 'tabular-nums' }}>AED {fmtShort(c.cost)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Pill t={t} v={c.gain} text={fmtPct(c.ret)} />
              <div style={{ fontSize: 11, color: toneColor(t, c.gain), marginTop: 4 }}>{fmtShort(c.gain)}</div>
            </div>
            <RightOutlined style={{ color: t.faint }} />
          </div>
        );
      })}
    </div>
  );

  // ── holdings as cards ───────────────────────────────────────────────────────
  const holdingCards = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
      {visible.map(p => {
        const g = gainOf(p); const r = retOf(p);
        return (
          <div key={`${p.symbol}-${p.shareType}-${p.exchange}`} style={surfaceStyle(t, { padding: 16 })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: t.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.symbolName}</div>
                <div style={{ fontSize: 11, color: t.accent }}>{p.symbol} <span style={{ color: t.faint }}>· {p.exchange} · {p.shareType}</span></div>
              </div>
              <Pill t={t} v={g} text={fmtPct(r)} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.ink, marginTop: 12, fontVariantNumeric: 'tabular-nums' }}>{curSym(p.currency)}{fmtShort(p.valueAtCmp)}</div>
            <div style={{ fontSize: 11, color: t.muted }}>{fmtNum(p.qty, 0)} × {curSym(p.currency)}{fmtNum(p.cmp)} · AED {fmtShort(p.marketAed)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.line}`, fontSize: 11 }}>
              {showOrig && <div><div style={{ color: t.faint }}>Original WAC</div><div style={{ color: t.ink, fontWeight: 600 }}>{curSym(p.currency)}{fmtNum(p.originalWac)}</div></div>}
              {showRev && <div style={{ background: t.reval, borderRadius: 6, padding: '2px 6px' }}><div style={{ color: t.revalInk }}>Revalued rate</div><div style={{ color: t.ink, fontWeight: 600 }}>{curSym(p.currency)}{fmtNum(p.recalRate)}</div></div>}
              <div><div style={{ color: t.faint }}>{basis === 'REVALUED' ? 'Gain since reval.' : 'Gain / loss'}</div><div style={{ fontWeight: 600 }}><Gain t={t} v={g} cur={p.currency} /></div></div>
              {basis === 'COMPARE' && <div><div style={{ color: t.faint }}>Since reval.</div><div style={{ fontWeight: 600 }}><Gain t={t} v={p.revaluedGain} cur={p.currency} /></div></div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <ConfigProvider theme={{
      algorithm: t.dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: { colorPrimary: t.accent, borderRadius: Math.min(t.radius - 4, 10), ...(t.dark ? { colorBgContainer: t.surface, colorBgElevated: '#18223b', colorBorder: t.line, colorBorderSecondary: t.line } : {}) },
    }}>
      <div style={{ background: t.bg, minHeight: '100%', padding: '12px 18px 28px', color: t.ink, transition: 'background .3s' }}>
        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/" style={{ color: t.muted }}><HomeOutlined /> Home</Link> },
          { title: company ? <a onClick={() => setParams({})} style={{ color: t.muted }}>Portfolio Management System</a> : <span style={{ color: t.ink }}>Portfolio Management System</span> },
          ...(company ? [{ title: <span style={{ color: t.ink }}>{nameOf(company.trim())}</span> }] : []),
        ]} />

        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: modern ? 22 : 25, fontWeight: 700, color: t.ink }}>{company ? nameOf(company.trim()) : 'Group Portfolio Dashboard'}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: t.muted }}>
              {company ? <>Company code: {company} &nbsp;|&nbsp; Equity portfolio</> : 'Consolidated equity portfolio'}
              {loadedAt && <> &nbsp;·&nbsp; refreshed {loadedAt.toLocaleTimeString()}</>}
            </div>
          </div>
          <Space wrap>
            {company && <Tag style={{ background: t.reval, color: t.revalInk, border: 'none', padding: '4px 10px' }}>{basisBadge}</Tag>}
            {lookSwitch}
            <span style={surfaceStyle(t, { padding: '5px 12px', fontSize: 11, borderRadius: 8, color: t.ink })}>{today}</span>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Refresh</Button>
            <Dropdown menu={modulesMenu} trigger={['click']}><Button icon={<AppstoreOutlined />}>Modules</Button></Dropdown>
          </Space>
        </div>

        {error && (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Portfolio could not be loaded" description={<>
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{error}</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>If the AI query gateway runs in whitelist mode, run <b>database/pms/pms_dashboard_acl.sql</b> to allow PMS_V_PORTFOLIO_POSTION, PMS_COMPANY and PMS_FAIRVALUE_CHANGE.</div>
          </>} />
        )}

        <Spin spinning={loading && !data}>
          {/* ═════════════ GROUP ═════════════ */}
          {!company && group && (
            <>
              {modern ? (
                <>
                  <Hero eyebrow="Group portfolio" title="Current market value" value={`AED ${fmtShort(group.market)}`}
                    pill={<Pill t={t} v={group.gain} text={`${fmtPct(group.ret)} · AED ${fmtShort(group.gain)}`} onHero />}
                    sub={<>$ {fmtShort(group.marketUsd)} USD · invested AED {fmtShort(group.cost)}</>}
                    stats={[['Portfolio cost', `AED ${fmtShort(group.cost)}`], ['Gain / loss', `AED ${fmtShort(group.gain)}`], ['Holdings', `${group.stocks} stocks`], ['Companies', `${group.companies}`]]} />
                  <Row gutter={[18, 18]} style={{ marginBottom: 18 }}>
                    <Col xs={24} xl={12} style={{ display: 'flex' }}>
                      <Section t={t} title="Allocation by company" style={{ flex: 1 }} extra={<span style={{ fontSize: 11, color: t.muted }}>market value · AED</span>}>
                        {slices.length ? <Donut slices={slices} t={t} centerTop="TOTAL AED" centerValue={fmtShort(group.market)} onPick={openCompany} /> : <Empty />}
                      </Section>
                    </Col>
                    <Col xs={24} xl={12} style={{ display: 'flex' }}>
                      <Section t={t} title="Top movers" style={{ flex: 1 }} extra={<span style={{ fontSize: 11, color: t.muted }}>return since purchase</span>}>
                        {movers.length ? <Movers movers={movers} t={t} onPick={openCompany} /> : <Empty description="No priced holdings" />}
                      </Section>
                    </Col>
                  </Row>
                  <div style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 12px', color: t.ink }}>Company Portfolios</div>
                  {companies.length === 0 ? <Empty description="No open holdings" /> : (look === 'aurora' ? companyRows : companyGrid)}
                </>
              ) : (
                <>
                  <Row gutter={[13, 13]} style={{ marginBottom: 15 }}>
                    <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi t={t} label="Market value" value={`AED ${fmtShort(group.market)}`} note={`$ ${fmtShort(group.marketUsd)} USD`} /></Col>
                    <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi t={t} label="Portfolio cost" value={`AED ${fmtShort(group.cost)}`} note={`$ ${fmtShort(group.costUsd)} USD`} /></Col>
                    <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi t={t} label="Gain / loss" value={`AED ${fmtShort(group.gain)}`} note={fmtPct(group.ret)} color={toneColor(t, group.gain)} /></Col>
                    <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi t={t} label="Portfolio coverage" value={`${group.stocks} Stocks`} note={`${group.companies} Companies`} /></Col>
                  </Row>
                  {group.market > 0 && (
                    <div style={surfaceStyle(t, { padding: '12px 16px', marginBottom: 6 })}>
                      <div style={{ ...labelStyle(t), marginBottom: 8 }}>Allocation by company (market value AED)</div>
                      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: '#eef1f5', gap: 2 }}>
                        {slices.map(s => (
                          <Tooltip key={s.key} title={`${s.label}: AED ${fmtShort(s.value)} (${((s.value / group.market) * 100).toFixed(1)}%)`}>
                            <div onClick={() => s.key !== '__other' && openCompany(s.key)} style={{ width: `${(s.value / group.market) * 100}%`, background: s.color, cursor: 'pointer' }} />
                          </Tooltip>
                        ))}
                      </div>
                      <Space size={14} wrap style={{ marginTop: 8 }}>
                        {slices.map(s => (
                          <span key={s.key} style={{ fontSize: 11, color: t.muted }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 5 }} />
                            {s.label} {((s.value / group.market) * 100).toFixed(1)}%
                          </span>
                        ))}
                      </Space>
                    </div>
                  )}
                  <div style={{ fontSize: 17, fontWeight: 700, margin: '20px 0 12px' }}>Company Portfolios</div>
                  {companies.length === 0 ? <Empty description="No open holdings" /> : companyGrid}
                </>
              )}
            </>
          )}

          {/* ═════════════ COMPANY ═════════════ */}
          {company && data && (
            <>
              <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setParams({})} style={{ marginBottom: 13 }}>All Companies</Button>
              {holdings.length === 0 ? <Empty description={`No open holdings for company ${company}`} /> : (
                <>
                  {modern ? (
                    <Hero eyebrow={`${company} · equity portfolio`} title="Current market value" value={`AED ${fmtShort(co.market)}`}
                      pill={basis === 'COMPARE' ? undefined : <Pill t={t} v={basis === 'REVALUED' ? co.revGain : co.gain}
                        text={`${fmtPct(basis === 'REVALUED' ? co.revRet : co.ret)} · AED ${fmtShort(basis === 'REVALUED' ? co.revGain : co.gain)}`} onHero />}
                      sub={<>$ {fmtShort(co.marketUsd)} USD · {co.stocks} stocks{revDate ? ` · last revaluation ${revDateText}` : ''}</>}
                      right={basis === 'COMPARE' ? (
                        <div style={{ minWidth: 280, background: t.heroChip, borderRadius: t.radius - 6, padding: '12px 16px' }}>
                          <div style={labelStyle(t, true)}>Compare both bases</div>
                          <CompareRow t={t} onHero label="Invested (original)" value={`AED ${fmtShort(co.cost)}`} />
                          <CompareRow t={t} onHero label={`Revalued (${revDateText})`} value={`AED ${fmtShort(co.revAed)}`} />
                          <CompareRow t={t} onHero label="Gain vs original" value={`AED ${fmtShort(co.gain)} · ${fmtPct(co.ret)}`} />
                          <CompareRow t={t} onHero label="Gain since reval." value={`AED ${fmtShort(co.revGain)} · ${fmtPct(co.revRet)}`} />
                        </div>
                      ) : undefined}
                      stats={basis === 'REVALUED'
                        ? [[`Revalued cost (${revDateText})`, `AED ${fmtShort(co.revAed)}`], ['Gain since reval.', `AED ${fmtShort(co.revGain)}`], ['Return since reval.', fmtPct(co.revRet)], ['Holdings', `${co.stocks} stocks`]]
                        : [['Invested (original)', `AED ${fmtShort(co.cost)}`], ['Gain / loss', `AED ${fmtShort(co.gain)}`], ['Return', fmtPct(co.ret)], ['Holdings', `${co.stocks} stocks`]]} />
                  ) : (
                    <Row gutter={[13, 13]} style={{ marginBottom: 15 }}>
                      <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi t={t} label="Market value" value={`AED ${fmtShort(co.market)}`} note={`$ ${fmtShort(co.marketUsd)} USD`} /></Col>
                      <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                        {basis === 'COMPARE' ? (
                          <Kpi t={t} label="Cost basis">
                            <CompareRow t={t} label="Invested (original)" value={`AED ${fmtShort(co.cost)}`} />
                            <CompareRow t={t} label={`Revalued (${revDateText})`} value={`AED ${fmtShort(co.revAed)}`} />
                          </Kpi>
                        ) : basis === 'REVALUED'
                          ? <Kpi t={t} label={`Revalued cost (${revDateText})`} value={`AED ${fmtShort(co.revAed)}`} note="Qty × Revalued rate" />
                          : <Kpi t={t} label="Invested amount (original)" value={`AED ${fmtShort(co.cost)}`} note="Qty × Original WAC" />}
                      </Col>
                      <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                        {basis === 'COMPARE' ? (
                          <Kpi t={t} label="Gain / loss">
                            <CompareRow t={t} label="vs Original" value={`AED ${fmtShort(co.gain)}`} color={toneColor(t, co.gain)} />
                            <CompareRow t={t} label="since Reval." value={`AED ${fmtShort(co.revGain)}`} color={toneColor(t, co.revGain)} />
                          </Kpi>
                        ) : basis === 'REVALUED'
                          ? <Kpi t={t} label="Gain / loss since revaluation" value={`AED ${fmtShort(co.revGain)}`} note={`Since ${revDateText}`} color={toneColor(t, co.revGain)} />
                          : <Kpi t={t} label="Gain / loss" value={`AED ${fmtShort(co.gain)}`} note="Since purchase" color={toneColor(t, co.gain)} />}
                      </Col>
                      <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                        <Kpi t={t} label="Return / holdings"
                          value={basis === 'COMPARE' ? undefined : fmtPct(basis === 'REVALUED' ? co.revRet : co.ret)}
                          color={basis === 'COMPARE' ? undefined : toneColor(t, basis === 'REVALUED' ? co.revGain : co.gain)}>
                          {basis === 'COMPARE' && <>
                            <CompareRow t={t} label="vs Original" value={fmtPct(co.ret)} color={toneColor(t, co.gain)} />
                            <CompareRow t={t} label="since Reval." value={fmtPct(co.revRet)} color={toneColor(t, co.revGain)} />
                          </>}
                          <div style={{ fontSize: 11, color: t.muted, marginTop: 6 }}>{co.stocks} Stocks</div>
                        </Kpi>
                      </Col>
                    </Row>
                  )}

                  {/* cost basis switch */}
                  <div style={surfaceStyle(t, { padding: '11px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 15, flexWrap: 'wrap' })}>
                    <Space size={12} wrap>
                      <span style={labelStyle(t)}>Cost basis</span>
                      <Segmented value={basis} onChange={v => setBasis(v as Basis)} options={[
                        { label: 'Original Cost', value: 'ORIGINAL' },
                        { label: `Revalued Cost (${revDateText})`, value: 'REVALUED' },
                        { label: 'Compare Both', value: 'COMPARE' },
                      ]} />
                    </Space>
                    <span style={{ fontFamily: 'Consolas, monospace', fontSize: 11, color: t.muted }}>
                      {basis === 'ORIGINAL' ? 'Gain = Market value − Qty × Original WAC'
                        : basis === 'REVALUED' ? `Gain = Market value − Qty × Revalued rate (${revDateText})`
                          : 'Original = since purchase  •  Revalued = since last revaluation'}
                    </span>
                  </div>

                  {/* search + filters */}
                  <div style={surfaceStyle(t, { padding: 10, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' })}>
                    <Input allowClear prefix={<SearchOutlined />} placeholder="Search stock, symbol or exchange…" value={search}
                      onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                    <Segmented value={filter} onChange={v => setFilter(v as Filter)} options={[
                      { label: `All Holdings (${holdings.length})`, value: 'ALL' },
                      { label: <span style={{ color: t.pos }}>Gainers ({gainers})</span>, value: 'GAIN' },
                      { label: <span style={{ color: t.neg }}>Losers ({losers})</span>, value: 'LOSS' },
                    ]} />
                    {shareTypes.length > 1 && (
                      <Segmented value={shareType} onChange={v => setShareType(String(v))}
                        options={[{ label: 'All types', value: 'ALL' }, ...shareTypes.map(s => ({ label: s, value: s }))]} />
                    )}
                    <Segmented value={holdView} onChange={v => changeView(v as HoldView)} options={[
                      { value: 'table', label: <Tooltip title="Table"><TableOutlined /></Tooltip> },
                      { value: 'cards', label: <Tooltip title="Cards"><BlockOutlined /></Tooltip> },
                    ]} />
                    <Button icon={<DownloadOutlined />} onClick={exportExcel} disabled={!visible.length}>Excel</Button>
                  </div>

                  {holdView === 'cards' ? (visible.length ? holdingCards : <Empty description="No holdings match" />) : (
                    <Table<PmsPosition> size="small" rowKey={p => `${p.symbol}-${p.shareType}-${p.exchange}`} columns={columns} dataSource={visible}
                      pagination={false} scroll={{ x: basis === 'COMPARE' ? 1750 : 1350 }} sticky
                      style={surfaceStyle(t, { overflow: 'hidden' })}
                      locale={{ emptyText: <Empty description="No holdings match" /> }} />
                  )}
                  <div style={{ fontSize: 11, color: t.muted, marginTop: 8 }}>
                    Values per holding are in its trading currency; no table total because holdings mix currencies (INR / AED / USD …). Totals above are in AED.
                  </div>
                </>
              )}
            </>
          )}
        </Spin>
        <style>{`.pf-company-card{transition:transform .2s, box-shadow .2s}.pf-company-card:hover{transform:translateY(-3px);box-shadow:0 14px 30px ${t.dark ? 'rgba(0,0,0,.45)' : 'rgba(31,45,61,.12)'} !important}`}</style>
      </div>
    </ConfigProvider>
  );
};

export default PMSModule;
