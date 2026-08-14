import React from 'react';
import { Layout, Breadcrumb, Typography, Card, Row, Col, Tag, Space } from 'antd';
import {
  HomeOutlined, ApartmentOutlined, CloudOutlined, LockOutlined, ApiOutlined,
  DesktopOutlined, DatabaseOutlined, ThunderboltOutlined, SafetyCertificateOutlined,
  ShoppingCartOutlined, ProfileOutlined, AppstoreOutlined, DollarOutlined,
  SettingOutlined, UploadOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const R = {
  primary: '#C74634', primaryDark: '#A33B2C', success: '#1D7B4D', warning: '#B07700',
  info: '#0572CE', teal: '#00918A', purple: '#7245A6',
  n100: '#F7F7F7', n200: '#E5E5E5', n300: '#C7C7C7', n600: '#6B6B6B', n900: '#1A1A1A', surface: '#FFF',
};

// A layer band in the architecture stack.
const Layer: React.FC<{ color: string; icon: React.ReactNode; title: string; subtitle: string; children?: React.ReactNode }> =
  ({ color, icon, title, subtitle, children }) => (
  <div style={{ position: 'relative', border: `1px solid ${color}44`, borderRadius: 12, background: `linear-gradient(180deg, ${color}0c, ${color}03)`, padding: '14px 16px' }}>
    <div style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 4, borderRadius: 4, background: color }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: children ? 12 : 0 }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div>
        <Text strong style={{ fontSize: 14.5, color: R.n900 }}>{title}</Text>
        <div style={{ fontSize: 12, color: R.n600 }}>{subtitle}</div>
      </div>
    </div>
    {children}
  </div>
);

const Chip: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: color + '15', color, fontSize: 12, fontWeight: 600, border: `1px solid ${color}30` }}>{children}</span>
);

const Arrow: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
    <span style={{ color: R.n300, fontSize: 20, lineHeight: 1 }}>↓</span>
  </div>
);

const MODULES = [
  { icon: <ShoppingCartOutlined />, name: 'Purchasing', color: R.primary, items: ['Purchase Orders', 'Expected Receipts', 'Suppliers', 'PO Life Cycle'] },
  { icon: <ProfileOutlined />, name: 'Order Management', color: R.purple, items: ['Sales Orders', 'Order Totals', 'Price List'] },
  { icon: <AppstoreOutlined />, name: 'Inventory', color: R.info, items: ['Transfer Orders', 'Shipment Lines', 'Confirm Picks', 'On-Hand', 'Completed Txns'] },
  { icon: <DollarOutlined />, name: 'Costing', color: R.success, items: ['Item Cost', 'Receipt Cost', 'Cost Management'] },
  { icon: <SettingOutlined />, name: 'Setups', color: R.warning, items: ['Business Units', 'Legal Entities', 'UAT / Diagnostics'] },
  { icon: <UploadOutlined />, name: 'Loading', color: R.teal, items: ['PO / SO / AR / AP', 'Customers · Suppliers', 'Stock On-Hand'] },
];

const TXN = [
  { verb: 'POST', res: 'supplyRequests', use: 'Create transfer orders (SCO)' },
  { verb: 'POST', res: 'pickWaves', use: 'Pick release shipment lines' },
  { verb: 'POST', res: 'pickTransactions', use: 'Confirm picks (lot / serial)' },
  { verb: 'POST', res: 'shippingTransactions', use: 'Ship confirm' },
  { verb: 'GET', res: 'salesOrdersForOrderHub', use: 'Query orders, lines & totals' },
  { verb: 'GET', res: 'itemCosts · receiptCosts', use: 'Costing analytics' },
];

const FusionArchitecture: React.FC = () => (
  <Layout style={{ minHeight: 'calc(100vh - 64px)', background: R.n100 }}>
    <Content>
      <div style={{ padding: '12px 24px', background: R.surface, borderBottom: `1px solid ${R.n200}` }}>
        <Breadcrumb items={[
          { title: <Link to="/home"><HomeOutlined /> Home</Link> },
          { title: <Link to="/procurement">Fusion Supply Chain</Link> },
          { title: 'Architecture' },
        ]} />
        <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ApartmentOutlined style={{ color: R.primary }} /> Fusion Client Architecture
          <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— from single sign-on to fully transactional operations across modules</Text>
        </Title>
      </div>

      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {/* Intro */}
        <Card style={{ borderRadius: 12, border: `1px solid ${R.n200}`, marginBottom: 20 }}>
          <Paragraph style={{ fontSize: 14, marginBottom: 8 }}>
            <Text strong>Fusion Client</Text> is a thin, secure front-end that talks directly to <Text strong>Oracle Fusion Cloud</Text> over its
            published <Text strong>REST APIs</Text>. There is no middle database and no custom back-end to maintain — every screen reads and writes
            live Fusion data, so what you see is always the system of record.
          </Paragraph>
          <Space wrap size={8}>
            <Chip color={R.info}><DesktopOutlined /> React + TypeScript · Ant Design</Chip>
            <Chip color={R.teal}><CloudOutlined /> Electron desktop &amp; web</Chip>
            <Chip color={R.primary}><ApiOutlined /> Oracle Fusion REST (fscmRestApi)</Chip>
            <Chip color={R.success}><ThunderboltOutlined /> Query <b>&amp;</b> transact</Chip>
          </Space>
        </Card>

        {/* Layered architecture diagram */}
        <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>End-to-end flow</Title>
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 24 }}>
          <Layer color={R.purple} icon={<LockOutlined />} title="1 · Single Sign-On" subtitle="Oracle Cloud (IDCS) identity — the same credentials as Fusion">
            <Space wrap size={8}>
              <Chip color={R.purple}><SafetyCertificateOutlined /> IDCS OAuth sign-in (desktop)</Chip>
              <Chip color={R.purple}>Session captures the Fusion user</Chip>
              <Chip color={R.purple}>Basic auth for REST calls</Chip>
            </Space>
          </Layer>
          <Arrow />
          <Layer color={R.info} icon={<DesktopOutlined />} title="2 · Presentation (Fusion Client UI)" subtitle="Module home → task pages → dialogs, all in the browser / Electron shell">
            <Space wrap size={8}>
              <Chip color={R.info}>Search &amp; filter grids</Chip>
              <Chip color={R.info}>Drill-down dialogs</Chip>
              <Chip color={R.info}>Excel load &amp; validate</Chip>
              <Chip color={R.info}>PDF print</Chip>
            </Space>
          </Layer>
          <Arrow />
          <Layer color={R.teal} icon={<ApiOutlined />} title="3 · Service / Connectivity" subtitle="Direct HTTPS in the desktop app; a dev proxy in the browser (no CORS)">
            <Space wrap size={8}>
              <Chip color={R.teal}>fetch + pagination (limit / offset)</Chip>
              <Chip color={R.teal}>Concurrency-limited fan-out</Chip>
              <Chip color={R.teal}>Child-link expansion</Chip>
            </Space>
          </Layer>
          <Arrow />
          <Layer color={R.primary} icon={<CloudOutlined />} title="4 · Oracle Fusion Cloud REST API" subtitle="fscmRestApi/resources — the same services Oracle uses internally">
            <Space wrap size={8}>
              <Chip color={R.primary}>Resources &amp; child collections</Chip>
              <Chip color={R.primary}>SQL-style query (q=…)</Chip>
              <Chip color={R.primary}>GET reads · POST transactions</Chip>
            </Space>
          </Layer>
          <Arrow />
          <Layer color={R.success} icon={<DatabaseOutlined />} title="5 · Fusion Cloud System of Record" subtitle="Purchasing · Inventory · Costing · Order Management · Receivables · Payables" />
        </div>

        {/* Modules */}
        <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>Modules covered</Title>
        <Row gutter={[14, 14]} style={{ marginBottom: 24 }}>
          {MODULES.map(m => (
            <Col key={m.name} xs={24} sm={12} lg={8}>
              <Card size="small" style={{ borderRadius: 12, border: `1px solid ${R.n200}`, height: '100%' }}
                styles={{ body: { padding: 14 } }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: m.color + '18', color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>{m.icon}</span>
                  <Text strong style={{ fontSize: 14, color: R.n900 }}>{m.name}</Text>
                </div>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {m.items.map(it => (
                    <div key={it} style={{ fontSize: 12.5, color: R.n600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircleOutlined style={{ color: m.color, fontSize: 12 }} />{it}
                    </div>
                  ))}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>

        {/* Transactional capability */}
        <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>Fully transactional — not just reporting</Title>
        <Card style={{ borderRadius: 12, border: `1px solid ${R.n200}` }}>
          <Paragraph style={{ fontSize: 13.5, color: R.n600 }}>
            The same REST layer that reads data also <Text strong>creates and progresses transactions</Text>. Fusion Client can run a
            complete operational cycle end-to-end — raise a transfer, release it for picking, confirm the pick with lot &amp; serial detail,
            and ship-confirm — entirely from these screens.
          </Paragraph>
          <Row gutter={[10, 10]}>
            {TXN.map(t => (
              <Col key={t.res} xs={24} sm={12} lg={8}>
                <div style={{ border: `1px solid ${R.n200}`, borderRadius: 10, padding: '10px 12px', background: R.n100, height: '100%' }}>
                  <Space size={6} style={{ marginBottom: 4 }}>
                    <Tag color={t.verb === 'POST' ? 'green' : 'blue'} style={{ margin: 0, fontFamily: 'monospace' }}>{t.verb}</Tag>
                    <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: R.info }}>{t.res}</Text>
                  </Space>
                  <div style={{ fontSize: 12, color: R.n600 }}>{t.use}</div>
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      </div>
    </Content>
  </Layout>
);

export default FusionArchitecture;
