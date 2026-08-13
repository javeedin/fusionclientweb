import React, { useState } from 'react';
import { Layout, Typography, Card, Breadcrumb, Row, Col, Statistic } from 'antd';
import {
  HomeOutlined,
  FileTextOutlined,
  HomeOutlined as BuildingOutlined,
  TeamOutlined,
  DollarOutlined,
  BarChartOutlined,
  FileAddOutlined,
  SearchOutlined,
  KeyOutlined,
  ToolOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  FileProtectOutlined,
  UserOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import FloatingMenu from '../../components/FloatingMenu';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:     '#C74634',
  primaryLight:'#E85D4A',
  success:     '#1D7B4D',
  warning:     '#D4A800',
  info:        '#0572CE',
  neutral100:  '#F7F7F7',
  neutral200:  '#E5E5E5',
  neutral600:  '#6B6B6B',
  neutral900:  '#1A1A1A',
  surface:     '#FFFFFF',
  rmTeal:      '#0B6E6E',
  rmGold:      '#B8860B',
};

interface MenuItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  color?: string;
  path?: string;
}

const agreementItems: MenuItemType[] = [
  { key: 'create-agreement', icon: <FileAddOutlined />, label: 'Create Agreement',    description: 'New rental agreement',          color: REDWOOD.info,    path: '/rm/agreements/new' },
  { key: 'manage-agreements',icon: <FileTextOutlined />,label: 'Manage Agreements',   description: 'Search and manage agreements',   color: REDWOOD.primary, path: '/rm/agreements' },
  { key: 'expiring',         icon: <ClockCircleOutlined />, label: 'Expiring Soon',   description: 'Agreements expiring in 90 days', color: REDWOOD.warning  },
  { key: 'renewals',         icon: <FileProtectOutlined />, label: 'Renewals',         description: 'Process agreement renewals',     color: REDWOOD.success  },
];

const paymentItems: MenuItemType[] = [
  { key: 'installments',     icon: <DollarOutlined />,  label: 'Installments',        description: 'View & update cheque status',    color: REDWOOD.info    },
  { key: 'bounced',          icon: <CloseCircleOutlined />, label: 'Bounced Cheques', description: 'Handle bounced cheques',          color: REDWOOD.primary },
  { key: 'cleared',          icon: <CheckCircleOutlined />, label: 'Cleared Payments',description: 'Cleared payment history',         color: REDWOOD.success },
  { key: 'receipts',         icon: <FileTextOutlined />, label: 'Receipts',            description: 'Print payment receipts',         color: REDWOOD.rmTeal  },
];

const propertyItems: MenuItemType[] = [
  { key: 'properties',       icon: <AppstoreOutlined />, label: 'Property List',       description: 'All properties',                color: REDWOOD.info,    path: '/rm/properties' },
  { key: 'available',        icon: <KeyOutlined />,      label: 'Available Units',     description: 'Units ready to rent',           color: REDWOOD.success  },
  { key: 'maintenance',      icon: <ToolOutlined />,     label: 'Under Maintenance',   description: 'Properties in maintenance',      color: REDWOOD.warning  },
];

const tenantItems: MenuItemType[] = [
  { key: 'customers',        icon: <TeamOutlined />,     label: 'Tenants / Customers', description: 'Customer master list',          color: REDWOOD.info,    path: '/rm/customers' },
  { key: 'brokers',          icon: <UserOutlined />,     label: 'Brokers',             description: 'Broker / agent list',           color: REDWOOD.rmTeal  },
];

const expenseItems: MenuItemType[] = [
  { key: 'expenses',         icon: <DollarOutlined />,   label: 'Property Expenses',   description: 'All property expenses',         color: REDWOOD.info,    path: '/rm/expenses' },
  { key: 'add-expense',      icon: <FileAddOutlined />,  label: 'Record Expense',       description: 'Add maintenance / utility cost',color: REDWOOD.primary },
];

const reportItems: MenuItemType[] = [
  { key: 'revenue-report',   icon: <BarChartOutlined />, label: 'Revenue Report',      description: 'Monthly revenue by property',   color: REDWOOD.success },
  { key: 'occupancy',        icon: <BarChartOutlined />, label: 'Occupancy Report',    description: 'Occupancy rates over time',      color: REDWOOD.info    },
  { key: 'pdc-report',       icon: <FileTextOutlined />, label: 'PDC Status Report',   description: 'Post-dated cheque status',       color: REDWOOD.warning },
];

interface TaskMenuProps {
  title: string;
  color: string;
  items: MenuItemType[];
  onItemClick: (item: MenuItemType) => void;
}

const TaskMenu: React.FC<TaskMenuProps> = ({ title, color, items, onItemClick }) => (
  <div style={{ marginBottom: 24 }}>
    <div style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: 1.2, color, marginBottom: 8, paddingLeft: 4,
    }}>
      {title}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map(item => (
        <div
          key={item.key}
          onClick={() => onItemClick(item)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = REDWOOD.neutral100)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ color: item.color || color, fontSize: 16, width: 20, textAlign: 'center' }}>
            {item.icon}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: REDWOOD.neutral900 }}>{item.label}</div>
            {item.description && (
              <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{item.description}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const KPICard: React.FC<{ label: string; value: number | string; color: string; icon: React.ReactNode; suffix?: string }> = ({ label, value, color, icon, suffix = '' }) => (
  <Card style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}` }} bodyStyle={{ padding: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
        <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 2 }}>{value}{suffix}</div>
      </div>
      <span style={{ fontSize: 28, color, opacity: 0.25 }}>{icon}</span>
    </div>
  </Card>
);

const RMModule: React.FC = () => {
  const navigate = useNavigate();

  const handleItemClick = (item: MenuItemType) => {
    if (item.path) navigate(item.path);
  };

  return (
    <Layout style={{ background: REDWOOD.neutral100, minHeight: 'calc(100vh - 64px)' }}>
      <Content style={{ padding: '24px 32px' }}>
        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 20 }}>
          <Breadcrumb.Item><Link to="/home"><HomeOutlined /></Link></Breadcrumb.Item>
          <Breadcrumb.Item style={{ color: REDWOOD.rmTeal, fontWeight: 600 }}>Rental Management</Breadcrumb.Item>
        </Breadcrumb>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>
            <KeyOutlined style={{ color: REDWOOD.rmTeal, marginRight: 10 }} />
            Rental Management — Dubai
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            End-to-end property rental management · agreements · installments · revenue recognition
          </Text>
        </div>

        {/* KPI Row */}
        <Row gutter={16} style={{ marginBottom: 28 }}>
          <Col xs={24} sm={12} lg={6}><KPICard label="Active Agreements"  value={0} color={REDWOOD.success} icon={<FileTextOutlined />} /></Col>
          <Col xs={24} sm={12} lg={6}><KPICard label="Properties Rented"  value={0} color={REDWOOD.info}    icon={<BuildingOutlined />} /></Col>
          <Col xs={24} sm={12} lg={6}><KPICard label="PDC Pending"        value={0} color={REDWOOD.warning} icon={<DollarOutlined />} /></Col>
          <Col xs={24} sm={12} lg={6}><KPICard label="Expiring in 90d"   value={0} color={REDWOOD.primary} icon={<ClockCircleOutlined />} /></Col>
        </Row>

        {/* Task Menu Grid */}
        <Row gutter={24}>
          {/* Left panel */}
          <Col xs={24} lg={8}>
            <Card style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 16 }}>
              <TaskMenu title="Agreements"  color={REDWOOD.info}    items={agreementItems}  onItemClick={handleItemClick} />
              <TaskMenu title="Payments"    color={REDWOOD.success} items={paymentItems}    onItemClick={handleItemClick} />
            </Card>
          </Col>

          {/* Center panel */}
          <Col xs={24} lg={8}>
            <Card style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 16 }}>
              <TaskMenu title="Properties"  color={REDWOOD.rmTeal}  items={propertyItems}  onItemClick={handleItemClick} />
              <TaskMenu title="Tenants"     color={REDWOOD.primary} items={tenantItems}    onItemClick={handleItemClick} />
            </Card>
          </Col>

          {/* Right panel */}
          <Col xs={24} lg={8}>
            <Card style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 16 }}>
              <TaskMenu title="Expenses"    color={REDWOOD.warning} items={expenseItems}   onItemClick={handleItemClick} />
              <TaskMenu title="Reports"     color={REDWOOD.rmGold}  items={reportItems}    onItemClick={handleItemClick} />
            </Card>
          </Col>
        </Row>
      </Content>
      
      <FloatingMenu />
    </Layout>
  );
};

export default RMModule;
