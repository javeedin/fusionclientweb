import React, { useState } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Statistic, Select, Progress, Descriptions, Tabs, Modal, message, Badge,
} from 'antd';
import {
  HomeOutlined, SettingOutlined, SyncOutlined, CheckCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined, MinusOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_MODEL_PORTFOLIOS, MOCK_FUNDS, formatPercent } from './mockData';
import type { ModelPortfolio, ModelAllocation } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const ModelPortfolioPage: React.FC = () => {
  const [models] = useState<ModelPortfolio[]>(MOCK_MODEL_PORTFOLIOS);
  const [selectedModel, setSelectedModel] = useState<ModelPortfolio>(models[0]);

  const totalDrift = selectedModel.targetAllocations.reduce((s, a) => s + Math.abs(a.driftPercent || 0), 0);
  const maxDrift = Math.max(...selectedModel.targetAllocations.map(a => Math.abs(a.driftPercent || 0)));
  const needsRebalance = maxDrift > 2;

  const handleRebalance = () => {
    message.success(`Rebalance orders generated for ${selectedModel.name}. Review in Order Management.`);
  };

  const allocationColumns = [
    {
      title: 'Symbol', key: 'symbol', width: 200,
      render: (_: unknown, r: ModelAllocation) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{r.symbol}</Text>
          <br /><Text type="secondary" style={{ fontSize: 10 }}>{r.name}</Text>
        </div>
      ),
    },
    {
      title: 'Sector', dataIndex: 'sector', key: 'sector', width: 120,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Target %', dataIndex: 'targetPercent', key: 'target', width: 100,
      render: (v: number) => (
        <div>
          <Text strong>{v.toFixed(1)}%</Text>
          <Progress percent={v} size="small" strokeColor={REDWOOD.info} showInfo={false} />
        </div>
      ),
      sorter: (a: ModelAllocation, b: ModelAllocation) => a.targetPercent - b.targetPercent,
    },
    {
      title: 'Current %', key: 'current', width: 100,
      render: (_: unknown, r: ModelAllocation) => (
        <div>
          <Text>{(r.currentPercent || 0).toFixed(1)}%</Text>
          <Progress percent={r.currentPercent || 0} size="small" strokeColor={REDWOOD.success} showInfo={false} />
        </div>
      ),
    },
    {
      title: 'Drift', key: 'drift', width: 100,
      render: (_: unknown, r: ModelAllocation) => {
        const drift = r.driftPercent || 0;
        const color = Math.abs(drift) > 2 ? REDWOOD.danger : Math.abs(drift) > 1 ? REDWOOD.warning : REDWOOD.success;
        return (
          <Text strong style={{ color }}>
            {drift > 0 ? '+' : ''}{drift.toFixed(1)}%
          </Text>
        );
      },
      sorter: (a: ModelAllocation, b: ModelAllocation) => Math.abs(b.driftPercent || 0) - Math.abs(a.driftPercent || 0),
    },
    {
      title: 'Action', key: 'action', width: 120,
      render: (_: unknown, r: ModelAllocation) => {
        if (!r.action || r.action === 'Hold') return <Tag icon={<MinusOutlined />}>Hold</Tag>;
        return (
          <div>
            <Tag color={r.action === 'Buy' ? 'green' : 'red'} icon={r.action === 'Buy' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}>
              {r.action}
            </Tag>
            {r.actionQuantity && <Text style={{ fontSize: 11, marginLeft: 4 }}>{r.actionQuantity} qty</Text>}
          </div>
        );
      },
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/pms">PMS</Link> },
            { title: 'Model Portfolio' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: '#37474F15', borderRadius: 12, padding: 12 }}>
                <SettingOutlined style={{ fontSize: 28, color: '#37474F' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Model Portfolio & Rebalancing</Title>
                <Text type="secondary">Target allocations, drift analysis, and automated rebalancing</Text>
              </div>
            </Space>
            <Space>
              <Select
                value={selectedModel.id}
                onChange={(v) => setSelectedModel(models.find(m => m.id === v) || models[0])}
                style={{ width: 280 }}
                options={models.map(m => ({ label: `${m.name} (${m.riskCategory})`, value: m.id }))}
              />
              {needsRebalance && (
                <Button type="primary" icon={<SyncOutlined />} onClick={handleRebalance} danger>
                  Generate Rebalance Orders
                </Button>
              )}
            </Space>
          </div>

          {/* Model Info */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Stocks</Text>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{selectedModel.targetAllocations.length}</div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Max Drift</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: maxDrift > 2 ? REDWOOD.danger : REDWOOD.success }}>
                  {maxDrift.toFixed(1)}%
                </div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Total Drift</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: totalDrift > 5 ? REDWOOD.warning : REDWOOD.success }}>
                  {totalDrift.toFixed(1)}%
                </div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Rebalance Freq</Text>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedModel.rebalanceFrequency}</div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Last Rebalance</Text>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{selectedModel.lastRebalanceDate}</div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Risk Level</Text>
                <Tag color={selectedModel.riskCategory === 'Very High' ? 'red' : selectedModel.riskCategory === 'High' ? 'orange' : 'blue'} style={{ marginTop: 4 }}>
                  {selectedModel.riskCategory}
                </Tag>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Benchmark</Text>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{selectedModel.benchmarkIndex}</div>
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Status</Text>
                <div>
                  <Badge status={needsRebalance ? 'warning' : 'success'} text={needsRebalance ? 'Drift Alert' : 'Aligned'} />
                </div>
              </Card>
            </Col>
          </Row>

          {/* Allocation Table */}
          <Card
            title={<Space><SettingOutlined style={{ color: '#37474F' }} /><Text strong>{selectedModel.name}</Text></Space>}
            extra={<Text type="secondary">{selectedModel.description}</Text>}
            style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          >
            <Table
              dataSource={selectedModel.targetAllocations}
              columns={allocationColumns}
              rowKey="symbol"
              size="small"
              pagination={false}
              rowClassName={(record) => Math.abs(record.driftPercent || 0) > 2 ? 'drift-alert-row' : ''}
              summary={(data) => {
                const totalTarget = data.reduce((s, r) => s + r.targetPercent, 0);
                const totalCurrent = data.reduce((s, r) => s + (r.currentPercent || 0), 0);
                const buys = data.filter(r => r.action === 'Buy').length;
                const sells = data.filter(r => r.action === 'Sell').length;
                const holds = data.filter(r => !r.action || r.action === 'Hold').length;
                return (
                  <Table.Summary>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}><Text strong>Total</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={2}><Text strong>{totalTarget.toFixed(1)}%</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={3}><Text strong>{totalCurrent.toFixed(1)}%</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={4}><Text strong>{totalDrift.toFixed(1)}%</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={5}>
                        <Space>
                          <Tag color="green">{buys} Buy</Tag>
                          <Tag color="red">{sells} Sell</Tag>
                          <Tag>{holds} Hold</Tag>
                        </Space>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Card>

          {/* All Models Overview */}
          <Card title={<Text strong>All Model Portfolios</Text>} style={{ borderRadius: 12, border: 'none', marginTop: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <Row gutter={[12, 12]}>
              {models.map(model => {
                const drift = Math.max(...model.targetAllocations.map(a => Math.abs(a.driftPercent || 0)));
                return (
                  <Col xs={24} sm={12} lg={8} key={model.id}>
                    <Card
                      hoverable
                      size="small"
                      style={{
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: selectedModel.id === model.id ? `2px solid ${REDWOOD.info}` : `1px solid ${REDWOOD.neutral200}`,
                      }}
                      onClick={() => setSelectedModel(model)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 13 }}>{model.name}</Text>
                        <Tag color={model.status === 'Active' ? 'green' : 'default'}>{model.status}</Tag>
                      </div>
                      <Text type="secondary" style={{ fontSize: 11 }}>{model.description}</Text>
                      <Row gutter={8} style={{ marginTop: 8 }}>
                        <Col span={8}><Text type="secondary" style={{ fontSize: 10 }}>Stocks</Text><div style={{ fontWeight: 600 }}>{model.targetAllocations.length}</div></Col>
                        <Col span={8}><Text type="secondary" style={{ fontSize: 10 }}>Max Drift</Text><div style={{ fontWeight: 600, color: drift > 2 ? REDWOOD.danger : REDWOOD.success }}>{drift.toFixed(1)}%</div></Col>
                        <Col span={8}><Text type="secondary" style={{ fontSize: 10 }}>Rebalance</Text><div style={{ fontWeight: 600, fontSize: 12 }}>{model.rebalanceFrequency}</div></Col>
                      </Row>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </Card>
        </div>

        <style>{`
          .drift-alert-row { background: #FFF3E0 !important; }
          .drift-alert-row:hover td { background: #FFE0B2 !important; }
        `}</style>
      </Content>
    </Layout>
  );
};

export default ModelPortfolioPage;
