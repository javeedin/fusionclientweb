import React, { useState, useEffect } from 'react';
import {
  Layout, Card, Button, Form, Input, Select, Radio, Tabs, Table, Space, Modal, message,
  Row, Col, Typography, Breadcrumb, Tag, Divider, Spin, Tooltip, Drawer, Collapse,
  InputNumber, Checkbox, Descriptions
} from 'antd';
import {
  HomeOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined,
  BugOutlined, ExportOutlined, SettingOutlined, CheckCircleOutlined, ApiOutlined, PlayCircleOutlined
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
  const [previewTestResult, setPreviewTestResult] = useState<any>(null);
  const [previewTestLoading, setPreviewTestLoading] = useState(false);
  const [apiInspectorOpen, setApiInspectorOpen] = useState(false);

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

  const testApiPreview = async (values: any) => {
    setPreviewTestLoading(true);
    try {
      const config = extractConfigFromForm(values, serverType);
      if (serverType === 'REST') {
        const restConfig = config as RESTConfig;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        if (restConfig.authType === 'basic' && restConfig.authUsername && restConfig.authPassword) {
          const encoded = btoa(`${restConfig.authUsername}:${restConfig.authPassword}`);
          headers['Authorization'] = `Basic ${encoded}`;
        } else if (restConfig.authType === 'bearer' && restConfig.bearerToken) {
          headers['Authorization'] = `Bearer ${restConfig.bearerToken}`;
        } else if (restConfig.authType === 'apiKey' && restConfig.apiKey) {
          headers[restConfig.apiKeyHeader || 'X-API-Key'] = restConfig.apiKey;
        }

        const options: RequestInit = {
          method: restConfig.method,
          headers,
          timeout: restConfig.timeout || 30000,
        };

        if ((restConfig.method === 'POST' || restConfig.method === 'PUT') && restConfig.payloadTemplate) {
          options.body = restConfig.payloadTemplate;
        }

        const response = await fetch(restConfig.endpoint, options);
        const data = await response.json();

        setPreviewTestResult({
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
          body: data,
        });
        message.success('API test completed');
      }
    } catch (error) {
      setPreviewTestResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      message.error('API test failed');
    } finally {
      setPreviewTestLoading(false);
    }
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
      title: 'Endpoint',
      key: 'endpoint',
      width: 300,
      render: (_: any, record: MCPServerConfig) => {
        if (record.type === 'SOAP') {
          const config = record.config as SOAPConfig;
          return (
            <div>
              <Tag color="blue">SOAP</Tag>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                {config.bipReportName}
              </Text>
            </div>
          );
        }
        const config = record.config as RESTConfig;
        return (
          <Tooltip title={config.endpoint}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined style={{ color: '#0572CE' }} />
              <Text ellipsis style={{ fontSize: 11, flex: 1, maxWidth: 250 }}>
                {config.method} {config.endpoint}
              </Text>
            </div>
          </Tooltip>
        );
      },
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
          <Tooltip title="View API Endpoint Details">
            <Button
              size="small"
              icon={<ApiOutlined />}
              onClick={() => showApiDetails(record)}
              style={{ color: '#0572CE', borderColor: '#0572CE' }}
            />
          </Tooltip>
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
            icon={<BugOutlined />}
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

  const showApiDetails = (server: MCPServerConfig) => {
    if (server.type === 'SOAP') {
      const config = server.config as SOAPConfig;
      Modal.info({
        title: `SOAP Server Details - ${server.name}`,
        width: 700,
        content: (
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <Descriptions
              column={1}
              size="small"
              items={[
                { label: 'Server Name', children: server.name },
                { label: 'Type', children: 'SOAP' },
                { label: 'Status', children: server.status },
                { label: 'Fusion URL', children: <Text code copyable>{config.fusionUrl}</Text> },
                { label: 'BIP Report', children: <Text code>{config.bipReportName}</Text> },
                { label: 'Username', children: <Text code>{config.username}</Text> },
                { label: 'Timeout', children: `${config.timeout || 30000}ms` },
              ]}
            />
            <Divider />
            <Text strong style={{ fontSize: 12 }}>Parameters:</Text>
            <Card size="small" style={{ background: '#f5f5f5', marginTop: 8 }}>
              <pre style={{ margin: 0, fontSize: 11 }}>
                {JSON.stringify(config.parameters, null, 2)}
              </pre>
            </Card>
          </div>
        ),
      });
    } else {
      const config = server.config as RESTConfig;
      Modal.info({
        title: `REST API Details - ${server.name}`,
        width: 800,
        content: (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <div>
                <Text strong style={{ fontSize: 12, color: '#666' }}>METHOD & ENDPOINT</Text>
                <Card size="small" style={{ background: '#f5f5f5', marginTop: 4 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                    <Tag color={
                      config.method === 'GET' ? 'blue' :
                      config.method === 'POST' ? 'green' :
                      config.method === 'PUT' ? 'orange' : 'red'
                    }>
                      {config.method}
                    </Tag>
                    {' '}{config.endpoint}
                  </div>
                </Card>
              </div>

              <div>
                <Text strong style={{ fontSize: 12, color: '#666' }}>AUTHENTICATION</Text>
                <Card size="small" style={{ background: '#f5f5f5', marginTop: 4 }}>
                  <div style={{ fontSize: 12 }}>
                    <div><Text strong>Type:</Text> {config.authType || 'none'}</div>
                    {config.authType === 'basic' && (
                      <div><Text strong>Username:</Text> {config.authUsername}</div>
                    )}
                    {config.authType === 'bearer' && (
                      <div><Text strong>Token:</Text> {config.bearerToken ? '••••••••' : 'Not set'}</div>
                    )}
                    {config.authType === 'apiKey' && (
                      <div><Text strong>Header:</Text> {config.apiKeyHeader || 'X-API-Key'}</div>
                    )}
                  </div>
                </Card>
              </div>

              {config.payloadTemplate && (
                <div>
                  <Text strong style={{ fontSize: 12, color: '#666' }}>REQUEST BODY TEMPLATE</Text>
                  <Card size="small" style={{ background: '#f5f5f5', marginTop: 4 }}>
                    <pre style={{ margin: 0, fontSize: 11, maxHeight: 200, overflowY: 'auto', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                      {config.payloadTemplate}
                    </pre>
                  </Card>
                </div>
              )}

              <div>
                <Text strong style={{ fontSize: 12, color: '#666' }}>ADDITIONAL INFO</Text>
                <Card size="small" style={{ background: '#f5f5f5', marginTop: 4 }}>
                  <div style={{ fontSize: 12 }}>
                    <div><Text strong>Timeout:</Text> {config.timeout || 30000}ms</div>
                    {config.headers && (
                      <div>
                        <Text strong>Custom Headers:</Text>
                        <pre style={{ margin: '8px 0 0 0', fontSize: 11, background: '#fff', padding: 8, borderRadius: 4 }}>
                          {JSON.stringify(config.headers, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </Space>
          </div>
        ),
      });
    }
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

      {serverType === 'REST' && (
        <>
          <Divider style={{ marginTop: 32, marginBottom: 16 }} />
          <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>
            <ApiOutlined /> API Preview
          </Text>

          <Card
            size="small"
            style={{ background: '#fafafa', marginBottom: 16 }}
            bodyStyle={{ padding: 12 }}
          >
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ fontSize: 11, color: '#666' }}>METHOD & ENDPOINT</Text>
              <div style={{ background: '#fff', padding: '8px', borderRadius: 4, marginTop: 4, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                <Tag color={form.getFieldValue('method') === 'GET' ? 'blue' : form.getFieldValue('method') === 'POST' ? 'green' : form.getFieldValue('method') === 'PUT' ? 'orange' : 'red'}>
                  {form.getFieldValue('method') || 'GET'}
                </Tag>
                {' '}{form.getFieldValue('endpoint') || 'https://api.example.com/endpoint'}
              </div>
            </div>

            {(form.getFieldValue('method') === 'POST' || form.getFieldValue('method') === 'PUT') && form.getFieldValue('payloadTemplate') && (
              <div style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 11, color: '#666' }}>REQUEST BODY</Text>
                <div style={{ background: '#fff', padding: '8px', borderRadius: 4, marginTop: 4, fontFamily: 'monospace', fontSize: 10, maxHeight: 150, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {form.getFieldValue('payloadTemplate')}
                </div>
              </div>
            )}

            {form.getFieldValue('authType') !== 'none' && (
              <div>
                <Text strong style={{ fontSize: 11, color: '#666' }}>AUTHENTICATION</Text>
                <div style={{ background: '#fff', padding: '8px', borderRadius: 4, marginTop: 4, fontSize: 11 }}>
                  {form.getFieldValue('authType') === 'basic' && <div>Basic Auth: {form.getFieldValue('authUsername')}</div>}
                  {form.getFieldValue('authType') === 'bearer' && <div>Bearer Token: {form.getFieldValue('bearerToken') ? '••••••••' : 'Not set'}</div>}
                  {form.getFieldValue('authType') === 'apiKey' && <div>API Key Header: {form.getFieldValue('apiKeyHeader') || 'X-API-Key'}</div>}
                </div>
              </div>
            )}

            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              loading={previewTestLoading}
              onClick={() => testApiPreview(form.getFieldsValue())}
              style={{ marginTop: 12 }}
            >
              Test API
            </Button>
          </Card>

          {previewTestResult && (
            <Card
              size="small"
              style={{ background: previewTestResult.success ? '#f6ffed' : '#fff2f0', marginBottom: 16 }}
              bodyStyle={{ padding: 12 }}
              title={
                <Text strong style={{ color: previewTestResult.success ? '#52c41a' : '#d4380d' }}>
                  {previewTestResult.success ? '✓ Test Passed' : '✗ Test Failed'}
                </Text>
              }
            >
              <div>
                <Text strong style={{ fontSize: 11 }}>Status:</Text>
                <div style={{ fontSize: 11, marginBottom: 8 }}>{previewTestResult.status} {previewTestResult.statusText}</div>

                {previewTestResult.body && (
                  <>
                    <Text strong style={{ fontSize: 11 }}>Response:</Text>
                    <div style={{ background: '#fff', padding: '8px', borderRadius: 4, marginTop: 4, fontFamily: 'monospace', fontSize: 10, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(previewTestResult.body, null, 2)}
                    </div>
                  </>
                )}

                {previewTestResult.error && (
                  <>
                    <Text strong style={{ fontSize: 11, color: '#d4380d' }}>Error:</Text>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#d4380d' }}>{previewTestResult.error}</div>
                  </>
                )}
              </div>
            </Card>
          )}
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
            <Space>
              <Button
                size="large"
                icon={<ApiOutlined />}
                onClick={() => setApiInspectorOpen(true)}
                style={{ color: '#0572CE', borderColor: '#0572CE' }}
              >
                API Inspector
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                onClick={handleCreateNew}
              >
                Create MCP Server
              </Button>
            </Space>
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

      {/* API Inspector Modal */}
      <Modal
        title="API Inspector — All Endpoints"
        open={apiInspectorOpen}
        onCancel={() => setApiInspectorOpen(false)}
        width={1000}
        footer={null}
      >
        <Tabs
          items={servers.map((server) => ({
            key: server.id,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ApiOutlined />
                <span>{server.name}</span>
                <Tag color={server.status === 'active' ? 'success' : 'default'}>
                  {server.status}
                </Tag>
              </div>
            ),
            children: (
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {server.type === 'SOAP' ? (
                  <Card style={{ background: '#f0f2f5' }}>
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="Type">
                        <Tag color="blue">SOAP</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Fusion URL">
                        <Text code copyable>
                          {(server.config as SOAPConfig).fusionUrl}
                        </Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="BIP Report">
                        <Text code>
                          {(server.config as SOAPConfig).bipReportName}
                        </Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Description">
                        {server.description}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <div>
                      <Text strong style={{ fontSize: 12, color: '#666' }}>REQUEST</Text>
                      <Card size="small" style={{ background: '#f5f5f5', marginTop: 8 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}>
                          <div>
                            <Tag color={
                              (server.config as RESTConfig).method === 'GET' ? 'blue' :
                              (server.config as RESTConfig).method === 'POST' ? 'green' :
                              (server.config as RESTConfig).method === 'PUT' ? 'orange' : 'red'
                            }>
                              {(server.config as RESTConfig).method}
                            </Tag>
                          </div>
                          <div style={{ marginTop: 8, wordBreak: 'break-all', padding: '8px', background: '#fff', borderRadius: 4 }}>
                            {(server.config as RESTConfig).endpoint}
                          </div>
                        </div>
                      </Card>
                    </div>

                    {(server.config as RESTConfig).authType !== 'none' && (
                      <div>
                        <Text strong style={{ fontSize: 12, color: '#666' }}>AUTHENTICATION</Text>
                        <Card size="small" style={{ background: '#f5f5f5', marginTop: 8 }}>
                          <div style={{ fontSize: 12 }}>
                            <div>
                              <Text strong>Type:</Text> {(server.config as RESTConfig).authType}
                            </div>
                            {(server.config as RESTConfig).authType === 'basic' && (
                              <div>
                                <Text strong>Username:</Text> {(server.config as RESTConfig).authUsername}
                              </div>
                            )}
                            {(server.config as RESTConfig).authType === 'bearer' && (
                              <div>
                                <Text strong>Token:</Text> {(server.config as RESTConfig).bearerToken ? '••••••••' : 'Not set'}
                              </div>
                            )}
                            {(server.config as RESTConfig).authType === 'apiKey' && (
                              <div>
                                <Text strong>Header:</Text> {(server.config as RESTConfig).apiKeyHeader || 'X-API-Key'}
                              </div>
                            )}
                          </div>
                        </Card>
                      </div>
                    )}

                    {(server.config as RESTConfig).payloadTemplate && (
                      <div>
                        <Text strong style={{ fontSize: 12, color: '#666' }}>REQUEST BODY</Text>
                        <Card size="small" style={{ background: '#f5f5f5', marginTop: 8 }}>
                          <pre style={{ margin: 0, fontSize: 11, maxHeight: 200, overflowY: 'auto', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                            {(server.config as RESTConfig).payloadTemplate}
                          </pre>
                        </Card>
                      </div>
                    )}

                    <div>
                      <Text strong style={{ fontSize: 12, color: '#666' }}>METADATA</Text>
                      <Card size="small" style={{ background: '#f5f5f5', marginTop: 8 }}>
                        <Descriptions column={1} size="small">
                          <Descriptions.Item label="Timeout">
                            {(server.config as RESTConfig).timeout || 30000}ms
                          </Descriptions.Item>
                          <Descriptions.Item label="Created">
                            {new Date(server.createdAt).toLocaleString()}
                          </Descriptions.Item>
                          <Descriptions.Item label="Last Updated">
                            {new Date(server.updatedAt).toLocaleString()}
                          </Descriptions.Item>
                        </Descriptions>
                      </Card>
                    </div>
                  </Space>
                )}
              </div>
            ),
          }))}
        />
      </Modal>
    </Layout>
  );
};

import { Alert } from 'antd';

export default MCPServerManager;
