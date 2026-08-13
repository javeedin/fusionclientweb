import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Select,
  Statistic, Progress, Divider,
} from 'antd';
import {
  HomeOutlined, LineChartOutlined, ArrowUpOutlined, ArrowDownOutlined,
  TrophyOutlined, BarChartOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_BENCHMARK_DATA, MOCK_FUNDS, MOCK_RISK_METRICS, formatPercent } from './mockData';
import type { BenchmarkData } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const BenchmarkComparison: React.FC = () => {
  const [selectedFundId, setSelectedFundId] = useState<string>('FUND-001');
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>('nifty50');
  const data = MOCK_BENCHMARK_DATA;

  const selectedFund = MOCK_FUNDS.find(f => f.id === selectedFundId);
  const metrics = MOCK_RISK_METRICS.find(r => r.fundId === selectedFundId);

  const benchmarkNames: Record<string, string> = {
    nifty50: 'Nifty 50',
    sensex: 'Sensex',
    niftyNext50: 'Nifty Next 50',
    niftyMidcap100: 'Nifty Midcap 100',
    niftySmallcap100: 'Nifty Smallcap 100',
    niftyBank: 'Nifty Bank',
    niftyIT: 'Nifty IT',
    niftyPharma: 'Nifty Pharma',
  };

  // Calculate returns
  const calcReturn = (key: keyof BenchmarkData): { total: number; monthly: { date: string; return: number }[] } => {
    if (data.length < 2) return { total: 0, monthly: [] };
    const first = data[0][key] as number;
    const last = data[data.length - 1][key] as number;
    const total = ((last - first) / first) * 100;
    const monthly = data.map((d, i) => ({
      date: d.date,
      return: i === 0 ? 0 : (((d[key] as number) - (data[i - 1][key] as number)) / (data[i - 1][key] as number)) * 100,
    }));
    return { total, monthly };
  };

  const fundReturn = calcReturn('fundNav');
  const benchmarkReturn = calcReturn(selectedBenchmark as keyof BenchmarkData);
  const alpha = fundReturn.total - benchmarkReturn.total;

  // Table data for monthly comparison
  const monthlyData = data.map((d, i) => ({
    key: i,
    date: d.date,
    fundNav: d.fundNav,
    benchmarkValue: d[selectedBenchmark as keyof BenchmarkData] as number,
    fundReturn: i === 0 ? 0 : (((d.fundNav || 0) - (data[i - 1].fundNav || 0)) / (data[i - 1].fundNav || 1)) * 100,
    benchmarkReturn: i === 0 ? 0 : (((d[selectedBenchmark as keyof BenchmarkData] as number) - (data[i - 1][selectedBenchmark as keyof BenchmarkData] as number)) / (data[i - 1][selectedBenchmark as keyof BenchmarkData] as number)) * 100,
    cumulativeFund: ((d.fundNav || 0) - (data[0].fundNav || 0)) / (data[0].fundNav || 1) * 100,
    cumulativeBenchmark: ((d[selectedBenchmark as keyof BenchmarkData] as number) - (data[0][selectedBenchmark as keyof BenchmarkData] as number)) / (data[0][selectedBenchmark as keyof BenchmarkData] as number) * 100,
  }));

  // All benchmarks comparison
  const allBenchmarks = Object.keys(benchmarkNames).map(key => {
    const ret = calcReturn(key as keyof BenchmarkData);
    return {
      key,
      name: benchmarkNames[key],
      totalReturn: ret.total,
      fundExcess: fundReturn.total - ret.total,
    };
  });

  const columns = [
    { title: 'Month', dataIndex: 'date', key: 'date', width: 100 },
    {
      title: `Fund NAV`, key: 'fundNav', width: 100,
      render: (_: unknown, r: typeof monthlyData[0]) => r.fundNav?.toFixed(2) || '-',
    },
    {
      title: `${benchmarkNames[selectedBenchmark]}`, key: 'bm', width: 100,
      render: (_: unknown, r: typeof monthlyData[0]) => r.benchmarkValue?.toLocaleString('en-IN'),
    },
    {
      title: 'Fund Monthly', key: 'fundMon', width: 110,
      render: (_: unknown, r: typeof monthlyData[0]) => (
        <Text style={{ color: r.fundReturn >= 0 ? REDWOOD.success : REDWOOD.danger, fontWeight: 600 }}>
          {formatPercent(r.fundReturn)}
        </Text>
      ),
    },
    {
      title: `BM Monthly`, key: 'bmMon', width: 110,
      render: (_: unknown, r: typeof monthlyData[0]) => (
        <Text style={{ color: r.benchmarkReturn >= 0 ? REDWOOD.success : REDWOOD.danger }}>
          {formatPercent(r.benchmarkReturn)}
        </Text>
      ),
    },
    {
      title: 'Alpha (M)', key: 'alphaM', width: 100,
      render: (_: unknown, r: typeof monthlyData[0]) => {
        const a = r.fundReturn - r.benchmarkReturn;
        return <Tag color={a >= 0 ? 'green' : 'red'}>{formatPercent(a)}</Tag>;
      },
    },
    {
      title: 'Cum. Fund', key: 'cumF', width: 100,
      render: (_: unknown, r: typeof monthlyData[0]) => (
        <Text strong style={{ color: r.cumulativeFund >= 0 ? REDWOOD.success : REDWOOD.danger }}>
          {formatPercent(r.cumulativeFund)}
        </Text>
      ),
    },
    {
      title: 'Cum. BM', key: 'cumBM', width: 100,
      render: (_: unknown, r: typeof monthlyData[0]) => (
        <Text style={{ color: r.cumulativeBenchmark >= 0 ? REDWOOD.success : REDWOOD.danger }}>
          {formatPercent(r.cumulativeBenchmark)}
        </Text>
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
            { title: 'Benchmark Comparison' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: '#1B5E2015', borderRadius: 12, padding: 12 }}>
                <LineChartOutlined style={{ fontSize: 28, color: '#1B5E20' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Benchmark Comparison & Attribution</Title>
                <Text type="secondary">Compare fund performance against market indices</Text>
              </div>
            </Space>
            <Space>
              <Select
                value={selectedFundId}
                onChange={setSelectedFundId}
                style={{ width: 220 }}
                options={MOCK_FUNDS.map(f => ({ label: f.shortName, value: f.id }))}
              />
              <Select
                value={selectedBenchmark}
                onChange={setSelectedBenchmark}
                style={{ width: 180 }}
                options={Object.entries(benchmarkNames).map(([k, v]) => ({ label: v, value: k }))}
              />
            </Space>
          </div>

          {/* Headline comparison */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Fund Return</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: fundReturn.total >= 0 ? REDWOOD.success : REDWOOD.danger }}>
                  {formatPercent(fundReturn.total)}
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>{selectedFund?.shortName} (14 months)</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{benchmarkNames[selectedBenchmark]} Return</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: benchmarkReturn.total >= 0 ? REDWOOD.success : REDWOOD.danger }}>
                  {formatPercent(benchmarkReturn.total)}
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>Same period</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center', background: alpha >= 0 ? `${REDWOOD.success}08` : `${REDWOOD.danger}08` }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Alpha Generated</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: alpha >= 0 ? REDWOOD.success : REDWOOD.danger }}>
                  {formatPercent(alpha)}
                </div>
                <Tag color={alpha >= 0 ? 'green' : 'red'} icon={alpha >= 0 ? <TrophyOutlined /> : <ArrowDownOutlined />}>
                  {alpha >= 0 ? 'Outperformed' : 'Underperformed'}
                </Tag>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Tracking Error</Text>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {metrics?.trackingError.toFixed(2) || '-'}%
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>Annualized</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Information Ratio</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: (metrics?.informationRatio || 0) >= 0.5 ? REDWOOD.success : REDWOOD.neutral600 }}>
                  {metrics?.informationRatio.toFixed(2) || '-'}
                </div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Beta</Text>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {metrics?.beta.toFixed(2) || '-'}
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>vs {benchmarkNames[selectedBenchmark]}</Text>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Sharpe Ratio</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: (metrics?.sharpeRatio || 0) >= 1 ? REDWOOD.success : REDWOOD.warning }}>
                  {metrics?.sharpeRatio.toFixed(2) || '-'}
                </div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Win Rate</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.success }}>
                  {((monthlyData.filter(d => d.fundReturn > d.benchmarkReturn).length / Math.max(1, monthlyData.length - 1)) * 100).toFixed(0)}%
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>Months beating BM</Text>
              </Card>
            </Col>
          </Row>

          {/* Monthly data table */}
          <Card
            title={<Space><BarChartOutlined style={{ color: '#1B5E20' }} /><Text strong>Monthly Returns Comparison</Text></Space>}
            style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 20 }}
            bodyStyle={{ padding: 0 }}
          >
            <Table
              dataSource={monthlyData}
              columns={columns}
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: 900 }}
            />
          </Card>

          {/* All Benchmarks comparison */}
          <Card
            title={<Space><LineChartOutlined style={{ color: REDWOOD.info }} /><Text strong>Fund vs All Indices</Text></Space>}
            style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          >
            <Table
              dataSource={allBenchmarks}
              columns={[
                { title: 'Index', dataIndex: 'name', key: 'name', width: 180, render: (v: string) => <Text strong>{v}</Text> },
                {
                  title: 'Index Return', dataIndex: 'totalReturn', key: 'return', width: 120,
                  render: (v: number) => <Text style={{ color: v >= 0 ? REDWOOD.success : REDWOOD.danger }}>{formatPercent(v)}</Text>,
                  sorter: (a: typeof allBenchmarks[0], b: typeof allBenchmarks[0]) => a.totalReturn - b.totalReturn,
                },
                {
                  title: 'Fund Return', key: 'fund', width: 120,
                  render: () => <Text strong style={{ color: fundReturn.total >= 0 ? REDWOOD.success : REDWOOD.danger }}>{formatPercent(fundReturn.total)}</Text>,
                },
                {
                  title: 'Excess (Alpha)', dataIndex: 'fundExcess', key: 'excess', width: 120,
                  render: (v: number) => <Tag color={v >= 0 ? 'green' : 'red'} style={{ fontWeight: 600 }}>{formatPercent(v)}</Tag>,
                  sorter: (a: typeof allBenchmarks[0], b: typeof allBenchmarks[0]) => a.fundExcess - b.fundExcess,
                },
                {
                  title: 'Relative', key: 'bar', width: 200,
                  render: (_: unknown, r: typeof allBenchmarks[0]) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Progress
                        percent={Math.min(100, Math.abs(r.fundExcess) * 5)}
                        size="small"
                        strokeColor={r.fundExcess >= 0 ? REDWOOD.success : REDWOOD.danger}
                        showInfo={false}
                        style={{ flex: 1 }}
                      />
                      {r.fundExcess >= 0 ? <TrophyOutlined style={{ color: REDWOOD.success }} /> : <ArrowDownOutlined style={{ color: REDWOOD.danger }} />}
                    </div>
                  ),
                },
              ]}
              rowKey="key"
              size="small"
              pagination={false}
            />
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default BenchmarkComparison;
