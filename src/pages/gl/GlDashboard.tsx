// General Ledger dashboard (top of the GL page) — focused on journals that are not posted, PMS journals first.
// Every figure is direct SQL through the read gateway; see glDashboard.service for the queries and the rules.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Input, Modal, Row, Segmented, Skeleton, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, CopyOutlined, ExclamationCircleOutlined,
  ReloadOutlined, SearchOutlined, StopOutlined,
} from '@ant-design/icons';
import JournalFullPreview from '../../components/JournalFullPreview';
import { AGES, inAge, isPmsCategory, loadGlDashboard, pmsKind, summarizeGl, type GlData, type GlJournal } from '../../services/glDashboard.service';

const { Text } = Typography;

// ink + chart tokens (validated: ordinal blue ramp on the white card surface)
const INK = { primary: '#1f1f1f', secondary: '#595959', muted: '#8c8c8c', hairline: '#f0f0f0' };
const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];   // created today → over 90 days
const ACCENT = '#2a78d6', DEEMPHASIS = '#c3c2b7';
const POSTED_C = '#86b6ef', NOT_POSTED_C = '#1c5cab';
const STATUS = { critical: '#d03b3b', warning: '#d48806', good: '#0ca30c' };

const money = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const card: React.CSSProperties = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 20, height: '100%', boxSizing: 'border-box' };
const clickable = (on: boolean): React.CSSProperties => (on ? { cursor: 'pointer' } : {});
const MODE_KEY = 'gl.dashboard.mode';

const GlDashboard: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<GlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'PMS' | 'ALL'>(() => { try { return localStorage.getItem(MODE_KEY) === 'ALL' ? 'ALL' : 'PMS'; } catch { return 'PMS'; } });
  const [list, setList] = useState<{ title: string; rows: GlJournal[] } | null>(null);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<GlJournal | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadGlDashboard()); }
    catch (e) { message.error(`GL dashboard: ${e instanceof Error ? e.message : e}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const changeMode = (m: 'PMS' | 'ALL') => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* per-viewer convenience */ } };

  const s = useMemo(() => (data ? summarizeGl(data.journals, data.periods, data.open, mode === 'PMS') : null), [data, mode]);
  const show = (title: string, rows: GlJournal[]) => { setSearch(''); setList({ title, rows }); };

  if (loading && !data) {
    return <div style={{ marginBottom: 32 }}><Row gutter={[16, 16]}>{[9, 5, 5, 5].map((w, i) => (
      <Col key={i} xs={24} sm={12} lg={w}><div style={card}><Skeleton active paragraph={{ rows: 2 }} /></div></Col>))}</Row></div>;
  }
  if (!s || !data) return null;

  const scope = mode === 'PMS' ? 'PMS journals' : 'journals';
  const slices = mode === 'PMS' ? s.byKind : s.byCategory.slice(0, 8);
  const maxSlice = Math.max(1, ...slices.map(x => x.count));
  const maxAge = Math.max(1, ...s.ages.map(b => b.count));
  const maxMonth = Math.max(1, ...s.months.map(m => m.posted + m.notPosted));
  const pct = s.currentTotal ? Math.round((s.currentPosted / s.currentTotal) * 100) : 0;
  const oldestFirst = [...s.notPosted].sort((a, b) => b.ageDays - a.ageDays);

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Segmented value={mode} onChange={v => changeMode(v as 'PMS' | 'ALL')}
          options={[{ value: 'PMS', label: 'PMS journals' }, { value: 'ALL', label: 'All journals' }]} />
        <Space size={8}>
          <Text style={{ fontSize: 12, color: INK.muted }}>Live from the database · as of {data.asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          <Tooltip title="Refresh"><Button size="small" type="text" icon={<ReloadOutlined spin={loading} />} onClick={load} /></Tooltip>
          <Tooltip title="The SQL behind every figure"><Button size="small" type="text" icon={<CodeOutlined />} onClick={() => setSqlOpen(true)}>SQL</Button></Tooltip>
        </Space>
      </div>
      {data.errors.length > 0 && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Some figures could not be read"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{data.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>} />
      )}

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={9}>
          <div style={{ ...card, ...clickable(s.count > 0) }} onClick={() => s.count && show(`${scope[0].toUpperCase()}${scope.slice(1)} not posted`, oldestFirst)}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>{mode === 'PMS' ? 'PMS journals not posted' : 'Journals not posted'}</Text>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', margin: '6px 0 4px' }}>
              <span style={{ fontSize: 'clamp(34px, 3.4vw, 48px)', fontWeight: 600, color: INK.primary, lineHeight: 1.15 }}>{s.count.toLocaleString()}</span>
              <span style={{ fontSize: 15, color: INK.secondary }}>AED {money(s.aed)} Dr</span>
            </div>
            <Text style={{ fontSize: 13, color: INK.secondary }}>
              {s.count > 0 ? <>oldest created {s.oldestDays} days ago</> : <><CheckCircleOutlined style={{ color: STATUS.good }} /> everything is posted</>}
            </Text>
            {s.byStatus.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.byStatus.map(x => <Tag key={x.status} style={{ margin: 0 }}>{x.status} <b>{x.count}</b></Tag>)}
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(s.blocked.length > 0) }}
            onClick={() => s.blocked.length && show('Not posted — their period is not open', s.blocked)}>
            <Space size={6}>
              {s.blocked.length ? <StopOutlined style={{ color: STATUS.critical }} /> : <CheckCircleOutlined style={{ color: STATUS.good }} />}
              <Text style={{ fontSize: 13, color: INK.secondary }}>Can't post — period not open</Text>
            </Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{s.blocked.length.toLocaleString()}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              {s.blocked.length
                ? <>periods {[...new Set(s.blocked.map(j => j.period))].slice(0, 4).join(', ')} — open them in Accounting Periods</>
                : <>every {mode === 'PMS' ? 'PMS ' : ''}journal waiting is in an open period</>}
            </Text>
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={card}>
            <Space size={6}><ClockCircleOutlined style={{ color: STATUS.warning }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Posted in {s.currentPeriod}</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>
              {s.currentPosted.toLocaleString()} <span style={{ fontSize: 15, fontWeight: 400, color: INK.secondary }}>of {s.currentTotal.toLocaleString()}</span>
            </div>
            {/* meter: same-hue track */}
            <div style={{ height: 8, background: '#cde2fb', borderRadius: 4, overflow: 'hidden', margin: '6px 0' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: ACCENT, borderRadius: '0 4px 4px 0' }} />
            </div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>{pct}% of the period's {scope} posted</Text>
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(true) }} onClick={() => onNavigate('/gl/accounting-periods')}>
            <Space size={6}><CalendarOutlined style={{ color: ACCENT }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Open GL periods</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{s.openPeriods.length}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {s.openPeriods.slice(0, 6).map(p => <Tag key={p} style={{ margin: 0 }}>{p}</Tag>)}
              {s.openPeriods.length === 0 && <Text style={{ fontSize: 12, color: INK.secondary }}>none — nothing can be posted</Text>}
            </div>
          </div>
        </Col>
      </Row>

      {/* ── by type / category + by age ────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>{mode === 'PMS' ? 'PMS journals not posted, by type' : 'Not posted, by category'}</Text>
              <Text style={{ fontSize: 11, color: INK.muted }}>{mode === 'ALL' ? 'PMS categories highlighted · ' : ''}click a bar for the journals</Text>
            </div>
            {slices.length === 0 && <Text type="secondary">Nothing waiting</Text>}
            {slices.map(x => {
              const rows = s.notPosted.filter(j => (mode === 'PMS' ? pmsKind(j.category) === x.name : j.category === x.name));
              return (
                <Tooltip key={x.name} placement="topLeft" title={`${mode === 'PMS' ? `PMS ${x.name} Journals` : x.name}: ${plural(x.count, 'journal')} · AED ${money(x.aed)}`}>
                  <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 150px', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}
                    onClick={() => show(`${mode === 'PMS' ? `PMS ${x.name} Journals` : x.name} — not posted`, rows.sort((a, b) => b.ageDays - a.ageDays))}>
                    <Text ellipsis style={{ fontSize: 12, color: INK.secondary }}>{mode === 'PMS' ? x.name : x.name}</Text>
                    <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(x.count / maxSlice) * 100}%`, height: '100%', minWidth: 3,
                        background: mode === 'PMS' || x.pms ? ACCENT : DEEMPHASIS, borderRadius: '0 4px 4px 0' }} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text style={{ fontSize: 12, color: INK.primary, fontVariantNumeric: 'tabular-nums' }}>{x.count}</Text>
                      <Text style={{ fontSize: 11, color: INK.muted, marginLeft: 6 }}>AED {money(x.aed, 0)}</Text>
                    </div>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </Col>

        <Col xs={24} lg={12}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>How long they have waited</Text>
              <Text style={{ fontSize: 11, color: INK.muted }}>days since created · click a bar for the journals</Text>
            </div>
            {s.ages.map((b, k) => (
              <Tooltip key={b.key} placement="topLeft" title={`${b.label}: ${plural(b.count, 'journal')} · AED ${money(b.aed)}`}>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 150px', alignItems: 'center', gap: 10, padding: '6px 0', ...clickable(b.count > 0) }}
                  onClick={() => b.count && show(`Not posted — ${b.label.toLowerCase()}`, s.notPosted.filter(j => inAge(AGES[k], j)).sort((x, y) => y.ageDays - x.ageDays))}>
                  <Text style={{ fontSize: 12, color: INK.secondary }}>{b.label}</Text>
                  <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(b.count / maxAge) * 100}%`, height: '100%', minWidth: b.count ? 3 : 0, background: RAMP[k], borderRadius: '0 4px 4px 0' }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text style={{ fontSize: 12, color: INK.primary, fontVariantNumeric: 'tabular-nums' }}>{b.count}</Text>
                    <Text style={{ fontSize: 11, color: INK.muted, marginLeft: 6 }}>AED {money(b.aed, 0)}</Text>
                  </div>
                </div>
              </Tooltip>
            ))}
          </div>
        </Col>
      </Row>

      {/* ── last 6 periods + oldest waiting ───────────────────────────── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>{mode === 'PMS' ? 'PMS journals' : 'Journals'} per period</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: NOT_POSTED_C, marginRight: 4, verticalAlign: -1 }} />Not posted</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: POSTED_C, marginRight: 4, verticalAlign: -1 }} />Posted</span>
              </Space>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150, padding: '0 4px', borderBottom: '1px solid #c3c2b7' }}>
              {s.months.map(m => {
                const h = (v: number) => `${(v / maxMonth) * 120}px`;
                return (
                  <Tooltip key={m.month} title={`${m.period}: ${m.posted} posted · ${m.notPosted} not posted`}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-end', height: '100%', gap: 0 }}>
                      {m.notPosted > 0 && <Text style={{ fontSize: 10, color: INK.secondary, textAlign: 'center' }}>{m.notPosted}</Text>}
                      {m.notPosted > 0 && <div style={{ height: h(m.notPosted), background: NOT_POSTED_C, borderRadius: '4px 4px 0 0', marginBottom: m.posted ? 2 : 0 }} />}
                      {m.posted > 0 && <div style={{ height: h(m.posted), background: POSTED_C, borderRadius: m.notPosted ? 0 : '4px 4px 0 0' }} />}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '4px 4px 0' }}>
              {s.months.map(m => <Text key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: INK.muted }}>{m.period}</Text>)}
            </div>
          </div>
        </Col>

        <Col xs={24} lg={14}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 15 }}>Waiting longest</Text>
              <Space>
                {s.count > 6 && <a style={{ fontSize: 12 }} onClick={() => show(`${scope[0].toUpperCase()}${scope.slice(1)} not posted`, oldestFirst)}>All {s.count}</a>}
                <a style={{ fontSize: 12 }} onClick={() => onNavigate('/gl/manage-journals')}>Manage Journals</a>
              </Space>
            </div>
            <JournalTable rows={oldestFirst.slice(0, 6)} compact onOpen={setPreview} />
          </div>
        </Col>
      </Row>

      <Modal open={!!list} onCancel={() => setList(null)} width={1100} destroyOnHidden title={list?.title}
        footer={<Space><Button onClick={() => { setList(null); onNavigate('/gl/manage-journals'); }}>Open Manage Journals</Button><Button type="primary" onClick={() => setList(null)}>Close</Button></Space>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search batch, journal, category, created by" value={search}
          onChange={e => setSearch(e.target.value)} style={{ maxWidth: 340, marginBottom: 12 }} />
        {list && <JournalTable rows={list.rows.filter(j => !search || [j.batchName, j.journalName, j.category, j.createdBy, j.period]
          .some(v => v.toLowerCase().includes(search.toLowerCase())))} onOpen={setPreview} />}
      </Modal>

      <JournalFullPreview open={!!preview} jeHeaderId={preview?.headerId ?? null} batchId={preview?.batchId ?? null} onClose={() => setPreview(null)} />

      <Modal open={sqlOpen} onCancel={() => setSqlOpen(false)} width={960} footer={<Button onClick={() => setSqlOpen(false)}>Close</Button>}
        title={<Space><CodeOutlined />SQL behind the dashboard<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>POST ai/executequery</Text></Space>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
          PMS journals = category starting with “PMS” (PMS FD / Loan / Stock Journals). Posted = batch STATUS 'P' / Posted, or header Posted.
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

const JournalTable: React.FC<{ rows: GlJournal[]; onOpen: (j: GlJournal) => void; compact?: boolean }> = ({ rows, onOpen, compact }) => (
  <Table<GlJournal> size="small" rowKey="headerId" dataSource={rows}
    pagination={compact ? false : { pageSize: 12, showSizeChanger: false, showTotal: t => `${t} journals` }}
    onRow={r => ({ onClick: () => onOpen(r), style: { cursor: 'pointer' } })}
    locale={{ emptyText: 'Nothing waiting' }}
    summary={compact ? undefined : () => (
      <Table.Summary.Row style={{ background: '#fafafa' }}>
        <Table.Summary.Cell index={0} colSpan={4}><Text strong>Total ({rows.length})</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={4} align="right"><Text strong>{money(rows.reduce((t, r) => t + r.accountedDr, 0))}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={5} colSpan={3} />
      </Table.Summary.Row>
    )}
    columns={[
      { title: 'Batch / journal', key: 'b', ellipsis: true, render: (_: unknown, r) => (
        <div style={{ minWidth: 0 }}>
          <a style={{ fontSize: 12 }}>{r.batchName || r.journalName || `#${r.headerId}`}</a>
          {!compact && r.journalName && r.journalName !== r.batchName && <div style={{ fontSize: 11, color: INK.muted }}>{r.journalName}</div>}
        </div>) },
      { title: 'Category', dataIndex: 'category', width: compact ? 150 : 170, ellipsis: true,
        render: (v: string) => (isPmsCategory(v) ? <Tag color="blue" style={{ margin: 0 }}>{v}</Tag> : v) },
      { title: 'Period', dataIndex: 'period', width: 90, render: (v: string, r) => (
        <Space size={4}>{r.periodClosed && <Tooltip title="Period not open — it cannot be posted"><ExclamationCircleOutlined style={{ color: STATUS.critical }} /></Tooltip>}{v || '—'}</Space>) },
      ...(compact ? [] : [{ title: 'Status', dataIndex: 'status', width: 100 }]),
      { title: 'AED Dr', dataIndex: 'accountedDr', width: 130, align: 'right' as const, sorter: (a: GlJournal, b: GlJournal) => a.accountedDr - b.accountedDr, render: (v: number) => money(v) },
      { title: 'Waiting', dataIndex: 'ageDays', width: 90, align: 'right' as const, sorter: (a: GlJournal, b: GlJournal) => a.ageDays - b.ageDays,
        render: (v: number) => (v <= 0 ? 'today' : `${v} d`) },
      ...(compact ? [] : [
        { title: 'Created by', dataIndex: 'createdBy', width: 170, ellipsis: true },
        { title: 'Ledger', dataIndex: 'ledger', width: 150, ellipsis: true },
      ]),
    ]} />
);

export default GlDashboard;
