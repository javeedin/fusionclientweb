import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input,
  Switch, Tag, Space, Modal, Popconfirm, message, Tooltip, Badge, Divider, Tabs, Alert, Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, RobotOutlined, PlusOutlined, ReloadOutlined,
  EditOutlined, DeleteOutlined, CheckCircleOutlined, StopOutlined,
  EyeOutlined, EyeInvisibleOutlined, ApiOutlined,
  CheckCircleFilled, CloseCircleFilled, ThunderboltOutlined, SyncOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const APEX_BASE = buildApexUrl('');

interface ClaudeKey {
  id: number;
  apiKey: string;
  description: string;
  isActive: string;
  createdBy: string;
  creationDate: string;
  lastUpdatedBy: string;
  lastUpdateDate: string;
}

interface TestResult {
  step: string;
  status: 'ok' | 'error' | 'warn';
  detail: string;
}

const maskKey = (key: string) => {
  if (!key || key.length < 16) return key;
  return key.substring(0, 14) + '••••••••••••' + key.substring(key.length - 4);
};

const fmtDate = (d?: string) => d ? dayjs(d).format('D-MMM-YYYY HH:mm') : '—';

// ── API endpoint definitions shown in the inspector ──────────────────────────
const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/settings/claudekey',
    label: 'Get Active Key (used by AI agents)',
    color: REDWOOD.success,
    description: 'Called by the Electron main process to fetch the active API key before each Claude call.',
    response: `{
  "status": "success",
  "apiKey": "sk-ant-api03-..."
}`,
  },
  {
    method: 'GET',
    path: '/admin/claudekeys',
    label: 'List All Keys (admin)',
    color: REDWOOD.info,
    description: 'Returns all keys (active and inactive) for this admin page.',
    response: `{
  "status": "success",
  "items": [
    { "id": 1, "apiKey": "sk-ant-...", "isActive": "Y",
      "description": "Production", "createdBy": "ADMIN", ... }
  ]
}`,
  },
  {
    method: 'POST',
    path: '/admin/claudekeys',
    label: 'Add New Key',
    color: '#722ed1',
    description: 'Inserts a new key row. Set isActive=Y to make it the active key.',
    body: `{
  "apiKey": "sk-ant-api03-...",
  "description": "Claude Sonnet — Production",
  "isActive": "Y",
  "createdBy": "ERP_USER"
}`,
    response: `{ "status": "success", "id": 1 }`,
  },
  {
    method: 'PUT',
    path: '/admin/claudekeys/:id',
    label: 'Update Key (activate / deactivate)',
    color: REDWOOD.warning,
    description: 'Updates description or active flag for a specific key by ID.',
    body: `{
  "description": "Updated description",
  "isActive": "N",
  "lastUpdatedBy": "ERP_USER"
}`,
    response: `{ "status": "success" }`,
  },
  {
    method: 'DELETE',
    path: '/admin/claudekeys/:id',
    label: 'Delete Key',
    color: REDWOOD.primary,
    description: 'Permanently removes a key row.',
    response: `{ "status": "success" }`,
  },
];

const METHOD_COLOR: Record<string, string> = {
  GET: REDWOOD.success, POST: '#722ed1', PUT: REDWOOD.warning, DELETE: REDWOOD.primary,
};

// ── Component ─────────────────────────────────────────────────────────────────
const ClaudeKeySettings: React.FC = () => {
  const [keys, setKeys]             = useState<ClaudeKey[]>([]);
  const [loading, setLoading]       = useState(false);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<ClaudeKey | null>(null);
  const [saving, setSaving]         = useState(false);
  const [revealId, setRevealId]     = useState<number | null>(null);

  // API inspector
  const [apiOpen, setApiOpen]       = useState(false);
  const [apiTab, setApiTab]         = useState('0');
  const [runningGet, setRunningGet] = useState<number | null>(null);
  const [getResults, setGetResults] = useState<Record<number, { status: number; body: string }>>({});

  // Test modal
  const [testOpen, setTestOpen]     = useState(false);
  const [testing, setTesting]       = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  const [form] = Form.useForm();

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${APEX_BASE}/admin/claudekeys`);
      const text = await res.text();
      if (text.trimStart().startsWith('<')) {
        message.error('APEX endpoint not found — run rr_claude_key.sql in Oracle APEX first.');
        return;
      }
      const data = JSON.parse(text);
      if (data.status === 'success') {
        setKeys(data.items ?? []);
      } else {
        message.error(data.message || 'Failed to load keys.');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  // ── Test connection ────────────────────────────────────────────────────────
  const handleTest = async () => {
    setTestResults([]);
    setTesting(true);
    setTestOpen(true);
    const results: TestResult[] = [];

    // Step 1 — APEX connectivity
    try {
      const res  = await fetch(`${APEX_BASE}/settings/claudekey`);
      const text = await res.text();
      if (text.trimStart().startsWith('<')) {
        results.push({ step: 'APEX: GET /settings/claudekey', status: 'error', detail: `HTTP ${res.status} — endpoint not deployed. Run rr_claude_key.sql in Oracle APEX.` });
        setTestResults([...results]);
        setTesting(false);
        return;
      }
      const data = JSON.parse(text);
      if (data.status === 'success' && data.apiKey) {
        results.push({ step: 'APEX: GET /settings/claudekey', status: 'ok', detail: `Key retrieved — ${maskKey(data.apiKey)}` });
      } else {
        results.push({ step: 'APEX: GET /settings/claudekey', status: 'error', detail: data.message || 'No active key found in RR_CLAUDE_KEY table.' });
        setTestResults([...results]);
        setTesting(false);
        return;
      }
    } catch (e: any) {
      results.push({ step: 'APEX: GET /settings/claudekey', status: 'error', detail: 'Network error: ' + e.message });
      setTestResults([...results]);
      setTesting(false);
      return;
    }
    setTestResults([...results]);

    // Step 2 — Claude API test via Electron IPC (desktop only)
    const api = (window as any).electronAPI;
    if (api?.claudeTestKey) {
      try {
        const result = await api.claudeTestKey();
        if (result.success) {
          results.push({ step: 'Claude API: ping message', status: 'ok', detail: `Response: "${result.reply}"` });
        } else {
          results.push({ step: 'Claude API: ping message', status: 'error', detail: result.error || 'Claude API returned an error.' });
        }
      } catch (e: any) {
        results.push({ step: 'Claude API: ping message', status: 'error', detail: e.message });
      }
    } else {
      results.push({
        step: 'Claude API: ping message',
        status: 'warn',
        detail: 'Full Claude API test requires the Electron desktop app. APEX key is ready — AI agents will work in the desktop app.',
      });
    }

    setTestResults([...results]);
    setTesting(false);
  };

  // ── Run a GET endpoint live in the API inspector ───────────────────────────
  const runGet = async (idx: number, path: string) => {
    setRunningGet(idx);
    try {
      const url = `${APEX_BASE}${path}`;
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      const body = (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } })();
      setGetResults(prev => ({ ...prev, [idx]: { status: res.status, body } }));
    } catch (e: any) {
      setGetResults(prev => ({ ...prev, [idx]: { status: 0, body: 'Error: ' + e.message } }));
    } finally {
      setRunningGet(null);
    }
  };

  // ── CRUD handlers ──────────────────────────────────────────────────────────
  const openAdd = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (rec: ClaudeKey) => {
    setEditing(rec);
    form.setFieldsValue({ description: rec.description, isActive: rec.isActive === 'Y' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      if (editing) {
        const res  = await fetch(`${APEX_BASE}/admin/claudekeys/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: values.description ?? '', isActive: values.isActive ? 'Y' : 'N', lastUpdatedBy: 'ERP_USER' }),
        });
        const data = await res.json();
        if (data.status === 'success') { message.success('Key updated.'); setModalOpen(false); loadKeys(); }
        else message.error(data.message || 'Update failed.');
      } else {
        const res  = await fetch(`${APEX_BASE}/admin/claudekeys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: values.apiKey, description: values.description ?? '', isActive: values.isActive ? 'Y' : 'N', createdBy: 'ERP_USER' }),
        });
        const data = await res.json();
        if (data.status === 'success') { message.success('Claude API key saved.'); setModalOpen(false); loadKeys(); }
        else message.error(data.message || 'Save failed.');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rec: ClaudeKey) => {
    const newFlag = rec.isActive === 'Y' ? 'N' : 'Y';
    try {
      const res  = await fetch(`${APEX_BASE}/admin/claudekeys/${rec.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newFlag, description: rec.description, lastUpdatedBy: 'ERP_USER' }),
      });
      const data = await res.json();
      if (data.status === 'success') { message.success(newFlag === 'Y' ? 'Key activated.' : 'Key deactivated.'); loadKeys(); }
      else message.error(data.message || 'Update failed.');
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res  = await fetch(`${APEX_BASE}/admin/claudekeys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') { message.success('Key deleted.'); loadKeys(); }
      else message.error(data.message || 'Delete failed.');
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    }
  };

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns: ColumnsType<ClaudeKey> = [
    {
      title: 'Status', dataIndex: 'isActive', width: 90, align: 'center',
      render: (val: string) => val === 'Y'
        ? <Badge status="success" text={<Text style={{ fontSize: 12, color: REDWOOD.success }}>Active</Text>} />
        : <Badge status="default" text={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Inactive</Text>} />,
      filters: [{ text: 'Active', value: 'Y' }, { text: 'Inactive', value: 'N' }],
      onFilter: (val, rec) => rec.isActive === val,
    },
    {
      title: 'API Key', dataIndex: 'apiKey',
      render: (val: string, rec: ClaudeKey) => (
        <Space>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {revealId === rec.id ? val : maskKey(val)}
          </Text>
          <Tooltip title={revealId === rec.id ? 'Hide' : 'Reveal'}>
            <Button type="text" size="small"
              icon={revealId === rec.id ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setRevealId(prev => prev === rec.id ? null : rec.id)}
              style={{ color: REDWOOD.neutral600 }}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: 'Description', dataIndex: 'description',
      render: (val: string) => <Text style={{ fontSize: 12 }}>{val || <Text type="secondary">—</Text>}</Text>,
    },
    { title: 'Created By', dataIndex: 'createdBy', width: 120, render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    {
      title: 'Creation Date', dataIndex: 'creationDate', width: 160, render: fmtDate,
      sorter: (a, b) => (a.creationDate ?? '').localeCompare(b.creationDate ?? ''),
      defaultSortOrder: 'descend',
    },
    { title: 'Last Updated', dataIndex: 'lastUpdateDate', width: 160, render: fmtDate },
    {
      title: 'Actions', width: 130, align: 'center',
      render: (_, rec) => (
        <Space size={4}>
          <Tooltip title={rec.isActive === 'Y' ? 'Deactivate' : 'Activate'}>
            <Button size="small" type={rec.isActive === 'Y' ? 'default' : 'primary'}
              icon={rec.isActive === 'Y' ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={() => handleToggleActive(rec)}
              style={rec.isActive === 'Y'
                ? { color: REDWOOD.warning, borderColor: REDWOOD.warning }
                : { background: REDWOOD.success, borderColor: REDWOOD.success }}
            />
          </Tooltip>
          <Tooltip title="Edit description">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(rec)} />
          </Tooltip>
          <Popconfirm title="Delete this API key?" description="This action cannot be undone."
            onConfirm={() => handleDelete(rec.id)} okText="Delete" okButtonProps={{ danger: true }}>
            <Tooltip title="Delete">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Administration</Link> },
            { title: 'Claude AI Key Settings' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: 'linear-gradient(135deg, #722ed1 0%, #531dab 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px #722ed140',
              }}>
                <RobotOutlined style={{ fontSize: 26, color: '#fff' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Claude AI Key Settings</Title>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Manage Anthropic Claude API keys used by AI agents (Bank Reconciliation, etc.)
                </Text>
              </div>
            </div>
            <Space>
              <Tooltip title="API endpoints used by this page">
                <Button icon={<ApiOutlined />} onClick={() => setApiOpen(true)}
                  style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>
                  API
                </Button>
              </Tooltip>
              <Button
                icon={testing ? <SyncOutlined spin /> : <ThunderboltOutlined />}
                loading={testing}
                onClick={handleTest}
                style={{ color: '#722ed1', borderColor: '#722ed1' }}
              >
                Test Connection
              </Button>
              <Button icon={<ReloadOutlined />} onClick={loadKeys} loading={loading}>Refresh</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}>
                Add Key
              </Button>
            </Space>
          </div>

          {/* Info banner */}
          <Card style={{ marginBottom: 16, borderRadius: 8, background: '#f9f0ff', border: '1px solid #d3adf7' }}
            styles={{ body: { padding: '12px 16px' } }}>
            <Space>
              <RobotOutlined style={{ color: '#722ed1', fontSize: 16 }} />
              <Text style={{ fontSize: 13, color: '#531dab' }}>
                Only the <strong>active</strong> key is used. If multiple keys are active, the newest one takes precedence.
                Get your key from <Text code style={{ fontSize: 12 }}>console.anthropic.com → API Keys</Text>.
                The key is fetched at runtime from <Text code style={{ fontSize: 12 }}>{APEX_BASE}/settings/claudekey</Text>.
              </Text>
            </Space>
          </Card>

          {/* Table */}
          <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: 0 } }}>
            <Table<ClaudeKey>
              columns={columns}
              dataSource={keys}
              rowKey="id"
              loading={loading}
              size="small"
              pagination={false}
              locale={{ emptyText: 'No API keys configured. Click "Add Key" to get started.' }}
              rowClassName={(rec) => rec.isActive === 'Y' ? 'claude-row-active' : ''}
            />
            <style>{`.claude-row-active td { background: #f9f0ff !important; }`}</style>
          </Card>
        </div>
      </Content>

      {/* ── Test Connection Modal ── */}
      <Modal
        title={<Space><ThunderboltOutlined style={{ color: '#722ed1' }} /><span>Test Claude AI Connection</span></Space>}
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        footer={<Button onClick={() => setTestOpen(false)}>Close</Button>}
        width={560}
      >
        <div style={{ padding: '8px 0' }}>
          {testing && testResults.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: REDWOOD.neutral600 }}>Testing connection…</div>
            </div>
          )}

          {testResults.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
              borderBottom: i < testResults.length - 1 ? `1px solid ${REDWOOD.neutral200}` : 'none',
            }}>
              <div style={{ marginTop: 2, flexShrink: 0 }}>
                {r.status === 'ok'    && <CheckCircleFilled style={{ fontSize: 18, color: REDWOOD.success }} />}
                {r.status === 'error' && <CloseCircleFilled style={{ fontSize: 18, color: REDWOOD.primary }} />}
                {r.status === 'warn'  && <CheckCircleFilled style={{ fontSize: 18, color: REDWOOD.warning }} />}
              </div>
              <div>
                <Text strong style={{ fontSize: 13 }}>{r.step}</Text>
                <div style={{ fontSize: 12, color: r.status === 'error' ? REDWOOD.primary : REDWOOD.neutral600, marginTop: 2 }}>
                  {r.detail}
                </div>
              </div>
            </div>
          ))}

          {!testing && testResults.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {testResults.every(r => r.status !== 'error')
                ? <Alert type="success" showIcon message="All checks passed — AI agents are ready to use." />
                : <Alert type="error" showIcon message="One or more checks failed. See details above." />
              }
            </div>
          )}
        </div>
      </Modal>

      {/* ── API Inspector Modal ── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — Claude Key Endpoints</span></Space>}
        open={apiOpen}
        onCancel={() => setApiOpen(false)}
        footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}
        width={760}
        styles={{ body: { padding: '0 24px 16px' } }}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '12px 0 8px' }}>
          Base URL: <Text code copyable style={{ fontSize: 11 }}>{APEX_BASE}</Text>
        </Text>

        <Tabs
          activeKey={apiTab}
          onChange={setApiTab}
          size="small"
          items={API_ENDPOINTS.map((ep, idx) => ({
            key: String(idx),
            label: (
              <span>
                <Tag color={METHOD_COLOR[ep.method]} style={{ fontSize: 10, margin: '0 4px 0 0' }}>{ep.method}</Tag>
                {ep.path}
              </span>
            ),
            children: (
              <div style={{ paddingTop: 8 }}>
                <Text style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{ep.label}</Text>
                <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 4, marginBottom: 12 }}>{ep.description}</div>

                <Text strong style={{ fontSize: 12 }}>Endpoint</Text>
                <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', marginTop: 4, marginBottom: 12 }}>
                  <Text style={{ color: METHOD_COLOR[ep.method], fontSize: 11, fontFamily: 'monospace' }}>{ep.method} </Text>
                  <Text code copyable style={{ color: '#79c0ff', fontSize: 11 }}>{APEX_BASE}{ep.path}</Text>
                </div>

                {ep.body && (
                  <>
                    <Text strong style={{ fontSize: 12 }}>Request Body</Text>
                    <pre style={{ background: '#1e1e2e', color: '#cdd6f4', padding: 12, borderRadius: 6, fontSize: 11, marginTop: 4, marginBottom: 12, overflowX: 'auto' }}>
                      {ep.body}
                    </pre>
                  </>
                )}

                <Text strong style={{ fontSize: 12 }}>Response</Text>
                <pre style={{ background: '#f6ffed', border: '1px solid #b7eb8f', color: REDWOOD.neutral900, padding: 12, borderRadius: 6, fontSize: 11, marginTop: 4, marginBottom: 12, overflowX: 'auto' }}>
                  {ep.response}
                </pre>

                {(ep.method === 'GET') && (
                  <>
                    <Button
                      size="small"
                      type="primary"
                      icon={runningGet === idx ? <SyncOutlined spin /> : <ApiOutlined />}
                      loading={runningGet === idx}
                      onClick={() => runGet(idx, ep.path)}
                      style={{ background: REDWOOD.success, borderColor: REDWOOD.success, marginBottom: 12 }}
                    >
                      Run Live
                    </Button>
                    {getResults[idx] && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Text strong style={{ fontSize: 12 }}>Live Response</Text>
                          <Tag color={getResults[idx].status >= 200 && getResults[idx].status < 300 ? 'success' : 'error'}>
                            HTTP {getResults[idx].status || 'Error'}
                          </Tag>
                        </div>
                        <pre style={{
                          background: getResults[idx].status >= 200 && getResults[idx].status < 300 ? '#f6ffed' : '#fff2f0',
                          border: `1px solid ${getResults[idx].status >= 200 && getResults[idx].status < 300 ? '#b7eb8f' : '#ffccc7'}`,
                          color: REDWOOD.neutral900, padding: 12, borderRadius: 6,
                          fontSize: 11, maxHeight: 200, overflowY: 'auto', overflowX: 'auto',
                        }}>
                          {getResults[idx].body}
                        </pre>
                      </>
                    )}
                  </>
                )}
              </div>
            ),
          }))}
        />
      </Modal>

      {/* ── Add / Edit Modal ── */}
      <Modal
        title={<Space><RobotOutlined style={{ color: '#722ed1' }} /><span>{editing ? 'Edit Key Settings' : 'Add Claude API Key'}</span></Space>}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={editing ? 'Save Changes' : 'Save Key'}
        okButtonProps={{ loading: saving, style: { background: '#722ed1', borderColor: '#722ed1' } }}
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editing && (
            <Form.Item
              label="API Key"
              name="apiKey"
              rules={[
                { required: true, message: 'API key is required' },
                { pattern: /^sk-ant-/, message: 'Claude keys start with sk-ant-' },
              ]}
              extra={<Text type="secondary" style={{ fontSize: 12 }}>Starts with sk-ant-api03-…</Text>}
            >
              <Input.Password placeholder="sk-ant-api03-..." autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item label="Description" name="description">
            <Input placeholder="e.g. Claude Sonnet — Production" maxLength={200} />
          </Form.Item>
          <Form.Item label="Active" name="isActive" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="Active" unCheckedChildren="Inactive"
              style={{ background: form.getFieldValue('isActive') ? '#722ed1' : undefined }} />
          </Form.Item>
          {editing && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Key: <Text code style={{ fontSize: 11 }}>{maskKey(editing.apiKey)}</Text>
                <br />To replace the key, delete this entry and add a new one.
              </Text>
            </>
          )}
        </Form>
      </Modal>
    </Layout>
  );
};

export default ClaudeKeySettings;
