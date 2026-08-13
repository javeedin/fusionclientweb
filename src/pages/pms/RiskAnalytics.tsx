import React, { useState } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Select, Tag, Statistic,
  Progress, Descriptions, Table, Divider,
} from 'antd';
import {
  HomeOutlined, ThunderboltOutlined, ArrowUpOutlined, ArrowDownOutlined,
  WarningOutlined, LineChartOutlined, BarChartOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_FUNDS, MOCK_RISK_METRICS, formatPercent } from './mockData';
import type { RiskMetrics } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF', riskOrange: '#E65100',
};

const RiskAnalytics: React.FC = () => {
  const [selectedFundId, setSelectedFundId] = useState<string>('FUND-001');

  const selectedFund = MOCK_FUNDS.find(f => f.id === selectedFundId);
  const metrics = MOCK_RISK_METRICS.find(r => r.fundId === selectedFundId);

  const MetricCard = ({ title, value, suffix, color, description }: {
    title: string; value: string | number; suffix?: string; color?: string; description?: string;
  }) => (
    <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center', height: '100%' }} bodyStyle={{ padding: '12px 10px' }}>
      <Text type="secondary" style={{ fontSize: 11 }}>{title}</Text>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || REDWOOD.neutral900, marginTop: 4 }}>
        {value}{suffix}
      </div>
      {description && <Text type="secondary" style={{ fontSize: 10 }}>{description}</Text>}
    </Card>
  );

  const RiskGauge = ({ label, value, maxValue, warningThreshold, dangerThreshold }: {
    label: string; value: number; maxValue: number; warningThreshold: number; dangerThreshold: number;
  }) => {
    const pct = Math.min(100, (Math.abs(value) / Math.abs(maxValue)) * 100);
    const color = Math.abs(value) >= Math.abs(dangerThreshold) ? REDWOOD.danger : Math.abs(value) >= Math.abs(warningThreshold) ? REDWOOD.warning : REDWOOD.success;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ fontSize: 12 }}>{label}</Text>
          <Text strong style={{ fontSize: 12, color }}>{value.toFixed(2)}%</Text>
        </div>
        <Progress percent={pct} strokeColor={color} showInfo={false} size="small" />
      </div>
    );
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/pms">PMS</Link> },
            { title: 'Risk Analytics' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: `${REDWOOD.riskOrange}15`, borderRadius: 12, padding: 12 }}>
                <ThunderboltOutlined style={{ fontSize: 28, color: REDWOOD.riskOrange }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Risk Analytics</Title>
                <Text type="secondary">Portfolio risk metrics, VaR analysis, and concentration monitoring</Text>
              </div>
            </Space>
            <Select
              value={selectedFundId}
              onChange={setSelectedFundId}
              style={{ width: 250 }}
              options={MOCK_FUNDS.map(f => ({ label: `${f.shortName} (${f.type})`, value: f.id }))}
            />
          </div>

          {metrics ? (
            <>
              {/* Returns Overview */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <LineChartOutlined style={{ color: REDWOOD.success }} />
                  <Text strong style={{ fontSize: 15 }}>Performance Returns — {selectedFund?.shortName}</Text>
                </div>
                <Row gutter={[10, 10]}>
                  {[
                    { label: 'Daily', value: metrics.dailyReturn },
                    { label: 'Weekly', value: metrics.weeklyReturn },
                    { label: 'Monthly', value: metrics.monthlyReturn },
                    { label: 'YTD', value: metrics.ytdReturn },
                    { label: '1 Year', value: metrics.oneYearReturn },
                    { label: '3 Year', value: metrics.threeYearReturn },
                    { label: 'Since Inception', value: metrics.sinceInceptionReturn },
                  ].map((item, i) => (
                    <Col xs={12} sm={6} lg={3} key={i}>
                      <MetricCard
                        title={item.label}
                        value={formatPercent(item.value)}
                        color={item.value >= 0 ? REDWOOD.success : REDWOOD.danger}
                      />
                    </Col>
                  ))}
                  <Col xs={12} sm={6} lg={3}>
                    <MetricCard title="Benchmark" value={selectedFund?.benchmarkIndex || ''} color={REDWOOD.info} />
                  </Col>
                </Row>
              </div>

              {/* Risk Ratios */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <BarChartOutlined style={{ color: REDWOOD.riskOrange }} />
                  <Text strong style={{ fontSize: 15 }}>Risk Ratios</Text>
                </div>
                <Row gutter={[10, 10]}>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Std Deviation" value={metrics.standardDeviation.toFixed(2)} suffix="%" description="Annualized volatility" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Sharpe Ratio" value={metrics.sharpeRatio.toFixed(2)} color={metrics.sharpeRatio >= 1 ? REDWOOD.success : metrics.sharpeRatio >= 0.5 ? REDWOOD.warning : REDWOOD.danger} description="Risk-adj return" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Sortino Ratio" value={metrics.sortinoRatio.toFixed(2)} color={metrics.sortinoRatio >= 1.5 ? REDWOOD.success : REDWOOD.warning} description="Downside risk-adj" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Beta" value={metrics.beta.toFixed(2)} color={metrics.beta > 1.2 ? REDWOOD.danger : metrics.beta > 0.8 ? REDWOOD.warning : REDWOOD.success} description="Market sensitivity" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Alpha" value={metrics.alpha.toFixed(2)} suffix="%" color={metrics.alpha > 0 ? REDWOOD.success : REDWOOD.danger} description="Excess return" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Treynor Ratio" value={metrics.treynorRatio.toFixed(2)} description="Return per unit risk" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Info Ratio" value={metrics.informationRatio.toFixed(2)} color={metrics.informationRatio >= 0.5 ? REDWOOD.success : REDWOOD.neutral600} description="Active return/TE" /></Col>
                  <Col xs={12} sm={6} lg={3}><MetricCard title="Tracking Error" value={metrics.trackingError.toFixed(2)} suffix="%" description="vs Benchmark" /></Col>
                </Row>
              </div>

              <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                {/* Drawdown Analysis */}
                <Col xs={24} lg={12}>
                  <Card title={<Space><WarningOutlined style={{ color: REDWOOD.danger }} /><Text strong>Drawdown Analysis</Text></Space>} style={{ borderRadius: 12, border: 'none', height: '100%' }}>
                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                      <Col span={8}>
                        <Card size="small" style={{ textAlign: 'center', borderRadius: 8, background: `${REDWOOD.danger}08` }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>Max Drawdown</Text>
                          <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.danger }}>{metrics.maxDrawdown.toFixed(2)}%</div>
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>Current DD</Text>
                          <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.warning }}>{metrics.currentDrawdown.toFixed(2)}%</div>
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>DD Duration</Text>
                          <div style={{ fontSize: 24, fontWeight: 700 }}>{metrics.drawdownDuration} days</div>
                        </Card>
                      </Col>
                    </Row>
                    <RiskGauge label="Current Drawdown vs Max" value={metrics.currentDrawdown} maxValue={metrics.maxDrawdown} warningThreshold={metrics.maxDrawdown * 0.5} dangerThreshold={metrics.maxDrawdown * 0.8} />
                    <Divider style={{ margin: '12px 0' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      The fund experienced its maximum drawdown of {metrics.maxDrawdown.toFixed(2)}% with a recovery period of {metrics.drawdownDuration} trading days.
                      Current drawdown stands at {metrics.currentDrawdown.toFixed(2)}%.
                    </Text>
                  </Card>
                </Col>

                {/* VaR Analysis */}
                <Col xs={24} lg={12}>
                  <Card title={<Space><ThunderboltOutlined style={{ color: REDWOOD.riskOrange }} /><Text strong>Value at Risk (VaR)</Text></Space>} style={{ borderRadius: 12, border: 'none', height: '100%' }}>
                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                      <Col span={8}>
                        <Card size="small" style={{ textAlign: 'center', borderRadius: 8, background: `${REDWOOD.warning}08` }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>VaR (95%)</Text>
                          <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.warning }}>{metrics.var95.toFixed(2)}%</div>
                          <Text type="secondary" style={{ fontSize: 10 }}>1-day, parametric</Text>
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small" style={{ textAlign: 'center', borderRadius: 8, background: `${REDWOOD.danger}08` }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>VaR (99%)</Text>
                          <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.danger }}>{metrics.var99.toFixed(2)}%</div>
                          <Text type="secondary" style={{ fontSize: 10 }}>1-day, parametric</Text>
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small" style={{ textAlign: 'center', borderRadius: 8, background: `${REDWOOD.danger}08` }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>CVaR (95%)</Text>
                          <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.danger }}>{metrics.cvar95.toFixed(2)}%</div>
                          <Text type="secondary" style={{ fontSize: 10 }}>Expected Shortfall</Text>
                        </Card>
                      </Col>
                    </Row>
                    <Divider style={{ margin: '12px 0' }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      With 95% confidence, the portfolio will not lose more than <Text strong>{Math.abs(metrics.var95).toFixed(2)}%</Text> in a single trading day.
                      The Conditional VaR (Expected Shortfall) of <Text strong>{Math.abs(metrics.cvar95).toFixed(2)}%</Text> represents the expected loss in the worst 5% of scenarios.
                    </Text>
                  </Card>
                </Col>
              </Row>

              {/* Concentration Analysis */}
              <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                <Col xs={24} lg={12}>
                  <Card title={<Text strong>Sector Concentration</Text>} style={{ borderRadius: 12, border: 'none' }}>
                    {metrics.sectorConcentration.map((sector, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <Text style={{ fontSize: 12 }}>{sector.sector}</Text>
                          <Text strong style={{ fontSize: 12 }}>{sector.percent.toFixed(1)}%</Text>
                        </div>
                        <Progress
                          percent={sector.percent}
                          size="small"
                          strokeColor={sector.percent > 30 ? REDWOOD.danger : sector.percent > 20 ? REDWOOD.warning : REDWOOD.info}
                          showInfo={false}
                        />
                      </div>
                    ))}
                    <Divider style={{ margin: '12px 0' }} />
                    <Row gutter={16}>
                      <Col span={12}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Herfindahl Index</Text>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{metrics.herfindahlIndex.toFixed(3)}</div>
                        <Text type="secondary" style={{ fontSize: 10 }}>{metrics.herfindahlIndex > 0.25 ? 'Concentrated' : metrics.herfindahlIndex > 0.15 ? 'Moderate' : 'Diversified'}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Top 5 Holdings</Text>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{metrics.top5HoldingsPercent.toFixed(1)}%</div>
                      </Col>
                    </Row>
                  </Card>
                </Col>

                {/* All Funds Comparison */}
                <Col xs={24} lg={12}>
                  <Card title={<Text strong>Cross-Fund Risk Comparison</Text>} style={{ borderRadius: 12, border: 'none' }}>
                    <Table
                      dataSource={MOCK_RISK_METRICS}
                      columns={[
                        { title: 'Fund', key: 'fund', render: (_: unknown, r: RiskMetrics) => MOCK_FUNDS.find(f => f.id === r.fundId)?.shortName || r.fundId },
                        { title: 'YTD', dataIndex: 'ytdReturn', key: 'ytd', render: (v: number) => <Tag color={v >= 0 ? 'green' : 'red'}>{formatPercent(v)}</Tag> },
                        { title: 'Sharpe', dataIndex: 'sharpeRatio', key: 'sharpe', render: (v: number) => v.toFixed(2) },
                        { title: 'Beta', dataIndex: 'beta', key: 'beta', render: (v: number) => v.toFixed(2) },
                        { title: 'Max DD', dataIndex: 'maxDrawdown', key: 'maxdd', render: (v: number) => <Text style={{ color: REDWOOD.danger }}>{v.toFixed(2)}%</Text> },
                        { title: 'VaR 95%', dataIndex: 'var95', key: 'var', render: (v: number) => `${v.toFixed(2)}%` },
                      ]}
                      rowKey="fundId"
                      size="small"
                      pagination={false}
                    />
                  </Card>
                </Col>
              </Row>
            </>
          ) : (
            <Card style={{ textAlign: 'center', padding: 40 }}>
              <Text type="secondary">No risk metrics available for this fund</Text>
            </Card>
          )}
        </div>
      </Content>
    </Layout>
  );
};

export default RiskAnalytics;
