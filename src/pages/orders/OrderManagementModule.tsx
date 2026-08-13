import React from 'react';
import { Layout, Breadcrumb, Typography, Card, Row, Col } from 'antd';
import {
  HomeOutlined, ShoppingOutlined, TeamOutlined, DatabaseOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C',
  teal: '#00918A', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  orange: '#C25700',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

interface MenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
  path?: string;
}

const menuItems: MenuItem[] = [
  {
    key: 'orders',
    icon: <ShoppingOutlined />,
    label: 'Sales Orders',
    description: 'Search, view and manage sales orders from Oracle Fusion Order Hub',
    color: REDWOOD.orange,
    path: '/om/orders',
  },
  {
    key: 'customers',
    icon: <TeamOutlined />,
    label: 'Customers',
    description: 'Manage customer accounts, contacts and addresses',
    color: REDWOOD.info,
    path: '/om/customers',
  },
  {
    key: 'inventory',
    icon: <DatabaseOutlined />,
    label: 'On-Hand Inventory',
    description: 'View real-time stock levels, lots and serial numbers',
    color: REDWOOD.teal,
    path: '/inventory/onhand',
  },
];

const TaskCard: React.FC<{ item: MenuItem; onClick: () => void }> = ({ item, onClick }) => (
  <Card
    hoverable={!!item.path}
    onClick={onClick}
    style={{
      borderRadius: 10,
      border: item.path ? `1px solid ${item.color}30` : `1px solid ${REDWOOD.neutral200}`,
      cursor: item.path ? 'pointer' : 'default',
      opacity: item.path ? 1 : 0.6,
      position: 'relative',
      transition: 'box-shadow 0.2s, transform 0.1s',
    }}
    styles={{ body: { padding: '18px 20px' } }}
  >
    {item.path && (
      <div style={{
        position: 'absolute', top: 8, right: 8,
        background: REDWOOD.success, color: '#fff', borderRadius: '50%',
        width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <CheckCircleOutlined style={{ fontSize: 11 }} />
      </div>
    )}
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
        background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}AA 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 20,
        boxShadow: `0 4px 10px ${item.color}35`,
      }}>
        {item.icon}
      </div>
      <div>
        <Text strong style={{ fontSize: 14, color: item.path ? item.color : REDWOOD.neutral900 }}>
          {item.label}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 3 }}>
          {item.description}
        </Text>
      </div>
    </div>
  </Card>
);

const OrderManagementModule: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: 'Order Management' },
          ]} />
        </div>

        <div style={{ padding: 28 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: `linear-gradient(135deg, ${REDWOOD.orange} 0%, #A34800 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 6px 18px ${REDWOOD.orange}45`,
            }}>
              <ShoppingOutlined style={{ fontSize: 28, color: '#fff' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>Order Management</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Sales Orders · Customers · On-Hand Inventory — Oracle Fusion
              </Text>
            </div>
          </div>

          {/* Menu cards */}
          <Text strong style={{ fontSize: 12, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 14 }}>
            ORDER MANAGEMENT
          </Text>
          <Row gutter={[16, 16]}>
            {menuItems.map(item => (
              <Col key={item.key} xs={24} sm={12} lg={8}>
                <TaskCard item={item} onClick={() => item.path && navigate(item.path)} />
              </Col>
            ))}
          </Row>
        </div>
      </Content>
    </Layout>
  );
};

export default OrderManagementModule;
