import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input,
  Switch, Tag, Space, Modal, Popconfirm, message, Tooltip, Select, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ApiOutlined, PlusOutlined, ReloadOutlined,
  EditOutlined, DeleteOutlined, ThunderboltOutlined, DesktopOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const APEX_BASE = buildApexUrl('');

interface McpTool {
  id: number;
  toolName: string;
  description: string;
  paramsSchema: string | null;
  httpMethod: string;
  urlTemplate: string;
  authType: string;
  resultFilter: string | null;
  isActive: string;
  createdBy?: string;
  creationDate?: string;
  lastUpdatedBy?: string;
  lastUpdateDate?: string;
}

const AUTH_COLORS: Record<string, string> = {
  NONE: REDWOOD.neutral600, BASIC_ORDS: REDWOOD.info, BASIC_FUSION: REDWOOD.primary,
};

const McpRegistry: React.FC = () => {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<McpTool | null>(null);
  const [saving, setSaving] = useState(false);

  // Add to Claude Desktop
  const [desktopModalOpen, setDesktopModalOpen] = useState(false);
  const [desktopForm] = Form.useForm();
  const [addingToDesktop, setAddingToDesktop] = useState(false);
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.mcpRegistryAddToClaudeDesktop;

  const handleAddToClaudeDesktop = async () => {
    try {
      const vals = await desktopForm.validateFields();
      setAddingToDesktop(true);
      const res = await (window as any).electronAPI.mcpRegistryAddToClaudeDesktop({
        fusionUsername: vals.fusionUsername || '',
        fusionPassword: vals.fusionPassword || '',
      });
      if (res?.success) {
        Modal.success({
          title: 'Added to Claude Desktop',
          content: (
            <div style={{ fontSize: 12 }}>
              <p>Config updated at:</p>
              <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>{res.configPath}</Text>
              <p style={{ marginTop: 8 }}>Servers in config: <Text strong>{(res.servers || []).join(', ')}</Text></p>
              <p style={{ marginTop: 8, color: '#C74634' }}>
                Now fully quit Claude Desktop (system tray → Quit) and reopen it to load the server.
              </p>
            </div>
          ),
        });
        setDesktopModalOpen(false);
      } else {
        message.error(res?.error || 'Failed to update Claude Desktop config');
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message || 'Failed');
    } finally {
      setAddingToDesktop(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${APEX_BASE}/admin/mcptools`);
      const data = await res.json();
      setRows(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      message.error(`Failed to load registry: ${e.message}. Run 05_mcp_tool_registry.sql in APEX if not deployed.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ httpMethod: 'GET', authType: 'NONE', isActive: true });
    setModalOpen(true);
  };

  const openEdit = (record: McpTool) => {
    setEditing(record);
    form.setFieldsValue({
      toolName: record.toolName,
      description: record.description,
      paramsSchema: record.paramsSchema || '',
      httpMethod: record.httpMethod,
      urlTemplate: record.urlTemplate,
      authType: record.authType,
      resultFilter: record.resultFilter || '',
      isActive: record.isActive === 'Y',
    });
    setModalOpen(true);
  };

  const validateJsonField = (_: any, value: string) => {
    if (!value || !value.trim()) return Promise.resolve();
    try { JSON.parse(value); return Promise.resolve(); }
    catch (e) { return Promise.reject(new Error('Must be valid JSON')); }
  };

  const handleSave = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      const userEmail = sessionStorage.getItem('userEmail') || 'reacterp';
      const body = {
        toolName: vals.toolName,
        description: vals.description,
        paramsSchema: vals.paramsSchema || null,
        httpMethod: vals.httpMethod,
        urlTemplate: vals.urlTemplate,
        authType: vals.authType,
        resultFilter: vals.resultFilter || null,
        isActive: vals.isActive ? 'Y' : 'N',
        createdBy: userEmail,
        updatedBy: userEmail,
      };
      const url = editing ? `${APEX_BASE}/admin/mcptools/${editing.id}` : `${APEX_BASE}/admin/mcptools`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.status === 'success') {
        message.success(editing ? 'Tool updated' : 'Tool created');
        setModalOpen(false);
        load();
      } else {
        message.error(data?.message || 'Save failed');
      }
    } catch (e: any) {
      if (e?.errorFields) return; // form validation error, already shown
      message.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: McpTool) => {
    try {
      const res = await fetch(`${APEX_BASE}/admin/mcptools/${record.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data?.status === 'success') { message.success('Tool deleted'); load(); }
      else message.error(data?.message || 'Delete failed');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns: ColumnsType<McpTool> = [
    { title: 'Tool Name', dataIndex: 'toolName', key: 'toolName', width: 220,
      render: (v) => <Text strong style={{ color: REDWOOD.primary, fontFamily: 'monospace', fontSize: 12 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Method', dataIndex: 'httpMethod', key: 'httpMethod', width: 80, align: 'center',
      render: (v) => <Tag color={v === 'GET' ? 'green' : 'orange'} style={{ margin: 0 }}>{v}</Tag> },
    { title: 'Auth', dataIndex: 'authType', key: 'authType', width: 120, align: 'center',
      render: (v) => <Tag style={{ margin: 0, color: AUTH_COLORS[v], borderColor: `${AUTH_COLORS[v]}60`, background: `${AUTH_COLORS[v]}10` }}>{v}</Tag> },
    { title: 'URL Template', dataIndex: 'urlTemplate', key: 'urlTemplate', ellipsis: true,
      render: (v) => <Tooltip title={v}><Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text></Tooltip> },
    { title: 'Active', dataIndex: 'isActive', key: 'isActive', width: 80, align: 'center',
      render: (v) => v === 'Y'
        ? <Tag color="success" style={{ margin: 0 }}>Yes</Tag>
        : <Tag style={{ margin: 0 }}>No</Tag> },
    { title: '', key: 'actions', width: 120, align: 'center',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title={isElectron ? 'Add to Claude Desktop (registers the MCP registry server in claude_desktop_config.json)' : 'Available only in the desktop (Electron) app'}>
            <Button size="small" type="text" icon={<DesktopOutlined style={{ color: isElectron ? REDWOOD.info : undefined }} />}
              disabled={!isElectron} onClick={() => setDesktopModalOpen(true)} />
          </Tooltip>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="Delete this tool?" onConfirm={() => handleDelete(record)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: 'Administration' },
            { title: 'MCP Registry' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.info} 0%, ${REDWOOD.info}99 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ApiOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>MCP Tool Registry</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Data-driven tools for the generic MCP server — add a row, Claude gets a new tool. No code, no redeploy.
                </Text>
              </div>
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
                New Tool
              </Button>
            </Space>
          </div>

          <Alert
            type="info" showIcon icon={<ThunderboltOutlined />}
            style={{ marginBottom: 16, borderRadius: 8 }}
            message="How it works"
            description={
              <Text style={{ fontSize: 12 }}>
                The generic MCP server (<Text code>electron/mcp-registry-server.cjs</Text>) loads active rows from this
                registry via <Text code>GET /settings/mcptools</Text> and exposes each one as an MCP tool in Claude Desktop.
                URL templates use <Text code>{'{param}'}</Text> placeholders filled from tool arguments; the optional result
                filter trims the response (e.g. keep only installments with <Text code>TotalBalanceAmount != 0</Text>).
              </Text>
            }
          />

          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: 0 }}>
            <Table
              rowKey="id"
              size="small"
              loading={loading}
              columns={columns}
              dataSource={rows}
              pagination={{ pageSize: 20, showTotal: (t) => `${t} tools` }}
            />
          </Card>
        </div>

        <Modal
          title={editing ? `Edit Tool — ${editing.toolName}` : 'New MCP Tool'}
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={handleSave}
          confirmLoading={saving}
          width={860}
          okText={editing ? 'Update' : 'Create'}
        >
          <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <Space.Compact block>
              <Form.Item name="toolName" label="Tool Name" style={{ flex: 1, marginRight: 12 }}
                rules={[{ required: true, message: 'Tool name is required' },
                        { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: 'Letters, digits, underscore; start with a letter' }]}>
                <Input placeholder="e.g. ar_getOpenInstallments" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item name="httpMethod" label="Method" style={{ width: 110, marginRight: 12 }} rules={[{ required: true }]}>
                <Select options={['GET', 'POST', 'PUT', 'DELETE'].map(m => ({ value: m, label: m }))} />
              </Form.Item>
              <Form.Item name="authType" label="Auth" style={{ width: 150 }} rules={[{ required: true }]}>
                <Select options={[
                  { value: 'NONE', label: 'None (public)' },
                  { value: 'BASIC_ORDS', label: 'Basic — ORDS' },
                  { value: 'BASIC_FUSION', label: 'Basic — Fusion' },
                ]} />
              </Form.Item>
            </Space.Compact>

            <Form.Item name="description" label="Description (Claude reads this to decide when to use the tool)"
              rules={[{ required: true, message: 'Description is required' }]}>
              <TextArea rows={2} placeholder="Get OPEN (unpaid) receivables installments for a customer..." />
            </Form.Item>

            <Form.Item name="urlTemplate" label="URL Template — use {param} placeholders"
              rules={[{ required: true, message: 'URL template is required' }]}>
              <TextArea rows={3} style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder="https://host/api/resource?q=Name LIKE '{customer_name}%'&expand=children" />
            </Form.Item>

            <Form.Item name="paramsSchema" label='Parameters Schema (JSON: {"properties":{...},"required":[...]})'
              rules={[{ validator: validateJsonField }]}>
              <TextArea rows={3} style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder='{"properties":{"customer_name":{"type":"string","description":"Customer name"}},"required":["customer_name"]}' />
            </Form.Item>

            <Form.Item name="resultFilter" label='Result Filter (optional JSON: {"path":"items[].child","where":{"field":"F","op":"!=","value":0}})'
              rules={[{ validator: validateJsonField }]}>
              <TextArea rows={2} style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder='{"path":"items[].transactionPaymentSchedules","where":{"field":"TotalBalanceAmount","op":"!=","value":0}}' />
            </Form.Item>

            <Form.Item name="isActive" label="Active" valuePropName="checked">
              <Switch checkedChildren="Y" unCheckedChildren="N" />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="Add MCP Registry Server to Claude Desktop"
          open={desktopModalOpen}
          onCancel={() => setDesktopModalOpen(false)}
          onOk={handleAddToClaudeDesktop}
          confirmLoading={addingToDesktop}
          okText="Write Config"
          width={520}
        >
          <Alert type="info" showIcon style={{ marginBottom: 16, fontSize: 12 }}
            message="This writes the mcp-registry server into claude_desktop_config.json, keeping existing servers (gl-server) untouched." />
          <Form form={desktopForm} layout="vertical">
            <Form.Item name="fusionUsername" label="Oracle Fusion Username (for BASIC_FUSION tools, e.g. AR)"
              extra="Leave blank if no registry tools use Fusion authentication">
              <Input placeholder="fusion.user@company.com" autoComplete="off" />
            </Form.Item>
            <Form.Item name="fusionPassword" label="Oracle Fusion Password">
              <Input.Password placeholder="••••••••" autoComplete="new-password" />
            </Form.Item>
          </Form>
          <Text type="secondary" style={{ fontSize: 11 }}>
            After writing, fully quit Claude Desktop from the system tray and reopen it.
          </Text>
        </Modal>
      </Content>
    </Layout>
  );
};

export default McpRegistry;
