import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Breadcrumb,
  Tag,
  Row,
  Col,
  Spin,
  Alert,
  Progress,
  Statistic,
} from 'antd';
import {
  HomeOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { ORACLE_FUSION_CONFIG } from '../../config/api.config';
import FloatingMenu from '../../components/FloatingMenu';

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  error: '#C74634',
  info: '#0572CE',
  neutral: '#383838',
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F7F7',
  border: '#E5E5E5',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B6B',
};

// Types - using camelCase to match API response
interface InvoiceHold {
  holdName: string;
  holdType: string;
  description: string | null;
  holdInstruction: string | null;
  postableFlag: boolean;
  userReleaseableFlag: boolean;
  userUpdateableFlag: boolean;
  holdsResolutionRoutingFlag: boolean | null;
  daysBeforeNotifying: number | null;
  daysBeforeReminding: number | null;
  inactiveDate: string | null;
  createdBy: string;
  creationDate: string;
  lastUpdateDate: string;
  lastUpdatedBy: string;
}

const FUSION_AUTH = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
const FUSION_HEADERS = { Authorization: FUSION_AUTH, Accept: 'application/json' };

const InvoiceHolds: React.FC = () => {
  const [holds, setHolds] = useState<InvoiceHold[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; fetching: boolean }>({
    current: 0,
    total: 0,
    fetching: false,
  });

  // Fetch all invoice holds with pagination
  const fetchAllHolds = useCallback(async () => {
    setLoading(true);
    setError('');
    setHolds([]);
    setFetchProgress({ current: 0, total: 0, fetching: true });

    const allHolds: InvoiceHold[] = [];
    let offset = 0;
    const limit = 500;
    let hasMore = true;
    let pageCount = 0;

    try {
      while (hasMore) {
        const fusionPath = `fscmRestApi/resources/11.13.18.05/payablesInvoiceHolds?limit=${limit}&offset=${offset}`;
        const url = `https://iaaobn.fa.ocs.oraclecloud.com/${fusionPath}`;

        console.log(`=== FETCHING INVOICE HOLDS PAGE ${pageCount + 1} ===`);
        console.log('URL:', url);
        console.log('Offset:', offset);

        const response = await fetch(url, { headers: FUSION_HEADERS });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const items = result.items || [];

        console.log('Items fetched:', items.length);
        console.log('Sample item:', items[0]);
        console.log('HasMore:', result.hasMore);

        allHolds.push(...items);
        pageCount++;

        setFetchProgress({
          current: allHolds.length,
          total: result.totalResults || allHolds.length,
          fetching: true,
        });

        // Check if there are more pages
        hasMore = result.hasMore === true && items.length > 0;
        offset += limit;

        // Safety check to prevent infinite loops
        if (pageCount > 50) {
          console.warn('Safety limit reached: 50 pages');
          break;
        }
      }

      console.log('=== FETCH COMPLETE ===');
      console.log('Total holds fetched:', allHolds.length);
      console.log('Total pages:', pageCount);

      setHolds(allHolds);
      setFetchProgress({ current: allHolds.length, total: allHolds.length, fetching: false });
    } catch (err) {
      console.error('Error fetching holds:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setFetchProgress({ current: 0, total: 0, fetching: false });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchAllHolds();
  }, [fetchAllHolds]);

  // Get unique hold types for filtering
  const holdTypes = [...new Set(holds.map(h => h.holdType).filter(Boolean))];

  // Get statistics
  const activeHolds = holds.filter(h => !h.inactiveDate).length;
  const postableHolds = holds.filter(h => h.postableFlag).length;
  const userReleaseableHolds = holds.filter(h => h.userReleaseableFlag).length;

  // Table columns - using camelCase field names
  const columns = [
    {
      title: 'Hold Name',
      dataIndex: 'holdName',
      key: 'holdName',
      width: 180,
      sorter: (a: InvoiceHold, b: InvoiceHold) => (a.holdName || '').localeCompare(b.holdName || ''),
      render: (name: string, record: InvoiceHold) => (
        <Space size={4}>
          <Text strong style={{ fontSize: 11 }}>{name}</Text>
          {!record.inactiveDate && <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 10 }} />}
        </Space>
      ),
    },
    {
      title: 'Hold Type',
      dataIndex: 'holdType',
      key: 'holdType',
      width: 180,
      filters: holdTypes.map(t => ({ text: t, value: t })),
      onFilter: (value: React.Key | boolean, record: InvoiceHold) => record.holdType === value,
      render: (type: string) => type ? <Tag style={{ fontSize: 9 }}>{type}</Tag> : '-',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: 300,
      ellipsis: true,
      render: (desc: string) => <Text style={{ fontSize: 10 }}>{desc || '-'}</Text>,
    },
    {
      title: 'Postable',
      dataIndex: 'postableFlag',
      key: 'postableFlag',
      width: 80,
      filters: [
        { text: 'Yes', value: true },
        { text: 'No', value: false },
      ],
      onFilter: (value: React.Key | boolean, record: InvoiceHold) => record.postableFlag === value,
      render: (flag: boolean) => (
        flag ? <CheckCircleOutlined style={{ color: REDWOOD.success }} /> : <CloseCircleOutlined style={{ color: REDWOOD.textSecondary }} />
      ),
    },
    {
      title: 'User Releaseable',
      dataIndex: 'userReleaseableFlag',
      key: 'userReleaseableFlag',
      width: 120,
      filters: [
        { text: 'Yes', value: true },
        { text: 'No', value: false },
      ],
      onFilter: (value: React.Key | boolean, record: InvoiceHold) => record.userReleaseableFlag === value,
      render: (flag: boolean) => (
        flag ? <CheckCircleOutlined style={{ color: REDWOOD.success }} /> : <CloseCircleOutlined style={{ color: REDWOOD.textSecondary }} />
      ),
    },
    {
      title: 'User Updateable',
      dataIndex: 'userUpdateableFlag',
      key: 'userUpdateableFlag',
      width: 120,
      render: (flag: boolean) => (
        flag ? <CheckCircleOutlined style={{ color: REDWOOD.success }} /> : <CloseCircleOutlined style={{ color: REDWOOD.textSecondary }} />
      ),
    },
    {
      title: 'Active',
      dataIndex: 'inactiveDate',
      key: 'active',
      width: 70,
      filters: [
        { text: 'Yes', value: 'active' },
        { text: 'No', value: 'inactive' },
      ],
      onFilter: (value: React.Key | boolean, record: InvoiceHold) => {
        if (value === 'active') return !record.inactiveDate;
        return !!record.inactiveDate;
      },
      render: (inactiveDate: string | null) => (
        !inactiveDate ? (
          <Tag color="green" style={{ fontSize: 10 }}>Yes</Tag>
        ) : (
          <Tag color="default" style={{ fontSize: 10 }}>No</Tag>
        )
      ),
    },
    {
      title: 'Hold Instruction',
      dataIndex: 'holdInstruction',
      key: 'holdInstruction',
      width: 200,
      ellipsis: true,
      render: (instruction: string) => <Text style={{ fontSize: 10 }}>{instruction || '-'}</Text>,
    },
  ];

  return (
    <Layout style={{ height: 'calc(100vh - 64px)', background: REDWOOD.surfaceSecondary, overflow: 'hidden' }}>
      <Content style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          padding: '8px 16px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.border}`,
          flexShrink: 0,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/ap">Payables</Link> },
              { title: 'Invoice Holds' },
            ]}
          />
        </div>

        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Title and Controls */}
          <Row justify="space-between" align="middle" style={{ marginBottom: 12, flexShrink: 0 }}>
            <Col>
              <Space align="center">
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: REDWOOD.primaryDark,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <StopOutlined style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div>
                  <Title level={4} style={{ margin: 0, color: REDWOOD.textPrimary }}>
                    Invoice Holds
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>View and manage invoice hold codes</Text>
                </div>
              </Space>
            </Col>
            <Col>
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchAllHolds}
                loading={loading}
                size="small"
              >
                Refresh
              </Button>
            </Col>
          </Row>

          {/* Statistics Cards */}
          <Row gutter={12} style={{ marginBottom: 12, flexShrink: 0 }}>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Total Holds</Text>}
                  value={holds.length}
                  prefix={<StopOutlined style={{ color: REDWOOD.info }} />}
                  valueStyle={{ fontSize: 20, color: REDWOOD.info }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Active Holds</Text>}
                  value={activeHolds}
                  prefix={<CheckCircleOutlined style={{ color: REDWOOD.success }} />}
                  valueStyle={{ fontSize: 20, color: REDWOOD.success }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>User Releaseable</Text>}
                  value={userReleaseableHolds}
                  prefix={<ExclamationCircleOutlined style={{ color: REDWOOD.warning }} />}
                  valueStyle={{ fontSize: 20, color: REDWOOD.warning }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 6 }} bodyStyle={{ padding: '12px 16px' }}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Postable</Text>}
                  value={postableHolds}
                  prefix={<CheckCircleOutlined style={{ color: REDWOOD.primary }} />}
                  valueStyle={{ fontSize: 20, color: REDWOOD.primary }}
                />
              </Card>
            </Col>
          </Row>

          {/* Fetch Progress */}
          {fetchProgress.fetching && (
            <Card size="small" style={{ marginBottom: 12, borderRadius: 6 }} bodyStyle={{ padding: '8px 16px' }}>
              <Space style={{ width: '100%' }}>
                <Spin size="small" />
                <Text style={{ fontSize: 12 }}>
                  Fetching invoice holds... {fetchProgress.current} records loaded
                </Text>
                {fetchProgress.total > 0 && (
                  <Progress
                    percent={Math.round((fetchProgress.current / fetchProgress.total) * 100)}
                    size="small"
                    style={{ width: 150 }}
                  />
                )}
              </Space>
            </Card>
          )}

          {/* Error Alert */}
          {error && (
            <Alert
              message="Error Loading Invoice Holds"
              description={error}
              type="error"
              showIcon
              closable
              onClose={() => setError('')}
              style={{ marginBottom: 12, borderRadius: 6 }}
            />
          )}

          {/* Invoice Holds Table */}
          <Card
            style={{
              flex: 1,
              borderRadius: 6,
              border: `1px solid ${REDWOOD.border}`,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            bodyStyle={{ padding: 0, flex: 1, overflow: 'hidden' }}
          >
            <Spin spinning={loading && holds.length === 0} tip="Loading invoice holds...">
              <Table
                dataSource={holds}
                columns={columns}
                rowKey="holdName"
                size="small"
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  pageSizeOptions: ['20', '50', '100', '200'],
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} holds`,
                  size: 'small',
                }}
                scroll={{ y: 'calc(100vh - 400px)' }}
              />
            </Spin>
          </Card>
        </div>
      </Content>

      {/* Autopilot Assistant */}
      
      <FloatingMenu />
    </Layout>
  );
};

export default InvoiceHolds;
