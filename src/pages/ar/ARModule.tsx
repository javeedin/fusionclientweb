import React from 'react';
import { Layout, Typography, Card, Breadcrumb, Row, Col, Space } from 'antd';
import {
  HomeOutlined,
  FileTextOutlined,
  TeamOutlined,
  DollarOutlined,
  BankOutlined,
  EyeOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import FloatingMenu from '../../components/FloatingMenu';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  taskBlue:   '#0572CE',
  surface:    '#FFFFFF',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral900: '#1A1A1A',
  neutral600: '#6B6B6B',
};

const tasks = [
  {
    key: 'manage-receivables',
    icon: <FileTextOutlined style={{ fontSize: 28, color: REDWOOD.primary }} />,
    label: 'Manage Receivable Invoices',
    description: 'Create and manage AR invoices and transactions',
    path: '/ar/manage-receivables',
  },
  {
    key: 'manage-customers',
    icon: <TeamOutlined style={{ fontSize: 28, color: REDWOOD.primary }} />,
    label: 'Manage Customers',
    description: 'View and manage customer accounts',
    path: '/ar/manage-customers',
  },
  {
    key: 'manage-receipts',
    icon: <DollarOutlined style={{ fontSize: 28, color: REDWOOD.success }} />,
    label: 'Manage Receipts',
    description: 'Search and manage cash receipts',
    path: '/ar/manage-receipts',
  },
  {
    key: 'manage-adjustments',
    icon: <FileTextOutlined style={{ fontSize: 28, color: REDWOOD.info }} />,
    label: 'Manage Adjustments',
    description: 'Search and view AR adjustments',
    path: '/ar/manage-adjustments',
  },
  {
    key: 'manage-credit-memos',
    icon: <FileTextOutlined style={{ fontSize: 28, color: REDWOOD.warning }} />,
    label: 'Manage Credit Memos',
    description: 'Search and view AR credit memos',
    path: '/ar/manage-credit-memos',
  },
  {
    key: 'sync-cm-applications',
    icon: <BankOutlined style={{ fontSize: 28, color: REDWOOD.info }} />,
    label: 'Sync CM Applications',
    description: 'Sync credit memo applications per customer from Oracle Fusion',
    path: '/ar/sync-cm-applications',
  },
  {
    key: 'customer-site-activities',
    icon: <EyeOutlined style={{ fontSize: 28, color: REDWOOD.primary }} />,
    label: 'Customer Site Activities',
    description: 'View receivables activity by customer account site',
    path: '/ar/customer-site-activities',
  },
  {
    key: 'revenue-recognition',
    icon: <CalendarOutlined style={{ fontSize: 28, color: REDWOOD.success }} />,
    label: 'Revenue Recognition',
    description: 'Generate monthly revenue schedules from rental contracts',
    path: '/ar/revenue-recognition',
  },
];

const ARModule: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content>

        {/* Breadcrumb bar */}
        <div style={{
          padding: '16px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /> Home</Link> },
            { title: 'Accounts Receivable' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Page title — matches Payables style */}
          <div style={{ marginBottom: 24 }}>
            <Space align="center">
              <div style={{
                width: 56, height: 56, borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #E85D4A 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}>
                <BankOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <div>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                  Accounts Receivable
                </Title>
                <Text type="secondary">Manage invoices, customers and receipts</Text>
              </div>
            </Space>
          </div>

          {/* Task Cards */}
          <Row gutter={[16, 16]}>
            {tasks.map(task => (
              <Col xs={24} sm={12} md={8} key={task.key}>
                <Card
                  hoverable
                  onClick={() => navigate(task.path)}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${REDWOOD.neutral200}`,
                    cursor: 'pointer',
                  }}
                  bodyStyle={{ padding: 24 }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 10,
                      background: REDWOOD.neutral100,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {task.icon}
                    </div>
                    <div>
                      <Text strong style={{ fontSize: 15, color: REDWOOD.neutral900, display: 'block' }}>
                        {task.label}
                      </Text>
                      <Text style={{ fontSize: 13, color: REDWOOD.neutral600 }}>
                        {task.description}
                      </Text>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>

      </Content>
      <FloatingMenu />
      
    </Layout>
  );
};

export default ARModule;

