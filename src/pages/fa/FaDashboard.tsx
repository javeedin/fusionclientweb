// Fixed Assets dashboard (top of the FA page): what the assets cost and are worth now, how far depreciated they are,
// depreciation per period (and how much of it is accounted), retirements, and what needs attention.
// Every figure is direct SQL through the read gateway — see faDashboard.service.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Modal, Row, Skeleton, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, CopyOutlined, ExclamationCircleOutlined,
  MinusCircleOutlined, PlusCircleOutlined, ReloadOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  FA_CCY, LIFE, loadFaAssets, loadFaDashboard, periodOf,
  type AssetFilter, type FaAsset, type FaData,
} from '../../services/faDashboard.service';

const { Text } = Typography;

// ink + chart tokens (validated: ordinal blue ramp and the two-shade pair on the white card surface)
const INK = { primary: '#1f1f1f', secondary: '#595959', muted: '#8c8c8c', hairline: '#f0f0f0' };
const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];   // little used → fully depreciated
const DEEMPHASIS = '#c3c2b7', ACCENT = '#2a78d6';
const LIGHT = '#86b6ef', DARK = '#1c5cab';                                // depreciated / NBV · not accounted / accounted
const STATUS = { critical: '#d03b3b', warning: '#d48806', good: '#0ca30c' };

const money = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${money(v / 1e6, 2)}M` : Math.abs(v) >= 1e3 ? `${money(v / 1e3, 1)}K` : money(v, 0));
const card: React.CSSProperties = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 20, height: '100%', boxSizing: 'border-box' };
const clickable = (on: boolean): React.CSSProperties => (on ? { cursor: 'pointer' } : {});
const swatch = (c: string) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 4, verticalAlign: -1 }} />;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

const FaDashboard: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<FaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<{ title: string; rows: FaAsset[] | null } | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadFaDashboard()); }
    catch (e) { message.error(`Fixed Assets dashboard: ${e instanceof Error ? e.message : e}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const show = async (title: string, f: AssetFilter) => {
    setList({ title, rows: null });
    try { setList({ title, rows: await loadFaAssets(f) }); }
    catch (e) { setList(null); message.error(e instanceof Error ? e.message : String(e)); }
  };

  if (loading && !data) {
    return <div style={{ marginBottom: 32 }}><Row gutter={[16, 16]}>{[9, 5, 5, 5].map((w, i) => (
      <Col key={i} xs={24} sm={12} lg={w}><div style={card}><Skeleton active paragraph={{ rows: 2 }} /></div></Col>))}</Row></div>;
  }
  if (!data) return null;

  const pctUsed = data.cost ? Math.round((data.reserve / data.cost) * 100) : 0;
  const thisPeriod = periodOf(new Date());
  const last = data.periods[data.periods.length - 1];
  const runThisMonth = !!last && last.period.toLowerCase() === thisPeriod.toLowerCase();
  const notAccountedDeprn = data.periods.reduce((t, p) => t + Math.max(0, p.amount - p.accounted), 0);
  const maxCat = Math.max(1, ...data.categories.map(c => c.cost));
  const maxLife = Math.max(1, ...data.life.map(l => l.assets));
  const maxPeriod = Math.max(1, ...data.periods.map(p => p.amount));
  const gl = data.retirements.ytdGainLoss;
  const attention = [
    { key: 'na', label: 'Additions not accounted', count: data.notAccounted, hint: 'in service, no addition journal yet', icon: <ExclamationCircleOutlined style={{ color: STATUS.warning }} />,
      go: () => show('Assets not accounted', 'NOT_ACCOUNTED') },
    { key: 'deprn', label: 'Depreciation not accounted', count: notAccountedDeprn > 0.005 ? data.periods.filter(p => p.amount - p.accounted > 0.005).length : 0,
      hint: `${FA_CCY} ${money(notAccountedDeprn)} across ${data.periods.filter(p => p.amount - p.accounted > 0.005).map(p => p.period).slice(-3).join(', ')}`,
      icon: <ExclamationCircleOutlined style={{ color: STATUS.warning }} />, go: () => onNavigate('/fa/depreciation') },
    { key: 'nodep', label: 'Not depreciating', count: data.noDeprn, hint: 'in service over a month, no depreciation recorded', icon: <WarningOutlined style={{ color: STATUS.warning }} />,
      go: () => show('In service, not depreciating', 'NO_DEPRN') },
    { key: 'drafts', label: 'Retirements in draft', count: data.retirements.drafts, hint: 'created, not processed / accounted', icon: <ClockCircleOutlined style={{ color: STATUS.warning }} />,
      go: () => onNavigate('/fa/retirements') },
    { key: 'full', label: 'Fully depreciated, still in service', count: data.fullyReserved, hint: 'nothing left to depreciate — review or retire', icon: <MinusCircleOutlined style={{ color: INK.muted }} />,
      go: () => show('Fully depreciated, in service', 'FULL') },
  ];

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: INK.muted }}>Live from the database{data.book ? ` · ${data.book}` : ''} · as of {data.asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        <Tooltip title="Refresh"><Button size="small" type="text" icon={<ReloadOutlined spin={loading} />} onClick={load} /></Tooltip>
        <Tooltip title="The SQL behind every figure"><Button size="small" type="text" icon={<CodeOutlined />} onClick={() => setSqlOpen(true)}>SQL</Button></Tooltip>
      </div>
      {data.errors.length > 0 && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Some figures could not be read"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{data.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>} />
      )}

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={9}>
          <div style={{ ...card, ...clickable(data.active > 0) }} onClick={() => data.active && show('Assets in service', 'ACTIVE')}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>Net book value · {plural(data.active, 'asset')} in service</Text>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '6px 0 4px' }}>
              <span style={{ fontSize: 15, color: INK.secondary }}>{FA_CCY}</span>
              <span style={{ fontSize: 'clamp(30px, 3.2vw, 44px)', fontWeight: 600, color: INK.primary, lineHeight: 1.15 }}>{money(data.nbv)}</span>
            </div>
            <Text style={{ fontSize: 13, color: INK.secondary }}>cost {money(data.cost)} · depreciated {money(data.reserve)}</Text>
            {data.cost > 0 && <>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, margin: '12px 0 6px' }}>
                {pctUsed > 0 && <div style={{ width: `${pctUsed}%`, background: LIGHT }} />}
                <div style={{ width: `${100 - pctUsed}%`, background: DARK }} />
              </div>
              <Space size={14} style={{ fontSize: 12, color: INK.secondary }}>
                <span>{swatch(LIGHT)}Depreciated {pctUsed}%</span>
                <span>{swatch(DARK)}Net book value {100 - pctUsed}%</span>
              </Space>
            </>}
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(true) }} onClick={() => onNavigate(runThisMonth ? '/fa/depreciation' : '/fa/calculate-deprn')}>
            <Space size={6}>{runThisMonth ? <CheckCircleOutlined style={{ color: STATUS.good }} /> : <CalendarOutlined style={{ color: STATUS.warning }} />}
              <Text style={{ fontSize: 13, color: INK.secondary }}>Depreciation {last ? last.period : ''}</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{last ? compact(last.amount) : '—'}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              {!last ? 'no depreciation run yet' : runThisMonth ? `${plural(last.assets, 'asset')} · run for this month` : <>{thisPeriod} <b>not run yet</b> — Calculate Depreciation</>}
            </Text>
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(data.addedYtd > 0) }} onClick={() => data.addedYtd && show(`Added in ${new Date().getFullYear()}`, 'ADDED_YTD')}>
            <Space size={6}><PlusCircleOutlined style={{ color: ACCENT }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Added this year</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{compact(data.addedYtdCost)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>{plural(data.addedYtd, 'asset')} · {FA_CCY} cost</Text>
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(true) }} onClick={() => onNavigate('/fa/retirements')}>
            <Space size={6}><MinusCircleOutlined style={{ color: INK.muted }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Retired this year</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{data.retirements.ytd.toLocaleString()}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              cost {compact(data.retirements.ytdCost)}{data.retirements.ytd ? <> · {gl >= 0 ? 'gain' : 'loss'} {compact(Math.abs(gl))}</> : null}
            </Text>
          </div>
        </Col>
      </Row>

      {/* ── by category + how depreciated ──────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={13}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>By category</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}><span>{swatch(DARK)}Net book value</span><span>{swatch(LIGHT)}Depreciated</span></Space>
            </div>
            {data.categories.length === 0 && <Text type="secondary">No assets in service</Text>}
            {data.categories.map(c => (
              <Tooltip key={c.category} placement="topLeft" title={`${c.category}: ${plural(c.assets, 'asset')} · cost ${FA_CCY} ${money(c.cost)} · depreciated ${money(c.reserve)} · NBV ${money(c.cost - c.reserve)}`}>
                <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 120px', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}
                  onClick={() => show(`${c.category} — in service`, `CAT:${c.category}`)}>
                  <Text ellipsis style={{ fontSize: 12, color: INK.secondary }}>{c.category}</Text>
                  <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden', display: 'flex', gap: 2 }}>
                    {c.cost - c.reserve > 0 && <div style={{ width: `${((c.cost - c.reserve) / maxCat) * 100}%`, background: DARK, minWidth: 3 }} />}
                    {c.reserve > 0 && <div style={{ width: `${(c.reserve / maxCat) * 100}%`, background: LIGHT, minWidth: 3, borderRadius: '0 4px 4px 0' }} />}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text style={{ fontSize: 12, color: INK.primary, fontVariantNumeric: 'tabular-nums' }}>{compact(c.cost - c.reserve)}</Text>
                    <Text style={{ fontSize: 11, color: INK.muted, marginLeft: 6 }}>{c.assets}</Text>
                  </div>
                </div>
              </Tooltip>
            ))}
          </div>
        </Col>
        <Col xs={24} lg={11}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>How depreciated they are</Text>
              <Text style={{ fontSize: 11, color: INK.muted }}>assets in service · click for the list</Text>
            </div>
            {data.life.map((l, k) => (
              <Tooltip key={l.key} placement="topLeft" title={`${l.label}: ${plural(l.assets, 'asset')} · cost ${FA_CCY} ${money(l.cost)} · NBV ${money(l.nbv)}`}>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px', alignItems: 'center', gap: 10, padding: '6px 0', ...clickable(l.assets > 0) }}
                  onClick={() => l.assets && show(`${LIFE[k].label}`, `LIFE:${l.key}`)}>
                  <Text style={{ fontSize: 12, color: INK.secondary }}>{l.label}</Text>
                  <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(l.assets / maxLife) * 100}%`, height: '100%', minWidth: l.assets ? 3 : 0, background: RAMP[k], borderRadius: '0 4px 4px 0' }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text style={{ fontSize: 12, color: INK.primary, fontVariantNumeric: 'tabular-nums' }}>{l.assets}</Text>
                    <Text style={{ fontSize: 11, color: INK.muted, marginLeft: 6 }}>{compact(l.nbv)}</Text>
                  </div>
                </div>
              </Tooltip>
            ))}
          </div>
        </Col>
      </Row>

      {/* ── depreciation per period + attention ─────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>Depreciation per period</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}><span>{swatch(DARK)}Accounted</span><span>{swatch(LIGHT)}Not accounted</span><span style={{ color: INK.muted }}>{FA_CCY}</span></Space>
            </div>
            {data.periods.length === 0 ? <Text type="secondary">No depreciation run yet</Text> : <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, padding: '0 4px', borderBottom: `1px solid ${DEEMPHASIS}` }}>
                {data.periods.map(p => {
                  const h = (v: number) => `${(v / maxPeriod) * 120}px`;
                  const open = Math.max(0, p.amount - p.accounted);
                  return (
                    <Tooltip key={p.period} title={`${p.period}: ${FA_CCY} ${money(p.amount)} · ${plural(p.assets, 'asset')} · accounted ${money(p.accounted)}${open > 0.005 ? ` · not accounted ${money(open)}` : ''}`}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', cursor: 'pointer' }} onClick={() => onNavigate('/fa/depreciation')}>
                        {open > 0.005 && <div style={{ height: h(open), background: LIGHT, borderRadius: '4px 4px 0 0', marginBottom: p.accounted ? 2 : 0 }} />}
                        {p.accounted > 0 && <div style={{ height: h(p.accounted), background: DARK, borderRadius: open > 0.005 ? 0 : '4px 4px 0 0' }} />}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '4px 4px 0' }}>
                {data.periods.map(p => <Text key={p.period} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: INK.muted }}>{p.period}</Text>)}
              </div>
            </>}
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div style={card}>
            <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 8 }}>Needs attention</Text>
            {attention.map(a => (
              <div key={a.key} onClick={() => a.count && a.go()}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${INK.hairline}`, ...clickable(a.count > 0) }}>
                {a.count ? a.icon : <CheckCircleOutlined style={{ color: STATUS.good }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: INK.primary }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: INK.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.count ? a.hint : 'none'}</div>
                </div>
                <Text style={{ fontSize: 16, fontWeight: 600, color: a.count ? INK.primary : INK.muted, fontVariantNumeric: 'tabular-nums' }}>{a.count.toLocaleString()}</Text>
              </div>
            ))}
          </div>
        </Col>
      </Row>

      {data.recent.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 15 }}>Latest additions</Text>
            <Space><a style={{ fontSize: 12 }} onClick={() => onNavigate('/fa/assets')}>Asset Workbench</a><a style={{ fontSize: 12 }} onClick={() => onNavigate('/fa/create-asset')}>Add asset</a></Space>
          </div>
          <AssetTable rows={data.recent} compact onOpen={a => onNavigate(`/fa/assets?assetNumber=${encodeURIComponent(a.number)}`)} />
        </div>
      )}

      <Modal open={!!list} onCancel={() => setList(null)} width={1100} destroyOnHidden title={list?.title} footer={<Button onClick={() => setList(null)}>Close</Button>}>
        <AssetTable rows={list?.rows ?? []} loading={!list?.rows} onOpen={a => { setList(null); onNavigate(`/fa/assets?assetNumber=${encodeURIComponent(a.number)}`); }} />
      </Modal>

      <Modal open={sqlOpen} onCancel={() => setSqlOpen(false)} width={960} footer={<Button onClick={() => setSqlOpen(false)}>Close</Button>}
        title={<Space><CodeOutlined />SQL behind the dashboard<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>POST ai/executequery</Text></Space>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
          Book row = the asset's active RR_FA_BOOKS row. Depreciated = DEPRN_RESERVE of its latest depreciation period; NBV = cost − that.
          Retired = RETIRED_FLAG YES or the book row made ineffective. Fully depreciated = reserve ≥ cost − salvage value.
        </Text>
        {data.queries.map(q => (
          <div key={q.label} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text strong style={{ fontSize: 13 }}>{q.label}</Text>
              <Button size="small" icon={<CopyOutlined />} onClick={() => navigator.clipboard?.writeText(q.sql).then(() => message.success('Copied'))}>Copy</Button>
            </div>
            <pre style={{ margin: 0, background: '#1f1f1f', color: '#d4d4d4', padding: 10, borderRadius: 6, fontSize: 11, maxHeight: 260, overflow: 'auto' }}>{q.sql}</pre>
          </div>
        ))}
      </Modal>
    </div>
  );
};

const AssetTable: React.FC<{ rows: FaAsset[]; onOpen: (a: FaAsset) => void; compact?: boolean; loading?: boolean }> = ({ rows, onOpen, compact: small, loading }) => (
  <Table<FaAsset> size="small" rowKey="id" loading={loading} dataSource={rows}
    pagination={small ? false : { pageSize: 12, showSizeChanger: false, showTotal: t => `${t} asset${t === 1 ? '' : 's'}${t >= 500 ? ' (first 500)' : ''}` }}
    onRow={r => ({ onClick: () => onOpen(r), style: { cursor: 'pointer' } })}
    summary={small ? undefined : list => (
      <Table.Summary.Row style={{ background: '#fafafa' }}>
        <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total ({list.length})</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={3} align="right"><Text strong>{money(list.reduce((t, r) => t + r.cost, 0))}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={4} align="right"><Text strong>{money(list.reduce((t, r) => t + r.reserve, 0))}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={5} align="right"><Text strong>{money(list.reduce((t, r) => t + r.nbv, 0))}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={6} colSpan={3} />
      </Table.Summary.Row>
    )}
    columns={[
      { title: 'Asset', dataIndex: 'number', width: 120, render: (v: string) => <a>{v}</a> },
      { title: 'Description', dataIndex: 'description', ellipsis: true },
      { title: 'Category', dataIndex: 'category', width: 180, ellipsis: true },
      { title: `Cost ${FA_CCY}`, dataIndex: 'cost', width: 130, align: 'right' as const, sorter: (a: FaAsset, b: FaAsset) => a.cost - b.cost, render: (v: number) => money(v) },
      { title: 'Depreciated', dataIndex: 'reserve', width: 120, align: 'right' as const, render: (v: number) => money(v) },
      { title: 'NBV', dataIndex: 'nbv', width: 120, align: 'right' as const, sorter: (a: FaAsset, b: FaAsset) => a.nbv - b.nbv, render: (v: number) => money(v) },
      { title: 'In service', dataIndex: 'dpis', width: 100 },
      { title: 'Last period', dataIndex: 'lastPeriod', width: 90, render: (v: string) => v || <Text type="secondary">—</Text> },
      { title: 'Accounted', key: 'acc', width: 110, render: (_: unknown, r: FaAsset) => (r.retired
        ? <Tag style={{ margin: 0 }}>Retired</Tag>
        : r.accounted ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Yes</Tag>
          : <Tag color="warning" icon={<ExclamationCircleOutlined />} style={{ margin: 0 }}>No</Tag>) },
    ]} />
);

export default FaDashboard;
