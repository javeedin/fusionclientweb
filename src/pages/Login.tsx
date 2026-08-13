import React, { useState } from 'react';
import {
  Form, Input, Button, Card, Typography, Modal, Tag, Tooltip, Table, Space, Code,
  Steps, Alert, Divider,
} from 'antd';
import {
  UserOutlined, LockOutlined, CloudServerOutlined,
  MailOutlined, KeyOutlined, CheckCircleOutlined, BugOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCurrentCompany, getAllCompanies, setCurrentCompany, isCompanySelectionDisabled, getDefaultCompany } from '../config/company.config';
import type { CompanyCode } from '../config/company.config';
import { CheckboxOutlined, CheckSquareOutlined } from '@ant-design/icons';

const { Title, Text, Link } = Typography;

// ─── password strength helper ────────────────────────────────────────────────
function passwordStrength(pw: string): { label: string; color: string } | null {
  if (!pw) return null;
  if (pw.length < 6)                    return { label: 'Too short',  color: '#f5222d' };
  if (pw.length < 8)                    return { label: 'Weak',       color: '#fa8c16' };
  if (!/[A-Z]/.test(pw))               return { label: 'Fair',       color: '#fadb14' };
  if (!/[0-9!@#$%^&*]/.test(pw))       return { label: 'Good',       color: '#52c41a' };
  return                                       { label: 'Strong',     color: '#1677ff' };
}

// ─── API Inspector Modal ─────────────────────────────────────────────────────
const ApiInspectorModal: React.FC<{
  open: boolean;
  onClose: () => void;
  selectedCompany: CompanyCode;
  selectedInstance: string;
  fusionInstances: any[];
  currentCompanyConfig: any;
}> = ({ open, onClose, selectedCompany, selectedInstance, fusionInstances, currentCompanyConfig }) => {
  const instanceName = fusionInstances.find(i => i.url === selectedInstance)?.name || 'Unknown';

  const apiEndpoints = [
    {
      name: 'Fusion Cloud REST API',
      baseUrl: selectedInstance || currentCompanyConfig?.fusionBaseUrl,
      resource: '/fscmRestApi/resources/11.13.18.05',
      description: 'Oracle Fusion Supply Chain and Financial APIs'
    },
    {
      name: 'Oracle APEX ORDS',
      baseUrl: currentCompanyConfig?.apexBaseUrl,
      resource: '/ords/...',
      description: 'Oracle APEX REST API endpoints'
    },
    {
      name: 'HCM API',
      baseUrl: currentCompanyConfig?.hcmBaseUrl,
      resource: '/hcmRestApi/resources/11.13.18.05',
      description: 'Oracle Human Capital Management APIs'
    }
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  console.log('[API Inspector] Company:', selectedCompany, 'Config:', currentCompanyConfig);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="API Inspector - POD Information"
      width={700}
      footer={[
        <Button key="close" onClick={onClose}>Close</Button>
      ]}
    >
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong>Company:</Text>
          <Tag color="blue" style={{ marginLeft: 8 }}>{selectedCompany} - {currentCompanyConfig?.name}</Tag>
        </div>

        {selectedInstance && (
          <div>
            <Text strong>Fusion Instance:</Text>
            <Tag color="green" style={{ marginLeft: 8 }}>{instanceName}</Tag>
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <code>{selectedInstance}</code>
                <Tooltip title="Copy to clipboard">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(selectedInstance)}
                  />
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>

      <Divider />

      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 14 }}>Available API Endpoints (PODs):</Text>
      </div>

      {apiEndpoints.map((endpoint, idx) => (
        <div key={idx} style={{ marginBottom: 16, padding: '12px', border: '1px solid #e8e8e8', borderRadius: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>{endpoint.name}</Text>
            {endpoint.baseUrl && (
              <Tooltip title="Copy full URL">
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyToClipboard(`${endpoint.baseUrl}${endpoint.resource}`)}
                />
              </Tooltip>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{endpoint.description}</div>
          <div style={{ background: '#fafafa', padding: '8px', borderRadius: 4, marginBottom: 8, fontSize: 11 }}>
            <div><strong>Base URL:</strong></div>
            <code style={{ wordBreak: 'break-all' }}>{endpoint.baseUrl || 'Not configured'}</code>
          </div>
          <div style={{ background: '#fafafa', padding: '8px', borderRadius: 4, fontSize: 11 }}>
            <div><strong>Resource Path:</strong></div>
            <code>{endpoint.resource}</code>
          </div>
        </div>
      ))}
    </Modal>
  );
};

// ─── Forgot-password / Set-password modal ────────────────────────────────────
const ForgotPasswordModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { sendOtp, setPassword } = useAuth();
  const [step, setStep]           = useState(0);          // 0 = email, 1 = otp+pwd, 2 = done
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [username, setUsername]   = useState('');
  const [newPwd, setNewPwd]       = useState('');
  const [form]                    = Form.useForm();

  const handleClose = () => {
    form.resetFields();
    setStep(0); setError(''); setUsername(''); setNewPwd('');
    onClose();
  };

  // Step 0 → send OTP
  const handleSendOtp = async (values: { username: string }) => {
    setLoading(true); setError('');
    const result = await sendOtp(values.username);
    setLoading(false);
    if (result.status === 'SENT') {
      setUsername(values.username);
      setStep(1);
    } else {
      setError(result.message || 'Failed to send OTP.');
    }
  };

  // Step 1 → verify OTP + set password
  const handleSetPassword = async (values: { otp: string; new_password: string; confirm_password: string }) => {
    if (values.new_password !== values.confirm_password) {
      setError('Passwords do not match.'); return;
    }
    setLoading(true); setError('');
    const result = await setPassword(username, values.otp, values.new_password);
    setLoading(false);
    if (result.status === 'SUCCESS') {
      setStep(2);
    } else {
      setError(result.message || 'Failed to set password.');
    }
  };

  const strength = passwordStrength(newPwd);

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      title={null}
      width={440}
      centered
      destroyOnHidden
    >
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <KeyOutlined style={{ fontSize: 36, color: '#1677ff', marginBottom: 8 }} />
        <Title level={4} style={{ margin: 0 }}>
          {step === 2 ? 'Password Set!' : 'Reset / Set Password'}
        </Title>
      </div>

      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Enter Email' },
          { title: 'OTP + Password' },
          { title: 'Done' },
        ]}
      />

      {error && (
        <Alert title={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {/* ── Step 0: Enter email ── */}
      {step === 0 && (
        <Form form={form} layout="vertical" onFinish={handleSendOtp} requiredMark={false}>
          <Form.Item
            label="Email Address"
            name="username"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Enter a valid email address' },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="you@example.com"
              size="large"
              autoFocus
            />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
            We will send a 6-digit OTP to this email. Valid for 15 minutes.
          </Text>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Send OTP
          </Button>
        </Form>
      )}

      {/* ── Step 1: OTP + new password ── */}
      {step === 1 && (
        <Form form={form} layout="vertical" onFinish={handleSetPassword} requiredMark={false}>
          <Alert
            title={`OTP sent to ${username}`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="One-Time Password (OTP)"
            name="otp"
            rules={[
              { required: true, message: 'Please enter the OTP' },
              { len: 6, message: 'OTP must be exactly 6 digits' },
              { pattern: /^\d{6}$/, message: 'OTP must be 6 digits' },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="6-digit code"
              size="large"
              maxLength={6}
              autoFocus
            />
          </Form.Item>
          <Form.Item
            label="New Password"
            name="new_password"
            rules={[
              { required: true, message: 'Please enter a new password' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="Min 8 characters"
              size="large"
              onChange={e => setNewPwd(e.target.value)}
            />
          </Form.Item>
          {strength && (
            <div style={{ marginTop: -12, marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: strength.color }}>
                ● Strength: {strength.label}
              </Text>
            </div>
          )}
          <Form.Item
            label="Confirm Password"
            name="confirm_password"
            rules={[{ required: true, message: 'Please confirm your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="Re-enter new password"
              size="large"
            />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button block size="large" onClick={() => { setStep(0); setError(''); form.resetFields(['otp','new_password','confirm_password']); }}>
              Back
            </Button>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              Set Password
            </Button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Link onClick={async () => {
              setLoading(true); setError('');
              const r = await sendOtp(username);
              setLoading(false);
              if (r.status !== 'SENT') setError(r.message || 'Failed to resend OTP.');
            }}>
              Resend OTP
            </Link>
          </div>
        </Form>
      )}

      {/* ── Step 2: Done ── */}
      {step === 2 && (
        <div style={{ textAlign: 'center' }}>
          <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
          <Title level={5}>Password set successfully!</Title>
          <Text type="secondary">You can now log in with your new password.</Text>
          <Button type="primary" block size="large" style={{ marginTop: 24 }} onClick={handleClose}>
            Go to Login
          </Button>
        </div>
      )}
    </Modal>
  );
};


// ─── Main Login page ─────────────────────────────────────────────────────────
const Login: React.FC = () => {
  const companySelectionDisabled = isCompanySelectionDisabled();
  const defaultCompanyCode = getDefaultCompany();

  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [forgotOpen, setForgotOpen]     = useState(false);
  const [apiInspectorOpen, setApiInspectorOpen] = useState(false);
  const [useFusionLogin, setUseFusionLogin] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<CompanyCode>(
    companySelectionDisabled ? defaultCompanyCode : getCurrentCompany().code
  );
  const { loginWithStatus }             = useAuth();
  const navigate                        = useNavigate();

  const currentCompanyConfig = getAllCompanies().find(c => c.code === selectedCompany);
  const fusionInstances = currentCompanyConfig?.fusionInstances || [];

  // Debug: Log company and instances info
  React.useEffect(() => {
    console.log('[DEBUG] Selected Company:', selectedCompany);
    console.log('[DEBUG] Company Config:', currentCompanyConfig);
    console.log('[DEBUG] Fusion Instances for', selectedCompany, ':', fusionInstances);
  }, [selectedCompany, currentCompanyConfig, fusionInstances]);

  const onFinish = async (values: { username: string; password: string }) => {
    // Validate Fusion instance selection if Fusion login is selected
    if (useFusionLogin && !selectedInstance) {
      setError('Please select a Fusion instance');
      return;
    }

    setLoading(true); setError('');

    // Store Fusion login settings in sessionStorage
    if (useFusionLogin && selectedInstance) {
      sessionStorage.setItem('fusionLoginEnabled', 'true');
      sessionStorage.setItem('fusionInstanceUrl', selectedInstance);
    } else {
      sessionStorage.removeItem('fusionLoginEnabled');
      sessionStorage.removeItem('fusionInstanceUrl');
    }

    const result = await loginWithStatus(values.username, values.password);
    setLoading(false);

    if (result.status === 'SUCCESS') {
      navigate('/home');
      return;
    }

    // Show specific messages per status
    if (result.status === 'NO_PASSWORD') {
      setError('No password found for this account. Use "Forgot Password" below to set one via OTP.');
    } else {
      setError(result.message || 'Login failed. Please try again.');
    }
  };

  return (
    <>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        }}
      >
        <Card
          style={{
            width: 420,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            borderRadius: 12,
            border: 'none',
          }}
          styles={{ body: { padding: '40px' } }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            {/* Re-ERP Logo */}
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: 12 }}>
              <rect width="64" height="64" rx="13" fill="#C74634"/>
              <rect x="0" y="0" width="64" height="32" rx="13" fill="rgba(255,255,255,0.1)"/>
              <rect x="7"  y="7"  width="21" height="21" rx="4" fill="rgba(255,255,255,0.92)"/>
              <rect x="36" y="7"  width="21" height="21" rx="4" fill="rgba(255,255,255,0.60)"/>
              <rect x="7"  y="36" width="21" height="21" rx="4" fill="rgba(255,255,255,0.60)"/>
              <rect x="36" y="36" width="21" height="21" rx="4" fill="rgba(255,255,255,0.35)"/>
              <rect x="28" y="15" width="8" height="3" rx="1.5" fill="rgba(255,255,255,0.55)"/>
              <rect x="28" y="46" width="8" height="3" rx="1.5" fill="rgba(255,255,255,0.35)"/>
              <rect x="15" y="28" width="3" height="8" rx="1.5" fill="rgba(255,255,255,0.55)"/>
              <rect x="46" y="28" width="3" height="8" rx="1.5" fill="rgba(255,255,255,0.35)"/>
              <text x="9" y="24" fontFamily="Arial Black, Arial, sans-serif" fontSize="14" fontWeight="900" fill="#C74634">Re</text>
            </svg>
            <Title level={2} style={{ margin: 0, color: '#1a1a2e' }}>
              Fusion<span style={{ fontWeight: 400 }}>Client</span>
            </Title>
            <Text type="secondary">Multi-Tenant ERP Platform</Text>
          </div>

          {/* Company Selector - Hidden when company selection is disabled */}
          {!companySelectionDisabled && (
            <div style={{ marginBottom: 24, padding: '12px 16px', background: '#f5f5f5', borderRadius: 8, border: '1px solid #e8e8e8' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#262626', margin: 0 }}>Company:</label>
                <select
                  onChange={(e) => {
                    const code = e.target.value as CompanyCode;
                    setSelectedCompany(code);
                    setCurrentCompany(code);
                    setSelectedInstance('');
                  }}
                  value={selectedCompany}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    fontSize: 13,
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {getAllCompanies().map((company) => (
                    <option key={company.code} value={company.code}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Company Display - Shown when company selection is disabled */}
          {companySelectionDisabled && (
            <div style={{ marginBottom: 24, padding: '12px 16px', background: '#f0f5ff', borderRadius: 8, border: '1px solid #b3d8ff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#262626', margin: 0 }}>Company:</label>
                <div style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#1677ff',
                }}>
                  {currentCompanyConfig?.name || selectedCompany}
                </div>
              </div>
            </div>
          )}

          {/* Fusion Login Checkbox */}
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #e8e8e8' }}>
            <div
              onClick={() => setUseFusionLogin(!useFusionLogin)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                padding: '8px 0',
                userSelect: 'none',
              }}
            >
              <div style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                border: '1.5px solid #1677ff',
                background: useFusionLogin ? '#1677ff' : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 11,
              }}>
                {useFusionLogin && '✓'}
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#262626' }}>
                Login using Oracle Fusion
              </span>
            </div>
          </div>

          {/* Fusion Instance Selector */}
          {useFusionLogin && fusionInstances.length > 0 && (
            <div style={{ marginBottom: 24, padding: '12px 16px', background: '#fffbe6', borderRadius: 8, border: '1px solid #ffe58f' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#262626', margin: 0 }}>Fusion Instance:</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <select
                    onChange={(e) => setSelectedInstance(e.target.value)}
                    value={selectedInstance}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      border: '1px solid #ffc069',
                      borderRadius: 4,
                      fontSize: 13,
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">-- Select Instance --</option>
                    {fusionInstances.map((instance, idx) => (
                      <option key={idx} value={instance.url}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                  {selectedInstance && (
                    <Tooltip title="View API Endpoints">
                      <Button
                        type="text"
                        size="small"
                        icon={<BugOutlined />}
                        onClick={() => setApiInspectorOpen(true)}
                        style={{ color: '#1677ff' }}
                      />
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          )}

          {useFusionLogin && fusionInstances.length === 0 && (
            <div style={{ marginBottom: 24, padding: '12px 16px', background: '#fff2f0', borderRadius: 8, border: '1px solid #ffccc7' }}>
              <Text type="danger" style={{ fontSize: 12 }}>No Fusion instances configured for this company</Text>
            </div>
          )}

          {/* Error alert */}
          {error && (
            <Alert title={error} type="error" showIcon style={{ marginBottom: 20 }} />
          )}

          {/* Login form */}
          <Form
            name="login"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Please enter your email' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Email address"
                size="large"
                style={{ borderRadius: 8 }}
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Password"
                size="large"
                style={{ borderRadius: 8 }}
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
                style={{ borderRadius: 8, height: 48, fontSize: 16, fontWeight: 500 }}
              >
                Sign In
              </Button>
            </Form.Item>
          </Form>

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              First time or forgot password?{' '}
            </Text>
            <Link
              style={{ fontSize: 13 }}
              onClick={() => { setError(''); setForgotOpen(true); }}
            >
              Reset / Set Password
            </Link>
          </div>
        </Card>
      </div>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
      <ApiInspectorModal
        open={apiInspectorOpen}
        onClose={() => setApiInspectorOpen(false)}
        selectedCompany={selectedCompany}
        selectedInstance={selectedInstance}
        fusionInstances={fusionInstances}
        currentCompanyConfig={currentCompanyConfig}
      />
    </>
  );
};

export default Login;
