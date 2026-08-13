import React, { useState, useEffect } from 'react';
import {
  Layout, Card, Typography, Breadcrumb, Button, Space, Tabs, Row, Col,
  Descriptions, Spin, message, Divider, Table, Tag, Collapse, Statistic,
} from 'antd';
import {
  HomeOutlined, ArrowLeftOutlined, FileTextOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import FloatingMenu from '../../components/FloatingMenu';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
};

const fmt = (val: any) => val ?? '—';
const fmtDate = (val: string | null) => val ? dayjs(val).format('D-MMM-YYYY') : '—';
const fmtAmt = (val: any, currency = '') =>
  val != null ? `${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`.trim() : '—';

interface LineRecord {
  key: string;
  lineNumber: number;
  itemNumber: string;
  description: string;
  memoLine: string;
  unitOfMeasure: string;
  quantity: number;
  unitSellingPrice: number;
  lineAmount: number;
  salesOrder: string;
}

const InvoiceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState<any>(null);
  const [lines, setLines] = useState<LineRecord[]>([]);

  useEffect(() => {
    if (!id) return;
    const fetchAll = async () => {
      try {
        setLoading(true);
        const [invResp, linesResp] = await Promise.all([
          fetch(`${APEX_DB_CONFIG.baseUrl}/ar/invoices/${id}`),
          fetch(`${APEX_DB_CONFIG.baseUrl}/ar/invoices/${id}/lines`),
        ]);

        if (!invResp.ok) throw new Error(`Invoice fetch failed: HTTP ${invResp.status}`);
        const invData = await invResp.json();
        setInvoice(invData.items?.[0] ?? invData);

        if (linesResp.ok) {
          const linesData = await linesResp.json();
          setLines((linesData.items || []).map((l: any) => ({
            key:              String(l.CUSTOMER_TRANSACTION_LINE_ID),
            lineNumber:       l.LINE_NUMBER,
            itemNumber:       l.ITEM_NUMBER,
            description:      l.DESCRIPTION,
            memoLine:         l.MEMO_LINE,
            unitOfMeasure:    l.UNIT_OF_MEASURE,
            quantity:         l.QUANTITY,
            unitSellingPrice: l.UNIT_SELLING_PRICE,
            lineAmount:       l.LINE_AMOUNT,
            salesOrder:       l.SALES_ORDER,
          })));
        }
      } catch (err) {
        message.error('Failed to load invoice: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [id]);

  const lineColumns: ColumnsType<LineRecord> = [
    { title: 'Line', dataIndex: 'lineNumber', key: 'lineNumber', width: 60 },
    { title: 'Item', dataIndex: 'itemNumber', key: 'itemNumber', width: 120 },
    { title: 'Description', dataIndex: 'description', key: 'description', width: 260, ellipsis: true },
    { title: 'Memo Line', dataIndex: 'memoLine', key: 'memoLine', width: 140 },
    { title: 'UOM', dataIndex: 'unitOfMeasure', key: 'unitOfMeasure', width: 80 },
    { title: 'Quantity', dataIndex: 'quantity', key: 'quantity', width: 90, align: 'right' },
    {
      title: 'Unit Price', dataIndex: 'unitSellingPrice', key: 'unitSellingPrice', width: 120, align: 'right',
      render: (v) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—',
    },
    {
      title: 'Amount', dataIndex: 'lineAmount', key: 'lineAmount', width: 130, align: 'right',
      render: (v) => <Text strong>{v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}</Text>,
    },
    { title: 'Sales Order', dataIndex: 'salesOrder', key: 'salesOrder', width: 130 },
  ];

  if (loading) {
    return (
      <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
        <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </Content>
      </Layout>
    );
  }

  if (!invoice) return null;

  const txnNumber = invoice.TRANSACTION_NUMBER || id;
  const currency  = invoice.INVOICE_CURRENCY_CODE || '';
  const isComplete = invoice.INVOICE_STATUS === 'Complete';

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '0 24px 32px' }}>

        {/* Breadcrumb + action bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0' }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /></Link> },
            { title: <Link to="/ar">Accounts Receivable</Link> },
            { title: <Link to="/ar/manage-invoices">Manage Invoices</Link> },
            { title: `Invoice ${txnNumber}` },
          ]} />
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>Back</Button>
            <Button style={{ background: REDWOOD.primary, color: '#fff', border: 'none' }}>
              Done
            </Button>
          </Space>
        </div>

        {/* Page title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <FileTextOutlined style={{ fontSize: 22, color: REDWOOD.primary }} />
          <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>
            Review Transaction: Invoice {txnNumber}
          </Title>
          <Tag color={isComplete ? 'success' : 'default'} style={{ borderRadius: 10 }}>
            {invoice.INVOICE_STATUS || 'N/A'}
          </Tag>
        </div>

        {/* ── General Information ─────────────────────────────────────────── */}
        <Card
          style={{ borderRadius: 8, marginBottom: 16, border: `1px solid ${REDWOOD.border}` }}
          title={<Text strong>General Information</Text>}
          bodyStyle={{ padding: '16px 24px' }}
        >
          <Row gutter={[32, 0]}>
            {/* Column 1 */}
            <Col xs={24} md={8}>
              <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 180 }}>
                <Descriptions.Item label="Business Unit">{fmt(invoice.BUSINESS_UNIT)}</Descriptions.Item>
                <Descriptions.Item label="Transaction Source">{fmt(invoice.TRANSACTION_SOURCE)}</Descriptions.Item>
                <Descriptions.Item label="Transaction Type">{fmt(invoice.TRANSACTION_TYPE)}</Descriptions.Item>
                <Descriptions.Item label="Transaction Number">
                  <Text strong>{fmt(invoice.TRANSACTION_NUMBER)}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Billing Number">{fmt(invoice.BILLING_NUMBER)}</Descriptions.Item>
                <Descriptions.Item label="Cross Reference">{fmt(invoice.CROSS_REFERENCE)}</Descriptions.Item>
                <Descriptions.Item label="Document Number">{fmt(invoice.DOCUMENT_NUMBER)}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  {isComplete
                    ? <Tag color="success"><CheckCircleOutlined /> Complete</Tag>
                    : <Tag>{invoice.INVOICE_STATUS}</Tag>}
                </Descriptions.Item>
              </Descriptions>
            </Col>

            {/* Column 2 */}
            <Col xs={24} md={8}>
              <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 160 }}>
                <Descriptions.Item label="Transaction Date">{fmtDate(invoice.TRANSACTION_DATE)}</Descriptions.Item>
                <Descriptions.Item label="Billing Date">{fmtDate(invoice.BILLING_DATE)}</Descriptions.Item>
                <Descriptions.Item label="Accounting Date">{fmtDate(invoice.ACCOUNTING_DATE)}</Descriptions.Item>
                <Descriptions.Item label="Due Date">{fmtDate(invoice.DUE_DATE)}</Descriptions.Item>
                <Descriptions.Item label="Salesperson">{fmt(invoice.SALESPERSON_NUMBER)}</Descriptions.Item>
                <Descriptions.Item label="Invoicing Rule">{fmt(invoice.INVOICING_RULE)}</Descriptions.Item>
                <Descriptions.Item label="Legal Entity">{fmt(invoice.LEGAL_ENTITY_IDENTIFIER)}</Descriptions.Item>
                <Descriptions.Item label="Payment Terms">{fmt(invoice.PAYMENT_TERMS)}</Descriptions.Item>
              </Descriptions>
            </Col>

            {/* Column 3 — Totals */}
            <Col xs={24} md={8}>
              <div style={{
                background: REDWOOD.neutral100, borderRadius: 8, padding: 16,
                border: `1px solid ${REDWOOD.neutral200}`,
              }}>
                <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600 }}>
                  <Descriptions.Item label="Currency">{fmt(invoice.INVOICE_CURRENCY_CODE)}</Descriptions.Item>
                </Descriptions>
                <Divider style={{ margin: '8px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'Transaction Total', value: invoice.ENTERED_AMOUNT, bold: true },
                    { label: 'Lines',             value: invoice.ENTERED_AMOUNT },
                    { label: 'Tax',               value: 0 },
                    { label: 'Freight',           value: invoice.FREIGHT_AMOUNT },
                    { label: 'Charges',           value: 0 },
                    { label: 'Invoice Balance',   value: invoice.INVOICE_BALANCE_AMOUNT },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text style={{ color: REDWOOD.neutral600, fontSize: 13 }}>{row.label}</Text>
                      <Text strong={row.bold} style={{ fontSize: 13, color: REDWOOD.neutral900 }}>
                        {fmtAmt(row.value, currency)}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            </Col>
          </Row>
        </Card>

        {/* ── Customer / Payment / Misc Tabs ──────────────────────────────── */}
        <Card
          style={{ borderRadius: 8, marginBottom: 16, border: `1px solid ${REDWOOD.border}` }}
          bodyStyle={{ padding: 0 }}
        >
          <Tabs
            defaultActiveKey="customer"
            style={{ padding: '0 16px' }}
            items={[
              {
                key: 'customer',
                label: 'Customer',
                children: (
                  <Row gutter={[32, 24]} style={{ padding: '16px 8px 24px' }}>
                    {/* Bill-to */}
                    <Col xs={24} md={8}>
                      <Text strong style={{ color: REDWOOD.info, display: 'block', marginBottom: 8 }}>Bill-to</Text>
                      <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 80 }}>
                        <Descriptions.Item label="Name">{fmt(invoice.BILL_TO_CUSTOMER_NAME)}</Descriptions.Item>
                        <Descriptions.Item label="Account">{fmt(invoice.BILL_TO_CUSTOMER_NUMBER)}</Descriptions.Item>
                        <Descriptions.Item label="Site">{fmt(invoice.BILL_TO_SITE)}</Descriptions.Item>
                        <Descriptions.Item label="Contact">{fmt(invoice.BILL_TO_CONTACT)}</Descriptions.Item>
                      </Descriptions>
                    </Col>

                    {/* Ship-to */}
                    <Col xs={24} md={8}>
                      <Text strong style={{ color: REDWOOD.info, display: 'block', marginBottom: 8 }}>Ship-to</Text>
                      <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 80 }}>
                        <Descriptions.Item label="Name">{fmt(invoice.SHIP_TO_CUSTOMER_NAME)}</Descriptions.Item>
                        <Descriptions.Item label="Site">{fmt(invoice.SHIP_TO_SITE)}</Descriptions.Item>
                        <Descriptions.Item label="Contact">{fmt(invoice.SHIP_TO_CONTACT)}</Descriptions.Item>
                      </Descriptions>
                    </Col>

                    {/* Sold-to + Paying Customer */}
                    <Col xs={24} md={8}>
                      <Text strong style={{ color: REDWOOD.info, display: 'block', marginBottom: 8 }}>Sold-to</Text>
                      <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 80 }}>
                        <Descriptions.Item label="Name">{fmt(invoice.SOLD_TO_PARTY_NUMBER)}</Descriptions.Item>
                      </Descriptions>
                      <Divider style={{ margin: '12px 0' }} />
                      <Text strong style={{ color: REDWOOD.info, display: 'block', marginBottom: 8 }}>Paying Customer</Text>
                      <Descriptions column={1} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 80 }}>
                        <Descriptions.Item label="Name">{fmt(invoice.PAYING_CUSTOMER_NAME)}</Descriptions.Item>
                        <Descriptions.Item label="Account">{fmt(invoice.PAYING_CUSTOMER_ACCOUNT)}</Descriptions.Item>
                        <Descriptions.Item label="Site">{fmt(invoice.PAYING_CUSTOMER_SITE)}</Descriptions.Item>
                      </Descriptions>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'payment',
                label: 'Payment',
                children: (
                  <div style={{ padding: '16px 8px 24px' }}>
                    <Descriptions column={2} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 180 }}>
                      <Descriptions.Item label="Receipt Method">{fmt(invoice.RECEIPT_METHOD)}</Descriptions.Item>
                      <Descriptions.Item label="Payment Terms">{fmt(invoice.PAYMENT_TERMS)}</Descriptions.Item>
                      <Descriptions.Item label="Purchase Order">{fmt(invoice.PURCHASE_ORDER)}</Descriptions.Item>
                      <Descriptions.Item label="PO Date">{fmtDate(invoice.PURCHASE_ORDER_DATE)}</Descriptions.Item>
                      <Descriptions.Item label="PO Revision">{fmt(invoice.PURCHASE_ORDER_REVISION)}</Descriptions.Item>
                      <Descriptions.Item label="Due Date">{fmtDate(invoice.DUE_DATE)}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ),
              },
              {
                key: 'miscellaneous',
                label: 'Miscellaneous',
                children: (
                  <div style={{ padding: '16px 8px 24px' }}>
                    <Descriptions column={2} size="small" labelStyle={{ color: REDWOOD.neutral600, width: 200 }}>
                      <Descriptions.Item label="Delivery Method">{fmt(invoice.DELIVERY_METHOD)}</Descriptions.Item>
                      <Descriptions.Item label="Email">{fmt(invoice.EMAIL)}</Descriptions.Item>
                      <Descriptions.Item label="Print Option">{fmt(invoice.PRINT_OPTION)}</Descriptions.Item>
                      <Descriptions.Item label="Default Taxation Country">{fmt(invoice.DEFAULT_TAXATION_COUNTRY)}</Descriptions.Item>
                      <Descriptions.Item label="Remit-to Address">{fmt(invoice.REMIT_TO_ADDRESS)}</Descriptions.Item>
                      <Descriptions.Item label="Prepayment">{fmt(invoice.PREPAYMENT)}</Descriptions.Item>
                      <Descriptions.Item label="Intercompany">{fmt(invoice.INTERCOMPANY)}</Descriptions.Item>
                      <Descriptions.Item label="Special Instructions">{fmt(invoice.SPECIAL_INSTRUCTIONS)}</Descriptions.Item>
                      <Descriptions.Item label="Comments">{fmt(invoice.COMMENTS)}</Descriptions.Item>
                      <Descriptions.Item label="Internal Notes">{fmt(invoice.INTERNAL_NOTES)}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ),
              },
            ]}
          />
        </Card>

        {/* ── Invoice Lines ───────────────────────────────────────────────── */}
        <Card
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}` }}
          title={<Text strong>Invoice Details</Text>}
          bodyStyle={{ padding: 0 }}
        >
          <Tabs
            defaultActiveKey="lines"
            style={{ padding: '0 16px' }}
            items={[
              {
                key: 'lines',
                label: `Invoice Lines (${lines.length})`,
                children: (
                  <Table
                    columns={lineColumns}
                    dataSource={lines}
                    size="small"
                    scroll={{ x: 1100 }}
                    pagination={false}
                    style={{ marginBottom: 16 }}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={7} align="right">
                          <Text strong>Total</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right">
                          <Text strong>
                            {lines.reduce((s, l) => s + (l.lineAmount || 0), 0)
                              .toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} />
                      </Table.Summary.Row>
                    )}
                  />
                ),
              },
              {
                key: 'salesCredits',
                label: 'Sales Credits',
                children: (
                  <div style={{ padding: '16px 0 24px', textAlign: 'center', color: REDWOOD.neutral600 }}>
                    No sales credits for this transaction
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </Content>
      <FloatingMenu />
      
    </Layout>
  );
};

export default InvoiceDetail;
