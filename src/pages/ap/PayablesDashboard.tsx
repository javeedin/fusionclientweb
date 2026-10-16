// Payables dashboard (top of the Payables page). Every figure comes from direct SQL through the read gateway —
// see payablesDashboard.service for the queries and the outstanding / due-date rules.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Input, Modal, Row, Skeleton, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, CopyOutlined, ExclamationCircleOutlined,
  ReloadOutlined, SearchOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  AGING, ATTENTION, FUNCTIONAL_CCY, inBucket, isReadyToPay, loadAttentionList, loadPayablesDashboard,
  type AttentionKey, type OpenInvoice, type PayablesData,
} from '../../services/payablesDashboard.service';
import type { Row as SqlRow } from '../../services/po.service';

const { Text } = Typography;

// ink + chart tokens (validated: ordinal blue ramp on the white card surface)
const INK = { primary: '#1f1f1f', secondary: '#595959', muted: '#8c8c8c', hairline: '#f0f0f0' };
const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];   // not yet due → over 90 days
const SUPPLIER_OVERDUE = '#1c5cab', SUPPLIER_CURRENT = '#86b6ef';
const DEEMPHASIS = '#c3c2b7', ACCENT = '#2a78d6';
const STATUS = { critical: '#d03b3b', warning: '#d48806', good: '#0ca30c' };

const money = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const aed = (v: number, dp = 2) => `${FUNCTIONAL_CCY} ${money(v, dp)}`;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleString('en-US', { month: 'short' });
const dayLabel = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') : '—');

const card: React.CSSProperties = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 20, height: '100%', boxSizing: 'border-box' };
const clickable = (on: boolean): React.CSSProperties => (on ? { cursor: 'pointer' } : {});

/** A list of invoices the user opened from a tile, a bar or an action. */
type Drill =
  | { kind: 'invoices'; title: string; rows: OpenInvoice[] }
  | { kind: 'suppliers'; title: string }
  | { kind: 'attention'; key: AttentionKey; title: string; rows: SqlRow[] | null };

const PayablesDashboard: React.FC<{
  businessUnit: string;
  onOpenInvoice: (invoiceId: number, invoiceNumber: string) => void;
  onNavigate: (path: string) => void;
}> = ({ businessUnit, onOpenInvoice, onNavigate }) => {
  const [data, setData] = useState<PayablesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [search, setSearch] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadPayablesDashboard(businessUnit)); }
    catch (e) { message.error(`Payables dashboard: ${e instanceof Error ? e.message : e}`); }
    finally { setLoading(false); }
  }, [businessUnit]);
  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const open = data?.open ?? [];
  const showInvoices = (title: string, rows: OpenInvoice[]) => { setSearch(''); setDrill({ kind: 'invoices', title, rows }); };
  const showAttention = async (key: AttentionKey, title: string) => {
    setSearch('');
    setDrill({ kind: 'attention', key, title, rows: null });
    try {
      const rows = await loadAttentionList(key, businessUnit);
      setDrill(d => (d && d.kind === 'attention' && d.key === key ? { ...d, rows } : d));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setDrill(null);
    }
  };

  if (loading && !data) {
    return <div style={{ marginBottom: 32 }}><Row gutter={[16, 16]}>{[9, 5, 5, 5].map((w, i) => (
      <Col key={i} xs={24} sm={12} lg={w}><div style={card}><Skeleton active paragraph={{ rows: 2 }} /></div></Col>))}</Row></div>;
  }
  if (!s) return null;

  const maxBucket = Math.max(1, ...s.buckets.map(b => b.aed));
  const topSuppliers = s.suppliers.slice(0, 6);
  const maxSupplier = Math.max(1, ...topSuppliers.map(x => x.aed));
  const maxMonth = Math.max(1, ...s.months.map(m => m.aed));
  const paidDiff = s.paidThisMonth.aed - s.paidLastMonth.aed;

  return (
    <div style={{ marginBottom: 32 }}>
      {/* as-of line: the data is read live, so the old "last sync" card is gone */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: INK.muted }}>
          Live from the database · as of {data!.asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Tooltip title="Refresh"><Button size="small" type="text" icon={<ReloadOutlined spin={loading} />} onClick={load} /></Tooltip>
        <Tooltip title="The SQL behind every figure"><Button size="small" type="text" icon={<CodeOutlined />} onClick={() => setSqlOpen(true)}>SQL</Button></Tooltip>
      </div>
      {data!.errors.length > 0 && (
        <Alert type="error" showIcon closable style={{ marginBottom: 12 }} message="Some figures could not be read"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{data!.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>} />
      )}

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={9}>
          <div style={{ ...card, ...clickable(true) }} onClick={() => { setSearch(''); setDrill({ kind: 'suppliers', title: 'Outstanding by supplier' }); }}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>Outstanding payables</Text>
            <div style={{ fontSize: 'clamp(30px, 3.2vw, 48px)', fontWeight: 600, color: INK.primary, lineHeight: 1.2, margin: '6px 0 4px' }}>{aed(s.outstandingAed)}</div>
            <Text style={{ fontSize: 13, color: INK.secondary }}>
              {plural(s.openCount, 'open invoice')} · {plural(s.supplierCount, 'supplier')}
              {s.creditsAed < 0 && <> · after {aed(s.creditsAed)} credits</>}
            </Text>
            {s.foreign.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.foreign.slice(0, 4).map(f => (
                  <Tooltip key={f.ccy} title={`${f.ccy} ${money(f.amount)} = ${aed(f.aed)} at the invoices' conversion rates`}>
                    <Tag style={{ margin: 0, fontSize: 12 }}>{f.ccy} {money(f.amount)}</Tag>
                  </Tooltip>
                ))}
                <Text style={{ fontSize: 11, color: INK.muted, alignSelf: 'center' }}>included, converted to {FUNCTIONAL_CCY}</Text>
              </div>
            )}
            {s.foreignWithoutRate > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: INK.secondary }}>
                <WarningOutlined style={{ color: STATUS.warning, marginRight: 4 }} />
                {plural(s.foreignWithoutRate, 'foreign invoice')} without a conversion rate counted at 1
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(s.overdueCount > 0) }}
            onClick={() => s.overdueCount && showInvoices('Overdue invoices', open.filter(i => i.remaining > 0 && i.daysPastDue > 0).sort((a, b) => b.daysPastDue - a.daysPastDue))}>
            <Space size={6}><ExclamationCircleOutlined style={{ color: STATUS.critical }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Overdue</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{aed(s.overdueAed)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              {plural(s.overdueCount, 'invoice')}{s.overdueCount > 0 && <> · {s.overduePct}% of outstanding<br />oldest {s.oldestDays} days past due</>}
            </Text>
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(s.due30Count > 0) }}
            onClick={() => s.due30Count && showInvoices('Due in the next 30 days', open.filter(i => i.remaining > 0 && i.daysPastDue <= 0 && i.daysPastDue >= -30).sort((a, b) => b.daysPastDue - a.daysPastDue))}>
            <Space size={6}><ClockCircleOutlined style={{ color: STATUS.warning }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Due in the next 7 days</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{aed(s.due7Aed)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              {plural(s.due7Count, 'invoice')}<br />next 30 days: {aed(s.due30Aed, 0)} ({s.due30Count})
            </Text>
          </div>
        </Col>

        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(true) }} onClick={() => onNavigate('/ap/manage-payments')}>
            <Space size={6}><CheckCircleOutlined style={{ color: STATUS.good }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Paid this month</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{aed(s.paidThisMonth.aed)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>
              {plural(s.paidThisMonth.count, 'payment')} · last month {aed(s.paidLastMonth.aed, 0)}
              {s.paidLastMonth.aed > 0 && <span style={{ color: INK.muted }}> ({paidDiff >= 0 ? '▲' : '▼'} {money(Math.abs(paidDiff), 0)})</span>}
            </Text>
            {/* 6-month columns: past months de-emphasised, this month in the accent */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 34, marginTop: 10 }}>
              {s.months.map((m, i) => (
                <Tooltip key={m.month} title={`${monthLabel(m.month)}: ${aed(m.aed)} · ${plural(m.count, 'payment')}`}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', height: `${Math.max(2, (m.aed / maxMonth) * 24)}px`, borderRadius: '4px 4px 0 0',
                      background: i === 5 ? ACCENT : DEEMPHASIS }} />
                    <span style={{ fontSize: 9, color: INK.muted, lineHeight: 1 }}>{monthLabel(m.month)}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        </Col>
      </Row>

      {/* ── Aging + suppliers ──────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>Aging of outstanding invoices</Text>
              <Text style={{ fontSize: 11, color: INK.muted }}>days past the due date · click a bar for the invoices</Text>
            </div>
            {s.buckets.map((b, k) => (
              <Tooltip key={b.key} placement="topLeft" title={`${b.label}: ${aed(b.aed)} · ${plural(b.count, 'invoice')}${s.outstandingAed > 0 ? ` · ${Math.round((b.aed / Math.max(1, s.buckets.reduce((t, x) => t + x.aed, 0))) * 100)}%` : ''}`}>
                <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr 150px', alignItems: 'center', gap: 10, padding: '6px 0', ...clickable(b.count > 0) }}
                  onClick={() => b.count && showInvoices(b.label, open.filter(i => inBucket(AGING[k], i)).sort((x, y) => y.remainingAed - x.remainingAed))}>
                  <Text style={{ fontSize: 12, color: INK.secondary }}>{b.label}</Text>
                  <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(b.aed / maxBucket) * 100}%`, height: '100%', background: RAMP[k], borderRadius: '0 4px 4px 0', minWidth: b.aed > 0 ? 3 : 0 }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text style={{ fontSize: 12, color: INK.primary, fontVariantNumeric: 'tabular-nums' }}>{money(b.aed, 0)}</Text>
                    <Text style={{ fontSize: 11, color: INK.muted, marginLeft: 6 }}>{b.count}</Text>
                  </div>
                </div>
              </Tooltip>
            ))}
          </div>
        </Col>

        <Col xs={24} lg={12}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>Top suppliers by outstanding</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: SUPPLIER_OVERDUE, marginRight: 4, verticalAlign: -1 }} />Overdue</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: SUPPLIER_CURRENT, marginRight: 4, verticalAlign: -1 }} />Not yet due</span>
                <a style={{ fontSize: 12 }} onClick={() => { setSearch(''); setDrill({ kind: 'suppliers', title: 'Outstanding by supplier' }); }}>All {s.suppliers.length}</a>
              </Space>
            </div>
            {topSuppliers.length === 0 && <Text type="secondary">Nothing outstanding</Text>}
            {topSuppliers.map(x => {
              const overdueW = (x.overdueAed / maxSupplier) * 100;
              const currentW = (Math.max(0, x.aed - x.overdueAed) / maxSupplier) * 100;
              return (
                <Tooltip key={x.supplierNumber || x.supplier} placement="topLeft"
                  title={<>{x.supplier}<br />{aed(x.aed)} · {plural(x.count, 'invoice')}{x.overdueAed > 0 && <><br />overdue {aed(x.overdueAed)} · oldest {x.oldestDays} days</>}</>}>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 110px', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}
                    onClick={() => showInvoices(x.supplier, open.filter(i => (i.supplierNumber || i.supplier) === (x.supplierNumber || x.supplier)).sort((a, b) => b.daysPastDue - a.daysPastDue))}>
                    <Text ellipsis style={{ fontSize: 12, color: INK.secondary }}>{x.supplier}</Text>
                    <div style={{ display: 'flex', height: 14, gap: overdueW > 0 && currentW > 0 ? 2 : 0 }}>
                      {overdueW > 0 && <div style={{ width: `${overdueW}%`, background: SUPPLIER_OVERDUE, borderRadius: currentW > 0 ? 0 : '0 4px 4px 0' }} />}
                      {currentW > 0 && <div style={{ width: `${currentW}%`, background: SUPPLIER_CURRENT, borderRadius: '0 4px 4px 0' }} />}
                    </div>
                    <Text style={{ fontSize: 12, color: INK.primary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(x.aed, 0)}</Text>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </Col>
      </Row>

      {/* ── Needs attention ────────────────────────────────────────────── */}
      <div style={{ ...card, padding: '14px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <Text strong style={{ fontSize: 14, marginRight: 6 }}>Needs attention</Text>
          {ATTENTION.map(a => {
            const n = data!.attention[a.key];
            return (
              <Tooltip key={a.key} title={a.hint}>
                <Button size="small" disabled={!n} onClick={() => showAttention(a.key, a.label)}
                  style={{ borderRadius: 16, borderColor: n ? '#d9d9d9' : undefined }}>
                  {n > 0 && <WarningOutlined style={{ color: a.key === 'REJECTED' ? STATUS.critical : STATUS.warning }} />}
                  {a.label} <b style={{ marginLeft: 4 }}>{n.toLocaleString()}</b>
                </Button>
              </Tooltip>
            );
          })}
          <span style={{ flex: 1 }} />
          <Tooltip title="Validated, not awaiting a decision, with a balance — open the payment run">
            <Button size="small" type="primary" ghost style={{ borderRadius: 16 }} disabled={!s.readyCount}
              onClick={() => showInvoices('Ready to pay', open.filter(isReadyToPay).sort((a, b) => b.daysPastDue - a.daysPastDue))}>
              Ready to pay <b style={{ margin: '0 4px' }}>{s.readyCount.toLocaleString()}</b> · {aed(s.readyAed, 0)}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* ── drill-down ─────────────────────────────────────────────────── */}
      <Modal open={!!drill} onCancel={() => setDrill(null)} width={1000} destroyOnHidden footer={
        <Space>
          {drill?.kind === 'invoices' && drill.title === 'Ready to pay' && (
            <Button type="primary" onClick={() => { setDrill(null); onNavigate('/ap/submit-payment'); }}>Submit payment process request</Button>
          )}
          <Button onClick={() => setDrill(null)}>Close</Button>
        </Space>}
        title={<Space>{drill?.title}{businessUnit && <Tag color="blue">{businessUnit}</Tag>}</Space>}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search invoice or supplier" value={search}
          onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
        {drill?.kind === 'suppliers' && <SupplierTable data={s.suppliers} search={search}
          onPick={x => showInvoices(x.supplier, open.filter(i => (i.supplierNumber || i.supplier) === (x.supplierNumber || x.supplier)).sort((a, b) => b.daysPastDue - a.daysPastDue))} />}
        {drill?.kind === 'invoices' && <OpenInvoiceTable rows={drill.rows} search={search} onOpen={onOpenInvoice} />}
        {drill?.kind === 'attention' && <AttentionTable rows={drill.rows} search={search} onOpen={onOpenInvoice} />}
      </Modal>

      <Modal open={sqlOpen} onCancel={() => setSqlOpen(false)} width={960} footer={<Button onClick={() => setSqlOpen(false)}>Close</Button>}
        title={<Space><CodeOutlined />SQL behind the dashboard<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>POST ai/executequery</Text></Space>}>
        {data!.queries.map(q => (
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

const matches = (search: string, ...vals: unknown[]) => !search || vals.some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()));

const OpenInvoiceTable: React.FC<{ rows: OpenInvoice[]; search: string; onOpen: (id: number, no: string) => void }> = ({ rows, search, onOpen }) => {
  const shown = useMemo(() => rows.filter(r => matches(search, r.invoiceNumber, r.supplier, r.supplierNumber)), [rows, search]);
  return (
    <Table<OpenInvoice> size="small" rowKey="invoiceId" dataSource={shown} pagination={{ pageSize: 12, showSizeChanger: false, showTotal: t => `${t} invoices` }}
      onRow={r => ({ onClick: () => onOpen(r.invoiceId, r.invoiceNumber), style: { cursor: 'pointer' } })}
      summary={() => (
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} colSpan={4}><Text strong>Total ({shown.length})</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={4} align="right"><Text strong>{money(shown.reduce((t, r) => t + r.remainingAed, 0))}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={5} colSpan={2} />
        </Table.Summary.Row>
      )}
      columns={[
        { title: 'Invoice', dataIndex: 'invoiceNumber', render: v => <a>{v}</a> },
        { title: 'Supplier', dataIndex: 'supplier', ellipsis: true },
        { title: 'Ccy', dataIndex: 'ccy', width: 60 },
        { title: 'Outstanding', dataIndex: 'remaining', width: 130, align: 'right', render: v => money(v) },
        { title: `${FUNCTIONAL_CCY}`, dataIndex: 'remainingAed', width: 130, align: 'right', sorter: (a, b) => a.remainingAed - b.remainingAed, render: v => money(v) },
        { title: 'Due', dataIndex: 'dueDate', width: 110, render: dayLabel },
        { title: 'Days overdue', dataIndex: 'daysPastDue', width: 110, align: 'right', sorter: (a, b) => a.daysPastDue - b.daysPastDue,
          render: (v: number) => (v > 0
            ? <Space size={4}>{v > 90 && <Tooltip title="Over 90 days past due"><WarningOutlined style={{ color: STATUS.critical }} /></Tooltip>}{v}</Space>
            : <Text type="secondary">in {-v} d</Text>) },
      ]} />
  );
};

const SupplierTable: React.FC<{ data: PayablesData['summary']['suppliers']; search: string; onPick: (x: PayablesData['summary']['suppliers'][number]) => void }> = ({ data, search, onPick }) => {
  const shown = useMemo(() => data.filter(r => matches(search, r.supplier, r.supplierNumber)), [data, search]);
  return (
    <Table size="small" rowKey={r => r.supplierNumber || r.supplier} dataSource={shown}
      pagination={{ pageSize: 12, showSizeChanger: false, showTotal: t => `${t} suppliers` }}
      onRow={r => ({ onClick: () => onPick(r), style: { cursor: 'pointer' } })}
      summary={() => (
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total ({shown.length})</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right"><Text strong>{money(shown.reduce((t, r) => t + r.aed, 0))}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={4} align="right"><Text strong>{money(shown.reduce((t, r) => t + r.overdueAed, 0))}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={5} />
        </Table.Summary.Row>
      )}
      columns={[
        { title: 'Supplier', dataIndex: 'supplier', render: v => <a>{v}</a> },
        { title: 'Number', dataIndex: 'supplierNumber', width: 110 },
        { title: 'Invoices', dataIndex: 'count', width: 90, align: 'right' },
        { title: `Outstanding ${FUNCTIONAL_CCY}`, dataIndex: 'aed', width: 160, align: 'right', sorter: (a, b) => a.aed - b.aed, defaultSortOrder: 'descend', render: v => money(v) },
        { title: `Overdue ${FUNCTIONAL_CCY}`, dataIndex: 'overdueAed', width: 150, align: 'right', sorter: (a, b) => a.overdueAed - b.overdueAed, render: v => (v ? money(v) : '—') },
        { title: 'Oldest overdue', dataIndex: 'oldestDays', width: 120, align: 'right', render: v => (v ? `${v} days` : '—') },
      ]} />
  );
};

const AttentionTable: React.FC<{ rows: SqlRow[] | null; search: string; onOpen: (id: number, no: string) => void }> = ({ rows, search, onOpen }) => {
  const shown = useMemo(() => (rows || []).filter(r => matches(search, r.INVOICE_NUMBER, r.SUPPLIER, r.SUPPLIER_NUMBER)), [rows, search]);
  return (
    <Table size="small" loading={rows === null} rowKey={r => String(r.INVOICE_ID)} dataSource={shown}
      pagination={{ pageSize: 12, showSizeChanger: false, showTotal: t => `${t} invoices` }}
      onRow={r => ({ onClick: () => onOpen(Number(r.INVOICE_ID), String(r.INVOICE_NUMBER)), style: { cursor: 'pointer' } })}
      columns={[
        { title: 'Invoice', dataIndex: 'INVOICE_NUMBER', render: v => <a>{v}</a> },
        { title: 'Supplier', dataIndex: 'SUPPLIER', ellipsis: true },
        { title: 'Date', dataIndex: 'INVOICE_DATE', width: 110, render: dayLabel },
        { title: 'Amount', key: 'amt', width: 150, align: 'right', render: (_: unknown, r: SqlRow) => `${r.CCY} ${money(Number(r.INVOICE_AMOUNT) || 0)}` },
        { title: 'Validation', dataIndex: 'VALIDATION_STATUS', width: 130, render: v => v || '—' },
        { title: 'Approval', dataIndex: 'APPROVAL_STATUS', width: 130, render: v => v || '—' },
        { title: 'Accounting', dataIndex: 'ACCOUNTING_STATUS', width: 130, render: v => v || '—' },
      ]} />
  );
};

export default PayablesDashboard;
