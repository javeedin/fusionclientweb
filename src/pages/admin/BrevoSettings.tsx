import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Button, Form, Input,
  Alert, Spin, Divider, Space, Tag, message, Tooltip,
} from 'antd';
import {
  HomeOutlined, MailOutlined, SaveOutlined, ReloadOutlined,
  EyeOutlined, EyeInvisibleOutlined, InfoCircleOutlined,
  CheckCircleOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const BASE = APEX_DB_CONFIG.baseUrl;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

interface BrevoConfig {
  configId: number | null;
  apiKeyMasked: string;
  fromEmail: string;
  fromName: string;
  serverIp: string;
  active: string;
}

const BrevoSettings: React.FC = () => {
  const [form] = Form.useForm();
  const [config, setConfig] = useState<BrevoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/approvals/brevo-config`);
      const data = await res.json();
      if (data.status === 'SUCCESS' || data.status === 'EMPTY') {
        setConfig(data);
        form.setFieldsValue({
          fromEmail: data.fromEmail,
          fromName:  data.fromName,
          serverIp:  data.serverIp,
          apiKey:    '',
        });
      }
    } catch {
      message.error('Failed to load Brevo config');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async (values: { apiKey?: string; fromEmail: string; fromName: string; serverIp?: string }) => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        fromEmail: values.fromEmail,
        fromName:  values.fromName || 'ERP Approval System',
        serverIp:  values.serverIp || '',
        active:    'Y',
      };
      if (values.apiKey && values.apiKey.trim()) {
        payload.apiKey = values.apiKey.trim();
      }
      const res = await fetch(`${BASE}/approvals/brevo-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'SUCCESS') {
        message.success('Brevo config saved successfully');
        form.setFieldValue('apiKey', '');
        loadConfig();
      } else {
        message.error(data.message ?? 'Save failed');
      }
    } catch {
      message.error('Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const email = form.getFieldValue('fromEmail');
    if (!email) { message.warning('Enter the From Email first'); return; }
    setTestLoading(true);
    try {
      const res = await fetch(`${BASE}/approvals/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail:     email,
          toName:      'Admin',
          subject:     '[TEST] Brevo Server-Side Email Test',
          htmlContent: '<p>This is a test email sent from Oracle Cloud (server-side Brevo proxy).</p><p>If you receive this, the server IP is correctly whitelisted in Brevo.</p>',
        }),
      });
      const data = await res.json();
      if (data.status === 'SUCCESS') {
        message.success(`Test email sent to ${email}`);
      } else {
        message.error(`Test failed: ${data.message ?? 'Unknown error'}`);
      }
    } catch {
      message.error('Test request failed');
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Administration</Link> },
            { title: 'Brevo Email Settings' },
          ]} />
        </div>

        <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: `linear-gradient(135deg, #0056b3 0%, #003d82 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,86,179,0.3)',
            }}>
              <MailOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Brevo Email Settings</Title>
              <Text type="secondary">Configure server-side email delivery via Brevo API</Text>
            </div>
          </div>

          <Alert
            type="info"
            showIcon
            icon={<GlobalOutlined />}
            style={{ marginBottom: 20, borderRadius: 8 }}
            message="Fixed IP Email Delivery"
            description={
              <div>
                All approval emails are sent from <strong>Oracle Cloud (server-side)</strong> using a fixed outbound IP address.
                You only need to whitelist <strong>one IP</strong> in Brevo → Settings → Authorised IPs.
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  The Oracle Cloud outbound IP can be found in your OCI Console → Networking, or ask your DBA.
                  Store it in the Server IP field below for reference.
                </Text>
              </div>
            }
          />

          <Spin spinning={loading}>
            <Card
              style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}` }}
              styles={{ body: { padding: 28 } }}
            >
              {config && config.configId ? (
                <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f0f9eb', borderRadius: 8, border: '1px solid #b7eb8f' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Tag color="success" icon={<CheckCircleOutlined />}>Config Active</Tag>
                    <Text style={{ fontSize: 13 }}>
                      <strong>API Key:</strong> <code style={{ background: '#e6f4ea', padding: '2px 8px', borderRadius: 4 }}>{config.apiKeyMasked}</code>
                    </Text>
                    {config.fromEmail && (
                      <Text style={{ fontSize: 13 }}>
                        <strong>From:</strong> {config.fromEmail}
                      </Text>
                    )}
                  </div>
                </div>
              ) : config && !config.configId ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 20, borderRadius: 8 }}
                  message="No config found"
                  description="RR_BRAVO_IP_ADDRESS table is empty and RR_EMAIL_CONFIG has no rows. Enter your Brevo API key and sender email below to get started."
                />
              ) : null}

              <Form form={form} layout="vertical" onFinish={handleSave}>
                <Form.Item
                  label="Brevo API Key"
                  name="apiKey"
                  extra={
                    config?.configId
                      ? 'Leave blank to keep the existing API key. Enter a new key to replace it.'
                      : 'Required for first-time setup. Get your API key from Brevo → SMTP & API → API Keys.'
                  }
                  rules={config?.configId ? [] : [{ required: true, message: 'API key is required for first-time setup' }]}
                >
                  <Input.Password
                    placeholder={config?.configId ? `Current: ${config.apiKeyMasked} — leave blank to keep` : 'xkeysib-...'}
                    visibilityToggle={{ visible: showKey, onVisibleChange: setShowKey }}
                    iconRender={v => v ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  />
                </Form.Item>

                <Form.Item
                  label="From Email Address"
                  name="fromEmail"
                  rules={[{ required: true, message: 'From email is required' }, { type: 'email', message: 'Enter a valid email' }]}
                  extra="The sender address used for all approval emails. Must be a verified sender in Brevo."
                >
                  <Input prefix={<MailOutlined />} placeholder="noreply@yourcompany.com" />
                </Form.Item>

                <Form.Item
                  label="Sender Display Name"
                  name="fromName"
                  extra='Name shown in the email "From" field. Defaults to "ERP Approval System".'
                >
                  <Input placeholder="ERP Approval System" />
                </Form.Item>

                <Form.Item
                  label={
                    <Space>
                      Oracle Cloud Server IP
                      <Tooltip title="For reference only — this is the fixed outbound IP you need to whitelist in Brevo → Settings → Authorised IPs.">
                        <InfoCircleOutlined style={{ color: REDWOOD.info }} />
                      </Tooltip>
                    </Space>
                  }
                  name="serverIp"
                  extra="Note the Oracle Cloud outbound IP here so you always know which IP to whitelist in Brevo."
                >
                  <Input placeholder="e.g. 129.148.x.x" />
                </Form.Item>

                <Divider />

                <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={saving}
                      icon={<SaveOutlined />}
                      style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                    >
                      Save Config
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={loadConfig} loading={loading}>
                      Refresh
                    </Button>
                  </Space>
                  <Button
                    icon={<MailOutlined />}
                    onClick={handleTest}
                    loading={testLoading}
                    disabled={!config?.configId}
                    title="Sends a test email to the From Email address using the server-side proxy"
                  >
                    Send Test Email
                  </Button>
                </div>
              </Form>
            </Card>
          </Spin>

          <Card
            style={{ marginTop: 20, borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}` }}
            styles={{ body: { padding: 20 } }}
            title={<Text strong>How to whitelist the server IP in Brevo</Text>}
          >
            <ol style={{ margin: 0, paddingLeft: 20, color: REDWOOD.neutral600, lineHeight: 2 }}>
              <li>Log into <strong>app.brevo.com</strong></li>
              <li>Go to <strong>Settings → Senders, Domains & Dedicated IPs</strong></li>
              <li>Click <strong>Authorised IPs</strong></li>
              <li>Add the Oracle Cloud outbound IP shown in the Server IP field above</li>
              <li>Click <strong>Save</strong></li>
              <li>Use the <em>Send Test Email</em> button above to confirm delivery</li>
            </ol>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default BrevoSettings;
