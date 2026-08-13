import React, { useState, useCallback } from 'react';
import {
  Layout, Card, Form, Select, Input, Button, Space, Typography, Table, Tag,
  Row, Col, Breadcrumb, Tooltip, DatePicker, Collapse, message, Modal, Spin,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, FileTextOutlined,
  ApiOutlined, CopyOutlined, CheckOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import FloatingMenu from '../../components/FloatingMenu';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  error:      '#D93025',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
};

interface ARInvoiceRecord {
  key: string;
  customerTransactionId: number;
  transactionNumber: string;
  transactionSource: string;
  transactionClass: string;
  transactionType: string;
  invoiceStatus: string;
  billToCustomerName: string;
  billToCustomerNumber: string;
  enteredAmount: number;
  invoiceCurrencyCode: string;
  transactionDate: string;
  accountingDate: string;
  businessUnit: string;
  documentNumber: number;
  purchaseOrder: string;
  crossReference: string;
}

interface ARLineRecord {
  key: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unitSellingPrice: number;
  lineAmount: number;
  taxClassificationCode: string;
}

const APEX_AR_INVOICES_URL = `${APEX_DB_CONFIG.baseUrl}/ar/invoices`;

const ManageInvoices: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<ARInvoiceRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchCollapsed, setSearchCollapsed] = useState(false);

  // Expanded lines state: { [customerTransactionId]: { loading, lines } }
  const [expandedLines, setExpandedLines] = useState<Record<number, { loading: boolean; lines: ARLineRecord[] }>>({});

  // API modal state
  const [apiModalVisible, setApiModalVisible] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [lastCalledUrl, setLastCalledUrl] = useState<string | null>(null);
  const [lastApiStatus, setLastApiStatus] = useState<'success' | 'error' | null>(null);
  const [apiExecResults, setApiExecResults] = useState<Record<number, { loading: boolean; response: string | null }>>({});

  const PAGE_APIS = [
    {
      name: 'Search AR Transactions',
      method: 'GET',
      url: APEX_AR_INVOICES_URL,
      params: 'business_unit={bu}&transaction_source={src}&transaction_class={class}&transaction_type={type}&transaction_number={num}&bill_to_customer={customer}&cross_reference={ref}&date_from={YYYY-MM-DD}&date_to={YYYY-MM-DD}&limit=200',
      description: 'Returns AR invoice headers matching the search criteria.',
    },
    {
      name: 'Get Invoice Detail',
      method: 'GET',
      url: `${APEX_AR_INVOICES_URL}/{customerTransactionId}`,
      params: '',
      description: 'Fetches a single AR invoice header by its Customer Transaction ID.',
    },
    {
      name: 'Get Invoice Lines',
      method: 'GET',
      url: `${APEX_AR_INVOICES_URL}/{customerTransactionId}/lines`,
      params: '',
      description: 'Returns all invoice line items for a given transaction.',
    },
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    message.success('URL copied to clipboard');
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const executeApi = async (index: number, url: string) => {
    setApiExecResults(prev => ({ ...prev, [index]: { loading: true, response: null } }));
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let formatted = text;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `HTTP ${res.status}\n\n${formatted}` } }));
    } catch (e: any) {
      setApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `Error: ${e.message}` } }));
    }
  };

  const fetchLines = async (txnId: number) => {
    if (expandedLines[txnId]) return; // already loaded
    setExpandedLines(prev => ({ ...prev, [txnId]: { loading: true, lines: [] } }));
    try {
      const resp = await fetch(`${APEX_AR_INVOICES_URL}/${txnId}/lines`);
      const data = await resp.json();
      const lines: ARLineRecord[] = (data.items || []).map((l: any, i: number) => ({
        key: String(l.customer_transaction_line_id ?? l.CUSTOMER_TRANSACTION_LINE_ID ?? i),
        lineNumber:            l.line_number            ?? l.LINE_NUMBER,
        description:           l.description            ?? l.DESCRIPTION,
        quantity:              l.quantity               ?? l.QUANTITY,
        unitSellingPrice:      l.unit_selling_price     ?? l.UNIT_SELLING_PRICE,
        lineAmount:            l.line_amount            ?? l.LINE_AMOUNT,
        taxClassificationCode: l.tax_classification_code ?? l.TAX_CLASSIFICATION_CODE,
      }));
      setExpandedLines(prev => ({ ...prev, [txnId]: { loading: false, lines } }));
    } catch {
      setExpandedLines(prev => ({ ...prev, [txnId]: { loading: false, lines: [] } }));
    }
  };

  const handleSearch = useCallback(async () => {
    try {
      const values = form.getFieldsValue();
      setLoading(true);
      setSearched(true);
      setExpandedLines({});

      const params = new URLSearchParams();
      if (values.businessUnit)       params.append('business_unit',      values.businessUnit);
      if (values.transactionSource)  params.append('transaction_source',  values.transactionSource);
      if (values.transactionClass)   params.append('transaction_class',   values.transactionClass);
      if (values.transactionType)    params.append('transaction_type',    values.transactionType);
      if (values.transactionNumber)  params.append('transaction_number',  values.transactionNumber);
      if (values.billToCustomer)     params.append('bill_to_customer',    values.billToCustomer);
      if (values.reference)          params.append('cross_reference',     values.reference);
      if (values.dateRange?.[0])     params.append('date_from', values.dateRange[0].format('YYYY-MM-DD'));
      if (values.dateRange?.[1])     params.append('date_to',   values.dateRange[1].format('YYYY-MM-DD'));
      params.append('limit', '200');

      const url = `${APEX_AR_INVOICES_URL}?${params.toString()}`;
      setLastCalledUrl(url);

      const resp = await fetch(url);
      if (!resp.ok) {
        setLastApiStatus('error');
        throw new Error(`HTTP ${resp.status}`);
      }
      setLastApiStatus('success');
      const data = await resp.json();
      const rows: ARInvoiceRecord[] = (data.items || []).map((r: any) => ({
        key:                    String(r.CustomerTransactionId  ?? r.customer_transaction_id  ?? r.CUSTOMER_TRANSACTION_ID),
        customerTransactionId:  r.CustomerTransactionId  ?? r.customer_transaction_id  ?? r.CUSTOMER_TRANSACTION_ID,
        transactionNumber:      r.TransactionNumber      ?? r.transaction_number       ?? r.TRANSACTION_NUMBER,
        transactionSource:      r.TransactionSource      ?? r.transaction_source       ?? r.TRANSACTION_SOURCE,
        transactionClass:       r.TransactionClass       ?? r.transaction_class        ?? r.TRANSACTION_CLASS ?? '',
        transactionType:        r.TransactionType        ?? r.transaction_type         ?? r.TRANSACTION_TYPE,
        invoiceStatus:          r.InvoiceStatus          ?? r.invoice_status           ?? r.INVOICE_STATUS,
        billToCustomerName:     r.BillToCustomerName     ?? r.bill_to_customer_name    ?? r.BILL_TO_CUSTOMER_NAME,
        billToCustomerNumber:   r.BillToCustomerNumber   ?? r.bill_to_customer_number  ?? r.BILL_TO_CUSTOMER_NUMBER,
        enteredAmount:          r.EnteredAmount          ?? r.entered_amount           ?? r.ENTERED_AMOUNT,
        invoiceCurrencyCode:    r.InvoiceCurrencyCode    ?? r.invoice_currency_code    ?? r.INVOICE_CURRENCY_CODE,
        transactionDate:        r.TransactionDate        ?? r.transaction_date         ?? r.TRANSACTION_DATE,
        accountingDate:         r.AccountingDate         ?? r.accounting_date          ?? r.ACCOUNTING_DATE,
        businessUnit:           r.BusinessUnit           ?? r.business_unit            ?? r.BUSINESS_UNIT,
        documentNumber:         r.DocumentNumber         ?? r.document_number          ?? r.DOCUMENT_NUMBER,
        purchaseOrder:          r.PurchaseOrder          ?? r.purchase_order           ?? r.PURCHASE_ORDER,
        crossReference:         r.CrossReference         ?? r.cross_reference          ?? r.CROSS_REFERENCE,
      }));
      setInvoices(rows);
      if (rows.length === 0) message.info('No invoices found for the given criteria');
    } catch (err) {
      message.error('Failed to fetch invoices: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [form]);

  const handleReset = () => {
    form.resetFields();
    setInvoices([]);
    setSearched(false);
    setLastCalledUrl(null);
    setLastApiStatus(null);
    setExpandedLines({});
  };

  const lineColumns: ColumnsType<ARLineRecord> = [
    { title: 'Line', dataIndex: 'lineNumber', key: 'lineNumber', width: 60, align: 'center' },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: 'Quantity', dataIndex: 'quantity', key: 'quantity', width: 90, align: 'right',
      render: (v) => v != null ? Number(v).toLocaleString() : '',
    },
    {
      title: 'Unit Price', dataIndex: 'unitSellingPrice', key: 'unitSellingPrice', width: 120, align: 'right',
      render: (v) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
    },
    {
      title: 'Line Amount', dataIndex: 'lineAmount', key: 'lineAmount', width: 130, align: 'right',
      render: (v) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
    },
    { title: 'Tax Code', dataIndex: 'taxClassificationCode', key: 'taxClassificationCode', width: 130 },
  ];

  const columns: ColumnsType<ARInvoiceRecord> = [
    {
      title: 'Transaction Number',
      dataIndex: 'transactionNumber',
      key: 'transactionNumber',
      fixed: 'left',
      width: 155,
      render: (val, record) => (
        <Button
          type="link"
          style={{ padding: 0, color: REDWOOD.info, fontWeight: 500 }}
          onClick={() => navigate(`/ar/invoices/${record.customerTransactionId}`)}
        >
          {val}
        </Button>
      ),
    },
    {
      title: 'Transaction Source',
      dataIndex: 'transactionSource',
      key: 'transactionSource',
      width: 155,
      ellipsis: true,
      render: (val) => <Tooltip title={val}><span>{val}</span></Tooltip>,
    },
    {
      title: 'Transaction Class',
      dataIndex: 'transactionClass',
      key: 'transactionClass',
      width: 130,
    },
    {
      title: 'Transaction Type',
      dataIndex: 'transactionType',
      key: 'transactionType',
      width: 140,
      ellipsis: true,
      render: (val) => <Tooltip title={val}><span>{val}</span></Tooltip>,
    },
    {
      title: 'Complete',
      dataIndex: 'invoiceStatus',
      key: 'invoiceStatus',
      width: 90,
      align: 'center',
      render: (val) => {
        const isComplete = val === 'Complete';
        return (
          <span style={{ color: isComplete ? REDWOOD.success : REDWOOD.neutral600, fontWeight: 500 }}>
            {isComplete ? 'Yes' : 'No'}
          </span>
        );
      },
    },
    {
      title: 'Bill-to Customer',
      dataIndex: 'billToCustomerName',
      key: 'billToCustomerName',
      width: 200,
      ellipsis: true,
      render: (val) => <Tooltip title={val}><span>{val}</span></Tooltip>,
    },
    {
      title: 'Entered Amount',
      dataIndex: 'enteredAmount',
      key: 'enteredAmount',
      width: 150,
      align: 'right',
      render: (val, record) => (
        <span style={{ fontWeight: 500 }}>
          {Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {record.invoiceCurrencyCode}
        </span>
      ),
    },
    {
      title: 'Transaction Date',
      dataIndex: 'transactionDate',
      key: 'transactionDate',
      width: 130,
      render: (val) => val ? dayjs(val).format('D-MMM-YYYY') : '',
    },
    {
      title: 'Business Unit',
      dataIndex: 'businessUnit',
      key: 'businessUnit',
      width: 180,
      ellipsis: true,
      render: (val) => <Tooltip title={val}><span>{val}</span></Tooltip>,
    },
    {
      title: 'Original Transaction Number',
      key: 'originalTransactionNumber',
      width: 180,
      render: () => '',
    },
    {
      title: 'Document Number',
      dataIndex: 'documentNumber',
      key: 'documentNumber',
      width: 140,
    },
    {
      title: 'PO Number',
      dataIndex: 'purchaseOrder',
      key: 'purchaseOrder',
      width: 140,
      ellipsis: true,
      render: (val) => <Tooltip title={val}><span>{val}</span></Tooltip>,
    },
    {
      title: 'Reference',
      dataIndex: 'crossReference',
      key: 'crossReference',
      width: 150,
      ellipsis: true,
      render: (val) => <Tooltip title={val}><span>{val}</span></Tooltip>,
    },
  ];

  const expandable: TableProps<ARInvoiceRecord>['expandable'] = {
    onExpand: (expanded: boolean, record: ARInvoiceRecord) => {
      if (expanded) fetchLines(record.customerTransactionId);
    },
    expandedRowRender: (record: ARInvoiceRecord) => {
      const state = expandedLines[record.customerTransactionId];
      if (!state || state.loading) {
        return (
          <div style={{ padding: '12px 24px', textAlign: 'center' }}>
            <Spin size="small" />
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>Loading lines...</Text>
          </div>
        );
      }
      if (state.lines.length === 0) {
        return (
          <div style={{ padding: '12px 24px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>No lines found for this transaction.</Text>
          </div>
        );
      }
      return (
        <div style={{ padding: '8px 24px 16px' }}>
          <Table
            columns={lineColumns}
            dataSource={state.lines}
            size="small"
            pagination={false}
            style={{ background: '#fff' }}
            rowClassName={() => ''}
          />
        </div>
      );
    },
  };

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '0 24px 24px' }}>
        {/* Breadcrumb + actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0' }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /></Link> },
            { title: <Link to="/ar">Accounts Receivable</Link> },
            { title: 'Manage Invoices' },
          ]} />
          <Space>
            <Tooltip title="View Page APIs">
              <Button
                icon={<ApiOutlined />}
                onClick={() => setApiModalVisible(true)}
                style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
              />
            </Tooltip>
            <Button
              style={{ background: REDWOOD.primary, color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600 }}
              onClick={() => navigate('/ar')}
            >
              Done
            </Button>
          </Space>
        </div>

        <Title level={4} style={{ margin: '0 0 16px', color: REDWOOD.neutral900 }}>
          Manage Transactions
        </Title>

        {/* Search Panel */}
        <Card
          style={{ borderRadius: 8, marginBottom: 16, border: `1px solid ${REDWOOD.border}` }}
          bodyStyle={{ padding: 0 }}
        >
          <Collapse
            ghost
            defaultActiveKey={['search']}
            onChange={(keys) => setSearchCollapsed(!keys.includes('search'))}
          >
            <Collapse.Panel
              key="search"
              header={
                <Text strong style={{ color: REDWOOD.neutral900 }}>
                  {searchCollapsed ? '▶ Search' : '▼ Search'}
                </Text>
              }
              style={{ padding: '0 16px' }}
            >
              <Form form={form} layout="vertical" style={{ padding: '8px 0 16px' }}>
                <Row gutter={[24, 0]}>
                  <Col xs={24} md={12}>
                    <Row gutter={[16, 0]}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 12 }}>
                          <Input placeholder="Business unit" allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Transaction Source" name="transactionSource" style={{ marginBottom: 12 }}>
                          <Input placeholder="Transaction source" allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Transaction Class" name="transactionClass" style={{ marginBottom: 12 }}>
                          <Select placeholder="Select" allowClear>
                            <Option value="Invoice">Invoice</Option>
                            <Option value="Credit Memo">Credit Memo</Option>
                            <Option value="Debit Memo">Debit Memo</Option>
                            <Option value="Chargeback">Chargeback</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Transaction Type" name="transactionType" style={{ marginBottom: 12 }}>
                          <Input placeholder="Transaction type" allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Col>
                  <Col xs={24} md={12}>
                    <Row gutter={[16, 0]}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Transaction Number" name="transactionNumber" style={{ marginBottom: 12 }}>
                          <Input prefix={<span style={{ color: REDWOOD.neutral600, fontSize: 12 }}>Starts with</span>} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Bill-to Customer" name="billToCustomer" style={{ marginBottom: 12 }}>
                          <Input placeholder="Customer name or number" allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Transaction Date" name="dateRange" style={{ marginBottom: 12 }}>
                          <RangePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Reference" name="reference" style={{ marginBottom: 12 }}>
                          <Input placeholder="Cross reference" allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Col>
                </Row>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <Button onClick={handleReset} icon={<ReloadOutlined />}>Reset</Button>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={handleSearch}
                    loading={loading}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                  >
                    Search
                  </Button>
                </div>
              </Form>
            </Collapse.Panel>
          </Collapse>
        </Card>

        {/* Results Table */}
        {(searched || invoices.length > 0) && (
          <Card
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}` }}
            bodyStyle={{ padding: 0 }}
            title={
              <Space>
                <FileTextOutlined style={{ color: REDWOOD.primary }} />
                <Text strong>Search Results</Text>
                {invoices.length > 0 && <Tag style={{ borderRadius: 10 }}>{invoices.length} records</Tag>}
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={invoices}
              loading={loading}
              expandable={expandable}
              scroll={{ x: 1700 }}
              size="small"
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showTotal: (total) => `${total} invoices`,
              }}
              rowClassName={(_, idx) => idx % 2 === 0 ? '' : 'ar-row-alt'}
              onRow={(record) => ({
                onDoubleClick: () => navigate(`/ar/invoices/${record.customerTransactionId}`),
              })}
            />
          </Card>
        )}

        {!searched && invoices.length === 0 && (
          <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}`, textAlign: 'center', padding: 48 }}>
            <FileTextOutlined style={{ fontSize: 48, color: REDWOOD.neutral600, marginBottom: 16 }} />
            <br />
            <Text style={{ color: REDWOOD.neutral600 }}>
              Use the search criteria above to find AR transactions
            </Text>
          </Card>
        )}

        <style>{`
          .ar-row-alt { background: ${REDWOOD.neutral100}; }
          .ant-table-expand-icon-col { width: 32px !important; }
        `}</style>
      </Content>

      {/* API Viewer Modal */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>Page APIs — Manage Invoices (Receivables)</span>
          </Space>
        }
        open={apiModalVisible}
        onCancel={() => setApiModalVisible(false)}
        footer={[<Button key="close" onClick={() => setApiModalVisible(false)}>Close</Button>]}
        width={860}
      >
        <div style={{ marginBottom: 16 }}>
          <Tag color="blue">Data Source: APEX ORDS</Tag>
          <Text type="secondary" style={{ marginLeft: 8 }}>
            All data is served from the APEX REST Data Services layer
          </Text>
        </div>

        {lastCalledUrl && (
          <Card
            size="small"
            style={{ marginBottom: 16, border: `1px solid ${lastApiStatus === 'error' ? '#ff4d4f' : '#52c41a'}` }}
            title={
              <Space>
                <span style={{ color: lastApiStatus === 'error' ? '#ff4d4f' : '#52c41a' }}>●</span>
                <Text strong>Last Executed Request</Text>
                <Tag color={lastApiStatus === 'error' ? 'red' : 'green'}>
                  {lastApiStatus === 'error' ? 'Error' : 'Success'}
                </Tag>
              </Space>
            }
          >
            <Text type="secondary" style={{ fontSize: 12 }}>URL:</Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <code style={{ background: '#fff7e6', padding: '6px 10px', borderRadius: 4, fontSize: 12, flex: 1, wordBreak: 'break-all', border: '1px solid #ffd591' }}>
                {lastCalledUrl}
              </code>
              <Button size="small" icon={copiedUrl === lastCalledUrl ? <CheckOutlined /> : <CopyOutlined />} onClick={() => copyToClipboard(lastCalledUrl)} />
            </div>
          </Card>
        )}

        <Card
          size="small"
          title={
            <Space>
              <DatabaseOutlined style={{ color: REDWOOD.success }} />
              <Text strong>APEX REST Endpoints</Text>
              <Tag color="green">Active</Tag>
            </Space>
          }
        >
          {PAGE_APIS.map((api, index) => {
            const exec = apiExecResults[index];
            return (
              <div key={index} style={{ padding: 12, background: REDWOOD.neutral100, borderRadius: 6, marginBottom: index < PAGE_APIS.length - 1 ? 12 : 0 }}>
                <Row justify="space-between" align="middle" style={{ marginBottom: 6 }}>
                  <Col>
                    <Space>
                      <Tag color={api.method === 'GET' ? 'blue' : 'orange'}>{api.method}</Tag>
                      <Text strong>{api.name}</Text>
                    </Space>
                  </Col>
                  {api.method === 'GET' && !api.url.includes('{') && (
                    <Col>
                      <Button size="small" type="primary" loading={exec?.loading} onClick={() => executeApi(index, api.url)}
                        style={{ background: REDWOOD.success, borderColor: REDWOOD.success, fontSize: 12 }}>
                        Execute
                      </Button>
                    </Col>
                  )}
                </Row>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>{api.description}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>Full URL:</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: api.params ? 8 : 0 }}>
                  <code style={{ background: '#e8f4ff', padding: '5px 10px', borderRadius: 4, fontSize: 12, flex: 1, wordBreak: 'break-all', border: '1px solid #91caff' }}>
                    {api.url}
                  </code>
                  <Button size="small" icon={copiedUrl === api.url ? <CheckOutlined /> : <CopyOutlined />} onClick={() => copyToClipboard(api.url)} />
                </div>
                {api.params && (
                  <>
                    <Text type="secondary" style={{ fontSize: 12 }}>Query Parameters:</Text>
                    <div style={{ marginTop: 2 }}>
                      <code style={{ background: '#f5f5f5', padding: '5px 10px', borderRadius: 4, fontSize: 11, display: 'block', wordBreak: 'break-all', border: '1px solid #d9d9d9', color: REDWOOD.neutral600 }}>
                        ?{api.params}
                      </code>
                    </div>
                  </>
                )}
                {exec && !exec.loading && exec.response !== null && (
                  <div style={{ marginTop: 10 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Response:</Text>
                    <pre style={{ background: '#0d1117', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', maxHeight: 220, overflowY: 'auto', overflowX: 'auto', margin: '4px 0 0', color: exec.response.startsWith('Error') ? '#ff7875' : '#7ee787' }}>
                      {exec.response}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </Modal>

      <FloatingMenu />
      
    </Layout>
  );
};

export default ManageInvoices;
