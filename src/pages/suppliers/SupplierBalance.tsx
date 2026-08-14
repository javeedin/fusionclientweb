import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout,
  Card,
  Typography,
  Table,
  Row,
  Col,
  Breadcrumb,
  Tabs,
  Spin,
  Statistic,
  Space,
  Button,
  Tag,
  Descriptions,
  Progress,
  Divider,
  message,
  Modal,
  Tooltip,
  Alert,
} from 'antd';
import {
  HomeOutlined,
  ArrowLeftOutlined,
  DollarOutlined,
  FileTextOutlined,
  CreditCardOutlined,
  UserOutlined,
  EnvironmentOutlined,
  CalendarOutlined,
  BankOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  ApiOutlined,
  CopyOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { Link, useParams, useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF', taskBlue: '#0572CE',
};

// ── API endpoints ──────────────────────────────────────────────────────────────
const SUPPLIERS_URL  = `${APEX_DB_CONFIG.baseUrl}/suppliers`;
const INVOICES_URL   = `${APEX_DB_CONFIG.baseUrl}/ap/invoices`;
const PAYMENTS_URL   = `${APEX_DB_CONFIG.baseUrl}/ap/payments`;

interface SupplierInfo {
  supplierNumber: string;
  supplierName: string;
  supplierType: string;
  taxRegistrationNumber: string;
  status: string;
  creationDate: string;
}

interface InvoiceRecord {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  amountPaid: number;
  amountRemaining: number;
  validationStatus: string;
  paidStatus: string;
  currency: string;
  description: string;
  businessUnit: string;
  invoiceType: string;
}

interface PaymentRecord {
  key: string;
  checkId: number;
  paymentNumber: string;
  paymentDate: string;
  paymentAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  currency: string;
  maturityDate: string;
  bankAccount: string;
}

const formatCurrency = (amount: number, currency = 'AED') =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);

const formatDate = (d: string | null) => {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
};

// ── Small API info button shown on each tab ────────────────────────────────────
const ApiInfoButton: React.FC<{ url: string; description: string }> = ({ url, description }) => {
  const [open, setOpen]       = useState(false);
  const [copied, setCopied]   = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <Tooltip title="View API details">
        <Button
          size="small"
          type="text"
          icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Details</span></Space>}
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
        width={680}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{description}</Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: REDWOOD.neutral100, padding: '8px 12px', borderRadius: 6 }}>
          <code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}>{url}</code>
          <Button size="small" type="text" icon={copied ? <CheckOutlined style={{ color: REDWOOD.success }} /> : <CopyOutlined />} onClick={copy} />
        </div>
      </Modal>
    </>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const SupplierBalance: React.FC = () => {
  const { supplierNumber } = useParams<{ supplierNumber: string }>();
  const navigate = useNavigate();

  const [supplierLoading, setSupplierLoading] = useState(true);
  const [supplier, setSupplier] = useState<SupplierInfo | null>(null);

  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoices, setInvoices]               = useState<InvoiceRecord[]>([]);
  const [invoiceError, setInvoiceError]       = useState('');

  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [payments, setPayments]               = useState<PaymentRecord[]>([]);
  const [paymentsError, setPaymentsError]     = useState('');

  const [drilldownVisible, setDrilldownVisible] = useState(false);
  const [drilldownPayment, setDrilldownPayment] = useState<PaymentRecord | null>(null);
  const [relatedInvoices, setRelatedInvoices]   = useState<InvoiceRecord[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [copiedUrl]                             = useState(false);

  // Derived summary
  const totalInvoiceAmount  = invoices.reduce((s, r) => s + r.invoiceAmount, 0);
  const totalPaid           = invoices.reduce((s, r) => s + r.amountPaid, 0);
  const totalRemaining      = invoices.reduce((s, r) => s + r.amountRemaining, 0);
  const totalPaymentAmount  = payments.reduce((s, r) => s + r.paymentAmount, 0);

  // ── Fetch supplier info ────────────────────────────────────────────────────
  const fetchSupplier = useCallback(async () => {
    if (!supplierNumber) return;
    setSupplierLoading(true);
    try {
      const url = `${SUPPLIERS_URL}?supplier_number=${encodeURIComponent(supplierNumber)}&limit=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const item = (data.items || data)[0];
      if (item) {
        setSupplier({
          supplierNumber: item.supplier_number || supplierNumber,
          supplierName:   item.supplier        || item.supplier_name || '',
          supplierType:   item.supplier_type   || '',
          taxRegistrationNumber: item.tax_registration_number || '',
          status:         item.status          || 'Active',
          creationDate:   item.creation_date   || '',
        });
      }
    } catch (err) {
      console.error('Supplier fetch error:', err);
    } finally {
      setSupplierLoading(false);
    }
  }, [supplierNumber]);

  // ── Fetch invoices ─────────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    if (!supplierNumber) return;
    setInvoicesLoading(true);
    setInvoiceError('');
    try {
      const url = `${INVOICES_URL}?supplier_number=${encodeURIComponent(supplierNumber)}&limit=500`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = data.items || [];
      setInvoices(items.map((item: any, i: number) => ({
        key:              item.invoice_id?.toString() || String(i),
        invoiceId:        item.invoice_id,
        invoiceNumber:    item.invoice_number   || '',
        invoiceDate:      item.invoice_date     || '',
        invoiceAmount:    Number(item.invoice_amount  || 0),
        amountPaid:       Number(item.amount_paid     || 0),
        amountRemaining:  Number(item.amount_remaining ?? (Number(item.invoice_amount || 0) - Number(item.amount_paid || 0))),
        validationStatus: item.validation_status || '',
        paidStatus:       item.paid_status       || '',
        currency:         item.invoice_currency  || 'AED',
        description:      item.description       || '',
        businessUnit:     item.business_unit     || '',
        invoiceType:      item.invoice_type      || 'Standard',
      })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInvoiceError(msg);
      message.error(`Failed to load invoices: ${msg}`);
    } finally {
      setInvoicesLoading(false);
    }
  }, [supplierNumber]);

  // ── Fetch payments ─────────────────────────────────────────────────────────
  const fetchPayments = useCallback(async () => {
    if (!supplierNumber) return;
    setPaymentsLoading(true);
    setPaymentsError('');
    try {
      const url = `${PAYMENTS_URL}?supplier_number=${encodeURIComponent(supplierNumber)}&limit=500`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = data.items || [];
      setPayments(items.map((item: any, i: number) => ({
        key:           item.CheckId?.toString() || item.check_id?.toString() || String(i),
        checkId:       item.CheckId   || item.check_id,
        paymentNumber: item.PaymentNumber || item.payment_number || '',
        paymentDate:   item.PaymentDate   || item.payment_date   || '',
        paymentAmount: Number(item.PaymentAmount  || item.payment_amount  || 0),
        paymentStatus: item.PaymentStatus || item.payment_status || '',
        paymentMethod: item.PaymentMethod || item.payment_method || '',
        currency:      item.PaymentCurrency || item.payment_currency || 'AED',
        maturityDate:  item.MaturityDate  || item.maturity_date  || '',
        bankAccount:   item.BankAccountName || item.bank_account_name || '',
      })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPaymentsError(msg);
      message.error(`Failed to load payments: ${msg}`);
    } finally {
      setPaymentsLoading(false);
    }
  }, [supplierNumber]);

  // ── Fetch related invoices for a payment ──────────────────────────────────
  const openPaymentDrilldown = async (payment: PaymentRecord) => {
    setDrilldownPayment(payment);
    setDrilldownVisible(true);
    setDrilldownLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/payments/${payment.checkId}/related-invoices`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = data.items || data.invoices || [];
      setRelatedInvoices(items.map((item: any, i: number) => ({
        key:             item.invoice_id?.toString() || String(i),
        invoiceId:       item.invoice_id,
        invoiceNumber:   item.invoice_number  || '',
        invoiceDate:     item.invoice_date    || '',
        invoiceAmount:   Number(item.invoice_amount  || 0),
        amountPaid:      Number(item.amount_applied  || item.amount_paid || 0),
        amountRemaining: Number(item.amount_remaining || 0),
        invoiceType:     item.invoice_type || 'Standard',
        validationStatus:'', paidStatus: '', currency: 'AED', description: '', businessUnit: '',
      })));
    } catch (err) {
      message.error(`Failed to load related invoices: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDrilldownLoading(false);
    }
  };

  useEffect(() => { fetchSupplier(); }, [fetchSupplier]);

  const handleTabChange = (key: string) => {
    if (key === 'invoices'  && invoices.length  === 0) fetchInvoices();
    if (key === 'payments'  && payments.length  === 0) fetchPayments();
  };

  // ── Invoice columns ────────────────────────────────────────────────────────
  const invoiceColumns: ColumnsType<InvoiceRecord> = [
    { title: 'Invoice #', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 140,
      render: (v: string) => <Text strong style={{ color: REDWOOD.info }}>{v}</Text> },
    { title: 'Type', dataIndex: 'invoiceType', key: 'invoiceType', width: 110,
      render: (v: string) => {
        const color = v === 'Prepayment' ? 'purple' : v === 'Credit Memo' ? 'orange' : 'default';
        return <Tag color={color}>{v || 'Standard'}</Tag>;
      } },
    { title: 'Date', dataIndex: 'invoiceDate', key: 'invoiceDate', width: 110,
      render: (v: string) => formatDate(v) },
    { title: 'Amount', dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 140, align: 'right',
      render: (v: number, r: InvoiceRecord) => <Text strong>{formatCurrency(v, r.currency)}</Text> },
    { title: 'Paid', dataIndex: 'amountPaid', key: 'amountPaid', width: 140, align: 'right',
      render: (v: number, r: InvoiceRecord) => <Text style={{ color: REDWOOD.success }}>{formatCurrency(v, r.currency)}</Text> },
    { title: 'Balance / Open Credit', dataIndex: 'amountRemaining', key: 'amountRemaining', width: 160, align: 'right',
      render: (v: number, r: InvoiceRecord) => (
        v < 0
          ? <Text style={{ color: REDWOOD.warning }}>{`(${formatCurrency(Math.abs(v), r.currency)}) `}<span style={{ fontSize: 10 }}>credit</span></Text>
          : <Text style={{ color: v > 0 ? REDWOOD.error : REDWOOD.success }}>{formatCurrency(v, r.currency)}</Text>
      ) },
    { title: 'Status', dataIndex: 'paidStatus', key: 'paidStatus', width: 110,
      render: (v: string) => <Tag color={v === 'Paid' ? 'green' : v === 'Partially Paid' ? 'orange' : 'default'}>{v || '-'}</Tag> },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
  ];

  // ── Payment columns ────────────────────────────────────────────────────────
  const paymentColumns: ColumnsType<PaymentRecord> = [
    { title: 'Payment #', dataIndex: 'paymentNumber', key: 'paymentNumber', width: 140,
      render: (v: string, r: PaymentRecord) =>
        <a onClick={() => openPaymentDrilldown(r)} style={{ color: REDWOOD.info, fontWeight: 500 }}>{v}</a> },
    { title: 'Date', dataIndex: 'paymentDate', key: 'paymentDate', width: 110,
      render: (v: string) => formatDate(v) },
    { title: 'Maturity Date', dataIndex: 'maturityDate', key: 'maturityDate', width: 120,
      render: (v: string) => formatDate(v) },
    { title: 'Amount', dataIndex: 'paymentAmount', key: 'paymentAmount', width: 140, align: 'right',
      render: (v: number, r: PaymentRecord) =>
        <Text strong style={{ color: REDWOOD.success }}>{formatCurrency(v, r.currency)}</Text> },
    { title: 'Status', dataIndex: 'paymentStatus', key: 'paymentStatus', width: 110,
      render: (v: string) => <Tag color={v === 'Cleared' ? 'green' : v === 'Voided' ? 'red' : 'blue'}>{v || '-'}</Tag> },
    { title: 'Method', dataIndex: 'paymentMethod', key: 'paymentMethod', width: 100 },
    { title: 'Bank Account', dataIndex: 'bankAccount', key: 'bankAccount', ellipsis: true },
  ];

  const relatedInvColumns: ColumnsType<InvoiceRecord> = [
    { title: 'Invoice #', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 140 },
    { title: 'Date', dataIndex: 'invoiceDate', key: 'invoiceDate', width: 110, render: (v: string) => formatDate(v) },
    { title: 'Invoice Amount', dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 140, align: 'right',
      render: (v: number) => formatCurrency(v) },
    { title: 'Amount Applied', dataIndex: 'amountPaid', key: 'amountPaid', width: 140, align: 'right',
      render: (v: number) => <Text style={{ color: REDWOOD.success }}>{formatCurrency(v)}</Text> },
    { title: 'Remaining', dataIndex: 'amountRemaining', key: 'amountRemaining', width: 140, align: 'right',
      render: (v: number) => (
        v < 0
          ? <Text style={{ color: REDWOOD.warning }}>{`(${formatCurrency(Math.abs(v))}) `}<span style={{ fontSize: 10 }}>credit</span></Text>
          : <Text style={{ color: v > 0 ? REDWOOD.warning : REDWOOD.success }}>{formatCurrency(v)}</Text>
      ) },
  ];

  // ── Supplier header ────────────────────────────────────────────────────────
  const supplierApiUrl = `${SUPPLIERS_URL}?supplier_number=${encodeURIComponent(supplierNumber || '')}&limit=1`;
  const renderHeader = () => (
    <Card
      style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
      extra={
        <ApiInfoButton
          url={supplierApiUrl}
          description="Fetches supplier master record from APEX by supplier number."
        />
      }
    >
      <Row gutter={24} align="middle">
        <Col flex="auto">
          <Row align="middle" gutter={16}>
            <Col>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: REDWOOD.primary,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
            </Col>
            <Col>
              <Title level={4} style={{ margin: 0 }}>{supplier?.supplierName || supplierNumber}</Title>
              <Space>
                <Tag color={REDWOOD.info}>{supplier?.supplierNumber}</Tag>
                <Tag color={supplier?.status === 'Active' ? REDWOOD.success : REDWOOD.error}>{supplier?.status}</Tag>
                {supplier?.supplierType && <Tag>{supplier.supplierType}</Tag>}
              </Space>
            </Col>
          </Row>
          {(supplier?.taxRegistrationNumber || supplier?.creationDate) && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <Space size="large">
                {supplier?.taxRegistrationNumber && (
                  <span><BankOutlined style={{ marginRight: 6, color: REDWOOD.neutral600 }} />
                    <Text type="secondary">Tax Reg: </Text><Text>{supplier.taxRegistrationNumber}</Text>
                  </span>
                )}
                {supplier?.creationDate && (
                  <span><CalendarOutlined style={{ marginRight: 6, color: REDWOOD.neutral600 }} />
                    <Text type="secondary">Created: </Text><Text>{formatDate(supplier.creationDate)}</Text>
                  </span>
                )}
              </Space>
            </>
          )}
        </Col>
        <Col>
          <Card style={{ background: totalRemaining > 0 ? '#fff2f0' : '#f6ffed',
            borderColor: totalRemaining > 0 ? REDWOOD.error : REDWOOD.success, minWidth: 200 }}>
            <Statistic
              title={<Text strong>Outstanding Balance</Text>}
              value={totalRemaining}
              precision={2}
              prefix="AED"
              valueStyle={{ color: totalRemaining > 0 ? REDWOOD.error : REDWOOD.success, fontSize: 26 }}
            />
          </Card>
        </Col>
      </Row>
    </Card>
  );

  // ── Summary tab ────────────────────────────────────────────────────────────
  const renderSummary = () => (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {[
          { title: 'Total Invoices',       value: invoices.length,       prefix: <FileTextOutlined style={{ color: REDWOOD.info }} />, precision: 0 },
          { title: 'Total Invoice Amount', value: totalInvoiceAmount,    prefix: 'AED', precision: 2 },
          { title: 'Total Payments',       value: payments.length,       prefix: <CreditCardOutlined style={{ color: REDWOOD.success }} />, precision: 0 },
          { title: 'Total Paid',           value: totalPaymentAmount,    prefix: 'AED', precision: 2 },
        ].map((s, i) => (
          <Col span={6} key={i}>
            <Card><Statistic {...s} /></Card>
          </Col>
        ))}
      </Row>
      <Card title={<Space><ExclamationCircleOutlined style={{ color: REDWOOD.warning }} /><Text strong>Balance</Text></Space>}>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Total Invoice Amount">
            <Text strong>{formatCurrency(totalInvoiceAmount)}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Total Paid">
            <Text style={{ color: REDWOOD.success }}>- {formatCurrency(totalPaid)}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Outstanding Balance">
            <Text strong style={{ fontSize: 16, color: totalRemaining > 0 ? REDWOOD.error : REDWOOD.success }}>
              = {formatCurrency(totalRemaining)}
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );

  // ── Invoices tab ───────────────────────────────────────────────────────────
  const invoicesApiUrl = `${INVOICES_URL}?supplier_number=${supplierNumber}&limit=500`;
  const renderInvoices = () => {
    const totalAmt  = invoices.reduce((s, r) => s + (r.invoiceAmount  || 0), 0);
    const totalPaid = invoices.reduce((s, r) => s + (r.amountPaid     || 0), 0);
    const totalBal  = invoices.reduce((s, r) => s + (r.amountRemaining || 0), 0);

    return (
    <div>
      {invoiceError && <Alert type="error" message={invoiceError} style={{ marginBottom: 12 }} closable onClose={() => setInvoiceError('')} />}
      <Card
        title={<Space><FileTextOutlined style={{ color: REDWOOD.info }} /><Text strong>Invoices</Text>
          <Text type="secondary">({invoices.length})</Text></Space>}
        extra={<Space>
          <ApiInfoButton url={invoicesApiUrl} description="Fetches all AP invoices for this supplier from APEX." />
          <Button icon={<ReloadOutlined />} size="small" onClick={fetchInvoices} loading={invoicesLoading}>Refresh</Button>
        </Space>}
      >
        <Table columns={invoiceColumns} dataSource={invoices} loading={invoicesLoading}
          scroll={{ x: 1000 }} size="small"
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `${t} invoices` }}
        />
        {!invoicesLoading && invoices.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            borderTop: '2px solid #d46b08',
            background: '#fff7e6',
            borderRadius: '0 0 8px 8px',
            padding: '8px 12px',
          }}>
            <div style={{ flex: '0 0 280px' }}>
              <Text strong style={{ color: '#d46b08', fontSize: 13 }}>
                Grand Total ({invoices.length} invoices)
              </Text>
            </div>
            <div style={{ flex: '0 0 140px', textAlign: 'right' }}>
              <Text strong style={{ color: '#d46b08', fontFamily: 'monospace', fontSize: 13 }}>
                {formatCurrency(totalAmt)}
              </Text>
            </div>
            <div style={{ flex: '0 0 140px', textAlign: 'right' }}>
              <Text strong style={{ color: REDWOOD.success, fontFamily: 'monospace', fontSize: 13 }}>
                {formatCurrency(totalPaid)}
              </Text>
            </div>
            <div style={{ flex: '0 0 140px', textAlign: 'right' }}>
              <Text strong style={{ color: totalBal > 0 ? REDWOOD.error : REDWOOD.success, fontFamily: 'monospace', fontSize: 13 }}>
                {formatCurrency(totalBal)}
              </Text>
            </div>
          </div>
        )}
      </Card>
    </div>
    );
  };

  // ── Payments tab ───────────────────────────────────────────────────────────
  const paymentsApiUrl = `${PAYMENTS_URL}?supplier_number=${supplierNumber}&limit=500`;
  const renderPayments = () => (
    <div>
      {paymentsError && <Alert type="error" message={paymentsError} style={{ marginBottom: 12 }} closable onClose={() => setPaymentsError('')} />}
      <Card
        title={<Space><CreditCardOutlined style={{ color: REDWOOD.success }} /><Text strong>Payments</Text>
          <Text type="secondary">({payments.length})</Text></Space>}
        extra={<Space>
          <ApiInfoButton url={paymentsApiUrl} description="Fetches all AP payments for this supplier from APEX." />
          <Button icon={<ReloadOutlined />} size="small" onClick={fetchPayments} loading={paymentsLoading}>Refresh</Button>
        </Space>}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>Click a payment number to view related invoices.</Text>
        <Table columns={paymentColumns} dataSource={payments} loading={paymentsLoading}
          scroll={{ x: 900 }} size="small"
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `${t} payments` }}
          summary={pageData => {
            const amt = pageData.reduce((s, r) => s + r.paymentAmount, 0);
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                  <Table.Summary.Cell index={0} colSpan={3}><Text strong>Page Total</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><Text strong style={{ color: REDWOOD.success }}>{formatCurrency(amt)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} colSpan={3} />
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </Card>
    </div>
  );

  if (supplierLoading) {
    return (
      <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
        <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Spin size="large" tip="Loading supplier..." />
        </Content>
      </Layout>
    );
  }

  const summaryApiUrl = `${SUPPLIERS_URL}?supplier_number=${supplierNumber}`;

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: <Link to="/suppliers/manage">Suppliers</Link> },
            { title: `Balance — ${supplierNumber}` },
          ]} />
        </div>

        {/* Title bar */}
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/suppliers/manage')}>
                  Back to Suppliers
                </Button>
                <Divider type="vertical" />
                <Title level={4} style={{ margin: 0 }}>Supplier Balance</Title>
              </Space>
            </Col>
            <Col>
              <Button icon={<ReloadOutlined />} onClick={() => { fetchSupplier(); fetchInvoices(); fetchPayments(); }}>
                Refresh All
              </Button>
            </Col>
          </Row>
        </div>

        <div style={{ padding: '16px 24px' }}>
          {renderHeader()}

          <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Tabs
              defaultActiveKey="summary"
              onChange={handleTabChange}
              items={[
                {
                  key: 'summary',
                  label: <Space><DollarOutlined />Balance Summary</Space>,
                  children: (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                        <ApiInfoButton url={summaryApiUrl} description="Fetches supplier info. Balance is computed from invoices and payments." />
                      </div>
                      {renderSummary()}
                    </div>
                  ),
                },
                {
                  key: 'invoices',
                  label: <Space><FileTextOutlined />Invoices {invoices.length > 0 && <Tag>{invoices.length}</Tag>}</Space>,
                  children: renderInvoices(),
                },
                {
                  key: 'payments',
                  label: <Space><CreditCardOutlined />Payments {payments.length > 0 && <Tag>{payments.length}</Tag>}</Space>,
                  children: renderPayments(),
                },
              ]}
            />
          </Card>
        </div>

        {/* Payment drilldown modal */}
        <Modal
          title={<Space><CreditCardOutlined style={{ color: REDWOOD.success }} /><span>Payment: {drilldownPayment?.paymentNumber}</span></Space>}
          open={drilldownVisible}
          onCancel={() => { setDrilldownVisible(false); setRelatedInvoices([]); }}
          footer={<Button onClick={() => setDrilldownVisible(false)}>Close</Button>}
          width={860}
        >
          {drilldownPayment && (
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Payment #">{drilldownPayment.paymentNumber}</Descriptions.Item>
              <Descriptions.Item label="Date">{formatDate(drilldownPayment.paymentDate)}</Descriptions.Item>
              <Descriptions.Item label="Amount">
                <Text strong style={{ color: REDWOOD.success }}>{formatCurrency(drilldownPayment.paymentAmount, drilldownPayment.currency)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status"><Tag>{drilldownPayment.paymentStatus}</Tag></Descriptions.Item>
              <Descriptions.Item label="Method">{drilldownPayment.paymentMethod}</Descriptions.Item>
              <Descriptions.Item label="Bank">{drilldownPayment.bankAccount || '-'}</Descriptions.Item>
            </Descriptions>
          )}
          <Card title="Related Invoices" size="small">
            <Table columns={relatedInvColumns} dataSource={relatedInvoices} loading={drilldownLoading}
              size="small" pagination={false} locale={{ emptyText: 'No related invoices found' }} />
          </Card>
        </Modal>
      </Content>
    </Layout>
  );
};

export default SupplierBalance;
