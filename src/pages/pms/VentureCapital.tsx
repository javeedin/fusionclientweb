// PMS → Venture Capital: trust-fund commitments, paid-in capital and deployment (port of the APEX VC dashboard).
// Company filter (all / one company), AED + USD and original-currency totals, commitment-vs-paid chart, paid-in by
// fund donut, fund table with total row; expand a fund to see its investment opportunities.
// Shares the Aurora / Midnight / Classic look with the Group Portfolio Dashboard.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Breadcrumb, Button, Col, ConfigProvider, Dropdown, Empty, Input, Row, Segmented, Select, Space, Spin, Table, Tag, Tooltip, theme as antTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ReloadOutlined, AppstoreOutlined, BgColorsOutlined,
  MoonOutlined, LayoutOutlined, SearchOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { loadVentureCapital, fmtM, fmtOrig, fmtAmt, type VcData, type VcFundRow, type VcOpportunity } from '../../services/vc.service';
import { THEMES, colorMap, surfaceStyle, Donut, PMS_MODULES, type Look, type Theme, type Slice } from './pmsVisuals';

const LOOK_KEY = 'pms.dashboard.look';      // same look as the Group Portfolio Dashboard
const readLook = (): Look => {
  try { const v = localStorage.getItem(LOOK_KEY) as Look | null; return v && v in THEMES ? v : 'aurora'; } catch { return 'aurora'; }
};


const labelStyle = (t: Theme, onHero = false): React.CSSProperties =>
  ({ fontSize: 10, color: onHero ? t.heroMuted : t.muted, textTransform: 'uppercase', letterSpacing: 0.6 });
const curSym = (c: string) => ({ INR: '₹ ', USD: '$ ', AED: 'AED ', EUR: '€ ', GBP: '£ ' } as Record<string, string>)[c.toUpperCase()] ?? (c ? `${c} ` : '');

/** deployment bar: paid against committed (≤ 100% fill; over-deployment flagged) */
const Deploy: React.FC<{ t: Theme; pct: number; color?: string; width?: number | string }> = ({ t, pct, color, width = 120 }) => (
  <div style={{ width, minWidth: 90 }}>
    <div style={{ height: 7, borderRadius: 4, background: t.dark ? '#1b2540' : '#e8ebf2', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, height: '100%', borderRadius: 4, background: color || t.pos }} />
    </div>
    <div style={{ fontSize: 10, color: pct > 100 ? t.neg : t.muted, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(2)} %{pct > 100 ? ' · over committed' : ''}</div>
  </div>
);

const VentureCapital: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const company = params.get('company') || 'ALL';
  const [data, setData] = useState<VcData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [look, setLook] = useState<Look>(readLook);
  const t = THEMES[look];
  const changeLook = (l: Look) => { setLook(l); try { localStorage.setItem(LOOK_KEY, l); } catch { /* ignore */ } };

  const load = useCallback(() => {
    setLoading(true); setError(null);
    loadVentureCapital().then(d => { setData(d); setLoadedAt(new Date()); })
      .catch(e => setError(String(e?.message || e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = useCallback((c: string) => data?.companyNames.get(c) || c, [data]);
  const companies = useMemo(() => [...new Set((data?.funds || []).map(f => f.company))].sort(), [data]);

  // fund rows for the selected company; "all companies" sums each fund across companies
  const rows = useMemo<VcFundRow[]>(() => {
    if (!data) return [];
    const src = company === 'ALL' ? data.funds : data.funds.filter(f => f.company === company);
    if (company !== 'ALL') return src;
    const by = new Map<number, VcFundRow>();
    src.forEach(f => {
      const cur = by.get(f.fundId);
      if (!cur) { by.set(f.fundId, { ...f, company: 'ALL' }); return; }
      const committed = cur.committed + f.committed; const paid = cur.paid + f.paid;
      by.set(f.fundId, { ...cur, committed, paid, opportunities: cur.opportunities + f.opportunities,
        costAed: cur.aedRate ? paid / cur.aedRate : null, costUsd: cur.usdRate ? paid / cur.usdRate : null,
        deployment: committed ? (paid / committed) * 100 : 0,
        lastPayment: [cur.lastPayment, f.lastPayment].filter(Boolean).sort().pop() || null });
    });
    return [...by.values()].sort((a, b) => a.fundName.localeCompare(b.fundName));
  }, [data, company]);
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? rows.filter(r => `${r.fundName} ${r.fundCode} ${r.currency}`.toLowerCase().includes(s)) : rows;
  }, [rows, search]);

  const tot = useMemo(() => {
    const sum = (f: (r: VcFundRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    const committed = sum(r => r.committed); const paid = sum(r => r.paid);
    const curs = [...new Set(rows.map(r => r.currency).filter(Boolean))];
    // across currencies deployment is weighted in AED (paid AED / committed AED); one currency → plain paid / committed
    const commitAed = sum(r => (r.aedRate ? r.committed / r.aedRate : null));
    const costAed = sum(r => r.costAed);
    return {
      committed, paid, costAed, costUsd: sum(r => r.costUsd),
      opps: sum(r => r.opportunities), funds: rows.length,
      deployment: curs.length > 1 ? (commitAed ? (costAed / commitAed) * 100 : 0) : committed ? (paid / committed) * 100 : 0,
      currency: curs.length === 1 ? curs[0] : curs.length ? 'MIXED' : '',
      missingFx: rows.filter(r => r.paid && (r.costAed == null || r.costUsd == null)).map(r => r.currency),
    };
  }, [rows]);

  const fundColors = useMemo(() => colorMap(rows.map(r => String(r.fundId)), t), [rows, t]);
  const slices = useMemo<Slice[]>(() => {
    const own = rows.filter(r => (r.costAed ?? 0) > 0 && fundColors.get(String(r.fundId)) !== t.other)
      .map(r => ({ key: String(r.fundId), label: r.fundName, value: r.costAed ?? 0, color: fundColors.get(String(r.fundId))! }));
    const rest = rows.filter(r => fundColors.get(String(r.fundId)) === t.other).reduce((s, r) => s + (r.costAed ?? 0), 0);
    return rest > 0 ? [...own, { key: '__other', label: 'Other funds', value: rest, color: t.other }] : own;
  }, [rows, fundColors, t]);

  const oppsOf = useCallback((fundId: number) => (data?.opportunities || [])
    .filter(o => o.fundId === fundId && (company === 'ALL' || o.company === company))
    .sort((a, b) => b.committed - a.committed), [data, company]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visible.map(r => ({
      'Trust fund': r.fundName, 'Fund ID': r.fundId, Currency: r.currency, Opportunities: r.opportunities,
      'Total committed': r.committed, 'Total paid': r.paid, 'Value at cost': r.paid, 'Value at CMP': r.paid,
      'Cost AED': r.costAed, 'Cost USD': r.costUsd, 'CMP AED': r.costAed, 'CMP USD': r.costUsd, 'Deployment %': Number(r.deployment.toFixed(2)),
    }))), 'Trust funds');
    const opps = visible.flatMap(r => oppsOf(r.fundId).map(o => ({ 'Trust fund': r.fundName, Opportunity: o.code, Investee: o.investee, Company: o.company,
      Stage: o.stage, Status: o.status, Approval: o.approval, Currency: o.currency, Committed: o.committed, Paid: o.paid, 'Last payment': o.lastPayment })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opps), 'Opportunities');
    XLSX.writeFile(wb, `Venture_Capital_${company}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const columns: ColumnsType<VcFundRow> = [
    { title: 'Trust fund', key: 'fund', fixed: 'left', width: 240, sorter: (a, b) => a.fundName.localeCompare(b.fundName), render: (_, r) => (
      <div>
        <div style={{ fontWeight: 600, color: t.accent, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: fundColors.get(String(r.fundId)), flex: 'none' }} />{r.fundName}
        </div>
        <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>Fund ID : {r.fundId}{r.fundCode ? ` · ${r.fundCode}` : ''}</div>
      </div>) },
    { title: 'Currency', dataIndex: 'currency', width: 90, align: 'center', render: v => <Tag style={{ marginInlineEnd: 0, fontWeight: 600 }}>{v}</Tag> },
    { title: 'Opportunities', dataIndex: 'opportunities', width: 125, align: 'right', sorter: (a, b) => a.opportunities - b.opportunities },
    { title: 'Total committed', dataIndex: 'committed', width: 150, align: 'right', sorter: (a, b) => a.committed - b.committed, render: fmtAmt },
    { title: 'Total paid', dataIndex: 'paid', width: 150, align: 'right', sorter: (a, b) => a.paid - b.paid, render: v => <strong>{fmtAmt(v)}</strong> },
    { title: 'Value at cost', dataIndex: 'paid', key: 'vac', width: 140, align: 'right', render: fmtAmt },
    { title: 'Value at CMP', dataIndex: 'paid', key: 'vcmp', width: 140, align: 'right', render: fmtAmt },
    { title: 'Cost AED', dataIndex: 'costAed', width: 140, align: 'right', sorter: (a, b) => (a.costAed ?? 0) - (b.costAed ?? 0),
      render: (v, r) => (v == null && r.paid ? <Tooltip title={`No ${r.currency} → AED rate in BMSEXERATE`}><Tag color="warning">no rate</Tag></Tooltip> : fmtAmt(v)) },
    { title: 'Cost USD', dataIndex: 'costUsd', width: 140, align: 'right',
      render: (v, r) => (v == null && r.paid ? <Tooltip title={`No ${r.currency} → USD rate in BMSEXERATE`}><Tag color="warning">no rate</Tag></Tooltip> : fmtAmt(v)) },
    { title: 'CMP AED', dataIndex: 'costAed', key: 'cmpaed', width: 140, align: 'right', render: fmtAmt },
    { title: 'CMP USD', dataIndex: 'costUsd', key: 'cmpusd', width: 140, align: 'right', render: fmtAmt },
    { title: 'Deployment %', dataIndex: 'deployment', width: 150, sorter: (a, b) => a.deployment - b.deployment,
      render: (v, r) => <Deploy t={t} pct={v} color={fundColors.get(String(r.fundId))} /> },
  ];
  const oppColumns: ColumnsType<VcOpportunity> = [
    { title: 'Opportunity', key: 'o', width: 230, render: (_, o) => (<div><div style={{ fontWeight: 600 }}>{o.investee || o.code}</div>
      <div style={{ fontSize: 10, color: t.faint }}>{o.code}{company === 'ALL' ? ` · company ${o.company}` : ''}{o.initiated ? ` · ${o.initiated}` : ''}</div></div>) },
    { title: 'Route', dataIndex: 'route', width: 120, render: v => <Tag style={{ marginInlineEnd: 0 }}>{String(v).replace('_', ' ')}</Tag> },
    { title: 'Stage', dataIndex: 'stage', width: 120 },
    { title: 'Status', key: 's', width: 170, render: (_, o) => <Space size={4}>{o.status && <Tag style={{ marginInlineEnd: 0 }}>{o.status}</Tag>}
      {o.approval && <Tag color={/APPROV/i.test(o.approval) ? 'green' : /REJECT/i.test(o.approval) ? 'red' : 'gold'} style={{ marginInlineEnd: 0 }}>{o.approval}</Tag>}</Space> },
    { title: 'Committed', key: 'c', width: 150, align: 'right', render: (_, o) => `${curSym(o.currency)}${fmtAmt(o.committed)}` },
    { title: 'Paid', key: 'p', width: 150, align: 'right', render: (_, o) => <strong>{curSym(o.currency)}{fmtAmt(o.paid)}</strong> },
    { title: 'Payments', key: 'n', width: 130, align: 'right', render: (_, o) => (o.payments ? `${o.payments}${o.lastPayment ? ` · last ${o.lastPayment}` : ''}` : '—') },
    { title: 'Deployment', key: 'd', width: 140, render: (_, o) => <Deploy t={t} pct={o.committed ? (o.paid / o.committed) * 100 : 0} width={110} /> },
  ];

  const modulesMenu = { items: PMS_MODULES.map(m => ({ key: m.key, icon: m.icon, label: m.label })), onClick: ({ key }: { key: string }) => navigate(key) };

  return (
    <ConfigProvider theme={{
      algorithm: t.dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: { colorPrimary: t.accent, borderRadius: Math.min(t.radius - 4, 10), ...(t.dark ? { colorBgContainer: t.surface, colorBgElevated: '#18223b', colorBorder: t.line, colorBorderSecondary: t.line } : {}) },
    }}>
      <div style={{ background: t.bg, minHeight: '100%', padding: '12px 18px 28px', color: t.ink }}>
        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/" style={{ color: t.muted }}><HomeOutlined /> Home</Link> },
          { title: <Link to="/pms" style={{ color: t.muted }}>Portfolio Management System</Link> },
          { title: <span style={{ color: t.ink }}>Venture Capital</span> },
        ]} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: t.ink }}>Venture Capital</div>
            <div style={{ marginTop: 4, fontSize: 12, color: t.muted }}>
              Trust funds · commitments, paid-in capital and deployment{loadedAt && <> &nbsp;·&nbsp; refreshed {loadedAt.toLocaleTimeString()}</>}
            </div>
          </div>
          <Space wrap>
            <Select style={{ minWidth: 240 }} value={company} onChange={v => setParams(v === 'ALL' ? {} : { company: v })}
              options={[{ value: 'ALL', label: 'All companies' }, ...companies.map(c => ({ value: c, label: `${c} - ${nameOf(c)}` }))]} />
            <Segmented size="small" value={look} onChange={v => changeLook(v as Look)} options={[
              { value: 'aurora', label: <span><BgColorsOutlined /> Aurora</span> },
              { value: 'midnight', label: <span><MoonOutlined /> Midnight</span> },
              { value: 'classic', label: <span><LayoutOutlined /> Classic</span> },
            ]} />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Refresh</Button>
            <Dropdown menu={modulesMenu} trigger={['click']}><Button icon={<AppstoreOutlined />}>Modules</Button></Dropdown>
          </Space>
        </div>

        {error && (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Venture capital data could not be loaded" description={<>
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{error}</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>If the AI query gateway runs in whitelist mode, run <b>database/pms/pms_dashboard_acl.sql</b> (allows the VCAP_* tables and BMSEXERATE).</div>
          </>} />
        )}
        {tot.missingFx.length > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }}
            message={`No AED / USD rate in BMSEXERATE for ${[...new Set(tot.missingFx)].join(', ')} — those funds are left out of the AED / USD totals.`} />
        )}

        <Spin spinning={loading && !data}>
          {data && (rows.length === 0 ? <Empty description="No trust-fund commitments or payments" /> : (
            <>
              {/* slim hero strip */}
              <div style={{ background: t.heroBg, color: t.heroInk, borderRadius: t.radius, padding: '12px 20px', marginBottom: 16, position: 'relative', overflow: 'hidden',
                boxShadow: look === 'aurora' ? '0 10px 28px rgba(124,58,237,.22)' : t.shadow, border: look === 'midnight' ? `1px solid ${t.line}` : look === 'classic' ? `1px solid ${t.line}` : 'none',
                display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={labelStyle(t, true)}>Paid-in (cost)</span>
                  <span style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>AED {fmtM(tot.costAed)}</span>
                  <span style={{ alignSelf: 'center', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: look === 'classic' ? '#eef2f7' : 'rgba(255,255,255,.18)' }}>
                    {tot.deployment.toFixed(2)} % deployed
                  </span>
                  <span style={{ fontSize: 11, color: t.heroMuted }}>$ {fmtM(tot.costUsd)}</span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap' }}>
                  {([
                    [`Original cost${tot.currency ? ` · ${tot.currency}` : ''}`, tot.currency === 'MIXED' ? 'mixed currencies' : `${curSym(tot.currency)}${fmtOrig(tot.paid, tot.currency)}`],
                    [`Committed${tot.currency && tot.currency !== 'MIXED' ? ` · ${tot.currency}` : ''}`, tot.currency === 'MIXED' ? 'mixed currencies' : `${curSym(tot.currency)}${fmtOrig(tot.committed, tot.currency)}`],
                    ['Trust funds', String(tot.funds)], ['Opportunities', String(tot.opps)],
                  ] as const).map(([l, v], i) => (
                    <div key={l} style={{ padding: '2px 16px', borderLeft: i ? `1px solid ${look === 'aurora' ? 'rgba(255,255,255,.25)' : t.line}` : 'none' }}>
                      <div style={{ ...labelStyle(t, true), fontSize: 9 }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <Row gutter={[18, 18]} style={{ marginBottom: 18 }}>
                <Col xs={24} xl={13} style={{ display: 'flex' }}>
                  <div style={surfaceStyle(t, { padding: 18, flex: 1 })}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>Committed vs paid by fund</span>
                      <span style={{ fontSize: 11, color: t.muted }}>bar = paid ÷ committed, per fund</span>
                    </div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      {rows.map(r => (
                        <Tooltip key={r.fundId} title={`${r.fundName}: paid ${curSym(r.currency)}${fmtAmt(r.paid)} of ${curSym(r.currency)}${fmtAmt(r.committed)} committed (${r.deployment.toFixed(2)}%)`}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 2fr 150px', gap: 12, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fundName}</div>
                            <div style={{ position: 'relative', height: 14 }}>
                              <div style={{ position: 'absolute', inset: '3px 0', borderRadius: 4, background: t.dark ? '#1f2a47' : '#e8ebf2' }} />
                              <div style={{ position: 'absolute', top: 1, height: 12, width: `${Math.min(Math.max(r.deployment, 0), 100)}%`, minWidth: r.paid ? 3 : 0, borderRadius: 4, background: fundColors.get(String(r.fundId)) }} />
                            </div>
                            <div style={{ fontSize: 11, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{r.deployment.toFixed(1)}%</strong>
                              <div style={{ color: t.muted, fontSize: 10 }}>{curSym(r.currency)}{fmtOrig(r.paid, r.currency)} / {fmtOrig(r.committed, r.currency)}</div>
                            </div>
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </Col>
                <Col xs={24} xl={11} style={{ display: 'flex' }}>
                  <div style={surfaceStyle(t, { padding: 18, flex: 1 })}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>Paid-in by fund</span>
                      <span style={{ fontSize: 11, color: t.muted }}>cost · AED</span>
                    </div>
                    {slices.length ? <Donut slices={slices} t={t} centerTop="PAID-IN AED" centerValue={fmtM(tot.costAed)} /> : <Empty description="No payments yet" />}
                  </div>
                </Col>
              </Row>

              <div style={surfaceStyle(t, { padding: 10, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' })}>
                <span style={{ fontSize: 13, color: t.ink, padding: '0 6px' }}>
                  Company : <strong style={{ color: t.accent }}>{company === 'ALL' ? 'All companies' : `${company} - ${nameOf(company)}`}</strong>
                  &nbsp;&nbsp; Trust Funds : <strong style={{ color: t.accent }}>{tot.funds}</strong>
                  &nbsp;&nbsp; Investment Opportunities : <strong style={{ color: t.accent }}>{tot.opps}</strong>
                </span>
                <Input allowClear prefix={<SearchOutlined />} placeholder="Search fund…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, marginLeft: 'auto', maxWidth: 320 }} />
                <Button icon={<DownloadOutlined />} onClick={exportExcel}>Excel</Button>
              </div>

              <Table<VcFundRow> size="small" rowKey="fundId" columns={columns} dataSource={visible} pagination={false} scroll={{ x: 1850 }} sticky
                style={surfaceStyle(t, { overflow: 'hidden' })}
                expandable={{
                  rowExpandable: r => oppsOf(r.fundId).length > 0,
                  expandedRowRender: r => (
                    <Table<VcOpportunity> size="small" rowKey="id" columns={oppColumns} dataSource={oppsOf(r.fundId)} pagination={false} scroll={{ x: 1200 }} />
                  ),
                }}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ fontWeight: 700 }}>
                      <Table.Summary.Cell index={0} />
                      <Table.Summary.Cell index={1}><strong>TOTAL</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} />
                      <Table.Summary.Cell index={3} align="right"><strong>{tot.opps}</strong></Table.Summary.Cell>
                      {tot.currency === 'MIXED'
                        ? <Table.Summary.Cell index={4} colSpan={4} align="right"><span style={{ color: t.muted, fontWeight: 400 }}>mixed currencies — see AED / USD</span></Table.Summary.Cell>
                        : <>
                          <Table.Summary.Cell index={4} align="right"><strong>{fmtAmt(tot.committed)}</strong></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="right"><strong>{fmtAmt(tot.paid)}</strong></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="right"><strong>{fmtAmt(tot.paid)}</strong></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="right"><strong>{fmtAmt(tot.paid)}</strong></Table.Summary.Cell>
                        </>}
                      <Table.Summary.Cell index={8} align="right"><strong>{fmtAmt(tot.costAed)}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={9} align="right"><strong>{fmtAmt(tot.costUsd)}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={10} align="right"><strong>{fmtAmt(tot.costAed)}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={11} align="right"><strong>{fmtAmt(tot.costUsd)}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={12}>
                        <Tooltip title={tot.currency === 'MIXED' ? 'Weighted in AED: paid AED ÷ committed AED' : 'Paid ÷ committed'}><strong>{tot.deployment.toFixed(2)} %</strong></Tooltip>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )} />
              <div style={{ fontSize: 11, color: t.muted, marginTop: 8 }}>
                Paid = completed payments against the funds' drawdown notices. Value at CMP equals value at cost (unlisted investments, as in the APEX dashboard). Expand a fund to see its opportunities.
              </div>
            </>
          ))}
        </Spin>
      </div>
    </ConfigProvider>
  );
};

export default VentureCapital;
