import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Modal, Form, Input, InputNumber, Select, Statistic, Descriptions, Tabs,
  Progress, message, Avatar,
} from 'antd';
import {
  HomeOutlined, TeamOutlined, PlusOutlined, EyeOutlined, UserOutlined,
  CheckCircleOutlined, MailOutlined, PhoneOutlined, BankOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_INVESTORS, MOCK_FUNDS, formatINR, formatPercent } from './mockData';
import type { Investor } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF', investorPurple: '#5E35B1',
};

const ClientManagement: React.FC = () => {
  const [investors, setInvestors] = useState<Investor[]>(MOCK_INVESTORS);
  const [selectedInvestor, setSelectedInvestor] = useState<Investor | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [form] = Form.useForm();

  const stats = useMemo(() => ({
    totalInvestors: investors.length,
    totalCommitment: investors.reduce((s, i) => s + i.totalCommitment, 0),
    totalInvested: investors.reduce((s, i) => s + i.totalInvested, 0),
    totalCurrentValue: investors.reduce((s, i) => s + i.currentPortfolioValue, 0),
    totalPnL: investors.reduce((s, i) => s + i.totalPnL, 0),
    avgReturn: investors.reduce((s, i) => s + i.totalPnLPercent, 0) / investors.length,
    kycVerified: investors.filter(i => i.kycStatus === 'Verified').length,
  }), [investors]);

  const handleCreate = () => {
    form.validateFields().then(values => {
      const newInvestor: Investor = {
        id: `INV-${String(investors.length + 1).padStart(3, '0')}`,
        ...values,
        kycStatus: 'Pending',
        onboardingDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        totalCommitment: values.totalCommitment || 0,
        totalInvested: 0,
        currentPortfolioValue: 0,
        totalPnL: 0,
        totalPnLPercent: 0,
        funds: [],
        bankDetails: { bankName: values.bankName || '', accountNumber: values.accountNumber || '', ifsc: values.ifsc || '' },
        address: values.address || '',
        status: 'Active',
      };
      setInvestors([...investors, newInvestor]);
      setCreateVisible(false);
      form.resetFields();
      message.success('Investor onboarded successfully');
    });
  };

  const columns = [
    {
      title: 'Investor', key: 'investor', width: 250, fixed: 'left' as const,
      render: (_: unknown, r: Investor) => (
        <Space>
          <Avatar style={{ backgroundColor: REDWOOD.investorPurple }} icon={<UserOutlined />} />
          <div>
            <Text strong style={{ fontSize: 13, cursor: 'pointer', color: REDWOOD.info }} onClick={() => { setSelectedInvestor(r); setDetailVisible(true); }}>{r.name}</Text>
            <br /><Text type="secondary" style={{ fontSize: 10 }}>{r.type} &bull; PAN: {r.pan}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'KYC', dataIndex: 'kycStatus', key: 'kyc', width: 90,
      render: (v: string) => <Tag color={v === 'Verified' ? 'green' : v === 'Pending' ? 'orange' : 'red'} icon={v === 'Verified' ? <CheckCircleOutlined /> : undefined}>{v}</Tag>,
    },
    {
      title: 'Risk Profile', dataIndex: 'riskProfile', key: 'risk', width: 120,
      render: (v: string) => <Tag color={v === 'Very Aggressive' ? 'red' : v === 'Aggressive' ? 'orange' : v === 'Moderate' ? 'blue' : 'green'}>{v}</Tag>,
    },
    {
      title: 'Commitment', dataIndex: 'totalCommitment', key: 'commit', width: 130,
      render: (v: number) => formatINR(v),
      sorter: (a: Investor, b: Investor) => a.totalCommitment - b.totalCommitment,
    },
    {
      title: 'Invested', dataIndex: 'totalInvested', key: 'invested', width: 120,
      render: (v: number) => formatINR(v),
    },
    {
      title: 'Current Value', dataIndex: 'currentPortfolioValue', key: 'current', width: 130,
      render: (v: number) => <Text strong>{formatINR(v)}</Text>,
      sorter: (a: Investor, b: Investor) => a.currentPortfolioValue - b.currentPortfolioValue,
    },
    {
      title: 'P&L', key: 'pnl', width: 140,
      render: (_: unknown, r: Investor) => (
        <div style={{ color: r.totalPnL >= 0 ? REDWOOD.success : REDWOOD.danger }}>
          <div style={{ fontWeight: 600 }}>{formatINR(r.totalPnL)}</div>
          <div style={{ fontSize: 11 }}>{formatPercent(r.totalPnLPercent)}</div>
        </div>
      ),
      sorter: (a: Investor, b: Investor) => a.totalPnLPercent - b.totalPnLPercent,
    },
    {
      title: 'Utilization', key: 'util', width: 130,
      render: (_: unknown, r: Investor) => {
        const pct = (r.totalInvested / r.totalCommitment) * 100;
        return (
          <div>
            <Progress percent={pct} size="small" strokeColor={pct > 90 ? REDWOOD.success : REDWOOD.info} format={() => `${pct.toFixed(0)}%`} />
          </div>
        );
      },
    },
    {
      title: 'Since', dataIndex: 'onboardingDate', key: 'since', width: 100,
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'Active' ? 'green' : v === 'Blocked' ? 'red' : 'default'}>{v}</Tag>,
    },
    {
      title: '', key: 'action', width: 60, fixed: 'right' as const,
      render: (_: unknown, r: Investor) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedInvestor(r); setDetailVisible(true); }} />
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
            { title: 'Investor Management' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: `${REDWOOD.investorPurple}15`, borderRadius: 12, padding: 12 }}>
                <TeamOutlined style={{ fontSize: 28, color: REDWOOD.investorPurple }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Investor Management</Title>
                <Text type="secondary">Onboard, manage, and track investor capital accounts</Text>
              </div>
            </Space>
            <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreateVisible(true)}>Onboard Investor</Button>
          </div>

          {/* KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Investors" value={stats.totalInvestors} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.investorPurple }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Commitment" value={formatINR(stats.totalCommitment)} valueStyle={{ fontSize: 14, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Invested" value={formatINR(stats.totalInvested)} valueStyle={{ fontSize: 14, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Portfolio Value" value={formatINR(stats.totalCurrentValue)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total P&L" value={formatINR(stats.totalPnL)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Avg Return" value={formatPercent(stats.avgReturn)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="KYC Verified" value={`${stats.kycVerified}/${stats.totalInvestors}`} valueStyle={{ fontSize: 18, fontWeight: 700, color: stats.kycVerified === stats.totalInvestors ? REDWOOD.success : REDWOOD.warning }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Utilization" value={`${((stats.totalInvested / stats.totalCommitment) * 100).toFixed(0)}%`} valueStyle={{ fontSize: 18, fontWeight: 700 }} />
              </Card>
            </Col>
          </Row>

          {/* Table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table dataSource={investors} columns={columns} rowKey="id" scroll={{ x: 1500 }} size="middle" pagination={false} />
          </Card>
        </div>

        {/* Detail Modal */}
        <Modal
          open={detailVisible}
          onCancel={() => setDetailVisible(false)}
          footer={null}
          width={900}
          title={<Space><UserOutlined style={{ color: REDWOOD.investorPurple }} /> {selectedInvestor?.name}</Space>}
        >
          {selectedInvestor && (
            <Tabs defaultActiveKey="profile" items={[
              {
                key: 'profile', label: 'Profile',
                children: (
                  <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                      <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="Commitment" value={formatINR(selectedInvestor.totalCommitment)} valueStyle={{ fontSize: 14 }} /></Card></Col>
                      <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="Invested" value={formatINR(selectedInvestor.totalInvested)} valueStyle={{ fontSize: 14 }} /></Card></Col>
                      <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="Current Value" value={formatINR(selectedInvestor.currentPortfolioValue)} valueStyle={{ fontSize: 14, color: REDWOOD.success }} /></Card></Col>
                      <Col span={6}><Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}><Statistic title="P&L" value={`${formatINR(selectedInvestor.totalPnL)} (${formatPercent(selectedInvestor.totalPnLPercent)})`} valueStyle={{ fontSize: 12, color: selectedInvestor.totalPnL >= 0 ? REDWOOD.success : REDWOOD.danger }} /></Card></Col>
                    </Row>
                    <Descriptions bordered size="small" column={2}>
                      <Descriptions.Item label="Investor ID">{selectedInvestor.id}</Descriptions.Item>
                      <Descriptions.Item label="PAN">{selectedInvestor.pan}</Descriptions.Item>
                      <Descriptions.Item label="Type">{selectedInvestor.type}</Descriptions.Item>
                      <Descriptions.Item label="KYC Status"><Tag color={selectedInvestor.kycStatus === 'Verified' ? 'green' : 'orange'}>{selectedInvestor.kycStatus}</Tag></Descriptions.Item>
                      <Descriptions.Item label="Risk Profile"><Tag color={selectedInvestor.riskProfile === 'Very Aggressive' ? 'red' : selectedInvestor.riskProfile === 'Aggressive' ? 'orange' : 'blue'}>{selectedInvestor.riskProfile}</Tag></Descriptions.Item>
                      <Descriptions.Item label="Status"><Tag color={selectedInvestor.status === 'Active' ? 'green' : 'red'}>{selectedInvestor.status}</Tag></Descriptions.Item>
                      <Descriptions.Item label="Email"><MailOutlined /> {selectedInvestor.email}</Descriptions.Item>
                      <Descriptions.Item label="Phone"><PhoneOutlined /> {selectedInvestor.phone}</Descriptions.Item>
                      <Descriptions.Item label="Bank"><BankOutlined /> {selectedInvestor.bankDetails.bankName} (A/c: {selectedInvestor.bankDetails.accountNumber})</Descriptions.Item>
                      <Descriptions.Item label="IFSC">{selectedInvestor.bankDetails.ifsc}</Descriptions.Item>
                      <Descriptions.Item label="Onboarding">{selectedInvestor.onboardingDate}</Descriptions.Item>
                      <Descriptions.Item label="Nominee">{selectedInvestor.nominee || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Address" span={2}>{selectedInvestor.address}</Descriptions.Item>
                    </Descriptions>
                  </>
                ),
              },
              {
                key: 'funds', label: 'Fund Allocations',
                children: (
                  <div>
                    <Text type="secondary" style={{ marginBottom: 12, display: 'block' }}>
                      This investor has allocations across the following funds:
                    </Text>
                    {MOCK_FUNDS.filter(f => f.investors.some(inv => inv.investorId === selectedInvestor.id)).map(fund => {
                      const alloc = fund.investors.find(inv => inv.investorId === selectedInvestor.id);
                      if (!alloc) return null;
                      const pnl = alloc.currentValue - alloc.investedAmount;
                      const pnlPct = (pnl / alloc.investedAmount) * 100;
                      return (
                        <Card key={fund.id} size="small" style={{ marginBottom: 8, borderRadius: 8 }}>
                          <Row gutter={16} align="middle">
                            <Col span={6}><Text strong>{fund.shortName}</Text><br/><Tag>{fund.type}</Tag></Col>
                            <Col span={4}><Text type="secondary" style={{ fontSize: 11 }}>Commitment</Text><br/><Text strong>{formatINR(alloc.commitmentAmount)}</Text></Col>
                            <Col span={4}><Text type="secondary" style={{ fontSize: 11 }}>Invested</Text><br/><Text>{formatINR(alloc.investedAmount)}</Text></Col>
                            <Col span={4}><Text type="secondary" style={{ fontSize: 11 }}>Current</Text><br/><Text strong>{formatINR(alloc.currentValue)}</Text></Col>
                            <Col span={4}><Text type="secondary" style={{ fontSize: 11 }}>P&L</Text><br/><Text style={{ color: pnl >= 0 ? REDWOOD.success : REDWOOD.danger, fontWeight: 600 }}>{formatINR(pnl)} ({formatPercent(pnlPct)})</Text></Col>
                            <Col span={2}><Tag color={alloc.status === 'Active' ? 'green' : 'default'}>{alloc.status}</Tag></Col>
                          </Row>
                        </Card>
                      );
                    })}
                  </div>
                ),
              },
            ]} />
          )}
        </Modal>

        {/* Create Modal */}
        <Modal
          open={createVisible}
          onCancel={() => { setCreateVisible(false); form.resetFields(); }}
          onOk={handleCreate}
          title={<Space><TeamOutlined style={{ color: REDWOOD.investorPurple }} /> Onboard New Investor</Space>}
          width={700}
          okText="Onboard"
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col span={16}><Form.Item name="name" label="Full Name / Entity Name" rules={[{ required: true }]}><Input placeholder="e.g. Sunrise Family Office" /></Form.Item></Col>
              <Col span={8}><Form.Item name="pan" label="PAN" rules={[{ required: true }]}><Input placeholder="ABCDE1234F" /></Form.Item></Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="type" label="Investor Type" rules={[{ required: true }]}>
                  <Select options={['Individual', 'HUF', 'Corporate', 'Trust', 'NRI', 'FPI'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="riskProfile" label="Risk Profile" rules={[{ required: true }]}>
                  <Select options={['Conservative', 'Moderate', 'Aggressive', 'Very Aggressive'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
              <Col span={8}><Form.Item name="totalCommitment" label="Commitment Amount"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input prefix={<MailOutlined />} /></Form.Item></Col>
              <Col span={12}><Form.Item name="phone" label="Phone" rules={[{ required: true }]}><Input prefix={<PhoneOutlined />} /></Form.Item></Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}><Form.Item name="bankName" label="Bank Name"><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name="accountNumber" label="Account Number"><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name="ifsc" label="IFSC Code"><Input /></Form.Item></Col>
            </Row>
            <Form.Item name="address" label="Address"><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="nominee" label="Nominee"><Input /></Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  );
};

export default ClientManagement;
