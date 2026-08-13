import React, { useState, useEffect } from 'react';
import {
  Layout,
  Typography,
  Card,
  Breadcrumb,
  Form,
  Input,
  Select,
  Button,
  Table,
  Space,
  Tag,
  message,
  Tooltip,
} from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  SettingOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
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

// Interface for Chart of Accounts data
interface ChartOfAccountsItem {
  name: string;
  description: string;
  structureinstanceid: string;
  structureinstancenumber: string;
  structureinstancecode: string;
  enabledflag: string;
}

const ChartOfAccounts: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ChartOfAccountsItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ChartOfAccountsItem | null>(null);

  // Auto-fetch data on component mount
  useEffect(() => {
    fetchChartOfAccounts();
  }, []);

  // Fetch chart of accounts data
  const fetchChartOfAccounts = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${APEX_DB_CONFIG.baseUrl}/chartofaccounts/getall`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setData(result.items || []);
      setSearched(true);
      message.success(`Found ${result.items?.length || 0} records`);
    } catch (error) {
      console.error('Error fetching chart of accounts:', error);
      message.error('Failed to fetch chart of accounts data');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle search
  const handleSearch = () => {
    fetchChartOfAccounts();
  };

  // Handle reset
  const handleReset = () => {
    form.resetFields();
    setData([]);
    setSearched(false);
  };

  // Table columns
  const columns = [
    {
      title: 'Application',
      dataIndex: 'application',
      key: 'application',
      width: 150,
      render: () => 'General Ledger',
    },
    {
      title: 'Key Flexfield Name',
      dataIndex: 'name',
      key: 'name',
      width: 250,
      sorter: (a: ChartOfAccountsItem, b: ChartOfAccountsItem) =>
        a.name.localeCompare(b.name),
    },
    {
      title: 'Key Flexfield Code',
      dataIndex: 'structureinstancecode',
      key: 'structureinstancecode',
      width: 120,
      render: () => 'GL#',
    },
    {
      title: 'Module',
      dataIndex: 'module',
      key: 'module',
      width: 150,
      render: () => 'General Ledger',
    },
    {
      title: 'Entity Usages',
      dataIndex: 'entityUsages',
      key: 'entityUsages',
      width: 120,
      align: 'center' as const,
      render: () => (
        <Tooltip title="View Entity Usages">
          <Button type="link" icon={<FileTextOutlined />} size="small" />
        </Tooltip>
      ),
    },
    {
      title: 'Deployment Status',
      dataIndex: 'enabledflag',
      key: 'deploymentStatus',
      width: 150,
      align: 'center' as const,
      render: (enabled: string) => (
        <Tag
          icon={<CheckCircleOutlined />}
          color={enabled === 'true' ? 'success' : 'default'}
        >
          {enabled === 'true' ? 'Deployed' : 'Not Deployed'}
        </Tag>
      ),
    },
    {
      title: 'Deployment Error Message',
      dataIndex: 'deploymentError',
      key: 'deploymentError',
      width: 180,
      align: 'center' as const,
      render: () => (
        <Tooltip title="View Error Details">
          <Button type="link" icon={<FileTextOutlined />} size="small" />
        </Tooltip>
      ),
    },
    {
      title: 'Deployment Date',
      dataIndex: 'deploymentDate',
      key: 'deploymentDate',
      width: 130,
      render: () => '15-Nov-2024',
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div
          style={{
            padding: '16px 24px',
            background: REDWOOD.surface,
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
          }}
        >
          <Breadcrumb
            items={[
              {
                title: (
                  <Link to="/home">
                    <HomeOutlined /> Home
                  </Link>
                ),
              },
              {
                title: <Link to="/gl">General Ledger</Link>,
              },
              { title: 'Chart of Accounts' },
            ]}
          />
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
          {/* Page Title */}
          <div style={{ marginBottom: 24 }}>
            <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>
              Manage Chart of Accounts Structure
            </Title>
          </div>

          {/* Search Card */}
          <Card
            style={{
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
              marginBottom: 24,
            }}
            bodyStyle={{ padding: 20 }}
          >
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900 }}>
                Search
              </Text>
            </div>

            <Form form={form} layout="vertical">
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <Form.Item
                  name="keyFlexfieldCode"
                  label="Key Flexfield Code"
                  style={{ marginBottom: 16, minWidth: 150 }}
                >
                  <Input placeholder="" style={{ width: 150 }} />
                </Form.Item>

                <Form.Item
                  name="keyFlexfieldName"
                  label="Key Flexfield Name"
                  style={{ marginBottom: 16, minWidth: 300 }}
                >
                  <Input placeholder="" style={{ width: 300 }} />
                </Form.Item>

                <Form.Item
                  name="module"
                  label="Module"
                  style={{ marginBottom: 16, minWidth: 250 }}
                >
                  <Select
                    placeholder="Select module"
                    allowClear
                    style={{ width: 250 }}
                    options={[
                      { label: 'General Ledger', value: 'GL' },
                      { label: 'Accounts Payable', value: 'AP' },
                      { label: 'Accounts Receivable', value: 'AR' },
                      { label: 'Fixed Assets', value: 'FA' },
                    ]}
                  />
                </Form.Item>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={handleReset} icon={<ReloadOutlined />}>
                  Reset
                </Button>
                <Button
                  type="primary"
                  onClick={handleSearch}
                  loading={loading}
                  icon={<SearchOutlined />}
                  style={{ background: REDWOOD.info }}
                >
                  Search
                </Button>
              </div>
            </Form>
          </Card>

          {/* Results Card */}
          <Card
            style={{
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
            }}
            bodyStyle={{ padding: 0 }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900 }}>
                Search Results
              </Text>
            </div>

            {/* Action Toolbar */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
                background: REDWOOD.neutral100,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Actions
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  View
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Format
                </Text>
              </Space>
              <div style={{ flex: 1 }} />
              <Space>
                <Button
                  icon={<SettingOutlined />}
                  size="small"
                  onClick={() => navigate('/gl/manage-structures')}
                >
                  Manage Structures
                </Button>
                <Button
                  icon={<FileTextOutlined />}
                  size="small"
                  onClick={() => {
                    if (selectedRecord) {
                      navigate(`/gl/chart-of-accounts/${selectedRecord.structureinstanceid}/edit`);
                    } else {
                      message.warning('Please select a record first');
                    }
                  }}
                >
                  Manage Structure Instances
                </Button>
                <Button
                  icon={<DeploymentUnitOutlined />}
                  size="small"
                  type="primary"
                  style={{ background: REDWOOD.info }}
                >
                  Deploy Flexfield
                </Button>
              </Space>
            </div>

            {/* Table */}
            <Table
              columns={columns}
              dataSource={data}
              rowKey="structureinstanceid"
              loading={loading}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showTotal: (total, range) =>
                  `${range[0]}-${range[1]} of ${total} items`,
              }}
              scroll={{ x: 1200 }}
              locale={{
                emptyText: searched
                  ? 'No results found'
                  : 'Click Search to load data',
              }}
              rowSelection={{
                type: 'radio',
                columnWidth: 40,
                onChange: (_: React.Key[], selectedRows: ChartOfAccountsItem[]) => {
                  setSelectedRecord(selectedRows[0] || null);
                },
              }}
              onRow={(record) => ({
                style: { cursor: 'pointer' },
                onClick: () => setSelectedRecord(record),
              })}
              style={{
                borderRadius: 0,
              }}
            />
          </Card>
        </div>
      </Content>

      {/* Autopilot Assistant */}
      
    </Layout>
  );
};

export default ChartOfAccounts;
