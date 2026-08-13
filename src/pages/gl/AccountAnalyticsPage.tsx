import { buildApexUrl } from '../config/api.helper';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Card, Row, Col, Typography, Space, Button, Table, Tag, Select,
  Tooltip, Input, Spin, Empty, Badge, Progress, Segmented, Statistic,
  Divider,
} from 'antd';
import {
  CloseOutlined, RiseOutlined, FallOutlined, BarChartOutlined,
  LineChartOutlined, SendOutlined, RobotOutlined, UserOutlined,
  BulbOutlined, DollarOutlined, ShoppingCartOutlined, SwapOutlined,
  FireOutlined, ArrowUpOutlined, ArrowDownOutlined, FundOutlined,
  CalendarOutlined, ThunderboltOutlined, TrophyOutlined,
} from '@ant-design/icons';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ─── Types ────────────────────────────────────────────────────────────────────
interface JournalLine {
  key: string;
  concatenatedSegments: string;
  accountDescription: string;
  jeLineDescription: string;
  defaultPeriodName: string;
  accountingDate: string;
  batchName: string;
  userJeSourceName: string;
  userJeCategoryName: string;
  currencyCode: string;
  enteredDr: number;
  enteredCr: number;
  accountedDr: number;
  accountedCr: number;
  jeHeaderId: number;
  segAccount?: string;
  segSubAcct?: string;
  segCompany?: string;
  isOpeningBalance?: boolean;
  isClosingBalance?: boolean;
  isTotals?: boolean;
  _accBal?: number;
}

interface Props {
  rows: JournalLine[];
  functionalCcy: string;
  onClose: () => void;
}

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  primary:  '#C74634',
  blue:     '#1565C0',
  green:    '#1D7B4D',
  purple:   '#6B4C9A',
  teal:     '#00695C',
  orange:   '#E65100',
  gold:     '#B8860B',
  bg:       '#F0F2F5',
  chart:    { dr: '#1D7B4D', cr: '#C74634', bal: '#1565C0', net: '#6B4C9A' },
};

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtN  = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtM  = (v: number) => {
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(v) >= 1_000_000)     return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)         return `${(v / 1_000).toFixed(1)}K`;
  return fmtN(v);
};
const chartFmt = (v: number) => fmtM(v);

// ─── Detect transaction type ──────────────────────────────────────────────────
const txnType = (desc: string): 'BUY' | 'SELL' | 'REVAL' | 'COST' | 'OTHER' => {
  const d = desc.toUpperCase();
  if (d.includes('BUY'))                               return 'BUY';
  if (d.includes('SELL') || d.includes('DISP'))        return 'SELL';
  if (d.includes('REVAL') || d.includes('FAIRVALUE') || d.includes('F1038') || d.includes('FAIR')) return 'REVAL';
  if (d.includes('STT') || d.includes('BROKERAGE') || d.includes('CHARGE') || d.includes('COST') || d.includes('G COST')) return 'COST';
  return 'OTHER';
};

const TYPE_CFG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  BUY:   { color: C.green,   bg: '#f6ffed', icon: <ShoppingCartOutlined />, label: 'Purchases' },
  SELL:  { color: C.primary, bg: '#fff1f0', icon: <DollarOutlined />,       label: 'Sales/Disposals' },
  REVAL: { color: C.purple,  bg: '#f9f0ff', icon: <SwapOutlined />,         label: 'Revaluations' },
  COST:  { color: C.orange,  bg: '#fff7e6', icon: <FireOutlined />,          label: 'Charges & Costs' },
  OTHER: { color: C.teal,    bg: '#e6fffb', icon: <BarChartOutlined />,      label: 'Other' },
};

// ─── Period sort ──────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const periodKey = (p: string) => {
  const [mon, yr] = (p ?? '').split('-');
  const mi = MONTHS.indexOf(mon ?? '');
  const y  = parseInt(yr ?? '0') + (parseInt(yr ?? '0') < 50 ? 2000 : 1900);
  return y * 12 + (mi >= 0 ? mi : 0);
};

// ─── Chat ────────────────────────────────────────────────────────────────────
interface ChatMsg { role: 'user' | 'assistant'; content: string; loading?: boolean; }
const CLAUDE_API = buildApexUrl('ai/chat');

// ─── Recharts custom tooltip ──────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label, ccy }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#262626' }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmtM(p.value ?? 0)} {ccy}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const AccountAnalyticsPage: React.FC<Props> = ({ rows, functionalCcy, onClose }) => {

  // strip sentinel rows
  const dataRows = useMemo(() => rows.filter(r => !r.isOpeningBalance && !r.isClosingBalance && !r.isTotals), [rows]);

  // opening balance from sentinel row
  const openingBal = useMemo(() => {
    const ob = rows.find(r => r.isOpeningBalance);
    return ob ? (ob.accountedDr - ob.accountedCr) : 0;
  }, [rows]);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [selPeriod, setSelPeriod] = useState('ALL');
  const [selType,   setSelType]   = useState('ALL');
  const [trendMetric, setTrendMetric] = useState<'balance' | 'debit' | 'credit' | 'net'>('balance');

  const periods = useMemo(() => [...new Set(dataRows.map(r => r.defaultPeriodName).filter(Boolean))].sort((a, b) => periodKey(a) - periodKey(b)), [dataRows]);

  const filtered = useMemo(() => dataRows.filter(r =>
    (selPeriod === 'ALL' || r.defaultPeriodName === selPeriod) &&
    (selType   === 'ALL' || txnType(r.jeLineDescription) === selType)
  ), [dataRows, selPeriod, selType]);

  // ── Period aggregates with running balance ────────────────────────────────────
  const periodData = useMemo(() => {
    const map = new Map<string, { dr: number; cr: number; count: number }>();
    dataRows.forEach(r => {
      const p = r.defaultPeriodName; if (!p) return;
      const e = map.get(p) ?? { dr: 0, cr: 0, count: 0 };
      e.dr += r.accountedDr; e.cr += r.accountedCr; e.count++;
      map.set(p, e);
    });
    let runBal = openingBal;
    return periods.map(p => {
      const e = map.get(p) ?? { dr: 0, cr: 0, count: 0 };
      runBal += e.dr - e.cr;
      return { period: p, debit: e.dr, credit: e.cr, balance: runBal, net: e.dr - e.cr, count: e.count };
    }).filter(p => p.count > 0 || map.has(p));
  }, [dataRows, periods, openingBal]);

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const totalDr   = useMemo(() => filtered.reduce((s, r) => s + r.accountedDr, 0), [filtered]);
  const totalCr   = useMemo(() => filtered.reduce((s, r) => s + r.accountedCr, 0), [filtered]);
  const netMvt    = totalDr - totalCr;
  const closingBal = useMemo(() => {
    const last = periodData[periodData.length - 1];
    return last?.balance ?? 0;
  }, [periodData]);
  const peakBal   = useMemo(() => Math.max(...periodData.map(p => p.balance), 0), [periodData]);
  const peakPeriod = useMemo(() => periodData.find(p => p.balance === peakBal)?.period ?? '—', [periodData, peakBal]);
  const avgMonthlyDr = periodData.length ? totalDr / periodData.length : 0;
  const buyTotal  = useMemo(() => filtered.filter(r => txnType(r.jeLineDescription) === 'BUY').reduce((s, r) => s + r.accountedDr, 0), [filtered]);
  const revalTotal = useMemo(() => filtered.filter(r => txnType(r.jeLineDescription) === 'REVAL').reduce((s, r) => s + r.accountedDr - r.accountedCr, 0), [filtered]);
  const costTotal  = useMemo(() => filtered.filter(r => txnType(r.jeLineDescription) === 'COST').reduce((s, r) => s + r.accountedDr, 0), [filtered]);

  // highest single debit period
  const highDrPeriod = useMemo(() => periodData.reduce((best, p) => p.debit > best.debit ? p : best, { period: '—', debit: 0 }), [periodData]);

  // ── Type breakdown ────────────────────────────────────────────────────────────
  const typeBreakdown = useMemo(() => {
    const map: Record<string, { dr: number; cr: number; count: number }> = {};
    filtered.forEach(r => {
      const t = txnType(r.jeLineDescription);
      if (!map[t]) map[t] = { dr: 0, cr: 0, count: 0 };
      map[t].dr += r.accountedDr; map[t].cr += r.accountedCr; map[t].count++;
    });
    return Object.entries(map).sort((a, b) => (b[1].dr + b[1].cr) - (a[1].dr + a[1].cr));
  }, [filtered]);

  // ── Source breakdown ─────────────────────────────────────────────────────────
  const sourceData = useMemo(() => {
    const map: Record<string, { dr: number; cr: number; count: number }> = {};
    filtered.forEach(r => {
      const s = r.userJeSourceName || 'Unknown';
      if (!map[s]) map[s] = { dr: 0, cr: 0, count: 0 };
      map[s].dr += r.accountedDr; map[s].cr += r.accountedCr; map[s].count++;
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
  }, [filtered]);

  // ── Type bar chart data ───────────────────────────────────────────────────────
  const typeBarData = useMemo(() => typeBreakdown.map(([type, v]) => ({
    type: TYPE_CFG[type]?.label ?? type,
    debit: v.dr, credit: v.cr, count: v.count,
  })), [typeBreakdown]);

  // ── Top transactions ──────────────────────────────────────────────────────────
  const topDr  = useMemo(() => [...filtered].sort((a, b) => b.accountedDr - a.accountedDr).slice(0, 8), [filtered]);
  const topCr  = useMemo(() => [...filtered].sort((a, b) => b.accountedCr - a.accountedCr).slice(0, 5), [filtered]);

  // ── Chatbot ───────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([{
    role: 'assistant',
    content: `Hello! I'm your AI financial analyst. I can see **${dataRows.length} transactions** across **${periods.length} periods**.\n\n• Opening Balance: **${fmtM(openingBal)} ${functionalCcy}**\n• Closing Balance: **${fmtM(closingBal)} ${functionalCcy}**\n• Total Invested: **${fmtM(dataRows.reduce((s, r) => s + r.accountedDr, 0))} ${functionalCcy}**\n\nAsk me about trends, performance, specific periods, or any transaction patterns.`,
  }]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }, { role: 'assistant', content: '', loading: true }]);
    setChatLoading(true);
    try {
      const ctx = {
        totalTransactions: filtered.length, periods, openingBalance: openingBal,
        closingBalance: closingBal, totalDebit: totalDr, totalCredit: totalCr,
        netMovement: netMvt, peakBalance: peakBal, peakPeriod,
        avgMonthlyInvestment: avgMonthlyDr, currency: functionalCcy,
        byType: Object.fromEntries(typeBreakdown.map(([k, v]) => [k, v])),
        bySource: Object.fromEntries(sourceData.map(s => [s.name, { dr: s.dr, cr: s.cr, count: s.count }])),
        periodTrend: periodData.map(p => ({ period: p.period, debit: p.debit, credit: p.credit, balance: p.balance, net: p.net })),
        top5Transactions: topDr.slice(0, 5).map(r => ({ desc: r.jeLineDescription.substring(0, 100), amount: r.accountedDr, period: r.defaultPeriodName })),
      };
      const res  = await fetch(CLAUDE_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are a financial analyst for an ERP system. Analyze GL journal data. Data:\n${JSON.stringify(ctx, null, 2)}\n\nBe concise and specific. Use bullet points. Reference actual figures.`,
          message: userMsg,
        }),
      });
      const json = await res.json();
      const reply = json.response ?? json.content ?? json.message ?? 'No response.';
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { role: 'assistant', content: reply } : m));
    } catch {
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { role: 'assistant', content: '⚠️ AI service unavailable.' } : m));
    } finally { setChatLoading(false); }
  };

  const SUGGESTIONS = [
    'What is the trend in account balance over the periods?',
    'Which period had the most investment activity?',
    'Analyse the revaluation impact on the balance',
    'What percentage of total movement is from purchases?',
    'Are there any unusual or large transactions I should review?',
  ];

  const detailColumns: ColumnsType<JournalLine> = [
    { title: 'Period',  dataIndex: 'defaultPeriodName', width: 78,  render: v => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
    { title: 'Date',    dataIndex: 'accountingDate',    width: 95,  render: v => <Text style={{ fontSize: 11 }}>{String(v).substring(0, 11)}</Text> },
    { title: 'Type',    key: 'type', width: 80,
      render: (_: any, r: JournalLine) => { const t = txnType(r.jeLineDescription); const cfg = TYPE_CFG[t]; return <Tag color={undefined} style={{ fontSize: 10, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}>{cfg.icon} {t}</Tag>; } },
    { title: 'Description', dataIndex: 'jeLineDescription', ellipsis: true, render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 11 }}>{v}</Text></Tooltip> },
    { title: 'Source',  dataIndex: 'userJeSourceName', width: 110, render: v => <Text style={{ fontSize: 10, color: '#8c8c8c' }}>{v}</Text> },
    { title: `Dr (${functionalCcy})`, dataIndex: 'accountedDr', width: 130, align: 'right',
      render: (v: number) => v > 0 ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.green }}>{fmtN(v)}</Text> : <Text style={{ color: '#d9d9d9', fontSize: 11 }}>—</Text> },
    { title: `Cr (${functionalCcy})`, dataIndex: 'accountedCr', width: 130, align: 'right',
      render: (v: number) => v > 0 ? <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.primary }}>{fmtN(v)}</Text> : <Text style={{ color: '#d9d9d9', fontSize: 11 }}>—</Text> },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '16px 20px' }}>

      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center">
            <FundOutlined style={{ fontSize: 24, color: C.primary }} />
            <div>
              <Title level={4} style={{ margin: 0, color: C.primary }}>Account Analytics</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {dataRows.length} transactions · {periods.length} periods · Opening: <Text strong>{fmtM(openingBal)} {functionalCcy}</Text>
              </Text>
            </div>
          </Space>
        </Col>
        <Col>
          <Button icon={<CloseOutlined />} onClick={onClose}
            style={{ borderColor: C.primary, color: C.primary, fontWeight: 600 }}>
            Close Analytics
          </Button>
        </Col>
      </Row>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 14, borderRadius: 8 }}>
        <Row gutter={[16, 8]} align="middle" wrap>
          <Col><Space>
            <Text strong style={{ fontSize: 12 }}>Period:</Text>
            <Select value={selPeriod} onChange={setSelPeriod} style={{ width: 120 }} size="small"
              options={[{ value: 'ALL', label: 'All Periods' }, ...periods.map(p => ({ value: p, label: p }))]} />
          </Space></Col>
          <Col><Space>
            <Text strong style={{ fontSize: 12 }}>Type:</Text>
            <Select value={selType} onChange={setSelType} style={{ width: 140 }} size="small"
              options={[
                { value: 'ALL',   label: 'All Types' },
                { value: 'BUY',   label: '🛒 Purchases' },
                { value: 'SELL',  label: '💰 Sales' },
                { value: 'REVAL', label: '🔄 Revaluations' },
                { value: 'COST',  label: '🔥 Costs/Fees' },
                { value: 'OTHER', label: '📋 Other' },
              ]} />
          </Space></Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Badge count={filtered.length} color={C.blue} overflowCount={9999}>
              <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>rows</Text>
            </Badge>
          </Col>
        </Row>
      </Card>

      {/* ── KPI Row 1 ── */}
      <Row gutter={[10, 10]} style={{ marginBottom: 10 }}>
        {[
          { label: 'Opening Balance',    value: openingBal, color: C.teal,   icon: <CalendarOutlined />,    pre: functionalCcy },
          { label: 'Closing Balance',    value: closingBal, color: C.blue,   icon: <LineChartOutlined />,   pre: functionalCcy },
          { label: 'Total Invested (Dr)', value: totalDr,   color: C.green,  icon: <ArrowUpOutlined />,     pre: functionalCcy },
          { label: 'Total Released (Cr)', value: totalCr,   color: C.primary,icon: <ArrowDownOutlined />,   pre: functionalCcy },
          { label: 'Net Movement',        value: netMvt,    color: netMvt >= 0 ? C.green : C.primary, icon: netMvt >= 0 ? <RiseOutlined /> : <FallOutlined />, pre: functionalCcy },
          { label: 'Balance Change',      value: closingBal - openingBal, color: (closingBal - openingBal) >= 0 ? C.green : C.primary, icon: <ThunderboltOutlined />, pre: functionalCcy },
        ].map(k => (
          <Col key={k.label} xs={12} sm={8} md={4}>
            <Card size="small" style={{ borderRadius: 8, borderTop: `3px solid ${k.color}`, height: '100%' }}>
              <div style={{ fontSize: 18, color: k.color, marginBottom: 2 }}>{k.icon}</div>
              <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 2 }}>{k.label}</div>
              <Text strong style={{ fontFamily: 'monospace', fontSize: 13, color: k.color }}>{fmtM(k.value)}</Text>
              <Text style={{ fontSize: 9, color: '#bfbfbf', marginLeft: 3 }}>{k.pre}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── KPI Row 2 ── */}
      <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
        {[
          { label: 'Purchases (Dr)',       value: buyTotal,       color: C.green,  icon: <ShoppingCartOutlined />, pre: functionalCcy },
          { label: 'Revaluation Impact',   value: revalTotal,     color: C.purple, icon: <SwapOutlined />,          pre: functionalCcy },
          { label: 'Charges & Costs',      value: costTotal,      color: C.orange, icon: <FireOutlined />,           pre: functionalCcy },
          { label: 'Peak Balance',         value: peakBal,        color: C.gold,   icon: <TrophyOutlined />,         pre: `${functionalCcy} · ${peakPeriod}` },
          { label: 'Avg Monthly Invest',   value: avgMonthlyDr,   color: C.teal,   icon: <FundOutlined />,           pre: functionalCcy },
          { label: 'Transactions',         value: filtered.length,color: C.blue,   icon: <BarChartOutlined />,       pre: 'count', isCount: true },
        ].map(k => (
          <Col key={k.label} xs={12} sm={8} md={4}>
            <Card size="small" style={{ borderRadius: 8, borderTop: `3px solid ${k.color}`, height: '100%' }}>
              <div style={{ fontSize: 18, color: k.color, marginBottom: 2 }}>{k.icon}</div>
              <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 2 }}>{k.label}</div>
              <Text strong style={{ fontFamily: 'monospace', fontSize: 13, color: k.color }}>
                {k.isCount ? k.value : fmtM(k.value as number)}
              </Text>
              <Text style={{ fontSize: 9, color: '#bfbfbf', marginLeft: 3 }}>{k.pre}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Main Trend Chart ── */}
      <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }}
        title={
          <Row justify="space-between" align="middle">
            <Space><LineChartOutlined style={{ color: C.blue }} /><Text strong>Period Trend</Text></Space>
            <Segmented size="small" value={trendMetric} onChange={v => setTrendMetric(v as any)}
              options={[
                { label: 'Balance',  value: 'balance' },
                { label: 'Debit',    value: 'debit'   },
                { label: 'Credit',   value: 'credit'  },
                { label: 'Dr vs Cr', value: 'net'     },
              ]}
            />
          </Row>
        }>
        {periodData.length === 0 ? <Empty description="No data" /> : (
          <ResponsiveContainer width="100%" height={280}>
            {trendMetric === 'net' ? (
              <BarChart data={periodData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10, angle: -35, textAnchor: 'end' }} interval={0} />
                <YAxis tickFormatter={chartFmt} tick={{ fontSize: 10 }} width={70} />
                <RechartsTip content={<ChartTooltip ccy={functionalCcy} />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="debit"  name="Debit"  fill={C.chart.dr}   radius={[3, 3, 0, 0]} />
                <Bar dataKey="credit" name="Credit" fill={C.chart.cr}   radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : trendMetric === 'balance' ? (
              <AreaChart data={periodData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.chart.bal} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.chart.bal} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10, angle: -35, textAnchor: 'end' }} interval={0} />
                <YAxis tickFormatter={chartFmt} tick={{ fontSize: 10 }} width={70} />
                <RechartsTip content={<ChartTooltip ccy={functionalCcy} />} />
                <ReferenceLine y={openingBal} stroke={C.teal} strokeDasharray="4 2" label={{ value: 'Opening', fontSize: 10, fill: C.teal }} />
                <Area type="monotone" dataKey="balance" name="Balance" stroke={C.chart.bal} fill="url(#balGrad)" strokeWidth={2.5} dot={{ r: 3, fill: C.chart.bal }} activeDot={{ r: 5 }} />
              </AreaChart>
            ) : trendMetric === 'debit' ? (
              <AreaChart data={periodData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                <defs>
                  <linearGradient id="drGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.chart.dr} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.chart.dr} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10, angle: -35, textAnchor: 'end' }} interval={0} />
                <YAxis tickFormatter={chartFmt} tick={{ fontSize: 10 }} width={70} />
                <RechartsTip content={<ChartTooltip ccy={functionalCcy} />} />
                <ReferenceLine y={avgMonthlyDr} stroke={C.gold} strokeDasharray="4 2" label={{ value: `Avg ${fmtM(avgMonthlyDr)}`, fontSize: 10, fill: C.gold }} />
                <Area type="monotone" dataKey="debit" name="Monthly Debit" stroke={C.chart.dr} fill="url(#drGrad)" strokeWidth={2.5} dot={{ r: 3, fill: C.chart.dr }} activeDot={{ r: 5 }} />
              </AreaChart>
            ) : (
              <AreaChart data={periodData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                <defs>
                  <linearGradient id="crGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.chart.cr} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.chart.cr} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10, angle: -35, textAnchor: 'end' }} interval={0} />
                <YAxis tickFormatter={chartFmt} tick={{ fontSize: 10 }} width={70} />
                <RechartsTip content={<ChartTooltip ccy={functionalCcy} />} />
                <Area type="monotone" dataKey="credit" name="Monthly Credit" stroke={C.chart.cr} fill="url(#crGrad)" strokeWidth={2.5} dot={{ r: 3, fill: C.chart.cr }} activeDot={{ r: 5 }} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Row: Type breakdown bar + Source donut ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={14}>
          <Card size="small" style={{ borderRadius: 8 }}
            title={<Space><FireOutlined style={{ color: C.orange }} /><Text strong>Debit by Transaction Type</Text></Space>}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={typeBarData} layout="vertical" margin={{ top: 0, right: 30, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tickFormatter={chartFmt} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="type" tick={{ fontSize: 10 }} width={80} />
                <RechartsTip content={<ChartTooltip ccy={functionalCcy} />} />
                <Bar dataKey="debit"  name="Debit"  fill={C.green}  radius={[0, 4, 4, 0]} />
                <Bar dataKey="credit" name="Credit" fill={C.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" style={{ borderRadius: 8, height: '100%' }}
            title={<Space><SwapOutlined style={{ color: C.purple }} /><Text strong>By Journal Source</Text></Space>}>
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              {sourceData.map(s => {
                const totalCount = sourceData.reduce((sum, x) => sum + x.count, 0);
                const pct = totalCount > 0 ? (s.count / totalCount) * 100 : 0;
                return (
                  <div key={s.name}>
                    <Row justify="space-between">
                      <Text style={{ fontSize: 11 }}>{s.name}</Text>
                      <Space size={4}>
                        <Text style={{ fontSize: 10, color: C.green }}>{fmtM(s.dr)}</Text>
                        <Text style={{ fontSize: 10, color: '#bfbfbf' }}>·</Text>
                        <Badge count={s.count} color={C.blue} overflowCount={999} style={{ fontSize: 9 }} />
                      </Space>
                    </Row>
                    <Progress percent={pct} showInfo={false} size="small" strokeColor={C.teal} />
                  </div>
                );
              })}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* ── Balance Timeline as line chart + top transactions ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={14}>
          <Card size="small" style={{ borderRadius: 8 }}
            title={<Space><LineChartOutlined style={{ color: C.teal }} /><Text strong>Balance Timeline (Running)</Text></Space>}>
            {periodData.length === 0 ? <Empty description="No period data" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={periodData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10, angle: -35, textAnchor: 'end' }} interval={0} />
                  <YAxis tickFormatter={chartFmt} tick={{ fontSize: 10 }} width={70} />
                  <RechartsTip content={<ChartTooltip ccy={functionalCcy} />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                  <ReferenceLine y={openingBal} stroke={C.teal} strokeDasharray="5 3" />
                  <Line type="monotone" dataKey="balance" name="Balance" stroke={C.chart.bal} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="debit"   name="Debit"   stroke={C.chart.dr}  strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" style={{ borderRadius: 8, height: '100%' }}
            title={<Space><TrophyOutlined style={{ color: C.gold }} /><Text strong>Top 8 Largest Debits</Text></Space>}>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {topDr.length === 0 ? <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} /> :
                topDr.map((r, i) => (
                  <div key={r.key} style={{ padding: '4px 0', borderBottom: i < topDr.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                    <Row justify="space-between" align="top" wrap={false}>
                      <Col flex="auto" style={{ minWidth: 0 }}>
                        <Tooltip title={r.jeLineDescription}>
                          <Text style={{ fontSize: 11, display: 'block' }} ellipsis>{r.jeLineDescription.substring(0, 55)}</Text>
                        </Tooltip>
                        <Space size={4}>
                          <Tag style={{ fontSize: 9, margin: 0, padding: '0 3px' }}>{r.defaultPeriodName}</Tag>
                          <Text style={{ fontSize: 9, color: '#8c8c8c' }}>{String(r.accountingDate).substring(0, 11)}</Text>
                        </Space>
                      </Col>
                      <Col style={{ textAlign: 'right', minWidth: 90, paddingLeft: 8 }}>
                        <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: C.green }}>{fmtM(r.accountedDr)}</Text>
                      </Col>
                    </Row>
                  </div>
                ))
              }
            </div>
          </Card>
        </Col>
      </Row>

      {/* ── Transaction detail table ── */}
      <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }}
        title={<Space><BarChartOutlined style={{ color: C.blue }} /><Text strong>Transaction Detail</Text><Badge count={filtered.length} color={C.blue} overflowCount={9999} /></Space>}>
        <Table<JournalLine>
          dataSource={filtered}
          columns={detailColumns}
          rowKey="key"
          size="small"
          scroll={{ x: 1000, y: 260 }}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
        />
      </Card>

      {/* ── AI Chatbot ── */}
      <Card size="small" style={{ borderRadius: 8 }}
        title={<Space><RobotOutlined style={{ color: C.purple, fontSize: 16 }} /><Text strong style={{ color: C.purple }}>AI Financial Analyst</Text><Tag color="purple" style={{ fontSize: 10 }}>Claude</Tag></Space>}>
        <div style={{ height: 300, overflowY: 'auto', padding: '8px 4px', marginBottom: 8, background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10, gap: 8 }}>
              {msg.role === 'assistant' && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.purple, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
                </div>
              )}
              <div style={{ maxWidth: '76%', background: msg.role === 'user' ? C.blue : '#fff', color: msg.role === 'user' ? '#fff' : '#262626', borderRadius: msg.role === 'user' ? '12px 12px 0 12px' : '12px 12px 12px 0', padding: '8px 12px', fontSize: 12, lineHeight: 1.65, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', border: msg.role === 'assistant' ? '1px solid #f0f0f0' : 'none' }}>
                {msg.loading ? <Spin size="small" /> : <Paragraph style={{ margin: 0, fontSize: 12, color: 'inherit', whiteSpace: 'pre-wrap' }}>{msg.content}</Paragraph>}
              </div>
              {msg.role === 'user' && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <UserOutlined style={{ color: '#fff', fontSize: 14 }} />
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        {messages.length <= 1 && (
          <div style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 11, color: '#8c8c8c' }}><BulbOutlined /> Suggested:</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
              {SUGGESTIONS.map(s => (
                <Button key={s} size="small" style={{ fontSize: 10, height: 'auto', padding: '2px 8px', borderColor: C.purple, color: C.purple }} onClick={() => setChatInput(s)}>{s}</Button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <TextArea value={chatInput} onChange={e => setChatInput(e.target.value)}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask about trends, anomalies, buys/sells, period comparisons… (Enter to send)"
            autoSize={{ minRows: 1, maxRows: 4 }} style={{ fontSize: 12, borderRadius: 8 }} disabled={chatLoading} />
          <Button type="primary" icon={<SendOutlined />} onClick={sendMessage} loading={chatLoading}
            style={{ background: C.purple, borderColor: C.purple, borderRadius: 8, height: 'auto' }} />
        </div>
        <Text style={{ fontSize: 10, color: '#bfbfbf', marginTop: 4, display: 'block' }}>
          AI has access to {filtered.length} transactions and period trend data. Shift+Enter for new line.
        </Text>
      </Card>
    </div>
  );
};

export default AccountAnalyticsPage;
