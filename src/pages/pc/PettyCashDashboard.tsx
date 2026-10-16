// Petty cash dashboard (first tab of Petty Cash Registers): the key figures every register shows in its header —
// balance, balance with suspense, available to add, limit, money in / out — across the active registers, plus what needs
// attention. Direct SQL through the read gateway — see pettyCashDashboard.service. Opening a register opens its tab.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Modal, Row, Skeleton, Space, Tooltip, Typography, message } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CodeOutlined, CopyOutlined, ExclamationCircleOutlined,
  ReloadOutlined, SearchOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { PCRegister } from '../../services/pc.service';
import { loadPettyCashDashboard, type PcData, type PcRegisterStat } from '../../services/pettyCashDashboard.service';

const { Text } = Typography;

// ink + chart tokens (validated: blue pair and ramp on the white card surface)
const INK = { primary: '#1f1f1f', secondary: '#595959', muted: '#8c8c8c', hairline: '#f0f0f0' };
const LIGHT = '#86b6ef', DARK = '#1c5cab', ACCENT = '#2a78d6', DEEMPHASIS = '#c3c2b7';
const STATUS = { critical: '#d03b3b', warning: '#d48806', good: '#0ca30c' };
const LOW = 20;   // a register under this % of its limit needs a refill

const money = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const card: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', padding: 18, height: '100%', boxSizing: 'border-box' };
const clickable = (on: boolean): React.CSSProperties => (on ? { cursor: 'pointer' } : {});
const swatch = (c: string) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 4, verticalAlign: -1 }} />;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

const PettyCashDashboard: React.FC<{
  onOpenRegister: (reg: PCRegister) => void; onShowSearch: () => void;
  /** the tab is showing — refresh each time it comes back (registers change in the other tabs) */
  active: boolean;
}> = ({ onOpenRegister, onShowSearch, active }) => {
  const [data, setData] = useState<PcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<{ title: string; rows: PcRegisterStat[] } | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadPettyCashDashboard()); }
    catch (e) { message.error(`Petty cash dashboard: ${e instanceof Error ? e.message : e}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  if (loading && !data) {
    return <div style={{ padding: '12px 0' }}><Row gutter={[16, 16]}>{[9, 5, 5, 5].map((w, i) => (
      <Col key={i} xs={24} sm={12} lg={w}><div style={card}><Skeleton active paragraph={{ rows: 2 }} /></div></Col>))}</Row></div>;
  }
  if (!data) return null;

  const ccy = data.currency;
  const usedPct = data.limit > 0 ? Math.min(100, Math.round((data.balance / data.limit) * 100)) : null;
  const byBalance = [...data.active].sort((a, b) => b.register.balance - a.register.balance);
  const maxBar = Math.max(1, ...data.active.map(x => Math.max(x.register.limit ?? 0, x.register.balance)));
  const maxMonth = Math.max(1, ...data.months.flatMap(m => [m.moneyIn, m.moneyOut]));
  const maxExp = Math.max(1, ...data.expenses.map(e => e.amount));
  const lowOnes = data.active.filter(x => x.usedPct != null && x.usedPct < LOW && x.register.balance >= 0);
  const negative = data.registers.filter(x => x.register.balance < -0.005);
  const overLimit = data.active.filter(x => x.usedPct != null && x.usedPct > 100);
  const withUnposted = data.registers.filter(x => x.unposted > 0);
  const withErrors = data.registers.filter(x => x.errors > 0);
  const withSuspense = data.registers.filter(x => x.suspense > 0.005);
  const attention = [
    { key: 'low', label: 'Need a refill', rows: lowOnes, hint: `balance under ${LOW}% of the limit`, icon: <WarningOutlined style={{ color: STATUS.warning }} /> },
    { key: 'neg', label: 'Negative balance', rows: negative, hint: 'more paid out than put in', icon: <CloseCircleOutlined style={{ color: STATUS.critical }} /> },
    { key: 'over', label: 'Over the limit', rows: overLimit, hint: 'balance above the register limit', icon: <ExclamationCircleOutlined style={{ color: STATUS.warning }} /> },
    { key: 'unposted', label: 'Transactions to post', rows: withUnposted, hint: `${plural(data.unposted, 'transaction')} · ${ccy} ${money(data.unpostedAmount)}`, icon: <ClockCircleOutlined style={{ color: STATUS.warning }} /> },
    { key: 'errors', label: 'Posting errors', rows: withErrors, hint: `${plural(data.errors, 'transaction')} failed to post`, icon: <CloseCircleOutlined style={{ color: STATUS.critical }} /> },
    { key: 'susp', label: 'Suspense to clear', rows: withSuspense, hint: `${ccy} ${money(data.suspense)} in suspense`, icon: <ExclamationCircleOutlined style={{ color: '#722ed1' }} /> },
  ];

  const registerRow = (x: PcRegisterStat) => {
    const r = x.register;
    const hasLimit = r.limit != null && r.limit > 0;
    const low = x.usedPct != null && x.usedPct < LOW;
    return (
      <Tooltip key={r.registerId} placement="topLeft" title={<div style={{ fontSize: 12 }}>
        <div>{r.registerName} · {r.businessUnit}{r.ownedBy ? ` · ${r.ownedBy}` : ''}</div>
        <div>Balance {r.currency} {money(r.balance)}{hasLimit ? ` of ${money(r.limit!)} limit (${x.usedPct}%)` : ' · no limit'}</div>
        <div>Balance w/ suspense {money(x.balanceWithSuspense)}{x.available != null ? ` · available to add ${money(x.available)}` : ''}</div>
        <div>In {money(r.totalDebit)} · out {money(r.totalCredit)}{x.lastTxn ? ` · last ${x.lastTxn}` : ''}</div>
        <div style={{ opacity: 0.75 }}>Click to open the register</div>
      </div>} overlayStyle={{ maxWidth: 420 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr 140px', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: `1px solid ${INK.hairline}`, cursor: 'pointer' }}
          onClick={() => onOpenRegister(r)}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: INK.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.registerName}</div>
            <div style={{ fontSize: 11, color: INK.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[r.businessUnit, r.ownedBy].filter(Boolean).join(' · ')}
            </div>
          </div>
          {/* balance against the limit: dark = balance, light track to the limit */}
          <div>
            <div style={{ position: 'relative', height: 12, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
              {hasLimit && <div style={{ position: 'absolute', inset: 0, width: `${(r.limit! / maxBar) * 100}%`, background: '#dbe8fa', borderRadius: '0 4px 4px 0' }} />}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(Math.max(0, r.balance) / maxBar) * 100}%`, minWidth: r.balance > 0 ? 3 : 0, background: DARK, borderRadius: '0 4px 4px 0' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 11, color: INK.muted }}>
              {hasLimit ? <span>{x.usedPct}% of {money(r.limit!, 0)}</span> : <span>no limit</span>}
              {low && <span style={{ color: STATUS.warning }}><WarningOutlined /> refill</span>}
              {x.unposted > 0 && <span><ClockCircleOutlined /> {x.unposted} to post</span>}
              {x.suspense > 0.005 && <span style={{ color: '#722ed1' }}>suspense {money(x.suspense, 0)}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: r.balance < 0 ? STATUS.critical : INK.primary, fontVariantNumeric: 'tabular-nums' }}>{money(r.balance)}</div>
            <div style={{ fontSize: 11, color: INK.muted }}>{r.currency}{x.available != null ? ` · add ${money(x.available, 0)}` : ''}</div>
          </div>
        </div>
      </Tooltip>
    );
  };

  return (
    // right padding keeps the floating menu off the figures
    <div style={{ padding: '12px 72px 4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: INK.muted }}>
          Live from the database · {ccy}{data.otherCurrencies.length ? ` (registers in ${data.otherCurrencies.join(', ')} are listed, not totalled)` : ''} · as of {data.asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Tooltip title="Refresh"><Button size="small" type="text" icon={<ReloadOutlined spin={loading} />} onClick={load} /></Tooltip>
        <Tooltip title="The SQL behind every figure"><Button size="small" type="text" icon={<CodeOutlined />} onClick={() => setSqlOpen(true)}>SQL</Button></Tooltip>
      </div>
      {data.errors_.length > 0 && (
        <Alert type="error" showIcon closable style={{ marginBottom: 12 }} message="Some figures could not be read"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{data.errors_.map((e, i) => <li key={i}>{e}</li>)}</ul>} />
      )}

      {/* ── key figures ─────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={9}>
          <div style={{ ...card, ...clickable(data.active.length > 0) }} onClick={() => data.active.length && setList({ title: 'Active registers', rows: byBalance })}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>Cash in {plural(data.active.length, 'active register')}</Text>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '6px 0 4px' }}>
              <span style={{ fontSize: 15, color: INK.secondary }}>{ccy}</span>
              <span style={{ fontSize: 'clamp(28px, 3vw, 40px)', fontWeight: 600, color: INK.primary, lineHeight: 1.15 }}>{money(data.balance)}</span>
            </div>
            <Text style={{ fontSize: 13, color: INK.secondary }}>
              balance w/ suspense <b style={{ color: INK.primary }}>{money(data.balanceWithSuspense)}</b>
              {data.limit > 0 && <> · available to add <b style={{ color: INK.primary }}>{money(data.available)}</b></>}
            </Text>
            {usedPct != null && <>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, margin: '12px 0 6px', background: INK.hairline }}>
                {usedPct > 0 && <div style={{ width: `${usedPct}%`, background: DARK }} />}
                {usedPct < 100 && <div style={{ width: `${100 - usedPct}%`, background: LIGHT }} />}
              </div>
              <Space size={14} style={{ fontSize: 12, color: INK.secondary }}>
                <span>{swatch(DARK)}Balance {usedPct}%</span>
                <span>{swatch(LIGHT)}Room to the limits ({money(data.limit, 0)})</span>
              </Space>
            </>}
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={card}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>Money out this month</Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{money(data.outMtd)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>money in {money(data.inMtd)} · {ccy}</Text>
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(withUnposted.length > 0) }} onClick={() => withUnposted.length && setList({ title: 'Registers with transactions to post', rows: withUnposted })}>
            <Space size={6}>{data.unposted ? <ClockCircleOutlined style={{ color: STATUS.warning }} /> : <CheckCircleOutlined style={{ color: STATUS.good }} />}
              <Text style={{ fontSize: 13, color: INK.secondary }}>Waiting to be posted</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{data.unposted.toLocaleString()}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>{data.unposted ? `${ccy} ${money(data.unpostedAmount)} in ${plural(withUnposted.length, 'register')}` : 'everything is posted'}</Text>
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(withSuspense.length > 0) }} onClick={() => withSuspense.length && setList({ title: 'Registers with suspense', rows: withSuspense })}>
            <Space size={6}><ExclamationCircleOutlined style={{ color: data.suspense > 0.005 ? '#722ed1' : INK.muted }} /><Text style={{ fontSize: 13, color: INK.secondary }}>In suspense</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{money(data.suspense)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>{withSuspense.length ? `${plural(withSuspense.length, 'register')} · to clear` : 'nothing in suspense'}</Text>
          </div>
        </Col>
      </Row>

      {/* ── registers + attention ──────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text strong style={{ fontSize: 15 }}>Active registers</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}>
                <span>{swatch(DARK)}Balance</span><span>{swatch('#dbe8fa')}Limit</span>
                <a style={{ fontSize: 12 }} onClick={onShowSearch}><SearchOutlined /> Search</a>
              </Space>
            </div>
            {byBalance.length === 0 ? <Text type="secondary">No active registers</Text> : byBalance.slice(0, 10).map(registerRow)}
            {byBalance.length > 10 && <a style={{ fontSize: 12, display: 'inline-block', marginTop: 8 }} onClick={() => setList({ title: 'Active registers', rows: byBalance })}>All {byBalance.length} registers</a>}
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div style={card}>
            <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>Needs attention</Text>
            {attention.map(a => (
              <div key={a.key} onClick={() => a.rows.length && setList({ title: a.label, rows: a.rows })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${INK.hairline}`, ...clickable(a.rows.length > 0) }}>
                {a.rows.length ? a.icon : <CheckCircleOutlined style={{ color: STATUS.good }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: INK.primary }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: INK.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.rows.length ? a.hint : 'none'}
                  </div>
                </div>
                <Text style={{ fontSize: 16, fontWeight: 600, color: a.rows.length ? INK.primary : INK.muted }}>{a.rows.length}</Text>
              </div>
            ))}
          </div>
        </Col>
      </Row>

      {/* ── money in / out + spending by type ──────────────────────────── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>Money in and out</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}><span>{swatch(LIGHT)}In</span><span>{swatch(DARK)}Out</span><span style={{ color: INK.muted }}>{ccy}</span></Space>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140, padding: '0 4px', borderBottom: `1px solid ${DEEMPHASIS}` }}>
              {data.months.map(m => (
                <Tooltip key={m.month} title={`${m.label}: in ${ccy} ${money(m.moneyIn)} · out ${money(m.moneyOut)}`}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '100%' }}>
                    {[m.moneyIn, m.moneyOut].map((v, k) => (
                      <div key={k} style={{ width: '42%', height: `${(v / maxMonth) * 115}px`, minHeight: v ? 3 : 0, background: k ? DARK : LIGHT, borderRadius: '4px 4px 0 0' }} />
                    ))}
                  </div>
                </Tooltip>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, padding: '4px 4px 0' }}>
              {data.months.map(m => <Text key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: INK.muted }}>{m.label}</Text>)}
            </div>
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text strong style={{ fontSize: 15 }}>Spending by expense type</Text>
              <Text style={{ fontSize: 11, color: INK.muted }}>last 90 days · {ccy}</Text>
            </div>
            {data.expenses.length === 0 && <Text type="secondary">No expenses in the last 90 days</Text>}
            {data.expenses.map(e => (
              <Tooltip key={e.type} placement="topLeft" title={`${e.type}: ${ccy} ${money(e.amount)} · ${plural(e.n, 'expense')}`}>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 90px', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                  <Text ellipsis style={{ fontSize: 12, color: INK.secondary }}>{e.type}</Text>
                  <div style={{ height: 12, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(e.amount / maxExp) * 100}%`, height: '100%', minWidth: 3, background: ACCENT, borderRadius: '0 4px 4px 0' }} />
                  </div>
                  <Text style={{ fontSize: 12, color: INK.primary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(e.amount, 0)}</Text>
                </div>
              </Tooltip>
            ))}
          </div>
        </Col>
      </Row>

      <Modal open={!!list} onCancel={() => setList(null)} width={900} destroyOnHidden title={list?.title} footer={<Button onClick={() => setList(null)}>Close</Button>}>
        {(list?.rows ?? []).map(registerRow)}
      </Modal>

      <Modal open={sqlOpen} onCancel={() => setSqlOpen(false)} width={960} footer={<Button onClick={() => setSqlOpen(false)}>Close</Button>}
        title={<Space><CodeOutlined />SQL behind the dashboard<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>POST ai/executequery</Text></Space>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
          Balance = money in − money out (as each register shows it); balance with suspense = balance − suspense; available to add = limit − balance.
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

export default PettyCashDashboard;
