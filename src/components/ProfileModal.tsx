import { buildApexUrl } from '../config/api.helper';
import React, { useRef, useState } from 'react';
import {
  Modal, Avatar, Button, Progress, Typography, Space, Divider,
  Tabs, Form, Input, message, Tag, Empty, Tooltip,
} from 'antd';
import {
  UserOutlined, CameraOutlined, LockOutlined, AppstoreOutlined,
  CheckCircleOutlined, EyeInvisibleOutlined, EyeTwoTone,
  ReloadOutlined, ApiOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';

const { Text, Title } = Typography;

const MAX_SIZE_MB = 2;

// Oracle Redwood palette
const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
};

// Module colour map — consistent with Home.tsx
const MODULE_COLORS: Record<string, string> = {
  GL: REDWOOD.primary,
  AP: REDWOOD.success,
  AR: '#FA8C16',
  PMS: '#7B68EE',
  RM: '#13C2C2',
  HR: '#EB2F96',
  PROCUREMENT: '#52C41A',
  INVENTORY: '#722ED1',
  PROJECTS: '#1890FF',
  MANUFACTURING: '#FA541C',
  REPORTS: '#2F54EB',
  ADMIN: REDWOOD.primary,
};

function resizeImage(file: File, maxPx = 250): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const mimeType = 'image/jpeg';
      const dataUrl = canvas.toDataURL(mimeType, 0.75);
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType });
    };
    img.onerror = reject;
    img.src = url;
  });
}

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

/* ─────────────────────────────────────────────
   Tab 1 — Profile
───────────────────────────────────────────── */
const ProfileTab: React.FC = () => {
  const { user, uploadPhoto } = useAuth();
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File too large. Max size is ${MAX_SIZE_MB}MB.`);
      return;
    }
    setError('');
    setLoading(true);
    setProgress(30);
    try {
      const { base64, mimeType } = await resizeImage(file, 250);
      setProgress(60);
      const result = await uploadPhoto(user!.username, base64, mimeType);
      setProgress(100);
      if (result.status !== 'OK') {
        setError(result.message || 'Upload failed.');
      } else {
        message.success('Profile photo updated.');
      }
    } catch {
      setError('Failed to process image.');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 800);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      {/* Avatar */}
      <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', display: 'inline-block', width: '100%' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Avatar
            size={120}
            src={user?.photo}
            icon={!user?.photo && <UserOutlined />}
            style={{
              border: `3px solid ${REDWOOD.primary}`,
              boxShadow: `0 4px 16px ${REDWOOD.primary}33`,
              background: !user?.photo ? REDWOOD.primary : undefined,
              fontSize: !user?.photo ? 48 : undefined,
            }}
          >
            {!user?.photo && user?.name?.charAt(0).toUpperCase()}
          </Avatar>
          <Button
            type="primary"
            shape="circle"
            icon={<CameraOutlined />}
            size="small"
            loading={loading}
            onClick={() => fileRef.current?.click()}
            style={{
              position: 'absolute', bottom: 4, right: 4,
              width: 32, height: 32, minWidth: 32,
              background: REDWOOD.primary,
              borderColor: REDWOOD.primary,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
          />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {progress > 0 && (
        <Progress percent={progress} size="small" strokeColor={REDWOOD.primary} style={{ marginBottom: 12 }} />
      )}
      {error && (
        <Text type="danger" style={{ display: 'block', textAlign: 'center', marginBottom: 12 }}>
          {error}
        </Text>
      )}

      <Divider style={{ margin: '8px 0 16px' }} />

      {/* User info */}
      <div style={{ padding: '0 8px' }}>
        <Space vertical={true} style={{ width: '100%' }} size={10}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">Name</Text>
            <Text strong>{user?.name}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">Username</Text>
            <Text strong>{user?.username}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">Email</Text>
            <Text strong>{user?.email}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">Role</Text>
            <Text strong>{user?.role}</Text>
          </div>
          {user?.isAdmin && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Admin</Text>
              <Tag color="red" style={{ margin: 0 }}>Administrator</Tag>
            </div>
          )}
        </Space>
      </div>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Button
          block
          onClick={() => fileRef.current?.click()}
          loading={loading}
          icon={<CameraOutlined />}
          style={{ borderColor: REDWOOD.primary, color: REDWOOD.primary }}
        >
          {user?.photo ? 'Change Photo' : 'Upload Photo'}
        </Button>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          JPG, PNG or WebP · Max {MAX_SIZE_MB}MB · Auto-resized to 250px
        </Text>
      </div>
    </>
  );
};

/* ─────────────────────────────────────────────
   Tab 2 — Change Password
───────────────────────────────────────────── */
const ChangePasswordTab: React.FC = () => {
  const { user, changePassword } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: {
    current_password: string;
    new_password: string;
    confirm_password: string;
  }) => {
    if (!user) return;
    if (values.new_password !== values.confirm_password) {
      form.setFields([{ name: 'confirm_password', errors: ['Passwords do not match.'] }]);
      return;
    }
    setLoading(true);
    try {
      const result = await changePassword(user.username, values.current_password, values.new_password);
      if (result.status === 'OK' || result.status === 'SUCCESS') {
        message.success('Password changed successfully.');
        form.resetFields();
      } else {
        message.error(result.message || 'Failed to change password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      style={{ padding: '8px 0' }}
    >
      <Form.Item
        label="Current Password"
        name="current_password"
        rules={[{ required: true, message: 'Please enter your current password.' }]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: REDWOOD.neutral600 }} />}
          iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          placeholder="Current password"
        />
      </Form.Item>

      <Form.Item
        label="New Password"
        name="new_password"
        rules={[
          { required: true, message: 'Please enter a new password.' },
          { min: 8, message: 'Password must be at least 8 characters.' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: REDWOOD.neutral600 }} />}
          iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          placeholder="New password (min. 8 chars)"
        />
      </Form.Item>

      <Form.Item
        label="Confirm New Password"
        name="confirm_password"
        dependencies={['new_password']}
        rules={[
          { required: true, message: 'Please confirm your new password.' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('new_password') === value) {
                return Promise.resolve();
              }
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

      <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={loading}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
        >
          Change Password
        </Button>
      </Form.Item>
    </Form>
  );
};

/* ─────────────────────────────────────────────
   Tab 3 — My Access
───────────────────────────────────────────── */
const APEX_ADMIN = buildApexUrl('admin');

const moduleLabel: Record<string, string> = {
  GL: 'General Ledger', AP: 'Accounts Payable', AR: 'Accounts Receivable',
  PMS: 'Portfolio Management', RM: 'Rental Management', HR: 'Human Resources',
  PROCUREMENT: 'Procurement', INVENTORY: 'Inventory', PROJECTS: 'Projects',
  MANUFACTURING: 'Manufacturing', REPORTS: 'Reports & Analytics', ADMIN: 'Administration',
  SYNC: 'Data Sync',
};

const MyAccessTab: React.FC = () => {
  const { user, setUser } = useAuth() as any;
  const [loading, setLoading] = useState(false);
  const [apiResult, setApiResult] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const apiUrl = `${APEX_ADMIN}/user-access/${encodeURIComponent(user?.username ?? '')}`;

  const modules = user?.modules ?? [];
  const bus     = user?.bus     ?? [];

  const refresh = async () => {
    if (!user?.username) return;
    setLoading(true);
    setApiResult(null);
    try {
      const res  = await fetch(apiUrl);
      const data = await res.json();
      setApiResult(JSON.stringify(data, null, 2));
      if (data.status === 'SUCCESS' && setUser) {
        setUser((prev: any) => {
          const updated = {
            ...prev,
            isAdmin: data.data?.is_admin === 'Y',
            modules: data.data?.modules  || [],
            bus:     data.data?.bus      || [],
          };
          localStorage.setItem('erp_user', JSON.stringify(updated));
          return updated;
        });
        message.success('Access refreshed.');
      } else {
        message.warning(data.message || 'No access data returned.');
      }
    } catch (e: any) {
      setApiResult(`Error: ${e.message}`);
      message.error('Failed to fetch access data.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '4px 0' }}>

      {/* API info bar */}
      <div style={{
        background: REDWOOD.neutral100,
        border: `1px solid ${REDWOOD.neutral200}`,
        borderRadius: 8,
        padding: '8px 12px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <ApiOutlined style={{ color: REDWOOD.info, fontSize: 14 }} />
        <Text style={{ fontSize: 11, color: REDWOOD.neutral600, flex: 1, wordBreak: 'break-all' }}>
          {apiUrl}
        </Text>
        <Tooltip title={showRaw ? 'Hide response' : 'Show raw response'}>
          <Button
            size="small"
            type={showRaw ? 'primary' : 'default'}
            onClick={() => setShowRaw(p => !p)}
            style={{ fontSize: 11 }}
          >
            {showRaw ? 'Hide' : 'Raw'}
          </Button>
        </Tooltip>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={refresh}
          style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
        >
          Refresh
        </Button>
      </div>

      {/* Raw API response */}
      {showRaw && apiResult && (
        <pre style={{
          background: '#1a1a2e',
          color: '#a8ff78',
          fontSize: 11,
          padding: 12,
          borderRadius: 8,
          overflowX: 'auto',
          maxHeight: 180,
          marginBottom: 16,
        }}>
          {apiResult}
        </pre>
      )}

      {/* Modules */}
      <div style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Assigned Modules ({modules.length})
        </Text>
        <Divider style={{ margin: '8px 0 12px' }} />
        {modules.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No modules assigned" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {modules.map((code: string) => (
              <Tag
                key={code}
                icon={<CheckCircleOutlined />}
                style={{
                  background: `${MODULE_COLORS[code] ?? REDWOOD.primary}15`,
                  color: MODULE_COLORS[code] ?? REDWOOD.primary,
                  borderColor: `${MODULE_COLORS[code] ?? REDWOOD.primary}40`,
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 13,
                }}
              >
                {moduleLabel[code] ?? code}
              </Tag>
            ))}
          </div>
        )}
      </div>

      {/* Business Units */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Assigned Business Units ({bus.length})
        </Text>
        <Divider style={{ margin: '8px 0 12px' }} />
        {bus.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No business units assigned" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {bus.map((bu: { id: number; name: string }) => (
              <Tag
                key={bu.id}
                style={{
                  background: `${REDWOOD.info}15`,
                  color: REDWOOD.info,
                  borderColor: `${REDWOOD.info}40`,
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 13,
                }}
              >
                {bu.name}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Root Modal
───────────────────────────────────────────── */
const ProfileModal: React.FC<ProfileModalProps> = ({ open, onClose }) => {
  const { user } = useAuth();

  const tabItems = [
    {
      key: 'profile',
      label: (
        <span>
          <UserOutlined style={{ marginRight: 6 }} />
          Profile
        </span>
      ),
      children: <ProfileTab />,
    },
    {
      key: 'password',
      label: (
        <span>
          <LockOutlined style={{ marginRight: 6 }} />
          Change Password
        </span>
      ),
      children: <ChangePasswordTab />,
    },
    {
      key: 'access',
      label: (
        <span>
          <AppstoreOutlined style={{ marginRight: 6 }} />
          My Access
        </span>
      ),
      children: <MyAccessTab />,
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={null}
      width={440}
      centered
      destroyOnHidden
    >
      {/* Header */}
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <Title level={4} style={{ marginBottom: 2, color: REDWOOD.neutral900 }}>My Profile</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{user?.email}</Text>
      </div>

      <Tabs
        defaultActiveKey="profile"
        items={tabItems}
        tabBarStyle={{ marginBottom: 20 }}
        style={{ minHeight: 320 }}
      />
    </Modal>
  );
};

export default ProfileModal;
