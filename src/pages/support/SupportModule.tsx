import React from 'react';
import { Layout, Breadcrumb, Typography, Card, Row, Col } from 'antd';
import {
  HomeOutlined, BugOutlined, UnorderedListOutlined, UserOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warning: '#D4A800',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', surface: '#FFFFFF', neutral900: '#1A1A1A',
};

const items = [
  {
    key: 'my-tickets',
    icon: <UserOutlined />,
    label: 'My Tickets',
    description: 'View and track your own submitted tickets',
    color: REDWOOD.info,
    path: '/support/my-tickets',
  },
  {
    key: 'tickets',
    icon: <UnorderedListOutlined />,
    label: 'Manage Tickets',
    description: 'Search, assign, update and resolve all support tickets',
    color: REDWOOD.primary,
    path: '/support/tickets',
  },
  {
    key: 'raise',
    icon: <BugOutlined />,
    label: 'Raise a Ticket',
    description: 'Use the bug icon in the toolbar from any page to report an issue',
    color: REDWOOD.warning,
    path: null,
  },
];

const SupportModule: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: 'Support' },
          ]} />
        </div>

        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <BugOutlined style={{ fontSize: 22, color: REDWOOD.primary }} />
            <Title level={4} style={{ margin: 0 }}>Support & Ticketing</Title>
          </div>

          <Row gutter={[16, 16]}>
            {items.map(item => (
              <Col key={item.key} xs={24} sm={12} lg={8}>
                <Card
                  hoverable={!!item.path}
                  onClick={() => item.path && navigate(item.path)}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${REDWOOD.neutral200}`,
                    cursor: item.path ? 'pointer' : 'default',
                    opacity: item.path ? 1 : 0.6,
                    borderTop: `3px solid ${item.color}`,
                  }}
                  styles={{ body: { padding: '16px 20px' } }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                      background: item.color + '18',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: item.color, fontSize: 20,
                    }}>
                      {item.icon}
                    </div>
                    <div>
                      <Text strong style={{ fontSize: 14, color: item.path ? item.color : REDWOOD.neutral900, display: 'block', marginBottom: 4 }}>
                        {item.label}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.description}
                      </Text>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>

          <div style={{ marginTop: 32, padding: '16px 20px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8 }}>
            <Text strong style={{ fontSize: 13 }}>Tip</Text>
            <Text style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
              Use the <BugOutlined style={{ color: REDWOOD.primary }} /> button in the top toolbar to raise a ticket
              from any page — it automatically captures which module and page you are on.
            </Text>
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default SupportModule;
