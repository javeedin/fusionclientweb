// General Ledger dashboard (top of the GL page) — focused on journals that are not posted, PMS journals first.
// Every figure is direct SQL through the read gateway; see glDashboard.service for the queries and the rules.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Input, Modal, Row, Segmented, Skeleton, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  AuditOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CodeOutlined, CopyOutlined, ExclamationCircleOutlined,
  LoadingOutlined, MinusCircleOutlined, ReloadOutlined, SearchOutlined, SendOutlined, StopOutlined, WarningOutlined,
} from '@ant-design/icons';
import JournalFullPreview from '../../components/JournalFullPreview';
import ApprovalStatusModal from '../../components/approvals/ApprovalStatusModal';
import { JournalApprovalAction, JournalApprovalModal, JournalApprovalTag, useApprovalUser, type JournalToSend } from '../../components/approvals/JournalApprovalModal';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { postJournal } from '../../services/manage-journals.service';
import { onApprovalsChanged, type ApprovalRule } from '../../services/approvals.service';
import {
  cleanDbMessage, journalGate, loadJournalApprovals, loadJournalRules, ruleFor, withdrawJournalApproval,
  type GateTone, type JournalApproval, type JournalGate,
} from '../../services/glApproval.service';
import {
  AGES, inAge, isPmsCategory, loadGlDashboard, planBatchPost, pmsKind, summarizeGl,
  type GlData, type GlJournal, type PostBatchItem,
} from '../../services/glDashboard.service';

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
const FREE_GATE: JournalGate = { tone: 'free', label: 'No approval needed', block: null, canSend: false };
/** approval chips in the headline card, in the order a journal moves through them */
const APPROVAL_CHIPS: { tone: GateTone; label: string; color: string; icon: React.ReactNode; title: string }[] = [
  { tone: 'needed',   label: 'need approval',   color: 'orange', icon: <ExclamationCircleOutlined />, title: 'Not posted — an approval rule covers them, not sent yet' },
  { tone: 'pending',  label: 'awaiting approval', color: 'gold', icon: <ClockCircleOutlined />,       title: 'Not posted — waiting for the approver' },
  { tone: 'rejected', label: 'rejected',        color: 'red',    icon: <CloseCircleOutlined />,       title: 'Not posted — rejected by the approver' },
  { tone: 'changed',  label: 'changed after approval', color: 'orange', icon: <WarningOutlined />,    title: 'Not posted — changed after they were approved' },
  { tone: 'approved', label: 'approved, ready to post', color: 'green', icon: <CheckCircleOutlined />, title: 'Approved — ready to post' },
];

const GlDashboard: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<GlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'PMS' | 'ALL'>(() => { try { return localStorage.getItem(MODE_KEY) === 'ALL' ? 'ALL' : 'PMS'; } catch { return 'PMS'; } });
  const [list, setList] = useState<{ title: string; rows: GlJournal[] } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);          // header ids picked in the list
  const [post, setPost] = useState<{ items: PostBatchItem[]; running: boolean; done: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<GlJournal | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  // journal approvals: the latest request of each batch + the rules that say which journals need one
  const [approvals, setApprovals] = useState<Map<number, JournalApproval>>(new Map());
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [sendFor, setSendFor] = useState<JournalToSend[] | null>(null);
  const [trailFor, setTrailFor] = useState<GlJournal | null>(null);
  const approvalUser = useApprovalUser();

  const loadApprovals = useCallback(async () => {
    const [a, r] = await Promise.all([loadJournalApprovals().catch(() => new Map<number, JournalApproval>()), loadJournalRules().catch(() => [])]);
    setApprovals(a); setRules(r);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    loadApprovals();
    try { setData(await loadGlDashboard()); }
    catch (e) { message.error(`GL dashboard: ${e instanceof Error ? e.message : e}`); }
    finally { setLoading(false); }
  }, [loadApprovals]);
  useEffect(() => { load(); }, [load]);
  // approved / rejected from the bell, or sent from another screen → show it
  useEffect(() => onApprovalsChanged(d => { if (!d.module || d.module === 'GL') loadApprovals(); }), [loadApprovals]);

  // a batch is approved as a whole: its amount is every not-posted journal in it
  const batchAed = useMemo(() => {
    const m = new Map<number, number>();
    data?.journals.forEach(j => { if (j.batchId) m.set(j.batchId, (m.get(j.batchId) || 0) + j.accountedDr); });
    return m;
  }, [data]);
  const gateOfBatch = useCallback((batchId: number | null, aed: number): JournalGate =>
    (batchId ? journalGate(approvals.get(batchId), aed, ruleFor(aed, rules)) : FREE_GATE), [approvals, rules]);
  const gateOf = useCallback((j: GlJournal) => gateOfBatch(j.batchId, j.batchId ? batchAed.get(j.batchId) ?? j.accountedDr : j.accountedDr),
    [gateOfBatch, batchAed]);
  const toSend = (journals: GlJournal[]): JournalToSend[] => {
    const ids = [...new Set(journals.map(j => j.batchId).filter((b): b is number => !!b))];
    return ids.map(batchId => {
      const all = (data?.journals ?? []).filter(j => j.batchId === batchId);
      const dr = all.reduce((t, j) => t + j.accountedDr, 0), cr = all.reduce((t, j) => t + j.accountedCr, 0);
      const first = all[0] ?? journals.find(j => j.batchId === batchId)!;
      return {
        batchId, batchName: first.batchName || `Batch ${batchId}`, period: first.period, category: first.category, journals: all.length || 1,
        amount: Math.round(dr * 100) / 100, currency: 'AED', balanced: Math.abs(dr - cr) <= 0.01,
        approval: approvals.get(batchId), gate: gateOfBatch(batchId, dr),
      };
    });
  };
  // approved / rejected from a row: posted → off the not-posted lists
  const afterDecision = (j: GlJournal, posted: boolean) => {
    if (posted && j.batchId) {
      setList(l => (l ? { ...l, rows: l.rows.filter(x => x.batchId !== j.batchId) } : l));
      load();
    } else loadApprovals();
  };
  const withdraw = async (j: GlJournal) => {
    if (!j.batchId) return;
    try { message.success(await withdrawJournalApproval(j.batchId, approvalUser, approvals.get(j.batchId))); }
    catch (e) { message.error(e instanceof Error ? e.message : String(e)); }
    await loadApprovals();
  };
  const changeMode = (m: 'PMS' | 'ALL') => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* per-viewer convenience */ } };

  const s = useMemo(() => (data ? summarizeGl(data.journals, data.periods, data.open, mode === 'PMS') : null), [data, mode]);
  const show = (title: string, rows: GlJournal[]) => { setSearch(''); setSelected([]); setList({ title, rows }); };

  // Post: PUT gl/journals/:jeBatchId/post (RR_POST_JOURNAL), one batch at a time, the way Manage Journals' Post Batch does
  const openPost = () => {
    if (!data || !list) return;
    const picked = list.rows.filter(j => selected.includes(j.headerId));
    setPost({ items: planBatchPost(picked, data.journals, (batchId, aed) => gateOfBatch(batchId, aed).block), running: false, done: false });
  };
  const runPost = async () => {
    if (!post) return;
    const items = post.items.map(i => ({ ...i }));
    setPost({ items, running: true, done: false });
    for (let k = 0; k < items.length; k++) {
      if (items[k].status !== 'ready') continue;
      items[k] = { ...items[k], status: 'posting' };
      setPost({ items: [...items], running: true, done: false });
      const res = await postJournal(items[k].batchId);
      items[k] = res.success
        ? { ...items[k], status: 'posted', message: res.message || 'Posted' }
        : { ...items[k], status: 'failed', message: cleanDbMessage(res.error || res.message) || 'Not posted', errors: res.errors };
      setPost({ items: [...items], running: true, done: false });
    }
    setPost({ items, running: false, done: true });
    const ok = items.filter(i => i.status === 'posted').length, bad = items.filter(i => i.status === 'failed').length;
    (bad ? message.warning : message.success)(`${ok} batch${ok === 1 ? '' : 'es'} posted${bad ? ` · ${bad} failed` : ''}`);
    if (ok) {
      const posted = new Set(items.filter(i => i.status === 'posted').map(i => i.batchId));
      setList(l => (l ? { ...l, rows: l.rows.filter(j => !j.batchId || !posted.has(j.batchId)) } : l));
      setSelected([]);
      load();
    }
    if (bad) loadApprovals();
  };

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
  const byTone = new Map<GateTone, GlJournal[]>();
  s.notPosted.forEach(j => { const t = gateOf(j).tone; byTone.set(t, [...(byTone.get(t) || []), j]); });
  const chips = APPROVAL_CHIPS.filter(c => byTone.get(c.tone)?.length);

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
            {chips.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                <Text style={{ fontSize: 12, color: INK.secondary }}><AuditOutlined /> Approval</Text>
                {chips.map(c => {
                  const rows = byTone.get(c.tone)!;
                  return (
                    <Tooltip key={c.tone} title={`${c.title} · AED ${money(rows.reduce((t, j) => t + j.accountedDr, 0))} · click for the journals`}>
                      <Tag color={c.color} icon={c.icon} style={{ margin: 0, cursor: 'pointer' }}
                        onClick={() => show(`${scope[0].toUpperCase()}${scope.slice(1)} — ${c.label}`, [...rows].sort((a, b) => b.ageDays - a.ageDays))}>
                        <b>{rows.length}</b> {c.label}
                      </Tag>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(s.blocked.length > 0) }}
            onClick={() => s.blocked.length && show('Not posted — their period is not open', s.blocked)}>
            <Space size={6}>
              {s.openPeriods === null ? <ExclamationCircleOutlined style={{ color: INK.muted }} />
                : s.blocked.length ? <StopOutlined style={{ color: STATUS.critical }} /> : <CheckCircleOutlined style={{ color: STATUS.good }} />}
              <Text style={{ fontSize: 13, color: INK.secondary }}>Can't post — period not open</Text>
            </Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{s.openPeriods === null ? '—' : s.blocked.length.toLocaleString()}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              {s.openPeriods === null
                ? <>period status unavailable</>
                : s.blocked.length
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
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{s.openPeriods === null ? '—' : s.openPeriods.length}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(s.openPeriods ?? []).slice(0, 6).map(p => <Tag key={p} style={{ margin: 0 }}>{p}</Tag>)}
              {s.openPeriods === null && <Text style={{ fontSize: 12, color: INK.secondary }}>period status unavailable</Text>}
              {s.openPeriods?.length === 0 && <Text style={{ fontSize: 12, color: INK.secondary }}>none — nothing can be posted</Text>}
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
            <JournalTable rows={oldestFirst.slice(0, 6)} compact onOpen={setPreview} gateOf={gateOf} approvals={approvals} onTrail={setTrailFor}
              onSend={j => setSendFor(toSend([j]))} onDecided={afterDecision} />
          </div>
        </Col>
      </Row>

      <Modal open={!!list} onCancel={() => setList(null)} width={1150} destroyOnHidden title={list?.title}
        footer={<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {selected.length ? `${plural(selected.length, 'journal')} selected · AED ${money(list?.rows.filter(j => selected.includes(j.headerId)).reduce((t, j) => t + j.accountedDr, 0) ?? 0)}` : 'Tick journals to send them for approval or post them'}
          </Text>
          <Space>
            <Button onClick={() => { setList(null); onNavigate('/gl/manage-journals'); }}>Open Manage Journals</Button>
            <Tooltip title="The approver approves or rejects each batch from their notifications; until then it cannot be posted">
              <Button icon={<AuditOutlined />} disabled={!selected.length}
                onClick={() => list && setSendFor(toSend(list.rows.filter(j => selected.includes(j.headerId))))}>
                Send for approval{selected.length ? ` (${new Set(list?.rows.filter(j => selected.includes(j.headerId)).map(j => j.batchId)).size})` : ''}
              </Button>
            </Tooltip>
            <Button type="primary" icon={<SendOutlined />} disabled={!selected.length} onClick={openPost}
              style={selected.length ? { background: '#1D7B4D', borderColor: '#1D7B4D' } : undefined}>
              Post selected{selected.length ? ` (${selected.length})` : ''}
            </Button>
          </Space>
        </div>}>
        {(() => {
          const shown = (list?.rows ?? []).filter(j => !search || [j.batchName, j.journalName, j.category, j.createdBy, j.period]
            .some(v => v.toLowerCase().includes(search.toLowerCase())));
          const postable = shown.filter(j => j.batchId && !j.periodClosed && Math.abs(j.accountedDr - j.accountedCr) <= 0.01 && !gateOf(j).block);
          return <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Input allowClear prefix={<SearchOutlined />} placeholder="Search batch, journal, category, created by" value={search}
                onChange={e => setSearch(e.target.value)} style={{ width: 340 }} />
              <Tooltip title="Every journal shown that is balanced, has a batch, sits in an open period and is not held by approval">
                <Button onClick={() => setSelected(postable.map(j => j.headerId))} disabled={!postable.length}>Select postable ({postable.length})</Button>
              </Tooltip>
              {selected.length > 0 && <Button type="link" onClick={() => setSelected([])}>Clear</Button>}
            </Space>
            <JournalTable rows={shown} onOpen={setPreview} selection={{ keys: selected, onChange: setSelected }} gateOf={gateOf} approvals={approvals} onTrail={setTrailFor}
              onSend={j => setSendFor(toSend([j]))} onDecided={afterDecision} />
          </>;
        })()}
      </Modal>

      <Modal open={!!post} width={980} destroyOnHidden maskClosable={!post?.running} closable={!post?.running}
        onCancel={() => !post?.running && setPost(null)}
        title={<Space><SendOutlined style={{ color: '#1D7B4D' }} />Post journals<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>PUT gl/journals/:jeBatchId/post · RR_POST_JOURNAL</Text></Space>}
        footer={post?.done
          ? <Button type="primary" onClick={() => setPost(null)}>Close</Button>
          : <Space>
              <Button disabled={post?.running} onClick={() => setPost(null)}>Cancel</Button>
              <Button type="primary" icon={<SendOutlined />} loading={post?.running} disabled={!post?.items.some(i => i.status === 'ready')}
                style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={runPost}>
                Post {post ? plural(post.items.filter(i => i.status === 'ready').length, 'batch').replace('batchs', 'batches') : ''}
              </Button>
            </Space>}>
        {post && <PostTable items={post.items} />}
      </Modal>

      <JournalApprovalModal open={!!sendFor} batches={sendFor ?? []} rules={rules} onClose={() => setSendFor(null)} onDone={loadApprovals} />

      {(() => {
        const a = trailFor?.batchId ? approvals.get(trailFor.batchId) : undefined;
        return (
          <ApprovalStatusModal open={!!trailFor} onClose={() => setTrailFor(null)} module="GL"
            transactionId={trailFor?.batchId ?? undefined} transactionTypes={['JOURNAL']}
            title={trailFor ? trailFor.batchName || trailFor.journalName : ''}
            status={a?.status} sentBy={a?.requestedBy} sentDate={a?.requestedDate}
            approverName={a?.status === 'PENDING' ? a?.approverName : a?.decidedBy || a?.approverName} approverEmail={a?.approverEmail}
            decisionDate={a?.decidedDate}
            onSendAgain={trailFor ? () => { const j = trailFor; setTrailFor(null); setSendFor(toSend([j])); } : undefined}
            onWithdraw={trailFor ? () => withdraw(trailFor) : undefined} />
        );
      })()}

      <JournalFullPreview open={!!preview} jeHeaderId={preview?.headerId ?? null} batchId={preview?.batchId ?? null} onClose={() => setPreview(null)} />

      <Modal open={sqlOpen} onCancel={() => setSqlOpen(false)} width={960} footer={<Button onClick={() => setSqlOpen(false)}>Close</Button>}
        title={<Space><CodeOutlined />SQL behind the dashboard<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>POST ai/executequery</Text></Space>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
          PMS journals = category starting with “PMS” (PMS FD / Loan / Stock Journals). Posted = batch STATUS 'P' / Posted, or header Posted.
          Open period = RR_ACCOUNTING_PERIODS_STATUS, General Ledger (101), CLOSING_STATUS 'O' — the check RR_POST_JOURNAL makes.
          Approval = the batch's latest request in RR_APPROVAL_REQUESTS (module GL); "needs approval" = an active GL / JOURNAL approval rule covers its amount.
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

const PostTable: React.FC<{ items: PostBatchItem[] }> = ({ items }) => {
  const ready = items.filter(i => i.status === 'ready').length, skipped = items.filter(i => i.blockers.length).length;
  const others = items.reduce((t, i) => t + i.others.length, 0);
  const posted = items.filter(i => i.status === 'posted').length, failed = items.filter(i => i.status === 'failed').length;
  const finished = posted + failed > 0 && !items.some(i => i.status === 'ready' || i.status === 'posting');
  const icon = (i: PostBatchItem) => ({
    ready: <ClockCircleOutlined style={{ color: INK.muted }} />, skipped: <MinusCircleOutlined style={{ color: STATUS.warning }} />,
    posting: <LoadingOutlined style={{ color: ACCENT }} />, posted: <CheckCircleOutlined style={{ color: STATUS.good }} />,
    failed: <CloseCircleOutlined style={{ color: STATUS.critical }} />,
  }[i.status]);
  return (
    <>
      {finished ? (
        <Alert type={failed ? 'warning' : 'success'} showIcon style={{ marginBottom: 12, fontSize: 12 }}
          message={`${posted} batch${posted === 1 ? '' : 'es'} posted${failed ? ` · ${failed} refused by the database (reason shown)` : ''}${skipped ? ` · ${skipped} skipped` : ''}`} />
      ) : (
        <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
          message={<span>Posting works on a <b>batch</b>: every journal in it is posted together. {ready} of {items.length} batch{items.length === 1 ? '' : 'es'} ready
            {skipped ? <> · {skipped} will be skipped (reason shown)</> : null}.
            The database checks the period and balance again and refuses anything it cannot post.</span>} />
      )}
      {others > 0 && !finished && (
        <Alert type="warning" showIcon style={{ marginBottom: 12, fontSize: 12 }}
          message={`${plural(others, 'journal')} you did not select ${others === 1 ? 'shares' : 'share'} a batch with selected ones and will be posted with ${others === 1 ? 'it' : 'them'}.`} />
      )}
      <Table<PostBatchItem> size="small" rowKey={i => `${i.batchId}-${i.batchName}`} dataSource={items} pagination={items.length > 12 ? { pageSize: 12 } : false}
        columns={[
          { title: '', key: 's', width: 32, render: (_: unknown, i) => <Tooltip title={i.status}>{icon(i)}</Tooltip> },
          { title: 'Batch', dataIndex: 'batchName', ellipsis: true, render: (v: string, i) => (
            <div>{v}<div style={{ fontSize: 11, color: INK.muted }}>{plural(i.journals.length, 'journal')}{i.others.length ? ` + ${i.others.length} not selected` : ''} · {i.ledger}</div></div>) },
          { title: 'Period', dataIndex: 'period', width: 80 },
          { title: 'AED Dr', dataIndex: 'aed', width: 140, align: 'right', render: (v: number) => money(v) },
          { title: 'Result', key: 'r', width: 340, render: (_: unknown, i) => {
            if (i.blockers.length) return <Text style={{ fontSize: 12, color: INK.secondary }}>Skipped — {i.blockers.join('; ')}</Text>;
            if (i.status === 'ready') return <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>PUT …/gl/journals/{i.batchId}/post</Text>;
            if (i.status === 'posting') return <Text style={{ fontSize: 12 }}>Posting…</Text>;
            return (
              <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>PUT {APEX_DB_CONFIG.baseUrl}/gl/journals/{i.batchId}/post</span>} overlayStyle={{ maxWidth: 600 }}>
                <div style={{ fontSize: 12, color: i.status === 'posted' ? INK.primary : STATUS.critical }}>
                  {i.message}{i.errors?.length ? <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>{i.errors.map((e, k) => <li key={k}>{e}</li>)}</ul> : null}
                </div>
              </Tooltip>
            );
          } },
        ]} />
    </>
  );
};

const JournalTable: React.FC<{
  rows: GlJournal[]; onOpen: (j: GlJournal) => void; compact?: boolean;
  selection?: { keys: number[]; onChange: (keys: number[]) => void };
  gateOf?: (j: GlJournal) => JournalGate; approvals?: Map<number, JournalApproval>; onTrail?: (j: GlJournal) => void;
  onSend?: (j: GlJournal) => void; onDecided?: (j: GlJournal, posted: boolean) => void;
}> = ({ rows, onOpen, compact, selection, gateOf, approvals, onTrail, onSend, onDecided }) => (
  <Table<GlJournal> size="small" rowKey="headerId" dataSource={rows}
    rowSelection={selection ? {
      selectedRowKeys: selection.keys, preserveSelectedRowKeys: true,
      onChange: keys => selection.onChange(keys as number[]),
      getCheckboxProps: r => ({ disabled: !r.batchId }),
    } : undefined}
    pagination={compact ? false : { pageSize: 12, showSizeChanger: false, showTotal: t => `${t} journals` }}
    onRow={r => ({ onClick: () => onOpen(r), style: { cursor: 'pointer' } })}
    locale={{ emptyText: 'Nothing waiting' }}
    summary={compact ? undefined : () => (
      <Table.Summary.Row style={{ background: '#fafafa' }}>
        {/* lead = selection box + batch, category, period, status */}
        <Table.Summary.Cell index={0} colSpan={(selection ? 1 : 0) + 4}><Text strong>Total ({rows.length})</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={(selection ? 1 : 0) + 4} align="right"><Text strong>{money(rows.reduce((t, r) => t + r.accountedDr, 0))}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={(selection ? 1 : 0) + 5} colSpan={gateOf ? 4 : 3} />
      </Table.Summary.Row>
    )}
    columns={[
      { title: 'Batch / journal', key: 'b', ellipsis: true, render: (_: unknown, r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          {gateOf && onSend && r.batchId && (
            <JournalApprovalAction batchId={r.batchId} batchName={r.batchName || `Batch ${r.batchId}`} gate={gateOf(r)} approval={approvals?.get(r.batchId)}
              onSend={() => onSend(r)} onTrail={approvals?.get(r.batchId) && onTrail ? () => onTrail(r) : undefined}
              onDecided={({ posted }) => onDecided?.(r, posted)} />
          )}
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <a style={{ fontSize: 12 }}>{r.batchName || r.journalName || `#${r.headerId}`}</a>
            {!compact && r.journalName && r.journalName !== r.batchName && <div style={{ fontSize: 11, color: INK.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.journalName}</div>}
          </div>
        </div>) },
      { title: 'Category', dataIndex: 'category', width: compact ? 150 : 170, ellipsis: true,
        render: (v: string) => (isPmsCategory(v) ? <Tag color="blue" style={{ margin: 0 }}>{v}</Tag> : v) },
      { title: 'Period', dataIndex: 'period', width: 90, render: (v: string, r) => (
        <Space size={4}>{r.periodClosed && <Tooltip title="Period not open — it cannot be posted"><ExclamationCircleOutlined style={{ color: STATUS.critical }} /></Tooltip>}{v || '—'}</Space>) },
      ...(compact ? [] : [{ title: 'Status', dataIndex: 'status', width: 100 }]),
      { title: 'AED Dr', dataIndex: 'accountedDr', width: 130, align: 'right' as const, sorter: (a: GlJournal, b: GlJournal) => a.accountedDr - b.accountedDr, render: (v: number) => money(v) },
      { title: 'Waiting', dataIndex: 'ageDays', width: 90, align: 'right' as const, sorter: (a: GlJournal, b: GlJournal) => a.ageDays - b.ageDays,
        render: (v: number) => (v <= 0 ? 'today' : `${v} d`) },
      ...(gateOf ? [{ title: 'Approval', key: 'appr', width: compact ? 150 : 200, render: (_: unknown, r: GlJournal) => {
        const a = r.batchId ? approvals?.get(r.batchId) : undefined;
        return <JournalApprovalTag gate={gateOf(r)} approval={a} compact={compact} onClick={a && onTrail ? () => onTrail(r) : undefined} />;
      } }] : []),
      ...(compact ? [] : [
        { title: 'Created by', dataIndex: 'createdBy', width: 170, ellipsis: true },
        { title: 'Ledger', dataIndex: 'ledger', width: 150, ellipsis: true },
      ]),
    ]} />
);

export default GlDashboard;
