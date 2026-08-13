import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Statistic, Progress, Select, Tabs, Badge, Descriptions, Divider,
} from 'antd';
import {
  HomeOutlined, SafetyCertificateOutlined, WarningOutlined, CheckCircleOutlined,
  AlertOutlined, ClockCircleOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_COMPLIANCE_RULES, MOCK_FUNDS, formatINR } from './mockData';
import type { ComplianceRule } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const CompliancePage: React.FC = () => {
  const [rules] = useState<ComplianceRule[]>(MOCK_COMPLIANCE_RULES);
  const [activeTab, setActiveTab] = useState('all');

  const stats = useMemo(() => ({
    total: rules.length,
    compliant: rules.filter(r => r.status === 'Compliant').length,
    warning: rules.filter(r => r.status === 'Warning').length,
    breach: rules.filter(r => r.status === 'Breach').length,
    sebiRules: rules.filter(r => r.category === 'SEBI').length,
    internalRules: rules.filter(r => r.category === 'Internal').length,
  }), [rules]);

  const complianceScore = ((stats.compliant / stats.total) * 100);

  const filteredRules = useMemo(() => {
    if (activeTab === 'all') return rules;
    if (activeTab === 'alerts') return rules.filter(r => r.status !== 'Compliant');
    if (activeTab === 'sebi') return rules.filter(r => r.category === 'SEBI');
    if (activeTab === 'internal') return rules.filter(r => r.category === 'Internal');
    return rules;
  }, [rules, activeTab]);

  const columns = [
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: (v: string) => {
        const config: Record<string, { color: string; icon: React.ReactNode }> = {
          'Compliant': { color: 'green', icon: <CheckCircleOutlined /> },
          'Warning': { color: 'orange', icon: <AlertOutlined /> },
          'Breach': { color: 'red', icon: <WarningOutlined /> },
        };
        const c = config[v] || { color: 'default', icon: null };
        return <Tag color={c.color} icon={c.icon} style={{ fontWeight: 600 }}>{v}</Tag>;
      },
      filters: [{ text: 'Compliant', value: 'Compliant' }, { text: 'Warning', value: 'Warning' }, { text: 'Breach', value: 'Breach' }],
      onFilter: (value: unknown, record: ComplianceRule) => record.status === value,
    },
    {
      title: 'Rule', key: 'rule', width: 280,
      render: (_: unknown, r: ComplianceRule) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{r.name}</Text>
          <br /><Text type="secondary" style={{ fontSize: 11 }}>{r.description}</Text>
        </div>
      ),
    },
    {
      title: 'Category', dataIndex: 'category', key: 'category', width: 90,
      render: (v: string) => <Tag color={v === 'SEBI' ? 'blue' : v === 'Internal' ? 'purple' : 'orange'}>{v}</Tag>,
    },
    {
      title: 'Fund', key: 'fund', width: 120,
      render: (_: unknown, r: ComplianceRule) => r.fundId ? <Tag>{MOCK_FUNDS.find(f => f.id === r.fundId)?.shortName}</Tag> : <Text type="secondary">All Funds</Text>,
    },
    {
      title: 'Current', key: 'current', width: 100,
      render: (_: unknown, r: ComplianceRule) => (
        <Text strong style={{ color: r.status === 'Breach' ? REDWOOD.danger : r.status === 'Warning' ? REDWOOD.warning : REDWOOD.neutral900 }}>
          {r.currentValue}{r.limit > 1 ? '%' : ''}
        </Text>
      ),
    },
    {
      title: 'Limit', key: 'limit', width: 80,
      render: (_: unknown, r: ComplianceRule) => <Text>{r.limit}{r.limit > 1 ? '%' : ''}</Text>,
    },
    {
      title: 'Utilization', key: 'utilization', width: 180,
      render: (_: unknown, r: ComplianceRule) => {
        const pct = r.limit > 0 ? Math.min(100, (r.currentValue / r.limit) * 100) : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={pct}
              size="small"
              strokeColor={r.status === 'Breach' ? REDWOOD.danger : r.status === 'Warning' ? REDWOOD.warning : REDWOOD.success}
              style={{ flex: 1 }}
              format={() => `${pct.toFixed(0)}%`}
            />
          </div>
        );
      },
    },
    {
      title: 'Warning At', key: 'warning', width: 90,
      render: (_: unknown, r: ComplianceRule) => <Text type="secondary">{r.warningThreshold}{r.limit > 1 ? '%' : ''}</Text>,
    },
    {
      title: 'Last Checked', dataIndex: 'lastChecked', key: 'lastChecked', width: 140,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/pms">PMS</Link> },
            { title: 'Compliance' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: `${REDWOOD.danger}15`, borderRadius: 12, padding: 12 }}>
                <SafetyCertificateOutlined style={{ fontSize: 28, color: REDWOOD.danger }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Compliance & Exposure Monitoring</Title>
                <Text type="secondary">SEBI PMS regulations, internal limits, and risk thresholds</Text>
              </div>
            </Space>
            <Button icon={<ReloadOutlined />}>Re-check All</Button>
          </div>

          {/* Compliance Score + KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={24} sm={8} lg={4}>
              <Card style={{ borderRadius: 12, border: 'none', textAlign: 'center', height: '100%' }} bodyStyle={{ padding: 16 }}>
                <Progress
                  type="dashboard"
                  percent={complianceScore}
                  strokeColor={complianceScore >= 90 ? REDWOOD.success : complianceScore >= 70 ? REDWOOD.warning : REDWOOD.danger}
                  format={() => `${complianceScore.toFixed(0)}%`}
                  width={100}
                />
                <div style={{ marginTop: 8 }}>
                  <Text strong style={{ fontSize: 14 }}>Compliance Score</Text>
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={16} lg={20}>
              <Row gutter={[12, 12]}>
                <Col xs={12} sm={6} lg={4}>
                  <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                    <Statistic title="Total Rules" value={stats.total} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={12} sm={6} lg={4}>
                  <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                    <Statistic title="Compliant" value={stats.compliant} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success }} prefix={<CheckCircleOutlined />} />
                  </Card>
                </Col>
                <Col xs={12} sm={6} lg={4}>
                  <Badge count={stats.warning} size="small" offset={[10, 0]}>
                    <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center', width: '100%' }} bodyStyle={{ padding: 12 }}>
                      <Statistic title="Warnings" value={stats.warning} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.warning }} prefix={<AlertOutlined />} />
                    </Card>
                  </Badge>
                </Col>
                <Col xs={12} sm={6} lg={4}>
                  <Badge count={stats.breach} size="small" offset={[10, 0]}>
                    <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center', width: '100%' }} bodyStyle={{ padding: 12 }}>
                      <Statistic title="Breaches" value={stats.breach} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.danger }} prefix={<WarningOutlined />} />
                    </Card>
                  </Badge>
                </Col>
                <Col xs={12} sm={6} lg={4}>
                  <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                    <Statistic title="SEBI Rules" value={stats.sebiRules} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.info }} />
                  </Card>
                </Col>
                <Col xs={12} sm={6} lg={4}>
                  <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                    <Statistic title="Internal Rules" value={stats.internalRules} valueStyle={{ fontSize: 20, fontWeight: 700, color: '#5E35B1' }} />
                  </Card>
                </Col>
              </Row>
            </Col>
          </Row>

          {/* Alerts Summary Cards */}
          {(stats.breach > 0 || stats.warning > 0) && (
            <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
              {rules.filter(r => r.status === 'Breach').map(rule => (
                <Col xs={24} sm={12} key={rule.id}>
                  <Card
                    style={{ borderRadius: 10, borderLeft: `4px solid ${REDWOOD.danger}`, background: `${REDWOOD.danger}05` }}
                    bodyStyle={{ padding: '12px 16px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Space>
                          <WarningOutlined style={{ color: REDWOOD.danger }} />
                          <Text strong style={{ color: REDWOOD.danger }}>{rule.name}</Text>
                        </Space>
                        <br />
                        <Text style={{ fontSize: 12 }}>{rule.description}</Text>
                        {rule.fundId && <Tag style={{ marginLeft: 4, fontSize: 10 }}>{MOCK_FUNDS.find(f => f.id === rule.fundId)?.shortName}</Tag>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.danger }}>{rule.currentValue}%</div>
                        <Text type="secondary" style={{ fontSize: 11 }}>Limit: {rule.limit}%</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
              {rules.filter(r => r.status === 'Warning').map(rule => (
                <Col xs={24} sm={12} key={rule.id}>
                  <Card
                    style={{ borderRadius: 10, borderLeft: `4px solid ${REDWOOD.warning}`, background: `${REDWOOD.warning}05` }}
                    bodyStyle={{ padding: '12px 16px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Space>
                          <AlertOutlined style={{ color: REDWOOD.warning }} />
                          <Text strong style={{ color: '#8B6914' }}>{rule.name}</Text>
                        </Space>
                        <br />
                        <Text style={{ fontSize: 12 }}>{rule.description}</Text>
                        {rule.fundId && <Tag style={{ marginLeft: 4, fontSize: 10 }}>{MOCK_FUNDS.find(f => f.id === rule.fundId)?.shortName}</Tag>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#8B6914' }}>{rule.currentValue}{rule.limit > 1 ? '%' : ''}</div>
                        <Text type="secondary" style={{ fontSize: 11 }}>Limit: {rule.limit}{rule.limit > 1 ? '%' : ''}</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )}

          {/* Rules Table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                { key: 'all', label: `All Rules (${stats.total})` },
                { key: 'alerts', label: <Badge count={stats.warning + stats.breach} size="small" offset={[12, 0]}><span>Alerts</span></Badge> },
                { key: 'sebi', label: `SEBI (${stats.sebiRules})` },
                { key: 'internal', label: `Internal (${stats.internalRules})` },
              ]}
            />
            <Table
              dataSource={filteredRules}
              columns={columns}
              rowKey="id"
              scroll={{ x: 1300 }}
              size="small"
              pagination={false}
              rowClassName={(record) => record.status === 'Breach' ? 'compliance-breach-row' : record.status === 'Warning' ? 'compliance-warning-row' : ''}
            />
          </Card>
        </div>

        <style>{`
          .compliance-breach-row { background: #FFEBEE !important; }
          .compliance-breach-row:hover td { background: #FFCDD2 !important; }
          .compliance-warning-row { background: #FFF8E1 !important; }
          .compliance-warning-row:hover td { background: #FFECB3 !important; }
        `}</style>
      </Content>
    </Layout>
  );
};

export default CompliancePage;
