import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Select, DatePicker, Statistic, Modal, Form, message, Input,
} from 'antd';
import {
  HomeOutlined, FileTextOutlined, DownloadOutlined, PlusOutlined,
  FilePdfOutlined, FileExcelOutlined, SendOutlined, EyeOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_REPORTS, MOCK_FUNDS, MOCK_INVESTORS } from './mockData';
import type { Report } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;
const { RangePicker } = DatePicker;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const ReportsPage: React.FC = () => {
  const [reports, setReports] = useState<Report[]>(MOCK_REPORTS);
  const [createVisible, setCreateVisible] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [form] = Form.useForm();

  const filteredReports = useMemo(() => {
    if (typeFilter === 'all') return reports;
    return reports.filter(r => r.type === typeFilter);
  }, [reports, typeFilter]);

  const handleGenerate = () => {
    form.validateFields().then(values => {
      const newReport: Report = {
        id: `RPT-${String(reports.length + 1).padStart(3, '0')}`,
        name: values.name,
        type: values.type,
        fundId: values.fundId,
        investorId: values.investorId,
        periodStart: values.period?.[0]?.format('DD MMM YYYY') || '',
        periodEnd: values.period?.[1]?.format('DD MMM YYYY') || '',
        generatedDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        generatedBy: 'Current User',
        status: 'Generated',
        format: values.format,
      };
      setReports([newReport, ...reports]);
      setCreateVisible(false);
      form.resetFields();
      message.success('Report generated successfully');
    });
  };

  const reportTypes = ['Performance', 'Holdings', 'Transaction', 'Client Statement', 'Risk', 'Compliance', 'Fee', 'Attribution', 'MIS'];

  const columns = [
    {
      title: 'Report', key: 'report', width: 350,
      render: (_: unknown, r: Report) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{r.name}</Text>
          <br /><Text type="secondary" style={{ fontSize: 10 }}>{r.id}</Text>
        </div>
      ),
    },
    {
      title: 'Type', dataIndex: 'type', key: 'type', width: 120,
      render: (v: string) => {
        const colors: Record<string, string> = {
          Performance: 'green', Holdings: 'blue', Transaction: 'cyan', 'Client Statement': 'purple',
          Risk: 'orange', Compliance: 'red', Fee: 'gold', Attribution: 'geekblue', MIS: 'magenta',
        };
        return <Tag color={colors[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: 'Fund', key: 'fund', width: 120,
      render: (_: unknown, r: Report) => r.fundId ? <Tag>{MOCK_FUNDS.find(f => f.id === r.fundId)?.shortName}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: 'Period', key: 'period', width: 200,
      render: (_: unknown, r: Report) => <Text style={{ fontSize: 12 }}>{r.periodStart} — {r.periodEnd}</Text>,
    },
    {
      title: 'Generated', dataIndex: 'generatedDate', key: 'generated', width: 110,
    },
    {
      title: 'By', dataIndex: 'generatedBy', key: 'by', width: 110,
    },
    {
      title: 'Format', dataIndex: 'format', key: 'format', width: 80,
      render: (v: string) => (
        <Tag icon={v === 'PDF' ? <FilePdfOutlined /> : <FileExcelOutlined />} color={v === 'PDF' ? 'red' : v === 'Excel' ? 'green' : 'default'}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => (
        <Tag color={v === 'Sent' ? 'green' : v === 'Generated' ? 'blue' : 'default'} icon={v === 'Sent' ? <SendOutlined /> : undefined}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Actions', key: 'actions', width: 120,
      render: (_: unknown, r: Report) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />}>View</Button>
          <Button type="link" size="small" icon={<DownloadOutlined />}>Download</Button>
        </Space>
      ),
    },
  ];

  // Quick report templates
  const quickReports = [
    { label: 'Monthly Performance', type: 'Performance', desc: 'Fund-wise monthly performance summary' },
    { label: 'Current Holdings', type: 'Holdings', desc: 'Snapshot of all holdings across funds' },
    { label: 'Client Statement', type: 'Client Statement', desc: 'Investor capital account statement' },
    { label: 'Risk Report', type: 'Risk', desc: 'Risk metrics and concentration analysis' },
    { label: 'Compliance Check', type: 'Compliance', desc: 'Regulatory compliance status report' },
    { label: 'Fee Schedule', type: 'Fee', desc: 'Management and performance fee calculations' },
    { label: 'Trade Report', type: 'Transaction', desc: 'Transaction and settlement report' },
    { label: 'MIS Report', type: 'MIS', desc: 'Management information summary' },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/pms">PMS</Link> },
            { title: 'Reports' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: '#4A148C15', borderRadius: 12, padding: 12 }}>
                <FileTextOutlined style={{ fontSize: 28, color: '#4A148C' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Reports & Statements</Title>
                <Text type="secondary">Generate performance reports, client statements, and MIS</Text>
              </div>
            </Space>
            <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreateVisible(true)}>Generate Report</Button>
          </div>

          {/* Quick Report Templates */}
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 14, marginBottom: 8, display: 'block' }}>Quick Generate</Text>
            <Row gutter={[8, 8]}>
              {quickReports.map((qr, i) => (
                <Col xs={12} sm={8} md={6} lg={3} key={i}>
                  <Card
                    hoverable
                    size="small"
                    style={{ borderRadius: 8, cursor: 'pointer', textAlign: 'center' }}
                    bodyStyle={{ padding: '10px 8px' }}
                    onClick={() => {
                      form.setFieldsValue({ type: qr.type, name: qr.label, format: 'PDF' });
                      setCreateVisible(true);
                    }}
                  >
                    <FileTextOutlined style={{ fontSize: 20, color: '#4A148C', marginBottom: 4 }} />
                    <div><Text strong style={{ fontSize: 11 }}>{qr.label}</Text></div>
                    <Text type="secondary" style={{ fontSize: 9 }}>{qr.desc}</Text>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>

          {/* KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Reports" value={reports.length} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Sent" value={reports.filter(r => r.status === 'Sent').length} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Draft" value={reports.filter(r => r.status === 'Draft').length} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.warning }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Report Types" value={new Set(reports.map(r => r.type)).size} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
          </Row>

          {/* Filters + Table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
              <Select
                value={typeFilter}
                onChange={setTypeFilter}
                style={{ width: 180 }}
                options={[{ label: 'All Types', value: 'all' }, ...reportTypes.map(t => ({ label: t, value: t }))]}
              />
            </div>
            <Table dataSource={filteredReports} columns={columns} rowKey="id" scroll={{ x: 1300 }} size="small" pagination={{ pageSize: 15 }} />
          </Card>
        </div>

        {/* Generate Report Modal */}
        <Modal
          open={createVisible}
          onCancel={() => { setCreateVisible(false); form.resetFields(); }}
          onOk={handleGenerate}
          title={<Space><FileTextOutlined style={{ color: '#4A148C' }} /> Generate Report</Space>}
          width={600}
          okText="Generate"
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item name="name" label="Report Name" rules={[{ required: true }]}>
              <Input placeholder="e.g. Monthly Performance Report - Feb 2026" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="type" label="Report Type" rules={[{ required: true }]}>
                  <Select options={reportTypes.map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="format" label="Format" rules={[{ required: true }]} initialValue="PDF">
                  <Select options={['PDF', 'Excel', 'CSV'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="fundId" label="Fund (optional)">
                  <Select allowClear options={MOCK_FUNDS.map(f => ({ label: f.shortName, value: f.id }))} placeholder="All funds" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="investorId" label="Investor (optional)">
                  <Select allowClear options={MOCK_INVESTORS.map(i => ({ label: i.name, value: i.id }))} placeholder="All investors" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="period" label="Period">
              <RangePicker style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  );
};

export default ReportsPage;
