import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Form, Input, Select, Button, Space, Typography, Table,
  Row, Col, Breadcrumb, Tag, Modal, InputNumber, DatePicker, Descriptions,
  Divider, message, Badge, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, AuditOutlined,
  DollarOutlined, InfoCircleOutlined, StopOutlined, ApiOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  getRetirements, getBookControls, retireAsset, formatCurrency,
} from '../../services/fa.service';
import type { RetirementRecord, BookControlRecord } from '../../services/fa.service';
import { buildApexUrl } from '../../config/api.helper';
import { APEX_DB_CONFIG } from '../../config/api.config';

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

  // Edit modal
  const [editOpen,   setEditOpen]   = useState(false);
  const [editRecord, setEditRecord] = useState<RetirementRecord | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [accountsWithDesc, setAccountsWithDesc] = useState<Record<string, { combo: string; segments: string }>>({});

  // API test modal
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);
  const [apiTestLoading, setApiTestLoading] = useState(false);

  // Retire API details modal
  const [retireApiOpen, setRetireApiOpen] = useState(false);

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
    setLoading(true);
    try {
      // Build the API endpoint with query params
      const params = new URLSearchParams();
      if (bookTypeCode) params.append('bookTypeCode', bookTypeCode);
      const apiUrl = buildApexUrl(`fa/retirements${params.toString() ? '?' + params.toString() : ''}`);

      // Call the GET endpoint
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      // Update table with results
      const records = data.items || data || [];
      setRows(records);
      setSearched(true);

      // Show API response modal
      Modal.info({
        title: 'GET Retirements API Response',
        width: 900,
        content: (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 12, fontWeight: 600 }}>
              ✓ Success! Retrieved {records.length} retirement records
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600 }}>ENDPOINT (GET)</div>
            <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
              {apiUrl}
            </Text>
            <div style={{ fontSize: 11, color: '#888', margin: '16px 0 8px', fontWeight: 600 }}>RESPONSE ({records.length} records)</div>
            <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, maxHeight: 500, overflow: 'auto' }}>
              <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          </div>
        ),
      });
    } catch (error) {
      message.error(`API Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [form]);

  const handleReset = () => {
    form.resetFields();
    loadRetirements();
  };

  const fetchAccountSegmentDescriptions = async (accountCombos: Record<string, string | null>) => {
    const results: Record<string, { combo: string; segments: string }> = {};
    const combosToFetch = Object.entries(accountCombos).filter(([_, v]) => v);

    for (const [key, combo] of combosToFetch) {
      if (!combo) continue;
      try {
        const params = new URLSearchParams({ combination: combo });
        const url = `${APEX_DB_CONFIG.baseUrl}/fa/gl-code-combination?${params}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          results[key] = { combo, segments: data.description || combo };
        } else {
          results[key] = { combo, segments: combo };
        }
      } catch (error) {
        results[key] = { combo, segments: combo };
      }
    }
    return results;
  };

  const openEdit = async (record: RetirementRecord) => {
    setEditRecord(record);
    setEditOpen(true);
    setEditLoading(true);

    try {
      const accounts = {
        assetCost: record.assetCostAccount || '',
        deprnReserve: record.deprnReserveAccount || '',
        proceeds: record.proceedsAccount || '',
        costOfRemoval: record.costOfRemovalAccount || '',
        gain: record.gainAccount || '',
        loss: record.lossAccount || '',
      };

      const descs = await fetchAccountSegmentDescriptions(accounts);
      setAccountsWithDesc(descs);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      message.error('Failed to load account details');
    } finally {
      setEditLoading(false);
    }
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
        bookTypeCode:        retireTarget.bookTypeCode,
        assetId:             retireTarget.assetId,
        dateRetired:         vals.dateRetired,
        retirementTypeCode:  vals.retirementTypeCode || 'ORDINARY',
        proceedsOfSale:      vals.proceedsOfSale    || 0,
        costOfRemoval:       vals.costOfRemoval     || 0,
        soldTo:              vals.soldTo            || '',
        createdBy:           sessionStorage.getItem('userEmail') || 'reacterp',
        lines:               [],
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
    { title: '', key: 'actions', width: 100, align: 'center' as const,
      render: (_: any, record: RetirementRecord) => (
        <Space size="small">
          <Tooltip title="Edit accounting">
            <Button size="small" type="text" style={{ color: FA_COLOR }}
              onClick={() => openEdit(record)}>Edit</Button>
          </Tooltip>
          <Tooltip title="View details">
            <Button size="small" type="text" icon={<InfoCircleOutlined />}
              onClick={() => { setDetailRecord(record); setDetailOpen(true); }} />
          </Tooltip>
        </Space>
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
                <Col xs={24} sm={16} md={18} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <Form.Item style={{ marginBottom: 8 }}>
                    <Space>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                        style={{ background: FA_COLOR, borderColor: FA_COLOR }}>
                        Search
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                    </Space>
                  </Form.Item>
                  <Tooltip title="View API endpoint and test">
                    <Button
                      size="small"
                      icon={<ApiOutlined />}
                      style={{ color: FA_COLOR, borderColor: FA_COLOR, fontSize: 11 }}
                      onClick={() => {
                        const { bookTypeCode } = form.getFieldsValue();
                        const params = new URLSearchParams();
                        if (bookTypeCode) params.append('bookTypeCode', bookTypeCode);
                        const apiUrl = buildApexUrl(`fa/retirements${params.toString() ? '?' + params.toString() : ''}`);

                        Modal.info({
                          title: 'Retirements API — GET Request',
                          width: 760,
                          content: (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>ENDPOINT (GET)</div>
                              <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                                {apiUrl}
                              </Text>
                              {bookTypeCode && (
                                <div style={{ marginTop: 12, fontSize: 11, color: '#666' }}>
                                  <div><strong>Query Parameters:</strong></div>
                                  <div style={{ marginLeft: 8, marginTop: 4 }}>
                                    <code>bookTypeCode = {bookTypeCode}</code>
                                  </div>
                                </div>
                              )}
                              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                                <Button
                                  size="small"
                                  type="primary"
                                  loading={apiTestLoading}
                                  onClick={() => {
                                    setApiTestResult(null);
                                    setApiTestLoading(true);
                                    fetch(apiUrl)
                                      .then(r => {
                                        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                                        return r.json();
                                      })
                                      .then(data => {
                                        setApiTestResult({
                                          success: true,
                                          message: `Success! Retrieved ${(data.items || data).length || 0} records`,
                                          data,
                                        });
                                      })
                                      .catch(err => {
                                        setApiTestResult({
                                          success: false,
                                          message: `Error: ${err.message}`,
                                        });
                                      })
                                      .finally(() => setApiTestLoading(false));
                                  }}
                                >
                                  Test API
                                </Button>
                              </div>
                              {apiTestResult && (
                                <div style={{
                                  marginTop: 12,
                                  padding: 12,
                                  borderRadius: 4,
                                  background: apiTestResult.success ? '#f6ffed' : '#fff2f0',
                                  border: `1px solid ${apiTestResult.success ? '#b7eb8f' : '#ffa39e'}`,
                                }}>
                                  <Text style={{ color: apiTestResult.success ? '#52c41a' : '#f5222d', fontSize: 12 }}>
                                    {apiTestResult.success ? '✓' : '✗'} {apiTestResult.message}
                                  </Text>
                                  {apiTestResult.data && (
                                    <div style={{ marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
                                      <pre style={{
                                        background: '#f5f5f5',
                                        padding: 8,
                                        borderRadius: 2,
                                        fontSize: 10,
                                        fontFamily: 'monospace',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                      }}>
                                        {JSON.stringify(apiTestResult.data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ),
                        });
                      }}
                    >
                      API
                    </Button>
                  </Tooltip>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <StopOutlined style={{ color: REDWOOD.primary }} />
                <span>Retire Asset — {retireTarget?.assetNumber}</span>
              </Space>
              <Tooltip title="View API endpoint and test">
                <Button
                  type="text"
                  size="small"
                  icon={<ApiOutlined />}
                  style={{ color: FA_COLOR, fontSize: 12 }}
                  onClick={() => setRetireApiOpen(true)}
                />
              </Tooltip>
            </div>
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

        {/* Edit Retirement Modal */}
        <Modal
          open={editOpen}
          title={
            <Space>
              <StopOutlined style={{ color: REDWOOD.primary }} />
              <span>Edit Retirement — {editRecord?.retirementId}</span>
            </Space>
          }
          onCancel={() => setEditOpen(false)}
          footer={[
            <Button key="close" onClick={() => setEditOpen(false)}>Close</Button>,
          ]}
          width={800}
          loading={editLoading}
        >
          {editRecord && (
            <>
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 24 }} labelStyle={{ fontWeight: 500, width: 150 }}>
                <Descriptions.Item label="Retirement ID">{editRecord.retirementId}</Descriptions.Item>
                <Descriptions.Item label="Asset Number">{editRecord.assetNumber}</Descriptions.Item>
                <Descriptions.Item label="Book">{editRecord.bookTypeCode}</Descriptions.Item>
                <Descriptions.Item label="Date Retired">{editRecord.dateRetired}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Tag style={{ borderRadius: 4, background: `${statusColor[editRecord.status] || REDWOOD.neutral600}20`,
                    color: statusColor[editRecord.status] || REDWOOD.neutral600 }}>
                    {editRecord.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Retirement Type">{editRecord.retirementTypeCode || '—'}</Descriptions.Item>
              </Descriptions>

              <Divider orientation="left" style={{ fontSize: 12, margin: '16px 0 12px' }}>
                Accounting Accounts
              </Divider>

              {!editLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { label: 'Asset Cost Account', key: 'assetCost', value: editRecord.assetCostAccount },
                    { label: 'Depreciation Reserve Account', key: 'deprnReserve', value: editRecord.deprnReserveAccount },
                    { label: 'Proceeds of Sale Account', key: 'proceeds', value: editRecord.proceedsAccount },
                    { label: 'Cost of Removal Account', key: 'costOfRemoval', value: editRecord.costOfRemovalAccount },
                    { label: 'Gain Account', key: 'gain', value: editRecord.gainAccount },
                    { label: 'Loss Account', key: 'loss', value: editRecord.lossAccount },
                  ].map(({ label, key, value }) => (
                    <Card key={key} size="small" style={{ background: REDWOOD.neutral100 }}>
                      <div style={{ marginBottom: 8 }}>
                        <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900 }}>{label}</Text>
                      </div>
                      {value ? (
                        <>
                          <div style={{ marginBottom: 4 }}>
                            <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, color: '#0572CE' }}>
                              {value}
                            </Text>
                          </div>
                          {accountsWithDesc[key] && (
                            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                              {accountsWithDesc[key].segments}
                            </Text>
                          )}
                        </>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </Modal>

        {/* Retire Asset API Details Modal */}
        <Modal
          open={retireApiOpen}
          title="Retire Asset API Details"
          onCancel={() => setRetireApiOpen(false)}
          footer={[
            <Button key="close" onClick={() => setRetireApiOpen(false)}>Close</Button>,
            <Button
              key="test"
              type="primary"
              loading={apiTestLoading}
              style={{ background: FA_COLOR, borderColor: FA_COLOR }}
              onClick={() => {
                if (!retireTarget) return;
                setApiTestLoading(true);
                const vals = retireForm.getFieldsValue();
                let dateRetired = vals.dateRetired;
                if (dayjs.isDayjs(dateRetired)) {
                  dateRetired = dateRetired.format('YYYY-MM-DD');
                }
                const payload = {
                  bookTypeCode:        retireTarget.bookTypeCode,
                  assetId:             retireTarget.assetId,
                  dateRetired:         dateRetired,
                  retirementTypeCode:  vals.retirementTypeCode || 'ORDINARY',
                  proceedsOfSale:      vals.proceedsOfSale    || 0,
                  costOfRemoval:       vals.costOfRemoval     || 0,
                  soldTo:              vals.soldTo            || '',
                  createdBy:           sessionStorage.getItem('userEmail') || 'reacterp',
                  lines:               [],
                };
                const apiUrl = buildApexUrl('fa/retirements');
                fetch(apiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                })
                  .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                    return r.json();
                  })
                  .then(data => {
                    setApiTestResult({ success: true, message: 'Success', data });
                    message.success('API test successful');
                  })
                  .catch(e => {
                    setApiTestResult({ success: false, message: e.message });
                    message.error(`API test failed: ${e.message}`);
                  })
                  .finally(() => setApiTestLoading(false));
              }}
            >
              Test API
            </Button>,
          ]}
          width={900}
        >
          {retireTarget && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>ENDPOINT (POST)</div>
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                {buildApexUrl('fa/retirements')}
              </Text>

              <div style={{ fontSize: 11, color: '#888', margin: '16px 0 8px', fontWeight: 600 }}>REQUEST BODY</div>
              <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, maxHeight: 400, overflow: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' }}>
                  {JSON.stringify({
                    bookTypeCode:        retireTarget.bookTypeCode,
                    assetId:             retireTarget.assetId,
                    dateRetired:         retireForm.getFieldValue('dateRetired') ? (dayjs.isDayjs(retireForm.getFieldValue('dateRetired')) ? retireForm.getFieldValue('dateRetired').format('YYYY-MM-DD') : retireForm.getFieldValue('dateRetired')) : new Date().toISOString().split('T')[0],
                    retirementTypeCode:  retireForm.getFieldValue('retirementTypeCode') || 'ORDINARY',
                    proceedsOfSale:      retireForm.getFieldValue('proceedsOfSale') || 0,
                    costOfRemoval:       retireForm.getFieldValue('costOfRemoval') || 0,
                    soldTo:              retireForm.getFieldValue('soldTo') || '',
                    createdBy:           sessionStorage.getItem('userEmail') || 'reacterp',
                    lines:               [],
                  }, null, 2)}
                </pre>
              </div>

              {apiTestResult && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600 }}>RESPONSE</div>
                  <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, maxHeight: 300, overflow: 'auto' }}>
                    <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' }}>
                      {JSON.stringify(apiTestResult.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      </Content>


    </Layout>
  );
};

export default Retirements;
