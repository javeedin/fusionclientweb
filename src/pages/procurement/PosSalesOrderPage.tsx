// ── POS Sales Order page ─────────────────────────────────────────────────────
// Standalone POS page (Supply Chain → Order Management → POS Sales Order).
// Step 1: Register New Order (same modal the order editor uses) sets the
// customer/BU/warehouse. Step 2: the POS screen — barcode scanning, ticket
// lines, totals, Complete Sale. Customer stays hidden behind the 👤 icon.
import React, { useState } from 'react';
import { Layout, Breadcrumb, Typography, Button, Tag, Space } from 'antd';
import { HomeOutlined, BarcodeOutlined, UserAddOutlined, UserSwitchOutlined, ShoppingOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { RegisterOrderModal, type OrderHeader, type NewLine } from './SalesOrders';
import PosSalesOrder from './PosSalesOrder';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', dark: '#1A1A1A', success: '#1D7B4D',
  n100: '#F7F7F7', n200: '#E5E5E5', n600: '#6B6B6B', n900: '#1A1A1A', surface: '#FFFFFF',
};

const PosSalesOrderPage: React.FC = () => {
  const [header, setHeader] = useState<OrderHeader | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [posKey, setPosKey] = useState(0); // remount POS on customer change
  const navigate = useNavigate();

  const openDraftInEditor = (draft: { header: OrderHeader; lines: NewLine[] }) =>
    navigate('/procurement/sales-orders', { state: { posDraft: draft } });

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.n100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.n200}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <Breadcrumb items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/procurement">Fusion Supply Chain</Link> },
              { title: <Link to="/procurement/sales-orders">Sales Orders</Link> },
              { title: 'POS Sales Order' },
            ]} />
            <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarcodeOutlined style={{ color: REDWOOD.primary }} /> POS Sales Order
              <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— scan-to-sell point of sale (Fusion salesOrdersForOrderHub)</Text>
            </Title>
          </div>
          {header && (
            <Space>
              <Tag color="volcano" style={{ fontSize: 12, padding: '2px 10px' }}>{header.businessUnit}</Tag>
              <Button icon={<UserSwitchOutlined />} onClick={() => setRegisterOpen(true)}>Change Customer</Button>
            </Space>
          )}
        </div>

        <div style={{ padding: '14px 20px' }}>
          {!header ? (
            // ── Landing: register the customer first ──
            <div style={{ maxWidth: 620, margin: '60px auto', textAlign: 'center' }}>
              <div style={{ background: REDWOOD.dark, borderRadius: 18, padding: '46px 36px', boxShadow: '0 6px 24px rgba(0,0,0,0.22)' }}>
                <span style={{ display: 'inline-flex', width: 88, height: 88, borderRadius: 22, background: REDWOOD.primary, color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 46 }}>
                  <BarcodeOutlined />
                </span>
                <div style={{ color: '#fff', fontSize: 24, fontWeight: 800, marginTop: 20, letterSpacing: '0.03em' }}>Point of Sale</div>
                <div style={{ color: '#bbb', fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>
                  Register the order first — business unit, customer, warehouse.<br />
                  Then scan barcodes to build the ticket: each scan adds the item with qty 1.
                </div>
                <Button type="primary" size="large" icon={<UserAddOutlined />} onClick={() => setRegisterOpen(true)}
                  style={{ marginTop: 26, height: 52, fontSize: 16, fontWeight: 700, padding: '0 36px', background: REDWOOD.primary, borderColor: REDWOOD.primary, borderRadius: 10 }}>
                  Register New Order
                </Button>
                <div style={{ marginTop: 18 }}>
                  <Link to="/procurement/sales-orders" style={{ color: '#888', fontSize: 12 }}>
                    <ShoppingOutlined /> Back to Sales Orders
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <PosSalesOrder key={posKey} header={header} onOpenDraft={openDraftInEditor} />
          )}
        </div>

        <RegisterOrderModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          onProceed={(h) => { setHeader(h); setPosKey(k => k + 1); }}
        />
      </Content>
    </Layout>
  );
};

export default PosSalesOrderPage;
