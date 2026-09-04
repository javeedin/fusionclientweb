import { buildApexUrl, buildCurrencyUrl } from '../../config/api.helper';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  Card,
  Form,
  Select,
  Input,
  Button,
  Space,
  Typography,
  Table,
  Tag,
  Row,
  Col,
  Tooltip,
  Tabs,
  message,
  DatePicker,
  InputNumber,
  Modal,
  Divider,
  Descriptions,
  Dropdown,
  Alert,
  Drawer,
  Statistic,
  Progress,
  Spin,
  Upload,
  Badge,
  Popover,
  AutoComplete,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SaveOutlined,
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  FileTextOutlined,
  ShoppingCartOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UndoOutlined,
  DownOutlined,
  CheckSquareOutlined,
  StopOutlined,
  CalculatorOutlined,
  DollarOutlined,
  LockOutlined,
  UnlockOutlined,
  SendOutlined,
  RollbackOutlined,
  CopyOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  WalletOutlined,
  CreditCardOutlined,
  LoadingOutlined,
  ApiOutlined,
  AccountBookOutlined,
  AppstoreOutlined,
  CalendarOutlined,
  InfoCircleOutlined,
  UploadOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  InboxOutlined,
  ScheduleOutlined,
  BankOutlined,
  PlayCircleOutlined,
  EditOutlined,
  BugOutlined,
  EyeOutlined,
  PaperClipOutlined,
  PrinterOutlined,
} from '@ant-design/icons';

dayjs.extend(customParseFormat);
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ColumnsType } from 'antd/es/table';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { fetchLedgerByBusinessUnit, checkAccountingExists, getAccounting, getLinesByHeaderId, checkGLJournalExists, createAccounting, buildApPaymentSlaPayloads, derivePeriodName } from '../../services/sla.service';
import { postSlaToGL, eventTypeToRef5 } from '../../services/glPosting.service';
import type { GlPostingLine } from '../../services/glPosting.service';
import { searchCombinations, type DistCombination } from '../../services/distCombinations.service';
import AccountSelector, { validateAccountCode } from '../../components/AccountSelector';
import { useAccountDescriptions } from '../../hooks/useAccountDescriptions';
import { useAuth } from '../../context/AuthContext';
import InvoiceAttachments from '../../components/InvoiceAttachments';
import { listAttachments } from '../../services/invoiceAttachment.service';
import { getMpaSchedule, generateMpaSchedule } from '../../services/multiperiod.service';

const { Text, Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

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
  neutral400: '#A0A0A0',
  neutral600: '#6B6B6B',
  neutral700: '#4A4A4A',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  textSecondary: '#6B6B6B',
};

const APEX_SUPPLIERS_URL      = `${APEX_DB_CONFIG.baseUrl}/suppliers?limit=500`;
const APEX_BUSINESS_UNITS_URL = `${APEX_DB_CONFIG.baseUrl}/gl/businessunits`;
const APEX_SUPPLIER_SITES_URL = `${APEX_DB_CONFIG.baseUrl}/suppliers/sites`;

// Supplier record
interface SupplierRecord {
  key: string;
  supplierId: number;
  supplier: string;
  supplierNumber: string;
  alternativeName: string;
  status: string;
  supplierType: string;
  creationDate: string;
  taxpayerId: string;
}

interface SupplierSiteRecord {
  siteId: string;
  siteName: string;
}

// Supplier balance interfaces
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

interface BalanceInvoiceRecord {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  amountPaid: number;
  amountRemaining: number;
  invoiceStatus: string;
  currency: string;
  description: string;
}

interface BalancePaymentRecord {
  key: string;
  paymentId: number;
  paymentNumber: string;
  paymentDate: string;
  paymentAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  currency: string;
  bankAccountName: string;
}

// Format currency
const formatCurrency = (amount: number, currency: string = 'AED'): string => {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

// Format date
// Parse a date that may arrive as ISO (YYYY-MM-DD[THH:mm:ssZ]), Oracle DD-MON-YYYY
// (e.g. 31-JUL-2026), DD-MMM-YYYY, or space-separated "DD MMM YYYY". Returns a dayjs
// object or null. Centralises parsing so load (formatDateStr) and save (toISODate) agree.
const parseFlexDate = (input: string | null | undefined): dayjs.Dayjs | null => {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Normalise a "DD-MON-YYYY" / "DD MON YYYY" style token so the month is Title-case
  // (dayjs's MMM token is case-sensitive, so "31-JUL-2026" would otherwise fail).
  const m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/);
  const normalised = m
    ? `${m[1].padStart(2, '0')}-${m[2][0].toUpperCase()}${m[2].slice(1, 3).toLowerCase()}-${m[3]}`
    : s;
  const d = dayjs(normalised, [
    'DD-MMM-YYYY', 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss',
    'YYYY-MM-DDTHH:mm:ssZ', 'YYYY-MM-DDTHH:mm:ss.SSSZ', 'DD-MMMM-YYYY',
  ], false);
  if (d.isValid()) return d;
  const native = dayjs(new Date(s));
  return native.isValid() ? native : null;
};

const formatDateStr = (dateStr: string | null): string => {
  const d = parseFlexDate(dateStr);
  return d ? d.format('DD-MMM-YYYY') : '';
};

// Aging color helper
const getAgingColor = (bucket: string): string => {
  switch (bucket) {
    case 'Current': return '#1D7B4D';
    case '1-30 Days': return '#0572CE';
    case '31-60 Days': return '#D4A800';
    case '61-90 Days': return '#FF8C00';
    case '91-120 Days': return '#C74634';
    case '120+ Days': return '#D93025';
    default: return '#6B6B6B';
  }
};

// Unified Invoice Line - same data, different column views per tab
interface InvoiceLine {
  key: string;
  id?: number;
  lineNumber: number;
  // Distribution columns (matching Fusion Payables)
  type: string;
  amount: number;
  distributionSet: string;
  distributionCombination: string;
  accountingDate: string;
  prorateAcrossAllItemLines: string;
  description: string;
  taxClassification: string;
  shipToLocation: string;
  // Additional distribution fields
  quantity: number;
  unitPrice: number;
  uomName: string;
  project: string;
  task: string;
  // Purchase Order columns
  poNumber: string;
  poLine: string;
  poSchedule: string;
  receiptNumber: string;
  receiptLine: string;
  consumptionAdviceNumber: string;
  consumptionAdviceLine: string;
  startDate: string;
  endDate: string;
  accrualAccount: string;
  taxAmount: number;
  taxAccountCombination?: string;  // GL account for this line's tax, from BU tax assignment
  accountDescription?: string;
}

// Prepayment interfaces
interface AvailablePrepayment {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  description: string;
  supplierSite: string;
  purchaseOrder: string;
  currency: string;
  availableAmount: number;
  lineNumber: number;
  prepaymentLineNumber: number;
  businessUnit: string;
  toApply: number;
  accountingDate: dayjs.Dayjs | null;
}

interface AppliedPrepayment {
  key: string;
  applicationId: number;
  prepaymentInvoiceId: number;
  prepaymentNumber: string;
  description: string;
  supplierSite: string;
  purchaseOrder: string;
  currency: string;
  appliedAmount: number;
  lineNumber: number;
  prepaymentLineNumber: number;
  applicationAccountingDate: string;
  createdBy?: string;
  status?: string;
  syncStatus?: string;
}

// When viewing a Prepayment invoice: balance summary
interface PrepaymentBalance {
  invoiceAmount: number;
  totalApplied: number;
  availableBalance: number;
  applicationCount: number;
}

// When viewing a Prepayment invoice: which standard invoices applied this prepayment
interface AppliedInvoice {
  key: string;
  applicationId: number;
  invoiceId: number;
  invoiceNumber: string;
  description: string;
  currency: string;
  appliedAmount: number;
  applicationAccountingDate: string;
  status: string;
}

interface InstallmentRow {
  key: string;
  installmentId?: number | null;   // DB primary key — null/undefined for new rows
  installmentNumber: number;
  dueDate: dayjs.Dayjs | null;
  grossAmount: number;
  unpaidAmount: number;
  paymentPriority: number;
  paymentMethod: string;
  bankAccount: string;
}

// Currency list
const CURRENCIES = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'JOD', name: 'Jordanian Dinar' },
  { code: 'LBP', name: 'Lebanese Pound' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'RUB', name: 'Russian Ruble' },
];

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

// Format amount
const formatAmount = (value: number): string => {
  return new Intl.NumberFormat('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

// Helper: derive tax rate from tax classification code
const getTaxRateForClassification = (taxClassification: string): number => {
  if (!taxClassification) return 0;
  if (taxClassification === 'VAT 5%') return 5;
  // Zero Rated, Exempt, Out of Scope, Reverse Charge => 0
  return 0;
};

// Helper: compute end of month from a DD-MMM-YYYY date string
const getEndOfMonth = (dateStr: string): string => {
  if (!dateStr) return '';
  const parsed = dayjs(dateStr, 'DD-MMM-YYYY');
  if (!parsed.isValid()) return '';
  return parsed.endOf('month').format('DD-MMM-YYYY');
};

// Create a blank line — accepts optional defaults to inherit from header
const createBlankLine = (lineNumber: number, defaults?: { accountingDate?: string; taxClassification?: string; accrualAccount?: string; description?: string }): InvoiceLine => {
  const acctDate = defaults?.accountingDate || '';
  return {
    key: Date.now().toString() + '-' + lineNumber,
    lineNumber,
    type: 'Item',
    amount: 0,
    distributionSet: '',
    distributionCombination: '',
    accountingDate: acctDate,
    prorateAcrossAllItemLines: 'No',
    description: defaults?.description || '',
    taxClassification: defaults?.taxClassification || '',
    shipToLocation: '',
    quantity: 1,
    unitPrice: 0,
    uomName: '',
    project: '',
    task: '',
    poNumber: '',
    poLine: '',
    poSchedule: '',
    receiptNumber: '',
    receiptLine: '',
    consumptionAdviceNumber: '',
    consumptionAdviceLine: '',
    startDate: acctDate,
    endDate: getEndOfMonth(acctDate),
    accrualAccount: defaults?.accrualAccount || '',
    taxAmount: 0,
  };
};

export interface InvoiceInitialData {
  supplier?: string;
  supplierNumber?: string;
  supplierId?: number;
  invoiceNumber?: string;
  invoiceAmount?: number;
  invoiceDate?: any;
  description?: string;
  invoiceCurrency?: string;
  businessUnit?: string;
  invoiceType?: string;
  taxCode?: string;
  includingTax?: boolean;
  // Edit mode fields
  invoiceId?: number;
  supplierSite?: string;
  unpaidAmount?: number;
  validationStatus?: string;
  approvalStatus?: string;
  holdPaidStatus?: string;
  applyAfterDate?: string;
  paymentTerms?: string;
  invoiceGroup?: string;
  termsDate?: string;
  goodsReceivedDate?: string;
  liabilityDistribution?: string;
  accountingDate?: string;
  conversionRateType?: string;
  conversionDate?: string;
  conversionRate?: number | null;
  paymentCurrency?: string;
  // Audit / system info
  creationDate?: string;
  createdBy?: string;
  lastUpdatedBy?: string;
  lastUpdateDate?: string;
  syncDate?: string;
  cancellationDate?: string;
  cancelledBy?: string;
  deliveryChannelCode?: string;
  deliveryChannel?: string;
  firstPartyTaxRegistrationId?: string;
  firstPartyTaxRegistrationNum?: string;
  taxationCountry?: string;
  documentCategory?: string;
  documentSequence?: number | string;
  voucherNumber?: string;
  accountingStatus?: string;
  // Synced invoice (from Oracle Fusion) — read-only except Pay in Full
  isSynced?: boolean;
}

interface CreateInvoiceProps {
  onClose: () => void;
  onSave?: (values: any) => void;
  initialData?: InvoiceInitialData;
}

const CreateInvoice: React.FC<CreateInvoiceProps> = ({ onClose, onSave, initialData }) => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [payInFullForm] = Form.useForm();
  const [ciVoidForm] = Form.useForm();

  // Unified invoice lines - shared across both tabs
  const [lines, setLines] = useState<InvoiceLine[]>([createBlankLine(1, { accountingDate: initialData?.invoiceId ? '' : dayjs().format('DD-MMM-YYYY') })]);
  // Track lines whose description was manually edited (not auto-synced from header)
  const [manuallyEditedDescLines, setManuallyEditedDescLines] = useState<Set<string>>(new Set());
  // State for description edit modals
  const [headerDescModal, setHeaderDescModal] = useState(false);
  const [lineDescModal, setLineDescModal] = useState<{ open: boolean; lineKey: string; value: string }>({ open: false, lineKey: '', value: '' });

  // Distribution combinations (AP + ALL modules)
  const [distCombinations, setDistCombinations] = useState<DistCombination[]>([]);
  const [distLovOpen, setDistLovOpen]     = useState(false);
  const [distLovLineKey, setDistLovLineKey] = useState<string | null>(null);
  const [distLovSearch, setDistLovSearch] = useState('');

  // Supplier modal
  const [supplierModalVisible, setSupplierModalVisible] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [supplierSearchText, setSupplierSearchText] = useState('');
  const [selectedSupplierInfo, setSelectedSupplierInfo] = useState<{ number: string; id: number } | null>(null);
  const [businessUnits, setBusinessUnits] = useState<{ name: string; company: string }[]>([]);
  const [buSelected, setBuSelected] = useState<boolean>(!!initialData?.businessUnit);
  const [derivedCompany, setDerivedCompany] = useState<string>('');

  // Supplier sites
  const [supplierSites, setSupplierSites] = useState<SupplierSiteRecord[]>([]);
  const [supplierSiteLoading, setSupplierSiteLoading] = useState(false);

  // Header completion tracking
  const [headerValues, setHeaderValues] = useState<Record<string, any>>({
    invoiceType: 'Standard',
    invoiceCurrency: 'AED',
    invoiceDate: initialData?.invoiceId ? undefined : dayjs(),
  });
  const [taxRate, setTaxRate] = useState<number>(0);
  const [taxCodes, setTaxCodes] = useState<{ taxCode: string; taxName: string; taxRate: number; taxAccount: string }[]>([]);
  const taxRateMapRef    = useRef<Record<string, number>>({});
  const taxAccountMapRef = useRef<Record<string, string>>({});
  const taxRateMap = useMemo(() => {
    const rateMap: Record<string, number> = {};
    const acctMap: Record<string, string> = {};
    taxCodes.forEach(t => { rateMap[t.taxCode] = t.taxRate; acctMap[t.taxCode] = t.taxAccount; });
    taxRateMapRef.current    = rateMap;
    taxAccountMapRef.current = acctMap;
    return rateMap;
  }, [taxCodes]);

  // Check if all required header fields are filled
  const isHeaderComplete = useMemo(() => {
    const requiredFields = ['businessUnit', 'invoiceNumber', 'invoiceCurrency', 'invoiceAmount', 'invoiceDate', 'supplier', 'invoiceType'];
    const fieldsOk = requiredFields.every((field) => {
      const val = headerValues[field];
      return val !== undefined && val !== null && val !== '';
    });
    // For existing invoices derivedCompany is not required — it's only needed when
    // creating new account distributions. Synced/existing invoices already have lines stored.
    const editMode = !!initialData?.invoiceId;
    return fieldsOk && (editMode || !!derivedCompany);
  }, [headerValues, derivedCompany, initialData?.invoiceId]);

  // Line selection
  const [selectedLineKeys, setSelectedLineKeys] = useState<React.Key[]>([]);

  // Account Selector (Distribution Combination popup)
  const [accountSelectorVisible, setAccountSelectorVisible] = useState(false);
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  const [editingLineField, setEditingLineField] = useState<'distributionCombination' | 'accrualAccount'>('distributionCombination');
  const [accountSelectorInitialValue, setAccountSelectorInitialValue] = useState<string | undefined>(undefined);

  // Supplier balance popup state
  const [balanceModalVisible, setBalanceModalVisible] = useState(false);
  const [balanceSupplierName, setBalanceSupplierName] = useState('');
  const [balanceSupplierNumber, setBalanceSupplierNumber] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceSummary, setBalanceSummary] = useState<BalanceSummary | null>(null);
  const [agingReport, setAgingReport] = useState<AgingBucket[]>([]);
  const [balanceInvoices, setBalanceInvoices] = useState<BalanceInvoiceRecord[]>([]);
  const [balancePayments, setBalancePayments] = useState<BalancePaymentRecord[]>([]);
  const [balanceInvoicesLoading, setBalanceInvoicesLoading] = useState(false);
  const [balancePaymentsLoading, setBalancePaymentsLoading] = useState(false);
  const [balanceActiveTab, setBalanceActiveTab] = useState('invoices');
  const [balanceInvoiceFilter, setBalanceInvoiceFilter] = useState<'all' | 'paid' | 'unpaid'>('unpaid');
  const [balancePrepayments, setBalancePrepayments] = useState<any[]>([]);
  const [balancePrepaymentsLoading, setBalancePrepaymentsLoading] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);
  const amountDebounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validation state
  const [isValidated,        setIsValidated]        = useState(false);
  const [activeTabKey,       setActiveTabKey]       = useState('distribution');
  const [attachmentCount,    setAttachmentCount]    = useState(0);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const [validationResults, setValidationResults] = useState<{ label: string; passed: boolean; detail?: string; action?: { label: string; onClick: () => void }; subItems?: { label: string; detail?: string; action?: { label: string; onClick: () => void } }[] }[]>([]);
  const [validationModalVisible, setValidationModalVisible] = useState(false);

  // Resolve account-combination descriptions for the distribution + accrual accounts on the lines.
  const lineAccountCodes = useMemo(() => {
    const s = new Set<string>();
    lines.forEach(l => { if (l.distributionCombination) s.add(l.distributionCombination); if (l.accrualAccount) s.add(l.accrualAccount); });
    return Array.from(s);
  }, [lines]);
  const lineAccountDescs = useAccountDescriptions(lineAccountCodes);

  // View Accounting modal
  const [accountingModalVisible, setAccountingModalVisible] = useState(false);
  const [resolvedAcctDescs, setResolvedAcctDescs] = useState<Record<string, string>>({});

  const openAccountingModal = useCallback(async () => {
    setAccountingModalVisible(true);
    // Collect all unique account codes from lines + liability distribution
    const liabilityDist = form.getFieldValue('liabilityDistribution') || '';
    const codes = new Set<string>();
    lines.forEach(l => {
      if (l.distributionCombination) codes.add(l.distributionCombination);
      if (l.accrualAccount)          codes.add(l.accrualAccount);
      if (l.taxAccountCombination)   codes.add(l.taxAccountCombination);
    });
    if (liabilityDist) codes.add(liabilityDist);
    const descMap: Record<string, string> = {};
    await Promise.all(Array.from(codes).map(async (code) => {
      try {
        const result = await validateAccountCode(code);
        const naturalValue = Object.values(result.segmentDetails).find(s =>
          s.name?.toLowerCase().includes('natural') || s.name?.toLowerCase().includes('account')
        )?.value || '';
        const desc = (naturalValue
          ? Object.values(result.segmentDetails).find(s => s.value === naturalValue)?.description
          : Object.values(result.segmentDetails).find(s => s.description)?.description) || '';
        if (desc) descMap[code] = desc;
      } catch { /* silent */ }
    }));
    setResolvedAcctDescs(descMap);
  }, [form, lines]);

  // SLA – Subledger Accounting state
  const [slaHeaderId, setSlaHeaderId]         = useState<number | null>(null);
  // Seed from initialData so locks are instant (fetchSlaHeader will confirm/override)
  const [slaStatus, setSlaStatus]             = useState<string | null>(initialData?.accountingStatus ?? null);
  // Cancellation reversal accounting
  const [cancelSlaHeaderId, setCancelSlaHeaderId] = useState<number | null>(null);
  const [cancelSlaLines,     setCancelSlaLines]    = useState<any[]>([]);
  const [cancelSlaStatus,    setCancelSlaStatus]   = useState<string | null>(null);
  const [slaPostingStatus, setSlaPostingStatus] = useState<string | null>(null);
  const [slaLines, setSlaLines]               = useState<any[]>([]);
  const [slaModalVisible, setSlaModalVisible] = useState(false);
  const [slaCreating, setSlaCreating]               = useState(false);
  const [slaPosting, setSlaPosting]                 = useState(false);
  const [cancelSlaPosting, setCancelSlaPosting]     = useState(false);
  const [cancelPostError,  setCancelPostError]      = useState<string | null>(null);
  const [cancelFlowDebug,  setCancelFlowDebug]      = useState<Array<{step: string; method: string; url: string; status?: number; request?: string; response?: string; ok?: boolean}>>([]);
  const [cancelFlowModalVisible, setCancelFlowModalVisible] = useState(false);
  const [slaFetching, setSlaFetching]               = useState(false);
  const [slaGlBatchId, setSlaGlBatchId]       = useState<number | null>(null);
  const [slaGlBatchName, setSlaGlBatchName]   = useState<string | null>(null);
  const [slaGlHeaderId, setSlaGlHeaderId]     = useState<number | null>(null);

  const [autoPostPending, setAutoPostPending] = useState(false);

  // SLA Debug Modal state
  const [slaDebugVisible, setSlaDebugVisible]       = useState(false);
  const [slaDebugPayload, setSlaDebugPayload]       = useState<any>(null);
  const [slaDebugSourceId, setSlaDebugSourceId]     = useState<number | null>(null);
  const [slaDebugGetResult, setSlaDebugGetResult]   = useState<any>(null);
  const [slaDebugPostResult, setSlaDebugPostResult] = useState<any>(null);
  const [slaDebugLoading, setSlaDebugLoading]       = useState<'get' | 'post' | null>(null);
  const [slaDebugTab, setSlaDebugTab]               = useState<string>('post');

  // BMS currency rate auto-fetch
  const [bmsRateLoading, setBmsRateLoading] = useState(false);
  const [bmsRate, setBmsRate] = useState<{ rate: number; inverseRate: number; rateType: string; rateDate: string } | null>(null);

  // Applied prepayment SLA – per-row accounting state (keyed by applicationId)
  const [appSlaMap, setAppSlaMap] = useState<Record<number, { headerId: number | null; status: string | null }>>({});
  const [appSlaLoadingId, setAppSlaLoadingId] = useState<number | null>(null);

  // SLA modal – tabs & per-section fetched full accounting results
  const [slaModalTab, setSlaModalTab]                   = useState<string>('invoice');
  const [appSlaData, setAppSlaData]                     = useState<Record<number, any>>({});   // full SlaGetResult per applicationId
  const [paymentSlaData, setPaymentSlaData]             = useState<Record<number, any>>({});   // full SlaGetResult per checkId
  const [slaModalPrepayLoading, setSlaModalPrepayLoading]   = useState(false);
  const [slaModalPaymentLoading, setSlaModalPaymentLoading] = useState(false);
  // GL payload debug modal
  const [glPayloadDebug, setGlPayloadDebug]             = useState<object | null>(null);
  const [glPayloadModalVisible, setGlPayloadModalVisible] = useState(false);
  // Debug GET tab – per-application accounting check results
  const [slaDebugGetPrepayResults, setSlaDebugGetPrepayResults] =
    useState<Record<number, { status: number; ok: boolean; data?: any; error?: string }>>({});
  const [slaDebugCheckingPrepay, setSlaDebugCheckingPrepay] = useState(false);

  // Import Lines modal
  const [importModalVisible, setImportModalVisible] = useState(false);
  // Pay in Full modal state
  const [payInFullOpen, setPayInFullOpen] = useState(false);
  const [payInFullApiDrawerOpen, setPayInFullApiDrawerOpen] = useState(false);
  const [payInFullBankAccounts, setPayInFullBankAccounts] = useState<{ bankAccountName: string; bankAccountNumber: string; currencyCode: string; legalEntityName: string; cashAccountCombination: string; pdcAccountCombination: string; cashClearingAccountCombination: string }[]>([]);
  const [payInFullBankLoading, setPayInFullBankLoading] = useState(false);
  const [payInFullSubmitting, setPayInFullSubmitting] = useState(false);
  const [step1CheckId, setStep1CheckId] = useState<number | null>(null);
  const [payInFullPdfUrl,  setPayInFullPdfUrl]  = useState<string | null>(null);
  const [payInFullPdfOpen, setPayInFullPdfOpen] = useState(false);
  const [stepResults, setStepResults] = useState<Record<number, { status: 'success' | 'error'; data: any }>>({});
  const [stepLoading, setStepLoading] = useState<Record<number, boolean>>({});
  // Incremented on every payInFullForm field change so the API drawer IIFE re-runs with fresh values
  const [payInFullTick, setPayInFullTick] = useState(0);
  // Step-by-step execution status for Pay in Full
  const [payInFullStepStatus, setPayInFullStepStatus] = useState<
    { step: number; label: string; status: 'idle' | 'running' | 'success' | 'error'; detail?: string }[]
  >([]);

  // Void Payment from invoice edit page
  const [ciVoidOpen, setCiVoidOpen]           = useState(false);
  const [ciVoidCheckId, setCiVoidCheckId]     = useState<number | null>(null);
  const [ciVoidPaymentInfo, setCiVoidPaymentInfo] = useState<{ number: string; paymentDate: string; paidAmount: number; currency: string } | null>(null);
  const [ciVoidEligibility, setCiVoidEligibility] = useState<{ eligible: boolean; errors: string[] } | null>(null);
  const [ciVoidEligLoading, setCiVoidEligLoading] = useState(false);
  const [ciVoidSubmitting, setCiVoidSubmitting]   = useState(false);
  const [ciVoidStepStatus, setCiVoidStepStatus]   = useState<
    { step: number; label: string; status: 'idle' | 'running' | 'success' | 'error'; detail?: string }[]
  >([]);

  const [installmentsModalOpen, setInstallmentsModalOpen] = useState(false);
  const [installmentsModalData, setInstallmentsModalData] = useState<any[]>([]);
  const [installmentsModalLoading, setInstallmentsModalLoading] = useState(false);
  const [installmentsModalUrl, setInstallmentsModalUrl] = useState('');

  // Installment editor — accessible via Invoice Actions → Manage Installments
  const [instEditVisible, setInstEditVisible] = useState(false);
  const [instEditRows, setInstEditRows]       = useState<InstallmentRow[]>([{
    key: '1', installmentNumber: 1, dueDate: null,
    grossAmount: 0, unpaidAmount: 0, paymentPriority: 99, paymentMethod: '', bankAccount: '',
  }]);
  const [instSelectedKey, setInstSelectedKey] = useState<string | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<{ type: string; amount: number; description: string }[]>([]);
  const [pasteText, setPasteText] = useState('');

  // Apply/Unapply Prepayments modal state
  const [prepaymentModalVisible, setPrepaymentModalVisible] = useState(false);
  const [availablePrepayments, setAvailablePrepayments] = useState<AvailablePrepayment[]>([]);
  const [appliedPrepaymentsList, setAppliedPrepaymentsList] = useState<AppliedPrepayment[]>([]);
  const [prepaymentLoading, setPrepaymentLoading] = useState(false);
  const [prepaymentApplying, setPrepaymentApplying] = useState(false);
  const [supplierHasPrepayments, setSupplierHasPrepayments] = useState(false);

  // Cancel Invoice modal state
  const [cancelModalOpen, setCancelModalOpen]     = useState(false);
  const [cancelEligLoading, setCancelEligLoading] = useState(false);
  const [cancelExecuting, setCancelExecuting]     = useState(false);
  const [cancelDone, setCancelDone]               = useState(false);
  const [cancelStep, setCancelStep]               = useState<'eligibility' | 'confirm'>('eligibility');
  const [cancelEligibility, setCancelEligibility] = useState<{
    eligible: boolean;
    invoiceNumber: string;
    invoiceType: string;
    paidStatus: string;
    invoiceAmount?: number;
    outstanding?: number;
    checks: { check: string; passed: boolean; detail?: string }[];
  } | null>(null);
  const [cancelApiExpanded, setCancelApiExpanded]   = useState(false);
  const [cancelApiTesting,  setCancelApiTesting]    = useState(false);
  const [cancelApiResult,   setCancelApiResult]     = useState<string | null>(null);
  const [cancelPostExpanded, setCancelPostExpanded] = useState(false);
  const [cancelPostTesting,  setCancelPostTesting]  = useState(false);
  const [cancelPostResult,   setCancelPostResult]   = useState<string | null>(null);
  const [selectedAvailKeys, setSelectedAvailKeys] = useState<React.Key[]>([]);

  // Un-apply modal state
  const [unapplyModalVisible, setUnapplyModalVisible] = useState(false);
  const [unapplyRecord, setUnapplyRecord] = useState<AppliedPrepayment | null>(null);
  const [unapplyDate, setUnapplyDate] = useState<dayjs.Dayjs>(dayjs());

  // Multiperiod schedule modal
  const [mpaModalOpen,    setMpaModalOpen]    = useState(false);
  const [mpaSchedule,     setMpaSchedule]     = useState<import('../../services/multiperiod.service').MpaScheduleLine[]>([]);
  const [mpaLoading,      setMpaLoading]      = useState(false);
  const [mpaTabSchedule,  setMpaTabSchedule]  = useState<import('../../services/multiperiod.service').MpaScheduleLine[]>([]);
  const [mpaTabChecked,   setMpaTabChecked]   = useState(false);
  const [mpaTabLoading,   setMpaTabLoading]   = useState(false);
  const [mpaTabGenerating,setMpaTabGenerating]= useState(false);
  const [mpaTabApiUrl,    setMpaTabApiUrl]    = useState('');
  const [mpaError,        setMpaError]        = useState<string | null>(null);
  const [mpaGenerating,   setMpaGenerating]   = useState(false);
  const [unapplyLoading, setUnapplyLoading] = useState(false);

  // Prepayment invoice view: balance + applied invoices
  const [prepaymentBalance, setPrepaymentBalance] = useState<PrepaymentBalance | null>(null);
  const [appliedInvoicesList, setAppliedInvoicesList] = useState<AppliedInvoice[]>([]);

  // Prepayment API Drawer state
  const [prepaymentAPIDrawerVisible, setPrepaymentAPIDrawerVisible] = useState(false);
  interface PrepaymentAPIResult {
    endpoint: string;
    url: string;
    loading: boolean;
    status: number | null;
    durationMs: number | null;
    data: any[] | null;
    error: string | null;
  }
  const [prepaymentAPIResults, setPrepaymentAPIResults] = useState<PrepaymentAPIResult[]>([]);

  // API Preview modal
  const [apiPreviewVisible, setApiPreviewVisible] = useState(false);
  const [apiPreviewData, setApiPreviewData] = useState<{ url: string; body: string; installmentUrl: string; installmentBody: string } | null>(null);
  // Live-execute results for each card in the preview modal
  const [apiExecInvoice, setApiExecInvoice]     = useState<{ loading: boolean; httpStatus: number; body: string } | null>(null);
  const [apiExecInstall, setApiExecInstall]     = useState<{ loading: boolean; httpStatus: number; body: string } | null>(null);

  // API Log (last request/response)
  const [apiLog, setApiLog] = useState<{ url: string; method: string; requestBody: string; responseBody: string; status: string; httpStatus: number; timestamp: string } | null>(null);
  // API Log history (all requests during session)
  const [apiLogHistory, setApiLogHistory] = useState<{ action: string; url: string; method: string; requestBody: string; responseBody: string; status: string; httpStatus: number; timestamp: string }[]>([]);
  const [apiLogHistoryVisible, setApiLogHistoryVisible] = useState(false);

  // Saved invoice state — tracks whether we're in create or update mode
  const [savedInvoiceId, setSavedInvoiceId] = useState<number | null>(initialData?.invoiceId || null);

  // Live status — refreshable without closing/reopening the invoice
  const [liveHoldPaidStatus,   setLiveHoldPaidStatus]   = useState(initialData?.holdPaidStatus   || '');
  const [liveValidationStatus, setLiveValidationStatus] = useState(initialData?.validationStatus || '');
  const [liveApprovalStatus,   setLiveApprovalStatus]   = useState(initialData?.approvalStatus   || '');
  const [statusRefreshing,     setStatusRefreshing]     = useState(false);
  const [refreshApiLog,        setRefreshApiLog]        = useState<{ label: string; url: string; status: number; response: string }[]>([]);
  const [refreshApiLogVisible, setRefreshApiLogVisible] = useState(false);

  const openPrepaymentAPIDrawer = useCallback(async () => {
    const supplierId = selectedSupplierInfo?.id || initialData?.supplierId || form.getFieldValue('supplierId');
    const invoiceId = savedInvoiceId ?? initialData?.invoiceId ?? null;
    if (!supplierId) { message.warning('Select a supplier first.'); return; }

    const endpoints: { endpoint: string; url: string }[] = [
      {
        endpoint: 'Available Prepayments',
        url: `${APEX_DB_CONFIG.baseUrl}/ap/prepayments/available?P_SUPPLIER_ID=${supplierId}`,
      },
      ...(invoiceId ? [
        {
          endpoint: 'Applied Prepayments (by Invoice)',
          url: `${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments?P_INVOICE_ID=${invoiceId}`,
        },
        {
          endpoint: 'Applied Prepayments (by-invoice REST)',
          url: `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/by-invoice/${invoiceId}`,
        },
      ] : []),
    ];

    setPrepaymentAPIResults(endpoints.map(e => ({ ...e, loading: true, status: null, durationMs: null, data: null, error: null })));
    setPrepaymentAPIDrawerVisible(true);

    endpoints.forEach(async (ep, idx) => {
      const t0 = performance.now();
      try {
        const res = await fetch(ep.url, { headers: { Accept: 'application/json' } });
        const durationMs = Math.round(performance.now() - t0);
        let data: any[] = [];
        if (res.ok) {
          const json = await res.json();
          data = json.items ?? json.prepayments ?? json.applied ?? (Array.isArray(json) ? json : []);
        }
        setPrepaymentAPIResults(prev => prev.map((r, i) =>
          i === idx ? { ...r, loading: false, status: res.status, durationMs, data, error: res.ok ? null : `HTTP ${res.status}` } : r
        ));
        if (idx === 0) {
          const invoiceAmt = form.getFieldValue('invoiceAmount') || 0;
          setSupplierHasPrepayments(data.length > 0);
          setAvailablePrepayments(data.map((item: any, index: number) => {
            const avail = Number(item.available_amount ?? 0);
            return {
              key: item.invoice_id?.toString() || index.toString(),
              invoiceId: Number(item.invoice_id ?? 0),
              invoiceNumber: item.invoice_number ?? '',
              description: item.description ?? '',
              supplierSite: item.supplier_site ?? '',
              purchaseOrder: item.purchase_order ?? '',
              currency: item.currency ?? '',
              availableAmount: avail,
              lineNumber: Number(item.line_number ?? 1),
              prepaymentLineNumber: Number(item.prepayment_line_number ?? 1),
              businessUnit: item.business_unit ?? '',
              toApply: invoiceAmt > 0 ? Math.min(avail, invoiceAmt) : 0,
              accountingDate: null,
            };
          }));
        }
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - t0);
        setPrepaymentAPIResults(prev => prev.map((r, i) =>
          i === idx ? { ...r, loading: false, status: 0, durationMs, data: [], error: String(err?.message ?? err) } : r
        ));
      }
    });
  }, [form, savedInvoiceId, initialData]);

  // Edit mode: determine if invoice is editable or read-only
  const isEditMode = Boolean(initialData?.invoiceId);
  const isPrepaymentInvoice = (initialData?.invoiceType || '').toLowerCase() === 'prepayment';
  const [isEditing, setIsEditing] = useState(false);
  const isInvoiceSynced = !!initialData?.isSynced;

  const { isReadOnly, isPermanentlyLocked, isPaid, isPostedToGL, isCancelled } = useMemo(() => {
    const hasId = !!(initialData?.invoiceId || savedInvoiceId);
    if (!hasId) return { isReadOnly: false, isPermanentlyLocked: false, isPaid: false, isPostedToGL: false, isCancelled: false };
    const status = (liveHoldPaidStatus || initialData?.holdPaidStatus || '').toLowerCase();
    const isPostedToGL = slaStatus === 'POSTED';
    const isCancelled = status === 'cancelled';
    const isPaid = status === 'fully paid' || status === 'paid' || status === 'available';
    const permanentlyLocked = isPaid || isCancelled || isPostedToGL;
    const ro = initialData?.isSynced ? true : (permanentlyLocked || !isEditing);
    return { isReadOnly: ro, isPermanentlyLocked: permanentlyLocked || !!initialData?.isSynced, isPaid, isPostedToGL, isCancelled };
  }, [initialData, isEditing, slaStatus, liveHoldPaidStatus, savedInvoiceId]);

  // True when applied prepayments fully cover the invoice amount
  const isPrepaymentFullyPaid = useMemo(() => {
    if (appliedPrepaymentsList.length === 0) return false;
    const totalApplied = appliedPrepaymentsList.reduce((s, r) => s + r.appliedAmount, 0);
    const invoiceAmt = headerValues.invoiceAmount || 0;
    return invoiceAmt > 0 && totalApplied >= invoiceAmt;
  }, [appliedPrepaymentsList, headerValues.invoiceAmount]);

  // Payments tab state (for edit mode)
  const [invoicePayments, setInvoicePayments] = useState<{ key: string; checkId: number; number: string; paymentDocument: string; status: string; reconciled: string; currentPayeeName: string; paymentDate: string; paidAmount: number; discountTaken: number; currency: string; address: string; remitToAccount: string }[]>([]);
  const [invoicePaymentsLoading, setInvoicePaymentsLoading] = useState(false);
  const [invoicePaymentsUrl, setInvoicePaymentsUrl] = useState('');

  // Invoice balance from API (edit mode)
  const [invoiceBalance, setInvoiceBalance] = useState<number | null>(null);
  const [invoiceBalanceLoading, setInvoiceBalanceLoading] = useState(false);

  // Holds tab state (for edit mode)
  const [invoiceHolds, setInvoiceHolds] = useState<{ key: string; holdName: string; holdReason: string; holdDate: string; heldBy: string; releaseDate: string; releasedBy: string }[]>([]);
  const [invoiceHoldsLoading, setInvoiceHoldsLoading] = useState(false);

  // Installments tab state (for edit mode)
  const [invoiceInstallments, setInvoiceInstallments] = useState<{ key: string; installmentNumber: number; dueDate: string; grossAmount: number; unpaidAmount: number; paymentPriority: number; paymentMethod: string; bankAccount: string }[]>([]);
  const [invoiceInstallmentsLoading, setInvoiceInstallmentsLoading] = useState(false);
  const [invoiceInstallmentsUrl, setInvoiceInstallmentsUrl] = useState('');

  // Fetch invoice payments (edit mode)
  const fetchInvoicePayments = useCallback(async (invoiceId: number) => {
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/payments?P_INVOICE_ID=${invoiceId}`;
    setInvoicePaymentsUrl(url);
    setInvoicePaymentsLoading(true);
    console.log('[Payments Tab] Fetching:', url);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      console.log('[Payments Tab] Raw response:', data);
      const items = data.items || (Array.isArray(data) ? data : []);
      setInvoicePayments(
        items.map((item: any, index: number) => ({
          key:              (item.id ?? index).toString(),
          checkId:          Number(item.id ?? item.check_id ?? 0),
          number:           (item.paper_document_number ?? item.id ?? '').toString(),
          paymentDocument:  item.invoice_number ?? '',
          status:           item.payment_status ?? '',
          reconciled:       item.reconciled_flag === 'Y' ? 'Yes' : item.reconciled_flag === 'N' ? 'No' : (item.reconciled_flag ?? ''),
          currentPayeeName: item.invoice_business_unit ?? '',
          paymentDate:      formatDateStr(item.payment_date ?? item.creation_date ?? ''),
          paidAmount:       Number(item.amount_paid_payment_currency ?? 0),
          discountTaken:    Number(item.discount_taken ?? item.DISCOUNT_TAKEN ?? item.DiscountTaken ?? 0),
          currency:         item.invoice_currency ?? '',
          address:          '',
          remitToAccount:   '',
        }))
      );
    } catch (error) {
      console.error('[Payments Tab] Error:', error);
    } finally {
      setInvoicePaymentsLoading(false);
    }
  }, []);

  // Fetch invoice balance from API (edit mode)
  const fetchInvoiceBalance = useCallback(async (invoiceId: number): Promise<number | null> => {
    setInvoiceBalanceLoading(true);
    try {
      // Use net-balance endpoint which deducts both cash payments and prepayment applications
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/net-balance`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const bal = data.netBalance ?? data.balance ?? null;
      setInvoiceBalance(bal);
      return bal;
    } catch (error) {
      console.error('[Invoice Balance] Error:', error);
      return null;
    } finally {
      setInvoiceBalanceLoading(false);
    }
  }, []);

  // Open void modal from invoice edit (Payments tab or Invoice Actions)
  const openInvoiceVoidModal = async (
    checkId: number,
    paymentInfo: { number: string; paymentDate: string; paidAmount: number; currency: string }
  ) => {
    setCiVoidCheckId(checkId);
    setCiVoidPaymentInfo(paymentInfo);
    setCiVoidEligibility(null);
    setCiVoidStepStatus([]);
    ciVoidForm.setFieldsValue({ voidDate: dayjs(), voidReason: '' });
    setCiVoidOpen(true);
    setCiVoidEligLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/payments/${checkId}/void-eligibility`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        setCiVoidEligibility({ eligible: false, errors: [`API returned HTTP ${res.status}`] });
      } else {
        const data = await res.json();
        setCiVoidEligibility({ ...data, errors: Array.isArray(data.errors) ? data.errors : [] });
      }
    } catch (e: any) {
      setCiVoidEligibility({ eligible: false, errors: [e?.message ?? 'Network error'] });
    } finally {
      setCiVoidEligLoading(false);
    }
  };

  const handleCiVoidSubmit = async (values: any) => {
    if (!ciVoidCheckId) return;
    const steps = [
      { step: 0, label: 'Re-check eligibility', status: 'idle' as const },
      { step: 1, label: 'Void payment',          status: 'idle' as const },
    ];
    setCiVoidStepStatus(steps);
    setCiVoidSubmitting(true);
    const setStep = (step: number, status: 'running' | 'success' | 'error', detail?: string) =>
      setCiVoidStepStatus(prev => prev.map(s => s.step === step ? { ...s, status, detail } : s));
    try {
      setStep(0, 'running');
      const eligRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/payments/${ciVoidCheckId}/void-eligibility`, { headers: { Accept: 'application/json' } });
      const eligData = eligRes.ok ? await eligRes.json() : { eligible: false, errors: [`HTTP ${eligRes.status}`] };
      if (!eligData.eligible) {
        setStep(0, 'error', (eligData.errors ?? [])[0] ?? 'Not eligible');
        message.error('Payment is not eligible for void');
        return;
      }
      setStep(0, 'success', 'Eligible for void');

      setStep(1, 'running');
      const voidBody = {
        CheckId:       ciVoidCheckId,
        VoidDate:      values.voidDate ? values.voidDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        VoidedBy:      null,
        StopReason:    values.voidReason || 'Payment Voided',
        StopReference: ciVoidPaymentInfo?.number ?? null,
      };
      const voidRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/payments/void`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(voidBody),
      });
      const voidData = await voidRes.json();
      if (voidData.status === 'error' || !voidRes.ok) {
        setStep(1, 'error', voidData.message ?? `HTTP ${voidRes.status}`);
        message.error('Void failed: ' + (voidData.message ?? 'Unknown error'));
        return;
      }
      setStep(1, 'success', `Voided — New balance: ${voidData.newBalance != null ? Number(voidData.newBalance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}`);
      message.success('Payment voided successfully');
      setTimeout(() => {
        setCiVoidOpen(false);
        ciVoidForm.resetFields();
        setCiVoidStepStatus([]);
        const invoiceId = savedInvoiceId || initialData?.invoiceId;
        if (invoiceId) {
          fetchInvoicePayments(invoiceId);
          fetchInvoiceBalance(invoiceId);
        }
      }, 1800);
    } finally {
      setCiVoidSubmitting(false);
    }
  };

  // ── SLA: fetch existing accounting status for this invoice ──────────────
  const fetchSlaHeader = useCallback(async (invoiceId: number) => {
    setSlaFetching(true);
    try {
      // ── 1. Invoice creation accounting ──────────────────────────────────
      const existsResult = await checkAccountingExists('AP_INVOICES', invoiceId, 'AP_INVOICE_CREATION');
      if (existsResult.exists && existsResult.headerId) {
        setSlaHeaderId(existsResult.headerId);
        setSlaStatus(existsResult.accountingStatus);
        setSlaPostingStatus(existsResult.postingStatus);
        // Fetch lines for the creation header specifically (not the most-recent catch-all)
        try {
          const linesData = await getLinesByHeaderId(existsResult.headerId);
          setSlaLines(linesData.items || []);
        } catch { /* non-critical */ }
        // Fetch GL batch IDs (only meaningful before cancellation; getAccounting returns most-recent)
        try {
          const fullData = await getAccounting('AP_INVOICES', invoiceId);
          if (fullData.found && fullData.headerId === existsResult.headerId) {
            setSlaGlBatchId(fullData.glBatchId ?? null);
            setSlaGlBatchName(fullData.glBatchName ?? null);
            setSlaGlHeaderId(fullData.glHeaderId ?? null);
          }
        } catch { /* non-critical */ }
      } else {
        setSlaHeaderId(null);
        setSlaStatus(null);
        setSlaPostingStatus(null);
        setSlaLines([]);
        setSlaGlBatchId(null);
        setSlaGlBatchName(null);
        setSlaGlHeaderId(null);
      }

      // ── 2. Cancellation reversal accounting (if any) ──────────────────
      try {
        const cancelResult = await checkAccountingExists('AP_INVOICES', invoiceId, 'INVOICE_CANCELLED');
        if (cancelResult.exists && cancelResult.headerId) {
          setCancelSlaHeaderId(cancelResult.headerId);
          setCancelSlaStatus(cancelResult.accountingStatus);
          const cancelLines = await getLinesByHeaderId(cancelResult.headerId);
          setCancelSlaLines(cancelLines.items || []);
        } else {
          setCancelSlaHeaderId(null);
          setCancelSlaStatus(null);
          setCancelSlaLines([]);
        }
      } catch { /* non-critical — cancellation accounting is optional */ }

    } catch { /* silent */ }
    finally {
      setSlaFetching(false);
    }
  }, []);

  // ── Applied Prepayment SLA: load per-row accounting status ───────────────
  const loadAppSlaStatuses = useCallback(async (applications: AppliedPrepayment[]) => {
    if (!Array.isArray(applications) || applications.length === 0) return;
    const results = await Promise.all(
      applications.map(async (a) => {
        try {
          const r = await checkAccountingExists('RR_AP_APPLIED_PREPAYMENTS', a.applicationId, 'PREPAYMENT_APPLIED');
          return { id: a.applicationId, headerId: r.exists ? (r.headerId ?? null) : null, status: r.exists ? (r.accountingStatus ?? null) : null };
        } catch {
          return { id: a.applicationId, headerId: null, status: null };
        }
      })
    );
    setAppSlaMap(prev => {
      const updated = { ...prev };
      results.forEach(r => { updated[r.id] = { headerId: r.headerId, status: r.status }; });
      return updated;
    });
  }, []);

  // ── SLA: build flat DR/CR lines from current invoice ────────────────────
  const buildSlaLines = useCallback(() => {
    const liabilityDist = form.getFieldValue('liabilityDistribution') || '';
    const currency = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
    const exchangeRate = Number(headerValues.conversionRate || form.getFieldValue('conversionRate') || 1);
    const supplierId = Number(form.getFieldValue('supplierId')) || null;
    const invoiceType = form.getFieldValue('invoiceType') || '';
    const isCreditMemo = invoiceType === 'Credit Memo';
    const activeLines = lines.filter(l => Math.abs(l.amount || 0) > 0);
    const result: any[] = [];
    let lineNum = 1;

    activeLines.forEach((l) => {
      const amt = Math.abs(l.amount || 0);
      // Multi-period: use accrual account for DR whenever line has one set
      const isMpa = !!l.accrualAccount;
      const drAccount = isMpa
        ? l.accrualAccount
        : (l.distributionCombination || l.distributionSet || '');
      // DR line (for credit memo this becomes CR)
      result.push({
        lineNumber: lineNum++,
        lineType: isCreditMemo ? 'CR' : 'DR',
        accountingClass: isMpa ? 'ACCRUAL' : 'EXPENSE',
        accountCombination: drAccount,
        enteredDr:   isCreditMemo ? 0   : amt,
        enteredCr:   isCreditMemo ? amt : 0,
        accountedDr: isCreditMemo ? 0   : amt * exchangeRate,
        accountedCr: isCreditMemo ? amt * exchangeRate : 0,
        currencyCode: currency,
        exchangeRate,
        description: l.description || `Line ${l.lineNumber} – ${l.type || 'Item'}`,
        sourceLineId: l.id || null,
        sourceLineNumber: l.lineNumber,
        partyId: supplierId || null,
        partyType: 'SUPPLIER',
      });
      // Tax line (DR in standard, CR in credit memo)
      const taxRate = taxRateMapRef.current[l.taxClassification] ?? getTaxRateForClassification(l.taxClassification);
      if (taxRate > 0) {
        const taxAmt = Math.round(amt * taxRate / 100 * 100) / 100;
        const taxAcct = l.taxAccountCombination || taxAccountMapRef.current[l.taxClassification] || 'Tax Recoverable';
        result.push({
          lineNumber: lineNum++,
          lineType: isCreditMemo ? 'CR' : 'DR',
          accountingClass: 'TAX',
          accountCombination: taxAcct,
          enteredDr:   isCreditMemo ? 0       : taxAmt,
          enteredCr:   isCreditMemo ? taxAmt  : 0,
          accountedDr: isCreditMemo ? 0       : taxAmt,
          accountedCr: isCreditMemo ? taxAmt  : 0,
          currencyCode: currency,
          exchangeRate,
          description: `Input VAT – ${l.taxClassification || ''}`,
          sourceLineNumber: l.lineNumber,
        });
      }
    });

    // Single summed Liability line: CR for standard invoice, DR for credit memo
    const totalLiability = Math.round(
      activeLines.reduce((sum, l) => {
        const amt = Math.abs(l.amount || 0);
        const taxRate = taxRateMapRef.current[l.taxClassification] ?? getTaxRateForClassification(l.taxClassification);
        const taxAmt  = taxRate > 0 ? Math.round(amt * taxRate / 100 * 100) / 100 : 0;
        return sum + amt + taxAmt;
      }, 0) * 100
    ) / 100;

    if (totalLiability > 0) {
      result.push({
        lineNumber: lineNum++,
        lineType: isCreditMemo ? 'DR' : 'CR',
        accountingClass: 'LIABILITY',
        accountCombination: liabilityDist,
        enteredDr:   isCreditMemo ? totalLiability : 0,
        enteredCr:   isCreditMemo ? 0 : totalLiability,
        accountedDr: isCreditMemo ? totalLiability * exchangeRate : 0,
        accountedCr: isCreditMemo ? 0 : totalLiability * exchangeRate,
        currencyCode: currency,
        exchangeRate,
        description: 'AP Liability',
        partyId: supplierId || null,
        partyType: 'SUPPLIER',
      });
    }

    return result;
  }, [form, lines, headerValues]);

  // ── Journal period/date source of truth ──────────────────────────────────
  // Header Accounting Date first, Invoice Date as fallback. Returns null when
  // neither is usable — callers must ABORT with an error instead of silently
  // booking to today's period (the cause of Aug-period journals on Jul invoices).
  const resolveAcctPeriod = useCallback((): { acctDate: string; periodName: string } | null => {
    const raw = form.getFieldValue('accountingDate') || form.getFieldValue('invoiceDate');
    const dj  = raw ? dayjs(raw) : null;
    if (!dj || !dj.isValid()) return null;
    return { acctDate: dj.format('YYYY-MM-DD'), periodName: dj.format('MMM-YY') };
  }, [form]);

  // ── SLA: Create Accounting ───────────────────────────────────────────────
  const handleCreateAccounting = useCallback(async () => {
    const invoiceId = savedInvoiceId || initialData?.invoiceId;
    if (!invoiceId) { message.warning('Save the invoice first before creating accounting.'); return; }
    if (slaStatus === 'POSTED') { message.warning('Accounting is already posted and locked.'); return; }

    const invoiceNumber = form.getFieldValue('invoiceNumber');
    const currency      = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
    const bu            = form.getFieldValue('businessUnit') || '';
    // Period/date from Accounting Date (fallback Invoice Date) — never today
    const resolved = resolveAcctPeriod();
    if (!resolved) { message.error('Accounting/Invoice date is missing — save the invoice with a date before creating accounting.'); return; }
    const { acctDate, periodName } = resolved;

    const slaLines_ = buildSlaLines();
    if (slaLines_.length === 0) { message.warning('No invoice lines with amounts to account.'); return; }

    const ledgerInfo = await fetchLedgerByBusinessUnit(bu);

    const payload = {
      header: {
        moduleName:       'AP',
        sourceTable:      'AP_INVOICES',
        sourceId:         invoiceId,
        sourceNumber:     invoiceNumber,
        sourceType:       form.getFieldValue('invoiceType') || 'STANDARD',
        eventTypeCode:    'AP_INVOICE_CREATION',
        eventDate:        acctDate,
        accountingDate:   acctDate,
        periodName,
        ledgerId:         ledgerInfo?.ledgerId  ?? 300000003259529,
        ledgerName:       ledgerInfo?.ledgerName ?? 'BCL DIFC',
        currencyCode:     currency,
        ledgerCurrency:   'AED',
        exchangeRate:     1,
        exchangeRateType: 'Corporate',
        businessUnit:     bu,
        description:      `AP Invoice ${invoiceNumber}`,
        createdBy:        'user',
      },
      lines: slaLines_,
    };

    // Execute directly — no debug modal
    setSlaDebugPayload(payload);
    setSlaDebugSourceId(invoiceId);
    setSlaCreating(true);
    try {
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { message.error(`Create accounting failed: HTTP ${res.status}`); return; }
      const headerId = data.headerId || data.header_id || null;
      setSlaHeaderId(headerId);
      setSlaStatus('DRAFT');
      setSlaPostingStatus('UNPOSTED');
      setSlaLines(payload.lines || []);

      // Auto-create SLA for any applied prepayments that don't have accounting yet
      const pending = appliedPrepaymentsList.filter(r => !appSlaMap[r.applicationId]?.status);
      if (pending.length > 0) {
        const liabilityDist = form.getFieldValue('liabilityDistribution') || '';
        const firstSeg      = liabilityDist.split('-')[0] || '';
        const prepaymentDist = firstSeg ? `${firstSeg}-00-00-1223108-0000-000-00-000-000` : '';
        const currency_     = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
        const supplierId    = Number(form.getFieldValue('supplierId')) || null;
        const ledgerInfo    = await fetchLedgerByBusinessUnit(bu);
        let created = 0;
        await Promise.all(pending.map(async (record) => {
          try {
            // Application accounting date first; invoice accounting date as
            // fallback — never today's date.
            const dj_ = dayjs(record.applicationAccountingDate || acctDate);
            if (!dj_.isValid()) return;
            const acctDate_   = dj_.format('YYYY-MM-DD');
            const periodName_ = dj_.format('MMM-YY');
            const slaPayload_ = {
              header: { moduleName: 'AP', sourceTable: 'RR_AP_APPLIED_PREPAYMENTS', sourceId: record.applicationId,
                sourceNumber: record.prepaymentNumber, sourceType: 'APPLIED', eventTypeCode: 'PREPAYMENT_APPLIED',
                eventDate: acctDate_, accountingDate: acctDate_, periodName: periodName_,
                ledgerId: ledgerInfo?.ledgerId ?? 300000003259529, ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC',
                currencyCode: record.currency || currency_, ledgerCurrency: 'AED', exchangeRate: 1, exchangeRateType: 'Corporate',
                businessUnit: bu, description: `Prepayment Applied – ${record.prepaymentNumber} on ${invoiceNumber}`, createdBy: 'user',
                supplierId },
              lines: [
                { lineNumber: 1, lineType: 'DR', accountingClass: 'LIABILITY', accountCombination: liabilityDist,
                  enteredDr: record.appliedAmount, enteredCr: 0, accountedDr: record.appliedAmount, accountedCr: 0,
                  currencyCode: record.currency || currency_, description: `Prepayment Apply – ${record.prepaymentNumber}` },
                { lineNumber: 2, lineType: 'CR', accountingClass: 'PREPAYMENT', accountCombination: prepaymentDist,
                  enteredDr: 0, enteredCr: record.appliedAmount, accountedDr: 0, accountedCr: record.appliedAmount,
                  currencyCode: record.currency || currency_, description: `Prepayment Apply – ${record.prepaymentNumber}` },
              ],
            };
            const r_ = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(slaPayload_) });
            const slaResp_ = await r_.json();
            if (r_.ok && slaResp_.headerId) {
              setAppSlaMap(prev => ({ ...prev, [record.applicationId]: { headerId: slaResp_.headerId, status: 'DRAFT' } }));
              created++;
            }
          } catch { /* non-fatal */ }
        }));
        if (created > 0) message.info(`Also created SLA journals for ${created} prepayment application(s).`);
      }

      // Trigger GL posting on next render (after slaHeaderId state is applied)
      setAutoPostPending(true);
    } catch (err: any) {
      message.error(`Failed to create accounting: ${err.message}`);
    } finally {
      setSlaCreating(false);
    }
  }, [savedInvoiceId, initialData, form, headerValues, lines, buildSlaLines, slaStatus, appliedPrepaymentsList, appSlaMap, setAppSlaMap, fetchLedgerByBusinessUnit]);

  // ── SLA Debug: Execute POST ───────────────────────────────────────────────
  const handleDebugPost = useCallback(async () => {
    if (!slaDebugPayload) return;
    setSlaDebugLoading('post');
    const url = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`;
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(slaDebugPayload),
      });
      const data = await res.json();
      setSlaDebugPostResult({ status: res.status, ok: res.ok, data });
      if (res.ok) {
        const headerId = data.headerId || data.header_id || null;
        setSlaHeaderId(headerId);
        setSlaStatus('DRAFT');
        setSlaPostingStatus('UNPOSTED');
        setSlaLines(slaDebugPayload.lines || []);
        message.success(`Accounting created (Header ID: ${headerId}) — ${(slaDebugPayload.lines || []).length} lines`);
        // Close debug modal and show accounting lines modal
        setSlaDebugVisible(false);
        setSlaModalVisible(true);

        // ── Auto-create SLA for any applied prepayments that don't have accounting yet ──
        const pending = appliedPrepaymentsList.filter(r => !appSlaMap[r.applicationId]?.status);
        if (pending.length > 0) {
          const invoiceId     = savedInvoiceId || initialData?.invoiceId;
          const invoiceNumber = form.getFieldValue('invoiceNumber');
          const bu            = form.getFieldValue('businessUnit') || '';
          const liabilityDist = form.getFieldValue('liabilityDistribution') || '';
          const firstSeg      = liabilityDist.split('-')[0] || '';
          const prepaymentDist = firstSeg ? `${firstSeg}-00-00-1223108-0000-000-00-000-000` : '';
          const currency      = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
          const supplierId    = Number(form.getFieldValue('supplierId')) || null;
          const ledgerInfo    = await fetchLedgerByBusinessUnit(bu);
          let created = 0;
          await Promise.all(pending.map(async (record) => {
            try {
              // Application accounting date first; invoice accounting date as
              // fallback — never today's date.
              const djApp_ = dayjs(record.applicationAccountingDate || resolveAcctPeriod()?.acctDate);
              if (!djApp_.isValid()) return;
              const acctDate_   = djApp_.format('YYYY-MM-DD');
              const periodName_ = djApp_.format('MMM-YY');

              const slaPayload = {
                header: {
                  moduleName:       'AP',
                  sourceTable:      'RR_AP_APPLIED_PREPAYMENTS',
                  sourceId:         record.applicationId,
                  sourceNumber:     record.prepaymentNumber,
                  sourceType:       'APPLIED',
                  eventTypeCode:    'PREPAYMENT_APPLIED',
                  eventDate:        acctDate_,
                  accountingDate:   acctDate_,
                  periodName:       periodName_,
                  ledgerId:         ledgerInfo?.ledgerId  ?? 300000003259529,
                  ledgerName:       ledgerInfo?.ledgerName ?? 'BCL DIFC',
                  currencyCode:     record.currency || currency,
                  ledgerCurrency:   'AED',
                  exchangeRate:     1,
                  exchangeRateType: 'Corporate',
                  businessUnit:     bu,
                  description:      `Prepayment Applied – ${record.prepaymentNumber} on Invoice ${invoiceNumber}`,
                  createdBy:        'user',
                },
                lines: [
                  {
                    lineNumber: 1, lineType: 'DR', accountingClass: 'LIABILITY',
                    accountCombination: liabilityDist,
                    enteredDr: record.appliedAmount, enteredCr: 0,
                    accountedDr: record.appliedAmount, accountedCr: 0,
                    currencyCode: record.currency || currency, exchangeRate: 1,
                    description: `AP Liability Reduced – Invoice ${invoiceNumber}`,
                    partyId: supplierId, partyType: 'SUPPLIER',
                  },
                  {
                    lineNumber: 2, lineType: 'CR', accountingClass: 'PREPAYMENT',
                    accountCombination: prepaymentDist,
                    enteredDr: 0, enteredCr: record.appliedAmount,
                    accountedDr: 0, accountedCr: record.appliedAmount,
                    currencyCode: record.currency || currency, exchangeRate: 1,
                    description: `Prepayment Asset Cleared – ${record.prepaymentNumber}`,
                    partyId: supplierId, partyType: 'SUPPLIER',
                  },
                ],
              };

              const appRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(slaPayload),
              });
              if (appRes.ok) {
                const appData = await appRes.json();
                const newHeaderId = appData.headerId || appData.header_id || null;
                setAppSlaMap(prev => ({
                  ...prev,
                  [record.applicationId]: { headerId: newHeaderId, status: 'DRAFT' },
                }));
                created++;
              }
            } catch { /* non-fatal */ }
          }));
          if (created > 0) message.info(`Also created SLA journals for ${created} prepayment application(s).`);
        }
      } else {
        message.error(`Create accounting failed: HTTP ${res.status}`);
      }
    } catch (err: any) {
      setSlaDebugPostResult({ status: 0, ok: false, error: err.message });
      message.error(`Failed: ${err.message}`);
    } finally {
      setSlaDebugLoading(null);
    }
  }, [slaDebugPayload, appliedPrepaymentsList, appSlaMap, savedInvoiceId, initialData, form, setAppSlaMap]);

  // ── SLA Debug: Execute GET ────────────────────────────────────────────────
  const handleDebugGet = useCallback(async () => {
    if (!slaDebugSourceId) return;
    setSlaDebugLoading('get');
    const url = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=${slaDebugSourceId}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setSlaDebugGetResult({ status: res.status, ok: res.ok, data });
    } catch (err: any) {
      setSlaDebugGetResult({ status: 0, ok: false, error: err.message });
    } finally {
      setSlaDebugLoading(null);
    }
  }, [slaDebugSourceId]);

  // ── SLA Modal: tab-change – lazy-load prepayment / payment accounting data ──
  const handleSlaModalTabChange = useCallback(async (key: string) => {
    setSlaModalTab(key);

    if (key === 'prepayments' && appliedPrepaymentsList.length > 0) {
      const missing = appliedPrepaymentsList.filter(r => !appSlaData[r.applicationId]);
      if (missing.length === 0) return;
      setSlaModalPrepayLoading(true);
      await Promise.all(missing.map(async (record) => {
        try {
          let result = await getAccounting('RR_AP_APPLIED_PREPAYMENTS', record.applicationId);
          // Fallback: if lines empty but headerId known, fetch via journals/lines directly
          if ((!result.lines || result.lines.length === 0) && (result.headerId || appSlaMap[record.applicationId]?.headerId)) {
            const hId = result.headerId ?? appSlaMap[record.applicationId]?.headerId;
            const res  = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${hId}&limit=500`, { headers: { Accept: 'application/json' } });
            if (res.ok) {
              const jData = await res.json();
              result = { ...result, lines: jData.lines || jData.items || jData || [] };
            }
          }
          setAppSlaData(prev => ({ ...prev, [record.applicationId]: result }));
        } catch { /* non-fatal */ }
      }));
      setSlaModalPrepayLoading(false);
    }

    if (key === 'payment' && invoicePayments.length > 0) {
      const missing = invoicePayments.filter(p => !paymentSlaData[p.checkId]);
      if (missing.length === 0) return;
      setSlaModalPaymentLoading(true);
      await Promise.all(missing.map(async (p) => {
        try {
          let result = await getAccounting('AP_PAYMENTS', p.checkId);
          // Fallback via headerId if lines empty
          if ((!result.lines || result.lines.length === 0) && result.headerId) {
            const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${result.headerId}&limit=500`, { headers: { Accept: 'application/json' } });
            if (res.ok) {
              const jData = await res.json();
              result = { ...result, lines: jData.lines || jData.items || jData || [] };
            }
          }
          setPaymentSlaData(prev => ({ ...prev, [p.checkId]: result }));
        } catch { /* non-fatal */ }
      }));
      setSlaModalPaymentLoading(false);
    }
  }, [appliedPrepaymentsList, invoicePayments, appSlaData, paymentSlaData, appSlaMap]);

  // ── SLA: Post to Ledger ──────────────────────────────────────────────────
  const handlePostToLedger = useCallback(async () => {
    if (!slaHeaderId) { message.warning('Create Accounting first.'); return; }
    if (slaStatus === 'POSTED') { message.warning('Already posted and locked.'); return; }

    setSlaPosting(true);
    try {
      const currency       = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
      const invoiceNumber  = form.getFieldValue('invoiceNumber');
      const bu             = form.getFieldValue('businessUnit') || '';
      const conversionRate = Number(headerValues.conversionRate || form.getFieldValue('conversionRate') || 1);
      // Period/date from Accounting Date (fallback Invoice Date) — never today
      const resolved = resolveAcctPeriod();
      if (!resolved) {
        message.error('Accounting/Invoice date is missing — cannot post to GL.');
        setSlaPosting(false);
        return;
      }
      const { acctDate, periodName } = resolved;

      // Validate period format: must be Mon-YY (e.g. Apr-26)
      if (!/^[A-Z][a-z]{2}-\d{2}$/.test(periodName)) {
        message.error(`Invalid accounting period "${periodName}". Expected format: Mon-YY (e.g. Apr-26). Check the invoice date.`);
        setSlaPosting(false);
        return;
      }

      // Fetch lines via sla/accounting (filtered by sourceId) — same approach as ManagePayments
      const invoiceId = savedInvoiceId || initialData?.invoiceId;
      const fullData  = await getAccounting('AP_INVOICES', invoiceId!);
      const fetchedLines: any[] = fullData.lines || [];
      if (fetchedLines.length === 0) throw new Error('No SLA lines found for this accounting header.');

      const [ledgerInfo] = await Promise.all([fetchLedgerByBusinessUnit(bu)]);
      const resolvedLedgerName = ledgerInfo?.ledgerName ?? 'BCL DIFC';
      const resolvedLedgerId   = ledgerInfo?.ledgerId   ?? 0;

      const totalDr = fetchedLines.reduce((s: number, l: any) => s + (l.enteredDr || 0), 0);
      const totalCr = fetchedLines.reduce((s: number, l: any) => s + (l.enteredCr || 0), 0);
      const batchName = `AP-${invoiceNumber}-${dayjs().format('YYYYMMDD-HHmmss')}`;

      // Build journal payload matching ManageSLAJournals buildGLPayload structure
      const journalPayload = {
        batch: {
          batchName,
          batchDescription:  `AP Invoice ${invoiceNumber} – Posted from SLA`,
          ledgerName:        resolvedLedgerName,
          ledgerId:          resolvedLedgerId,
          status:            'NEW',
          accountingPeriod:  periodName,
          controlTotal:      totalDr,
          runningTotalDr:    totalDr,
          runningTotalCr:    totalCr,
          batchSource:       'Payables',
          createdBy:         'user',
        },
        header: {
          ledgerId:               resolvedLedgerId,
          ledgerName:             resolvedLedgerName,
          jeCategory:             'Purchase Invoices',
          jeSource:               'Payables',
          periodName,
          journalName:            `AP Invoice ${invoiceNumber}`,
          description:            `Subledger accounting – Invoice ${invoiceNumber}`,
          currencyCode:           currency,
          currencyConversionType: 'User',
          currencyConversionDate: acctDate,
          currencyConversionRate: conversionRate,
          defaultEffectiveDate:   acctDate,
          status:                 'NEW',
          runningTotalDr:         totalDr,
          runningTotalCr:         totalCr,
          createdBy:              'user',
        },
        lines: fetchedLines.map((l: any) => {
          const eDr = l.lineType === 'DR' ? (l.enteredDr || null) : null;
          const eCr = l.lineType === 'CR' ? (l.enteredCr || null) : null;
          return {
          enteredDr:                eDr,
          enteredCr:                eCr,
          accountedDr:              eDr != null ? Math.round(eDr * conversionRate * 100) / 100 : null,
          accountedCr:              eCr != null ? Math.round(eCr * conversionRate * 100) / 100 : null,
          statAmount:               null,
          description:              l.description || '',
          currencyCode:             l.currencyCode || currency,
          currencyConversionDate:   l.accountingDate || acctDate,
          currencyConversionRate:   conversionRate,
          userCurrencyConversionType: 'User',
          accountCombination:       l.accountCombination || '',
          chartOfAccountsName:      'Chart of Accounts',
          reference1:               invoiceNumber,
          reference2:               String(savedInvoiceId || initialData?.invoiceId || ''),
          reference3:               l.accountingClass || null,
          reference4:               bu || null,
          reference5:               'AP-INVOICE-CREATION',
          createdBy:                'user',
        };
        }),
      };

      // Init debug log — updated at each step
      const debugLog: { step: string; method: string; url: string; requestBody?: any; status?: number; response?: any }[] = [];
      setGlPayloadDebug({ steps: debugLog });

      // ── Idempotency check: abort if journal already exists in GL ─────────────
      const invoiceIdStr = String(savedInvoiceId || initialData?.invoiceId || '');
      debugLog[0] = { step: '0 — Duplicate check (GL exists?)', method: 'GET', url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/check?reference1=${invoiceNumber}&reference2=${invoiceIdStr}&reference5=AP-INVOICE-CREATION` };
      setGlPayloadDebug({ steps: [...debugLog] });
      const glExists = await checkGLJournalExists(invoiceNumber, invoiceIdStr, 'AP-INVOICE-CREATION');
      debugLog[0].status   = 200;
      debugLog[0].response = glExists;
      setGlPayloadDebug({ steps: [...debugLog] });

      if (glExists.exists) {
        // Journal already in GL — warn user and reuse existing batchId
        const existingBatchId   = glExists.batchId;
        const existingBatchName = batchName;
        message.warning(`GL journal already exists for this invoice (Batch #${existingBatchId}). Reusing existing journal — no duplicate will be created.`);

        if (glExists.status === 'P') {
          // Already posted — just stamp SLA and finish
          const slaPostUrl  = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`;
          const slaPostBody = { headerId: slaHeaderId, postedBy: 'user', glBatchId: existingBatchId, glBatchName: existingBatchName, glHeaderId: glExists.headerId };
          await fetch(slaPostUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slaPostBody) });
          setSlaStatus('POSTED');
          setSlaPostingStatus('POSTED');
          setIsEditing(false);
          message.success('GL journal already posted. SLA header updated.');
          return;
        }
        // Exists but not yet posted — run POST validation step only
        debugLog[1] = { step: '1 — Create Journal (SKIPPED — already exists)', method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/journals/create`, response: { skipped: true, reason: 'Journal already exists', batchId: existingBatchId } };
        debugLog[1].status = 200;
        setGlPayloadDebug({ steps: [...debugLog] });

        // Jump straight to step 2 using existing batch
        const postGlUrl2  = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${existingBatchId}/post`;
        debugLog[2] = { step: '2 — Post to GL (existing batch)', method: 'PUT', url: postGlUrl2 };
        setGlPayloadDebug({ steps: [...debugLog] });
        const postGlRes2  = await fetch(postGlUrl2, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
        const postGlData2 = await postGlRes2.json().catch(() => ({}));
        debugLog[2].status = postGlRes2.status; debugLog[2].response = postGlData2;
        setGlPayloadDebug({ steps: [...debugLog] });
        if (!postGlRes2.ok || postGlData2?.success === false) {
          const err2 = Array.isArray(postGlData2?.errors) && postGlData2.errors.length > 0 ? postGlData2.errors[0] : postGlData2?.error || `HTTP ${postGlRes2.status}`;
          setSlaStatus('ERROR');
          throw new Error(`GL posting failed: ${err2}`);
        }
        const slaPostUrl2  = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`;
        const slaPostBody2 = { headerId: slaHeaderId, postedBy: 'user', glBatchId: existingBatchId, glBatchName: existingBatchName, glHeaderId: glExists.headerId };
        debugLog[3] = { step: '3 — Stamp GL IDs on SLA header', method: 'POST', url: slaPostUrl2, requestBody: slaPostBody2 };
        setGlPayloadDebug({ steps: [...debugLog] });
        const slaRes2 = await fetch(slaPostUrl2, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slaPostBody2) });
        const slaDat2 = await slaRes2.json().catch(() => ({}));
        debugLog[3].status = slaRes2.status; debugLog[3].response = slaDat2;
        setGlPayloadDebug({ steps: [...debugLog] });
        setSlaStatus('POSTED'); setSlaPostingStatus('POSTED'); setIsEditing(false);
        message.success('Posted to General Ledger successfully.');
        return;
      }

      // Step 1 — POST to journals/create
      const glUrl = `${APEX_DB_CONFIG.baseUrl}/journals/create`;
      debugLog[1] = { step: '1 — Create Journal', method: 'POST', url: glUrl, requestBody: journalPayload };
      setGlPayloadDebug({ steps: [...debugLog] });

      const glRes = await fetch(glUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(journalPayload),
      });
      const glData = await glRes.json().catch(() => ({}));
      debugLog[1].status   = glRes.status;
      debugLog[1].response = glData;
      setGlPayloadDebug({ steps: [...debugLog] });

      if (!glRes.ok) {
        await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headerId: slaHeaderId, errorMessage: `HTTP ${glRes.status}: ${glData?.message || ''}`, postedBy: 'user' }),
        });
        setSlaStatus('ERROR');
        throw new Error(`GL journal creation failed: HTTP ${glRes.status} – ${glData?.message || JSON.stringify(glData)}`);
      }

      // journals/create returns jeBatchId / jeHeaderId / batchName
      const glBatchId   = glData.jeBatchId  ?? glData.je_batch_id  ?? glData.batchId  ?? glData.batch_id  ?? null;
      const glHeaderId  = glData.jeHeaderId ?? glData.je_header_id ?? glData.headerId ?? glData.header_id ?? null;
      const glBatchName = glData.batchName  ?? glData.batch_name   ?? batchName;

      // Step 2 — PUT to RR_POST_JOURNAL (validates period format, period open, balance, accounts)
      if (glBatchId) {
        const postGlUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${glBatchId}/post`;
        debugLog[2] = { step: '2 — Post to GL (RR_POST_JOURNAL)', method: 'PUT', url: postGlUrl };
        setGlPayloadDebug({ steps: [...debugLog] });

        const postGlRes  = await fetch(postGlUrl, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    '{}',
        });
        const postGlData = await postGlRes.json().catch(() => ({}));
        debugLog[2].status   = postGlRes.status;
        debugLog[2].response = postGlData;
        setGlPayloadDebug({ steps: [...debugLog] });

        if (!postGlRes.ok || postGlData?.success === false) {
          const firstError = Array.isArray(postGlData?.errors) && postGlData.errors.length > 0
            ? postGlData.errors[0]
            : postGlData?.error || `HTTP ${postGlRes.status}`;
          await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/error`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headerId: slaHeaderId, errorMessage: firstError, postedBy: 'user' }),
          });
          setSlaStatus('ERROR');
          throw new Error(`GL posting failed: ${firstError}`);
        }
      } else {
        debugLog[2] = { step: '2 — Post to GL (SKIPPED — no batchId in step 1 response)', method: 'PUT', url: 'n/a', response: glData };
        setGlPayloadDebug({ steps: [...debugLog] });
      }

      // Step 3 — stamp GL IDs back on the SLA header
      const slaPostUrl  = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`;
      const slaPostBody = { headerId: slaHeaderId, postedBy: 'user', glBatchId, glBatchName, glHeaderId };
      debugLog[3] = { step: '3 — Stamp GL IDs on SLA header', method: 'POST', url: slaPostUrl, requestBody: slaPostBody };
      setGlPayloadDebug({ steps: [...debugLog] });

      if (glBatchId || glHeaderId) {
        const postRes  = await fetch(slaPostUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify(slaPostBody),
        });
        const postData = await postRes.json().catch(() => ({}));
        debugLog[3].status   = postRes.status;
        debugLog[3].response = postData;
        setGlPayloadDebug({ steps: [...debugLog] });
        if (!postRes.ok) throw new Error(`SLA post update failed: ${JSON.stringify(postData)}`);
      }

      setSlaStatus('POSTED');
      setSlaPostingStatus('POSTED');
      setSlaGlBatchId(glBatchId);
      setSlaGlBatchName(glBatchName);
      setSlaGlHeaderId(glHeaderId);
      setSlaLines(fetchedLines);
      setIsEditing(false);   // lock the form — posted accounting cannot be changed
      message.success('Posted to General Ledger successfully. Accounting is now locked.');

      // ── Auto-post any applied prepayment SLAs that are in DRAFT ──
      const draftApps = appliedPrepaymentsList.filter(r => appSlaMap[r.applicationId]?.status === 'DRAFT');
      if (draftApps.length > 0) {
        const bu = form.getFieldValue('businessUnit') || '';
        let posted = 0;
        await Promise.all(draftApps.map(async (record) => {
          const appSlaInfo = appSlaMap[record.applicationId];
          if (!appSlaInfo?.headerId) return;
          try {
            const currency   = record.currency;
            // Application accounting date first; invoice accounting date as
            // fallback — never today's date.
            const djApp = dayjs(record.applicationAccountingDate || resolveAcctPeriod()?.acctDate);
            if (!djApp.isValid()) return;
            const acctDate    = djApp.format('YYYY-MM-DD');
            const periodName_ = djApp.format('MMM-YY');
            if (!/^[A-Z][a-z]{2}-\d{2}$/.test(periodName_)) return; // skip invalid period

            const fullData_    = await getAccounting('RR_AP_APPLIED_PREPAYMENTS', record.applicationId);
            const appLines: any[] = fullData_.lines || [];
            if (appLines.length === 0) return;

            const ledger_    = await fetchLedgerByBusinessUnit(bu);
            const ledgerName_ = ledger_?.ledgerName ?? 'BCL DIFC';
            const ledgerId_   = ledger_?.ledgerId   ?? 0;
            const totalDr_   = appLines.reduce((s: number, l: any) => s + (l.enteredDr || 0), 0);
            const totalCr_   = appLines.reduce((s: number, l: any) => s + (l.enteredCr || 0), 0);
            const batchName_ = `AP-PREP-${record.prepaymentNumber}-${dayjs().format('YYYYMMDD-HHmmss')}`;

            const glPayload_ = {
              batch: {
                batchName: batchName_, batchDescription: `AP Prepayment Application ${record.prepaymentNumber} – Posted from SLA`,
                ledgerName: ledgerName_, ledgerId: ledgerId_, status: 'NEW',
                accountingPeriod: periodName_, controlTotal: totalDr_,
                runningTotalDr: totalDr_, runningTotalCr: totalCr_, batchSource: 'Payables', createdBy: 'user',
              },
              header: {
                ledgerId: ledgerId_, ledgerName: ledgerName_, jeCategory: 'Purchase Invoices', jeSource: 'Payables',
                periodName: periodName_, journalName: `AP Prepayment ${record.prepaymentNumber}`,
                description: `Subledger accounting – Prepayment Applied ${record.prepaymentNumber}`,
                currencyCode: currency, currencyConversionType: 'User', currencyConversionDate: acctDate,
                currencyConversionRate: 1, defaultEffectiveDate: acctDate, status: 'NEW', runningTotalDr: totalDr_, runningTotalCr: totalCr_, createdBy: 'user',
              },
              lines: appLines.map((l: any) => ({
                enteredDr: l.lineType === 'DR' ? (l.enteredDr || null) : null,
                enteredCr: l.lineType === 'CR' ? (l.enteredCr || null) : null,
                accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null, statAmount: null,
                description: l.description || '', currencyCode: l.currencyCode || currency,
                currencyConversionDate: l.accountingDate || acctDate, currencyConversionRate: 1,
                userCurrencyConversionType: 'User', accountCombination: l.accountCombination || '',
                chartOfAccountsName: 'Chart of Accounts', reference1: record.prepaymentNumber,
                reference2: String(record.applicationId), reference3: l.accountingClass || null,
                reference4: l.legalEntity || bu || null, reference5: 'AP-PREPAYMENT-APPLICATION', createdBy: 'user',
              })),
            };

            const glRes_ = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/create`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(glPayload_),
            });
            const glData_ = await glRes_.json();
            if (!glRes_.ok) return;

            const glBatchId_   = glData_.jeBatchId  ?? glData_.je_batch_id  ?? glData_.batchId  ?? glData_.batch_id  ?? null;
            const glHeaderId_  = glData_.jeHeaderId ?? glData_.je_header_id ?? glData_.headerId ?? glData_.header_id ?? null;
            const glBatchName_ = glData_.batchName  ?? glData_.batch_name   ?? batchName_;

            if (glBatchId_ || glHeaderId_) {
              await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ headerId: appSlaInfo.headerId, postedBy: 'user', glBatchId: glBatchId_, glBatchName: glBatchName_, glHeaderId: glHeaderId_ }),
              });
            }
            setAppSlaMap(prev => ({ ...prev, [record.applicationId]: { headerId: appSlaInfo.headerId, status: 'POSTED' } }));
            posted++;
          } catch { /* non-fatal — invoice post already succeeded */ }
        }));
        if (posted > 0) message.info(`Also posted ${posted} prepayment application accounting(s) to GL.`);
      }
    } catch (err: any) {
      message.error(`Post to Ledger failed: ${err.message}`);
      // Auto-open debug modal so user can see which step failed
      setGlPayloadModalVisible(true);
    } finally {
      setSlaPosting(false);
    }
  }, [slaHeaderId, slaStatus, form, headerValues, savedInvoiceId, initialData, appliedPrepaymentsList, appSlaMap, setAppSlaMap, fetchLedgerByBusinessUnit]);

  // ── Applied Prepayment SLA: Create Accounting ─────────────────────────────
  const handleAppCreateAccounting = useCallback(async (record: AppliedPrepayment) => {
    const { applicationId } = record;
    const appSlaInfo = appSlaMap[applicationId];
    if (appSlaInfo?.status === 'POSTED') { message.warning('Accounting is already posted and locked.'); return; }

    setAppSlaLoadingId(applicationId);
    try {
      const invoiceId     = savedInvoiceId || initialData?.invoiceId;
      const invoiceNumber = form.getFieldValue('invoiceNumber');
      const bu            = form.getFieldValue('businessUnit') || '';

      // Re-call save_application with the existing applicationId — DB handles account lookups
      const payload = {
        PrepaymentApplicationId:   applicationId,
        InvoiceId:                 invoiceId,
        InvoiceNumber:             invoiceNumber,
        PrepaymentInvoiceId:       record.prepaymentInvoiceId,
        PrepaymentNumber:          record.prepaymentNumber,
        LineNumber:                record.lineNumber,
        PrepaymentLineNumber:      record.prepaymentLineNumber,
        Description:               record.description,
        BusinessUnit:              bu,
        SupplierSite:              record.supplierSite,
        PurchaseOrder:             record.purchaseOrder,
        Currency:                  record.currency,
        AppliedAmount:             record.appliedAmount,
        IncludedTax:               0,
        IncludedonInvoiceFlag:     'N',
        Status:                    'Applied',
        ApplicationAccountingDate: record.applicationAccountingDate,
        CreatedBy:                 'user',
        LastUpdatedBy:             'user',
      };

      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Re-check accounting status from DB after a short delay
      await new Promise(r => setTimeout(r, 600));
      const r2 = await checkAccountingExists('RR_AP_APPLIED_PREPAYMENTS', applicationId, 'PREPAYMENT_APPLIED');
      const newStatus   = r2.exists ? (r2.accountingStatus ?? 'DRAFT') : 'DRAFT';
      const newHeaderId = r2.exists ? (r2.headerId ?? null) : null;
      setAppSlaMap(prev => ({ ...prev, [applicationId]: { headerId: newHeaderId, status: newStatus } }));
      message.success(`Accounting created for prepayment application — ${record.prepaymentNumber}`);
    } catch (err: any) {
      message.error(`Create accounting failed: ${err.message}`);
    } finally {
      setAppSlaLoadingId(null);
    }
  }, [appSlaMap, form, savedInvoiceId, initialData]);

  // ── Cancellation Reversal SLA: Post to Ledger ────────────────────────────
  const handlePostCancellationToLedger = useCallback(async () => {
    if (!cancelSlaHeaderId) { message.warning('No cancellation accounting header found.'); return; }
    if (cancelSlaStatus === 'POSTED') { message.warning('Cancellation journal already posted.'); return; }

    setCancelSlaPosting(true);
    setCancelPostError(null);
    try {
      const invoiceNumber = form.getFieldValue('invoiceNumber');
      const invoiceId     = savedInvoiceId || initialData?.invoiceId;
      const currency      = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
      const bu            = form.getFieldValue('businessUnit') || '';
      const months        = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d             = new Date();
      const periodName    = `${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
      const acctDate      = dayjs().format('YYYY-MM-DD');

      if (!/^[A-Z][a-z]{2}-\d{2}$/.test(periodName)) {
        message.error(`Invalid accounting period "${periodName}". Expected Mon-YY (e.g. Apr-26).`);
        return;
      }

      const linesData = await getLinesByHeaderId(cancelSlaHeaderId);
      const fetchedLines: any[] = linesData.items || [];
      if (fetchedLines.length === 0) throw new Error('No cancellation SLA lines found.');

      const ledgerInfo         = await fetchLedgerByBusinessUnit(bu);
      const resolvedLedgerName = ledgerInfo?.ledgerName ?? '';
      const resolvedLedgerId   = ledgerInfo?.ledgerId   ?? 0;
      const totalDr   = fetchedLines.reduce((s: number, l: any) => s + (l.enteredDr || 0), 0);
      const totalCr   = fetchedLines.reduce((s: number, l: any) => s + (l.enteredCr || 0), 0);
      const batchName = `AP-CANCEL-${invoiceNumber}-${dayjs().format('YYYYMMDD-HHmmss')}`;

      // Step 0 — duplicate check
      const glExists = await checkGLJournalExists(invoiceNumber, String(invoiceId), 'AP-INVOICE-CANCELLATION');
      if (glExists.exists) {
        message.warning(`Cancellation journal already exists in GL (Batch #${glExists.batchId}). Reusing existing journal.`);
        if (glExists.status === 'P') {
          await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headerId: cancelSlaHeaderId, postedBy: 'user', glBatchId: glExists.batchId, glBatchName: batchName, glHeaderId: glExists.headerId }),
          });
          setCancelSlaStatus('POSTED');
          setCancelPostError(null);
          message.success('Cancellation journal already posted. SLA updated.');
          return;
        }
        // Exists unposted — post it
        const putRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/${glExists.batchId}/post`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
        });
        const putData = await putRes.json().catch(() => ({}));
        if (!putRes.ok || putData?.success === false) {
          const err = Array.isArray(putData?.errors) && putData.errors.length > 0 ? putData.errors[0] : putData?.error || `HTTP ${putRes.status}`;
          throw new Error(`GL posting failed: ${err}`);
        }
        await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headerId: cancelSlaHeaderId, postedBy: 'user', glBatchId: glExists.batchId, glBatchName: batchName, glHeaderId: glExists.headerId }),
        });
        setCancelSlaStatus('POSTED');
        setCancelPostError(null);
        message.success('Cancellation journal posted to GL successfully.');
        return;
      }

      // Step 1 — create journal
      const journalPayload = {
        batch: {
          batchName, batchDescription: `AP Invoice Cancellation ${invoiceNumber}`,
          ledgerName: resolvedLedgerName, ledgerId: resolvedLedgerId,
          status: 'NEW', accountingPeriod: periodName,
          controlTotal: totalDr, runningTotalDr: totalDr, runningTotalCr: totalCr,
          batchSource: 'Payables', createdBy: 'user',
        },
        header: {
          ledgerId: resolvedLedgerId, ledgerName: resolvedLedgerName,
          jeCategory: 'Purchase Invoices', jeSource: 'Payables',
          periodName, journalName: `AP Cancellation ${invoiceNumber}`,
          description: `Cancellation reversal – Invoice ${invoiceNumber}`,
          currencyCode: currency, currencyConversionType: 'User',
          currencyConversionDate: acctDate, currencyConversionRate: 1,
          defaultEffectiveDate: acctDate, status: 'NEW',
          runningTotalDr: totalDr, runningTotalCr: totalCr, createdBy: 'user',
        },
        lines: fetchedLines.map((l: any) => ({
          enteredDr:   l.lineType === 'DR' ? (l.enteredDr || null) : null,
          enteredCr:   l.lineType === 'CR' ? (l.enteredCr || null) : null,
          accountedDr: l.accountedDr || null,
          accountedCr: l.accountedCr || null,
          statAmount:  null,
          description: l.description || '',
          currencyCode: l.currencyCode || currency,
          currencyConversionDate: acctDate, currencyConversionRate: 1,
          userCurrencyConversionType: 'User',
          accountCombination: l.accountCombination || '',
          chartOfAccountsName: 'Chart of Accounts',
          reference1: invoiceNumber,
          reference2: String(invoiceId),
          reference3: l.accountingClass || null,
          reference4: l.legalEntity || bu || null,
          reference5: 'AP-INVOICE-CANCELLATION',
          createdBy:  'user',
        })),
      };

      const glRes  = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(journalPayload),
      });
      const glData = await glRes.json().catch(() => ({}));
      if (!glRes.ok) throw new Error(`GL journal creation failed: HTTP ${glRes.status} – ${glData?.message || JSON.stringify(glData)}`);

      const glBatchId   = glData.jeBatchId  ?? glData.je_batch_id  ?? glData.batchId  ?? null;
      const glHeaderId  = glData.jeHeaderId ?? glData.je_header_id ?? glData.headerId ?? null;
      const glBatchName = glData.batchName  ?? batchName;

      // Step 2 — post to GL
      if (glBatchId) {
        const putRes  = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/${glBatchId}/post`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
        });
        const putData = await putRes.json().catch(() => ({}));
        if (!putRes.ok || putData?.success === false) {
          const err = Array.isArray(putData?.errors) && putData.errors.length > 0 ? putData.errors[0] : putData?.error || `HTTP ${putRes.status}`;
          throw new Error(`GL posting failed: ${err}`);
        }
      }

      // Step 3 — stamp SLA
      await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headerId: cancelSlaHeaderId, postedBy: 'user', glBatchId, glBatchName, glHeaderId }),
      });

      setCancelSlaStatus('POSTED');
      setCancelPostError(null);
      message.success('Cancellation journal posted to GL successfully.');
    } catch (err: any) {
      const msg = err.message || 'Unknown error during cancellation posting';
      setCancelPostError(msg);
      message.error(`Post Cancellation failed: ${msg}`);
    } finally {
      setCancelSlaPosting(false);
    }
  }, [cancelSlaHeaderId, cancelSlaStatus, form, headerValues, savedInvoiceId, initialData, fetchLedgerByBusinessUnit]);

  // ── Applied Prepayment SLA: Post to Ledger ────────────────────────────────
  const handleAppPostToLedger = useCallback(async (record: AppliedPrepayment) => {
    const { applicationId } = record;
    const appSlaInfo = appSlaMap[applicationId];
    if (!appSlaInfo?.headerId) { message.warning('Create Accounting first.'); return; }
    if (appSlaInfo.status === 'POSTED') { message.warning('Already posted and locked.'); return; }

    setAppSlaLoadingId(applicationId);
    try {
      const bu         = form.getFieldValue('businessUnit') || '';
      const currency   = record.currency;
      // Application accounting date first; invoice accounting date as
      // fallback — never today's date.
      const djApp = dayjs(record.applicationAccountingDate || resolveAcctPeriod()?.acctDate);
      if (!djApp.isValid()) {
        message.error('No accounting date available for this prepayment application.');
        setAppSlaLoadingId(null);
        return;
      }
      const acctDate   = djApp.format('YYYY-MM-DD');
      const periodName = djApp.format('MMM-YY');

      // Validate period format: must be Mon-YY (e.g. Apr-26)
      if (!/^[A-Z][a-z]{2}-\d{2}$/.test(periodName)) {
        message.error(`Invalid accounting period "${periodName}". Expected format: Mon-YY (e.g. Apr-26). Check the application accounting date.`);
        setAppSlaLoadingId(null);
        return;
      }

      // Fetch lines via sla/accounting (filtered by sourceId) — same approach as ManagePayments
      const fullData     = await getAccounting('RR_AP_APPLIED_PREPAYMENTS', applicationId);
      const fetchedLines: any[] = fullData.lines || [];
      if (fetchedLines.length === 0) throw new Error('No SLA lines found for this accounting header.');

      const ledgerInfo         = await fetchLedgerByBusinessUnit(bu);
      const resolvedLedgerName = ledgerInfo?.ledgerName ?? 'BCL DIFC';
      const resolvedLedgerId   = ledgerInfo?.ledgerId   ?? 0;

      const totalDr   = fetchedLines.reduce((s: number, l: any) => s + (l.enteredDr || 0), 0);
      const totalCr   = fetchedLines.reduce((s: number, l: any) => s + (l.enteredCr || 0), 0);
      const batchName = `AP-PREP-${record.prepaymentNumber}-${dayjs().format('YYYYMMDD-HHmmss')}`;

      const journalPayload = {
        batch: {
          batchName,
          batchDescription:  `AP Prepayment Application ${record.prepaymentNumber} – Posted from SLA`,
          ledgerName:        resolvedLedgerName,
          ledgerId:          resolvedLedgerId,
          status:            'NEW',
          accountingPeriod:  periodName,
          controlTotal:      totalDr,
          runningTotalDr:    totalDr,
          runningTotalCr:    totalCr,
          batchSource:       'Payables',
          createdBy:         'user',
        },
        header: {
          ledgerId:               resolvedLedgerId,
          ledgerName:             resolvedLedgerName,
          jeCategory:             'Purchase Invoices',
          jeSource:               'Payables',
          periodName,
          journalName:            `AP Prepayment ${record.prepaymentNumber}`,
          description:            `Subledger accounting – Prepayment Applied ${record.prepaymentNumber}`,
          currencyCode:           currency,
          currencyConversionType: 'User',
          currencyConversionDate: acctDate,
          currencyConversionRate: 1,
          defaultEffectiveDate:   acctDate,
          status:                 'NEW',
          runningTotalDr:         totalDr,
          runningTotalCr:         totalCr,
          createdBy:              'user',
        },
        lines: fetchedLines.map((l: any) => ({
          enteredDr:                  l.lineType === 'DR' ? (l.enteredDr || null) : null,
          enteredCr:                  l.lineType === 'CR' ? (l.enteredCr || null) : null,
          accountedDr:                l.accountedDr || null,
          accountedCr:                l.accountedCr || null,
          statAmount:                 null,
          description:                l.description || '',
          currencyCode:               l.currencyCode || currency,
          currencyConversionDate:     l.accountingDate || acctDate,
          currencyConversionRate:     1,
          userCurrencyConversionType: 'User',
          accountCombination:         l.accountCombination || '',
          chartOfAccountsName:        'Chart of Accounts',
          reference1:                 record.prepaymentNumber,
          reference2:                 String(applicationId),
          reference3:                 l.accountingClass || null,
          reference4:                 l.legalEntity || bu || null,
          reference5:                 'AP-PREPAYMENT-APPLICATION',
          createdBy:                  'user',
        })),
      };

      // Step 1 — POST to journals/create
      const glRes  = await fetch(`${APEX_DB_CONFIG.baseUrl}/journals/create`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(journalPayload),
      });
      const glData = await glRes.json();

      if (!glRes.ok) {
        await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/error`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ headerId: appSlaInfo.headerId, errorMessage: `HTTP ${glRes.status}: ${glData?.message || ''}`, postedBy: 'user' }),
        });
        setAppSlaMap(prev => ({ ...prev, [applicationId]: { ...prev[applicationId], status: 'ERROR' } }));
        throw new Error(`GL journal creation failed: HTTP ${glRes.status} – ${glData?.message || ''}`);
      }

      const glBatchId   = glData.jeBatchId  ?? glData.je_batch_id  ?? glData.batchId  ?? glData.batch_id  ?? null;
      const glHeaderId  = glData.jeHeaderId ?? glData.je_header_id ?? glData.headerId ?? glData.header_id ?? null;
      const glBatchName = glData.batchName || glData.batch_name || batchName;

      // Step 2 — POST to GL via RR_POST_JOURNAL (validates period format, period open, balance, accounts)
      if (glBatchId) {
        const postGlRes  = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/${glBatchId}/post`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    '{}',   // ORDS requires a body when Content-Type is application/json
        });
        const postGlData = await postGlRes.json().catch(() => ({}));

        if (!postGlRes.ok || postGlData?.success === false) {
          const firstError = Array.isArray(postGlData?.errors) && postGlData.errors.length > 0
            ? postGlData.errors[0]
            : postGlData?.error || `HTTP ${postGlRes.status}`;
          await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/error`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ headerId: appSlaInfo.headerId, errorMessage: firstError, postedBy: 'user' }),
          });
          setAppSlaMap(prev => ({ ...prev, [applicationId]: { ...prev[applicationId], status: 'ERROR' } }));
          throw new Error(`GL posting failed: ${firstError}`);
        }
      }

      // Step 3 — stamp GL IDs back on the SLA header
      if (glBatchId || glHeaderId) {
        const postRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify({ headerId: appSlaInfo.headerId, postedBy: 'user', glBatchId, glBatchName, glHeaderId }),
        });
        if (!postRes.ok) { const t = await postRes.text(); throw new Error(`SLA post update failed: ${t}`); }
      }

      setAppSlaMap(prev => ({ ...prev, [applicationId]: { headerId: prev[applicationId]?.headerId ?? null, status: 'POSTED' } }));
      message.success('Posted to General Ledger. Prepayment application accounting is now locked.');
    } catch (err: any) {
      message.error(`Post to Ledger failed: ${err.message}`);
    } finally {
      setAppSlaLoadingId(null);
    }
  }, [appSlaMap, form, fetchLedgerByBusinessUnit]);

  // Fetch invoice holds (edit mode)
  const fetchInvoiceHolds = useCallback(async (invoiceId: number) => {
    setInvoiceHoldsLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoice-holds?invoice_id=${invoiceId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.items || data || [];
      setInvoiceHolds(
        items.map((item: any, index: number) => ({
          key: item.hold_id?.toString() || index.toString(),
          holdName: item.hold_lookup_code || item.hold_name || '',
          holdReason: item.hold_reason || item.description || '',
          holdDate: formatDateStr(item.hold_date || item.creation_date),
          heldBy: item.held_by || item.created_by || '',
          releaseDate: formatDateStr(item.release_date),
          releasedBy: item.released_by || '',
        }))
      );
    } catch (error) {
      console.error('Error fetching invoice holds:', error);
    } finally {
      setInvoiceHoldsLoading(false);
    }
  }, []);

  // Fetch invoice installments (edit mode)
  const fetchInvoiceInstallments = useCallback(async (invoiceId: number) => {
    setInvoiceInstallmentsLoading(true);
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments?P_INVOICE_ID=${invoiceId}`;
    setInvoiceInstallmentsUrl(url);
    console.log('[Installments Tab] Fetching:', url);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.items || data.installments || data || [];
      setInvoiceInstallments(
        items.map((item: any, index: number) => ({
          key: item.installment_id?.toString() || index.toString(),
          installmentNumber: item.installment_number || index + 1,
          dueDate: formatDateStr(item.due_date),
          grossAmount: item.gross_amount || 0,
          unpaidAmount: item.amount_remaining || item.unpaid_amount || 0,
          paymentPriority: item.payment_priority || 0,
          paymentMethod: item.payment_method || '',
          bankAccount: item.bank_account || item.bank_account_name || '',
        }))
      );
    } catch (error) {
      console.error('Error fetching installments:', error);
    } finally {
      setInvoiceInstallmentsLoading(false);
    }
  }, []);

  // Fetch existing invoice lines (edit mode)
  const fetchExistingLines = useCallback(async (invoiceId: number) => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${invoiceId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.items || data || [];

      if (Array.isArray(items) && items.length > 0) {
        const itemLines = items.filter((item: any) => item.line_type === 'Item' || !item.line_type);
        if (itemLines.length > 0) {
          const mappedLines: InvoiceLine[] = itemLines.map((item: any, index: number) => {
            const taxClass = item.tax_classification_code || item.tax_classification || '';
            return {
              key: item.line_id?.toString() || `${Date.now()}-${index}`,
              lineNumber: item.line_number || index + 1,
              type: item.line_type || 'Item',
              amount: item.line_amount || 0,
              distributionSet: item.distribution_set || '',
              distributionCombination: item.distribution_combination || item.dist_code_combination || '',
              accountingDate: formatDateStr(item.accounting_date) || '',
              prorateAcrossAllItemLines: item.prorate_across_all_items || 'No',
              description: item.description || '',
              taxClassification: taxClass,
              shipToLocation: item.ship_to_location || '',
              quantity: item.quantity || 1,
              unitPrice: item.unit_price || 0,
              uomName: item.uom || '',
              project: item.project || '',
              task: item.task || '',
              poNumber: item.purchase_order_number || item.po_number || '',
              poLine: item.purchase_order_line_number?.toString() || item.po_line_number?.toString() || '',
              poSchedule: item.purchase_order_schedule_line_number?.toString() || '',
              receiptNumber: item.receipt_number || '',
              receiptLine: item.receipt_line_number?.toString() || '',
              consumptionAdviceNumber: item.consumption_advice_number || '',
              consumptionAdviceLine: item.consumption_advice_line_number?.toString() || '',
              startDate: formatDateStr(item.multiperiod_start_date) || '',
              endDate: formatDateStr(item.multiperiod_end_date) || '',
              accrualAccount: item.multiperiod_accrual_account || item.accrual_account || '',
              // Only carry taxAmount if the line actually has a tax classification
              taxAmount: taxClass ? (item.tax_control_amount || item.tax_amount || 0) : 0,
            };
          });
          setLines(mappedLines);

          // Set tax rate from the first line that has a tax classification;
          // if no line has one, default to 0 (no tax)
          const firstTaxedLine = mappedLines.find(l => l.taxClassification);
          if (firstTaxedLine) {
            setTaxRate(getTaxRateForClassification(firstTaxedLine.taxClassification));
          } else {
            setTaxRate(0);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching existing invoice lines:', error);
      message.warning('Could not load existing invoice lines');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Procurement Business Units from DB on mount; fall back to known values if endpoint not yet deployed
  const FALLBACK_BUSINESS_UNITS = [
    { name: 'BUIMERC CORP FZE_JAFZA',   company: '' },
    { name: 'BUIMERC CORP_DIFC_INVST',  company: '' },
    { name: 'BUIMERC CORP FZE',         company: '' },
    { name: 'BUIMERC CORP DIFC',        company: '' },
  ];
  // Auto-post to GL immediately after accounting is created (triggered by handleCreateAccounting)
  useEffect(() => {
    if (autoPostPending && slaHeaderId) {
      setAutoPostPending(false);
      handlePostToLedger();
    }
  }, [autoPostPending, slaHeaderId, handlePostToLedger]);

  const fetchTaxCodes = useCallback(async (businessUnit: string) => {
    if (!businessUnit) { setTaxCodes([]); return; }
    try {
      const params = new URLSearchParams({ business_unit: businessUnit });
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/tax/taxes/bybu?${params}`);
      const data = await res.json();
      const items: any[] = data?.items ?? [];
      setTaxCodes(
        items
          .map((t: any) => ({
            taxCode:    t.taxCode    || '',
            taxName:    t.taxName    || '',
            taxRate:    Number(t.taxRate) || 0,
            taxAccount: t.taxAccount || '',
          }))
          .filter(t => t.taxCode)
      );
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetch(APEX_BUSINESS_UNITS_URL, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const items = (data?.items ?? [])
          .filter((i: any) => i.business_unit_name)
          .map((i: any) => ({ name: i.business_unit_name as string, company: (i.company || '') as string }));
        const buList = items.length > 0 ? items : FALLBACK_BUSINESS_UNITS;
        setBusinessUnits(buList);
        // Initialise derivedCompany for edit mode (BU already set)
        const currentBu = form.getFieldValue('businessUnit') || initialData?.businessUnit || '';
        if (currentBu) {
          const match = buList.find((b: { name: string; company: string }) => b.name === currentBu);
          if (match?.company) setDerivedCompany(match.company);
        }
      })
      .catch(() => setBusinessUnits(FALLBACK_BUSINESS_UNITS));

    if (initialData?.businessUnit) fetchTaxCodes(initialData.businessUnit);

    searchCombinations({})
      .then(data => setDistCombinations(data))
      .catch(() => {});
  }, []);

  // In edit mode, if LIABILITY_DISTRIBUTION was not stored (old invoice or null),
  // derive it from the business unit once BUs have loaded.
  useEffect(() => {
    if (!initialData?.invoiceId || businessUnits.length === 0) return;
    const current = form.getFieldValue('liabilityDistribution');
    if (current) return; // already set — do nothing
    const buName = form.getFieldValue('businessUnit') || initialData.businessUnit;
    if (!buName) return;
    const selectedBU = businessUnits.find(bu => bu.name === buName);
    if (selectedBU?.company) {
      const derived = `${selectedBU.company}-00-00-2313101-0000-000-00-000-000`;
      form.setFieldValue('liabilityDistribution', derived);
      setHeaderValues(prev => ({ ...prev, liabilityDistribution: derived }));
      setLines(prev => prev.map(line => ({ ...line, accrualAccount: line.accrualAccount || derived })));
    }
  }, [businessUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill from initialData (Quick Create or Edit mode)
  useEffect(() => {
    if (initialData) {
      const formValues: Record<string, any> = {};
      if (initialData.supplier) formValues.supplier = initialData.supplier;
      if (initialData.supplierNumber) formValues.supplierNumber = initialData.supplierNumber;
      if (initialData.supplierId) formValues.supplierId = initialData.supplierId;
      if (initialData.invoiceNumber) formValues.invoiceNumber = initialData.invoiceNumber;
      if (initialData.invoiceAmount) formValues.invoiceAmount = initialData.invoiceAmount;
      if (initialData.invoiceDate) {
        formValues.invoiceDate = dayjs.isDayjs(initialData.invoiceDate)
          ? initialData.invoiceDate
          : dayjs(initialData.invoiceDate as string, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']);
      } else if (!initialData.invoiceId) {
        formValues.invoiceDate = dayjs();
      }
      if (initialData.description) formValues.description = initialData.description;
      if (initialData.invoiceCurrency) formValues.invoiceCurrency = initialData.invoiceCurrency;
      if (initialData.businessUnit) formValues.businessUnit = initialData.businessUnit;
      if (initialData.invoiceType) formValues.invoiceType = initialData.invoiceType;
      if (initialData.supplierSite) formValues.supplierSite = initialData.supplierSite;
      if (initialData.paymentTerms) formValues.paymentTerms = initialData.paymentTerms;
      if (initialData.invoiceGroup) formValues.invoiceGroup = initialData.invoiceGroup;
      if (initialData.termsDate) formValues.termsDate = dayjs(initialData.termsDate, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']);
      if (initialData.goodsReceivedDate) formValues.goodsReceivedDate = dayjs(initialData.goodsReceivedDate, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']);
      if (initialData.liabilityDistribution) formValues.liabilityDistribution = initialData.liabilityDistribution;
      if (initialData.accountingDate) formValues.accountingDate = dayjs(initialData.accountingDate, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']);
      if (initialData.conversionRateType) formValues.conversionRateType = initialData.conversionRateType;
      if (initialData.conversionDate) formValues.conversionDate = dayjs(initialData.conversionDate, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']);
      // For functional currency (AED) always use rate 1; otherwise load from DB
      const isFuncCcy = (initialData.invoiceCurrency || 'AED') === 'AED';
      formValues.conversionRate = isFuncCcy ? 1 : (initialData.conversionRate || undefined);
      if (initialData.paymentCurrency) formValues.paymentCurrency = initialData.paymentCurrency;
      if (initialData.documentCategory) formValues.documentCategory = initialData.documentCategory;
      if (initialData.documentSequence != null && initialData.documentSequence !== '') formValues.documentSequence = Number(initialData.documentSequence) || initialData.documentSequence;
      if (initialData.voucherNumber) formValues.voucherNumber = initialData.voucherNumber;
      form.setFieldsValue(formValues);
      setHeaderValues((prev) => ({ ...prev, ...formValues }));
      if (initialData.businessUnit) setBuSelected(true);

      // Edit mode: fetch existing lines, payments, holds, installments, applied prepayments
      if (initialData.invoiceId) {
        fetchSuppliers(); // load suppliers so supplierId fallback lookup works for prepayments
        fetchExistingLines(initialData.invoiceId);
        fetchInvoicePayments(initialData.invoiceId);
        fetchInvoiceHolds(initialData.invoiceId);
        fetchInvoiceInstallments(initialData.invoiceId);
        fetchInvoiceBalance(initialData.invoiceId);
        fetchSlaHeader(initialData.invoiceId);
        fetchAppliedPrepayments(initialData.invoiceId).then(list => {
          setAppliedPrepaymentsList(list);
          loadAppSlaStatuses(list);
        });

        // Fetch full invoice header to get fields not returned by the search endpoint
        fetch(`${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/${initialData.invoiceId}`, { headers: { Accept: 'application/json' } })
          .then(r => r.json())
          .then(data => {
            const hdr = data?.header || data;
            const patch: Record<string, any> = {};
            if (hdr.AccountingDate || hdr.accounting_date) patch.accountingDate = dayjs(hdr.AccountingDate || hdr.accounting_date, ['YYYY-MM-DD', 'DD-MMM-YYYY']);
            if (hdr.ConversionRateType || hdr.conversion_rate_type) patch.conversionRateType = hdr.ConversionRateType || hdr.conversion_rate_type;
            if (hdr.ConversionDate || hdr.conversion_date) patch.conversionDate = dayjs(hdr.ConversionDate || hdr.conversion_date, ['YYYY-MM-DD', 'DD-MMM-YYYY']);
            if (hdr.ConversionRate || hdr.conversion_rate) patch.conversionRate = Number(hdr.ConversionRate || hdr.conversion_rate);
            if (hdr.PaymentCurrency || hdr.payment_currency) patch.paymentCurrency = hdr.PaymentCurrency || hdr.payment_currency;
            if (Object.keys(patch).length > 0) {
              form.setFieldsValue(patch);
              setHeaderValues(prev => ({ ...prev, ...patch }));
            }
            // Update live validation status from DB — overrides the ManageInvoices snapshot
            const dbValidationStatus = hdr.ValidationStatus || hdr.validation_status || '';
            if (dbValidationStatus) {
              setLiveValidationStatus(dbValidationStatus);
              setIsValidated(dbValidationStatus === 'Validated');
            }
          })
          .catch(() => {}); // silently ignore if endpoint doesn't support GET
        // When viewing a Prepayment invoice, also load balance + applied invoices
        if ((initialData.invoiceType || '').toLowerCase() === 'prepayment') {
          fetchPrepaymentBalance(initialData.invoiceId);
          fetchAppliedInvoices(initialData.invoiceId);
        }
        // Mark as validated if it was already validated (or validated-unpaid for prepayments)
        if (initialData.validationStatus === 'Validated' || initialData.validationStatus === 'Validated-Unpaid') {
          setIsValidated(true);
        }
        if (initialData.applyAfterDate) {
          form.setFieldValue('applyAfterDate', dayjs(initialData.applyAfterDate, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']));
        }
        return; // Skip blank line creation for edit mode
      }

      // Set tax rate based on tax code
      if (initialData.taxCode) {
        if (initialData.taxCode === 'VAT 5%') setTaxRate(5);
        else if (initialData.taxCode === 'Zero Rated' || initialData.taxCode === 'Exempt' || initialData.taxCode === 'Out of Scope') setTaxRate(0);
        else setTaxRate(5);
      }

      // Pre-fill the first line with amount and description
      const firstLine = createBlankLine(1);
      if (initialData.invoiceAmount) {
        if (initialData.includingTax && initialData.taxCode === 'VAT 5%') {
          // Amount includes tax: back-calculate line amount
          const rate = 5;
          firstLine.amount = Math.round((initialData.invoiceAmount / (1 + rate / 100)) * 100) / 100;
        } else {
          firstLine.amount = initialData.invoiceAmount;
        }
      }
      if (initialData.taxCode) {
        firstLine.taxClassification = initialData.taxCode;
        // Compute line-level tax
        const lineRate = getTaxRateForClassification(initialData.taxCode);
        firstLine.taxAmount = Math.round(firstLine.amount * (lineRate / 100) * 100) / 100;
      }
      if (initialData.description) firstLine.description = initialData.description;
      if (initialData.invoiceDate && initialData.invoiceDate.format) {
        const formattedDate = initialData.invoiceDate.format('DD-MMM-YYYY');
        firstLine.accountingDate = formattedDate;
        firstLine.startDate = formattedDate;
        firstLine.endDate = getEndOfMonth(formattedDate);
      }
      // accrualAccount should be left empty and set separately for expense/accrual accounts, NOT liability
      // DO NOT set it to liabilityDistribution as that causes double-posting to the same account
      setLines([firstLine]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch suppliers filtered by the currently selected business unit
  const fetchSuppliers = async () => {
    setSupplierLoading(true);
    try {
      const bu = form.getFieldValue('businessUnit') || '';
      const url = bu
        ? `${APEX_SUPPLIERS_URL}&P_BUSINESS_UNIT=${bu}`
        : APEX_SUPPLIERS_URL;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.items || data || [];
      if (Array.isArray(items)) {
        const mapped: SupplierRecord[] = items.map((item: any, index: number) => ({
          key: item.supplier_id?.toString() || index.toString(),
          supplierId: item.supplier_id,
          supplier: item.supplier || '',
          supplierNumber: item.supplier_number || '',
          alternativeName: item.alternate_name || '',
          status: item.status || '',
          supplierType: item.supplier_type || '',
          creationDate: formatDate(item.creation_date),
          taxpayerId: item.taxpayer_id || '',
        }));
        setSuppliers(mapped);
      }
    } catch (error) {
      console.error('Supplier fetch error:', error);
      message.error('Failed to fetch suppliers');
    } finally {
      setSupplierLoading(false);
    }
  };

  const openSupplierModal = () => {
    setSupplierModalVisible(true);
    setSupplierSearchText('');
    fetchSuppliers(); // always refetch — business unit may have changed
  };

  const handleSupplierSelect = (record: SupplierRecord) => {
    const bu = form.getFieldValue('businessUnit') || '';
    form.setFieldsValue({
      supplier:       `${record.supplier} (${record.supplierNumber})`,
      supplierNumber: record.supplierNumber,
      supplierId:     record.supplierId,
      supplierSite:   undefined,
    });
    setSelectedSupplierInfo({ number: record.supplierNumber, id: record.supplierId });
    setSupplierModalVisible(false);
    message.success(`Selected: ${record.supplier}`);
    fetchSupplierSites(record.supplierId, bu);
    // Check for available prepayments in background (to show badge)
    fetchAvailablePrepayments(record.supplierId).then(avail => {
      setSupplierHasPrepayments(avail.length > 0);
      setAvailablePrepayments(avail);
    });
  };

  const fetchSupplierSites = async (supplierId: number, procurementBU: string) => {
    setSupplierSiteLoading(true);
    setSupplierSites([]);
    try {
      const url = `${buildApexUrl("suppliers/sites?P_SUPPLIER_ID=${supplierId}&P_PROCUREMENT_BU=${encodeURIComponent(procurementBU)}")}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = data.items || (Array.isArray(data) ? data : []);
      const mapped: SupplierSiteRecord[] = items.map((item: any) => ({
        siteId:       item.suppliersiteid?.toString() || '',
        siteName: item.supplier_site || item.SUPPLIER_SITE || '',
      })).filter(s => s.siteId);
      setSupplierSites(mapped);
      if (mapped.length === 1) {
        form.setFieldsValue({ supplierSite: mapped[0].siteId });
        message.success(`Site auto-selected: ${mapped[0].siteName}`);
      } else if (mapped.length === 0) {
        message.warning('No supplier sites found for this supplier.');
      }
    } catch (err) {
      message.error(`Failed to load supplier sites: ${err}`);
    } finally {
      setSupplierSiteLoading(false);
    }
  };

  // Fetch available prepayments for the supplier (to show badge and populate Available section)
  const fetchAvailablePrepayments = useCallback(async (supplierId: number): Promise<AvailablePrepayment[]> => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/prepayments/available?P_SUPPLIER_ID=${supplierId}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      const items: any[] = data.items || (Array.isArray(data) ? data : []);
      return items.map((item: any, idx: number) => ({
        key: (item.invoice_id ?? idx).toString(),
        invoiceId: Number(item.invoice_id ?? 0),
        invoiceNumber: item.invoice_number ?? '',
        description: item.description ?? '',
        supplierSite: item.supplier_site ?? '',
        purchaseOrder: item.purchase_order ?? '',
        currency: item.currency ?? 'AED',
        availableAmount: Number(item.available_amount ?? 0),
        lineNumber: Number(item.line_number ?? 1),
        prepaymentLineNumber: Number(item.prepayment_line_number ?? 1),
        businessUnit: item.business_unit ?? '',
        toApply: 0,
        accountingDate: dayjs(),
      }));
    } catch {
      return [];
    }
  }, []);

  // Fetch already-applied prepayments for this invoice
  const fetchAppliedPrepayments = useCallback(async (invoiceId: number): Promise<AppliedPrepayment[]> => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments?P_INVOICE_ID=${invoiceId}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      const items: any[] = data.items || (Array.isArray(data) ? data : []);
      return items.map((item: any, idx: number) => ({
        key: (item.application_id ?? idx).toString(),
        applicationId: Number(item.application_id ?? 0),
        prepaymentInvoiceId: Number(item.prepayment_invoice_id ?? 0),
        prepaymentNumber: item.prepayment_number ?? '',
        description: item.description ?? '',
        supplierSite: item.supplier_site ?? '',
        purchaseOrder: item.purchase_order ?? '',
        currency: item.currency ?? 'AED',
        appliedAmount: Number(item.applied_amount ?? 0),
        lineNumber: Number(item.line_number ?? 1),
        prepaymentLineNumber: Number(item.prepayment_line_number ?? 1),
        applicationAccountingDate: item.application_accounting_date ?? '',
        createdBy: item.created_by ?? '',
        status: item.status ?? '',
        syncStatus: item.sync_status ?? 'NEW',
      }));
    } catch {
      return [];
    }
  }, []);

  // Fetch balance (InvoiceAmount / TotalApplied / AvailableBalance) for a prepayment invoice
  const fetchPrepaymentBalance = useCallback(async (prepaymentInvoiceId: number) => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/balances?prepayment_invoice_id=${prepaymentInvoiceId}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const json = await res.json();
      // Handle ORDS { items: [...] }, plain array, or single object
      let item: any = null;
      if (Array.isArray(json)) {
        item = json[0];
      } else if (json?.items && Array.isArray(json.items)) {
        item = json.items[0];
      } else {
        item = json;
      }
      if (item) {
        // Support both PascalCase and snake_case field names from ORDS
        setPrepaymentBalance({
          invoiceAmount: Number(item.InvoiceAmount ?? item.invoice_amount ?? 0),
          totalApplied: Number(item.TotalApplied ?? item.total_applied ?? 0),
          availableBalance: Number(item.AvailableBalance ?? item.available_balance ?? 0),
          applicationCount: Number(item.ApplicationCount ?? item.application_count ?? 0),
        });
      }
    } catch { /* silent */ }
  }, []);

  // Fetch standard invoices that have applied this prepayment (source: PREPAYMENT_INVOICE_ID)
  const fetchAppliedInvoices = useCallback(async (prepaymentInvoiceId: number) => {
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/by-prepayment/${prepaymentInvoiceId}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const json = await res.json();
      const items: any[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
      setAppliedInvoicesList(items.map((item: any, idx: number) => ({
        key: String(item.ApplicationId ?? idx),
        applicationId: Number(item.ApplicationId ?? 0),
        invoiceId: Number(item.InvoiceId ?? 0),
        invoiceNumber: item.InvoiceNumber ?? '',
        description: item.Description ?? '',
        currency: item.Currency ?? '',
        appliedAmount: Number(item.AppliedAmount ?? 0),
        applicationAccountingDate: item.ApplicationAccountingDate ?? '',
        status: item.Status ?? '',
      })));
    } catch { /* silent */ }
  }, []);

  // Refresh — runs every webservice that fires when an invoice is opened for editing
  // Must be defined after fetchSlaHeader, fetchPrepaymentBalance, fetchAppliedInvoices, loadAppSlaStatuses
  const handleRefreshStatus = useCallback(async () => {
    const invoiceId = savedInvoiceId || initialData?.invoiceId;
    if (!invoiceId) return;
    setStatusRefreshing(true);

    const logs: { label: string; url: string; status: number; response: string }[] = [];
    const hit = async (label: string, url: string) => {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const text = await res.text();
        logs.push({ label, url, status: res.status, response: text });
        return { ok: res.ok, text };
      } catch (err: any) {
        logs.push({ label, url, status: 0, response: String(err) });
        return { ok: false, text: '' };
      }
    };

    try {
      // 1. Invoice header — paid_status, validation_status, approval_status
      const invoiceNumber = form.getFieldValue('invoiceNumber') || initialData?.invoiceNumber || '';
      const statusUrl = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice${invoiceNumber ? `?invoice_number=${encodeURIComponent(invoiceNumber)}` : ''}`;
      const { ok: statusOk, text: statusText } = await hit('Invoice Header (status)', statusUrl);
      if (statusOk) {
        try {
          const data = JSON.parse(statusText);
          const items: any[] = data.items || (Array.isArray(data) ? data : []);
          const item = items.find((i: any) => i.invoice_id === invoiceId) || items[0];
          if (item) {
            setLiveHoldPaidStatus(item.paid_status        || '');
            setLiveValidationStatus(item.validation_status || '');
            setLiveApprovalStatus(item.approval_status    || '');
          }
        } catch { /* parse error logged */ }
      }

      // 2–9. Run the same calls as the edit-mode useEffect — all in parallel
      const invoiceType = form.getFieldValue('invoiceType') || initialData?.invoiceType || '';
      const isPrepayment = invoiceType.toLowerCase() === 'prepayment';

      await Promise.all([
        // Balance
        (async () => {
          const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/net-balance`;
          const { ok, text } = await hit('Net Balance', url);
          if (ok) { try { const d = JSON.parse(text); setInvoiceBalance(d.netBalance ?? d.balance ?? null); } catch {} }
        })(),
        // Payments
        (async () => {
          const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/payments?P_INVOICE_ID=${invoiceId}`;
          const { ok, text } = await hit('Payments', url);
          if (ok) { try {
            const items = JSON.parse(text).items || [];
            setInvoicePayments(items.map((item: any, idx: number) => ({
              key: (item.id ?? idx).toString(), checkId: Number(item.id ?? item.check_id ?? 0),
              number: (item.paper_document_number ?? item.id ?? '').toString(),
              paymentDocument: item.invoice_number ?? '', status: item.payment_status ?? '',
              reconciled: item.reconciled_flag === 'Y' ? 'Yes' : item.reconciled_flag === 'N' ? 'No' : (item.reconciled_flag ?? ''),
              currentPayeeName: item.invoice_business_unit ?? '',
              paymentDate: formatDateStr(item.payment_date ?? item.creation_date ?? ''),
              paidAmount: Number(item.amount_paid_payment_currency ?? 0),
              discountTaken: Number(item.discount_taken ?? item.DISCOUNT_TAKEN ?? item.DiscountTaken ?? 0),
              currency: item.invoice_currency ?? '', address: '', remitToAccount: '',
            })));
          } catch {} }
        })(),
        // Installments
        (async () => {
          const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments?P_INVOICE_ID=${invoiceId}`;
          const { ok, text } = await hit('Installments', url);
          if (ok) { try {
            const items = JSON.parse(text).items || JSON.parse(text).installments || JSON.parse(text) || [];
            setInvoiceInstallments(items.map((item: any, idx: number) => ({
              key: item.installment_id?.toString() || idx.toString(),
              installmentNumber: item.installment_number || idx + 1,
              dueDate: formatDateStr(item.due_date), grossAmount: item.gross_amount || 0,
              unpaidAmount: item.amount_remaining || item.unpaid_amount || 0,
              paymentPriority: item.payment_priority || 0,
              paymentMethod: item.payment_method || '', bankAccount: item.bank_account || item.bank_account_name || '',
            })));
          } catch {} }
        })(),
        // Holds
        (async () => {
          const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoice-holds?invoice_id=${invoiceId}`;
          const { ok, text } = await hit('Invoice Holds', url);
          if (ok) { try {
            const items = JSON.parse(text).items || JSON.parse(text) || [];
            setInvoiceHolds(items.map((item: any, idx: number) => ({
              key: item.hold_id?.toString() || idx.toString(),
              holdName: item.hold_lookup_code || item.hold_name || '',
              holdReason: item.hold_reason || item.description || '',
              holdDate: formatDateStr(item.hold_date || item.creation_date),
              heldBy: item.held_by || item.created_by || '',
              releaseDate: formatDateStr(item.release_date), releasedBy: item.released_by || '',
            })));
          } catch {} }
        })(),
        // Applied prepayments
        (async () => {
          const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments?P_INVOICE_ID=${invoiceId}`;
          const { ok, text } = await hit('Applied Prepayments', url);
          if (ok) { try {
            const d = JSON.parse(text);
            const list: AppliedPrepayment[] = Array.isArray(d.items) ? d.items : Array.isArray(d) ? d : [];
            setAppliedPrepaymentsList(list);
            loadAppSlaStatuses(list);
          } catch {} }
        })(),
        // SLA / accounting header
        (async () => {
          const url = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=${invoiceId}`;
          await hit('SLA Accounting Status', url);
          fetchSlaHeader(invoiceId);
        })(),
        // Prepayment-specific calls
        ...(isPrepayment ? [
          (async () => {
            const url = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/balances?prepayment_invoice_id=${invoiceId}`;
            await hit('Prepayment Balance', url);
            fetchPrepaymentBalance(invoiceId);
          })(),
          (async () => {
            const url = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/by-prepayment/${invoiceId}`;
            await hit('Applied Invoices', url);
            fetchAppliedInvoices(invoiceId);
          })(),
        ] : []),
      ]);
    } finally {
      setRefreshApiLog(logs);
      setStatusRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedInvoiceId, initialData, form, fetchSlaHeader, fetchPrepaymentBalance, fetchAppliedInvoices, loadAppSlaStatuses]);

  // Open the prepayment modal — load available + applied in parallel
  const openPrepaymentModal = useCallback(async () => {
    const supplierId = selectedSupplierInfo?.id
      || initialData?.supplierId
      || form.getFieldValue('supplierId')
      || (() => {
        const supplierNumber = form.getFieldValue('supplierNumber') || '';
        const supplierName   = form.getFieldValue('supplier') || '';
        return suppliers.find(s => supplierNumber && s.supplierNumber === supplierNumber)?.supplierId
          || suppliers.find(s => supplierName && (s.supplier === supplierName || supplierName.startsWith(s.supplier)))?.supplierId;
      })();
    const invoiceId = savedInvoiceId || initialData?.invoiceId;
    if (!supplierId) { message.warning('Select a supplier first.'); return; }
    if (!invoiceId) { message.warning('Please save the invoice before applying a prepayment.'); return; }
    if (invoiceBalance !== null && invoiceBalance <= 0) { message.info('Invoice balance is zero — no prepayment needed.'); return; }
    const remainingBalance = invoiceBalance ?? form.getFieldValue('invoiceAmount') ?? 0;
    setPrepaymentLoading(true);
    setPrepaymentModalVisible(true);
    setSelectedAvailKeys([]);
    try {
      const [avail, applied] = await Promise.all([
        fetchAvailablePrepayments(Number(supplierId)),
        invoiceId ? fetchAppliedPrepayments(invoiceId) : Promise.resolve([]),
      ]);
      setAvailablePrepayments(avail.map(r => ({
        ...r,
        toApply: remainingBalance > 0 ? Math.min(r.availableAmount, remainingBalance) : 0,
      })));
      setAppliedPrepaymentsList(applied);
      loadAppSlaStatuses(applied);
      setSupplierHasPrepayments(avail.length > 0);
    } finally {
      setPrepaymentLoading(false);
    }
  }, [form, savedInvoiceId, initialData, selectedSupplierInfo, fetchAvailablePrepayments, fetchAppliedPrepayments, suppliers, invoiceBalance, loadAppSlaStatuses]);

  // Open the cancel invoice modal — fetch eligibility first
  const openCancelModal = useCallback(async () => {
    const invoiceId = savedInvoiceId || initialData?.invoiceId;
    if (!invoiceId) { message.warning('Save the invoice before cancelling.'); return; }
    setCancelStep('eligibility');
    setCancelEligibility(null);
    setCancelDone(false);
    setCancelApiExpanded(false);
    setCancelApiResult(null);
    setCancelPostExpanded(false);
    setCancelPostResult(null);
    setCancelEligLoading(true);
    setCancelModalOpen(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/cancel-eligibility`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setCancelEligibility({
        eligible:      data.eligible      ?? false,
        invoiceNumber: data.invoiceNumber ?? '',
        invoiceType:   data.invoiceType   ?? '',
        paidStatus:    data.paidStatus    ?? '',
        invoiceAmount: data.invoiceAmount,
        outstanding:   data.outstanding,
        checks:        Array.isArray(data.checks) ? data.checks : [],
      });
    } catch (err) {
      message.error(`Failed to check eligibility: ${err instanceof Error ? err.message : String(err)}`);
      setCancelModalOpen(false);
    } finally {
      setCancelEligLoading(false);
    }
  }, [savedInvoiceId, initialData]);

  // Execute the cancellation
  const executeCancelInvoice = useCallback(async () => {
    const invoiceId = savedInvoiceId || initialData?.invoiceId;
    if (!invoiceId) return;
    setCancelExecuting(true);
    try {
      const steps: typeof cancelFlowDebug = [];

      // ── Step 1: Cancel invoice ────────────────────────────────────────
      const cancelUrl  = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/cancel`;
      const cancelBody = { cancelledBy: user?.username || 'SYSTEM' };
      steps.push({ step: '1 — Cancel Invoice', method: 'POST', url: cancelUrl, request: JSON.stringify(cancelBody, null, 2) });
      const res  = await fetch(cancelUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:   JSON.stringify(cancelBody),
      });
      const data = await res.json().catch(() => ({}));
      steps[0].status   = res.status;
      steps[0].ok       = res.ok && data.success !== false;
      steps[0].response = JSON.stringify(data, null, 2);

      if (data.success === false || res.status >= 400) {
        setCancelFlowDebug([...steps]);
        setCancelFlowModalVisible(true);
        message.error(data.message || data.error || 'Cancellation failed');
        return;
      }
      setCancelDone(true);
      setLiveHoldPaidStatus('Cancelled');
      message.success('Invoice cancelled successfully');

      // ── Step 2: Check for cancellation SLA header ─────────────────────
      const slaExistsUrl = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=${invoiceId}&eventType=INVOICE_CANCELLED`;
      steps.push({ step: '2 — Check Cancellation SLA (INVOICE_CANCELLED)', method: 'GET', url: slaExistsUrl });
      try {
        const slaRes  = await fetch(slaExistsUrl, { headers: { Accept: 'application/json' } });
        const slaData = await slaRes.json().catch(() => ({}));
        steps[1].status   = slaRes.status;
        steps[1].ok       = slaRes.ok && slaData.exists === true;
        steps[1].response = JSON.stringify(slaData, null, 2);

        if (slaData.exists && slaData.headerId) {
          setCancelSlaHeaderId(slaData.headerId);
          setCancelSlaStatus(slaData.accountingStatus);

          // ── Step 3: Fetch SLA lines for cancellation header ─────────
          const linesUrl = `${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${slaData.headerId}&limit=500`;
          steps.push({ step: `3 — Fetch Cancellation SLA Lines (headerId=${slaData.headerId})`, method: 'GET', url: linesUrl });
          let fetchedLines: any[] = [];
          try {
            const linesRes  = await fetch(linesUrl, { headers: { Accept: 'application/json' } });
            const linesData = await linesRes.json().catch(() => ({}));
            steps[2].status   = linesRes.status;
            steps[2].ok       = linesRes.ok;
            steps[2].response = JSON.stringify(linesData, null, 2);
            fetchedLines = linesData.items || [];
            setCancelSlaLines(fetchedLines);
          } catch (le: any) {
            steps[2].ok       = false;
            steps[2].response = `Network error: ${le.message}`;
          }

          // ── Step 4: Resolve ledger ──────────────────────────────────
          {
            const bu = form.getFieldValue('businessUnit') || '';
            const ledgerInfo = await fetchLedgerByBusinessUnit(bu).catch(() => null);
            steps.push({
              step: '4 — Resolve Ledger',
              method: 'GET',
              url: `${APEX_DB_CONFIG.baseUrl}/gl/ledgers?businessUnit=${encodeURIComponent(bu)}`,
              ok: !!ledgerInfo,
              response: ledgerInfo ? JSON.stringify(ledgerInfo, null, 2) : 'No ledger found for business unit',
            });

            // ── Steps 5-8: Post to GL ────────────────────────────────────
            if (fetchedLines.length > 0) {
              const invoiceNumber = form.getFieldValue('invoiceNumber');
              const currency      = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
              // Period/date from Accounting Date (fallback Invoice Date).
              // Previously hardcoded to TODAY — the cause of current-month
              // periods on journals for invoices dated in earlier months.
              const resolved = resolveAcctPeriod();
              if (!resolved) throw new Error('Accounting/Invoice date is missing — cannot post to GL.');
              const { acctDate, periodName } = resolved;
              const legalEntity   = fetchedLines.find((l: any) => l.legalEntity)?.legalEntity || '';

              const glLines: GlPostingLine[] = fetchedLines.map((l: any) => ({
                lineType:           l.lineType as 'DR' | 'CR',
                enteredDr:          l.enteredDr  || null,
                enteredCr:          l.enteredCr  || null,
                accountedDr:        l.accountedDr || null,
                accountedCr:        l.accountedCr || null,
                description:        l.description || '',
                currencyCode:       l.currencyCode || currency,
                accountingDate:     l.accountingDate || acctDate,
                accountCombination: l.accountCombination || '',
                accountingClass:    l.accountingClass || null,
                legalEntity:        l.legalEntity || null,
              }));

              steps.push({ step: '5–8 — Post Cancellation Journal to GL (duplicate check → create → PUT post → stamp SLA)', method: 'POST', url: '(postSlaToGL service — see glPosting.service.ts)' });
              const glStepIdx = steps.length - 1;

              const glResult = await postSlaToGL({
                slaHeaderId:    slaData.headerId,
                sourceNumber:   invoiceNumber,
                sourceId:       invoiceId,
                eventTypeCode:  'INVOICE_CANCELLED',
                periodName,
                ledgerName:     ledgerInfo?.ledgerName ?? '',
                ledgerId:       ledgerInfo?.ledgerId   ?? 0,
                currency,
                accountingDate: acctDate,
                legalEntity,
                businessUnit:    form.getFieldValue('businessUnit') || '',
                conversionRate:  Number(headerValues.conversionRate || form.getFieldValue('conversionRate') || 1),
                lines:           glLines,
                createdBy:       'user',
              });

              steps[glStepIdx].ok       = glResult.success;
              steps[glStepIdx].response = JSON.stringify(glResult, null, 2);

              if (glResult.success) {
                setCancelSlaStatus('POSTED');
                setCancelPostError(null);
                if (glResult.skipped) {
                  message.warning('Cancellation journal already in GL — SLA stamped.');
                } else {
                  message.success('Cancellation journal posted to GL successfully.');
                }
              } else {
                setCancelPostError(glResult.error || 'GL posting failed');
                message.error(`Post Cancellation failed: ${glResult.error}`);
              }
            } else {
              steps.push({ step: '5-8 — Post Cancellation Journal to GL', method: 'POST', url: '(skipped — no SLA lines returned in step 3; re-run sla_journals_ords.sql in APEX to fix the 500)', ok: false });
            }
          }
        } else {
          steps[1].ok = false;
          steps.push({ step: '3 — Fetch Cancellation SLA Lines', method: 'GET', url: '(skipped — no SLA header found in step 2)', ok: false });
          steps.push({ step: '4 — Resolve Ledger',               method: 'GET', url: '(skipped)', ok: false });
          steps.push({ step: '5-8 — Post Cancellation Journal to GL', method: 'POST', url: '(skipped)', ok: false });
        }
      } catch (se: any) {
        steps[1].ok       = false;
        steps[1].response = `Network error: ${se.message}`;
      }

      setCancelFlowDebug([...steps]);
      setCancelFlowModalVisible(true);
      handleRefreshStatus();
    } catch (err) {
      message.error(`Cancellation error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCancelExecuting(false);
    }
  }, [savedInvoiceId, initialData, user, handleRefreshStatus, form, headerValues, fetchLedgerByBusinessUnit]);

  const filteredSuppliers = useMemo(() => {
    if (!supplierSearchText) return suppliers;
    const search = supplierSearchText.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.supplier.toLowerCase().includes(search) ||
        s.supplierNumber.toLowerCase().includes(search) ||
        (s.alternativeName && s.alternativeName.toLowerCase().includes(search))
    );
  }, [suppliers, supplierSearchText]);

  // Fetch supplier balance dashboard (summary + aging)
  const fetchBalanceDashboard = async (supplierNum: string) => {
    setBalanceLoading(true);
    setBalanceSummary(null);
    setAgingReport([]);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/dashboard/${supplierNum}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.success === 'false') throw new Error(data.error || 'Failed to load balance data');

      setBalanceSummary({
        totalInvoices: data.balance_summary?.total_invoices || 0,
        totalInvoiceAmount: data.balance_summary?.total_invoice_amount || 0,
        totalPayments: data.balance_summary?.total_payments || 0,
        totalPaymentAmount: data.balance_summary?.total_payment_amount || 0,
        balance: data.balance_summary?.balance || 0,
        currency: data.balance_summary?.currency || 'AED',
      });
      setAgingReport(
        (data.aging_report || []).map((item: any) => ({
          bucket: item.bucket || '',
          amount: item.amount || 0,
          invoiceCount: item.invoice_count || 0,
          percentage: item.percentage || 0,
        }))
      );
    } catch (error) {
      console.error('Error fetching balance dashboard:', error);
      message.error(`Failed to load balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setBalanceLoading(false);
    }
  };

  // Fetch supplier balance invoices (filter: 'all' | 'paid' | 'unpaid')
  const fetchBalanceInvoices = async (supplierNum: string, filter: 'all' | 'paid' | 'unpaid' = 'unpaid') => {
    setBalanceInvoicesLoading(true);
    try {
      const statusParam = filter === 'all' ? 'All' : filter === 'paid' ? 'Paid' : 'Unpaid';
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/${supplierNum}?status=${statusParam}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.invoices || [];
      setBalanceInvoices(
        items.map((item: any, index: number) => ({
          key: item.invoice_id?.toString() || index.toString(),
          invoiceId: item.invoice_id,
          invoiceNumber: item.invoice_number || '',
          invoiceDate: item.invoice_date || '',
          invoiceAmount: item.invoice_amount || 0,
          amountPaid: item.amount_paid || 0,
          amountRemaining: item.amount_remaining || 0,
          invoiceStatus: item.invoice_status || '',
          currency: item.currency || 'AED',
          description: item.description || '',
        }))
      );
    } catch (error) {
      console.error('Error fetching balance invoices:', error);
      message.error('Failed to load invoices');
    } finally {
      setBalanceInvoicesLoading(false);
    }
  };

  // Fetch supplier balance payments
  const fetchBalancePayments = async (supplierNum: string) => {
    setBalancePaymentsLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payments/${supplierNum}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.payments || [];
      setBalancePayments(
        items.map((item: any, index: number) => ({
          key: item.payment_id?.toString() || index.toString(),
          paymentId: item.payment_id,
          paymentNumber: item.payment_number || '',
          paymentDate: item.payment_date || '',
          paymentAmount: item.payment_amount || 0,
          paymentStatus: item.payment_status || '',
          paymentMethod: item.payment_method || '',
          currency: item.currency || 'AED',
          bankAccountName: item.bank_account_name || '',
        }))
      );
    } catch (error) {
      console.error('Error fetching balance payments:', error);
      message.error('Failed to load payments');
    } finally {
      setBalancePaymentsLoading(false);
    }
  };

  // Fetch supplier prepayment balances
  const fetchBalancePrepayments = async (supplierNum: string) => {
    setBalancePrepaymentsLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/balances?supplier_number=${encodeURIComponent(supplierNum)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const text = await response.text();
      if (!text.trim()) { setBalancePrepayments([]); return; }
      const data = JSON.parse(text);
      setBalancePrepayments(Array.isArray(data) ? data : (data.items || []));
    } catch (error) {
      console.error('Error fetching prepayments:', error);
      setBalancePrepayments([]);
    } finally {
      setBalancePrepaymentsLoading(false);
    }
  };

  // Open supplier balance popup
  const handleCheckBalance = () => {
    const supplierName = form.getFieldValue('supplier');
    const supplierNum = form.getFieldValue('supplierNumber');
    if (!supplierNum) {
      message.warning('Please select a supplier first');
      return;
    }
    setBalanceSupplierName(supplierName);
    setBalanceSupplierNumber(supplierNum);
    setBalanceModalVisible(true);
    setBalanceActiveTab('invoices');
    setBalanceInvoices([]);
    setBalancePayments([]);
    setBalancePrepayments([]);
    setBalanceInvoiceFilter('unpaid');
    fetchBalanceDashboard(supplierNum);
    fetchBalanceInvoices(supplierNum, 'unpaid');
  };

  // Handle balance tab change (lazy-load payments & prepayments)
  const handleBalanceTabChange = (key: string) => {
    setBalanceActiveTab(key);
    if (key === 'payments' && balancePayments.length === 0 && !balancePaymentsLoading) {
      fetchBalancePayments(balanceSupplierNumber);
    }
    if (key === 'prepayments' && balancePrepayments.length === 0 && !balancePrepaymentsLoading) {
      fetchBalancePrepayments(balanceSupplierNumber);
    }
  };

  const supplierColumns: ColumnsType<SupplierRecord> = [
    {
      title: 'Action', key: 'action', width: 80,
      render: (_: any, record: SupplierRecord) => (
        <Button type="link" size="small" onClick={() => handleSupplierSelect(record)} style={{ color: REDWOOD.info }}>Select</Button>
      ),
    },
    { title: 'Supplier Number', dataIndex: 'supplierNumber', key: 'supplierNumber', width: 130, sorter: (a, b) => a.supplierNumber.localeCompare(b.supplierNumber) },
    { title: 'Supplier Name', dataIndex: 'supplier', key: 'supplier', width: 280, ellipsis: true, sorter: (a, b) => a.supplier.localeCompare(b.supplier) },
    { title: 'Alternative Name', dataIndex: 'alternativeName', key: 'alternativeName', width: 200, ellipsis: true },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (status: string) => <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{status}</Tag> },
    { title: 'Taxpayer ID', dataIndex: 'taxpayerId', key: 'taxpayerId', width: 120 },
  ];

  // Line management
  const addLine = () => {
    const nextLine = lines.length + 1;
    // Inherit accounting date from header invoice date, tax classification, and accrual account
    const invoiceDate = form.getFieldValue('invoiceDate');
    const defaultAcctDate = invoiceDate?.format?.('DD-MMM-YYYY') || '';
    const existingTax = lines.find((l) => l.taxClassification)?.taxClassification || '';
    const defaultAccrual = form.getFieldValue('liabilityDistribution') || '';
    const headerDescription = form.getFieldValue('description') || '';
    setLines([...lines, createBlankLine(nextLine, { accountingDate: defaultAcctDate, taxClassification: existingTax, accrualAccount: defaultAccrual, description: headerDescription })]);
  };

  const removeLines = () => {
    if (selectedLineKeys.length === 0) {
      message.warning('Select lines to delete');
      return;
    }
    const filtered = lines.filter((l) => !selectedLineKeys.includes(l.key));
    const renumbered = filtered.map((l, idx) => ({ ...l, lineNumber: idx + 1 }));
    setLines(renumbered);
    setSelectedLineKeys([]);
  };

  // ========== Import Lines Logic ==========
  const VALID_TYPES = ['Item', 'Freight', 'Miscellaneous', 'Tax', 'Prepay'];

  const normalizeType = (raw: string): string => {
    if (!raw) return 'Item';
    const lower = raw.trim().toLowerCase();
    const match = VALID_TYPES.find((t) => t.toLowerCase() === lower);
    return match || 'Item';
  };

  const parseImportRows = (rows: Record<string, any>[]): { type: string; amount: number; description: string }[] => {
    return rows
      .map((row) => {
        // Flexible column matching (case-insensitive)
        const keys = Object.keys(row);
        const findCol = (names: string[]) => keys.find((k) => names.includes(k.trim().toLowerCase()));
        const typeKey = findCol(['type', 'line type', 'linetype']);
        const amountKey = findCol(['amount', 'line amount', 'lineamount', 'amt']);
        const descKey = findCol(['description', 'desc', 'line description', 'linedescription', 'memo']);

        const rawAmt = amountKey ? row[amountKey] : 0;
        const amount = typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt).replace(/,/g, '')) || 0;

        return {
          type: normalizeType(typeKey ? String(row[typeKey]) : ''),
          amount,
          description: descKey ? String(row[descKey] || '') : '',
        };
      })
      .filter((r) => r.amount !== 0 || r.description.trim() !== '');
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(firstSheet);
        const parsed = parseImportRows(jsonRows as Record<string, any>[]);
        if (parsed.length === 0) {
          message.warning('No valid rows found in file. Ensure columns: Type, Amount, Description');
          return;
        }
        setImportPreviewData(parsed);
        message.success(`${parsed.length} line(s) parsed from file`);
      } catch {
        message.error('Failed to parse file. Please use the template format.');
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // prevent antd auto upload
  };

  const handlePasteImport = () => {
    if (!pasteText.trim()) {
      message.warning('Paste data first');
      return;
    }
    // Parse tab/comma separated text
    const rawLines = pasteText.trim().split('\n');
    const parsed: { type: string; amount: number; description: string }[] = [];

    for (const rawLine of rawLines) {
      // Try tab-separated first, then comma
      const cols = rawLine.includes('\t') ? rawLine.split('\t') : rawLine.split(',');
      if (cols.length >= 2) {
        const firstCol = cols[0].trim();
        // Detect if first col is a type or an amount
        const isType = VALID_TYPES.some((t) => t.toLowerCase() === firstCol.toLowerCase());
        if (isType) {
          parsed.push({
            type: normalizeType(firstCol),
            amount: parseFloat(String(cols[1]).replace(/,/g, '')) || 0,
            description: (cols.slice(2).join(',') || '').trim(),
          });
        } else {
          // Assume: amount, description (default type Item)
          const amt = parseFloat(String(cols[0]).replace(/,/g, ''));
          if (!isNaN(amt)) {
            parsed.push({
              type: 'Item',
              amount: amt,
              description: (cols.slice(1).join(',') || '').trim(),
            });
          }
        }
      }
    }

    if (parsed.length === 0) {
      message.warning('No valid rows detected. Use format: Type, Amount, Description (or just Amount, Description)');
      return;
    }
    setImportPreviewData(parsed);
    message.success(`${parsed.length} line(s) parsed from pasted data`);
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Type', 'Amount', 'Description'],
      ['Item', 1000, 'Office Supplies'],
      ['Item', 2500, 'IT Equipment'],
      ['Freight', 150, 'Shipping Charges'],
    ]);
    ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice Lines');
    XLSX.writeFile(wb, 'invoice_lines_template.xlsx');
    message.success('Template downloaded');
  };

  const handleConfirmImport = () => {
    if (importPreviewData.length === 0) {
      message.warning('No lines to import');
      return;
    }
    const invoiceDate = form.getFieldValue('invoiceDate');
    const defaultAcctDate = invoiceDate?.format?.('DD-MMM-YYYY') || '';
    const existingTax = lines.find((l) => l.taxClassification)?.taxClassification || '';
    const defaultAccrual = form.getFieldValue('liabilityDistribution') || '';

    // Filter out empty placeholder lines
    const existingNonEmpty = lines.filter((l) => l.amount !== 0 || l.description.trim() !== '' || l.distributionCombination);
    const startNum = existingNonEmpty.length + 1;

    const newLines = importPreviewData.map((row, idx) => {
      const line = createBlankLine(startNum + idx, { accountingDate: defaultAcctDate, taxClassification: existingTax, accrualAccount: defaultAccrual });
      line.type = row.type;
      line.amount = row.amount;
      line.description = row.description;
      // Compute tax
      const lineRate = getTaxRateForClassification(existingTax);
      line.taxAmount = Math.round(row.amount * (lineRate / 100) * 100) / 100;
      return line;
    });

    // If first line is empty placeholder, replace it
    const firstLineEmpty = lines.length === 1 && lines[0].amount === 0 && !lines[0].description && !lines[0].distributionCombination;
    if (firstLineEmpty) {
      // Renumber imported lines from 1
      newLines.forEach((l, i) => { l.lineNumber = i + 1; });
      setLines(newLines);
    } else {
      setLines([...existingNonEmpty, ...newLines]);
    }

    setImportModalVisible(false);
    setImportPreviewData([]);
    setPasteText('');
    setIsValidated(false);
    message.success(`${newLines.length} line(s) imported`);
  };

  const applyCompanySegment = useCallback((combo: string): string => {
    if (!derivedCompany || !combo) return combo;
    const parts = combo.split('-');
    parts[0] = derivedCompany;
    return parts.join('-');
  }, [derivedCompany]);

  const updateLine = useCallback((key: string, field: string, value: any) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const updated = { ...line, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          updated.amount = (field === 'quantity' ? value : updated.quantity) * (field === 'unitPrice' ? value : updated.unitPrice);
        }
        // Recalculate line-level tax when amount or taxClassification changes
        if (field === 'amount' || field === 'quantity' || field === 'unitPrice' || field === 'taxClassification') {
          const lineAmount = updated.amount || 0;
          const lineRate = taxRateMapRef.current[updated.taxClassification] ?? getTaxRateForClassification(updated.taxClassification);
          updated.taxAmount = Math.round(lineAmount * (lineRate / 100) * 100) / 100;
        }
        if (field === 'taxClassification') {
          updated.taxAccountCombination = taxAccountMapRef.current[updated.taxClassification] || '';
        }
        // Auto-derive multiperiod dates when accounting date changes
        if (field === 'accountingDate' && value) {
          updated.startDate = value;
          updated.endDate = getEndOfMonth(value);
        }
        return updated;
      })
    );
    setIsValidated(false);
  }, []);

  // Open account selector for a line
  const openAccountSelector = (lineKey: string, initialValue?: string, field: 'distributionCombination' | 'accrualAccount' = 'distributionCombination') => {
    setEditingLineKey(lineKey);
    setEditingLineField(field);
    setAccountSelectorInitialValue(initialValue);
    setAccountSelectorVisible(true);
  };

  // Handle account code validation on blur
  const handleAccountBlur = async (lineKey: string, accountCode: string) => {
    if (!accountCode || accountCode.trim() === '' || !accountCode.includes('-')) return;
    // always enforce company segment before validation
    const normalised = applyCompanySegment(accountCode);
    if (normalised !== accountCode) {
      setLines((prev) => prev.map((l) => l.key === lineKey ? { ...l, distributionCombination: normalised } : l));
    }

    try {
      const result = await validateAccountCode(normalised);
      if (!result.segmentsLoaded) {
        message.info('Could not load segment data for validation.');
        return;
      }
      const naturalValue = normalised.split('-')[3] || '';
      const natDesc = Object.values(result.segmentDetails).find(s => s.value === naturalValue)?.description || '';
      if (!result.isValid) {
        message.warning(`Invalid segment value(s): ${result.invalidSegments.join(', ')}. Please correct using the account selector.`);
        setLines((prev) =>
          prev.map((line) =>
            line.key === lineKey ? { ...line, distributionCombination: result.validatedCode, accountDescription: natDesc } : line
          )
        );
        openAccountSelector(lineKey, result.validatedCode);
      } else {
        message.success('Account code validated successfully');
        if (natDesc) {
          setLines((prev) =>
            prev.map((line) =>
              line.key === lineKey ? { ...line, accountDescription: natDesc } : line
            )
          );
        }
      }
    } catch (error) {
      console.error('Error validating account code:', error);
    }
  };

  // Handle account selection from popup
  const handleAccountSelect = (accountCode: string, segments: Record<string, { value: string; description: string }>) => {
    const naturalValue = accountCode.split('-')[3] || '';
    const natDesc = Object.values(segments).find(s => s.value === naturalValue)?.description || '';

    if (editingLineKey === '__liability__') {
      // Liability distribution (header)
      form.setFieldValue('liabilityDistribution', accountCode);
      setHeaderValues((prev) => ({ ...prev, liabilityDistribution: accountCode }));
    } else if (editingLineKey) {
      const field = editingLineField; // 'distributionCombination' or 'accrualAccount'

      // Set on the current line only — user can click the Apply icon to propagate
      setLines((prev) =>
        prev.map((line) =>
          line.key === editingLineKey
            ? { ...line, [field]: accountCode, ...(field === 'distributionCombination' ? { accountDescription: natDesc } : {}) }
            : line
        )
      );
    }
    setAccountSelectorVisible(false);
    setEditingLineKey(null);
  };

  // Totals
  const linesTotal = useMemo(() => {
    return lines.reduce((sum, l) => sum + (l.amount || 0), 0);
  }, [lines]);

  // Tax total: sum per-line taxAmount (already computed in updateLine)
  const taxTotal = useMemo(() => lines.reduce((sum, l) => sum + (l.taxAmount || 0), 0), [lines]);

  // Tally validation: header amount must equal lines total + tax
  const headerInvoiceAmount = headerValues.invoiceAmount || 0;
  const computedTotal = linesTotal + taxTotal;
  // Any non-voided payment recorded → treat invoice as paid
  const hasAnyPayment = invoicePayments.filter(p => !p.status?.toLowerCase().includes('void')).length > 0;
  const isTallyMismatch = useMemo(() => {
    if (!isHeaderComplete) return false;
    if (linesTotal === 0) return false;
    return Math.abs(headerInvoiceAmount - computedTotal) > 0.01;
  }, [isHeaderComplete, headerInvoiceAmount, computedTotal, linesTotal]);

  // ── Reactive installment sync ────────────────────────────────────────────
  // When the header invoice amount, due date, or payment method changes,
  // keep the single installment row in sync automatically.
  // Once the user splits into multiple rows we stop auto-updating.
  useEffect(() => {
    const amt = headerValues.invoiceAmount || 0;
    setInstEditRows(prev => {
      if (prev.length !== 1) return prev;          // user split — leave as-is
      if (prev[0].grossAmount === amt) return prev; // no change
      return [{ ...prev[0], grossAmount: amt, unpaidAmount: amt }];
    });
  }, [headerValues.invoiceAmount]);

  useEffect(() => {
    const rawDue = headerValues.termsDate || headerValues.invoiceDate;
    if (!rawDue) return;
    const due = dayjs.isDayjs(rawDue) ? rawDue : dayjs(rawDue);
    setInstEditRows(prev => {
      if (prev.length !== 1) return prev;
      return [{ ...prev[0], dueDate: due }];
    });
  }, [headerValues.termsDate, headerValues.invoiceDate]);

  useEffect(() => {
    if (!headerValues.paymentMethod) return;
    setInstEditRows(prev => {
      if (prev.length !== 1) return prev;
      return [{ ...prev[0], paymentMethod: headerValues.paymentMethod }];
    });
  }, [headerValues.paymentMethod]);

  // Fetch BMS rate when invoice currency is a foreign currency
  const fetchBmsRate = useCallback(() => {
    const currency = headerValues.invoiceCurrency;
    if (!currency || currency === 'AED') {
      setBmsRate(null);
      return;
    }
    setBmsRateLoading(true);
    setBmsRate(null);
    const convDate = (form.getFieldValue('conversionDate') as any)?.format?.('YYYY-MM-DD');
    const datePart = convDate ? `&rate_date=${convDate}` : '';
    fetch(`${buildCurrencyUrl('currencies/bmsrate')}?source_cur=${currency}&target_cur=AED${datePart}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'ok') {
          setBmsRate({ rate: data.rate, inverseRate: data.inverseRate, rateType: data.rateType, rateDate: data.rateDate });
          // Auto-fill only if conversionRate is currently empty
          const currentRate = form.getFieldValue('conversionRate');
          if (!currentRate) {
            form.setFieldsValue({
              conversionRate: data.rate,
              conversionRateType: data.rateType || 'Corporate',
              conversionDate: dayjs(data.rateDate),
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setBmsRateLoading(false));
  }, [headerValues.invoiceCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchBmsRate();
  }, [headerValues.invoiceCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
  // ────────────────────────────────────────────────────────────────────────

  // Invoice Actions dropdown menu items
  // For synced invoices: only show View Accounting, Manage Installments, Pay in Full (if unpaid)
  // For cancelled invoices: only view actions (no edits, no payments, no new actions)
  // Create Accounting is NOT available for synced invoices (they are accounted in Oracle Fusion)
  const isCreditMemoType = headerValues.invoiceType === 'Credit Memo';
  // Cancelled invoices: only view actions; hide accounting items if never posted
  const cancelledOnlyActions: MenuProps['items'] = [
    ...(isPostedToGL ? [
      { key: 'viewAccounting', icon: <AccountBookOutlined />, label: 'View Accounting' } as const,
      { type: 'divider' as const },
    ] : []),
    { key: 'manageInstallments', icon: <ScheduleOutlined />, label: 'Manage Installments' },
    { type: 'divider' as const },
    { key: 'multiperiodSchedule', icon: <CalendarOutlined />, label: 'Multiperiod Accounting' },
  ];
  const invoiceActionItems: MenuProps['items'] = isCancelled
    ? cancelledOnlyActions
    : isInvoiceSynced
    ? [
        {
          key: 'viewAccounting',
          icon: <AccountBookOutlined />,
          label: 'View Accounting',
        },
        { type: 'divider' as const },
        {
          key: 'manageInstallments',
          icon: <ScheduleOutlined />,
          label: 'Manage Installments',
        },
        { type: 'divider' as const },
        {
          key: 'multiperiodSchedule',
          icon: <CalendarOutlined />,
          label: 'Multiperiod Accounting',
        },
        ...(!isPaid && !isCreditMemoType ? [
          { type: 'divider' as const },
          {
            key: 'payInFull',
            icon: <CreditCardOutlined />,
            label: 'Pay in Full',
          },
        ] : []),
      ]
    : [
        {
          key: 'validate',
          icon: <CheckSquareOutlined />,
          label: isValidated ? 'Revalidate' : 'Validate',
        },
        { type: 'divider' as const },
        {
          key: 'manageInstallments',
          icon: <ScheduleOutlined />,
          label: 'Manage Installments',
        },
        { type: 'divider' as const },
        {
          key: 'multiperiodSchedule',
          icon: <CalendarOutlined />,
          label: 'Multiperiod Accounting',
        },
        { type: 'divider' as const },
        {
          key: 'calculateTax',
          icon: <CalculatorOutlined />,
          label: 'Calculate Tax',
        },
        { type: 'divider' as const },
        ...(!isCreditMemoType ? [{
          key: 'payInFull',
          icon: <CreditCardOutlined />,
          label: 'Pay in Full',
        }] : []),
        {
          key: 'applyPrepayment',
          icon: <DollarOutlined />,
          label: 'Apply Prepayment',
        },
        {
          key: 'voidPayment',
          icon: <StopOutlined />,
          label: 'Void Payment',
          danger: true,
        },
        {
          key: 'placeHold',
          icon: <LockOutlined />,
          label: 'Place Hold',
        },
        {
          key: 'releaseHold',
          icon: <UnlockOutlined />,
          label: 'Release Hold',
        },
        { type: 'divider' as const },
        {
          key: 'initiateApproval',
          icon: <SendOutlined />,
          label: 'Initiate Approval',
        },
        {
          key: 'cancelInvoice',
          icon: <StopOutlined />,
          label: 'Cancel Invoice',
        },
        {
          key: 'reverseInvoice',
          icon: <RollbackOutlined />,
          label: 'Reverse Invoice',
        },
        { type: 'divider' as const },
        {
          key: 'duplicate',
          icon: <CopyOutlined />,
          label: 'Duplicate Invoice',
        },
      ];

  // Persist validation status to RR_AP_INVOICES_ALL.VALIDATION_STATUS
  const saveValidationStatus = async (invoiceId: number, status: string) => {
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/validation-status`;
    console.log(`[ValidationStatus] PUT ${url}`, { VALIDATION_STATUS: status });
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ VALIDATION_STATUS: status }),
      });
      const text = await res.text();
      console.log(`[ValidationStatus] Response ${res.status}:`, text);
      if (!res.ok) {
        console.warn(`[ValidationStatus] PUT failed (${res.status}): ${text}`);
        message.warning(`Validation status not saved to DB (HTTP ${res.status}) — check APEX handler`);
      }
    } catch (e) {
      console.warn('[ValidationStatus] PUT error:', e);
    }
  };

  // Handle invoice action menu clicks
  // Run all validations and show checklist
  const runValidation = () => {
    const values = form.getFieldsValue();
    const results: { label: string; passed: boolean; detail?: string; subItems?: any[]; action?: any }[] = [];

    // 1. Required header fields
    const requiredFields = ['businessUnit', 'invoiceNumber', 'invoiceCurrency', 'invoiceAmount', 'invoiceDate', 'supplier', 'invoiceType', 'paymentTerms'];
    const missingHeader = requiredFields.filter((f) => !values[f]);
    results.push({
      label: 'Required header fields',
      passed: missingHeader.length === 0,
      detail: missingHeader.length > 0 ? `Missing: ${missingHeader.join(', ')}` : undefined,
    });

    // 2. Liability Distribution
    const liabilityDist = values.liabilityDistribution;
    results.push({
      label: 'Liability Distribution',
      passed: !!liabilityDist && liabilityDist.trim() !== '',
      detail: !liabilityDist ? 'Liability distribution is required' : undefined,
    });

    // 3. Liability account ≠ Accrual account on multiperiod lines
    const mpaLinesConflict = lines.filter((l) => {
      const isMpa = !!(l.accrualAccount && l.startDate && l.endDate &&
        dayjs(l.startDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM') !==
        dayjs(l.endDate,   ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM'));
      return isMpa && liabilityDist && l.accrualAccount &&
        l.accrualAccount.trim() === liabilityDist.trim();
    });
    results.push({
      label: 'Liability ≠ Accrual account (multiperiod lines)',
      passed: mpaLinesConflict.length === 0,
      detail: mpaLinesConflict.length > 0
        ? `Line(s) ${mpaLinesConflict.map(l => l.lineNumber).join(', ')}: accrual account is the same as the liability account (${liabilityDist}). They must be different accounts.`
        : undefined,
      subItems: mpaLinesConflict.map((l) => ({
        label: `Line ${l.lineNumber}`,
        detail: `${l.description || 'Item'} — accrual account "${l.accrualAccount}" matches liability distribution`,
      })),
    });

    // 4. Line distributions — check every line that has data
    const activeLines = lines.filter((l) => l.amount !== 0 || l.description);
    const linesWithoutDist = activeLines.filter(
      (l) => !l.distributionCombination && !l.distributionSet
    );
    const hasLineData = activeLines.length > 0;
    results.push({
      label: 'Line distributions',
      passed: linesWithoutDist.length === 0 && hasLineData,
      detail: !hasLineData
        ? 'At least one line is required'
        : linesWithoutDist.length > 0
        ? `${linesWithoutDist.length} line(s) missing distribution`
        : undefined,
      subItems: linesWithoutDist.map((l) => ({
        label: `Line ${l.lineNumber}`,
        detail: `${l.description || l.type || 'Item'} — ${formatAmount(l.amount)}`,
        action: {
          label: 'Select Distribution',
          onClick: () => {
            setValidationModalVisible(false);
            setTimeout(() => openAccountSelector(l.key, ''), 150);
          },
        },
      })),
    });

    // 4. Invoice amount vs lines + tax tally
    const hdrAmt = values.invoiceAmount || 0;
    const tallyOk = linesTotal === 0 || Math.abs(hdrAmt - computedTotal) <= 0.01;
    results.push({
      label: 'Amount tally (Header vs Lines + Tax)',
      passed: tallyOk,
      detail: !tallyOk ? `Header: ${formatAmount(hdrAmt)}, Lines + Tax: ${formatAmount(computedTotal)}` : undefined,
      action: !tallyOk && computedTotal > 0 ? {
        label: `Update header to ${formatAmount(computedTotal)}`,
        onClick: () => {
          form.setFieldValue('invoiceAmount', computedTotal);
          setHeaderValues((prev) => ({ ...prev, invoiceAmount: computedTotal }));
          message.success(`Header amount updated to ${formatAmount(computedTotal)}`);
          setValidationModalVisible(false);
          setTimeout(() => runValidation(), 100);
        },
      } : undefined,
    });

    // 5. Conversion rate for non-AED currency
    const currency = values.invoiceCurrency || 'AED';
    const convRate = values.conversionRate;
    const needsRate = currency !== 'AED';
    results.push({
      label: 'Conversion rate (non-AED)',
      passed: !needsRate || (!!convRate && convRate > 0),
      detail: needsRate && !convRate ? `Currency is ${currency} — conversion rate is required` : undefined,
    });

    // 6. Tax classification on all amount lines
    const linesWithAmountNoTax = lines.filter((l) => (l.amount || 0) !== 0 && !l.taxClassification);
    results.push({
      label: 'Tax classification on invoice lines',
      passed: linesWithAmountNoTax.length === 0,
      detail: linesWithAmountNoTax.length > 0
        ? `${linesWithAmountNoTax.length} line(s) are missing a tax classification`
        : undefined,
      subItems: linesWithAmountNoTax.map((l) => ({
        label: `Line ${l.lineNumber}`,
        detail: `${l.description || 'Item'} — ${formatAmount(l.amount)}`,
      })),
    });

    // 6b. Tax account must be set for every taxed line
    const linesWithTaxNoAccount = lines.filter(
      (l) => l.taxClassification && !l.taxAccountCombination && !taxAccountMapRef.current[l.taxClassification]
    );
    results.push({
      label: 'Tax GL account on taxed lines',
      passed: linesWithTaxNoAccount.length === 0,
      detail: linesWithTaxNoAccount.length > 0
        ? `${linesWithTaxNoAccount.length} line(s) have a tax code with no GL account assigned in Tax Setup`
        : undefined,
      subItems: linesWithTaxNoAccount.map((l) => ({
        label: `Line ${l.lineNumber}`,
        detail: `Tax code "${l.taxClassification}" has no account — assign one in Tax Setup → BU Assignments`,
      })),
    });

    // 7. At least one line
    results.push({
      label: 'Invoice lines exist',
      passed: lines.some((l) => l.amount !== 0 || l.description),
      detail: !lines.some((l) => l.amount !== 0 || l.description) ? 'Add at least one invoice line' : undefined,
    });

    // 7. Installments total must equal invoice amount (only if installments exist)
    if (instEditRows.length > 0) {
      const instGrossTotal = instEditRows.reduce((s, r) => s + (r.grossAmount || 0), 0);
      const instBalanced   = Math.abs(instGrossTotal - hdrAmt) <= 0.01;
      results.push({
        label: 'Installments total matches invoice amount',
        passed: instBalanced,
        detail: !instBalanced
          ? `Installments total: ${formatAmount(instGrossTotal)}, Invoice amount: ${formatAmount(hdrAmt)} (diff: ${formatAmount(instGrossTotal - hdrAmt)})`
          : undefined,
        action: !instBalanced ? {
          label: 'Open Installments',
          onClick: () => {
            setValidationModalVisible(false);
            setTimeout(() => setInstEditVisible(true), 150);
          },
        } : undefined,
      });
    }

    const allPassed = results.every((r) => r.passed);
    setValidationResults(results);
    setIsValidated(allPassed);
    const newStatus = allPassed ? 'Validated' : 'Needs Revalidation';
    setLiveValidationStatus(newStatus);
    setValidationModalVisible(true);

    const invoiceId = savedInvoiceId ?? initialData?.invoiceId ?? null;
    if (invoiceId) {
      saveValidationStatus(invoiceId, newStatus);
    }

    if (allPassed) {
      message.success('Validation passed — invoice is ready to save');
    }
  };

  const fetchInstallmentsForModal = async () => {
    const invoiceId = savedInvoiceId ?? initialData?.invoiceId ?? null;
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments?P_INVOICE_ID=${invoiceId ?? ''}`;
    setInstallmentsModalUrl(url);
    if (!invoiceId) { message.warning('Invoice ID not available'); return; }
    setInstallmentsModalLoading(true);
    console.log('[Installments] Fetching:', url);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items = data.items || (Array.isArray(data) ? data : []);
      setInstallmentsModalData(items);
    } catch (err) {
      console.error('Error fetching installments:', err);
      message.error('Failed to load installments');
      setInstallmentsModalData([]);
    } finally {
      setInstallmentsModalLoading(false);
    }
  };

  // ── Pay in Full helpers ─────────────────────────────────────────────────
  const fetchPayInFullBankAccounts = async (legalEntityName: string) => {
    setPayInFullBankLoading(true);
    try {
      const response = await fetch(`${APEX_DB_CONFIG.baseUrl}/banks/bankaccounts`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const all = (data.items || []).map((item: any) => ({
        bankAccountName:                 item.bank_account_name   || '',
        bankAccountNumber:               item.bank_account_num    || item.bank_account_number || '',
        currencyCode:                    item.currency_code       || '',
        legalEntityName:                 item.legal_entity_name   || '',
        cashAccountCombination:          item.cash_account_combination          || '',
        pdcAccountCombination:           item.pdc_account_combination           || '',
        cashClearingAccountCombination:  item.cash_clearing_account_combination || '',
      }));
      const filtered = legalEntityName
        ? all.filter((a: any) => a.legalEntityName.trim().toLowerCase() === legalEntityName.trim().toLowerCase())
        : all;
      setPayInFullBankAccounts(filtered);
      if (filtered.length === 0)
        message.warning(`No bank accounts found for legal entity "${legalEntityName}"`);
    } catch {
      message.error('Failed to load bank accounts');
    } finally {
      setPayInFullBankLoading(false);
    }
  };

  const executePayStep = useCallback(async (step: number, method: string, url: string, body: object) => {
    setStepLoading(prev => ({ ...prev, [step]: true }));
    setStepResults(prev => { const n = { ...prev }; delete n[step]; return n; });
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      // Read as text first — ORDS can return HTML error pages for system errors
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      const isAppError = data?.status === 'error';
      if (step === 1 && data?.checkId != null) {
        setStep1CheckId(data.checkId);
      }
      setStepResults(prev => ({
        ...prev,
        [step]: { status: (res.ok && !isAppError) ? 'success' : 'error', data },
      }));
    } catch (err: any) {
      setStepResults(prev => ({ ...prev, [step]: { status: 'error', data: { message: err?.message ?? 'Network error' } } }));
    } finally {
      setStepLoading(prev => ({ ...prev, [step]: false }));
    }
  }, []);

  const generatePayInFullVoucherPdf = () => {
    const fv      = payInFullForm.getFieldsValue();
    const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW   = doc.internal.pageSize.getWidth();
    const fmt     = (v: any) => (v != null && v !== '') ? String(v) : '—';
    const fmtAmt  = (v: any) => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const fmtDt   = (v: any) => {
      if (!v) return '—';
      try { return new Date(v instanceof Object ? v.toDate?.() ?? v : v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return String(v); }
    };
    const invoiceNum   = form.getFieldValue('invoiceNumber') || '—';
    const supplier     = form.getFieldValue('supplier') || '—';
    const supplierNum  = form.getFieldValue('supplierNumber') || '—';
    const supplierSite = form.getFieldValue('supplierSite') || '—';
    const buName       = form.getFieldValue('businessUnit') || headerValues.businessUnit || '—';
    const currency     = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
    const balance      = invoiceBalance ?? (computedTotal - invoicePayments.filter(p => p.status !== 'Voided').reduce((s, p) => s + p.paidAmount, 0));
    const paymentNum   = step1CheckId ? String(step1CheckId) : '(New)';

    // Header bar
    doc.setFillColor(191, 70, 0);
    doc.rect(0, 0, pageW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('PAYMENT VOUCHER', 14, 13);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Printed: ${new Date().toLocaleString()}`, pageW - 14, 13, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    let y = 28;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(191, 70, 0);
    doc.text(`Payment #${paymentNum}`, 14, y);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(`Invoice: ${invoiceNum}`, 14, y + 6);
    doc.setTextColor(0, 0, 0);
    y += 14;

    // Section 1: Payee & Organisation
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Payee & Organisation', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ['Business Unit', fmt(buName),       'Payee',      fmt(supplier)],
        ['Supplier #',    fmt(supplierNum),   'Payee Site', fmt(supplierSite)],
        ['Bank Account',  fmt(fv.disbursementBankAccount), 'Pay Currency', fmt(fv.paymentCurrency || currency)],
      ],
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, fillColor: [245, 245, 245] }, 2: { fontStyle: 'bold', cellWidth: 40, fillColor: [245, 245, 245] } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section 2: Payment Details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Payment Details', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ['Payment Date',    fmtDt(fv.paymentDate),    'Payment Method', fmt(fv.paymentMethod)],
        ['Conv. Rate Type', fmt(fv.conversionRateType),'Conv. Rate',    fmt(fv.conversionRate)],
        ['Conv. Date',      fmtDt(fv.conversionDate),  'Maturity Date', fmtDt(fv.maturityDate)],
        ['Paper Doc #',     fmt(fv.paperDocumentNumber),'Voucher #',    fmt(fv.voucherNumber)],
        ['Reference',       fmt(fv.paymentReference),  'Description',   fmt(fv.description)],
      ],
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, fillColor: [245, 245, 245] }, 2: { fontStyle: 'bold', cellWidth: 40, fillColor: [245, 245, 245] } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Section 3: Invoice Being Paid
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Invoice Being Paid', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Invoice #', 'Currency', 'Payment Amount']],
      body: [[invoiceNum, currency, fmtAmt(balance)]],
      foot: [['', 'Total', fmtAmt(balance)]],
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [58, 58, 58], textColor: 255 },
      footStyles: { fillColor: [230, 230, 230], fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    // Signature block
    if (y > 240) { doc.addPage(); y = 20; }
    const sigY = Math.max(y + 10, 250);
    const sigW = (pageW - 28 - 20) / 3;
    doc.setDrawColor(200, 200, 200);
    ['Prepared By', 'Reviewed By', 'Approved By'].forEach((label, i) => {
      const sx = 14 + i * (sigW + 10);
      doc.line(sx, sigY, sx + sigW, sigY);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(label, sx + sigW / 2, sigY + 5, { align: 'center' });
    });

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 290, { align: 'center' });
      doc.text('Generated by ReactERP', 14, 290);
      doc.setTextColor(0);
    }

    const blob = doc.output('blob');
    const url  = URL.createObjectURL(blob);
    setPayInFullPdfUrl(url);
    setPayInFullPdfOpen(true);
  };

  const openPayInFullModal = async () => {
    const buName = form.getFieldValue('businessUnit') || headerValues.businessUnit || '';
    payInFullForm.resetFields();
    payInFullForm.setFieldsValue({
      businessUnit:  buName,
      supplier:      form.getFieldValue('supplier') || '',
      invoiceNumber: form.getFieldValue('invoiceNumber') || '',
      payAmount:     invoiceBalance !== null
        ? invoiceBalance
        : computedTotal - invoicePayments
          .filter(p => p.status !== 'Voided')
          .reduce((sum, p) => sum + p.paidAmount, 0),
      currency:            headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED',
      paymentCurrency:     headerValues.paymentCurrency || headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED',
      paymentBaseCurrency: 'AED',
      paymentDate:         dayjs(),
      conversionRateType:  form.getFieldValue('conversionRateType') || undefined,
      conversionDate:      form.getFieldValue('conversionDate') || undefined,
      conversionRate:      form.getFieldValue('conversionRate') || undefined,
    });
    setPayInFullOpen(true);

    // Always fetch fresh installments when opening the modal so the table is up to date
    const invoiceId = savedInvoiceId ?? initialData?.invoiceId;
    if (invoiceId) {
      fetchInvoiceInstallments(invoiceId);
    }

    // Step 1: fetch BUs to resolve legalEntityName for the current BU
    try {
      const buRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, {
        headers: { Accept: 'application/json' },
      });
      if (!buRes.ok) throw new Error(`HTTP ${buRes.status}`);
      const buData = await buRes.json();
      const buList = (buData.items || []).map((item: any) => ({
        name:            item.business_unit_name || item.name || '',
        legalEntityName: item.legal_entity_name  || '',
      }));
      const matched = buList.find((b: any) => b.name === buName);
      const legalEntityName = matched?.legalEntityName || '';
      console.log(`[Pay in Full] BU="${buName}" → legalEntity="${legalEntityName}"`);
      // Step 2: fetch bank accounts filtered by legalEntityName
      fetchPayInFullBankAccounts(legalEntityName);
    } catch {
      // fallback: load all accounts
      fetchPayInFullBankAccounts('');
    }
  };
  // ────────────────────────────────────────────────────────────────────────

  const handleInvoiceAction = async ({ key }: { key: string }) => {
    const viewOnlyActions = ['viewAccounting', 'validate'];
    if (!isValidated && !isInvoiceSynced && !viewOnlyActions.includes(key)) {
      message.warning('Please validate the invoice before performing this action.');
      return;
    }
    switch (key) {
      case 'viewAccounting':
        openAccountingModal();
        break;
      case 'validate':
        runValidation();
        break;
      case 'calculateTax':
        message.info('Calculating tax...');
        break;
      case 'payInFull':
        if (!(savedInvoiceId || initialData?.invoiceId)) { message.warning('Save the invoice first before making a payment.'); return; }
        // Re-fetch balance from API before opening modal
        (async () => {
          const invoiceId = savedInvoiceId || initialData?.invoiceId;
          if (!invoiceId) { openPayInFullModal(); return; }
          const latestBalance = await fetchInvoiceBalance(invoiceId);
          if (latestBalance !== null && latestBalance <= 0) {
            message.warning('Invoice already paid. No remaining balance.');
            return;
          }
          openPayInFullModal();
        })();
        break;
      case 'applyPrepayment':
        openPrepaymentModal();
        break;
      case 'voidPayment': {
        if (!isEditMode) { message.warning('Open an existing invoice with a payment to void.'); return; }
        if (invoicePayments.length === 0) { message.warning('No payments found for this invoice.'); return; }
        const firstVoidable = invoicePayments.find(p => !p.status?.toLowerCase().includes('void'));
        if (!firstVoidable) { message.warning('All payments are already voided.'); return; }
        openInvoiceVoidModal(firstVoidable.checkId, {
          number: firstVoidable.number,
          paymentDate: firstVoidable.paymentDate,
          paidAmount: firstVoidable.paidAmount,
          currency: firstVoidable.currency,
        });
        break;
      }
      case 'placeHold':
        message.info('Placing hold on invoice...');
        break;
      case 'releaseHold':
        message.info('Releasing hold...');
        break;
      case 'initiateApproval':
        message.info('Initiating approval...');
        break;
      case 'multiperiodSchedule': {
        const invId = savedInvoiceId ?? initialData?.invoiceId ?? null;
        if (!invId) { message.warning('Save the invoice first to view its multiperiod schedule.'); return; }
        setMpaModalOpen(true);
        setMpaLoading(true);
        setMpaError(null);
        getMpaSchedule(invId)
          .then(detail => { setMpaSchedule(detail.lines || []); })
          .catch(e => setMpaError(e?.message ?? 'Failed to load schedule'))
          .finally(() => setMpaLoading(false));
        break;
      }
      case 'cancelInvoice':
        openCancelModal();
        break;
      case 'reverseInvoice':
        message.warning('Reverse invoice...');
        break;
      case 'duplicate':
        message.info('Duplicating invoice...');
        break;
      case 'manageInstallments': {
        const invId = savedInvoiceId ?? initialData?.invoiceId ?? null;
        if (invId) {
          // Invoice already saved — retrieve real installments from the API
          try {
            const url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments?P_INVOICE_ID=${invId}`;
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (res.ok) {
              const data = await res.json();
              const items: any[] = data.items || data.installments || (Array.isArray(data) ? data : []);
              if (items.length > 0) {
                setInstEditRows(items.map((item: any, idx: number) => ({
                  key:               item.installment_id?.toString() || idx.toString(),
                  installmentId:     item.installment_id ? Number(item.installment_id) : null,
                  installmentNumber: item.installment_number || idx + 1,
                  dueDate:           formatDateStr(item.due_date) ? dayjs(formatDateStr(item.due_date), 'DD-MMM-YYYY') : null,
                  grossAmount:       item.gross_amount || 0,
                  unpaidAmount:      item.amount_remaining || item.unpaid_amount || 0,
                  paymentPriority:   item.payment_priority ?? 99,
                  paymentMethod:     item.payment_method || '',
                  bankAccount:       item.bank_account || item.bank_account_name || '',
                })));
              }
            }
          } catch { /* keep existing rows on error */ }
        }
        setInstSelectedKey(null);
        setInstEditVisible(true);
        break;
      }
      default:
        break;
    }
  };

  // Tally check before save
  const validateTally = (): boolean => {
    if (linesTotal > 0 && Math.abs(headerInvoiceAmount - computedTotal) > 0.01) {
      message.error(
        `Invoice amount (${formatAmount(headerInvoiceAmount)}) does not match Lines + Tax total (${formatAmount(computedTotal)}). Please correct before saving.`
      );
      return false;
    }
    return true;
  };

  // Build the combined invoice payload (header + lines)
  const buildInvoicePayload = (values: any) => {
    const invoiceDate = values.invoiceDate?.format('YYYY-MM-DD') || '';

    // Convert any supported date form (DD-MMM-YYYY, Oracle DD-MON-YYYY, "DD MMM YYYY",
    // ISO) to YYYY-MM-DD for the API. Uses the shared flexible parser so dates loaded
    // from the server round-trip correctly even if the user never re-picks them.
    const toISODate = (dateStr: string): string | null => {
      const d = parseFlexDate(dateStr);
      return d ? d.format('YYYY-MM-DD') : null;
    };

    // Keep every line the user has in the grid (only drop truly blank rows)
    const validLines = lines.filter(l =>
      l.amount !== 0 || l.description || l.distributionCombination ||
      l.distributionSet || l.poNumber || l.taxClassification ||
      l.unitPrice !== 0 || l.quantity !== 1
    );

    // Helper: remove empty string, null, undefined keys to keep JSON compact
    const clean = (obj: Record<string, any>) => {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v !== '' && v !== null && v !== undefined) result[k] = v;
      }
      return result;
    };

    const accountingDate = values.accountingDate?.format?.('YYYY-MM-DD') || invoiceDate || null;

    const payload = clean({
      InvoiceNumber: values.invoiceNumber || null,
      InvoiceCurrency: values.invoiceCurrency || 'AED',
      PaymentCurrency: values.paymentCurrency || values.invoiceCurrency || 'AED',
      InvoiceAmount: values.invoiceAmount || 0,
      InvoiceDate: invoiceDate || null,
      BusinessUnit: values.businessUnit || null,
      Supplier: values.supplier || null,
      SupplierNumber: values.supplierNumber || null,
      SupplierSite: values.supplierSite || null,
      InvoiceType: values.invoiceType || 'Standard',
      Description: values.description || null,
      LegalEntity: values.legalEntity || null,
      InvoiceGroup: values.invoiceGroup || null,
      InvoiceSource: 'MANUAL',
      PaymentTerms: values.paymentTerms || null,
      AccountingDate: accountingDate,
      TermsDate: values.termsDate?.format?.('YYYY-MM-DD') || null,
      GoodsReceivedDate: values.goodsReceivedDate?.format?.('YYYY-MM-DD') || null,
      PayGroup: values.payGroup || null,
      PaymentMethod: values.paymentMethod || null,
      PayAlone: (values.payAlone === 'Yes' || values.payAlone === 'Y') ? 'Y' : 'N',
      // Accounting tab fields
      LiabilityDistribution: values.liabilityDistribution || null,
      ConversionRateType: values.conversionRateType || null,
      ConversionDate: values.conversionDate?.format?.('YYYY-MM-DD') || null,
      ConversionRate: values.conversionRate || null,
      DocumentCategory: values.documentCategory || null,
      DocumentSequence: values.documentSequence != null && values.documentSequence !== '' ? Number(values.documentSequence) : null,
      VoucherNumber: values.voucherNumber || null,
      FirstPartyTaxRegistrationNumber: values.firstPartyTaxRegistrationNumber || null,
      SupplierTaxRegistrationNumber: values.supplierTaxRegistrationNumber || null,
      ApplyAfterDate: values.invoiceType === 'Prepayment'
        ? (values.applyAfterDate?.format?.('YYYY-MM-DD') || invoiceDate || null)
        : null,
      CreatedBy: user?.username || user?.name || null,
      LastUpdatedBy: user?.username || user?.name || null,
    });

    // Always include lines array (even if empty) so PL/SQL JSON_TABLE can parse it
    payload.lines = validLines.map(line => clean({
      LineNumber: line.lineNumber,
      LineType: line.type || 'Item',
      LineAmount: line.amount ?? 0,
      Description: line.description || null,
      AccountingDate: toISODate(line.accountingDate) || invoiceDate || null,
      DistributionCombination: line.distributionCombination || null,
      DistributionSet: line.distributionSet || null,
      TaxClassification: line.taxClassification || null,
      TaxControlAmount: line.taxAmount || null,
      Quantity: line.quantity || null,
      UnitPrice: line.unitPrice || null,
      UOM: line.uomName || null,
      PONumber: line.poNumber || null,
      POLineNumber: line.poLine || null,
      ReceiptNumber: line.receiptNumber || null,
      ReceiptLineNumber: line.receiptLine || null,
      ShipToLocation: line.shipToLocation || null,
      // Only send multiperiod fields when start and end span different months —
      // same-month lines must not generate schedule rows in the multiperiod table.
      ...(line.startDate && line.endDate && line.accrualAccount &&
          parseFlexDate(line.startDate)?.format('YYYY-MM') !==
          parseFlexDate(line.endDate)?.format('YYYY-MM')
        ? {
            MultiperiodStartDate:    toISODate(line.startDate),
            MultiperiodEndDate:      toISODate(line.endDate),
            MultiperiodAccrualAccount: line.accrualAccount,
          }
        : {
            MultiperiodStartDate:    null,
            MultiperiodEndDate:      null,
            MultiperiodAccrualAccount: null,
          }),
    }));

    console.log('Invoice payload lines:', lines.length, 'total,', validLines.length, 'valid, payload:', JSON.stringify(payload).length, 'chars');
    return payload;
  };

  // Helper to log an API call to both current log and history
  const logApiCall = (action: string, entry: { url: string; method: string; requestBody: string; responseBody: string; status: string; httpStatus: number; timestamp: string }) => {
    setApiLog(entry);
    setApiLogHistory((prev) => [{ action, ...entry }, ...prev]);
  };

  // POST combined invoice (header + lines) to APEX; returns invoiceId on success, false on failure
  const saveInvoice = async (values: any): Promise<number | false> => {
    setSaving(true);
    const payload = buildInvoicePayload(values);
    const isUpdate = savedInvoiceId !== null;
    const httpMethod = isUpdate ? 'PUT' : 'POST';
    const actionLabel = isUpdate ? 'Update Invoice' : 'Create Invoice';
    const url = isUpdate
      ? `${APEX_DB_CONFIG.baseUrl}/ap/createinvoicefull/${savedInvoiceId}`
      : `${APEX_DB_CONFIG.baseUrl}/ap/createinvoicefull`;

    // Include InvoiceId in payload for updates
    if (isUpdate) {
      payload.InvoiceId = savedInvoiceId;
    }

    const requestBody = JSON.stringify(payload, null, 2);
    const timestamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    try {
      console.log(`${httpMethod} Invoice (${actionLabel}):`, url, payload);
      console.log('[Payload JSON]', JSON.stringify(payload, null, 2));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s covers fetch + body read

      let response: Response;
      let responseText: string;
      try {
        response = await fetch(url, {
          method: httpMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        // Keep timer running — server can hang AFTER sending headers (during body)
        responseText = await response.text();
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === 'AbortError') {
          message.error('Request timed out (30s). The server did not respond — please try again.');
          console.error('Save invoice timed out after 30s');
        } else {
          message.error(`Network error: ${fetchErr?.message ?? fetchErr}`);
        }
        return false;
      }
      clearTimeout(timeoutId);
      let data: any = null;
      let responseBody = responseText;

      try {
        data = JSON.parse(responseText);
        responseBody = JSON.stringify(data, null, 2);
      } catch {
        // Response is not JSON (e.g. ORDS PL/SQL error page)
        data = null;
      }
      console.log('Invoice Response:', response.status, data || responseText);

      // If response is not JSON or not OK, show the raw server error
      if (!data) {
        logApiCall(actionLabel, {
          url,
          method: httpMethod,
          requestBody,
          responseBody: responseText || '(empty response)',
          status: 'SERVER_ERROR',
          httpStatus: response.status,
          timestamp,
        });
        message.error(`Server error (HTTP ${response.status}): Check API Log for details`);
        return false;
      }

      // Update API log
      logApiCall(actionLabel, {
        url,
        method: httpMethod,
        requestBody,
        responseBody,
        status: data.status || (response.ok ? 'SUCCESS' : 'ERROR'),
        httpStatus: response.status,
        timestamp,
      });

      if (data.status !== 'SUCCESS' || !data.success) {
        const errMsg = data.message || 'Unknown error';
        if (errMsg.toLowerCase().includes('already exists')) {
          Modal.error({
            title: 'Duplicate Invoice Number',
            content: errMsg,
            okText: 'OK',
          });
        } else {
          message.error(`Failed: ${errMsg}`);
        }
        return false;
      }

      const invoiceId = data.invoiceId || savedInvoiceId || 0;

      // Store invoice ID — switch to update mode
      if (!isUpdate && invoiceId) {
        setSavedInvoiceId(invoiceId);
        setIsEditing(true); // keep form in edit mode so Update Invoice button shows immediately
        // Seed live status for a freshly created invoice so the refresh button works immediately
        setLiveHoldPaidStatus('Unpaid');
        setLiveValidationStatus('Never Validated');
        saveValidationStatus(invoiceId, 'Never Validated');
        fetchInvoiceBalance(invoiceId);
        fetchInvoicePayments(invoiceId);
        // Show the DB-generated document sequence in the form field
        if (data.documentSequence != null) {
          const docSeq = Number(data.documentSequence);
          form.setFieldValue('documentSequence', docSeq);
          setHeaderValues((prev) => ({ ...prev, documentSequence: docSeq }));
        }
      } else if (isUpdate && invoiceId) {
        // Data changed — mark as needing revalidation
        setIsValidated(false);
        setLiveValidationStatus('Needs Revalidation');
        saveValidationStatus(invoiceId, 'Needs Revalidation');
      }

      message.success(data.message || `Invoice ${isUpdate ? 'updated' : 'created'} (ID: ${invoiceId})`);

      // Notify parent
      if (onSave) onSave({ ...values, invoiceId });

      return invoiceId;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Save invoice error:', error);
      logApiCall(actionLabel, {
        url,
        method: httpMethod,
        requestBody,
        responseBody: JSON.stringify({ error: errorMsg }, null, 2),
        status: 'NETWORK_ERROR',
        httpStatus: 0,
        timestamp,
      });
      message.error(`Failed to ${isUpdate ? 'update' : 'save'} invoice: ${errorMsg}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // POST all installment rows for a saved invoice in a single request
  const saveInstallments = async (invoiceId: number) => {
    const loginUser = user?.username || null;
    const timestamp = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const items = instEditRows.map((row) => ({
      InvoiceId:              invoiceId,
      InstallmentId:          row.installmentId || null,
      InstallmentNumber:      row.installmentNumber,
      DueDate:                row.dueDate?.format('YYYY-MM-DD') || null,
      GrossAmount:            row.grossAmount,
      UnpaidAmount:           row.unpaidAmount,
      FirstDiscountAmount:    null, FirstDiscountDate:      null,
      SecondDiscountAmount:   null, SecondDiscountDate:     null,
      ThirdDiscountAmount:    null, ThirdDiscountDate:      null,
      NetAmountOne:           null, NetAmountTwo:           null, NetAmountThree: null,
      PaymentPriority:        row.paymentPriority,
      PaymentMethod:          row.paymentMethod || null,
      PaymentMethodCode:      row.paymentMethod || null,
      HoldReason:             null, HoldType:               null,
      HoldDate:               null, HeldBy:                 null,
      BankAccount:            row.bankAccount || null,
      ExternalBankAccountId:  null, DigitalPaymentAccount:  null,
      RemitToAddressName:     null, RemitToSupplier:        null,
      RemittanceMessageOne:   null, RemittanceMessageTwo:   null, RemittanceMessageThree: null,
      CreatedBy:              loginUser,
      LastUpdatedBy:          loginUser,
      LastUpdateLogin:        loginUser,
    }));

    const instUrl = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments?P_INVOICE_ID=${invoiceId}`;
    try {
      const instRes = await fetch(instUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),   // all installments in one request
      });
      const instText = await instRes.text();
      let instData: any = null;
      try { instData = JSON.parse(instText); } catch { /* non-JSON */ }
      logApiCall(`Save Installments (${items.length})`, {
        url: instUrl, method: 'POST',
        requestBody: JSON.stringify({ items }, null, 2),
        responseBody: instData ? JSON.stringify(instData, null, 2) : instText,
        status: instData?.status || (instRes.ok ? 'SUCCESS' : 'ERROR'),
        httpStatus: instRes.status, timestamp,
      });
      if (!instRes.ok || instData?.status === 'ERROR') {
        message.warning(`Invoice saved but installments failed: ${instData?.message || instText}`);
      }
    } catch (e) {
      message.warning(`Invoice saved but installments error: ${e}`);
    }
  };

  // Core save: validate installments, save invoice, save installments
  const saveInvoiceWithInstallments = async (values: any): Promise<number | false> => {
    const invoiceAmount = values.invoiceAmount || 0;
    const rowTotal = instEditRows.reduce((s, r) => s + (r.grossAmount || 0), 0);
    if (invoiceAmount > 0 && Math.abs(rowTotal - invoiceAmount) > 0.01) {
      message.error(
        `Installments total (${rowTotal.toFixed(2)}) doesn't match invoice amount (${invoiceAmount.toFixed(2)}). ` +
        'Use Invoice Actions → Manage Installments to fix.'
      );
      return false;
    }
    const invoiceId = await saveInvoice(values);
    if (!invoiceId) return false;
    await saveInstallments(invoiceId);
    return invoiceId;
  };

  // Load attachment count whenever the invoice is saved/opened
  useEffect(() => {
    const id = savedInvoiceId || initialData?.invoiceId;
    if (!id) return;
    listAttachments(id).then(rows => setAttachmentCount(rows.length)).catch(() => {});
  }, [savedInvoiceId, initialData?.invoiceId]);

  // Save and create next handler
  const handleSaveAndCreateNext = async () => {
    try {
      const coreFields = ['businessUnit', 'invoiceNumber', 'invoiceCurrency', 'invoiceAmount', 'invoiceDate', 'supplier', 'invoiceType', 'paymentTerms'];
      await form.validateFields(coreFields);
      const values = { ...headerValues, ...form.getFieldsValue(true) };
      if (!validateTally()) return;
      const invoiceId = await saveInvoiceWithInstallments(values);
      if (invoiceId) {
        message.success('Invoice saved. Creating next...');
        form.resetFields();
        setLines([createBlankLine(1)]);
        setSelectedLineKeys([]);
        setHeaderValues({ invoiceType: 'Standard', invoiceCurrency: 'AED' });
        setTaxRate(5);
        setIsValidated(false);
        setSavedInvoiceId(null);
        setSelectedSupplierInfo(null);
        setInstEditRows([{ key: '1', installmentNumber: 1, dueDate: null, grossAmount: 0, unpaidAmount: 0, paymentPriority: 99, paymentMethod: '', bankAccount: '' }]);
      }
    } catch {
      message.error('Please fill in required fields');
    }
  };

  // Save handler
  const handleSave = async (): Promise<boolean> => {
    try {
      const coreFields = ['businessUnit', 'invoiceNumber', 'invoiceCurrency', 'invoiceAmount', 'invoiceDate', 'supplier', 'invoiceType', 'paymentTerms'];
      await form.validateFields(coreFields);
      const values = { ...headerValues, ...form.getFieldsValue(true) };
      // Require conversion rate for non-functional currencies
      const invoiceCcy = (values.invoiceCurrency || 'AED').toUpperCase();
      if (invoiceCcy !== 'AED') {
        const rate = Number(values.conversionRate);
        if (!rate || rate <= 0) {
          message.error('Conversion rate is required for non-AED currencies. Please enter a valid rate before saving.');
          return false;
        }
      }
      if (!validateTally()) return false;
      const result = await saveInvoiceWithInstallments(values);
      if (result) message.success('Invoice saved successfully');
      return Boolean(result);
    } catch (err) {
      console.log('Validation failed:', err);
      message.error('Please fill in required fields');
      return false;
    }
  };

  // Show API preview (URL + JSON body for Postman testing)
  const handleApiPreview = (previewValues?: any) => {
    const values = previewValues || { ...headerValues, ...form.getFieldsValue(true) };
    const payload = buildInvoicePayload(values);
    const isUpdate = savedInvoiceId !== null;
    const url = isUpdate
      ? `${APEX_DB_CONFIG.baseUrl}/ap/createinvoicefull/${savedInvoiceId}`
      : `${APEX_DB_CONFIG.baseUrl}/ap/createinvoicefull`;
    if (isUpdate) payload.InvoiceId = savedInvoiceId;

    const previewLoginUser = user?.username || null;
    const instItems = instEditRows.map((row) => ({
      InvoiceId:                savedInvoiceId || '<invoice_id after save>',
      InstallmentNumber:        row.installmentNumber,
      DueDate:                  row.dueDate?.format('YYYY-MM-DD') || null,
      GrossAmount:              row.grossAmount,
      UnpaidAmount:             row.unpaidAmount,
      FirstDiscountAmount:      null, FirstDiscountDate:      null,
      SecondDiscountAmount:     null, SecondDiscountDate:     null,
      ThirdDiscountAmount:      null, ThirdDiscountDate:      null,
      NetAmountOne:             null, NetAmountTwo:           null, NetAmountThree: null,
      PaymentPriority:          row.paymentPriority,
      PaymentMethod:            row.paymentMethod || null,
      PaymentMethodCode:        row.paymentMethod || null,
      HoldReason:               null, HoldType:               null,
      HoldDate:                 null, HeldBy:                 null,
      BankAccount:              row.bankAccount || null,
      ExternalBankAccountId:    null, DigitalPaymentAccount:  null,
      RemitToAddressName:       null, RemitToSupplier:        null,
      RemittanceMessageOne:     null, RemittanceMessageTwo:   null, RemittanceMessageThree: null,
      CreatedBy:                previewLoginUser,
      LastUpdatedBy:            previewLoginUser,
      LastUpdateLogin:          previewLoginUser,
    }));

    setApiPreviewData({
      url:              `${isUpdate ? 'PUT' : 'POST'} ${url}`,
      body:             JSON.stringify(payload, null, 2),
      installmentUrl:   `POST ${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments`,
      installmentBody:  JSON.stringify({ items: instItems }, null, 2),
    });
    setApiExecInvoice(null);
    setApiExecInstall(null);
    setApiPreviewVisible(true);
  };

  // Execute invoice API directly from the preview modal
  const executePreviewInvoiceApi = async () => {
    if (!apiPreviewData) return;
    const [method, ...rest] = apiPreviewData.url.split(' ');
    const url = rest.join(' ');
    setApiExecInvoice({ loading: true, httpStatus: 0, body: '' });
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: apiPreviewData.body,
      });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
      setApiExecInvoice({ loading: false, httpStatus: res.status, body: pretty });
    } catch (e: any) {
      setApiExecInvoice({ loading: false, httpStatus: 0, body: e?.message ?? 'Network error' });
    }
  };

  // Execute installment API directly from the preview modal
  const executePreviewInstallApi = async () => {
    if (!apiPreviewData) return;
    // Prefer invoiceId captured from the invoice execute result, then savedInvoiceId
    let invoiceId: number | null = null;
    if (apiExecInvoice?.body) {
      try { invoiceId = JSON.parse(apiExecInvoice.body)?.invoiceId ?? null; } catch { /* ignore */ }
    }
    if (!invoiceId) invoiceId = savedInvoiceId;
    const [, ...rest] = apiPreviewData.installmentUrl.split(' ');
    const baseUrl = rest.join(' ');
    const url = invoiceId ? `${baseUrl}?P_INVOICE_ID=${invoiceId}` : baseUrl;
    // Substitute captured invoiceId into the body (already {"items":[...]} envelope)
    const bodyPayload = invoiceId
      ? apiPreviewData.installmentBody.replace(/"<invoice_id after save>"/g, String(invoiceId))
      : apiPreviewData.installmentBody;
    setApiExecInstall({ loading: true, httpStatus: 0, body: '' });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyPayload,
      });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
      setApiExecInstall({ loading: false, httpStatus: res.status, body: pretty });
    } catch (e: any) {
      setApiExecInstall({ loading: false, httpStatus: 0, body: e?.message ?? 'Network error' });
    }
  };

  // Generate (or regenerate) the multiperiod schedule from the schedule modal, then reload it.
  const handleGenerateMpaFromModal = async () => {
    const invId = savedInvoiceId ?? initialData?.invoiceId ?? null;
    if (!invId) { message.warning('Save the invoice first to generate its multiperiod schedule.'); return; }
    setMpaGenerating(true);
    setMpaError(null);
    try {
      await generateMpaSchedule(invId);
      const detail = await getMpaSchedule(invId);
      const rows = detail.lines || [];
      setMpaSchedule(rows);
      if (rows.length === 0) {
        message.warning('No schedule rows generated. Ensure each line has start & end dates in different months plus an accrual account, then save the invoice and try again.');
      } else {
        message.success(`Multiperiod schedule generated — ${rows.length} row(s)`);
      }
    } catch (e: any) {
      setMpaError(e?.message ?? 'Failed to generate schedule');
      message.error(e?.message || 'Failed to generate schedule');
    } finally {
      setMpaGenerating(false);
    }
  };

  // ========== Distribution Tab Columns (matching Fusion Payables) ==========
  const distributionColumns: ColumnsType<InvoiceLine> = [
    {
      title: 'Number',
      dataIndex: 'lineNumber',
      key: 'lineNumber',
      width: 65,
      align: 'center',
      render: (val: number) => <Text style={{ fontSize: 12 }}>{val}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (val: string, record: InvoiceLine) => (
        <Select
          size="small"
          value={val}
          onChange={(v) => updateLine(record.key, 'type', v)}
          style={{ width: '100%' }}
          variant="borderless"
          disabled={isReadOnly}
        >
          <Option value="Item">Item</Option>
          <Option value="Freight">Freight</Option>
          <Option value="Miscellaneous">Miscellaneous</Option>
          <Option value="Tax">Tax</Option>
          <Option value="Prepay">Prepay</Option>
        </Select>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 130,
      align: 'right',
      render: (val: number, record: InvoiceLine) => {
        const isCreditMemoLine = headerValues.invoiceType === 'Credit Memo';
        return (
          <InputNumber
            size="small"
            value={val}
            onChange={(v) => {
              const entered = v || 0;
              // Auto-negate: in Credit Memo mode, positive entries become negative
              const finalVal = isCreditMemoLine && entered > 0 ? -entered : entered;
              updateLine(record.key, 'amount', finalVal);
            }}
            min={isCreditMemoLine ? undefined : 0}
            precision={2}
            style={{ width: '100%', fontWeight: 600, textAlign: 'right' }}
            styles={{ input: { textAlign: 'right' } }}
            variant="borderless"
            disabled={isReadOnly}
          />
        );
      },
    },
    {
      title: 'Distribution Set',
      dataIndex: 'distributionSet',
      key: 'distributionSet',
      width: 200,
      render: (val: string, record: InvoiceLine) => (
        <AutoComplete
          size="small"
          value={val}
          disabled={isReadOnly}
          placeholder="Type or search…"
          style={{ width: '100%' }}
          options={distCombinations
            .filter(d => {
              if (!val) return true;
              const q = val.toLowerCase();
              return d.combinationName.toLowerCase().includes(q)
                || (d.description || '').toLowerCase().includes(q)
                || (d.glAccountDesc || '').toLowerCase().includes(q);
            })
            .map(d => ({
              value: d.combinationName,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{d.combinationName}</span>
                  <span style={{ fontSize: 11, color: REDWOOD.neutral300, fontFamily: 'monospace' }}>{d.glAccountDesc || ''}</span>
                </div>
              ),
              combination: d,
            }))}
          onChange={v => updateLine(record.key, 'distributionSet', v)}
          onSelect={(_v, opt) => {
            const d = (opt as { combination: DistCombination }).combination;
            updateLine(record.key, 'distributionSet', d.combinationName);
            if (d.glAccountDesc) updateLine(record.key, 'distributionCombination', applyCompanySegment(d.glAccountDesc));
          }}
          filterOption={false}
          notFoundContent={val ? <span style={{ fontSize: 12, color: REDWOOD.neutral300 }}>No match</span> : null}
        >
          <Input
            size="small"
            variant="borderless"
            suffix={
              <SearchOutlined
                style={{ color: isReadOnly ? REDWOOD.neutral300 : REDWOOD.info, fontSize: 11, cursor: isReadOnly ? 'default' : 'pointer' }}
                onClick={() => {
                  if (isReadOnly) return;
                  setDistLovLineKey(record.key);
                  setDistLovSearch(val || '');
                  setDistLovOpen(true);
                }}
              />
            }
          />
        </AutoComplete>
      ),
    },
    {
      title: 'Distribution Combination',
      dataIndex: 'distributionCombination',
      key: 'distributionCombination',
      width: 280,
      render: (val: string, record: InvoiceLine) => {
        // company segment is locked to derivedCompany; user edits only the rest
        const restVal = derivedCompany && val ? val.split('-').slice(1).join('-') : val;
        const buildFull = (rest: string) => derivedCompany ? `${derivedCompany}-${rest}` : rest;
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {derivedCompany && (
                <span style={{
                  fontSize: 11, fontFamily: 'monospace',
                  background: '#f0f0f0', padding: '2px 5px',
                  borderRadius: 3, color: '#555', whiteSpace: 'nowrap',
                  border: '1px solid #d9d9d9',
                }}>
                  {derivedCompany}-
                </span>
              )}
              <Input
                size="small"
                value={val}
                readOnly
                placeholder="Select via search →"
                variant="borderless"
                style={{ flex: 1, cursor: isReadOnly ? 'default' : 'pointer' }}
                onClick={() => !isReadOnly && openAccountSelector(record.key, val)}
                suffix={
                  <SearchOutlined
                    style={{ color: isReadOnly ? REDWOOD.neutral300 : REDWOOD.info, fontSize: 12, cursor: isReadOnly ? 'default' : 'pointer' }}
                    onClick={() => !isReadOnly && openAccountSelector(record.key, val)}
                  />
                }
              />
              {val && lines.length > 1 && (
                <Tooltip title="Apply to all lines">
                  <AppstoreOutlined
                    style={{ color: REDWOOD.info, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
                    onClick={() => {
                      Modal.confirm({
                        title: 'Apply to All Lines?',
                        icon: <AppstoreOutlined style={{ color: REDWOOD.info }} />,
                        content: (
                          <div style={{ fontSize: 13 }}>
                            Set <Text code style={{ fontSize: 12 }}>{val}</Text> on all {lines.length} lines?
                          </div>
                        ),
                        okText: 'Apply to All',
                        cancelText: 'Cancel',
                        onOk: () => {
                          setLines((prev) =>
                            prev.map((line) => ({ ...line, distributionCombination: applyCompanySegment(line.distributionCombination || val) }))
                          );
                          message.success(`Distribution applied to all ${lines.length} lines`);
                          setIsValidated(false);
                        },
                      });
                    }}
                  />
                </Tooltip>
              )}
            </div>
            {(record.accountDescription || lineAccountDescs[val]) && (
              <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2, paddingLeft: 4 }}>
                {record.accountDescription || lineAccountDescs[val]}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Accounting Date',
      dataIndex: 'accountingDate',
      key: 'accountingDate',
      width: 150,
      render: (val: string, record: InvoiceLine) => (
        <DatePicker
          size="small"
          value={val ? dayjs(val, 'DD-MMM-YYYY') : null}
          onChange={(d) => updateLine(record.key, 'accountingDate', d ? d.format('DD-MMM-YYYY') : '')}
          format="DD-MMM-YYYY"
          variant="borderless"
          placeholder="dd-mmm-yyyy"
          style={{ width: '100%' }}
          disabled={isReadOnly}
        />
      ),
    },
    {
      title: 'Prorate Across All Item Lines',
      dataIndex: 'prorateAcrossAllItemLines',
      key: 'prorateAcrossAllItemLines',
      width: 200,
      render: (val: string, record: InvoiceLine) => (
        <Select
          size="small"
          value={val || 'No'}
          onChange={(v) => updateLine(record.key, 'prorateAcrossAllItemLines', v)}
          style={{ width: '100%' }}
          variant="borderless"
          disabled={isReadOnly}
        >
          <Option value="Yes">Yes</Option>
          <Option value="No">No</Option>
        </Select>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: 240,
      render: (val: string, record: InvoiceLine) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Input.TextArea
            size="small"
            value={val}
            onChange={(e) => {
              setManuallyEditedDescLines((prev) => new Set(prev).add(record.key));
              updateLine(record.key, 'description', e.target.value);
            }}
            placeholder=""
            variant="borderless"
            disabled={isReadOnly}
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ flex: 1, fontSize: 12 }}
          />
          {!isReadOnly && (
            <Tooltip title="Edit description">
              <EditOutlined
                style={{ fontSize: 11, color: '#8c8c8c', cursor: 'pointer', marginTop: 4, flexShrink: 0 }}
                onClick={() => setLineDescModal({ open: true, lineKey: record.key, value: val || '' })}
              />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Tax Classification',
      dataIndex: 'taxClassification',
      key: 'taxClassification',
      width: 180,
      render: (val: string, record: InvoiceLine) => {
        const taxEntry   = taxCodes.find(t => t.taxCode === val);
        const taxAcct    = record.taxAccountCombination || taxEntry?.taxAccount || '';
        const missingAcct = val && !taxAcct;
        return (
          <div>
            <Select
              size="small"
              value={val || undefined}
              onChange={(v) => updateLine(record.key, 'taxClassification', v)}
              style={{ width: '100%' }}
              variant="borderless"
              placeholder={!buSelected ? 'Select BU first' : ''}
              allowClear
              disabled={isReadOnly || !buSelected || (buSelected && !derivedCompany)}
              notFoundContent={!buSelected ? 'Select a business unit to load taxes' : 'No taxes configured for this BU'}
            >
              {taxCodes.map(t => (
                <Option key={t.taxCode} value={t.taxCode}>
                  {t.taxCode}{t.taxRate > 0 ? ` (${t.taxRate}%)` : ''}
                </Option>
              ))}
            </Select>
            {taxAcct && (
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 1, lineHeight: 1.3 }}>
                {taxAcct}
              </Text>
            )}
            {missingAcct && (
              <Text style={{ fontSize: 10, display: 'block', marginTop: 1, color: '#faad14' }}>
                ⚠ No tax account assigned
              </Text>
            )}
          </div>
        );
      },
    },
    {
      title: 'Tax Amount',
      dataIndex: 'taxAmount',
      key: 'taxAmount',
      width: 110,
      align: 'right',
      render: (val: number, record: InvoiceLine) => {
        const rate = taxRateMap[record.taxClassification] ?? getTaxRateForClassification(record.taxClassification);
        const computed = Math.round((record.amount || 0) * (rate / 100) * 100) / 100;
        return (
          <Text style={{ fontSize: 12, fontWeight: 600, color: computed > 0 ? REDWOOD.info : REDWOOD.neutral600 }}>
            {computed > 0 ? formatAmount(computed) : '0.00'}
          </Text>
        );
      },
    },
    {
      title: 'Ship-to Location',
      dataIndex: 'shipToLocation',
      key: 'shipToLocation',
      width: 160,
      render: (val: string, record: InvoiceLine) => (
        <Input
          size="small"
          value={val}
          onChange={(e) => updateLine(record.key, 'shipToLocation', e.target.value)}
          variant="borderless"
          placeholder=""
          disabled={isReadOnly}
          suffix={<SearchOutlined style={{ color: REDWOOD.neutral300, fontSize: 11 }} />}
        />
      ),
    },
  ];

  // ========== Purchase Orders Tab Columns ==========
  const poColumns: ColumnsType<InvoiceLine> = [
    {
      title: 'Line',
      dataIndex: 'lineNumber',
      key: 'lineNumber',
      width: 50,
      align: 'center',
      render: (val: number) => <Text type="secondary" style={{ fontSize: 12 }}>{val}</Text>,
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 130,
      align: 'right',
      render: (val: number) => <Text strong style={{ fontSize: 12 }}>{formatAmount(val)}</Text>,
    },
    {
      title: 'PO Number',
      dataIndex: 'poNumber',
      key: 'poNumber',
      width: 130,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'poNumber', e.target.value)} variant="borderless" placeholder="" disabled={isReadOnly} suffix={<SearchOutlined style={{ color: REDWOOD.neutral300, fontSize: 11 }} />} />
      ),
    },
    {
      title: 'PO Line',
      dataIndex: 'poLine',
      key: 'poLine',
      width: 80,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'poLine', e.target.value)} variant="borderless" disabled={isReadOnly} />
      ),
    },
    {
      title: 'PO Schedule',
      dataIndex: 'poSchedule',
      key: 'poSchedule',
      width: 100,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'poSchedule', e.target.value)} variant="borderless" disabled={isReadOnly} />
      ),
    },
    {
      title: 'Receipt Number',
      dataIndex: 'receiptNumber',
      key: 'receiptNumber',
      width: 130,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'receiptNumber', e.target.value)} variant="borderless" disabled={isReadOnly} />
      ),
    },
    {
      title: 'Receipt Line',
      dataIndex: 'receiptLine',
      key: 'receiptLine',
      width: 100,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'receiptLine', e.target.value)} variant="borderless" disabled={isReadOnly} />
      ),
    },
    {
      title: 'Consumption Advice Number',
      dataIndex: 'consumptionAdviceNumber',
      key: 'consumptionAdviceNumber',
      width: 190,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'consumptionAdviceNumber', e.target.value)} variant="borderless" disabled={isReadOnly} />
      ),
    },
    {
      title: 'Consumption Advice Line',
      dataIndex: 'consumptionAdviceLine',
      key: 'consumptionAdviceLine',
      width: 170,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'consumptionAdviceLine', e.target.value)} variant="borderless" disabled={isReadOnly} />
      ),
    },
    {
      title: 'Ship-to Location',
      dataIndex: 'shipToLocation',
      key: 'shipToLocation',
      width: 150,
      render: (val: string, record: InvoiceLine) => (
        <Input size="small" value={val} onChange={(e) => updateLine(record.key, 'shipToLocation', e.target.value)} variant="borderless" disabled={isReadOnly} suffix={<SearchOutlined style={{ color: REDWOOD.neutral300, fontSize: 11 }} />} />
      ),
    },
    {
      title: 'Start Date',
      dataIndex: 'startDate',
      key: 'startDate',
      width: 140,
      render: (val: string, record: InvoiceLine) => (
        <DatePicker
          size="small"
          value={val ? dayjs(val, 'DD-MMM-YYYY') : null}
          onChange={(d) => updateLine(record.key, 'startDate', d ? d.format('DD-MMM-YYYY') : '')}
          format="DD-MMM-YYYY"
          variant="borderless"
          placeholder="dd-mmm-yyyy"
          style={{ width: '100%' }}
          disabled={isReadOnly}
        />
      ),
    },
    {
      title: 'End Date',
      dataIndex: 'endDate',
      key: 'endDate',
      width: 140,
      render: (val: string, record: InvoiceLine) => (
        <DatePicker
          size="small"
          value={val ? dayjs(val, 'DD-MMM-YYYY') : null}
          onChange={(d) => updateLine(record.key, 'endDate', d ? d.format('DD-MMM-YYYY') : '')}
          format="DD-MMM-YYYY"
          variant="borderless"
          placeholder="dd-mmm-yyyy"
          style={{ width: '100%' }}
          disabled={isReadOnly}
        />
      ),
    },
  ];

  // ========== Multiperiod Accounting Tab Columns ==========
  const multiperiodColumns: ColumnsType<InvoiceLine> = [
    {
      title: 'Line',
      dataIndex: 'lineNumber',
      key: 'lineNumber',
      width: 50,
      align: 'center',
      render: (val: number) => <Text style={{ fontSize: 12 }}>{val}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: 200,
      render: (val: string) => <Text style={{ fontSize: 12 }}>{val || '—'}</Text>,
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (val: number) => <Text strong style={{ fontSize: 12 }}>{formatAmount(val)}</Text>,
    },
    {
      title: 'Accounting Date',
      dataIndex: 'accountingDate',
      key: 'accountingDate',
      width: 150,
      render: (val: string, record: InvoiceLine) => (
        <DatePicker
          size="small"
          value={val ? dayjs(val, 'DD-MMM-YYYY') : null}
          onChange={(d) => updateLine(record.key, 'accountingDate', d ? d.format('DD-MMM-YYYY') : '')}
          format="DD-MMM-YYYY"
          variant="borderless"
          placeholder="dd-mmm-yyyy"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Start Date',
      dataIndex: 'startDate',
      key: 'startDate',
      width: 150,
      render: (val: string, record: InvoiceLine) => (
        <DatePicker
          size="small"
          value={val ? dayjs(val, 'DD-MMM-YYYY') : null}
          onChange={(d) => updateLine(record.key, 'startDate', d ? d.format('DD-MMM-YYYY') : '')}
          format="DD-MMM-YYYY"
          variant="borderless"
          placeholder="dd-mmm-yyyy"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'End Date',
      dataIndex: 'endDate',
      key: 'endDate',
      width: 150,
      render: (val: string, record: InvoiceLine) => (
        <DatePicker
          size="small"
          value={val ? dayjs(val, 'DD-MMM-YYYY') : null}
          onChange={(d) => updateLine(record.key, 'endDate', d ? d.format('DD-MMM-YYYY') : '')}
          format="DD-MMM-YYYY"
          variant="borderless"
          placeholder="dd-mmm-yyyy"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Accrual Account',
      dataIndex: 'accrualAccount',
      key: 'accrualAccount',
      width: 250,
      render: (val: string, record: InvoiceLine) => (
        <div>
          <Input
            size="small"
            value={val}
            onChange={(e) => updateLine(record.key, 'accrualAccount', e.target.value)}
            variant="borderless"
            placeholder="e.g. 01-000-2200-0000-000"
            readOnly={isReadOnly}
            suffix={
              <SearchOutlined
                style={{ color: isReadOnly ? REDWOOD.neutral300 : REDWOOD.info, fontSize: 12, cursor: isReadOnly ? 'default' : 'pointer' }}
                onClick={() => !isReadOnly && openAccountSelector(record.key, val, 'accrualAccount')}
              />
            }
          />
          {val && lineAccountDescs[val] && (
            <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 2, paddingLeft: 4 }}>
              {lineAccountDescs[val]}
            </div>
          )}
        </div>
      ),
    },
  ];

  // Row selection config (shared)
  const rowSelection = {
    selectedRowKeys: selectedLineKeys,
    onChange: (keys: React.Key[]) => setSelectedLineKeys(keys),
  };

  return (
    <div style={{ background: REDWOOD.neutral100, minHeight: 'calc(100vh - 200px)' }}>
      {/* Action Bar - matching Fusion Payables layout */}
      <div
        style={{
          padding: '6px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        {/* Row 1: Title + Balance + Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space size={12}>
          <Title level={5} style={{ margin: 0, whiteSpace: 'nowrap' }}>
            <FileTextOutlined style={{ marginRight: 8, color: REDWOOD.primary }} />
            {isEditMode ? (isReadOnly ? 'View Invoice' : 'Edit Invoice') : 'Create Invoice'}
          </Title>
          {isEditMode && isPrepaymentInvoice ? (
            (() => {
              const balUrl = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/balances?prepayment_invoice_id=${initialData?.invoiceId || ''}`;
              return prepaymentBalance ? (
                <Space size={4}>
                  <Text strong style={{ fontSize: 15, color: REDWOOD.primary, whiteSpace: 'nowrap' }}>
                    Available: {formatAmount(prepaymentBalance.availableBalance)} {initialData?.invoiceCurrency || headerValues.invoiceCurrency || 'AED'}
                  </Text>
                  <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{balUrl}</span>} placement="bottom">
                    <InfoCircleOutlined style={{ fontSize: 13, color: '#1677ff', cursor: 'pointer' }} />
                  </Tooltip>
                </Space>
              ) : (
                <Text type="secondary" style={{ fontSize: 13 }}>Loading balance...</Text>
              );
            })()
          ) : isEditMode ? (
            invoiceBalanceLoading
              ? <Text type="secondary" style={{ fontSize: 13 }}>Loading balance...</Text>
              : invoiceBalance !== null
                ? (
                  <Space size={4}>
                    <Text strong style={{ fontSize: 15, color: invoiceBalance === 0 ? REDWOOD.success : REDWOOD.primary, whiteSpace: 'nowrap' }}>
                      {`Balance: ${formatAmount(invoiceBalance)} ${initialData?.invoiceCurrency || headerValues.invoiceCurrency || 'AED'}`}
                    </Text>
                    <Tooltip
                      title={
                        <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          {`${APEX_DB_CONFIG.baseUrl}/ap/invoices/${initialData?.invoiceId}/net-balance`}
                        </span>
                      }
                      placement="bottom"
                    >
                      <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 12 }} />
                    </Tooltip>
                  </Space>
                )
                : initialData?.unpaidAmount !== undefined
                  ? (() => {
                      const isCredit = (initialData.invoiceAmount ?? 0) < 0;
                      const label    = isCredit ? 'Open Credit' : 'Unpaid';
                      const color    = isCredit ? REDWOOD.warning : REDWOOD.primary;
                      return <Text strong style={{ fontSize: 15, color, whiteSpace: 'nowrap' }}>{`${label}: ${formatAmount(Math.abs(initialData.unpaidAmount))} ${initialData.invoiceCurrency || 'AED'}`}</Text>;
                    })()
                  : null
          ) : null}
          {(isEditMode || !!savedInvoiceId) && (
            <Space size={4}>
              <Tooltip title="Refresh status">
                <Button
                  icon={<ReloadOutlined spin={statusRefreshing} />}
                  size="small"
                  onClick={handleRefreshStatus}
                  loading={statusRefreshing}
                  style={{ fontSize: 12 }}
                />
              </Tooltip>
              <Tooltip title={refreshApiLog.length > 0 ? `${refreshApiLog.length} calls — click to view` : 'No refresh called yet'}>
                <Button
                  icon={<ApiOutlined />}
                  size="small"
                  style={{
                    fontSize: 12,
                    color: refreshApiLog.length > 0
                      ? (refreshApiLog.every(r => r.status >= 200 && r.status < 300) ? REDWOOD.success : REDWOOD.error)
                      : '#aaa',
                    borderColor: refreshApiLog.length > 0
                      ? (refreshApiLog.every(r => r.status >= 200 && r.status < 300) ? REDWOOD.success : REDWOOD.error)
                      : '#d9d9d9',
                  }}
                  onClick={() => setRefreshApiLogVisible(true)}
                />
              </Tooltip>
            </Space>
          )}
        </Space>

        <Space size={8}>
          <Tooltip title="API Preview (Postman)">
            <Button
              icon={<ApiOutlined />}
              onClick={handleApiPreview}
              style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
            />
          </Tooltip>
          {/* Attachment button — opens popup */}
          <Tooltip title={attachmentCount > 0 ? `${attachmentCount} attachment(s)` : 'Attachments'}>
            <Badge count={attachmentCount} size="small" offset={[-4, 4]}>
              <Button
                icon={<PaperClipOutlined />}
                onClick={() => setAttachmentModalOpen(true)}
                style={{
                  color: attachmentCount > 0 ? REDWOOD.primary : undefined,
                  borderColor: attachmentCount > 0 ? REDWOOD.primary : undefined,
                }}
              />
            </Badge>
          </Tooltip>
          {/* Invoice Actions Dropdown */}
          <Dropdown
            menu={{
              items: invoiceActionItems,
              onClick: handleInvoiceAction,
            }}
            trigger={['click']}
          >
            <Button style={{ fontWeight: 500 }}>
              Invoice Actions <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          {!isCancelled && !hasAnyPayment && !isPostedToGL && (
            <Button
              icon={<CheckSquareOutlined />}
              onClick={runValidation}
              style={{
                fontWeight: 500,
                borderColor: isValidated ? REDWOOD.success : REDWOOD.primary,
                color: isValidated ? REDWOOD.success : REDWOOD.primary,
              }}
            >
              {isValidated ? 'Validated' : 'Validate'}
            </Button>
          )}
          {/* Accounting Actions Dropdown — hidden when cancelled and not yet posted */}
          {(!isCancelled || isPostedToGL) && <Dropdown
            menu={{
              items: [
                {
                  key: 'viewAccounting',
                  icon: <AccountBookOutlined />,
                  label: 'Check Accounting',
                  disabled: !savedInvoiceId,
                },
                ...(!isInvoiceSynced && savedInvoiceId && slaStatus !== 'POSTED' ? [{
                  key: 'createAccounting',
                  icon: <CheckSquareOutlined />,
                  label: slaStatus === 'DRAFT' ? 'Re-create Accounting' : 'Create Accounting',
                }] : []),
                ...(!isInvoiceSynced && slaStatus === 'DRAFT' ? [{
                  key: 'postToLedger',
                  icon: <SendOutlined />,
                  label: 'Post to Ledger',
                }] : []),
                ...(slaHeaderId ? [{ type: 'divider' as const }, {
                  key: 'viewSlaLines',
                  icon: <AccountBookOutlined />,
                  label: slaStatus === 'POSTED' ? 'Final Accounting' : 'Draft Accounting',
                }] : []),
              ],
              onClick: ({ key }: { key: string }) => {
                if (key !== 'viewAccounting' && key !== 'viewSlaLines' && !isValidated && !isInvoiceSynced) {
                  message.warning('Please validate the invoice before performing this action.');
                  return;
                }
                if (key === 'viewAccounting') setAccountingModalVisible(true);
                else if (key === 'createAccounting') handleCreateAccounting();
                else if (key === 'postToLedger') handlePostToLedger();
                else if (key === 'viewSlaLines') {
                  const invoiceId = savedInvoiceId || initialData?.invoiceId;
                  if (invoiceId) fetchSlaHeader(invoiceId);
                  setSlaModalVisible(true);
                }
              },
            }}
            trigger={['click']}
          >
            <Button
              loading={slaCreating || slaPosting || slaFetching}
              style={{ fontWeight: 500, borderColor: REDWOOD.info, color: REDWOOD.info }}
            >
              Accounting Actions <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>}
          {/* Accounting Status Tag */}
          {slaStatus ? (
            <Tag
              color={slaStatus === 'POSTED' ? 'green' : slaStatus === 'DRAFT' ? '#1677ff' : slaStatus === 'ERROR' ? 'red' : 'orange'}
              icon={slaStatus === 'POSTED' ? <CheckCircleOutlined /> : slaStatus === 'DRAFT' ? <AccountBookOutlined /> : <StopOutlined />}
              style={{ fontSize: 12, padding: '2px 10px', fontWeight: 600 }}
            >
              {slaStatus === 'POSTED' ? 'Posted Done' : slaStatus === 'DRAFT' ? 'Draft Done' : slaStatus === 'ERROR' ? 'Accounting Error' : slaStatus}
            </Tag>
          ) : (
            <Tag color="default" style={{ fontSize: 12, padding: '2px 8px' }}>
              Accounting: None
            </Tag>
          )}
          {savedInvoiceId && (
            <Tag color="green" style={{ fontSize: 12, padding: '2px 10px', fontWeight: 600 }}>
              <CheckCircleOutlined /> Invoice ID: {savedInvoiceId}
            </Tag>
          )}
          {isCancelled ? (
            <Tag
              color="red"
              style={{ fontSize: 12, padding: '4px 12px', fontWeight: 600, borderRadius: 6 }}
            >
              CANCELLED
            </Tag>
          ) : isEditMode && !isEditing && (hasAnyPayment || isPostedToGL || isPaid || isPrepaymentFullyPaid) ? (
            <Tag
              color={isPaid || hasAnyPayment || isPrepaymentFullyPaid ? 'blue' : 'purple'}
              style={{ fontSize: 12, padding: '4px 12px', fontWeight: 600, borderRadius: 6 }}
            >
              {isPrepaymentFullyPaid && !isPaid && !hasAnyPayment ? 'Prepayment Paid' : isPaid || hasAnyPayment ? 'Paid' : 'Posted'}
            </Tag>
          ) : isEditMode && !isEditing ? (
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                setIsEditing(true);
                const invoiceId = savedInvoiceId ?? initialData?.invoiceId ?? null;
                if (invoiceId) {
                  setIsValidated(false);
                  setLiveValidationStatus('Needs Revalidation');
                  saveValidationStatus(invoiceId, 'Needs Revalidation');
                }
              }}
            >
              Edit
            </Button>
          ) : null}
          {isPrepaymentInvoice && isEditMode && !isEditing && prepaymentBalance && prepaymentBalance.totalApplied > 0 && (
            <Tag color="orange" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6 }}>
              Applied: {formatAmount(prepaymentBalance.totalApplied)}
            </Tag>
          )}
          {!isReadOnly && (
            <>
              <Button
                type="default"
                danger
                onClick={() => {
                  form.resetFields();
                  setBuSelected(false);
                  setDerivedCompany('');
                  setSelectedSupplierInfo(null);
                  setLines([createBlankLine(1, { accountingDate: dayjs().format('DD-MMM-YYYY') })]);
                  setSavedInvoiceId(null);
                  setTimeout(() => {
                    const el = document.querySelector('[data-sat-id="invoice-business-unit"] .ant-select-selector');
                    if (el) (el as HTMLElement).click();
                  }, 100);
                }}
              >
                Clear Data
              </Button>
              <Tooltip title={`Preview the full ${savedInvoiceId ? 'PUT' : 'POST'} request — URL and JSON payload (incl. multiperiod start/end dates)`}>
                <Button
                  icon={<ApiOutlined />}
                  onClick={() => handleApiPreview()}
                  data-sat-id="invoice-api-preview-button"
                >
                  API
                </Button>
              </Tooltip>
              <Tooltip title={buSelected && !derivedCompany ? 'No company code for this Business Unit — cannot save invoice' : undefined}>
                <Button
                  type="primary"
                  onClick={handleSave}
                  loading={saving}
                  disabled={saving || !!(buSelected && !derivedCompany)}
                  icon={<SaveOutlined />}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                  data-sat-id="invoice-save-button"
                >
                  {savedInvoiceId ? 'Update Invoice' : 'Save'}
                </Button>
              </Tooltip>
            </>
          )}
          <Button onClick={onClose}>
            {isReadOnly ? 'Close' : 'Cancel'}
          </Button>
        </Space>
        </div>{/* end Row 1 */}

        {/* Row 2: Status tags */}
        {isEditMode && (
          <div style={{ display: 'flex', gap: 6, paddingTop: 4, paddingBottom: 2 }}>
            {isReadOnly && (
              <Tag color="warning" style={{ fontSize: 12 }}>Read-Only</Tag>
            )}
            {liveHoldPaidStatus && !isCancelled && (
              <Tag
                color={liveHoldPaidStatus === 'Paid' ? 'blue' : liveHoldPaidStatus === 'On Hold' ? 'red' : 'orange'}
                style={{ fontSize: 12 }}
              >
                {liveHoldPaidStatus}
              </Tag>
            )}
            {liveValidationStatus && (
              <Tag
                color={liveValidationStatus === 'Validated' ? 'green' : 'orange'}
                style={{ fontSize: 12 }}
              >
                {liveValidationStatus}
              </Tag>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '16px 24px' }}>
        {/* ========== INVOICE HEADER ========== */}
        <Card
          style={{
            marginBottom: 12,
            borderRadius: 8,
            border: `1px solid ${REDWOOD.neutral200}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
          bodyStyle={{ padding: '8px 16px 4px' }}
        >
          <div style={{ marginBottom: 4 }}>
            <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900 }}>Invoice Header</Text>
          </div>
          <Form
            form={form}
            layout="horizontal"
            labelCol={{ span: 9 }}
            wrapperCol={{ span: 15 }}
            size="small"
            disabled={isReadOnly || !buSelected || (buSelected && !derivedCompany)}
            initialValues={{
              invoiceType: 'Standard',
              invoiceCurrency: initialData?.invoiceCurrency || 'AED',
              paymentCurrency: initialData?.invoiceCurrency || 'AED',
              legalEntity: '',
              payGroup: '',
              payAlone: 'No',
              calculateTax: 'Yes',
              liabilityDistribution: '',
              invoiceDate: initialData?.invoiceId ? undefined : dayjs(),
              accountingDate: initialData?.invoiceId ? undefined : dayjs(),
            }}
            onValuesChange={(changedValues, allValues) => {
              setIsValidated(false);
              // Auto-invalidate when the user edits a saved, non-locked invoice
              if (savedInvoiceId && !isPermanentlyLocked) {
                setLiveValidationStatus('Needs Revalidation');
                if (invalidateDebounceRef.current) clearTimeout(invalidateDebounceRef.current);
                invalidateDebounceRef.current = setTimeout(() => {
                  saveValidationStatus(savedInvoiceId, 'Needs Revalidation');
                }, 1500);
              }
              // Debounce invoiceAmount — every keystroke triggers onValuesChange, which
              // causes expensive re-renders of the lines table. Delay state sync by 300ms.
              if ('invoiceAmount' in changedValues) {
                if (amountDebounceRef.current) clearTimeout(amountDebounceRef.current);
                amountDebounceRef.current = setTimeout(() => {
                  setHeaderValues(allValues);
                  const amt = changedValues.invoiceAmount || 0;
                  setLines(prev => {
                    if (prev.length !== 1) return prev;
                    if (prev[0].amount === amt) return prev;
                    return [{ ...prev[0], amount: amt, unitPrice: amt }];
                  });
                }, 300);
                return;
              }
              setHeaderValues(allValues);
              if (changedValues.invoiceCurrency) {
                form.setFieldValue('paymentCurrency', changedValues.invoiceCurrency);
                setHeaderValues((prev) => ({ ...prev, paymentCurrency: changedValues.invoiceCurrency }));
                // Auto-set conversion rate to 1 when switching to functional currency (AED)
                if (changedValues.invoiceCurrency === 'AED') {
                  form.setFieldsValue({ conversionRate: 1, conversionRateType: undefined, conversionDate: undefined });
                  setHeaderValues((prev) => ({ ...prev, conversionRate: 1, conversionRateType: undefined, conversionDate: undefined }));
                } else {
                  // Clear rate fields when switching to a foreign currency so user must fill them
                  form.setFieldsValue({ conversionRate: undefined, conversionRateType: undefined, conversionDate: undefined });
                  setHeaderValues((prev) => ({ ...prev, conversionRate: undefined, conversionRateType: undefined, conversionDate: undefined }));
                }
              }
              // Copy invoice date to all lines' accounting date + derive multiperiod dates
              if (changedValues.invoiceDate) {
                // Only auto-set header accounting date for new invoices, not when editing existing ones
                if (!initialData?.invoiceId) {
                  form.setFieldValue('accountingDate', changedValues.invoiceDate);
                }
                const formattedDate = changedValues.invoiceDate.format('DD-MMM-YYYY');
                const endDate = getEndOfMonth(formattedDate);
                setLines((prev) => prev.map((line) => ({
                  ...line,
                  accountingDate: formattedDate,
                  startDate: formattedDate,
                  endDate,
                })));
                // Keep applyAfterDate in sync with invoice date for Prepayment
                if (allValues.invoiceType === 'Prepayment') {
                  form.setFieldValue('applyAfterDate', changedValues.invoiceDate);
                }
              }
              // When switching to Prepayment: set Apply After Date + auto-fill line distribution
              if (changedValues.invoiceType === 'Prepayment') {
                const invoiceDateVal = form.getFieldValue('invoiceDate');
                if (invoiceDateVal && !form.getFieldValue('applyAfterDate')) {
                  form.setFieldValue('applyAfterDate', invoiceDateVal);
                }
                const liabilityDist = form.getFieldValue('liabilityDistribution') || '';
                const firstSeg = liabilityDist.split('-')[0] || '';
                const prepaymentDist = firstSeg ? `${firstSeg}-00-00-1223108-0000-000-00-000-000` : '';
                setLines((prev) => prev.map((line) => ({
                  ...line,
                  distributionCombination: line.distributionCombination || prepaymentDist,
                })));
              }
              // When liability distribution changes for Prepayment, update line distribution first segment
              if ('liabilityDistribution' in changedValues && allValues.invoiceType === 'Prepayment') {
                const liabilityDist = changedValues.liabilityDistribution || '';
                const firstSeg = liabilityDist.split('-')[0] || '';
                const prepaymentDist = firstSeg ? `${firstSeg}-00-00-1223108-0000-000-00-000-000` : '';
                setLines((prev) => prev.map((line) => ({
                  ...line,
                  distributionCombination: prepaymentDist,
                })));
              }
              // Copy header description to lines that haven't been manually edited
              if ('description' in changedValues) {
                setLines((prev) => prev.map((line) => ({
                  ...line,
                  description: manuallyEditedDescLines.has(line.key)
                    ? line.description
                    : (changedValues.description || ''),
                })));
              }
              // When business unit changes, update buSelected gate
              if ('businessUnit' in changedValues) {
                setBuSelected(!!changedValues.businessUnit);
                fetchTaxCodes(changedValues.businessUnit || '');
                // Derive and store company code for this BU
                const matchedBU = businessUnits.find(bu => bu.name === changedValues.businessUnit);
                setDerivedCompany(matchedBU?.company || '');
              }
              // When business unit changes, build liability distribution:
              // segment 1 = company from BU webservice; rest is fixed
              if ('businessUnit' in changedValues && changedValues.businessUnit) {
                const selectedBU = businessUnits.find(bu => bu.name === changedValues.businessUnit);
                if (selectedBU?.company) {
                  const newLiability = `${selectedBU.company}-00-00-2313101-0000-000-00-000-000`;
                  form.setFieldValue('liabilityDistribution', newLiability);
                  setHeaderValues((prev) => ({ ...prev, liabilityDistribution: newLiability }));
                  // Do NOT copy liability to accrualAccount - they are different accounting purposes
                }
              }
              // DO NOT copy liability distribution to accrual account
              // They should be separate: liability is for AP Liability, accrual is for expense/accrual accounts
              // Copying causes duplicate posting to same account (DR liability + CR liability)
            }}
          >
            <Tabs
              defaultActiveKey="general"
              size="small"
              tabBarStyle={{ marginBottom: 6 }}
              items={[
                {
                  key: 'general',
                  label: (
                    <Space size={4}>
                      <AppstoreOutlined />
                      <span>General</span>
                    </Space>
                  ),
                  children: (
                    <Row gutter={32} style={{ paddingTop: 8 }}>
                      {/* Column 1 */}
                      <Col span={8}>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Business Unit</Text>}
                          name="businessUnit"
                          rules={[{ required: true, message: 'Required' }]}
                          style={{ marginBottom: 4 }}
                          data-sat-id="invoice-business-unit"
                          extra={!buSelected && !isReadOnly
                            ? <Text style={{ fontSize: 11, color: REDWOOD.warning }}>Select a Business Unit to enable the rest of the form</Text>
                            : buSelected && !derivedCompany && !isReadOnly
                            ? <Text style={{ fontSize: 11, color: '#cf1322' }}>⚠ No company code for this BU — cannot save or select accounts</Text>
                            : buSelected && derivedCompany
                            ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>Company Code:</Text><Tag color="blue" style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, marginLeft: 0 }}>{derivedCompany}</Tag></span>
                            : undefined}
                        >
                          <Select
                            placeholder="Select Business Unit"
                            showSearch
                            allowClear
                            disabled={isReadOnly || (!!selectedSupplierInfo && !isReadOnly)}
                          >
                            {businessUnits.map(bu => (
                              <Option key={bu.name} value={bu.name}>{bu.name}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Invoice Number</Text>}
                          name="invoiceNumber"
                          rules={[{ required: true, message: 'Required' }]}
                          style={{ marginBottom: 4 }}
                          data-sat-id="invoice-number"
                        >
                          <Input placeholder="Enter invoice number" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Invoice Currency</Text>}
                          name="invoiceCurrency"
                          rules={[{ required: true, message: 'Required' }]}
                          style={{ marginBottom: 4 }}
                        >
                          <Select showSearch optionFilterProp="children" placeholder="Select currency">
                            {CURRENCIES.map((c) => (
                              <Option key={c.code} value={c.code}>{c.code} - {c.name}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Amount</Text>}
                          name="invoiceAmount"
                          dependencies={['invoiceType']}
                          rules={[
                            { required: true, message: 'Required' },
                            ({ getFieldValue }) => ({
                              validator(_, value) {
                                if (getFieldValue('invoiceType') === 'Credit Memo' && value !== undefined && value !== null && value >= 0) {
                                  return Promise.reject('Credit Memo amount must be negative');
                                }
                                return Promise.resolve();
                              },
                            }),
                          ]}
                          style={{ marginBottom: 4 }}
                          data-sat-id="invoice-amount"
                        >
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="0.00"
                            precision={2}
                            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={(value) => value!.replace(/,/g, '') as any}
                          />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Invoice Date</Text>}
                          name="invoiceDate"
                          rules={[{ required: true, message: 'Required' }]}
                          style={{ marginBottom: 4 }}
                          data-sat-id="invoice-date"
                        >
                          <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Legal Entity</Text>}
                          name="legalEntity"
                          style={{ marginBottom: 4 }}
                        >
                          <Select placeholder="Select entity" allowClear showSearch>
                            {businessUnits.map(bu => (
                              <Option key={bu.name} value={bu.name}>{bu.name}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>

                      {/* Column 2 */}
                      <Col span={8}>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Supplier</Text>}
                          data-sat-id="invoice-supplier"
                          required
                          style={{ marginBottom: 4 }}
                          extra={selectedSupplierInfo ? (
                            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                              # {selectedSupplierInfo.number}
                            </Text>
                          ) : undefined}
                        >
                          <Space.Compact style={{ width: '100%' }}>
                            <Form.Item name="supplier" noStyle rules={[{ required: true, message: 'Required' }]}>
                              <Input
                                placeholder="Search supplier..."
                                readOnly
                                suffix={
                                  <Space size={4}>
                                    <SearchOutlined
                                      style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 14 }}
                                      onClick={openSupplierModal}
                                    />
                                  </Space>
                                }
                                onClick={openSupplierModal}
                                style={{ cursor: 'pointer', flex: 1 }}
                              />
                            </Form.Item>
                            <Tooltip title="Check Balance">
                              <Button
                                icon={<WalletOutlined />}
                                onClick={handleCheckBalance}
                                style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
                              />
                            </Tooltip>
                            <Tooltip title={supplierHasPrepayments ? `${availablePrepayments.length} prepayment(s) available — view API results` : 'Check prepayments for this supplier'}>
                              <Badge
                                count={availablePrepayments.length}
                                size="small"
                                style={{ backgroundColor: REDWOOD.success }}
                              >
                                <Button
                                  icon={<CreditCardOutlined />}
                                  onClick={openPrepaymentAPIDrawer}
                                  style={{
                                    borderColor: supplierHasPrepayments ? REDWOOD.success : REDWOOD.neutral300,
                                    color: supplierHasPrepayments ? REDWOOD.success : REDWOOD.neutral600,
                                    background: supplierHasPrepayments ? '#f6ffed' : undefined,
                                  }}
                                />
                              </Badge>
                            </Tooltip>
                            <Tooltip title="View supplier webservice URL">
                              <Button
                                icon={<ApiOutlined />}
                                onClick={() => {
                                  const bu = form.getFieldValue('businessUnit') || '';
                                  const url = bu
                                    ? `${APEX_SUPPLIERS_URL}&P_BUSINESS_UNIT=${encodeURIComponent(bu)}`
                                    : APEX_SUPPLIERS_URL;
                                  Modal.info({
                                    title: 'Supplier List Webservice',
                                    width: 600,
                                    content: (
                                      <div>
                                        <Text type="secondary" style={{ fontSize: 12 }}>Endpoint called to populate supplier dropdown:</Text>
                                        <div style={{
                                          marginTop: 8,
                                          padding: '10px 14px',
                                          background: '#f5f5f5',
                                          borderRadius: 6,
                                          fontFamily: 'monospace',
                                          fontSize: 12,
                                          wordBreak: 'break-all',
                                          color: REDWOOD.primary,
                                        }}>
                                          {url}
                                        </div>
                                        {bu && (
                                          <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                                            Filtered by Business Unit: <strong>{bu}</strong>
                                          </Text>
                                        )}
                                        <div style={{ marginTop: 12 }}>
                                          <Button
                                            size="small"
                                            icon={<CopyOutlined />}
                                            onClick={() => { navigator.clipboard.writeText(url); }}
                                          >
                                            Copy URL
                                          </Button>
                                        </div>
                                      </div>
                                    ),
                                  });
                                }}
                                style={{ borderColor: REDWOOD.neutral300, color: REDWOOD.neutral600 }}
                              />
                            </Tooltip>
                          </Space.Compact>
                        </Form.Item>
                        <Form.Item name="supplierNumber" hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item name="supplierId" hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Supplier Site</Text>}
                          name="supplierSite"
                          rules={[{ required: true, message: 'Supplier site is required' }]}
                          style={{ marginBottom: 4 }}
                        >
                          <Select
                            placeholder={supplierSiteLoading ? 'Loading sites...' : 'Select site'}
                            loading={supplierSiteLoading}
                            disabled={supplierSiteLoading || isReadOnly}
                            allowClear
                            notFoundContent={supplierSiteLoading ? 'Loading…' : 'No sites — select a supplier first'}
                          >
                            {supplierSites.map(site => (
                              <Option key={site.siteId} value={site.siteId}>
                                {site.siteName}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Type</Text>}
                          name="invoiceType"
                          rules={[{ required: true, message: 'Required' }]}
                          style={{ marginBottom: 4 }}
                        >
                          <Select
                            onChange={(val) => {
                              if (val === 'Credit Memo') {
                                // Auto-negate invoice amount
                                const currentAmt = form.getFieldValue('invoiceAmount');
                                if (currentAmt !== undefined && currentAmt !== null && currentAmt > 0) {
                                  form.setFieldValue('invoiceAmount', -currentAmt);
                                }
                                // Auto-negate all line amounts
                                setLines((prev) => prev.map((line) => ({
                                  ...line,
                                  amount: line.amount > 0 ? -line.amount : line.amount,
                                })));
                              }
                            }}
                          >
                            <Option value="Standard">Standard</Option>
                            <Option value="Prepayment">Prepayment</Option>
                            <Option value="Debit Memo">Debit Memo</Option>
                            <Option value="Credit Memo">Credit Memo</Option>
                          </Select>
                        </Form.Item>
                        {headerValues.invoiceType === 'Prepayment' && (
                          <Form.Item
                            label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Apply After Date</Text>}
                            name="applyAfterDate"
                            style={{ marginBottom: 4 }}
                          >
                            <DatePicker
                              format="DD-MMM-YYYY"
                              style={{ width: '100%' }}
                              disabled={isReadOnly}
                            />
                          </Form.Item>
                        )}
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Payment Currency</Text>}
                          name="paymentCurrency"
                          style={{ marginBottom: 4 }}
                        >
                          <Select showSearch optionFilterProp="children">
                            {CURRENCIES.map((c) => (
                              <Option key={c.code} value={c.code}>{c.code} - {c.name}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Pay Group</Text>}
                          name="payGroup"
                          style={{ marginBottom: 4 }}
                        >
                          <Select placeholder="Select pay group" allowClear>
                            <Option value="Standard">Standard</Option>
                            <Option value="Urgent">Urgent</Option>
                            <Option value="Manual">Manual</Option>
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Pay Alone</Text>}
                          name="payAlone"
                          style={{ marginBottom: 4 }}
                        >
                          <Select>
                            <Option value="No">No</Option>
                            <Option value="Yes">Yes</Option>
                          </Select>
                        </Form.Item>
                      </Col>

                      {/* Column 3 */}
                      <Col span={8}>
                        <Form.Item
                          label={
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Description</Text>
                              {!isReadOnly && (
                                <Tooltip title="Edit description">
                                  <EditOutlined
                                    style={{ fontSize: 11, color: '#8c8c8c', cursor: 'pointer' }}
                                    onClick={() => setHeaderDescModal(true)}
                                  />
                                </Tooltip>
                              )}
                            </span>
                          }
                          name="description"
                          style={{ marginBottom: 4 }}
                        >
                          <TextArea rows={2} placeholder="Enter description" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Invoice Group</Text>}
                          name="invoiceGroup"
                          style={{ marginBottom: 4 }}
                        >
                          <Input placeholder="Enter group" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Payment Terms</Text>}
                          name="paymentTerms"
                          rules={[{ required: true, message: 'Required' }]}
                          style={{ marginBottom: 4 }}
                        >
                          <Select placeholder="Select terms" allowClear showSearch>
                            <Option value="Immediate">Immediate</Option>
                            <Option value="Net 15">Net 15</Option>
                            <Option value="Net 30">Net 30</Option>
                            <Option value="Net 45">Net 45</Option>
                            <Option value="Net 60">Net 60</Option>
                            <Option value="Net 90">Net 90</Option>
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Terms Date</Text>}
                          name="termsDate"
                          style={{ marginBottom: 4 }}
                        >
                          <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Goods Received Date</Text>}
                          name="goodsReceivedDate"
                          style={{ marginBottom: 4 }}
                        >
                          <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Calculate Tax</Text>}
                          name="calculateTax"
                          style={{ marginBottom: 4 }}
                        >
                          <Select>
                            <Option value="Yes">Yes</Option>
                            <Option value="No">No</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'accounting',
                  forceRender: true,
                  label: (
                    <Space size={4}>
                      <AccountBookOutlined />
                      <span>Accounting</span>
                    </Space>
                  ),
                  children: (
                    <Row gutter={32} style={{ paddingTop: 8 }}>
                      {/* Column 1 */}
                      <Col span={8}>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Accounting Date</Text>}
                          name="accountingDate"
                          style={{ marginBottom: 4 }}
                        >
                          <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Liability Distribution</Text>}
                          required
                          style={{ marginBottom: 4 }}
                        >
                          <Space.Compact style={{ width: '100%' }}>
                            <Form.Item name="liabilityDistribution" noStyle rules={[{ required: true, message: 'Required' }]}>
                              <Input
                                placeholder="Select account via the search button →"
                                readOnly
                                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                                onClick={() => !isReadOnly && openAccountSelector('__liability__', form.getFieldValue('liabilityDistribution'))}
                              />
                            </Form.Item>
                            <Tooltip title="Select Account">
                              <Button
                                icon={<SearchOutlined />}
                                disabled={isReadOnly}
                                onClick={() => !isReadOnly && openAccountSelector('__liability__', form.getFieldValue('liabilityDistribution'))}
                                style={{ borderColor: isReadOnly ? undefined : REDWOOD.info, color: isReadOnly ? undefined : REDWOOD.info }}
                              />
                            </Tooltip>
                          </Space.Compact>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Document Category</Text>}
                          name="documentCategory"
                          style={{ marginBottom: 4 }}
                        >
                          <Select placeholder="Select category" allowClear showSearch>
                            <Option value="Standard Invoices">Standard Invoices</Option>
                            <Option value="Credit Memos">Credit Memos</Option>
                            <Option value="Prepayments">Prepayments</Option>
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Document Sequence</Text>}
                          name="documentSequence"
                          style={{ marginBottom: 4 }}
                        >
                          <InputNumber placeholder="Auto-generated" style={{ width: '100%' }} precision={0} disabled />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Voucher Number</Text>}
                          name="voucherNumber"
                          style={{ marginBottom: 4 }}
                        >
                          <Input placeholder="Enter voucher number" />
                        </Form.Item>
                      </Col>

                      {/* Column 2 */}
                      <Col span={8}>
                        {(() => {
                          const isFuncCcy = (headerValues.invoiceCurrency || 'AED') === 'AED';
                          return (<>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Conversion Rate Type</Text>}
                          name="conversionRateType"
                          style={{ marginBottom: 4 }}
                          required={!isFuncCcy}
                        >
                          <Select placeholder={isFuncCcy ? 'N/A – functional currency' : 'Select rate type'} allowClear disabled={isFuncCcy || isReadOnly}>
                            <Option value="User">User</Option>
                            <Option value="Corporate">Corporate</Option>
                            <Option value="Spot">Spot</Option>
                          </Select>
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Conversion Date</Text>}
                          name="conversionDate"
                          style={{ marginBottom: 4 }}
                          required={!isFuncCcy}
                        >
                          <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder={isFuncCcy ? 'N/A' : 'dd-mmm-yyyy'} disabled={isFuncCcy || isReadOnly} />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Conversion Rate</Text>}
                          name="conversionRate"
                          style={{ marginBottom: 4 }}
                          required={!isFuncCcy}
                          extra={!isFuncCcy && (
                            bmsRateLoading
                              ? <Text type="secondary" style={{ fontSize: 10 }}>Fetching rate…</Text>
                              : bmsRate
                                ? <Space size={4}>
                                    <Text style={{ fontSize: 10, color: '#0572CE' }}>
                                      {bmsRate.rateType}: <strong>{bmsRate.rate}</strong> (inv: {bmsRate.inverseRate}) — {bmsRate.rateDate}
                                    </Text>
                                    <Button type="link" size="small" style={{ fontSize: 10, padding: 0, height: 'auto' }}
                                      onClick={() => form.setFieldsValue({
                                        conversionRate: bmsRate.rate,
                                        conversionRateType: bmsRate.rateType,
                                        conversionDate: dayjs(bmsRate.rateDate),
                                      })}>
                                      Apply
                                    </Button>
                                    <Button type="text" size="small" loading={bmsRateLoading} icon={<ReloadOutlined />} onClick={fetchBmsRate} style={{ fontSize: 10, padding: 0, height: 'auto' }}>
                                      ↻ Refresh
                                    </Button>
                                  </Space>
                                : null
                          )}
                        >
                          <InputNumber style={{ width: '100%' }} placeholder={isFuncCcy ? '1' : '0.000000'} precision={6} min={0} disabled={isFuncCcy || isReadOnly} />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Inverse Rate</Text>}
                          style={{ marginBottom: 4 }}
                        >
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="Auto-calculated"
                            precision={6}
                            disabled
                            value={isFuncCcy ? 1 : (headerValues?.conversionRate ? (1 / headerValues.conversionRate) : undefined)}
                          />
                        </Form.Item>
                          </>);
                        })()}
                      </Col>

                      {/* Column 3 */}
                      <Col span={8}>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>First-Party Tax Reg No.</Text>}
                          name="firstPartyTaxRegistrationNumber"
                          style={{ marginBottom: 4 }}
                        >
                          <Input placeholder="Enter registration number" />
                        </Form.Item>
                        <Form.Item
                          label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Supplier Tax Reg No.</Text>}
                          name="supplierTaxRegistrationNumber"
                          style={{ marginBottom: 4 }}
                        >
                          <Input placeholder="Enter registration number" />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
              ]}
            />
          </Form>
        </Card>

        {/* ========== INVOICE LINES ========== */}
        <Card
          style={{
            marginBottom: 16,
            borderRadius: 8,
            border: `1px solid ${!isHeaderComplete ? REDWOOD.neutral300 : REDWOOD.neutral200}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            position: 'relative',
          }}
        >
          {/* Lock overlay when header is incomplete */}
          {!isHeaderComplete && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(255, 255, 255, 0.85)',
                zIndex: 5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                cursor: 'not-allowed',
              }}
            >
              <LockOutlined style={{ fontSize: 32, color: REDWOOD.neutral300, marginBottom: 12 }} />
              <Text style={{ fontSize: 14, color: REDWOOD.neutral600, fontWeight: 500 }}>
                Complete the Invoice Header to enter lines
              </Text>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                Fill in Business Unit, Invoice Number, Currency, Amount, Date, Supplier, and Type
              </Text>
            </div>
          )}

          {(() => {
            const _mpaActiveCount = lines.filter((l) =>
              l.startDate && l.endDate && l.accrualAccount && l.amount !== 0 &&
              dayjs(l.startDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM') !==
              dayjs(l.endDate,   ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM')
            ).length;
            return (
          <div data-sat-id="invoice-lines-table" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900 }}>
              Invoice Lines
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>({lines.length} line{lines.length !== 1 ? 's' : ''})</Text>
              {isHeaderComplete && (
                <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>
                  <CheckCircleOutlined /> Header Complete
                </Tag>
              )}
              {_mpaActiveCount > 0 && (
                <Tag color="purple" style={{ marginLeft: 8, fontSize: 11, fontWeight: 600 }}>
                  <CalendarOutlined style={{ marginRight: 3 }} />
                  Multiperiod Active — {_mpaActiveCount} line{_mpaActiveCount > 1 ? 's' : ''}
                </Tag>
              )}
            </Text>
            <Space>
              {!isReadOnly && (
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  onClick={() => { setImportPreviewData([]); setPasteText(''); setImportModalVisible(true); }}
                  disabled={!isHeaderComplete}
                  style={{ fontSize: 12, borderColor: REDWOOD.info, color: REDWOOD.info }}
                >
                  Import Lines
                </Button>
              )}
            </Space>
          </div>
            );
          })()}

          <Tabs
            activeKey={activeTabKey}
            onChange={setActiveTabKey}
            size="small"
            items={[
              {
                key: 'distribution',
                label: (
                  <Space size={4}>
                    <FileTextOutlined />
                    <span>Distribution</span>
                  </Space>
                ),
                children: (
                  <Table
                    columns={distributionColumns}
                    dataSource={lines}
                    size="small"
                    pagination={false}
                    scroll={{ x: 1600 }}
                    rowSelection={rowSelection}
                    summary={() => (
                      <Table.Summary fixed>
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={3}>
                            <Text strong style={{ fontSize: 12, paddingLeft: 8 }}>Total</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="right">
                            <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>
                              {formatAmount(linesTotal)}
                            </Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={4} colSpan={7} />
                        </Table.Summary.Row>
                      </Table.Summary>
                    )}
                  />
                ),
              },
              {
                key: 'multiperiod',
                label: (() => {
                  const _cnt = lines.filter((l) =>
                    l.startDate && l.endDate && l.accrualAccount && l.amount !== 0 &&
                    dayjs(l.startDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM') !==
                    dayjs(l.endDate,   ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM')
                  ).length;
                  return (
                    <Space size={4}>
                      <CalendarOutlined />
                      <span>Multiperiod Accounting</span>
                      {_cnt > 0 && (
                        <Tag color="purple" style={{ marginLeft: 2, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
                          {_cnt}
                        </Tag>
                      )}
                    </Space>
                  );
                })(),
                children: (() => {
                  const invId = savedInvoiceId || initialData?.invoiceId;
                  const checkUrl  = invId ? `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/${invId}` : '';
                  const genUrl    = invId ? `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/generate` : '';

                  const handleCheckSchedule = async () => {
                    if (!invId) { message.warning('Save the invoice first.'); return; }
                    setMpaTabLoading(true);
                    setMpaTabApiUrl(checkUrl);
                    try {
                      const detail = await getMpaSchedule(invId);
                      setMpaTabSchedule(detail.lines || []);
                      setMpaTabChecked(true);
                    } catch {
                      setMpaTabSchedule([]);
                      setMpaTabChecked(true);
                    } finally {
                      setMpaTabLoading(false);
                    }
                  };

                  const handleGenerateSchedule = async () => {
                    if (!invId) { message.warning('Save the invoice first.'); return; }
                    setMpaTabGenerating(true);
                    setMpaTabApiUrl(genUrl);
                    try {
                      await generateMpaSchedule(invId);
                      message.success('Schedule generated successfully');
                      const detail = await getMpaSchedule(invId);
                      setMpaTabSchedule(detail.lines || []);
                      setMpaTabChecked(true);
                    } catch (e: any) {
                      message.error(e?.message || 'Failed to generate schedule');
                    } finally {
                      setMpaTabGenerating(false);
                    }
                  };

                  const scheduleColumns = [
                    { title: 'Period',        dataIndex: 'periodName',   key: 'periodName',   width: 120 },
                    { title: 'Period Date',   dataIndex: 'periodDate',   key: 'periodDate',   width: 120 },
                    { title: 'Amount',        dataIndex: 'periodAmount', key: 'periodAmount', width: 120, align: 'right' as const,
                      render: (v: number) => <Text strong>{formatAmount(v)}</Text> },
                    { title: 'Status',        dataIndex: 'postingStatus',key: 'postingStatus',width: 110,
                      render: (v: string) => <Tag color={v === 'Posted' ? 'success' : 'warning'}>{v || 'Pending'}</Tag> },
                    { title: 'Posted Date',   dataIndex: 'postedDate',  key: 'postedDate',   width: 120,
                      render: (v: string | null) => v || '—' },
                    { title: 'Accrual Account', dataIndex: 'accrualAccount', key: 'accrualAccount', ellipsis: true },
                  ];

                  return (
                    <div>
                      {/* Lines table */}
                      <Table
                        columns={multiperiodColumns}
                        dataSource={lines}
                        size="small"
                        pagination={false}
                        scroll={{ x: 1100 }}
                        rowSelection={rowSelection}
                        summary={() => (
                          <Table.Summary fixed>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={2}>
                                <Text strong style={{ fontSize: 12, paddingLeft: 8 }}>Total</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={2} align="right">
                                <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>
                                  {formatAmount(linesTotal)}
                                </Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={3} colSpan={5} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />

                      {/* Schedule toolbar */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 12px',
                        borderTop: `1px solid ${REDWOOD.borderColor || '#e5e5e5'}`,
                        background: '#fafafa',
                        flexWrap: 'wrap',
                      }}>
                        <Text strong style={{ fontSize: 12, marginRight: 4 }}>Schedule:</Text>
                        <Button
                          size="small"
                          icon={<SearchOutlined />}
                          loading={mpaTabLoading}
                          onClick={handleCheckSchedule}
                          disabled={!invId}
                        >
                          Check Schedule
                        </Button>
                        {mpaTabChecked && mpaTabSchedule.length === 0 && (
                          <Button
                            size="small"
                            type="primary"
                            icon={<PlayCircleOutlined />}
                            loading={mpaTabGenerating}
                            onClick={handleGenerateSchedule}
                            disabled={!invId}
                            style={{ background: '#722ed1', borderColor: '#722ed1' }}
                          >
                            Generate Schedule
                          </Button>
                        )}
                        {mpaTabApiUrl && (
                          <Tooltip title="Show API URL">
                            <Button
                              size="small"
                              icon={<ApiOutlined />}
                              style={{ color: '#1677ff', borderColor: '#1677ff' }}
                              onClick={() => Modal.info({
                                title: 'API Request — Multiperiod Schedule',
                                width: 860,
                                content: (
                                  <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                                    {mpaTabApiUrl}
                                  </Typography.Text>
                                ),
                              })}
                            />
                          </Tooltip>
                        )}
                        {mpaTabChecked && (
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                            {mpaTabSchedule.length > 0
                              ? `${mpaTabSchedule.length} schedule period${mpaTabSchedule.length !== 1 ? 's' : ''} found`
                              : 'No schedule found — click Generate Schedule to create it'}
                          </Text>
                        )}
                      </div>

                      {/* Schedule results */}
                      {mpaTabChecked && mpaTabSchedule.length > 0 && (
                        <Table
                          columns={scheduleColumns}
                          dataSource={mpaTabSchedule.map((r, i) => ({ ...r, key: i }))}
                          size="small"
                          pagination={false}
                          scroll={{ x: 800 }}
                          style={{ borderTop: `1px solid ${REDWOOD.borderColor || '#e5e5e5'}` }}
                          summary={(rows) => {
                            const total = rows.reduce((s, r) => s + (r.periodAmount || 0), 0);
                            return (
                              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
                                <Table.Summary.Cell index={0} colSpan={2}>
                                  <Text strong style={{ fontSize: 12 }}>Total</Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={2} align="right">
                                  <Text strong style={{ color: REDWOOD.primary }}>{formatAmount(total)}</Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={3} colSpan={3} />
                              </Table.Summary.Row>
                            );
                          }}
                        />
                      )}
                    </div>
                  );
                })(),
              },
              {
                key: 'purchaseOrders',
                label: (
                  <Space size={4}>
                    <ShoppingCartOutlined />
                    <span>Purchase Orders</span>
                  </Space>
                ),
                children: (
                  <Table
                    columns={poColumns}
                    dataSource={lines}
                    size="small"
                    pagination={false}
                    scroll={{ x: 1500 }}
                    rowSelection={rowSelection}
                    summary={() => (
                      <Table.Summary fixed>
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0}>
                            <Text strong style={{ fontSize: 12, paddingLeft: 8 }}>Total</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right">
                            <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>
                              {formatAmount(linesTotal)}
                            </Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} colSpan={10} />
                        </Table.Summary.Row>
                      </Table.Summary>
                    )}
                  />
                ),
              },
              // Payments tab (edit mode only, shown when payments exist)
              ...(isEditMode ? [{
                key: 'payments',
                label: (
                  <Space size={4}>
                    <CreditCardOutlined />
                    <span>Payments ({invoicePayments.length})</span>
                    <Tooltip
                      title={
                        <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          {invoicePaymentsUrl}
                        </span>
                      }
                      placement="bottom"
                    >
                      <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 12 }} />
                    </Tooltip>
                  </Space>
                ),
                children: invoicePaymentsLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <div style={{ marginTop: 8, color: REDWOOD.neutral600, fontSize: 12 }}>Loading payments...</div>
                  </div>
                ) : invoicePayments.length > 0 ? (
                  <Table
                    dataSource={invoicePayments}
                    columns={[
                      { title: 'Number',             dataIndex: 'number',           key: 'number',           width: 80 },
                      { title: 'Payment Document',   dataIndex: 'paymentDocument',  key: 'paymentDocument',  width: 200, ellipsis: true },
                      { title: 'Status',             dataIndex: 'status',           key: 'status',           width: 130,
                        render: (s: string) => {
                          const lower = s?.toLowerCase() ?? '';
                          const color = lower.includes('fully') ? 'green' : lower.includes('partial') ? 'orange' : lower.includes('not') ? 'red' : lower.includes('void') ? 'red' : lower.includes('clear') ? 'green' : 'default';
                          return <Tag color={color}>{s}</Tag>;
                        }},
                      { title: 'Reconciled',         dataIndex: 'reconciled',       key: 'reconciled',       width: 100, align: 'center' as const,
                        render: (v: string) => v === 'Yes' ? <Tag color="green">Yes</Tag> : v === 'No' ? <Tag>No</Tag> : '—' },
                      { title: 'Current Payee Name', dataIndex: 'currentPayeeName', key: 'currentPayeeName', width: 220, ellipsis: true },
                      { title: 'Payment Date',       dataIndex: 'paymentDate',      key: 'paymentDate',      width: 110 },
                      { title: 'Paid Amount',        dataIndex: 'paidAmount',       key: 'paidAmount',       width: 160, align: 'right' as const,
                        render: (amt: number, row: any) => (
                          <Text strong style={{ color: REDWOOD.success }}>{formatAmount(amt)}{row.currency ? ` ${row.currency}` : ''}</Text>
                        )},
                      { title: 'Discount Taken',     dataIndex: 'discountTaken',    key: 'discountTaken',    width: 150, align: 'right' as const,
                        render: (amt: number, row: any) => amt > 0
                          ? <Text style={{ color: '#52c41a' }}>{formatAmount(amt)}{row.currency ? ` ${row.currency}` : ''}</Text>
                          : <Text style={{ color: REDWOOD.neutral400 }}>—</Text>
                      },
                      { title: 'Address',            dataIndex: 'address',          key: 'address',          ellipsis: true,
                        render: (v: string) => v || '—' },
                      { title: 'Remit-to Account',   dataIndex: 'remitToAccount',   key: 'remitToAccount',   width: 160, ellipsis: true,
                        render: (v: string) => v || '—' },
                      {
                        title: 'Action', key: 'voidAction', width: 70, fixed: 'right' as const,
                        render: (_: any, row: any) => {
                          const isVoided = row.status?.toLowerCase().includes('void');
                          return (
                            <Tooltip title={isVoided ? 'Already voided' : 'Void Payment'}>
                              <Button
                                size="small"
                                danger={!isVoided}
                                disabled={isVoided}
                                icon={<StopOutlined />}
                                style={{ fontSize: 11, padding: '0 6px' }}
                                onClick={() => openInvoiceVoidModal(row.checkId, { number: row.number, paymentDate: row.paymentDate, paidAmount: row.paidAmount, currency: row.currency })}
                              />
                            </Tooltip>
                          );
                        },
                      },
                    ]}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    scroll={{ x: 1300, y: 300 }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: 30, color: REDWOOD.neutral600, fontSize: 12 }}>
                    {(initialData?.invoiceAmount ?? headerValues.invoiceAmount ?? 0) < 0
                      ? 'Credit notes are settled by applying the credit against another invoice (Pre-Payment Applications tab), not by a cash payment.'
                      : 'No payments found for this invoice.'}
                  </div>
                ),
              }] : []),
              // Holds tab (edit mode only, shown when holds exist)
              ...(isEditMode ? [{
                key: 'holds',
                label: (
                  <Space size={4}>
                    <StopOutlined />
                    <span>Holds ({invoiceHolds.length})</span>
                    {invoiceHolds.length > 0 && <Tag color="red" style={{ fontSize: 10, marginLeft: 2, padding: '0 4px', lineHeight: '16px' }}>{invoiceHolds.length}</Tag>}
                  </Space>
                ),
                children: invoiceHoldsLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <div style={{ marginTop: 8, color: REDWOOD.neutral600, fontSize: 12 }}>Loading holds...</div>
                  </div>
                ) : invoiceHolds.length > 0 ? (
                  <Table
                    dataSource={invoiceHolds}
                    columns={[
                      { title: 'Hold Name', dataIndex: 'holdName', key: 'holdName', width: 180, render: (v: string) => <Text strong style={{ color: REDWOOD.error }}>{v}</Text> },
                      { title: 'Hold Reason', dataIndex: 'holdReason', key: 'holdReason', ellipsis: true },
                      { title: 'Hold Date', dataIndex: 'holdDate', key: 'holdDate', width: 110 },
                      { title: 'Held By', dataIndex: 'heldBy', key: 'heldBy', width: 140 },
                      { title: 'Release Date', dataIndex: 'releaseDate', key: 'releaseDate', width: 110, render: (v: string) => v ? <Text style={{ color: REDWOOD.success }}>{v}</Text> : <Tag color="red">Active</Tag> },
                      { title: 'Released By', dataIndex: 'releasedBy', key: 'releasedBy', width: 140 },
                    ]}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    scroll={{ y: 300 }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: 30, color: REDWOOD.neutral600, fontSize: 12 }}>
                    No holds on this invoice.
                  </div>
                ),
              }] : []),
              // Installments tab (edit mode only)
              ...(isEditMode ? [{
                key: 'installments',
                label: (
                  <Space size={4}>
                    <DollarOutlined />
                    <span>Installments ({invoiceInstallments.length})</span>
                    <Tooltip
                      title={
                        <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          {invoiceInstallmentsUrl}
                        </span>
                      }
                      placement="bottom"
                    >
                      <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 12 }} />
                    </Tooltip>
                  </Space>
                ),
                children: invoiceInstallmentsLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <div style={{ marginTop: 8, color: REDWOOD.neutral600, fontSize: 12 }}>Loading installments...</div>
                  </div>
                ) : invoiceInstallments.length > 0 ? (
                  <Table
                    dataSource={invoiceInstallments}
                    columns={[
                      { title: '#', dataIndex: 'installmentNumber', key: 'installmentNumber', width: 60, align: 'center' as const },
                      { title: 'Due Date', dataIndex: 'dueDate', key: 'dueDate', width: 110 },
                      { title: 'Gross Amount', dataIndex: 'grossAmount', key: 'grossAmount', width: 130, align: 'right' as const, render: (v: number) => <Text strong>{formatAmount(v)}</Text> },
                      { title: 'Unpaid Amount', dataIndex: 'unpaidAmount', key: 'unpaidAmount', width: 130, align: 'right' as const, render: (v: number) => <Text style={{ color: v > 0 ? REDWOOD.error : REDWOOD.success }}>{formatAmount(v)}</Text> },
                      { title: 'Priority', dataIndex: 'paymentPriority', key: 'paymentPriority', width: 80, align: 'center' as const },
                      { title: 'Payment Method', dataIndex: 'paymentMethod', key: 'paymentMethod', width: 140 },
                      { title: 'Bank Account', dataIndex: 'bankAccount', key: 'bankAccount', ellipsis: true },
                    ]}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    scroll={{ y: 300 }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: 30, color: REDWOOD.neutral600, fontSize: 12 }}>
                    No installments found for this invoice.
                  </div>
                ),
              }] : []),
              // Pre-Payment Applications tab (always visible)
              // — Prepayment invoice: shows which standard invoices applied THIS prepayment
              // — Standard invoice:   shows which prepayments were applied to THIS invoice
              ...[{
                key: 'prepaymentApplications',
                label: (
                  <Space size={4}>
                    <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                    <span>
                      {isPrepaymentInvoice
                        ? `Applied to Invoices (${appliedInvoicesList.length})`
                        : `Pre-Payment Applications (${appliedPrepaymentsList.length})`}
                    </span>
                    <Tooltip
                      title={
                        <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          {isPrepaymentInvoice
                            ? `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/by-prepayment/${initialData?.invoiceId ?? ''}`
                            : `${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments?P_INVOICE_ID=${savedInvoiceId ?? initialData?.invoiceId ?? ''}`}
                        </span>
                      }
                      placement="bottom"
                    >
                      <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 12 }} />
                    </Tooltip>
                  </Space>
                ),
                children: isPrepaymentInvoice ? (
                  // ── Prepayment invoice view: which standard invoices used this prepayment ──
                  <>
                    {prepaymentBalance && (
                      <div style={{ display: 'flex', gap: 24, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, marginBottom: 10, border: '1px solid #b7eb8f', fontSize: 12 }}>
                        <span><Text type="secondary">Invoice Amount:</Text> <Text strong>{formatAmount(prepaymentBalance.invoiceAmount)}</Text></span>
                        <span><Text type="secondary">Total Applied:</Text> <Text strong style={{ color: REDWOOD.primary }}>{formatAmount(prepaymentBalance.totalApplied)}</Text></span>
                        <span><Text type="secondary">Available Balance:</Text> <Text strong style={{ color: REDWOOD.success }}>{formatAmount(prepaymentBalance.availableBalance)}</Text></span>
                      </div>
                    )}
                    <Table<AppliedInvoice>
                      dataSource={appliedInvoicesList}
                      rowKey="key"
                      size="small"
                      pagination={false}
                      scroll={{ x: 800, y: 300 }}
                      summary={rows => {
                        const total = rows.reduce((s, r) => s + r.appliedAmount, 0);
                        return (
                          <Table.Summary fixed>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={3} align="right">
                                <Text strong style={{ fontSize: 12 }}>Total Applied</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={3} align="right">
                                <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>{formatAmount(total)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={4} />
                              <Table.Summary.Cell index={5} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        );
                      }}
                      columns={[
                        {
                          title: 'Invoice Number',
                          dataIndex: 'invoiceNumber',
                          width: 160,
                          render: (v: string) => <Text style={{ color: REDWOOD.info, fontSize: 12 }}>{v || '—'}</Text>,
                        },
                        {
                          title: 'Description',
                          dataIndex: 'description',
                          ellipsis: true,
                          render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
                        },
                        {
                          title: 'Currency',
                          dataIndex: 'currency',
                          width: 80,
                          render: (v: string) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : <Text style={{ fontSize: 12 }}>—</Text>,
                        },
                        {
                          title: 'Applied Amount',
                          dataIndex: 'appliedAmount',
                          width: 130,
                          align: 'right' as const,
                          render: (v: number) => (
                            <Text strong style={{ fontSize: 12, color: REDWOOD.primary }}>{formatAmount(v)}</Text>
                          ),
                        },
                        {
                          title: 'Application Date',
                          dataIndex: 'applicationAccountingDate',
                          width: 160,
                          render: (v: string) => (
                            <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YYYY') : '—'}</Text>
                          ),
                        },
                        {
                          title: 'Status',
                          dataIndex: 'status',
                          width: 100,
                          render: (v: string) => v ? (
                            <Tag color={v.toLowerCase() === 'cancelled' ? 'red' : 'green'} style={{ fontSize: 11 }}>{v}</Tag>
                          ) : <Text style={{ fontSize: 12 }}>—</Text>,
                        },
                      ]}
                      locale={{ emptyText: 'No invoices have applied this prepayment yet.' }}
                    />
                  </>
                ) : (
                  // ── Standard invoice view: which prepayments were applied to this invoice ──
                  <Table<AppliedPrepayment>
                    dataSource={appliedPrepaymentsList}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    scroll={{ x: 900, y: 300 }}
                    summary={rows => {
                      const total = rows.reduce((s, r) => s + r.appliedAmount, 0);
                      return (
                        <Table.Summary fixed>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={5} align="right">
                              <Text strong style={{ fontSize: 12 }}>Total Applied</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={5} align="right">
                              <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>{formatAmount(total)}</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={6} />
                          </Table.Summary.Row>
                        </Table.Summary>
                      );
                    }}
                    columns={[
                      {
                        title: 'Prepayment Number',
                        dataIndex: 'prepaymentNumber',
                        width: 150,
                        render: (v: string) => (
                          <Text style={{ color: REDWOOD.info, fontSize: 12 }}>
                            {v.length > 15 ? v.slice(0, 15) + '…' : v}
                          </Text>
                        ),
                      },
                      {
                        title: 'Description',
                        dataIndex: 'description',
                        ellipsis: true,
                        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
                      },
                      {
                        title: 'Site',
                        dataIndex: 'supplierSite',
                        width: 110,
                        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
                      },
                      {
                        title: 'Purchase Order',
                        dataIndex: 'purchaseOrder',
                        width: 130,
                        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
                      },
                      {
                        title: 'Currency',
                        dataIndex: 'currency',
                        width: 80,
                        render: (v: string) => <Tag style={{ fontSize: 11 }}>{v}</Tag>,
                      },
                      {
                        title: 'Applied Amount',
                        dataIndex: 'appliedAmount',
                        width: 120,
                        align: 'right' as const,
                        render: (v: number) => (
                          <Text strong style={{ fontSize: 12, color: REDWOOD.primary }}>{formatAmount(v)}</Text>
                        ),
                      },
                      {
                        title: 'Application Accounting Date',
                        dataIndex: 'applicationAccountingDate',
                        width: 180,
                        render: (v: string) => (
                          <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YYYY') : '—'}</Text>
                        ),
                      },
                      {
                        title: 'Created By',
                        dataIndex: 'createdBy',
                        width: 120,
                        align: 'center' as const,
                        render: (v: string) => (
                          <Text style={{ fontSize: 11 }}>{v || '—'}</Text>
                        ),
                      },
                      {
                        title: 'Sync Status',
                        dataIndex: 'syncStatus',
                        width: 110,
                        align: 'center' as const,
                        render: (v: string) =>
                          v === 'SYNCED'
                            ? <Tag color="blue" style={{ fontSize: 10 }}>SYNCED</Tag>
                            : <Tag style={{ fontSize: 10 }}>NEW</Tag>,
                      },
                      {
                        title: 'Accounting',
                        width: 180,
                        align: 'center' as const,
                        render: (_: any, record: AppliedPrepayment) => {
                          const slaInfo   = appSlaMap[record.applicationId];
                          const st        = slaInfo?.status ?? null;
                          const isLoading = appSlaLoadingId === record.applicationId;
                          const tagColor  = st === 'POSTED' ? 'green' : st === 'DRAFT' ? '#1677ff' : st === 'ERROR' ? 'red' : 'default';
                          const tagLabel  = st === 'POSTED' ? 'Posted' : st === 'DRAFT' ? 'Draft' : st === 'ERROR' ? 'Error' : 'None';
                          const isFusionSync = record.syncStatus === 'SYNCED' || record.createdBy === 'FUSION_SYNC';
                          return (
                            <Space direction="vertical" size={2} style={{ width: '100%', alignItems: 'center' }}>
                              <Tag color={tagColor} style={{ fontSize: 11, margin: 0 }}>
                                {st === 'POSTED' ? <CheckCircleOutlined /> : st === 'DRAFT' ? <AccountBookOutlined /> : null}
                                {' '}{tagLabel}
                              </Tag>
                              {/* Hide accounting dropdown for Fusion-synced rows or when already posted */}
                              {!isFusionSync && st !== 'POSTED' && (
                                <Dropdown
                                  disabled={isLoading}
                                  menu={{
                                    items: [
                                      {
                                        key: 'create',
                                        icon: <CheckSquareOutlined />,
                                        label: st === 'DRAFT' ? 'Re-create Accounting' : 'Create Accounting',
                                      },
                                      ...(st === 'DRAFT' ? [{
                                        key: 'post',
                                        icon: <SendOutlined />,
                                        label: 'Post to Ledger',
                                      }] : []),
                                    ],
                                    onClick: ({ key }: { key: string }) => {
                                      if (key === 'create') handleAppCreateAccounting(record);
                                      else if (key === 'post') handleAppPostToLedger(record);
                                    },
                                  }}
                                  trigger={['click']}
                                >
                                  <Button
                                    size="small"
                                    loading={isLoading}
                                    style={{ fontSize: 11, borderColor: REDWOOD.info, color: REDWOOD.info }}
                                  >
                                    Accounting <DownOutlined style={{ fontSize: 9 }} />
                                  </Button>
                                </Dropdown>
                              )}
                            </Space>
                          );
                        },
                      },
                      {
                        title: 'Action',
                        width: 90,
                        align: 'center' as const,
                        render: (_: any, record: AppliedPrepayment) => {
                          const isFusionSync = record.syncStatus === 'SYNCED' || record.createdBy === 'FUSION_SYNC';
                          return (
                            <Tooltip title={isFusionSync ? 'Cannot unapply Fusion-synced application' : undefined}>
                              <Button
                                size="small"
                                danger
                                disabled={isFusionSync}
                                onClick={() => {
                                  setUnapplyRecord(record);
                                  setUnapplyDate(dayjs());
                                  setUnapplyModalVisible(true);
                                }}
                              >
                                Un-Apply
                              </Button>
                            </Tooltip>
                          );
                        },
                      },
                    ]}
                    locale={{ emptyText: 'No prepayments applied to this invoice.' }}
                  />
                ),
              }],
              // System Info tab (edit mode only)
              ...(isEditMode ? [{
                key: 'systemInfo',
                label: (
                  <Space size={4}>
                    <InfoCircleOutlined />
                    <span>System Info</span>
                  </Space>
                ),
                children: (() => {
                  const field = (label: string, value?: string | null) => (
                    <Col span={6}>
                      <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: value ? 500 : 400, color: value ? REDWOOD.neutral900 : REDWOOD.neutral400 }}>
                        {value || '—'}
                      </div>
                    </Col>
                  );
                  return (
                    <div style={{ padding: '14px 4px' }}>
                      {/* Audit */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral700, marginBottom: 8 }}>Audit</div>
                      <Row gutter={[24, 14]} style={{ marginBottom: 16 }}>
                        {field('Created By',        initialData?.createdBy)}
                        {field('Creation Date',     initialData?.creationDate)}
                        {field('Last Updated By',   initialData?.lastUpdatedBy)}
                        {field('Last Update Date',  initialData?.lastUpdateDate)}
                      </Row>

                      {/* Sync */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral700, marginBottom: 8 }}>Sync</div>
                      <Row gutter={[24, 14]} style={{ marginBottom: 16 }}>
                        {field('Sync Status',       initialData?.isSynced ? 'SYNCED' : 'MANUAL')}
                        {field('Sync Date',         initialData?.syncDate)}
                        {field('Cancellation Date', initialData?.cancellationDate)}
                        {field('Cancelled By',      initialData?.cancelledBy)}
                      </Row>

                      {/* Document */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral700, marginBottom: 8 }}>Document</div>
                      <Row gutter={[24, 14]} style={{ marginBottom: 16 }}>
                        {field('Document Category', initialData?.documentCategory)}
                        {field('Document Sequence', initialData?.documentSequence != null ? String(initialData.documentSequence) : null)}
                        {field('Voucher Number',    initialData?.voucherNumber)}
                        {field('Delivery Channel',  initialData?.deliveryChannel || initialData?.deliveryChannelCode)}
                      </Row>

                      {/* Tax */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral700, marginBottom: 8 }}>Tax & Registration</div>
                      <Row gutter={[24, 14]}>
                        {field('Taxation Country',  initialData?.taxationCountry)}
                        {field('Tax Reg Number',    initialData?.firstPartyTaxRegistrationNum)}
                        {field('Tax Reg ID',        initialData?.firstPartyTaxRegistrationId)}
                        <Col span={6} />
                      </Row>
                    </div>
                  );
                })(),
              }] : []),
            ]}
          />
          {!isReadOnly && activeTabKey === 'distribution' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={addLine}
                disabled={!isHeaderComplete}
                style={{ background: isHeaderComplete ? REDWOOD.info : undefined, borderColor: isHeaderComplete ? REDWOOD.info : undefined, fontSize: 12 }}
              >
                Add Line
              </Button>
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
                onClick={removeLines}
                disabled={selectedLineKeys.length === 0}
                style={{ fontSize: 12 }}
              >
                Delete {selectedLineKeys.length > 0 ? `(${selectedLineKeys.length})` : ''}
              </Button>
            </div>
          )}
        </Card>

        {/* ========== TAXES & TOTALS ========== */}
        <Row gutter={16}>
          {/* Taxes */}
          <Col span={12}>
            <Card
              style={{
                borderRadius: 8,
                border: `1px solid ${REDWOOD.neutral200}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                height: '100%',
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900 }}>Taxes</Text>
              </div>
              <Descriptions
                column={1}
                size="small"
                labelStyle={{ fontSize: 12, color: REDWOOD.neutral600, width: 180 }}
                contentStyle={{ fontSize: 12 }}
              >
                <Descriptions.Item label="Tax Classification">
                  <Select size="small" style={{ width: 200 }} placeholder="Select" defaultValue="">
                    <Option value="">None</Option>
                    <Option value="standard_vat">Standard VAT (5%)</Option>
                    <Option value="zero_rated">Zero Rated</Option>
                    <Option value="exempt">Exempt</Option>
                    <Option value="reverse_charge">Reverse Charge</Option>
                    <Option value="out_of_scope">Out of Scope</Option>
                  </Select>
                </Descriptions.Item>
                <Descriptions.Item label="Tax Rate">
                  <InputNumber size="small" style={{ width: 100 }} value={taxRate} onChange={(v) => setTaxRate(v || 0)} min={0} max={100} precision={2} addonAfter="%" />
                </Descriptions.Item>
                <Descriptions.Item label="Tax Amount">
                  <Text style={{ fontSize: 13 }}>{formatAmount(taxTotal)}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Withholding Tax Group">
                  <Select size="small" style={{ width: 200 }} placeholder="Select" allowClear>
                    <Option value="standard">Standard</Option>
                    <Option value="none">None</Option>
                  </Select>
                </Descriptions.Item>
                <Descriptions.Item label="Self-Assessed Tax">
                  <Select size="small" style={{ width: 100 }} defaultValue="No">
                    <Option value="Yes">Yes</Option>
                    <Option value="No">No</Option>
                  </Select>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>

          {/* Totals */}
          <Col span={12}>
            <Card
              style={{
                borderRadius: 8,
                border: `1px solid ${REDWOOD.neutral200}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                height: '100%',
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ fontSize: 14, color: REDWOOD.neutral900 }}>Totals</Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Tally mismatch warning */}
                {isTallyMismatch && (
                  <Alert
                    type="warning"
                    showIcon
                    icon={<WarningOutlined />}
                    message={
                      <span style={{ fontSize: 12 }}>
                        Header amount (<strong>{formatAmount(headerInvoiceAmount)}</strong>) does not match
                        Lines + Tax total (<strong>{formatAmount(computedTotal)}</strong>).
                        Difference: <strong style={{ color: REDWOOD.error }}>{formatAmount(Math.abs(headerInvoiceAmount - computedTotal))}</strong>
                      </span>
                    }
                    style={{ marginBottom: 4, borderRadius: 6 }}
                  />
                )}
                <Row justify="space-between" align="middle">
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Header Invoice Amount</Text>
                  <Text style={{ fontSize: 14, fontWeight: 500, color: isTallyMismatch ? REDWOOD.error : undefined }}>
                    {formatAmount(headerInvoiceAmount)}
                  </Text>
                </Row>
                <Divider style={{ margin: '4px 0' }} />
                <Row justify="space-between" align="middle">
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Lines Total</Text>
                  <Text style={{ fontSize: 14, fontWeight: 500 }}>{formatAmount(linesTotal)}</Text>
                </Row>
                <Row justify="space-between" align="middle">
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Tax Total ({taxRate}%)</Text>
                  <Text style={{ fontSize: 14, fontWeight: 500 }}>{formatAmount(taxTotal)}</Text>
                </Row>
                <Divider style={{ margin: '4px 0' }} />
                <Row justify="space-between" align="middle">
                  <Text strong style={{ fontSize: 13 }}>Computed Total (Lines + Tax)</Text>
                  <Text strong style={{ fontSize: 18, color: isTallyMismatch ? REDWOOD.error : REDWOOD.primary }}>
                    {formatAmount(computedTotal)}
                    {isTallyMismatch && <ExclamationCircleOutlined style={{ marginLeft: 6, fontSize: 14 }} />}
                  </Text>
                </Row>
                <Divider style={{ margin: '4px 0' }} />
                <Row justify="space-between" align="middle">
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Amount Applicable to Discount</Text>
                  <Text style={{ fontSize: 13 }}>0.00</Text>
                </Row>
                <Row justify="space-between" align="middle">
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Prepayment Applied</Text>
                  <Text style={{ fontSize: 13 }}>0.00</Text>
                </Row>
                <Row justify="space-between" align="middle">
                  <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Amount Withheld</Text>
                  <Text style={{ fontSize: 13 }}>0.00</Text>
                </Row>
                <Divider style={{ margin: '4px 0' }} />
                <Row
                  justify="space-between"
                  align="middle"
                  style={{
                    padding: '8px 12px',
                    background: isTallyMismatch ? '#fff7e6' : REDWOOD.neutral100,
                    borderRadius: 6,
                    border: `1px solid ${isTallyMismatch ? '#ffd591' : REDWOOD.neutral200}`,
                  }}
                >
                  <Text strong style={{ fontSize: 14 }}>Amount Due</Text>
                  <Text strong style={{ fontSize: 20, color: isTallyMismatch ? REDWOOD.warning : REDWOOD.success }}>
                    {formatAmount(computedTotal)}
                  </Text>
                </Row>
                {isEditMode && invoicePayments.length > 0 && (() => {
                  const activePayments = invoicePayments.filter(p => !p.status?.toLowerCase().includes('void'));
                  const paidTotal = activePayments.reduce((sum, p) => sum + p.paidAmount, 0);
                  const discountTotal = activePayments.reduce((sum, p) => sum + p.discountTaken, 0);
                  const currency = invoicePayments[0]?.currency ?? '';
                  const balance = computedTotal - paidTotal - discountTotal;
                  return (
                    <>
                      <Divider style={{ margin: '4px 0' }} />
                      <Row justify="space-between" align="middle">
                        <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Total Paid (excl. Voided)</Text>
                        <Text style={{ fontSize: 13, color: REDWOOD.success }}>
                          {formatAmount(paidTotal)}{currency ? ` ${currency}` : ''}
                        </Text>
                      </Row>
                      {discountTotal > 0 && (
                        <Row justify="space-between" align="middle">
                          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Discount Taken</Text>
                          <Text style={{ fontSize: 13, color: '#52c41a' }}>
                            {formatAmount(discountTotal)}{currency ? ` ${currency}` : ''}
                          </Text>
                        </Row>
                      )}
                      <Row
                        justify="space-between"
                        align="middle"
                        style={{
                          padding: '8px 12px',
                          background: balance <= 0 ? '#f6ffed' : '#fff7e6',
                          borderRadius: 6,
                          border: `1px solid ${balance <= 0 ? '#b7eb8f' : '#ffd591'}`,
                          marginTop: 4,
                        }}
                      >
                        <Space>
                          <CreditCardOutlined style={{ color: balance <= 0 ? REDWOOD.success : REDWOOD.warning }} />
                          <Text strong style={{ fontSize: 14 }}>Invoice Balance</Text>
                        </Space>
                        <Text strong style={{ fontSize: 20, color: balance <= 0 ? REDWOOD.success : REDWOOD.warning }}>
                          {formatAmount(Math.abs(balance))}{currency ? ` ${currency}` : ''}
                        </Text>
                      </Row>
                    </>
                  );
                })()}
              </div>
            </Card>
          </Col>
        </Row>
      </div>

      {/* ========== API LOG PANEL ========== */}
      {apiLog && (
        <div style={{ padding: '0 24px 16px' }}>
          <Card
            size="small"
            title={
              <Row justify="space-between" align="middle">
                <Space>
                  <ApiOutlined style={{ color: apiLog.status === 'SUCCESS' ? REDWOOD.success : REDWOOD.error }} />
                  <Text strong style={{ fontSize: 13 }}>API Log</Text>
                  <Tag color={apiLog.method === 'PUT' ? 'orange' : 'blue'} style={{ fontSize: 10 }}>{apiLog.method}</Tag>
                  <Tag color={apiLog.status === 'SUCCESS' ? 'green' : 'red'}>{apiLog.httpStatus} {apiLog.status}</Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>{apiLog.timestamp}</Text>
                </Space>
                <Space>
                  {apiLogHistory.length > 1 && (
                    <Button
                      size="small"
                      icon={<FileTextOutlined />}
                      onClick={() => setApiLogHistoryVisible(true)}
                    >
                      History ({apiLogHistory.length})
                    </Button>
                  )}
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      const curlCmd = `curl -X ${apiLog.method} '${apiLog.url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${apiLog.requestBody.replace(/'/g, "'\\''")}'`;
                      navigator.clipboard.writeText(curlCmd);
                      message.success('cURL command copied');
                    }}
                  >
                    Copy cURL
                  </Button>
                  <Button size="small" onClick={() => setApiLog(null)}>
                    <CloseOutlined />
                  </Button>
                </Space>
              </Row>
            }
            style={{ border: `1px solid ${apiLog.status === 'SUCCESS' ? '#b7eb8f' : '#ffa39e'}` }}
          >
            <Row gutter={12}>
              {/* Request */}
              <Col span={12}>
                <Row justify="space-between" align="middle" style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <Tag color={apiLog.method === 'PUT' ? 'orange' : 'blue'} style={{ fontSize: 10 }}>{apiLog.method}</Tag> Request Body
                  </Text>
                  <Button
                    size="small"
                    type="link"
                    icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(apiLog.requestBody); message.success('Request JSON copied'); }}
                    style={{ fontSize: 11, padding: 0 }}
                  >
                    Copy
                  </Button>
                </Row>
                <div style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontFamily: 'monospace', color: REDWOOD.info, wordBreak: 'break-all' }}>{apiLog.url}</Text>
                </div>
                <pre style={{
                  background: '#1e1e1e', color: '#d4d4d4', padding: '8px 10px', borderRadius: 4,
                  fontSize: 10, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto', margin: 0,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {apiLog.requestBody}
                </pre>
              </Col>
              {/* Response */}
              <Col span={12}>
                <Row justify="space-between" align="middle" style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <Tag color={apiLog.status === 'SUCCESS' ? 'green' : 'red'} style={{ fontSize: 10 }}>{apiLog.httpStatus}</Tag> Response
                  </Text>
                  <Button
                    size="small"
                    type="link"
                    icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(apiLog.responseBody); message.success('Response JSON copied'); }}
                    style={{ fontSize: 11, padding: 0 }}
                  >
                    Copy
                  </Button>
                </Row>
                <div style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontFamily: 'monospace', color: apiLog.status === 'SUCCESS' ? REDWOOD.success : REDWOOD.error }}>
                    {apiLog.status === 'SUCCESS'
                      ? (apiLog.method === 'PUT' ? 'Invoice updated successfully' : 'Invoice created successfully')
                      : 'Request failed'}
                  </Text>
                </div>
                <pre style={{
                  background: '#1e1e1e', color: apiLog.status === 'SUCCESS' ? '#4ec9b0' : '#f48771', padding: '8px 10px', borderRadius: 4,
                  fontSize: 10, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto', margin: 0,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {apiLog.responseBody}
                </pre>
              </Col>
            </Row>
          </Card>
        </div>
      )}

      {/* ========== SUPPLIER SEARCH MODAL ========== */}
      <Modal
        title={
          <Space>
            <SearchOutlined style={{ color: REDWOOD.info }} />
            <span>Search Suppliers</span>
            <Tooltip title={APEX_SUPPLIERS_URL}>
              <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 14 }} />
            </Tooltip>
          </Space>
        }
        open={supplierModalVisible}
        onCancel={() => setSupplierModalVisible(false)}
        footer={null}
        width={900}
        styles={{ body: { padding: '12px 24px' } }}
      >
        {/* API URL bar */}
        <div style={{
          background: '#1a1a2e', borderRadius: 6, padding: '6px 12px',
          marginBottom: 12, fontSize: 11, fontFamily: 'monospace',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <div>
            <span style={{ color: '#1D7B4D', fontWeight: 700, marginRight: 8 }}>GET</span>
            <span style={{ color: '#e0e0e0' }}>
              {form.getFieldValue('businessUnit')
                ? `${APEX_SUPPLIERS_URL}&P_BUSINESS_UNIT=${form.getFieldValue('businessUnit')}`
                : APEX_SUPPLIERS_URL}
            </span>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="Search by supplier name, number, or alternate name..."
            prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
            value={supplierSearchText}
            onChange={(e) => setSupplierSearchText(e.target.value)}
            allowClear
            size="middle"
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filteredSuppliers.length} supplier{filteredSuppliers.length !== 1 ? 's' : ''} found
            </Text>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchSuppliers}
              loading={supplierLoading}
            >
              Refresh
            </Button>
          </div>
        </div>
        <Table
          columns={supplierColumns}
          dataSource={filteredSuppliers}
          loading={supplierLoading}
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}` }}
          scroll={{ y: 400 }}
          onRow={(record) => ({
            onDoubleClick: () => handleSupplierSelect(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Modal>

      {/* ========== API LOG HISTORY MODAL ========== */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>API Log History ({apiLogHistory.length} calls)</span>
          </Space>
        }
        open={apiLogHistoryVisible}
        onCancel={() => setApiLogHistoryVisible(false)}
        footer={
          <Space>
            <Button
              danger
              onClick={() => { setApiLogHistory([]); setApiLogHistoryVisible(false); message.success('History cleared'); }}
              disabled={apiLogHistory.length === 0}
            >
              Clear History
            </Button>
            <Button type="primary" onClick={() => setApiLogHistoryVisible(false)}>Close</Button>
          </Space>
        }
        width={850}
      >
        <Table
          dataSource={apiLogHistory.map((entry, i) => ({ ...entry, key: i }))}
          pagination={false}
          size="small"
          scroll={{ y: 400 }}
          columns={[
            {
              title: '#',
              key: 'idx',
              width: 35,
              align: 'center',
              render: (_: any, __: any, idx: number) => <Text style={{ fontSize: 11 }}>{idx + 1}</Text>,
            },
            {
              title: 'Action',
              dataIndex: 'action',
              key: 'action',
              width: 130,
              render: (v: string) => <Text strong style={{ fontSize: 11 }}>{v}</Text>,
            },
            {
              title: 'Method',
              dataIndex: 'method',
              key: 'method',
              width: 60,
              render: (v: string) => <Tag color={v === 'PUT' ? 'orange' : v === 'DELETE' ? 'red' : 'blue'} style={{ fontSize: 10 }}>{v}</Tag>,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              width: 100,
              render: (v: string, record: any) => (
                <Tag color={v === 'SUCCESS' ? 'green' : 'red'} style={{ fontSize: 10 }}>{record.httpStatus} {v}</Tag>
              ),
            },
            {
              title: 'URL',
              dataIndex: 'url',
              key: 'url',
              ellipsis: true,
              render: (v: string) => <Text style={{ fontSize: 10, fontFamily: 'monospace' }}>{v.replace(APEX_DB_CONFIG.baseUrl, '...')}</Text>,
            },
            {
              title: 'Time',
              dataIndex: 'timestamp',
              key: 'timestamp',
              width: 140,
              render: (v: string) => <Text type="secondary" style={{ fontSize: 10 }}>{v}</Text>,
            },
            {
              title: '',
              key: 'actions',
              width: 60,
              render: (_: any, record: any) => (
                <Button
                  size="small"
                  type="link"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    const curlCmd = `curl -X ${record.method} '${record.url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${record.requestBody.replace(/'/g, "'\\''")}'`;
                    navigator.clipboard.writeText(curlCmd);
                    message.success('cURL copied');
                  }}
                  style={{ fontSize: 10 }}
                >
                  cURL
                </Button>
              ),
            },
          ]}
          expandable={{
            expandedRowRender: (record: any) => (
              <Row gutter={12}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Request</Text>
                  <pre style={{
                    background: '#1e1e1e', color: '#d4d4d4', padding: '6px 8px', borderRadius: 4,
                    fontSize: 9, fontFamily: 'monospace', maxHeight: 150, overflow: 'auto', margin: '4px 0 0',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {record.requestBody}
                  </pre>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Response</Text>
                  <pre style={{
                    background: '#1e1e1e', color: record.status === 'SUCCESS' ? '#4ec9b0' : '#f48771',
                    padding: '6px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'monospace',
                    maxHeight: 150, overflow: 'auto', margin: '4px 0 0',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {record.responseBody}
                  </pre>
                </Col>
              </Row>
            ),
          }}
        />
      </Modal>

      {/* ========== ACCOUNT SELECTOR MODAL (Distribution Combination) ========== */}
      <AccountSelector
        visible={accountSelectorVisible}
        onCancel={() => {
          setAccountSelectorVisible(false);
          setEditingLineKey(null);
          setAccountSelectorInitialValue(undefined);
        }}
        onSelect={(accountCode, segments) => {
          handleAccountSelect(accountCode, segments);
          setAccountSelectorInitialValue(undefined);
        }}
        initialValue={
          accountSelectorInitialValue
          ?? (editingLineKey === '__liability__'
            ? form.getFieldValue('liabilityDistribution')
            : editingLineKey
            ? lines.find((l) => l.key === editingLineKey)?.distributionCombination
            : undefined)
        }
        lockedFirstSegment={derivedCompany || undefined}
      />

      {/* ========== DISTRIBUTION SET LOV ========== */}
      <Modal
        title={
          <Space>
            <SearchOutlined style={{ color: REDWOOD.info }} />
            Select Distribution Set
            <Tooltip
              title={
                <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  <div style={{ marginBottom: 4, color: '#aaa' }}>GET</div>
                  {`${APEX_DB_CONFIG.baseUrl}/distributions/combinations`}
                  <div style={{ marginTop: 6, color: '#aaa' }}>No filters applied — all combinations returned</div>
                </div>
              }
              overlayStyle={{ maxWidth: 520 }}
            >
              <ApiOutlined style={{ color: REDWOOD.neutral300, fontSize: 13, cursor: 'help' }} />
            </Tooltip>
          </Space>
        }
        open={distLovOpen}
        onCancel={() => setDistLovOpen(false)}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Input
          placeholder="Search by name or account…"
          prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
          value={distLovSearch}
          onChange={e => setDistLovSearch(e.target.value)}
          allowClear
          autoFocus
          style={{ marginBottom: 12 }}
        />
        {distCombinations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: REDWOOD.neutral300, fontSize: 13 }}>
            No distribution combinations found.<br />
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral300 }}>
              {`${APEX_DB_CONFIG.baseUrl}/distributions/combinations`}
            </span>
          </div>
        ) : (
          <Table
            size="small"
            dataSource={distCombinations.filter(d => {
              const q = distLovSearch.toLowerCase();
              return !q
                || d.combinationName.toLowerCase().includes(q)
                || (d.glAccountDesc || '').toLowerCase().includes(q)
                || (d.description || '').toLowerCase().includes(q);
            })}
            rowKey="combinationId"
            pagination={{ pageSize: 10, size: 'small', showTotal: t => `${t} combinations` }}
            onRow={d => ({
              style: { cursor: 'pointer' },
              onClick: () => {
                if (distLovLineKey) {
                  updateLine(distLovLineKey, 'distributionSet', d.combinationName);
                  if (d.glAccountDesc) updateLine(distLovLineKey, 'distributionCombination', applyCompanySegment(d.glAccountDesc));
                }
                setDistLovOpen(false);
              },
            })}
            columns={[
              {
                title: 'Distribution Set',
                dataIndex: 'combinationName',
                render: (v: string, d: DistCombination) => (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
                    {d.description && <div style={{ fontSize: 11, color: REDWOOD.neutral300 }}>{d.description}</div>}
                  </div>
                ),
              },
              {
                title: 'GL Account',
                dataIndex: 'glAccountDesc',
                width: 200,
                render: (v: string) => <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</span>,
              },
              {
                title: 'BU',
                dataIndex: 'businessUnit',
                width: 100,
                render: (v: string) => <span style={{ fontSize: 11 }}>{v || '—'}</span>,
              },
            ]}
          />
        )}
      </Modal>

      {/* ========== VALIDATION CHECKLIST MODAL ========== */}
      <Modal
        title={
          <Space>
            <CheckSquareOutlined style={{ color: isValidated ? REDWOOD.success : REDWOOD.primary }} />
            <span>Invoice Validation</span>
          </Space>
        }
        open={validationModalVisible}
        onCancel={() => setValidationModalVisible(false)}
        footer={
          <Button type="primary" onClick={() => setValidationModalVisible(false)}>
            Close
          </Button>
        }
        width={520}
      >
        <div style={{ padding: '8px 0' }}>
          {validationResults.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                padding: '8px 12px',
                marginBottom: 4,
                borderRadius: 6,
                background: item.passed ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${item.passed ? '#b7eb8f' : '#ffccc7'}`,
              }}
            >
              <span style={{ fontSize: 16, marginRight: 10, marginTop: 1 }}>
                {item.passed
                  ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                  : <ExclamationCircleOutlined style={{ color: REDWOOD.primary }} />}
              </span>
              <div style={{ flex: 1 }}>
                <Text strong style={{ fontSize: 13 }}>{item.label}</Text>
                {item.detail && (
                  <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 2 }}>{item.detail}</div>
                )}
                {item.action && (
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0, fontSize: 12, marginTop: 2, color: REDWOOD.info }}
                    onClick={item.action.onClick}
                  >
                    {item.action.label}
                  </Button>
                )}
                {/* Sub-items: list each line missing distribution with individual fix actions */}
                {item.subItems && item.subItems.length > 0 && (
                  <div style={{ marginTop: 6, borderTop: '1px dashed #ffccc7', paddingTop: 6 }}>
                    {item.subItems.map((sub, sIdx) => (
                      <div
                        key={sIdx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                          borderBottom: sIdx < item.subItems!.length - 1 ? '1px solid #fff0ee' : 'none',
                        }}
                      >
                        <div>
                          <Text style={{ fontSize: 12, fontWeight: 600 }}>{sub.label}</Text>
                          {sub.detail && (
                            <Text style={{ fontSize: 11, color: REDWOOD.neutral600, marginLeft: 8 }}>{sub.detail}</Text>
                          )}
                        </div>
                        {sub.action && (
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            style={{ fontSize: 11, height: 24, borderRadius: 4 }}
                            onClick={sub.action.onClick}
                          >
                            {sub.action.label}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Tag color={item.passed ? 'success' : 'error'} style={{ marginLeft: 8 }}>
                {item.passed ? 'PASS' : 'FAIL'}
              </Tag>
            </div>
          ))}
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            {isValidated ? (
              <Tag color="success" style={{ fontSize: 13, padding: '4px 16px' }}>All validations passed</Tag>
            ) : (
              <Tag color="error" style={{ fontSize: 13, padding: '4px 16px' }}>Fix issues above before saving</Tag>
            )}
          </div>
        </div>
      </Modal>

      {/* ========== IMPORT LINES MODAL ========== */}
      <Modal
        title={
          <Space>
            <FileExcelOutlined style={{ color: '#217346' }} />
            <span>Import Invoice Lines</span>
          </Space>
        }
        open={importModalVisible}
        onCancel={() => { setImportModalVisible(false); setImportPreviewData([]); setPasteText(''); }}
        width={720}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => { setImportModalVisible(false); setImportPreviewData([]); setPasteText(''); }}>
              Cancel
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={importPreviewData.length === 0}
              onClick={handleConfirmImport}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
            >
              Import {importPreviewData.length > 0 ? `(${importPreviewData.length} lines)` : ''}
            </Button>
          </div>
        }
      >
        {/* Step 1: Template download */}
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text strong style={{ fontSize: 13 }}>Step 1: Download Template</Text>
              <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 2 }}>
                Excel file with columns: <Text code>Type</Text>, <Text code>Amount</Text>, <Text code>Description</Text>
              </div>
            </div>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownloadTemplate}
              style={{ borderColor: '#217346', color: '#217346' }}
            >
              Download Template
            </Button>
          </div>
        </div>

        {/* Step 2: Upload or Paste */}
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ fontSize: 13 }}>Step 2: Upload File or Paste Data</Text>
          <Tabs
            size="small"
            style={{ marginTop: 4 }}
            items={[
              {
                key: 'upload',
                label: (
                  <Space size={4}>
                    <UploadOutlined />
                    <span>Upload File</span>
                  </Space>
                ),
                children: (
                  <Upload.Dragger
                    accept=".xlsx,.xls,.csv"
                    beforeUpload={handleFileUpload}
                    showUploadList={false}
                    style={{ padding: '16px 0' }}
                  >
                    <p style={{ marginBottom: 8 }}>
                      <InboxOutlined style={{ fontSize: 32, color: REDWOOD.info }} />
                    </p>
                    <p style={{ fontSize: 13, color: REDWOOD.neutral900 }}>
                      Click or drag an Excel/CSV file here
                    </p>
                    <p style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                      Supports .xlsx, .xls, .csv
                    </p>
                  </Upload.Dragger>
                ),
              },
              {
                key: 'paste',
                label: (
                  <Space size={4}>
                    <CopyOutlined />
                    <span>Paste Data</span>
                  </Space>
                ),
                children: (
                  <div>
                    <Input.TextArea
                      rows={5}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={`Paste tab or comma separated data:\nItem, 1000, Office Supplies\nItem, 2500, IT Equipment\nFreight, 150, Shipping\n\nOr just amount and description:\n1000, Office Supplies\n2500, IT Equipment`}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <Button
                      size="small"
                      type="primary"
                      onClick={handlePasteImport}
                      style={{ marginTop: 8, background: REDWOOD.info, borderColor: REDWOOD.info }}
                      disabled={!pasteText.trim()}
                    >
                      Parse Pasted Data
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>

        {/* Step 3: Preview */}
        {importPreviewData.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13 }}>Step 3: Preview ({importPreviewData.length} lines)</Text>
              <Button size="small" type="link" danger onClick={() => setImportPreviewData([])}>
                Clear
              </Button>
            </div>
            <Table
              dataSource={importPreviewData.map((r, i) => ({ ...r, key: i, lineNumber: i + 1 }))}
              pagination={false}
              size="small"
              bordered
              scroll={{ y: 200 }}
              columns={[
                {
                  title: '#',
                  dataIndex: 'lineNumber',
                  key: 'lineNumber',
                  width: 40,
                  align: 'center',
                  render: (v: number) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                },
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  width: 100,
                  render: (v: string) => <Tag color={v === 'Item' ? 'blue' : v === 'Freight' ? 'orange' : 'default'}>{v}</Tag>,
                },
                {
                  title: 'Amount',
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 120,
                  align: 'right',
                  render: (v: number) => <Text strong style={{ fontSize: 12 }}>{formatAmount(v)}</Text>,
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                },
              ]}
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}>
                      <Text strong style={{ fontSize: 12 }}>Total</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>
                        {formatAmount(importPreviewData.reduce((s, r) => s + r.amount, 0))}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} />
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </div>
        )}
      </Modal>

      {/* ========== VIEW ACCOUNTING MODAL ========== */}
      <Modal
        title={
          <Space>
            <AccountBookOutlined style={{ color: REDWOOD.info }} />
            <span>Accounting Entries</span>
          </Space>
        }
        open={accountingModalVisible}
        onCancel={() => setAccountingModalVisible(false)}
        footer={<Button type="primary" onClick={() => setAccountingModalVisible(false)}>Close</Button>}
        width={960}
      >
        {(() => {
          const liabilityDist = form.getFieldValue('liabilityDistribution') || '—';
          const invoiceDate = form.getFieldValue('invoiceDate');
          const defaultAcctDate = invoiceDate?.format?.('DD-MMM-YYYY') || 'N/A';
          const invoiceCurrency = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
          const convRate = headerValues.conversionRate || form.getFieldValue('conversionRate') || 0;
          const isForeignCurrency = invoiceCurrency !== 'AED';
          if (isForeignCurrency && !convRate) {
            return (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Text type="danger" style={{ fontSize: 14 }}>
                  Conversion rate is required for foreign currency invoices ({invoiceCurrency}) before checking accounting.
                </Text>
                <div style={{ marginTop: 8, color: REDWOOD.neutral600, fontSize: 12 }}>
                  Please enter the Conversion Rate in the Accounting tab and save the invoice.
                </div>
              </div>
            );
          }
          const effectiveRate = convRate || 1;
          // Build account description lookup from loaded dist combinations
          const acctDescMap: Record<string, string> = {};
          distCombinations.forEach(d => {
            if (d.combinationName) acctDescMap[d.combinationName] = d.glAccountDesc || d.description || '';
          });
          const getAcctDesc = (code: string, lineDesc?: string) =>
            lineDesc || resolvedAcctDescs[code] || acctDescMap[code] || '';
          type AcctEntry = { key: number; period: string; line: string; account: string; accountDescription?: string; description: string; lineClass: string; debit: number; credit: number; accountedDebit: number; accountedCredit: number; isGroupHeader?: boolean; isPeriodSubtotal?: boolean; subtotalDebit?: number; subtotalCredit?: number; subtotalAccountedDebit?: number; subtotalAccountedCredit?: number };

          // ── Shared table renderer ────────────────────────────────────────────
          const renderAcctTable = (allEntries: AcctEntry[], periodMap: Map<string, any[]>, grandTotalDebit: number, grandTotalCredit: number, sortedPeriods: string[], grandTotalAccountedDebit?: number, grandTotalAccountedCredit?: number) => (
            <>
              <Table
                dataSource={allEntries}
                pagination={false}
                size="small"
                bordered
                rowClassName={(record) => record.isGroupHeader ? 'acct-period-header' : record.isPeriodSubtotal ? 'acct-period-subtotal' : ''}
                columns={[
                  {
                    title: 'Accounting Date',
                    dataIndex: 'period',
                    key: 'period',
                    width: 130,
                    onCell: (record: AcctEntry) => ({
                      colSpan: record.isGroupHeader ? 6 : record.isPeriodSubtotal ? 5 : 1,
                      style: record.isGroupHeader
                        ? { background: '#e6f4ff', fontWeight: 700, fontSize: 12 }
                        : record.isPeriodSubtotal
                        ? { background: '#f0f5ff', borderTop: '1px solid #d6e4ff' }
                        : undefined,
                    }),
                    render: (v: string, record: AcctEntry) => {
                      if (record.isGroupHeader) {
                        const pl = periodMap.get(v) || [];
                        const periodTotal = pl.reduce((s: number, l: any) => s + (l.amount || 0), 0);
                        const periodTax = pl.reduce((s: number, l: any) => s + Math.round((l.amount || 0) * ((taxRateMapRef.current[l.taxClassification] ?? getTaxRateForClassification(l.taxClassification)) / 100) * 100) / 100, 0);
                        return (
                          <span>
                            Period: <strong>{v}</strong>
                            {periodTax > 0 && (
                              <span style={{ marginLeft: 16, color: REDWOOD.neutral600, fontWeight: 400 }}>
                                Lines: {formatAmount(periodTotal)} | Tax: {formatAmount(periodTax)} | Total: {formatAmount(periodTotal + periodTax)}
                              </span>
                            )}
                          </span>
                        );
                      }
                      if (record.isPeriodSubtotal) return <Text strong style={{ fontSize: 12 }}>Period Subtotal — {v}</Text>;
                      return <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v}</Text>;
                    },
                  },
                  {
                    title: 'Line',
                    dataIndex: 'line',
                    key: 'line',
                    width: 70,
                    onCell: (record: AcctEntry) => ({ colSpan: record.isGroupHeader || record.isPeriodSubtotal ? 0 : 1 }),
                    render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                  },
                  {
                    title: 'Account',
                    dataIndex: 'account',
                    key: 'account',
                    width: 230,
                    onCell: (record: AcctEntry) => ({ colSpan: record.isGroupHeader || record.isPeriodSubtotal ? 0 : 1 }),
                    render: (v: string, record: AcctEntry) => (
                      <div>
                        <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</Text>
                        {record.accountDescription && (
                          <div style={{ fontSize: 10, color: REDWOOD.neutral600, marginTop: 1 }}>{record.accountDescription}</div>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: 'Description',
                    dataIndex: 'description',
                    key: 'description',
                    width: 220,
                    onCell: (record: AcctEntry) => ({ colSpan: record.isGroupHeader || record.isPeriodSubtotal ? 0 : 1 }),
                    render: (v: string) => (
                      <Tooltip title={v} placement="topLeft">
                        <Text style={{ fontSize: 12, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v}</Text>
                      </Tooltip>
                    ),
                  },
                  {
                    title: 'Class',
                    dataIndex: 'lineClass',
                    key: 'lineClass',
                    width: 130,
                    onCell: (record: AcctEntry) => ({ colSpan: record.isGroupHeader || record.isPeriodSubtotal ? 0 : 1 }),
                    render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                  },
                  {
                    title: `Entered Dr (${invoiceCurrency})`,
                    dataIndex: 'debit',
                    key: 'debit',
                    width: 120,
                    align: 'right' as const,
                    onCell: (record: AcctEntry) => ({
                      colSpan: record.isGroupHeader ? 0 : 1,
                      style: record.isPeriodSubtotal ? { background: '#f0f5ff', borderTop: '1px solid #d6e4ff' } : undefined,
                    }),
                    render: (v: number, record: AcctEntry) => {
                      if (record.isPeriodSubtotal) return <Text strong style={{ fontSize: 12, color: '#389e0d' }}>{formatAmount(record.subtotalDebit || 0)}</Text>;
                      return v > 0 ? <Text style={{ fontSize: 12, fontWeight: 600, color: '#389e0d' }}>{formatAmount(v)}</Text> : null;
                    },
                  },
                  {
                    title: `Entered Cr (${invoiceCurrency})`,
                    dataIndex: 'credit',
                    key: 'credit',
                    width: 120,
                    align: 'right' as const,
                    onCell: (record: AcctEntry) => ({
                      colSpan: record.isGroupHeader ? 0 : 1,
                      style: record.isPeriodSubtotal ? { background: '#f0f5ff', borderTop: '1px solid #d6e4ff' } : undefined,
                    }),
                    render: (v: number, record: AcctEntry) => {
                      if (record.isPeriodSubtotal) return <Text strong style={{ fontSize: 12, color: REDWOOD.primary }}>{formatAmount(record.subtotalCredit || 0)}</Text>;
                      return v > 0 ? <Text style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.primary }}>{formatAmount(v)}</Text> : null;
                    },
                  },
                  {
                    title: 'Accounted Dr (AED)',
                    dataIndex: 'accountedDebit',
                    key: 'accountedDebit',
                    width: 120,
                    align: 'right' as const,
                    onCell: (record: AcctEntry) => ({
                      colSpan: record.isGroupHeader ? 0 : 1,
                      style: record.isPeriodSubtotal ? { background: '#f0f5ff', borderTop: '1px solid #d6e4ff' } : undefined,
                    }),
                    render: (v: number, record: AcctEntry) => {
                      if (record.isPeriodSubtotal) return <Text strong style={{ fontSize: 12, color: '#389e0d' }}>{formatAmount(record.subtotalAccountedDebit || 0)}</Text>;
                      return v > 0 ? <Text style={{ fontSize: 12, fontWeight: 600, color: '#389e0d' }}>{formatAmount(v)}</Text> : null;
                    },
                  },
                  {
                    title: 'Accounted Cr (AED)',
                    dataIndex: 'accountedCredit',
                    key: 'accountedCredit',
                    width: 120,
                    align: 'right' as const,
                    onCell: (record: AcctEntry) => ({
                      colSpan: record.isGroupHeader ? 0 : 1,
                      style: record.isPeriodSubtotal ? { background: '#f0f5ff', borderTop: '1px solid #d6e4ff' } : undefined,
                    }),
                    render: (v: number, record: AcctEntry) => {
                      if (record.isPeriodSubtotal) return <Text strong style={{ fontSize: 12, color: REDWOOD.primary }}>{formatAmount(record.subtotalAccountedCredit || 0)}</Text>;
                      return v > 0 ? <Text style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.primary }}>{formatAmount(v)}</Text> : null;
                    },
                  },
                ]}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}><Text strong style={{ fontSize: 13 }}>Grand Total</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right"><Text strong style={{ fontSize: 13, color: '#389e0d' }}>{formatAmount(grandTotalDebit)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="right"><Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>{formatAmount(grandTotalCredit)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={7} align="right"><Text strong style={{ fontSize: 13, color: '#389e0d' }}>{formatAmount(grandTotalAccountedDebit ?? grandTotalDebit)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={8} align="right"><Text strong style={{ fontSize: 13, color: REDWOOD.primary }}>{formatAmount(grandTotalAccountedCredit ?? grandTotalCredit)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={9}>
                        {Math.abs(grandTotalDebit - grandTotalCredit) > 0.01
                          ? <Text type="danger" style={{ fontSize: 12 }}>Out of balance by {formatAmount(Math.abs(grandTotalDebit - grandTotalCredit))}</Text>
                          : <Text style={{ fontSize: 12, color: '#389e0d' }}>Balanced — Debit equals Credit</Text>
                        }
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
              {sortedPeriods.length > 1 && (
                <div style={{ marginTop: 8, fontSize: 11, color: REDWOOD.neutral600 }}>
                  {sortedPeriods.length} accounting periods
                </div>
              )}
            </>
          );

          // ── Tab 1: Invoice Accounting ────────────────────────────────────────
          const buildInvoiceAccounting = () => {
            const allEntries: AcctEntry[] = [];
            let keyIdx = 0;
            const activeLines = lines.filter((l) => l.amount > 0 || l.description);
            const periodMap = new Map<string, typeof activeLines>();
            activeLines.forEach((l) => {
              const period = l.accountingDate || defaultAcctDate;
              if (!periodMap.has(period)) periodMap.set(period, []);
              periodMap.get(period)!.push(l);
            });
            const sortedPeriods = Array.from(periodMap.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
            let grandTotalDebit = 0;
            let grandTotalCredit = 0;
            let grandTotalAccountedDebit = 0;
            let grandTotalAccountedCredit = 0;

            sortedPeriods.forEach((period) => {
              const periodLines = periodMap.get(period)!;
              let periodDebit = 0;
              let periodCredit = 0;
              let periodAccountedDebit = 0;
              let periodAccountedCredit = 0;
              allEntries.push({ key: keyIdx++, period, line: '', account: '', description: '', lineClass: '', debit: 0, credit: 0, accountedDebit: 0, accountedCredit: 0, isGroupHeader: true });

              periodLines.forEach((l) => {
                const amt = l.amount || 0;
                const acctAmt = Math.round(amt * effectiveRate * 100) / 100;
                // MPA: use accrual account for DR when line has one set
                const isMpa = !!l.accrualAccount;
                const debitAccount = isMpa ? l.accrualAccount : (l.distributionCombination || l.distributionSet || '—');
                const debitDesc = l.description || l.type || 'Item';
                const itemClass = isMpa ? 'ACCRUAL' : 'Item expense';
                allEntries.push({ key: keyIdx++, period, line: `Line ${l.lineNumber}`, account: debitAccount, accountDescription: getAcctDesc(debitAccount, l.accountDescription), description: debitDesc, lineClass: itemClass, debit: amt, credit: 0, accountedDebit: acctAmt, accountedCredit: 0 });
                periodDebit += amt;
                periodAccountedDebit += acctAmt;
              });

              const periodLineTax = periodLines.reduce((sum, l) => sum + Math.round((l.amount || 0) * ((taxRateMapRef.current[l.taxClassification] ?? getTaxRateForClassification(l.taxClassification)) / 100) * 100) / 100, 0);
              if (periodLineTax > 0) {
                const acctTax = Math.round(periodLineTax * effectiveRate * 100) / 100;
                const firstTaxedLine = periodLines.find(l => l.taxClassification);
                const taxAcct = firstTaxedLine?.taxAccountCombination
                  || (firstTaxedLine ? taxAccountMapRef.current[firstTaxedLine.taxClassification] : '')
                  || 'Tax Recoverable';
                allEntries.push({ key: keyIdx++, period, line: 'Tax', account: taxAcct, accountDescription: getAcctDesc(taxAcct), description: 'Input VAT', lineClass: 'Tax Recoverable', debit: periodLineTax, credit: 0, accountedDebit: acctTax, accountedCredit: 0 });
                periodDebit += periodLineTax;
                periodAccountedDebit += acctTax;
              }

              periodLines.forEach((l) => {
                const amt = l.amount || 0;
                const acctAmt = Math.round(amt * effectiveRate * 100) / 100;
                allEntries.push({ key: keyIdx++, period, line: `Line ${l.lineNumber}`, account: liabilityDist, accountDescription: getAcctDesc(liabilityDist), description: `AP — ${l.description || l.type || 'Item'}`, lineClass: 'Liability', debit: 0, credit: amt, accountedDebit: 0, accountedCredit: acctAmt });
                periodCredit += amt;
                periodAccountedCredit += acctAmt;
              });

              if (periodLineTax > 0) {
                const acctTax = Math.round(periodLineTax * effectiveRate * 100) / 100;
                allEntries.push({ key: keyIdx++, period, line: 'Tax', account: liabilityDist, accountDescription: getAcctDesc(liabilityDist), description: 'AP — Input VAT', lineClass: 'Liability', debit: 0, credit: periodLineTax, accountedDebit: 0, accountedCredit: acctTax });
                periodCredit += periodLineTax;
                periodAccountedCredit += acctTax;
              }

              allEntries.push({ key: keyIdx++, period, line: '', account: '', description: '', lineClass: '', debit: 0, credit: 0, accountedDebit: 0, accountedCredit: 0, isPeriodSubtotal: true, subtotalDebit: periodDebit, subtotalCredit: periodCredit, subtotalAccountedDebit: periodAccountedDebit, subtotalAccountedCredit: periodAccountedCredit });
              grandTotalDebit += periodDebit;
              grandTotalCredit += periodCredit;
              grandTotalAccountedDebit += periodAccountedDebit;
              grandTotalAccountedCredit += periodAccountedCredit;
            });

            if (allEntries.length === 0) return <Text type="secondary">No invoice lines with amounts.</Text>;
            return renderAcctTable(allEntries, periodMap as Map<string, any[]>, grandTotalDebit, grandTotalCredit, sortedPeriods, grandTotalAccountedDebit, grandTotalAccountedCredit);
          };

          // ── Tab 2: Multiperiod (Accrual) Accounting ──────────────────────────
          const buildMultiperiodAccounting = () => {
            // Only lines that have startDate + endDate + accrualAccount filled
            const mpaLines = lines.filter((l) => l.startDate && l.endDate && l.accrualAccount && l.amount !== 0 && dayjs(l.startDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM') !== dayjs(l.endDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM'));
            if (mpaLines.length === 0) {
              return (
                <div style={{ textAlign: 'center', padding: '32px 0', color: REDWOOD.neutral600 }}>
                  <CalendarOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
                  <div>No multiperiod accounting lines.</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Enter Start Date, End Date and Accrual Account on an invoice line to generate accrual entries.</div>
                </div>
              );
            }

            const allEntries: AcctEntry[] = [];
            let keyIdx = 0;
            // Collect all periods across all MPA lines for the period map (used by header renderer — pass empty for MPA)
            const periodMap = new Map<string, any[]>();
            let grandTotalDebit = 0;
            let grandTotalCredit = 0;
            const allPeriods = new Set<string>();

            mpaLines.forEach((line) => {
              const start = dayjs(line.startDate, 'DD-MMM-YYYY');
              const end   = dayjs(line.endDate,   'DD-MMM-YYYY');
              if (!start.isValid() || !end.isValid() || end.isBefore(start)) return;

              const totalDays  = end.diff(start, 'day') + 1;
              const totalAmt   = line.amount;
              const expAccount = line.distributionCombination || line.distributionSet || '—';
              const accrualAcc = line.accrualAccount;
              const lineDesc   = line.description || `Line ${line.lineNumber}`;

              // Build per-month slices
              type Slice = { period: string; days: number; amount: number };
              const slices: Slice[] = [];
              let cursor = start.startOf('month');
              let remaining = totalAmt;

              while (!cursor.isAfter(end, 'month')) {
                const sliceStart = cursor.isBefore(start) ? start : cursor;
                const sliceEnd   = cursor.endOf('month').isAfter(end) ? end : cursor.endOf('month');
                const days       = sliceEnd.diff(sliceStart, 'day') + 1;
                const isLast     = cursor.add(1, 'month').startOf('month').isAfter(end);
                const amount     = isLast ? Math.round(remaining * 100) / 100 : Math.round(totalAmt * days / totalDays * 100) / 100;
                remaining        = Math.round((remaining - amount) * 100) / 100;
                slices.push({ period: cursor.format('MMM-YYYY'), days, amount });
                cursor = cursor.add(1, 'month').startOf('month');
              }

              // Line header spanning all periods for this invoice line
              allEntries.push({
                key: keyIdx++,
                period: `Line ${line.lineNumber} — ${lineDesc} | ${line.startDate} → ${line.endDate} | ${totalDays} days | ${formatAmount(totalAmt)}`,
                line: '', account: '', description: '', lineClass: '', debit: 0, credit: 0,
                accountedDebit: 0, accountedCredit: 0,
                isGroupHeader: true,
              });

              let lineTotalDebit = 0;
              let lineTotalCredit = 0;

              // ── Entry 1: Initial deferral in invoice period (full amount) ──
              // DR Accrual/Prepaid / CR Expense — reverses the expense posted in invoice accounting
              const invoicePeriod = slices[0]?.period || '';
              allPeriods.add(invoicePeriod);
              allEntries.push({
                key: keyIdx++, period: invoicePeriod,
                line: `Line ${line.lineNumber}`,
                account: accrualAcc, accountDescription: getAcctDesc(accrualAcc, line.accountDescription),
                description: `Dr Accrual — Defer expense ${lineDesc}`,
                lineClass: 'Prepaid / Accrual',
                debit: totalAmt, credit: 0,
                accountedDebit: totalAmt, accountedCredit: 0,
              });
              allEntries.push({
                key: keyIdx++, period: invoicePeriod,
                line: `Line ${line.lineNumber}`,
                account: expAccount, accountDescription: getAcctDesc(expAccount, line.accountDescription),
                description: `Cr Expense — Defer expense ${lineDesc}`,
                lineClass: 'Item expense',
                debit: 0, credit: totalAmt,
                accountedDebit: 0, accountedCredit: totalAmt,
              });

              // ── Entry 2: Monthly recognition — DR Expense / CR Accrual ──
              slices.forEach(({ period, days, amount }) => {
                allPeriods.add(period);
                allEntries.push({
                  key: keyIdx++, period,
                  line: `Line ${line.lineNumber}`,
                  account: expAccount, accountDescription: getAcctDesc(expAccount, line.accountDescription),
                  description: `Dr Expense — ${lineDesc} (${days}d)`,
                  lineClass: 'Item expense',
                  debit: amount, credit: 0,
                  accountedDebit: amount, accountedCredit: 0,
                });
                allEntries.push({
                  key: keyIdx++, period,
                  line: `Line ${line.lineNumber}`,
                  account: accrualAcc, accountDescription: getAcctDesc(accrualAcc, line.accountDescription),
                  description: `Cr Accrual — ${lineDesc} (${days}d)`,
                  lineClass: 'Prepaid / Accrual',
                  debit: 0, credit: amount,
                  accountedDebit: 0, accountedCredit: amount,
                });
                lineTotalDebit  += amount;
                lineTotalCredit += amount;
              });

              // Line subtotal
              allEntries.push({
                key: keyIdx++, period: `Line ${line.lineNumber}`,
                line: '', account: '', description: '', lineClass: '',
                debit: 0, credit: 0,
                accountedDebit: 0, accountedCredit: 0,
                isPeriodSubtotal: true,
                subtotalDebit: lineTotalDebit, subtotalCredit: lineTotalCredit,
              });

              grandTotalDebit  += lineTotalDebit;
              grandTotalCredit += lineTotalCredit;
            });

            return renderAcctTable(allEntries, periodMap, grandTotalDebit, grandTotalCredit, Array.from(allPeriods));
          };

          const mpaCount = lines.filter((l) => l.startDate && l.endDate && l.accrualAccount && l.amount !== 0 && dayjs(l.startDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM') !== dayjs(l.endDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM')).length;

          return (
            <Tabs
              defaultActiveKey="invoice"
              size="small"
              items={[
                {
                  key: 'invoice',
                  label: (
                    <span><AccountBookOutlined style={{ marginRight: 4 }} />Invoice Accounting</span>
                  ),
                  children: buildInvoiceAccounting(),
                },
                {
                  key: 'multiperiod',
                  label: (
                    <span>
                      <CalendarOutlined style={{ marginRight: 4 }} />
                      Multiperiod Accounting
                      {mpaCount > 0
                        ? <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>{mpaCount} line{mpaCount > 1 ? 's' : ''}</Tag>
                        : <Tag style={{ marginLeft: 6, fontSize: 10 }}>None</Tag>
                      }
                    </span>
                  ),
                  children: buildMultiperiodAccounting(),
                },
              ]}
            />
          );
        })()}
      </Modal>

      {/* Refresh Status API Log Modal */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{
              color: refreshApiLog.length > 0
                ? (refreshApiLog.every(r => r.status >= 200 && r.status < 300) ? REDWOOD.success : REDWOOD.error)
                : '#aaa',
            }} />
            <span>Refresh Status — API Calls</span>
            {refreshApiLog.length > 0 && (
              <Tag color={refreshApiLog.every(r => r.status >= 200 && r.status < 300) ? 'success' : 'error'}>
                {refreshApiLog.length} calls
              </Tag>
            )}
          </Space>
        }
        open={refreshApiLogVisible}
        onCancel={() => setRefreshApiLogVisible(false)}
        footer={<Button onClick={() => setRefreshApiLogVisible(false)}>Close</Button>}
        width={820}
        styles={{ body: { padding: '12px 20px', maxHeight: '72vh', overflowY: 'auto' } }}
      >
        {refreshApiLog.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {refreshApiLog.map((entry, idx) => {
              const httpOk = entry.status >= 200 && entry.status < 300;
              const prettyJson = (() => {
                try { return JSON.stringify(JSON.parse(entry.response), null, 2); }
                catch { return entry.response; }
              })();
              return (
                <div key={idx} style={{
                  border: `1px solid ${httpOk ? '#b7eb8f' : '#ffccc7'}`,
                  borderRadius: 8, overflow: 'hidden',
                }}>
                  {/* Header row */}
                  <div style={{
                    background: httpOk ? '#f6ffed' : '#fff2f0',
                    padding: '6px 12px',
                    display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: `1px solid ${httpOk ? '#b7eb8f' : '#ffccc7'}`,
                  }}>
                    <Tag color={httpOk ? 'success' : 'error'} style={{ margin: 0, fontWeight: 700, fontSize: 11 }}>
                      {entry.status || 'ERR'}
                    </Tag>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{entry.label}</span>
                  </div>
                  {/* URL row */}
                  <div style={{
                    background: '#f5f5f5', padding: '6px 12px',
                    fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all',
                    borderBottom: '1px solid #e8e8e8',
                    display: 'flex', gap: 6, alignItems: 'flex-start',
                  }}>
                    <span style={{ color: '#1677ff', fontWeight: 700, flexShrink: 0 }}>GET</span>
                    <span style={{ color: '#444' }}>{entry.url}</span>
                  </div>
                  {/* Response body */}
                  <pre style={{
                    background: '#1a1a2e', color: '#e2e8f0',
                    padding: '8px 12px', fontSize: 10, maxHeight: 200,
                    overflowY: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {prettyJson}
                  </pre>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: REDWOOD.neutral400, textAlign: 'center', padding: 32 }}>
            Click the refresh button (⟳) first to see the API call details.
          </div>
        )}
      </Modal>

      {/* API Preview Modal */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>{apiPreviewData?.url?.startsWith('PUT') ? 'Update Invoice — Review & Confirm' : 'API Preview — Postman'}</span>
          </Space>
        }
        open={apiPreviewVisible}
        onCancel={() => setApiPreviewVisible(false)}
        footer={<Button onClick={() => setApiPreviewVisible(false)}>Close</Button>}
        width={900}
        styles={{ body: { padding: '16px 24px', maxHeight: '75vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        {apiPreviewData && (
          <>
            {/* ── Card 1: Invoice ── */}
            {(() => {
              const r = apiExecInvoice;
              const isOk = r && r.httpStatus >= 200 && r.httpStatus < 300;
              return (
                <Card
                  size="small"
                  style={{ border: r ? `1px solid ${isOk ? '#b7eb8f' : '#ffa39e'}` : undefined }}
                  title={
                    <Row justify="space-between" align="middle">
                      <Space>
                        <Tag color={apiPreviewData.url.startsWith('PUT') ? 'orange' : 'green'}>
                          {apiPreviewData.url.split(' ')[0]}
                        </Tag>
                        <Text strong>Create Invoice (Header + Lines)</Text>
                      </Space>
                      <Space size={4}>
                        <Button size="small" icon={<CopyOutlined />}
                          onClick={() => { navigator.clipboard.writeText(apiPreviewData.url); message.success('URL copied'); }}>
                          Copy URL
                        </Button>
                        <Button size="small" icon={<CopyOutlined />}
                          onClick={() => { navigator.clipboard.writeText(apiPreviewData.body); message.success('JSON copied'); }}>
                          Copy JSON
                        </Button>
                        <Button
                          size="small" type="primary" icon={<PlayCircleOutlined />}
                          loading={r?.loading}
                          style={{ background: apiPreviewData.url.startsWith('PUT') ? REDWOOD.warning : REDWOOD.primary, borderColor: apiPreviewData.url.startsWith('PUT') ? REDWOOD.warning : REDWOOD.primary }}
                          onClick={executePreviewInvoiceApi}
                        >
                          {apiPreviewData.url.startsWith('PUT') ? 'Update Invoice' : 'Execute'}
                        </Button>
                      </Space>
                    </Row>
                  }
                >
                  {/* URL bar */}
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
                    background: '#1e1e1e', borderRadius: 4, padding: '7px 12px' }}>
                    <Tag color={apiPreviewData.url.startsWith('PUT') ? 'orange' : 'green'} style={{ margin: 0, fontWeight: 700, fontSize: 11 }}>
                      {apiPreviewData.url.split(' ')[0]}
                    </Tag>
                    <Text style={{ color: '#d4d4d4', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>
                      {apiPreviewData.url.split(' ').slice(1).join(' ')}
                    </Text>
                  </div>
                  {/* Request body */}
                  <Text type="secondary" style={{ fontSize: 11 }}>Request Body</Text>
                  <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '10px 14px', borderRadius: 4,
                    fontSize: 11, fontFamily: 'monospace', maxHeight: 300, overflow: 'auto', margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {apiPreviewData.body}
                  </pre>
                  {/* Response */}
                  {r && !r.loading && (
                    <div style={{ marginTop: 10 }}>
                      <Row align="middle" style={{ marginBottom: 4 }} gutter={8}>
                        <Col><Text type="secondary" style={{ fontSize: 11 }}>Response</Text></Col>
                        <Col>
                          <Tag color={isOk ? 'success' : 'error'} style={{ fontWeight: 700 }}>
                            HTTP {r.httpStatus || 'ERR'}
                          </Tag>
                        </Col>
                        {isOk && (() => {
                          try {
                            const id = JSON.parse(r.body)?.invoiceId;
                            return id ? <Col><Tag color="blue">Invoice ID: {id}</Tag></Col> : null;
                          } catch { return null; }
                        })()}
                      </Row>
                      <pre style={{ background: isOk ? '#0d1a0d' : '#1a0d0d', color: isOk ? '#b5e8b5' : '#f5a5a5',
                        padding: '10px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                        maxHeight: 220, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.body}
                      </pre>
                    </div>
                  )}
                  {r?.loading && (
                    <div style={{ marginTop: 10, textAlign: 'center', padding: '12px 0' }}>
                      <Spin size="small" /><Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>Executing...</Text>
                    </div>
                  )}
                </Card>
              );
            })()}

            {/* ── Card 2: Installment ── */}
            {(() => {
              const r = apiExecInstall;
              const isOk = r && r.httpStatus >= 200 && r.httpStatus < 300;
              // Determine effective invoiceId for the installment URL
              let capturedId: number | null = null;
              if (apiExecInvoice?.body) {
                try { capturedId = JSON.parse(apiExecInvoice.body)?.invoiceId ?? null; } catch { /* */ }
              }
              const effectiveId = capturedId || savedInvoiceId;
              const instBodyDisplay = effectiveId
                ? apiPreviewData!.installmentBody.replace(/"<invoice_id after save>"/g, String(effectiveId))
                : apiPreviewData!.installmentBody;
              const instUrlDisplay = effectiveId
                ? `${apiPreviewData!.installmentUrl.split(' ').slice(1).join(' ')}?P_INVOICE_ID=${effectiveId}`
                : apiPreviewData!.installmentUrl.split(' ').slice(1).join(' ');
              return (
                <Card
                  size="small"
                  style={{ marginTop: 12, border: r ? `1px solid ${isOk ? '#b7eb8f' : '#ffa39e'}` : undefined }}
                  title={
                    <Row justify="space-between" align="middle">
                      <Space>
                        <Tag color="blue">POST</Tag>
                        <Text strong>Create Installment</Text>
                        {!effectiveId && (
                          <Tooltip title="Execute the Invoice API first to capture the Invoice ID">
                            <Tag color="warning" style={{ fontSize: 10 }}>Needs Invoice ID</Tag>
                          </Tooltip>
                        )}
                        {effectiveId && <Tag color="green" style={{ fontSize: 10 }}>ID: {effectiveId}</Tag>}
                      </Space>
                      <Space size={4}>
                        <Button size="small" icon={<CopyOutlined />}
                          onClick={() => { navigator.clipboard.writeText(instBodyDisplay); message.success('Copied'); }}>
                          Copy JSON
                        </Button>
                        <Button
                          size="small" type="primary" icon={<PlayCircleOutlined />}
                          loading={r?.loading}
                          disabled={!effectiveId}
                          style={{ background: effectiveId ? REDWOOD.info : undefined, borderColor: effectiveId ? REDWOOD.info : undefined }}
                          onClick={executePreviewInstallApi}
                        >
                          Execute
                        </Button>
                      </Space>
                    </Row>
                  }
                >
                  {/* URL bar */}
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
                    background: '#1e1e1e', borderRadius: 4, padding: '7px 12px' }}>
                    <Tag color="blue" style={{ margin: 0, fontWeight: 700, fontSize: 11 }}>POST</Tag>
                    <Text style={{ color: effectiveId ? '#d4d4d4' : '#888', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>
                      {instUrlDisplay}
                    </Text>
                  </div>
                  {/* Request body */}
                  <Text type="secondary" style={{ fontSize: 11 }}>Request Body</Text>
                  <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '10px 14px', borderRadius: 4,
                    fontSize: 11, fontFamily: 'monospace', maxHeight: 260, overflow: 'auto', margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {instBodyDisplay}
                  </pre>
                  {/* Response */}
                  {r && !r.loading && (
                    <div style={{ marginTop: 10 }}>
                      <Row align="middle" style={{ marginBottom: 4 }} gutter={8}>
                        <Col><Text type="secondary" style={{ fontSize: 11 }}>Response</Text></Col>
                        <Col><Tag color={isOk ? 'success' : 'error'} style={{ fontWeight: 700 }}>HTTP {r.httpStatus || 'ERR'}</Tag></Col>
                      </Row>
                      <pre style={{ background: isOk ? '#0d1a0d' : '#1a0d0d', color: isOk ? '#b5e8b5' : '#f5a5a5',
                        padding: '10px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                        maxHeight: 200, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.body}
                      </pre>
                    </div>
                  )}
                  {r?.loading && (
                    <div style={{ marginTop: 10, textAlign: 'center', padding: '12px 0' }}>
                      <Spin size="small" /><Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>Executing...</Text>
                    </div>
                  )}
                </Card>
              );
            })()}

            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="Postman Setup"
              description={
                <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 12 }}>
                  <li>Method: <Tag color="green" style={{ fontSize: 11 }}>POST</Tag></li>
                  <li>Header: <code>Content-Type: application/json</code></li>
                  <li>Single POST — header + lines in one JSON, InvoiceId auto-generated by sequence</li>
                  <li>PL/SQL Package: <code>RR_AP_CREATE_INVOICE_PKG.create_invoice</code></li>
                  <li>Tables: <code>RR_AP_INVOICES_ALL</code> (header) + <code>XXAP_INVOICE_LINES_STG</code> (lines)</li>
                </ul>
              }
            />

            <Alert
              type="success"
              showIcon
              style={{ marginTop: 8 }}
              message="Expected Response"
              description={
                <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace' }}>
{`{
  "status": "SUCCESS",
  "message": "Invoice INV-001 created (ID: 900001) with 2 lines",
  "invoiceId": 900001,
  "success": true
}`}
                </pre>
              }
            />
          </>
        )}
      </Modal>

      {/* Supplier Balance Popup Modal */}
      <Modal
        title={
          <Space>
            <WalletOutlined style={{ color: REDWOOD.info }} />
            <span>Supplier Balance — {balanceSupplierName}</span>
            <Tag color="blue">{balanceSupplierNumber}</Tag>
          </Space>
        }
        open={balanceModalVisible}
        onCancel={() => setBalanceModalVisible(false)}
        footer={<Button onClick={() => setBalanceModalVisible(false)}>Close</Button>}
        width={950}
        styles={{ body: { padding: '16px 24px', maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        {balanceLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
            <div style={{ marginTop: 12, color: REDWOOD.neutral600 }}>Loading balance data...</div>
          </div>
        ) : balanceSummary ? (
          <>
            {/* Outstanding Balance Header */}
            <Card
              size="small"
              style={{
                marginBottom: 16,
                background: balanceSummary.balance > 0 ? '#FFF1F0' : '#F6FFED',
                border: `1px solid ${balanceSummary.balance > 0 ? '#FFA39E' : '#B7EB8F'}`,
              }}
            >
              <Row justify="space-between" align="middle">
                <Col>
                  <Text type="secondary">Outstanding Balance</Text>
                  <div>
                    <Text strong style={{ fontSize: 24, color: balanceSummary.balance > 0 ? REDWOOD.error : REDWOOD.success }}>
                      {formatCurrency(balanceSummary.balance, balanceSummary.currency)}
                    </Text>
                  </div>
                </Col>
                <Col>
                  <Row gutter={24}>
                    <Col>
                      <Statistic title="Total Invoices" value={balanceSummary.totalInvoices} prefix={<FileTextOutlined style={{ color: REDWOOD.info }} />} valueStyle={{ fontSize: 16 }} />
                    </Col>
                    <Col>
                      <Statistic title="Invoice Amount" value={balanceSummary.totalInvoiceAmount} precision={2} suffix={balanceSummary.currency} valueStyle={{ fontSize: 14 }} />
                    </Col>
                    <Col>
                      <Statistic title="Payments" value={balanceSummary.totalPayments} prefix={<CreditCardOutlined style={{ color: REDWOOD.success }} />} valueStyle={{ fontSize: 16 }} />
                    </Col>
                    <Col>
                      <Statistic title="Paid Amount" value={balanceSummary.totalPaymentAmount} precision={2} suffix={balanceSummary.currency} valueStyle={{ color: REDWOOD.success, fontSize: 14 }} />
                    </Col>
                  </Row>
                </Col>
              </Row>
            </Card>

            {/* Aging Report */}
            {agingReport.length > 0 && (
              <Card
                title={<Space><ExclamationCircleOutlined style={{ color: REDWOOD.warning }} /><Text strong style={{ fontSize: 13 }}>Aging Report</Text></Space>}
                size="small"
                style={{ marginBottom: 16 }}
              >
                <Row gutter={8}>
                  {agingReport.map((bucket, index) => (
                    <Col span={4} key={index}>
                      <Card size="small" style={{ borderTop: `3px solid ${getAgingColor(bucket.bucket)}`, textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: 10 }}>{bucket.bucket}</Text>
                        <div style={{ margin: '6px 0' }}>
                          <Text strong style={{ fontSize: 14, color: getAgingColor(bucket.bucket) }}>{formatCurrency(bucket.amount)}</Text>
                        </div>
                        <Tag style={{ fontSize: 10 }}>{bucket.invoiceCount} inv</Tag>
                        <Progress percent={bucket.percentage} size="small" strokeColor={getAgingColor(bucket.bucket)} showInfo={false} style={{ marginTop: 6 }} />
                        <Text type="secondary" style={{ fontSize: 10 }}>{bucket.percentage.toFixed(1)}%</Text>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>
            )}

            {/* Invoices & Payments Tabs */}
            <Tabs
              activeKey={balanceActiveTab}
              onChange={handleBalanceTabChange}
              size="small"
              items={[
                {
                  key: 'invoices',
                  label: <span><FileTextOutlined /> Invoices ({balanceInvoices.length})</span>,
                  children: (
                    <>
                      {/* All / Unpaid / Paid filter */}
                      <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
                        {(['all', 'unpaid', 'paid'] as const).map(f => (
                          <Button
                            key={f}
                            size="small"
                            type={balanceInvoiceFilter === f ? 'primary' : 'default'}
                            onClick={() => {
                              setBalanceInvoiceFilter(f);
                              fetchBalanceInvoices(balanceSupplierNumber, f);
                            }}
                          >
                            {f === 'all' ? 'All' : f === 'unpaid' ? 'Unpaid' : 'Paid'}
                          </Button>
                        ))}
                      </div>
                      <Table
                        dataSource={balanceInvoices}
                        columns={[
                          { title: 'Invoice Number', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 130 },
                          { title: 'Invoice Date', dataIndex: 'invoiceDate', key: 'invoiceDate', width: 100, render: (d: string) => formatDateStr(d) },
                          { title: 'Amount', dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 120, align: 'right' as const, render: (amt: number) => <Text strong>{formatCurrency(amt)}</Text> },
                          { title: 'Paid', dataIndex: 'amountPaid', key: 'amountPaid', width: 120, align: 'right' as const, render: (amt: number) => <Text style={{ color: REDWOOD.success }}>{formatCurrency(amt)}</Text> },
                          { title: 'Balance', dataIndex: 'amountRemaining', key: 'amountRemaining', width: 120, align: 'right' as const, render: (amt: number) => <Text style={{ color: amt > 0 ? REDWOOD.error : REDWOOD.success }}>{formatCurrency(amt)}</Text> },
                          { title: 'Status', dataIndex: 'invoiceStatus', key: 'invoiceStatus', width: 90, render: (s: string) => <Tag>{s || '-'}</Tag> },
                          { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
                        ]}
                        rowKey="key"
                        size="small"
                        loading={balanceInvoicesLoading}
                        pagination={{ pageSize: 8, size: 'small' }}
                        scroll={{ y: 280 }}
                      />
                    </>
                  ),
                },
                {
                  key: 'payments',
                  label: <span><CreditCardOutlined /> Payments ({balancePayments.length})</span>,
                  children: (
                    <Table
                      dataSource={balancePayments}
                      columns={[
                        { title: 'Payment Number', dataIndex: 'paymentNumber', key: 'paymentNumber', width: 140 },
                        { title: 'Payment Date', dataIndex: 'paymentDate', key: 'paymentDate', width: 100, render: (d: string) => formatDateStr(d) },
                        { title: 'Amount', dataIndex: 'paymentAmount', key: 'paymentAmount', width: 130, align: 'right' as const, render: (amt: number) => <Text strong style={{ color: REDWOOD.success }}>{formatCurrency(amt)}</Text> },
                        { title: 'Status', dataIndex: 'paymentStatus', key: 'paymentStatus', width: 100, render: (s: string) => <Tag color={s === 'NEGOTIABLE' ? 'green' : 'default'}>{s}</Tag> },
                        { title: 'Method', dataIndex: 'paymentMethod', key: 'paymentMethod', width: 100 },
                        { title: 'Bank Account', dataIndex: 'bankAccountName', key: 'bankAccountName', ellipsis: true },
                      ]}
                      rowKey="key"
                      size="small"
                      loading={balancePaymentsLoading}
                      pagination={{ pageSize: 8, size: 'small' }}
                      scroll={{ y: 300 }}
                    />
                  ),
                },
                {
                  key: 'prepayments',
                  label: <span><DollarOutlined /> Prepayments ({balancePrepayments.length})</span>,
                  children: (
                    <Table
                      dataSource={balancePrepayments.map((r, i) => ({ ...r, key: r.PrepaymentInvoiceId?.toString() || i.toString() }))}
                      columns={[
                        { title: 'Prepayment #', dataIndex: 'PrepaymentNumber', key: 'PrepaymentNumber', width: 140 },
                        { title: 'Date', dataIndex: 'InvoiceDate', key: 'InvoiceDate', width: 100, render: (d: string) => formatDateStr(d) },
                        { title: 'Amount', dataIndex: 'InvoiceAmount', key: 'InvoiceAmount', width: 120, align: 'right' as const, render: (v: number) => <Text strong>{formatCurrency(v)}</Text> },
                        { title: 'Applied', dataIndex: 'TotalApplied', key: 'TotalApplied', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ color: REDWOOD.warning }}>{formatCurrency(v)}</Text> },
                        { title: 'Available', dataIndex: 'AvailableBalance', key: 'AvailableBalance', width: 120, align: 'right' as const,
                          render: (v: number) => <Text strong style={{ color: v > 0 ? REDWOOD.success : REDWOOD.neutral600 }}>{formatCurrency(v)}</Text> },
                        { title: 'Status', dataIndex: 'PaidStatus', key: 'PaidStatus', width: 90,
                          render: (s: string) => <Tag color={s === 'Paid' ? 'green' : 'orange'}>{s || 'Unpaid'}</Tag> },
                        { title: 'Business Unit', dataIndex: 'BusinessUnit', key: 'BusinessUnit', ellipsis: true },
                      ]}
                      rowKey="key"
                      size="small"
                      loading={balancePrepaymentsLoading}
                      pagination={{ pageSize: 8, size: 'small' }}
                      scroll={{ y: 300 }}
                      locale={{ emptyText: 'No prepayments found for this supplier' }}
                    />
                  ),
                },
              ]}
            />
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: REDWOOD.neutral600 }}>
            No balance data available for this supplier.
          </div>
        )}
      </Modal>

      {/* Installments Modal */}
      <Modal
        title={
          <Space>
            <ScheduleOutlined style={{ color: '#722ed1' }} />
            <span>Installments</span>
            <Tooltip
              title={
                <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                  {installmentsModalUrl}
                </span>
              }
              placement="bottom"
            >
              <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 14 }} />
            </Tooltip>
          </Space>
        }
        open={installmentsModalOpen}
        onCancel={() => setInstallmentsModalOpen(false)}
        footer={[<Button key="close" onClick={() => setInstallmentsModalOpen(false)}>Close</Button>]}
        width={900}
        destroyOnClose
      >
        <Spin spinning={installmentsModalLoading}>
          <Table
            dataSource={installmentsModalData.map((item: any, idx: number) => ({
              key: (item.installment_id ?? item.INSTALLMENT_ID ?? idx).toString(),
              paymentNum:    item.payment_num         ?? item.PAYMENT_NUM         ?? item.PaymentNum         ?? idx + 1,
              dueDate:       item.due_date            ?? item.DUE_DATE            ?? item.DueDate            ?? '',
              grossAmount:   item.gross_amount        ?? item.GROSS_AMOUNT        ?? item.GrossAmount        ?? 0,
              remaining:     item.amount_remaining    ?? item.AMOUNT_REMAINING    ?? item.unpaid_amount      ?? item.UNPAID_AMOUNT ?? item.UnpaidAmount ?? 0,
              status:        item.payment_status_flag ?? item.PAYMENT_STATUS_FLAG ?? item.status             ?? item.STATUS       ?? '',
              paymentMethod: item.payment_method_code ?? item.PAYMENT_METHOD_CODE ?? item.payment_method     ?? item.PAYMENT_METHOD ?? '',
              priority:      item.payment_priority    ?? item.PAYMENT_PRIORITY    ?? item.PaymentPriority    ?? '',
              holdFlag:      item.hold_flag           ?? item.HOLD_FLAG           ?? 'N',
            }))}
            columns={[
              { title: '#',              dataIndex: 'paymentNum',    key: 'paymentNum',    width: 55,  align: 'center' as const },
              { title: 'Due Date',       dataIndex: 'dueDate',       key: 'dueDate',       width: 110,
                render: (v: string) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '' },
              { title: 'Gross Amount',   dataIndex: 'grossAmount',   key: 'grossAmount',   width: 130, align: 'right' as const,
                render: (v: number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) },
              { title: 'Remaining',      dataIndex: 'remaining',     key: 'remaining',     width: 130, align: 'right' as const,
                render: (v: number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) },
              { title: 'Status',         dataIndex: 'status',        key: 'status',        width: 90,
                render: (v: string) => {
                  const s = (v || '').toUpperCase();
                  const color = s === 'Y' || s === 'PAID' ? 'success' : s === 'P' || s === 'PARTIAL' ? 'warning' : 'default';
                  const label = s === 'Y' ? 'Paid' : s === 'N' ? 'Unpaid' : s === 'P' ? 'Partial' : v || 'Unpaid';
                  return <Tag color={color}>{label}</Tag>;
                }},
              { title: 'Payment Method', dataIndex: 'paymentMethod', key: 'paymentMethod', width: 130 },
              { title: 'Priority',       dataIndex: 'priority',      key: 'priority',      width: 70, align: 'center' as const },
              { title: 'Hold',           dataIndex: 'holdFlag',      key: 'holdFlag',      width: 60, align: 'center' as const,
                render: (v: string) => v === 'Y' ? <Tag color="error">Hold</Tag> : null },
            ]}
            size="small"
            bordered
            pagination={false}
            locale={{ emptyText: 'No installments found for this invoice.' }}
            summary={(rows) => rows.length === 0 ? undefined : (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}><span style={{ fontWeight: 600 }}>Totals</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <span style={{ fontWeight: 600 }}>
                      {rows.reduce((s, r: any) => s + Number(r.grossAmount || 0), 0)
                        .toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <span style={{ fontWeight: 600 }}>
                      {rows.reduce((s, r: any) => s + Number(r.remaining || 0), 0)
                        .toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} colSpan={4} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </Spin>
      </Modal>

      {/* ═══════════════════ PAY IN FULL MODAL ═══════════════════ */}
      <Modal
        title={
          <Space>
            <CreditCardOutlined style={{ color: REDWOOD.success }} />
            <span>Pay Invoice in Full</span>
            <Tooltip title="View POST endpoints & JSON bodies">
              <ApiOutlined
                style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 15, marginLeft: 4 }}
                onClick={(e) => { e.stopPropagation(); setPayInFullApiDrawerOpen(true); }}
              />
            </Tooltip>
          </Space>
        }
        open={payInFullOpen}
        onCancel={() => { setPayInFullOpen(false); payInFullForm.resetFields(); setPayInFullStepStatus([]); setStep1CheckId(null); }}
        width={960}
        destroyOnClose
        footer={(() => {
          const paymentDone = payInFullStepStatus.length > 0 &&
            payInFullStepStatus.every(s => s.status === 'success');
          return paymentDone ? [
            <Button
              key="pdf"
              icon={<PrinterOutlined />}
              onClick={generatePayInFullVoucherPdf}
            >
              Payment Voucher PDF
            </Button>,
            <Button
              key="close"
              type="primary"
              icon={<CheckCircleOutlined />}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={() => { setPayInFullOpen(false); payInFullForm.resetFields(); setPayInFullStepStatus([]); setStep1CheckId(null); }}
            >
              Close
            </Button>,
          ] : [
            <Button key="cancel" onClick={() => { setPayInFullOpen(false); payInFullForm.resetFields(); }}>
              Cancel
            </Button>,
            <Button
              key="pdf"
              icon={<PrinterOutlined />}
              onClick={generatePayInFullVoucherPdf}
            >
              Preview Voucher
            </Button>,
            <Button
              key="submit"
              type="primary"
              loading={payInFullSubmitting}
              icon={<CreditCardOutlined />}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={() => payInFullForm.submit()}
            >
              Confirm Payment
            </Button>,
          ];
        })()}
      >
        <Form
          form={payInFullForm}
          layout="vertical"
          size="small"
          onValuesChange={() => setPayInFullTick(t => t + 1)}
          onFinish={async (values) => {
            const invoiceId      = savedInvoiceId ?? initialData?.invoiceId;
            const buName         = form.getFieldValue('businessUnit') || headerValues.businessUnit || '';
            const supplierName   = form.getFieldValue('supplier') || '';
            const supplierNumber = form.getFieldValue('supplierNumber') || null;
            const supplierSite   = form.getFieldValue('supplierSite') || null;
            const invoiceNumber  = form.getFieldValue('invoiceNumber') || null;
            const currency       = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
            const payDate        = values.paymentDate ? values.paymentDate.format('YYYY-MM-DD') : null;
            const sysdate        = dayjs().format('YYYY-MM-DDTHH:mm:ss.SSS+00:00');
            const loginUser      = user?.username || null;
            const selBankAcct    = payInFullBankAccounts.find(a => a.bankAccountName === values.disbursementBankAccount);
            const legalEntityName   = selBankAcct?.legalEntityName   || '';
            const bankAccountNumber = selBankAcct?.bankAccountNumber || null;
            const supplierId        = form.getFieldValue('supplierId')
                                      || suppliers.find(s => s.supplierNumber === supplierNumber || s.supplier === supplierName)?.supplierId
                                      || null;
            const pendingInst = invoiceInstallments.filter(i => i.unpaidAmount > 0);
            const hasInstallments = pendingInst.length > 0;

            // Build initial step list
            const relatedStep = hasInstallments ? 3 : 2;
            const acctStep    = hasInstallments ? 4 : 3;
            const glStep      = hasInstallments ? 5 : 4;
            const initSteps = [
              { step: 0, label: 'Check invoice balance',         status: 'idle' as const, detail: undefined },
              { step: 1, label: 'Create payment record',         status: 'idle' as const, detail: undefined },
              ...(hasInstallments ? [{ step: 2, label: `Update installments (${pendingInst.length})`, status: 'idle' as const, detail: undefined }] : []),
              { step: relatedStep, label: 'Link payment to invoice', status: 'idle' as const, detail: undefined },
              { step: acctStep,    label: 'Create accounting',       status: 'idle' as const, detail: undefined },
              { step: glStep,      label: 'Post to GL',              status: 'idle' as const, detail: undefined },
            ];
            setPayInFullStepStatus(initSteps);
            setPayInFullSubmitting(true);

            const setStep = (step: number, status: 'running' | 'success' | 'error', detail?: string) =>
              setPayInFullStepStatus(prev => prev.map(s => s.step === step ? { ...s, status, detail } : s));

            try {
              // ── Step 0: balance check ──────────────────────────────────────
              setStep(0, 'running');
              const latestBalance = await fetchInvoiceBalance(invoiceId!);
              if (latestBalance !== null && latestBalance <= 0) {
                setStep(0, 'error', 'Invoice already paid — no remaining balance');
                message.error('Invoice already paid. No remaining balance.');
                return;
              }
              const payBalance = latestBalance ?? invoiceBalance ?? 0;
              setStep(0, 'success', `Balance: ${formatAmount(payBalance)} ${currency}`);

              // ── Step 1: POST /ap/payments ──────────────────────────────────
              setStep(1, 'running');
              const step1Body = {
                CheckId: null, PaymentId: null,
                PaymentReference: values.paymentReference || null,
                PaperDocumentNumber: values.paperDocumentNumber || null,
                PaymentNumber: values.paperDocumentNumber || null,
                VoucherNumber: values.voucherNumber || null,
                PaymentAmount: payBalance, PaymentBaseAmount: payBalance,
                WithheldAmount: null, BankChargeAmount: null,
                PaymentDate: payDate, AccountingDate: payDate,
                MaturityDate: values.maturityDate ? values.maturityDate.format('YYYY-MM-DD') : null,
                AnticipatedValueDate: null, StopDate: null,
                VoidDate: null, VoidAccountingDate: null,
                ConversionDate: values.conversionDate ? values.conversionDate.format('YYYY-MM-DD') : payDate,
                ClearingDate: null,
                ClearingConversionDate: null, ClearingValueDate: null, MaturityConversionDate: null,
                CreationDate: sysdate, LastUpdateDate: sysdate,
                LocalCreatedDate: sysdate, LocalUpdatedDate: sysdate,
                PaymentDescription: values.description || null,
                PaymentStatus: 'Negotiable', PaymentType: 'Quick',
                PaymentMode: null, PaymentFunction: 'Supplier Payments',
                PaymentCurrency: values.paymentCurrency || currency,
                PaymentBaseCurrency: values.paymentBaseCurrency || 'AED',
                ConversionRate: values.conversionRate || headerValues.conversionRate || null,
                ConversionRateType: values.conversionRateType || headerValues.conversionRateType || null,
                CrossCurrencyRateType: 'Corporate',
                ClearingAmount: null, ClearingLedgerAmount: null,
                ClearingConversionRate: null, ClearingConversionRateType: null,
                MaturityConversionRateType: null, MaturityConversionRate: null,
                AccountingStatus: null, ReconciledFlag: 'false',
                SeparateRemittanceAdviceCreated: null, IbyPaymentStatus: null,
                LegalEntity: legalEntityName || null,
                BusinessUnit: buName, ProcurementBU: buName,
                Payee: supplierName, PartyId: supplierId,
                PayeeSite: supplierSite, SupplierNumber: supplierNumber,
                EmployeeAddress: null, ThirdPartySupplier: null, ThirdPartyAddressName: null,
                ExternalBankAccountId: null, RemitToAccountNumber: null,
                DisbursementBankAccountNumber: bankAccountNumber,
                DisbursementBankAccountName: values.disbursementBankAccount || null,
                FundingCardAccount: null, DigitalPaymentAccount: null,
                PaymentMethodCode: values.paymentDocument || null,
                PaymentMethod: values.paymentMethod || null,
                PaymentDocument: values.paymentDocument || null,
                PaymentProcessProfileCode: null, PaymentProcessProfile: null,
                DocumentCategory: null, DocumentSequence: null,
                AddressLine1: null, AddressLine2: null, AddressLine3: null, AddressLine4: null,
                City: null, County: null, Province: null, State: null,
                Country: 'AE', Zip: null,
                StopReason: null, StopReference: null,
                CreatedBy: loginUser, LastUpdatedBy: loginUser, LastUpdateLogin: loginUser,
              };
              let capturedCheckId: number | null = null;
              let generatedPaymentNumber: string | null = null;
              try {
                const res1 = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/payments`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: JSON.stringify(step1Body),
                });
                const text1 = await res1.text();
                const data1 = (() => { try { return JSON.parse(text1); } catch { return { raw: text1 }; } })();
                if (data1?.status === 'error' || !res1.ok) {
                  setStep(1, 'error', data1?.message || `HTTP ${res1.status}`);
                  message.error('Step 1 failed — payment not created');
                  return;
                }
                capturedCheckId = data1?.checkId ?? null;
                setStep1CheckId(capturedCheckId);
                generatedPaymentNumber = data1?.paymentNumber ?? null;
                setStep(1, 'success', `Payment No: ${generatedPaymentNumber ?? capturedCheckId}`);
              } catch (e: any) {
                setStep(1, 'error', e?.message ?? 'Network error');
                message.error('Step 1 failed — network error');
                return;
              }

              // ── Step 2 (optional): PUT installments ────────────────────────
              // Capture installment IDs so Step 3 can store them in the related-invoices record
              const installmentIdMap: Record<string, string> = {};
              if (hasInstallments) {
                setStep(2, 'running');
                let instErrors = 0;
                for (const inst of pendingInst) {
                  try {
                    const res2 = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                      body: JSON.stringify({
                        InvoiceId: invoiceId, InstallmentId: inst.key,
                        PaymentStatus: 'Fully Paid', AmountRemaining: 0,
                      }),
                    });
                    const d2 = await res2.json().catch(() => ({}));
                    if (d2?.status === 'error' || !res2.ok) {
                      instErrors++;
                    } else {
                      installmentIdMap[String(invoiceId)] = inst.key; // track primary installment
                    }
                  } catch { instErrors++; }
                }
                if (instErrors > 0) {
                  setStep(2, 'error', `${instErrors} of ${pendingInst.length} installment(s) failed`);
                } else {
                  setStep(2, 'success', `${pendingInst.length} installment(s) updated`);
                }
              }

              // ── Step link: POST /ap/payments/related-invoices ─────────────
              setStep(relatedStep, 'running');
              const step3Body = {
                InvoicePaymentId: null,
                CheckId: capturedCheckId,
                InvoiceId: invoiceId,
                InvoiceBusinessUnit: buName || null,
                InvoiceNumber: invoiceNumber,
                InstallmentNumber: installmentIdMap[String(invoiceId)] ? Number(installmentIdMap[String(invoiceId)]) : (pendingInst[0]?.key ? Number(pendingInst[0].key) : null),
                AmountPaidPaymentCurrency: payBalance,
                AmountPaidInvoiceCurrency: payBalance,
                InvoicePaymentAmount: payBalance,
                InvoiceAmount: payBalance,
                InvoiceBaseAmount: payBalance,
                PaymentBaseAmount: payBalance,
                DiscountLost: null, DiscountTaken: null,
                InvoiceCurrency: currency,
                CrossCurrencyRate: headerValues.conversionRate || null,
                InvoicePaymentStatus: 'Negotiable',
                CreatedBy: null, LastUpdatedBy: null, LastUpdateLogin: null,
              };
              try {
                const res3 = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/payments/related-invoices`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: JSON.stringify(step3Body),
                });
                const text3 = await res3.text();
                const data3 = (() => { try { return JSON.parse(text3); } catch { return { raw: text3 }; } })();
                if (data3?.status === 'error' || !res3.ok) {
                  setStep(relatedStep, 'error', data3?.message || `HTTP ${res3.status}`);
                  message.error('Link failed — invoice link not created');
                  return;
                }
                setStep(relatedStep, 'success', 'Payment linked to invoice');
              } catch (e: any) {
                setStep(relatedStep, 'error', e?.message ?? 'Network error');
                message.error('Link step failed — network error');
                return;
              }

              // ── Create accounting + Post to GL ─────────────────────────────
              setStep(acctStep, 'running');
              try {
                const hasMaturity = !!(values.maturityDate || values.paymentType?.toLowerCase().includes('pdc'));
                const cashClearingAccount = hasMaturity
                  ? (selBankAcct?.pdcAccountCombination  || '')
                  : (selBankAcct?.cashAccountCombination || '');
                const accountingCrClass = hasMaturity ? 'PDC' : 'CASH';
                if (!cashClearingAccount) {
                  setStep(acctStep, 'error', 'Bank account has no cash/PDC account — skipped');
                  setStep(glStep, 'error', 'Skipped');
                  message.warning('Payment created but accounting skipped — bank account missing cash account');
                } else {
                  const [relRes2, ledgerInfo2] = await Promise.all([
                    fetch(`${APEX_DB_CONFIG.baseUrl}/ap/payments/${capturedCheckId}/related-invoices`, { headers: { Accept: 'application/json' } }),
                    fetchLedgerByBusinessUnit(buName),
                  ]);
                  const relData2    = await relRes2.json();
                  const relInvoices2: any[] = relData2.items || [];
                  const paymentCcy  = values.paymentCurrency || currency;
                  const exRate      = (paymentCcy !== 'AED' && (values.conversionRate || headerValues.conversionRate))
                    ? Number(values.conversionRate || headerValues.conversionRate) : 1;
                  const paperDocNum  = values.paperDocumentNumber || generatedPaymentNumber || String(capturedCheckId);
                  const paymentNum   = generatedPaymentNumber || String(capturedCheckId);
                  const payDate2     = payDate || dayjs().format('YYYY-MM-DD');

                  const payloads = buildApPaymentSlaPayloads({
                    checkId:              capturedCheckId!,
                    paymentNumber:        paymentNum,
                    paperDocumentNumber:  paperDocNum,
                    paymentDate:         payDate2,
                    currencyCode:        paymentCcy,
                    exchangeRate:        exRate,
                    businessUnit:        buName || undefined,
                    legalEntity:         legalEntityName || undefined,
                    ledgerId:            ledgerInfo2?.ledgerId,
                    ledgerName:          ledgerInfo2?.ledgerName,
                    cashClearingAccount,
                    accountingClass:     accountingCrClass,
                    appliedInvoices:     relInvoices2.map((inv: any) => ({
                      invoiceNumber:          inv.InvoiceNumber || '',
                      invoiceId:              inv.InvoiceId || 0,
                      amountPaid:             inv.AmountPaidInvoiceCurrency || inv.InvoicePaymentAmount || 0,
                      liabilityDistribution:  inv.LiabilityDistribution || '',
                    })),
                  });

                  const acctHeaderIds: { headerId: number; payload: typeof payloads[0] }[] = [];
                  for (const payload of payloads) {
                    const result = await createAccounting(payload);
                    acctHeaderIds.push({ headerId: result.headerId, payload });
                  }
                  setStep(acctStep, 'success', `${acctHeaderIds.length} SLA header(s) created`);

                  // ── Post to GL ──────────────────────────────────────────────
                  setStep(glStep, 'running');
                  const period   = derivePeriodName(new Date(payDate2));
                  let glSuccess  = 0;
                  const glErrors: string[] = [];
                  for (const { headerId, payload } of acctHeaderIds) {
                    const glLines: GlPostingLine[] = payload.lines.map(l => ({
                      lineType:           l.lineType as 'DR' | 'CR',
                      enteredDr:          l.lineType === 'DR' ? (l.enteredDr  || null) : null,
                      enteredCr:          l.lineType === 'CR' ? (l.enteredCr  || null) : null,
                      accountedDr:        l.lineType === 'DR' ? (l.accountedDr || null) : null,
                      accountedCr:        l.lineType === 'CR' ? (l.accountedCr || null) : null,
                      description:        l.description || '',
                      currencyCode:       l.currencyCode || paymentCcy,
                      accountingDate:     payDate2,
                      accountCombination: l.accountCombination || '',
                      accountingClass:    l.accountingClass || null,
                      legalEntity:        legalEntityName || null,
                    }));
                    const glResult = await postSlaToGL({
                      slaHeaderId:    headerId,
                      sourceNumber:   paperDocNum,
                      sourceId:       capturedCheckId!,
                      eventTypeCode:  'AP_PAYMENT_CREATED',
                      jeCategory:     'AP_PAYMENT_CREATED',
                      periodName:     period,
                      ledgerName:     ledgerInfo2?.ledgerName || 'BCL DIFC',
                      ledgerId:       ledgerInfo2?.ledgerId   || 300000003259529,
                      currency:       paymentCcy,
                      accountingDate: payDate2,
                      legalEntity:    legalEntityName || '',
                      businessUnit:   buName || '',
                      conversionRate: exRate,
                      lines:          glLines,
                      createdBy:      loginUser || 'SYSTEM',
                    });
                    if (glResult.success) glSuccess++;
                    else glErrors.push(glResult.error || 'Unknown GL error');
                  }
                  if (glErrors.length > 0) {
                    setStep(glStep, 'error', `${glErrors.length} GL error(s): ${glErrors[0]}`);
                    message.warning('Payment created but GL posting had errors');
                  } else {
                    setStep(glStep, 'success', `${glSuccess} GL journal(s) posted`);
                    message.success('Payment created, accounting done, and posted to GL!');
                  }
                }
              } catch (acctErr: any) {
                setStep(acctStep, 'error', acctErr.message ?? 'Accounting failed');
                setStep(glStep, 'error', 'Skipped due to accounting error');
                message.warning('Payment created but accounting failed: ' + (acctErr.message ?? 'Unknown error'));
              }

              handleRefreshStatus();

            } finally {
              setPayInFullSubmitting(false);
            }
          }}
        >
          {/* ── Read-only invoice summary ── */}
          <div style={{
            background: REDWOOD.neutral100,
            border: `1px solid ${REDWOOD.neutral200}`,
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 16,
          }}>
            <Row gutter={16}>
              <Col span={12}>
                <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Business Unit</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {form.getFieldValue('businessUnit') || headerValues.businessUnit || '—'}
                </div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Supplier</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {form.getFieldValue('supplier') || '—'}
                </div>
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={12}>
                <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Invoice Number</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {form.getFieldValue('invoiceNumber') || '—'}
                </div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Remaining Balance</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: REDWOOD.success }}>
                  {invoiceBalanceLoading
                    ? 'Loading...'
                    : formatAmount(
                        invoiceBalance !== null
                          ? invoiceBalance
                          : computedTotal - invoicePayments.filter(p => p.status !== 'Voided').reduce((s, p) => s + p.paidAmount, 0)
                      )}{' '}
                  <span style={{ fontSize: 13 }}>
                    {headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED'}
                  </span>
                </div>
              </Col>
            </Row>
          </div>

          <Divider style={{ margin: '0 0 14px' }} />

          {/* ── Payment fields ── */}
          {/* Row 1: Date | Method | Document */}
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                label="Payment Date"
                name="paymentDate"
                rules={[{ required: true, message: 'Payment date is required' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="Payment Method"
                name="paymentMethod"
                rules={[{ required: true, message: 'Payment method is required' }]}
              >
                <Select placeholder="Select method">
                  <Select.Option value="Electronic">Electronic</Select.Option>
                  <Select.Option value="Check">Check</Select.Option>
                  <Select.Option value="Wire">Wire</Select.Option>
                  <Select.Option value="EFT">EFT</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Payment Document" name="paymentDocument">
                <Select placeholder="Select document" allowClear>
                  <Select.Option value="Check">Check</Select.Option>
                  <Select.Option value="Manual">Manual</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* Row 2: Paper Doc # | Reference | Voucher */}
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Paper Document Number" name="paperDocumentNumber">
                <Input placeholder="Auto-assigned if blank" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Payment Reference" name="paymentReference">
                <Input placeholder="Optional reference" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Voucher Number" name="voucherNumber">
                <Input placeholder="Optional voucher number" />
              </Form.Item>
            </Col>
          </Row>

          {/* Row 3: Disbursement Bank Account (full width — has dynamic label) */}
          <Form.Item
            label={
              <Space>
                <span>Disbursement Bank Account</span>
                {payInFullBankLoading && <LoadingOutlined style={{ fontSize: 12, color: REDWOOD.info }} />}
                {!payInFullBankLoading && payInFullBankAccounts.length === 0 && (
                  <span style={{ color: REDWOOD.warning, fontSize: 11 }}>
                    No accounts found for this Business Unit
                  </span>
                )}
              </Space>
            }
            name="disbursementBankAccount"
            rules={[{ required: true, message: 'Bank account is required' }]}
          >
            <Select
              placeholder={payInFullBankLoading ? 'Loading...' : 'Select bank account'}
              loading={payInFullBankLoading}
              showSearch
              optionFilterProp="label"
            >
              {payInFullBankAccounts.map((acct, i) => (
                <Select.Option key={i} value={acct.bankAccountName} label={acct.bankAccountName}>
                  <Space>
                    <BankOutlined style={{ color: REDWOOD.info }} />
                    <span>{acct.bankAccountName}</span>
                    {acct.currencyCode && <Tag style={{ fontSize: 10 }}>{acct.currencyCode}</Tag>}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {/* Row 4: Payment Currency | Payment Base Currency */}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Payment Currency" name="paymentCurrency">
                <Select placeholder="Select currency" showSearch>
                  {['AED','USD','EUR','GBP','SAR','QAR','KWD','BHD','OMR','JOD','EGP','INR'].map(c => (
                    <Select.Option key={c} value={c}>{c}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Payment Base Currency" name="paymentBaseCurrency">
                <Select placeholder="Select base currency" showSearch>
                  {['AED','USD','EUR','GBP','SAR','QAR','KWD','BHD','OMR','JOD','EGP','INR'].map(c => (
                    <Select.Option key={c} value={c}>{c}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* Row 5: Conversion fields + Maturity Date (shown for all, required for foreign currency) */}
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item
                label="Conversion Rate Type"
                name="conversionRateType"
                rules={[{ required: (headerValues.invoiceCurrency || 'AED') !== 'AED', message: 'Required for foreign currency' }]}
              >
                <Select placeholder="Select type" allowClear>
                  <Select.Option value="User">User</Select.Option>
                  <Select.Option value="Corporate">Corporate</Select.Option>
                  <Select.Option value="Spot">Spot</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="Conversion Date"
                name="conversionDate"
                rules={[{ required: (headerValues.invoiceCurrency || 'AED') !== 'AED', message: 'Required for foreign currency' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="Conversion Rate"
                name="conversionRate"
                rules={[{ required: (headerValues.invoiceCurrency || 'AED') !== 'AED', message: 'Required for foreign currency' }]}
              >
                <InputNumber style={{ width: '100%' }} placeholder="0.000000" precision={6} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="Maturity Date" name="maturityDate">
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Optional payment description" />
          </Form.Item>

          {/* ── Step execution status ── */}
          {payInFullStepStatus.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0 10px' }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral700, marginBottom: 8 }}>
                Payment Progress
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {payInFullStepStatus.map(s => {
                  const icon =
                    s.status === 'idle'    ? <span style={{ color: REDWOOD.neutral300, fontSize: 16 }}>○</span> :
                    s.status === 'running' ? <Spin size="small" /> :
                    s.status === 'success' ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16 }} /> :
                                             <CloseCircleOutlined style={{ color: REDWOOD.error,   fontSize: 16 }} />;
                  const bg =
                    s.status === 'success' ? '#f6ffed' :
                    s.status === 'error'   ? '#fff2f0' :
                    s.status === 'running' ? '#e6f4ff' : REDWOOD.neutral100;
                  const border =
                    s.status === 'success' ? '#b7eb8f' :
                    s.status === 'error'   ? '#ffa39e' :
                    s.status === 'running' ? '#91caff' : REDWOOD.neutral200;
                  return (
                    <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 6, background: bg, border: `1px solid ${border}` }}>
                      {icon}
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Step {s.step}: {s.label}</span>
                        {s.detail && <span style={{ fontSize: 11, color: REDWOOD.neutral600, marginLeft: 8 }}>{s.detail}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Pending installments (below form fields) ── */}
          {(() => {
            const pending = invoiceInstallments.filter(i => i.unpaidAmount > 0);
            if (pending.length === 0) return null;
            const totalUnpaid = pending.reduce((s, i) => s + i.unpaidAmount, 0);
            const currency = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
            return (
              <>
                <Divider style={{ margin: '12px 0 10px' }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.neutral700, marginBottom: 6 }}>
                  Pending Installments
                </div>
                <Table
                  dataSource={pending}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  scroll={{ y: 180 }}
                  columns={[
                    { title: '#',            dataIndex: 'installmentNumber', key: 'installmentNumber', width: 45,  align: 'center' as const },
                    { title: 'Due Date',     dataIndex: 'dueDate',           key: 'dueDate',           width: 110 },
                    { title: 'Gross Amount', dataIndex: 'grossAmount',       key: 'grossAmount',       width: 140, align: 'right' as const,
                      render: (v: number) => <Text>{formatAmount(v)}</Text> },
                    { title: 'Unpaid Amount', dataIndex: 'unpaidAmount',     key: 'unpaidAmount',      align: 'right' as const,
                      render: (v: number) => (
                        <Text strong style={{ color: REDWOOD.warning }}>{formatAmount(v)} {currency}</Text>
                      )},
                  ]}
                  summary={() => (
                    <Table.Summary.Row style={{ background: '#fffbe6' }}>
                      <Table.Summary.Cell index={0} colSpan={3} align="right">
                        <Text strong style={{ fontSize: 12 }}>Total Unpaid</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <Text strong style={{ color: REDWOOD.warning, fontSize: 13 }}>
                          {formatAmount(totalUnpaid)} {currency}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </>
            );
          })()}
        </Form>
      </Modal>

      {/* ═══════════════ PAY IN FULL — PAYMENT VOUCHER PDF ═══════════════ */}
      <Modal
        open={payInFullPdfOpen}
        onCancel={() => { setPayInFullPdfOpen(false); if (payInFullPdfUrl) URL.revokeObjectURL(payInFullPdfUrl); setPayInFullPdfUrl(null); }}
        title={<Space><PrinterOutlined style={{ color: REDWOOD.primary }} /><span>Payment Voucher — PDF Preview</span></Space>}
        width={860}
        footer={[
          <Button
            key="download"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => {
              if (payInFullPdfUrl) {
                const a = document.createElement('a');
                a.href = payInFullPdfUrl;
                a.download = `payment-voucher-${step1CheckId || 'draft'}.pdf`;
                a.click();
              }
            }}
          >
            Download PDF
          </Button>,
          <Button key="close" onClick={() => { setPayInFullPdfOpen(false); if (payInFullPdfUrl) URL.revokeObjectURL(payInFullPdfUrl); setPayInFullPdfUrl(null); }}>
            Close
          </Button>,
        ]}
        destroyOnClose
      >
        {payInFullPdfUrl && (
          <iframe src={payInFullPdfUrl} style={{ width: '100%', height: '75vh', border: 'none' }} title="Payment Voucher Preview" />
        )}
      </Modal>

      {/* ═══════════════ PAY IN FULL — API REFERENCE DRAWER ═══════════════ */}
      <Drawer
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>Pay in Full — API Endpoints</span>
          </Space>
        }
        placement="right"
        width={680}
        zIndex={1100}
        open={payInFullApiDrawerOpen}
        onClose={() => {
          setPayInFullApiDrawerOpen(false);
          setStep1CheckId(null);
          setStepResults({});
          setStepLoading({});
        }}
        destroyOnClose={false}
      >
        {(() => {
          const invoiceId       = savedInvoiceId ?? initialData?.invoiceId ?? '<INVOICE_ID>';
          const fv              = payInFullForm.getFieldsValue();
          const buName          = form.getFieldValue('businessUnit') || headerValues.businessUnit || '';
          const supplierName    = form.getFieldValue('supplier') || '';
          const supplierNumber  = form.getFieldValue('supplierNumber') || null;
          const pendingInst     = invoiceInstallments.filter(i => i.unpaidAmount > 0);
          const currency        = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
          const balance         = computedTotal - invoicePayments
            .filter(p => p.status !== 'Voided').reduce((s, p) => s + p.paidAmount, 0);
          const selBankAcct        = payInFullBankAccounts.find(a => a.bankAccountName === fv.disbursementBankAccount);
          const legalEntityName    = selBankAcct?.legalEntityName    || '';
          const bankAccountNumber  = selBankAcct?.bankAccountNumber  || null;
          const supplierId         = form.getFieldValue('supplierId')
                                     || suppliers.find(s => s.supplierNumber === supplierNumber || s.supplier === supplierName)?.supplierId
                                     || null;
          const supplierSite       = form.getFieldValue('supplierSite') || null;
          const loginUser          = user?.username || null;
          // Oracle TO_TIMESTAMP_TZ expects +00:00 not Z
          const sysdate            = dayjs().format('YYYY-MM-DDTHH:mm:ss.SSS+00:00');
          const payDate         = fv.paymentDate ? fv.paymentDate.format('YYYY-MM-DD') : null;
          const relatedStep     = pendingInst.length > 0 ? 3 : 2;

          const blockStyle: React.CSSProperties = {
            background: '#1e1e1e', color: '#d4d4d4',
            fontFamily: 'monospace', fontSize: 11,
            padding: '10px 12px', borderRadius: 6,
            overflowX: 'auto', whiteSpace: 'pre',
            marginTop: 6, marginBottom: 0,
          };
          const labelStyle: React.CSSProperties = {
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 8px', borderRadius: 4, marginRight: 8,
          };

          const apis = [
            {
              step: 1,
              method: 'POST',
              color: '#52c41a',
              url: `${APEX_DB_CONFIG.baseUrl}/ap/payments`,
              desc: '✅ POST /ap/payments — CheckId:null → backend assigns seq. Response returns checkId which is auto-injected into the last step body.',
              body: {
                // ── IDs (auto-generated by backend) ──────────────────────
                CheckId:                         null,
                PaymentId:                       null,
                PaymentReference:                fv.paymentReference || null,
                PaperDocumentNumber:             fv.paperDocumentNumber || null,
                PaymentNumber:                   fv.paperDocumentNumber || null,
                PaymentFileReference:            null,
                PaymentProcessRequest:           null,
                VoucherNumber:                   fv.voucherNumber || null,
                // ── Amounts ──────────────────────────────────────────────
                PaymentAmount:                   balance,
                PaymentBaseAmount:               balance,
                WithheldAmount:                  null,
                BankChargeAmount:                null,
                // ── Dates ────────────────────────────────────────────────
                PaymentDate:                     payDate,
                AccountingDate:                  payDate,
                MaturityDate:                    null,
                AnticipatedValueDate:            null,
                StopDate:                        null,
                VoidDate:                        null,
                VoidAccountingDate:              null,
                ConversionDate:                  payDate,
                ClearingDate:                    null,
                ClearingConversionDate:          null,
                ClearingValueDate:               null,
                MaturityConversionDate:          null,
                // ── Audit timestamps ─────────────────────────────────────
                CreationDate:                    sysdate,
                LastUpdateDate:                  sysdate,
                LocalCreatedDate:                sysdate,
                LocalUpdatedDate:                sysdate,
                // ── Details ──────────────────────────────────────────────
                PaymentDescription:              fv.description || null,
                PaymentStatus:                   'Negotiable',
                PaymentType:                     'Quick',
                PaymentMode:                     null,
                PaymentFunction:                 'Supplier Payments',
                // ── Currency ─────────────────────────────────────────────
                PaymentCurrency:                 currency,
                PaymentBaseCurrency:             currency,
                ConversionRate:                  headerValues.conversionRate || null,
                ConversionRateType:              headerValues.conversionRateType || null,
                CrossCurrencyRateType:           'Corporate',
                // ── Clearing ─────────────────────────────────────────────
                ClearingAmount:                  null,
                ClearingLedgerAmount:            null,
                ClearingConversionRate:          null,
                ClearingConversionRateType:      null,
                // ── Maturity ─────────────────────────────────────────────
                MaturityConversionRateType:      null,
                MaturityConversionRate:          null,
                // ── Status flags ─────────────────────────────────────────
                AccountingStatus:                null,
                ReconciledFlag:                  'false',
                SeparateRemittanceAdviceCreated: null,
                IbyPaymentStatus:                null,
                // ── Organization ─────────────────────────────────────────
                LegalEntity:                     legalEntityName || null,
                BusinessUnit:                    buName,
                ProcurementBU:                   buName,
                // ── Payee / Supplier ─────────────────────────────────────
                Payee:                           supplierName,
                PartyId:                         supplierId,
                PayeeSite:                       supplierSite,
                SupplierNumber:                  supplierNumber,
                EmployeeAddress:                 null,
                ThirdPartySupplier:              null,
                ThirdPartyAddressName:           null,
                // ── Bank ─────────────────────────────────────────────────
                ExternalBankAccountId:           null,
                RemitToAccountNumber:            null,
                DisbursementBankAccountNumber:   bankAccountNumber,
                DisbursementBankAccountName:     fv.disbursementBankAccount || null,
                FundingCardAccount:              null,
                DigitalPaymentAccount:           null,
                // ── Payment method ───────────────────────────────────────
                PaymentMethodCode:               fv.paymentDocument || null,
                PaymentMethod:                   fv.paymentMethod || null,
                PaymentDocument:                 fv.paymentDocument || null,
                PaymentProcessProfileCode:       null,
                PaymentProcessProfile:           null,
                // ── Document ─────────────────────────────────────────────
                DocumentCategory:                null,
                DocumentSequence:                null,
                // ── Address ──────────────────────────────────────────────
                AddressLine1:                    null,
                AddressLine2:                    null,
                AddressLine3:                    null,
                AddressLine4:                    null,
                City:                            null,
                County:                          null,
                Province:                        null,
                State:                           null,
                Country:                         'AE',
                Zip:                             null,
                // ── Stop / Void ──────────────────────────────────────────
                StopReason:                      null,
                StopReference:                   null,
                // ── Audit user ───────────────────────────────────────────
                CreatedBy:                       loginUser,
                LastUpdatedBy:                   loginUser,
                LastUpdateLogin:                 loginUser,
              },
            },
            ...(pendingInst.length > 0 ? [{
              step: 2,
              method: 'PUT',
              color: '#52c41a',
              url: `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/installments`,
              desc: `✅ PUT /ap/createinvoice/installments — Call once per pending installment (${pendingInst.length} call${pendingInst.length > 1 ? 's' : ''}). Sets PaymentStatus=Fully Paid and AmountRemaining=0.`,
              body: {
                '// call once per pending installment': '',
                InvoiceId:       invoiceId,
                InstallmentId:   pendingInst[0]?.key ?? '<INSTALLMENT_ID>',
                PaymentStatus:   'Fully Paid',
                AmountRemaining: 0,
                ...(pendingInst.length > 1 ? {
                  '// also call for': pendingInst.slice(1).map(i => ({
                    InstallmentId:   i.key,
                    DueDate:         i.dueDate,
                    UnpaidWas:       i.unpaidAmount,
                  })),
                } : {}),
              },
            }] : []),
            {
              step: relatedStep,
              method: 'POST',
              color: '#52c41a',
              url: `${APEX_DB_CONFIG.baseUrl}/ap/payments/related-invoices`,
              desc: '✅ POST /ap/payments/related-invoices — InvoicePaymentId:null auto-assigned. CheckId is filled automatically after Step 1 succeeds.',
              body: {
                InvoicePaymentId:            null,
                CheckId:                     step1CheckId !== null ? step1CheckId : '<checkId from Step 1 response>',
                InvoiceId:                   invoiceId,
                InvoiceBusinessUnit:         buName || null,
                InvoiceNumber:               form.getFieldValue('invoiceNumber') || null,
                InstallmentNumber:           invoiceInstallments.filter(i => i.unpaidAmount > 0)[0]?.key ? Number(invoiceInstallments.filter(i => i.unpaidAmount > 0)[0].key) : null,
                AmountPaidPaymentCurrency:   balance,
                AmountPaidInvoiceCurrency:   balance,
                InvoicePaymentAmount:        balance,
                InvoiceAmount:               balance,
                InvoiceBaseAmount:           balance,
                PaymentBaseAmount:           balance,
                DiscountLost:                null,
                DiscountTaken:               null,
                InvoiceCurrency:             currency,
                CrossCurrencyRate:           headerValues.conversionRate || null,
                InvoicePaymentStatus:        'Negotiable',
                CreatedBy:                   null,
                LastUpdatedBy:               null,
                LastUpdateLogin:             null,
              },
            },
          ];

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Alert
                type="info"
                showIcon
                message="Execute steps in order: 1 → 2 → 3"
                description="Click Execute on each step. Step 1 response checkId is captured automatically and injected into the last step. Step 3 Execute button is locked until Step 1 succeeds."
                style={{ fontSize: 12 }}
              />
              {apis.map(api => {
                const result    = stepResults[api.step];
                const isLoading = stepLoading[api.step] ?? false;
                const isRelated = api.step === relatedStep;
                const locked    = isRelated && step1CheckId === null;
                return (
                  <div key={api.step} style={{ border: `1px solid ${result ? (result.status === 'success' ? '#b7eb8f' : '#ffa39e') : REDWOOD.neutral200}`, borderRadius: 8, overflow: 'hidden' }}>
                    {/* Header row */}
                    <div style={{ padding: '8px 12px', background: REDWOOD.neutral100, borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Space size={4} wrap>
                        <Text strong style={{ color: REDWOOD.neutral600, fontSize: 12 }}>Step {api.step}</Text>
                        <span style={{ ...labelStyle, background: api.color, color: '#fff' }}>{api.method}</span>
                        <Text style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{api.url}</Text>
                      </Space>
                      <Tooltip title={locked ? 'Execute Step 1 first to capture CheckId' : ''}>
                        <Button
                          type="primary"
                          size="small"
                          icon={<PlayCircleOutlined />}
                          loading={isLoading}
                          disabled={locked}
                          style={{ flexShrink: 0 }}
                          onClick={() => executePayStep(api.step, api.method, api.url, api.body)}
                        >
                          Execute
                        </Button>
                      </Tooltip>
                    </div>
                    {/* Description */}
                    <div style={{ padding: '6px 12px 4px' }}>
                      <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{api.desc}</Text>
                    </div>
                    {/* Request body */}
                    <div style={{ padding: '0 12px 10px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral400, marginBottom: 2 }}>REQUEST BODY</div>
                      <pre style={blockStyle}>{JSON.stringify(api.body, null, 2)}</pre>
                    </div>
                    {/* Response result */}
                    {result && (
                      <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${REDWOOD.neutral200}` }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: result.status === 'success' ? '#52c41a' : '#ff4d4f', margin: '8px 0 2px' }}>
                          {result.status === 'success' ? '✅ RESPONSE' : '❌ ERROR'}
                        </div>
                        <pre style={{ ...blockStyle, border: `1px solid ${result.status === 'success' ? '#52c41a33' : '#ff4d4f33'}` }}>
                          {JSON.stringify(result.data, null, 2)}
                        </pre>
                        {result.status === 'success' && api.step === 1 && step1CheckId !== null && (
                          <div style={{ marginTop: 6, padding: '4px 10px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, fontSize: 11 }}>
                            CheckId <strong>{step1CheckId}</strong> captured — Step {relatedStep} body updated automatically.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Drawer>
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {/* ─── Void Payment Modal (from invoice edit) ─────────────────────── */}
      <Modal
        title={
          <Space>
            <StopOutlined style={{ color: '#cf1322' }} />
            <span>Void Payment</span>
            {ciVoidPaymentInfo && (
              <Tag color="red" style={{ marginLeft: 4 }}>{ciVoidPaymentInfo.number}</Tag>
            )}
          </Space>
        }
        open={ciVoidOpen}
        onCancel={() => { setCiVoidOpen(false); ciVoidForm.resetFields(); setCiVoidStepStatus([]); }}
        footer={null}
        width={620}
        destroyOnClose
      >
        <Spin spinning={ciVoidEligLoading} tip="Checking eligibility...">
          {/* Eligibility Banner */}
          {ciVoidEligibility && !ciVoidEligLoading && (
            <Alert
              type={ciVoidEligibility.eligible ? 'success' : 'error'}
              showIcon
              message={ciVoidEligibility.eligible ? 'Payment is eligible for void' : 'Payment cannot be voided'}
              description={
                !ciVoidEligibility.eligible && (ciVoidEligibility.errors?.length ?? 0) > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {ciVoidEligibility.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                ) : null
              }
              style={{ marginBottom: 16 }}
            />
          )}

          <Form form={ciVoidForm} layout="vertical" onFinish={handleCiVoidSubmit} size="small">
            {/* Row 1: Payment Number | Void Date */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Payment Number">
                  <Input value={ciVoidPaymentInfo?.number ?? ''} readOnly style={{ background: '#f5f5f5', color: '#555' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label={<><span style={{ color: '#C74634' }}>*</span> Void Date</>}
                  name="voidDate"
                  rules={[{ required: true, message: 'Required' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
                </Form.Item>
              </Col>
            </Row>

            {/* Row 2: Payment Date | Payment Amount */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Payment Date">
                  <Input value={ciVoidPaymentInfo?.paymentDate ?? ''} readOnly style={{ background: '#f5f5f5', color: '#555' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Payment Amount">
                  <Input
                    value={ciVoidPaymentInfo ? `${new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ciVoidPaymentInfo.paidAmount)} ${ciVoidPaymentInfo.currency}` : ''}
                    readOnly
                    style={{ background: '#f5f5f5', color: '#555', fontWeight: 500 }}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* Void Reason */}
            <Form.Item label="Void Reason" name="voidReason">
              <Input placeholder="Enter void reason (optional)" />
            </Form.Item>

            {/* Step Status Panel */}
            {ciVoidStepStatus.length > 0 && (
              <div style={{ marginBottom: 16, background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 14px' }}>
                {ciVoidStepStatus.map(s => {
                  const icon =
                    s.status === 'running' ? <LoadingOutlined style={{ color: '#0572CE' }} spin /> :
                    s.status === 'success' ? <CheckCircleOutlined style={{ color: '#1D7B4D' }} /> :
                    s.status === 'error'   ? <CloseCircleOutlined style={{ color: '#D93025' }} /> :
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: '#d9d9d9', verticalAlign: 'middle' }} />;
                  const textColor =
                    s.status === 'success' ? '#1D7B4D' :
                    s.status === 'error'   ? '#D93025' :
                    s.status === 'running' ? '#0572CE' : '#6B6B6B';
                  return (
                    <div key={s.step} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ marginTop: 2 }}>{icon}</span>
                      <div>
                        <Text style={{ fontSize: 12, color: textColor }}>
                          <strong>Step {s.step}:</strong> {s.label}
                        </Text>
                        {s.detail && <div><Text type="secondary" style={{ fontSize: 11 }}>{s.detail}</Text></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button onClick={() => { setCiVoidOpen(false); ciVoidForm.resetFields(); setCiVoidStepStatus([]); }}>
                Cancel
              </Button>
              <Button
                type="primary"
                danger
                htmlType="submit"
                loading={ciVoidSubmitting}
                disabled={!ciVoidEligibility?.eligible || ciVoidEligLoading}
                icon={<StopOutlined />}
              >
                Void Payment
              </Button>
            </div>
          </Form>
        </Spin>
      </Modal>
      {/* ── Installment Editor Modal ──────────────────────────────────────── */}
      {(() => {
        const invoiceAmt  = headerValues.invoiceAmount || 0;
        const grossTotal  = instEditRows.reduce((s, r) => s + (r.grossAmount  || 0), 0);
        const unpaidTotal = instEditRows.reduce((s, r) => s + (r.unpaidAmount || 0), 0);
        const isBalanced  = Math.abs(grossTotal - invoiceAmt) <= 0.01;
        const selectedRow = instEditRows.find(r => r.key === instSelectedKey) ?? null;

        const updateRow = (key: string, patch: Partial<InstallmentRow>) =>
          setInstEditRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));

        const addRow = () => {
          const used      = instEditRows.reduce((s, r) => s + (r.grossAmount || 0), 0);
          const remaining = parseFloat(Math.max(0, invoiceAmt - used).toFixed(2));
          const lastDue   = instEditRows[instEditRows.length - 1]?.dueDate;
          const lastPM    = instEditRows[instEditRows.length - 1]?.paymentMethod || '';
          const newRow: InstallmentRow = {
            key:               Date.now().toString(),
            installmentNumber: instEditRows.length + 1,
            dueDate:           lastDue ? lastDue.add(30, 'day') : null,
            grossAmount:       remaining,
            unpaidAmount:      remaining,
            paymentPriority:   99,
            paymentMethod:     lastPM,
            bankAccount:       '',
          };
          setInstEditRows(prev => [...prev, newRow]);
          setInstSelectedKey(newRow.key);
        };

        const deleteRow = (key: string) => {
          setInstEditRows(prev =>
            prev.filter(r => r.key !== key).map((r, i) => ({ ...r, installmentNumber: i + 1 }))
          );
          setInstSelectedKey(null);
        };

        const splitInstallment = () => {
          if (!selectedRow) { message.info('Select an installment row to split'); return; }
          const half1 = parseFloat((selectedRow.grossAmount / 2).toFixed(2));
          const half2 = parseFloat((selectedRow.grossAmount - half1).toFixed(2));
          const newKey = Date.now().toString();
          setInstEditRows(prev => {
            const idx = prev.findIndex(r => r.key === selectedRow.key);
            const updated = [...prev];
            updated[idx] = { ...selectedRow, grossAmount: half1, unpaidAmount: half1 };
            updated.splice(idx + 1, 0, {
              ...selectedRow,
              key:               newKey,
              installmentId:     null,   // new row — no DB record yet
              grossAmount:       half2,
              unpaidAmount:      half2,
              dueDate:           selectedRow.dueDate ? selectedRow.dueDate.add(30, 'day') : null,
            });
            return updated.map((r, i) => ({ ...r, installmentNumber: i + 1 }));
          });
          setInstSelectedKey(newKey);
        };

        return (
          <Modal
            title={
              <Space>
                <ScheduleOutlined style={{ color: REDWOOD.primary }} />
                <span style={{ fontWeight: 600 }}>Payment Installments</span>
                <Tag color="blue" style={{ fontWeight: 500 }}>{headerValues.invoiceCurrency || 'AED'}</Tag>
                <Tag color={isBalanced ? 'green' : 'red'} style={{ fontWeight: 500 }}>
                  {isBalanced ? 'Balanced' : `Diff: ${(grossTotal - invoiceAmt).toFixed(2)}`}
                </Tag>
              </Space>
            }
            open={instEditVisible}
            onCancel={() => {
              if (!isBalanced) {
                message.error(`Installments total (${grossTotal.toFixed(2)}) must equal invoice amount (${invoiceAmt.toFixed(2)}) before closing.`);
                return;
              }
              setInstEditVisible(false);
            }}
            width={960}
            destroyOnClose
            footer={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Invoice Amount: <strong>{invoiceAmt.toFixed(2)}</strong>
                  {'  ·  '}
                  Gross Total: <strong style={{ color: isBalanced ? REDWOOD.success : REDWOOD.error }}>{grossTotal.toFixed(2)}</strong>
                  {!isBalanced && (
                    <Text type="danger" style={{ marginLeft: 8, fontSize: 11 }}>
                      ⚠ Installments must balance with invoice amount before closing
                    </Text>
                  )}
                </Text>
                <Button
                  type="primary"
                  disabled={!isBalanced}
                  onClick={() => setInstEditVisible(false)}
                  style={{ background: isBalanced ? REDWOOD.primary : undefined, borderColor: isBalanced ? REDWOOD.primary : undefined }}
                >
                  Done
                </Button>
              </div>
            }
          >
            {/* ── Oracle-style toolbar ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`,
              borderRadius: '6px 6px 0 0', padding: '6px 10px', flexWrap: 'wrap',
            }}>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={addRow}
                style={{ fontSize: 12 }}
              >
                Add Row
              </Button>
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
                disabled={!instSelectedKey || instEditRows.length === 1}
                onClick={() => instSelectedKey && deleteRow(instSelectedKey)}
                style={{ fontSize: 12 }}
              >
                Delete
              </Button>
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <Button
                size="small"
                icon={<LockOutlined />}
                disabled={!instSelectedKey}
                style={{ fontSize: 12, borderColor: REDWOOD.warning, color: REDWOOD.warning }}
              >
                Place Hold
              </Button>
              <Button
                size="small"
                icon={<UnlockOutlined />}
                disabled={!instSelectedKey}
                style={{ fontSize: 12, borderColor: REDWOOD.success, color: REDWOOD.success }}
              >
                Release Hold
              </Button>
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <Button
                size="small"
                icon={<AppstoreOutlined />}
                disabled={!instSelectedKey}
                onClick={splitInstallment}
                style={{ fontSize: 12 }}
              >
                Split Installment
              </Button>
            </div>

            {/* ── Installment table ── */}
            <Table<InstallmentRow>
              size="small"
              dataSource={instEditRows}
              rowKey="key"
              pagination={false}
              bordered
              rowSelection={{
                type: 'radio',
                selectedRowKeys: instSelectedKey ? [instSelectedKey] : [],
                onChange: (keys) => setInstSelectedKey(keys[0] as string ?? null),
              }}
              onRow={(row) => ({
                onClick: () => setInstSelectedKey(row.key),
                style: {
                  cursor: 'pointer',
                  background: row.key === instSelectedKey ? '#e6f4ff' : undefined,
                },
              })}
              style={{ borderRadius: 0 }}
              columns={[
                {
                  title: 'Installment',
                  dataIndex: 'installmentNumber',
                  width: 80,
                  align: 'center',
                  render: (_v, _r, idx) => (
                    <Text style={{ fontSize: 12, fontWeight: 600 }}>{idx + 1}</Text>
                  ),
                },
                {
                  title: 'Due Date',
                  dataIndex: 'dueDate',
                  width: 148,
                  render: (_v, row) => (
                    <DatePicker
                      size="small"
                      value={row.dueDate}
                      format="D-MMM-YYYY"
                      style={{ width: '100%' }}
                      onChange={(d) => updateRow(row.key, { dueDate: d })}
                    />
                  ),
                },
                {
                  title: 'Gross Amount',
                  dataIndex: 'grossAmount',
                  width: 130,
                  align: 'right',
                  render: (_v, row) => (
                    <InputNumber
                      size="small"
                      value={row.grossAmount}
                      min={0}
                      precision={2}
                      style={{ width: '100%' }}
                      formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={v => Number(v?.replace(/,/g, '') || 0)}
                      onChange={(val) => {
                        const amt = val ?? 0;
                        updateRow(row.key, { grossAmount: amt, unpaidAmount: amt });
                      }}
                    />
                  ),
                },
                {
                  title: 'Unpaid Amount',
                  dataIndex: 'unpaidAmount',
                  width: 120,
                  align: 'right',
                  render: (_v, row) => (
                    <Text style={{ fontSize: 12, paddingRight: 4 }}>
                      {row.unpaidAmount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  ),
                },
                {
                  title: 'Payment Priority',
                  dataIndex: 'paymentPriority',
                  width: 110,
                  align: 'center',
                  render: (_v, row) => (
                    <InputNumber
                      size="small"
                      value={row.paymentPriority}
                      min={1}
                      max={999}
                      style={{ width: '100%' }}
                      onChange={(val) => updateRow(row.key, { paymentPriority: val ?? 99 })}
                    />
                  ),
                },
                {
                  title: 'Payment Method',
                  dataIndex: 'paymentMethod',
                  width: 130,
                  render: (_v, row) => (
                    <Select
                      size="small"
                      value={row.paymentMethod || undefined}
                      style={{ width: '100%' }}
                      placeholder="Select"
                      allowClear
                      onChange={(val) => updateRow(row.key, { paymentMethod: val ?? '' })}
                    >
                      <Option value="Check">Check</Option>
                      <Option value="Electronic">Electronic</Option>
                      <Option value="Wire">Wire</Option>
                      <Option value="EFT">EFT</Option>
                    </Select>
                  ),
                },
                {
                  title: 'Bank Account',
                  dataIndex: 'bankAccount',
                  render: (_v, row) => (
                    <Select
                      size="small"
                      value={row.bankAccount || undefined}
                      style={{ width: '100%' }}
                      placeholder="Select"
                      allowClear
                      onChange={(val) => updateRow(row.key, { bankAccount: val ?? '' })}
                    >
                      {/* Bank accounts come from pay-in-full modal data when available */}
                      {payInFullBankAccounts.map(ba => (
                        <Option key={ba.bankAccountNumber} value={ba.bankAccountName}>
                          {ba.bankAccountName}
                        </Option>
                      ))}
                    </Select>
                  ),
                },
              ]}
              summary={() => (
                <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
                  <Table.Summary.Cell index={0} colSpan={2} align="right">
                    <Text strong style={{ fontSize: 12 }}>Totals</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong style={{ color: isBalanced ? REDWOOD.success : REDWOOD.error, fontSize: 12 }}>
                      {grossTotal.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <Text strong style={{ fontSize: 12 }}>
                      {unpaidTotal.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} colSpan={3} />
                </Table.Summary.Row>
              )}
            />
            {!isBalanced && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8, borderRadius: 4 }}
                message={`Gross total (${grossTotal.toFixed(2)}) does not match invoice amount (${invoiceAmt.toFixed(2)}). Difference: ${(grossTotal - invoiceAmt).toFixed(2)}`}
              />
            )}
          </Modal>
        );
      })()}
      {/* ─────────────────────────────────────────────────────────────────── */}

      {/* ── Apply or Unapply Prepayments Modal ─────────────────────────── */}
      <Modal
        title={
          <Space>
            <DollarOutlined style={{ color: REDWOOD.success }} />
            <span>Apply or Unapply Prepayments</span>
          </Space>
        }
        open={prepaymentModalVisible}
        onCancel={() => setPrepaymentModalVisible(false)}
        footer={<Button onClick={() => setPrepaymentModalVisible(false)}>Done</Button>}
        width={1000}
        styles={{ body: { padding: '16px 24px', maxHeight: '75vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        {prepaymentLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
            <div style={{ marginTop: 12, color: REDWOOD.neutral600 }}>Loading prepayments...</div>
          </div>
        ) : (
          <>
            {/* ── Available Section ─────────────────────────────────── */}
            <Title level={5} style={{ marginBottom: 8, color: REDWOOD.neutral900 }}>Available</Title>
            <div style={{ marginBottom: 4 }}>
              <Space>
                <Button
                  size="small"
                  type="primary"
                  disabled={selectedAvailKeys.length === 0 || prepaymentApplying}
                  loading={prepaymentApplying}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                  onClick={async () => {
                    const invoiceId = savedInvoiceId || initialData?.invoiceId;
                    if (!invoiceId) {
                      message.warning('Save the invoice first before applying a prepayment.');
                      return;
                    }
                    const selected = availablePrepayments.filter(r => selectedAvailKeys.includes(r.key));
                    // Validate
                    for (const row of selected) {
                      if (!row.toApply || row.toApply <= 0) {
                        message.warning(`Enter a "To Apply" amount for prepayment ${row.invoiceNumber}.`);
                        return;
                      }
                      if (row.toApply > row.availableAmount) {
                        message.warning(`Amount to apply (${row.toApply}) exceeds available balance (${row.availableAmount}) for ${row.invoiceNumber}.`);
                        return;
                      }
                      if (!row.accountingDate) {
                        message.warning(`Enter an accounting date for prepayment ${row.invoiceNumber}.`);
                        return;
                      }
                    }
                    setPrepaymentApplying(true);
                    try {
                      const invoiceNumber = form.getFieldValue('invoiceNumber');
                      const businessUnit = form.getFieldValue('businessUnit') || selected[0]?.businessUnit || '';
                      const supplierSite = (() => {
                        const siteId = form.getFieldValue('supplierSite');
                        const site = supplierSites.find(s => s.siteId === siteId);
                        return site?.siteName || siteId || '';
                      })();
                      let successCount = 0;
                      for (const row of selected) {
                        const body = {
                          InvoiceId: invoiceId,
                          InvoiceNumber: invoiceNumber,
                          PrepaymentInvoiceId: row.invoiceId,
                          PrepaymentNumber: row.invoiceNumber,
                          LineNumber: 1,
                          PrepaymentLineNumber: row.prepaymentLineNumber,
                          Description: row.description || null,
                          BusinessUnit: businessUnit,
                          SupplierSite: supplierSite,
                          PurchaseOrder: row.purchaseOrder || null,
                          Currency: row.currency,
                          AppliedAmount: row.toApply,
                          IncludedTax: null,
                          IncludedonInvoiceFlag: false,
                          ApplicationAccountingDate: row.accountingDate!.format('YYYY-MM-DD'),
                          Status: 'Applied',
                        };
                        const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments`;
                        const res = await fetch(url, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                          body: JSON.stringify(body),
                        });
                        if (!res.ok) {
                          const errText = await res.text();
                          throw new Error(`HTTP ${res.status}: ${errText}`);
                        }
                        successCount++;
                      }
                      message.success(`${successCount} prepayment(s) applied successfully.`);
                      // Small delay to allow the DB to commit before re-fetching
                      await new Promise(r => setTimeout(r, 600));
                      // Refresh applied list and available list
                      const [avail, applied] = await Promise.all([
                        fetchAvailablePrepayments(Number(form.getFieldValue('supplierId'))),
                        fetchAppliedPrepayments(invoiceId),
                      ]);
                      const invoiceAmt = form.getFieldValue('invoiceAmount') || 0;
                      setAvailablePrepayments(avail.map(r => ({
                        ...r,
                        toApply: invoiceAmt > 0 ? Math.min(r.availableAmount, invoiceAmt) : 0,
                      })));
                      setAppliedPrepaymentsList(applied);
                      loadAppSlaStatuses(applied);
                      setSupplierHasPrepayments(avail.length > 0);
                      setSelectedAvailKeys([]);
                      fetchInvoiceBalance(invoiceId);
                    } catch (err: any) {
                      message.error(`Failed to apply prepayment: ${err.message}`);
                    } finally {
                      setPrepaymentApplying(false);
                    }
                  }}
                >
                  Apply
                </Button>
                <Popover
                  trigger="click"
                  placement="rightTop"
                  title={
                    <Space>
                      <ApiOutlined style={{ color: REDWOOD.info }} />
                      <span style={{ fontSize: 13 }}>Prepayment — API Endpoints</span>
                    </Space>
                  }
                  content={
                    <div style={{ width: 500, maxHeight: 480, overflowY: 'auto' }}>
                      {/* GET Available */}
                      <Text type="secondary" style={{ fontSize: 11 }}>GET — Available Prepayments</Text>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="green" style={{ fontFamily: 'monospace', fontSize: 12 }}>GET</Tag>
                        <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {APEX_DB_CONFIG.baseUrl}/ap/prepayments/available?P_SUPPLIER_ID={selectedSupplierInfo?.id ?? initialData?.supplierId ?? form.getFieldValue('supplierId') ?? '<supplier_id>'}
                        </Text>
                      </div>
                      {/* GET Applied */}
                      <Text type="secondary" style={{ fontSize: 11 }}>GET — Applied Prepayments</Text>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="green" style={{ fontFamily: 'monospace', fontSize: 12 }}>GET</Tag>
                        <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments?P_INVOICE_ID={savedInvoiceId ?? initialData?.invoiceId ?? '<invoice_id>'}
                        </Text>
                      </div>
                      <Divider style={{ margin: '8px 0' }} />
                      {/* POST Apply */}
                      <Text type="secondary" style={{ fontSize: 11 }}>POST — Apply Prepayment</Text>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 12 }}>POST</Tag>
                        <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments
                        </Text>
                      </div>
                      <Divider style={{ margin: '8px 0' }} />
                      <Text type="secondary" style={{ fontSize: 11 }}>SAMPLE REQUEST BODY (first selected row)</Text>
                      <pre style={{
                        background: '#f5f5f5', border: '1px solid #e0e0e0',
                        borderRadius: 4, padding: '8px 10px', fontSize: 11,
                        marginTop: 6, overflowX: 'auto',
                      }}>
                        {(() => {
                          const invoiceId = savedInvoiceId || initialData?.invoiceId;
                          const invoiceNumber = form.getFieldValue('invoiceNumber');
                          const businessUnit = form.getFieldValue('businessUnit') || '';
                          const siteId = form.getFieldValue('supplierSite');
                          const site = supplierSites.find(s => s.siteId === siteId);
                          const supplierSite = site?.siteName || siteId || '';
                          const row = availablePrepayments.find(r => selectedAvailKeys.includes(r.key))
                            || availablePrepayments[0];
                          if (!row) return '// No prepayment selected';
                          return JSON.stringify({
                            InvoiceId: invoiceId ?? '<save invoice first>',
                            InvoiceNumber: invoiceNumber,
                            PrepaymentInvoiceId: row.invoiceId,
                            PrepaymentNumber: row.invoiceNumber,
                            LineNumber: 1,
                            PrepaymentLineNumber: row.prepaymentLineNumber,
                            Description: row.description || null,
                            BusinessUnit: businessUnit,
                            SupplierSite: supplierSite,
                            PurchaseOrder: row.purchaseOrder || null,
                            Currency: row.currency,
                            AppliedAmount: row.toApply,
                            IncludedTax: null,
                            IncludedonInvoiceFlag: false,
                            ApplicationAccountingDate: row.accountingDate?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD'),
                            Status: 'Applied',
                          }, null, 2);
                        })()}
                      </pre>
                    </div>
                  }
                >
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    title="View API endpoint"
                    style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                  />
                </Popover>
              </Space>
            </div>
            <Table<AvailablePrepayment>
              dataSource={availablePrepayments}
              size="small"
              pagination={false}
              rowSelection={{
                selectedRowKeys: selectedAvailKeys,
                onChange: setSelectedAvailKeys,
              }}
              summary={rows => {
                const total = rows.reduce((s, r) => s + r.availableAmount, 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={6} align="right">
                      <Text strong style={{ fontSize: 12 }}>{formatAmount(total)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} colSpan={3} />
                  </Table.Summary.Row>
                );
              }}
              columns={[
                {
                  title: 'Number',
                  dataIndex: 'invoiceNumber',
                  width: 140,
                  render: (v: string) => (
                    <Text style={{ color: REDWOOD.info, fontSize: 12 }}>
                      {v.length > 12 ? v.slice(0, 12) + ' ...' : v}
                    </Text>
                  ),
                },
                { title: 'Description', dataIndex: 'description', width: 160, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Site', dataIndex: 'supplierSite', width: 90, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Purchase Order', dataIndex: 'purchaseOrder', width: 110, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Currency', dataIndex: 'currency', width: 80, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                {
                  title: 'Available',
                  dataIndex: 'availableAmount',
                  width: 100,
                  align: 'right' as const,
                  render: (v: number) => <Text strong style={{ fontSize: 12 }}>{formatAmount(v)}</Text>,
                },
                {
                  title: <span><span style={{ color: REDWOOD.error }}>* </span>To Apply</span>,
                  dataIndex: 'toApply',
                  width: 110,
                  render: (_: any, record: AvailablePrepayment) => (
                    <InputNumber
                      size="small"
                      min={0}
                      max={record.availableAmount}
                      precision={2}
                      value={record.toApply}
                      style={{ width: '100%' }}
                      onChange={val => {
                        setAvailablePrepayments(prev =>
                          prev.map(r => r.key === record.key ? { ...r, toApply: val ?? 0 } : r)
                        );
                      }}
                    />
                  ),
                },
                {
                  title: <span><span style={{ color: REDWOOD.error }}>* </span>Accounting Date</span>,
                  dataIndex: 'accountingDate',
                  width: 140,
                  render: (_: any, record: AvailablePrepayment) => (
                    <DatePicker
                      size="small"
                      format="D-MMM-YYYY"
                      value={record.accountingDate}
                      style={{ width: '100%' }}
                      onChange={date => {
                        setAvailablePrepayments(prev =>
                          prev.map(r => r.key === record.key ? { ...r, accountingDate: date } : r)
                        );
                      }}
                    />
                  ),
                },
              ]}
              locale={{ emptyText: 'No available prepayments for this supplier.' }}
              style={{ marginBottom: 24 }}
            />

            {/* ── Applied Section ───────────────────────────────────── */}
            <Title level={5} style={{ marginBottom: 8, color: REDWOOD.neutral900 }}>Applied</Title>
            <Table<AppliedPrepayment>
              dataSource={appliedPrepaymentsList}
              size="small"
              pagination={false}
              summary={rows => {
                const total = rows.reduce((s, r) => s + r.appliedAmount, 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={6} align="right">
                      <Text strong style={{ fontSize: 12 }}>{formatAmount(total)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} colSpan={1} />
                  </Table.Summary.Row>
                );
              }}
              columns={[
                {
                  title: 'Number',
                  dataIndex: 'prepaymentNumber',
                  width: 140,
                  render: (v: string) => (
                    <Text style={{ color: REDWOOD.info, fontSize: 12 }}>
                      {v.length > 12 ? v.slice(0, 12) + ' ...' : v}
                    </Text>
                  ),
                },
                { title: 'Description', dataIndex: 'description', width: 160, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Site', dataIndex: 'supplierSite', width: 90, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Purchase Order', dataIndex: 'purchaseOrder', width: 110, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                { title: 'Currency', dataIndex: 'currency', width: 80, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                {
                  title: 'Applied',
                  dataIndex: 'appliedAmount',
                  width: 100,
                  align: 'right' as const,
                  render: (v: number) => <Text strong style={{ fontSize: 12 }}>{formatAmount(v)}</Text>,
                },
                {
                  title: <span><span style={{ color: REDWOOD.error }}>* </span>Application Accounting Date</span>,
                  dataIndex: 'applicationAccountingDate',
                  width: 160,
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YYYY') : ''}</Text>,
                },
                {
                  title: 'Action',
                  width: 90,
                  align: 'center' as const,
                  render: (_: any, record: AppliedPrepayment) => (
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        setUnapplyRecord(record);
                        setUnapplyDate(dayjs());
                        setUnapplyModalVisible(true);
                      }}
                    >
                      Un-Apply
                    </Button>
                  ),
                },
              ]}
              locale={{ emptyText: 'No prepayments applied to this invoice yet.' }}
            />
          </>
        )}
      </Modal>
      {/* ── End Prepayments Modal ────────────────────────────────────────── */}

      {/* ── Un-Apply Prepayment Modal ─────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <RollbackOutlined style={{ color: REDWOOD.error }} />
            <span>Un-Apply Prepayment</span>
          </Space>
        }
        open={unapplyModalVisible}
        onCancel={() => { if (!unapplyLoading) setUnapplyModalVisible(false); }}
        destroyOnClose
        footer={
          <Space>
            <Button disabled={unapplyLoading} onClick={() => setUnapplyModalVisible(false)}>Cancel</Button>
            <Button
              danger
              type="primary"
              loading={unapplyLoading}
              icon={<RollbackOutlined />}
              onClick={async () => {
                if (!unapplyRecord) return;
                const invoiceId = savedInvoiceId || initialData?.invoiceId;
                if (!invoiceId) { message.warning('Invoice ID not found.'); return; }
                setUnapplyLoading(true);
                try {
                  const invoiceNumber = form.getFieldValue('invoiceNumber');
                  const businessUnit = form.getFieldValue('businessUnit') || unapplyRecord.supplierSite || '';
                  const body = {
                    InvoiceId: invoiceId,
                    InvoiceNumber: invoiceNumber,
                    PrepaymentInvoiceId: unapplyRecord.prepaymentInvoiceId,
                    PrepaymentNumber: unapplyRecord.prepaymentNumber,
                    LineNumber: unapplyRecord.lineNumber,
                    PrepaymentLineNumber: unapplyRecord.prepaymentLineNumber,
                    Description: unapplyRecord.description || null,
                    BusinessUnit: businessUnit,
                    SupplierSite: unapplyRecord.supplierSite,
                    PurchaseOrder: unapplyRecord.purchaseOrder || null,
                    Currency: unapplyRecord.currency,
                    AppliedAmount: -(unapplyRecord.appliedAmount),
                    IncludedTax: null,
                    IncludedonInvoiceFlag: false,
                    ApplicationAccountingDate: unapplyDate.format('YYYY-MM-DD'),
                    Status: 'Unapplied',
                  };
                  const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/appliedprepayments`;
                  const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(body),
                  });
                  if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errText}`);
                  }
                  message.success(`Prepayment ${unapplyRecord.prepaymentNumber} un-applied successfully.`);
                  setUnapplyModalVisible(false);
                  // Refresh both lists and balance
                  await new Promise(r => setTimeout(r, 600));
                  const supplierId = form.getFieldValue('supplierId');
                  const remainingBalance = invoiceBalance ?? form.getFieldValue('invoiceAmount') ?? 0;
                  const [avail, applied] = await Promise.all([
                    fetchAvailablePrepayments(Number(supplierId)),
                    fetchAppliedPrepayments(invoiceId),
                  ]);
                  setAvailablePrepayments(avail.map(r => ({
                    ...r,
                    toApply: remainingBalance > 0 ? Math.min(r.availableAmount, remainingBalance) : 0,
                  })));
                  setAppliedPrepaymentsList(applied);
                  loadAppSlaStatuses(applied);
                  setSupplierHasPrepayments(avail.length > 0);
                  fetchInvoiceBalance(invoiceId);
                } catch (err: any) {
                  message.error(`Failed to un-apply prepayment: ${err.message}`);
                } finally {
                  setUnapplyLoading(false);
                }
              }}
            >
              Un-Apply
            </Button>
          </Space>
        }
        width={440}
      >
        {unapplyRecord && (
          <Descriptions column={1} size="small" bordered style={{ marginTop: 8 }}>
            <Descriptions.Item label="Prepayment Number">
              <Text strong style={{ color: REDWOOD.info }}>{unapplyRecord.prepaymentNumber}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Description">
              {unapplyRecord.description || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Currency">
              {unapplyRecord.currency}
            </Descriptions.Item>
            <Descriptions.Item label="Un-Applied Amount">
              <Text strong style={{ color: REDWOOD.error }}>
                ({formatAmount(unapplyRecord.appliedAmount)})
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Original Applied Date">
              {unapplyRecord.applicationAccountingDate
                ? dayjs(unapplyRecord.applicationAccountingDate).format('D-MMM-YYYY')
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={<span><span style={{ color: REDWOOD.error }}>* </span>Un-Apply Date</span>}>
              <DatePicker
                format="D-MMM-YYYY"
                value={unapplyDate}
                onChange={d => d && setUnapplyDate(d)}
                style={{ width: '100%' }}
                allowClear={false}
              />
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
      {/* ── End Un-Apply Modal ───────────────────────────────────────────── */}

      {/* ── SLA Accounting Lines Viewer Modal ────────────────────────────── */}
      <Modal
        title={
          <Space>
            <AccountBookOutlined style={{ color: slaStatus === 'POSTED' ? REDWOOD.success : REDWOOD.warning }} />
            <span>Subledger Accounting</span>
            <Tag color={slaStatus === 'POSTED' ? 'green' : slaStatus === 'ERROR' ? 'red' : 'orange'} style={{ fontSize: 11 }}>
              {slaStatus}
            </Tag>
            <Tooltip
              title={
                <div style={{ fontSize: 11, fontFamily: 'monospace', lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>API Endpoints</div>

                  <div style={{ marginBottom: 4 }}>
                    <Tag color="blue" style={{ fontSize: 10 }}>GET</Tag>
                    <span style={{ wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=${savedInvoiceId || initialData?.invoiceId}&eventType=AP_INVOICE_CREATION`}
                    </span>
                  </div>

                  <div style={{ marginBottom: 4 }}>
                    <Tag color="blue" style={{ fontSize: 10 }}>GET</Tag>
                    <span style={{ wordBreak: 'break-all' }}>
                      {`${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${slaHeaderId ?? '<headerId>'}&limit=500`}
                    </span>
                  </div>

                  <div style={{ marginBottom: 4 }}>
                    <Tag color="orange" style={{ fontSize: 10 }}>POST</Tag>
                    <span>{`${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`}</span>
                  </div>
                  <pre style={{ fontSize: 10, background: '#1a1a1a', color: '#e6e6e6', borderRadius: 4, padding: '4px 8px', margin: '2px 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{
`{ "header": { "moduleName":"AP", "sourceTable":"AP_INVOICES",
  "sourceId":<invoiceId>, "sourceNumber":"<invoiceNumber>",
  "sourceType":"STANDARD", "eventTypeCode":"AP_INVOICE_CREATION",
  "accountingDate":"YYYY-MM-DD", "periodName":"Mon-YY",
  "currencyCode":"<currency>", "businessUnit":"<bu>" },
  "lines": [{ "lineType":"DR","accountingClass":"EXPENSE",
  "accountCombination":"<acct>","enteredDr":<amount> }, ...] }`
                  }</pre>

                  <div style={{ marginBottom: 4 }}>
                    <Tag color="orange" style={{ fontSize: 10 }}>POST</Tag>
                    <span>{`${APEX_DB_CONFIG.baseUrl}/journals/create`}</span>
                  </div>
                  <pre style={{ fontSize: 10, background: '#1a1a1a', color: '#e6e6e6', borderRadius: 4, padding: '4px 8px', margin: '2px 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{
`{ "batch": { "batchName":"AP-<num>-<ts>", "ledgerName":"BCL DIFC",
  "accountingPeriod":"Mon-YY", "batchSource":"Payables" },
  "header": { "jeCategory":"Purchase Invoices","jeSource":"Payables",
  "periodName":"Mon-YY","journalName":"AP Invoice <num>",
  "currencyCode":"<currency>","status":"NEW" },
  "lines": [{ "enteredDr":<dr>,"enteredCr":<cr>,
  "accountCombination":"<acct>","reference1":"<invoiceNum>" }, ...] }`
                  }</pre>

                  <div>
                    <Tag color="orange" style={{ fontSize: 10 }}>POST</Tag>
                    <span>{`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`}</span>
                  </div>
                  <pre style={{ fontSize: 10, background: '#1a1a1a', color: '#e6e6e6', borderRadius: 4, padding: '4px 8px', margin: '2px 0', whiteSpace: 'pre-wrap' }}>{
`{ "headerId":<headerId>, "postedBy":"user",
  "glBatchId":<batchId>, "glBatchName":"<name>",
  "glHeaderId":<headerId> }`
                  }</pre>
                </div>
              }
              overlayStyle={{ maxWidth: 620 }}
            >
              <ApiOutlined style={{ fontSize: 14, color: REDWOOD.info, cursor: 'pointer' }} />
            </Tooltip>
          </Space>
        }
        open={slaModalVisible}
        onCancel={() => setSlaModalVisible(false)}
        footer={
          <Space>
            {slaStatus === 'DRAFT' && (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={slaPosting}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                onClick={handlePostToLedger}
              >
                Post to Ledger
              </Button>
            )}
            {cancelSlaHeaderId && cancelSlaStatus !== 'POSTED' && (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={cancelSlaPosting}
                style={{ background: REDWOOD.error, borderColor: REDWOOD.error }}
                onClick={handlePostCancellationToLedger}
              >
                Post Cancellation to GL
              </Button>
            )}
            <Button onClick={() => setSlaModalVisible(false)}>Close</Button>
          </Space>
        }
        width={1100}
        destroyOnClose
      >
        <Spin spinning={slaFetching} tip="Loading accounting data...">
        {/* ── reusable column definition for SLA lines table ── */}
        {(() => {
          const slaLineColumns = [
            { title: '#', dataIndex: 'lineNumber', width: 45, render: (v: number) => <Text style={{ fontSize: 11 }}>{v}</Text> },
            { title: 'Type', dataIndex: 'lineType', width: 55, render: (v: string) => <Tag color={v === 'DR' ? 'blue' : 'red'} style={{ fontSize: 11, fontWeight: 700 }}>{v}</Tag> },
            { title: 'Class', dataIndex: 'accountingClass', width: 120, render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
            { title: 'Account Combination', dataIndex: 'accountCombination', width: 260, render: (v: string, r: any) => (
              <div>
                <Text code style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v || '—'}</Text>
                {r.accountDescription && <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{r.accountDescription}</div>}
              </div>
            ) },
            { title: 'Ent. Dr',  dataIndex: 'enteredDr',   width: 110, align: 'right' as const, render: (v: number) => v ? <Text strong style={{ fontSize: 11, color: REDWOOD.info }}>{formatAmount(v)}</Text>   : <Text style={{ fontSize: 11, color: REDWOOD.neutral400 }}>—</Text> },
            { title: 'Ent. Cr',  dataIndex: 'enteredCr',   width: 110, align: 'right' as const, render: (v: number) => v ? <Text strong style={{ fontSize: 11, color: REDWOOD.error }}>{formatAmount(v)}</Text>  : <Text style={{ fontSize: 11, color: REDWOOD.neutral400 }}>—</Text> },
            { title: 'Acc. Dr',  dataIndex: 'accountedDr', width: 110, align: 'right' as const, render: (v: number) => v ? <Text style={{ fontSize: 11, color: REDWOOD.info }}>{formatAmount(v)}</Text>          : <Text style={{ fontSize: 11, color: REDWOOD.neutral400 }}>—</Text> },
            { title: 'Acc. Cr',  dataIndex: 'accountedCr', width: 110, align: 'right' as const, render: (v: number) => v ? <Text style={{ fontSize: 11, color: REDWOOD.error }}>{formatAmount(v)}</Text>         : <Text style={{ fontSize: 11, color: REDWOOD.neutral400 }}>—</Text> },
            { title: 'Description', dataIndex: 'description', width: 180, ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
          ];

          const exportSlaToExcel = (headerLines: any[], label: string) => {
            const invoiceNum  = form.getFieldValue('invoiceNumber') || 'invoice';
            const supplier    = form.getFieldValue('supplier')       || '';
            const bu          = form.getFieldValue('businessUnit')   || '';
            const currency    = form.getFieldValue('invoiceCurrency') || '';
            const invoiceAmt  = form.getFieldValue('invoiceAmount')  || '';

            // Sheet 1 — Header info
            const headerRows = [
              ['Invoice Number', invoiceNum],
              ['Supplier',       supplier],
              ['Business Unit',  bu],
              ['Currency',       currency],
              ['Invoice Amount', invoiceAmt],
              ['SLA Header ID',  slaHeaderId ?? ''],
              ['Status',         slaStatus   ?? ''],
              ['GL Batch',       slaGlBatchName ?? ''],
              ['Exported',       new Date().toLocaleString()],
            ];

            // Sheet 2 — Journal lines
            const lineRows = [
              ['#', 'Type', 'Class', 'Account Combination', 'Entered Dr', 'Entered Cr', 'Accounted Dr', 'Accounted Cr', 'Description'],
              ...headerLines.map(l => [
                l.lineNumber, l.lineType, l.accountingClass,
                l.accountCombination || '',
                l.enteredDr   || 0, l.enteredCr   || 0,
                l.accountedDr || 0, l.accountedCr || 0,
                l.description || '',
              ]),
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(headerRows), 'Header');
            const ws2 = XLSX.utils.aoa_to_sheet(lineRows);
            ws2['!cols'] = [{ wch: 5 }, { wch: 6 }, { wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
            XLSX.utils.book_append_sheet(wb, ws2, 'Journal Lines');
            XLSX.writeFile(wb, `SLA_${invoiceNum}_${label}_${new Date().toISOString().slice(0, 10)}.xlsx`);
          };

          const renderLinesTable = (lines: any[], exportLabel: string = 'Invoice') => (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <Button
                  size="small"
                  icon={<FileExcelOutlined style={{ color: '#217346' }} />}
                  onClick={() => exportSlaToExcel(lines, exportLabel)}
                >
                  Export to Excel
                </Button>
              </div>
              <Table
                dataSource={lines.map((l, i) => ({ ...l, key: l.lineId || i }))}
                size="small" pagination={false} bordered scroll={{ x: 1060 }}
                summary={(data) => {
                  const totEntDr  = data.reduce((s, r) => s + (r.enteredDr   || 0), 0);
                  const totEntCr  = data.reduce((s, r) => s + (r.enteredCr   || 0), 0);
                  const totAccDr  = data.reduce((s, r) => s + (r.accountedDr || 0), 0);
                  const totAccCr  = data.reduce((s, r) => s + (r.accountedCr || 0), 0);
                  return (
                    <Table.Summary.Row style={{ background: '#f5f5f5', fontWeight: 700 }}>
                      <Table.Summary.Cell index={0} colSpan={4}>Total</Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: REDWOOD.info }}>{formatAmount(totEntDr)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: REDWOOD.error }}>{formatAmount(totEntCr)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="right"><Text style={{ color: REDWOOD.info }}>{formatAmount(totAccDr)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={7} align="right"><Text style={{ color: REDWOOD.error }}>{formatAmount(totAccCr)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
                columns={slaLineColumns}
              />
            </>
          );

          return (
            <Tabs
              activeKey={slaModalTab}
              onChange={handleSlaModalTabChange}
              type="card"
              items={[
                {
                  key: 'invoice',
                  label: (
                    <Space size={4}>
                      <FileTextOutlined />
                      <span>Invoice</span>
                      <Tag color={slaStatus === 'POSTED' ? 'green' : slaStatus === 'ERROR' ? 'red' : 'orange'} style={{ margin: 0, fontSize: 10 }}>{slaStatus}</Tag>
                    </Space>
                  ),
                  children: (
                    <>
                      {/* ── Original Invoice Accounting ── */}
                      <div style={{ marginBottom: cancelSlaLines.length > 0 ? 24 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Text strong style={{ fontSize: 13 }}>Invoice Accounting</Text>
                          <Tag color={slaStatus === 'POSTED' ? 'green' : slaStatus === 'ERROR' ? 'red' : 'orange'} style={{ fontSize: 11 }}>
                            {slaStatus === 'POSTED' ? 'POSTED' : slaStatus === 'DRAFT' ? 'DRAFT' : slaStatus ?? 'Unknown'}
                          </Tag>
                          <Text type="secondary" style={{ fontSize: 11 }}>Header ID: {slaHeaderId}</Text>
                          {slaGlBatchName && <Text type="secondary" style={{ fontSize: 11 }}>· Batch: {slaGlBatchName}</Text>}
                        </div>
                        <Descriptions size="small" column={3} bordered style={{ marginBottom: 10 }}>
                          <Descriptions.Item label="Status">
                            <Tag color={slaStatus === 'POSTED' ? 'green' : slaStatus === 'ERROR' ? 'red' : 'orange'}>{slaStatus}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="Posting Status">
                            <Tag color={slaPostingStatus === 'POSTED' ? 'green' : 'default'}>{slaPostingStatus}</Tag>
                          </Descriptions.Item>
                          {slaGlBatchId && <Descriptions.Item label="GL Batch ID">{slaGlBatchId}</Descriptions.Item>}
                          {slaGlBatchName && <Descriptions.Item label="GL Batch Name" span={2}>{slaGlBatchName}</Descriptions.Item>}
                          {slaGlHeaderId && <Descriptions.Item label="GL Header ID">{slaGlHeaderId}</Descriptions.Item>}
                        </Descriptions>
                        {renderLinesTable(slaLines, 'Invoice')}
                        {slaStatus === 'POSTED' && cancelSlaLines.length === 0 && (
                          <div style={{ marginTop: 10, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, fontSize: 12, color: '#52c41a' }}>
                            <CheckCircleOutlined style={{ marginRight: 6 }} />
                            Posted to GL on {slaGlBatchName || `Batch ID ${slaGlBatchId}`}. No further changes allowed.
                          </div>
                        )}
                      </div>

                      {/* ── Cancellation Reversal Accounting ── */}
                      {cancelSlaLines.length > 0 && (
                        <div>
                          <div style={{ height: 1, background: '#f0f0f0', marginBottom: 16 }} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Text strong style={{ fontSize: 13, color: REDWOOD.error }}>Cancellation Reversal</Text>
                            <Tag color={cancelSlaStatus === 'POSTED' ? 'green' : cancelSlaStatus === 'ERROR' ? 'red' : 'orange'} style={{ fontSize: 11 }}>
                              {cancelSlaStatus ?? 'Unknown'}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 11 }}>Header ID: {cancelSlaHeaderId}</Text>
                          </div>
                          {renderLinesTable(cancelSlaLines, 'Cancellation')}
                          {cancelPostError && (
                            <Alert
                              type="error"
                              showIcon
                              style={{ marginTop: 10 }}
                              message="Post Cancellation to GL Failed"
                              description={cancelPostError}
                            />
                          )}
                          {cancelSlaStatus === 'POSTED' && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, fontSize: 12, color: REDWOOD.error }}>
                              <StopOutlined style={{ marginRight: 6 }} />
                              Invoice cancelled — reversal posted to GL and locked.
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ),
                },

                // ── Prepayment Applications tab (only when applications exist) ──
                ...(appliedPrepaymentsList.length > 0 ? [{
                  key: 'prepayments',
                  label: (
                    <Space size={4}>
                      <WalletOutlined />
                      <span>Prepayment Applications</span>
                      <Tag style={{ margin: 0, fontSize: 10 }}>{appliedPrepaymentsList.length}</Tag>
                    </Space>
                  ),
                  children: (
                    <Spin spinning={slaModalPrepayLoading} tip="Loading prepayment accounting...">
                      {appliedPrepaymentsList.map((record) => {
                        const fetched  = appSlaData[record.applicationId];
                        const slaInfo  = appSlaMap[record.applicationId];
                        // Prefer fetched full result; fall back to appSlaMap values
                        const headerId  = fetched?.headerId  ?? slaInfo?.headerId  ?? null;
                        const st        = fetched?.accountingStatus ?? slaInfo?.status ?? 'None';
                        const postingSt = fetched?.postingStatus ?? '—';
                        const glBatch   = fetched?.glBatchName ?? (fetched?.glBatchId ? `Batch ${fetched.glBatchId}` : null);
                        const lines     = fetched?.lines ?? [];
                        const tagColor  = st === 'POSTED' ? 'green' : st === 'DRAFT' ? 'blue' : st === 'ERROR' ? 'red' : 'default';
                        const notLoaded = !fetched;
                        return (
                          <div key={record.applicationId} style={{ marginBottom: 16, border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
                            {/* Card header */}
                            <div style={{ padding: '8px 12px', background: '#f9f0ff', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Space>
                                <Text strong style={{ fontSize: 12 }}>Application ID: {record.applicationId}</Text>
                                <Text style={{ fontSize: 12, color: REDWOOD.info }}>{record.prepaymentNumber}</Text>
                                <Text type="secondary" style={{ fontSize: 11 }}>Applied: {formatAmount(record.appliedAmount)} {record.currency}</Text>
                              </Space>
                              <Tag color={tagColor} style={{ fontSize: 11 }}>SLA: {st}</Tag>
                            </div>
                            {/* Descriptions row — same structure as Invoice tab */}
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0' }}>
                              <Descriptions size="small" column={3} bordered>
                                <Descriptions.Item label="Header ID">{headerId ?? '—'}</Descriptions.Item>
                                <Descriptions.Item label="Status">
                                  <Tag color={tagColor}>{st}</Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="Posting Status">
                                  <Tag color={postingSt === 'POSTED' ? 'green' : 'default'}>{postingSt}</Tag>
                                </Descriptions.Item>
                                {glBatch && <Descriptions.Item label="GL Batch" span={3}>{glBatch}</Descriptions.Item>}
                              </Descriptions>
                            </div>
                            {/* Lines table */}
                            <div style={{ padding: 12 }}>
                              {notLoaded
                                ? <Text type="secondary" style={{ fontSize: 12 }}>Switch to this tab to load lines…</Text>
                                : lines.length > 0
                                  ? renderLinesTable(lines, 'Prepayment')
                                  : <Text type="secondary" style={{ fontSize: 12 }}>{headerId ? 'No accounting lines found for this header.' : 'Accounting not yet created.'}</Text>
                              }
                            </div>
                          </div>
                        );
                      })}
                    </Spin>
                  ),
                }] : []),

                // ── Payment tab (only when payments exist) ──
                ...(invoicePayments.length > 0 ? [{
                  key: 'payment',
                  label: (
                    <Space size={4}>
                      <BankOutlined />
                      <span>Payment</span>
                      <Tag style={{ margin: 0, fontSize: 10 }}>{invoicePayments.length}</Tag>
                    </Space>
                  ),
                  children: (
                    <Spin spinning={slaModalPaymentLoading} tip="Loading payment accounting...">
                      {invoicePayments.map((p) => {
                        const fetched   = paymentSlaData[p.checkId];
                        const headerId  = fetched?.headerId ?? null;
                        const st        = fetched?.accountingStatus ?? 'None';
                        const postingSt = fetched?.postingStatus ?? '—';
                        const glBatch   = fetched?.glBatchName ?? (fetched?.glBatchId ? `Batch ${fetched.glBatchId}` : null);
                        const lines     = fetched?.lines ?? [];
                        const tagColor  = st === 'POSTED' ? 'green' : st === 'DRAFT' ? 'blue' : st === 'ERROR' ? 'red' : 'default';
                        const notLoaded = !fetched;
                        return (
                          <div key={p.checkId} style={{ marginBottom: 16, border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
                            {/* Card header */}
                            <div style={{ padding: '8px 12px', background: '#e6f4ff', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Space>
                                <Text strong style={{ fontSize: 12 }}>Check ID: {p.checkId}</Text>
                                <Text style={{ fontSize: 12, color: REDWOOD.info }}>{p.number}</Text>
                                <Text type="secondary" style={{ fontSize: 11 }}>Paid: {formatAmount(p.paidAmount)} {p.currency}</Text>
                                <Text type="secondary" style={{ fontSize: 11 }}>{p.paymentDate}</Text>
                              </Space>
                              <Tag color={p.status === 'NEGOTIABLE' ? 'green' : 'default'} style={{ fontSize: 11 }}>{p.status}</Tag>
                            </div>
                            {/* Descriptions row — same structure as Invoice tab */}
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0' }}>
                              <Descriptions size="small" column={3} bordered>
                                <Descriptions.Item label="Header ID">{headerId ?? '—'}</Descriptions.Item>
                                <Descriptions.Item label="Status">
                                  <Tag color={tagColor}>{st}</Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="Posting Status">
                                  <Tag color={postingSt === 'POSTED' ? 'green' : 'default'}>{postingSt}</Tag>
                                </Descriptions.Item>
                                {glBatch && <Descriptions.Item label="GL Batch" span={3}>{glBatch}</Descriptions.Item>}
                              </Descriptions>
                            </div>
                            {/* Lines table */}
                            <div style={{ padding: 12 }}>
                              {notLoaded
                                ? <Text type="secondary" style={{ fontSize: 12 }}>Switch to this tab to load lines…</Text>
                                : lines.length > 0
                                  ? renderLinesTable(lines, 'Payment')
                                  : <Text type="secondary" style={{ fontSize: 12 }}>{headerId ? 'No accounting lines found for this header.' : 'Payment accounting not yet created.'}</Text>
                              }
                            </div>
                          </div>
                        );
                      })}
                    </Spin>
                  ),
                }] : []),
              ]}
            />
          );
        })()}
        </Spin>
      </Modal>
      {/* ── End SLA Modal ─────────────────────────────────────────────────── */}

      {/* ── GL Payload Debug Modal ────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>Post to Ledger — API Debug</span>
            {(() => {
              const steps: any[] = (glPayloadDebug as any)?.steps || [];
              const failedStep = steps.find(s => s.status && s.status >= 400);
              return failedStep
                ? <Tag color="red">Failed at: {failedStep.step}</Tag>
                : steps.length > 0 ? <Tag color="green">All steps OK</Tag> : null;
            })()}
          </Space>
        }
        open={glPayloadModalVisible}
        onCancel={() => setGlPayloadModalVisible(false)}
        footer={
          <Space>
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                const text = JSON.stringify((glPayloadDebug as any)?.steps ?? glPayloadDebug, null, 2);
                navigator.clipboard.writeText(text).then(
                  () => message.success('All steps copied to clipboard'),
                  () => message.error('Copy failed — select manually'),
                );
              }}
            >
              Copy All
            </Button>
            <Button onClick={() => setGlPayloadModalVisible(false)}>Close</Button>
          </Space>
        }
        width={860}
        destroyOnClose
      >
        {glPayloadDebug && (() => {
          const steps: any[] = (glPayloadDebug as any).steps || [];
          const methodColor = (m: string) => m === 'POST' ? 'orange' : m === 'PUT' ? 'purple' : 'blue';
          const statusColor = (s?: number) => !s ? 'default' : s < 300 ? 'green' : s < 500 ? 'orange' : 'red';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ border: `1px solid ${s.status && s.status >= 400 ? '#ff4d4f' : '#f0f0f0'}`, borderRadius: 6, overflow: 'hidden' }}>
                  {/* Step header */}
                  <div style={{ background: s.status && s.status >= 400 ? '#fff1f0' : '#fafafa', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f0f0f0' }}>
                    <Tag color={methodColor(s.method)} style={{ fontWeight: 700, margin: 0 }}>{s.method}</Tag>
                    <Text code style={{ fontSize: 11, flex: 1 }}>{s.url}</Text>
                    {s.status && <Tag color={statusColor(s.status)}>{s.status}</Tag>}
                  </div>
                  {/* Request body */}
                  {s.requestBody && (
                    <div style={{ padding: '4px 12px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Request Body</Text>
                        <Button size="small" type="link" icon={<CopyOutlined />} style={{ fontSize: 11 }}
                          onClick={() => navigator.clipboard.writeText(JSON.stringify(s.requestBody, null, 2)).then(() => message.success('Copied'))}>
                          Copy
                        </Button>
                      </div>
                      <pre style={{ fontSize: 11, background: '#1a1a1a', color: '#e6e6e6', borderRadius: 4, padding: '6px 10px', maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 8px' }}>
                        {JSON.stringify(s.requestBody, null, 2)}
                      </pre>
                    </div>
                  )}
                  {/* Response */}
                  {s.response !== undefined && (
                    <div style={{ padding: '4px 12px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Response</Text>
                        <Button size="small" type="link" icon={<CopyOutlined />} style={{ fontSize: 11 }}
                          onClick={() => navigator.clipboard.writeText(JSON.stringify(s.response, null, 2)).then(() => message.success('Copied'))}>
                          Copy
                        </Button>
                      </div>
                      <pre style={{ fontSize: 11, background: '#1a1a1a', color: s.status && s.status >= 400 ? '#ff7875' : '#e6e6e6', borderRadius: 4, padding: '6px 10px', maxHeight: 160, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0' }}>
                        {JSON.stringify(s.response, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
              {steps.length === 0 && <Text type="secondary">Click Post to Ledger first to capture the API calls.</Text>}
            </div>
          );
        })()}
      </Modal>
      {/* ── End GL Payload Debug Modal ────────────────────────────────────── */}

      {/* ── SLA Debug Modal ───────────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <BugOutlined style={{ color: '#fa8c16' }} />
            <span style={{ fontWeight: 700 }}>Create Accounting — API Debug</span>
            <Tag color="orange" style={{ fontSize: 11 }}>Developer Tool</Tag>
          </Space>
        }
        open={slaDebugVisible}
        onCancel={() => setSlaDebugVisible(false)}
        footer={
          <Space>
            {slaDebugPostResult?.ok && (
              <Button
                type="primary"
                icon={<EyeOutlined />}
                onClick={() => { setSlaDebugVisible(false); setSlaModalVisible(true); }}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              >
                View Accounting Lines
              </Button>
            )}
            <Button onClick={() => setSlaDebugVisible(false)}>Close</Button>
          </Space>
        }
        width={960}
        styles={{ body: { padding: '16px 24px', maxHeight: '75vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        <Tabs
          activeKey={slaDebugTab}
          onChange={(k) => setSlaDebugTab(k)}
          type="card"
          items={[
            {
              key: 'post',
              label: (
                <Space size={4}>
                  <Tag color="blue" style={{ margin: 0, fontWeight: 700, fontSize: 11 }}>POST</Tag>
                  <span>Create Accounting</span>
                </Space>
              ),
              children: (
                <div>
                  {/* Endpoint */}
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #adc6ff' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>ENDPOINT</Text>
                    <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      POST {APEX_DB_CONFIG.baseUrl}/sla/accounting/create
                    </Text>
                  </div>

                  {/* Headers */}
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>HEADERS</Text>
                    <Text code style={{ fontSize: 11 }}>Content-Type: application/json</Text><br />
                    <Text code style={{ fontSize: 11 }}>Accept: application/json</Text>
                  </div>

                  {/* Request Body */}
                  <div style={{ marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6, fontWeight: 600 }}>REQUEST BODY</Text>
                    <pre style={{
                      background: '#1e1e1e',
                      color: '#d4d4d4',
                      padding: 14,
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.6,
                      overflow: 'auto',
                      maxHeight: 280,
                      margin: 0,
                      fontFamily: 'monospace',
                    }}>
                      {JSON.stringify(slaDebugPayload, null, 2)}
                    </pre>
                  </div>

                  {/* Execute button */}
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={slaDebugLoading === 'post'}
                    onClick={handleDebugPost}
                    disabled={!!slaDebugPostResult?.ok}
                    style={{ marginBottom: 12 }}
                  >
                    {slaDebugPostResult?.ok ? 'Posted Successfully' : 'Execute POST'}
                  </Button>

                  {/* Response */}
                  {slaDebugPostResult && (
                    <div>
                      <div style={{ marginBottom: 6 }}>
                        <Tag color={slaDebugPostResult.ok ? 'success' : 'error'} style={{ fontWeight: 700 }}>
                          HTTP {slaDebugPostResult.status}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>RESPONSE</Text>
                      </div>
                      <pre style={{
                        background: slaDebugPostResult.ok ? '#001529' : '#2b0000',
                        color: slaDebugPostResult.ok ? '#52c41a' : '#ff7875',
                        padding: 14,
                        borderRadius: 6,
                        fontSize: 11,
                        lineHeight: 1.6,
                        overflow: 'auto',
                        maxHeight: 200,
                        margin: 0,
                        fontFamily: 'monospace',
                      }}>
                        {JSON.stringify(slaDebugPostResult.data ?? slaDebugPostResult.error, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ),
            },
            // ── Prepayment Applications tab (only when applications exist) ──
            ...(appliedPrepaymentsList.length > 0 ? [{
              key: 'prepaymentApps',
              label: (
                <Space size={4}>
                  <Tag color="purple" style={{ margin: 0, fontWeight: 700, fontSize: 11 }}>SLA</Tag>
                  <span>Prepayment Applications</span>
                  <Tag style={{ margin: 0, fontSize: 10 }}>{appliedPrepaymentsList.length}</Tag>
                </Space>
              ),
              children: (
                <div>
                  {/* Info banner */}
                  <div style={{ marginBottom: 14, padding: '8px 12px', background: '#f9f0ff', borderRadius: 6, border: '1px solid #d3adf7', fontSize: 12 }}>
                    <Text style={{ color: '#531dab' }}>
                      <strong>Auto-triggered on Execute POST:</strong> For each application below with no accounting,
                      the system calls <Text code style={{ fontSize: 11 }}>POST /sla/accounting/create</Text> with
                      <Text code style={{ fontSize: 11 }}>sourceTable=RR_AP_APPLIED_PREPAYMENTS</Text> and builds
                      DR LIABILITY / CR PREPAYMENT lines from the invoice's liability distribution account.
                    </Text>
                  </div>

                  {/* Endpoint */}
                  <div style={{ marginBottom: 14, padding: '8px 12px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #adc6ff' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>ENDPOINT (per application)</Text>
                    <Text code style={{ fontSize: 12 }}>POST {APEX_DB_CONFIG.baseUrl}/sla/accounting/create</Text>
                  </div>

                  {/* Per-application cards */}
                  {appliedPrepaymentsList.map((record) => {
                    const slaInfo        = appSlaMap[record.applicationId];
                    const st             = slaInfo?.status ?? null;
                    const tagColor       = st === 'POSTED' ? 'green' : st === 'DRAFT' ? '#1677ff' : st === 'ERROR' ? 'red' : 'default';
                    const invoiceNumber  = form.getFieldValue('invoiceNumber');
                    const bu             = form.getFieldValue('businessUnit') || '';
                    const liabilityDist_ = form.getFieldValue('liabilityDistribution') || '';
                    const firstSeg_      = liabilityDist_.split('-')[0] || '';
                    const prepayDist_    = firstSeg_ ? `${firstSeg_}-00-00-1223108-0000-000-00-000-000` : '';
                    const currency_      = headerValues.invoiceCurrency || form.getFieldValue('invoiceCurrency') || 'AED';
                    const acctDate_      = record.applicationAccountingDate
                      ? dayjs(record.applicationAccountingDate).format('YYYY-MM-DD')
                      : dayjs().format('YYYY-MM-DD');
                    const d_             = record.applicationAccountingDate ? dayjs(record.applicationAccountingDate).toDate() : new Date();
                    const months__       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const periodName__   = `${months__[d_.getMonth()]}-${String(d_.getFullYear()).slice(-2)}`;

                    const requestPayload = {
                      header: {
                        moduleName: 'AP', sourceTable: 'RR_AP_APPLIED_PREPAYMENTS',
                        sourceId: record.applicationId, sourceNumber: record.prepaymentNumber,
                        sourceType: 'APPLIED', eventTypeCode: 'PREPAYMENT_APPLIED',
                        eventDate: acctDate_, accountingDate: acctDate_, periodName: periodName__,
                        ledgerId: '<ledgerId>', ledgerName: '<ledgerName>',
                        currencyCode: record.currency || currency_, ledgerCurrency: 'AED', exchangeRate: 1,
                        businessUnit: bu, description: `Prepayment Applied – ${record.prepaymentNumber} on Invoice ${invoiceNumber}`,
                        createdBy: 'user',
                      },
                      lines: [
                        { lineNumber: 1, lineType: 'DR', accountingClass: 'LIABILITY', accountCombination: liabilityDist_,
                          enteredDr: record.appliedAmount, enteredCr: 0, accountedDr: record.appliedAmount, accountedCr: 0,
                          currencyCode: record.currency || currency_, description: `AP Liability Reduced – Invoice ${invoiceNumber}` },
                        { lineNumber: 2, lineType: 'CR', accountingClass: 'PREPAYMENT', accountCombination: prepayDist_,
                          enteredDr: 0, enteredCr: record.appliedAmount, accountedDr: 0, accountedCr: record.appliedAmount,
                          currencyCode: record.currency || currency_, description: `Prepayment Asset Cleared – ${record.prepaymentNumber}` },
                      ],
                    };

                    return (
                      <div key={record.applicationId} style={{ marginBottom: 14, border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
                        {/* Card header */}
                        <div style={{ padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Space>
                            <Text strong style={{ fontSize: 12 }}>Application ID: {record.applicationId}</Text>
                            <Text style={{ fontSize: 12, color: REDWOOD.info }}>{record.prepaymentNumber}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>Applied: {formatAmount(record.appliedAmount)} {record.currency}</Text>
                          </Space>
                          <Tag color={tagColor} style={{ fontSize: 11 }}>
                            Accounting: {st ?? 'None'}
                          </Tag>
                        </div>

                        {/* SLA journal entries that will be created */}
                        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6, fontWeight: 600 }}>
                            SLA JOURNAL LINES (sourceTable: RR_AP_APPLIED_PREPAYMENTS, eventType: PREPAYMENT_APPLIED)
                          </Text>
                          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: '#f5f5f5' }}>
                                {['#', 'Type', 'Class', 'Account Combination', 'Debit', 'Credit', 'Description'].map(h => (
                                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', border: '1px solid #e8e8e8', fontWeight: 600 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>1</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}><Tag color="blue" style={{ fontSize: 10, margin: 0 }}>DR</Tag></td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>LIABILITY</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}><Text code style={{ fontSize: 10 }}>{liabilityDist_ || '—'}</Text></td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8', color: '#1677ff', fontWeight: 600 }}>{formatAmount(record.appliedAmount)}</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>—</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>AP Liability Reduced – Invoice {invoiceNumber}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>2</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}><Tag color="volcano" style={{ fontSize: 10, margin: 0 }}>CR</Tag></td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>PREPAYMENT</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}><Text code style={{ fontSize: 10 }}>{prepayDist_}</Text></td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>—</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8', color: '#cf1322', fontWeight: 600 }}>{formatAmount(record.appliedAmount)}</td>
                                <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>Prepayment Asset Cleared – {record.prepaymentNumber}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Request payload */}
                        <div style={{ padding: '8px 12px' }}>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>REQUEST BODY</Text>
                          <pre style={{
                            background: '#1e1e1e', color: '#d4d4d4', padding: 10, borderRadius: 6,
                            fontSize: 10, lineHeight: 1.5, overflow: 'auto', maxHeight: 180, margin: 0, fontFamily: 'monospace',
                          }}>
                            {JSON.stringify(requestPayload, null, 2)}
                          </pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ),
            }] : []),
            {
              key: 'get',
              label: (
                <Space size={4}>
                  <Tag color="green" style={{ margin: 0, fontWeight: 700, fontSize: 11 }}>GET</Tag>
                  <span>Check Accounting</span>
                </Space>
              ),
              children: (
                <div>
                  {/* Endpoint */}
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>ENDPOINT</Text>
                    <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      GET {APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId={slaDebugSourceId}
                    </Text>
                  </div>

                  {/* Headers */}
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #adc6ff' }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>HEADERS</Text>
                    <Text code style={{ fontSize: 11 }}>Accept: application/json</Text>
                  </div>

                  {/* Execute button */}
                  <Button
                    icon={<ReloadOutlined />}
                    loading={slaDebugLoading === 'get'}
                    onClick={handleDebugGet}
                    style={{ marginBottom: 12, borderColor: '#52c41a', color: '#52c41a' }}
                  >
                    Execute GET
                  </Button>

                  {/* Response — Invoice */}
                  {slaDebugGetResult && (
                    <div style={{ marginBottom: appliedPrepaymentsList.length > 0 ? 20 : 0 }}>
                      <div style={{ marginBottom: 6 }}>
                        <Tag color={slaDebugGetResult.ok ? 'success' : 'error'} style={{ fontWeight: 700 }}>
                          HTTP {slaDebugGetResult.status}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>RESPONSE — Invoice (AP_INVOICES)</Text>
                      </div>
                      <pre style={{
                        background: '#001529', color: '#52c41a', padding: 14, borderRadius: 6,
                        fontSize: 11, lineHeight: 1.6, overflow: 'auto', maxHeight: 220, margin: 0, fontFamily: 'monospace',
                      }}>
                        {JSON.stringify(slaDebugGetResult.data ?? slaDebugGetResult.error, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* ── Prepayment Accounting Check (shown only when applications exist) ── */}
                  {appliedPrepaymentsList.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <Divider style={{ margin: '8px 0 12px' }} />
                      <div style={{ marginBottom: 10, padding: '8px 12px', background: '#f9f0ff', borderRadius: 6, border: '1px solid #d3adf7' }}>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>ENDPOINT (per application)</Text>
                        <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          GET {APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=RR_AP_APPLIED_PREPAYMENTS&sourceId=&#123;applicationId&#125;
                        </Text>
                      </div>

                      <Button
                        icon={<ReloadOutlined />}
                        loading={slaDebugCheckingPrepay}
                        style={{ marginBottom: 12, borderColor: '#722ed1', color: '#722ed1' }}
                        onClick={async () => {
                          setSlaDebugCheckingPrepay(true);
                          const results: Record<number, any> = {};
                          await Promise.all(appliedPrepaymentsList.map(async (record) => {
                            try {
                              const url = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=RR_AP_APPLIED_PREPAYMENTS&sourceId=${record.applicationId}`;
                              const res = await fetch(url, { headers: { Accept: 'application/json' } });
                              const data = await res.json();
                              results[record.applicationId] = { status: res.status, ok: res.ok, data };
                            } catch (err: any) {
                              results[record.applicationId] = { status: 0, ok: false, error: err.message };
                            }
                          }));
                          setSlaDebugGetPrepayResults(results);
                          setSlaDebugCheckingPrepay(false);
                        }}
                      >
                        Check Prepayment Accounting ({appliedPrepaymentsList.length})
                      </Button>

                      {appliedPrepaymentsList.map((record) => {
                        const result = slaDebugGetPrepayResults[record.applicationId];
                        return (
                          <div key={record.applicationId} style={{ marginBottom: 10, border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{ padding: '6px 10px', background: '#f9f0ff', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Space size={4}>
                                <Text strong style={{ fontSize: 11 }}>App ID: {record.applicationId}</Text>
                                <Text style={{ fontSize: 11, color: REDWOOD.info }}>{record.prepaymentNumber}</Text>
                                <Text type="secondary" style={{ fontSize: 10 }}>{formatAmount(record.appliedAmount)} {record.currency}</Text>
                              </Space>
                              {result && (
                                <Tag color={result.ok ? 'success' : 'error'} style={{ fontSize: 10 }}>HTTP {result.status}</Tag>
                              )}
                            </div>
                            {result && (
                              <pre style={{
                                background: result.ok ? '#001529' : '#2b0000', color: result.ok ? '#52c41a' : '#ff7875',
                                padding: 10, margin: 0, fontSize: 10, lineHeight: 1.5, overflow: 'auto', maxHeight: 140, fontFamily: 'monospace',
                              }}>
                                {JSON.stringify(result.data ?? result.error, null, 2)}
                              </pre>
                            )}
                            {!result && (
                              <div style={{ padding: '6px 10px' }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>Not checked yet — click the button above</Text>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>
      {/* ── End SLA Debug Modal ───────────────────────────────────────────── */}

      {/* ── Prepayment API Explorer Modal ────────────────────────────────── */}
      <Modal
        open={prepaymentAPIDrawerVisible}
        onCancel={() => setPrepaymentAPIDrawerVisible(false)}
        width={900}
        styles={{ body: { padding: '16px 24px', maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnHidden
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
              {prepaymentAPIResults.length} endpoint{prepaymentAPIResults.length !== 1 ? 's' : ''} queried
            </Text>
            <Space>
              <Button onClick={() => setPrepaymentAPIDrawerVisible(false)}>Close</Button>
              <Tooltip title={
                !(savedInvoiceId || initialData?.invoiceId)
                  ? 'Save the invoice first before applying a prepayment'
                  : availablePrepayments.length === 0
                  ? 'No prepayments available for this supplier'
                  : ''
              }>
                <Button
                  type="primary"
                  icon={<DollarOutlined />}
                  disabled={availablePrepayments.length === 0 || !(savedInvoiceId || initialData?.invoiceId)}
                  onClick={() => { setPrepaymentAPIDrawerVisible(false); openPrepaymentModal(); }}
                  style={
                    availablePrepayments.length > 0 && (savedInvoiceId || initialData?.invoiceId)
                      ? { background: REDWOOD.success, borderColor: REDWOOD.success }
                      : {}
                  }
                >
                  Apply Prepayments ({availablePrepayments.length})
                </Button>
              </Tooltip>
            </Space>
          </div>
        }
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: availablePrepayments.length > 0 ? '#f0faf4' : REDWOOD.neutral100,
              border: `1.5px solid ${availablePrepayments.length > 0 ? REDWOOD.success : REDWOOD.neutral300}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Badge count={availablePrepayments.length} size="small" style={{ backgroundColor: REDWOOD.success }}>
                <CreditCardOutlined style={{ fontSize: 16, color: availablePrepayments.length > 0 ? REDWOOD.success : REDWOOD.neutral600 }} />
              </Badge>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>Prepayment API Explorer</div>
              <div style={{ fontSize: 11, color: REDWOOD.neutral600, fontWeight: 400 }}>
                Live results from all prepayment endpoints for this supplier
              </div>
            </div>
            {availablePrepayments.length > 0 && (
              <Tag color="green" style={{ marginLeft: 4 }}>
                {availablePrepayments.length} available
              </Tag>
            )}
          </div>
        }
      >
        {prepaymentAPIResults.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: REDWOOD.neutral600 }}>
            <CreditCardOutlined style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>Select a supplier to load prepayment data</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {prepaymentAPIResults.map((result, idx) => {
              const statusColor = result.status === null ? '#888'
                : result.status >= 200 && result.status < 300 ? REDWOOD.success
                : REDWOOD.error;
              const methodColor = '#0572CE';
              const cols = result.data && result.data.length > 0
                ? Object.keys(result.data[0]).slice(0, 8).map(k => ({
                    title: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    dataIndex: k,
                    key: k,
                    ellipsis: true,
                    render: (v: any) => {
                      if (v === null || v === undefined) return <span style={{ color: '#ccc' }}>—</span>;
                      if (typeof v === 'number' && k.includes('amount')) return <span style={{ fontWeight: 600, color: REDWOOD.success }}>{v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>;
                      return <span style={{ fontSize: 11 }}>{String(v)}</span>;
                    },
                  }))
                : [];

              return (
                <Card
                  key={idx}
                  size="small"
                  styles={{ body: { padding: '12px 16px' } }}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${result.error ? REDWOOD.error : result.data && result.data.length > 0 ? REDWOOD.success + '55' : REDWOOD.neutral200}`,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <Tag style={{ background: methodColor, color: '#fff', border: 'none', fontWeight: 700, fontSize: 10, margin: 0 }}>GET</Tag>
                    <Text strong style={{ fontSize: 13 }}>{result.endpoint}</Text>
                    {result.loading ? (
                      <LoadingOutlined style={{ color: '#aaa' }} />
                    ) : (
                      <Space size={4}>
                        <Tag style={{ background: result.error ? REDWOOD.error : REDWOOD.success, color: '#fff', border: 'none', fontSize: 10, margin: 0 }}>
                          {result.status === 0 ? 'ERR' : result.status}
                        </Tag>
                        {result.durationMs !== null && (
                          <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>{result.durationMs}ms</Text>
                        )}
                        {result.data !== null && !result.error && (
                          <Tag color={result.data.length > 0 ? 'green' : 'default'} style={{ fontSize: 10, margin: 0 }}>
                            {result.data.length} row{result.data.length !== 1 ? 's' : ''}
                          </Tag>
                        )}
                      </Space>
                    )}
                  </div>

                  <div style={{
                    background: '#1a1a2e',
                    borderRadius: 4,
                    padding: '5px 12px',
                    marginBottom: 10,
                    fontFamily: 'monospace',
                    fontSize: 10,
                    color: '#e0e0e0',
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{ color: methodColor, fontWeight: 700 }}>GET </span>
                    <span style={{ color: statusColor }}>{result.url}</span>
                  </div>

                  {result.loading ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin indicator={<LoadingOutlined spin />} size="small" />
                      <div style={{ marginTop: 6, fontSize: 11, color: REDWOOD.neutral600 }}>Fetching...</div>
                    </div>
                  ) : result.error ? (
                    <Alert type="error" showIcon message={result.error} style={{ fontSize: 11 }} />
                  ) : result.data && result.data.length > 0 ? (
                    <Table
                      size="small"
                      dataSource={result.data.map((r: any, i: number) => ({ ...r, _key: i }))}
                      rowKey="_key"
                      columns={cols}
                      pagination={result.data.length > 5 ? { pageSize: 5, size: 'small' } : false}
                      scroll={{ x: true }}
                      style={{ fontSize: 11 }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', padding: 16, color: REDWOOD.neutral600, fontSize: 12 }}>
                      No records found
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Modal>
      {/* ── End Prepayment API Explorer Modal ────────────────────────────── */}

      {/* ── Cancel Flow Debug Modal ──────────────────────────────────────── */}
      <Modal
        open={cancelFlowModalVisible}
        onCancel={() => setCancelFlowModalVisible(false)}
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span style={{ fontWeight: 600 }}>Cancellation Flow — API Steps</span>
            {cancelFlowDebug.every(s => s.ok !== false) ? (
              <Tag color="success">All steps passed</Tag>
            ) : (
              <Tag color="error">One or more steps failed</Tag>
            )}
          </Space>
        }
        footer={<Button onClick={() => setCancelFlowModalVisible(false)}>Close</Button>}
        width={820}
        destroyOnClose
        style={{ top: 20 }}
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', padding: 16 } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cancelFlowDebug.map((s, idx) => (
            <div key={idx} style={{
              border: `1px solid ${s.ok === false ? '#ffa39e' : s.ok === true ? '#b7eb8f' : '#d9d9d9'}`,
              borderRadius: 6, overflow: 'hidden',
            }}>
              {/* Step header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                background: s.ok === false ? '#fff2f0' : s.ok === true ? '#f6ffed' : '#fafafa',
              }}>
                <Tag color={s.method === 'POST' ? 'orange' : s.method === 'PUT' ? 'blue' : 'default'}
                  style={{ margin: 0, fontSize: 10, fontWeight: 700 }}>{s.method || '—'}</Tag>
                <Tag color={s.ok === false ? 'error' : s.ok === true ? 'success' : 'default'}
                  style={{ margin: 0, fontSize: 10 }}>{s.status ?? '—'}</Tag>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{s.step}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888' }}>
                  {s.ok === false ? '✗ Failed' : s.ok === true ? '✓ OK' : ''}
                </span>
              </div>
              {/* URL */}
              <div style={{ padding: '6px 12px', background: '#1e1e2e' }}>
                <code style={{ fontSize: 11, color: '#89d85d', wordBreak: 'break-all' }}>{s.url}</code>
              </div>
              {/* Request body */}
              {s.request && (
                <div style={{ padding: '6px 12px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                  <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 2 }}>REQUEST BODY</div>
                  <pre style={{ margin: 0, fontSize: 11, color: '#333', whiteSpace: 'pre-wrap' }}>{s.request}</pre>
                </div>
              )}
              {/* Response */}
              {s.response && (
                <div style={{ padding: '6px 12px', borderTop: '1px solid #f0f0f0', background: s.ok === false ? '#fff2f0' : '#f6ffed' }}>
                  <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 2 }}>RESPONSE</div>
                  <pre style={{ margin: 0, fontSize: 11, color: '#333', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{s.response}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>

      {/* ── Cancel Invoice Modal ─────────────────────────────────────────── */}
      <Modal
        open={cancelModalOpen}
        onCancel={() => { if (!cancelExecuting) setCancelModalOpen(false); }}
        title={
          <Space>
            <StopOutlined style={{ color: REDWOOD.error }} />
            <span style={{ fontWeight: 700, color: REDWOOD.error }}>Cancel Invoice</span>
          </Space>
        }
        footer={
          cancelDone ? (
            <Button type="primary" onClick={() => setCancelModalOpen(false)}>Close</Button>
          ) : cancelStep === 'eligibility' ? (
            <Space>
              <Button onClick={() => setCancelModalOpen(false)}>Close</Button>
              <Button
                type="primary"
                danger
                disabled={!cancelEligibility?.eligible || cancelEligLoading}
                onClick={() => setCancelStep('confirm')}
              >
                Proceed to Confirm
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setCancelStep('eligibility')} disabled={cancelExecuting}>Back</Button>
              <Button
                type="primary"
                danger
                loading={cancelExecuting}
                icon={<StopOutlined />}
                onClick={executeCancelInvoice}
              >
                Confirm Cancel Invoice
              </Button>
            </Space>
          )
        }
        width={520}
        destroyOnClose
      >
        {cancelEligLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, color: REDWOOD.neutral600, fontSize: 13 }}>Checking eligibility…</div>
          </div>
        ) : cancelDone ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 48, color: REDWOOD.success }} />
            <div style={{ marginTop: 12, fontSize: 16, fontWeight: 600, color: REDWOOD.success }}>
              Invoice Cancelled
            </div>
            <div style={{ marginTop: 6, color: REDWOOD.neutral600, fontSize: 13 }}>
              Invoice <strong>{cancelEligibility?.invoiceNumber}</strong> has been cancelled successfully.
            </div>
          </div>
        ) : cancelStep === 'eligibility' ? (
          <div>
            {cancelEligibility && (
              <>
                <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="Invoice #">{cancelEligibility.invoiceNumber}</Descriptions.Item>
                  <Descriptions.Item label="Type">{cancelEligibility.invoiceType}</Descriptions.Item>
                  <Descriptions.Item label="Paid Status">{cancelEligibility.paidStatus}</Descriptions.Item>
                  <Descriptions.Item label="Eligible">
                    {cancelEligibility.eligible
                      ? <Tag color="success" icon={<CheckCircleOutlined />}>Yes</Tag>
                      : <Tag color="error"   icon={<CloseCircleOutlined />}>No</Tag>}
                  </Descriptions.Item>
                  {cancelEligibility.invoiceAmount !== undefined && (
                    <Descriptions.Item label="Invoice Amount">
                      <span style={{ fontWeight: 600 }}>
                        {cancelEligibility.invoiceAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                      </span>
                    </Descriptions.Item>
                  )}
                  {cancelEligibility.outstanding !== undefined && (
                    <Descriptions.Item label="Outstanding Balance">
                      <span style={{
                        fontWeight: 600,
                        color: Math.abs(cancelEligibility.outstanding - (cancelEligibility.invoiceAmount ?? 0)) < 0.01
                          ? REDWOOD.success   /* balance = invoice amount = fully open */
                          : REDWOOD.error,
                      }}>
                        {cancelEligibility.outstanding.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                        {Math.abs(cancelEligibility.outstanding - (cancelEligibility.invoiceAmount ?? 0)) < 0.01 && (
                          <Tag color="success" style={{ marginLeft: 6, fontSize: 10 }}>Fully Open</Tag>
                        )}
                      </span>
                    </Descriptions.Item>
                  )}
                </Descriptions>
                <Divider style={{ margin: '8px 0 12px' }} />
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Eligibility Checks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cancelEligibility.checks.map((c, idx) => (
                    <div key={idx} style={{
                      display:      'flex',
                      alignItems:   'flex-start',
                      gap:          8,
                      padding:      '6px 10px',
                      background:   c.passed ? '#f6ffed' : '#fff2f0',
                      border:       `1px solid ${c.passed ? '#b7eb8f' : '#ffccc7'}`,
                      borderRadius: 6,
                      fontSize:     12,
                    }}>
                      {c.passed
                        ? <CheckCircleOutlined style={{ color: REDWOOD.success, marginTop: 2, flexShrink: 0 }} />
                        : <CloseCircleOutlined style={{ color: REDWOOD.error,   marginTop: 2, flexShrink: 0 }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{c.check}</span>
                          {!c.passed && <Tag color="error" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>Failed</Tag>}
                        </div>
                        {c.detail && (
                          <div style={{
                            color:      c.passed ? REDWOOD.neutral600 : REDWOOD.error,
                            fontWeight: c.passed ? 400 : 600,
                            marginTop:  3,
                            fontSize:   12,
                          }}>
                            {!c.passed && '→ '}{c.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!cancelEligibility.eligible && (
                  <Alert
                    type="error"
                    showIcon
                    message="This invoice cannot be cancelled"
                    description="One or more eligibility checks failed. Review the checks above."
                    style={{ marginTop: 14 }}
                  />
                )}

                {/* ── API Info Panel ─────────────────────────────────── */}
                <div style={{ marginTop: 14 }}>
                  <div
                    onClick={() => { setCancelApiExpanded(v => !v); setCancelApiResult(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '5px 8px', borderRadius: 6,
                      background: '#f0f5ff', border: '1px solid #adc6ff',
                      fontSize: 12, color: '#2f54eb', userSelect: 'none',
                    }}
                  >
                    <ApiOutlined style={{ fontSize: 13 }} />
                    <span style={{ fontWeight: 600 }}>API Info</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11 }}>{cancelApiExpanded ? '▲ Hide' : '▼ Show'}</span>
                  </div>

                  {cancelApiExpanded && (() => {
                    const invoiceId = savedInvoiceId || initialData?.invoiceId;
                    const eligUrl = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/cancel-eligibility`;
                    return (
                      <div style={{
                        marginTop: 6, padding: '10px 12px', borderRadius: 6,
                        background: '#fafafa', border: '1px solid #d9d9d9', fontSize: 12,
                      }}>
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ color: '#8c8c8c', fontSize: 11 }}>GET — Eligibility check</span>
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          background: '#fff', border: '1px solid #e0e0e0',
                          borderRadius: 4, padding: '4px 8px',
                        }}>
                          <code style={{ flex: 1, fontSize: 11, wordBreak: 'break-all', color: '#1d39c4' }}>
                            {eligUrl}
                          </code>
                          <Tooltip title="Copy URL">
                            <CopyOutlined
                              style={{ flexShrink: 0, cursor: 'pointer', color: '#595959' }}
                              onClick={() => { navigator.clipboard.writeText(eligUrl); message.success('URL copied'); }}
                            />
                          </Tooltip>
                        </div>

                        <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<ApiOutlined />}
                            loading={cancelApiTesting}
                            onClick={async () => {
                              setCancelApiTesting(true);
                              setCancelApiResult(null);
                              try {
                                const res = await fetch(eligUrl, { headers: { Accept: 'application/json' } });
                                const text = await res.text();
                                try {
                                  setCancelApiResult(JSON.stringify(JSON.parse(text), null, 2));
                                } catch {
                                  setCancelApiResult(text);
                                }
                              } catch (e: any) {
                                setCancelApiResult(`Error: ${e.message}`);
                              } finally {
                                setCancelApiTesting(false);
                              }
                            }}
                          >
                            Test
                          </Button>
                          {cancelApiResult && (
                            <Tooltip title="Copy response">
                              <CopyOutlined
                                style={{ cursor: 'pointer', color: '#595959' }}
                                onClick={() => { navigator.clipboard.writeText(cancelApiResult!); message.success('Response copied'); }}
                              />
                            </Tooltip>
                          )}
                        </div>

                        {cancelApiResult && (
                          <pre style={{
                            marginTop: 8, padding: '8px 10px',
                            background: '#1e1e1e', color: '#d4d4d4',
                            borderRadius: 4, fontSize: 11,
                            maxHeight: 200, overflow: 'auto',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>
                            {cancelApiResult}
                          </pre>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {/* ── End API Info Panel ─────────────────────────────── */}
              </>
            )}
          </div>
        ) : (
          /* confirm step */
          <div>
            <Alert
              type="warning"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message="Are you sure you want to cancel this invoice?"
              description={
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
                  <li>Invoice <strong>{cancelEligibility?.invoiceNumber}</strong> will be marked as <strong>Cancelled</strong>.</li>
                  <li>If accounting has already been posted to the GL, a reversal journal will be created automatically.</li>
                  <li>This action cannot be undone.</li>
                </ul>
              }
            />

            {/* ── API Info Panel (POST cancel) ──────────────────────── */}
            {(() => {
              const invoiceId = savedInvoiceId || initialData?.invoiceId;
              const cancelUrl = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/${invoiceId}/cancel`;
              const cancelBody = JSON.stringify({ cancelledBy: user?.username || 'SYSTEM' }, null, 2);
              return (
                <div style={{ marginTop: 14 }}>
                  <div
                    onClick={() => { setCancelPostExpanded(v => !v); setCancelPostResult(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '5px 8px', borderRadius: 6,
                      background: '#fff7e6', border: '1px solid #ffd591',
                      fontSize: 12, color: '#d46b08', userSelect: 'none',
                    }}
                  >
                    <ApiOutlined style={{ fontSize: 13 }} />
                    <span style={{ fontWeight: 600 }}>API Info — Cancel Request</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11 }}>{cancelPostExpanded ? '▲ Hide' : '▼ Show'}</span>
                  </div>

                  {cancelPostExpanded && (
                    <div style={{
                      marginTop: 6, padding: '10px 12px', borderRadius: 6,
                      background: '#fafafa', border: '1px solid #d9d9d9', fontSize: 12,
                    }}>
                      {/* Method + URL */}
                      <div style={{ marginBottom: 4, color: '#8c8c8c', fontSize: 11 }}>POST — Cancel invoice</div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: '#fff', border: '1px solid #e0e0e0',
                        borderRadius: 4, padding: '4px 8px', marginBottom: 8,
                      }}>
                        <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>POST</Tag>
                        <code style={{ flex: 1, fontSize: 11, wordBreak: 'break-all', color: '#1d39c4' }}>
                          {cancelUrl}
                        </code>
                        <Tooltip title="Copy URL">
                          <CopyOutlined
                            style={{ flexShrink: 0, cursor: 'pointer', color: '#595959' }}
                            onClick={() => { navigator.clipboard.writeText(cancelUrl); message.success('URL copied'); }}
                          />
                        </Tooltip>
                      </div>

                      {/* Request body */}
                      <div style={{ marginBottom: 4, color: '#8c8c8c', fontSize: 11 }}>Request Body (JSON)</div>
                      <div style={{ position: 'relative' }}>
                        <pre style={{
                          margin: 0, padding: '6px 32px 6px 8px',
                          background: '#1e1e1e', color: '#ce9178',
                          borderRadius: 4, fontSize: 11,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {cancelBody}
                        </pre>
                        <Tooltip title="Copy body">
                          <CopyOutlined
                            style={{
                              position: 'absolute', top: 6, right: 8,
                              cursor: 'pointer', color: '#888',
                            }}
                            onClick={() => { navigator.clipboard.writeText(cancelBody); message.success('Body copied'); }}
                          />
                        </Tooltip>
                      </div>

                      {/* Test button */}
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Button
                          size="small"
                          type="primary"
                          danger
                          ghost
                          icon={<ApiOutlined />}
                          loading={cancelPostTesting}
                          onClick={async () => {
                            setCancelPostTesting(true);
                            setCancelPostResult(null);
                            try {
                              const res = await fetch(cancelUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                body: JSON.stringify({ cancelledBy: user?.username || 'SYSTEM' }),
                              });
                              const text = await res.text();
                              try { setCancelPostResult(JSON.stringify(JSON.parse(text), null, 2)); }
                              catch { setCancelPostResult(text); }
                            } catch (e: any) {
                              setCancelPostResult(`Error: ${e.message}`);
                            } finally {
                              setCancelPostTesting(false);
                            }
                          }}
                        >
                          Test POST
                        </Button>
                        <span style={{ fontSize: 11, color: '#ff4d4f' }}>⚠ This will actually cancel the invoice</span>
                        {cancelPostResult && (
                          <Tooltip title="Copy response">
                            <CopyOutlined
                              style={{ cursor: 'pointer', color: '#595959' }}
                              onClick={() => { navigator.clipboard.writeText(cancelPostResult!); message.success('Response copied'); }}
                            />
                          </Tooltip>
                        )}
                      </div>

                      {cancelPostResult && (
                        <pre style={{
                          marginTop: 8, padding: '8px 10px',
                          background: '#1e1e1e', color: '#d4d4d4',
                          borderRadius: 4, fontSize: 11,
                          maxHeight: 200, overflow: 'auto',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {cancelPostResult}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* ── End API Info Panel ────────────────────────────────── */}
          </div>
        )}
      </Modal>
      {/* ── End Cancel Invoice Modal ──────────────────────────────────────── */}

      <style>{`
        .ant-table-thead > tr > th {
          background: ${REDWOOD.neutral100} !important;
          font-weight: 600;
          font-size: 11px;
          padding: 6px 8px !important;
          color: ${REDWOOD.neutral600};
        }
        .ant-table-tbody > tr > td {
          font-size: 12px;
          padding: 4px 8px !important;
        }
        .ant-input-number-borderless,
        .ant-input-borderless,
        .ant-select-borderless .ant-select-selector {
          background: transparent !important;
        }
        .ant-table-tbody > tr:hover > td {
          background: #fef7f6 !important;
        }
      `}</style>

      {/* ── Attachments Modal ───────────────────────────────────────────── */}
      <Modal
        open={attachmentModalOpen}
        onCancel={() => setAttachmentModalOpen(false)}
        footer={null}
        title={
          <Space>
            <PaperClipOutlined style={{ color: REDWOOD.primary }} />
            <span>
              Invoice Attachments
              {attachmentCount > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#888', fontWeight: 400 }}>
                  ({attachmentCount} file{attachmentCount !== 1 ? 's' : ''})
                </span>
              )}
            </span>
          </Space>
        }
        width={780}
        styles={{ body: { padding: '16px 24px', maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose={false}
      >
        <InvoiceAttachments
          invoiceId={savedInvoiceId || initialData?.invoiceId}
          readOnly={false}
          onCountChange={setAttachmentCount}
        />
      </Modal>

      {/* ── Multiperiod Schedule Modal ─────────────────────────────────── */}
      <Modal
        open={mpaModalOpen}
        onCancel={() => { setMpaModalOpen(false); setMpaSchedule([]); setMpaError(null); }}
        footer={null}
        title={
          <Space>
            <CalendarOutlined style={{ color: REDWOOD.primary }} />
            <span>Multiperiod Accounting Schedule</span>
            {mpaSchedule.length > 0 && (
              <>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  ({mpaSchedule.length} row{mpaSchedule.length !== 1 ? 's' : ''})
                </Text>
                <Tooltip title="Rebuild the schedule from the current saved lines">
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={mpaGenerating}
                    onClick={handleGenerateMpaFromModal}
                  >
                    Regenerate
                  </Button>
                </Tooltip>
              </>
            )}
          </Space>
        }
        width={900}
        styles={{ body: { padding: '12px 24px', maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        {mpaLoading && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        )}
        {mpaError && (
          <Alert type="warning" showIcon message="Could not load multiperiod schedule" description={mpaError} />
        )}
        {!mpaLoading && !mpaError && mpaSchedule.length === 0 && (
          <div style={{ margin: '16px 0' }}>
            <Alert
              type="info"
              showIcon
              message="No multiperiod schedule found for this invoice"
              description="Multiperiod schedule is generated from lines that have start/end dates spanning different months and an accrual account set. Click Generate to build it now."
            />
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={mpaGenerating}
                onClick={handleGenerateMpaFromModal}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
              >
                Generate Multiperiod Schedule
              </Button>
            </div>
          </div>
        )}
        {!mpaLoading && mpaSchedule.length > 0 && (() => {
          const totalAmt = mpaSchedule.reduce((s, l) => s + (l.periodAmount || 0), 0);
          const postedAmt = mpaSchedule.filter(l => l.postingStatus === 'Posted').reduce((s, l) => s + l.periodAmount, 0);
          const notPostedAmt = mpaSchedule.filter(l => l.postingStatus === 'Not Posted').reduce((s, l) => s + l.periodAmount, 0);
          return (
            <>
              <Row gutter={12} style={{ marginBottom: 12 }}>
                {[
                  { label: 'Total', value: totalAmt, color: '#000' },
                  { label: 'Posted', value: postedAmt, color: REDWOOD.success },
                  { label: 'Not Posted', value: notPostedAmt, color: REDWOOD.warning },
                ].map(s => (
                  <Col span={8} key={s.label}>
                    <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4, padding: '6px 12px' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{s.label}</Text>
                      <div style={{ fontSize: 14, fontWeight: 600, color: s.color }}>
                        {Number(s.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
              <Table
                dataSource={mpaSchedule}
                rowKey="scheduleId"
                size="small"
                pagination={false}
                scroll={{ x: 820 }}
                columns={[
                  {
                    title: 'Period', dataIndex: 'periodName', width: 90,
                    render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
                  },
                  { title: 'Line', dataIndex: 'lineNumber', width: 50, align: 'center' as const },
                  { title: 'Description', dataIndex: 'description', ellipsis: true,
                    render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                  {
                    title: 'Amount', dataIndex: 'periodAmount', width: 110, align: 'right' as const,
                    render: v => <Text strong style={{ fontSize: 12 }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>,
                  },
                  {
                    title: 'Charge A/C (Dr)', dataIndex: 'chargeAccount', width: 180, ellipsis: true,
                    render: v => <Text code style={{ fontSize: 10 }}>{v || '—'}</Text>,
                  },
                  {
                    title: 'Accrual A/C (Cr)', dataIndex: 'accrualAccount', width: 180, ellipsis: true,
                    render: v => <Text code style={{ fontSize: 10 }}>{v || '—'}</Text>,
                  },
                  {
                    title: 'Status', dataIndex: 'postingStatus', width: 110,
                    render: v => (
                      <Tag color={v === 'Posted' ? 'success' : v === 'Error' ? 'error' : 'warning'} style={{ fontSize: 11 }}>
                        {v}
                      </Tag>
                    ),
                  },
                  {
                    title: 'Posted By', width: 110, ellipsis: true,
                    render: (_, rec) => rec.postingStatus === 'Posted'
                      ? <Text type="secondary" style={{ fontSize: 11 }}>{rec.postedBy}</Text>
                      : null,
                  },
                ]}
              />
            </>
          );
        })()}
      </Modal>

      {/* Header Description Edit Modal */}
      <Modal
        title="Edit Description"
        open={headerDescModal}
        onOk={() => setHeaderDescModal(false)}
        onCancel={() => setHeaderDescModal(false)}
        width={500}
        destroyOnClose
      >
        <Form.Item style={{ marginBottom: 0 }}>
          <Input.TextArea
            rows={5}
            value={form.getFieldValue('description') || ''}
            onChange={(e) => {
              form.setFieldValue('description', e.target.value);
              // Also sync to non-manually-edited lines
              setLines((prev) => prev.map((line) => ({
                ...line,
                description: manuallyEditedDescLines.has(line.key)
                  ? line.description
                  : e.target.value,
              })));
            }}
            placeholder="Enter description"
          />
        </Form.Item>
      </Modal>

      {/* Line Description Edit Modal */}
      <Modal
        title="Edit Line Description"
        open={lineDescModal.open}
        onOk={() => {
          setManuallyEditedDescLines((prev) => new Set(prev).add(lineDescModal.lineKey));
          updateLine(lineDescModal.lineKey, 'description', lineDescModal.value);
          setLineDescModal({ open: false, lineKey: '', value: '' });
        }}
        onCancel={() => setLineDescModal({ open: false, lineKey: '', value: '' })}
        width={500}
        destroyOnClose
      >
        <Input.TextArea
          rows={5}
          value={lineDescModal.value}
          onChange={(e) => setLineDescModal((prev) => ({ ...prev, value: e.target.value }))}
          placeholder="Enter line description"
        />
      </Modal>
    </div>
  );
};

export default CreateInvoice;
