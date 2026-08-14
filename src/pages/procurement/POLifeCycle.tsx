import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import {
  Modal, Tabs, Table, Tag, Typography, Row, Col, Card, Spin, Empty, Space,
  Button, Tooltip, Segmented, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FUSION_POD_AUTH } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';
import {
  HistoryOutlined, FolderOpenOutlined, FileTextOutlined,
  ReloadOutlined, ApiOutlined, InfoCircleOutlined, DollarOutlined,
  InboxOutlined, RollbackOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, PieChart, Pie, Legend, AreaChart, Area,
  ComposedChart, Line,
} from 'recharts';

const { Text } = Typography;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};

// ── Redwood palette ──────────────────────────────────────────────────────────
const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#B07700', info: '#0572CE', error: '#D93025',
  teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const CHART_COLORS = ['#C74634', '#0572CE', '#1D7B4D', '#B07700', '#7245A6', '#00918A', '#E85D4A', '#D93025'];

// ── Fusion config ────────────────────────────────────────────────────────────
const BASE_URL = `${getFusionBase()}`;
const AUTH_HEADER = FUSION_POD_AUTH;
const CHILD_LIMIT = 500;
// Fusion's canonical resource capitalises the C (LifeCycle); some versions use
// a lowercase c — try the canonical form first, fall back on 404.
const LC_RESOURCES = ['purchaseOrderLifeCycleDetails', 'purchaseOrderLifecycleDetails'];

const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = stripped.includes('?') ? '&' : '?';
    const url = `${stripped}${sep}limit=${CHILD_LIMIT}&offset=${offset}`;
    const r = await fetch(url, { headers: { Authorization: AUTH_HEADER, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < CHILD_LIMIT) break;
    offset += CHILD_LIMIT;
  }
  return all;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const fmtAmt = (v?: number | null, ccy?: string) => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return ccy ? `${s} ${ccy}` : s;
};
const fmtQty = (v?: number | null) => (v == null ? '—' : new Intl.NumberFormat('en-US').format(v));
const fmtDate = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; } };
const compact = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  return String(v);
};

interface POLite { POHeaderId: number; OrderNumber?: string; CurrencyCode?: string; Supplier?: string; }

// ── KPI card ──────────────────────────────────────────────────────────────────
const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: string; color?: string; icon?: React.ReactNode }> =
  ({ label, value, sub, color = REDWOOD.neutral900, icon }) => (
  <Card size="small" styles={{ body: { padding: '12px 14px' } }}
    style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, height: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon} {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2 }}>{sub}</div>}
  </Card>
);

const ChartCard: React.FC<{ title: string; children: React.ReactNode; height?: number }> = ({ title, children, height = 260 }) => (
  <Card size="small" title={<Text style={{ fontSize: 12, fontWeight: 700 }}>{title}</Text>}
    styles={{ body: { padding: 10 } }}
    style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
    <div style={{ width: '100%', height }}>{children}</div>
  </Card>
);

const EmptyChart: React.FC<{ msg?: string }> = ({ msg = 'No data' }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: REDWOOD.neutral600, fontSize: 12 }}>{msg}</div>
);

// ── Main modal ────────────────────────────────────────────────────────────────
interface LcSummary { receipts: boolean; invoices: boolean; payment: boolean }

// Detect a paid invoice from its status fields.
const isPaidInvoice = (r: any) => {
  const s = String(r?.InvoiceStatus ?? r?.InvoiceStatusCode ?? '').toUpperCase();
  return s.includes('PAID') && !s.includes('UNPAID') && !s.includes('PARTIAL');
};

const POLifeCycleModal: React.FC<{
  po: POLite | null;
  open: boolean;
  onClose: () => void;
  onLoaded?: (poHeaderId: number, summary: LcSummary) => void;
}> = ({ po, open, onClose, onLoaded }) => {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fetched, setFetched]   = useState(false);
  const [tab, setTab]           = useState('overview');
  const [rcView, setRcView]     = useState<'summary' | 'detail'>('summary');
  const [invView, setInvView]   = useState<'summary' | 'detail'>('summary');
  const [urls, setUrls]         = useState<{ receipts: string; invoices: string }>({
    receipts: `${BASE_URL}/${LC_RESOURCES[0]}/${po?.POHeaderId}/child/receipts`,
    invoices: `${BASE_URL}/${LC_RESOURCES[0]}/${po?.POHeaderId}/child/invoices`,
  });

  const ccy = po?.CurrencyCode
    ?? receipts.find(r => r.CurrencyCode)?.CurrencyCode
    ?? invoices.find(r => r.CurrencyCode)?.CurrencyCode
    ?? '';

  const fetchChild = useCallback(async (headerId: number, child: string): Promise<{ url: string; items: any[] }> => {
    let lastErr: any = null;
    for (const resource of LC_RESOURCES) {
      const url = `${BASE_URL}/${resource}/${headerId}/child/${child}`;
      try { return { url, items: await fetchAllPages(url) }; }
      catch (e: any) { lastErr = e; if (!String(e?.message ?? '').includes('404')) throw e; }
    }
    throw lastErr ?? new Error('Not found');
  }, []);

  const load = useCallback(async (headerId: number) => {
    setLoading(true); setError(null);
    const errs: string[] = [];
    const [rc, inv] = await Promise.allSettled([fetchChild(headerId, 'receipts'), fetchChild(headerId, 'invoices')]);
    const nextUrls = { ...urls };
    let rcItems: any[] = [], invItems: any[] = [];
    if (rc.status === 'fulfilled') { rcItems = rc.value.items; setReceipts(rcItems); nextUrls.receipts = rc.value.url; }
    else errs.push(`Receipts: ${(rc as any).reason?.message ?? 'failed'}`);
    if (inv.status === 'fulfilled') { invItems = inv.value.items; setInvoices(invItems); nextUrls.invoices = inv.value.url; }
    else errs.push(`Invoices: ${(inv as any).reason?.message ?? 'failed'}`);
    setUrls(nextUrls);
    setFetched(true);
    if (errs.length) setError(errs.join('  |  '));
    setLoading(false);
    // Report presence flags back to the Search grid.
    onLoaded?.(headerId, {
      receipts: rcItems.length > 0,
      invoices: invItems.length > 0,
      payment: invItems.some(isPaidInvoice),
    });
  }, [fetchChild, onLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load whenever the modal opens for a PO; reset when the PO changes.
  useEffect(() => {
    if (open && po?.POHeaderId) {
      setReceipts([]); setInvoices([]); setFetched(false); setError(null); setTab('overview');
      setUrls({
        receipts: `${BASE_URL}/${LC_RESOURCES[0]}/${po.POHeaderId}/child/receipts`,
        invoices: `${BASE_URL}/${LC_RESOURCES[0]}/${po.POHeaderId}/child/invoices`,
      });
      load(po.POHeaderId);
    }
  }, [open, po?.POHeaderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analytics ───────────────────────────────────────────────────────────────
  const a = useMemo(() => {
    const distinct = (arr: any[], key: string) => new Set(arr.map(x => x[key]).filter(v => v != null)).size;

    // Receipts
    const rcReceived  = receipts.reduce((s, r) => s + num(r.ReceivedQuantity), 0);
    const rcDelivered = receipts.reduce((s, r) => s + num(r.DeliveredQuantity), 0);
    const rcReturned  = receipts.reduce((s, r) => s + num(r.ReturnedQuantity), 0);
    const rcOpenInvAmt = receipts.reduce((s, r) => s + num(r.OpenToInvoiceAmount), 0);
    const rcCount = distinct(receipts, 'ReceiptId');

    // received quantity trend by ReceiptDate
    const dateMap: Record<string, number> = {};
    receipts.forEach(r => { const d = r.ReceiptDate ?? '—'; dateMap[d] = (dateMap[d] ?? 0) + num(r.ReceivedQuantity); });
    const rcTrend = Object.entries(dateMap).filter(([d]) => d !== '—')
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([date, qty]) => ({ date: fmtDate(date), qty }));

    // received by line (top 12)
    const lineRc: Record<string, { line: string; qty: number; desc: string }> = {};
    receipts.forEach(r => {
      const k = String(r.LineNumberScheduleNumber ?? r.LineNumber ?? '—');
      if (!lineRc[k]) lineRc[k] = { line: k, qty: 0, desc: r.ItemOrScheduleDescription ?? r.LineDescription ?? '' };
      lineRc[k].qty += num(r.ReceivedQuantity);
    });
    const rcByLine = Object.values(lineRc).sort((x, y) => y.qty - x.qty).slice(0, 12);

    // Invoices
    const invMatchedQty = invoices.reduce((s, r) => s + num(r.MatchedQuantity), 0);
    const invMatchedAmt = invoices.reduce((s, r) => s + num(r.MatchedAmount), 0);
    const invCount = distinct(invoices, 'InvoiceId');

    // status breakdown
    const statusMap: Record<string, { name: string; count: number; amt: number }> = {};
    invoices.forEach(r => {
      const s = r.InvoiceStatus ?? r.InvoiceStatusCode ?? 'Unknown';
      if (!statusMap[s]) statusMap[s] = { name: s, count: 0, amt: 0 };
      statusMap[s].count += 1;
      statusMap[s].amt += num(r.MatchedAmount);
    });
    const invStatus = Object.values(statusMap).sort((x, y) => y.amt - x.amt);

    // matched amount trend by InvoicedDate
    const invDateMap: Record<string, number> = {};
    invoices.forEach(r => { const d = r.InvoicedDate ?? '—'; invDateMap[d] = (invDateMap[d] ?? 0) + num(r.MatchedAmount); });
    const invTrend = Object.entries(invDateMap).filter(([d]) => d !== '—')
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([date, amt]) => ({ date: fmtDate(date), amt }));

    // per-line received vs invoiced quantity comparison (top 12 by activity)
    const lineCmp: Record<string, { line: string; received: number; invoiced: number; desc: string }> = {};
    receipts.forEach(r => {
      const k = String(r.LineNumber ?? '—');
      if (!lineCmp[k]) lineCmp[k] = { line: k, received: 0, invoiced: 0, desc: r.ItemOrScheduleDescription ?? r.LineDescription ?? '' };
      lineCmp[k].received += num(r.ReceivedQuantity);
    });
    invoices.forEach(r => {
      const k = String(r.LineNumber ?? '—');
      if (!lineCmp[k]) lineCmp[k] = { line: k, received: 0, invoiced: 0, desc: r.ItemOrScheduleDescription ?? r.LineDescription ?? '' };
      lineCmp[k].invoiced += num(r.MatchedQuantity);
    });
    const lineComparison = Object.values(lineCmp)
      .sort((x, y) => (y.received + y.invoiced) - (x.received + x.invoiced)).slice(0, 12);

    const returns = receipts.filter(r => num(r.ReturnedQuantity) > 0);

    return {
      rcReceived, rcDelivered, rcReturned, rcOpenInvAmt, rcCount,
      rcTrend, rcByLine,
      invMatchedQty, invMatchedAmt, invCount, invStatus, invTrend,
      lineComparison, returns,
    };
  }, [receipts, invoices]);

  // ── Columns ───────────────────────────────────────────────────────────────
  const receiptColumns: ColumnsType<any> = [
    { title: 'Receipt', dataIndex: 'Receipt', width: 120, fixed: 'left',
      render: (v, r) => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v ?? r.ReceiptId ?? '—'}</Text> },
    { title: 'Date', dataIndex: 'ReceiptDate', width: 110, render: fmtDate },
    { title: 'Line', dataIndex: 'LineNumberScheduleNumber', width: 65, align: 'center',
      render: (v, r) => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? r.LineNumber ?? '—'}</Tag> },
    { title: 'Description', dataIndex: 'ItemOrScheduleDescription', ellipsis: true,
      render: (v, r) => <Text style={{ fontSize: 12 }}>{v ?? r.LineDescription ?? '—'}</Text> },
    { title: 'UOM', dataIndex: 'UOM', width: 60, align: 'center', render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Received', dataIndex: 'ReceivedQuantity', width: 95, align: 'right',
      render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', color: REDWOOD.success }}>{fmtQty(v)}</Text> },
    { title: 'Delivered', dataIndex: 'DeliveredQuantity', width: 95, align: 'right', render: fmtQty },
    { title: 'Returned', dataIndex: 'ReturnedQuantity', width: 90, align: 'right',
      render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', color: num(v) > 0 ? REDWOOD.error : REDWOOD.neutral600 }}>{v == null ? '—' : fmtQty(v)}</Text> },
    { title: 'Open to Invoice', dataIndex: 'OpenToInvoiceAmount', width: 130, align: 'right',
      render: v => <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{v == null ? '—' : fmtAmt(v, ccy)}</Text> },
    { title: 'Shipment', dataIndex: 'ShipmentNumber', width: 110, render: v => v ?? '—' },
    { title: 'Received By', dataIndex: 'ReceivedBy', width: 130, ellipsis: true, render: v => v ?? '—' },
  ];

  const invoiceColumns: ColumnsType<any> = [
    { title: 'Invoice', dataIndex: 'Invoice', width: 150, fixed: 'left',
      render: (v, r) => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v ?? r.InvoiceId ?? '—'}</Text> },
    { title: 'Date', dataIndex: 'InvoicedDate', width: 110, render: fmtDate },
    { title: 'Status', dataIndex: 'InvoiceStatus', width: 100,
      render: (v, r) => {
        const s = v ?? r.InvoiceStatusCode ?? '—';
        const up = String(s).toUpperCase();
        const color = up.includes('PAID') && !up.includes('UNPAID') ? 'green' : up.includes('UNPAID') ? 'orange' : up.includes('HOLD') ? 'red' : 'default';
        return <Tag color={color} style={{ fontSize: 11 }}>{s}</Tag>;
      } },
    { title: 'Type', dataIndex: 'InvoiceType', width: 90, render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Line', dataIndex: 'LineNumberScheduleNumber', width: 65, align: 'center',
      render: (v, r) => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? r.LineNumber ?? '—'}</Tag> },
    { title: 'Description', dataIndex: 'ItemOrScheduleDescription', ellipsis: true,
      render: (v, r) => <Text style={{ fontSize: 12 }}>{v ?? r.LineDescription ?? '—'}</Text> },
    { title: 'Matched Qty', dataIndex: 'MatchedQuantity', width: 105, align: 'right', render: fmtQty },
    { title: 'Matched Amount', dataIndex: 'MatchedAmount', width: 140, align: 'right',
      render: v => <Text strong style={{ fontVariantNumeric: 'tabular-nums', color: REDWOOD.primary }}>{fmtAmt(v, ccy)}</Text> },
    { title: 'Hold Reason', dataIndex: 'HoldReasonCode', width: 120, render: v => v ?? '—' },
    { title: 'Receipt', dataIndex: 'Receipt', width: 120, render: v => v ?? '—' },
  ];

  // ── Renderers ───────────────────────────────────────────────────────────────
  const overviewTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Row gutter={[10, 10]}>
        <Col xs={12} sm={8} md={4}><Kpi label="Receipts" value={a.rcCount} icon={<FolderOpenOutlined />} color={REDWOOD.info} /></Col>
        <Col xs={12} sm={8} md={4}><Kpi label="Received Qty" value={fmtQty(a.rcReceived)} icon={<InboxOutlined />} color={REDWOOD.success} /></Col>
        <Col xs={12} sm={8} md={4}><Kpi label="Returned Qty" value={fmtQty(a.rcReturned)} icon={<RollbackOutlined />} color={a.rcReturned > 0 ? REDWOOD.error : REDWOOD.neutral900} /></Col>
        <Col xs={12} sm={8} md={4}><Kpi label="Invoices" value={a.invCount} icon={<FileTextOutlined />} color={REDWOOD.purple} /></Col>
        <Col xs={12} sm={8} md={4}><Kpi label="Matched Amt" value={compact(a.invMatchedAmt)} sub={ccy} icon={<DollarOutlined />} color={REDWOOD.primary} /></Col>
        <Col xs={12} sm={8} md={4}><Kpi label="Open to Invoice" value={compact(a.rcOpenInvAmt)} sub={ccy} icon={<DollarOutlined />} color={REDWOOD.warning} /></Col>
      </Row>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={14}>
          <ChartCard title="Received vs Invoiced quantity — by line (top 12)">
            {a.lineComparison.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer>
                <BarChart data={a.lineComparison} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="line" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} />
                  <RTooltip formatter={(v: any) => fmtQty(Number(v))}
                    labelFormatter={(l: any) => { const row = a.lineComparison.find(x => x.line === l); return `Line ${l}${row?.desc ? ' — ' + row.desc : ''}`; }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="received" name="Received" fill={REDWOOD.success} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="invoiced" name="Invoiced" fill={REDWOOD.primary} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Col>
        <Col xs={24} md={10}>
          <ChartCard title={`Invoice amount by status (${ccy})`}>
            {a.invStatus.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={a.invStatus} dataKey="amt" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                    label={(e: any) => `${e.name}: ${compact(e.amt)}`} labelLine={false} style={{ fontSize: 11 }}>
                    {a.invStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <RTooltip formatter={(v: any) => fmtAmt(Number(v), ccy)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Col>
      </Row>
      <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
        <InfoCircleOutlined style={{ marginRight: 6 }} />
        Delivered {fmtQty(a.rcDelivered)} · Matched quantity {fmtQty(a.invMatchedQty)} · Returns are receipt rows carrying a returned quantity.
      </div>
    </div>
  );

  const receiptsTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size={6}>
          <Tag color="blue">{a.rcCount} receipt{a.rcCount !== 1 ? 's' : ''}</Tag>
          <Tag color="green">Received {fmtQty(a.rcReceived)}</Tag>
          <Tag>Delivered {fmtQty(a.rcDelivered)}</Tag>
          {a.rcReturned > 0 && <Tag color="red">Returned {fmtQty(a.rcReturned)}</Tag>}
        </Space>
        <Segmented size="small" value={rcView} onChange={v => setRcView(v as any)}
          options={[{ label: 'Summary', value: 'summary' }, { label: 'Detail', value: 'detail' }]} />
      </div>
      {rcView === 'summary' ? (
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <ChartCard title="Received quantity over time">
              {a.rcTrend.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer>
                  <AreaChart data={a.rcTrend} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <defs><linearGradient id="rcArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={REDWOOD.success} stopOpacity={0.7} />
                      <stop offset="95%" stopColor={REDWOOD.success} stopOpacity={0.05} />
                    </linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} />
                    <RTooltip formatter={(v: any) => fmtQty(Number(v))} />
                    <Area type="monotone" dataKey="qty" name="Received" stroke={REDWOOD.success} fill="url(#rcArea)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </Col>
          <Col xs={24} md={12}>
            <ChartCard title="Received quantity by line (top 12)">
              {a.rcByLine.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer>
                  <BarChart data={a.rcByLine} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={compact} />
                    <YAxis type="category" dataKey="line" tick={{ fontSize: 11 }} width={48} />
                    <RTooltip formatter={(v: any) => fmtQty(Number(v))}
                      labelFormatter={(l: any) => { const row = a.rcByLine.find(x => x.line === l); return `Line ${l}${row?.desc ? ' — ' + row.desc : ''}`; }} />
                    <Bar dataKey="qty" name="Received" fill={REDWOOD.info} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </Col>
        </Row>
      ) : receipts.length === 0 ? <Empty description="No receipts" style={{ padding: 40 }} /> : (
        <Table columns={receiptColumns} dataSource={receipts} rowKey={(_, i) => `rc-${i}`} size="small"
          pagination={receipts.length > 25 ? { pageSize: 25, size: 'small' } : false} scroll={{ x: 1250, y: 340 }} />
      )}
    </div>
  );

  const invoicesTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size={6}>
          <Tag color="purple">{a.invCount} invoice{a.invCount !== 1 ? 's' : ''}</Tag>
          <Tag color="red">Matched {fmtAmt(a.invMatchedAmt, ccy)}</Tag>
          <Tag>Qty {fmtQty(a.invMatchedQty)}</Tag>
        </Space>
        <Segmented size="small" value={invView} onChange={v => setInvView(v as any)}
          options={[{ label: 'Summary', value: 'summary' }, { label: 'Detail', value: 'detail' }]} />
      </div>
      {invView === 'summary' ? (
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <ChartCard title={`Matched amount over time (${ccy})`}>
              {a.invTrend.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer>
                  <ComposedChart data={a.invTrend} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} />
                    <RTooltip formatter={(v: any) => fmtAmt(Number(v), ccy)} />
                    <Bar dataKey="amt" name="Matched" fill={REDWOOD.primary} radius={[3, 3, 0, 0]} barSize={28} />
                    <Line type="monotone" dataKey="amt" stroke={REDWOOD.warning} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </Col>
          <Col xs={24} md={12}>
            <ChartCard title="Invoice count by status">
              {a.invStatus.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer>
                  <BarChart data={a.invStatus} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="count" name="Invoices" radius={[3, 3, 0, 0]}>
                      {a.invStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </Col>
        </Row>
      ) : invoices.length === 0 ? <Empty description="No invoices" style={{ padding: 40 }} /> : (
        <Table columns={invoiceColumns} dataSource={invoices} rowKey={(_, i) => `inv-${i}`} size="small"
          pagination={invoices.length > 25 ? { pageSize: 25, size: 'small' } : false} scroll={{ x: 1250, y: 340 }} />
      )}
    </div>
  );

  const returnsTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space size={6}>
        <Tag color="red">{a.returns.length} return line{a.returns.length !== 1 ? 's' : ''}</Tag>
        <Tag>Returned Qty {fmtQty(a.rcReturned)}</Tag>
      </Space>
      {a.returns.length === 0 ? <Empty description="No returns found for this order" style={{ padding: 48 }} /> : (
        <Table columns={receiptColumns} dataSource={a.returns} rowKey={(_, i) => `ret-${i}`} size="small"
          pagination={false} scroll={{ x: 1250, y: 380 }} />
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1160}
      style={{ top: 24 }}
      styles={{ body: { paddingTop: 8 } }}
      title={
        <Space>
          <HistoryOutlined style={{ color: REDWOOD.primary }} />
          <span>Purchase Order Life Cycle</span>
          {po?.OrderNumber && <Tag color="volcano" style={{ fontSize: 12 }}>{po.OrderNumber}</Tag>}
          {po?.Supplier && <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{po.Supplier}</Text>}
        </Space>
      }
    >
      {loading && !fetched ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Spin size="large" tip="Loading receipts & invoices…" />
        </div>
      ) : (
        <>
          {error && (
            <div style={{ padding: 10, marginBottom: 12, color: REDWOOD.error, background: REDWOOD.error + '10', borderRadius: 6, fontSize: 12 }}>
              <InfoCircleOutlined style={{ marginRight: 8 }} />{error}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
            <Tooltip title={<div style={{ fontSize: 11 }}>
              <div style={{ marginBottom: 4 }}><b>Receipts</b></div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{urls.receipts}</div>
              <div style={{ margin: '6px 0 4px' }}><b>Invoices</b></div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{urls.invoices}</div>
            </div>}>
              <Button size="small" icon={<ApiOutlined />} style={{ borderColor: REDWOOD.info, color: REDWOOD.info, fontSize: 11 }}
                onClick={() => { navigator.clipboard.writeText(`${urls.receipts}\n${urls.invoices}`); message.success('Endpoint URLs copied'); }}>
                API
              </Button>
            </Tooltip>
            <Button size="small" icon={<ReloadOutlined />} loading={loading}
              onClick={() => po?.POHeaderId && load(po.POHeaderId)} style={{ fontSize: 11 }}>
              Refresh
            </Button>
          </div>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            size="small"
            items={[
              { key: 'overview', label: <span><HistoryOutlined style={{ marginRight: 5 }} />Overview</span>, children: overviewTab },
              { key: 'receipts', label: <span><FolderOpenOutlined style={{ marginRight: 5 }} />Receipts ({receipts.length})</span>, children: receiptsTab },
              { key: 'invoices', label: <span><FileTextOutlined style={{ marginRight: 5 }} />Invoices ({invoices.length})</span>, children: invoicesTab },
              { key: 'returns', label: <span><RollbackOutlined style={{ marginRight: 5 }} />Returns ({a.returns.length})</span>, children: returnsTab },
            ]}
          />
        </>
      )}
    </Modal>
  );
};

export default POLifeCycleModal;
