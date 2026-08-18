import React, { useState, useEffect } from 'react';
import {
  Layout, Card, Button, Form, Input, Select, Radio, Tabs, Table, Space, Modal, message,
  Row, Col, Typography, Breadcrumb, Tag, Divider, Spin, Tooltip, Drawer, Collapse,
  InputNumber, Checkbox, Descriptions
} from 'antd';
import {
  HomeOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined,
  TestOutlined, ExportOutlined, SettingOutlined
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { mcpServerService } from '../../services/mcp-server.service';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  type: 'SOAP' | 'REST';
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  config: SOAPConfig | RESTConfig;
  url?: string;
}

interface SOAPConfig {
  fusionUrl: string;
  bipReportName: string;
  username: string;
  password: string;
  parameters: Record<string, string>;
  timeout?: number;
}

interface RESTConfig {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  authType: 'none' | 'basic' | 'bearer' | 'apiKey';
  authUsername?: string;
  authPassword?: string;
  bearerToken?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  headers?: Record<string, string>;
  payloadTemplate?: string;
  timeout?: number;
}

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

const MCPServerManager: React.FC = () => {
  const navigate = useNavigate();
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [serverType, setServerType] = useState<'SOAP' | 'REST'>('REST');
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [serverToTest, setServerToTest] = useState<string | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    setLoading(true);
    try {
      const data = await mcpServerService.listServers();
      setServers(data);
    } catch (error) {
      message.error('Failed to load MCP servers');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setEditingServer(null);
    form.resetFields();
    setServerType('REST');
    setDrawerVisible(true);
  };

  const handleEdit = (server: MCPServerConfig) => {
    setEditingServer(server);
    setServerType(server.type);
    form.setFieldsValue(server.config);
    form.setFieldValue('name', server.name);
    form.setFieldValue('description', server.description);
    setDrawerVisible(true);
  };

  const handleSave = async (values: any) => {
    try {
      setLoading(true);
      const payload = {
        name: values.name,
        description: values.description,
        type: serverType,
        config: extractConfigFromForm(values, serverType),
      };

      if (editingServer) {
        await mcpServerService.updateServer(editingServer.id, payload);
        message.success('MCP Server updated successfully');
      } else {
        await mcpServerService.createServer(payload);
        message.success('MCP Server created successfully');
      }

      setDrawerVisible(false);
      form.resetFields();
      loadServers();
    } catch (error) {
      message.error('Failed to save MCP Server');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const extractConfigFromForm = (values: any, type: 'SOAP' | 'REST'): SOAPConfig | RESTConfig => {
    if (type === 'SOAP') {
      return {
        fusionUrl: values.fusionUrl,
        bipReportName: values.bipReportName,
        username: values.username,
        password: values.password,
        parameters: values.parameters || {},
        timeout: values.timeout || 30000,
      };
    } else {
      return {
        endpoint: values.endpoint,
        method: values.method || 'GET',
        authType: values.authType || 'none',
        authUsername: values.authUsername,
        authPassword: values.authPassword,
        bearerToken: values.bearerToken,
        apiKey: values.apiKey,
        apiKeyHeader: values.apiKeyHeader || 'X-API-Key',
        headers: values.headers || {},
        payloadTemplate: values.payloadTemplate,
        timeout: values.timeout || 30000,
      };
    }
  };

  const handleDelete = (serverId: string) => {
    Modal.confirm({
      title: 'Delete MCP Server',
      content: 'Are you sure you want to delete this MCP server? This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          setLoading(true);
          await mcpServerService.deleteServer(serverId);
          message.success('MCP Server deleted successfully');
          loadServers();
        } catch (error) {
          message.error('Failed to delete MCP Server');
          console.error(error);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleTestServer = async (serverId: string) => {
    setServerToTest(serverId);
    setTestLoading(true);
    try {
      const result = await mcpServerService.testServer(serverId);
      setTestResult(result);
      message.success('Test completed');
    } catch (error) {
      message.error('Server test failed');
      setTestResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setTestLoading(false);
      setServerToTest(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('Copied to clipboard');
  };

  const columns = [
    {
      title: 'Server Name',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (text: string, record: MCPServerConfig) => (
        <div>
          <Text strong>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.description}
          </Text>
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: ['config', 'type'],
      key: 'type',
      width: 80,
      render: (type: string) => (
        <Tag color={type === 'SOAP' ? 'blue' : 'green'}>{type}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : 'default'}>
          {status.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_: any, record: MCPServerConfig) => (
        <Space size="small" wrap>
          <Tooltip title="View MCP URL">
            <Button
              type="primary"
              size="small"
              icon={<ExportOutlined />}
              onClick={() => showServerUrl(record)}
            >
              URL
            </Button>
          </Tooltip>
          <Button
            size="small"
            icon={<TestOutlined />}
            onClick={() => handleTestServer(record.id)}
            loading={serverToTest === record.id && testLoading}
          >
            Test
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            Edit
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ];

  const showServerUrl = (server: MCPServerConfig) => {
    const mcpUrl = `http://localhost:3000/mcp/${server.id}`;
    const claudeConfig = {
      mcpServers: {
        [server.name.toLowerCase().replace(/\s+/g, '-')]: {
          command: 'node',
          args: ['path/to/mcp-server-wrapper.js', server.id],
          env: {
            MCP_SERVER_URL: mcpUrl,
            MCP_SERVER_ID: server.id,
          },
        },
      },
    };

    Modal.info({
      title: `MCP Server Configuration - ${server.name}`,
      width: 800,
      content: (
        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <Collapse
            items={[
              {
                key: '1',
                label: 'Local Setup (Electron)',
                children: (
                  <div>
                    <Paragraph>
                      <Text strong>Server URL:</Text>
                    </Paragraph>
                    <Card
                      style={{ background: '#f5f5f5', marginBottom: 16 }}
                      bodyStyle={{ padding: 12 }}
                    >
                      <Text code copyable>{mcpUrl}</Text>
                    </Card>

                    <Paragraph>
                      <Text strong>Step 1: Claude Desktop Config (~/claude_desktop_config.json)</Text>
                    </Paragraph>
                    <Card
                      style={{ background: '#f5f5f5', marginBottom: 16 }}
                      bodyStyle={{ padding: 12 }}
                    >
                      <pre style={{ margin: 0, fontSize: 12 }}>
                        {JSON.stringify(claudeConfig, null, 2)}
                      </pre>
                    </Card>

                    <Button
                      type="primary"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(JSON.stringify(claudeConfig, null, 2))}
                      style={{ marginBottom: 16 }}
                    >
                      Copy JSON Config
                    </Button>
                  </div>
                ),
              },
              {
                key: '2',
                label: 'Cloud/Remote Setup',
                children: (
                  <div>
                    <Paragraph>
                      <Text strong>Public MCP URL:</Text>
                    </Paragraph>
                    <Card
                      style={{ background: '#f5f5f5', marginBottom: 16 }}
                      bodyStyle={{ padding: 12 }}
                    >
                      <Text code copyable>https://your-domain.com/mcp/{server.id}</Text>
                    </Card>

                    <Alert
                      type="info"
                      message="Deploy this server configuration to a public cloud endpoint to use with remote Claude instances"
                      style={{ marginBottom: 16 }}
                    />
                  </div>
                ),
              },
            ]}
          />
        </div>
      ),
    });
  };

  const drawerContent = (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSave}
      autoComplete="off"
    >
      <Form.Item
        name="name"
        label="Server Name"
        rules={[{ required: true, message: 'Server name is required' }]}
      >
        <Input placeholder="e.g., Price List BIP Report" />
      </Form.Item>

      <Form.Item
        name="description"
        label="Description"
      >
        <Input.TextArea
          placeholder="Describe what this MCP server does"
          rows={3}
        />
      </Form.Item>

      <Divider />

      <Form.Item label="Server Type">
        <Radio.Group
          value={serverType}
          onChange={(e) => {
            setServerType(e.target.value);
            form.resetFields();
          }}
        >
          <Radio value="REST">REST API</Radio>
          <Radio value="SOAP">SOAP / Oracle Fusion</Radio>
        </Radio.Group>
      </Form.Item>

      {serverType === 'REST' ? (
        <>
          <Form.Item
            name="endpoint"
            label="API Endpoint URL"
            rules={[{ required: true, message: 'Endpoint is required' }]}
          >
            <Input placeholder="https://api.example.com/reports/price-list" />
          </Form.Item>

          <Form.Item
            name="method"
            label="HTTP Method"
            initialValue="GET"
          >
            <Select>
              <Select.Option value="GET">GET</Select.Option>
              <Select.Option value="POST">POST</Select.Option>
              <Select.Option value="PUT">PUT</Select.Option>
              <Select.Option value="DELETE">DELETE</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="authType"
            label="Authentication Type"
            initialValue="none"
          >
            <Select>
              <Select.Option value="none">None</Select.Option>
              <Select.Option value="basic">Basic Auth</Select.Option>
              <Select.Option value="bearer">Bearer Token</Select.Option>
              <Select.Option value="apiKey">API Key</Select.Option>
            </Select>
          </Form.Item>

          {form.getFieldValue('authType') === 'basic' && (
            <>
              <Form.Item
                name="authUsername"
                label="Username"
              >
                <Input type="text" />
              </Form.Item>
              <Form.Item
                name="authPassword"
                label="Password"
              >
                <Input.Password />
              </Form.Item>
            </>
          )}

          {form.getFieldValue('authType') === 'bearer' && (
            <Form.Item
              name="bearerToken"
              label="Bearer Token"
            >
              <Input.Password placeholder="your-bearer-token" />
            </Form.Item>
          )}

          {form.getFieldValue('authType') === 'apiKey' && (
            <>
              <Form.Item
                name="apiKey"
                label="API Key"
              >
                <Input.Password />
              </Form.Item>
              <Form.Item
                name="apiKeyHeader"
                label="API Key Header Name"
                initialValue="X-API-Key"
              >
                <Input />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="payloadTemplate"
            label="Request Payload Template (JSON)"
          >
            <Input.TextArea
              placeholder={'{"param1": "value1", "param2": "value2"}'}
              rows={4}
            />
          </Form.Item>

          <Form.Item
            name="timeout"
            label="Timeout (ms)"
            initialValue={30000}
          >
            <InputNumber min={1000} step={1000} />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item
            name="fusionUrl"
            label="Oracle Fusion Instance URL"
            rules={[{ required: true, message: 'Fusion URL is required' }]}
          >
            <Input placeholder="https://efmh-test.fa.em3.oraclecloud.com" />
          </Form.Item>

          <Form.Item
            name="bipReportName"
            label="BIP Report Name"
            rules={[{ required: true, message: 'BIP Report name is required' }]}
          >
            <Input placeholder="e.g., XXBUIMERC_PRICE_LIST_REPORT" />
          </Form.Item>

          <Form.Item
            name="username"
            label="Fusion Username"
            rules={[{ required: true, message: 'Username is required' }]}
          >
            <Input type="text" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Fusion Password"
            rules={[{ required: true, message: 'Password is required' }]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="timeout"
            label="Timeout (ms)"
            initialValue={30000}
          >
            <InputNumber min={1000} step={1000} />
          </Form.Item>

          <Text type="secondary" style={{ fontSize: 12 }}>
            Note: BIP Report parameters can be added and managed in the test configuration.
          </Text>
        </>
      )}

      <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            {editingServer ? 'Update Server' : 'Create Server'}
          </Button>
          <Button onClick={() => setDrawerVisible(false)}>
            Cancel
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div style={{
          padding: '16px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/admin">Administration</Link> },
              { title: 'MCP Server Manager' },
            ]}
          />
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
          {/* Page Header */}
          <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                MCP Server Manager
              </Title>
              <Text type="secondary">
                Create and manage MCP servers for Oracle Fusion and REST APIs
              </Text>
            </div>
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={handleCreateNew}
            >
              Create MCP Server
            </Button>
          </div>

          {/* Servers Table */}
          <Card
            style={{
              borderRadius: 12,
              border: `1px solid ${REDWOOD.neutral200}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
            bodyStyle={{ padding: 0 }}
          >
            <Spin spinning={loading}>
              <Table
                columns={columns}
                dataSource={servers.map(s => ({ ...s, key: s.id }))}
                pagination={{ pageSize: 10 }}
                size="small"
              />
            </Spin>
          </Card>

          {servers.length === 0 && !loading && (
            <Card
              style={{
                textAlign: 'center',
                borderRadius: 12,
                border: `1px solid ${REDWOOD.neutral200}`,
                marginTop: 24,
              }}
            >
              <SettingOutlined style={{ fontSize: 48, color: REDWOOD.neutral300, marginBottom: 16 }} />
              <Title level={4}>No MCP Servers Created</Title>
              <Text type="secondary">
                Create your first MCP server to connect Claude with Oracle Fusion or REST APIs
              </Text>
              <div style={{ marginTop: 16 }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<PlusOutlined />}
                  onClick={handleCreateNew}
                >
                  Create Server
                </Button>
              </div>
            </Card>
          )}
        </div>
      </Content>

      {/* Drawer for Create/Edit */}
      <Drawer
        title={editingServer ? 'Edit MCP Server' : 'Create MCP Server'}
        placement="right"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        width={500}
        bodyStyle={{ paddingBottom: 80 }}
      >
        {drawerContent}
      </Drawer>

      {/* Test Result Modal */}
      {testResult && (
        <Modal
          title="Server Test Result"
          open={!!testResult}
          onOk={() => setTestResult(null)}
          onCancel={() => setTestResult(null)}
        >
          {testResult.error ? (
            <Card style={{ background: '#fff2f0' }}>
              <Text strong style={{ color: '#d4380d' }}>Error:</Text>
              <Paragraph>{testResult.error}</Paragraph>
            </Card>
          ) : (
            <Descriptions>
              <Descriptions.Item label="Status">
                <Tag color="success">Connected</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Response Time">
                {testResult.responseTime}ms
              </Descriptions.Item>
            </Descriptions>
          )}
        </Modal>
      )}
    </Layout>
  );
};

import { Alert } from 'antd';

export default MCPServerManager;
