import React, { useState, useEffect } from 'react';
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
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  CheckOutlined,
  PlusOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

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

// Interface for Structure data
interface StructureItem {
  id: string;
  name: string;
  structurecode: string;
  enabled: boolean;
}

const ManageStructures: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StructureItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<StructureItem | null>(null);

  // Mock data - will be replaced with API call
  const fetchStructures = async () => {
    setLoading(true);
    try {
      // For now, use mock data
      const mockData: StructureItem[] = [
        {
          id: '1',
          name: 'BUIMERC Global Chart of Accounts',
          structurecode: 'BUIMERC_FIN_GLB_COA',
          enabled: true,
        },
      ];
      setData(mockData);
      setSearched(true);
      message.success(`Found ${mockData.length} records`);
    } catch (error) {
      console.error('Error fetching structures:', error);
      message.error('Failed to fetch structures data');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on load
  useEffect(() => {
    fetchStructures();
  }, []);

  // Handle search
  const handleSearch = () => {
    fetchStructures();
  };

  // Handle reset
  const handleReset = () => {
    form.resetFields();
    setData([]);
    setSearched(false);
  };

  // Handle done
  const handleDone = () => {
    navigate('/gl/chart-of-accounts');
  };

  // Handle edit structure
  const handleEditStructure = () => {
    if (selectedRecord) {
      navigate(`/gl/structures/${selectedRecord.id}/edit`);
    } else {
      message.warning('Please select a structure first');
    }
  };

  // Table columns
  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 350,
      sorter: (a: StructureItem, b: StructureItem) => a.name.localeCompare(b.name),
    },
    {
      title: 'Structure Code',
      dataIndex: 'structurecode',
      key: 'structurecode',
      width: 300,
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      align: 'center' as const,
      render: (enabled: boolean) =>
        enabled ? <CheckOutlined style={{ color: REDWOOD.success }} /> : null,
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
              Manage Key Flexfield Structures
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Key Flexfield Code: GL#
            </Text>
          </div>
          <Button onClick={handleDone}>Done</Button>
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
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
                  name="structureCode"
                  label="Structure Code"
                  style={{ marginBottom: 16, minWidth: 250 }}
                >
                  <Input placeholder="" style={{ width: 250 }} />
                </Form.Item>

                <Form.Item
                  name="name"
                  label="Name"
                  style={{ marginBottom: 16, minWidth: 350 }}
                >
                  <Input placeholder="" style={{ width: 350 }} />
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
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={handleEditStructure}
                />
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
              dataSource={data}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="small"
              className="compact-table"
              rowSelection={{
                type: 'radio',
                columnWidth: 40,
                onChange: (_: React.Key[], selectedRows: StructureItem[]) => {
                  setSelectedRecord(selectedRows[0] || null);
                },
              }}
              onRow={(record) => ({
                style: { cursor: 'pointer' },
                onClick: () => setSelectedRecord(record),
                onDoubleClick: () => navigate(`/gl/structures/${record.id}/edit`),
              })}
              locale={{
                emptyText: searched ? 'No results found' : 'Click Search to load data',
              }}
            />
          </Card>
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

export default ManageStructures;
