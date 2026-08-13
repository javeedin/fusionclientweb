import React from 'react';
import { Layout, Breadcrumb, Typography, Card, Row, Col, Tag, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SyncOutlined, DatabaseOutlined, ThunderboltOutlined, RobotOutlined,
  CheckCircleOutlined, WarningOutlined, RocketOutlined, ExperimentOutlined,
  SafetyCertificateOutlined, DeploymentUnitOutlined, BranchesOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const R = {
  primary: '#C74634', primaryDark: '#A33B2C', success: '#1D7B4D', warning: '#B07700',
  info: '#0572CE', teal: '#00918A', purple: '#7245A6', error: '#D93025',
  n100: '#F7F7F7', n200: '#E5E5E5', n300: '#C7C7C7', n600: '#6B6B6B', n900: '#1A1A1A', surface: '#FFF',
};

const Box: React.FC<{ color: string; icon: React.ReactNode; title: string; sub?: string; wide?: boolean }> = ({ color, icon, title, sub, wide }) => (
  <div style={{ flex: wide ? 1.4 : 1, minWidth: 150, border: `1.5px solid ${color}`, borderRadius: 12, background: `linear-gradient(180deg, ${color}12, ${color}04)`, padding: '12px 14px', textAlign: 'center' }}>
    <div style={{ width: 36, height: 36, borderRadius: 9, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, margin: '0 auto 8px' }}>{icon}</div>
    <Text strong style={{ fontSize: 13, color: R.n900, display: 'block' }}>{title}</Text>
    {sub && <div style={{ fontSize: 11.5, color: R.n600, marginTop: 2 }}>{sub}</div>}
  </div>
);
const Conn: React.FC<{ label?: string }> = ({ label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 34, color: R.n300 }}>
    <span style={{ fontSize: 22, lineHeight: 1 }}>→</span>
    {label && <span style={{ fontSize: 10, color: R.n600 }}>{label}</span>}
  </div>
);

interface SvcRow { module: string; color: string; services: string; scope: string }
const SERVICES: SvcRow[] = [
  { module: 'Purchasing', color: R.primary, services: 'purchaseOrders · purchaseOrderLifeCycleDetails · suppliers', scope: 'POs, receipts, invoices, payments, supplier master' },
  { module: 'Order Management', color: R.purple, services: 'salesOrdersForOrderHub (+lines, +totals)', scope: 'Sales orders, fulfillment lines, order totals' },
  { module: 'Inventory', color: R.info, services: 'transferOrders · shipmentLines · pickSlipDetails · inventoryOnhandBalances · inventoryCompletedTransactions', scope: 'Transfers, picks, shipments, on-hand, movements' },
  { module: 'Costing', color: R.success, services: 'itemCosts · receiptCosts', scope: 'Item cost, receipt cost, valuation' },
  { module: 'Items', color: R.teal, services: 'itemsV2', scope: 'Item master validation & attributes' },
  { module: 'Receivables', color: R.warning, services: 'receivablesInvoices · receipts', scope: 'AR invoices & receipts (loadable)' },
  { module: 'Payables', color: R.error, services: 'invoices · payments', scope: 'AP invoices & payments (loadable)' },
  { module: 'Setups', color: R.n600, services: 'finBusinessUnitsLOV · inventoryOrganizations · subinventories', scope: 'BUs, orgs, subinventories, LOVs' },
];

const ADV = [
  { icon: <ExperimentOutlined />, color: R.info, title: 'Tests almost every scenario', text: 'Real legacy volumes flow through real Fusion services — edge cases surface that scripted UAT never reaches.' },
  { icon: <WarningOutlined />, color: R.warning, title: 'Finds defects early', text: 'Config gaps, mapping errors and data issues are caught during the run, not after go-live.' },
  { icon: <SafetyCertificateOutlined />, color: R.success, title: 'Evidence-based sign-off', text: 'Reconciliation results give stakeholders hard numbers to make the go / no-go call.' },
  { icon: <RobotOutlined />, color: R.purple, title: 'AI-assisted loading', text: 'Anomaly detection during load flags outliers and inconsistencies before they reach Fusion.' },
  { icon: <BranchesOutlined />, color: R.teal, title: 'Reduced go-live stress', text: 'Parallel-run mode avoids a big-bang cutover — the new system is proven while the old one still runs.' },
  { icon: <DeploymentUnitOutlined />, color: R.primary, title: 'Staggered go-live', text: 'Hundreds of entities can be phased live in controlled waves rather than all at once.' },
];

const ParallelRunStrategy: React.FC = () => {
  const svcCols: ColumnsType<SvcRow> = [
    { title: 'Module', dataIndex: 'module', width: 150, render: (v, r) => <Tag color={undefined} style={{ borderColor: r.color, color: r.color, background: r.color + '12', fontWeight: 600 }}>{v}</Tag> },
    { title: 'Fusion REST services', dataIndex: 'services', render: v => <Text style={{ fontFamily: 'monospace', fontSize: 12, color: R.info }}>{v}</Text> },
    { title: 'Parallel-run scope', dataIndex: 'scope', width: 320, render: v => <Text style={{ fontSize: 12.5, color: R.n600 }}>{v}</Text> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: R.n100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: R.surface, borderBottom: `1px solid ${R.n200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Client</Link> },
            { title: 'Parallel Run / UAT Strategy' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <SyncOutlined style={{ color: R.primary }} /> Parallel Run / UAT Strategy
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— automated, reconciled, evidence-driven path to go-live</Text>
          </Title>
        </div>

        <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
          {/* Intro */}
          <Card style={{ borderRadius: 12, border: `1px solid ${R.n200}`, marginBottom: 20 }}>
            <Paragraph style={{ fontSize: 14, marginBottom: 8 }}>
              A <Text strong>full parallel run</Text> processes the same live business through both the <Text strong>legacy system</Text> and
              <Text strong> Oracle Fusion</Text> at the same time, using automation across every module. Once data is loaded, a built-in
              <Text strong> Reconcile with Legacy</Text> step compares both sets of results and surfaces the variances automatically — so the
              programme runs on facts, not hope.
            </Paragraph>
            <Space wrap size={8}>
              <Tag color="blue">Automated across all modules</Tag>
              <Tag color="green">Auto-reconciliation vs legacy</Tag>
              <Tag color="volcano">Variance analysis</Tag>
              <Tag color="purple">AI-assisted anomaly detection</Tag>
              <Tag color="gold">Phased go-live</Tag>
            </Space>
          </Card>

          {/* Flow diagram */}
          <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>How the parallel run works</Title>
          <Card style={{ borderRadius: 12, border: `1px solid ${R.n200}`, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flexWrap: 'wrap' }}>
              <Box color={R.n600} icon={<DatabaseOutlined />} title="Legacy System" sub="Live transactions" />
              <Conn label="extract" />
              <Box color={R.teal} icon={<RobotOutlined />} title="AI-assisted Load" sub="Detect anomalies" wide />
              <Conn label="post" />
              <Box color={R.primary} icon={<ThunderboltOutlined />} title="Oracle Fusion" sub="Real services" />
              <Conn label="compare" />
              <Box color={R.info} icon={<SyncOutlined />} title="Reconcile" sub="Auto vs legacy" wide />
              <Conn label="report" />
              <Box color={R.warning} icon={<WarningOutlined />} title="Variances" sub="Investigate & fix" />
              <Conn label="sign-off" />
              <Box color={R.success} icon={<RocketOutlined />} title="Go-Live" sub="Phased waves" />
            </div>
            <Paragraph style={{ fontSize: 12.5, color: R.n600, margin: '14px 0 0' }}>
              Every module runs this loop continuously. Because the loaders are <Text strong>AI-enabled</Text>, anomalies and data
              inconsistencies are deducted during loading — reducing the noise that reaches reconciliation.
            </Paragraph>
          </Card>

          {/* Web services per module */}
          <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>Web services powering each module</Title>
          <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 12, border: `1px solid ${R.n200}`, marginBottom: 24 }}>
            <Table size="small" columns={svcCols} dataSource={SERVICES} rowKey="module" pagination={false} scroll={{ x: 760 }} />
          </Card>

          {/* Reconcile */}
          <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>Reconcile with Legacy</Title>
          <Card style={{ borderRadius: 12, border: `1px solid ${R.n200}`, marginBottom: 24 }}>
            <Row gutter={[16, 12]}>
              <Col xs={24} md={16}>
                <Paragraph style={{ fontSize: 13.5, color: R.n600, marginBottom: 8 }}>
                  After each load, the <Text strong>Reconcile</Text> option pulls the equivalent result from the legacy system and matches it
                  against Fusion automatically — quantities, values, balances, document counts. Differences are classified and presented as a
                  clear <Text strong>variance report</Text>:
                </Paragraph>
                <Space direction="vertical" size={6}>
                  <div style={{ fontSize: 13, color: R.n900 }}><CheckCircleOutlined style={{ color: R.success, marginRight: 8 }} />Matched — legacy and Fusion agree</div>
                  <div style={{ fontSize: 13, color: R.n900 }}><WarningOutlined style={{ color: R.warning, marginRight: 8 }} />Variance — value / quantity / status differs</div>
                  <div style={{ fontSize: 13, color: R.n900 }}><WarningOutlined style={{ color: R.error, marginRight: 8 }} />Missing — present in one system only</div>
                </Space>
              </Col>
              <Col xs={24} md={8}>
                <div style={{ border: `1px dashed ${R.n300}`, borderRadius: 10, padding: 14, background: R.n100, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: R.success }}>≈ 100%</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>reconciliation coverage — every loaded record is checked, not sampled</Text>
                </div>
              </Col>
            </Row>
          </Card>

          {/* Advantages */}
          <Title level={5} style={{ color: R.n900, marginBottom: 12 }}>Why automated parallel run</Title>
          <Row gutter={[14, 14]} style={{ marginBottom: 24 }}>
            {ADV.map(a => (
              <Col key={a.title} xs={24} sm={12} lg={8}>
                <Card size="small" style={{ borderRadius: 12, border: `1px solid ${R.n200}`, height: '100%' }} styles={{ body: { padding: 14 } }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 32, height: 32, borderRadius: 8, background: a.color + '18', color: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{a.icon}</span>
                    <Text strong style={{ fontSize: 13.5, color: R.n900 }}>{a.title}</Text>
                  </div>
                  <Text style={{ fontSize: 12.5, color: R.n600 }}>{a.text}</Text>
                </Card>
              </Col>
            ))}
          </Row>

          {/* Go-live */}
          <Card style={{ borderRadius: 12, border: `1px solid ${R.success}44`, background: `linear-gradient(180deg, ${R.success}0c, ${R.success}03)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <RocketOutlined style={{ color: R.success, fontSize: 20 }} />
              <Text strong style={{ fontSize: 15, color: R.n900 }}>Go-live with confidence — even in parallel-run mode</Text>
            </div>
            <Paragraph style={{ fontSize: 13.5, color: R.n600, marginBottom: 0 }}>
              Stakeholders make the call to proceed to <Text strong>production setup</Text> and then <Text strong>LIVE</Text> based on the
              reconciliation evidence — not gut feel. Because the run is automated and AI-assisted, organisations can go live in
              <Text strong> parallel-run mode</Text> and phase out hundreds of entities in a <Text strong>staggered</Text> manner, dramatically
              reducing the risk and stress of a big-bang cutover.
            </Paragraph>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default ParallelRunStrategy;
