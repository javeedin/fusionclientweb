// Receivables dashboard (top of the AR page): what customers owe, how late it is, who owes most, cash coming in and
// what needs attention. Every figure is direct SQL through the read gateway — see receivablesDashboard.service.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Modal, Row, Skeleton, Space, Table, Tooltip, Typography, message } from 'antd';
import {
  CheckCircleOutlined, CodeOutlined, CopyOutlined, ExclamationCircleOutlined, FileTextOutlined, ReloadOutlined,
  WalletOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  AGES, FUNCTIONAL_CCY, loadOpenInvoices, loadReceivablesDashboard,
  type ArData, type OpenInvoice, type UnappliedReceipt,
} from '../../services/receivablesDashboard.service';

const { Text } = Typography;

// ink + chart tokens (validated: ordinal blue ramp and the two-shade pair on the white card surface)
const INK = { primary: '#1f1f1f', secondary: '#595959', muted: '#8c8c8c', hairline: '#f0f0f0' };
const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];   // 1–30 days → over 180 days
const DEEMPHASIS = '#c3c2b7';
const LIGHT = '#86b6ef', DARK = '#1c5cab';                                // current / overdue · billed / received
const STATUS = { critical: '#d03b3b', warning: '#d48806', good: '#0ca30c' };

const money = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${money(v / 1e6, 2)}M` : Math.abs(v) >= 1e3 ? `${money(v / 1e3, 1)}K` : money(v, 0));
const card: React.CSSProperties = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 20, height: '100%', boxSizing: 'border-box' };
const clickable = (on: boolean): React.CSSProperties => (on ? { cursor: 'pointer' } : {});
const swatch = (c: string) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 4, verticalAlign: -1 }} />;

const ReceivablesDashboard: React.FC<{ businessUnit: string; onNavigate: (path: string) => void }> = ({ businessUnit, onNavigate }) => {
  const [data, setData] = useState<ArData | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<{ title: string; rows: OpenInvoice[] | null } | null>(null);
  const [receipts, setReceipts] = useState<UnappliedReceipt[] | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadReceivablesDashboard(businessUnit)); }
    catch (e) { message.error(`Receivables dashboard: ${e instanceof Error ? e.message : e}`); }
    finally { setLoading(false); }
  }, [businessUnit]);
  useEffect(() => { load(); }, [load]);

  const showInvoices = async (title: string, filter: string) => {
    setList({ title, rows: null });
    try { setList({ title, rows: await loadOpenInvoices(businessUnit, filter) }); }
    catch (e) { setList(null); message.error(e instanceof Error ? e.message : String(e)); }
  };

  if (loading && !data) {
    return <div style={{ marginBottom: 32 }}><Row gutter={[16, 16]}>{[9, 5, 5, 5].map((w, i) => (
      <Col key={i} xs={24} sm={12} lg={w}><div style={card}><Skeleton active paragraph={{ rows: 2 }} /></div></Col>))}</Row></div>;
  }
  if (!data) return null;

  const overduePct = data.open ? Math.round((data.overdue / data.open) * 100) : 0;
  const maxAge = Math.max(1, ...data.ages.map(a => a.aed));
  const maxCust = Math.max(1, ...data.topCustomers.map(c => c.aed));
  const maxMonth = Math.max(1, ...data.months.flatMap(m => [m.billed, m.received]));
  // 91–180 and over 180 days (an invoice with installments in both counts in each)
  const over90 = data.ages.filter(a => a.key === 'D180' || a.key === 'OVER').reduce((t, a) => t + a.invoices, 0);
  const attention = [
    { key: 'over90', label: 'Overdue more than 90 days', count: over90, hint: 'invoices — follow up or provide for them', icon: <WarningOutlined style={{ color: STATUS.critical }} />,
      go: () => showInvoices('Overdue more than 90 days', 'OVER90') },
    { key: 'unapplied', label: 'Receipts not fully applied', count: data.unapplied.length, hint: `${FUNCTIONAL_CCY} ${money(data.unappliedAed)} cash not matched to invoices`,
      icon: <WalletOutlined style={{ color: STATUS.warning }} />, go: () => setReceipts(data.unapplied) },
    { key: 'incomplete', label: 'Incomplete invoices', count: data.attention.incomplete, hint: 'not completed — they are not receivable yet',
      icon: <FileTextOutlined style={{ color: STATUS.warning }} />, go: () => onNavigate('/ar/manage-receivables') },
    { key: 'disputed', label: 'Disputed installments', count: data.attention.disputed, hint: 'customer disputes on open balances',
      icon: <ExclamationCircleOutlined style={{ color: STATUS.warning }} />, go: () => onNavigate('/ar/manage-receivables') },
    { key: 'research', label: 'Adjustments needing research', count: data.attention.adjResearch, hint: 'status “More Research Required”',
      icon: <ExclamationCircleOutlined style={{ color: STATUS.warning }} />, go: () => onNavigate('/ar/manage-adjustments') },
  ];

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: INK.muted }}>Live from the database{businessUnit ? ` · ${businessUnit}` : ''} · as of {data.asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
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
          <div style={{ ...card, ...clickable(data.invoices > 0) }} onClick={() => data.invoices && showInvoices('Open invoices', 'ALL')}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>Customers owe</Text>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '6px 0 4px' }}>
              <span style={{ fontSize: 15, color: INK.secondary }}>{FUNCTIONAL_CCY}</span>
              <span style={{ fontSize: 'clamp(30px, 3.2vw, 44px)', fontWeight: 600, color: INK.primary, lineHeight: 1.15 }}>{money(data.open)}</span>
            </div>
            <Text style={{ fontSize: 13, color: INK.secondary }}>{data.invoices.toLocaleString()} open invoice{data.invoices === 1 ? '' : 's'} · {data.customersOwing.toLocaleString()} customer{data.customersOwing === 1 ? '' : 's'}</Text>
            {data.open > 0 && <>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, margin: '12px 0 6px' }}>
                <div style={{ width: `${100 - overduePct}%`, background: LIGHT }} />
                {overduePct > 0 && <div style={{ width: `${overduePct}%`, background: DARK }} />}
              </div>
              <Space size={14} style={{ fontSize: 12, color: INK.secondary }}>
                <span>{swatch(LIGHT)}Not yet due {money(data.open - data.overdue, 0)}</span>
                <span>{swatch(DARK)}Overdue {money(data.overdue, 0)} ({overduePct}%)</span>
              </Space>
            </>}
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(data.overdue > 0) }} onClick={() => data.overdue && showInvoices('Overdue invoices', 'OVERDUE')}>
            <Space size={6}>{data.overdue > 0 ? <WarningOutlined style={{ color: STATUS.warning }} /> : <CheckCircleOutlined style={{ color: STATUS.good }} />}
              <Text style={{ fontSize: 13, color: INK.secondary }}>Overdue</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{compact(data.overdue)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>{data.overdue > 0 ? `${data.overdueInvoices.toLocaleString()} invoice${data.overdueInvoices === 1 ? '' : 's'} past their due date` : 'nothing is past due'}</Text>
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(true) }} onClick={() => onNavigate('/ar/manage-receipts')}>
            <Text style={{ fontSize: 13, color: INK.secondary }}>Received this month</Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{compact(data.receivedThisMonth)}</div>
            <Tooltip title="Days sales outstanding: open balance ÷ invoices billed in the last 90 days × 90">
              <Text style={{ fontSize: 12, color: INK.secondary }}>{data.dso != null ? <>DSO <b>{data.dso}</b> days</> : 'DSO — nothing billed in 90 days'}</Text>
            </Tooltip>
          </div>
        </Col>
        <Col xs={24} sm={8} lg={5}>
          <div style={{ ...card, ...clickable(data.unapplied.length > 0) }} onClick={() => data.unapplied.length && setReceipts(data.unapplied)}>
            <Space size={6}><WalletOutlined style={{ color: data.unapplied.length ? STATUS.warning : INK.muted }} /><Text style={{ fontSize: 13, color: INK.secondary }}>Unapplied cash</Text></Space>
            <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, margin: '6px 0 4px' }}>{compact(data.unappliedAed)}</div>
            <Text style={{ fontSize: 12, color: INK.secondary }}>{data.unapplied.length ? `${data.unapplied.length} receipt${data.unapplied.length === 1 ? '' : 's'} to apply to invoices` : 'every receipt is applied'}</Text>
          </div>
        </Col>
      </Row>

      {/* ── aging + top customers ──────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>How late it is</Text>
              <Text style={{ fontSize: 11, color: INK.muted }}>days past due · click a bar for the invoices</Text>
            </div>
            {data.ages.map(a => {
              const k = AGES.findIndex(x => x.key === a.key);
              const color = a.key === 'CURRENT' ? DEEMPHASIS : RAMP[k - 1];
              return (
                <Tooltip key={a.key} placement="topLeft" title={`${a.label}: ${a.invoices} invoice${a.invoices === 1 ? '' : 's'} · ${a.customers} customer${a.customers === 1 ? '' : 's'} · ${FUNCTIONAL_CCY} ${money(a.aed)}`}>
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 150px', alignItems: 'center', gap: 10, padding: '6px 0', ...clickable(a.invoices > 0) }}
                    onClick={() => a.invoices && showInvoices(`Open — ${a.label.toLowerCase()}`, a.key)}>
                    <Text style={{ fontSize: 12, color: INK.secondary }}>{a.label}</Text>
                    <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(a.aed / maxAge) * 100}%`, height: '100%', minWidth: a.aed ? 3 : 0, background: color, borderRadius: '0 4px 4px 0' }} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text style={{ fontSize: 12, color: INK.primary, fontVariantNumeric: 'tabular-nums' }}>{money(a.aed, 0)}</Text>
                      <Text style={{ fontSize: 11, color: INK.muted, marginLeft: 6 }}>{a.invoices}</Text>
                    </div>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>Customers owing the most</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}><span>{swatch(DARK)}Overdue</span><span>{swatch(LIGHT)}Not yet due</span></Space>
            </div>
            {data.topCustomers.length === 0 && <Text type="secondary">No customer owes anything</Text>}
            {data.topCustomers.map(c => (
              <Tooltip key={c.customer} placement="topLeft"
                title={`${c.customer}: ${FUNCTIONAL_CCY} ${money(c.aed)} · overdue ${money(c.overdueAed)} · ${c.invoices} invoice${c.invoices === 1 ? '' : 's'}${c.maxLate > 0 ? ` · oldest ${c.maxLate} days late` : ''}`}>
                <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 110px', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}
                  onClick={() => showInvoices(`${c.customer} — open invoices`, `CUST:${c.customer}`)}>
                  <Text ellipsis style={{ fontSize: 12, color: INK.secondary }}>{c.customer}</Text>
                  <div style={{ height: 14, background: INK.hairline, borderRadius: 4, overflow: 'hidden', display: 'flex', gap: 2 }}>
                    {c.overdueAed > 0 && <div style={{ width: `${(c.overdueAed / maxCust) * 100}%`, background: DARK, minWidth: 3 }} />}
                    {c.aed - c.overdueAed > 0 && <div style={{ width: `${((c.aed - c.overdueAed) / maxCust) * 100}%`, background: LIGHT, minWidth: 3, borderRadius: '0 4px 4px 0' }} />}
                  </div>
                  <Text style={{ fontSize: 12, color: INK.primary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{compact(c.aed)}</Text>
                </div>
              </Tooltip>
            ))}
          </div>
        </Col>
      </Row>

      {/* ── billed vs received + attention ─────────────────────────────── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text strong style={{ fontSize: 15 }}>Billed and received</Text>
              <Space size={12} style={{ fontSize: 11, color: INK.secondary }}><span>{swatch(LIGHT)}Billed</span><span>{swatch(DARK)}Received</span><span style={{ color: INK.muted }}>{FUNCTIONAL_CCY}</span></Space>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 160, padding: '0 4px', borderBottom: `1px solid ${DEEMPHASIS}` }}>
              {data.months.map(m => (
                <Tooltip key={m.month} title={`${m.label}: billed ${FUNCTIONAL_CCY} ${money(m.billed)} · received ${money(m.received)}`}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '100%' }}>
                    {[m.billed, m.received].map((v, k) => (
                      <div key={k} style={{ width: '42%', height: `${(v / maxMonth) * 130}px`, minHeight: v ? 3 : 0, background: k ? DARK : LIGHT, borderRadius: '4px 4px 0 0' }} />
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
            <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 8 }}>Needs attention</Text>
            {attention.map(a => (
              <div key={a.key} onClick={() => a.count && a.go()}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${INK.hairline}`, ...clickable(a.count > 0) }}>
                {a.count ? a.icon : <CheckCircleOutlined style={{ color: STATUS.good }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: INK.primary }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: INK.muted }}>{a.count ? a.hint : 'none'}</div>
                </div>
                <Text style={{ fontSize: 16, fontWeight: 600, color: a.count ? INK.primary : INK.muted, fontVariantNumeric: 'tabular-nums' }}>{a.count.toLocaleString()}</Text>
              </div>
            ))}
          </div>
        </Col>
      </Row>

      <Modal open={!!list} onCancel={() => setList(null)} width={1050} destroyOnHidden title={list?.title} footer={<Button onClick={() => setList(null)}>Close</Button>}>
        <Table<OpenInvoice> size="small" rowKey="id" loading={!list?.rows} dataSource={list?.rows ?? []}
          pagination={{ pageSize: 12, showSizeChanger: false, showTotal: t => `${t} invoice${t === 1 ? '' : 's'}${t >= 500 ? ' (first 500)' : ''}` }}
          onRow={r => ({ onClick: () => { setList(null); onNavigate(`/ar/invoices/${r.id}`); }, style: { cursor: 'pointer' } })}
          summary={rows => (
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0} colSpan={4}><Text strong>Total ({rows.length})</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={4} />
              <Table.Summary.Cell index={5} align="right"><Text strong>{money(rows.reduce((t, r) => t + r.aed, 0))}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
          )}
          columns={[
            { title: 'Invoice', dataIndex: 'number', width: 150, render: (v: string) => <a>{v}</a> },
            { title: 'Customer', dataIndex: 'customer', ellipsis: true },
            { title: 'Due', dataIndex: 'dueDate', width: 105 },
            { title: 'Late', dataIndex: 'late', width: 90, align: 'right', sorter: (a, b) => a.late - b.late,
              render: (v: number) => (v > 0 ? <span><WarningOutlined style={{ color: v > 90 ? STATUS.critical : STATUS.warning, marginRight: 4 }} />{v} d</span> : <Text type="secondary">not due</Text>) },
            { title: 'Balance', key: 'bal', width: 150, align: 'right', render: (_: unknown, r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}><Text type="secondary" style={{ fontSize: 11 }}>{r.ccy}</Text> {money(r.balance)}</span> },
            { title: FUNCTIONAL_CCY, dataIndex: 'aed', width: 140, align: 'right', sorter: (a, b) => a.aed - b.aed, render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span> },
          ]} />
      </Modal>

      <Modal open={!!receipts} onCancel={() => setReceipts(null)} width={950} destroyOnHidden title="Receipts not fully applied"
        footer={<Space><Button onClick={() => { setReceipts(null); onNavigate('/ar/manage-receipts'); }}>Open Receipts</Button><Button onClick={() => setReceipts(null)}>Close</Button></Space>}>
        <Table<UnappliedReceipt> size="small" rowKey="id" dataSource={receipts ?? []} pagination={{ pageSize: 12, showSizeChanger: false }}
          columns={[
            { title: 'Receipt', dataIndex: 'number', width: 150 },
            { title: 'Customer', dataIndex: 'customer', ellipsis: true },
            { title: 'Date', dataIndex: 'date', width: 105 },
            { title: 'Age', dataIndex: 'age', width: 80, align: 'right', sorter: (a, b) => a.age - b.age, render: (v: number) => `${v} d` },
            { title: 'Unapplied', key: 'u', width: 150, align: 'right', render: (_: unknown, r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}><Text type="secondary" style={{ fontSize: 11 }}>{r.ccy}</Text> {money(r.unapplied)}</span> },
            { title: FUNCTIONAL_CCY, dataIndex: 'aed', width: 130, align: 'right', render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span> },
          ]} />
      </Modal>

      <Modal open={sqlOpen} onCancel={() => setSqlOpen(false)} width={960} footer={<Button onClick={() => setSqlOpen(false)}>Close</Button>}
        title={<Space><CodeOutlined />SQL behind the dashboard<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>POST ai/executequery</Text></Space>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
          Open balance = installments' balance due (reduced by receipts applied here and in Fusion), else the invoice balance; void invoices left out.
          Due = installment due date, else invoice due date, else transaction date. Amounts in {FUNCTIONAL_CCY} at each document's rate.
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

export default ReceivablesDashboard;
