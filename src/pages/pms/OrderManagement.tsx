import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Modal, Form, Input, InputNumber, Select, Statistic, Tabs, message, Badge, Tooltip,
} from 'antd';
import {
  HomeOutlined, SwapOutlined, PlusOutlined, CheckCircleOutlined,
  ClockCircleOutlined, CloseCircleOutlined, ArrowUpOutlined, ArrowDownOutlined,
  FilterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_ORDERS, MOCK_FUNDS, formatINR } from './mockData';
import type { Order } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const OrderManagement: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>(MOCK_ORDERS);
  const [createVisible, setCreateVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [form] = Form.useForm();

  const stats = useMemo(() => ({
    total: orders.length,
    pending: orders.filter(o => o.status === 'Pending').length,
    partiallyFilled: orders.filter(o => o.status === 'Partially Filled').length,
    filled: orders.filter(o => o.status === 'Filled').length,
    cancelled: orders.filter(o => o.status === 'Cancelled' || o.status === 'Rejected').length,
    todayBuyValue: orders.filter(o => o.side === 'Buy' && o.status === 'Filled' && o.orderDate === '14 Feb 2026').reduce((s, o) => s + (o.totalCost || 0), 0),
    todaySellValue: orders.filter(o => o.side === 'Sell' && o.status === 'Filled' && o.orderDate === '14 Feb 2026').reduce((s, o) => s + (o.totalCost || 0), 0),
  }), [orders]);

  const filteredOrders = useMemo(() => {
    if (activeTab === 'all') return orders;
    if (activeTab === 'pending') return orders.filter(o => o.status === 'Pending' || o.status === 'Partially Filled');
    if (activeTab === 'filled') return orders.filter(o => o.status === 'Filled');
    if (activeTab === 'cancelled') return orders.filter(o => o.status === 'Cancelled' || o.status === 'Rejected' || o.status === 'Expired');
    return orders;
  }, [orders, activeTab]);

  const handleCreateOrder = () => {
    form.validateFields().then(values => {
      const newOrder: Order = {
        id: `ORD-${Date.now()}`,
        ...values,
        fundName: MOCK_FUNDS.find(f => f.id === values.fundId)?.shortName || '',
        stockName: values.symbol,
        filledQuantity: 0,
        status: 'Pending',
        orderDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        orderTime: new Date().toLocaleTimeString('en-GB'),
        tradingAccount: 'ZERODHA-PMS-001',
        broker: 'Zerodha',
        createdBy: 'Current User',
        brokerage: 0, stt: 0, otherCharges: 0, totalCost: 0,
      };
      setOrders([newOrder, ...orders]);
      setCreateVisible(false);
      form.resetFields();
      message.success('Order placed successfully');
    });
  };

  const handleCancelOrder = (orderId: string) => {
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: 'Cancelled' as const } : o));
    message.success('Order cancelled');
  };

  const columns = [
    {
      title: 'Order ID', dataIndex: 'id', key: 'id', width: 160,
      render: (v: string) => <Text strong style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: 'Fund', dataIndex: 'fundName', key: 'fund', width: 120,
      render: (v: string) => <Tag>{v}</Tag>,
      filters: MOCK_FUNDS.map(f => ({ text: f.shortName, value: f.shortName })),
      onFilter: (value: unknown, record: Order) => record.fundName === value,
    },
    {
      title: 'Symbol', key: 'symbol', width: 160,
      render: (_: unknown, r: Order) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{r.symbol}</Text>
          <br /><Text type="secondary" style={{ fontSize: 10 }}>{r.exchange}</Text>
        </div>
      ),
    },
    {
      title: 'Side', dataIndex: 'side', key: 'side', width: 70,
      render: (v: string) => <Tag color={v === 'Buy' ? 'green' : 'red'} style={{ fontWeight: 600 }}>{v}</Tag>,
      filters: [{ text: 'Buy', value: 'Buy' }, { text: 'Sell', value: 'Sell' }],
      onFilter: (value: unknown, record: Order) => record.side === value,
    },
    {
      title: 'Type', dataIndex: 'orderType', key: 'type', width: 90,
      render: (v: string) => <Tag color={v === 'Market' ? 'blue' : v === 'Limit' ? 'purple' : 'orange'}>{v}</Tag>,
    },
    {
      title: 'Qty', key: 'qty', width: 100,
      render: (_: unknown, r: Order) => (
        <div>
          <Text strong>{r.quantity.toLocaleString('en-IN')}</Text>
          {r.filledQuantity > 0 && r.filledQuantity < r.quantity && (
            <div style={{ fontSize: 10, color: REDWOOD.info }}>Filled: {r.filledQuantity.toLocaleString('en-IN')}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Price', key: 'price', width: 100,
      render: (_: unknown, r: Order) => (
        <div>
          {r.price ? <Text>{formatINR(r.price)}</Text> : <Text type="secondary">Market</Text>}
          {r.avgExecutionPrice && <div style={{ fontSize: 10, color: REDWOOD.success }}>Exec: {formatINR(r.avgExecutionPrice)}</div>}
        </div>
      ),
    },
    {
      title: 'Value', key: 'value', width: 120,
      render: (_: unknown, r: Order) => r.totalCost > 0 ? <Text strong>{formatINR(r.totalCost)}</Text> : '-',
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 130,
      render: (v: string) => {
        const config: Record<string, { color: string; icon: React.ReactNode }> = {
          'Pending': { color: 'orange', icon: <ClockCircleOutlined /> },
          'Partially Filled': { color: 'blue', icon: <ArrowUpOutlined /> },
          'Filled': { color: 'green', icon: <CheckCircleOutlined /> },
          'Cancelled': { color: 'default', icon: <CloseCircleOutlined /> },
          'Rejected': { color: 'red', icon: <CloseCircleOutlined /> },
          'Expired': { color: 'default', icon: <ClockCircleOutlined /> },
        };
        const c = config[v] || { color: 'default', icon: null };
        return <Tag color={c.color} icon={c.icon}>{v}</Tag>;
      },
    },
    {
      title: 'Date/Time', key: 'datetime', width: 130,
      render: (_: unknown, r: Order) => (
        <div>
          <Text style={{ fontSize: 12 }}>{r.orderDate}</Text>
          <br /><Text type="secondary" style={{ fontSize: 10 }}>{r.orderTime}</Text>
        </div>
      ),
      sorter: (a: Order, b: Order) => a.orderDate.localeCompare(b.orderDate),
    },
    { title: 'Validity', dataIndex: 'validity', key: 'validity', width: 60 },
    {
      title: 'Action', key: 'action', width: 100, fixed: 'right' as const,
      render: (_: unknown, r: Order) => (
        r.status === 'Pending' || r.status === 'Partially Filled' ? (
          <Button type="link" danger size="small" onClick={() => handleCancelOrder(r.id)}>Cancel</Button>
        ) : null
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/pms">PMS</Link> },
            { title: 'Order Management' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: `${REDWOOD.info}15`, borderRadius: 12, padding: 12 }}>
                <SwapOutlined style={{ fontSize: 28, color: REDWOOD.info }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Order Management System</Title>
                <Text type="secondary">Place, monitor, and manage trading orders across all funds</Text>
              </div>
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />}>Refresh</Button>
              <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreateVisible(true)}>Place Order</Button>
            </Space>
          </div>

          {/* KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={4}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Orders" value={stats.total} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={4}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Badge count={stats.pending} size="small" offset={[10, 0]}>
                  <Statistic title="Pending" value={stats.pending} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.warning }} />
                </Badge>
              </Card>
            </Col>
            <Col xs={12} sm={4}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Part. Filled" value={stats.partiallyFilled} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.info }} />
              </Card>
            </Col>
            <Col xs={12} sm={4}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Filled" value={stats.filled} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={4}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Today Buy" value={formatINR(stats.todayBuyValue)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={4}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Today Sell" value={formatINR(stats.todaySellValue)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.danger }} />
              </Card>
            </Col>
          </Row>

          {/* Orders Table with Tabs */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                { key: 'all', label: `All (${stats.total})` },
                { key: 'pending', label: <Badge count={stats.pending + stats.partiallyFilled} size="small" offset={[12, 0]}><span>Open</span></Badge> },
                { key: 'filled', label: `Filled (${stats.filled})` },
                { key: 'cancelled', label: `Cancelled (${stats.cancelled})` },
              ]}
            />
            <Table
              dataSource={filteredOrders}
              columns={columns}
              rowKey="id"
              scroll={{ x: 1500 }}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true }}
            />
          </Card>
        </div>

        {/* Place Order Modal */}
        <Modal
          open={createVisible}
          onCancel={() => { setCreateVisible(false); form.resetFields(); }}
          onOk={handleCreateOrder}
          title={<Space><SwapOutlined style={{ color: REDWOOD.info }} /> Place New Order</Space>}
          width={600}
          okText="Place Order"
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="fundId" label="Fund" rules={[{ required: true }]}>
                  <Select options={MOCK_FUNDS.map(f => ({ label: f.shortName, value: f.id }))} placeholder="Select fund" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="symbol" label="Symbol" rules={[{ required: true }]}>
                  <Input placeholder="e.g. RELIANCE" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="side" label="Side" rules={[{ required: true }]}>
                  <Select options={[{ label: 'Buy', value: 'Buy' }, { label: 'Sell', value: 'Sell' }]} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="orderType" label="Order Type" rules={[{ required: true }]}>
                  <Select options={['Market', 'Limit', 'Stop Loss', 'Stop Limit'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="validity" label="Validity" rules={[{ required: true }]} initialValue="Day">
                  <Select options={['Day', 'GTC', 'IOC'].map(t => ({ label: t, value: t }))} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={1} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="price" label="Limit Price">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.05} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="triggerPrice" label="Trigger Price">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.05} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item name="exchange" label="Exchange" initialValue="NSE">
                  <Select options={[{ label: 'NSE', value: 'NSE' }, { label: 'BSE', value: 'BSE' }]} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="notes" label="Notes">
              <Input.TextArea rows={2} placeholder="Order notes / rationale" />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  );
};

export default OrderManagement;
