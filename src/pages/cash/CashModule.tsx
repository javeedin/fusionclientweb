import React from 'react';
import { Layout, Breadcrumb, Typography, Card, Row, Col } from 'antd';
import {
  HomeOutlined, BankOutlined, SwapOutlined, ReconciliationOutlined,
  BarChartOutlined, FileTextOutlined, SettingOutlined, CheckCircleOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D',
  warning: '#D4A800', neutral100: '#F7F7F7', neutral200: '#E5E5E5',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

interface MenuItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
  path?: string;
}

const transferItems: MenuItemType[] = [
  { key: 'manage-transfers',    icon: <SwapOutlined />,    label: 'Manage Bank Account Transfers', description: 'Search, create and manage interbank fund transfers', color: REDWOOD.info,    path: '/cash/bank-transfers' },
  { key: 'external-txns',       icon: <FileTextOutlined />, label: 'Manage External Transactions',  description: 'Search and create external cash transactions',       color: REDWOOD.success, path: '/cash/external-transactions' },
  { key: 'manage-payees',       icon: <TeamOutlined />,     label: 'Manage Payees',                 description: 'Create and manage ad-hoc payees and bank accounts',  color: REDWOOD.primary, path: '/cash/payees' },
  { key: 'manage-banks',        icon: <BankOutlined />,     label: 'Banks & Accounts',              description: 'View banks, branches and bank accounts',             color: REDWOOD.info },
];

const reconItems: MenuItemType[] = [
  { key: 'bank-statements',  icon: <FileTextOutlined />,       label: 'Manage Bank Statements',     description: 'Import, create and review bank statements',  color: REDWOOD.info,    path: '/cash/bank-statements' },
  { key: 'reconciliation',   icon: <ReconciliationOutlined />, label: 'Bank Reconciliation',        description: 'Reconcile bank statements with system',       color: REDWOOD.primary, path: '/cash/bank-reconciliation' },
  { key: 'transaction-codes', icon: <SettingOutlined />,        label: 'Transaction Codes',          description: 'Maintain bank statement transaction codes',   color: REDWOOD.warning, path: '/cash/transaction-codes' },
  { key: 'pdf-templates',    icon: <FileTextOutlined />,       label: 'PDF Statement Templates',    description: 'Design templates for parsing PDF bank statements', color: REDWOOD.info,   path: '/cash/pdf-templates' },
];

const reportItems: MenuItemType[] = [
  { key: 'cash-position',   icon: <BarChartOutlined />, label: 'Cash Position',  description: 'View current cash balances by account',    color: REDWOOD.success },
  { key: 'cash-forecast',   icon: <BarChartOutlined />, label: 'Cash Forecast',  description: 'Projected cash flows and requirements',     color: REDWOOD.warning },
];

const TaskCard: React.FC<{ item: MenuItemType; onClick: () => void }> = ({ item, onClick }) => (
  <Card
    hoverable={!!item.path}
    onClick={onClick}
    style={{
      borderRadius: 8,
      border: item.path ? `1px solid ${REDWOOD.success}30` : `1px solid ${REDWOOD.neutral200}`,
      cursor: item.path ? 'pointer' : 'default',
      opacity: item.path ? 1 : 0.6,
      position: 'relative',
    }}
    styles={{ body: { padding: '14px 16px' } }}
  >
    {item.path && (
      <div style={{
        position: 'absolute', top: 6, right: 6,
        background: REDWOOD.success, color: '#fff',
        borderRadius: '50%', width: 16, height: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <CheckCircleOutlined style={{ fontSize: 10 }} />
      </div>
    )}
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
        background: item.color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: item.color, fontSize: 18,
      }}>
        {item.icon}
      </div>
      <div>
        <Text strong style={{ fontSize: 13, color: item.path ? item.color : REDWOOD.neutral900 }}>
          {item.label}
        </Text>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
          {item.description}
        </Text>
      </div>
    </div>
  </Card>
);

const TaskSection: React.FC<{ title: string; items: MenuItemType[] }> = ({ title, items }) => {
  const navigate = useNavigate();
  return (
    <div style={{ marginBottom: 24 }}>
      <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 10 }}>
        {title}
      </Text>
      <Row gutter={[12, 12]}>
        {items.map(item => (
          <Col key={item.key} xs={24} sm={12} lg={8}>
            <TaskCard item={item} onClick={() => item.path && navigate(item.path)} />
          </Col>
        ))}
      </Row>
    </div>
  );
};

const CashModule: React.FC = () => (
  <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
    <Content>
      <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
        <Breadcrumb items={[
          { title: <Link to="/home"><HomeOutlined /> Home</Link> },
          { title: 'Cash Management' },
        ]} />
      </div>

      <div style={{ padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12,
            background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #0450A0 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 14px ${REDWOOD.info}40`,
          }}>
            <BankOutlined style={{ fontSize: 26, color: '#fff' }} />
          </div>
          <div>
            <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>Cash Management</Title>
            <Text type="secondary">Bank accounts, transfers, reconciliation and cash reporting</Text>
          </div>
        </div>

        <TaskSection title="Transfers" items={transferItems} />
        <TaskSection title="Reconciliation" items={reconItems} />
        <TaskSection title="Reports" items={reportItems} />
      </div>
    </Content>
  </Layout>
);

export default CashModule;
