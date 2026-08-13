import React, { useState, useRef, useEffect } from 'react';
import {
  Layout,
  Card,
  Form,
  Select,
  Input,
  Button,
  Space,
  Typography,
  Table,
  Row,
  Col,
  Breadcrumb,
  Collapse,
  message,
  DatePicker,
  Tabs,
  Switch,
  Spin,
  Divider,
  Descriptions,
  Checkbox,
  Modal,
  Tag,
  Tooltip,
  Statistic,
  Progress,
} from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  ReloadOutlined,
  SaveOutlined,
  PlusOutlined,
  SettingOutlined,
  SwapOutlined,
  CloudOutlined,
  DatabaseOutlined,
  UserOutlined,
  EnvironmentOutlined,
  BankOutlined,
  ContactsOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  CloseOutlined,
  ApiOutlined,
  CopyOutlined,
  CheckOutlined,
  DollarOutlined,
  FileTextOutlined,
  CreditCardOutlined,
  ExclamationCircleOutlined,
  CalendarOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  BarChartOutlined,
  EditOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import FloatingMenu from '../../components/FloatingMenu';
import InvoiceDetail from './InvoiceDetail';
import type { ColumnsType } from 'antd/es/table';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;
const { Panel } = Collapse;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  error: '#D93025',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  taskBlue: '#0572CE',
};

import { APEX_DB_CONFIG, ORACLE_FUSION_CONFIG } from '../../config/api.config';

const FUSION_AUTH = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);

// Supplier record interface
interface SupplierRecord {
  key: string;
  supplierId: number;
  supplier: string;
  supplierNumber: string;
  alternateName: string;
  businessRelationship: string;
  parentSupplier: string;
  creationDate: string;
  inactiveSince: string;
  taxRegistrationNumber: string;
  taxpayerId: string;
  dunsNumber: string;
  supplierType: string;
  taxOrganizationType: string;
  status: string;
}

// Supplier detail interface
interface SupplierDetail extends SupplierRecord {
  // General
  creationSource: string;
  registrationRequest: string;
  parentSupplierNumber: string;
  inactiveDate: string;
  // Identification
  alias: string;
  customerNumber: string;
  sic: string;
  nationalInsuranceNumber: string;
  corporateWebSite: string;
  oneTimeSupplier: boolean;
  registryId: string;
  relationships: string;
  // Regional Information
  regionalInformation: string;
  // Corporate Profile
  yearEstablished: string;
  missionStatement: string;
  yearIncorporated: string;
  chiefExecutiveTitle: string;
  chiefExecutiveName: string;
  principalTitle: string;
  principalName: string;
  // Financial Profile
  fiscalYearEndMonth: string;
  currentFiscalYearRevenue: string;
  preferredFunctionalCurrency: string;
}

// Tab item interface for open suppliers
interface SupplierTab {
  key: string;
  label: string;
  supplier: SupplierRecord;
  detail?: SupplierDetail;
  loading?: boolean;
  tabType: 'detail' | 'balance';
}

// Balance tab interfaces
interface BalanceSummary {
  totalInvoices: number;
  totalInvoiceAmount: number;
  totalPayments: number;
  totalPaymentAmount: number;
  balance: number;
  currency: string;
}

interface AgingBucket {
  bucket: string;
  amount: number;
  invoiceCount: number;
  percentage: number;
}

interface SupplierAddress {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface BalanceData {
  supplier: {
    supplierId: number;
    supplierNumber: string;
    supplierName: string;
    supplierType: string | null;
    status: string;
    taxRegistrationNumber: string | null;
    creationDate: string | null;
    address: SupplierAddress | null;
  };
  balanceSummary: BalanceSummary;
  agingReport: AgingBucket[];
}

interface InvoiceRecord {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  invoiceAmount: number;
  amountPaid: number;
  amountRemaining: number;
  invoiceStatus: string;
  currency: string;
  description: string;
}

interface PaymentRecord {
  key: string;
  paymentId: number;
  checkId: number;
  paymentNumber: string;
  paymentDate: string;
  paymentAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  currency: string;
  bankAccountName: string;
}

interface RelatedInvoice {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceAmount: number;
  amountApplied: number;      // cash paid (AMOUNT_PAID_INVOICE_CURRENCY)
  discountTaken: number;      // discount settled at payment time
  discountLost: number;
  totalSettled: number;       // amountApplied + discountTaken
}

interface CategoryInvoice {
  invoiceNumber: string;
  description: string;
  amount: number;
}

interface CategoryData {
  name: string;
  amount: number;
  count: number;
}

interface TrendData {
  month: string;
  amount: number;
}

interface AnalyticsData {
  categories: CategoryData[];
  trend: TrendData[];
  totalAmount: number;
  totalCount: number;
  invoicesByCategory: Record<string, CategoryInvoice[]>;
}

// Helper function to format date
const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

// Map Fusion API response to SupplierRecord
const mapFusionToSupplierRecord = (item: any, index: number): SupplierRecord => ({
  key: item.SupplierId?.toString() || index.toString(),
  supplierId: item.SupplierId,
  supplier: item.Supplier || '',
  supplierNumber: item.SupplierNumber || '',
  alternateName: item.AlternateName || '',
  businessRelationship: item.BusinessRelationship || '',
  parentSupplier: item.ParentSupplier || '',
  creationDate: formatDate(item.CreationDate),
  inactiveSince: formatDate(item.InactiveDate),
  taxRegistrationNumber: item.TaxRegistrationNumber || '',
  taxpayerId: item.TaxpayerId || '',
  dunsNumber: item.DUNSNumber || '',
  supplierType: item.SupplierType || '',
  taxOrganizationType: item.TaxOrganizationType || '',
  status: item.Status || 'Active',
});

// Map APEX API response to SupplierRecord (lowercase column names)
const mapApexToSupplierRecord = (item: any, index: number): SupplierRecord => ({
  key: item.supplier_id?.toString() || index.toString(),
  supplierId: item.supplier_id,
  supplier: item.supplier || '',
  supplierNumber: item.supplier_number || '',
  alternateName: item.alternate_name || '',
  businessRelationship: item.business_relationship || '',
  parentSupplier: item.parent_supplier || '',
  creationDate: formatDate(item.creation_date),
  inactiveSince: formatDate(item.inactive_date),
  taxRegistrationNumber: item.tax_registration_number || '',
  taxpayerId: item.taxpayer_id || '',
  dunsNumber: item.duns_number || '',
  supplierType: item.supplier_type || '',
  taxOrganizationType: item.tax_organization_type || '',
  status: item.status || 'Active',
});

// Map Fusion detail API response to SupplierDetail
const mapFusionToSupplierDetail = (item: any): SupplierDetail => ({
  key: item.SupplierId?.toString() || '',
  supplierId: item.SupplierId,
  supplier: item.Supplier || '',
  supplierNumber: item.SupplierNumber || '',
  alternateName: item.AlternateName || '',
  businessRelationship: item.BusinessRelationship || '',
  parentSupplier: item.ParentSupplier || '',
  creationDate: formatDate(item.CreationDate),
  inactiveSince: formatDate(item.InactiveDate),
  taxRegistrationNumber: item.TaxRegistrationNumber || '',
  taxpayerId: item.TaxpayerId || '',
  dunsNumber: item.DUNSNumber || '',
  supplierType: item.SupplierType || '',
  taxOrganizationType: item.TaxOrganizationType || '',
  status: item.Status || 'Active',
  // General
  creationSource: item.CreationSource || '',
  registrationRequest: item.RegistrationRequest || '',
  parentSupplierNumber: item.ParentSupplierNumber || '',
  inactiveDate: formatDate(item.InactiveDate),
  // Identification
  alias: item.Alias || '',
  customerNumber: item.CustomerNumber || '',
  sic: item.SIC || '',
  nationalInsuranceNumber: item.NationalInsuranceNumber || '',
  corporateWebSite: item.CorporateWebSite || '',
  oneTimeSupplier: item.OneTimeSupplierFlag === 'Y',
  registryId: item.RegistryId || '',
  relationships: item.Relationships || 'Supplier',
  // Regional Information
  regionalInformation: item.RegionalInformation || '',
  // Corporate Profile
  yearEstablished: item.YearEstablished || '',
  missionStatement: item.MissionStatement || '',
  yearIncorporated: item.YearIncorporated || '',
  chiefExecutiveTitle: item.ChiefExecutiveTitle || '',
  chiefExecutiveName: item.ChiefExecutiveName || '',
  principalTitle: item.PrincipalTitle || '',
  principalName: item.PrincipalName || '',
  // Financial Profile
  fiscalYearEndMonth: item.FiscalYearEndMonth || '',
  currentFiscalYearRevenue: item.CurrentFiscalYearRevenue || '',
  preferredFunctionalCurrency: item.PreferredFunctionalCurrency || '',
});

// ── InvoicesTabContent ──────────────────────────────────────────────────────
// Defined OUTSIDE ManageSuppliers so its type identity is stable across
// parent re-renders, preventing full remount when parent state changes.
interface InvoicesTabContentProps {
  invoices: InvoiceRecord[];
  invoicesLoading: boolean;
  supplierNumber: string;
  apiUrl: string;
  onExport: (rows: InvoiceRecord[]) => void;
  onRefresh: () => void;
  onEdit: (invoice: InvoiceRecord) => void;
}

const InvoicesTabContent: React.FC<InvoicesTabContentProps> = ({
  invoices, invoicesLoading, apiUrl, onExport, onRefresh, onEdit,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fmt = (amt: number, currency = 'AED') =>
    new Intl.NumberFormat('en-AE', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amt);

  // Totals over ALL invoices (not just filtered) for the summary cards
  const totals = React.useMemo(() => ({
    count:     invoices.length,
    amount:    invoices.reduce((s, r) => s + (r.invoiceAmount   || 0), 0),
    paid:      invoices.reduce((s, r) => s + (r.amountPaid      || 0), 0),
    balance:   invoices.reduce((s, r) => s + (r.amountRemaining || 0), 0),
    currency:  invoices[0]?.currency || 'AED',
    paidCount:   invoices.filter(r => (r.amountRemaining || 0) === 0).length,
    unpaidCount: invoices.filter(r => (r.amountRemaining || 0) !== 0).length,
  }), [invoices]);

  const filtered = React.useMemo(() => {
    let rows = invoices;
    if (statusFilter === 'paid')   rows = rows.filter(r => (r.amountRemaining || 0) === 0);
    if (statusFilter === 'unpaid') rows = rows.filter(r => (r.amountRemaining || 0) !== 0);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.invoiceNumber || '').toLowerCase().includes(q) ||
        (r.description   || '').toLowerCase().includes(q) ||
        (r.invoiceStatus || '').toLowerCase().includes(q) ||
        String(r.invoiceAmount).includes(q)
      );
    }
    return rows;
  }, [invoices, statusFilter, search]);

  React.useEffect(() => { setPage(1); }, [search, statusFilter]);

  const fmtNum = (n: number) =>
    new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const columns = React.useMemo(() => [
    { title: 'Invoice #', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 130,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Date', dataIndex: 'invoiceDate', key: 'invoiceDate', width: 100,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    {
      title: 'Amount', dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 120, align: 'right' as const,
      render: (amt: number, r: InvoiceRecord) => <Text strong style={{ fontSize: 11 }}>{fmt(amt, r.currency)}</Text>
    },
    {
      title: 'Paid', dataIndex: 'amountPaid', key: 'amountPaid', width: 120, align: 'right' as const,
      render: (amt: number, r: InvoiceRecord) => <Text style={{ color: REDWOOD.success, fontSize: 11 }}>{fmt(amt, r.currency)}</Text>
    },
    {
      title: 'Balance', dataIndex: 'amountRemaining', key: 'amountRemaining', width: 140, align: 'right' as const,
      render: (amt: number, r: InvoiceRecord) => (
        amt < 0
          ? <Text style={{ color: REDWOOD.warning, fontSize: 11 }}>{`(${fmt(Math.abs(amt), r.currency)}) `}<span style={{ fontSize: 9 }}>credit</span></Text>
          : <Text style={{ color: amt > 0 ? REDWOOD.error : REDWOOD.success, fontSize: 11 }}>{fmt(amt, r.currency)}</Text>
      )
    },
    {
      title: 'Status', dataIndex: 'invoiceStatus', key: 'invoiceStatus', width: 90,
      render: (status: string) => {
        const color = status === 'PAID' ? 'green' : status === 'CANCELLED' ? 'default' : status === 'HOLD' ? 'orange' : 'blue';
        return <Tag color={color} style={{ fontSize: 10 }}>{status || '-'}</Tag>;
      }
    },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    {
      title: '', key: 'actions', width: 40, fixed: 'right' as const,
      render: (_: any, record: InvoiceRecord) => (
        <Tooltip title="View / Edit Invoice">
          <Button type="text" size="small" icon={<EditOutlined />} style={{ color: REDWOOD.info }} onClick={() => onEdit(record)} />
        </Tooltip>
      ),
    },
  ], [onEdit]);

  return (
    <div>
      {/* Totals row */}
      {invoices.length > 0 && (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={6}>
            <Card size="small" style={{ background: '#f0f5ff', borderColor: '#adc6ff' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Total Invoices</Text>} value={totals.count} valueStyle={{ fontSize: 16 }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#f0f5ff', borderColor: '#adc6ff' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Invoice Amount</Text>} value={totals.amount} precision={2} suffix={totals.currency} valueStyle={{ fontSize: 15 }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Total Paid</Text>} value={totals.paid} precision={2} suffix={totals.currency} valueStyle={{ fontSize: 15, color: REDWOOD.success }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: totals.balance > 0 ? '#fff2f0' : '#f6ffed', borderColor: totals.balance > 0 ? '#ffccc7' : '#b7eb8f' }}>
              <Statistic title={<Text style={{ fontSize: 11 }}>Outstanding Balance</Text>} value={totals.balance} precision={2} suffix={totals.currency} valueStyle={{ fontSize: 15, color: totals.balance > 0 ? REDWOOD.error : REDWOOD.success }} />
            </Card>
          </Col>
        </Row>
      )}

      {/* Status filter + search toolbar */}
      <Row gutter={8} style={{ marginBottom: 12 }} align="middle" justify="space-between">
        <Col>
          <Space>
            {(['all', 'paid', 'unpaid'] as const).map(s => (
              <Button
                key={s}
                size="small"
                type={statusFilter === s ? 'primary' : 'default'}
                onClick={() => setStatusFilter(s)}
                style={statusFilter === s ? { background: s === 'paid' ? REDWOOD.success : s === 'unpaid' ? REDWOOD.error : REDWOOD.info } : {}}
              >
                {s === 'all' ? `All (${totals.count})` : s === 'paid' ? `Paid (${totals.paidCount})` : `Unpaid (${totals.unpaidCount})`}
              </Button>
            ))}
          </Space>
        </Col>
        <Col>
          <Space>
            <Input
              placeholder="Search invoice #, description..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              allowClear
              size="small"
              style={{ width: 240 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} rows</Text>
            <Button icon={<FileExcelOutlined />} size="small" style={{ color: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={() => onExport(filtered)}>Excel</Button>
            <Button icon={<ReloadOutlined />} size="small" onClick={onRefresh} loading={invoicesLoading}>Refresh</Button>
            <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{apiUrl}</span>} placement="bottomRight">
              <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 14 }} />
            </Tooltip>
          </Space>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={filtered}
        loading={invoicesLoading}
        scroll={{ x: 900 }}
        size="small"
        rowKey="key"
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} invoices`,
          onChange: (p, s) => { setPage(p); setPageSize(s); },
        }}
        summary={() => {
          if (invoicesLoading || filtered.length === 0) return null;
          const fAmt  = filtered.reduce((s, r) => s + (r.invoiceAmount   || 0), 0);
          const fPaid = filtered.reduce((s, r) => s + (r.amountPaid      || 0), 0);
          const fBal  = filtered.reduce((s, r) => s + (r.amountRemaining || 0), 0);
          const label = filtered.length !== invoices.length ? `Filtered (${filtered.length})` : `Total (${filtered.length})`;
          return (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#fff7e6', fontWeight: 600 }}>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Text strong style={{ color: '#d46b08', fontSize: 11 }}>{label}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <Text strong style={{ color: '#d46b08', fontFamily: 'monospace', fontSize: 11 }}>{fmtNum(fAmt)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <Text strong style={{ color: REDWOOD.success, fontFamily: 'monospace', fontSize: 11 }}>{fmtNum(fPaid)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <Text strong style={{ color: fBal > 0 ? REDWOOD.error : REDWOOD.success, fontFamily: 'monospace', fontSize: 11 }}>{fmtNum(fBal)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} colSpan={3} />
              </Table.Summary.Row>
            </Table.Summary>
          );
        }}
      />
    </div>
  );
};

const ManageSuppliers: React.FC = () => {
  const [form] = Form.useForm();
  const selectedBU = Form.useWatch('businessUnit', form);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [gridFilter, setGridFilter] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // ── Register (create) supplier ─────────────────────────────────────────────
  const [createOpen,   setCreateOpen]   = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createForm]   = Form.useForm();

  const CREATE_SUPPLIER_URL = `${APEX_DB_CONFIG.baseUrl}/suppliers/create`;

  const buildSupplierPayload = (vals: any): any => {
    const addr = vals.address || {};
    return {
      supplier:              vals.supplier,
      supplierNumber:        vals.supplierNumber || undefined,
      alternateName:         vals.alternateName,
      supplierType:          vals.supplierType,
      taxOrganizationType:   vals.taxOrganizationType,
      businessRelationship:  vals.businessRelationship,
      taxRegistrationNumber: vals.taxRegistrationNumber,
      taxpayerId:            vals.taxpayerId,
      dunsNumber:            vals.dunsNumber,
      status:                vals.status || 'Active',
      createdBy:             'REACTERP',
      address: addr.addressName ? {
        addressName:   addr.addressName,
        country:       addr.country,
        addressLine1:  addr.addressLine1,
        addressLine2:  addr.addressLine2,
        city:          addr.city,
        state:         addr.state,
        postalCode:    addr.postalCode,
        phoneNumber:   addr.phoneNumber,
        email:         addr.email,
        purposeOrdering: !!addr.purposeOrdering,
        purposeRemitTo:  !!addr.purposeRemitTo,
      } : undefined,
      sites: (vals.sites || []).filter((s: any) => s && s.siteCode).map((s: any) => ({
        siteCode:       s.siteCode,
        siteName:       s.siteName,
        procurementBu:  s.procurementBu,
        addressName:    s.addressName || addr.addressName,
        payFlag:        !!s.payFlag,
        purchasingFlag: !!s.purchasingFlag,
        paymentTerms:   s.paymentTerms,
        invoiceCurrency: s.invoiceCurrency,
        status:         'Active',
      })),
    };
  };

  const showCreateSupplierApi = () => {
    const payload = buildSupplierPayload(createForm.getFieldsValue());
    Modal.info({
      title: 'Create Supplier — API Request',
      width: 660,
      content: (
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Method / URL</div>
          <Typography.Text copyable code style={{ fontSize: 12, wordBreak: 'break-all' }}>{`POST ${CREATE_SUPPLIER_URL}`}</Typography.Text>
          <div style={{ fontSize: 12, color: '#888', margin: '10px 0 4px' }}>JSON Body</div>
          <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 10, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      ),
    });
  };

  const handleCreateSupplier = async () => {
    let vals: any;
    try { vals = await createForm.validateFields(); }
    catch { return; }   // validation errors are shown inline
    setCreateSaving(true);
    try {
      const payload = buildSupplierPayload(vals);
      const res = await fetch(CREATE_SUPPLIER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        message.success(`Supplier ${data.supplierNumber || ''} created${data.sites ? ` with ${data.sites} site(s)` : ''}`);
        setCreateOpen(false);
        createForm.resetFields();
        handleSearch();
      } else {
        message.error(data.error || `Create failed (HTTP ${res.status})`);
      }
    } catch (e: any) {
      message.error(e?.message || 'Create failed');
    } finally {
      setCreateSaving(false);
    }
  };

  // Compute filtered suppliers at component level so changes always propagate
  const filteredSuppliers = React.useMemo(() => {
    const q = gridFilter.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(r =>
      (r.supplier              || '').toLowerCase().includes(q) ||
      (r.supplierNumber        || '').toLowerCase().includes(q) ||
      (r.alternateName         || '').toLowerCase().includes(q) ||
      (r.supplierType          || '').toLowerCase().includes(q) ||
      (r.status                || '').toLowerCase().includes(q) ||
      (r.taxRegistrationNumber || '').toLowerCase().includes(q)
    );
  }, [suppliers, gridFilter]);
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const dataSource = 'apex';

  // Tab management state
  const [activeTab, setActiveTab] = useState('search');
  const [openTabs, setOpenTabs] = useState<SupplierTab[]>([]);

  // Edit-supplier detail (Addresses / Sites) — stored per tab key
  const [addressesMap, setAddressesMap] = useState<Record<string, any[]>>({});
  const [sitesDetailMap, setSitesDetailMap] = useState<Record<string, any[]>>({});
  const [detailLoadingMap, setDetailLoadingMap] = useState<Record<string, boolean>>({});

  // Balance tab state - stored per tab key
  const [balanceDataMap, setBalanceDataMap] = useState<Record<string, BalanceData | null>>({});
  const [invoicesMap, setInvoicesMap] = useState<Record<string, InvoiceRecord[]>>({});
  const [invoicesUrlMap, setInvoicesUrlMap] = useState<Record<string, string>>({});
  const [paymentsMap, setPaymentsMap] = useState<Record<string, PaymentRecord[]>>({});
  const [balanceLoadingMap, setBalanceLoadingMap] = useState<Record<string, boolean>>({});
  const [invoicesLoadingMap, setInvoicesLoadingMap] = useState<Record<string, boolean>>({});
  const [paymentsLoadingMap, setPaymentsLoadingMap] = useState<Record<string, boolean>>({});

  // Payment drilldown modal
  const [drilldownVisible, setDrilldownVisible] = useState(false);
  const [drilldownPayment, setDrilldownPayment] = useState<PaymentRecord | null>(null);
  const [editInvoiceVisible, setEditInvoiceVisible] = useState(false);
  const [editInvoice, setEditInvoice] = useState<InvoiceRecord | null>(null);
  const [editInvoiceSaving, setEditInvoiceSaving] = useState(false);
  const [relatedInvoices, setRelatedInvoices] = useState<RelatedInvoice[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Analytics tab state
  const [analyticsDataMap, setAnalyticsDataMap] = useState<Record<string, AnalyticsData | null>>({});
  const [analyticsLoadingMap, setAnalyticsLoadingMap] = useState<Record<string, boolean>>({});
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string>('');
  const [catDrillVisible, setCatDrillVisible] = useState(false);
  const [catDrillCategory, setCatDrillCategory] = useState<string>('');
  const [catDrillInvoices, setCatDrillInvoices] = useState<CategoryInvoice[]>([]);

  // API Info Modal state
  const [apiModalVisible, setApiModalVisible] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Supplier LOV modal state
  const [lovVisible, setLovVisible] = useState(false);
  const [lovSearch, setLovSearch] = useState('');
  const [lovResults, setLovResults] = useState<{ supplierNumber: string; supplier: string }[]>([]);
  const [lovLoading, setLovLoading] = useState(false);
  // Cache — load once, filter client-side on every subsequent open
  const lovCacheRef = useRef<{ supplierNumber: string; supplier: string }[]>([]);

  const displayedLovResults = React.useMemo(() => {
    const q = lovSearch.trim().toLowerCase();
    const rows = q
      ? lovResults.filter(r =>
          (r.supplierNumber || '').toLowerCase().includes(q) ||
          (r.supplier       || '').toLowerCase().includes(q)
        )
      : lovResults;
    return rows.map((r, i) => ({ ...r, key: i }));
  }, [lovSearch, lovResults]);

  const openLov = async () => {
    setLovSearch('');
    setLovVisible(true);
    if (lovCacheRef.current.length > 0) {
      // Already loaded — use cache, no API call
      setLovResults(lovCacheRef.current);
      return;
    }
    // First open — fetch all suppliers and cache them
    setLovLoading(true);
    try {
      const items = await fetchAllApexSuppliers(new URLSearchParams());
      const mapped = items.map((item: any) => ({
        supplierNumber: item.supplier_number || '',
        supplier: item.supplier || '',
      }));
      lovCacheRef.current = mapped;
      setLovResults(mapped);
    } catch { /* ignore */ }
    finally { setLovLoading(false); }
  };

  // Fetch ALL pages from the APEX suppliers endpoint (no artificial limit)
  const fetchAllApexSuppliers = async (extraParams: URLSearchParams): Promise<any[]> => {
    const PAGE = 100;
    let offset = 0;
    let all: any[] = [];
    while (true) {
      const p = new URLSearchParams(extraParams);
      p.set('limit', String(PAGE));
      p.set('offset', String(offset));
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/suppliers?${p.toString()}`);
      if (!res.ok) break;
      const data = await res.json();
      const items: any[] = Array.isArray(data) ? data : (data.items || []);
      all = [...all, ...items];
      if (!data.hasMore || items.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  };


  const onLovPick = (row: { supplierNumber: string; supplier: string }) => {
    form.setFieldsValue({ supplierNumber: row.supplierNumber, supplier: row.supplier });
    setLovVisible(false);
  };

  // Business Unit options — fetched from RR_GL_BUSINESS_UNITS via GET /gl/businessunits
  const [businessUnits, setBusinessUnits] = useState<string[]>([]);
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const items: any[] = Array.isArray(data) ? data : (data.items || []);
        setBusinessUnits(items.map((i: any) => i.business_unit_name || '').filter(Boolean));
      })
      .catch(() => {});
  }, []);

  // API Configuration for this page
  const PAGE_APIS = {
    fusion: [
      {
        name: 'Search Suppliers',
        method: 'GET',
        proxyUrl: `${ORACLE_FUSION_CONFIG.baseUrl}/suppliers`,
        actualUrl: `${ORACLE_FUSION_CONFIG.baseUrl}/suppliers`,
        params: 'limit=25&onlyData=true',
        description: 'Fetches list of suppliers with pagination',
      },
      {
        name: 'Get Supplier Detail',
        method: 'GET',
        proxyUrl: `${ORACLE_FUSION_CONFIG.baseUrl}/suppliers/{supplierId}`,
        actualUrl: `${ORACLE_FUSION_CONFIG.baseUrl}/suppliers/{supplierId}`,
        params: '',
        description: 'Fetches complete supplier details by ID',
      },
    ],
    apex: [
      {
        name: 'Search Suppliers',
        method: 'GET',
        proxyUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers`,
        actualUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers`,
        params: '',
        description: 'Fetches suppliers from APEX database',
      },
      {
        name: 'Supplier Balance Dashboard',
        method: 'GET',
        proxyUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/dashboard/{supplierNumber}`,
        actualUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/dashboard/{supplierNumber}`,
        params: '',
        description: 'Fetches supplier balance summary, aging report, and supplier details',
      },
      {
        name: 'Supplier Balance Invoices',
        method: 'GET',
        proxyUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/{supplierNumber}`,
        actualUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/{supplierNumber}`,
        params: '',
        description: 'Fetches all invoices for a supplier with amounts and status',
      },
      {
        name: 'Supplier Balance Payments',
        method: 'GET',
        proxyUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payments/{supplierNumber}`,
        actualUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payments/{supplierNumber}`,
        params: '',
        description: 'Fetches all payments made to a supplier',
      },
      {
        name: 'Payment Drilldown (Related Invoices)',
        method: 'GET',
        proxyUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payment-invoices/{checkId}`,
        actualUrl: `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payment-invoices/{checkId}`,
        params: '',
        description: 'Fetches invoices related to a specific payment check',
      },
    ],
  };

  // Copy URL to clipboard
  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    message.success('URL copied to clipboard');
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // Fetch supplier detail from Fusion
  const fetchSupplierDetail = async (supplierId: number): Promise<SupplierDetail | null> => {
    try {
      const directUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/suppliers/${supplierId}`;

      const response = await fetch(directUrl, {
        headers: { 'Authorization': `Basic ${FUSION_AUTH}` },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return mapFusionToSupplierDetail(data);
    } catch (error) {
      console.error('Error fetching supplier detail:', error);
      message.error('Failed to fetch supplier details');
      return null;
    }
  };

  // Fetch balance dashboard data
  const fetchBalanceDashboard = async (supplierNumber: string): Promise<BalanceData | null> => {
    try {
      const enc = encodeURIComponent(supplierNumber);
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/suppliers/balance/dashboard/${enc}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.success !== 'true') throw new Error(d.error || 'Dashboard error');

      const sup = d.supplier || {};
      const bs  = d.balance_summary || {};

      // Use total_outstanding from the aging_report buckets already in the dashboard response.
      // This is the server-computed correct outstanding: sum of (INVOICE_AMOUNT - actual_payments)
      // per unpaid invoice, grouped into aging buckets — more accurate than bs.balance which is
      // total_invoice_amount minus total_payment_amount and can include paid/partially-matched invoices.
      const agingBuckets: any[] = d.aging_report || [];
      const totalOutstanding = agingBuckets.reduce((sum, b) => sum + Number(b.amount || 0), 0);

      return {
        supplier: {
          supplierId:            sup.supplier_id    || 0,
          supplierNumber:        sup.supplier_number || supplierNumber,
          supplierName:          sup.supplier_name   || '',
          supplierType:          sup.supplier_type   || null,
          status:                sup.status          || 'Active',
          taxRegistrationNumber: sup.tax_registration_number || null,
          creationDate:          sup.creation_date   || null,
          address:               null,
        },
        balanceSummary: {
          totalInvoices:      bs.total_invoices       || 0,
          totalInvoiceAmount: bs.total_invoice_amount || 0,
          totalPayments:      bs.total_payments       || 0,
          totalPaymentAmount: bs.total_payment_amount || 0,
          balance:            totalOutstanding,
          currency:           bs.currency             || 'AED',
        },
        agingReport: agingBuckets,
      };
    } catch (error) {
      console.error('Error fetching balance dashboard:', error);
      message.error(`Failed to load balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  };

  // Fetch invoices for balance tab
  const fetchBalanceInvoices = async (supplierNumber: string, tabKey: string) => {
    setInvoicesLoadingMap(prev => ({ ...prev, [tabKey]: true }));
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/${encodeURIComponent(supplierNumber)}?limit=500`;
      setInvoicesUrlMap(prev => ({ ...prev, [tabKey]: url }));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items: any[] = data.invoices || data.items || [];
      setInvoicesMap(prev => ({
        ...prev,
        [tabKey]: items.map((item: any, index: number) => ({
          key:            item.invoice_id?.toString() || index.toString(),
          invoiceId:      item.invoice_id,
          invoiceNumber:  item.invoice_number  || '',
          invoiceDate:    item.invoice_date    || '',
          invoiceType:    item.invoice_type    || 'Standard',
          invoiceAmount:  Number(item.invoice_amount   || 0),
          amountPaid:     Number(item.amount_paid      || 0),
          amountRemaining: Number(item.amount_remaining ?? 0),
          invoiceStatus:  item.invoice_status || item.validation_status || '',
          currency:       item.currency || item.invoice_currency || 'AED',
          description:    item.description || '',
        })),
      }));
    } catch (error) {
      console.error('Error fetching invoices:', error);
      message.error('Failed to load invoices');
    } finally {
      setInvoicesLoadingMap(prev => ({ ...prev, [tabKey]: false }));
    }
  };

  // Fetch payments for balance tab
  const fetchBalancePayments = async (supplierNumber: string, tabKey: string) => {
    setPaymentsLoadingMap(prev => ({ ...prev, [tabKey]: true }));
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/payments?supplier_number=${encodeURIComponent(supplierNumber)}&limit=500`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items: any[] = data.items || [];
      setPaymentsMap(prev => ({
        ...prev,
        [tabKey]: items.map((item: any, index: number) => ({
          key:           item.CheckId?.toString() || item.check_id?.toString() || index.toString(),
          paymentId:     item.CheckId   || item.check_id,
          checkId:       item.CheckId   || item.check_id,
          paymentNumber: item.PaymentNumber || item.payment_number || '',
          paymentDate:   item.PaymentDate   || item.payment_date   || '',
          paymentAmount: Number(item.PaymentAmount  || item.payment_amount  || 0),
          paymentStatus: item.PaymentStatus || item.payment_status || '',
          paymentMethod: item.PaymentMethod || item.payment_method || '',
          currency:      item.PaymentCurrency || item.payment_currency || 'AED',
          bankAccountName: item.BankAccountName || item.bank_account_name || '',
        })),
      }));
    } catch (error) {
      console.error('Error fetching payments:', error);
      message.error('Failed to load payments');
    } finally {
      setPaymentsLoadingMap(prev => ({ ...prev, [tabKey]: false }));
    }
  };

  // Fetch payment drilldown
  const fetchPaymentDrilldown = async (payment: PaymentRecord) => {
    setDrilldownPayment(payment);
    setDrilldownVisible(true);
    setDrilldownLoading(true);

    try {
      // Use the dedicated payment-invoices endpoint from PKG_SUPPLIER_BALANCE
      // which returns amount_paid_invoice_currency + discount_taken + discount_lost
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payment-invoices/${payment.checkId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const items: any[] = data.invoices || data.items || [];
      setRelatedInvoices(items.map((item: any, index: number) => {
        const cash     = Number(item.amount_paid_invoice_currency || item.amount_applied || 0);
        const discount = Number(item.discount_taken || 0);
        return {
          key:           item.invoice_id?.toString() || index.toString(),
          invoiceId:     item.invoice_id,
          invoiceNumber: item.invoice_number || '',
          invoiceAmount: Number(item.invoice_amount || 0),
          amountApplied: cash,
          discountTaken: discount,
          discountLost:  Number(item.discount_lost || 0),
          totalSettled:  cash + discount,
        };
      }));
    } catch (error) {
      console.error('Error fetching drilldown:', error);
      message.error('Failed to load related invoices');
    } finally {
      setDrilldownLoading(false);
    }
  };

  // Detect invoice category from description keywords
  const detectCategory = (description: string): string => {
    const d = (description || '').toLowerCase();
    if (/rent|lease|tenancy|office space/.test(d))        return 'Rent & Lease';
    if (/electric|water|gas|utility|utilities|dewa|sewa/.test(d)) return 'Utilities';
    if (/maintenance|repair|service|cleaning|janitorial/.test(d)) return 'Maintenance';
    if (/legal|audit|consult|accounting|advisory|professional/.test(d)) return 'Professional Services';
    if (/software|hardware|\bit\b|tech|license|subscription|cloud|server|network|hosting|saas/.test(d)) return 'IT & Technology';
    if (/salary|payroll|hr|human resource|benefit|bonus|staff/.test(d)) return 'HR & Payroll';
    if (/transport|freight|shipping|logistics|courier|delivery/.test(d)) return 'Transport & Logistics';
    if (/marketing|advertising|promotion|media|campaign/.test(d)) return 'Marketing';
    if (/insurance|premium|policy|cover/.test(d)) return 'Insurance';
    if (/training|course|seminar|workshop|education/.test(d)) return 'Training';
    return 'Others';
  };

  // Fetch and compute analytics data
  const fetchAnalyticsData = async (supplierNumber: string, tabKey: string) => {
    setAnalyticsLoadingMap(prev => ({ ...prev, [tabKey]: true }));
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/${encodeURIComponent(supplierNumber)}?status=All&limit=1000`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = data.invoices || data.items || [];

      // Category aggregation
      const catMap: Record<string, { amount: number; count: number }> = {};
      const invBycat: Record<string, CategoryInvoice[]> = {};
      // Monthly trend
      const trendMap: Record<string, number> = {};

      items.forEach(item => {
        const amt  = Number(item.invoice_amount || 0);
        const cat  = detectCategory(item.description || '');
        if (!catMap[cat]) { catMap[cat] = { amount: 0, count: 0 }; invBycat[cat] = []; }
        catMap[cat].amount += amt;
        catMap[cat].count  += 1;
        invBycat[cat].push({
          invoiceNumber: item.invoice_number || '',
          description:   item.description   || '',
          amount:        amt,
        });

        const raw = item.invoice_date || '';
        const d   = raw ? new Date(raw) : null;
        if (d && !isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          trendMap[key] = (trendMap[key] || 0) + amt;
        }
      });

      const categories: CategoryData[] = Object.entries(catMap)
        .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
        .sort((a, b) => b.amount - a.amount);

      const trend: TrendData[] = Object.entries(trendMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ month, amount }));

      const totalAmount = categories.reduce((s, c) => s + c.amount, 0);
      const totalCount  = categories.reduce((s, c) => s + c.count,  0);

      setAnalyticsDataMap(prev => ({ ...prev, [tabKey]: { categories, trend, totalAmount, totalCount, invoicesByCategory: invBycat } }));
    } catch (err) {
      message.error('Failed to load analytics data');
    } finally {
      setAnalyticsLoadingMap(prev => ({ ...prev, [tabKey]: false }));
    }
  };

  // Export analytics data to Excel
  const exportAnalyticsExcel = (tabKey: string, supplierNumber: string) => {
    const ad = analyticsDataMap[tabKey];
    if (!ad) { message.warning('No analytics data to export'); return; }
    const catRows = ad.categories.map(c => ({
      'Category': c.name,
      'Invoice Count': c.count,
      'Total Amount (AED)': c.amount,
      '% of Total': ad.totalAmount > 0 ? ((c.amount / ad.totalAmount) * 100).toFixed(2) + '%' : '0%',
    }));
    const trendRows = ad.trend.map(t => ({ 'Month': t.month, 'Total Amount (AED)': t.amount }));
    const wb = XLSX.utils.book_new();
    const wsCat = XLSX.utils.json_to_sheet(catRows);
    wsCat['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsCat, 'Category Breakdown');
    const wsTrend = XLSX.utils.json_to_sheet(trendRows);
    wsTrend['!cols'] = [{ wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsTrend, 'Monthly Trend');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Analytics_${supplierNumber}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    message.success('Analytics exported to Excel');
  };

  // Export analytics data to PDF and show preview
  const exportAnalyticsPdf = (tabKey: string, supplierNumber: string, supplierName: string) => {
    const ad = analyticsDataMap[tabKey];
    if (!ad) { message.warning('No analytics data to export'); return; }
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Supplier Analytics Report`, 14, 20);
    doc.setFontSize(11);
    doc.text(`Supplier: ${supplierName} (${supplierNumber})`, 14, 30);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 37);
    doc.setFontSize(13);
    doc.text('Invoice Category Breakdown', 14, 48);
    autoTable(doc, {
      startY: 52,
      head: [['Category', 'Count', 'Amount (AED)', '% of Total']],
      body: ad.categories.map(c => [
        c.name,
        c.count.toString(),
        c.amount.toLocaleString('en-AE', { minimumFractionDigits: 2 }),
        ad.totalAmount > 0 ? ((c.amount / ad.totalAmount) * 100).toFixed(1) + '%' : '0%',
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [199, 70, 52] },
    });
    const afterCat = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(13);
    doc.text('Monthly Expense Trend', 14, afterCat);
    autoTable(doc, {
      startY: afterCat + 4,
      head: [['Month', 'Amount (AED)']],
      body: ad.trend.map(t => [
        t.month,
        t.amount.toLocaleString('en-AE', { minimumFractionDigits: 2 }),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 114, 206] },
    });
    const pdfBlob = doc.output('bloburl');
    setPdfPreviewUrl(pdfBlob as unknown as string);
    setPdfPreviewVisible(true);
  };

  // Fetch a supplier's addresses + sites for the Edit screen
  const fetchSupplierDetailData = async (supplierId: number, tabKey: string) => {
    setDetailLoadingMap(prev => ({ ...prev, [tabKey]: true }));
    try {
      const [addrRes, siteRes] = await Promise.all([
        fetch(`${APEX_DB_CONFIG.baseUrl}/suppliers/addresses/${supplierId}`),
        fetch(`${APEX_DB_CONFIG.baseUrl}/suppliers/sitelist/${supplierId}`),
      ]);
      const addrData = addrRes.ok ? await addrRes.json() : {};
      const siteData = siteRes.ok ? await siteRes.json() : {};
      const addrItems: any[] = Array.isArray(addrData) ? addrData : (addrData.items || []);
      const siteItems: any[] = Array.isArray(siteData) ? siteData : (siteData.items || []);
      setAddressesMap(prev => ({ ...prev, [tabKey]: addrItems }));
      setSitesDetailMap(prev => ({ ...prev, [tabKey]: siteItems }));
    } catch (e) {
      console.error('Error fetching supplier detail data:', e);
      message.error('Failed to load addresses / sites');
    } finally {
      setDetailLoadingMap(prev => ({ ...prev, [tabKey]: false }));
    }
  };

  // Open supplier detail in new tab
  const openSupplierTab = async (record: SupplierRecord) => {
    const tabKey = `supplier-${record.supplierId}`;

    // Check if tab already exists
    const existingTab = openTabs.find((tab) => tab.key === tabKey);
    if (existingTab) {
      setActiveTab(tabKey);
      return;
    }

    // Add new tab with loading state
    const newTab: SupplierTab = {
      key: tabKey,
      label: record.supplier,
      supplier: record,
      loading: false,
      tabType: 'detail',
    };
    setOpenTabs([...openTabs, newTab]);
    setActiveTab(tabKey);
    // Load addresses + sites for the Addresses / Sites sub-tabs
    fetchSupplierDetailData(record.supplierId, tabKey);
  };

  // Open supplier balance in new tab
  const openBalanceTab = async (record: SupplierRecord) => {
    const tabKey = `balance-${record.supplierNumber}`;

    // Check if tab already exists
    const existingTab = openTabs.find((tab) => tab.key === tabKey);
    if (existingTab) {
      setActiveTab(tabKey);
      return;
    }

    // Add new tab with loading state
    const newTab: SupplierTab = {
      key: tabKey,
      label: record.supplier,
      supplier: record,
      loading: true,
      tabType: 'balance',
    };
    setOpenTabs([...openTabs, newTab]);
    setActiveTab(tabKey);
    setBalanceLoadingMap(prev => ({ ...prev, [tabKey]: true }));

    // Fetch balance dashboard
    const balanceData = await fetchBalanceDashboard(record.supplierNumber);
    setBalanceDataMap(prev => ({ ...prev, [tabKey]: balanceData }));
    setBalanceLoadingMap(prev => ({ ...prev, [tabKey]: false }));
    setOpenTabs((prevTabs) =>
      prevTabs.map((tab) =>
        tab.key === tabKey ? { ...tab, loading: false } : tab
      )
    );
  };

  // Close supplier tab
  const closeSupplierTab = (tabKey: string) => {
    const newTabs = openTabs.filter((tab) => tab.key !== tabKey);
    setOpenTabs(newTabs);

    if (activeTab === tabKey) {
      setActiveTab('search');
    }
  };

  // Handle tab change
  const onTabChange = (key: string) => {
    setActiveTab(key);
  };

  // Handle tab edit (close)
  const onTabEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove' && typeof targetKey === 'string') {
      closeSupplierTab(targetKey);
    }
  };

  // Search suppliers from API
  const handleSearch = async () => {
    setLoading(true);
    try {
      // Get form values
      const formValues = form.getFieldsValue();
      const supplierNumber = formValues.supplierNumber?.trim();
      const supplierName = formValues.supplier?.trim();
      const businessUnit = formValues.businessUnit?.trim();

      // APEX API - fetch all pages
      const apexParams = new URLSearchParams();
      if (supplierNumber) apexParams.set('supplier_number', supplierNumber);
      if (businessUnit)   apexParams.set('P_BUSINESS_UNIT', businessUnit);

      const items = await fetchAllApexSuppliers(apexParams);

      if (items.length > 0) {
        const mappedSuppliers = items.map(mapApexToSupplierRecord);
        setSuppliers(mappedSuppliers);
        message.success(`Found ${mappedSuppliers.length} supplier(s)`);
      } else {
        setSuppliers([]);
        message.info('No suppliers found');
      }
    } catch (error) {
      console.error('Search error:', error);
      message.error(`Failed to search suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Reset search form
  const handleReset = () => {
    form.resetFields();
    setSuppliers([]);
  };

  const exportSuppliersToExcel = () => {
    const rows = filteredSuppliers.map(r => ({
      'Supplier Number':          r.supplierNumber,
      'Supplier Name':            r.supplier,
      'Alternate Name':           r.alternateName,
      'Business Relationship':    r.businessRelationship,
      'Parent Supplier':          r.parentSupplier,
      'Supplier Type':            r.supplierType,
      'Tax Organization Type':    r.taxOrganizationType,
      'Taxpayer ID':              r.taxpayerId,
      'Tax Registration Number':  r.taxRegistrationNumber,
      'D-U-N-S Number':           r.dunsNumber,
      'Status':                   r.status,
      'Creation Date':            r.creationDate,
      'Inactive Since':           r.inactiveSince,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Suppliers');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Suppliers_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Table columns
  const columns: ColumnsType<SupplierRecord> = [
    {
      title: 'Supplier',
      dataIndex: 'supplier',
      key: 'supplier',
      width: 250,
      render: (text: string, record: SupplierRecord) => (
        <a
          onClick={() => openSupplierTab(record)}
          style={{ color: REDWOOD.info, fontWeight: 500 }}
        >
          {text}
        </a>
      ),
    },
    {
      title: 'Supplier Number',
      dataIndex: 'supplierNumber',
      key: 'supplierNumber',
      width: 120,
    },
    {
      title: 'Alt Name',
      dataIndex: 'alternateName',
      key: 'alternateName',
      width: 150,
    },
    {
      title: 'Business Relationship',
      dataIndex: 'businessRelationship',
      key: 'businessRelationship',
      width: 150,
    },
    {
      title: 'Parent Supplier',
      dataIndex: 'parentSupplier',
      key: 'parentSupplier',
      width: 150,
    },
    {
      title: 'Creation Date',
      dataIndex: 'creationDate',
      key: 'creationDate',
      width: 120,
    },
    {
      title: 'Inactive Since',
      dataIndex: 'inactiveSince',
      key: 'inactiveSince',
      width: 120,
    },
    {
      title: 'Tax Registration Number',
      dataIndex: 'taxRegistrationNumber',
      key: 'taxRegistrationNumber',
      width: 160,
    },
    {
      title: 'Taxpayer ID',
      dataIndex: 'taxpayerId',
      key: 'taxpayerId',
      width: 120,
    },
    {
      title: 'D-U-N-S Number',
      dataIndex: 'dunsNumber',
      key: 'dunsNumber',
      width: 120,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 130,
      fixed: 'right' as const,
      render: (_: any, record: SupplierRecord) => (
        <Button
          type="primary"
          size="small"
          icon={<DollarOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            openBalanceTab(record);
          }}
          style={{ background: REDWOOD.success }}
        >
          Balance
        </Button>
      ),
    },
  ];

  // Row selection config
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // Render search tab content
  const renderSearchTab = () => (
    <div style={{ padding: '0 24px 24px' }}>
      {/* Search Form */}
      <Card
        style={{
          marginBottom: 16,
          borderRadius: 8,
          border: `1px solid ${REDWOOD.neutral200}`,
        }}
        bodyStyle={{ padding: 16 }}
      >
        <Collapse
          activeKey={searchCollapsed ? [] : ['1']}
          onChange={() => setSearchCollapsed(!searchCollapsed)}
          bordered={false}
          style={{ background: 'transparent' }}
        >
          <Panel
            header={
              <Space>
                <SearchOutlined />
                <Text strong>Advanced Search</Text>
              </Space>
            }
            key="1"
          >
            <Form form={form} layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 8 }}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Select
                        placeholder="Select business unit..."
                        allowClear
                        size="small"
                        showSearch
                        style={{ flex: 1 }}
                        filterOption={(input, option) =>
                          String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                      >
                        {businessUnits.map(bu => (
                          <Option key={bu} value={bu}>{bu}</Option>
                        ))}
                      </Select>
                      {selectedBU && (
                        <Tooltip title={`Copy: ${selectedBU}`}>
                          <Button
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => {
                              navigator.clipboard.writeText(selectedBU);
                              message.success('Business unit name copied');
                            }}
                          />
                        </Tooltip>
                      )}
                    </Space.Compact>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="Supplier Number" name="supplierNumber" style={{ marginBottom: 8 }}>
                    <Input
                      size="small"
                      placeholder="e.g. A022"
                      suffix={
                        <SearchOutlined
                          style={{ color: REDWOOD.info, cursor: 'pointer' }}
                          onClick={() => openLov()}
                        />
                      }
                      onPressEnter={() => openLov()}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="Supplier" name="supplier" style={{ marginBottom: 8 }}>
                    <Input
                      size="small"
                      placeholder="Type name or click 🔍"
                      suffix={
                        <SearchOutlined
                          style={{ color: REDWOOD.info, cursor: 'pointer' }}
                          onClick={handleSearch}
                        />
                      }
                      onPressEnter={handleSearch}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="Supplier Type" name="supplierType" style={{ marginBottom: 8 }}>
                    <Select placeholder="" allowClear size="small">
                      <Option value="">All</Option>
                      <Option value="Vendor">Vendor</Option>
                      <Option value="Contractor">Contractor</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="Taxpayer ID" name="taxpayerId" style={{ marginBottom: 8 }}>
                    <Input placeholder="" size="small" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="Tax Organization Type" name="taxOrganizationType" style={{ marginBottom: 8 }}>
                    <Select placeholder="" allowClear size="small">
                      <Option value="">All</Option>
                      <Option value="Corporation">Corporation</Option>
                      <Option value="Individual">Individual</Option>
                      <Option value="Partnership">Partnership</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="Tax Registration Number" name="taxRegistrationNumber" style={{ marginBottom: 8 }}>
                    <Input placeholder="" size="small" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="Business Classification" name="businessClassification" style={{ marginBottom: 8 }}>
                    <Select placeholder="" allowClear size="small">
                      <Option value="">All</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8} />
              </Row>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="Creation Date" name="creationDate" style={{ marginBottom: 8 }}>
                    <RangePicker size="small" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="Products and Services" name="productsServices" style={{ marginBottom: 8 }}>
                    <Input placeholder="" size="small" suffix={<SearchOutlined />} />
                  </Form.Item>
                </Col>
                <Col span={8} />
              </Row>
            </Form>
          </Panel>
        </Collapse>

        {/* Action buttons */}
        <Row justify="end" style={{ marginTop: 16 }}>
          <Space>
            <Button icon={<SearchOutlined />} type="primary" onClick={handleSearch} loading={loading}>
              Search
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleReset}>
              Reset
            </Button>
            <Button icon={<SaveOutlined />}>Save...</Button>
            <Button icon={<PlusOutlined />}>Add Fields</Button>
            <Button icon={<SwapOutlined />}>Reorder</Button>
          </Space>
        </Row>
      </Card>

      {/* Data Source Toggle */}
      <Card
        style={{
          marginBottom: 16,
          borderRadius: 8,
          border: `1px solid ${REDWOOD.neutral200}`,
        }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <DatabaseOutlined style={{ color: REDWOOD.success }} />
              <Text style={{ color: REDWOOD.success }}>APEX Database</Text>
            </Space>
          </Col>
          <Col>
            <Text type="secondary">Fetching synced data from APEX database</Text>
          </Col>
        </Row>
      </Card>

      {/* Search Results */}
      <Card
        title={
          <Space>
            <Text strong>Search Results</Text>
            <Text type="secondary">
              {gridFilter.trim() ? `${filteredSuppliers.length} / ${suppliers.length}` : suppliers.length} records
            </Text>
          </Space>
        }
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        extra={
          <Space>
            <Input
              placeholder="Filter results..."
              prefix={<SearchOutlined />}
              value={gridFilter}
              onChange={e => setGridFilter(e.target.value)}
              allowClear
              size="small"
              style={{ width: 220 }}
            />
            <Button
              size="small"
              icon={<FileExcelOutlined />}
              onClick={exportSuppliersToExcel}
              disabled={filteredSuppliers.length === 0}
            >
              Export
            </Button>
            <Button size="small" icon={<PlusOutlined />} type="primary"
              onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ status: 'Active', address: { country: 'United Arab Emirates' }, sites: [{ invoiceCurrency: 'AED', payFlag: true, purchasingFlag: true }] }); setCreateOpen(true); }}>
              Register Supplier
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={filteredSuppliers}
          rowKey="key"
          rowSelection={rowSelection}
          loading={loading}
          scroll={{ x: 1550 }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: ['25', '50', '100', '200'],
            showTotal: (total) => `${total} suppliers`,
          }}
          size="small"
          onRow={(record) => ({
            onDoubleClick: () => openSupplierTab(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* ── Register Supplier dialog ── */}
      <Modal
        open={createOpen}
        title={<Space><PlusOutlined style={{ color: REDWOOD.primary }} /><span>Register New Supplier</span>
          <Tooltip title="Show the API URL & JSON payload"><Button size="small" icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }} onClick={showCreateSupplierApi} /></Tooltip>
        </Space>}
        onCancel={() => { if (!createSaving) setCreateOpen(false); }}
        maskClosable={!createSaving}
        width={880}
        okText="Create Supplier"
        confirmLoading={createSaving}
        onOk={handleCreateSupplier}
        okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" size="small">
          <Divider orientation="left" style={{ margin: '4px 0 12px', fontSize: 13 }}>Supplier</Divider>
          <Row gutter={12}>
            <Col span={10}><Form.Item name="supplier" label="Supplier Name" rules={[{ required: true, message: 'Required' }]}><Input placeholder="e.g. ACME TRADING LLC" /></Form.Item></Col>
            <Col span={7}><Form.Item name="supplierNumber" label="Supplier Number" tooltip="Leave blank to auto-generate"><Input placeholder="auto" /></Form.Item></Col>
            <Col span={7}><Form.Item name="alternateName" label="Alternate Name"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="supplierType" label="Supplier Type"><Select allowClear options={[{ value: 'Supplier' }, { value: 'Individual' }, { value: 'Contractor' }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="taxOrganizationType" label="Tax Org Type"><Select allowClear options={[{ value: 'Corporation' }, { value: 'Individual' }, { value: 'Partnership' }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="businessRelationship" label="Business Relationship"><Select allowClear options={[{ value: 'Spend Authorized' }, { value: 'Prospective' }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="status" label="Status"><Select options={[{ value: 'Active' }, { value: 'Inactive' }]} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="taxRegistrationNumber" label="Tax Registration No."><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="taxpayerId" label="Taxpayer ID"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="dunsNumber" label="D-U-N-S Number"><Input /></Form.Item></Col>
          </Row>

          <Divider orientation="left" style={{ margin: '4px 0 12px', fontSize: 13 }}>Primary Address</Divider>
          <Row gutter={12}>
            <Col span={8}><Form.Item name={['address', 'addressName']} label="Address Name"><Input placeholder="e.g. MAIN" /></Form.Item></Col>
            <Col span={8}><Form.Item name={['address', 'country']} label="Country"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name={['address', 'city']} label="City"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name={['address', 'addressLine1']} label="Address Line 1"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name={['address', 'addressLine2']} label="Address Line 2"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={6}><Form.Item name={['address', 'state']} label="State/Province"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name={['address', 'postalCode']} label="Postal Code"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name={['address', 'phoneNumber']} label="Phone"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name={['address', 'email']} label="Email"><Input /></Form.Item></Col>
          </Row>
          <Space size="large">
            <Form.Item name={['address', 'purposeOrdering']} valuePropName="checked" noStyle><Checkbox>Ordering address</Checkbox></Form.Item>
            <Form.Item name={['address', 'purposeRemitTo']} valuePropName="checked" noStyle><Checkbox>Remit-to address</Checkbox></Form.Item>
          </Space>

          <Divider orientation="left" style={{ margin: '14px 0 12px', fontSize: 13 }}>Sites</Divider>
          <Form.List name="sites">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Row gutter={8} key={key} align="middle" style={{ marginBottom: 4 }}>
                    <Col span={4}><Form.Item {...rest} name={[name, 'siteCode']} rules={[{ required: true, message: 'Code' }]} style={{ marginBottom: 8 }}><Input placeholder="Site Code *" /></Form.Item></Col>
                    <Col span={4}><Form.Item {...rest} name={[name, 'siteName']} style={{ marginBottom: 8 }}><Input placeholder="Site Name" /></Form.Item></Col>
                    <Col span={4}><Form.Item {...rest} name={[name, 'procurementBu']} style={{ marginBottom: 8 }}>
                      <Select showSearch allowClear placeholder="Procurement BU" optionFilterProp="children"
                        options={businessUnits.map(bu => ({ value: bu, label: bu }))} />
                    </Form.Item></Col>
                    <Col span={4}><Form.Item {...rest} name={[name, 'paymentTerms']} style={{ marginBottom: 8 }}><Input placeholder="Payment Terms" /></Form.Item></Col>
                    <Col span={3}><Form.Item {...rest} name={[name, 'invoiceCurrency']} style={{ marginBottom: 8 }}><Input placeholder="Ccy" /></Form.Item></Col>
                    <Col span={2}><Form.Item {...rest} name={[name, 'payFlag']} valuePropName="checked" style={{ marginBottom: 8 }}><Checkbox>Pay</Checkbox></Form.Item></Col>
                    <Col span={2}><Form.Item {...rest} name={[name, 'purchasingFlag']} valuePropName="checked" style={{ marginBottom: 8 }}><Checkbox>Purch</Checkbox></Form.Item></Col>
                    <Col span={1}><MinusCircleOutlined style={{ color: REDWOOD.error, cursor: 'pointer' }} onClick={() => remove(name)} /></Col>
                  </Row>
                ))}
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ invoiceCurrency: 'AED', payFlag: true, purchasingFlag: true })} style={{ marginTop: 4 }}>
                  Add Site
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );

  // Render supplier detail tab content
  // Render Addresses sub-tab (Edit Supplier)
  const renderAddressesTab = (tabKey: string) => {
    const rows = (addressesMap[tabKey] || []).map((r, i) => ({ ...r, key: r.supplierAddressId ?? i }));
    const yn = (v: any) => (String(v).toUpperCase() === 'Y' ? <CheckOutlined style={{ color: REDWOOD.success }} /> : null);
    const cols: ColumnsType<any> = [
      { title: 'Address Name', dataIndex: 'addressName', key: 'addressName', width: 140 },
      { title: 'Address', key: 'addr', render: (_: any, r: any) =>
          [r.addressLine1, r.addressLine2, r.city, r.state, r.postalCode, r.country].filter(Boolean).join(', ') },
      { title: 'Phone', dataIndex: 'phoneNumber', key: 'phoneNumber', width: 120 },
      { title: 'Email', dataIndex: 'email', key: 'email', width: 160 },
      { title: 'Ordering', dataIndex: 'purposeOrdering', key: 'purposeOrdering', width: 80, align: 'center' as const, render: yn },
      { title: 'Remit To', dataIndex: 'purposeRemitTo', key: 'purposeRemitTo', width: 80, align: 'center' as const, render: yn },
      { title: 'Status', dataIndex: 'status', key: 'status', width: 90,
        render: (v: string) => <Tag color={String(v).toUpperCase() === 'ACTIVE' ? 'green' : 'default'}>{v || '-'}</Tag> },
    ];
    return (
      <div style={{ padding: 12 }}>
        <Table columns={cols} dataSource={rows} loading={detailLoadingMap[tabKey]} size="small"
          rowKey="key" pagination={false} scroll={{ x: 800 }}
          locale={{ emptyText: detailLoadingMap[tabKey] ? 'Loading…' : 'No addresses' }} />
      </div>
    );
  };

  // Render Sites sub-tab (Edit Supplier)
  const renderSitesTab = (tabKey: string) => {
    const rows = (sitesDetailMap[tabKey] || []).map((r, i) => ({ ...r, key: r.supplierSiteId ?? i }));
    const yn = (v: any) => (String(v).toUpperCase() === 'Y' ? <CheckOutlined style={{ color: REDWOOD.success }} /> : null);
    const cols: ColumnsType<any> = [
      { title: 'Site Code', dataIndex: 'siteCode', key: 'siteCode', width: 120 },
      { title: 'Site Name', dataIndex: 'supplierSite', key: 'supplierSite', width: 160 },
      { title: 'Procurement BU', dataIndex: 'procurementBu', key: 'procurementBu', width: 160 },
      { title: 'Assigned BU', dataIndex: 'assignedBu', key: 'assignedBu', width: 160,
        render: (v: string) => v || <Text type="secondary">-</Text> },
      { title: 'Address', dataIndex: 'addressName', key: 'addressName', width: 130 },
      { title: 'Purchasing', dataIndex: 'purchasingFlag', key: 'purchasingFlag', width: 90, align: 'center' as const, render: yn },
      { title: 'Pay', dataIndex: 'payFlag', key: 'payFlag', width: 60, align: 'center' as const, render: yn },
      { title: 'Payment Terms', dataIndex: 'paymentTerms', key: 'paymentTerms', width: 130 },
      { title: 'Currency', dataIndex: 'invoiceCurrency', key: 'invoiceCurrency', width: 90 },
      { title: 'Status', dataIndex: 'status', key: 'status', width: 90,
        render: (v: string) => <Tag color={String(v).toUpperCase() === 'ACTIVE' ? 'green' : 'default'}>{v || '-'}</Tag> },
    ];
    return (
      <div style={{ padding: 12 }}>
        <Table columns={cols} dataSource={rows} loading={detailLoadingMap[tabKey]} size="small"
          rowKey="key" pagination={false} scroll={{ x: 1100 }}
          locale={{ emptyText: detailLoadingMap[tabKey] ? 'Loading…' : 'No sites' }} />
      </div>
    );
  };

  const renderSupplierDetailTab = (tab: SupplierTab) => {
    if (tab.loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
          <Spin size="large" tip="Loading supplier details..." />
        </div>
      );
    }

    const detail = tab.detail || tab.supplier;

    return (
      <div style={{ padding: '0 24px 24px' }}>
        {/* Header */}
        <Card
          style={{
            marginBottom: 16,
            borderRadius: 8,
            border: `1px solid ${REDWOOD.neutral200}`,
          }}
          bodyStyle={{ padding: '16px 24px' }}
        >
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <Title level={4} style={{ margin: 0 }}>
                  Edit Supplier: {detail.supplier}
                </Title>
                <StarOutlined style={{ color: REDWOOD.warning }} />
              </Space>
            </Col>
            <Col>
              <Space>
                <Button type="primary" style={{ background: REDWOOD.primary }}>Save</Button>
                <Button type="primary" style={{ background: REDWOOD.info }}>Save and Close</Button>
                <Button onClick={() => closeSupplierTab(tab.key)}>Cancel</Button>
                <Text type="secondary" style={{ marginLeft: 16 }}>
                  Last Saved: {new Date().toLocaleString()}
                </Text>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Supplier Detail Tabs */}
        <Card
          style={{
            borderRadius: 8,
            border: `1px solid ${REDWOOD.neutral200}`,
          }}
        >
          <Tabs
            defaultActiveKey="profile"
            items={[
              {
                key: 'profile',
                label: (
                  <Space>
                    <UserOutlined />
                    Profile
                  </Space>
                ),
                children: renderProfileTab(detail as SupplierDetail),
              },
              {
                key: 'addresses',
                label: (
                  <Space>
                    <EnvironmentOutlined />
                    Addresses ({(addressesMap[tab.key] || []).length})
                  </Space>
                ),
                children: renderAddressesTab(tab.key),
              },
              {
                key: 'sites',
                label: (
                  <Space>
                    <BankOutlined />
                    Sites ({(sitesDetailMap[tab.key] || []).length})
                  </Space>
                ),
                children: renderSitesTab(tab.key),
              },
              {
                key: 'contacts',
                label: (
                  <Space>
                    <ContactsOutlined />
                    Contacts
                  </Space>
                ),
                children: <div style={{ padding: 24 }}><Text type="secondary">Contacts tab content</Text></div>,
              },
              {
                key: 'qualifications',
                label: (
                  <Space>
                    <SafetyCertificateOutlined />
                    Qualifications
                  </Space>
                ),
                children: <div style={{ padding: 24 }}><Text type="secondary">Qualifications tab content</Text></div>,
              },
            ]}
          />
        </Card>
      </div>
    );
  };

  // Render Profile tab content
  const renderProfileTab = (detail: SupplierDetail) => (
    <div>
      {/* General Section */}
      <Collapse defaultActiveKey={['general']} bordered={false}>
        <Panel header={<Text strong>General</Text>} key="general">
          <Row gutter={24}>
            <Col span={12}>
              <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
                <Form.Item label="Supplier" required style={{ marginBottom: 6 }}>
                  <Input value={detail.supplier} size="small" />
                </Form.Item>
                <Form.Item label="Supplier Number" style={{ marginBottom: 6 }}>
                  <Text>{detail.supplierNumber}</Text>
                </Form.Item>
                <Form.Item label="Alternate Name" style={{ marginBottom: 6 }}>
                  <Input value={detail.alternateName} size="small" />
                </Form.Item>
                <Form.Item label="Tax Organization Type" style={{ marginBottom: 6 }}>
                  <Select value={detail.taxOrganizationType || 'Corporation'} style={{ width: '100%' }} size="small">
                    <Option value="Corporation">Corporation</Option>
                    <Option value="Individual">Individual</Option>
                    <Option value="Partnership">Partnership</Option>
                  </Select>
                </Form.Item>
                <Form.Item label="Supplier Type" style={{ marginBottom: 6 }}>
                  <Select value={detail.supplierType} style={{ width: '100%' }} allowClear size="small">
                    <Option value="Vendor">Vendor</Option>
                    <Option value="Contractor">Contractor</Option>
                  </Select>
                </Form.Item>
                <Form.Item label="Inactive Date" style={{ marginBottom: 6 }}>
                  <DatePicker style={{ width: '100%' }} placeholder="dd-mmm-yyyy" size="small" />
                </Form.Item>
                <Form.Item label="Status" style={{ marginBottom: 6 }}>
                  <Text>{detail.status}</Text>
                </Form.Item>
              </Form>
            </Col>
            <Col span={12}>
              <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
                <Form.Item label="Business Relationship" style={{ marginBottom: 6 }}>
                  <Text>{detail.businessRelationship}</Text>
                </Form.Item>
                <Form.Item label="Parent Supplier" style={{ marginBottom: 6 }}>
                  <Input suffix={<SearchOutlined />} size="small" />
                </Form.Item>
                <Form.Item label="Parent Supplier Number" style={{ marginBottom: 6 }}>
                  <Text>{detail.parentSupplierNumber}</Text>
                </Form.Item>
                <Form.Item label="Creation Date" style={{ marginBottom: 6 }}>
                  <Text>{detail.creationDate}</Text>
                </Form.Item>
                <Form.Item label="Creation Source" style={{ marginBottom: 6 }}>
                  <Text>{detail.creationSource || 'Import'}</Text>
                </Form.Item>
                <Form.Item label="Registration Request" style={{ marginBottom: 6 }}>
                  <Text>{detail.registrationRequest}</Text>
                </Form.Item>
                <Form.Item label="Attachments" style={{ marginBottom: 6 }}>
                  <Button type="link" style={{ padding: 0 }} size="small">None +</Button>
                </Form.Item>
              </Form>
            </Col>
          </Row>
        </Panel>
      </Collapse>

      <Divider style={{ margin: '16px 0' }} />

      {/* Profile Details Section */}
      <Title level={5}>Profile Details</Title>
      <Tabs
        defaultActiveKey="organization"
        size="small"
        items={[
          {
            key: 'organization',
            label: 'Organization',
            children: renderOrganizationTab(detail),
          },
          {
            key: 'businessClassifications',
            label: 'Business Classifications',
            children: <div style={{ padding: 16 }}><Text type="secondary">Business Classifications content</Text></div>,
          },
          {
            key: 'productsServices',
            label: 'Products and Services',
            children: <div style={{ padding: 16 }}><Text type="secondary">Products and Services content</Text></div>,
          },
          {
            key: 'transactionTax',
            label: 'Transaction Tax',
            children: <div style={{ padding: 16 }}><Text type="secondary">Transaction Tax content</Text></div>,
          },
          {
            key: 'incomeTax',
            label: 'Income Tax',
            children: <div style={{ padding: 16 }}><Text type="secondary">Income Tax content</Text></div>,
          },
          {
            key: 'payments',
            label: 'Payments',
            children: <div style={{ padding: 16 }}><Text type="secondary">Payments content</Text></div>,
          },
        ]}
      />
    </div>
  );

  // Render Organization sub-tab
  const renderOrganizationTab = (detail: SupplierDetail) => (
    <div>
      {/* Identification */}
      <Collapse defaultActiveKey={['identification', 'corporate', 'financial']} bordered={false}>
        <Panel header={<Text strong>Identification</Text>} key="identification">
          <Row gutter={24}>
            <Col span={12}>
              <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
                <Form.Item label="Alias" style={{ marginBottom: 6 }}>
                  <Input value={detail.alias} size="small" />
                </Form.Item>
                <Form.Item label="D-U-N-S Number" style={{ marginBottom: 6 }}>
                  <Input value={detail.dunsNumber} size="small" />
                </Form.Item>
                <Form.Item label=" " colon={false} style={{ marginBottom: 6 }}>
                  <Checkbox checked={detail.oneTimeSupplier}>One-time supplier</Checkbox>
                </Form.Item>
                <Form.Item label="Registry ID" style={{ marginBottom: 6 }}>
                  <Text>{detail.registryId}</Text>
                </Form.Item>
                <Form.Item label="Relationships" style={{ marginBottom: 6 }}>
                  <Text>{detail.relationships}</Text>
                </Form.Item>
              </Form>
            </Col>
            <Col span={12}>
              <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
                <Form.Item label="Customer Number" style={{ marginBottom: 6 }}>
                  <Input value={detail.customerNumber} size="small" />
                </Form.Item>
                <Form.Item label="SIC" style={{ marginBottom: 6 }}>
                  <Input value={detail.sic} size="small" />
                </Form.Item>
                <Form.Item label="National Insurance Number" style={{ marginBottom: 6 }}>
                  <Input value={detail.nationalInsuranceNumber} size="small" />
                </Form.Item>
                <Form.Item label="Corporate Web Site" style={{ marginBottom: 6 }}>
                  <Input value={detail.corporateWebSite} size="small" />
                </Form.Item>
              </Form>
            </Col>
          </Row>
        </Panel>

        <Panel header={<Text strong>Regional Information</Text>} key="regional">
          <Form layout="horizontal" labelCol={{ span: 5 }} wrapperCol={{ span: 19 }} size="small">
            <Form.Item label="Regional Information" style={{ marginBottom: 6 }}>
              <Select style={{ width: 300 }} allowClear size="small">
                <Option value="">Select...</Option>
              </Select>
            </Form.Item>
          </Form>
        </Panel>

        <Panel header={<Text strong>Corporate Profile</Text>} key="corporate">
          <Row gutter={24}>
            <Col span={12}>
              <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
                <Form.Item label="Year Established" style={{ marginBottom: 6 }}>
                  <Input value={detail.yearEstablished} size="small" />
                </Form.Item>
                <Form.Item label="Mission Statement" style={{ marginBottom: 6 }}>
                  <Input.TextArea value={detail.missionStatement} rows={2} size="small" />
                </Form.Item>
                <Form.Item label="Year Incorporated" style={{ marginBottom: 6 }}>
                  <Input value={detail.yearIncorporated} size="small" />
                </Form.Item>
              </Form>
            </Col>
            <Col span={12}>
              <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} size="small">
                <Form.Item label="Chief Executive Title" style={{ marginBottom: 6 }}>
                  <Input value={detail.chiefExecutiveTitle} size="small" />
                </Form.Item>
                <Form.Item label="Chief Executive Name" style={{ marginBottom: 6 }}>
                  <Input value={detail.chiefExecutiveName} size="small" />
                </Form.Item>
                <Form.Item label="Principal Title" style={{ marginBottom: 6 }}>
                  <Input value={detail.principalTitle} size="small" />
                </Form.Item>
                <Form.Item label="Principal Name" style={{ marginBottom: 6 }}>
                  <Input value={detail.principalName} size="small" />
                </Form.Item>
              </Form>
            </Col>
          </Row>
        </Panel>

        <Panel header={<Text strong>Financial Profile</Text>} key="financial">
          <Form layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} style={{ maxWidth: 600 }} size="small">
            <Form.Item label="Fiscal Year End Month" style={{ marginBottom: 6 }}>
              <Select style={{ width: 200 }} value={detail.fiscalYearEndMonth} allowClear size="small">
                <Option value="January">January</Option>
                <Option value="February">February</Option>
                <Option value="March">March</Option>
                <Option value="December">December</Option>
              </Select>
            </Form.Item>
            <Form.Item label="Current Fiscal Year's Potential Revenue" style={{ marginBottom: 6 }}>
              <Input value={detail.currentFiscalYearRevenue} size="small" />
            </Form.Item>
            <Form.Item label="Preferred Functional Currency" style={{ marginBottom: 6 }}>
              <Select style={{ width: 200 }} value={detail.preferredFunctionalCurrency} allowClear size="small">
                <Option value="AED">AED</Option>
                <Option value="USD">USD</Option>
                <Option value="EUR">EUR</Option>
              </Select>
            </Form.Item>
          </Form>
        </Panel>
      </Collapse>
    </div>
  );

  // Format currency helper
  const formatCurrency = (amount: number, currency: string = 'AED'): string => {
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Get aging color helper
  const getAgingColor = (bucket: string): string => {
    switch (bucket) {
      case 'Current': return REDWOOD.success;
      case '1-30 Days': return REDWOOD.info;
      case '31-60 Days': return REDWOOD.warning;
      case '61-90 Days': return '#FF8C00';
      case '91-120 Days': return REDWOOD.primary;
      case '120+ Days': return REDWOOD.error;
      default: return REDWOOD.neutral600;
    }
  };

  // Export invoices for a tab to Excel
  const exportInvoicesToExcel = async (tabKey: string, supplierNumber: string, rows: InvoiceRecord[]) => {
    if (!rows.length) { message.warning('No data to export'); return; }
    const exportRows = rows.map(r => ({
      'Invoice Number':   r.invoiceNumber,
      'Invoice Date':     r.invoiceDate,
      'Invoice Amount':   r.invoiceAmount,
      'Amount Paid':      r.amountPaid,
      'Balance Due':      r.amountRemaining,
      'Currency':         r.currency,
      'Status':           r.invoiceStatus,
      'Description':      r.description,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Invoices`);
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const filename = `Invoices_${supplierNumber}.xlsx`;
    const eAPI = (window as any).electronAPI;
    if (eAPI?.openExcel) {
      await eAPI.openExcel(buf, filename);
      message.success('Excel opened');
    } else {
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
      message.success('Exported to Excel');
    }
  };


  // Render supplier balance tab content
  const renderSupplierBalanceTab = (tab: SupplierTab) => {
    const tabKey = tab.key;
    const balanceData = balanceDataMap[tabKey];
    const invoices = invoicesMap[tabKey] || [];
    const payments = paymentsMap[tabKey] || [];
    const isLoading = balanceLoadingMap[tabKey];
    const invoicesLoading = invoicesLoadingMap[tabKey];
    const paymentsLoading = paymentsLoadingMap[tabKey];

    if (tab.loading || isLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
          <Spin size="large" tip="Loading supplier balance..." />
        </div>
      );
    }

    if (!balanceData) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
          <Text type="secondary">Failed to load balance data</Text>
        </div>
      );
    }

    const { supplier, balanceSummary, agingReport } = balanceData;

    // Payment columns
    const paymentColumns = [
      {
        title: 'Payment Number', dataIndex: 'paymentNumber', key: 'paymentNumber', width: 150,
        render: (text: string, record: PaymentRecord) => (
          <a onClick={() => fetchPaymentDrilldown(record)} style={{ color: REDWOOD.info }}>{text}</a>
        )
      },
      { title: 'Payment Date', dataIndex: 'paymentDate', key: 'paymentDate', width: 110 },
      {
        title: 'Amount', dataIndex: 'paymentAmount', key: 'paymentAmount', width: 140, align: 'right' as const,
        render: (amt: number) => <Text strong style={{ color: REDWOOD.success }}>{formatCurrency(amt)}</Text>
      },
      {
        title: 'Status', dataIndex: 'paymentStatus', key: 'paymentStatus', width: 100,
        render: (status: string) => <Tag color={status === 'NEGOTIABLE' ? 'green' : 'default'}>{status}</Tag>
      },
      { title: 'Method', dataIndex: 'paymentMethod', key: 'paymentMethod', width: 100 },
      { title: 'Bank Account', dataIndex: 'bankAccountName', key: 'bankAccountName', ellipsis: true },
    ];

    // Handle balance tab change to lazy load data
    const handleBalanceTabChange = (key: string) => {
      if (key === 'invoices' && invoices.length === 0 && !invoicesLoading) {
        fetchBalanceInvoices(tab.supplier.supplierNumber, tabKey);
      } else if (key === 'payments' && payments.length === 0 && !paymentsLoading) {
        fetchBalancePayments(tab.supplier.supplierNumber, tabKey);
      }
      // analytics: do NOT auto-load — user must click Refresh
    };

    const analyticsData    = analyticsDataMap[tabKey] || null;
    const analyticsLoading = analyticsLoadingMap[tabKey] || false;
    const CHART_COLORS = ['#C74634','#0572CE','#1D7B4D','#D4A800','#8B5CF6','#06B6D4','#F59E0B','#EF4444','#10B981','#6366F1','#84CC16'];

    return (
      <div style={{ padding: '0 24px 24px' }}>
        {/* Supplier Header */}
        <Card style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <Row gutter={24} align="middle">
            <Col span={16}>
              <Row align="middle" gutter={16}>
                <Col>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: REDWOOD.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <UserOutlined style={{ fontSize: 24, color: '#fff' }} />
                  </div>
                </Col>
                <Col>
                  <Title level={4} style={{ margin: 0 }}>{supplier.supplierName}</Title>
                  <Space>
                    <Tag color={REDWOOD.info}>{supplier.supplierNumber}</Tag>
                    <Tag color={supplier.status === 'Active' ? REDWOOD.success : REDWOOD.error}>{supplier.status}</Tag>
                    {supplier.supplierType && <Tag>{supplier.supplierType}</Tag>}
                  </Space>
                </Col>
              </Row>
              {supplier.address && (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <Space>
                    <EnvironmentOutlined style={{ color: REDWOOD.neutral600 }} />
                    <Text type="secondary">
                      {[supplier.address.addressLine1, supplier.address.city, supplier.address.country].filter(Boolean).join(', ')}
                    </Text>
                  </Space>
                </>
              )}
            </Col>
            <Col span={8}>
              <Card style={{ background: balanceSummary.balance > 0 ? '#fff2f0' : '#f6ffed', borderColor: balanceSummary.balance > 0 ? REDWOOD.error : REDWOOD.success }}>
                <Statistic
                  title={<Text strong>Outstanding Balance</Text>}
                  value={balanceSummary.balance}
                  precision={2}
                  prefix={balanceSummary.currency}
                  valueStyle={{ color: balanceSummary.balance > 0 ? REDWOOD.error : REDWOOD.success, fontSize: 24 }}
                />
              </Card>
            </Col>
          </Row>
        </Card>

        {/* Balance Tabs */}
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <Tabs
            defaultActiveKey="summary"
            onChange={handleBalanceTabChange}
            items={[
              {
                key: 'summary',
                label: <Space><DollarOutlined />Balance Summary</Space>,
                children: (
                  <div>
                    {/* Summary Cards */}
                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic title="Total Invoices" value={balanceSummary.totalInvoices} prefix={<FileTextOutlined style={{ color: REDWOOD.info }} />} />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic title="Invoice Amount" value={balanceSummary.totalInvoiceAmount} precision={2} suffix={balanceSummary.currency} valueStyle={{ fontSize: 18 }} />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic title="Total Payments" value={balanceSummary.totalPayments} prefix={<CreditCardOutlined style={{ color: REDWOOD.success }} />} />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic title="Paid Amount" value={balanceSummary.totalPaymentAmount} precision={2} suffix={balanceSummary.currency} valueStyle={{ color: REDWOOD.success, fontSize: 18 }} />
                        </Card>
                      </Col>
                    </Row>

                    {/* Aging Report */}
                    <Card title={<Space><ExclamationCircleOutlined style={{ color: REDWOOD.warning }} /><Text strong>Aging Report</Text></Space>} size="small" style={{ marginBottom: 16 }}>
                      <Row gutter={12}>
                        {agingReport.map((bucket, index) => (
                          <Col span={4} key={index}>
                            <Card size="small" style={{ borderTop: `3px solid ${getAgingColor(bucket.bucket)}`, textAlign: 'center' }}>
                              <Text type="secondary" style={{ fontSize: 11 }}>{bucket.bucket}</Text>
                              <div style={{ margin: '8px 0' }}>
                                <Text strong style={{ fontSize: 16, color: getAgingColor(bucket.bucket) }}>{formatCurrency(bucket.amount)}</Text>
                              </div>
                              <Tag style={{ fontSize: 10 }}>{bucket.invoiceCount} inv</Tag>
                              <Progress percent={bucket.percentage} size="small" strokeColor={getAgingColor(bucket.bucket)} showInfo={false} style={{ marginTop: 8 }} />
                              <Text type="secondary" style={{ fontSize: 10 }}>{bucket.percentage.toFixed(1)}%</Text>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    </Card>

                    {/* Balance Calculation */}
                    <Card title="Balance Calculation" size="small">
                      <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="Total Invoice Amount"><Text strong>{formatCurrency(balanceSummary.totalInvoiceAmount)}</Text></Descriptions.Item>
                        <Descriptions.Item label="Total Payment Amount"><Text style={{ color: REDWOOD.success }}>- {formatCurrency(balanceSummary.totalPaymentAmount)}</Text></Descriptions.Item>
                        <Descriptions.Item label="Outstanding Balance">
                          <Text strong style={{ fontSize: 16, color: balanceSummary.balance > 0 ? REDWOOD.error : REDWOOD.success }}>= {formatCurrency(balanceSummary.balance)}</Text>
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </div>
                ),
              },
              {
                key: 'invoices',
                label: <Space><FileTextOutlined />Invoices ({invoices.length})</Space>,
                children: (
                  <InvoicesTabContent
                    invoices={invoices}
                    invoicesLoading={!!invoicesLoading}
                    supplierNumber={tab.supplier.supplierNumber}
                    apiUrl={invoicesUrlMap[tabKey] || `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/${tab.supplier.supplierNumber}?limit=500`}
                    onExport={rows => exportInvoicesToExcel(tabKey, tab.supplier.supplierNumber, rows)}
                    onRefresh={() => fetchBalanceInvoices(tab.supplier.supplierNumber, tabKey)}
                    onEdit={record => { setEditInvoice({ ...record }); setEditInvoiceVisible(true); }}
                  />
                ),
              },
              {
                key: 'payments',
                label: <Space><CreditCardOutlined />Payments ({payments.length})</Space>,
                children: (
                  <div>
                    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Button icon={<ReloadOutlined />} onClick={() => fetchBalancePayments(tab.supplier.supplierNumber, tabKey)} loading={paymentsLoading}>Refresh</Button>
                      <Button
                        icon={<FileExcelOutlined />}
                        disabled={payments.length === 0}
                        style={{ color: '#1D7B4D', borderColor: '#1D7B4D' }}
                        onClick={() => {
                          const exportRows = payments.map(p => ({
                            'Payment #':      p.paymentNumber,
                            'Payment Date':   p.paymentDate,
                            'Amount':         p.paymentAmount,
                            'Currency':       p.currency,
                            'Status':         p.paymentStatus,
                            'Method':         p.paymentMethod,
                            'Bank Account':   p.bankAccountName,
                          }));
                          const ws = XLSX.utils.json_to_sheet(exportRows);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, 'Payments');
                          saveAs(
                            new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }),
                            `Payments_${tab.supplier.supplierNumber}_${new Date().toISOString().slice(0, 10)}.xlsx`
                          );
                        }}
                      >
                        Excel
                      </Button>
                      <Text type="secondary">Click payment number to view related invoices</Text>
                    </div>
                    <Table
                      columns={paymentColumns}
                      dataSource={payments}
                      loading={paymentsLoading}
                      scroll={{ x: 800 }}
                      size="small"
                      rowKey="key"
                      pagination={{
                        defaultPageSize: 20,
                        showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50', '100'],
                        showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} payments`,
                      }}
                      summary={() => {
                        if (!payments.length) return null;
                        const total = payments.reduce((s, p) => s + (p.paymentAmount || 0), 0);
                        return (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#f6ffed', fontWeight: 600 }}>
                              <Table.Summary.Cell index={0} colSpan={2}>
                                <Text strong style={{ fontSize: 11 }}>Total ({payments.length} payments)</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={2} align="right">
                                <Text strong style={{ color: REDWOOD.success, fontFamily: 'monospace' }}>{formatCurrency(total)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={3} colSpan={3} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        );
                      }}
                    />
                  </div>
                ),
              },
              {
                key: 'analytics',
                label: <Space><BarChartOutlined />Analytics</Space>,
                children: (
                  <div>
                    {/* Toolbar */}
                    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        type="primary"
                        icon={<ReloadOutlined />}
                        loading={analyticsLoading}
                        style={{ background: REDWOOD.primary }}
                        onClick={() => fetchAnalyticsData(tab.supplier.supplierNumber, tabKey)}
                      >
                        Refresh
                      </Button>
                      <Button
                        icon={<FileExcelOutlined />}
                        disabled={!analyticsData}
                        style={{ color: '#1D7B4D', borderColor: '#1D7B4D' }}
                        onClick={() => exportAnalyticsExcel(tabKey, tab.supplier.supplierNumber)}
                      >
                        Excel
                      </Button>
                      <Button
                        icon={<FilePdfOutlined />}
                        disabled={!analyticsData}
                        style={{ color: REDWOOD.error, borderColor: REDWOOD.error }}
                        onClick={() => exportAnalyticsPdf(tabKey, tab.supplier.supplierNumber, supplier.supplierName)}
                      >
                        PDF / Preview
                      </Button>
                      {analyticsData && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {analyticsData.totalCount} invoices · AED {analyticsData.totalAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                        </Text>
                      )}
                    </div>

                    {!analyticsData && !analyticsLoading && (
                      <div style={{ textAlign: 'center', padding: 60, color: REDWOOD.neutral600 }}>
                        <BarChartOutlined style={{ fontSize: 48, marginBottom: 12 }} />
                        <div>Click <b>Refresh</b> to load invoice analytics</div>
                      </div>
                    )}

                    {analyticsLoading && (
                      <div style={{ textAlign: 'center', padding: 60 }}>
                        <Spin size="large" tip="Computing analytics..." />
                      </div>
                    )}

                    {analyticsData && !analyticsLoading && (
                      <div>
                        <Row gutter={16} style={{ marginBottom: 24 }}>
                          {/* Pie chart */}
                          <Col span={10}>
                            <Card size="small" title={<Text strong>Category Breakdown (Pie)</Text>}>
                              <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                  <Pie
                                    data={analyticsData.categories}
                                    dataKey="amount"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                    labelLine={false}
                                  >
                                    {analyticsData.categories.map((_, i) => (
                                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                  </Pie>
                                  <RTooltip formatter={(val: any) => [`AED ${(val as number).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`, 'Amount']} />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            </Card>
                          </Col>

                          {/* Bar chart */}
                          <Col span={14}>
                            <Card size="small" title={<Text strong>Category Comparison (Bar)</Text>}>
                              <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={analyticsData.categories} margin={{ top: 5, right: 20, left: 20, bottom: 60 }}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="name" angle={-35} textAnchor="end" tick={{ fontSize: 10 }} interval={0} />
                                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                                  <RTooltip formatter={(val: any) => [`AED ${(val as number).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`, 'Amount']} />
                                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                                    {analyticsData.categories.map((_, i) => (
                                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </Card>
                          </Col>
                        </Row>

                        {/* Line chart trend */}
                        <Row gutter={16} style={{ marginBottom: 24 }}>
                          <Col span={24}>
                            <Card size="small" title={<Text strong>Monthly Expense Trend</Text>}>
                              {analyticsData.trend.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 20, color: REDWOOD.neutral600 }}>No date data available</div>
                              ) : (
                                <ResponsiveContainer width="100%" height={240}>
                                  <LineChart data={analyticsData.trend} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                                    <RTooltip formatter={(val: any) => [`AED ${(val as number).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`, 'Amount']} />
                                    <Legend />
                                    <Line type="monotone" dataKey="amount" stroke={REDWOOD.primary} strokeWidth={2} dot={{ r: 4 }} name="Invoice Amount" />
                                  </LineChart>
                                </ResponsiveContainer>
                              )}
                            </Card>
                          </Col>
                        </Row>

                        {/* Category data table */}
                        <Card size="small" title={<Text strong>Category Detail</Text>} extra={<Text type="secondary" style={{ fontSize: 11 }}>Click a row to see invoices</Text>}>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={analyticsData.categories.map((c, i) => ({ ...c, key: i }))}
                            onRow={(record: CategoryData) => ({
                              onClick: () => {
                                setCatDrillCategory(record.name);
                                setCatDrillInvoices(analyticsData.invoicesByCategory[record.name] || []);
                                setCatDrillVisible(true);
                              },
                              style: { cursor: 'pointer' },
                            })}
                            columns={[
                              { title: 'Category', dataIndex: 'name', key: 'name',
                                render: (v: string, _: any, i: number) => (
                                  <Space>
                                    <div style={{ width: 12, height: 12, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                                    <a style={{ color: REDWOOD.info }}>{v}</a>
                                  </Space>
                                )
                              },
                              { title: 'Invoice Count', dataIndex: 'count', key: 'count', align: 'right' as const, width: 120 },
                              { title: 'Total Amount (AED)', dataIndex: 'amount', key: 'amount', align: 'right' as const, width: 180,
                                render: (v: number) => <Text strong style={{ fontFamily: 'monospace' }}>{v.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text>
                              },
                              { title: '% of Total', key: 'pct', align: 'right' as const, width: 100,
                                render: (_: any, r: CategoryData) => (
                                  <Text>{analyticsData.totalAmount > 0 ? ((r.amount / analyticsData.totalAmount) * 100).toFixed(1) : '0'}%</Text>
                                )
                              },
                            ]}
                            summary={() => (
                              <Table.Summary.Row style={{ background: '#f0f5ff' }}>
                                <Table.Summary.Cell index={0}><Text strong>Total</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={1} align="right"><Text strong>{analyticsData.totalCount}</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={2} align="right">
                                  <Text strong style={{ fontFamily: 'monospace' }}>{analyticsData.totalAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={3} align="right"><Text strong>100%</Text></Table.Summary.Cell>
                              </Table.Summary.Row>
                            )}
                          />
                        </Card>
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Card>

        {/* Category Invoice Drilldown Modal */}
        <Modal
          title={
            <Space>
              <FileTextOutlined style={{ color: REDWOOD.info }} />
              <span>Invoices — {catDrillCategory}</span>
              <Tag color="blue">{catDrillInvoices.length}</Tag>
            </Space>
          }
          open={catDrillVisible}
          onCancel={() => setCatDrillVisible(false)}
          footer={[<Button key="close" onClick={() => setCatDrillVisible(false)}>Close</Button>]}
          width={700}
        >
          <Table
            size="small"
            pagination={{ pageSize: 10, showTotal: t => `${t} invoices`, size: 'small' }}
            dataSource={catDrillInvoices.map((inv, i) => ({ ...inv, key: i }))}
            columns={[
              { title: 'Invoice #', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 150,
                render: (v: string) => <Text style={{ color: REDWOOD.info, fontWeight: 500 }}>{v || '—'}</Text> },
              { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
                render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
              { title: 'Amount (AED)', dataIndex: 'amount', key: 'amount', width: 150, align: 'right' as const,
                render: (v: number) => <Text strong style={{ fontFamily: 'monospace' }}>{v.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text> },
            ]}
            summary={() => {
              const total = catDrillInvoices.reduce((s, r) => s + r.amount, 0);
              return (
                <Table.Summary.Row style={{ background: '#f0f5ff' }}>
                  <Table.Summary.Cell index={0} colSpan={2}><Text strong>Total</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <Text strong style={{ fontFamily: 'monospace' }}>{total.toLocaleString('en-AE', { minimumFractionDigits: 2 })}</Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
        </Modal>

        {/* PDF Preview Modal */}
        <Modal
          title={<Space><FilePdfOutlined style={{ color: REDWOOD.error }} />PDF Preview</Space>}
          open={pdfPreviewVisible}
          onCancel={() => { setPdfPreviewVisible(false); setPdfPreviewUrl(''); }}
          footer={[
            <Button key="download" type="primary" icon={<FilePdfOutlined />} style={{ background: REDWOOD.error }}
              onClick={() => {
                const a = document.createElement('a');
                a.href = pdfPreviewUrl;
                a.download = `Analytics_${tab.supplier.supplierNumber}_${new Date().toISOString().slice(0, 10)}.pdf`;
                a.click();
              }}>
              Download PDF
            </Button>,
            <Button key="close" onClick={() => { setPdfPreviewVisible(false); setPdfPreviewUrl(''); }}>Close</Button>,
          ]}
          width="80vw"
          style={{ top: 20 }}
          styles={{ body: { padding: 0, height: 'calc(80vh - 100px)' } }}
        >
          {pdfPreviewUrl && (
            <iframe src={pdfPreviewUrl} style={{ width: '100%', height: '100%', border: 'none', minHeight: 500 }} title="PDF Preview" />
          )}
        </Modal>
      </div>
    );
  };

  // Build tab items
  const tabItems = [
    {
      key: 'search',
      label: (
        <Space>
          <SearchOutlined />
          Manage Suppliers
        </Space>
      ),
      children: renderSearchTab(),
      closable: false,
    },
    ...openTabs.map((tab) => ({
      key: tab.key,
      label: (
        <Space>
          {tab.tabType === 'balance' ? <DollarOutlined style={{ color: REDWOOD.success }} /> : <UserOutlined />}
          <Text>{tab.tabType === 'balance' ? 'Balance: ' : 'Supplier: '}{tab.label}</Text>
        </Space>
      ),
      children: tab.tabType === 'balance' ? renderSupplierBalanceTab(tab) : renderSupplierDetailTab(tab),
      closable: true,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb>
            <Breadcrumb.Item>
              <Link to="/home">
                <HomeOutlined /> Home
              </Link>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <Link to="/ap">Payables</Link>
            </Breadcrumb.Item>
            <Breadcrumb.Item>Suppliers</Breadcrumb.Item>
          </Breadcrumb>
        </div>

        {/* Page Title */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface }}>
          <Row justify="space-between" align="middle">
            <Col>
              <Title level={3} style={{ margin: 0 }}>
                Manage Suppliers
              </Title>
            </Col>
            <Col>
              <Space>
                <Tooltip title="View API Endpoints">
                  <Button
                    type="text"
                    icon={<ApiOutlined />}
                    onClick={() => setApiModalVisible(true)}
                    style={{ color: REDWOOD.info }}
                  >
                    API
                  </Button>
                </Tooltip>
                <Button type="text" style={{ color: REDWOOD.info }}>Done</Button>
              </Space>
            </Col>
          </Row>
        </div>

        {/* Tabs */}
        <Tabs
          type="editable-card"
          activeKey={activeTab}
          onChange={onTabChange}
          onEdit={onTabEdit}
          hideAdd
          items={tabItems}
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{
            padding: '0 24px',
            marginBottom: 0,
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
          }}
        />

        {/* Supplier LOV Modal */}
        <Modal
          title={
            <Space>
              <SearchOutlined style={{ color: REDWOOD.info }} />
              <span>Supplier List of Values</span>
              {!lovLoading && lovResults.length > 0 && (
                <Tag color="blue">{lovResults.length} suppliers</Tag>
              )}
            </Space>
          }
          open={lovVisible}
          onCancel={() => setLovVisible(false)}
          footer={null}
          width={680}
          destroyOnClose
        >
          <Input
            placeholder="Search by supplier number or name..."
            prefix={<SearchOutlined />}
            value={lovSearch}
            onChange={e => setLovSearch(e.target.value)}
            allowClear
            autoFocus
            style={{ marginBottom: 12 }}
          />
          <Table
            size="small"
            loading={lovLoading}
            dataSource={displayedLovResults}
            pagination={{ pageSize: 10, showTotal: t => `${t} of ${lovResults.length} suppliers`, size: 'small' }}
            locale={{ emptyText: 'Type to search suppliers' }}
            onRow={row => ({
              onClick: () => onLovPick(row),
              style: { cursor: 'pointer' },
            })}
            columns={[
              { title: 'Supplier Number', dataIndex: 'supplierNumber', key: 'supplierNumber', width: 160,
                render: (v: string) => <Text style={{ color: REDWOOD.info, fontWeight: 500 }}>{v}</Text> },
              { title: 'Supplier Name', dataIndex: 'supplier', key: 'supplier' },
            ]}
          />
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>Click a row to select</Text>
          </div>
        </Modal>

        {/* API Info Modal */}
        <Modal
          title={
            <Space>
              <ApiOutlined style={{ color: REDWOOD.info }} />
              <span>API Endpoints - Manage Suppliers</span>
            </Space>
          }
          open={apiModalVisible}
          onCancel={() => setApiModalVisible(false)}
          footer={[
            <Button key="close" onClick={() => setApiModalVisible(false)}>
              Close
            </Button>,
          ]}
          width={900}
        >
          {/* APEX APIs */}
          <Card
            size="small"
            title={
              <Space>
                <DatabaseOutlined style={{ color: REDWOOD.success }} />
                <Text strong>APEX APIs</Text>
                <Tag color="green">Active</Tag>
              </Space>
            }
          >
            {PAGE_APIS.apex.map((api, index) => (
              <div
                key={index}
                style={{
                  padding: '12px',
                  background: REDWOOD.neutral100,
                  borderRadius: 6,
                  marginBottom: index < PAGE_APIS.apex.length - 1 ? 12 : 0,
                }}
              >
                <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
                  <Col>
                    <Space>
                      <Tag color="green">{api.method}</Tag>
                      <Text strong>{api.name}</Text>
                    </Space>
                  </Col>
                </Row>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  {api.description}
                </Text>
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Proxy URL:</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code
                      style={{
                        background: '#f5f5f5',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {api.proxyUrl}
                    </code>
                    <Button
                      type="text"
                      size="small"
                      icon={copiedUrl === api.proxyUrl ? <CheckOutlined /> : <CopyOutlined />}
                      onClick={() => copyToClipboard(api.proxyUrl)}
                    />
                  </div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Actual URL:</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code
                      style={{
                        background: '#f6ffed',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {api.actualUrl}
                    </code>
                    <Button
                      type="text"
                      size="small"
                      icon={copiedUrl === api.actualUrl ? <CheckOutlined /> : <CopyOutlined />}
                      onClick={() => copyToClipboard(api.actualUrl)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </Modal>

        {/* Payment Drilldown Modal */}
        <Modal
          title={
            <Space>
              <CreditCardOutlined style={{ color: REDWOOD.success }} />
              <span>Payment: {drilldownPayment?.paymentNumber}</span>
            </Space>
          }
          open={drilldownVisible}
          onCancel={() => {
            setDrilldownVisible(false);
            setDrilldownPayment(null);
            setRelatedInvoices([]);
          }}
          footer={[
            <Button key="close" onClick={() => setDrilldownVisible(false)}>Close</Button>,
          ]}
          width={800}
        >
          {drilldownPayment && (
            <div style={{ marginBottom: 16 }}>
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="Payment Number">{drilldownPayment.paymentNumber}</Descriptions.Item>
                <Descriptions.Item label="Payment Date">{drilldownPayment.paymentDate}</Descriptions.Item>
                <Descriptions.Item label="Amount">
                  <Text strong style={{ color: REDWOOD.success }}>{formatCurrency(drilldownPayment.paymentAmount, drilldownPayment.currency)}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Status"><Tag>{drilldownPayment.paymentStatus}</Tag></Descriptions.Item>
                <Descriptions.Item label="Method">{drilldownPayment.paymentMethod}</Descriptions.Item>
                <Descriptions.Item label="Bank Account">{drilldownPayment.bankAccountName}</Descriptions.Item>
              </Descriptions>
            </div>
          )}

          <Card title="Related Invoices" size="small">
            <Table
              columns={[
                { title: 'Invoice #',       dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 150 },
                { title: 'Invoice Amount',  dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 130, align: 'right' as const,
                  render: (amt: number) => formatCurrency(amt) },
                { title: 'Cash Applied',    dataIndex: 'amountApplied', key: 'amountApplied', width: 130, align: 'right' as const,
                  render: (amt: number) => <Text style={{ color: REDWOOD.success }}>{formatCurrency(amt)}</Text> },
                { title: 'Discount Taken',  dataIndex: 'discountTaken', key: 'discountTaken', width: 130, align: 'right' as const,
                  render: (amt: number) => <Text style={{ color: amt > 0 ? REDWOOD.warning : REDWOOD.neutral600 }}>{formatCurrency(amt)}</Text> },
                { title: 'Total Settled',   dataIndex: 'totalSettled',  key: 'totalSettled',  width: 130, align: 'right' as const,
                  render: (amt: number) => <Text strong style={{ color: REDWOOD.success }}>{formatCurrency(amt)}</Text> },
              ]}
              dataSource={relatedInvoices}
              loading={drilldownLoading}
              pagination={false}
              size="small"
              locale={{ emptyText: 'No related invoices found' }}
              summary={() => {
                if (relatedInvoices.length === 0) return null;
                const totInv  = relatedInvoices.reduce((s, r) => s + r.invoiceAmount, 0);
                const totCash = relatedInvoices.reduce((s, r) => s + r.amountApplied, 0);
                const totDisc = relatedInvoices.reduce((s, r) => s + r.discountTaken, 0);
                const totSett = relatedInvoices.reduce((s, r) => s + r.totalSettled,  0);
                return (
                  <Table.Summary.Row style={{ background: '#f6ffed' }}>
                    <Table.Summary.Cell index={0}><Text strong style={{ fontSize: 11 }}>Total</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right"><Text strong style={{ fontSize: 11 }}>{formatCurrency(totInv)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: REDWOOD.success, fontSize: 11 }}>{formatCurrency(totCash)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><Text strong style={{ color: REDWOOD.warning, fontSize: 11 }}>{formatCurrency(totDisc)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: REDWOOD.success, fontSize: 11 }}>{formatCurrency(totSett)}</Text></Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          </Card>
        </Modal>
        {/* Edit Invoice Modal — full InvoiceDetail (header + lines) */}
        <Modal
          title={
            <Space>
              <EditOutlined style={{ color: REDWOOD.info }} />
              <span>Invoice: {editInvoice?.invoiceNumber}</span>
            </Space>
          }
          open={editInvoiceVisible}
          onCancel={() => { setEditInvoiceVisible(false); setEditInvoice(null); }}
          footer={null}
          width="95vw"
          style={{ top: 20 }}
          styles={{ body: { padding: 0, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' } }}
          destroyOnClose
        >
          {editInvoice && (() => {
            // Find the supplier name from the active balance tab
            const activeBalanceTab = openTabs.find(t => t.tabType === 'balance' && t.key === activeTab);
            const supplierName = activeBalanceTab
              ? balanceDataMap[activeBalanceTab.key]?.supplier?.supplierName || activeBalanceTab.supplier.supplier
              : '';
            return (
              <InvoiceDetail
                invoice={{
                  invoiceId: editInvoice.invoiceId,
                  invoiceNumber: editInvoice.invoiceNumber,
                  invoiceDate: editInvoice.invoiceDate,
                  invoiceType: editInvoice.invoiceType || 'Standard',
                  supplierOrParty: supplierName,
                  supplierSite: '',
                  invoiceAmount: editInvoice.invoiceAmount,
                  unpaidAmount: editInvoice.amountRemaining,
                  appliedPrepayments: 0,
                  invoiceCurrency: editInvoice.currency,
                  businessUnit: '',
                  validationStatus: editInvoice.invoiceStatus || 'Never validated',
                  approvalStatus: '',
                  holdPaidStatus: editInvoice.amountRemaining === 0 ? 'Paid' : 'Not paid',
                  notes: editInvoice.description,
                  syncStatus: 'SYNCED',
                }}
                onClose={() => { setEditInvoiceVisible(false); setEditInvoice(null); }}
              />
            );
          })()}
        </Modal>

        <FloatingMenu />
        
      </Content>
    </Layout>
  );
};

export default ManageSuppliers;
