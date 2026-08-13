import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Button, Table, Tag,
  Select, Breadcrumb, Tooltip, Spin, Segmented, Divider,
  Progress, Badge, Empty, message,
} from 'antd';
import {
  HomeOutlined, ReloadOutlined, StockOutlined, DollarOutlined,
  RiseOutlined, FallOutlined, BankOutlined, GlobalOutlined,
  PieChartOutlined, BarChartOutlined, TableOutlined, BulbOutlined, SettingOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Link, useNavigate } from 'react-router-dom';
import { ApiKeySettingsModal, getSavedApiKey } from '../../components/ApiKeySettingsModal';

const { Content } = Layout;
const { Title, Text } = Typography;

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = {
  primary:  '#C74634',
  blue:     '#1565C0',
  purple:   '#6B4C9A',
  green:    '#1D7B4D',
  orange:   '#E65100',
  teal:     '#00695C',
  headerBg: '#F0F2F5',
  usd:      '#1565C0',
  aed:      '#00695C',
  inr:      '#6B4C9A',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Holding {
  companyCode:             string;
  shareType:               string;
  currency:                string;
  symbolName:              string;
  symbol:                  string;
  exchange:                string;
  qty:                     number;
  shPercent:               number;
  originalWag:             number;
  originalCost:            number;
  avgCostPriceInclRecal:   number;
  valueAtCostWithFvChange: number;
  cmp:                     number;
  valueAtCmp:              number;
  fxRateToAed:             number;
  portfolioValueAtCostAed: number;
  portfolioValueAtCostUsd: number;
  valueAtCmpAed:           number;
  valueAtCmpUsd:           number;
}

type CurrencyMode = 'ALL' | 'USD' | 'AED' | 'INR';

// ─── API ──────────────────────────────────────────────────────────────────────
const API_URL = buildApexUrl('pms/PMS_V_PORTFOLIO_POSTION');

const r2 = (v: unknown): number => {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};

const mapItem = (i: any): Holding => ({
  companyCode:             String(i.company_code ?? ''),
  shareType:               String(i.share_type  ?? ''),
  currency:                String(i.currency    ?? ''),
  symbolName:              String(i.symbol_name ?? ''),
  symbol:                  String(i.symbol      ?? ''),
  exchange:                String(i.exchange    ?? ''),
  qty:                     r2(i.qty),
  shPercent:               r2(i.sh_percent),
  originalWag:             r2(i.original_wag),   // "########" becomes 0
  originalCost:            r2(i.original_cost),
  avgCostPriceInclRecal:   r2(i.avgcost_price_incl_recal),
  valueAtCostWithFvChange: r2(i.valueat_cost_with_fv_change),
  cmp:                     r2(i.cmp),
  valueAtCmp:              r2(i.value_at_cmp),
  fxRateToAed:             r2(i.fx_rate_to_aed),
  portfolioValueAtCostAed: r2(i.portfolio_value_at_cost_aed),
  portfolioValueAtCostUsd: r2(i.portfolio_value_at_cost_usd),
  valueAtCmpAed:           r2(i.value_at_cmp_aed),
  valueAtCmpUsd:           r2(i.value_at_cmp_usd),
});

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtNum  = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtAbbr = (v: number) => {
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(v) >= 1_000_000)     return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)         return `${(v / 1_000).toFixed(1)}K`;
  return fmtNum(v);
};
const pnlColor = (v: number) => v >= 0 ? COLORS.green : COLORS.primary;
const pnlIcon  = (v: number) => v >= 0 ? <RiseOutlined /> : <FallOutlined />;

// ─── Multi-currency value cell ────────────────────────────────────────────────
const MultiCurrCell = ({ usd, aed, inr, bold, isPnl, fmt }: {
  usd: number; aed: number; inr: number; bold?: boolean; isPnl?: boolean;
  fmt: (v: number) => string;
}) => (
  <Space direction="vertical" size={1} style={{ textAlign: 'right', width: '100%' }}>
    {[
      { sym: '$',    val: usd, color: COLORS.usd, label: 'USD' },
      { sym: 'AED ', val: aed, color: COLORS.aed, label: 'AED' },
      { sym: '₹',   val: inr, color: COLORS.inr, label: 'INR' },
    ].map(({ sym, val, color, label }) => {
      const sign = isPnl && val >= 0 ? '+' : '';
      return (
        <div key={label} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
          <Tag style={{ fontSize: 9, padding: '0 3px', margin: 0, lineHeight: '14px' }} color={label === 'USD' ? 'blue' : label === 'AED' ? 'cyan' : 'purple'}>{label}</Tag>
          <Text style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: bold ? 600 : 400, color: isPnl ? pnlColor(val) : color }}>
            {sym}{sign}{fmt(val)}
          </Text>
        </div>
      );
    })}
  </Space>
);

// ─── Component ────────────────────────────────────────────────────────────────
export default function InvestmentHoldings() {
  const navigate = useNavigate();
  const [allData,   setAllData]   = useState<Holding[]>([]);
  const [company,   setCompany]   = useState<string>('ALL');
  const [shareType, setShareType] = useState<string>('ALL');
  const [loading,   setLoading]   = useState(false);
  const [viewMode,  setViewMode]  = useState<'table' | 'cards'>('table');
  const [currency,  setCurrency]  = useState<CurrencyMode>('ALL');
  const [msgApi, ctxHolder]       = message.useMessage();
  const [numFmt, setNumFmt]       = useState<'abbr' | 'full'>('abbr');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string>(getSavedApiKey() || '');

  const fmt = useCallback((v: number) => numFmt === 'full' ? fmtNum(v) : fmtAbbr(v), [numFmt]);

  const handleAnalyzeStock = useCallback((holding: Holding) => {
    const stockData = {
      symbol: holding.symbol,
      symbolName: holding.symbolName,
      exchange: holding.exchange,
      cmp: holding.cmp,
      qty: holding.qty,
      shareType: holding.shareType,
    };
    localStorage.setItem('selectedStock', JSON.stringify(stockData));
    navigate('/pms/ai-analysis');
  }, [navigate]);

  // ── Fetch from API ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let items: any[] = [];
      let url: string | null = API_URL;
      while (url) {
        const res  = await fetch(url);
        const json = await res.json();
        items = [...items, ...(json.items ?? [])];
        url = json.hasMore ? (json.links?.find((l: any) => l.rel === 'next')?.href ?? null) : null;
      }
      setAllData(items.map(mapItem));
    } catch (e) {
      msgApi.error('Failed to load portfolio data');
    } finally {
      setLoading(false);
    }
  }, [msgApi]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Dynamic filter options from live data ────────────────────────────────────
  const companies  = useMemo(() => [...new Set(allData.map(r => r.companyCode))].sort(), [allData]);
  const shareTypes = useMemo(() => [...new Set(allData.map(r => r.shareType))].sort(),   [allData]);

  // ── Filtered data ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => allData.filter(r =>
    (company   === 'ALL' || r.companyCode === company) &&
    (shareType === 'ALL' || r.shareType   === shareType)
  ), [allData, company, shareType]);

  // ── Totals ───────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const costUsd = filtered.reduce((s, r) => s + r.portfolioValueAtCostUsd, 0);
    const mktUsd  = filtered.reduce((s, r) => s + r.valueAtCmpUsd, 0);
    const costAed = filtered.reduce((s, r) => s + r.portfolioValueAtCostAed, 0);
    const mktAed  = filtered.reduce((s, r) => s + r.valueAtCmpAed, 0);
    const costInr = filtered.reduce((s, r) => s + r.valueAtCostWithFvChange, 0);
    const mktInr  = filtered.reduce((s, r) => s + r.valueAtCmp, 0);
    return { costUsd, mktUsd, costAed, mktAed, costInr, mktInr };
  }, [filtered]);

  // For sorting / weight when a single currency is chosen
  const singleMkt = useCallback((r: Holding) => {
    if (currency === 'USD') return r.valueAtCmpUsd;
    if (currency === 'AED') return r.valueAtCmpAed;
    if (currency === 'INR') return r.valueAtCmp;
    return r.valueAtCmpUsd; // ALL — sort by USD
  }, [currency]);

  const grandMktForWeight = currency === 'AED' ? totals.mktAed : currency === 'INR' ? totals.mktInr : totals.mktUsd;

  // ── KPI cards ────────────────────────────────────────────────────────────────
  // When ALL: show three sub-rows per card; otherwise one value
  const KpiCard = ({ label, color, icon, isCount }: {
    label: string; color: string; icon: React.ReactNode; isCount?: boolean;
  }) => {
    const pnlUsd = totals.mktUsd - totals.costUsd;
    const pnlAed = totals.mktAed - totals.costAed;
    const pnlInr = totals.mktInr - totals.costInr;
    const pnlPct = totals.costUsd > 0 ? (pnlUsd / totals.costUsd) * 100 : 0;

    const rows: { sym: string; val: number; label: string; tagColor: string }[] =
      label === 'Total Book Value'   ? [{ sym: '$', val: totals.costUsd, label: 'USD', tagColor: 'blue' }, { sym: 'AED ', val: totals.costAed, label: 'AED', tagColor: 'cyan' }, { sym: '₹', val: totals.costInr, label: 'INR', tagColor: 'purple' }]
    : label === 'Total Market Value' ? [{ sym: '$', val: totals.mktUsd,  label: 'USD', tagColor: 'blue' }, { sym: 'AED ', val: totals.mktAed,  label: 'AED', tagColor: 'cyan' }, { sym: '₹', val: totals.mktInr,  label: 'INR', tagColor: 'purple' }]
    : label === 'Unrealized P&L'     ? [{ sym: '$', val: pnlUsd,         label: 'USD', tagColor: 'blue' }, { sym: 'AED ', val: pnlAed,         label: 'AED', tagColor: 'cyan' }, { sym: '₹', val: pnlInr,         label: 'INR', tagColor: 'purple' }]
    : [];

    const singleCostVal = currency === 'AED' ? totals.costAed : currency === 'INR' ? totals.costInr : totals.costUsd;
    const singleMktVal  = currency === 'AED' ? totals.mktAed  : currency === 'INR' ? totals.mktInr  : totals.mktUsd;
    const singlePnlVal  = singleMktVal - singleCostVal;
    const singlePct     = singleCostVal > 0 ? (singlePnlVal / singleCostVal) * 100 : 0;
    const currSym       = currency === 'INR' ? '₹' : currency === 'AED' ? 'AED ' : '$';

    return (
      <Card size="small" style={{ borderRadius: 8, borderTop: `3px solid ${color}`, height: '100%' }}>
        <Space align="start">
          <div style={{ fontSize: 20, color, paddingTop: 2 }}>{icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>{label}</div>
            {isCount ? (
              <Text strong style={{ fontSize: 22, color }}>{filtered.length}</Text>
            ) : currency === 'ALL' ? (
              <Space direction="vertical" size={2}>
                {rows.map(({ sym, val, label: lbl, tagColor }) => (
                  <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Tag style={{ fontSize: 9, padding: '0 3px', margin: 0, lineHeight: '14px' }} color={tagColor}>{lbl}</Tag>
                    <Text strong style={{
                      fontFamily: 'monospace', fontSize: 13,
                      color: lbl === 'Unrealized P&L' || label === 'Unrealized P&L' ? pnlColor(val) : color,
                    }}>
                      {label === 'Unrealized P&L' && val >= 0 ? '+' : ''}{sym}{fmt(val)}
                    </Text>
                  </div>
                ))}
                {label === 'Unrealized P&L' && (
                  <Text style={{ fontSize: 10, color: pnlColor(pnlPct) }}>{pnlIcon(pnlPct)} {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% (USD basis)</Text>
                )}
              </Space>
            ) : (
              <Space direction="vertical" size={0}>
                <Text strong style={{ fontFamily: 'monospace', fontSize: 16, color: label === 'Unrealized P&L' ? pnlColor(singlePnlVal) : color }}>
                  {label === 'Unrealized P&L' && singlePnlVal >= 0 ? '+' : ''}{currSym}{fmt(
                    label === 'Total Book Value' ? singleCostVal :
                    label === 'Total Market Value' ? singleMktVal : singlePnlVal
                  )}
                </Text>
                {label === 'Unrealized P&L' && (
                  <Text style={{ fontSize: 10, color: pnlColor(singlePct) }}>{pnlIcon(singlePct)} {singlePct >= 0 ? '+' : ''}{singlePct.toFixed(2)}%</Text>
                )}
              </Space>
            )}
          </div>
        </Space>
      </Card>
    );
  };

  // ── Table columns ─────────────────────────────────────────────────────────────
  const columns = useMemo((): ColumnsType<Holding> => {
    const showAll = currency === 'ALL';

    const valueCols: ColumnsType<Holding> = showAll ? [
      {
        title: <span style={{ color: COLORS.usd }}>Book Value</span>,
        key: 'bookAll',
        width: 160,
        align: 'right',
        render: (_, r) => (
          <MultiCurrCell
            usd={r.portfolioValueAtCostUsd}
            aed={r.portfolioValueAtCostAed}
            inr={r.valueAtCostWithFvChange}
            fmt={fmt}
          />
        ),
      },
      {
        title: <span style={{ color: COLORS.blue }}>Market Value</span>,
        key: 'mktAll',
        width: 160,
        align: 'right',
        sorter: (a, b) => a.valueAtCmpUsd - b.valueAtCmpUsd,
        render: (_, r) => (
          <MultiCurrCell
            usd={r.valueAtCmpUsd}
            aed={r.valueAtCmpAed}
            inr={r.valueAtCmp}
            bold
            fmt={fmt}
          />
        ),
      },
      {
        title: <span style={{ color: COLORS.green }}>Unrealized P&L</span>,
        key: 'pnlAll',
        width: 160,
        align: 'right',
        sorter: (a, b) => (a.valueAtCmpUsd - a.portfolioValueAtCostUsd) - (b.valueAtCmpUsd - b.portfolioValueAtCostUsd),
        render: (_, r) => {
          const pct = r.portfolioValueAtCostUsd > 0
            ? ((r.valueAtCmpUsd - r.portfolioValueAtCostUsd) / r.portfolioValueAtCostUsd) * 100 : 0;
          return (
            <Space direction="vertical" size={1} style={{ textAlign: 'right', width: '100%' }}>
              <MultiCurrCell
                usd={r.valueAtCmpUsd - r.portfolioValueAtCostUsd}
                aed={r.valueAtCmpAed - r.portfolioValueAtCostAed}
                inr={r.valueAtCmp - r.valueAtCostWithFvChange}
                bold isPnl fmt={fmt}
              />
              <Text style={{ fontSize: 10, color: pnlColor(pct) }}>{pnlIcon(pct)} {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</Text>
            </Space>
          );
        },
      },
    ] : [
      {
        title: `Book Value (${currency})`,
        key: 'bookValue',
        width: 130,
        align: 'right',
        sorter: (a, b) => {
          const get = (r: Holding) => currency === 'AED' ? r.portfolioValueAtCostAed : currency === 'INR' ? r.valueAtCostWithFvChange : r.portfolioValueAtCostUsd;
          return get(a) - get(b);
        },
        render: (_, r) => {
          const v = currency === 'AED' ? r.portfolioValueAtCostAed : currency === 'INR' ? r.valueAtCostWithFvChange : r.portfolioValueAtCostUsd;
          return <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmt(v)}</Text>;
        },
      },
      {
        title: `Mkt Value (${currency})`,
        key: 'mktValue',
        width: 130,
        align: 'right',
        sorter: (a, b) => singleMkt(a) - singleMkt(b),
        render: (_, r) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: COLORS.blue }}>{fmt(singleMkt(r))}</Text>,
      },
      {
        title: `P&L (${currency})`,
        key: 'pnl',
        width: 130,
        align: 'right',
        sorter: (a, b) => {
          const pnl = (r: Holding) => singleMkt(r) - (currency === 'AED' ? r.portfolioValueAtCostAed : currency === 'INR' ? r.valueAtCostWithFvChange : r.portfolioValueAtCostUsd);
          return pnl(a) - pnl(b);
        },
        render: (_, r) => {
          const cost = currency === 'AED' ? r.portfolioValueAtCostAed : currency === 'INR' ? r.valueAtCostWithFvChange : r.portfolioValueAtCostUsd;
          const pnl  = singleMkt(r) - cost;
          const pct  = cost > 0 ? (pnl / cost) * 100 : 0;
          return (
            <Space direction="vertical" size={0} style={{ textAlign: 'right' }}>
              <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: pnlColor(pnl) }}>{pnl >= 0 ? '+' : ''}{fmt(pnl)}</Text>
              <Text style={{ fontSize: 10, color: pnlColor(pct) }}>{pnlIcon(pct)} {pct.toFixed(2)}%</Text>
            </Space>
          );
        },
      },
    ];

    return [
      {
        title: 'Security',
        key: 'security',
        fixed: 'left',
        width: 220,
        render: (_, r) => (
          <Space direction="vertical" size={0}>
            <Text strong style={{ fontSize: 13 }}>{r.symbol}</Text>
            <Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: r.symbolName }}>{r.symbolName}</Text>
            <Space size={4}>
              <Tag style={{ fontSize: 10, padding: '0 4px', margin: 0 }} color="blue">{r.exchange}</Tag>
              <Tag style={{ fontSize: 10, padding: '0 4px', margin: 0 }} color={r.shareType === 'NRE' ? 'purple' : 'cyan'}>{r.shareType}</Tag>
            </Space>
          </Space>
        ),
      },
      {
        title: 'Qty',
        dataIndex: 'qty',
        width: 110,
        align: 'right',
        sorter: (a, b) => a.qty - b.qty,
        render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.toLocaleString()}</Text>,
      },
      {
        title: 'Sh %',
        dataIndex: 'shPercent',
        width: 65,
        align: 'right',
        sorter: (a, b) => a.shPercent - b.shPercent,
        render: (v: number) => <Text style={{ fontSize: 11 }}>{v.toFixed(4)}%</Text>,
      },
      {
        title: 'Orig WAG',
        dataIndex: 'originalWag',
        width: 95,
        align: 'right',
        sorter: (a, b) => a.originalWag - b.originalWag,
        render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>₹{fmtNum(v)}</Text>,
      },
      {
        title: 'Avg Cost',
        dataIndex: 'avgCostPriceInclRecal',
        width: 95,
        align: 'right',
        sorter: (a, b) => a.avgCostPriceInclRecal - b.avgCostPriceInclRecal,
        render: (v: number) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>₹{fmtNum(v)}</Text>,
      },
      {
        title: 'CMP',
        dataIndex: 'cmp',
        width: 100,
        align: 'right',
        sorter: (a, b) => a.cmp - b.cmp,
        render: (v: number, r) => {
          const chg = r.avgCostPriceInclRecal > 0 ? ((v - r.avgCostPriceInclRecal) / r.avgCostPriceInclRecal) * 100 : 0;
          return (
            <Space direction="vertical" size={0} style={{ textAlign: 'right' }}>
              <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>₹{fmtNum(v)}</Text>
              <Text style={{ fontSize: 10, color: pnlColor(chg) }}>{pnlIcon(chg)} {chg.toFixed(2)}%</Text>
            </Space>
          );
        },
      },
      ...valueCols,
      {
        title: 'Weight',
        key: 'weight',
        width: 110,
        align: 'right',
        render: (_, r) => {
          const wt = grandMktForWeight > 0 ? (singleMkt(r) / grandMktForWeight) * 100 : 0;
          return (
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text style={{ fontSize: 11 }}>{wt.toFixed(2)}%</Text>
              <Progress percent={wt} showInfo={false} size="small" strokeColor={COLORS.blue} style={{ margin: 0 }} />
            </Space>
          );
        },
      },
      {
        title: 'FX→AED',
        dataIndex: 'fxRateToAed',
        width: 75,
        align: 'right',
        render: (v: number) => <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{v}</Text>,
      },
    ];
  }, [currency, singleMkt, grandMktForWeight, filtered.length]);

  // ── Totals row values ─────────────────────────────────────────────────────────
  const showAll = currency === 'ALL';
  const grandCost = currency === 'AED' ? totals.costAed : currency === 'INR' ? totals.costInr : totals.costUsd;
  const grandMkt  = currency === 'AED' ? totals.mktAed  : currency === 'INR' ? totals.mktInr  : totals.mktUsd;
  const grandPnl  = grandMkt - grandCost;
  const grandPct  = grandCost > 0 ? (grandPnl / grandCost) * 100 : 0;

  return (
    <Layout style={{ minHeight: '100vh', background: COLORS.headerBg }}>
      {ctxHolder}
      <Content style={{ padding: '16px 24px' }}>

        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/home"><HomeOutlined /></Link> },
          { title: <Link to="/pms">Portfolio Management</Link> },
          { title: 'Investment Holdings' },
        ]} />

        {/* Header */}
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Space align="center">
              <StockOutlined style={{ fontSize: 22, color: COLORS.primary }} />
              <div>
                <Title level={4} style={{ margin: 0, color: COLORS.primary }}>Investment Holdings</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Equity portfolio across NRE / NRO accounts — NSE listed securities</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button icon={<SettingOutlined />} size="small" onClick={() => setSettingsOpen(true)}>
                API Settings
              </Button>
              <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={fetchData}>
                Refresh
              </Button>
            </Space>
          </Col>
        </Row>

        {/* Filters */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
          <Row gutter={[16, 8]} align="middle" wrap>
            <Col>
              <Space>
                <Text strong style={{ fontSize: 12 }}>Company:</Text>
                <Select value={company} onChange={setCompany} style={{ width: 140 }} size="small"
                  options={[{ value: 'ALL', label: 'All Companies' }, ...companies.map(c => ({ value: c, label: `Company ${c}` }))]} />
              </Space>
            </Col>
            <Col>
              <Space>
                <Text strong style={{ fontSize: 12 }}>Share Type:</Text>
                <Select value={shareType} onChange={setShareType} style={{ width: 155 }} size="small"
                  options={[
                    { value: 'ALL', label: 'All Types' },
                    ...shareTypes.map(s => ({
                      value: s,
                      label: s === 'NRE' ? 'NRE – Non-Resident External'
                           : s === 'NRO' ? 'NRO – Non-Resident Ordinary'
                           : s,
                    })),
                  ]} />
              </Space>
            </Col>
            <Col>
              <Space>
                <Text strong style={{ fontSize: 12 }}>Currency:</Text>
                <Segmented size="small" value={currency} onChange={v => setCurrency(v as CurrencyMode)}
                  options={[
                    { label: 'All', value: 'ALL', icon: <GlobalOutlined /> },
                    { label: 'USD', value: 'USD', icon: <DollarOutlined /> },
                    { label: 'AED', value: 'AED' },
                    { label: 'INR', value: 'INR', icon: <span style={{ fontSize: 11, fontWeight: 700 }}>₹</span> },
                  ]}
                />
              </Space>
            </Col>
            <Col>
              <Space>
                <Text strong style={{ fontSize: 12 }}>View:</Text>
                <Segmented size="small" value={viewMode} onChange={v => setViewMode(v as 'table' | 'cards')}
                  options={[
                    { label: 'Table', value: 'table', icon: <TableOutlined /> },
                    { label: 'Cards', value: 'cards', icon: <BarChartOutlined /> },
                  ]}
                />
              </Space>
            </Col>
            <Col>
              <Space>
                <Text strong style={{ fontSize: 12 }}>Numbers:</Text>
                <Segmented size="small" value={numFmt} onChange={v => setNumFmt(v as 'abbr' | 'full')}
                  options={[
                    { label: 'Abbr', value: 'abbr' },
                    { label: 'Full', value: 'full' },
                  ]}
                />
              </Space>
            </Col>
            <Col flex="auto" style={{ textAlign: 'right' }}>
              <Space size={4}>
                {company   !== 'ALL' && <Tag color="blue"   closable onClose={() => setCompany('ALL')}>Co: {company}</Tag>}
                {shareType !== 'ALL' && <Tag color="purple" closable onClose={() => setShareType('ALL')}>{shareType}</Tag>}
                {currency  !== 'ALL' && <Tag color="geekblue">{currency}</Tag>}
                <Tag>{filtered.length} holdings</Tag>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* KPI cards */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {[
            { label: 'Total Book Value',   color: COLORS.blue,   icon: <BankOutlined /> },
            { label: 'Total Market Value', color: COLORS.teal,   icon: <StockOutlined /> },
            { label: 'Unrealized P&L',     color: pnlColor(totals.mktUsd - totals.costUsd), icon: (totals.mktUsd - totals.costUsd) >= 0 ? <RiseOutlined /> : <FallOutlined /> },
            { label: 'Holdings',           color: COLORS.purple, icon: <PieChartOutlined />, isCount: true },
          ].map(k => (
            <Col key={k.label} xs={24} sm={12} md={6}>
              <KpiCard {...k} />
            </Col>
          ))}
        </Row>

        {/* NRE / NRO split bar */}
        {shareType === 'ALL' && filtered.length > 0 && (() => {
          const getMkt = (r: Holding) => currency === 'AED' ? r.valueAtCmpAed : currency === 'INR' ? r.valueAtCmp : r.valueAtCmpUsd;
          const nreMkt = filtered.filter(r => r.shareType === 'NRE').reduce((s, r) => s + getMkt(r), 0);
          const nroMkt = filtered.filter(r => r.shareType === 'NRO').reduce((s, r) => s + getMkt(r), 0);
          const total  = nreMkt + nroMkt;
          const nrePct = total > 0 ? (nreMkt / total) * 100 : 0;
          const dispCur = currency === 'ALL' ? 'USD' : currency;
          return (
            <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
              <Row gutter={16} align="middle">
                <Col><Text strong style={{ fontSize: 12 }}>Market Value by Account Type {currency === 'ALL' ? '(USD basis)' : `(${dispCur})`}</Text></Col>
                <Col flex="auto">
                  <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', background: '#f0f0f0' }}>
                    <Tooltip title={`NRE: ${fmt(nreMkt)} ${dispCur} (${nrePct.toFixed(1)}%)`}>
                      <div style={{ width: `${nrePct}%`, background: COLORS.purple, transition: 'width 0.4s' }} />
                    </Tooltip>
                    <Tooltip title={`NRO: ${fmt(nroMkt)} ${dispCur} (${(100 - nrePct).toFixed(1)}%)`}>
                      <div style={{ flex: 1, background: COLORS.teal }} />
                    </Tooltip>
                  </div>
                </Col>
                <Col>
                  <Space size={12}>
                    <Space size={4}><Badge color={COLORS.purple} /><Text style={{ fontSize: 12 }}>NRE {nrePct.toFixed(1)}%</Text></Space>
                    <Space size={4}><Badge color={COLORS.teal} /><Text style={{ fontSize: 12 }}>NRO {(100 - nrePct).toFixed(1)}%</Text></Space>
                  </Space>
                </Col>
              </Row>
            </Card>
          );
        })()}

        {/* Main content */}
        <Spin spinning={loading}>
          {filtered.length === 0 ? (
            <Empty description="No holdings match the selected filters" />
          ) : viewMode === 'table' ? (
            <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
              <Table
                dataSource={filtered}
                columns={columns}
                rowKey={r => `${r.companyCode}-${r.shareType}-${r.symbol}`}
                size="small"
                scroll={{ x: showAll ? 1600 : 1300 }}
                pagination={false}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
                      <Table.Summary.Cell index={0} colSpan={3}>
                        <Text strong style={{ fontSize: 12 }}>TOTAL ({filtered.length})</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} colSpan={3} />
                      {showAll ? (
                        <>
                          <Table.Summary.Cell index={6} align="right">
                            <MultiCurrCell usd={totals.costUsd} aed={totals.costAed} inr={totals.costInr} bold fmt={fmt} />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="right">
                            <MultiCurrCell usd={totals.mktUsd} aed={totals.mktAed} inr={totals.mktInr} bold fmt={fmt} />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={8} align="right">
                            <MultiCurrCell
                              usd={totals.mktUsd - totals.costUsd}
                              aed={totals.mktAed - totals.costAed}
                              inr={totals.mktInr - totals.costInr}
                              bold isPnl fmt={fmt}
                            />
                          </Table.Summary.Cell>
                        </>
                      ) : (
                        <>
                          <Table.Summary.Cell index={6} align="right">
                            <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmt(grandCost)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="right">
                            <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: COLORS.blue }}>{fmt(grandMkt)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={8} align="right">
                            <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: pnlColor(grandPnl) }}>
                              {grandPnl >= 0 ? '+' : ''}{fmt(grandPnl)}
                              <Text style={{ fontSize: 10, color: pnlColor(grandPct), marginLeft: 4 }}>({grandPct >= 0 ? '+' : ''}{grandPct.toFixed(2)}%)</Text>
                            </Text>
                          </Table.Summary.Cell>
                        </>
                      )}
                      <Table.Summary.Cell index={9} colSpan={2} />
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            </Card>
          ) : (
            /* Cards view */
            <Row gutter={[12, 12]}>
              {filtered.map(r => {
                const mkt  = singleMkt(r);
                const cost = currency === 'AED' ? r.portfolioValueAtCostAed : currency === 'INR' ? r.valueAtCostWithFvChange : r.portfolioValueAtCostUsd;
                const pnl  = showAll ? r.valueAtCmpUsd - r.portfolioValueAtCostUsd : mkt - cost;
                const pct  = (showAll ? r.portfolioValueAtCostUsd : cost) > 0 ? (pnl / (showAll ? r.portfolioValueAtCostUsd : cost)) * 100 : 0;
                const wt   = grandMktForWeight > 0 ? (mkt / grandMktForWeight) * 100 : 0;
                const cmpChg = r.avgCostPriceInclRecal > 0 ? ((r.cmp - r.avgCostPriceInclRecal) / r.avgCostPriceInclRecal) * 100 : 0;
                return (
                  <Col key={`${r.companyCode}-${r.shareType}-${r.symbol}`} xs={24} sm={12} lg={showAll ? 8 : 6}>
                    <Card size="small" style={{ borderRadius: 8, borderTop: `3px solid ${pnlColor(pnl)}` }}
                      title={<Space><Text strong style={{ fontSize: 13 }}>{r.symbol}</Text><Tag style={{ fontSize: 10, margin: 0 }} color={r.shareType === 'NRE' ? 'purple' : 'cyan'}>{r.shareType}</Tag></Space>}
                      extra={
                        <Space size={4}>
                          <Tooltip title="AI Analysis">
                            <Button
                              type="text"
                              size="small"
                              icon={<BulbOutlined />}
                              onClick={() => handleAnalyzeStock(r)}
                              style={{ color: COLORS.orange }}
                            />
                          </Tooltip>
                          <Text style={{ fontSize: 10, color: '#8c8c8c' }}>{r.exchange}</Text>
                        </Space>
                      }
                    >
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }} ellipsis={{ tooltip: r.symbolName }}>{r.symbolName}</Text>
                      <Divider style={{ margin: '4px 0' }} />
                      <Row gutter={8}>
                        <Col span={12}>
                          <Text style={{ fontSize: 10, color: '#8c8c8c' }}>CMP</Text>
                          <div>
                            <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>₹{fmtNum(r.cmp)}</Text>
                            <Text style={{ fontSize: 10, color: pnlColor(cmpChg), marginLeft: 3 }}>{cmpChg >= 0 ? '+' : ''}{cmpChg.toFixed(1)}%</Text>
                          </div>
                        </Col>
                        <Col span={12}>
                          <Text style={{ fontSize: 10, color: '#8c8c8c' }}>Qty</Text>
                          <div><Text strong style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.qty.toLocaleString()}</Text></div>
                        </Col>
                      </Row>
                      <Divider style={{ margin: '4px 0' }} />
                      {showAll ? (
                        <Row gutter={8}>
                          <Col span={12}>
                            <Text style={{ fontSize: 10, color: '#8c8c8c' }}>Book Value</Text>
                            <MultiCurrCell usd={r.portfolioValueAtCostUsd} aed={r.portfolioValueAtCostAed} inr={r.valueAtCostWithFvChange} fmt={fmt} />
                          </Col>
                          <Col span={12}>
                            <Text style={{ fontSize: 10, color: '#8c8c8c' }}>Market Value</Text>
                            <MultiCurrCell usd={r.valueAtCmpUsd} aed={r.valueAtCmpAed} inr={r.valueAtCmp} bold fmt={fmt} />
                          </Col>
                        </Row>
                      ) : (
                        <Row gutter={8}>
                          <Col span={12}>
                            <Text style={{ fontSize: 10, color: '#8c8c8c' }}>Book ({currency})</Text>
                            <div><Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(cost)}</Text></div>
                          </Col>
                          <Col span={12}>
                            <Text style={{ fontSize: 10, color: '#8c8c8c' }}>Market ({currency})</Text>
                            <div><Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.blue }}>{fmt(mkt)}</Text></div>
                          </Col>
                        </Row>
                      )}
                      <Divider style={{ margin: '4px 0' }} />
                      <Row justify="space-between" align="middle">
                        <Col>
                          <Text style={{ fontSize: 10, color: '#8c8c8c' }}>P&amp;L {showAll ? '(USD)' : `(${currency})`}</Text>
                          {showAll ? (
                            <MultiCurrCell
                              usd={r.valueAtCmpUsd - r.portfolioValueAtCostUsd}
                              aed={r.valueAtCmpAed - r.portfolioValueAtCostAed}
                              inr={r.valueAtCmp - r.valueAtCostWithFvChange}
                              bold isPnl fmt={fmt}
                            />
                          ) : (
                            <div>
                              <Text strong style={{ fontFamily: 'monospace', fontSize: 11, color: pnlColor(pnl) }}>{pnl >= 0 ? '+' : ''}{fmt(pnl)}</Text>
                              <Text style={{ fontSize: 10, color: pnlColor(pct), marginLeft: 3 }}>({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</Text>
                            </div>
                          )}
                        </Col>
                        <Col>
                          <Tooltip title={`Weight: ${wt.toFixed(2)}%`}>
                            <Progress type="circle" percent={wt} size={38} strokeColor={COLORS.blue}
                              format={p => <span style={{ fontSize: 9 }}>{p?.toFixed(1)}%</span>} />
                          </Tooltip>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          )}
        </Spin>
      </Content>

      <ApiKeySettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKey={apiKey}
        onSave={setApiKey}
      />
    </Layout>
  );
}
