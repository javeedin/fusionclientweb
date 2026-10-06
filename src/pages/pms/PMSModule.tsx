// Portfolio Management System — Group Portfolio Dashboard (live).
// Port of APEX P_RENDER_STOCK_PORTFOLIO_R5: group KPIs + company cards, and per company the holdings with
// an Original WAC / Revalued (last RE-CAL) / Compare cost basis switch, search and gainers / losers filter.
// Data: PMS_V_PORTFOLIO_POSTION via POST {base}/ai/executequery (src/services/pms.service.ts).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Breadcrumb, Button, Card, Col, Dropdown, Empty, Input, Row, Segmented, Space, Spin, Table, Tag, Tooltip, Typography, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ReloadOutlined, ArrowLeftOutlined, AppstoreOutlined, SearchOutlined, DownloadOutlined,
  CaretUpFilled, CaretDownFilled, BankOutlined, EyeOutlined, PieChartOutlined, SwapOutlined, CalendarOutlined,
  TeamOutlined, ThunderboltOutlined, SafetyCertificateOutlined, SettingOutlined, LineChartOutlined, DollarOutlined,
  FileTextOutlined, BarChartOutlined, RobotOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  loadPortfolio, totals, fmtShort, fmtPct, fmtNum, curSym, tone, type PmsData, type PmsPosition,
} from '../../services/pms.service';

const { Text } = Typography;

const C = {
  bg: '#f5f7fb', ink: '#172033', muted: '#7c8596', line: '#dfe4ec', navy: '#1e3766', link: '#3167c6',
  pos: '#168a42', neg: '#ce3434', neu: '#697386', reval: '#fff7dc', revalInk: '#806317',
};
const TONE: Record<string, string> = { pos: C.pos, neg: C.neg, neu: C.neu };
const PALETTE = ['#1e3766', '#3167c6', '#2a9d8f', '#e9a03b', '#c74634', '#6b4c9a', '#00796b', '#8d6e63', '#5c6bc0', '#9e9d24'];

type Basis = 'ORIGINAL' | 'REVALUED' | 'COMPARE';
type Filter = 'ALL' | 'GAIN' | 'LOSS';

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

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12 };
const kpiLabel: React.CSSProperties = { fontSize: 10, color: '#778194', textTransform: 'uppercase', letterSpacing: 0.5 };

const Kpi: React.FC<{ label: React.ReactNode; value?: React.ReactNode; note?: React.ReactNode; color?: string; children?: React.ReactNode }> =
  ({ label, value, note, color, children }) => (
    <div style={{ ...card, padding: 18, minHeight: 105, flex: 1 }}>
      <div style={kpiLabel}>{label}</div>
      {value !== undefined && <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: color || C.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>}
      {note && <div style={{ fontSize: 11, color: color || C.muted, marginTop: 6 }}>{note}</div>}
      {children}
    </div>
  );

const CompareRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7, fontSize: 11 }}>
    <span>{label}</span><strong style={{ fontSize: 13, color: color || C.ink }}>{value}</strong>
  </div>
);

const Gain: React.FC<{ v: number; cur: string; bold?: boolean }> = ({ v, cur, bold }) => (
  <span style={{ color: TONE[tone(v)], fontWeight: bold ? 600 : undefined, whiteSpace: 'nowrap' }}>
    {v > 0 ? <CaretUpFilled /> : v < 0 ? <CaretDownFilled /> : null} {curSym(cur)}{fmtShort(v)}
  </span>
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

  // ── landing: one card per company ──────────────────────────────────────────
  const companies = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, PmsPosition[]>();
    data.positions.forEach(p => by.set(p.company, [...(by.get(p.company) || []), p]));
    return [...by.entries()].map(([code, ps]) => ({ code, name: nameOf(code), ...totals(ps) }))
      .sort((a, b) => b.market - a.market);
  }, [data, nameOf]);

  // ── company detail ─────────────────────────────────────────────────────────
  const holdings = useMemo(() => (data && company ? data.positions.filter(p => p.company === company.trim())
    .sort((a, b) => b.marketAed - a.marketAed) : []), [data, company]);
  const co = useMemo(() => {
    const t = totals(holdings);
    const revAed = holdings.reduce((s, p) => s + p.revaluedAed, 0);
    const revGain = t.market - revAed;
    return { ...t, revAed, revGain, revRet: revAed ? (revGain / revAed) * 100 : 0 };
  }, [holdings]);
  const revDate = company ? data?.revaluedDates.get(company.trim()) : undefined;
  const revDateText = revDate ? new Date(`${revDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not Available';
  const shareTypes = useMemo(() => [...new Set(holdings.map(h => h.shareType).filter(Boolean))].sort(), [holdings]);
  const gainOf = useCallback((p: PmsPosition) => (basis === 'REVALUED' ? p.revaluedGain : p.originalGain), [basis]);
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
  const revCell = { style: { background: C.reval } };
  const columns: ColumnsType<PmsPosition> = [
    { title: 'Stock', key: 'stock', fixed: 'left', width: 230, sorter: (a, b) => a.symbolName.localeCompare(b.symbolName), render: (_, p) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{p.symbolName}</div>
        <div style={{ color: C.link, fontSize: 10, marginTop: 2 }}>{p.symbol}</div>
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
    { title: 'Market value', key: 'mv', width: 140, align: 'right', sorter: (a, b) => a.marketAed - b.marketAed, defaultSortOrder: undefined,
      render: (_, p) => <Tooltip title={`AED ${fmtShort(p.marketAed)} · $ ${fmtShort(p.marketUsd)}`}><strong>{curSym(p.currency)}{fmtShort(p.valueAtCmp)}</strong></Tooltip> },
    ...(showOrig ? [
      { title: 'Gain / loss', key: 'og', width: 140, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.originalGain - b.originalGain,
        render: (_: unknown, p: PmsPosition) => <Gain v={p.originalGain} cur={p.currency} /> },
      { title: 'Return %', key: 'or', width: 110, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.originalReturn - b.originalReturn,
        render: (_: unknown, p: PmsPosition) => <span style={{ color: TONE[tone(p.originalGain)], fontWeight: 600 }}>{fmtPct(p.originalReturn)}</span> },
    ] : []),
    ...(showRev ? [
      { title: 'Gain / loss since reval.', key: 'rg', width: 160, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.revaluedGain - b.revaluedGain,
        render: (_: unknown, p: PmsPosition) => <Gain v={p.revaluedGain} cur={p.currency} /> },
      { title: 'Return since reval.', key: 'rr2', width: 130, align: 'right' as const, sorter: (a: PmsPosition, b: PmsPosition) => a.revaluedReturn - b.revaluedReturn,
        render: (_: unknown, p: PmsPosition) => <span style={{ color: TONE[tone(p.revaluedGain)], fontWeight: 600 }}>{fmtPct(p.revaluedReturn)}</span> },
    ] : []),
  ];

  const modulesMenu = { items: MODULES.map(m => ({ key: m.key, icon: m.icon, label: m.label })), onClick: ({ key }: { key: string }) => navigate(key) };
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div style={{ background: C.bg, minHeight: '100%', padding: '12px 16px 24px', color: C.ink }}>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/"><HomeOutlined /> Home</Link> },
        { title: company ? <a onClick={() => setParams({})}>Portfolio Management System</a> : 'Portfolio Management System' },
        ...(company ? [{ title: nameOf(company.trim()) }] : []),
      ]} />

      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 25, fontWeight: 700 }}>{company ? nameOf(company.trim()) : 'Group Portfolio Dashboard'}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
            {company ? <>Company code: {company} &nbsp;|&nbsp; Equity portfolio</> : 'Consolidated equity portfolio'}
            {loadedAt && <> &nbsp;·&nbsp; refreshed {loadedAt.toLocaleTimeString()}</>}
          </div>
        </div>
        <Space wrap>
          {company && <Tag style={{ background: C.reval, color: C.revalInk, border: 'none', padding: '4px 10px' }}>
            {basis === 'ORIGINAL' ? 'Cost basis: Original WAC' : basis === 'REVALUED' ? `Cost basis: Revalued ${revDateText}` : 'Comparing both bases'}
          </Tag>}
          <span style={{ ...card, padding: '6px 12px', fontSize: 11, borderRadius: 8 }}>{today}</span>
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
        {!company && group && (
          <>
            <Row gutter={[13, 13]} style={{ marginBottom: 15 }}>
              <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi label="Market value" value={`AED ${fmtShort(group.market)}`} note={`$ ${fmtShort(group.marketUsd)} USD`} /></Col>
              <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi label="Portfolio cost" value={`AED ${fmtShort(group.cost)}`} note={`$ ${fmtShort(group.costUsd)} USD`} /></Col>
              <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi label="Gain / loss" value={`AED ${fmtShort(group.gain)}`} note={fmtPct(group.ret)} color={TONE[tone(group.gain)]} /></Col>
              <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi label="Portfolio coverage" value={`${group.stocks} Stocks`} note={`${group.companies} Companies`} /></Col>
            </Row>

            {/* allocation of market value across companies */}
            {group.market > 0 && (
              <div style={{ ...card, padding: '12px 16px', marginBottom: 6 }}>
                <div style={{ ...kpiLabel, marginBottom: 8 }}>Allocation by company (market value AED)</div>
                <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: '#eef1f5' }}>
                  {companies.filter(c => c.market > 0).map((c, i) => (
                    <Tooltip key={c.code} title={`${c.name}: AED ${fmtShort(c.market)} (${((c.market / group.market) * 100).toFixed(1)}%)`}>
                      <div onClick={() => setParams({ company: c.code })} style={{ width: `${(c.market / group.market) * 100}%`, background: PALETTE[i % PALETTE.length], cursor: 'pointer' }} />
                    </Tooltip>
                  ))}
                </div>
                <Space size={14} wrap style={{ marginTop: 8 }}>
                  {companies.filter(c => c.market > 0).map((c, i) => (
                    <span key={c.code} style={{ fontSize: 11, color: C.muted }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], marginRight: 5 }} />
                      {c.name} {((c.market / group.market) * 100).toFixed(1)}%
                    </span>
                  ))}
                </Space>
              </div>
            )}

            <div style={{ fontSize: 17, fontWeight: 700, margin: '20px 0 12px' }}>Company Portfolios</div>
            {companies.length === 0 ? <Empty description="No open holdings" /> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
                {companies.map((c, i) => (
                  <div key={c.code} className="pf-company-card" role="button" tabIndex={0}
                    onClick={() => setParams({ company: c.code })} onKeyDown={e => e.key === 'Enter' && setParams({ company: c.code })}
                    style={{ ...card, borderRadius: 14, padding: 19, cursor: 'pointer', borderTop: `3px solid ${PALETTE[i % PALETTE.length]}` }}>
                    <div style={{ color: '#8590a4', fontSize: 10 }}>{c.code}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3 }}>{c.name}</div>
                    <div style={{ marginTop: 20, fontSize: 10, color: '#8b94a6' }}>CURRENT MARKET VALUE</div>
                    <div style={{ fontSize: 25, fontWeight: 700, marginTop: 4 }}>AED {fmtShort(c.market)}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16, borderTop: '1px solid #edf0f4' }}>
                      {[['Cost', `AED ${fmtShort(c.cost)}`, C.ink], ['Gain / loss', fmtShort(c.gain), TONE[tone(c.gain)]], ['Return', fmtPct(c.ret), TONE[tone(c.gain)]]].map(([l, v, col]) => (
                        <div key={l} style={{ paddingTop: 12 }}>
                          <div style={{ fontSize: 9, color: '#929bad', textTransform: 'uppercase' }}>{l}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: col }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 14, fontSize: 10, color: '#7d8696', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{c.stocks} Stocks</span>
                      <span>{group.market ? ((c.market / group.market) * 100).toFixed(1) : '0.0'}% of group</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {company && data && (
          <>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setParams({})} style={{ marginBottom: 13, color: C.link }}>All Companies</Button>
            {holdings.length === 0 ? <Empty description={`No open holdings for company ${company}`} /> : (
              <>
                <Row gutter={[13, 13]} style={{ marginBottom: 15 }}>
                  <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}><Kpi label="Market value" value={`AED ${fmtShort(co.market)}`} note={`$ ${fmtShort(co.marketUsd)} USD`} /></Col>
                  <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                    {basis === 'COMPARE' ? (
                      <Kpi label="Cost basis">
                        <CompareRow label="Invested (original)" value={`AED ${fmtShort(co.cost)}`} />
                        <CompareRow label={`Revalued (${revDateText})`} value={`AED ${fmtShort(co.revAed)}`} />
                      </Kpi>
                    ) : basis === 'REVALUED'
                      ? <Kpi label={`Revalued cost (${revDateText})`} value={`AED ${fmtShort(co.revAed)}`} note="Qty × Revalued rate" />
                      : <Kpi label="Invested amount (original)" value={`AED ${fmtShort(co.cost)}`} note="Qty × Original WAC" />}
                  </Col>
                  <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                    {basis === 'COMPARE' ? (
                      <Kpi label="Gain / loss">
                        <CompareRow label="vs Original" value={`AED ${fmtShort(co.gain)}`} color={TONE[tone(co.gain)]} />
                        <CompareRow label="since Reval." value={`AED ${fmtShort(co.revGain)}`} color={TONE[tone(co.revGain)]} />
                      </Kpi>
                    ) : basis === 'REVALUED'
                      ? <Kpi label="Gain / loss since revaluation" value={`AED ${fmtShort(co.revGain)}`} note={`Since ${revDateText}`} color={TONE[tone(co.revGain)]} />
                      : <Kpi label="Gain / loss" value={`AED ${fmtShort(co.gain)}`} note="Since purchase" color={TONE[tone(co.gain)]} />}
                  </Col>
                  <Col xs={24} sm={12} lg={6} style={{ display: 'flex' }}>
                    <Kpi label="Return / holdings"
                      value={basis === 'COMPARE' ? undefined : fmtPct(basis === 'REVALUED' ? co.revRet : co.ret)}
                      color={basis === 'COMPARE' ? undefined : TONE[tone(basis === 'REVALUED' ? co.revGain : co.gain)]}>
                      {basis === 'COMPARE' && <>
                        <CompareRow label="vs Original" value={fmtPct(co.ret)} color={TONE[tone(co.gain)]} />
                        <CompareRow label="since Reval." value={fmtPct(co.revRet)} color={TONE[tone(co.revGain)]} />
                      </>}
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{co.stocks} Stocks</div>
                    </Kpi>
                  </Col>
                </Row>

                {/* cost basis switch */}
                <div style={{ ...card, borderRadius: 11, padding: '11px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 15, flexWrap: 'wrap' }}>
                  <Space size={12} wrap>
                    <span style={{ ...kpiLabel, color: C.neu }}>Cost basis</span>
                    <Segmented value={basis} onChange={v => setBasis(v as Basis)} options={[
                      { label: 'Original Cost', value: 'ORIGINAL' },
                      { label: `Revalued Cost (${revDateText})`, value: 'REVALUED' },
                      { label: 'Compare Both', value: 'COMPARE' },
                    ]} />
                  </Space>
                  <span style={{ fontFamily: 'Consolas, monospace', fontSize: 11, color: '#687386' }}>
                    {basis === 'ORIGINAL' ? 'Gain = Market value − Qty × Original WAC'
                      : basis === 'REVALUED' ? `Gain = Market value − Qty × Revalued rate (${revDateText})`
                        : 'Original = since purchase  •  Revalued = since last revaluation'}
                  </span>
                </div>

                {/* search + filters */}
                <div style={{ ...card, borderRadius: 11, padding: 10, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Input allowClear prefix={<SearchOutlined />} placeholder="Search stock, symbol or exchange…" value={search}
                    onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                  <Segmented value={filter} onChange={v => setFilter(v as Filter)} options={[
                    { label: `All Holdings (${holdings.length})`, value: 'ALL' },
                    { label: <span style={{ color: C.pos }}>Gainers ({gainers})</span>, value: 'GAIN' },
                    { label: <span style={{ color: C.neg }}>Losers ({losers})</span>, value: 'LOSS' },
                  ]} />
                  {shareTypes.length > 1 && (
                    <Segmented value={shareType} onChange={v => setShareType(String(v))}
                      options={[{ label: 'All types', value: 'ALL' }, ...shareTypes.map(t => ({ label: t, value: t }))]} />
                  )}
                  <Button icon={<DownloadOutlined />} onClick={exportExcel} disabled={!visible.length}>Excel</Button>
                </div>

                <Table<PmsPosition> size="small" rowKey={p => `${p.symbol}-${p.shareType}-${p.exchange}`} columns={columns} dataSource={visible}
                  pagination={false} scroll={{ x: basis === 'COMPARE' ? 1750 : 1350 }} sticky
                  style={{ ...card, overflow: 'hidden' }}
                  locale={{ emptyText: <Empty description="No holdings match" /> }} />
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                  Values per holding are in its trading currency; no table total because holdings mix currencies (INR / AED / USD …). Totals in the cards are in AED.
                </Text>
              </>
            )}
          </>
        )}
      </Spin>
      <style>{`.pf-company-card{transition:.2s}.pf-company-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(31,45,61,.10)}`}</style>
    </div>
  );
};

export default PMSModule;
