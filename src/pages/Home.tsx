import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Typography, Card, Tag, Spin } from 'antd';
import {
  AccountBookOutlined, BankOutlined, DollarOutlined,
  FileTextOutlined, SyncOutlined, DatabaseOutlined,
  CheckCircleOutlined, ClockCircleOutlined,
  SafetyCertificateOutlined, BookOutlined, CalendarOutlined,
  ThunderboltOutlined, WalletOutlined, AuditOutlined, FundOutlined,
  ShopOutlined, HomeOutlined, SettingOutlined, ArrowUpOutlined, ArrowDownOutlined,
  EditOutlined, SwapOutlined, CalculatorOutlined, BarChartOutlined, TeamOutlined,
  CreditCardOutlined, ReconciliationOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { APEX_DB_CONFIG } from '../config/api.config';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  purple:     '#7B5EA7',
  teal:       '#00857C',
  orange:     '#E06C00',
  neutral50:  '#FAFAFA',
  neutral100: '#F5F5F5',
  neutral200: '#E8E8E8',
  neutral600: '#6B6B6B',
  neutral800: '#333333',
};

const APEX = APEX_DB_CONFIG.baseUrl;

const MODULES = [
  { id: 'gl',   label: 'General Ledger',      icon: <AccountBookOutlined />, path: '/gl',            color: REDWOOD.primary,   desc: 'Journals · Trial Balance · COA' },
  { id: 'ap',   label: 'Accounts Payable',    icon: <DollarOutlined />,      path: '/ap',            color: REDWOOD.orange,    desc: 'Invoices · Payments · Suppliers' },
  { id: 'ar',   label: 'Accounts Receivable', icon: <WalletOutlined />,      path: '/ar',            color: REDWOOD.success,   desc: 'Receipts · Invoices · Customers' },
  { id: 'cash', label: 'Cash Management',     icon: <BankOutlined />,        path: '/cash',          color: REDWOOD.info,      desc: 'Bank Recon · Transfers · Statements' },
  { id: 'fa',   label: 'Fixed Assets',        icon: <DatabaseOutlined />,    path: '/fa',            color: REDWOOD.purple,    desc: 'Assets · Depreciation · Retirements' },
  { id: 'rm',   label: 'Rental Management',   icon: <HomeOutlined />,        path: '/rm',            color: REDWOOD.teal,      desc: 'Agreements · Properties · Installments' },
  { id: 'pms',  label: 'Portfolio Mgmt',      icon: <FundOutlined />,        path: '/pms',           color: REDWOOD.success,   desc: 'Portfolio · Watchlist · Risk' },
  { id: 'proc', label: 'Procurement',         icon: <ShopOutlined />,        path: '/procurement',   color: REDWOOD.warning,   desc: 'Suppliers · Purchase Orders' },
  { id: 'pc',   label: 'Petty Cash',          icon: <AuditOutlined />,       path: '/pc/registers',  color: REDWOOD.orange,    desc: 'Registers · Expenses' },
  { id: 'supp', label: 'Support',             icon: <SafetyCertificateOutlined />, path: '/support', color: REDWOOD.neutral600, desc: 'Tickets · Issues' },
  { id: 'admin',label: 'Administration',      icon: <SettingOutlined />,     path: '/admin',         color: REDWOOD.neutral800, desc: 'Users · Settings · AI' },
  { id: 'sync', label: 'Oracle Sync',         icon: <SyncOutlined />,        path: '/sync',          color: REDWOOD.primary,   desc: 'Sync GL · AP · AR · Assets' },
];

const QUICK_ACTIONS = [
  { label: 'Create Journal',        path: '/gl/create-journal',          color: REDWOOD.primary, icon: <EditOutlined />              },
  { label: 'AR Invoices',           path: '/ar/manage-invoices',         color: REDWOOD.success, icon: <ReconciliationOutlined />    },
  { label: 'Manage AP Invoices',    path: '/ap/manage-invoices',         color: REDWOOD.orange,  icon: <FileTextOutlined />          },
  { label: 'AR Receipts',           path: '/ar/manage-receipts',         color: REDWOOD.success, icon: <DollarOutlined />            },
  { label: 'Bank Reconciliation',   path: '/cash/bank-reconciliation',   color: REDWOOD.info,    icon: <BankOutlined />              },
  { label: 'AP Payments',           path: '/ap/payments',                color: REDWOOD.orange,  icon: <CreditCardOutlined />        },
  { label: 'External Transactions', path: '/cash/external-transactions', color: REDWOOD.info,    icon: <SwapOutlined />              },
  { label: 'Run Depreciation',      path: '/fa/depreciation',            color: REDWOOD.purple,  icon: <CalculatorOutlined />        },
  { label: 'Trial Balance',         path: '/gl/trial-balance',           color: REDWOOD.success, icon: <BarChartOutlined />          },
  { label: 'Manage RM Agreements',  path: '/rm/agreements',              color: REDWOOD.teal,    icon: <TeamOutlined />              },
  { label: 'Investment Holdings',   path: '/pms/investment-holdings',    color: REDWOOD.teal,    icon: <FundOutlined />              },
  { label: 'Petty Cash Registers',  path: '/pc/registers',               color: REDWOOD.orange,  icon: <WalletOutlined />            },
  { label: 'Sync Oracle Data',      path: '/sync',                       color: REDWOOD.primary, icon: <SyncOutlined />              },
];

// ── Sub-components ─────────────────────────────────────────────────────────

const KpiCard: React.FC<{
  label: string; value: string; sub?: string; trend?: 'up' | 'down' | 'none';
  icon: React.ReactNode; color: string; loading: boolean; onClick?: () => void;
}> = ({ label, value, sub, trend, icon, color, loading, onClick }) => (
  <Card hoverable={!!onClick} onClick={onClick}
    style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, height: '100%', cursor: onClick ? 'pointer' : 'default' }}
    styles={{ body: { padding: '16px 20px' } }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{label}</Text>
        {loading
          ? <div style={{ marginTop: 8 }}><Spin size="small" /></div>
          : <div style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.neutral800, marginTop: 4 }}>{value}</div>}
        {sub && !loading && (
          <Text style={{ fontSize: 11, color: trend === 'up' ? REDWOOD.success : trend === 'down' ? REDWOOD.primary : REDWOOD.neutral600, marginTop: 2, display: 'block' }}>
            {trend === 'up' && <ArrowUpOutlined style={{ marginRight: 2 }} />}
            {trend === 'down' && <ArrowDownOutlined style={{ marginRight: 2 }} />}
            {sub}
          </Text>
        )}
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color }}>
        {icon}
      </div>
    </div>
  </Card>
);

const ModuleTile: React.FC<{ mod: typeof MODULES[0]; onClick: () => void }> = ({ mod, onClick }) => (
  <Card hoverable onClick={onClick}
    style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, cursor: 'pointer' }}
    styles={{ body: { padding: '12px 14px' } }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${mod.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color: mod.color, flexShrink: 0 }}>
        {mod.icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <Text style={{ fontWeight: 600, fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mod.label}</Text>
        <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{mod.desc}</Text>
      </div>
    </div>
  </Card>
);

// ── Main ───────────────────────────────────────────────────────────────────

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userName  = (user as any)?.name ?? (user as any)?.email?.split('@')[0] ?? 'User';
  const today     = dayjs();
  const hour      = today.hour();
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const [apStats,    setApStats]    = useState<any>(null);
  const [glPeriod,   setGlPeriod]   = useState<any>(null);
  const [approvals,  setApprovals]  = useState<any[]>([]);
  const [recentJnls, setRecentJnls] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [apRes, periodRes, approvalsRes, jnlRes] = await Promise.allSettled([
        fetch(`${APEX}/ap/invoices/stats`,                              { cache: 'no-store', headers: { Accept: 'application/json' } }),
        fetch(`${APEX}/gl/periodsstatus`,                               { cache: 'no-store', headers: { Accept: 'application/json' } }),
        fetch(`${APEX}/approvals/requests?status=PENDING`,              { cache: 'no-store', headers: { Accept: 'application/json' } }),
        fetch(`${APEX}/gl/journals/headers?p_offset=0&p_limit=5`,      { cache: 'no-store', headers: { Accept: 'application/json' } }),
      ]);
      if (apRes.status === 'fulfilled' && apRes.value.ok)               { const d = await apRes.value.json(); setApStats(d?.items?.[0] ?? d); }
      if (periodRes.status === 'fulfilled' && periodRes.value.ok)       { const d = await periodRes.value.json(); setGlPeriod((d.items || [])[0] ?? null); }
      if (approvalsRes.status === 'fulfilled' && approvalsRes.value.ok) { const d = await approvalsRes.value.json(); setApprovals(d.items || []); }
      if (jnlRes.status === 'fulfilled' && jnlRes.value.ok)             { const d = await jnlRes.value.json(); setRecentJnls(d.items || []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (n: number) =>
    n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : `${n}`;

  const fmtAmt = (n: number) =>
    n == null ? '—' : `AED ${Math.abs(n).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const pendingCount  = apStats?.pending_count  ?? apStats?.pendingCount  ?? 0;
  const pendingAmt    = apStats?.pending_amount ?? apStats?.pendingAmount ?? 0;
  const overdueCount  = apStats?.overdue_count  ?? apStats?.overdueCount  ?? 0;
  const paidThisMonth = apStats?.paid_this_month ?? apStats?.paidThisMonth ?? 0;

  const periodName   = glPeriod?.period_name ?? glPeriod?.periodName   ?? '—';
  const periodStatus = glPeriod?.status      ?? glPeriod?.glStatus     ?? '—';
  const isOpen       = periodStatus.toLowerCase().includes('open');

  return (
    <div style={{ padding: '20px 24px', background: REDWOOD.neutral50, minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Title level={3} style={{ margin: 0, color: REDWOOD.neutral800 }}>{greeting}, {userName} 👋</Title>
          <Text style={{ color: REDWOOD.neutral600, fontSize: 13 }}>{today.format('dddd, D MMMM YYYY')} · Re-ERP Enterprise Platform</Text>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {periodName !== '—' && <Tag icon={<CalendarOutlined />} style={{ padding: '4px 10px', borderRadius: 6 }}>Period: <strong>{periodName}</strong></Tag>}
          {periodStatus !== '—' && <Tag color={isOpen ? 'success' : 'error'} style={{ padding: '4px 10px', borderRadius: 6 }}>GL: {periodStatus}</Tag>}
          <Tag icon={<CheckCircleOutlined />} color="success" style={{ padding: '4px 10px', borderRadius: 6 }}>System Online</Tag>
          <Tag color="processing" style={{ padding: '4px 10px', borderRadius: 6 }}>v2.1.0 · Jul 21st</Tag>
        </div>
      </div>

      {/* KPI Row */}
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard label="Recent Journals" icon={<FileTextOutlined />} color={REDWOOD.primary}
            value={loading ? '…' : fmt(recentJnls.length)} sub="Latest batch loaded"
            trend="none" loading={loading} onClick={() => navigate('/gl/manage-journals')} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard label="GL Period" icon={<CalendarOutlined />} color={REDWOOD.info}
            value={loading ? '…' : (periodName !== '—' ? periodName : 'No period')}
            sub={periodStatus !== '—' ? `Status: ${periodStatus}` : 'Check accounting periods'}
            trend={isOpen ? 'up' : 'none'} loading={loading} onClick={() => navigate('/gl/accounting-periods')} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard label="AP Invoices" icon={<DollarOutlined />} color={REDWOOD.orange}
            value={loading ? '…' : (apStats ? fmt(apStats.pending_count ?? apStats.pendingCount ?? apStats.total_count ?? apStats.totalCount ?? '—') : '—')}
            sub={apStats ? 'Pending invoices' : 'Click to view invoices'}
            trend="none" loading={loading} onClick={() => navigate('/ap/manage-invoices')} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard label="Pending Approvals" icon={<ClockCircleOutlined />} color={REDWOOD.warning}
            value={loading ? '…' : fmt(approvals.length)}
            sub={approvals.length > 0 ? 'Awaiting your action' : 'All clear'}
            trend={approvals.length > 0 ? 'down' : 'none'} loading={loading} />
        </Col>
      </Row>

      {/* Body */}
      <Row gutter={[14, 14]}>

        {/* Module grid */}
        <Col xs={24} lg={16}>
          <Card style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }}
            styles={{ body: { padding: '16px 18px' } }}
            title={<Text strong style={{ fontSize: 13 }}><ThunderboltOutlined style={{ color: REDWOOD.primary, marginRight: 6 }} />Modules</Text>}>
            <Row gutter={[10, 10]}>
              {MODULES.map(mod => (
                <Col key={mod.id} xs={24} sm={12} xl={8}>
                  <ModuleTile mod={mod} onClick={() => navigate(mod.path)} />
                </Col>
              ))}
            </Row>
          </Card>
        </Col>

        {/* Right panel */}
        <Col xs={24} lg={8}>

          {/* Quick actions */}
          <Card style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }}
            styles={{ body: { padding: '16px 18px' } }}
            title={<Text strong style={{ fontSize: 13 }}><ThunderboltOutlined style={{ color: REDWOOD.primary, marginRight: 6 }} />Quick Actions</Text>}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {QUICK_ACTIONS.map((item, i) => (
                <div key={i} onClick={() => navigate(item.path)}
                  style={{ padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: REDWOOD.neutral50, display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${REDWOOD.neutral200}` }}
                  onMouseEnter={e => { (e.currentTarget.style.background = `${item.color}10`); (e.currentTarget.style.borderColor = item.color); }}
                  onMouseLeave={e => { (e.currentTarget.style.background = REDWOOD.neutral50); (e.currentTarget.style.borderColor = REDWOOD.neutral200); }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: `${item.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: item.color, flexShrink: 0 }}>
                    {item.icon}
                  </div>
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral800, fontWeight: 500, lineHeight: 1.3 }}>{item.label}</Text>
                </div>
              ))}
            </div>
          </Card>

          {/* Recent journals */}
          <Card style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }}
            styles={{ body: { padding: '16px 18px' } }}
            title={<Text strong style={{ fontSize: 13 }}><BookOutlined style={{ color: REDWOOD.purple, marginRight: 6 }} />Recent Journals</Text>}
            extra={<a onClick={() => navigate('/gl/manage-journals')} style={{ fontSize: 12, color: REDWOOD.info }}>View all</a>}>
            {loading ? <Spin size="small" /> : recentJnls.length === 0
              ? <Text style={{ color: REDWOOD.neutral600, fontSize: 13 }}>No journals found</Text>
              : recentJnls.slice(0, 5).map((j: any, i: number) => {
                  const name   = j.batchName || j.batch_name || j.journalName || `Journal #${j.jeHeaderId ?? j.je_header_id ?? i}`;
                  const period = j.periodName || j.period_name || j.defaultPeriodName || j.default_period_name || '';
                  const status = j.status || j.approvalStatus || j.approval_status || 'Draft';
                  const sc     = status.toLowerCase() === 'posted' ? 'success' : status.toLowerCase() === 'unposted' ? 'default' : 'processing';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < 4 ? `1px solid ${REDWOOD.neutral100}` : 'none' }}>
                      <div style={{ minWidth: 0 }}>
                        <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Text>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{period}</Text>
                      </div>
                      <Tag color={sc} style={{ fontSize: 10, marginLeft: 8, flexShrink: 0 }}>{status}</Tag>
                    </div>
                  );
                })
            }
          </Card>

          {/* Period status */}
          <Card style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}` }}
            styles={{ body: { padding: '16px 18px' } }}
            title={<Text strong style={{ fontSize: 13 }}><CalendarOutlined style={{ color: REDWOOD.info, marginRight: 6 }} />Accounting Period</Text>}>
            {loading ? <Spin size="small" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Current Period', value: <Text strong>{periodName}</Text> },
                  { label: 'GL Status',      value: <Tag color={isOpen ? 'success' : 'error'} style={{ margin: 0 }}>{periodStatus}</Tag> },
                  { label: 'Today',          value: <Text>{today.format('D MMM YYYY')}</Text> },
                ].map((row, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <Text style={{ color: REDWOOD.neutral600 }}>{row.label}</Text>
                    {row.value}
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, paddingTop: 8, display: 'flex', gap: 12 }}>
                  <a onClick={() => navigate('/gl/accounting-periods')} style={{ fontSize: 12, color: REDWOOD.info }}>Periods →</a>
                  <a onClick={() => navigate('/gl/trial-balance')}      style={{ fontSize: 12, color: REDWOOD.info }}>Trial Balance →</a>
                  <a onClick={() => navigate('/gl/manage-journals')}    style={{ fontSize: 12, color: REDWOOD.info }}>Journals →</a>
                </div>
              </div>
            )}
          </Card>

        </Col>
      </Row>
    </div>
  );
};

export default Home;
