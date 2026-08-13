import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Statistic, Select, Descriptions, Modal,
} from 'antd';
import {
  HomeOutlined, DollarOutlined, EyeOutlined, CheckCircleOutlined,
  FileTextOutlined, SendOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_FEE_CALCULATIONS, MOCK_FUNDS, formatINR, formatPercent } from './mockData';
import type { FeeCalculation } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const FeeManagementPage: React.FC = () => {
  const [fees] = useState<FeeCalculation[]>(MOCK_FEE_CALCULATIONS);
  const [selectedFee, setSelectedFee] = useState<FeeCalculation | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [fundFilter, setFundFilter] = useState<string>('all');

  const filteredFees = useMemo(() => {
    if (fundFilter === 'all') return fees;
    return fees.filter(f => f.fundId === fundFilter);
  }, [fees, fundFilter]);

  const stats = useMemo(() => ({
    totalMgmtFee: fees.reduce((s, f) => s + f.managementFee, 0),
    totalPerfFee: fees.reduce((s, f) => s + f.performanceFee, 0),
    totalFees: fees.reduce((s, f) => s + f.totalFee, 0),
    draft: fees.filter(f => f.status === 'Draft').length,
    approved: fees.filter(f => f.status === 'Approved').length,
    invoiced: fees.filter(f => f.status === 'Invoiced').length,
    paid: fees.filter(f => f.status === 'Paid').length,
  }), [fees]);

  const columns = [
    {
      title: 'Fund', dataIndex: 'fundName', key: 'fund', width: 120,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Investor', dataIndex: 'investorName', key: 'investor', width: 200,
      render: (v: string) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'Period', dataIndex: 'period', key: 'period', width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: 'Opening Value', dataIndex: 'openingValue', key: 'opening', width: 130,
      render: (v: number) => formatINR(v),
    },
    {
      title: 'Closing Value', dataIndex: 'closingValue', key: 'closing', width: 130,
      render: (v: number) => <Text strong>{formatINR(v)}</Text>,
    },
    {
      title: 'Excess Return', dataIndex: 'excessReturn', key: 'excess', width: 110,
      render: (v: number) => <Text style={{ color: v > 0 ? REDWOOD.success : REDWOOD.danger }}>{formatPercent(v)}</Text>,
    },
    {
      title: 'Mgmt Fee', dataIndex: 'managementFee', key: 'mgmt', width: 110,
      render: (v: number) => formatINR(v),
      sorter: (a: FeeCalculation, b: FeeCalculation) => a.managementFee - b.managementFee,
    },
    {
      title: 'Perf Fee', dataIndex: 'performanceFee', key: 'perf', width: 110,
      render: (v: number) => formatINR(v),
      sorter: (a: FeeCalculation, b: FeeCalculation) => a.performanceFee - b.performanceFee,
    },
    {
      title: 'Total Fee', dataIndex: 'totalFee', key: 'total', width: 120,
      render: (v: number) => <Text strong style={{ color: REDWOOD.primary }}>{formatINR(v)}</Text>,
      sorter: (a: FeeCalculation, b: FeeCalculation) => a.totalFee - b.totalFee,
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const colors: Record<string, string> = { Draft: 'default', Approved: 'blue', Invoiced: 'orange', Paid: 'green' };
        return <Tag color={colors[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '', key: 'action', width: 60,
      render: (_: unknown, r: FeeCalculation) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedFee(r); setDetailVisible(true); }} />
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
            { title: 'Fee Management' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: '#BF360C15', borderRadius: 12, padding: 12 }}>
                <DollarOutlined style={{ fontSize: 28, color: '#BF360C' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Fee Management</Title>
                <Text type="secondary">Management fees, performance fees, high water mark tracking</Text>
              </div>
            </Space>
            <Select
              value={fundFilter}
              onChange={setFundFilter}
              style={{ width: 200 }}
              options={[{ label: 'All Funds', value: 'all' }, ...MOCK_FUNDS.map(f => ({ label: f.shortName, value: f.id }))]}
            />
          </div>

          {/* KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Fees" value={formatINR(stats.totalFees)} valueStyle={{ fontSize: 16, fontWeight: 700, color: REDWOOD.primary }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Management Fees" value={formatINR(stats.totalMgmtFee)} valueStyle={{ fontSize: 14, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Performance Fees" value={formatINR(stats.totalPerfFee)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Draft" value={stats.draft} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.neutral600 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Approved" value={stats.approved} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.info }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Invoiced" value={stats.invoiced} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.warning }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Paid" value={stats.paid} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Fee Entries" value={fees.length} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
          </Row>

          {/* Fee Table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={filteredFees}
              columns={columns}
              rowKey="id"
              scroll={{ x: 1400 }}
              size="small"
              pagination={false}
              summary={(data) => {
                const totalMgmt = data.reduce((s, r) => s + r.managementFee, 0);
                const totalPerf = data.reduce((s, r) => s + r.performanceFee, 0);
                const totalAll = data.reduce((s, r) => s + r.totalFee, 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={6}><Text strong>Totals</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={6}><Text strong>{formatINR(totalMgmt)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={7}><Text strong>{formatINR(totalPerf)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={8}><Text strong style={{ color: REDWOOD.primary }}>{formatINR(totalAll)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={9} colSpan={2} />
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Card>

          {/* Fee Structure Cards */}
          <div style={{ marginTop: 20 }}>
            <Text strong style={{ fontSize: 15, marginBottom: 12, display: 'block' }}>Fee Structure by Fund</Text>
            <Row gutter={[12, 12]}>
              {MOCK_FUNDS.map(fund => (
                <Col xs={24} sm={12} lg={6} key={fund.id}>
                  <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
                    <Text strong style={{ fontSize: 13 }}>{fund.shortName}</Text>
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Management Fee</Text>
                        <Text strong>{fund.managementFeePercent}% p.a.</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Performance Fee</Text>
                        <Text strong>{fund.performanceFeePercent}%</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Hurdle Rate</Text>
                        <Text strong>{fund.hurdleRatePercent}% p.a.</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>High Water Mark</Text>
                        <Text strong>{fund.highWaterMark.toFixed(2)}</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        </div>

        {/* Detail Modal */}
        <Modal
          open={detailVisible}
          onCancel={() => setDetailVisible(false)}
          footer={null}
          width={700}
          title={<Space><DollarOutlined style={{ color: '#BF360C' }} /> Fee Calculation Details</Space>}
        >
          {selectedFee && (
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Fee ID">{selectedFee.id}</Descriptions.Item>
              <Descriptions.Item label="Status"><Tag color={selectedFee.status === 'Paid' ? 'green' : selectedFee.status === 'Invoiced' ? 'orange' : 'default'}>{selectedFee.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="Fund">{selectedFee.fundName}</Descriptions.Item>
              <Descriptions.Item label="Investor">{selectedFee.investorName}</Descriptions.Item>
              <Descriptions.Item label="Period">{selectedFee.period}</Descriptions.Item>
              <Descriptions.Item label="Period Range">{selectedFee.periodStart} — {selectedFee.periodEnd}</Descriptions.Item>
              <Descriptions.Item label="Opening Value">{formatINR(selectedFee.openingValue)}</Descriptions.Item>
              <Descriptions.Item label="Closing Value">{formatINR(selectedFee.closingValue)}</Descriptions.Item>
              <Descriptions.Item label="Net Inflow">{formatINR(selectedFee.netInflow)}</Descriptions.Item>
              <Descriptions.Item label="Return">{formatPercent(selectedFee.excessReturn)}</Descriptions.Item>
              <Descriptions.Item label="Previous HWM">{selectedFee.previousHighWaterMark.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="New HWM">{selectedFee.newHighWaterMark.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Hurdle Return">{formatPercent(selectedFee.hurdleReturn)}</Descriptions.Item>
              <Descriptions.Item label="Excess Over Hurdle">{formatPercent(selectedFee.excessReturn - selectedFee.hurdleReturn)}</Descriptions.Item>
              <Descriptions.Item label="Management Fee"><Text strong>{formatINR(selectedFee.managementFee)}</Text></Descriptions.Item>
              <Descriptions.Item label="Performance Fee"><Text strong>{formatINR(selectedFee.performanceFee)}</Text></Descriptions.Item>
              <Descriptions.Item label="Total Fee" span={2}>
                <Text strong style={{ fontSize: 18, color: REDWOOD.primary }}>{formatINR(selectedFee.totalFee)}</Text>
              </Descriptions.Item>
            </Descriptions>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default FeeManagementPage;
