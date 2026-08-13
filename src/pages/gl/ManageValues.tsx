import React, { useState } from 'react';
import {
  Layout,
  Typography,
  Card,
  Form,
  Input,
  Button,
  Table,
  Space,
  message,
  Spin,
  Checkbox,
  Select,
} from 'antd';
import {
  SaveOutlined,
  CloseOutlined,
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ORACLE_FUSION_CONFIG, PROXY_CONFIG } from '../../config/api.config';

// Detect if running in Electron
const isElectron = () => {
  return !!(window as any).electron || navigator.userAgent.toLowerCase().includes('electron');
};

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

// Interface for Value Set Value
interface ValueSetValue {
  Value: string;
  Description: string;
  EnabledFlag: string;
  StartDateActive: string;
  EndDateActive: string;
  SortOrder: number;
  SummaryFlag: string;
  AllowPostingFlag: string;
  AllowBudgetingFlag: string;
}

const ManageValues: React.FC = () => {
  const { segmentCode } = useParams<{ segmentCode: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<ValueSetValue[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Get segment name from location state
  const segmentName = location.state?.segmentName || segmentCode;

  // Fetch values from Oracle Fusion (direct in Electron, proxy in browser)
  const fetchValues = async () => {
    setLoading(true);
    const runningInElectron = isElectron();

    try {
      const offset = (currentPage - 1) * pageSize;
      let apiUrl: string;
      let headers: HeadersInit;

      if (runningInElectron) {
        apiUrl = `https://iaaobn.fa.ocs.oraclecloud.com:443/fscmRestApi/resources/11.13.18.05/valueSets/${segmentCode}/child/values?limit=${pageSize}&offset=${offset}`;
        const credentials = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
        headers = {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        };
      } else {
        apiUrl = `${PROXY_CONFIG.baseUrl}/fusion/fscmRestApi/resources/11.13.18.05/valueSets/${segmentCode}/child/values?limit=${pageSize}&offset=${offset}`;
        headers = {
          'Content-Type': 'application/json',
        };
      }

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setValues(result.items || []);
      setTotalCount(result.totalResults || result.count || result.items?.length || 0);

      if (result.items?.length > 0) {
        message.success(`Loaded ${result.items.length} values`);
      } else {
        message.info('No values found for this segment');
      }
    } catch (error) {
      console.error('Error fetching values:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (!runningInElectron) {
        message.error('Failed to fetch. Start proxy: node server/proxy.cjs');
      } else {
        message.error(`Failed to fetch values: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle search
  const handleSearch = () => {
    setCurrentPage(1);
    fetchValues();
  };

  // Handle reset
  const handleReset = () => {
    form.resetFields();
    setCurrentPage(1);
    fetchValues();
  };

  // Handle save
  const handleSave = () => {
    message.success('Changes saved successfully');
  };

  // Handle save and close
  const handleSaveAndClose = () => {
    message.success('Changes saved successfully');
    navigate(-1);
  };

  // Handle cancel
  const handleCancel = () => {
    navigate(-1);
  };

  // Table columns
  const columns = [
    {
      title: <><span style={{ color: REDWOOD.primary }}>*</span> Value</>,
      dataIndex: 'Value',
      key: 'Value',
      width: 100,
      sorter: (a: ValueSetValue, b: ValueSetValue) => a.Value.localeCompare(b.Value),
    },
    {
      title: 'Description',
      dataIndex: 'Description',
      key: 'Description',
      width: 300,
      render: (text: string) => (
        <Input value={text} style={{ width: '100%' }} />
      ),
    },
    {
      title: 'Enabled',
      dataIndex: 'EnabledFlag',
      key: 'EnabledFlag',
      width: 80,
      align: 'center' as const,
      render: (flag: string) => (
        <Checkbox checked={flag === 'Y' || flag === 'true'} />
      ),
    },
    {
      title: 'Start Date',
      dataIndex: 'StartDateActive',
      key: 'StartDateActive',
      width: 120,
      render: (date: string) => date || '',
    },
    {
      title: 'End Date',
      dataIndex: 'EndDateActive',
      key: 'EndDateActive',
      width: 120,
      render: (date: string) => date || 'dd-mmm-yyy',
    },
    {
      title: 'Sort Order',
      dataIndex: 'SortOrder',
      key: 'SortOrder',
      width: 100,
      render: (value: number) => value || '',
    },
    {
      title: <><span style={{ color: REDWOOD.primary }}>*</span> Summary</>,
      dataIndex: 'SummaryFlag',
      key: 'SummaryFlag',
      width: 100,
      render: (flag: string) => (
        <Select
          value={flag === 'Y' ? 'Yes' : 'No'}
          style={{ width: 80 }}
          options={[
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
          ]}
        />
      ),
    },
    {
      title: <><span style={{ color: REDWOOD.primary }}>*</span> Allow Posting</>,
      dataIndex: 'AllowPostingFlag',
      key: 'AllowPostingFlag',
      width: 120,
      render: (flag: string) => (
        <Select
          value={flag === 'Y' ? 'Yes' : 'No'}
          style={{ width: 80 }}
          options={[
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
          ]}
        />
      ),
    },
    {
      title: <><span style={{ color: REDWOOD.primary }}>*</span> Allow Budgeting</>,
      dataIndex: 'AllowBudgetingFlag',
      key: 'AllowBudgetingFlag',
      width: 120,
      render: (flag: string) => (
        <Select
          value={flag === 'Y' ? 'Yes' : 'No'}
          style={{ width: 80 }}
          options={[
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
          ]}
        />
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            background: REDWOOD.surface,
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>
              Manage Values
            </Title>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">Value Set Code</Text>
              <Text strong style={{ marginLeft: 16 }}>{segmentCode}</Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary">Description</Text>
              <Text strong style={{ marginLeft: 16 }}>{segmentName}</Text>
            </div>
          </div>
          <Space>
            <Button icon={<SaveOutlined />} onClick={handleSave}>
              Save
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveAndClose}
              style={{ background: REDWOOD.info }}
            >
              Save and Close
            </Button>
            <Button icon={<CloseOutlined />} onClick={handleCancel}>
              Cancel
            </Button>
          </Space>
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
          <Spin spinning={loading}>
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
                <div style={{ display: 'flex', gap: 16 }}>
                  <Form.Item
                    name="value"
                    label="Value"
                    style={{ marginBottom: 16, width: 200 }}
                  >
                    <Input />
                  </Form.Item>

                  <Form.Item
                    name="description"
                    label="Description"
                    style={{ marginBottom: 16, width: 350 }}
                  >
                    <Input />
                  </Form.Item>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button onClick={handleReset} icon={<ReloadOutlined />}>
                    Reset
                  </Button>
                  <Button
                    type="primary"
                    onClick={handleSearch}
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
                }}
              >
                <Text strong style={{ fontSize: 14, color: REDWOOD.info }}>
                  Search Results
                </Text>
              </div>

              {/* Toolbar */}
              <div
                style={{
                  padding: '12px 20px',
                  borderBottom: `1px solid ${REDWOOD.neutral200}`,
                  background: REDWOOD.neutral100,
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <Space size="middle">
                  <Text type="secondary" style={{ fontSize: 12 }}>Actions</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>View</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>Format</Text>
                </Space>
                <div style={{ borderLeft: `1px solid ${REDWOOD.neutral300}`, height: 20 }} />
                <Space size="small">
                  <Button size="small" type="text" icon={<PlusOutlined />} />
                  <Button size="small" type="text" icon={<DeleteOutlined />} />
                </Space>
                <div style={{ borderLeft: `1px solid ${REDWOOD.neutral300}`, height: 20 }} />
                <Space size="small">
                  <Button size="small" type="text">Freeze</Button>
                  <Button size="small" type="text">Detach</Button>
                  <Button size="small" type="text">Wrap</Button>
                </Space>
              </div>

              {/* Table */}
              <Table
                columns={columns}
                dataSource={values}
                rowKey="Value"
                loading={loading}
                size="small"
                scroll={{ x: 1200 }}
                className="compact-table"
                pagination={{
                  current: currentPage,
                  pageSize: pageSize,
                  total: totalCount,
                  showSizeChanger: true,
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
                  onChange: (page, size) => {
                    setCurrentPage(page);
                    setPageSize(size);
                  },
                }}
                rowSelection={{
                  type: 'checkbox',
                  columnWidth: 40,
                }}
              />
            </Card>
          </Spin>
        </div>
      </Content>

      {/* Autopilot Assistant */}
      

      {/* Compact table styles */}
      <style>{`
        .compact-table .ant-table-tbody > tr > td {
          padding: 8px 12px !important;
        }
        .compact-table .ant-table-thead > tr > th {
          padding: 10px 12px !important;
        }
      `}</style>
    </Layout>
  );
};

export default ManageValues;
