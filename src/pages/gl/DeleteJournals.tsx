import { buildApexUrl } from '../config/api.helper';
import React, { useState } from 'react';
import {
  Layout, Card, Row, Col, Input, Button, Space, Tabs, message, Modal, Divider,
  Form, InputNumber, Statistic, Typography, Alert, Empty, Table, Tag, Popconfirm, Spin,
} from 'antd';
import {
  DeleteOutlined, ClearOutlined, ExclamationCircleOutlined, CheckCircleOutlined,
  ClockCircleOutlined, BugOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const APEX_BASE = buildApexUrl('');

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

interface DeletionResult {
  id: number | string;
  type: 'sla' | 'journal';
  status: 'pending' | 'success' | 'error';
  message?: string;
  startTime?: number;
  endTime?: number;
}

const DeleteJournals: React.FC = () => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('sla');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DeletionResult[]>([]);
  const [deletionStats, setDeletionStats] = useState({
    total: 0,
    success: 0,
    failed: 0,
    duration: 0,
  });

  // ── Delete SLA Entry ────────────────────────────────────────────────────
  const handleDeleteSla = async (headerId: number) => {
    if (!headerId || headerId <= 0) {
      message.error('Please enter a valid SLA Header ID');
      return;
    }

    Modal.confirm({
      title: 'Delete SLA Entry',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Alert
            type="warning"
            message="This action will delete the SLA entry permanently"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <p>
            <strong>SLA Header ID:</strong> {headerId}
          </p>
          <p style={{ color: REDWOOD.primary, fontWeight: 500 }}>
            This cannot be undone. Are you sure?
          </p>
        </div>
      ),
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        const startTime = Date.now();
        const result: DeletionResult = {
          id: headerId,
          type: 'sla',
          status: 'pending',
          startTime,
        };

        try {
          const deleteUrl = `${APEX_BASE}/sla/accounting/delete`;
          const response = await fetch(deleteUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ headerId }),
          });

          const data = await response.json().catch(() => ({}));

          if (response.ok && (data.success !== false)) {
            result.status = 'success';
            result.message = `SLA Header ${headerId} deleted successfully`;
            message.success(result.message);
          } else {
            result.status = 'error';
            result.message = data?.message || data?.error || `HTTP ${response.status}`;
            message.error(`Failed to delete SLA: ${result.message}`);
          }
        } catch (error: any) {
          result.status = 'error';
          result.message = error.message || 'Network error';
          message.error(`Error deleting SLA: ${result.message}`);
        } finally {
          result.endTime = Date.now();
          setResults(prev => [...prev, result]);
          setLoading(false);
          form.resetFields();
        }
      },
    });
  };

  // ── Delete GL Journal ────────────────────────────────────────────────────
  const handleDeleteJournal = async (batchId: number) => {
    if (!batchId || batchId <= 0) {
      message.error('Please enter a valid GL Batch ID');
      return;
    }

    Modal.confirm({
      title: 'Delete GL Journal',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Alert
            type="warning"
            message="This action will delete the GL journal and all associated lines permanently"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <p>
            <strong>GL Batch ID:</strong> {batchId}
          </p>
          <p style={{ color: REDWOOD.primary, fontWeight: 500 }}>
            This cannot be undone. Are you sure?
          </p>
        </div>
      ),
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        const startTime = Date.now();
        const result: DeletionResult = {
          id: batchId,
          type: 'journal',
          status: 'pending',
          startTime,
        };

        try {
          const deleteUrl = `${APEX_BASE}/gl/journals/batches/${batchId}`;
          const response = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              Accept: 'application/json',
            },
          });

          const data = await response.json().catch(() => ({}));

          if (response.ok && (data.success !== false)) {
            result.status = 'success';
            result.message = `GL Batch ${batchId} deleted successfully`;
            message.success(result.message);
          } else {
            result.status = 'error';
            result.message = data?.message || data?.error || `HTTP ${response.status}`;
            message.error(`Failed to delete GL journal: ${result.message}`);
          }
        } catch (error: any) {
          result.status = 'error';
          result.message = error.message || 'Network error';
          message.error(`Error deleting GL journal: ${result.message}`);
        } finally {
          result.endTime = Date.now();
          setResults(prev => [...prev, result]);
          setLoading(false);
          form.resetFields();
        }
      },
    });
  };

  // ── Batch Delete ────────────────────────────────────────────────────────
  const handleBatchDelete = async (type: 'sla' | 'journal', ids: string) => {
    const idList = ids
      .split(/[,\s]+/)
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id) && id > 0);

    if (idList.length === 0) {
      message.error('Please enter valid IDs');
      return;
    }

    Modal.confirm({
      title: `Batch Delete ${type === 'sla' ? 'SLA Entries' : 'GL Journals'}`,
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Alert
            type="error"
            message={`This will delete ${idList.length} ${type === 'sla' ? 'SLA entries' : 'GL journals'}`}
            showIcon
            style={{ marginBottom: 12 }}
          />
          <p>
            <strong>IDs to delete:</strong> {idList.join(', ')}
          </p>
          <p style={{ color: REDWOOD.primary, fontWeight: 500 }}>
            This action cannot be undone. Are you sure?
          </p>
        </div>
      ),
      okText: 'Delete All',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        const overallStartTime = Date.now();
        let successCount = 0;
        let failCount = 0;
        const newResults: DeletionResult[] = [];

        for (const id of idList) {
          const startTime = Date.now();
          const result: DeletionResult = {
            id,
            type,
            status: 'pending',
            startTime,
          };

          try {
            if (type === 'sla') {
              const response = await fetch(`${APEX_BASE}/sla/accounting/delete`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify({ headerId: id }),
              });
              const data = await response.json().catch(() => ({}));
              if (response.ok && data.success !== false) {
                result.status = 'success';
                successCount++;
              } else {
                result.status = 'error';
                result.message = data?.message || `HTTP ${response.status}`;
                failCount++;
              }
            } else {
              const response = await fetch(`${APEX_BASE}/gl/journals/batches/${id}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' },
              });
              const data = await response.json().catch(() => ({}));
              if (response.ok && data.success !== false) {
                result.status = 'success';
                successCount++;
              } else {
                result.status = 'error';
                result.message = data?.message || `HTTP ${response.status}`;
                failCount++;
              }
            }
          } catch (error: any) {
            result.status = 'error';
            result.message = error.message;
            failCount++;
          }

          result.endTime = Date.now();
          newResults.push(result);
        }

        const duration = Date.now() - overallStartTime;
        setResults(prev => [...prev, ...newResults]);
        setDeletionStats({
          total: idList.length,
          success: successCount,
          failed: failCount,
          duration,
        });

        setLoading(false);
        form.resetFields();

        if (failCount === 0) {
          message.success(`All ${successCount} ${type === 'sla' ? 'SLA entries' : 'GL journals'} deleted successfully`);
        } else {
          message.warning(`Deleted ${successCount} of ${idList.length} items. ${failCount} failed.`);
        }
      },
    });
  };

  // ── Results Table ────────────────────────────────────────────────────────
  const resultColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (id: number) => <Text code>{id}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (type: string) => (
        <Tag color={type === 'sla' ? 'blue' : 'cyan'}>
          {type.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const colors = {
          pending: 'processing',
          success: 'success',
          error: 'error',
        };
        const icons = {
          pending: <ClockCircleOutlined />,
          success: <CheckCircleOutlined />,
          error: <BugOutlined />,
        };
        return (
          <Tag icon={icons[status as keyof typeof icons]} color={colors[status as keyof typeof colors]}>
            {status.toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      flex: 1,
      render: (msg: string) => msg ? <Text>{msg}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Duration (ms)',
      key: 'duration',
      width: 120,
      render: (_: any, record: DeletionResult) => {
        if (!record.startTime || !record.endTime) return '—';
        return <Text code>{record.endTime - record.startTime}</Text>;
      },
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: 24 }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <Space align="center" size="large">
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}
            >
              <DeleteOutlined style={{ fontSize: 28, color: '#fff' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                Delete Journals
              </Title>
              <Text type="secondary">Delete SLA entries and GL journals (Test Cleanup)</Text>
            </div>
          </Space>
        </div>

        <Spin spinning={loading}>
          {/* Tabs for SLA and Journal deletion */}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'sla',
                label: 'Delete SLA Entry',
                children: (
                  <Card
                    style={{
                      borderRadius: 12,
                      border: 'none',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                    bodyStyle={{ padding: 24 }}
                  >
                    <Form form={form} layout="vertical">
                      <Alert
                        type="warning"
                        icon={<ExclamationCircleOutlined />}
                        message="Warning: Deleting SLA entries is irreversible"
                        description="This will permanently delete the SLA accounting header and any related data."
                        showIcon
                        style={{ marginBottom: 24 }}
                      />

                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            label="SLA Header ID"
                            required
                            tooltip="The unique identifier of the SLA accounting header to delete"
                          >
                            <Input
                              placeholder="e.g., 845"
                              type="number"
                              onChange={(e) => {
                                const val = e.target.value;
                                form.setFieldValue('slaId', val ? parseInt(val, 10) : undefined);
                              }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider />

                      <Space>
                        <Button
                          danger
                          type="primary"
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            const id = form.getFieldValue('slaId');
                            if (id) handleDeleteSla(id);
                          }}
                        >
                          Delete SLA Entry
                        </Button>
                        <Button onClick={() => form.resetFields()}>
                          Clear
                        </Button>
                      </Space>

                      <Divider />

                      <div style={{ marginTop: 24 }}>
                        <Title level={4}>Batch Delete SLA Entries</Title>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                          Delete multiple SLA entries at once. Enter IDs separated by commas or spaces.
                        </Text>
                        <Form.Item label="SLA Header IDs (comma-separated)" style={{ marginBottom: 16 }}>
                          <Input.TextArea
                            placeholder="e.g., 845, 846, 847 or 845 846 847"
                            rows={3}
                            onChange={(e) => form.setFieldValue('slaBatch', e.target.value)}
                          />
                        </Form.Item>
                        <Button
                          danger
                          onClick={() => {
                            const ids = form.getFieldValue('slaBatch');
                            if (ids) handleBatchDelete('sla', ids);
                          }}
                        >
                          Delete Multiple SLA Entries
                        </Button>
                      </div>
                    </Form>
                  </Card>
                ),
              },
              {
                key: 'journal',
                label: 'Delete GL Journal',
                children: (
                  <Card
                    style={{
                      borderRadius: 12,
                      border: 'none',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                    bodyStyle={{ padding: 24 }}
                  >
                    <Form form={form} layout="vertical">
                      <Alert
                        type="warning"
                        icon={<ExclamationCircleOutlined />}
                        message="Warning: Deleting GL journals is irreversible"
                        description="This will permanently delete the GL journal batch, header, and all associated lines."
                        showIcon
                        style={{ marginBottom: 24 }}
                      />

                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            label="GL Batch ID"
                            required
                            tooltip="The unique identifier of the GL journal batch to delete"
                          >
                            <Input
                              placeholder="e.g., 12345"
                              type="number"
                              onChange={(e) => {
                                const val = e.target.value;
                                form.setFieldValue('journalId', val ? parseInt(val, 10) : undefined);
                              }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider />

                      <Space>
                        <Button
                          danger
                          type="primary"
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            const id = form.getFieldValue('journalId');
                            if (id) handleDeleteJournal(id);
                          }}
                        >
                          Delete GL Journal
                        </Button>
                        <Button onClick={() => form.resetFields()}>
                          Clear
                        </Button>
                      </Space>

                      <Divider />

                      <div style={{ marginTop: 24 }}>
                        <Title level={4}>Batch Delete GL Journals</Title>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                          Delete multiple GL journals at once. Enter IDs separated by commas or spaces.
                        </Text>
                        <Form.Item label="GL Batch IDs (comma-separated)" style={{ marginBottom: 16 }}>
                          <Input.TextArea
                            placeholder="e.g., 12345, 12346, 12347 or 12345 12346 12347"
                            rows={3}
                            onChange={(e) => form.setFieldValue('journalBatch', e.target.value)}
                          />
                        </Form.Item>
                        <Button
                          danger
                          onClick={() => {
                            const ids = form.getFieldValue('journalBatch');
                            if (ids) handleBatchDelete('journal', ids);
                          }}
                        >
                          Delete Multiple GL Journals
                        </Button>
                      </div>
                    </Form>
                  </Card>
                ),
              },
            ]}
          />

          {/* Statistics */}
          {deletionStats.total > 0 && (
            <Card
              style={{
                marginTop: 24,
                borderRadius: 12,
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
              bodyStyle={{ padding: 24 }}
            >
              <Title level={4}>Batch Deletion Statistics</Title>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={6}>
                  <Statistic title="Total" value={deletionStats.total} />
                </Col>
                <Col xs={24} sm={6}>
                  <Statistic
                    title="Successful"
                    value={deletionStats.success}
                    valueStyle={{ color: REDWOOD.success }}
                  />
                </Col>
                <Col xs={24} sm={6}>
                  <Statistic
                    title="Failed"
                    value={deletionStats.failed}
                    valueStyle={{ color: REDWOOD.primary }}
                  />
                </Col>
                <Col xs={24} sm={6}>
                  <Statistic title="Duration (ms)" value={deletionStats.duration} />
                </Col>
              </Row>
            </Card>
          )}

          {/* Results Table */}
          {results.length > 0 && (
            <Card
              style={{
                marginTop: 24,
                borderRadius: 12,
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
              bodyStyle={{ padding: 24 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Title level={4} style={{ margin: 0 }}>Deletion Results</Title>
                <Button
                  size="small"
                  onClick={() => {
                    setResults([]);
                    setDeletionStats({ total: 0, success: 0, failed: 0, duration: 0 });
                  }}
                >
                  Clear Results
                </Button>
              </div>
              <Table
                dataSource={results}
                columns={resultColumns}
                rowKey={(record, index) => `${record.type}-${record.id}-${index}`}
                pagination={{ pageSize: 10 }}
                size="small"
              />
            </Card>
          )}

          {/* API Documentation */}
          <Card
            style={{
              marginTop: 32,
              borderRadius: 12,
              border: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              background: REDWOOD.neutral100,
            }}
            bodyStyle={{ padding: 24 }}
          >
            <Title level={4}>API Endpoints</Title>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card size="small" style={{ background: REDWOOD.surface }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>Delete SLA Entry</Text>
                  <Text code style={{ display: 'block', marginBottom: 8 }}>POST /sla/accounting/delete</Text>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    Body: {'{headerId: number}'}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    URL: {APEX_BASE}/sla/accounting/delete
                  </Text>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" style={{ background: REDWOOD.surface }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>Delete GL Journal</Text>
                  <Text code style={{ display: 'block', marginBottom: 8 }}>DELETE /gl/journals/batches/{'{batchId}'}</Text>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    No body required
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    URL: {APEX_BASE}/gl/journals/batches/{'{batchId}'}
                  </Text>
                </Card>
              </Col>
            </Row>
          </Card>
        </Spin>
      </Content>
    </Layout>
  );
};

export default DeleteJournals;
