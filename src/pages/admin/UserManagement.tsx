import { buildApexUrl } from '../../config/api.helper';
import React, { useEffect, useState, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Table, Button, Input, Tag, Space,
  Modal, Form, Switch, Drawer, Tabs, Avatar, Tooltip,
  Popconfirm, message, Spin, Empty, Divider, Row, Col, Badge,
} from 'antd';
import {
  HomeOutlined, TeamOutlined, PlusOutlined, SearchOutlined,
  EditOutlined, LockOutlined, StopOutlined, CheckOutlined,
  AppstoreOutlined, BankOutlined, ReloadOutlined, UserOutlined,
  EyeInvisibleOutlined, EyeTwoTone, ApiOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';

const { Content } = Layout;
const { Title, Text } = Typography;

// ─── Oracle Redwood palette ────────────────────────────────────────────────
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

const APEX_ADMIN_BASE = buildApexUrl('admin');

// ─── API types ─────────────────────────────────────────────────────────────
interface UserRecord {
  username: string;
  user_id: number;
  person_number: string;
  suspended_flag: string;   // 'Y' | 'N'
  is_admin: string;         // 'Y' | 'N'
  created_date: string;
}

interface ModuleRecord {
  module_code: string;
  module_name: string;
}

interface BURecord {
  bu_id: number;
  bu_name: string;
}

interface UserAccessData {
  status: string;
  is_admin: string;
  modules: string[];
  bus: Array<{ id: number; name: string }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const avatarColor = (username: string) => {
  const palette = [
    REDWOOD.primary, REDWOOD.info, REDWOOD.success,
    '#7B68EE', '#FA8C16', '#13C2C2', '#EB2F96', '#722ED1',
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
};

const apiFetch = async (path: string, options?: RequestInit) => {
  const res = await fetch(`${APEX_ADMIN_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
};

// ─── API log entry ─────────────────────────────────────────────────────────
interface ApiLog {
  method: string;
  url: string;
  body?: object;
  status?: number;
  response?: object;
  error?: string;
  ts: string;
}

// ─── Sub-components ────────────────────────────────────────────────────────

/** Manage Access Drawer — Modules + Business Units tabs */
const ManageAccessDrawer: React.FC<{
  open: boolean;
  username: string | null;
  onClose: () => void;
}> = ({ open, username, onClose }) => {
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [allModules, setAllModules]       = useState<ModuleRecord[]>([]);
  const [allBUs, setAllBUs]               = useState<BURecord[]>([]);
  const [assignedModules, setAssignedModules] = useState<string[]>([]);
  const [assignedBUs, setAssignedBUs]         = useState<number[]>([]);
  const [savingModules, setSavingModules] = useState(false);
  const [savingBUs, setSavingBUs]         = useState(false);
  const [apiLogs, setApiLogs]             = useState<ApiLog[]>([]);
  const [showLogs, setShowLogs]           = useState(false);

  const logApi = useCallback((entry: Omit<ApiLog, 'ts'>) => {
    setApiLogs(prev => [{ ...entry, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));
  }, []);

  // ── tracked fetch ──────────────────────────────────────────────────────
  const apiFetchLogged = useCallback(async (
    path: string,
    options?: RequestInit,
    bodyObj?: object,
  ) => {
    const url = `${APEX_ADMIN_BASE}${path}`;
    const method = options?.method ?? 'GET';
    logApi({ method, url, body: bodyObj });
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let data: any = {};
    try { data = await res.json(); } catch { data = { error: 'non-JSON response' }; }
    logApi({ method, url, body: bodyObj, status: res.status, response: data });
    return data;
  }, [logApi]);

  const load = useCallback(async () => {
    if (!username) return;
    setLoadingAccess(true);
    try {
      const [modsRes, busRes, accessRes] = await Promise.all([
        apiFetchLogged('/modules'),
        apiFetchLogged('/bus'),
        apiFetchLogged(`/user-access/${encodeURIComponent(username)}`),
      ]);
      setAllModules(modsRes.data ?? []);
      setAllBUs(busRes.data ?? []);
      if (accessRes.status === 'SUCCESS') {
        setAssignedModules(accessRes.data?.modules ?? []);
        setAssignedBUs((accessRes.data?.bus ?? []).map((b: { id: number }) => b.id));
      } else {
        message.warning('Could not load current access: ' + (accessRes.message ?? accessRes.status));
      }
    } catch (e: any) {
      message.error('Failed to load access data: ' + e.message);
    } finally {
      setLoadingAccess(false);
    }
  }, [username, apiFetchLogged]);

  useEffect(() => {
    if (open && username) load();
  }, [open, username, load]);

  // ── Module toggle — uses POST for both assign and remove ───────────────
  const handleModuleToggle = async (code: string, checked: boolean) => {
    if (!username) return;
    setSavingModules(true);
    const endpoint = checked ? '/assign-module' : '/remove-module';
    const body = { username, module_code: code };
    try {
      const res = await apiFetchLogged(
        endpoint,
        { method: 'POST', body: JSON.stringify(body) },
        body,
      );
      if (res.status === 'SUCCESS') {
        setAssignedModules(prev =>
          checked ? [...prev, code] : prev.filter(m => m !== code),
        );
        message.success(checked ? `${code} assigned.` : `${code} removed.`);
      } else {
        message.error(res.message || 'Operation failed.');
      }
    } catch {
      message.error('Network error.');
    } finally {
      setSavingModules(false);
    }
  };

  // ── BU toggle — uses POST for both assign and remove ──────────────────
  const handleBUToggle = async (bu: BURecord, checked: boolean) => {
    if (!username) return;
    setSavingBUs(true);
    const endpoint = checked ? '/assign-bu' : '/remove-bu';
    const body = checked
      ? { username, bu_id: bu.bu_id }
      : { username, bu_id: bu.bu_id };
    try {
      const res = await apiFetchLogged(
        endpoint,
        { method: 'POST', body: JSON.stringify(body) },
        body,
      );
      if (res.status === 'SUCCESS') {
        setAssignedBUs(prev =>
          checked ? [...prev, bu.bu_id] : prev.filter(id => id !== bu.bu_id),
        );
        message.success(checked ? `${bu.bu_name} assigned.` : `${bu.bu_name} removed.`);
      } else {
        message.error(res.message || 'Operation failed.');
      }
    } catch {
      message.error('Network error.');
    } finally {
      setSavingBUs(false);
    }
  };

  // ── API log panel ──────────────────────────────────────────────────────
  const apiLogPanel = (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        background: REDWOOD.neutral100,
        border: `1px solid ${REDWOOD.neutral200}`,
        borderRadius: 8,
      }}>
        <ApiOutlined style={{ color: REDWOOD.info }} />
        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, flex: 1 }}>
          Base: <code style={{ fontSize: 10 }}>{APEX_ADMIN_BASE}</code>
        </Text>
        <Button
          size="small"
          type={showLogs ? 'primary' : 'default'}
          onClick={() => setShowLogs(p => !p)}
          style={{ fontSize: 11 }}
        >
          {showLogs ? 'Hide Logs' : `Logs${apiLogs.length ? ` (${apiLogs.length})` : ''}`}
        </Button>
      </div>

      {showLogs && (
        <div style={{
          marginTop: 8, maxHeight: 220, overflowY: 'auto',
          background: '#0d1117', borderRadius: 8, padding: 10,
        }}>
          {apiLogs.length === 0 && (
            <Text style={{ color: '#666', fontSize: 11 }}>No API calls yet.</Text>
          )}
          {apiLogs.map((log, i) => (
            <div key={i} style={{ marginBottom: 8, borderBottom: '1px solid #1e2a3a', paddingBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                <Tag
                  color={log.method === 'POST' ? 'blue' : log.method === 'DELETE' ? 'red' : 'green'}
                  style={{ fontSize: 10, padding: '0 4px', margin: 0 }}
                >
                  {log.method}
                </Tag>
                {log.status && (
                  <Tag
                    color={log.status < 300 ? 'success' : 'error'}
                    style={{ fontSize: 10, padding: '0 4px', margin: 0 }}
                  >
                    {log.status}
                  </Tag>
                )}
                <Text style={{ fontSize: 10, color: '#8b949e' }}>{log.ts}</Text>
              </div>
              <Text style={{ fontSize: 10, color: '#58a6ff', wordBreak: 'break-all', display: 'block' }}>
                {log.url}
              </Text>
              {log.body && (
                <Text style={{ fontSize: 10, color: '#e6c07b', display: 'block' }}>
                  → {JSON.stringify(log.body)}
                </Text>
              )}
              {log.response && (
                <Text style={{ fontSize: 10, color: log.response && (log.response as any).status === 'SUCCESS' ? '#98c379' : '#e06c75', display: 'block' }}>
                  ← {JSON.stringify(log.response)}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const drawerTabs = [
    {
      key: 'modules',
      label: (
        <span>
          <AppstoreOutlined style={{ marginRight: 6 }} />
          Modules {assignedModules.length > 0 && <Tag color="red" style={{ fontSize: 10, padding: '0 4px' }}>{assignedModules.length}</Tag>}
        </span>
      ),
      children: (
        <>
          {apiLogPanel}
          <Spin spinning={loadingAccess || savingModules}>
            {allModules.length === 0 && !loadingAccess ? (
              <Empty description="No modules found" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allModules.map(mod => {
                  const checked = assignedModules.includes(mod.module_code);
                  return (
                    <div
                      key={mod.module_code}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: `1px solid ${checked ? REDWOOD.primary + '40' : REDWOOD.neutral200}`,
                        background: checked ? `${REDWOOD.primary}08` : REDWOOD.surface,
                        transition: 'all 0.2s',
                      }}
                    >
                      <div>
                        <Text style={{ fontSize: 14, color: REDWOOD.neutral900 }}>{mod.module_name}</Text>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block' }}>{mod.module_code}</Text>
                      </div>
                      <Switch
                        checked={checked}
                        size="small"
                        loading={savingModules}
                        onChange={(val) => handleModuleToggle(mod.module_code, val)}
                        style={{ background: checked ? REDWOOD.primary : undefined }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Spin>
        </>
      ),
    },
    {
      key: 'bus',
      label: (
        <span>
          <BankOutlined style={{ marginRight: 6 }} />
          Business Units {assignedBUs.length > 0 && <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>{assignedBUs.length}</Tag>}
        </span>
      ),
      children: (
        <>
          {apiLogPanel}
          <Spin spinning={loadingAccess || savingBUs}>
            {allBUs.length === 0 && !loadingAccess ? (
              <Empty description="No business units found" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allBUs.map(bu => {
                  const checked = assignedBUs.includes(bu.bu_id);
                  return (
                    <div
                      key={bu.bu_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: `1px solid ${checked ? REDWOOD.info + '40' : REDWOOD.neutral200}`,
                        background: checked ? `${REDWOOD.info}08` : REDWOOD.surface,
                        transition: 'all 0.2s',
                      }}
                    >
                      <div>
                        <Text style={{ fontSize: 14, color: REDWOOD.neutral900 }}>{bu.bu_name}</Text>
                        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block' }}>ID: {bu.bu_id}</Text>
                      </div>
                      <Switch
                        checked={checked}
                        size="small"
                        loading={savingBUs}
                        onChange={(val) => handleBUToggle(bu, val)}
                        style={{ background: checked ? REDWOOD.info : undefined }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Spin>
        </>
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${REDWOOD.primary}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: REDWOOD.primary, fontSize: 16,
          }}>
            <AppstoreOutlined />
          </div>
          <span>Manage Access — <Text strong>{username}</Text></span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={500}
      destroyOnHidden
      extra={
        <Button icon={<ReloadOutlined />} onClick={load} size="small" loading={loadingAccess}>
          Refresh
        </Button>
      }
    >
      <Tabs items={drawerTabs} />
    </Drawer>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────
const UserManagement: React.FC = () => {
  const [users, setUsers]           = useState<UserRecord[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [pageLogs, setPageLogs]     = useState<ApiLog[]>([]);
  const [showPageLogs, setShowPageLogs] = useState(false);

  const logPage = useCallback((entry: Omit<ApiLog, 'ts'>) => {
    setPageLogs(prev => [{ ...entry, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 30));
  }, []);

  const apiFetchPage = useCallback(async (path: string, options?: RequestInit, bodyObj?: object) => {
    const url = `${APEX_ADMIN_BASE}${path}`;
    const method = options?.method ?? 'GET';
    logPage({ method, url, body: bodyObj });
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    let data: any = {};
    try { data = await res.json(); } catch { data = { error: 'non-JSON response' }; }
    logPage({ method, url, body: bodyObj, status: res.status, response: data });
    return data;
  }, [logPage]);

  // Create / Edit modal
  const [editModalOpen, setEditModalOpen]   = useState(false);
  const [editingUser, setEditingUser]       = useState<UserRecord | null>(null);
  const [editForm]                          = Form.useForm();
  const [savingUser, setSavingUser]         = useState(false);

  // Reset Password modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetTarget, setResetTarget]       = useState<string | null>(null);
  const [resetForm]                         = Form.useForm();
  const [savingReset, setSavingReset]       = useState(false);

  // Manage Access drawer
  const [accessDrawerOpen, setAccessDrawerOpen] = useState(false);
  const [accessTarget, setAccessTarget]         = useState<string | null>(null);

  // ── Load users ────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetchPage('/users');
      setUsers(data.data ?? []);
    } catch {
      message.error('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [apiFetchPage]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ── Filtered rows ──────────────────────────────────────────────────────
  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    String(u.user_id ?? '').includes(search) ||
    (u.person_number ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // ── Create / Edit modal ────────────────────────────────────────────────
  const openCreate = () => {
    setEditingUser(null);
    editForm.resetFields();
    editForm.setFieldsValue({ is_admin: false, suspended_flag: false });
    setEditModalOpen(true);
  };

  const openEdit = (record: UserRecord) => {
    setEditingUser(record);
    editForm.setFieldsValue({
      username: record.username,
      is_admin: record.is_admin === 'Y',
      suspended_flag: record.suspended_flag === 'Y',
    });
    setEditModalOpen(true);
  };

  const handleSaveUser = async () => {
    let values: { username: string; is_admin: boolean; suspended_flag: boolean };
    try {
      values = await editForm.validateFields();
    } catch { return; }

    setSavingUser(true);
    const updateBody = {
      username: values.username, name: values.username, email: values.username,
      is_admin: values.is_admin ? 'Y' : 'N', suspended: values.suspended_flag ? 'Y' : 'N',
    };
    const createBody = { username: values.username, name: values.username, email: values.username,
      password: 'Welcome@1', is_admin: values.is_admin ? 'Y' : 'N' };
    try {
      if (editingUser) {
        const res = await apiFetchPage('/users', { method: 'PUT', body: JSON.stringify(updateBody) }, updateBody);
        if (res.status === 'SUCCESS') { message.success('User updated.'); setEditModalOpen(false); loadUsers(); }
        else message.error(res.message || 'Update failed.');
      } else {
        const res = await apiFetchPage('/users', { method: 'POST', body: JSON.stringify(createBody) }, createBody);
        if (res.status === 'SUCCESS') { message.success('User created.'); setEditModalOpen(false); loadUsers(); }
        else message.error(res.message || 'Create failed.');
      }
    } catch {
      message.error('Network error.');
    } finally {
      setSavingUser(false);
    }
  };

  // ── Toggle Status ──────────────────────────────────────────────────────
  const handleToggleStatus = async (record: UserRecord) => {
    const newFlag = record.suspended_flag === 'Y' ? 'N' : 'Y';
    const body = { username: record.username, name: record.username, email: record.username,
      is_admin: record.is_admin, suspended: newFlag };
    try {
      const res = await apiFetchPage('/users', { method: 'PUT', body: JSON.stringify(body) }, body);
      if (res.status === 'OK' || res.status === 'SUCCESS') {
        message.success(newFlag === 'Y' ? 'User suspended.' : 'User activated.');
        loadUsers();
      } else {
        message.error(res.message || 'Operation failed.');
      }
    } catch {
      message.error('Network error.');
    }
  };

  // ── Reset Password modal ───────────────────────────────────────────────
  const openReset = (username: string) => {
    setResetTarget(username);
    resetForm.resetFields();
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    let values: { new_password: string; confirm_password: string };
    try {
      values = await resetForm.validateFields();
    } catch { return; }

    if (values.new_password !== values.confirm_password) {
      resetForm.setFields([{ name: 'confirm_password', errors: ['Passwords do not match.'] }]);
      return;
    }

    setSavingReset(true);
    try {
      const resetBody = { username: resetTarget, new_password: values.new_password, admin_user: 'ADMIN' };
      const res = await apiFetchPage('/reset-password', { method: 'POST', body: JSON.stringify(resetBody) }, resetBody);
      if (res.status === 'SUCCESS') {
        message.success(`Password reset for ${resetTarget}.`);
        setResetModalOpen(false);
      } else {
        message.error(res.message || 'Reset failed.');
      }
    } catch {
      message.error('Network error.');
    } finally {
      setSavingReset(false);
    }
  };

  // ── Table columns ──────────────────────────────────────────────────────
  const columns: ColumnsType<UserRecord> = [
    {
      title: 'User',
      key: 'user',
      width: 240,
      render: (_, record) => (
        <Space>
          <Avatar size={36} style={{ background: avatarColor(record.username), color: '#fff', fontWeight: 600, fontSize: 15, flexShrink: 0 }}>
            {record.username.charAt(0).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, color: REDWOOD.neutral900, lineHeight: 1.3, fontSize: 13 }}>
              {record.username}
            </div>
            <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
              ID: {record.user_id ?? '—'}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: 'Person No.',
      dataIndex: 'person_number',
      key: 'person_number',
      width: 120,
      render: (val: string) => val
        ? <Text style={{ fontSize: 12 }}>{val}</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>,
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_, record) =>
        record.suspended_flag === 'Y' ? (
          <Badge
            status="error"
            text={<Text style={{ fontSize: 13, color: '#CF1322' }}>Suspended</Text>}
          />
        ) : (
          <Badge
            status="success"
            text={<Text style={{ fontSize: 13, color: REDWOOD.success }}>Active</Text>}
          />
        ),
      filters: [
        { text: 'Active', value: 'N' },
        { text: 'Suspended', value: 'Y' },
      ],
      onFilter: (value, record) => record.suspended_flag === value,
    },
    {
      title: 'Admin',
      key: 'admin',
      width: 80,
      render: (_, record) =>
        record.is_admin === 'Y' ? (
          <Tag
            color="red"
            style={{ borderRadius: 4, fontSize: 11, padding: '0 6px' }}
          >
            Admin
          </Tag>
        ) : null,
      filters: [
        { text: 'Admin', value: 'Y' },
        { text: 'Standard', value: 'N' },
      ],
      onFilter: (value, record) => record.is_admin === value,
    },
    {
      title: 'Created',
      dataIndex: 'created_date',
      key: 'created_date',
      width: 160,
      render: (val: string) => {
        if (!val) return <Text type="secondary">—</Text>;
        try {
          return (
            <Text style={{ fontSize: 13 }}>
              {new Date(val).toLocaleDateString('en-AE', {
                year: 'numeric', month: 'short', day: '2-digit',
              })}
            </Text>
          );
        } catch { return <Text style={{ fontSize: 13 }}>{val}</Text>; }
      },
      sorter: (a, b) =>
        new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="Edit User">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
              style={{ color: REDWOOD.info }}
            />
          </Tooltip>
          <Tooltip title="Reset Password">
            <Button
              type="text"
              size="small"
              icon={<LockOutlined />}
              onClick={() => openReset(record.username)}
              style={{ color: REDWOOD.warning }}
            />
          </Tooltip>
          <Tooltip title={record.suspended_flag === 'Y' ? 'Activate User' : 'Suspend User'}>
            <Popconfirm
              title={`${record.suspended_flag === 'Y' ? 'Activate' : 'Suspend'} ${record.username}?`}
              onConfirm={() => handleToggleStatus(record)}
              okText="Yes"
              cancelText="No"
              okButtonProps={{
                style: { background: REDWOOD.primary, borderColor: REDWOOD.primary },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={record.suspended_flag === 'Y' ? <CheckOutlined /> : <StopOutlined />}
                style={{ color: record.suspended_flag === 'Y' ? REDWOOD.success : '#CF1322' }}
              />
            </Popconfirm>
          </Tooltip>
          <Tooltip title="Manage Access">
            <Button
              type="text"
              size="small"
              icon={<AppstoreOutlined />}
              onClick={() => { setAccessTarget(record.username); setAccessDrawerOpen(true); }}
              style={{ color: REDWOOD.primary }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{
          padding: '14px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/admin">Administration</Link> },
              { title: 'User Management' },
            ]}
          />
        </div>

        {/* Page Body */}
        <div style={{ padding: 24 }}>
          {/* Page Header */}
          <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}>
                <TeamOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                  User Management
                </Title>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Manage user accounts, roles, and access permissions
                </Text>
              </div>
            </div>

            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={loadUsers}
                loading={loading}
                style={{ borderColor: REDWOOD.neutral300 }}
              >
                Refresh
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreate}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              >
                Create User
              </Button>
            </Space>
          </div>

          {/* Search + API Log bar */}
          <div style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Input
              prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
              placeholder="Search username / user ID / person no…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              allowClear
              style={{ maxWidth: 340, borderRadius: 6 }}
            />
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px',
                background: REDWOOD.neutral100,
                border: `1px solid ${REDWOOD.neutral200}`,
                borderRadius: 6,
              }}>
                <ApiOutlined style={{ color: REDWOOD.info, fontSize: 13 }} />
                <Text style={{ fontSize: 11, color: REDWOOD.neutral600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {APEX_ADMIN_BASE}
                </Text>
                <Button
                  size="small"
                  type={showPageLogs ? 'primary' : 'default'}
                  onClick={() => setShowPageLogs(p => !p)}
                  style={{ fontSize: 11, flexShrink: 0 }}
                >
                  {showPageLogs ? 'Hide Logs' : `Logs${pageLogs.length ? ` (${pageLogs.length})` : ''}`}
                </Button>
              </div>
              {showPageLogs && (
                <div style={{
                  marginTop: 6, maxHeight: 240, overflowY: 'auto',
                  background: '#0d1117', borderRadius: 8, padding: 10,
                }}>
                  {pageLogs.length === 0 && <Text style={{ color: '#666', fontSize: 11 }}>No API calls yet.</Text>}
                  {pageLogs.map((log, i) => (
                    <div key={i} style={{ marginBottom: 7, borderBottom: '1px solid #1e2a3a', paddingBottom: 5 }}>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 2 }}>
                        <Tag color={log.method === 'GET' ? 'green' : log.method === 'PUT' ? 'orange' : 'blue'} style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>{log.method}</Tag>
                        {log.status && <Tag color={log.status < 300 ? 'success' : 'error'} style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>{log.status}</Tag>}
                        <Text style={{ fontSize: 10, color: '#8b949e' }}>{log.ts}</Text>
                      </div>
                      <Text style={{ fontSize: 10, color: '#58a6ff', wordBreak: 'break-all', display: 'block' }}>{log.url}</Text>
                      {log.body && <Text style={{ fontSize: 10, color: '#e6c07b', display: 'block' }}>→ {JSON.stringify(log.body)}</Text>}
                      {log.response && <Text style={{ fontSize: 10, color: (log.response as any).status === 'SUCCESS' ? '#98c379' : '#e06c75', display: 'block' }}>← {JSON.stringify(log.response)}</Text>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div style={{
            background: REDWOOD.surface,
            borderRadius: 10,
            border: `1px solid ${REDWOOD.neutral200}`,
            overflow: 'hidden',
          }}>
            <Table<UserRecord>
              columns={columns}
              dataSource={filteredUsers}
              rowKey="username"
              loading={loading}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                showTotal: (total) => `${total} user${total !== 1 ? 's' : ''}`,
                style: { padding: '12px 16px' },
              }}
              scroll={{ x: 760 }}
              locale={{ emptyText: <Empty description="No users found" /> }}
              size="middle"
            />
          </div>
        </div>
      </Content>

      {/* ── Create / Edit Modal ──────────────────────────────────────── */}
      <Modal
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleSaveUser}
        confirmLoading={savingUser}
        title={
          <Space>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `${REDWOOD.primary}15`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: REDWOOD.primary, fontSize: 14,
            }}>
              <UserOutlined />
            </div>
            {editingUser ? 'Edit User' : 'Create User'}
          </Space>
        }
        okText={editingUser ? 'Save Changes' : 'Create User'}
        okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        width={440}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="Username (Email)"
            name="username"
            rules={[
              { required: true, message: 'Username is required.' },
              { type: 'email', message: 'Must be a valid email address.' },
            ]}
          >
            <Input
              prefix={<UserOutlined style={{ color: REDWOOD.neutral600 }} />}
              placeholder="user@example.com"
              disabled={!!editingUser}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Administrator"
                name="is_admin"
                valuePropName="checked"
              >
                <Switch
                  checkedChildren="Yes"
                  unCheckedChildren="No"
                />
              </Form.Item>
            </Col>
            {editingUser && (
              <Col span={12}>
                <Form.Item
                  label="Suspended"
                  name="suspended_flag"
                  valuePropName="checked"
                >
                  <Switch
                    checkedChildren="Yes"
                    unCheckedChildren="No"
                  />
                </Form.Item>
              </Col>
            )}
          </Row>
        </Form>
      </Modal>

      {/* ── Reset Password Modal ────────────────────────────────────── */}
      <Modal
        open={resetModalOpen}
        onCancel={() => setResetModalOpen(false)}
        onOk={handleResetPassword}
        confirmLoading={savingReset}
        title={
          <Space>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `${REDWOOD.warning}20`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: REDWOOD.warning, fontSize: 14,
            }}>
              <LockOutlined />
            </div>
            Reset Password — <Text strong>{resetTarget}</Text>
          </Space>
        }
        okText="Reset Password"
        okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        width={400}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12, marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Set a new password for this user directly. No OTP required.
          </Text>
        </div>

        <Form form={resetForm} layout="vertical">
          <Form.Item
            label="New Password"
            name="new_password"
            rules={[
              { required: true, message: 'New password is required.' },
              { min: 8, message: 'Password must be at least 8 characters.' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: REDWOOD.neutral600 }} />}
              iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              placeholder="Enter new password"
            />
          </Form.Item>
          <Form.Item
            label="Confirm Password"
            name="confirm_password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: 'Please confirm the password.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) return Promise.resolve();
                  return Promise.reject(new Error('Passwords do not match.'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: REDWOOD.neutral600 }} />}
              iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              placeholder="Confirm new password"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Manage Access Drawer ────────────────────────────────────── */}
      <ManageAccessDrawer
        open={accessDrawerOpen}
        username={accessTarget}
        onClose={() => { setAccessDrawerOpen(false); setAccessTarget(null); }}
      />
    </Layout>
  );
};

export default UserManagement;
