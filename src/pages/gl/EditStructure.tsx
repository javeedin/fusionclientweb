import React, { useState, useEffect } from 'react';
import {
  Layout,
  Typography,
  Card,
  Form,
  Input,
  Select,
  Checkbox,
  Button,
  Table,
  Space,
  message,
  Spin,
} from 'antd';
import {
  SaveOutlined,
  CloseOutlined,
  CheckOutlined,
  PlusOutlined,
  EditOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
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

// Interface for Segment data from API
interface SegmentItem {
  key_flex_filed_name_code: string;
  structure_code: string;
  sequence_no: number;
  segment_name: string;
  segment_code: string;
  column_name: string;
  prompt: string;
  enabled: string;
}

// Interface for Structure header
interface StructureHeader {
  structureCode: string;
  name: string;
  description: string;
  delimiter: string;
  enabled: boolean;
}

const EditStructure: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<SegmentItem | null>(null);
  const [headerData] = useState<StructureHeader>({
    structureCode: 'BUIMERC_FIN_GLB_COA',
    name: 'BUIMERC Global Chart of Accounts',
    description: 'BUIMERC Global Chart of Accounts',
    delimiter: '-',
    enabled: true,
  });

  // Fetch data on load
  useEffect(() => {
    fetchStructureData();
  }, [id]);

  const fetchStructureData = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${APEX_DB_CONFIG.baseUrl}/chartofaccounts/structuresegments`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setSegments(result.items || []);

      // Set form values
      form.setFieldsValue({
        name: headerData.name,
        description: headerData.description,
        delimiter: headerData.delimiter,
        enabled: headerData.enabled,
      });
    } catch (error) {
      console.error('Error fetching structure data:', error);
      message.error('Failed to fetch structure data');
    } finally {
      setLoading(false);
    }
  };

  // Handle save
  const handleSave = () => {
    message.success('Changes saved successfully');
  };

  // Handle save and close
  const handleSaveAndClose = () => {
    message.success('Changes saved successfully');
    navigate('/gl/manage-structures');
  };

  // Handle cancel
  const handleCancel = () => {
    navigate('/gl/manage-structures');
  };

  // Table columns
  const columns = [
    {
      title: 'Sequence Number',
      dataIndex: 'sequence_no',
      key: 'sequence_no',
      width: 120,
      align: 'center' as const,
    },
    {
      title: 'Name',
      dataIndex: 'segment_name',
      key: 'segment_name',
      width: 150,
    },
    {
      title: 'Segment Code',
      dataIndex: 'segment_code',
      key: 'segment_code',
      width: 280,
    },
    {
      title: 'Column Name',
      dataIndex: 'column_name',
      key: 'column_name',
      width: 150,
    },
    {
      title: 'Prompt',
      dataIndex: 'prompt',
      key: 'prompt',
      width: 150,
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      align: 'center' as const,
      render: (enabled: string) =>
        enabled === 'YES' ? <CheckOutlined style={{ color: REDWOOD.success }} /> : null,
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
              Edit Key Flexfield Structure: {headerData.structureCode}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Key Flexfield Code: GL#
            </Text>
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
                <Text type="secondary">Structure Code</Text>
                <Text strong style={{ marginLeft: 16 }}>{headerData.structureCode}</Text>
              </div>

              <Form form={form} layout="vertical">
                <Form.Item
                  name="name"
                  label={<><span style={{ color: REDWOOD.primary }}>*</span> Name</>}
                  style={{ marginBottom: 16, maxWidth: 450 }}
                >
                  <Input />
                </Form.Item>

                <Form.Item
                  name="description"
                  label="Description"
                  style={{ marginBottom: 16, maxWidth: 450 }}
                >
                  <Input />
                </Form.Item>

                <Form.Item
                  name="delimiter"
                  label={<><span style={{ color: REDWOOD.primary }}>*</span> Delimiter</>}
                  style={{ marginBottom: 16, maxWidth: 100 }}
                >
                  <Select
                    options={[
                      { label: '-', value: '-' },
                      { label: '.', value: '.' },
                      { label: '|', value: '|' },
                    ]}
                  />
                </Form.Item>

                <Form.Item
                  name="enabled"
                  valuePropName="checked"
                  style={{ marginBottom: 0 }}
                >
                  <Checkbox>Enabled</Checkbox>
                </Form.Item>
              </Form>
            </Card>

            {/* Segments Card */}
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
                  Segments
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
                  <Button size="small" type="text" icon={<PlusOutlined />} />
                  <Button size="small" type="text" icon={<EditOutlined />} />
                </Space>
                <div style={{ borderLeft: `1px solid ${REDWOOD.neutral300}`, height: 20 }} />
                <Space size="small">
                  <Button size="small" type="text">Freeze</Button>
                  <Button size="small" type="text">Detach</Button>
                  <Button size="small" type="text">Wrap</Button>
                </Space>
                <div style={{ flex: 1 }} />
                <Button
                  icon={<UnorderedListOutlined />}
                  size="small"
                  onClick={() => {
                    if (selectedSegment) {
                      navigate(`/gl/values/${selectedSegment.segment_code}`, {
                        state: { segmentName: selectedSegment.segment_name }
                      });
                    } else {
                      message.warning('Please select a segment first');
                    }
                  }}
                >
                  Manage Values
                </Button>
              </div>

              {/* Table */}
              <Table
                columns={columns}
                dataSource={segments}
                rowKey="segment_code"
                loading={loading}
                pagination={false}
                size="small"
                scroll={{ x: 1000 }}
                className="compact-table"
                rowSelection={{
                  type: 'radio',
                  columnWidth: 40,
                  onChange: (_: React.Key[], selectedRows: SegmentItem[]) => {
                    setSelectedSegment(selectedRows[0] || null);
                  },
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

export default EditStructure;
