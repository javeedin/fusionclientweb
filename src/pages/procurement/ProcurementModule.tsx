import React, { useState, useEffect } from 'react';
import { Layout, Breadcrumb, Typography, Card, Row, Col, Input, Button, Form, Alert, Divider, message, Tag, Select, Tooltip, Checkbox } from 'antd';
import { FUSION_INSTANCES, getFusionInstanceKey, setFusionInstanceKey, getFusionInstance } from '../../config/fusionInstance';
import { useAuth } from '../../context/AuthContext';
import {
  HomeOutlined, ShoppingCartOutlined, TeamOutlined, AppstoreOutlined,
  DatabaseOutlined, CheckCircleOutlined, LockOutlined, BugOutlined,
  ApartmentOutlined, BankOutlined, SafetyCertificateOutlined, InboxOutlined,
  DollarOutlined, ReconciliationOutlined, CloudOutlined, HistoryOutlined,
  SwapOutlined, CarOutlined, CheckSquareOutlined, FileSearchOutlined, UploadOutlined, RollbackOutlined,
  RightOutlined, SettingOutlined, ShoppingOutlined, TagsOutlined, ProfileOutlined,
  SyncOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  teal: '#00918A',
};

const CORRECT_PASSWORD = 'MIT12345';
const SESSION_KEY = 'procurement_auth';

interface MenuItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
  path?: string;
  group: string;
}

// Section order + per-section icon/accent for the home page.
const GROUP_ORDER = ['Purchasing', 'Order Management', 'Inventory', 'Costing', 'Setup Data', 'Setups', 'Loading', 'Architecture & Strategy'];
const GROUP_META: Record<string, { icon: React.ReactNode; color: string }> = {
  Purchasing:        { icon: <ShoppingCartOutlined />, color: '#C74634' },
  'Order Management': { icon: <ProfileOutlined />,       color: '#7245A6' },
  Inventory:         { icon: <AppstoreOutlined />,     color: '#0572CE' },
  Costing:           { icon: <DollarOutlined />,        color: '#1D7B4D' },
  Setups:            { icon: <SettingOutlined />,       color: '#B07700' },
  'Setup Data':      { icon: <DatabaseOutlined />,      color: '#0572CE' },
  Loading:           { icon: <UploadOutlined />,        color: '#00918A' },
  'Architecture & Strategy': { icon: <ApartmentOutlined />, color: '#7245A6' },
};

const procurementItems: MenuItemType[] = [
  // ── Purchasing ──────────────────────────────────────────────────────────
  {
    key: 'purchase-orders', group: 'Purchasing',
    icon: <ShoppingCartOutlined />,
    label: 'Purchase Orders',
    description: 'Search, view and manage purchase orders from Oracle Fusion',
    color: REDWOOD.primary,
    path: '/procurement/purchase-orders',
  },
  {
    key: 'suppliers', group: 'Purchasing',
    icon: <TeamOutlined />,
    label: 'Suppliers',
    description: 'Manage supplier records, sites and contacts',
    color: REDWOOD.info,
    path: '/procurement/suppliers',
  },
  // ── Order Management ────────────────────────────────────────────────────
  {
    key: 'sales-orders', group: 'Order Management',
    icon: <ShoppingOutlined />,
    label: 'Sales Orders',
    description: 'Search sales orders and drill into header & lines (Fusion salesOrdersForOrderHub)',
    color: REDWOOD.primary,
    path: '/procurement/sales-orders',
  },
  {
    key: 'customers', group: 'Order Management',
    icon: <TeamOutlined />,
    label: 'Fusion Customers',
    description: 'Search and manage customer records via BIP report',
    color: REDWOOD.teal,
    path: '/procurement/customers',
  },
  {
    key: 'price-list', group: 'Order Management',
    icon: <TagsOutlined />,
    label: 'Price List',
    description: 'Manage and review price lists',
    color: '#7245A6',
    path: '/procurement/price-list',
  },
  // ── Inventory ───────────────────────────────────────────────────────────
  {
    key: 'item-master', group: 'Inventory',
    icon: <AppstoreOutlined />,
    label: 'Item Master',
    description: 'Item catalog with attributes, pricing and flags',
    color: REDWOOD.success,
    path: '/inventory/items',
  },
  {
    key: 'subinventories', group: 'Inventory',
    icon: <ApartmentOutlined />,
    label: 'Subinventories',
    description: 'Warehouse and subinventory hierarchy by business unit',
    color: REDWOOD.teal,
    path: '/inventory/subinventories',
  },
  {
    key: 'on-hand-inventory', group: 'Inventory',
    icon: <DatabaseOutlined />,
    label: 'On-Hand',
    description: 'View current on-hand stock levels by item and location',
    color: REDWOOD.success,
    path: '/inventory/onhand',
  },
  {
    key: 'expected-receipts', group: 'Inventory',
    icon: <InboxOutlined />,
    label: 'Expected PO Receipts',
    description: 'View and manage purchase order lines pending receipt in Oracle Fusion',
    color: REDWOOD.teal,
    path: '/procurement/expected-receipts',
  },
  {
    key: 'create-asn', group: 'Inventory',
    icon: <CarOutlined />,
    label: 'Create ASN',
    description: 'Query a purchase order and create an Advance Shipment Notice (ASN) in Oracle Fusion',
    color: REDWOOD.info,
    path: '/procurement/create-asn',
  },
  {
    key: 'transfer-orders', group: 'Inventory',
    icon: <SwapOutlined />,
    label: 'Transfer Orders',
    description: 'Transfer stock between inventory organizations (search & create via SCO)',
    color: REDWOOD.info,
    path: '/procurement/transfer-orders',
  },
  {
    key: 'supplier-returns', group: 'Inventory',
    icon: <RollbackOutlined />,
    label: 'Supplier Returns',
    description: 'Return received PO quantities to the supplier (Return to Vendor)',
    color: REDWOOD.primary,
    path: '/procurement/supplier-returns',
  },
  {
    key: 'shipment-lines', group: 'Inventory',
    icon: <CarOutlined />,
    label: 'Manage Shipment Lines',
    description: 'Search pending & in-progress shipment lines from Oracle Fusion (shipmentLines)',
    color: REDWOOD.teal,
    path: '/procurement/shipment-lines',
  },
  {
    key: 'confirm-picks', group: 'Inventory',
    icon: <CheckSquareOutlined />,
    label: 'Confirm Picks',
    description: 'Search pick slips and drill into pick lines (Oracle Fusion pickSlipDetails)',
    color: REDWOOD.info,
    path: '/procurement/confirm-picks',
  },
  {
    key: 'inv-completed-txns', group: 'Inventory',
    icon: <FileSearchOutlined />,
    label: 'Review Inventory Completed Transactions',
    description: 'Search completed inventory transactions by organization, item and date',
    color: REDWOOD.warning,
    path: '/procurement/inventory-transactions',
  },
  // ── Costing ─────────────────────────────────────────────────────────────
  {
    key: 'item-costs', group: 'Costing',
    icon: <DollarOutlined />,
    label: 'Item Cost',
    description: 'Search item costs from Oracle Fusion (itemCosts)',
    color: REDWOOD.primary,
    path: '/procurement/item-costs',
  },
  {
    key: 'receipt-costs', group: 'Costing',
    icon: <ReconciliationOutlined />,
    label: 'Receipt Cost',
    description: 'Search receipt costs from Oracle Fusion (receiptCosts)',
    color: REDWOOD.teal,
    path: '/procurement/receipt-costs',
  },
  {
    key: 'cost-management', group: 'Costing',
    icon: <DollarOutlined />,
    label: 'Cost Management',
    description: 'Cost received items — Receipt & Cost Accounting ESS jobs (run & monitor)',
    color: REDWOOD.primary,
    path: '/procurement/cost-management',
  },
  // ── Setups ──────────────────────────────────────────────────────────────
  {
    key: 'business-units', group: 'Setups',
    icon: <BankOutlined />,
    label: 'Business Units',
    description: 'Oracle Fusion business units',
    color: REDWOOD.info,
    path: '/procurement/business-units',
  },
  {
    key: 'legal-entities', group: 'Setups',
    icon: <SafetyCertificateOutlined />,
    label: 'Legal Entities',
    description: 'Legal entity setup and configuration',
    color: REDWOOD.warning,
    path: '/procurement/legal-entities',
  },
  {
    key: 'uat', group: 'Setups',
    icon: <BugOutlined />,
    label: 'UAT / Diagnostics',
    description: 'Automated UAT scripts — fetch live data from Fusion and validate expected values',
    color: '#7c3aed',
    path: '/procurement/uat',
  },
  {
    key: 'login-history', group: 'Setups',
    icon: <HistoryOutlined />,
    label: 'Login History',
    description: 'Oracle Fusion (IDCS) sign-in history via Audit Events',
    color: REDWOOD.info,
    path: '/procurement/login-history',
  },
  // ── Loading ─────────────────────────────────────────────────────────────
  {
    key: 'tb-loading', group: 'Loading',
    icon: <DatabaseOutlined />,
    label: 'Trial Balance',
    description: 'Load trial balance from Excel, filter and review the data',
    color: '#0572CE',
    path: '/procurement/tb-loading',
  },
  {
    key: 'po-loading', group: 'Loading',
    icon: <ShoppingCartOutlined />,
    label: 'Purchase Orders',
    description: 'Load purchase orders from Excel, review, validate & load',
    color: REDWOOD.primary,
    path: '/procurement/po-loading',
  },
  {
    key: 'so-loading', group: 'Loading',
    icon: <ShoppingOutlined />,
    label: 'Sales Orders',
    description: 'Bulk-load sales orders from Excel',
    color: '#7245A6',
    // path omitted until the loader is specified
  },
  {
    key: 'cust-loading', group: 'Loading',
    icon: <TeamOutlined />,
    label: 'Customers',
    description: 'Bulk-load customer records from Excel',
    color: REDWOOD.info,
  },
  {
    key: 'to-loading', group: 'Loading',
    icon: <SwapOutlined />,
    label: 'Transfer Orders',
    description: 'Bulk-load transfer orders from Excel',
    color: REDWOOD.teal,
  },
  {
    key: 'onhand-loading', group: 'Loading',
    icon: <DatabaseOutlined />,
    label: 'Stock Onhand',
    description: 'Search on-hand balances, and load on-hand (receipt) or issue stock out',
    color: REDWOOD.success,
    path: '/procurement/onhand-loading',
  },
  {
    key: 'ar-inv-loading', group: 'Loading',
    icon: <ReconciliationOutlined />,
    label: 'AR Invoices',
    description: 'Bulk-load receivables invoices from Excel',
    color: REDWOOD.warning,
  },
  {
    key: 'suppliers-loading', group: 'Loading',
    icon: <BankOutlined />,
    label: 'Suppliers',
    description: 'Bulk-load supplier records from Excel',
    color: REDWOOD.purple,
  },
  {
    key: 'ap-inv-loading', group: 'Loading',
    icon: <DollarOutlined />,
    label: 'AP Invoices',
    description: 'Bulk-load payables invoices from Excel',
    color: REDWOOD.primary,
  },
  {
    key: 'items-load', group: 'Loading',
    icon: <UploadOutlined />,
    label: 'Items Load',
    description: 'Search items, or bulk-load new items into the master org from a reference item',
    color: REDWOOD.warning,
    path: '/procurement/item-loading',
  },
  // ── Architecture & Strategy ─────────────────────────────────────────────
  {
    key: 'architecture', group: 'Architecture & Strategy',
    icon: <ApartmentOutlined />,
    label: 'Fusion Client Architecture',
    description: 'From single sign-on to fully transactional operations across all modules',
    color: REDWOOD.info,
    path: '/procurement/architecture',
  },
  {
    key: 'parallel-run', group: 'Architecture & Strategy',
    icon: <SyncOutlined />,
    label: 'Parallel Run / UAT Strategy',
    description: 'Automated parallel run, auto-reconciliation with legacy & phased go-live',
    color: '#7245A6',
    path: '/procurement/parallel-run',
  },
  // ── Setup Data (Fusion Setup Data Export explorer) ────────────────
  {
    key: 'setup-data', group: 'Setup Data',
    icon: <DatabaseOutlined />,
    label: 'Setup Data Overview',
    description: 'Upload a Fusion Setup Data Export and see every task + a per-module dashboard',
    color: REDWOOD.info,
    path: '/procurement/setup-data',
  },
  {
    key: 'setup-data-fin', group: 'Setup Data',
    icon: <BankOutlined />,
    label: 'Financials',
    description: 'Financials setup tasks (GL, AP, AR, Tax, Ledger…) from the export',
    color: '#0572CE',
    path: '/procurement/setup-data/financials',
  },
  {
    key: 'setup-data-scm', group: 'Setup Data',
    icon: <AppstoreOutlined />,
    label: 'Supply Chain',
    description: 'Supply Chain / inventory / item setup tasks from the export',
    color: '#00918A',
    path: '/procurement/setup-data/supply-chain',
  },
  {
    key: 'browse-data', group: 'Setup Data',
    icon: <ThunderboltOutlined />,
    label: 'Browse Data',
    description: 'Run read-only GET services & see per-BU / per-module data coverage + an API explorer',
    color: '#C74634',
    path: '/procurement/browse-data',
  },
];

const TaskCard: React.FC<{ item: MenuItemType; onClick: () => void }> = ({ item, onClick }) => (
  <div
    className={`fc-tile${item.path ? '' : ' fc-tile-disabled'}`}
    onClick={item.path ? onClick : undefined}
    style={{ ['--fc-accent' as any]: item.color }}
  >
    <span className="fc-accent" style={{ background: item.color }} />
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px' }}>
      <div className="fc-chip" style={{ background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}bb 100%)`, boxShadow: `0 3px 10px ${item.color}40` }}>
        {item.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text strong style={{ fontSize: 13.5, color: REDWOOD.neutral900, lineHeight: 1.25 }}>{item.label}</Text>
          {!item.path && <Tag style={{ fontSize: 10, lineHeight: '16px', margin: 0, borderRadius: 8 }}>Soon</Tag>}
          {item.path && <RightOutlined className="fc-chev" style={{ marginLeft: 'auto', fontSize: 12, color: item.color }} />}
        </div>
        <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 3, lineHeight: 1.4 }}>
          {item.description}
        </Text>
      </div>
    </div>
  </div>
);

// ── Password Gate ────────────────────────────────────────────────────────────
const PasswordGate: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fusionLoading, setFusionLoading] = useState(false);
  const [instKey, setInstKey] = useState(getFusionInstanceKey());
  const [useCloudLogin, setUseCloudLogin] = useState(false);

  // Switching the POD only changes the base URL + hardcoded credentials the API
  // calls use; endpoints are identical. The base is resolved at module load, so
  // persist the choice and reload to re-resolve it everywhere.
  const changeInstance = (key: string) => {
    setInstKey(key);
    if (key === getFusionInstanceKey()) return;
    const inst = FUSION_INSTANCES.find(i => i.key === key);
    setFusionInstanceKey(key);
    message.success(`Switched to ${inst?.label} — reloading…`);
    setTimeout(() => window.location.reload(), 600);
  };

  // Open the real Oracle Cloud (IDCS) sign-in window. On success, capture the
  // username and unlock the module.
  const handleFusionLogin = async () => {
    const api = (window as any).electronAPI;
    if (!api?.fusionLogin) {
      setError('Fusion login is only available in the desktop app.');
      return;
    }
    setError('');
    setFusionLoading(true);
    try {
      // Sign in to the CURRENTLY-SELECTED instance so its session cookie is
      // established for that POD (calls to a POD you haven't signed into hang).
      const res = await api.fusionLogin(`${getFusionInstance().host}/`);
      if (res?.success) {
        sessionStorage.setItem(SESSION_KEY, 'true');
        if (res.username) {
          sessionStorage.setItem('fusion_user', res.username);
          window.dispatchEvent(new CustomEvent('fusion-user-changed', { detail: res.username }));
        }
        message.success(`Signed in to Oracle Fusion${res.username ? ` as ${res.username}` : ''}`);
        onSuccess();
      } else if (res?.cancelled) {
        setError('Fusion sign-in was cancelled.');
      } else {
        setError(res?.error || 'Fusion sign-in did not complete.');
      }
    } catch (e: any) {
      setError(e?.message || 'Fusion sign-in failed.');
    } finally {
      setFusionLoading(false);
    }
  };

  const handleLogin = () => {
    setLoading(true);
    if (password === CORRECT_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, 'true');
      onSuccess();
    } else {
      setError('Incorrect password. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      background: REDWOOD.neutral100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Card
        style={{
          width: 380,
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          border: `1px solid ${REDWOOD.neutral200}`,
        }}
        styles={{ body: { padding: 36 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: `0 4px 14px ${REDWOOD.primary}40`,
          }}>
            <LockOutlined style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Fusion Supply Chain</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>Enter your access password to continue</Text>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            style={{ marginBottom: 16, borderRadius: 6 }}
            closable
            onClose={() => setError('')}
          />
        )}

        {/* Instance / POD selector — switches base URL + credentials for all groups */}
        <div style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 4 }}>
            <CloudOutlined /> Fusion Instance (POD)
          </Text>
          <Select
            value={instKey}
            onChange={changeInstance}
            size="large"
            style={{ width: '100%' }}
            options={FUSION_INSTANCES.map(i => ({ value: i.key, label: <b>{i.label}</b> }))}
          />
        </div>

        <Form onFinish={handleLogin}>
          <Form.Item style={{ marginBottom: 16 }}>
            <Input.Password
              size="large"
              placeholder="Password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              prefix={<LockOutlined style={{ color: REDWOOD.neutral300 }} />}
              style={{ borderRadius: 6 }}
              onPressEnter={handleLogin}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
            style={{
              background: REDWOOD.primary,
              borderColor: REDWOOD.primary,
              borderRadius: 6,
              fontWeight: 600,
              height: 44,
            }}
          >
            Access Fusion Supply Chain
          </Button>
        </Form>

        <div style={{ marginTop: 16 }}>
          <Checkbox checked={useCloudLogin} onChange={e => setUseCloudLogin(e.target.checked)}>
            Login using Fusion Cloud sign in
          </Checkbox>
          <Tooltip title="Optional — data calls already use the instance's stored credentials. Use this only if you need an interactive Oracle Cloud session for this POD.">
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>(optional)</Text>
          </Tooltip>
        </div>

        {useCloudLogin && (
          <>
            <Divider plain style={{ fontSize: 12, color: REDWOOD.neutral600, margin: '16px 0' }}>Oracle Cloud sign in</Divider>
            <Button
              block
              size="large"
              icon={<CloudOutlined />}
              loading={fusionLoading}
              onClick={handleFusionLogin}
              style={{ height: 44, fontWeight: 600, borderColor: REDWOOD.info, color: REDWOOD.info }}
            >
              Login to Fusion — {getFusionInstance().label}
            </Button>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', textAlign: 'center', marginTop: 8 }}>
              Sign in to <b>{getFusionInstance().label}</b> ({getFusionInstance().host.replace(/^https?:\/\//, '')})
            </Text>
          </>
        )}
      </Card>
    </div>
  );
};

// ── Module Home ───────────────────────────────────────────────────────────────
const ProcurementHome: React.FC = () => {
  const navigate = useNavigate();
  const fusionUser = sessionStorage.getItem('fusion_user');

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: 'Fusion Supply Chain' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 14px ${REDWOOD.primary}40`,
            }}>
              <ShoppingCartOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>Fusion Supply Chain</Title>
                {fusionUser && (
                  <Tag icon={<CloudOutlined />} color="green" style={{ fontWeight: 600, fontSize: 12 }}>
                    {fusionUser}
                  </Tag>
                )}
              </div>
              <Text type="secondary">Interface to query and perform transactions in Oracle Fusion</Text>
            </div>
          </div>

          <style>{`
            .fc-tile { position: relative; background: ${REDWOOD.surface}; border: 1px solid ${REDWOOD.neutral200};
              border-radius: 12px; overflow: hidden; cursor: pointer; height: 100%;
              transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
            .fc-tile:hover { transform: translateY(-3px); box-shadow: 0 10px 26px rgba(0,0,0,0.10);
              border-color: var(--fc-accent); }
            .fc-tile .fc-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
              opacity: 0; transition: opacity .18s ease; }
            .fc-tile:hover .fc-accent { opacity: 1; }
            .fc-tile .fc-chip { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
              display: flex; align-items: center; justify-content: center; color: #fff; font-size: 19px;
              transition: transform .18s ease; }
            .fc-tile:hover .fc-chip { transform: scale(1.06) rotate(-3deg); }
            .fc-tile .fc-chev { opacity: 0; transition: opacity .18s ease, transform .18s ease; }
            .fc-tile:hover .fc-chev { opacity: 1; transform: translateX(3px); }
            .fc-tile-disabled { cursor: default; opacity: .6; }
            .fc-tile-disabled:hover { transform: none; box-shadow: none; border-color: ${REDWOOD.neutral200}; }
            .fc-tile-disabled:hover .fc-chip { transform: none; }
          `}</style>

          {GROUP_ORDER.map(group => {
            const items = procurementItems.filter(i => i.group === group);
            if (items.length === 0) return null;
            const meta = GROUP_META[group] ?? { icon: null, color: REDWOOD.primary };
            const active = items.filter(i => i.path).length;
            return (
              <div key={group} style={{ marginBottom: 26 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: meta.color + '18', color: meta.color, fontSize: 15,
                  }}>{meta.icon}</span>
                  <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group}</Text>
                  <Tag style={{ borderRadius: 10, border: 'none', background: meta.color + '18', color: meta.color, fontSize: 11, fontWeight: 600 }}>{active}</Tag>
                  <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${meta.color}30, transparent)` }} />
                </div>
                <Row gutter={[14, 14]}>
                  {items.map(item => (
                    <Col key={item.key} xs={24} sm={12} lg={8}>
                      <TaskCard item={item} onClick={() => item.path && navigate(item.path)} />
                    </Col>
                  ))}
                </Row>
              </div>
            );
          })}
        </div>
      </Content>
    </Layout>
  );
};

// ── Main Export with Password Gate ───────────────────────────────────────────
const ProcurementModule: React.FC = () => {
  const { isAuthenticated } = useAuth();
  // If already logged into ERP, skip password gate
  const [authenticated, setAuthenticated] = useState(
    () => isAuthenticated || sessionStorage.getItem(SESSION_KEY) === 'true'
  );

  // Store in sessionStorage for consistency
  useEffect(() => {
    if (authenticated) {
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }, [authenticated]);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return <ProcurementHome />;
};

export default ProcurementModule;
