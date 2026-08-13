import React from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Statistic, Breadcrumb, Tag, Progress, Divider, Badge, Table,
} from 'antd';
import {
  HomeOutlined, StockOutlined, EyeOutlined, FundOutlined, PieChartOutlined,
  ArrowUpOutlined, ArrowDownOutlined, BankOutlined, TeamOutlined, SwapOutlined,
  AlertOutlined, FileTextOutlined, SettingOutlined, LineChartOutlined,
  DollarOutlined, SafetyCertificateOutlined, BarChartOutlined, CalendarOutlined,
  RightOutlined, ThunderboltOutlined, WarningOutlined, CheckCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { MOCK_DASHBOARD_KPIS, MOCK_FUNDS, MOCK_ORDERS, MOCK_COMPLIANCE_RULES, MOCK_RISK_METRICS, formatINR, formatPercent } from './mockData';
import type { Fund, Order, ComplianceRule } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  successLight: '#E8F5E9',
  warning: '#D4A800',
  warningLight: '#FFF8E1',
  danger: '#D32F2F',
  dangerLight: '#FFEBEE',
  info: '#0572CE',
  infoLight: '#E3F2FD',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  portfolioPurple: '#6B4C9A',
  fundBlue: '#1565C0',
  riskOrange: '#E65100',
};

interface NavItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
  path: string;
  badge?: number;
}

const PMSModule: React.FC = () => {
  const navigate = useNavigate();
  const kpis = MOCK_DASHBOARD_KPIS;

  // Navigation modules
  const moduleItems: NavItemType[] = [
    { key: 'funds', icon: <BankOutlined />, label: 'Fund Management', description: 'Manage funds, NAV, AUM tracking', color: REDWOOD.fundBlue, path: '/pms/funds' },
    { key: 'watchlist', icon: <EyeOutlined />, label: 'Watchlist', description: 'Stock screening & watchlists', color: REDWOOD.info, path: '/pms/watchlist' },
    { key: 'portfolio', icon: <PieChartOutlined />, label: 'Portfolio', description: 'Holdings & allocation', color: REDWOOD.portfolioPurple, path: '/pms/portfolio' },
    { key: 'orders', icon: <SwapOutlined />, label: 'Order Management', description: 'OMS - Place & track orders', color: '#1565C0', path: '/pms/orders', badge: kpis.pendingOrders },
    { key: 'transactions', icon: <CalendarOutlined />, label: 'Transactions', description: 'Trade book & settlements', color: '#00796B', path: '/pms/transactions', badge: kpis.pendingSettlements },
    { key: 'investors', icon: <TeamOutlined />, label: 'Investors', description: 'Client & capital accounts', color: '#5E35B1', path: '/pms/investors' },
    { key: 'risk', icon: <ThunderboltOutlined />, label: 'Risk Analytics', description: 'VaR, Sharpe, drawdown', color: REDWOOD.riskOrange, path: '/pms/risk' },
    { key: 'compliance', icon: <SafetyCertificateOutlined />, label: 'Compliance', description: 'SEBI limits & monitoring', color: REDWOOD.danger, path: '/pms/compliance', badge: kpis.complianceAlerts },
    { key: 'model', icon: <SettingOutlined />, label: 'Model Portfolio', description: 'Target allocation & rebalance', color: '#37474F', path: '/pms/model-portfolio' },
    { key: 'benchmark', icon: <LineChartOutlined />, label: 'Benchmark', description: 'Index comparison & attribution', color: '#1B5E20', path: '/pms/benchmark' },
    { key: 'fees', icon: <DollarOutlined />, label: 'Fee Management', description: 'Mgmt & performance fees', color: '#BF360C', path: '/pms/fees' },
    { key: 'reports', icon: <FileTextOutlined />, label: 'Reports', description: 'Statements, MIS, analytics', color: '#4A148C', path: '/pms/reports' },
    { key: 'investment-holdings', icon: <BarChartOutlined />, label: 'Investment Holdings', description: 'NRE/NRO equity holdings & P&L', color: '#00695C', path: '/pms/investment-holdings' },
  ];

  // KPI Card
  const KpiCard = ({ title, value, prefix, icon, color, trend, subtitle }: {
    title: string; value: string | number; prefix?: string;
    icon: React.ReactNode; color: string; trend?: { value: number; isUp: boolean }; subtitle?: string;
  }) => (
    <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', height: '100%' }} bodyStyle={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
          <Statistic value={value} prefix={prefix} valueStyle={{ fontSize: 22, fontWeight: 700, color: REDWOOD.neutral900 }} />
          {trend && (
            <Space size={4} style={{ marginTop: 2 }}>
              {trend.isUp ? <ArrowUpOutlined style={{ color: REDWOOD.success, fontSize: 11 }} /> : <ArrowDownOutlined style={{ color: REDWOOD.danger, fontSize: 11 }} />}
              <Text style={{ fontSize: 11, color: trend.isUp ? REDWOOD.success : REDWOOD.danger }}>{formatPercent(trend.value)}</Text>
            </Space>
          )}
          {subtitle && <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>{subtitle}</Text>}
        </div>
        <div style={{ background: `${color}15`, borderRadius: 10, padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {React.cloneElement(icon as React.ReactElement<{ style?: React.CSSProperties }>, { style: { fontSize: 24, color } })}
        </div>
      </div>
    </Card>
  );

  // Fund performance mini-card
  const FundMiniCard = ({ fund, riskMetric }: { fund: Fund; riskMetric?: typeof MOCK_RISK_METRICS[0] }) => {
    const navChange = ((fund.nav - fund.previousNav) / fund.previousNav) * 100;
    const isUp = navChange >= 0;
    return (
      <Card
        hoverable
        style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, cursor: 'pointer' }}
        bodyStyle={{ padding: '14px 16px' }}
        onClick={() => navigate('/pms/funds')}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <Text strong style={{ fontSize: 14 }}>{fund.shortName}</Text>
            <Tag color={fund.riskCategory === 'Very High' ? 'red' : fund.riskCategory === 'High' ? 'orange' : fund.riskCategory === 'Moderate' ? 'blue' : 'green'} style={{ marginLeft: 8, fontSize: 10 }}>
              {fund.riskCategory}
            </Tag>
          </div>
          <Tag color={isUp ? 'green' : 'red'} style={{ fontSize: 12, fontWeight: 600 }}>
            {isUp ? '+' : ''}{navChange.toFixed(2)}%
          </Tag>
        </div>
        <Row gutter={16}>
          <Col span={8}>
            <Text type="secondary" style={{ fontSize: 11 }}>NAV</Text>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{fund.nav.toFixed(2)}</div>
          </Col>
          <Col span={8}>
            <Text type="secondary" style={{ fontSize: 11 }}>AUM</Text>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{formatINR(fund.aum, false)}</div>
          </Col>
          <Col span={8}>
            <Text type="secondary" style={{ fontSize: 11 }}>YTD</Text>
            <div style={{ fontWeight: 600, fontSize: 14, color: riskMetric && riskMetric.ytdReturn >= 0 ? REDWOOD.success : REDWOOD.danger }}>
              {riskMetric ? formatPercent(riskMetric.ytdReturn) : 'N/A'}
            </div>
          </Col>
        </Row>
        <Progress percent={Math.min(100, (fund.aum / kpis.totalAUM) * 100)} size="small" strokeColor={REDWOOD.fundBlue} showInfo={false} style={{ marginTop: 8, marginBottom: 0 }} />
        <Text type="secondary" style={{ fontSize: 10 }}>{((fund.aum / kpis.totalAUM) * 100).toFixed(1)}% of Total AUM</Text>
      </Card>
    );
  };

  // Recent orders table
  const recentOrders = MOCK_ORDERS.filter(o => o.status === 'Pending' || o.status === 'Partially Filled').slice(0, 5);
  const orderColumns = [
    { title: 'Symbol', dataIndex: 'symbol', key: 'symbol', render: (v: string, r: Order) => (
      <div><Text strong style={{ fontSize: 13 }}>{v}</Text><br/><Text type="secondary" style={{ fontSize: 11 }}>{r.fundName}</Text></div>
    )},
    { title: 'Side', dataIndex: 'side', key: 'side', render: (v: string) => <Tag color={v === 'Buy' ? 'green' : 'red'}>{v}</Tag> },
    { title: 'Qty', dataIndex: 'quantity', key: 'quantity', render: (v: number) => v.toLocaleString('en-IN') },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: string) => (
      <Tag color={v === 'Pending' ? 'orange' : v === 'Partially Filled' ? 'blue' : 'green'} icon={v === 'Pending' ? <ClockCircleOutlined /> : undefined}>{v}</Tag>
    )},
  ];

  // Compliance alerts
  const alerts = MOCK_COMPLIANCE_RULES.filter((r: ComplianceRule) => r.status !== 'Compliant');

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[{ title: <Link to="/home"><HomeOutlined /> Home</Link> }, { title: 'Portfolio Management System' }]} />
        </div>

        <div style={{ padding: '20px 24px', paddingRight: 48 }}>
          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: `${REDWOOD.portfolioPurple}15`, borderRadius: 12, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <StockOutlined style={{ fontSize: 28, color: REDWOOD.portfolioPurple }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Institutional PMS</Title>
                <Text type="secondary">Own-Fund Portfolio Management System &bull; {MOCK_FUNDS.length} Active Funds &bull; {kpis.activeInvestors} Investors</Text>
              </div>
            </Space>
          </div>

          {/* KPI Row 1: Main metrics */}
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard title="Total AUM" value={formatINR(kpis.totalAUM)} icon={<BankOutlined />} color={REDWOOD.fundBlue} trend={{ value: kpis.aumChange, isUp: kpis.aumChange >= 0 }} subtitle={`${kpis.activeFunds} Active Funds`} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard title="Total P&L" value={formatINR(kpis.totalPnL)} icon={<FundOutlined />} color={REDWOOD.success} trend={{ value: kpis.totalPnLPercent, isUp: kpis.totalPnLPercent >= 0 }} subtitle="Since inception" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard title="Today's P&L" value={formatINR(kpis.todayPnL)} icon={<BarChartOutlined />} color={kpis.todayPnL >= 0 ? REDWOOD.success : REDWOOD.danger} trend={{ value: kpis.todayPnLPercent, isUp: kpis.todayPnLPercent >= 0 }} subtitle="Mark-to-market" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard title="YTD Return" value={formatPercent(kpis.ytdReturn)} icon={<LineChartOutlined />} color={REDWOOD.portfolioPurple} trend={{ value: kpis.ytdReturn, isUp: kpis.ytdReturn >= 0 }} subtitle={`Best: ${kpis.bestFund.name} (${formatPercent(kpis.bestFund.return)})`} />
            </Col>
          </Row>

          {/* KPI Row 2: Operational metrics */}
          <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} bodyStyle={{ padding: '12px 8px' }}>
                <Statistic value={kpis.totalFunds} valueStyle={{ fontSize: 24, fontWeight: 700, color: REDWOOD.fundBlue }} />
                <Text type="secondary" style={{ fontSize: 11 }}>Active Funds</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} bodyStyle={{ padding: '12px 8px' }}>
                <Statistic value={kpis.activeInvestors} valueStyle={{ fontSize: 24, fontWeight: 700, color: '#5E35B1' }} />
                <Text type="secondary" style={{ fontSize: 11 }}>Investors</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Badge count={kpis.pendingOrders} size="small" offset={[-8, 0]}>
                <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', width: '100%' }} bodyStyle={{ padding: '12px 8px' }}>
                  <Statistic value={kpis.pendingOrders} valueStyle={{ fontSize: 24, fontWeight: 700, color: REDWOOD.warning }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>Pending Orders</Text>
                </Card>
              </Badge>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Badge count={kpis.complianceAlerts} size="small" offset={[-8, 0]}>
                <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', width: '100%' }} bodyStyle={{ padding: '12px 8px' }}>
                  <Statistic value={kpis.complianceAlerts} valueStyle={{ fontSize: 24, fontWeight: 700, color: REDWOOD.danger }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>Alerts</Text>
                </Card>
              </Badge>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} bodyStyle={{ padding: '12px 8px' }}>
                <Statistic value={kpis.pendingSettlements} valueStyle={{ fontSize: 24, fontWeight: 700, color: '#00796B' }} />
                <Text type="secondary" style={{ fontSize: 11 }}>Pending Settle</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} bodyStyle={{ padding: '12px 8px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }}>{kpis.bestFund.name}</div>
                <Text type="secondary" style={{ fontSize: 11 }}>Best Fund YTD</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} bodyStyle={{ padding: '12px 8px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: REDWOOD.riskOrange }}>{kpis.worstFund.name}</div>
                <Text type="secondary" style={{ fontSize: 11 }}>Lowest YTD</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, textAlign: 'center', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} bodyStyle={{ padding: '12px 8px' }}>
                <Statistic value={MOCK_RISK_METRICS[0]?.sharpeRatio || 0} precision={2} valueStyle={{ fontSize: 24, fontWeight: 700, color: REDWOOD.portfolioPurple }} />
                <Text type="secondary" style={{ fontSize: 11 }}>Sharpe (Flagship)</Text>
              </Card>
            </Col>
          </Row>

          {/* Fund Performance Cards */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: `${REDWOOD.fundBlue}15`, borderRadius: 8, padding: 6, display: 'flex' }}>
                  <BankOutlined style={{ fontSize: 18, color: REDWOOD.fundBlue }} />
                </div>
                <Text strong style={{ fontSize: 16 }}>Fund Overview</Text>
              </div>
              <Link to="/pms/funds" style={{ fontSize: 13, color: REDWOOD.info }}>View All <RightOutlined style={{ fontSize: 10 }} /></Link>
            </div>
            <Row gutter={[12, 12]}>
              {MOCK_FUNDS.map((fund: Fund) => {
                const rm = MOCK_RISK_METRICS.find(r => r.fundId === fund.id);
                return (
                  <Col xs={24} sm={12} lg={6} key={fund.id}>
                    <FundMiniCard fund={fund} riskMetric={rm} />
                  </Col>
                );
              })}
            </Row>
          </div>

          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {/* Pending Orders */}
            <Col xs={24} lg={12}>
              <Card
                title={<Space><SwapOutlined style={{ color: '#1565C0' }} /><Text strong>Pending Orders</Text><Badge count={recentOrders.length} style={{ backgroundColor: REDWOOD.warning }} /></Space>}
                extra={<Link to="/pms/orders" style={{ fontSize: 12 }}>View All <RightOutlined style={{ fontSize: 10 }} /></Link>}
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                bodyStyle={{ padding: '0 16px 16px' }}
              >
                <Table dataSource={recentOrders} columns={orderColumns} size="small" pagination={false} rowKey="id" />
              </Card>
            </Col>

            {/* Compliance Alerts */}
            <Col xs={24} lg={12}>
              <Card
                title={<Space><AlertOutlined style={{ color: REDWOOD.danger }} /><Text strong>Compliance Alerts</Text><Badge count={alerts.length} style={{ backgroundColor: REDWOOD.danger }} /></Space>}
                extra={<Link to="/pms/compliance" style={{ fontSize: 12 }}>View All <RightOutlined style={{ fontSize: 10 }} /></Link>}
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                bodyStyle={{ padding: '12px 16px' }}
              >
                {alerts.map((rule: ComplianceRule) => (
                  <div key={rule.id} style={{ padding: '8px 0', borderBottom: `1px solid ${REDWOOD.neutral100}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ fontSize: 13 }}>{rule.name}</Text>
                        {rule.fundId && <Tag style={{ marginLeft: 8, fontSize: 10 }}>{MOCK_FUNDS.find(f => f.id === rule.fundId)?.shortName}</Tag>}
                      </div>
                      <Tag color={rule.status === 'Breach' ? 'red' : 'orange'} icon={rule.status === 'Breach' ? <WarningOutlined /> : <AlertOutlined />}>
                        {rule.status}
                      </Tag>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{rule.description}</Text>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>
                        {rule.currentValue}{typeof rule.limit === 'number' && rule.limit > 1 ? '%' : ''} / {rule.limit}{typeof rule.limit === 'number' && rule.limit > 1 ? '%' : ''} limit
                      </Text>
                    </div>
                    <Progress
                      percent={Math.min(100, (rule.currentValue / rule.limit) * 100)}
                      size="small"
                      strokeColor={rule.status === 'Breach' ? REDWOOD.danger : REDWOOD.warning}
                      showInfo={false}
                      style={{ marginTop: 4 }}
                    />
                  </div>
                ))}
              </Card>
            </Col>
          </Row>

          {/* Module Navigation Grid */}
          <Divider style={{ margin: '16px 0' }} />
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ background: `${REDWOOD.portfolioPurple}15`, borderRadius: 8, padding: 6, display: 'flex' }}>
                <BarChartOutlined style={{ fontSize: 18, color: REDWOOD.portfolioPurple }} />
              </div>
              <Text strong style={{ fontSize: 16 }}>All Modules</Text>
            </div>
            <Row gutter={[12, 12]}>
              {moduleItems.map((item) => (
                <Col xs={12} sm={8} md={6} lg={4} key={item.key}>
                  <Badge count={item.badge} size="small" offset={[-12, 4]}>
                    <Card
                      hoverable
                      style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, cursor: 'pointer', height: '100%' }}
                      bodyStyle={{ padding: '14px 12px', textAlign: 'center' }}
                      onClick={() => navigate(item.path)}
                    >
                      <div style={{ background: `${item.color}12`, borderRadius: 12, padding: 12, display: 'inline-flex', marginBottom: 8 }}>
                        {React.cloneElement(item.icon as React.ReactElement<{ style?: React.CSSProperties }>, { style: { fontSize: 24, color: item.color } })}
                      </div>
                      <div>
                        <Text strong style={{ fontSize: 13, display: 'block', color: REDWOOD.neutral900 }}>{item.label}</Text>
                        <Text type="secondary" style={{ fontSize: 10 }}>{item.description}</Text>
                      </div>
                    </Card>
                  </Badge>
                </Col>
              ))}
            </Row>
          </div>

          {/* Quick Stats Footer */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', background: `linear-gradient(135deg, ${REDWOOD.neutral900} 0%, #2D2D2D 100%)` }} bodyStyle={{ padding: '16px 24px' }}>
            <Row gutter={24} align="middle">
              <Col flex="auto">
                <Text style={{ color: '#ffffff99', fontSize: 12 }}>PORTFOLIO SUMMARY</Text>
                <Title level={4} style={{ color: '#fff', margin: '4px 0' }}>
                  {formatINR(kpis.totalAUM)} AUM across {kpis.activeFunds} funds
                </Title>
              </Col>
              <Col>
                <div style={{ textAlign: 'center', padding: '0 16px', borderRight: '1px solid #ffffff22' }}>
                  <Text style={{ color: '#ffffff80', fontSize: 11 }}>Total P&L</Text>
                  <div style={{ color: kpis.totalPnL >= 0 ? '#4CAF50' : '#EF5350', fontSize: 18, fontWeight: 700 }}>{formatINR(kpis.totalPnL)}</div>
                </div>
              </Col>
              <Col>
                <div style={{ textAlign: 'center', padding: '0 16px', borderRight: '1px solid #ffffff22' }}>
                  <Text style={{ color: '#ffffff80', fontSize: 11 }}>Today</Text>
                  <div style={{ color: kpis.todayPnL >= 0 ? '#4CAF50' : '#EF5350', fontSize: 18, fontWeight: 700 }}>{formatINR(kpis.todayPnL)}</div>
                </div>
              </Col>
              <Col>
                <div style={{ textAlign: 'center', padding: '0 16px', borderRight: '1px solid #ffffff22' }}>
                  <Text style={{ color: '#ffffff80', fontSize: 11 }}>Sharpe</Text>
                  <div style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{MOCK_RISK_METRICS[0]?.sharpeRatio.toFixed(2)}</div>
                </div>
              </Col>
              <Col>
                <div style={{ textAlign: 'center', padding: '0 16px' }}>
                  <Text style={{ color: '#ffffff80', fontSize: 11 }}>Status</Text>
                  <div><CheckCircleOutlined style={{ color: '#4CAF50', fontSize: 20, marginTop: 2 }} /></div>
                </div>
              </Col>
            </Row>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default PMSModule;
