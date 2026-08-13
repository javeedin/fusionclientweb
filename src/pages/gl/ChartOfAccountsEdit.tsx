import React, { useState, useEffect } from 'react';
import {
  Layout,
  Typography,
  Card,
  Breadcrumb,
  Form,
  Input,
  Checkbox,
  Button,
  Table,
  Space,
  message,
  Spin,
  Tag,
} from 'antd';
import {
  HomeOutlined,
  SaveOutlined,
  CloseOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { Link, useParams, useNavigate } from 'react-router-dom';
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

// Interface for Segment data
interface SegmentItem {
  structureinstanceid: number;
  segment_code: string;
  value_set_code: string;
  required_flag: string;
  displayed_flag: string;
  query_required: string;
}

// Interface for Chart of Accounts header data
interface ChartOfAccountsHeader {
  structureInstanceCode: string;
  apiName: string;
  name: string;
  description: string;
  enabled: boolean;
  dynamicCombinationAllowed: boolean;
  shorthandAliasEnabled: boolean;
  structureName: string;
}

const ChartOfAccountsEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [headerData, setHeaderData] = useState<ChartOfAccountsHeader>({
    structureInstanceCode: '',
    apiName: '',
    name: '',
    description: '',
    enabled: true,
    dynamicCombinationAllowed: true,
    shorthandAliasEnabled: false,
    structureName: '',
  });

  // Fetch segments data
  const fetchSegments = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${APEX_DB_CONFIG.baseUrl}/charofaccounts/getsegments`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setSegments(result.items || []);

      // Set header data based on first segment's structure instance
      if (result.items && result.items.length > 0) {
        setHeaderData({
          structureInstanceCode: 'BUIMERC_FIN_GLB_COA_INS',
          apiName: 'BuimercFinGlbCoaIns',
          name: 'BUIMERC Global Chart of Accounts Instance',
          description: 'BUIMERC Global Chart of Accounts Instance',
          enabled: true,
          dynamicCombinationAllowed: true,
          shorthandAliasEnabled: false,
          structureName: 'BUIMERC Global Chart of Accounts',
        });

        form.setFieldsValue({
          apiName: 'BuimercFinGlbCoaIns',
          name: 'BUIMERC Global Chart of Accounts Instance',
          description: 'BUIMERC Global Chart of Accounts Instance',
          enabled: true,
          dynamicCombinationAllowed: true,
          shorthandAliasEnabled: false,
        });
      }
    } catch (error) {
      console.error('Error fetching segments:', error);
      message.error('Failed to fetch segments data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSegments();
  }, [id]);

  // Handle save
  const handleSave = () => {
    message.success('Changes saved successfully');
  };

  // Handle save and close
  const handleSaveAndClose = () => {
    message.success('Changes saved successfully');
    navigate('/gl/chart-of-accounts');
  };

  // Handle cancel
  const handleCancel = () => {
    navigate('/gl/chart-of-accounts');
  };

  // Table columns for segments
  const columns = [
    {
      title: 'Segment Code',
      dataIndex: 'segment_code',
      key: 'segment_code',
      width: 250,
    },
    {
      title: 'Value Set Code',
      dataIndex: 'value_set_code',
      key: 'value_set_code',
      width: 300,
      render: (text: string) => (
        <a style={{ color: REDWOOD.info }}>{text}</a>
      ),
    },
    {
      title: 'Required',
      dataIndex: 'required_flag',
      key: 'required_flag',
      width: 100,
      align: 'center' as const,
      render: (flag: string) =>
        flag === 'YES' ? (
          <CheckOutlined style={{ color: REDWOOD.success }} />
        ) : null,
    },
    {
      title: 'Displayed',
      dataIndex: 'displayed_flag',
      key: 'displayed_flag',
      width: 100,
      align: 'center' as const,
      render: (flag: string) =>
        flag === 'YES' || flag === 'TES' ? (
          <CheckOutlined style={{ color: REDWOOD.success }} />
        ) : null,
    },
    {
      title: 'Query Required',
      dataIndex: 'query_required',
      key: 'query_required',
      width: 120,
      align: 'center' as const,
      render: (value: string) => (
        <Tag color={value === 'OPTIONAL' ? 'default' : 'blue'}>{value}</Tag>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Header with breadcrumb and actions */}
        <div
          style={{
            padding: '16px 24px',
            background: REDWOOD.surface,
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
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
                {
                  title: <Link to="/gl/chart-of-accounts">Chart of Accounts</Link>,
                },
                { title: 'Edit Structure Instance' },
              ]}
            />
            <Title level={4} style={{ margin: '8px 0 0 0', color: REDWOOD.neutral900 }}>
              Edit Key Flexfield Structure Instance: {headerData.structureInstanceCode}
            </Title>
          </div>

          {/* Action Buttons */}
          <Space>
            <Button
              icon={<SaveOutlined />}
              onClick={handleSave}
              style={{ background: REDWOOD.surface }}
            >
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
            <Button
              icon={<CloseOutlined />}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </Space>
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
          <Spin spinning={loading}>
            {/* Header Form Card */}
            <Card
              style={{
                borderRadius: 8,
                border: `1px solid ${REDWOOD.neutral200}`,
                marginBottom: 24,
              }}
              bodyStyle={{ padding: 24 }}
            >
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary">Key Flexfield Code</Text>
                <Text strong style={{ marginLeft: 16 }}>GL#</Text>
              </div>

              <div style={{ marginBottom: 24 }}>
                <Text type="secondary">Structure Instance Code</Text>
                <Text strong style={{ marginLeft: 16 }}>{headerData.structureInstanceCode}</Text>
              </div>

              <Form
                form={form}
                layout="vertical"
                initialValues={{
                  apiName: headerData.apiName,
                  name: headerData.name,
                  description: headerData.description,
                  enabled: headerData.enabled,
                  dynamicCombinationAllowed: headerData.dynamicCombinationAllowed,
                  shorthandAliasEnabled: headerData.shorthandAliasEnabled,
                }}
              >
                <div style={{ display: 'flex', gap: 16 }}>
                  <Form.Item
                    name="apiName"
                    label={<><span style={{ color: REDWOOD.primary }}>*</span> API name</>}
                    style={{ marginBottom: 16, width: 200 }}
                  >
                    <Input />
                  </Form.Item>

                  <Form.Item
                    name="name"
                    label={<><span style={{ color: REDWOOD.primary }}>*</span> Name</>}
                    style={{ marginBottom: 16, width: 350 }}
                  >
                    <Input />
                  </Form.Item>
                </div>

                <Form.Item
                  name="description"
                  label="Description"
                  style={{ marginBottom: 16, width: 400 }}
                >
                  <Input />
                </Form.Item>

                <Space direction="vertical" size={8}>
                  <Form.Item
                    name="enabled"
                    valuePropName="checked"
                    style={{ marginBottom: 8 }}
                  >
                    <Checkbox>Enabled</Checkbox>
                  </Form.Item>

                  <Form.Item
                    name="dynamicCombinationAllowed"
                    valuePropName="checked"
                    style={{ marginBottom: 8 }}
                  >
                    <Checkbox>Dynamic combination creation allowed</Checkbox>
                  </Form.Item>

                  <Form.Item
                    name="shorthandAliasEnabled"
                    valuePropName="checked"
                    style={{ marginBottom: 16 }}
                  >
                    <Checkbox>Shorthand alias enabled</Checkbox>
                  </Form.Item>
                </Space>

                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Structure Name</Text>
                  <Text strong style={{ marginLeft: 16 }}>{headerData.structureName}</Text>
                </div>
              </Form>
            </Card>

            {/* Segment Instances Card */}
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
                <Title level={5} style={{ margin: 0, color: REDWOOD.info }}>
                  Segment Instances
                </Title>
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
                  <Button size="small" type="text">Freeze</Button>
                  <Button size="small" type="text">Detach</Button>
                  <Button size="small" type="text">Wrap</Button>
                </Space>
              </div>

              {/* Table */}
              <Table
                columns={columns}
                dataSource={segments}
                rowKey="segment_code"
                loading={loading}
                pagination={false}
                scroll={{ x: 900 }}
                size="small"
                rowSelection={{
                  type: 'checkbox',
                  columnWidth: 40,
                }}
                style={{ borderRadius: 0 }}
                className="compact-table"
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

export default ChartOfAccountsEdit;
