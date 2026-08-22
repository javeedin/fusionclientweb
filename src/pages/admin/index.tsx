import React from 'react';
import { Layout, Typography, Card, Breadcrumb, Row, Col, Tag, Tooltip } from 'antd';
import {
  HomeOutlined,
  TeamOutlined,
  SettingOutlined,
  SafetyOutlined,
  RobotOutlined,
  MessageOutlined,
  MailOutlined,
  DatabaseOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

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

interface AdminCard {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  path?: string;
  badge?: string;
}

const adminCards: AdminCard[] = [
  {
    key: 'users',
    title: 'User Management',
    description: 'Create, edit, and manage user accounts. Assign roles, modules, and business unit access.',
    icon: <TeamOutlined />,
    color: REDWOOD.primary,
    path: '/admin/users',
  },
  {
    key: 'approvals',
    title: 'Approval Engine',
    description: 'Configure approval workflows, manage approvers, set amount limits, and track approval history across all modules.',
    icon: <SafetyOutlined />,
    color: '#0572CE',
    path: '/admin/approvals',
  },
  {
    key: 'settings',
    title: 'System Settings',
    description: 'Configure global system parameters, security policies, and application preferences.',
    icon: <SettingOutlined />,
    color: REDWOOD.info,
    badge: 'Coming Soon',
  },
  {
    key: 'security',
    title: 'Security & Audit',
    description: 'View audit trails, manage session policies, and review security events.',
    icon: <SafetyOutlined />,
    color: REDWOOD.success,
    badge: 'Coming Soon',
  },
  {
    key: 'claude-key',
    title: 'Claude AI Key Settings',
    description: 'Add, activate, or rotate the Anthropic Claude API key used by AI agents such as Bank Reconciliation.',
    icon: <RobotOutlined />,
    color: '#722ed1',
    path: '/admin/claude-key',
  },
  {
    key: 'ai-assistant',
    title: 'AI Assistant',
    description: 'RAG-powered chat assistant. Upload manuals and SOPs, then ask questions — or query live ERP data in natural language.',
    icon: <MessageOutlined />,
    color: '#08979c',
    path: '/admin/ai-assistant',
  },
  {
    key: 'gl-account-analysis',
    title: 'GL Account Analysis',
    description: 'Query Oracle GL transactions by account, period, and company. Start the MCP server, configure credentials, and analyze GL balances in real-time.',
    icon: <DollarOutlined />,
    color: '#13c2c2',
    path: '/admin/gl-account-analysis',
  },
  {
    key: 'mcp-registry',
    title: 'MCP Registry',
    description: 'Data-driven MCP tool definitions for Claude Desktop. Add a REST API as a new tool with a registry row — no code, no redeploy.',
    icon: <LinkOutlined />,
    color: '#0572CE',
    path: '/admin/mcp-registry',
  },
  {
    key: 'change-requests',
    title: 'Data Change Requests',
    description: 'Controlled, audited updates to transactional records. Search a transaction, edit specific fields, preview the generated SQL, and execute with full audit trail.',
    icon: <DatabaseOutlined />,
    color: '#C74634',
    path: '/admin/change-requests',
  },
  {
    key: 'brevo-settings',
    title: 'Brevo Email Settings',
    description: 'Configure server-side email delivery via Brevo API. Set the API key, sender address, and whitelist the Oracle Cloud fixed IP in Brevo.',
    icon: <MailOutlined />,
    color: '#0056b3',
    path: '/admin/brevo-settings',
  },
  {
    key: 'release-uploader',
    title: 'Release Uploader',
    description: 'Create and upload new Electron app versions to GitHub Releases. Users can then check for updates and install automatically.',
    icon: <CloudUploadOutlined />,
    color: REDWOOD.primary,
    path: '/admin/releases',
  },
  {
    key: 'mcp-servers',
    title: 'MCP Server Manager',
    description: 'Create and manage MCP (Model Context Protocol) servers to connect Claude with Oracle Fusion SOAP calls and REST APIs. Generate BIP reports and more.',
    icon: <LinkOutlined />,
    color: '#722ed1',
    path: '/admin/mcp-servers',
  },
];

const AdminModule: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleCardClick = (card: AdminCard) => {
    if (card.path) {
      navigate(card.path);
    }
  };

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
              { title: 'Administration' },
            ]}
          />
        </div>

        {/* Main Content */}
        <div style={{ padding: 24 }}>
          {/* Page Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}>
                <SettingOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <div>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                  Administration
                </Title>
                <Text type="secondary">
                  System administration and configuration
                </Text>
              </div>
            </div>

            {/* Admin badge */}
            {user?.isAdmin && (
              <div style={{ marginTop: 12 }}>
                <Tag color="red" style={{ borderRadius: 6, padding: '2px 10px', fontSize: 12 }}>
                  Administrator
                </Tag>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                  Logged in as {user.name}
                </Text>
              </div>
            )}
          </div>

          {/* Admin Cards */}
          <Row gutter={[24, 24]}>
            {adminCards.map((card) => (
              <Col xs={24} sm={12} lg={8} key={card.key}>
                <Card
                  hoverable={!!card.path}
                  onClick={() => handleCardClick(card)}
                  style={{
                    borderRadius: 12,
                    border: `1px solid ${REDWOOD.neutral200}`,
                    cursor: card.path ? 'pointer' : 'default',
                    height: '100%',
                    transition: 'all 0.2s ease',
                    opacity: card.path ? 1 : 0.75,
                  }}
                  styles={{ body: { padding: 24 } }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <Tooltip title={card.description}>
                      <div style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: `${card.color}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: card.color,
                        fontSize: 18,
                        flexShrink: 0,
                        cursor: 'help',
                        transition: 'all 0.2s ease',
                      }}>
                        {card.icon}
                      </div>
                    </Tooltip>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 16, color: REDWOOD.neutral900 }}>
                          {card.title}
                        </Text>
                        {card.badge && (
                          <Tag
                            style={{
                              borderRadius: 4,
                              fontSize: 10,
                              padding: '0 6px',
                              background: REDWOOD.neutral200,
                              border: 'none',
                              color: REDWOOD.neutral600,
                            }}
                          >
                            {card.badge}
                          </Tag>
                        )}
                      </div>
                      <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>
                        {card.description}
                      </Text>
                      {card.path && (
                        <div style={{ marginTop: 12 }}>
                          <Text style={{ color: card.color, fontSize: 13, fontWeight: 500 }}>
                            Open &rarr;
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      </Content>
    </Layout>
  );
};

export default AdminModule;
