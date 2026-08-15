import React, { useState } from 'react';
import { Modal, Button, Space, Tooltip, Row, Col, Card, Divider, Tag, Copy, Input, message } from 'antd';
import { BugOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { getCurrentCompany } from '../config/company.config';
import { getFusionInstanceUrl } from '../config/api.helper';
import { Typography } from 'antd';

const { Text, Paragraph } = Typography;

const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D',
  warning: '#B07700',
  error: '#D93025',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
};

interface DebugInfo {
  company: string;
  instanceUrl: string;
  username: string;
  password: string;
  sessionId: string;
  fusionBaseUrl: string;
  apexBaseUrl: string;
}

const DebugCredentialsPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const getDebugInfo = (): DebugInfo => {
    const company = getCurrentCompany();
    const username = localStorage.getItem('fusion_username') || '';
    const password = localStorage.getItem('fusion_password') || '';
    const instanceUrl = getFusionInstanceUrl() || '';
    const sessionId = localStorage.getItem('fusion_session_id') || localStorage.getItem('erp_token') || '';

    return {
      company: company.name,
      instanceUrl,
      username,
      password,
      sessionId,
      fusionBaseUrl: company.fusionBaseUrl,
      apexBaseUrl: company.apexBaseUrl,
    };
  };

  const debugInfo = getDebugInfo();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    message.success(`${label} copied to clipboard`, 2);
  };

  const maskPassword = (pwd: string) => {
    if (!pwd) return '—';
    return pwd.split('').map((_, i) => i === 0 ? pwd[0] : '●').join('');
  };

  const DebugRow: React.FC<{ label: string; value: string; canCopy?: boolean }> = ({ label, value, canCopy = true }) => (
    <div style={{ marginBottom: 12, padding: 10, background: REDWOOD.neutral100, borderRadius: 6, border: `1px solid ${REDWOOD.neutral200}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: REDWOOD.info, flex: 1 }}>
          {value}
        </div>
        {canCopy && value && value !== '—' && (
          <Tooltip title="Copy">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(value, label)}
              style={{ color: REDWOOD.info, padding: '2px 6px', minWidth: 'auto' }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Tooltip title="Debug Credentials & Configuration">
        <Button
          type="text"
          icon={<BugOutlined style={{ fontSize: 18, color: '#ff7a45' }} />}
          style={{ color: '#ff7a45' }}
          onClick={() => setOpen(true)}
        />
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title={<Space><BugOutlined style={{ color: '#ff7a45' }} /><span>Debug: Credentials & Configuration</span></Space>}
        width={800}
        footer={[
          <Button key="close" onClick={() => setOpen(false)}>Close</Button>,
          <Button
            key="toggle"
            type={showPasswords ? 'primary' : 'default'}
            icon={showPasswords ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setShowPasswords(!showPasswords)}
          >
            {showPasswords ? 'Hide Passwords' : 'Show Passwords'}
          </Button>,
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Current Session */}
          <Card
            size="small"
            title={<span style={{ fontSize: 13, fontWeight: 700 }}>📍 Current Session</span>}
            style={{ border: `1px solid ${REDWOOD.info}25` }}
          >
            <DebugRow label="Company" value={debugInfo.company} canCopy={false} />
            <DebugRow label="Instance URL" value={debugInfo.instanceUrl || '(not set - using default)' } />
            <DebugRow
              label="Username"
              value={debugInfo.username || '—'}
              canCopy={!!debugInfo.username}
            />
            <DebugRow
              label="Password"
              value={showPasswords ? debugInfo.password : maskPassword(debugInfo.password)}
              canCopy={showPasswords && !!debugInfo.password}
            />
            {debugInfo.sessionId && (
              <DebugRow
                label="Session ID"
                value={debugInfo.sessionId.substring(0, 50) + (debugInfo.sessionId.length > 50 ? '...' : '')}
                canCopy={false}
              />
            )}
          </Card>

          {/* Configuration */}
          <Card
            size="small"
            title={<span style={{ fontSize: 13, fontWeight: 700 }}>⚙️ Configuration</span>}
            style={{ border: `1px solid ${REDWOOD.warning}25` }}
          >
            <DebugRow label="Fusion Base URL" value={debugInfo.fusionBaseUrl} />
            <DebugRow label="APEX Base URL" value={debugInfo.apexBaseUrl} />
            <div style={{ marginTop: 12, padding: 10, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107' }}>
              <Text type="warning" style={{ fontSize: 12 }}>
                <strong>Note:</strong> Fusion Base URL is loaded from environment configuration. If it shows TEST but you logged into PROD,
                you may need to update the .env.local file to point to the production instance.
              </Text>
            </div>
          </Card>

          {/* Troubleshooting */}
          <Card
            size="small"
            title={<span style={{ fontSize: 13, fontWeight: 700 }}>🔧 Troubleshooting</span>}
            style={{ border: `1px solid ${REDWOOD.error}25` }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <Tag color={debugInfo.username ? 'green' : 'red'}>
                  {debugInfo.username ? '✓' : '✗'} Username
                </Tag>
                <Text style={{ marginLeft: 8, fontSize: 12 }}>
                  {debugInfo.username ? 'Set' : 'Missing - login may have failed'}
                </Text>
              </div>
              <div>
                <Tag color={debugInfo.password ? 'green' : 'red'}>
                  {debugInfo.password ? '✓' : '✗'} Password
                </Tag>
                <Text style={{ marginLeft: 8, fontSize: 12 }}>
                  {debugInfo.password ? 'Set' : 'Missing - login may have failed'}
                </Text>
              </div>
              <div>
                <Tag color={debugInfo.instanceUrl ? 'green' : 'orange'}>
                  {debugInfo.instanceUrl ? '✓' : '⚠'} Instance URL
                </Tag>
                <Text style={{ marginLeft: 8, fontSize: 12 }}>
                  {debugInfo.instanceUrl ? `Using: ${new URL(debugInfo.instanceUrl).hostname}` : 'Using default from env'}
                </Text>
              </div>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ padding: 10, background: '#e7f5ff', borderRadius: 6 }}>
                <Text style={{ fontSize: 11, color: REDWOOD.info }}>
                  <strong>If you see TEST URLs but logged in to PROD:</strong>
                  <ol style={{ marginTop: 8, paddingLeft: 16 }}>
                    <li>Check that the username/password are correct</li>
                    <li>Verify Instance URL shows your PROD instance</li>
                    <li>Update .env.local if needed to reflect PROD URLs</li>
                    <li>Clear browser cache and re-login</li>
                  </ol>
                </Text>
              </div>
            </div>
          </Card>
        </div>
      </Modal>
    </>
  );
};

export default DebugCredentialsPanel;
