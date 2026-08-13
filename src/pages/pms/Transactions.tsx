import React, { useState, useMemo } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Breadcrumb, Table, Tag, Button,
  Select, DatePicker, Statistic, Tabs, Descriptions, Modal,
} from 'antd';
import {
  HomeOutlined, CalendarOutlined, EyeOutlined, DownloadOutlined,
  ArrowUpOutlined, ArrowDownOutlined, CheckCircleOutlined, ClockCircleOutlined,
  SwapOutlined, DollarOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { MOCK_TRANSACTIONS, MOCK_FUNDS, formatINR } from './mockData';
import type { Transaction } from './types';

const { Text, Title } = Typography;
const { Content } = Layout;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', danger: '#D32F2F',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const TransactionsPage: React.FC = () => {
  const [transactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [fundFilter, setFundFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filteredTxns = useMemo(() => {
    let result = transactions;
    if (fundFilter !== 'all') result = result.filter(t => t.fundId === fundFilter);
    if (typeFilter !== 'all') result = result.filter(t => t.type === typeFilter);
    return result;
  }, [transactions, fundFilter, typeFilter]);

  const stats = useMemo(() => ({
    totalTrades: transactions.length,
    buyVolume: transactions.filter(t => t.type === 'Buy').reduce((s, t) => s + t.amount, 0),
    sellVolume: transactions.filter(t => t.type === 'Sell').reduce((s, t) => s + t.amount, 0),
    totalCharges: transactions.reduce((s, t) => s + t.totalCharges, 0),
    dividends: transactions.filter(t => t.type === 'Dividend').reduce((s, t) => s + t.netAmount, 0),
    pendingSettlement: transactions.filter(t => t.status === 'Pending Settlement').length,
    settled: transactions.filter(t => t.status === 'Settled').length,
  }), [transactions]);

  const columns = [
    {
      title: 'Trade ID', dataIndex: 'id', key: 'id', width: 100,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: 'Fund', dataIndex: 'fundName', key: 'fund', width: 110,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Symbol', key: 'symbol', width: 140,
      render: (_: unknown, r: Transaction) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{r.symbol}</Text>
          <br /><Text type="secondary" style={{ fontSize: 10 }}>{r.stockName}</Text>
        </div>
      ),
    },
    {
      title: 'Type', dataIndex: 'type', key: 'type', width: 90,
      render: (v: string) => {
        const colors: Record<string, string> = { Buy: 'green', Sell: 'red', Dividend: 'gold', Bonus: 'purple', Split: 'blue' };
        return <Tag color={colors[v] || 'default'} style={{ fontWeight: 600 }}>{v}</Tag>;
      },
    },
    {
      title: 'Qty', dataIndex: 'quantity', key: 'qty', width: 80,
      render: (v: number) => v.toLocaleString('en-IN'),
    },
    {
      title: 'Price', dataIndex: 'price', key: 'price', width: 100,
      render: (v: number) => formatINR(v),
    },
    {
      title: 'Amount', dataIndex: 'amount', key: 'amount', width: 120,
      render: (v: number) => <Text strong>{formatINR(v)}</Text>,
      sorter: (a: Transaction, b: Transaction) => a.amount - b.amount,
    },
    {
      title: 'Charges', dataIndex: 'totalCharges', key: 'charges', width: 90,
      render: (v: number) => v > 0 ? <Text type="secondary">{formatINR(v)}</Text> : '-',
    },
    {
      title: 'Net Amount', dataIndex: 'netAmount', key: 'net', width: 130,
      render: (v: number, r: Transaction) => (
        <Text strong style={{ color: r.type === 'Sell' || r.type === 'Dividend' ? REDWOOD.success : REDWOOD.neutral900 }}>
          {formatINR(v)}
        </Text>
      ),
    },
    {
      title: 'Trade Date', dataIndex: 'tradeDate', key: 'tradeDate', width: 110,
      sorter: (a: Transaction, b: Transaction) => a.tradeDate.localeCompare(b.tradeDate),
    },
    {
      title: 'Settlement', key: 'settlement', width: 130,
      render: (_: unknown, r: Transaction) => (
        <div>
          <Text style={{ fontSize: 11 }}>{r.settlementDate}</Text>
          <br />
          <Tag
            color={r.status === 'Settled' ? 'green' : r.status === 'Pending Settlement' ? 'orange' : 'red'}
            icon={r.status === 'Settled' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
            style={{ fontSize: 10 }}
          >
            {r.status}
          </Tag>
        </div>
      ),
    },
    {
      title: '', key: 'action', width: 60,
      render: (_: unknown, r: Transaction) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedTxn(r); setDetailVisible(true); }} />
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
            { title: 'Transactions' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{ background: '#00796B15', borderRadius: 12, padding: 12 }}>
                <CalendarOutlined style={{ fontSize: 28, color: '#00796B' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Transactions & Trade Book</Title>
                <Text type="secondary">Complete trade history, settlements, and corporate actions</Text>
              </div>
            </Space>
            <Button icon={<DownloadOutlined />}>Export</Button>
          </div>

          {/* KPIs */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Trades" value={stats.totalTrades} valueStyle={{ fontSize: 20, fontWeight: 700 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Buy Volume" value={formatINR(stats.buyVolume)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Sell Volume" value={formatINR(stats.sellVolume)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.danger }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Dividends" value={formatINR(stats.dividends)} valueStyle={{ fontSize: 14, fontWeight: 700, color: '#D4A800' }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Total Charges" value={formatINR(stats.totalCharges)} valueStyle={{ fontSize: 14, fontWeight: 700, color: REDWOOD.neutral600 }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Settled" value={stats.settled} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Pending" value={stats.pendingSettlement} valueStyle={{ fontSize: 20, fontWeight: 700, color: REDWOOD.warning }} />
              </Card>
            </Col>
            <Col xs={12} sm={6} lg={3}>
              <Card style={{ borderRadius: 10, border: 'none', textAlign: 'center' }} bodyStyle={{ padding: 12 }}>
                <Statistic title="Net Flow" value={formatINR(stats.buyVolume - stats.sellVolume)} valueStyle={{ fontSize: 14, fontWeight: 700, color: stats.buyVolume >= stats.sellVolume ? REDWOOD.success : REDWOOD.danger }} />
              </Card>
            </Col>
          </Row>

          {/* Filters */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
            <Space size={16}>
              <div>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Fund</Text>
                <Select
                  value={fundFilter}
                  onChange={setFundFilter}
                  style={{ width: 180 }}
                  options={[{ label: 'All Funds', value: 'all' }, ...MOCK_FUNDS.map(f => ({ label: f.shortName, value: f.id }))]}
                />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Type</Text>
                <Select
                  value={typeFilter}
                  onChange={setTypeFilter}
                  style={{ width: 140 }}
                  options={[{ label: 'All Types', value: 'all' }, ...['Buy', 'Sell', 'Dividend', 'Bonus', 'Split'].map(t => ({ label: t, value: t }))]}
                />
              </div>
            </Space>
          </Card>

          {/* Transactions Table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={filteredTxns}
              columns={columns}
              rowKey="id"
              scroll={{ x: 1400 }}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true }}
              summary={() => {
                const buyTotal = filteredTxns.filter(t => t.type === 'Buy').reduce((s, t) => s + t.netAmount, 0);
                const sellTotal = filteredTxns.filter(t => t.type === 'Sell').reduce((s, t) => s + t.netAmount, 0);
                const chargesTotal = filteredTxns.reduce((s, t) => s + t.totalCharges, 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={6}><Text strong>Totals</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={6}><Text strong>{formatINR(filteredTxns.reduce((s, t) => s + t.amount, 0))}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={7}><Text type="secondary">{formatINR(chargesTotal)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={8}><Text strong>{formatINR(filteredTxns.reduce((s, t) => s + t.netAmount, 0))}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={9} colSpan={3} />
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Card>
        </div>

        {/* Transaction Detail Modal */}
        <Modal
          open={detailVisible}
          onCancel={() => setDetailVisible(false)}
          footer={null}
          width={700}
          title={<Space><CalendarOutlined style={{ color: '#00796B' }} /> Transaction Details</Space>}
        >
          {selectedTxn && (
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Trade ID">{selectedTxn.id}</Descriptions.Item>
              <Descriptions.Item label="Order ID">{selectedTxn.orderId || '-'}</Descriptions.Item>
              <Descriptions.Item label="Fund">{selectedTxn.fundName}</Descriptions.Item>
              <Descriptions.Item label="Symbol">{selectedTxn.symbol} ({selectedTxn.exchange})</Descriptions.Item>
              <Descriptions.Item label="Type"><Tag color={selectedTxn.type === 'Buy' ? 'green' : selectedTxn.type === 'Sell' ? 'red' : 'gold'}>{selectedTxn.type}</Tag></Descriptions.Item>
              <Descriptions.Item label="Status"><Tag color={selectedTxn.status === 'Settled' ? 'green' : 'orange'}>{selectedTxn.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="Quantity">{selectedTxn.quantity.toLocaleString('en-IN')}</Descriptions.Item>
              <Descriptions.Item label="Price">{formatINR(selectedTxn.price)}</Descriptions.Item>
              <Descriptions.Item label="Amount">{formatINR(selectedTxn.amount)}</Descriptions.Item>
              <Descriptions.Item label="Trade Date">{selectedTxn.tradeDate}</Descriptions.Item>
              <Descriptions.Item label="Settlement Date">{selectedTxn.settlementDate}</Descriptions.Item>
              <Descriptions.Item label="Settlement No.">{selectedTxn.settlementNumber || '-'}</Descriptions.Item>
              <Descriptions.Item label="Charges Breakdown" span={2}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 12 }}>Brokerage: {formatINR(selectedTxn.brokerage)}</Text>
                  <Text style={{ fontSize: 12 }}>STT: {formatINR(selectedTxn.stt)}</Text>
                  <Text style={{ fontSize: 12 }}>GST: {formatINR(selectedTxn.gst)}</Text>
                  <Text style={{ fontSize: 12 }}>Stamp: {formatINR(selectedTxn.stampDuty)}</Text>
                  <Text style={{ fontSize: 12 }}>Exchange: {formatINR(selectedTxn.exchangeCharges)}</Text>
                  <Text style={{ fontSize: 12 }}>SEBI: {formatINR(selectedTxn.sebiCharges)}</Text>
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="Total Charges">{formatINR(selectedTxn.totalCharges)}</Descriptions.Item>
              <Descriptions.Item label="Net Amount"><Text strong style={{ fontSize: 16 }}>{formatINR(selectedTxn.netAmount)}</Text></Descriptions.Item>
            </Descriptions>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default TransactionsPage;
