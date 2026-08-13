import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Modal, Form, Input, InputNumber, Select, DatePicker, Descriptions, Tabs, Progress, Statistic,
  message, Divider,
} from 'antd';
import {
  HomeOutlined, BankOutlined, PlusOutlined, EditOutlined, EyeOutlined,
  ArrowUpOutlined, ArrowDownOutlined, TeamOutlined, LineChartOutlined,
  FundOutlined, BarChartOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_FUNDS, MOCK_RISK_METRICS, formatINR, formatPercent } from './mockData';
import type { Fund, FundHolding, RiskMetrics } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF', fundBlue: '#1565C0',
};

const FundManagement: React.FC = () => {
  const [funds, setFunds] = useState<Fund[]>(MOCK_FUNDS);
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [form] = Form.useForm();

  const totalAUM = useMemo(() => funds.reduce((s, f) => s + f.aum, 0), [funds]);

  const handleCreateFund = () => {
    form.validateFields().then(values => {
      const newFund: Fund = {
        id: `FUND-${String(funds.length + 1).padStart(3, '0')}`,
        ...values,
        nav: 100,
        previousNav: 100,
        navDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        aum: 0,
        highWaterMark: 100,
        status: 'Active',
        holdings: [],
        investors: [],
        inceptionDate: values.inceptionDate?.format('DD MMM YYYY') || new Date().toLocaleDateString(),
      };
      setFunds([...funds, newFund]);
      setCreateVisible(false);
      form.resetFields();
      message.success('Fund created successfully');
    });
  };

  const getRiskMetrics = (fundId: string): RiskMetrics | undefined =>
    MOCK_RISK_METRICS.find(r => r.fundId === fundId);

  // Fund table columns
  const columns = [
    {
      title: 'Fund', dataIndex: 'name', key: 'name', fixed: 'left' as const, width: 240,
      render: (v: string, r: Fund) => (
        <div>
          <Text strong style={{ fontSize: 13, cursor: 'pointer', color: REDWOOD.info }} onClick={() => { setSelectedFund(r); setDetailVisible(true); }}>{r.shortName}</Text>
          <br /><Text type="secondary" style={{ fontSize: 11 }}>{r.type} &bull; {r.strategy.substring(0, 50)}...</Text>
        </div>
      ),
    },
    {
      title: 'NAV', dataIndex: 'nav', key: 'nav', width: 100, sorter: (a: Fund, b: Fund) => a.nav - b.nav,
      render: (v: number, r: Fund) => {
        const chg = ((v - r.previousNav) / r.previousNav) * 100;
        return (
          <div>
            <Text strong>{v.toFixed(2)}</Text>
            <div style={{ fontSize: 11, color: chg >= 0 ? REDWOOD.success : REDWOOD.danger }}>
              {chg >= 0 ? <ArrowUpOutlined style={{ fontSize: 9 }} /> : <ArrowDownOutlined style={{ fontSize: 9 }} />} {formatPercent(chg)}
            </div>
          </div>
        );
      },
    },
    {
      title: 'AUM', dataIndex: 'aum', key: 'aum', width: 120, sorter: (a: Fund, b: Fund) => a.aum - b.aum,
      render: (v: number) => <Text strong>{formatINR(v)}</Text>,
    },
    {
      title: '% of Total', key: 'pctTotal', width: 120,
      render: (_: unknown, r: Fund) => {
        const pct = (r.aum / totalAUM) * 100;
        return (
          <div>
            <Text style={{ fontSize: 12 }}>{pct.toFixed(1)}%</Text>
            <Progress percent={pct} size="small" strokeColor={REDWOOD.fundBlue} showInfo={false} />
          </div>
        );
      },
    },
    {
      title: 'YTD Return', key: 'ytd', width: 100,
      render: (_: unknown, r: Fund) => {
        const rm = getRiskMetrics(r.id);
        if (!rm) return '-';
        return <Tag color={rm.ytdReturn >= 0 ? 'green' : 'red'}>{formatPercent(rm.ytdReturn)}</Tag>;
      },
      sorter: (a: Fund, b: Fund) => (getRiskMetrics(a.id)?.ytdReturn || 0) - (getRiskMetrics(b.id)?.ytdReturn || 0),
    },
    {
      title: 'Sharpe', key: 'sharpe', width: 80,
      render: (_: unknown, r: Fund) => {
        const rm = getRiskMetrics(r.id);
        return rm ? <Text>{rm.sharpeRatio.toFixed(2)}</Text> : '-';
      },
    },
    {
      title: 'Max DD', key: 'maxdd', width: 90,
      render: (_: unknown, r: Fund) => {
        const rm = getRiskMetrics(r.id);
        return rm ? <Text style={{ color: REDWOOD.danger }}>{rm.maxDrawdown.toFixed(2)}%</Text> : '-';
      },
    },
    {
      title: 'Holdings', key: 'holdings', width: 80,
      render: (_: unknown, r: Fund) => <Tag>{r.holdings.length}</Tag>,
    },
    {
      title: 'Investors', key: 'investors', width: 80,
      render: (_: unknown, r: Fund) => <Tag color="purple">{r.investors.length}</Tag>,
    },
    {
      title: 'Risk', dataIndex: 'riskCategory', key: 'risk', width: 100,
      render: (v: string) => <Tag color={v === 'Very High' ? 'red' : v === 'High' ? 'orange' : v === 'Moderate' ? 'blue' : 'green'}>{v}</Tag>,
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'Active' ? 'green' : v === 'Suspended' ? 'orange' : 'default'}>{v}</Tag>,
    },
    {
      title: 'Action', key: 'action', width: 80, fixed: 'right' as const,
      render: (_: unknown, r: Fund) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedFund(r); setDetailVisible(true); }}>Details</Button>
      ),
    },
  ];

  // Holdings table for detail view
  const holdingColumns = [
    { title: 'Symbol', dataIndex: 'symbol', key: 'symbol', render: (v: string, r: FundHolding) => (<div><Text strong style={{ fontSize: 13 }}>{v}</Text><br/><Text type="secondary" style={{ fontSize: 10 }}>{r.sector}</Text></div>) },
    { title: 'Qty', dataIndex: 'quantity', key: 'qty', render: (v: number) => v.toLocaleString('en-IN') },
    { title: 'Avg Cost', dataIndex: 'avgCostPrice', key: 'avg', render: (v: number) => formatINR(v) },
    { title: 'CMP', dataIndex: 'currentPrice', key: 'cmp', render: (v: number) => formatINR(v) },
    { title: 'Invested', dataIndex: 'investedValue', key: 'inv', render: (v: number) => formatINR(v) },
    { title: 'Current', dataIndex: 'currentValue', key: 'cur', render: (v: number) => formatINR(v) },
    {
      title: 'P&L', dataIndex: 'profitLoss', key: 'pnl',
      render: (v: number, r: FundHolding) => (
        <div style={{ color: v >= 0 ? REDWOOD.success : REDWOOD.danger }}>
          <div style={{ fontWeight: 600 }}>{formatINR(v)}</div>
          <div style={{ fontSize: 11 }}>{formatPercent(r.profitLossPercent)}</div>
        </div>
      ),
    },
    {
      title: 'Weight', key: 'weight',
      render: (_: unknown, r: FundHolding) => (
        <div>
          <Text>{r.weightPercent.toFixed(1)}%</Text>
          <div style={{ fontSize: 10, color: Math.abs(r.driftPercent) > 2 ? REDWOOD.danger : REDWOOD.neutral600 }}>
            Target: {r.targetWeightPercent}% | Drift: {r.driftPercent > 0 ? '+' : ''}{r.driftPercent.toFixed(1)}%
          </div>
        </div>
      ),
    },
    {
      title: 'Day Chg', key: 'daychg',
      render: (_: unknown, r: FundHolding) => (
        <Tag color={r.dayChangePercent >= 0 ? 'green' : 'red'}>{formatPercent(r.dayChangePercent)}</Tag>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/pms">PMS</Link> },
            { title: 'Fund Management' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: `${REDWOOD.fundBlue}15`, borderRadius: 12, padding: 12 }}>
                <BankOutlined style={{ fontSize: 28, color: REDWOOD.fundBlue }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Fund Management</Title>
                <Text type="secondary">Manage schemes, track NAV, and monitor AUM across all funds</Text>
              </div>
            </Space>
            <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreateVisible(true)}>
              Create Fund
            </Button>
          </div>

          {/* Summary KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Statistic title="Total AUM" value={formatINR(totalAUM)} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.fundBlue }} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Statistic title="Active Funds" value={funds.filter(f => f.status === 'Active').length} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Statistic title="Total Holdings" value={funds.reduce((s, f) => s + f.holdings.length, 0)} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Statistic title="Total Investors" value={funds.reduce((s, f) => s + f.investors.length, 0)} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
          </Row>

          {/* Funds Table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={funds}
              columns={columns}
              rowKey="id"
              scroll={{ x: 1400 }}
              pagination={false}
              size="middle"
            />
          </Card>
        </div>

        {/* Fund Detail Modal */}
        <Modal
          open={detailVisible}
          onCancel={() => setDetailVisible(false)}
          footer={null}
          width={1100}
          title={
            <Space>
              <BankOutlined style={{ color: REDWOOD.fundBlue }} />
              <span>{selectedFund?.name}</span>
              {selectedFund && <Tag color={selectedFund.status === 'Active' ? 'green' : 'default'}>{selectedFund.status}</Tag>}
            </Space>
          }
        >
          {selectedFund && (() => {
            const rm = getRiskMetrics(selectedFund.id);
            return (
              <Tabs defaultActiveKey="overview" items={[
                {
                  key: 'overview', label: 'Overview',
                  children: (
                    <>
                      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                        <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="NAV" value={selectedFund.nav.toFixed(2)} /></Card></Col>
                        <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="AUM" value={formatINR(selectedFund.aum)} /></Card></Col>
                        <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="YTD" value={rm ? formatPercent(rm.ytdReturn) : '-'} valueStyle={{ color: rm && rm.ytdReturn >= 0 ? REDWOOD.success : REDWOOD.danger }} /></Card></Col>
                        <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="Sharpe Ratio" value={rm?.sharpeRatio.toFixed(2) || '-'} /></Card></Col>
                      </Row>
                      <Descriptions bordered size="small" column={2}>
                        <Descriptions.Item label="Type">{selectedFund.type}</Descriptions.Item>
                        <Descriptions.Item label="Strategy">{selectedFund.strategy}</Descriptions.Item>
                        <Descriptions.Item label="Inception">{selectedFund.inceptionDate}</Descriptions.Item>
                        <Descriptions.Item label="Benchmark">{selectedFund.benchmarkIndex}</Descriptions.Item>
                        <Descriptions.Item label="Fund Manager">{selectedFund.fundManager}</Descriptions.Item>
                        <Descriptions.Item label="Risk Category"><Tag color={selectedFund.riskCategory === 'Very High' ? 'red' : selectedFund.riskCategory === 'High' ? 'orange' : 'blue'}>{selectedFund.riskCategory}</Tag></Descriptions.Item>
                        <Descriptions.Item label="Mgmt Fee">{selectedFund.managementFeePercent}% p.a.</Descriptions.Item>
                        <Descriptions.Item label="Perf Fee">{selectedFund.performanceFeePercent}% above {selectedFund.hurdleRatePercent}% hurdle</Descriptions.Item>
                        <Descriptions.Item label="High Water Mark">{selectedFund.highWaterMark.toFixed(2)}</Descriptions.Item>
                        <Descriptions.Item label="Min Investment">{formatINR(selectedFund.minInvestment)}</Descriptions.Item>
                        <Descriptions.Item label="Lock-in">{selectedFund.lockInMonths} months</Descriptions.Item>
                        <Descriptions.Item label="Description" span={2}>{selectedFund.description}</Descriptions.Item>
                      </Descriptions>
                    </>
                  ),
                },
                {
                  key: 'holdings', label: `Holdings (${selectedFund.holdings.length})`,
                  children: (
                    <Table dataSource={selectedFund.holdings} columns={holdingColumns} rowKey="key" size="small" pagination={false} scroll={{ x: 1000 }} />
                  ),
                },
                {
                  key: 'risk', label: 'Risk Metrics',
                  children: rm ? (
                    <Row gutter={[16, 16]}>
                      <Col span={24}>
                        <Descriptions bordered size="small" column={3} title="Returns">
                          <Descriptions.Item label="Daily">{formatPercent(rm.dailyReturn)}</Descriptions.Item>
                          <Descriptions.Item label="Weekly">{formatPercent(rm.weeklyReturn)}</Descriptions.Item>
                          <Descriptions.Item label="Monthly">{formatPercent(rm.monthlyReturn)}</Descriptions.Item>
                          <Descriptions.Item label="YTD">{formatPercent(rm.ytdReturn)}</Descriptions.Item>
                          <Descriptions.Item label="1 Year">{formatPercent(rm.oneYearReturn)}</Descriptions.Item>
                          <Descriptions.Item label="Since Inception">{formatPercent(rm.sinceInceptionReturn)}</Descriptions.Item>
                        </Descriptions>
                      </Col>
                      <Col span={24}>
                        <Descriptions bordered size="small" column={3} title="Risk Ratios">
                          <Descriptions.Item label="Std Dev">{rm.standardDeviation.toFixed(2)}%</Descriptions.Item>
                          <Descriptions.Item label="Sharpe">{rm.sharpeRatio.toFixed(2)}</Descriptions.Item>
                          <Descriptions.Item label="Sortino">{rm.sortinoRatio.toFixed(2)}</Descriptions.Item>
                          <Descriptions.Item label="Beta">{rm.beta.toFixed(2)}</Descriptions.Item>
                          <Descriptions.Item label="Alpha">{rm.alpha.toFixed(2)}%</Descriptions.Item>
                          <Descriptions.Item label="Treynor">{rm.treynorRatio.toFixed(2)}</Descriptions.Item>
                          <Descriptions.Item label="Info Ratio">{rm.informationRatio.toFixed(2)}</Descriptions.Item>
                          <Descriptions.Item label="Tracking Error">{rm.trackingError.toFixed(2)}%</Descriptions.Item>
                          <Descriptions.Item label="Max Drawdown"><Text style={{ color: REDWOOD.danger }}>{rm.maxDrawdown.toFixed(2)}%</Text></Descriptions.Item>
                          <Descriptions.Item label="VaR (95%)">{rm.var95.toFixed(2)}%</Descriptions.Item>
                          <Descriptions.Item label="VaR (99%)">{rm.var99.toFixed(2)}%</Descriptions.Item>
                          <Descriptions.Item label="CVaR (95%)">{rm.cvar95.toFixed(2)}%</Descriptions.Item>
                        </Descriptions>
                      </Col>
                      <Col span={24}>
                        <Text strong>Sector Concentration</Text>
                        <div style={{ marginTop: 8 }}>
                          {rm.sectorConcentration.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                              <Text style={{ width: 120, fontSize: 12 }}>{s.sector}</Text>
                              <Progress percent={s.percent} size="small" style={{ flex: 1 }} strokeColor={REDWOOD.fundBlue} format={p => `${p?.toFixed(1)}%`} />
                            </div>
                          ))}
                        </div>
                      </Col>
                    </Row>
                  ) : <Text type="secondary">No risk metrics available</Text>,
                },
                {
                  key: 'investors', label: `Investors (${selectedFund.investors.length})`,
                  children: (
                    <Table
                      dataSource={selectedFund.investors}
                      columns={[
                        { title: 'Investor ID', dataIndex: 'investorId', key: 'id' },
                        { title: 'Commitment', dataIndex: 'commitmentAmount', key: 'commit', render: (v: number) => formatINR(v) },
                        { title: 'Invested', dataIndex: 'investedAmount', key: 'invested', render: (v: number) => formatINR(v) },
                        { title: 'Current Value', dataIndex: 'currentValue', key: 'current', render: (v: number) => formatINR(v) },
                        { title: 'Units', dataIndex: 'units', key: 'units', render: (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) },
                        { title: 'Join Date', dataIndex: 'joinDate', key: 'join' },
                        { title: 'Status', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'Active' ? 'green' : 'default'}>{v}</Tag> },
                      ]}
                      rowKey="investorId"
                      size="small"
                      pagination={false}
                    />
                  ),
                },
              ]} />
            );
          })()}
        </Modal>

        {/* Create Fund Modal */}
        <Modal
          open={createVisible}
          onCancel={() => { setCreateVisible(false); form.resetFields(); }}
          onOk={handleCreateFund}
          title={<Space><BankOutlined style={{ color: REDWOOD.fundBlue }} /> Create New Fund</Space>}
          width={700}
          okText="Create Fund"
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col span={16}><Form.Item name="name" label="Fund Name" rules={[{ required: true }]}><Input placeholder="e.g. Alpha Growth Equity Fund" /></Form.Item></Col>
              <Col span={8}><Form.Item name="shortName" label="Short Name" rules={[{ required: true }]}><Input placeholder="e.g. Alpha Growth" /></Form.Item></Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="type" label="Fund Type" rules={[{ required: true }]}>
                  <Select options={['Equity', 'Debt', 'Hybrid', 'Multi-Asset', 'Sector', 'Thematic'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="riskCategory" label="Risk Category" rules={[{ required: true }]}>
                  <Select options={['Low', 'Moderate', 'High', 'Very High'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="inceptionDate" label="Inception Date"><DatePicker style={{ width: '100%' }} /></Form.Item>
              </Col>
            </Row>
            <Form.Item name="strategy" label="Strategy"><Input.TextArea rows={2} placeholder="Describe the investment strategy" /></Form.Item>
            <Row gutter={16}>
              <Col span={8}><Form.Item name="benchmarkIndex" label="Benchmark Index"><Input placeholder="e.g. Nifty 50 TRI" /></Form.Item></Col>
              <Col span={8}><Form.Item name="fundManager" label="Fund Manager"><Input placeholder="Manager name" /></Form.Item></Col>
              <Col span={8}><Form.Item name="minInvestment" label="Min Investment"><InputNumber style={{ width: '100%' }} formatter={v => `₹ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} /></Form.Item></Col>
            </Row>
            <Row gutter={16}>
              <Col span={6}><Form.Item name="managementFeePercent" label="Mgmt Fee %"><InputNumber style={{ width: '100%' }} step={0.1} min={0} max={5} /></Form.Item></Col>
              <Col span={6}><Form.Item name="performanceFeePercent" label="Perf Fee %"><InputNumber style={{ width: '100%' }} step={1} min={0} max={30} /></Form.Item></Col>
              <Col span={6}><Form.Item name="hurdleRatePercent" label="Hurdle Rate %"><InputNumber style={{ width: '100%' }} step={0.5} min={0} max={20} /></Form.Item></Col>
              <Col span={6}><Form.Item name="lockInMonths" label="Lock-in (months)"><InputNumber style={{ width: '100%' }} min={0} max={60} /></Form.Item></Col>
            </Row>
            <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  );
};

export default FundManagement;
