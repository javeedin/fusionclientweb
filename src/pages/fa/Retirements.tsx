import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Form, Input, Select, Button, Space, Typography, Table,
  Row, Col, Breadcrumb, Tag, Modal, InputNumber, DatePicker, Descriptions,
  Divider, message, Badge, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, AuditOutlined,
  DollarOutlined, InfoCircleOutlined, StopOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  getRetirements, getBookControls, retireAsset, formatCurrency,
} from '../../services/fa.service';
import type { RetirementRecord, BookControlRecord } from '../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const statusColor: Record<string, string> = {
  PROCESSED:  REDWOOD.success,
  PENDING:    REDWOOD.warning,
  REINSTATE:  REDWOOD.info,
};

const Retirements: React.FC = () => {
  const [form]      = Form.useForm();
  const [retireForm] = Form.useForm();

  const [rows,         setRows]         = useState<RetirementRecord[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [bookControls, setBookControls] = useState<BookControlRecord[]>([]);

  // Retire modal
  const [retireOpen,   setRetireOpen]   = useState(false);
  const [retireTarget, setRetireTarget] = useState<RetirementRecord | null>(null);
  const [retireSaving, setRetireSaving] = useState(false);

  // Detail modal
  const [detailOpen,   setDetailOpen]   = useState(false);
  const [detailRecord, setDetailRecord] = useState<RetirementRecord | null>(null);

  useEffect(() => {
    getBookControls().then(setBookControls);
    loadRetirements();
  }, []);

  const loadRetirements = async (bookTypeCode?: string) => {
    setLoading(true);
    try {
      const data = await getRetirements(bookTypeCode);
      setRows(data);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = useCallback(async () => {
    const { bookTypeCode } = form.getFieldsValue();
    await loadRetirements(bookTypeCode || undefined);
  }, [form]);

  const handleReset = () => {
    form.resetFields();
    loadRetirements();
  };

  const handleRetireSubmit = async () => {
    if (!retireTarget) return;
    try {
      await retireForm.validateFields();
      const vals = retireForm.getFieldsValue();
      if (vals.dateRetired && dayjs.isDayjs(vals.dateRetired)) {
        vals.dateRetired = vals.dateRetired.format('YYYY-MM-DD');
      }
      setRetireSaving(true);
      const res = await retireAsset(retireTarget.assetId, {
        bookTypeCode:      retireTarget.bookTypeCode,
        dateRetired:       vals.dateRetired,
        retirementTypeCode:vals.retirementTypeCode,
        proceedsOfSale:    vals.proceedsOfSale    || 0,
        costOfRemoval:     vals.costOfRemoval     || 0,
        soldTo:            vals.soldTo            || '',
      });
      if (res.success) {
        message.success(`Asset ${retireTarget.assetNumber} retired. Gain/Loss: ${formatCurrency(res.gainLoss || '0')}`);
        setRetireOpen(false);
        retireForm.resetFields();
        setRetireTarget(null);
        runSearch();
      } else {
        message.error(res.error || 'Retirement failed');
      }
    } finally {
      setRetireSaving(false);
    }
  };

  // ── Table columns ───────────────────────────────────────────────────────────
  const columns: ColumnsType<RetirementRecord> = [
    { title: 'Asset Number', dataIndex: 'assetNumber', key: 'assetNumber', width: 130,
      render: (v) => <Text strong style={{ color: FA_COLOR }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Book',        dataIndex: 'bookTypeCode', key: 'bookTypeCode', width: 160, ellipsis: true },
    { title: 'Date Retired',dataIndex: 'dateRetired',  key: 'dateRetired',  width: 120 },
    { title: 'Type',        dataIndex: 'retirementTypeCode', key: 'type',   width: 100,
      render: (v) => v ? <Tag style={{ borderRadius: 4 }}>{v}</Tag> : '—' },
    { title: 'Cost Retired',dataIndex: 'costRetired',  key: 'costRetired',  width: 130, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'NBV Retired', dataIndex: 'nbvRetired',   key: 'nbvRetired',   width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Proceeds',    dataIndex: 'proceedsOfSale',key: 'proceeds',    width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Gain / Loss', dataIndex: 'gainLossAmount',key: 'gainLoss',    width: 120, align: 'right' as const,
      render: (v) => {
        const n = parseFloat(v || '0');
        return <Text style={{ color: n >= 0 ? REDWOOD.success : REDWOOD.primary, fontWeight: 600 }}>
          {formatCurrency(v)}
        </Text>;
      }},
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: (v) => <Tag color={statusColor[v] ? undefined : undefined}
        style={{ borderRadius: 4, background: `${statusColor[v] || REDWOOD.neutral600}20`,
                 color: statusColor[v] || REDWOOD.neutral600, border: `1px solid ${statusColor[v] || REDWOOD.neutral600}40` }}>
        {v || '—'}
      </Tag> },
    { title: '', key: 'actions', width: 60, align: 'center' as const,
      render: (_: any, record: RetirementRecord) => (
        <Tooltip title="View details">
          <Button size="small" type="text" icon={<InfoCircleOutlined />}
            onClick={() => { setDetailRecord(record); setDetailOpen(true); }} />
        </Tooltip>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Asset Retirements' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primary}99 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AuditOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Asset Retirements</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>View and process asset retirements</Text>
              </div>
            </Space>
          </div>

          {/* Filter card */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 }}
            bodyStyle={{ padding: '16px 20px' }}>
            <Form form={form} layout="vertical" onFinish={runSearch}>
              <Row gutter={[16, 0]}>
                <Col xs={24} sm={8} md={6}>
                  <Form.Item name="bookTypeCode" label="Book" style={{ marginBottom: 8 }}>
                    <Select allowClear showSearch optionFilterProp="children" placeholder="All books">
                      {bookControls.map(b => (
                        <Option key={b.bookTypeCode} value={b.bookTypeCode}>{b.bookTypeCode}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8} md={4} style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Form.Item style={{ marginBottom: 8 }}>
                    <Space>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                        style={{ background: FA_COLOR, borderColor: FA_COLOR }}>
                        Search
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* Results table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: 0 }}
            title={
              searched
                ? <Text strong>Retirements <Badge count={rows.length} style={{ backgroundColor: REDWOOD.primary }} /></Text>
                : <Text strong>Retirements</Text>
            }
          >
            <Table<RetirementRecord>
              dataSource={rows}
              columns={columns}
              rowKey="retirementId"
              loading={loading}
              size="small"
              scroll={{ x: 1200 }}
              locale={{ emptyText: 'No retirement records found' }}
              pagination={{ pageSize: 50, showTotal: (t) => `${t} records`, showSizeChanger: true }}
            />
          </Card>
        </div>

        {/* Retire Asset Modal */}
        <Modal
          open={retireOpen}
          title={
            <Space>
              <StopOutlined style={{ color: REDWOOD.primary }} />
              <span>Retire Asset — {retireTarget?.assetNumber}</span>
            </Space>
          }
          onCancel={() => { setRetireOpen(false); retireForm.resetFields(); }}
          onOk={handleRetireSubmit}
          okText="Process Retirement"
          confirmLoading={retireSaving}
          okButtonProps={{ danger: true }}
          width={560}
        >
          {retireTarget && (
            <>
              <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Asset">{retireTarget.assetNumber}</Descriptions.Item>
                <Descriptions.Item label="Book">{retireTarget.bookTypeCode}</Descriptions.Item>
                <Descriptions.Item label="Description" span={2}>{retireTarget.description}</Descriptions.Item>
              </Descriptions>
              <Divider />
              <Form form={retireForm} layout="vertical">
                <Row gutter={[16, 0]}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="dateRetired" label="Date Retired" rules={[{ required: true, message: 'Required' }]}>
                      <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="retirementTypeCode" label="Retirement Type">
                      <Select allowClear placeholder="Select">
                        <Option value="ORDINARY">Ordinary</Option>
                        <Option value="SALE">Sale</Option>
                        <Option value="THEFT">Theft</Option>
                        <Option value="ABANDONMENT">Abandonment</Option>
                        <Option value="LIKE-KIND">Like-Kind Exchange</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="proceedsOfSale" label="Proceeds of Sale" initialValue={0}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01} prefix={<DollarOutlined />} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="costOfRemoval" label="Cost of Removal" initialValue={0}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01} prefix={<DollarOutlined />} />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item name="soldTo" label="Sold To">
                      <Input placeholder="Buyer name or reference" />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </>
          )}
        </Modal>

        {/* Detail Modal */}
        <Modal
          open={detailOpen}
          title={
            <Space>
              <AuditOutlined style={{ color: FA_COLOR }} />
              <span>Retirement Detail — {detailRecord?.assetNumber}</span>
            </Space>
          }
          onCancel={() => setDetailOpen(false)}
          footer={[
            <Button key="close" onClick={() => setDetailOpen(false)}>Close</Button>,
          ]}
          width={620}
        >
          {detailRecord && (
            <Descriptions column={2} size="small" bordered labelStyle={{ fontWeight: 500, width: 150 }}>
              <Descriptions.Item label="Retirement ID">{detailRecord.retirementId}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag style={{ borderRadius: 4, background: `${statusColor[detailRecord.status] || REDWOOD.neutral600}20`,
                  color: statusColor[detailRecord.status] || REDWOOD.neutral600 }}>
                  {detailRecord.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Asset Number">{detailRecord.assetNumber}</Descriptions.Item>
              <Descriptions.Item label="Book">{detailRecord.bookTypeCode}</Descriptions.Item>
              <Descriptions.Item label="Description" span={2}>{detailRecord.description}</Descriptions.Item>
              <Descriptions.Item label="Date Retired">{detailRecord.dateRetired}</Descriptions.Item>
              <Descriptions.Item label="Retirement Type">{detailRecord.retirementTypeCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="Cost Retired">{formatCurrency(detailRecord.costRetired)}</Descriptions.Item>
              <Descriptions.Item label="NBV Retired">{formatCurrency(detailRecord.nbvRetired)}</Descriptions.Item>
              <Descriptions.Item label="Proceeds">{formatCurrency(detailRecord.proceedsOfSale)}</Descriptions.Item>
              <Descriptions.Item label="Cost of Removal">{formatCurrency(detailRecord.costOfRemoval)}</Descriptions.Item>
              <Descriptions.Item label="Gain / Loss">
                <Text style={{ fontWeight: 600, color: parseFloat(detailRecord.gainLossAmount || '0') >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                  {formatCurrency(detailRecord.gainLossAmount)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Sold To">{detailRecord.soldTo || '—'}</Descriptions.Item>
            </Descriptions>
          )}
        </Modal>
      </Content>

      
    </Layout>
  );
};

export default Retirements;
