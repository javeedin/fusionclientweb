import React, { useState, useMemo, useEffect, useRef } from 'react';
import dayjs from 'dayjs';
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
  Tag,
  Row,
  Col,
  Breadcrumb,
  Tooltip,
  Dropdown,
  Collapse,
  message,
  DatePicker,
  InputNumber,
  Tabs,
  Modal,
  Checkbox,
  Statistic,
  Progress,
  Spin,
  List,
  Badge,
  Alert,
  Space as AntSpace,
  Descriptions,
  Radio,
  Drawer,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  ReloadOutlined,
  SaveOutlined,
  EditOutlined,
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  PrinterOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  FileTextOutlined,
  DollarOutlined,
  StopOutlined,
  SendOutlined,
  BankOutlined,
  SettingOutlined,
  CopyOutlined,
  ScissorOutlined,
  ApiOutlined,
  CheckOutlined,
  BugOutlined,
  AuditOutlined,
  CloudOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  WalletOutlined,
  CreditCardOutlined,
  LoadingOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FileZipOutlined,
  LinkOutlined,
  SyncOutlined,
  CalendarOutlined,
  AccountBookOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useShowAndTell } from '../../features/showAndTell';
import type { ColumnsType } from 'antd/es/table';
import FloatingMenu from '../../components/FloatingMenu';
import InvoiceDetail from './InvoiceDetail';
import CreateInvoice from './CreateInvoice';
import type { InvoiceInitialData } from './CreateInvoice';
import { APEX_DB_CONFIG, ORACLE_FUSION_CONFIG } from '../../config/api.config';
import { getApprovalRules, sendInvoiceApproval, type ApprovalUser, type ApprovalDebugStep } from '../../services/approvals.service';
import { getAccounting, buildApInvoiceSlaPayload, fetchLedgerByBusinessUnit, checkGLJournalExists } from '../../services/sla.service';
import { getGlJournalLines } from '../../services/glPosting.service';
import { validateAccountCode } from '../../components/AccountSelector';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

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
  reportGreen: '#1D7B4D',
};

// Invoice record interface
interface InvoiceRecord {
  key: string;
  invoiceId: number;
  supplierId: number;
  invoiceNumber: string;
  invoiceDate: string;
  creationDate: string;
  supplierOrParty: string;
  supplierSite: string;
  unpaidAmount: number;
  invoiceAmount: number;
  appliedPrepayments: number;
  invoiceType: string;
  attachments: string;
  notes: string;
  validationStatus: string;
  approvalStatus: string;
  holdPaidStatus: string;
  accountingStatus: string;
  applyAfterDate: string;
  businessUnit: string;
  invoiceCurrency: string;
  supplierNumber: string;
  paymentTerms: string;
  invoiceGroup: string;
  termsDate: string;
  goodsReceivedDate: string;
  liabilityDistribution: string;
  accountingDate: string;
  conversionRateType: string;
  conversionDate: string;
  conversionRate: number | null;
  paymentCurrency: string;
  syncStatus: string;
  // Audit / system info fields
  createdBy: string;
  lastUpdatedBy: string;
  lastUpdateDate: string;
  syncDate: string;
  cancellationDate: string;
  cancelledBy: string;
  deliveryChannelCode: string;
  deliveryChannel: string;
  firstPartyTaxRegistrationId: string;
  firstPartyTaxRegistrationNum: string;
  taxationCountry: string;
  documentCategory: string;
  documentSequence: number | string;
  voucherNumber: string;
  // Approval tracking
  approvalSentDate?: string;
  approvalSentBy?: string;
  approvalApproverName?: string;
  approvalApproverEmail?: string;
  approvedDate?: string;
  approvalRef?: string;
  hasMpa?: boolean;
}

// Tab item interface
interface InvoiceTab {
  key: string;
  label: string;
  invoice: InvoiceRecord;
  tabType?: 'detail' | 'create';
  initialData?: InvoiceInitialData;
}

// Supplier record from API
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

// APEX endpoint for invoices
const APEX_INVOICE_URL = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice`;
const APEX_SUPPLIERS_URL = `${APEX_DB_CONFIG.baseUrl}/suppliers`;

// Helper function to format amount in UAE format (000,000.00)
const formatAmount = (value: number): string => {
  return new Intl.NumberFormat('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

// Helper function to format currency
const formatCurrency = (amount: number, currency: string = 'AED'): string => {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

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

// Map API response to InvoiceRecord (API returns lowercase snake_case field names)
const mapApiToInvoiceRecord = (item: any, index: number): InvoiceRecord => ({
  key: item.invoice_id?.toString() || index.toString(),
  invoiceId: item.invoice_id,
  supplierId: item.supplier_id,
  invoiceNumber: item.invoice_number || '',
  invoiceDate: formatDate(item.invoice_date),
  creationDate: formatDate(item.creation_date || item.fusion_creation_date),
  supplierOrParty: item.supplier || item.party || '',
  supplierSite: item.supplier_site || '',
  unpaidAmount: item.unpaid_amount != null
    ? Number(item.unpaid_amount)
    : (item.invoice_amount || 0) - (item.amount_paid || 0),
  invoiceAmount: item.invoice_amount || 0,
  appliedPrepayments: item.applied_prepayments || 0,
  invoiceType: item.invoice_type || 'Standard',
  attachments: 'None',
  notes: item.description || '',
  validationStatus: item.validation_status || 'Never validated',
  approvalStatus: item.approval_status || 'Not required',
  holdPaidStatus: item.paid_status || 'Unpaid',
  accountingStatus: (item.invoice_source && item.invoice_source !== 'MANUAL') ? 'POSTED' : (item.accounting_status || 'Not Accounted'),
  applyAfterDate: item.apply_after_date || '',
  businessUnit: item.business_unit || '',
  invoiceCurrency: item.invoice_currency || 'AED',
  supplierNumber: item.supplier_number || '',
  paymentTerms: item.payment_terms || item.terms_name || '',
  invoiceGroup: item.invoice_group || '',
  termsDate: item.terms_date || '',
  goodsReceivedDate: item.goods_received_date || '',
  liabilityDistribution: item.liability_distribution || '',
  accountingDate: item.accounting_date || '',
  conversionRateType: item.conversion_rate_type || '',
  conversionDate: item.conversion_date || '',
  conversionRate: item.conversion_rate != null ? Number(item.conversion_rate) : null,
  paymentCurrency: item.payment_currency || item.invoice_currency || 'AED',
  // Invoices created in this app have invoice_source='MANUAL'.
  // Any other source (Oracle Fusion sync, import, etc.) is read-only.
  syncStatus: (item.invoice_source && item.invoice_source !== 'MANUAL') ? 'SYNCED' : '',
  // Audit / system info
  createdBy:                   item.created_by                      || '',
  lastUpdatedBy:               item.last_updated_by                 || '',
  lastUpdateDate:              item.last_update_date                || '',
  syncDate:                    item.sync_date                       || '',
  cancellationDate:            item.canceled_date                   || '',
  cancelledBy:                 item.canceled_by                     || '',
  deliveryChannelCode:         item.delivery_channel_code           || '',
  deliveryChannel:             item.delivery_channel                || '',
  firstPartyTaxRegistrationId: item.first_party_tax_registration_id || '',
  firstPartyTaxRegistrationNum:item.first_party_tax_registration_num|| '',
  taxationCountry:             item.taxation_country                || '',
  documentCategory:            item.document_category               || '',
  documentSequence:            item.document_sequence != null ? Number(item.document_sequence) || item.document_sequence : '',
  voucherNumber:               item.voucher_number                  || '',
  approvalSentDate:            item.approval_sent_date              || undefined,
  approvalSentBy:              item.approval_sent_by                || undefined,
  approvalApproverName:        item.approval_approver_name          || undefined,
  approvalApproverEmail:       item.approval_approver_email         || undefined,
  approvedDate:                item.approved_date                   || undefined,
  approvalRef:                 item.approval_ref                    || undefined,
  hasMpa:                      item.has_mpa === 'Y',
});

const ManageInvoices: React.FC = () => {
  const [form] = Form.useForm();
  const location = useLocation();
  const { user } = useAuth();
  const quickCreateHandled = useRef<string | null>(null);
  const { isRunning, activeTour } = useShowAndTell();
  const satTabOpened = useRef(false);
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [prepayBalances, setPrepayBalances] = useState<Record<number, number | null>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [businessUnits, setBusinessUnits] = useState<{ name: string }[]>([]);

  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        const items = (d.items || []).map((i: any) => ({ name: i.business_unit_name || '' })).filter((i: any) => i.name);
        setBusinessUnits(items);
      })
      .catch(() => {});
  }, []);

  // Tab management state
  const [activeTab, setActiveTab] = useState('search');
  const [openTabs, setOpenTabs] = useState<InvoiceTab[]>([]);

  // API viewer modal state
  const [apiModalVisible, setApiModalVisible] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [lastCalledUrl, setLastCalledUrl] = useState<string | null>(null);
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);
  const [apiExecResults, setApiExecResults] = useState<Record<number, { loading: boolean; response: string | null }>>({});

  // Invoice date operator state
  const [invoiceDateOp, setInvoiceDateOp] = useState<string>('=');

  // Supplier lookup modal state
  const [supplierModalVisible, setSupplierModalVisible] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [supplierSearchText, setSupplierSearchText] = useState('');

  // Quick-create invoice dialog state (triggered by Autopilot)
  const [quickCreateVisible, setQuickCreateVisible] = useState(false);
  const [quickCreateForm] = Form.useForm();
  const [qcSupplierModalVisible, setQcSupplierModalVisible] = useState(false);
  const [qcSupplierSearchText, setQcSupplierSearchText] = useState('');

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

  // Show/hide fully paid invoices
  const [showFullyPaid, setShowFullyPaid] = useState(true);

  // Attachment modal state
  const [attachModalVisible, setAttachModalVisible] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachInvoiceNum, setAttachInvoiceNum] = useState('');

  // Fusion Attachment Explorer state
  const [fusionAttachVisible, setFusionAttachVisible]     = useState(false);
  const [fusionAttachLoading, setFusionAttachLoading]     = useState(false);
  const [fusionAttachInvoice, setFusionAttachInvoice]     = useState('');
  const [fusionAttachItems, setFusionAttachItems]         = useState<any[]>([]);
  const [fusionAttachStep, setFusionAttachStep]           = useState<'idle'|'step1'|'step2'|'step3'|'done'|'error'>('idle');
  const [fusionAttachError, setFusionAttachError]         = useState('');
  const [fusionAttachLog, setFusionAttachLog]             = useState<string[]>([]);
  const [fusionDownloading, setFusionDownloading]         = useState<string | null>(null);

  // Applied Prepayments Fusion Fetch
  const [prepayFetchVisible,  setPrepayFetchVisible]  = useState(false);
  const [prepayFetchInvoice,  setPrepayFetchInvoice]  = useState<InvoiceRecord | null>(null);
  const [prepayFetchLoading,  setPrepayFetchLoading]  = useState(false);
  const [prepayFusionJson,    setPrepayFusionJson]    = useState('');
  const [prepayFusionItems,   setPrepayFusionItems]   = useState<any[]>([]);
  const [prepayMappedBody,    setPrepayMappedBody]    = useState('');
  const [prepayMappedItems,   setPrepayMappedItems]   = useState<any[]>([]);
  const [prepayFetchLog,      setPrepayFetchLog]      = useState<string[]>([]);
  const [prepayFetchError,    setPrepayFetchError]    = useState('');
  const [prepayFetchStep,     setPrepayFetchStep]     = useState<'idle'|'fetching'|'mapping'|'ready'|'posting'|'done'|'error'>('idle');
  const [prepayApexResult,    setPrepayApexResult]    = useState<any>(null);
  const [prepayApexLoading,   setPrepayApexLoading]   = useState(false);

  // ── Multi-fetch state ───────────────────────────────────────────────────────
  interface MultiFetchRow {
    key: React.Key;
    invoiceId: number;
    invoiceNumber: string;
    businessUnit: string;
    fusionStatus: 'idle' | 'fetching' | 'ok' | 'none' | 'error';
    fusionCount: number;
    fusionError?: string;
    apexStatus: 'idle' | 'posting' | 'ok' | 'error';
    apexInserted?: number;
    apexError?: string;
  }
  const [multiFetchVisible, setMultiFetchVisible] = useState(false);
  const [multiFetchRows,    setMultiFetchRows]    = useState<MultiFetchRow[]>([]);
  const [multiFetchRunning, setMultiFetchRunning] = useState(false);

  // Filtered invoices based on fully paid toggle
  const [tableSearch,     setTableSearch]     = useState('');
  const [payMethodFilter, setPayMethodFilter] = useState<'all'|'payment'|'prepayment'|'mixed'>('all');
  const [acctFilter,      setAcctFilter]      = useState<'all'|'posted'|'unposted'>('all');
  const [createdByFilter, setCreatedByFilter] = useState<string>('');
  const [knownUsers,      setKnownUsers]      = useState<string[]>([]);

  useEffect(() => {
    const uname = user?.username;
    if (uname && createdByFilter === '') setCreatedByFilter(uname);
  }, [user?.username]);

  // ── Invoice Approval state ──────────────────────────────────────────────────
  const [invApprovalOpen,      setInvApprovalOpen]      = useState(false);
  const [invApprovalTarget,    setInvApprovalTarget]    = useState<InvoiceRecord | null>(null);
  const [invApprovalUsers,     setInvApprovalUsers]     = useState<ApprovalUser[]>([]);
  const [invApprovalLoading,   setInvApprovalLoading]   = useState(false);
  const [invApprovalSending,   setInvApprovalSending]   = useState(false);
  const [invSelectedApprover,  setInvSelectedApprover]  = useState<string | undefined>(undefined);
  const [invDebugSteps,        setInvDebugSteps]        = useState<ApprovalDebugStep[]>([]);
  const [invDebugOpen,         setInvDebugOpen]         = useState(false);
  const [invStatusOpen,        setInvStatusOpen]        = useState(false);
  const [invStatusTarget,      setInvStatusTarget]      = useState<InvoiceRecord | null>(null);

  // ── MPA Detail modal ───────────────────────────────────────────────────────
  const [mpaModalOpen,    setMpaModalOpen]    = useState(false);
  const [mpaModalRecord,  setMpaModalRecord]  = useState<InvoiceRecord | null>(null);
  const [mpaModalData,    setMpaModalData]    = useState<import('../../services/multiperiod.service').MpaInvoiceDetail | null>(null);
  const [mpaModalLoading, setMpaModalLoading] = useState(false);

  // Accounting features state
  const [accountingAllModalOpen, setAccountingAllModalOpen] = useState(false);
  const [accountingAllData, setAccountingAllData] = useState<Array<{
    invoiceNumber: string;
    invoiceId: number;
    invoiceDate: string;
    debits: number;
    credits: number;
    debitAccount: string;
    creditAccount: string;
    lines: any[];
    glBatchId?: number | null;
    glHeaderId?: number | null;
    reference1?: string;
    reference2?: string;
    reference3?: string;
    reference4?: string;
    reference5?: string;
    glLines?: any[];
  }>>([]);
  const [accountingAllLoading, setAccountingAllLoading] = useState(false);
  const [accountingApiDebugOpen, setAccountingApiDebugOpen] = useState(false);
  const [apiTestInvoiceId, setApiTestInvoiceId] = useState('');
  const [apiTestLoading, setApiTestLoading] = useState(false);
  const [apiTestResponse, setApiTestResponse] = useState<any>(null);
  const [apiTestError, setApiTestError] = useState('');
  const [accountingSingleModalOpen, setAccountingSingleModalOpen] = useState(false);
  const [accountingSingleInvoice, setAccountingSingleInvoice] = useState<InvoiceRecord | null>(null);
  const [accountingSingleData, setAccountingSingleData] = useState<any>(null);
  const [accountingSingleLoading, setAccountingSingleLoading] = useState(false);

  // Preview modal state for Re-Create Accounting
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<any>(null);
  const [previewConfirming, setPreviewConfirming] = useState(false);
  const [previewCreationSteps, setPreviewCreationSteps] = useState<Array<{ step: string; status: 'pending' | 'in-progress' | 'completed' | 'error'; message?: string }>>([]);
  const [previewDebugSteps, setPreviewDebugSteps] = useState<Array<{ step: string; method: string; url: string; requestBody?: any; status?: number; response?: any; loading?: boolean }>>([]);
  const [previewDebugOpen, setPreviewDebugOpen] = useState(false);
  const [previewSlaHeaderId, setPreviewSlaHeaderId] = useState<number | null>(null);
  const [previewGlBatchId, setPreviewGlBatchId] = useState<number | null>(null);
  const [previewSlaCheckResponse, setPreviewSlaCheckResponse] = useState<any>(null);
  const [previewGlCheckResponse, setPreviewGlCheckResponse] = useState<any>(null);
  const [previewGlHeaderId, setPreviewGlHeaderId] = useState<number | null>(null);
  const [previewGlBatchName, setPreviewGlBatchName] = useState<string>('');
  const [manualSlaDeleteId, setManualSlaDeleteId] = useState<string>('');
  const [manualGlDeleteId, setManualGlDeleteId] = useState<string>('');
  const [slaDuplicateExists, setSlaDuplicateExists] = useState(false);
  const [glDuplicateExists, setGlDuplicateExists] = useState(false);
  const [executingStepIdx, setExecutingStepIdx] = useState<number | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [accountingAllSelectedKeys, setAccountingAllSelectedKeys] = useState<React.Key[]>([]);
  const [batchProgressModalOpen, setBatchProgressModalOpen] = useState(false);
  const [batchProgressData, setBatchProgressData] = useState<any[]>([]);
  const [batchConfirmed, setBatchConfirmed] = useState(false);


  const openMpaModal = async (record: InvoiceRecord) => {
    setMpaModalRecord(record);
    setMpaModalData(null);
    setMpaModalOpen(true);
    setMpaModalLoading(true);
    try {
      const { getMpaSchedule } = await import('../../services/multiperiod.service');
      const detail = await getMpaSchedule(record.invoiceId);
      setMpaModalData(detail);
    } catch {
      setMpaModalData(null);
    } finally {
      setMpaModalLoading(false);
    }
  };

  // ── Invoice Approval handlers ───────────────────────────────────────────────
  const openInvApprovalModal = async (record: InvoiceRecord) => {
    setInvApprovalTarget(record);
    setInvSelectedApprover(undefined);
    setInvDebugSteps([]);
    setInvDebugOpen(false);
    setInvApprovalLoading(true);
    setInvApprovalOpen(true);
    try {
      const rules = await getApprovalRules('AP');
      const invoiceRules = rules.filter(r => r.transactionType === 'INVOICE' && r.active === 'Y');
      const seen = new Set<string>();
      const users: ApprovalUser[] = [];
      for (const rule of invoiceRules) {
        for (const approver of rule.approvers) {
          if (!seen.has(approver.email)) {
            seen.add(approver.email);
            users.push({
              userId: approver.userId,
              fullName: approver.fullName,
              email: approver.email,
              department: approver.department,
              modules: ['AP'],
              active: 'Y',
              currency: 'AED',
            });
          }
        }
      }
      setInvApprovalUsers(users);
    } catch (e: any) {
      message.error(`Failed to load approvers: ${e.message}`);
    } finally {
      setInvApprovalLoading(false);
    }
  };

  const APPROVAL_ACTIONED_STATUSES = ['PENDING', 'Manually approved', 'Rejected', 'Workflow approved'];

  const handleInvSendApproval = async () => {
    if (!invApprovalTarget || !invSelectedApprover) return;
    const approver = invApprovalUsers.find(u => u.email === invSelectedApprover);
    if (!approver) return;
    setInvApprovalSending(true);

    let attachmentContent: string | undefined;
    let attachmentName: string | undefined;

    // Generate PDF with invoice header + lines (non-blocking if it fails)
    try {
      const linesUrl = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${invApprovalTarget.invoiceId}`;
      const linesRes = await fetch(linesUrl, { headers: { Accept: 'application/json' } });
      const linesData = await linesRes.json().catch(() => ({}));
      const lines: any[] = linesData.items || linesData || [];

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();

      // Blue header bar
      doc.setFillColor(0, 86, 179);
      doc.rect(0, 0, pageW, 36, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('AP Invoice', 14, 16);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Ref: AP-INV-${invApprovalTarget.invoiceId}  |  Generated: ${new Date().toLocaleDateString('en-AE')}`, 14, 27);

      // Invoice details table
      doc.setTextColor(0, 0, 0);
      let y = 46;
      const detailRows: [string, string][] = [
        ['Invoice Number', invApprovalTarget.invoiceNumber],
        ['Invoice Date',   invApprovalTarget.invoiceDate  || '—'],
        ['Invoice Type',   invApprovalTarget.invoiceType],
        ['Business Unit',  invApprovalTarget.businessUnit || '—'],
        ['Supplier',       invApprovalTarget.supplierOrParty],
        ['Amount',         `${formatAmount(invApprovalTarget.invoiceAmount)} ${invApprovalTarget.invoiceCurrency}`],
        ['Description',    invApprovalTarget.notes        || '—'],
        ['Created By',     invApprovalTarget.createdBy    || '—'],
      ];
      for (const [label, value] of detailRows) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 80, 80);
        doc.text(label, 14, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        const wrapped = doc.splitTextToSize(value, pageW - 80);
        doc.text(wrapped, 72, y);
        y += 7 * wrapped.length;
      }

      // Invoice lines table
      if (lines.length > 0) {
        autoTable(doc, {
          startY: y + 4,
          head: [['Line #', 'Type', 'Description', 'Qty', 'Unit Price', 'Amount']],
          body: lines.map((l: any) => [
            String(l.line_number ?? ''),
            l.line_type ?? '',
            l.description ?? '',
            l.quantity != null ? String(l.quantity) : '—',
            l.unit_price != null ? formatAmount(Number(l.unit_price)) : '—',
            l.line_amount != null ? formatAmount(Number(l.line_amount)) : '—',
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [0, 86, 179], textColor: [255, 255, 255] },
          alternateRowStyles: { fillColor: [240, 247, 255] },
        });
      }

      // Convert to base64
      const pdfBytes = doc.output('arraybuffer');
      const uint8 = new Uint8Array(pdfBytes);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      attachmentContent = btoa(binary);
      attachmentName    = `Invoice-${invApprovalTarget.invoiceNumber}.pdf`;
    } catch (pdfErr) {
      console.warn('PDF generation skipped:', pdfErr);
    }

    try {
      const result = await sendInvoiceApproval({
        invoiceId:         invApprovalTarget.invoiceId,
        invoiceNumber:     invApprovalTarget.invoiceNumber,
        invoiceType:       invApprovalTarget.invoiceType,
        amount:            invApprovalTarget.invoiceAmount,
        currency:          invApprovalTarget.invoiceCurrency,
        supplier:          invApprovalTarget.supplierOrParty,
        approverEmail:     approver.email,
        approverName:      approver.fullName || approver.email,
        sentBy:            user?.name || user?.email || 'ERP User',
        businessUnit:      invApprovalTarget.businessUnit,
        invoiceDate:       invApprovalTarget.invoiceDate,
        description:       invApprovalTarget.notes,
        createdBy:         invApprovalTarget.createdBy,
        attachmentContent,
        attachmentName,
      });
      setInvDebugSteps(result.debug ?? []);
      if (result.success) {
        message.success(`Approval request sent to ${approver.fullName || approver.email}`);
        setInvoices(prev => prev.map(inv =>
          inv.invoiceId === invApprovalTarget.invoiceId
            ? { ...inv, approvalStatus: 'PENDING', approvalApproverEmail: approver.email, approvalApproverName: approver.fullName }
            : inv
        ));
        setInvApprovalOpen(false);
      } else {
        setInvDebugOpen(true);
        message.error(result.message);
      }
    } catch (e: any) {
      message.error(`Send failed: ${e.message}`);
    } finally {
      setInvApprovalSending(false);
    }
  };

  const getPayMethod = (inv: InvoiceRecord): 'payment' | 'prepayment' | 'mixed' | 'open' => {
    const hasPrepay  = (inv.appliedPrepayments ?? 0) > 0;
    const paidByPmt  = (inv.invoiceAmount ?? 0) - (inv.unpaidAmount ?? 0) - (inv.appliedPrepayments ?? 0) > 0.001;
    if (hasPrepay && paidByPmt) return 'mixed';
    if (hasPrepay)              return 'prepayment';
    if (paidByPmt)              return 'payment';
    return 'open';
  };

  const displayedInvoices = useMemo(() => {
    let list = showFullyPaid ? invoices : invoices.filter(inv => inv.unpaidAmount !== 0);
    if (tableSearch.trim()) {
      const q = tableSearch.trim().toLowerCase();
      list = list.filter(inv =>
        inv.invoiceNumber?.toLowerCase().includes(q)  ||
        inv.supplierOrParty?.toLowerCase().includes(q) ||
        inv.supplierSite?.toLowerCase().includes(q)    ||
        inv.businessUnit?.toLowerCase().includes(q)    ||
        inv.invoiceType?.toLowerCase().includes(q)
      );
    }
    if (payMethodFilter !== 'all') {
      list = list.filter(inv => getPayMethod(inv) === payMethodFilter);
    }
    if (acctFilter !== 'all') {
      // Posted = accounting complete ("POSTED"/"Accounted", any case);
      // Unposted = everything else (Not Accounted, Draft, Unposted, Error, …).
      const isPosted = (s?: string) => {
        const v = String(s || '').trim().toLowerCase();
        return v === 'posted' || v === 'accounted' || v === 'final accounted';
      };
      list = list.filter(inv => acctFilter === 'posted' ? isPosted(inv.accountingStatus) : !isPosted(inv.accountingStatus));
    }
    if (createdByFilter) {
      list = list.filter(inv => inv.createdBy === createdByFilter);
    }
    return list;
  }, [invoices, showFullyPaid, tableSearch, payMethodFilter, acctFilter, createdByFilter]);

  // Compute totals for amount columns (based on displayed invoices)
  const totals = useMemo(() => {
    return displayedInvoices.reduce(
      (acc, inv) => ({
        unpaidAmount: acc.unpaidAmount + (inv.unpaidAmount || 0),
        invoiceAmount: acc.invoiceAmount + (inv.invoiceAmount || 0),
        appliedPrepayments: acc.appliedPrepayments + (inv.appliedPrepayments || 0),
      }),
      { unpaidAmount: 0, invoiceAmount: 0, appliedPrepayments: 0 }
    );
  }, [displayedInvoices]);

  // Export invoices to Excel
  const exportToExcel = () => {
    if (invoices.length === 0) {
      message.warning('No data to export');
      return;
    }

    const exportData = invoices.map((inv) => ({
      'Invoice Number': inv.invoiceNumber,
      'Invoice Date': inv.invoiceDate,
      'Creation Date': inv.creationDate,
      'Supplier or Party': inv.supplierOrParty,
      'Supplier Site': inv.supplierSite,
      'Unpaid Amount': inv.unpaidAmount,
      'Invoice Amount': inv.invoiceAmount,
      'Applied Prepayments': inv.appliedPrepayments,
      'Invoice Currency': inv.invoiceCurrency,
      'Invoice Type': inv.invoiceType,
      'Notes': inv.notes,
      'Validation Status': inv.validationStatus,
      'Approval Status': inv.approvalStatus,
      'Hold Paid Status': inv.holdPaidStatus,
      'Business Unit': inv.businessUnit,
    }));

    // Add totals row
    exportData.push({
      'Invoice Number': 'TOTALS',
      'Invoice Date': '',
      'Creation Date': '',
      'Supplier or Party': '',
      'Supplier Site': '',
      'Unpaid Amount': totals.unpaidAmount,
      'Invoice Amount': totals.invoiceAmount,
      'Applied Prepayments': totals.appliedPrepayments,
      'Invoice Currency': '',
      'Invoice Type': '',
      'Notes': '',
      'Validation Status': '',
      'Approval Status': '',
      'Hold Paid Status': '',
      'Business Unit': '',
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 14 },
      { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 14 },
      { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 28 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoices');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Invoices_${new Date().toISOString().slice(0, 10)}.xlsx`);
    message.success('Exported to Excel successfully');
  };

  // Fetch suppliers from API
  const fetchSuppliers = async () => {
    setSupplierLoading(true);
    try {
      const response = await fetch(APEX_SUPPLIERS_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

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
      message.error(`Failed to fetch suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSupplierLoading(false);
    }
  };

  // Open supplier lookup modal
  const openSupplierModal = () => {
    setSupplierModalVisible(true);
    setSupplierSearchText('');
    if (suppliers.length === 0) {
      fetchSuppliers();
    }
  };

  // Handle supplier selection
  const handleSupplierSelect = (record: SupplierRecord) => {
    form.setFieldsValue({
      supplierOrParty: record.supplier,
      supplierNumber: record.supplierNumber,
    });
    setSupplierModalVisible(false);
    message.success(`Selected supplier: ${record.supplier}`);
  };

  // Filtered suppliers based on search text
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

  // Supplier table columns
  const supplierColumns: ColumnsType<SupplierRecord> = [
    {
      title: 'Supplier Number',
      dataIndex: 'supplierNumber',
      key: 'supplierNumber',
      width: 130,
      sorter: (a, b) => a.supplierNumber.localeCompare(b.supplierNumber),
    },
    {
      title: 'Supplier Name',
      dataIndex: 'supplier',
      key: 'supplier',
      width: 280,
      ellipsis: true,
      sorter: (a, b) => a.supplier.localeCompare(b.supplier),
    },
    {
      title: 'Alternative Name',
      dataIndex: 'alternativeName',
      key: 'alternativeName',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{status}</Tag>
      ),
      filters: [
        { text: 'ACTIVE', value: 'ACTIVE' },
        { text: 'INACTIVE', value: 'INACTIVE' },
      ],
      onFilter: (value, record) => record.status === value,
    },
    {
      title: 'Taxpayer ID',
      dataIndex: 'taxpayerId',
      key: 'taxpayerId',
      width: 120,
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      render: (_: any, record: SupplierRecord) => (
        <Button
          type="link"
          size="small"
          onClick={() => handleSupplierSelect(record)}
          style={{ color: REDWOOD.info }}
        >
          Select
        </Button>
      ),
    },
  ];

  // Quick-create supplier filtering (reuse loaded suppliers)
  const qcFilteredSuppliers = useMemo(() => {
    if (!qcSupplierSearchText) return suppliers;
    const search = qcSupplierSearchText.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.supplier.toLowerCase().includes(search) ||
        s.supplierNumber.toLowerCase().includes(search) ||
        (s.alternativeName && s.alternativeName.toLowerCase().includes(search))
    );
  }, [suppliers, qcSupplierSearchText]);

  // Quick-create supplier select
  const handleQcSupplierSelect = (record: SupplierRecord) => {
    quickCreateForm.setFieldsValue({
      supplier: record.supplier,
      supplierNumber: record.supplierNumber,
    });
    setQcSupplierModalVisible(false);
  };

  // Quick-create submit
  const handleQuickCreateSubmit = async () => {
    try {
      const values = await quickCreateForm.validateFields();
      const initialData: InvoiceInitialData = {
        supplier: values.supplier,
        supplierNumber: values.supplierNumber,
        businessUnit: values.businessUnit,
        invoiceNumber: values.invoiceNumber,
        invoiceAmount: values.invoiceAmount,
        invoiceDate: values.invoiceDate,
        description: values.description,
        taxCode: values.taxCode,
        includingTax: values.includingTax || false,
      };

      // If tax code is VAT 5% and "Including Tax" is not checked, suggest the correct amount
      if (values.taxCode === 'VAT 5%' && !values.includingTax && values.invoiceAmount > 0) {
        const taxRate = 5;
        const taxAmount = Math.round(values.invoiceAmount * (taxRate / 100) * 100) / 100;
        const correctedAmount = Math.round((values.invoiceAmount + taxAmount) * 100) / 100;

        Modal.confirm({
          title: 'Invoice Amount Does Not Include Tax',
          icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
          content: (
            <div style={{ marginTop: 12 }}>
              <p>The entered amount <strong>{values.invoiceAmount.toFixed(2)}</strong> does not include VAT 5%.</p>
              <p>Correct amount with tax: <strong style={{ color: '#c74634', fontSize: 16 }}>{correctedAmount.toFixed(2)}</strong></p>
              <p style={{ fontSize: 12, color: '#666' }}>
                (Amount: {values.invoiceAmount.toFixed(2)} + VAT 5%: {taxAmount.toFixed(2)} = {correctedAmount.toFixed(2)})
              </p>
              <p>Would you like to use the corrected amount?</p>
            </div>
          ),
          okText: 'Yes, use corrected amount',
          cancelText: 'No, keep original',
          onOk: () => {
            initialData.invoiceAmount = correctedAmount;
            initialData.includingTax = true;
            setQuickCreateVisible(false);
            quickCreateForm.resetFields();
            openCreateInvoiceTab(initialData);
          },
          onCancel: () => {
            setQuickCreateVisible(false);
            quickCreateForm.resetFields();
            openCreateInvoiceTab(initialData);
          },
        });
        return;
      }

      setQuickCreateVisible(false);
      quickCreateForm.resetFields();
      openCreateInvoiceTab(initialData);
    } catch {
      // validation errors shown by form
    }
  };

  // Fetch supplier balance dashboard (summary + aging)
  const fetchBalanceDashboard = async (supplierNumber: string) => {
    setBalanceLoading(true);
    setBalanceSummary(null);
    setAgingReport([]);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/dashboard/${supplierNumber}`;
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

  // Fetch supplier balance invoices
  const fetchBalanceInvoices = async (supplierNumber: string) => {
    setBalanceInvoicesLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/invoices/${supplierNumber}`;
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
  const fetchBalancePayments = async (supplierNumber: string) => {
    setBalancePaymentsLoading(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/suppliers/balance/payments/${supplierNumber}`;
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

  // Open supplier balance popup
  const handleCheckBalance = () => {
    const supplierName = quickCreateForm.getFieldValue('supplier');
    const supplierNum = quickCreateForm.getFieldValue('supplierNumber');
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
    fetchBalanceDashboard(supplierNum);
    fetchBalanceInvoices(supplierNum);
  };

  // Handle balance tab change (lazy-load payments)
  const handleBalanceTabChange = (key: string) => {
    setBalanceActiveTab(key);
    if (key === 'payments' && balancePayments.length === 0 && !balancePaymentsLoading) {
      fetchBalancePayments(balanceSupplierNumber);
    }
  };

  // ── Attachment helpers ────────────────────────────────────────────────────
  const FUSION_HOST = 'https://iaaobn.fa.ocs.oraclecloud.com';

  const fetchAttachments = async (invoiceId: number, invoiceNum: string) => {
    setAttachments([]);
    setAttachLoading(true);
    setAttachInvoiceNum(invoiceNum);
    setAttachModalVisible(true);
    try {
      const creds = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
      const url = `${ORACLE_FUSION_CONFIG.baseUrl}/invoices/${invoiceId}/child/attachments`;
      const res = await fetch(url, { headers: { 'Authorization': `Basic ${creds}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAttachments(data.items || []);
    } catch (e: any) {
      message.error(`Failed to load attachments: ${e.message}`);
    } finally {
      setAttachLoading(false);
    }
  };

  // Authenticated fetch → blob download. All Fusion file links require Basic auth.
  const downloadFusionFile = async (href: string, fileName: string) => {
    setFusionDownloading(href);
    try {
      const creds = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
      const res = await fetch(href, { headers: { 'Authorization': `Basic ${creds}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      message.success(`Downloaded: ${fileName}`);
    } catch (e: any) {
      message.error(`Download failed: ${e.message}`);
    } finally {
      setFusionDownloading(null);
    }
  };

  const downloadAttachment = async (att: any) => {
    const fileName = att.FileName || att.Title || 'attachment';
    const links: any[] = att.links || [];
    // Prefer enclosure/FileContents, then any enclosure, then FileUrl
    const encLink = links.find((l: any) => l.rel === 'enclosure' && l.name === 'FileContents')
                 || links.find((l: any) => l.rel === 'enclosure');
    const href = encLink?.href || (att.FileUrl ? FUSION_HOST + att.FileUrl : null);
    if (!href) { message.warning('No download link available for this attachment'); return; }
    await downloadFusionFile(href, fileName);
  };

  const getFileIcon = (contentType: string, fileName: string) => {
    const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
    if (contentType?.includes('pdf') || ext === 'pdf')   return <FilePdfOutlined style={{ color: '#E53935', fontSize: 20 }} />;
    if (contentType?.includes('image') || ['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) return <FileImageOutlined style={{ color: '#1E88E5', fontSize: 20 }} />;
    if (['xls','xlsx'].includes(ext))  return <FileExcelOutlined style={{ color: '#1D7B4D', fontSize: 20 }} />;
    if (['doc','docx'].includes(ext))  return <FileWordOutlined  style={{ color: '#1565C0', fontSize: 20 }} />;
    if (['zip','rar','7z'].includes(ext)) return <FileZipOutlined style={{ color: '#F57C00', fontSize: 20 }} />;
    return <FileOutlined style={{ color: '#6B6B6B', fontSize: 20 }} />;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Fusion Attachment Explorer ────────────────────────────────────────────
  const fetchFusionAttachments = async (invoiceNumber: string) => {
    setFusionAttachInvoice(invoiceNumber);
    setFusionAttachItems([]);
    setFusionAttachLog([]);
    setFusionAttachError('');
    setFusionAttachStep('step1');
    setFusionAttachVisible(true);
    setFusionAttachLoading(true);

    const log: string[] = [];
    const addLog = (line: string) => { log.push(line); setFusionAttachLog([...log]); };

    try {
      const creds = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
      const headers = { 'Authorization': `Basic ${creds}`, 'Accept': 'application/json' };

      // Step 1: Query Fusion invoice by number
      const step1Url = `${ORACLE_FUSION_CONFIG.baseUrl}/invoices?q=InvoiceNumber=${encodeURIComponent(invoiceNumber)}`;
      addLog(`[Step 1] GET ${step1Url}`);
      const res1 = await fetch(step1Url, { headers });
      if (!res1.ok) throw new Error(`Step 1 failed: HTTP ${res1.status}`);
      const data1 = await res1.json();
      const invoiceItem = (data1.items || [])[0];
      if (!invoiceItem) throw new Error(`No Fusion invoice found for number: ${invoiceNumber}`);
      addLog(`[Step 1] Found invoice — InvoiceId: ${invoiceItem.InvoiceId || '?'}, ${(invoiceItem.links || []).length} links`);

      // Step 2: Extract attachments child link
      setFusionAttachStep('step2');
      const attachLink = (invoiceItem.links || []).find((l: any) => l.rel === 'child' && l.name === 'attachments');
      if (!attachLink) throw new Error('No attachments child link found on invoice');
      const attachHref: string = attachLink.href;
      addLog(`[Step 2] Attachments href: ${attachHref}`);

      // Step 3: Fetch attachments list
      setFusionAttachStep('step3');
      addLog(`[Step 3] GET ${attachHref}`);
      const res2 = await fetch(attachHref, { headers });
      if (!res2.ok) throw new Error(`Step 3 failed: HTTP ${res2.status}`);
      const data2 = await res2.json();
      const items: any[] = data2.items || [];
      addLog(`[Done] ${items.length} attachment(s) found`);
      setFusionAttachItems(items);
      setFusionAttachStep('done');
    } catch (e: any) {
      addLog(`[Error] ${e.message}`);
      setFusionAttachError(e.message);
      setFusionAttachStep('error');
    } finally {
      setFusionAttachLoading(false);
    }
  };

  // ── Fetch Applied Prepayments from Oracle Fusion ────────────────────────────
  const openPrepayFetch = (record: InvoiceRecord) => {
    setPrepayFetchInvoice(record);
    setPrepayFusionJson('');
    setPrepayFusionItems([]);
    setPrepayMappedBody('');
    setPrepayMappedItems([]);
    setPrepayFetchLog([]);
    setPrepayFetchError('');
    setPrepayFetchStep('idle');
    setPrepayApexResult(null);
    setPrepayFetchVisible(true);
  };

  const runPrepayFetch = async (record: InvoiceRecord) => {
    setPrepayFetchLoading(true);
    setPrepayFetchStep('fetching');
    const log: string[] = [];
    const addLog = (line: string) => { log.push(line); setPrepayFetchLog([...log]); };

    try {
      const creds = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);

      // Step 1: Fetch appliedPrepayments child from Fusion
      const fusionUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/invoices/${record.invoiceId}/child/appliedPrepayments`;
      addLog(`GET ${fusionUrl}`);
      const fusRes = await fetch(fusionUrl, {
        headers: { Authorization: `Basic ${creds}`, Accept: 'application/json' },
      });
      if (!fusRes.ok) throw new Error(`Fusion returned HTTP ${fusRes.status} ${fusRes.statusText}`);
      const fusData = await fusRes.json();
      const items: any[] = fusData.items || [];
      addLog(`✓ Fusion returned ${items.length} item(s)`);
      setPrepayFusionJson(JSON.stringify(fusData, null, 2));
      setPrepayFusionItems(items);

      if (items.length === 0) {
        setPrepayFetchStep('ready');
        setPrepayFetchLoading(false);
        return;
      }

      // Step 2: For each item, look up the prepayment invoice ID in APEX by InvoiceNumber
      setPrepayFetchStep('mapping');
      addLog('Looking up prepayment invoice IDs in APEX...');
      const uniqueNumbers = [...new Set(items.map((i: any) => i.InvoiceNumber).filter(Boolean))];
      const apexLookup: Record<string, number | null> = {};
      for (const num of uniqueNumbers) {
        try {
          const lookupUrl = `${APEX_INVOICE_URL}?invoice_number=${encodeURIComponent(num)}`;
          addLog(`  GET ${lookupUrl}`);
          const lr = await fetch(lookupUrl, { headers: { Accept: 'application/json' } });
          const ld = await lr.json();
          const found = (ld.items || ld || [])[0];
          apexLookup[num] = found ? (found.invoice_id || found.invoiceId || null) : null;
          addLog(`  ${num} → invoice_id: ${apexLookup[num] ?? 'NOT FOUND'}`);
        } catch {
          apexLookup[num] = null;
          addLog(`  ${num} → lookup failed`);
        }
      }

      // Step 3: Build APEX POST body
      const today = new Date().toISOString().slice(0, 10);
      // Field names must match exactly what JSON_VALUE expects in RR_AP_APPLIED_PREPAYMENTS_PKG
      // (PascalCase, case-sensitive JSON paths)
      const mappedItems = items.map((i: any) => ({
        PrepaymentApplicationId:  i.PayablesApplicationId ?? i.PayablesApplication ?? null,
        InvoiceId:                record.invoiceId,
        InvoiceNumber:            record.invoiceNumber,
        PrepaymentInvoiceId:      i.InvoiceNumber ? (apexLookup[i.InvoiceNumber] ?? null) : null,
        PrepaymentNumber:         i.InvoiceNumber ?? null,
        LineNumber:               i.LineNumber ?? null,
        PrepaymentLineNumber:     i.PrepaymentLineNumber ?? null,
        Description:              i.Description ?? null,
        BusinessUnit:             record.businessUnit ?? null,
        SupplierSite:             record.supplierSite || i.SupplierSite || null,
        PurchaseOrder:            i.PurchaseOrder ?? null,
        Currency:                 i.Currency ?? null,
        AppliedAmount:            i.AppliedAmount ?? null,
        IncludedTax:              i.IncludedTax ?? null,
        IncludedonInvoiceFlag:    i.IncludedonInvoiceFlag ? 'Y' : 'N',
        ApplicationAccountingDate: i.ApplicationAccountingDate ?? null,
        Status:                   'Applied',
        CreatedBy:                'FUSION_SYNC',
        CreationDate:             today,
        LastUpdatedBy:            'FUSION_SYNC',
        LastUpdateDate:           today,
      }));

      const apexBody = { items: mappedItems };
      setPrepayMappedItems(mappedItems);
      setPrepayMappedBody(JSON.stringify(apexBody, null, 2));
      addLog(`✓ Mapped ${mappedItems.length} item(s) → ready to POST to APEX`);
      setPrepayFetchStep('ready');
    } catch (e: any) {
      setPrepayFetchError(e.message);
      setPrepayFetchStep('error');
    } finally {
      setPrepayFetchLoading(false);
    }
  };

  const runPrepayApexPost = async () => {
    if (!prepayMappedItems.length) return;
    setPrepayApexLoading(true);
    setPrepayFetchStep('posting');
    try {
      const apexUrl = `${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments`;
      const body = { items: prepayMappedItems };
      const res = await fetch(apexUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setPrepayApexResult({ ok: res.ok, status: res.status, data });
      setPrepayFetchStep('done');
      if (res.ok && (data.status === 'success' || data.inserted >= 0)) {
        message.success(`Applied prepayments saved — ${data.inserted ?? prepayMappedItems.length} record(s)`);
      } else {
        message.warning(`APEX responded with: ${data.message || data.error || 'unknown result'}`);
      }
    } catch (e: any) {
      setPrepayApexResult({ ok: false, status: 0, data: { message: e.message } });
      setPrepayFetchStep('error');
      message.error(`APEX POST failed: ${e.message}`);
    } finally {
      setPrepayApexLoading(false);
    }
  };

  // ── Multi-fetch: open modal ─────────────────────────────────────────────────
  const openMultiFetch = () => {
    const rows: MultiFetchRow[] = selectedRowKeys
      .map(k => invoices.find(i => i.key === k))
      .filter(Boolean)
      .map(rec => ({
        key:           rec!.key,
        invoiceId:     rec!.invoiceId,
        invoiceNumber: rec!.invoiceNumber,
        businessUnit:  rec!.businessUnit ?? '',
        fusionStatus:  'idle' as const,
        fusionCount:   0,
        apexStatus:    'idle' as const,
      }));
    setMultiFetchRows(rows);
    setMultiFetchRunning(false);
    setMultiFetchVisible(true);
  };

  // ── Multi-fetch: process all rows sequentially ──────────────────────────────
  const runMultiFetch = async () => {
    setMultiFetchRunning(true);
    const creds   = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
    const today   = new Date().toISOString().slice(0, 10);

    const updateRow = (invoiceId: number, patch: Partial<MultiFetchRow>) =>
      setMultiFetchRows(prev => prev.map(r => r.invoiceId === invoiceId ? { ...r, ...patch } : r));

    for (const row of multiFetchRows) {
      // ── Step 1: Fusion fetch ──
      updateRow(row.invoiceId, { fusionStatus: 'fetching' });
      let fusionItems: any[] = [];
      try {
        const fusionUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/invoices/${row.invoiceId}/child/appliedPrepayments`;
        const fusRes = await fetch(fusionUrl, {
          headers: { Authorization: `Basic ${creds}`, Accept: 'application/json' },
        });
        if (!fusRes.ok) throw new Error(`HTTP ${fusRes.status}`);
        const fusData = await fusRes.json();
        fusionItems = fusData.items || [];
        updateRow(row.invoiceId, {
          fusionStatus: fusionItems.length === 0 ? 'none' : 'ok',
          fusionCount:  fusionItems.length,
        });
      } catch (e: any) {
        updateRow(row.invoiceId, { fusionStatus: 'error', fusionError: e.message });
        continue; // skip APEX post for this row
      }

      if (fusionItems.length === 0) continue;

      // ── Step 2: APEX lookup for prepayment invoice IDs ──
      const uniqueNumbers = [...new Set(fusionItems.map((i: any) => i.InvoiceNumber).filter(Boolean))];
      const apexLookup: Record<string, number | null> = {};
      for (const num of uniqueNumbers) {
        try {
          const lr = await fetch(`${APEX_INVOICE_URL}?invoice_number=${encodeURIComponent(num)}`, {
            headers: { Accept: 'application/json' },
          });
          const ld = await lr.json();
          const found = (ld.items || ld || [])[0];
          apexLookup[num] = found ? (found.invoice_id || found.invoiceId || null) : null;
        } catch { apexLookup[num] = null; }
      }

      // ── Step 3: POST to APEX ──
      updateRow(row.invoiceId, { apexStatus: 'posting' });
      try {
        const mappedItems = fusionItems.map((i: any) => ({
          PrepaymentApplicationId:   i.PayablesApplicationId ?? null,
          InvoiceId:                 row.invoiceId,
          InvoiceNumber:             row.invoiceNumber,
          PrepaymentInvoiceId:       i.InvoiceNumber ? (apexLookup[i.InvoiceNumber] ?? null) : null,
          PrepaymentNumber:          i.InvoiceNumber ?? null,
          LineNumber:                i.LineNumber ?? null,
          PrepaymentLineNumber:      i.PrepaymentLineNumber ?? null,
          Description:               i.Description ?? null,
          BusinessUnit:              row.businessUnit ?? null,
          SupplierSite:              i.SupplierSite ?? null,
          PurchaseOrder:             i.PurchaseOrder ?? null,
          Currency:                  i.Currency ?? null,
          AppliedAmount:             i.AppliedAmount ?? null,
          IncludedTax:               i.IncludedTax ?? null,
          IncludedonInvoiceFlag:     i.IncludedonInvoiceFlag ? 'Y' : 'N',
          ApplicationAccountingDate: i.ApplicationAccountingDate ?? null,
          Status:                    'Applied',
          CreatedBy:                 'FUSION_SYNC',
          CreationDate:              today,
          LastUpdatedBy:             'FUSION_SYNC',
          LastUpdateDate:            today,
        }));
        const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: mappedItems }),
        });
        const data = await res.json();
        if (res.ok && (data.status === 'success' || data.inserted >= 0)) {
          updateRow(row.invoiceId, { apexStatus: 'ok', apexInserted: data.inserted ?? mappedItems.length });
        } else {
          updateRow(row.invoiceId, { apexStatus: 'error', apexError: data.message || 'Unknown error' });
        }
      } catch (e: any) {
        updateRow(row.invoiceId, { apexStatus: 'error', apexError: e.message });
      }
    }

    setMultiFetchRunning(false);
  };

  // API Configuration for this page
  const selectedBuForApi = form.getFieldValue('businessUnit') || '';
  const PAGE_APIS = {
    apex: [
      {
        name: 'Search Invoices',
        method: 'GET',
        proxyUrl: APEX_INVOICE_URL,
        actualUrl: APEX_INVOICE_URL,
        params: 'supplier_number={supplierNumber}&business_unit={businessUnit}&invoice_number={invoiceNumber}&supplier={supplierOrParty}&invoice_date={invoiceDate}&invoice_amount={invoiceAmount}&supplier_site={supplierSite}&invoice_group={invoiceGroup}',
        description: 'Fetches invoices from APEX database with optional filters',
      },
      {
        name: 'Create Invoice',
        method: 'POST',
        proxyUrl: APEX_INVOICE_URL,
        actualUrl: APEX_INVOICE_URL,
        params: '',
        description: 'Creates a new invoice in APEX database',
      },
      {
        name: 'Tax Codes by Business Unit',
        method: 'GET',
        proxyUrl: `${APEX_DB_CONFIG.baseUrl}/tax/taxes/bybu`,
        actualUrl: `${APEX_DB_CONFIG.baseUrl}/tax/taxes/bybu${selectedBuForApi ? `?business_unit=${encodeURIComponent(selectedBuForApi)}` : '?business_unit=<select a BU filter above>'}`,
        params: selectedBuForApi ? `business_unit=${encodeURIComponent(selectedBuForApi)}` : 'business_unit=<BU name>',
        description: 'Returns active tax codes assigned to a business unit — used to populate the Tax Classification dropdown on invoice lines. Select a Business Unit filter above to test with a real BU.',
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

  // Execute a GET API and store the formatted response
  const executeApi = async (index: number, url: string) => {
    setApiExecResults(prev => ({ ...prev, [index]: { loading: true, response: null } }));
    try {
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let formatted = text;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `HTTP ${res.status}\n\n${formatted}` } }));
    } catch (e: any) {
      setApiExecResults(prev => ({ ...prev, [index]: { loading: false, response: `Error: ${e.message}` } }));
    }
  };

  // Open invoice in new tab
  // Synced invoices (from Oracle Fusion) open as read-only InvoiceDetail.
  // Locally-created invoices open in CreateInvoice (edit mode).
  const openInvoiceTab = (record: InvoiceRecord) => {
    const tabKey = `invoice-${record.invoiceId}`;

    const existingTab = openTabs.find((tab) => tab.key === tabKey);
    if (existingTab) {
      setActiveTab(tabKey);
      return;
    }

    // Always open CreateInvoice — synced invoices are read-only inside that component
    const editData: InvoiceInitialData = {
      invoiceId: record.invoiceId,
      isSynced: record.syncStatus === 'SYNCED',
      supplier: record.supplierOrParty,
      supplierNumber: record.supplierNumber,
      supplierId: record.supplierId,
      invoiceNumber: record.invoiceNumber,
      invoiceAmount: record.invoiceAmount,
      invoiceDate: record.invoiceDate ? dayjs(record.invoiceDate, 'DD MMM YYYY') : undefined,
      description: record.notes || '',
      invoiceCurrency: record.invoiceCurrency,
      businessUnit: record.businessUnit,
      invoiceType: record.invoiceType,
      supplierSite: record.supplierSite,
      unpaidAmount: record.unpaidAmount,
      validationStatus: record.validationStatus,
      approvalStatus: record.approvalStatus,
      holdPaidStatus: record.holdPaidStatus,
      applyAfterDate: record.applyAfterDate,
      paymentTerms: record.paymentTerms,
      invoiceGroup: record.invoiceGroup,
      termsDate: record.termsDate,
      goodsReceivedDate: record.goodsReceivedDate,
      liabilityDistribution: record.liabilityDistribution,
      accountingDate: record.accountingDate,
      conversionRateType: record.conversionRateType,
      conversionDate: record.conversionDate,
      conversionRate: record.conversionRate,
      paymentCurrency: record.paymentCurrency,
      // Audit / system info
      creationDate:                record.creationDate,
      createdBy:                   record.createdBy,
      lastUpdatedBy:               record.lastUpdatedBy,
      lastUpdateDate:              record.lastUpdateDate,
      syncDate:                    record.syncDate,
      cancellationDate:            record.cancellationDate,
      cancelledBy:                 record.cancelledBy,
      deliveryChannelCode:         record.deliveryChannelCode,
      deliveryChannel:             record.deliveryChannel,
      firstPartyTaxRegistrationId: record.firstPartyTaxRegistrationId,
      firstPartyTaxRegistrationNum:record.firstPartyTaxRegistrationNum,
      taxationCountry:             record.taxationCountry,
      documentCategory:            record.documentCategory,
      documentSequence:            record.documentSequence,
      voucherNumber:               record.voucherNumber,
      accountingStatus:            record.accountingStatus,
    };

    const newTab: InvoiceTab = {
      key: tabKey,
      label: record.invoiceNumber,
      invoice: record,
      tabType: 'create',
      initialData: editData,
    };
    setOpenTabs([...openTabs, newTab]);
    setActiveTab(tabKey);
  };

  // Open create invoice tab (optionally with pre-filled data)
  const openCreateInvoiceTab = (data?: InvoiceInitialData) => {
    const tabKey = `create-invoice-${Date.now()}`;
    // Build tab label: InvoiceNo + first 4 letters of supplier
    let tabLabel = 'New Invoice';
    if (data) {
      const invNo = data.invoiceNumber || '';
      const supplierShort = (data.supplier || '').substring(0, 4).toUpperCase();
      if (invNo && supplierShort) {
        tabLabel = `${invNo} - ${supplierShort}`;
      } else if (invNo) {
        tabLabel = invNo;
      }
    }
    const newTab: InvoiceTab = {
      key: tabKey,
      label: tabLabel,
      invoice: {} as InvoiceRecord,
      tabType: 'create',
      initialData: data,
    };
    setOpenTabs((prev) => [...prev, newTab]);
    setActiveTab(tabKey);
  };

  // Show & Tell: when the create-invoice tour navigates here, open the demo tab
  useEffect(() => {
    if (!isRunning || activeTour?.id !== 'create-invoice') {
      satTabOpened.current = false;
      return;
    }
    if (satTabOpened.current) return;
    satTabOpened.current = true;
    // Open a blank form — the tour guides the user to fill each field interactively
    setTimeout(() => openCreateInvoiceTab(), 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, activeTour?.id]);

  // Handle quick-create from FloatingMenu or Autopilot navigation state
  useEffect(() => {
    const state = location.state as any;
    if (!state?.quickCreate) return;
    // Use location.key to allow repeated navigations (each navigate() gets a new key)
    if (quickCreateHandled.current === location.key) return;
    quickCreateHandled.current = location.key;

    if (state.quickCreateData) {
      // FloatingMenu / Autopilot flow: data already collected, open tab directly
      const qcData = { ...state.quickCreateData } as InvoiceInitialData;
      // Convert serialised date string back to dayjs (structured clone strips prototype)
      if (qcData.invoiceDate && typeof qcData.invoiceDate === 'string') {
        qcData.invoiceDate = dayjs(qcData.invoiceDate);
      }
      setTimeout(() => {
        openCreateInvoiceTab(qcData);
      }, 100);
    } else if (state.showQuickCreateDialog) {
      // Autopilot flow: show dialog to collect data
      setTimeout(() => {
        setQuickCreateVisible(true);
        if (suppliers.length === 0) fetchSuppliers();
      }, 200);
    }

    window.history.replaceState({}, document.title);
  }, [location.state, location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close invoice tab
  const closeInvoiceTab = (tabKey: string) => {
    const newTabs = openTabs.filter((tab) => tab.key !== tabKey);
    setOpenTabs(newTabs);

    // If closing active tab, switch to search
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
      closeInvoiceTab(targetKey);
    }
  };

  // Search invoices from API
  const handleSearch = async (values: any) => {
    setLoading(true);
    try {
      // Build query parameters
      const params = new URLSearchParams();
      if (values.supplierNumber) params.append('supplier_number', values.supplierNumber);
      if (values.businessUnit) params.append('business_unit', values.businessUnit);
      if (values.invoiceNumber) params.append('invoice_number', values.invoiceNumber);
      if (values.supplierOrParty) params.append('supplier', values.supplierOrParty);

      // Invoice date — convert operator + picker value(s) to date_from / date_to
      const fmt = (d: import('dayjs').Dayjs) => d.format('YYYY-MM-DD');
      const today = dayjs();
      const op = invoiceDateOp;
      if (op === '=' && values.invoiceDate) {
        params.append('invoice_date_from', fmt(values.invoiceDate));
        params.append('invoice_date_to',   fmt(values.invoiceDate));
      } else if (op === 'between' && values.invoiceDateRange?.[0] && values.invoiceDateRange?.[1]) {
        params.append('invoice_date_from', fmt(values.invoiceDateRange[0]));
        params.append('invoice_date_to',   fmt(values.invoiceDateRange[1]));
      } else if (op === 'before' && values.invoiceDate) {
        params.append('invoice_date_to', fmt(values.invoiceDate));
      } else if (op === 'after' && values.invoiceDate) {
        params.append('invoice_date_from', fmt(values.invoiceDate));
      } else if (op === 'past10') {
        params.append('invoice_date_from', fmt(today.subtract(10, 'day')));
        params.append('invoice_date_to',   fmt(today));
      } else if (op === 'past20') {
        params.append('invoice_date_from', fmt(today.subtract(20, 'day')));
        params.append('invoice_date_to',   fmt(today));
      } else if (op === 'past30') {
        params.append('invoice_date_from', fmt(today.subtract(30, 'day')));
        params.append('invoice_date_to',   fmt(today));
      } else if (op === 'past60') {
        params.append('invoice_date_from', fmt(today.subtract(60, 'day')));
        params.append('invoice_date_to',   fmt(today));
      } else if (op === 'this_month') {
        params.append('invoice_date_from', fmt(today.startOf('month')));
        params.append('invoice_date_to',   fmt(today.endOf('month')));
      } else if (op === 'last_month') {
        const lm = today.subtract(1, 'month');
        params.append('invoice_date_from', fmt(lm.startOf('month')));
        params.append('invoice_date_to',   fmt(lm.endOf('month')));
      }

      if (values.invoiceAmount != null && values.invoiceAmount !== '') params.append('invoice_amount', values.invoiceAmount);
      if (values.supplierSite) params.append('supplier_site', values.supplierSite);
      if (values.invoiceGroup) params.append('invoice_group', values.invoiceGroup);
      if (values.invoiceType) params.append('invoice_type', values.invoiceType);

      // Build URL - call APEX endpoint directly
      const queryString = params.toString();
      const apiUrl = queryString ? `${APEX_INVOICE_URL}?${queryString}` : APEX_INVOICE_URL;

      console.log('Fetching invoices from:', apiUrl);
      setLastCalledUrl(apiUrl);

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        setLastApiResponse(`Error: HTTP ${response.status} ${response.statusText}`);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('API Response:', data);

      // Handle response - could be { items: [...] } or direct array
      const items = data.items || data || [];

      if (Array.isArray(items) && items.length > 0) {
        const mappedInvoices = items.map(mapApiToInvoiceRecord);
        setInvoices(mappedInvoices);
        setLastApiResponse(`Success: ${mappedInvoices.length} invoices returned`);
        message.success(`Found ${mappedInvoices.length} invoices`);
        const users = [...new Set(mappedInvoices.map(i => i.createdBy).filter(Boolean))] as string[];
        setKnownUsers(prev => [...new Set([user?.username, ...prev, ...users].filter(Boolean) as string[])].sort());

        // Fetch available balances for prepayment invoices in parallel
        const prepayRows = mappedInvoices.filter(i => i.invoiceType === 'Prepayment');
        if (prepayRows.length > 0) {
          setPrepayBalances({});
          Promise.allSettled(
            prepayRows.map(inv =>
              fetch(`${APEX_DB_CONFIG.baseUrl}/ap/applied-prepayments/balances?prepayment_invoice_id=${inv.invoiceId}`, {
                headers: { Accept: 'application/json' },
              })
                .then(r => r.ok ? r.json() : null)
                .then(json => {
                  if (!json) return;
                  const item = Array.isArray(json) ? json[0] : Array.isArray(json?.items) ? json.items[0] : json;
                  const bal  = item ? Number(item.AvailableBalance ?? item.available_balance ?? item.availableBalance ?? 0) : null;
                  setPrepayBalances(prev => ({ ...prev, [inv.invoiceId]: bal }));
                })
                .catch(() => {})
            )
          );
        }
      } else {
        setInvoices([]);
        setLastApiResponse(`Success: 0 invoices returned (empty result). Response keys: ${JSON.stringify(Object.keys(data))}`);
        message.info('No invoices found');
      }
    } catch (error) {
      console.error('Search error:', error);
      if (!lastApiResponse?.startsWith('Error:')) {
        setLastApiResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      message.error(`Failed to search invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Reset search form
  const handleReset = () => {
    form.resetFields();
  };

  // Get validation status tag
  const getValidationStatusTag = (status: string) => {
    const statusConfig: Record<string, { color: string; textColor: string }> = {
      'Validated': { color: REDWOOD.success, textColor: '#fff' },
      'Needs revalidation': { color: REDWOOD.warning, textColor: '#000' },
      'Canceled': { color: REDWOOD.error, textColor: '#fff' },
      'Never validated': { color: REDWOOD.neutral300, textColor: '#000' },
    };
    const config = statusConfig[status] || { color: REDWOOD.neutral300, textColor: '#000' };
    return (
      <Tag style={{ background: config.color, color: config.textColor, border: 'none' }}>
        {status}
      </Tag>
    );
  };

  // Get approval status tag
  const getApprovalStatusTag = (status: string) => {
    const statusConfig: Record<string, { color: string }> = {
      'Manually approved': { color: 'green' },
      'Workflow approved': { color: 'green' },
      'Not required': { color: 'default' },
      'Rejected': { color: 'red' },
      'Pending': { color: 'orange' },
      'PENDING': { color: 'orange' },
    };
    const config = statusConfig[status] || { color: 'default' };
    return <Tag color={config.color}>{status}</Tag>;
  };

  const getAccountingStatusTag = (status: string) => {
    const statusConfig: Record<string, { color: string }> = {
      'Accounted':       { color: 'green' },
      'Draft Accounted': { color: 'cyan' },
      'Not Accounted':   { color: 'default' },
      'Partial':         { color: 'orange' },
      'Error':           { color: 'red' },
    };
    const config = statusConfig[status] || { color: 'default' };
    return <Tag color={config.color}>{status || 'Not Accounted'}</Tag>;
  };

  // Action menu items
  const actionsMenuItems: MenuProps['items'] = [
    { key: 'edit', label: 'Edit', icon: <EditOutlined /> },
    { key: 'duplicate', label: 'Duplicate', icon: <CopyOutlined /> },
    { type: 'divider' },
    { key: 'delete', label: 'Delete', icon: <DeleteOutlined />, danger: true },
    { key: 'cancel', label: 'Cancel Invoice', icon: <StopOutlined />, danger: true },
  ];

  // View menu handler
  const handleViewMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'export') {
      exportToExcel();
    }
  };

  // View menu items
  const viewMenuItems: MenuProps['items'] = [
    { key: 'columns', label: 'Columns', icon: <SettingOutlined /> },
    { key: 'detach', label: 'Detach', icon: <ExportOutlined /> },
    { type: 'divider' },
    { key: 'export', label: 'Export to Excel', icon: <DownloadOutlined /> },
    { key: 'print', label: 'Print', icon: <PrinterOutlined /> },
  ];

  // Accounting functions
  const fetchAllAccountingData = async () => {
    setAccountingAllLoading(true);
    setAccountingAllData([]);
    const data: typeof accountingAllData = [];

    try {
      for (const invoice of displayedInvoices) {
        try {
          // Query GL journal lines directly by reference2 (invoice ID) and reference5 (AP-INVOICE-CREATION)
          console.log(`📍 Fetching GL journal lines for invoice ${invoice.invoiceNumber}:`, {
            reference2: invoice.invoiceId,
            reference5: 'AP-INVOICE-CREATION',
          });

          const glLinesUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${invoice.invoiceId}&reference5=AP-INVOICE-CREATION`;
          const res = await fetch(glLinesUrl, {
            headers: { Accept: 'application/json' }
          });

          if (!res.ok) {
            console.warn(`Failed to fetch GL journal lines for ${invoice.invoiceNumber}: HTTP ${res.status}`);
            continue;
          }

          const glLinesData = await res.json();
          console.log(`📥 GL Journal Lines for ${invoice.invoiceNumber}:`, glLinesData);

          // Handle both direct array and object with items wrapper
          let lines: any[] = [];
          if (Array.isArray(glLinesData)) {
            lines = glLinesData;
          } else if (glLinesData && typeof glLinesData === 'object' && Array.isArray(glLinesData.items)) {
            lines = glLinesData.items;
          }

          if (lines.length === 0) {
            continue;
          }

          // Process GL journal lines to extract accounting data
          let totalDebits = 0;
          let totalCredits = 0;
          let debitAccount = '';
          let creditAccount = '';
          let glBatchId: number | null = null;
          let glHeaderId: number | null = null;
          let glStatus = '';

          lines.forEach((line: any) => {
            glBatchId = line.je_batch_id || line.jeBatchId || line.batchId || glBatchId;
            glHeaderId = line.je_header_id || line.jeHeaderId || line.headerId || glHeaderId;
            glStatus = line.journal_status || line.batch_status || line.status || glStatus;

            const dr = Number(line.entered_dr || line.enteredDr || line.accounted_dr || line.accountedDr || 0);
            const cr = Number(line.entered_cr || line.enteredCr || line.accounted_cr || line.accountedCr || 0);
            totalDebits += dr;
            totalCredits += cr;

            // Extract debit account (first DR line)
            if (dr > 0 && !debitAccount) {
              debitAccount = line.account || line.accountCombination || '';
            }
            // Extract credit account (first CR line)
            if (cr > 0 && !creditAccount) {
              creditAccount = line.account || line.accountCombination || '';
            }
          });

          // Only add if there are journal lines
          if (totalDebits > 0 || totalCredits > 0) {
            // Extract reference fields from first GL journal line
            const firstLine = lines[0] || {};
            data.push({
              invoiceNumber: invoice.invoiceNumber,
              invoiceId: invoice.invoiceId,
              invoiceDate: invoice.invoiceDate,
              debits: totalDebits,
              credits: totalCredits,
              debitAccount,
              creditAccount,
              glBatchId,
              glHeaderId,
              glStatus,
              reference1: firstLine.reference1 || invoice.invoiceNumber,
              reference2: firstLine.reference2 || String(invoice.invoiceId),
              reference3: firstLine.reference3 || '',
              reference4: firstLine.reference4 || '',
              reference5: firstLine.reference5 || '',
              lines,
            });
          }
        } catch (e) {
          console.error(`Failed to fetch GL journal lines for ${invoice.invoiceNumber}:`, e);
        }
      }
      setAccountingAllData(data);
    } catch (error) {
      message.error('Failed to fetch accounting data');
      console.error(error);
    } finally {
      setAccountingAllLoading(false);
    }
  };

  const openAccountingForSingle = async (record: InvoiceRecord) => {
    setAccountingSingleInvoice(record);
    setAccountingSingleData(null);
    setAccountingSingleModalOpen(true);
    setAccountingSingleLoading(true);

    try {
      // Query GL journal lines directly by reference2 (invoice ID) and reference5 (AP-INVOICE-CREATION)
      const glLinesUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${record.invoiceId}&reference5=AP-INVOICE-CREATION`;

      console.log('📍 Fetching GL journal lines:', {
        reference2: record.invoiceId,
        reference5: 'AP-INVOICE-CREATION',
        endpoint: glLinesUrl
      });

      const res = await fetch(glLinesUrl, {
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch GL journal lines: HTTP ${res.status}`);
      }

      const glLinesData = await res.json();
      console.log('📥 GL Journal Lines Response:', glLinesData);

      // Extract journal info from response
      let lines: any[] = [];
      let headerId: number | null = null;
      let batchId: number | null = null;
      let accountingStatus = 'N/A';
      let accountingDate = record.invoiceDate;

      // Handle both direct array and object with items wrapper
      if (Array.isArray(glLinesData)) {
        lines = glLinesData;
      } else if (glLinesData && typeof glLinesData === 'object' && Array.isArray(glLinesData.items)) {
        lines = glLinesData.items;
      }

      if (lines.length > 0) {
        headerId = lines[0].je_header_id || lines[0].jeHeaderId || lines[0].headerId;
        batchId = lines[0].je_batch_id || lines[0].jeBatchId || lines[0].batchId;
        accountingStatus = lines[0].journal_status || lines[0].batch_status || lines[0].status || 'N/A';
        accountingDate = lines[0].accounting_date || lines[0].defaultEffectiveDate || lines[0].createdDate || record.invoiceDate;
      }

      setAccountingSingleData({
        headerId,
        batchId,
        accountingStatus,
        accountingDate,
        lines,
      });
    } catch (error: any) {
      message.error(`Failed to fetch GL journal lines for ${record.invoiceNumber}: ${error.message}`);
      console.error('Error fetching GL journal lines:', error);
    } finally {
      setAccountingSingleLoading(false);
    }
  };

  // Test GL Journal Lines API endpoint
  const handleTestGlJournalLinesApi = async (invoiceId: string) => {
    if (!invoiceId.trim()) {
      message.warning('Please enter an invoice ID');
      return;
    }

    setApiTestLoading(true);
    setApiTestError('');
    setApiTestResponse(null);

    try {
      const glLinesUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${invoiceId}&reference5=AP-INVOICE-CREATION`;
      console.log('🧪 Testing GL Journal Lines API:', glLinesUrl);

      const res = await fetch(glLinesUrl, {
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      setApiTestResponse(data);
      message.success('API call successful!');
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error';
      setApiTestError(errorMsg);
      message.error(`API call failed: ${errorMsg}`);
    } finally {
      setApiTestLoading(false);
    }
  };

  // Fetch account description for a given account combination
  const fetchAccountDescription = async (accountCode: string): Promise<string> => {
    if (!accountCode) return '';
    try {
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/accounts?account_code=${encodeURIComponent(accountCode)}`,
        { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const accounts = data.items || (Array.isArray(data) ? data : []);
        if (accounts.length > 0) {
          return accounts[0].description || accounts[0].account_description || '';
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch account description for ${accountCode}:`, err);
    }
    return '';
  };

  const handleRecreateAccountingPreview = async (record: InvoiceRecord, autoShowDebug: boolean = false) => {
    const inv = invoices.find(i => i.invoiceId === record.invoiceId);
    if (!inv) {
      message.error('Invoice data not found');
      return;
    }

    try {
      // Fetch invoice lines (which includes both item lines and tax lines)
      const linesRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${inv.invoiceId}`, { headers: { Accept: 'application/json' } });
      const linesData = linesRes.ok ? await linesRes.json().catch(() => ({})) : {};

      console.log('Invoice lines data:', linesData);

      // Parse lines and separate into item lines and tax lines
      const allItems: any[] = linesData.items || (Array.isArray(linesData) ? linesData : []);
      const rawLines: any[] = allItems.filter((item: any) => item.line_type !== 'Tax' && item.line_type !== 'TAX');
      const rawTaxLines: any[] = allItems.filter((item: any) => item.line_type === 'Tax' || item.line_type === 'TAX');

      console.log('All items:', allItems);
      console.log('Parsed rawLines:', rawLines);
      console.log('Parsed rawTaxLines:', rawTaxLines);

      // Debug: Log all field names from first line
      if (allItems.length > 0) {
        console.log('First item all fields:', Object.keys(allItems[0]));
        console.log('First item data:', allItems[0]);
      }

      if (rawLines.length === 0) {
        message.warning('No invoice lines loaded. Cannot create accounting.');
        return;
      }

      // Get first line's expense account as fallback
      const expenseAccountFallback = rawLines[0]?.distribution_combination || rawLines[0]?.dist_code_combination || '';

      // Fetch ledger info
      const ledgerInfo = await fetchLedgerByBusinessUnit(inv.businessUnit ?? '');

      // Fetch tax codes for the business unit to map tax classifications to accounts
      const taxRes = await fetch(`${APEX_DB_CONFIG.baseUrl}/tax/taxes/bybu?business_unit=${inv.businessUnit}`);
      const taxData = await taxRes.json();
      const taxCodes: any[] = taxData.items || [];
      const taxAccountMap: Record<string, string> = {};
      const taxRateMap: Record<string, number> = {};

      taxCodes.forEach((t: any) => {
        const code = t.taxCode || '';
        const name = t.taxName || '';
        const account = t.taxAccount || '';
        if (code) taxAccountMap[code] = account;
        if (name) taxAccountMap[name] = account;
        if (code) taxRateMap[code] = Number(t.taxRate) || 0;
        if (name) taxRateMap[name] = Number(t.taxRate) || 0;
      });

      console.log('Tax codes configuration:', taxCodes.map((t: any) => ({ taxCode: t.taxCode, taxName: t.taxName, taxAccount: t.taxAccount })));

      // Build invoice lines with tax embedded in each line
      // Each line has: line_amount, tax_control_amount (tax), tax_classification
      const invoiceLines = rawLines.map((l: any) => {
        const taxClassification = l.tax_classification || '';
        let taxAccount = taxAccountMap[taxClassification] || '';

        // Fallback to default VAT account if not found in config
        if (!taxAccount && taxClassification && taxClassification.toUpperCase().includes('VAT')) {
          taxAccount = '01-00-00-1223104-0000-000-00-000-000';
        }

        return {
          lineNumber:    l.line_number,
          amount:        Number(l.line_amount || 0),
          description:   l.description || `Line ${l.line_number}`,
          accrualAccount: l.distribution_combination || l.dist_code_combination || undefined,
          lineId:        l.line_id || undefined,
          // Tax embedded in line
          taxAmount:     Number(l.tax_control_amount || 0),
          taxAccount:    taxAccount,
          taxClassification: taxClassification,
          taxRateCode:   taxClassification || 'VAT',
          taxRate:       taxRateMap[taxClassification] || 0,
        };
      });

      console.log('Invoice lines (with embedded tax):', invoiceLines);

      // Build accounting lines following the pattern from CreateInvoice.tsx
      // Structure: Line DR + Tax DR (if exists) + Liability CR
      const slaLines: any[] = [];
      let lineNum = 1;
      let totalTaxAmount = 0;

      // For each invoice line, create:
      // 1. DR for the line amount (expense account)
      // 2. If tax > 0: separate DR for tax (tax account)
      for (const line of invoiceLines) {
        const lineAmount = line.amount || 0;
        const lineAccount = line.accrualAccount || expenseAccountFallback;

        // Line DR
        slaLines.push({
          lineNumber:      lineNum++,
          lineType:        'DR',
          accountingClass: 'EXPENSE',
          accountCombination: lineAccount,
          enteredDr:       lineAmount,
          enteredCr:       0,
          accountedDr:     lineAmount,
          accountedCr:     0,
          currencyCode:    inv.invoiceCurrency,
          exchangeRate:    1,
          description:     line.description || `Line ${line.lineNumber}`,
          sourceLineNumber: line.lineNumber,
        });

        // Tax DR (if tax exists on this line)
        const taxAmount = line.taxAmount || 0;
        if (taxAmount > 0) {
          const taxAccount = line.taxAccount || expenseAccountFallback;
          slaLines.push({
            lineNumber:      lineNum++,
            lineType:        'DR',
            accountingClass: 'TAX',
            accountCombination: taxAccount,
            enteredDr:       taxAmount,
            enteredCr:       0,
            accountedDr:     taxAmount,
            accountedCr:     0,
            currencyCode:    inv.invoiceCurrency,
            exchangeRate:    1,
            description:     `${line.taxRateCode || 'VAT'} – ${line.description || `Line ${line.lineNumber}`}`,
            sourceLineNumber: line.lineNumber,
          });
          totalTaxAmount += taxAmount;
          console.log(`Tax line: ${taxAmount} (${line.taxRate}%) from line ${line.lineNumber}`);
        }
      }

      // Single CR line for total AP Liability (including tax)
      const totalAmount = inv.invoiceAmount; // This already includes tax
      slaLines.push({
        lineNumber:      lineNum++,
        lineType:        'CR',
        accountingClass: 'LIABILITY',
        accountCombination: inv.liabilityDistribution || '',
        enteredDr:       0,
        enteredCr:       totalAmount,
        accountedDr:     0,
        accountedCr:     totalAmount,
        currencyCode:    inv.invoiceCurrency,
        exchangeRate:    1,
        description:     `AP Liability – Invoice ${inv.invoiceNumber}`,
      });

      console.log('Built SLA lines:', slaLines);
      console.log(`Total: DR ${slaLines.reduce((s, l) => s + (l.enteredDr || 0), 0)} = CR ${slaLines.reduce((s, l) => s + (l.enteredCr || 0), 0)}`);

      // Build payload with header info
      const today = new Date();
      const periodName = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()]}-${String(today.getFullYear()).slice(-2)}`;

      let payload: any = {
        header: {
          sourceId: inv.invoiceId,
          sourceNumber: inv.invoiceNumber,
          sourceTable: 'AP_INVOICES',
          sourceType: 'INVOICE',
          eventTypeCode: 'AP_INVOICE_CREATION',
          currencyCode: inv.invoiceCurrency,
          description: `AP Liability – Invoice ${inv.invoiceNumber}`,
          invoiceDate: inv.invoiceDate,
          periodName: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()]}-${String(today.getFullYear()).slice(-2)}`,
          ledgerId: ledgerInfo?.ledgerId || 300000003259529,
          ledgerName: ledgerInfo?.ledgerName || 'BCL DIFC',
          conversionRate: inv.conversionRate || 1,
          reference3: inv.accountingClass || inv.expenseClass || 'EXPENSE',
          reference4: inv.businessUnit || inv.buCode || '',
        },
        lines: slaLines,
      };

      // Fetch segment descriptions for all accounts in the payload
      if (payload.lines && payload.lines.length > 0) {
        for (const line of payload.lines) {
          if (line.accountCombination) {
            try {
              const validation = await validateAccountCode(line.accountCombination);
              // Add segment details to the line for display
              line.segmentDetails = validation.segmentDetails;
              line.accountDescription = Object.values(validation.segmentDetails)
                .map((seg: any) => seg.description)
                .filter(Boolean)
                .join(' | ') || line.accountCombination;
            } catch (e) {
              console.warn(`Failed to validate account ${line.accountCombination}:`, e);
              line.accountDescription = line.accountCombination;
            }
          }
        }
      }

      console.log('Final payload with descriptions:', payload);
      setPreviewPayload(payload);

      if (autoShowDebug) {
        // Automatically show debug drawer instead of preview modal
        setPreviewModalOpen(false);
        // Pass payload directly to avoid state closure issues
        const steps = buildPreviewDebugSteps(payload);
        setPreviewDebugSteps(steps);
        setPreviewDebugOpen(true);
        setSlaDuplicateExists(false);
        setGlDuplicateExists(false);
        setPreviewSlaHeaderId(null);
        setPreviewGlBatchId(null);
        setPreviewGlHeaderId(null);
        setPreviewGlBatchName('');
      } else {
        // Show preview modal normally
        setPreviewModalOpen(true);
      }
    } catch (err: any) {
      message.error(`Failed to build accounting: ${err.message}`);
      console.error('Full error:', err);
    }
  };

  // Build debug steps for Create Accounting (without running them)
  const buildPreviewDebugSteps = (payload?: any) => {
    const activePayload = payload || previewPayload;
    if (!activePayload) return [];

    const invoiceId = activePayload.header?.sourceId;
    const invoiceNumber = activePayload.header?.sourceNumber;

    // Get invoice data - use activePayload.header first, then fall back to invoices array
    const inv = invoices.find(i => i.invoiceId === invoiceId) || {};

    const invoiceDate = dayjs(activePayload.header?.invoiceDate || inv.invoiceDate || new Date());
    const acctDate = invoiceDate.format('YYYY-MM-DD');
    const periodName = activePayload.header?.periodName || `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][invoiceDate.month()]}-${invoiceDate.format('YY')}`;
    const conversionRate = activePayload.header?.conversionRate || inv.conversionRate || 1;
    const currency = activePayload.header?.currencyCode || inv.invoiceCurrency || 'AED';

    const totalDr = activePayload.lines.filter((l: any) => l.lineType === 'DR').reduce((s: number, l: any) => s + (l.enteredDr || 0), 0);
    const totalCr = activePayload.lines.filter((l: any) => l.lineType === 'CR').reduce((s: number, l: any) => s + (l.enteredCr || 0), 0);
    const batchName = `AP-${invoiceNumber}-${dayjs().format('YYYYMMDD-HHmmss')}`;

    // Build SLA payload with correct structure
    const slaPayload = {
      header: {
        moduleName: 'AP',
        sourceTable: activePayload.header.sourceTable,
        sourceId: activePayload.header.sourceId,
        sourceNumber: activePayload.header.sourceNumber,
        sourceType: activePayload.header.sourceType,
        eventTypeCode: activePayload.header.eventTypeCode,
        eventDate: acctDate,
        accountingDate: acctDate,
        periodName: periodName,
        ledgerId: activePayload.header.ledgerId,
        ledgerName: activePayload.header.ledgerName,
        ledgerCurrency: currency,
        businessUnit: activePayload.header.reference4 || '',
        currencyCode: currency,
        exchangeRate: conversionRate,
        exchangeRateType: 'User',
        description: activePayload.header.description,
        createdBy: 'user',
      },
      lines: activePayload.lines.map((l: any) => ({
        lineNumber: l.lineNumber,
        lineType: l.lineType,
        accountingClass: l.accountingClass,
        accountCombination: l.accountCombination,
        enteredDr: l.enteredDr,
        enteredCr: l.enteredCr,
        accountedDr: l.accountedDr,
        accountedCr: l.accountedCr,
        currencyCode: currency,
        exchangeRate: conversionRate,
        exchangeRateType: 'User',
        description: l.description,
        sourceLineId: previewPayload.header.sourceId,
        sourceLineNumber: l.lineNumber,
      })),
    };

    // Build GL journal payload with correct field names
    const ledgerName = activePayload.header?.ledgerName || inv.ledgerName || 'BCL DIFC';
    const ledgerId = activePayload.header?.ledgerId || inv.ledgerId || 300000003259529;

    const journalPayload = {
      batch: {
        batchName,
        batchDescription: `AP Invoice ${invoiceNumber} – Posted from SLA`,
        ledgerName,
        ledgerId,
        status: 'NEW',
        accountingPeriod: periodName,
        controlTotal: totalDr,
        runningTotalDr: totalDr,
        runningTotalCr: totalCr,
        batchSource: 'Payables',
        createdBy: 'user',
      },
      header: {
        ledgerId,
        ledgerName,
        jeCategory: 'Purchase Invoices',
        jeSource: 'Payables',
        periodName,
        journalName: `AP Invoice ${invoiceNumber}`,
        description: `Subledger accounting – Invoice ${invoiceNumber}`,
        currencyCode: currency,
        currencyConversionType: 'User',
        currencyConversionDate: acctDate,
        currencyConversionRate: conversionRate,
        defaultEffectiveDate: acctDate,
        status: 'NEW',
        runningTotalDr: totalDr,
        runningTotalCr: totalCr,
        createdBy: 'user',
      },
      lines: activePayload.lines.map((l: any) => ({
        enteredDr: l.lineType === 'DR' ? (l.enteredDr || null) : null,
        enteredCr: l.lineType === 'CR' ? (l.enteredCr || null) : null,
        accountedDr: l.lineType === 'DR' ? (l.enteredDr || 0) * conversionRate : null,
        accountedCr: l.lineType === 'CR' ? (l.enteredCr || 0) * conversionRate : null,
        description: l.description || '',
        currencyCode: l.currencyCode || currency,
        currencyConversionDate: l.accountingDate || acctDate,
        currencyConversionRate: conversionRate,
        userCurrencyConversionType: 'User',
        accountCombination: l.accountCombination || '',
        reference1: invoiceNumber,
        reference2: String(invoiceId),
        reference3: l.reference3 || previewPayload.header?.reference3 || '',
        reference4: l.reference4 || previewPayload.header?.reference4 || '',
        reference5: 'AP-INVOICE-CREATION',
        reconciledFlag: 'N',
        createdBy: 'user',
      })),
    };

    return [
      {
        step: '0 — Check if SLA Exists',
        method: 'GET',
        url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=${invoiceId}&eventType=AP_INVOICE_CREATION`,
        requestBody: null,
        status: undefined,
        response: undefined,
      },
      {
        step: '0.1 — Delete SLA',
        method: 'POST',
        url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/delete`,
        requestBody: { headerId: '{headerId}' },
        status: undefined,
        response: undefined,
      },
      {
        step: '1 — Check if GL Exists',
        method: 'GET',
        url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/check?reference1=${invoiceNumber}&reference2=${invoiceId}&reference5=AP-INVOICE-CREATION`,
        requestBody: null,
        status: undefined,
        response: undefined,
      },
      {
        step: '1.1 — Delete GL',
        method: 'DELETE',
        url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/{batchId}`,
        requestBody: null,
        status: undefined,
        response: undefined,
      },
      {
        step: '2 — Create SLA Accounting',
        method: 'POST',
        url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`,
        requestBody: slaPayload,
        status: undefined,
        response: undefined,
      },
      {
        step: '3 — Create Journal in GL',
        method: 'POST',
        url: `${APEX_DB_CONFIG.baseUrl}/journals/create`,
        requestBody: journalPayload,
        status: undefined,
        response: undefined,
      },
      {
        step: '4 — Post Journal to GL',
        method: 'PUT',
        url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/{glBatchId}/post`,
        requestBody: null,
        status: undefined,
        response: undefined,
      },
      {
        step: '5 — Stamp GL IDs on SLA Header',
        method: 'POST',
        url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`,
        requestBody: { headerId: '{slaHeaderId}', glBatchId: '{glBatchId}', glBatchName: '{glBatchName}', glHeaderId: '{glHeaderId}', postedBy: 'user' },
        status: undefined,
        response: undefined,
      },
    ];
  };

  // Handle Create Accounting - Show debug drawer without running
  const handleCreateAccounting = () => {
    if (!previewPayload) return;
    const steps = buildPreviewDebugSteps(previewPayload);
    setPreviewDebugSteps(steps);
    setPreviewDebugOpen(true);
    // Reset duplicate flags and IDs for new flow
    setSlaDuplicateExists(false);
    setGlDuplicateExists(false);
    setPreviewSlaHeaderId(null);
    setPreviewGlBatchId(null);
    setPreviewGlHeaderId(null);
    setPreviewGlBatchName('');
  };


  // Core function to run all steps - works for both debug dialog and batch
  const executeAllSteps = async (stepsToRun: any[], invoiceName: string = '') => {
    if (!stepsToRun || stepsToRun.length === 0) {
      console.warn('No steps to run');
      return [];
    }

    const results: any[] = [];
    let capturedSlaHeaderId: any = null;
    let capturedGlBatchId: any = null;
    let capturedGlHeaderId: any = null;

    for (let i = 0; i < stepsToRun.length; i++) {
      const prefix = invoiceName ? `[${invoiceName}]` : '';
      console.log(`${prefix} === STARTING STEP ${i} ===`);
      console.log(`${prefix} 📋 Current captured IDs: SLA=${capturedSlaHeaderId}, GL=${capturedGlBatchId}`);

      try {
        // Set state temporarily so runPreviewDebugStep can read step details
        setPreviewDebugSteps(stepsToRun);

        const stepResult = await runPreviewDebugStep(i, {
          capturedSlaHeaderId,
          capturedGlBatchId,
          capturedGlHeaderId,
          setCapturedIds: (ids: any) => {
            if (ids.slaHeaderId !== undefined) capturedSlaHeaderId = ids.slaHeaderId;
            if (ids.glBatchId !== undefined) capturedGlBatchId = ids.glBatchId;
            if (ids.glHeaderId !== undefined) capturedGlHeaderId = ids.glHeaderId;
          }
        });

        results.push({
          stepIdx: i,
          status: stepResult?.response?.status === 'error' ? 'API_ERROR'
            : (stepResult?.status === 200 || stepResult?.status === 204) ? 'success' : 'failed',
          url: stepResult?.url,
          request: stepResult?.request,
          response: stepResult?.response,
          responseStatus: stepResult?.status,
          capturedIds: { slaHeaderId: capturedSlaHeaderId, glBatchId: capturedGlBatchId, glHeaderId: capturedGlHeaderId }
        });

        console.log(`${prefix} ✓ Step ${i} completed\n`);
      } catch (error: any) {
        console.error(`${prefix} Error on step ${i}:`, error);
        results.push({
          stepIdx: i,
          status: 'failed',
          error: error.message
        });
      }

      // 1-second delay between steps
      if (i < stepsToRun.length - 1) {
        console.log(`${prefix} ⏳ Waiting 1 second before next step...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  };

  // Run all debug steps sequentially (for API Debug dialog "Run All Steps" button)
  const runAllPreviewDebugSteps = async () => {
    if (!previewPayload || previewDebugSteps.length === 0) {
      message.warning('No steps to run');
      return;
    }

    try {
      await executeAllSteps(previewDebugSteps, '');
      message.success('✓ All steps completed!');
    } catch (error: any) {
      console.error('Error running all steps:', error);
      message.error(`Error running steps: ${error.message}`);
    }
  };

  // Show batch progress modal with confirmation
  const showBatchProgressModal = async () => {
    if (accountingAllSelectedKeys.length === 0) {
      message.warning('Select at least one invoice');
      return;
    }

    const selectedInvoices = accountingAllData.filter(acc => accountingAllSelectedKeys.includes(acc.invoiceId));

    if (selectedInvoices.length === 0) {
      message.warning('No valid invoices selected');
      return;
    }

    // Initialize progress data for each invoice
    const progressData = selectedInvoices.map(acc => ({
      invoiceId: acc.invoiceId,
      invoiceNumber: acc.invoiceNumber,
      amount: acc.debits || 0,
      steps: [
        { label: 'Step 0: Check SLA', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 0.1: Delete SLA', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 1: Check GL', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 1.1: Delete GL', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 2: Create SLA', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 3: Create GL', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 4: Post GL', status: null, url: null, request: null, response: null, responseStatus: null },
        { label: 'Step 5: Stamp GL IDs', status: null, url: null, request: null, response: null, responseStatus: null },
      ],
    }));

    setBatchProgressData(progressData);
    setBatchProgressModalOpen(true);
    setBatchConfirmed(false);
  };

  // Batch run all steps for multiple selected invoices - uses same executeAllSteps logic as debug dialog
  const runBatchReCreateAccounting = async () => {
    if (!batchConfirmed) return;

    const selectedInvoices = accountingAllData.filter(acc => accountingAllSelectedKeys.includes(acc.invoiceId));

    if (selectedInvoices.length === 0) {
      message.warning('No valid invoices selected');
      return;
    }

    setBatchProcessing(true);
    message.destroy();

    try {
      for (let batchIdx = 0; batchIdx < batchProgressData.length; batchIdx++) {
        const progressRecord = batchProgressData[batchIdx];
        const invoice = invoices.find(i => i.invoiceId === progressRecord.invoiceId);

        if (!invoice) {
          console.warn(`Invoice not found: ${progressRecord.invoiceId}`);
          setBatchProgressData(prev => {
            const updated = [...prev];
            updated[batchIdx].steps.forEach((step: any) => step.status = 'failed');
            return updated;
          });
          continue;
        }

        console.log(`\n🔄 PROCESSING: ${progressRecord.invoiceNumber} (${batchIdx + 1}/${batchProgressData.length})`);

        try {
          // Fetch invoice lines
          const linesUrl = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${invoice.invoiceId}`;
          const linesRes = await fetch(linesUrl);
          const linesData = linesRes.ok ? await linesRes.json().catch(() => ({})) : {};
          const allItems: any[] = linesData.items || (Array.isArray(linesData) ? linesData : []);

          // Build payload for this invoice
          const invoicePayload = {
            header: {
              sourceId: invoice.invoiceId,
              sourceNumber: invoice.invoiceNumber,
              sourceTable: 'AP_INVOICES',
              eventType: 'AP_INVOICE_CREATION'
            },
            lines: allItems
          };

          // Build steps for this invoice
          const steps = buildPreviewDebugSteps(invoicePayload);

          // Reset state for this invoice
          setPreviewPayload(invoicePayload);
          setPreviewSlaHeaderId(null);
          setPreviewGlBatchId(null);
          setPreviewGlHeaderId(null);
          setPreviewGlBatchName('');
          setPreviewSlaCheckResponse(null);
          setPreviewGlCheckResponse(null);

          // Run all 8 steps using the same shared logic as debug dialog
          const results = await executeAllSteps(steps, progressRecord.invoiceNumber);

          // Update batch progress with results
          setBatchProgressData(prev => {
            const updated = [...prev];
            results.forEach((result: any) => {
              if (updated[batchIdx] && updated[batchIdx].steps[result.stepIdx]) {
                updated[batchIdx].steps[result.stepIdx].status = result.status;
                updated[batchIdx].steps[result.stepIdx].url = result.url;
                updated[batchIdx].steps[result.stepIdx].request = result.request;
                updated[batchIdx].steps[result.stepIdx].response = result.response;
                updated[batchIdx].steps[result.stepIdx].responseStatus = result.responseStatus;
              }
            });
            return updated;
          });

          // Add delay between invoices
          if (batchIdx < batchProgressData.length - 1) {
            console.log(`\n⏳ Waiting 1 second before next invoice...\n`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error: any) {
          console.error(`Error processing invoice ${progressRecord.invoiceNumber}:`, error);
          setBatchProgressData(prev => {
            const updated = [...prev];
            updated[batchIdx].steps.forEach((step: any) => step.status = 'failed');
            return updated;
          });
        }
      }

      message.success('✓ Batch processing completed!');
      setAccountingAllSelectedKeys([]);
    } catch (error: any) {
      message.error(`Batch processing error: ${error.message}`);
    } finally {
      setBatchProcessing(false);
    }
  };

  // Run individual debug step
  const runPreviewDebugStep = async (stepIdx: number, executionContext?: any) => {
    if (!previewPayload || !previewDebugSteps[stepIdx]) return;

    // Prevent concurrent execution of the same step
    if (executingStepIdx === stepIdx) {
      message.warning('⏳ This step is already running...');
      return;
    }

    // Set loading state
    const setLoading = (isLoading: boolean) => {
      setPreviewDebugSteps(prev => {
        const updated = [...prev];
        updated[stepIdx] = { ...updated[stepIdx], loading: isLoading };
        return updated;
      });
    };

    // Mark this step as executing
    setExecutingStepIdx(stepIdx);
    setLoading(true);

    try {
      // Step 4 (Create SLA) - ALWAYS refresh SLA check status before creating
      if (stepIdx === 4) {
        console.log('🔍 Step 4: Refreshing SLA status before creation...');
        message.info('🔍 Refreshing SLA status before creation...');

        try {
          // Get fresh SLA check data
          const activePayload = previewPayload;
          const invoiceId = activePayload?.header?.sourceId;

          const checkUrl = `${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=${invoiceId}&eventType=AP_INVOICE_CREATION`;
          console.log(`📤 Checking SLA: ${checkUrl}`);
          const checkResponse = await fetch(checkUrl, { method: 'GET', headers: { Accept: 'application/json' } });
          const checkData = await checkResponse.json();

          console.log('📥 SLA Check response:', checkData);

          // Update the stored SLA check response with fresh data
          setPreviewSlaCheckResponse(checkData);

          // Update Step 0 response in the steps array
          setPreviewDebugSteps(prev => {
            const updated = [...prev];
            updated[0] = { ...updated[0], response: checkData, status: checkResponse.status };
            return updated;
          });

          // Check the fresh response
          const exists = checkData.exists || checkData.header_exists || false;

          if (exists) {
            message.warning(`⏭️ SLA already exists (exists: ${exists}) - Skipping creation`);
            setExecutingStepIdx(null);
            setLoading(false);
            return;
          }

          message.success(`✓ SLA check passed (exists: false) - Safe to create`);
        } catch (checkError: any) {
          console.error('Error refreshing SLA check:', checkError);
          message.error(`Failed to check SLA status before creation: ${checkError.message}`);
          setExecutingStepIdx(null);
          setLoading(false);
          return;
        }
      }

      // Step 5 (Create GL) - ALWAYS refresh GL check status before creating
      if (stepIdx === 5) {
        console.log('🔍 Step 5: Refreshing GL status before creation...');
        message.info('🔍 Refreshing GL status before creation...');

        try {
          // Get fresh GL check data with proper parameters
          const activePayload = previewPayload;
          const invoiceId = activePayload?.header?.sourceId;
          const invoiceNumber = activePayload?.header?.sourceNumber;

          const checkUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/check?reference1=${invoiceNumber}&reference2=${invoiceId}&reference5=AP-INVOICE-CREATION`;
          console.log(`📤 Checking GL: ${checkUrl}`);
          const checkResponse = await fetch(checkUrl, { method: 'GET', headers: { Accept: 'application/json' } });
          const checkData = await checkResponse.json();

          console.log('📥 GL Check response:', checkData);

          // Update the stored GL check response with fresh data
          setPreviewGlCheckResponse(checkData);

          // Update Step 2 response in the steps array
          setPreviewDebugSteps(prev => {
            const updated = [...prev];
            updated[2] = { ...updated[2], response: checkData, status: checkResponse.status };
            return updated;
          });

          // Check the fresh response
          const exists = checkData.exists || checkData.journal_exists || false;

          if (exists) {
            message.warning(`⏭️ GL already exists (exists: ${exists}) - Skipping creation`);
            setExecutingStepIdx(null);
            setLoading(false);
            return;
          }

          message.success(`✓ GL check passed (exists: false) - Safe to create`);
        } catch (checkError: any) {
          console.error('Error refreshing GL check:', checkError);
          message.error(`Failed to check GL status before creation: ${checkError.message}`);
          setExecutingStepIdx(null);
          setLoading(false);
          return;
        }
      }

      const step = previewDebugSteps[stepIdx];
      const opts: RequestInit = {
        method: step.method,
        headers: { Accept: 'application/json' },
      };

      // Replace URL placeholders with actual captured IDs
      const glBatchNameValue = previewGlBatchName || 'AP-BATCH';
      let url = step.url
        .replace('{glBatchId}', String(previewGlBatchId || 'placeholder'))
        .replace('{slaHeaderId}', String(previewSlaHeaderId || 'placeholder'))
        .replace('{glBatchName}', glBatchNameValue)
        .replace('{glHeaderId}', String(previewGlHeaderId || 'placeholder'));

      // Handle request body with placeholder replacements
      let requestBody = step.requestBody;
      if (requestBody && typeof requestBody === 'object') {
        // Create a copy and replace placeholders in the body
        const bodyStr = JSON.stringify(requestBody);
        const replacedBodyStr = bodyStr
          .replace(/{slaHeaderId}/g, String(previewSlaHeaderId || '0'))
          .replace(/{glBatchId}/g, String(previewGlBatchId || '0'))
          .replace(/{glHeaderId}/g, String(previewGlHeaderId || '0'))
          .replace(/{glBatchName}/g, glBatchNameValue);

        try {
          requestBody = JSON.parse(replacedBodyStr);
        } catch (e) {
          console.error('Failed to parse replaced body:', replacedBodyStr);
        }

        opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(requestBody);
      }

      console.log('🔌 Running step:', {
        stepIdx,
        method: step.method,
        url,
        body: requestBody
      });

      console.log(`📤 Fetching: ${step.method} ${url.split('?')[0]}`);

      const res = await fetch(url, opts);
      const text = await res.text();
      let data: any = {};

      // Try to parse response as JSON
      if (text && text.trim()) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { message: text };
        }
      }

      console.log(`📥 Response Status: ${res.status}`, { data });

      // Update response and clear loading
      setPreviewDebugSteps(prev => {
        const updated = [...prev];
        updated[stepIdx] = { ...updated[stepIdx], status: res.status, response: data, loading: false };
        return updated;
      });

      // Clear execution state
      setExecutingStepIdx(null);
      setLoading(false);

      if (res.ok) {
        if (stepIdx === 0) {
          // SLA check - capture response and prepare deletion
          const exists = data.exists || data.header_exists || false;
          const headerId = data.headerId || data.header_id;
          // Store check response for Step 2 conditional
          setPreviewSlaCheckResponse(data);
          if (headerId) {
            if (executionContext?.setCapturedIds) {
              executionContext.setCapturedIds({ slaHeaderId: headerId });
            } else {
              setPreviewSlaHeaderId(headerId);
            }
            // Update Step 0.1 request body with the captured headerId
            setPreviewDebugSteps(prev => {
              const updated = [...prev];
              updated[1] = { ...updated[1], requestBody: { headerId } };
              return updated;
            });
            console.log('SLA found with ID:', headerId);
          }
          message.success(exists ? `✓ SLA exists (ID: ${headerId}) - Step 0.1 will delete it` : '✓ No SLA found');
        } else if (stepIdx === 1) {
          // SLA delete
          message.success('✓ SLA deleted successfully');
        } else if (stepIdx === 2) {
          // GL check - capture response and prepare deletion
          const exists = data.exists || data.journal_exists || data.items?.length > 0 || false;
          let batchId = data.jeBatchId || data.je_batch_id || data.batchId || data.batch_id;
          if (!batchId && data.items?.length > 0) {
            batchId = data.items[0].jeBatchId || data.items[0].je_batch_id || data.items[0].batchId;
          }
          // Store check response for Step 3 conditional
          setPreviewGlCheckResponse(data);
          if (batchId) {
            if (executionContext?.setCapturedIds) {
              executionContext.setCapturedIds({ glBatchId: batchId });
            } else {
              setPreviewGlBatchId(batchId);
            }
            // Update Step 1.1 URL with the captured batchId
            setPreviewDebugSteps(prev => {
              const updated = [...prev];
              updated[3] = { ...updated[3], url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${batchId}` };
              return updated;
            });
            console.log('GL found with Batch ID:', batchId);
          }
          message.success(exists ? `✓ GL exists (Batch ID: ${batchId}) - Step 1.1 will delete it` : '✓ No GL found');
        } else if (stepIdx === 3) {
          // GL delete
          message.success('✓ GL deleted successfully');
        } else if (stepIdx === 4) {
          // SLA creation - extract and save SLA header ID
          const slaId = data.headerId || data.header_id;
          if (slaId) {
            if (executionContext?.setCapturedIds) {
              executionContext.setCapturedIds({ slaHeaderId: slaId });
            } else {
              setPreviewSlaHeaderId(slaId);
            }
            console.log('SLA created:', slaId);
            message.success(`✓ SLA Accounting created (ID: ${slaId})`);
          } else {
            message.success(`Step ${stepIdx + 1} completed successfully`);
          }
        } else if (stepIdx === 5) {
          // GL journal creation - extract and save batch ID
          console.log('Step 5 full response:', data);

          // Try multiple field names for batchId
          let batchId = data.jeBatchId || data.je_batch_id || data.batchId || data.batch_id;

          // If not found, try nested properties
          if (!batchId && data.batch?.id) batchId = data.batch.id;
          if (!batchId && data.batch?.batchId) batchId = data.batch.batchId;
          if (!batchId && data.header?.id) batchId = data.header.id;
          if (!batchId && data.header?.batchId) batchId = data.header.batchId;

          // Try to extract from headers array if it exists
          if (!batchId && data.headers?.length > 0) {
            batchId = data.headers[0].batchId || data.headers[0].id;
          }

          const headerId = data.jeHeaderId || data.je_header_id || data.headerId || data.header_id;

          if (batchId) {
            if (executionContext?.setCapturedIds) {
              executionContext.setCapturedIds({ glBatchId: batchId });
            } else {
              setPreviewGlBatchId(batchId);
            }
            console.log('✓ GL journal created with Batch ID:', batchId);
            message.success(`✓ GL Journal created (Batch ID: ${batchId})`);
          } else {
            console.warn('⚠️ Batch ID not found in response. Available fields:', Object.keys(data));
            message.warning('⚠️ Step completed but Batch ID not found in response. Check console logs.');
          }
          if (headerId) {
            if (executionContext?.setCapturedIds) {
              executionContext.setCapturedIds({ glHeaderId: headerId });
            } else {
              setPreviewGlHeaderId(headerId);
            }
          }

          // Capture batch name if available
          const batchName = data.batchName || data.batch_name || data.batch?.batchName || 'AP-BATCH';
          setPreviewGlBatchName(batchName);
          console.log('Batch name:', batchName);
        } else {
          message.success(`Step ${stepIdx} completed successfully`);
        }
      }
    } catch (error: any) {
      console.error('Step execution error:', error);
      setPreviewDebugSteps(prev => {
        const updated = [...prev];
        updated[stepIdx] = { ...updated[stepIdx], response: { error: error.message }, loading: false };
        return updated;
      });
      setExecutingStepIdx(null);
      setLoading(false);
      message.error(`Step ${stepIdx + 1} failed: ${error.message}`);
    }
  };

  // Delete SLA accounting entry
  const handleDeleteSla = async () => {
    if (!previewSlaHeaderId) {
      message.error('No SLA header ID available. Run Step 2 first.');
      return;
    }

    try {
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ headerId: previewSlaHeaderId })
      });

      if (res.ok) {
        message.success(`✓ SLA accounting (ID: ${previewSlaHeaderId}) deleted successfully`);
        setPreviewSlaHeaderId(null);
      } else {
        message.error(`Failed to delete SLA: HTTP ${res.status}`);
      }
    } catch (err: any) {
      message.error(`Error deleting SLA: ${err.message}`);
    }
  };

  // Delete GL journal batch
  const handleDeleteGlJournal = async () => {
    if (!previewGlBatchId) {
      message.error('No GL batch ID available. Run Step 3 first.');
      return;
    }

    try {
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${previewGlBatchId}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });

      if (res.ok) {
        message.success(`✓ GL journal batch (ID: ${previewGlBatchId}) deleted successfully`);
        setPreviewGlBatchId(null);
      } else {
        message.error(`Failed to delete GL journal: HTTP ${res.status}`);
      }
    } catch (err: any) {
      message.error(`Error deleting GL journal: ${err.message}`);
    }
  };

  // Manual delete SLA by entered ID or auto-captured ID
  const handleManualDeleteSla = async () => {
    const idToDelete = manualSlaDeleteId.trim() ? Number(manualSlaDeleteId) : previewSlaHeaderId;

    if (!idToDelete) {
      message.error('No SLA Header ID available. Run Step 2 first or enter an ID manually.');
      return;
    }

    try {
      console.log('🔌 Deleting SLA:', {
        endpoint: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/delete`,
        method: 'POST',
        body: { headerId: idToDelete },
      });

      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ headerId: idToDelete })
      });

      console.log('📥 SLA Delete Response Status:', res.status);

      if (res.ok) {
        message.success(`✓ SLA (ID: ${idToDelete}) deleted successfully`);
        setManualSlaDeleteId('');
        setPreviewSlaHeaderId(null);
      } else {
        message.error(`Failed to delete SLA: HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error('❌ SLA Delete Error:', err);
      message.error(`Error: ${err.message}`);
    }
  };

  // Manual delete GL journal by entered ID or auto-captured ID
  const handleManualDeleteGlJournal = async () => {
    const idToDelete = manualGlDeleteId.trim() ? manualGlDeleteId : (previewGlBatchId ? String(previewGlBatchId) : null);

    if (!idToDelete) {
      message.error('No GL Batch ID available. Run Step 3 first or enter an ID manually.');
      return;
    }

    try {
      console.log('🔌 Deleting GL Journal:', {
        endpoint: `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${idToDelete}`,
        method: 'DELETE',
        body: 'No body (DELETE request)',
      });

      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${idToDelete}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });

      console.log('📥 GL Delete Response Status:', res.status);

      if (res.ok) {
        message.success(`✓ GL Journal (ID: ${idToDelete}) deleted successfully`);
        setManualGlDeleteId('');
        setPreviewGlBatchId(null);
      } else {
        message.error(`Failed to delete GL journal: HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error('❌ GL Delete Error:', err);
      message.error(`Error: ${err.message}`);
    }
  };

  // Approval menu items
  const approvalMenuItems: MenuProps['items'] = [
    { key: 'approve', label: 'Approve', icon: <CheckCircleOutlined /> },
    { key: 'reject', label: 'Reject', icon: <CloseCircleOutlined /> },
    { key: 'requestInfo', label: 'Request Information', icon: <FileTextOutlined /> },
  ];

  // Post menu items
  const postMenuItems: MenuProps['items'] = [
    { key: 'post', label: 'Post to GL', icon: <SendOutlined /> },
    { key: 'unpost', label: 'Unpost', icon: <StopOutlined /> },
  ];

  // Table columns
  const columns: ColumnsType<InvoiceRecord> = [
    {
      title: '',
      key: 'accounting',
      width: 40,
      fixed: 'left',
      render: (_: any, record: InvoiceRecord) => (
        <Tooltip title="View Accounting">
          <Button
            size="small"
            type="text"
            icon={<AccountBookOutlined style={{ color: REDWOOD.info, fontSize: 14 }} />}
            style={{ padding: '0 2px' }}
            onClick={(e) => { e.stopPropagation(); openAccountingForSingle(record); }}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Invoice Number',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      width: 200,
      fixed: 'left',
      render: (text: string, record: InvoiceRecord) => (
        <Space size={4}>
          <Tooltip title={APPROVAL_ACTIONED_STATUSES.includes(record.approvalStatus) ? 'Resend for Approval' : 'Send for Approval'}>
            <Button
              size="small"
              type="text"
              icon={<AuditOutlined style={{ color: REDWOOD.info, fontSize: 14 }} />}
              style={{ padding: '0 2px' }}
              onClick={(e) => { e.stopPropagation(); openInvApprovalModal(record); }}
            />
          </Tooltip>
          {APPROVAL_ACTIONED_STATUSES.includes(record.approvalStatus) ? (
            <Tooltip title="View Approval History">
              <Button
                size="small"
                type="text"
                icon={<CheckCircleOutlined style={{
                  color: record.approvalStatus === 'PENDING'
                    ? REDWOOD.warning
                    : record.approvalStatus === 'Rejected'
                    ? REDWOOD.error
                    : REDWOOD.success,
                  fontSize: 14,
                }} />}
                style={{ padding: '0 2px' }}
                onClick={(e) => { e.stopPropagation(); setInvStatusTarget(record); setInvStatusOpen(true); }}
              />
            </Tooltip>
          ) : null}
          <a
            onClick={() => openInvoiceTab(record)}
            style={{ color: REDWOOD.info, cursor: 'pointer' }}
          >
            {text}
          </a>
          {record.hasMpa && (
            <Tooltip title="View Multiperiod Schedule">
              <CalendarOutlined
                style={{ color: '#722ed1', fontSize: 13, cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); openMpaModal(record); }}
              />
            </Tooltip>
          )}
        </Space>
      ),
      sorter: (a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber),
    },
    {
      title: 'Accounting Status',
      dataIndex: 'accountingStatus',
      key: 'accountingStatus',
      width: 150,
      render: (status: string) => getAccountingStatusTag(status),
      filters: [
        { text: 'Accounted',       value: 'Accounted' },
        { text: 'Draft Accounted', value: 'Draft Accounted' },
        { text: 'Not Accounted',   value: 'Not Accounted' },
        { text: 'Error',           value: 'Error' },
      ],
      onFilter: (value, record) => record.accountingStatus === value,
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      width: 110,
      sorter: true,
    },
    {
      title: 'Supplier or Party',
      dataIndex: 'supplierOrParty',
      key: 'supplierOrParty',
      width: 220,
      ellipsis: true,
    },
    {
      title: 'Su Sit',
      dataIndex: 'supplierSite',
      key: 'supplierSite',
      width: 80,
      render: (text: string) => (
        <Tooltip title={text}>
          <span style={{ color: REDWOOD.primary, cursor: 'pointer' }}>
            <FileTextOutlined />
          </span>
        </Tooltip>
      ),
    },
    {
      title: 'Unpaid / Open Credit',
      dataIndex: 'unpaidAmount',
      key: 'unpaidAmount',
      width: 140,
      align: 'right',
      render: (value: number, record: InvoiceRecord) => {
        const isCredit = value < 0;
        return (
          <span style={{ color: value === 0 ? REDWOOD.neutral600 : isCredit ? REDWOOD.warning : REDWOOD.neutral900 }}>
            {isCredit ? `(${formatAmount(Math.abs(value))})` : formatAmount(value)} {record.invoiceCurrency}
            {isCredit && <span style={{ fontSize: 10, marginLeft: 4, color: REDWOOD.warning }}>(credit)</span>}
          </span>
        );
      },
    },
    {
      title: 'Invoice Amount',
      dataIndex: 'invoiceAmount',
      key: 'invoiceAmount',
      width: 130,
      align: 'right',
      render: (value: number, record: InvoiceRecord) => (
        <span style={{ color: value < 0 ? REDWOOD.error : REDWOOD.info, fontWeight: 500 }}>
          {formatAmount(value)} {record.invoiceCurrency}
        </span>
      ),
      sorter: (a, b) => a.invoiceAmount - b.invoiceAmount,
    },
    {
      title: 'Avail. Balance',
      key: 'availableBalance',
      width: 130,
      align: 'right' as const,
      render: (_: any, record: InvoiceRecord) => {
        if (record.invoiceType !== 'Prepayment') return <span style={{ color: '#bbb' }}>—</span>;
        const bal = prepayBalances[record.invoiceId];
        if (bal === undefined) return <span style={{ color: '#bbb', fontSize: 11 }}>…</span>;
        if (bal === null)      return <span style={{ color: '#bbb' }}>—</span>;
        return (
          <span style={{
            fontWeight: 600,
            color: bal > 0 ? REDWOOD.success : bal < 0 ? REDWOOD.error : '#bbb',
          }}>
            {formatAmount(bal)} {record.invoiceCurrency}
          </span>
        );
      },
      sorter: (a: InvoiceRecord, b: InvoiceRecord) =>
        (prepayBalances[a.invoiceId] ?? -Infinity) - (prepayBalances[b.invoiceId] ?? -Infinity),
    },
    {
      title: 'Applied Prepayments',
      dataIndex: 'appliedPrepayments',
      key: 'appliedPrepayments',
      width: 140,
      align: 'right',
      render: (value: number, record: InvoiceRecord) => (
        <span>{formatAmount(value)} {record.invoiceCurrency}</span>
      ),
    },
    {
      title: 'Paid By',
      key: 'paidBy',
      width: 110,
      align: 'center' as const,
      render: (_: any, record: InvoiceRecord) => {
        const m = getPayMethod(record);
        if (m === 'open')       return <Tag style={{ fontSize: 10 }}>Open</Tag>;
        if (m === 'payment')    return <Tag color="green"  style={{ fontSize: 10 }}>Payment</Tag>;
        if (m === 'prepayment') return <Tag color="blue"   style={{ fontSize: 10 }}>Prepayment</Tag>;
        return (
          <Space size={2} direction="vertical" style={{ alignItems: 'center' }}>
            <Tag color="green" style={{ fontSize: 10, margin: 0 }}>Payment</Tag>
            <Tag color="blue"  style={{ fontSize: 10, margin: 0 }}>Prepayment</Tag>
          </Space>
        );
      },
    },
    {
      title: 'Invoice Type',
      dataIndex: 'invoiceType',
      key: 'invoiceType',
      width: 110,
    },
    {
      title: 'Attachments',
      dataIndex: 'attachments',
      key: 'attachments',
      width: 110,
      render: (text: string, record: InvoiceRecord) => (
        <Space size={6}>
          {text !== 'None' ? (
            <Tooltip title="View APEX attachments">
              <PaperClipOutlined
                style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 16 }}
                onClick={() => fetchAttachments(record.invoiceId, record.invoiceNumber)}
              />
            </Tooltip>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
          )}
          <Tooltip title="Explore Fusion attachments">
            <CloudOutlined
              style={{ color: '#722ed1', cursor: 'pointer', fontSize: 16 }}
              onClick={() => fetchFusionAttachments(record.invoiceNumber)}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      key: 'notes',
      width: 80,
      render: (text: string) => (
        text ? (
          <Tooltip title={text}>
            <FileTextOutlined style={{ color: REDWOOD.info, cursor: 'pointer' }} />
          </Tooltip>
        ) : null
      ),
    },
    {
      title: 'Validation Status',
      dataIndex: 'validationStatus',
      key: 'validationStatus',
      width: 180,
      render: (status: string, record: InvoiceRecord) => (
        <Space size={4} wrap>
          {getValidationStatusTag(status)}
          {record.holdPaidStatus === 'Cancelled' && (
            <Tag style={{ background: REDWOOD.error, color: '#fff', border: 'none', fontSize: 11 }}>Cancelled</Tag>
          )}
        </Space>
      ),
      filters: [
        { text: 'Validated', value: 'Validated' },
        { text: 'Needs revalidation', value: 'Needs revalidation' },
        { text: 'Canceled', value: 'Canceled' },
        { text: 'Never validated', value: 'Never validated' },
      ],
      onFilter: (value, record) => record.validationStatus === value,
    },
    {
      title: 'Approval Status',
      dataIndex: 'approvalStatus',
      key: 'approvalStatus',
      width: 140,
      render: (status: string) => getApprovalStatusTag(status),
    },
    {
      title: 'Paid Status',
      dataIndex: 'holdPaidStatus',
      key: 'holdPaidStatus',
      width: 120,
      render: (status: string) => {
        if (status === 'Cancelled')
          return <Tag color="red" style={{ fontSize: 11 }}>Cancelled</Tag>;
        if (status === 'Fully Paid')
          return <Tag color="success" style={{ fontSize: 11 }}>Fully Paid</Tag>;
        if (status === 'Partially Paid')
          return <Tag color="warning" style={{ fontSize: 11 }}>Partially Paid</Tag>;
        return <Tag color="default" style={{ fontSize: 11 }}>Unpaid</Tag>;
      },
    },
    {
      title: 'Business Unit',
      dataIndex: 'businessUnit',
      key: 'businessUnit',
      width: 180,
      ellipsis: true,
    },
    {
      title: 'Fusion Sync',
      dataIndex: 'syncStatus',
      key: 'syncStatus',
      width: 120,
      render: (status: string) => status === 'SYNCED'
        ? <Tag color="purple" style={{ fontSize: 11 }}>Fusion Synced</Tag>
        : null,
      filters: [
        { text: 'Fusion Synced', value: 'SYNCED' },
        { text: 'Local', value: '' },
      ],
      onFilter: (value, record) => record.syncStatus === value,
    },
    {
      title: 'Creation Date',
      dataIndex: 'creationDate',
      key: 'creationDateEnd',
      width: 120,
    },
    {
      title: 'Created By',
      dataIndex: 'createdBy',
      key: 'createdBy',
      width: 130,
      ellipsis: true,
    },
  ];

  // Row selection config
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // Build tab items
  const tabItems = [
    {
      key: 'search',
      label: 'Search Results',
      closable: false,
      children: (
        <div style={{ padding: 16 }}>
          {/* Search Section */}
          <Card
            style={{
              marginBottom: 16,
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
            }}
            styles={{ body: { padding: searchCollapsed ? 0 : 16 } }}
          >
            <Collapse
              ghost
              defaultActiveKey={['search']}
              onChange={(keys) => setSearchCollapsed(keys.length === 0)}
              items={[
                {
                  key: 'search',
                  label: (
                    <Space>
                      <FilterOutlined />
                      <Text strong>Search: Invoice</Text>
                    </Space>
                  ),
                  extra: (
                    <Space onClick={(e) => e.stopPropagation()}>
                      <Button size="small">Advanced</Button>
                      <Select
                        size="small"
                        defaultValue="all"
                        style={{ width: 150 }}
                        options={[
                          { value: 'all', label: 'All Invoices' },
                          { value: 'recent', label: 'Recent Invoices' },
                          { value: 'pending', label: 'Pending Invoices' },
                        ]}
                      />
                    </Space>
                  ),
                  children: (
                    <Form
                      form={form}
                      layout="horizontal"
                      onFinish={handleSearch}
                      size="small"
                      labelCol={{ span: 8 }}
                      wrapperCol={{ span: 16 }}
                      labelAlign="right"
                      initialValues={{ invoiceDate: dayjs() }}
                    >
                      <Row gutter={32}>
                        <Col span={12}>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}>Business Unit</Text>}
                            name="businessUnit"
                            style={{ marginBottom: 8 }}
                          >
                            <Select placeholder="Select Business Unit" allowClear showSearch optionFilterProp="children">
                              {businessUnits.map(bu => (
                                <Option key={bu.name} value={bu.name}>{bu.name}</Option>
                              ))}
                            </Select>
                          </Form.Item>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}><span style={{ color: REDWOOD.primary }}>**</span> Invoice Number</Text>}
                            name="invoiceNumber"
                            style={{ marginBottom: 8 }}
                          >
                            <Input placeholder="Enter invoice number" />
                          </Form.Item>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}>Invoice Amount</Text>}
                            name="invoiceAmount"
                            style={{ marginBottom: 8 }}
                          >
                            <InputNumber style={{ width: '100%' }} placeholder="0.00" />
                          </Form.Item>
                          {/* Invoice Date with operator */}
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}><span style={{ color: REDWOOD.primary }}>**</span> Invoice Date</Text>}
                            style={{ marginBottom: 8 }}
                          >
                            <AntSpace.Compact style={{ width: '100%' }}>
                              <Select
                                value={invoiceDateOp}
                                onChange={(v) => {
                                  setInvoiceDateOp(v);
                                  form.setFieldsValue({ invoiceDate: undefined, invoiceDateRange: undefined });
                                }}
                                style={{ width: 130, flexShrink: 0 }}
                                options={[
                                  { value: '=',          label: 'Equal to' },
                                  { value: 'between',    label: 'Between' },
                                  { value: 'before',     label: 'Before' },
                                  { value: 'after',      label: 'After' },
                                  { value: 'past10',     label: 'Past 10 days' },
                                  { value: 'past20',     label: 'Past 20 days' },
                                  { value: 'past30',     label: 'Past 30 days' },
                                  { value: 'past60',     label: 'Past 60 days' },
                                  { value: 'this_month', label: 'This month' },
                                  { value: 'last_month', label: 'Last month' },
                                ]}
                              />
                              {(invoiceDateOp === '=' || invoiceDateOp === 'before' || invoiceDateOp === 'after') && (
                                <Form.Item name="invoiceDate" noStyle>
                                  <DatePicker style={{ flex: 1 }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
                                </Form.Item>
                              )}
                              {invoiceDateOp === 'between' && (
                                <Form.Item name="invoiceDateRange" noStyle>
                                  <DatePicker.RangePicker style={{ flex: 1 }} format="DD-MMM-YYYY" />
                                </Form.Item>
                              )}
                              {['past10','past20','past30','past60','this_month','last_month'].includes(invoiceDateOp) && (
                                <Input
                                  disabled
                                  style={{ flex: 1, color: '#666', background: '#f5f5f5', fontSize: 12 }}
                                  value={
                                    invoiceDateOp === 'past10'     ? `${dayjs().subtract(10,'day').format('DD-MMM-YYYY')} → Today` :
                                    invoiceDateOp === 'past20'     ? `${dayjs().subtract(20,'day').format('DD-MMM-YYYY')} → Today` :
                                    invoiceDateOp === 'past30'     ? `${dayjs().subtract(30,'day').format('DD-MMM-YYYY')} → Today` :
                                    invoiceDateOp === 'past60'     ? `${dayjs().subtract(60,'day').format('DD-MMM-YYYY')} → Today` :
                                    invoiceDateOp === 'this_month' ? `${dayjs().startOf('month').format('DD-MMM')} → ${dayjs().endOf('month').format('DD-MMM-YYYY')}` :
                                    invoiceDateOp === 'last_month' ? (() => { const lm = dayjs().subtract(1,'month'); return `${lm.startOf('month').format('DD-MMM')} → ${lm.endOf('month').format('DD-MMM-YYYY')}`; })() : ''
                                  }
                                />
                              )}
                            </AntSpace.Compact>
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}><span style={{ color: REDWOOD.primary }}>**</span> Supplier or Party</Text>}
                            name="supplierOrParty"
                            style={{ marginBottom: 8 }}
                          >
                            <Input
                              placeholder="Search supplier"
                              readOnly
                              suffix={
                                <SearchOutlined
                                  style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 14 }}
                                  onClick={openSupplierModal}
                                />
                              }
                              onClick={openSupplierModal}
                              style={{ cursor: 'pointer' }}
                            />
                          </Form.Item>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}><span style={{ color: REDWOOD.primary }}>**</span> Supplier Number</Text>}
                            name="supplierNumber"
                            style={{ marginBottom: 8 }}
                          >
                            <Input placeholder="e.g. H014" />
                          </Form.Item>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}>Supplier Site</Text>}
                            name="supplierSite"
                            style={{ marginBottom: 8 }}
                          >
                            <Select placeholder="Select site" allowClear>
                              <Option value="SHARJAH">SHARJAH</Option>
                              <Option value="DUBAI">DUBAI</Option>
                            </Select>
                          </Form.Item>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}><span style={{ color: REDWOOD.primary }}>**</span> Invoice Group</Text>}
                            name="invoiceGroup"
                            style={{ marginBottom: 8 }}
                          >
                            <Input placeholder="Enter invoice group" />
                          </Form.Item>
                          <Form.Item
                            label={<Text style={{ fontSize: 12 }}>Invoice Type</Text>}
                            name="invoiceType"
                            style={{ marginBottom: 8 }}
                          >
                            <Select placeholder="All types" allowClear>
                              <Option value="Standard">Standard</Option>
                              <Option value="Prepayment">Prepayment</Option>
                              <Option value="Credit Memo">Credit Memo</Option>
                              <Option value="Debit Memo">Debit Memo</Option>
                              <Option value="Mixed">Mixed</Option>
                              <Option value="Expense Report">Expense Report</Option>
                              <Option value="Quick">Quick</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row>
                        <Col span={24}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              <span style={{ color: REDWOOD.primary }}>**</span> At least one is required
                            </Text>
                            <Space>
                              <Button icon={<SearchOutlined />} type="primary" htmlType="submit" loading={loading}>
                                Search
                              </Button>
                              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                                Reset
                              </Button>
                              <Button icon={<SaveOutlined />}>
                                Save...
                              </Button>
                            </Space>
                          </div>
                        </Col>
                      </Row>
                    </Form>
                  ),
                },
              ]}
            />
          </Card>

          {/* Results Section */}
          <Card
            style={{
              borderRadius: 8,
              border: `1px solid ${REDWOOD.neutral200}`,
            }}
            styles={{ body: { padding: 0 } }}
          >
            {/* Action Toolbar */}
            <div style={{
              padding: '8px 16px',
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: REDWOOD.neutral100,
            }}>
              <Space size="small">
                <Dropdown menu={{ items: actionsMenuItems }} trigger={['click']}>
                  <Button size="small">
                    Actions <DownOutlined />
                  </Button>
                </Dropdown>
                <Dropdown menu={{ items: viewMenuItems, onClick: handleViewMenuClick }} trigger={['click']}>
                  <Button size="small">
                    View <DownOutlined />
                  </Button>
                </Dropdown>
                <Tooltip title="Edit">
                  <Button size="small" icon={<EditOutlined />} />
                </Tooltip>
                <Tooltip title="Add Attachment">
                  <Button size="small" icon={<PaperClipOutlined />} />
                </Tooltip>
                <Tooltip title="Export to Excel">
                  <Button size="small" icon={<DownloadOutlined />} onClick={exportToExcel} />
                </Tooltip>
                <Button size="small" icon={<ScissorOutlined />}>
                  Detach
                </Button>
                {(() => {
                  const selRec = selectedRowKeys.length === 1 ? invoices.find(i => i.key === selectedRowKeys[0]) : null;
                  const alreadyActioned = selRec ? APPROVAL_ACTIONED_STATUSES.includes(selRec.approvalStatus) : false;
                  const tooltipMsg = selectedRowKeys.length !== 1
                    ? 'Select one invoice to send for approval'
                    : alreadyActioned
                      ? `Invoice already ${selRec!.approvalStatus}`
                      : `Send invoice ${selRec?.invoiceNumber || ''} for approval`;
                  return (
                    <Tooltip title={tooltipMsg}>
                      <Button
                        size="small"
                        icon={<AuditOutlined />}
                        style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                        disabled={selectedRowKeys.length !== 1 || alreadyActioned}
                        onClick={() => { if (selRec) openInvApprovalModal(selRec); }}
                      >
                        Send for Approval
                      </Button>
                    </Tooltip>
                  );
                })()}
                {selectedRowKeys.length > 0 && (
                  <Button
                    size="small"
                    onClick={() => setSelectedRowKeys([])}
                  >
                    Clear Selection ({selectedRowKeys.length})
                  </Button>
                )}
                <Tooltip title="Show invoice-wise debits and credits from GL">
                  <Button
                    size="small"
                    icon={<AccountBookOutlined />}
                    style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                    loading={accountingAllLoading}
                    onClick={async () => {
                      setAccountingAllModalOpen(true);
                      await fetchAllAccountingData();
                    }}
                  >
                    Show Accounting for All Invoices
                  </Button>
                </Tooltip>
                <Tooltip title={
                  selectedRowKeys.length === 0
                    ? 'Select one or more invoices to fetch applied prepayments from Oracle Fusion'
                    : selectedRowKeys.length === 1
                      ? `Fetch prepayments for invoice ${invoices.find(i => i.key === selectedRowKeys[0])?.invoiceNumber || ''}`
                      : `Fetch prepayments for ${selectedRowKeys.length} selected invoices`
                }>
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    style={{ color: '#722ed1', borderColor: '#722ed1' }}
                    disabled={selectedRowKeys.length === 0}
                    onClick={() => {
                      if (selectedRowKeys.length === 1) {
                        const rec = invoices.find(i => i.key === selectedRowKeys[0]);
                        if (rec) openPrepayFetch(rec);
                      } else {
                        openMultiFetch();
                      }
                    }}
                  >
                    Fetch Prepayments
                  </Button>
                </Tooltip>
              </Space>
              <Space size="middle" wrap>
                <Input.Search
                  size="small"
                  placeholder="Search results…"
                  allowClear
                  style={{ width: 200 }}
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                />
                <Radio.Group
                  size="small"
                  value={acctFilter}
                  onChange={e => setAcctFilter(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="all">All</Radio.Button>
                  <Radio.Button value="posted">Posted</Radio.Button>
                  <Radio.Button value="unposted">Unposted</Radio.Button>
                </Radio.Group>
                <Select
                  size="small"
                  value={payMethodFilter}
                  onChange={setPayMethodFilter}
                  style={{ width: 150 }}
                  options={[
                    { label: 'All Payment Types', value: 'all' },
                    { label: 'Payment Only',       value: 'payment' },
                    { label: 'Prepayment Only',    value: 'prepayment' },
                    { label: 'Mixed',              value: 'mixed' },
                  ]}
                />
                <Checkbox
                  checked={showFullyPaid}
                  onChange={(e) => setShowFullyPaid(e.target.checked)}
                  style={{ fontSize: 12 }}
                >
                  <Text style={{ fontSize: 12 }}>Show Fully Paid</Text>
                </Checkbox>
                <Select
                  size="small"
                  value={createdByFilter || '__all__'}
                  onChange={v => setCreatedByFilter(v === '__all__' ? '' : v)}
                  style={{ width: 160 }}
                  placeholder="Created By"
                >
                  <Option value="__all__">All Users</Option>
                  {[...new Set([user?.username, ...knownUsers].filter(Boolean) as string[])].sort().map(u => (
                    <Option key={u} value={u}>{u}</Option>
                  ))}
                </Select>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {displayedInvoices.length} of {invoices.length} items | {selectedRowKeys.length} selected
                </Text>
              </Space>
            </div>

            {/* Data Table */}
            <Table
              columns={columns}
              dataSource={displayedInvoices}
              rowSelection={rowSelection}
              loading={loading}
              pagination={{
                pageSize: 25,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
              }}
              scroll={{ x: 1800 }}
              size="small"
              rowClassName={(_record, index) => index % 2 === 0 ? '' : 'table-row-light'}
              onRow={(record) => ({
                onDoubleClick: () => openInvoiceTab(record),
                style: { cursor: 'pointer' },
              })}
              summary={() =>
                invoices.length > 0 ? (
                  <Table.Summary fixed>
                    <Table.Summary.Row
                      style={{ background: REDWOOD.neutral100 }}
                    >
                      {/* Checkbox */}
                      <Table.Summary.Cell index={0} />
                      {/* Invoice Number */}
                      <Table.Summary.Cell index={1}>
                        <Text strong style={{ fontSize: 12 }}>Totals</Text>
                      </Table.Summary.Cell>
                      {/* Invoice Date */}
                      <Table.Summary.Cell index={2} />
                      {/* Supplier or Party */}
                      <Table.Summary.Cell index={3} />
                      {/* Supplier Site */}
                      <Table.Summary.Cell index={4} />
                      {/* Unpaid Amount */}
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong style={{
                          fontSize: 12,
                          color: totals.unpaidAmount === 0 ? REDWOOD.neutral600 : REDWOOD.neutral900,
                        }}>
                          {formatAmount(totals.unpaidAmount)}
                        </Text>
                      </Table.Summary.Cell>
                      {/* Invoice Amount */}
                      <Table.Summary.Cell index={6} align="right">
                        <Text strong style={{
                          fontSize: 12,
                          color: totals.invoiceAmount < 0 ? REDWOOD.error : REDWOOD.info,
                        }}>
                          {formatAmount(totals.invoiceAmount)}
                        </Text>
                      </Table.Summary.Cell>
                      {/* Applied Prepayments */}
                      <Table.Summary.Cell index={7} align="right">
                        <Text strong style={{ fontSize: 12 }}>
                          {formatAmount(totals.appliedPrepayments)}
                        </Text>
                      </Table.Summary.Cell>
                      {/* Remaining empty cells */}
                      <Table.Summary.Cell index={8} />
                      <Table.Summary.Cell index={9} />
                      <Table.Summary.Cell index={10} />
                      <Table.Summary.Cell index={11} />
                      <Table.Summary.Cell index={12} />
                      <Table.Summary.Cell index={13} />
                      <Table.Summary.Cell index={14} />
                      <Table.Summary.Cell index={15} />
                      <Table.Summary.Cell index={16} />
                      <Table.Summary.Cell index={17} />
                    </Table.Summary.Row>
                  </Table.Summary>
                ) : null
              }
            />
          </Card>
        </div>
      ),
    },
    // Add open invoice tabs
    ...openTabs.map((tab) => ({
      key: tab.key,
      label: tab.label,
      closable: true,
      children: (
        <CreateInvoice
          onClose={() => closeInvoiceTab(tab.key)}
          initialData={tab.initialData}
          onSave={(savedValues) => {
            // Update tab label to invoice number after first save
            if (savedValues?.invoiceNumber) {
              const invNo = savedValues.invoiceNumber as string;
              const supplierShort = ((savedValues.supplier || '') as string).substring(0, 4).toUpperCase();
              const newLabel = supplierShort ? `${invNo} - ${supplierShort}` : invNo;
              setOpenTabs((prev) =>
                prev.map((t) => t.key === tab.key ? { ...t, label: newLabel } : t)
              );
            }
            // Refresh invoice list after save if search was previously executed
            if (invoices.length > 0) {
              form.submit();
            }
          }}
        />
      ),
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div style={{
          padding: '12px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/ap">Payables</Link> },
              { title: 'Manage Invoices' },
            ]}
          />
          <Space>
            <Tooltip title="Create Invoice">
              <Button
                type="primary"
                icon={<FileTextOutlined />}
                onClick={() => openCreateInvoiceTab()}
                style={{
                  background: REDWOOD.primary,
                  borderColor: REDWOOD.primary,
                  borderRadius: 6,
                  fontWeight: 500,
                }}
              >
                + Create Invoice
              </Button>
            </Tooltip>
            <Tooltip title="View Page APIs">
              <Button
                icon={<ApiOutlined />}
                onClick={() => setApiModalVisible(true)}
                style={{ color: REDWOOD.info }}
              />
            </Tooltip>
            <Button type="primary" style={{ background: REDWOOD.primary }}>
              Done
            </Button>
          </Space>
        </div>

        {/* Page Title and Tabs */}
        <div style={{ background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <div style={{ padding: '8px 16px 0 16px' }}>
            <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BankOutlined /> Manage Invoices (Search)
            </Title>
          </div>

          {/* Tab Navigation */}
          <Tabs
            type="editable-card"
            activeKey={activeTab}
            onChange={onTabChange}
            onEdit={onTabEdit}
            hideAdd
            items={tabItems}
            style={{ marginBottom: 0 }}
            tabBarStyle={{
              margin: 0,
              padding: '0 16px',
              background: REDWOOD.surface,
            }}
          />
        </div>

        {/* Custom styles */}
        <style>{`
          .table-row-light {
            background-color: ${REDWOOD.neutral100};
          }
          .ant-table-thead > tr > th {
            background: ${REDWOOD.neutral100} !important;
            font-weight: 600;
            font-size: 12px;
          }
          .ant-table-tbody > tr > td {
            font-size: 12px;
          }
          .ant-collapse-header {
            padding: 8px 16px !important;
          }
          .ant-form-item {
            margin-bottom: 12px;
          }
          .ant-form-item-label {
            padding-bottom: 2px !important;
          }
          .ant-form-item-label > label {
            font-size: 12px;
            color: ${REDWOOD.neutral600};
          }
          .ant-tabs-tab {
            border-radius: 4px 4px 0 0 !important;
          }
          .ant-tabs-tab-active {
            background: ${REDWOOD.surface} !important;
            border-bottom: 2px solid ${REDWOOD.primary} !important;
          }
          .ant-tabs-nav {
            margin-bottom: 0 !important;
          }
          .ant-tabs-content-holder {
            background: ${REDWOOD.neutral100};
          }
        `}</style>

        {/* Supplier Search Modal */}
        <Modal
          title={
            <Space>
              <SearchOutlined style={{ color: REDWOOD.info }} />
              <span>Search Suppliers</span>
            </Space>
          }
          open={supplierModalVisible}
          onCancel={() => setSupplierModalVisible(false)}
          footer={null}
          width={900}
          styles={{ body: { padding: '12px 24px' } }}
        >
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
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
            }}
            scroll={{ y: 400 }}
            onRow={(record) => ({
              onDoubleClick: () => handleSupplierSelect(record),
              style: { cursor: 'pointer' },
            })}
            rowClassName={(_record, index) => index % 2 === 0 ? '' : 'table-row-light'}
          />
        </Modal>

        {/* API Viewer Modal */}
        <Modal
          title={
            <Space>
              <ApiOutlined style={{ color: REDWOOD.info }} />
              <span>Page APIs - Manage Invoices</span>
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
          <div style={{ marginBottom: 16 }}>
            <Tag color="green">Data Source: APEX</Tag>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              This page uses APEX database for invoice operations
            </Text>
          </div>

          {/* Last Called URL */}
          {lastCalledUrl && (
            <Card
              size="small"
              style={{ marginBottom: 16, border: `1px solid ${lastApiResponse?.startsWith('Error') ? '#ff4d4f' : '#52c41a'}` }}
              title={
                <Space>
                  <CloudOutlined style={{ color: lastApiResponse?.startsWith('Error') ? '#ff4d4f' : '#52c41a' }} />
                  <Text strong>Last Called URL</Text>
                  <Tag color={lastApiResponse?.startsWith('Error') ? 'red' : 'green'}>
                    {lastApiResponse?.startsWith('Error') ? 'Failed' : 'Success'}
                  </Tag>
                </Space>
              }
            >
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>URL:</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code
                    style={{
                      background: '#fff7e6',
                      padding: '6px 10px',
                      borderRadius: 4,
                      fontSize: 12,
                      flex: 1,
                      wordBreak: 'break-all',
                      border: '1px solid #ffd591',
                    }}
                  >
                    {lastCalledUrl}
                  </code>
                  <Button
                    size="small"
                    icon={copiedUrl === lastCalledUrl ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={() => copyToClipboard(lastCalledUrl)}
                  />
                </div>
              </div>
              {lastApiResponse && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Response:</Text>
                  <div>
                    <code
                      style={{
                        background: lastApiResponse.startsWith('Error') ? '#fff2f0' : '#f6ffed',
                        padding: '6px 10px',
                        borderRadius: 4,
                        fontSize: 12,
                        display: 'block',
                        wordBreak: 'break-all',
                        border: `1px solid ${lastApiResponse.startsWith('Error') ? '#ffccc7' : '#b7eb8f'}`,
                      }}
                    >
                      {lastApiResponse}
                    </code>
                  </div>
                </div>
              )}
            </Card>
          )}

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
            {PAGE_APIS.apex.map((api, index) => {
              const exec = apiExecResults[index];
              const isSuccess = exec?.response && !exec.response.startsWith('Error') && (exec.response.includes('"status":"success"') || exec.response.includes('"items"') || exec.response.startsWith('HTTP 200'));
              return (
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
                        <Tag color={api.method === 'GET' ? 'blue' : 'orange'}>{api.method}</Tag>
                        <Text strong>{api.name}</Text>
                      </Space>
                    </Col>
                    {api.method === 'GET' && (
                      <Col>
                        <Button
                          size="small"
                          type="primary"
                          loading={exec?.loading}
                          onClick={() => executeApi(index, api.actualUrl)}
                          style={{ background: REDWOOD.success, borderColor: REDWOOD.success, fontSize: 12 }}
                        >
                          Execute
                        </Button>
                      </Col>
                    )}
                  </Row>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {api.description}
                  </Text>
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Proxy URL:</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {api.proxyUrl}{api.params ? `?${api.params}` : ''}
                      </code>
                      <Button size="small" icon={copiedUrl === api.proxyUrl ? <CheckOutlined /> : <CopyOutlined />} onClick={() => copyToClipboard(api.proxyUrl)} />
                    </div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Actual URL:</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code style={{ background: '#e8f5e9', padding: '4px 8px', borderRadius: 4, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {api.actualUrl}
                      </code>
                      <Button size="small" icon={copiedUrl === api.actualUrl ? <CheckOutlined /> : <CopyOutlined />} onClick={() => copyToClipboard(api.actualUrl)} />
                    </div>
                  </div>
                  {exec && !exec.loading && exec.response !== null && (
                    <div style={{ marginTop: 10 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Response:</Text>
                      <pre style={{
                        background: '#0d1117', borderRadius: 6, padding: '8px 10px',
                        fontSize: 11, fontFamily: 'monospace', maxHeight: 220,
                        overflowY: 'auto', overflowX: 'auto', margin: '4px 0 0',
                        color: isSuccess ? '#3fb950' : '#f85149',
                        border: `1px solid ${isSuccess ? '#238636' : '#da3633'}`,
                      }}>
                        {exec.response}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </Modal>

        {/* Quick Create Invoice Dialog (triggered by Autopilot) */}
        <Modal
          title={
            <Space>
              <FileTextOutlined style={{ color: REDWOOD.primary }} />
              <span>Quick Create Invoice</span>
            </Space>
          }
          open={quickCreateVisible}
          onCancel={() => { setQuickCreateVisible(false); quickCreateForm.resetFields(); }}
          onOk={handleQuickCreateSubmit}
          okText="Create Invoice"
          width={520}
          destroyOnClose
        >
          <Form form={quickCreateForm} layout="vertical" size="small" style={{ marginTop: 16 }}>
            <Form.Item label="Supplier" required style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="supplier" noStyle rules={[{ required: true, message: 'Select a supplier' }]}>
                  <Input placeholder="Click search to select supplier" readOnly style={{ flex: 1 }} />
                </Form.Item>
                <Button
                  icon={<SearchOutlined />}
                  onClick={() => {
                    setQcSupplierModalVisible(true);
                    setQcSupplierSearchText('');
                    if (suppliers.length === 0) fetchSuppliers();
                  }}
                />
                <Tooltip title="Check Supplier Balance">
                  <Button
                    icon={<WalletOutlined />}
                    onClick={handleCheckBalance}
                    style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
                  />
                </Tooltip>
              </Space.Compact>
            </Form.Item>
            <Form.Item name="supplierNumber" hidden><Input /></Form.Item>
            <Form.Item name="businessUnit" label="Business Unit" rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 12 }}>
              <Select placeholder="Select Business Unit" allowClear showSearch optionFilterProp="children">
                {businessUnits.map(bu => (
                  <Option key={bu.name} value={bu.name}>{bu.name}</Option>
                ))}
              </Select>
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="invoiceNumber" label="Invoice Number" rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 12 }}>
                  <Input placeholder="Enter invoice number" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="invoiceAmount" label="Invoice Amount" rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 12 }}>
                  <InputNumber placeholder="0.00" style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="invoiceDate" label="Invoice Date" rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 12 }}>
                  <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="description" label="Description" style={{ marginBottom: 12 }}>
                  <Input placeholder="Invoice description" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="taxCode" label="Tax Code" rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 12 }}>
                  <Select placeholder="Select tax code">
                    <Option value="VAT 5%">VAT 5%</Option>
                    <Option value="Zero Rated">Zero Rated</Option>
                    <Option value="Exempt">Exempt</Option>
                    <Option value="Reverse Charge">Reverse Charge</Option>
                    <Option value="Out of Scope">Out of Scope</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="includingTax" label=" " valuePropName="checked" style={{ marginBottom: 12 }}>
                  <Checkbox>Amount Including Tax</Checkbox>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>

        {/* Quick Create Supplier Search Modal */}
        <Modal
          title="Select Supplier"
          open={qcSupplierModalVisible}
          onCancel={() => setQcSupplierModalVisible(false)}
          footer={null}
          width={700}
          destroyOnClose
        >
          <Input
            placeholder="Search by name, number, or alternative name..."
            prefix={<SearchOutlined />}
            value={qcSupplierSearchText}
            onChange={(e) => setQcSupplierSearchText(e.target.value)}
            allowClear
            style={{ marginBottom: 12 }}
          />
          <Table
            dataSource={qcFilteredSuppliers}
            columns={[
              { title: 'Number', dataIndex: 'supplierNumber', key: 'supplierNumber', width: 120 },
              { title: 'Supplier Name', dataIndex: 'supplier', key: 'supplier', width: 250, ellipsis: true },
              { title: 'Status', dataIndex: 'status', key: 'status', width: 90, render: (s: string) => <Tag color={s === 'ACTIVE' ? 'green' : 'red'}>{s}</Tag> },
              {
                title: 'Action', key: 'action', width: 80,
                render: (_: any, record: SupplierRecord) => (
                  <Button type="link" size="small" onClick={() => handleQcSupplierSelect(record)} style={{ color: REDWOOD.info }}>Select</Button>
                ),
              },
            ]}
            rowKey="key"
            size="small"
            loading={supplierLoading}
            pagination={{ pageSize: 10, size: 'small' }}
            scroll={{ y: 350 }}
          />
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
                      <Table
                        dataSource={balanceInvoices}
                        columns={[
                          { title: 'Invoice Number', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 130 },
                          { title: 'Invoice Date', dataIndex: 'invoiceDate', key: 'invoiceDate', width: 100, render: (d: string) => formatDate(d) },
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
                        scroll={{ y: 300 }}
                      />
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
                          { title: 'Payment Date', dataIndex: 'paymentDate', key: 'paymentDate', width: 100, render: (d: string) => formatDate(d) },
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
                ]}
              />
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: REDWOOD.neutral600 }}>
              No balance data available for this supplier.
            </div>
          )}
        </Modal>
      {/* ── Attachments Modal ─────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <PaperClipOutlined style={{ color: REDWOOD.info }} />
            <span>Attachments — Invoice {attachInvoiceNum}</span>
            {attachments.length > 0 && <Badge count={attachments.length} style={{ backgroundColor: REDWOOD.info }} />}
          </Space>
        }
        open={attachModalVisible}
        onCancel={() => setAttachModalVisible(false)}
        footer={<Button onClick={() => setAttachModalVisible(false)}>Close</Button>}
        width={640}
      >
        <Spin spinning={attachLoading}>
          {!attachLoading && attachments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
              <PaperClipOutlined style={{ fontSize: 32, marginBottom: 8 }} />
              <div>No attachments found for this invoice</div>
            </div>
          ) : (
            <List
              dataSource={attachments}
              renderItem={(att: any) => (
                <List.Item
                  style={{ padding: '12px 0' }}
                  actions={[
                    <Tooltip title="Download" key="dl">
                      <Button
                        type="primary"
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => downloadAttachment(att)}
                        style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                      >
                        Download
                      </Button>
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={getFileIcon(att.UploadedFileContentType, att.FileName)}
                    title={
                      <Text strong style={{ fontSize: 13 }}>
                        {att.FileName || att.Title || 'Unnamed file'}
                      </Text>
                    }
                    description={
                      <Space size={12}>
                        {att.UploadedFileLength > 0 && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatFileSize(att.UploadedFileLength)}
                          </Text>
                        )}
                        {att.Category && (
                          <Tag color="blue" style={{ fontSize: 11 }}>{att.Category}</Tag>
                        )}
                        {att.CreationDate && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {att.CreationDate.slice(0, 10)}
                          </Text>
                        )}
                        {att.CreatedByUserName && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {att.CreatedByUserName}
                          </Text>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Modal>

      {/* ── Fusion Attachment Explorer Modal ──────────────────────────── */}
      <Modal
        title={
          <Space>
            <CloudOutlined style={{ color: '#722ed1' }} />
            <span>Fusion Attachments — Invoice {fusionAttachInvoice}</span>
          </Space>
        }
        open={fusionAttachVisible}
        onCancel={() => setFusionAttachVisible(false)}
        footer={<Button onClick={() => setFusionAttachVisible(false)}>Close</Button>}
        width={760}
      >
        {/* Call log */}
        <div style={{
          background: '#1e1e1e', color: '#d4d4d4',
          padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
          maxHeight: 120, overflowY: 'auto',
        }}>
          {fusionAttachLog.length === 0
            ? <span style={{ color: '#888' }}>Initializing...</span>
            : fusionAttachLog.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('[Error]') ? '#f48771' : line.startsWith('[Done]') ? '#4ec9b0' : '#9cdcfe' }}>
                  {line}
                </div>
              ))
          }
          {fusionAttachLoading && <span style={{ color: '#888' }}>▌</span>}
        </div>

        {fusionAttachStep === 'error' && (
          <Alert type="error" message={fusionAttachError} style={{ marginBottom: 12 }} showIcon />
        )}

        <Spin spinning={fusionAttachLoading}>
          {fusionAttachStep === 'done' && fusionAttachItems.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>
              <CloudOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
              No attachments found in Fusion for this invoice
            </div>
          )}

          {fusionAttachItems.map((att: any, idx: number) => {
            const fileName   = att.FileName || att.Title || `Attachment ${idx + 1}`;
            const fileSize   = att.FileSize || att.UploadedFileLength || 0;
            const contentType = att.ContentType || att.UploadedFileContentType || '';
            const links: any[] = att.links || [];

            return (
              <Card
                key={idx}
                size="small"
                style={{ marginBottom: 8, borderLeft: '3px solid #722ed1' }}
              >
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {/* File info row */}
                  <Space wrap>
                    {getFileIcon(contentType, fileName)}
                    <Text strong style={{ fontSize: 13 }}>{fileName}</Text>
                    {fileSize > 0 && (
                      <Text type="secondary" style={{ fontSize: 11 }}>{formatFileSize(fileSize)}</Text>
                    )}
                    {att.Category && <Tag color="purple" style={{ fontSize: 11 }}>{att.Category}</Tag>}
                    {att.DatatypeCode && <Tag style={{ fontSize: 11 }}>{att.DatatypeCode}</Tag>}
                    {att.CreationDate && (
                      <Text type="secondary" style={{ fontSize: 11 }}>{String(att.CreationDate).slice(0, 10)}</Text>
                    )}
                  </Space>

                  {/* Download buttons — all use authenticated fetch, not window.open */}
                  <Space wrap size={4}>
                    {/* FileUrl button */}
                    {att.FileUrl && (
                      <Tooltip title={`${FUSION_HOST}${att.FileUrl}`}>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          loading={fusionDownloading === `${FUSION_HOST}${att.FileUrl}`}
                          style={{ background: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
                          onClick={() => downloadFusionFile(`${FUSION_HOST}${att.FileUrl}`, fileName)}
                        >
                          FileUrl
                        </Button>
                      </Tooltip>
                    )}

                    {/* One button per link */}
                    {links.map((link: any, li: number) => {
                      const label = link.name
                        ? (link.rel !== link.name ? `${link.rel}/${link.name}` : link.name)
                        : link.rel;
                      const isEnclosure = link.rel === 'enclosure';
                      return (
                        <Tooltip key={li} title={link.href}>
                          <Button
                            size="small"
                            icon={isEnclosure ? <DownloadOutlined /> : <LinkOutlined />}
                            type={isEnclosure ? 'primary' : 'default'}
                            loading={fusionDownloading === link.href}
                            style={isEnclosure ? { background: REDWOOD.info, borderColor: REDWOOD.info } : {}}
                            onClick={() => downloadFusionFile(link.href, fileName)}
                          >
                            {label}
                          </Button>
                        </Tooltip>
                      );
                    })}
                  </Space>

                  {/* Expandable raw data */}
                  <Collapse
                    ghost
                    size="small"
                    items={[{
                      key: 'raw',
                      label: <Text type="secondary" style={{ fontSize: 11 }}>Raw data ({links.length} links)</Text>,
                      children: (
                        <pre style={{
                          fontSize: 10, background: '#f5f5f5', padding: 8,
                          borderRadius: 4, overflow: 'auto', maxHeight: 200,
                          margin: 0,
                        }}>
                          {JSON.stringify({ ...att, links }, null, 2)}
                        </pre>
                      ),
                    }]}
                  />
                </Space>
              </Card>
            );
          })}
        </Spin>
      </Modal>

      {/* ── Applied Prepayments — Fusion Fetch Modal ──────────────────── */}
      {prepayFetchInvoice && (
        <Modal
          title={
            <Space>
              <SyncOutlined style={{ color: '#722ed1' }} />
              <span>Applied Prepayments from Fusion — {prepayFetchInvoice.invoiceNumber}</span>
            </Space>
          }
          open={prepayFetchVisible}
          onCancel={() => setPrepayFetchVisible(false)}
          width={1100}
          footer={
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                {prepayFetchStep === 'idle' && (
                  <Button
                    type="primary"
                    icon={<SyncOutlined />}
                    style={{ background: '#722ed1', borderColor: '#722ed1' }}
                    loading={prepayFetchLoading}
                    onClick={() => runPrepayFetch(prepayFetchInvoice)}
                  >
                    Fetch from Fusion
                  </Button>
                )}
                {['ready', 'done'].includes(prepayFetchStep) && prepayMappedItems.length > 0 && (
                  <Button
                    type="primary"
                    icon={<DatabaseOutlined />}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                    loading={prepayApexLoading}
                    disabled={prepayFetchStep === 'done'}
                    onClick={runPrepayApexPost}
                  >
                    POST to APEX ({prepayMappedItems.length} record{prepayMappedItems.length !== 1 ? 's' : ''})
                  </Button>
                )}
                {prepayFetchStep === 'error' && (
                  <Button icon={<SyncOutlined />} onClick={() => runPrepayFetch(prepayFetchInvoice)}>
                    Retry
                  </Button>
                )}
              </Space>
              <Button onClick={() => setPrepayFetchVisible(false)}>Close</Button>
            </Space>
          }
          destroyOnClose
        >
          {/* Log terminal */}
          <div style={{
            background: '#0d1117', borderRadius: 6, padding: '8px 12px',
            fontFamily: 'monospace', fontSize: 11, marginBottom: 12,
            minHeight: 48, maxHeight: 120, overflowY: 'auto',
          }}>
            {prepayFetchLog.length === 0
              ? <span style={{ color: '#555' }}>Click "Fetch from Fusion" to start…</span>
              : prepayFetchLog.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('✓') ? '#52c41a' : line.startsWith('GET') ? '#79c0ff' : '#d4d4d4' }}>
                  {line}
                </div>
              ))}
            {prepayFetchLoading && <span style={{ color: '#888' }}>▌</span>}
          </div>

          {prepayFetchError && (
            <Alert type="error" message={prepayFetchError} showIcon style={{ marginBottom: 12 }} />
          )}

          {/* Result banner */}
          {prepayFetchStep === 'done' && prepayApexResult && (
            <Alert
              type={prepayApexResult.ok ? 'success' : 'error'}
              showIcon
              message={prepayApexResult.ok
                ? `APEX POST successful — ${prepayApexResult.data?.inserted ?? prepayMappedItems.length} record(s) saved`
                : `APEX POST failed: ${prepayApexResult.data?.message || prepayApexResult.status}`}
              style={{ marginBottom: 12 }}
            />
          )}

          <Spin spinning={prepayFetchLoading}>
            {(prepayFusionItems.length > 0 || prepayMappedItems.length > 0) && (
              <>
                {/* Mapped rows table */}
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
                  Mapped Items ({prepayMappedItems.length})
                </div>
                <Table
                  size="small"
                  dataSource={prepayMappedItems.map((r, i) => ({ ...r, key: i }))}
                  pagination={false}
                  scroll={{ x: 900 }}
                  style={{ marginBottom: 12 }}
                  columns={[
                    { title: 'App ID', dataIndex: 'PrepaymentApplicationId', width: 100 },
                    { title: 'Prepayment Number', dataIndex: 'PrepaymentNumber', width: 160 },
                    { title: 'Prepay Invoice ID', dataIndex: 'PrepaymentInvoiceId', width: 120,
                      render: (v: any) => v
                        ? <Tag color="green">{v}</Tag>
                        : <Tag color="red">Not found in APEX</Tag> },
                    { title: 'Line #', dataIndex: 'LineNumber', width: 70 },
                    { title: 'Prepay Line #', dataIndex: 'PrepaymentLineNumber', width: 90 },
                    { title: 'Currency', dataIndex: 'Currency', width: 80 },
                    { title: 'Applied Amount', dataIndex: 'AppliedAmount', width: 120, align: 'right' as const,
                      render: (v: number) => v?.toLocaleString(undefined, { minimumFractionDigits: 2 }) },
                    { title: 'Incl. Tax', dataIndex: 'IncludedTax', width: 90, align: 'right' as const },
                    { title: 'On Invoice', dataIndex: 'IncludedonInvoiceFlag', width: 80 },
                    { title: 'Acctg Date', dataIndex: 'ApplicationAccountingDate', width: 110 },
                    { title: 'Description', dataIndex: 'Description', ellipsis: true },
                  ]}
                />

                {/* Side-by-side JSON panels */}
                <Row gutter={12}>
                  <Col span={12}>
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
                      Fusion Response JSON
                      <Tag color="geekblue" style={{ marginLeft: 6, fontSize: 10 }}>GET</Tag>
                      <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                        /invoices/{prepayFetchInvoice.invoiceId}/child/appliedPrepayments
                      </Text>
                    </div>
                    <div style={{
                      background: '#0d1117', borderRadius: 6, padding: '8px 10px',
                      maxHeight: 320, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10,
                      color: '#79c0ff', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {prepayFusionJson || '—'}
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
                      APEX POST Body
                      <Tag color="green" style={{ marginLeft: 6, fontSize: 10 }}>POST</Tag>
                      <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                        /ap/applied-prepayments
                      </Text>
                    </div>
                    <div style={{
                      background: '#0d1117', borderRadius: 6, padding: '8px 10px',
                      maxHeight: 320, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10,
                      color: '#4ec9b0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {prepayMappedBody || '—'}
                    </div>
                  </Col>
                </Row>

                {/* APEX result if posted */}
                {prepayApexResult && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>APEX Response</div>
                    <div style={{
                      background: '#0d1117', borderRadius: 6, padding: '8px 10px',
                      maxHeight: 180, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10,
                      color: prepayApexResult.ok ? '#4ec9b0' : '#f48771',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {`HTTP ${prepayApexResult.status}\n\n${JSON.stringify(prepayApexResult.data, null, 2)}`}
                    </div>
                  </div>
                )}
              </>
            )}
          </Spin>
        </Modal>
      )}

      {/* ── Applied Prepayments — Multi-Invoice Fetch Modal ───────────── */}
      <Modal
        title={
          <Space>
            <SyncOutlined style={{ color: '#722ed1' }} />
            <span>Fetch Applied Prepayments — {multiFetchRows.length} invoice{multiFetchRows.length !== 1 ? 's' : ''} selected</span>
          </Space>
        }
        open={multiFetchVisible}
        onCancel={() => { if (!multiFetchRunning) setMultiFetchVisible(false); }}
        width={820}
        footer={[
          <Button key="close" onClick={() => setMultiFetchVisible(false)} disabled={multiFetchRunning}>
            Close
          </Button>,
          <Button
            key="run"
            type="primary"
            icon={<SyncOutlined spin={multiFetchRunning} />}
            loading={multiFetchRunning}
            disabled={multiFetchRunning || multiFetchRows.every(r => r.apexStatus === 'ok' || (r.fusionStatus === 'none'))}
            style={{ background: '#722ed1', borderColor: '#722ed1' }}
            onClick={runMultiFetch}
          >
            {multiFetchRunning ? 'Processing…' : 'Fetch & Post All'}
          </Button>,
        ]}
      >
        <Table
          dataSource={multiFetchRows}
          rowKey="key"
          size="small"
          pagination={false}
          columns={[
            {
              title: 'Invoice #',
              dataIndex: 'invoiceNumber',
              width: 160,
              render: (v: string) => <Text style={{ fontSize: 12, color: REDWOOD.info }}>{v}</Text>,
            },
            {
              title: 'Business Unit',
              dataIndex: 'businessUnit',
              ellipsis: true,
              render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
            },
            {
              title: 'Fusion Fetch',
              width: 160,
              align: 'center' as const,
              render: (_: any, r: MultiFetchRow) => {
                if (r.fusionStatus === 'idle')     return <Tag style={{ fontSize: 11 }}>Pending</Tag>;
                if (r.fusionStatus === 'fetching') return <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Fetching…</Tag>;
                if (r.fusionStatus === 'none')     return <Tag color="default" style={{ fontSize: 11 }}>No prepayments</Tag>;
                if (r.fusionStatus === 'error')    return <Tooltip title={r.fusionError}><Tag color="error" style={{ fontSize: 11 }}>Error</Tag></Tooltip>;
                return <Tag color="success" style={{ fontSize: 11 }}>✓ {r.fusionCount} record{r.fusionCount !== 1 ? 's' : ''}</Tag>;
              },
            },
            {
              title: 'APEX POST',
              width: 160,
              align: 'center' as const,
              render: (_: any, r: MultiFetchRow) => {
                if (r.apexStatus === 'idle')    return <Tag style={{ fontSize: 11 }}>—</Tag>;
                if (r.apexStatus === 'posting') return <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Posting…</Tag>;
                if (r.apexStatus === 'error')   return <Tooltip title={r.apexError}><Tag color="error" style={{ fontSize: 11 }}>Error</Tag></Tooltip>;
                return <Tag color="success" style={{ fontSize: 11 }}>✓ {r.apexInserted} saved</Tag>;
              },
            },
          ]}
        />
        {!multiFetchRunning && multiFetchRows.some(r => r.fusionStatus !== 'idle') && (
          <div style={{ marginTop: 12, fontSize: 12, color: REDWOOD.neutral600 }}>
            {multiFetchRows.filter(r => r.apexStatus === 'ok').length} of {multiFetchRows.filter(r => r.fusionStatus === 'ok').length} invoices posted successfully
          </div>
        )}
      </Modal>

      {/* ── Send for Approval Modal (AP Invoice) ──────────────────────── */}
      <Modal
        title={
          <Space>
            <AuditOutlined style={{ color: REDWOOD.info }} />
            <span>Send for Approval — {invApprovalTarget?.invoiceNumber}</span>
          </Space>
        }
        open={invApprovalOpen}
        onCancel={() => { if (!invApprovalSending) setInvApprovalOpen(false); }}
        width={580}
        destroyOnClose
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              icon={<BugOutlined />}
              size="small"
              style={invDebugSteps.length > 0 ? { color: '#fa8c16', borderColor: '#fa8c16' } : {}}
              disabled={invDebugSteps.length === 0}
              onClick={() => setInvDebugOpen(v => !v)}
            >
              Debug {invDebugSteps.length > 0 ? `(${invDebugSteps.length})` : ''}
            </Button>
            <Space>
              <Button onClick={() => setInvApprovalOpen(false)} disabled={invApprovalSending}>Cancel</Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={invApprovalSending}
                disabled={!invSelectedApprover || invApprovalLoading}
                onClick={handleInvSendApproval}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              >
                Send for Approval
              </Button>
            </Space>
          </div>
        }
      >
        <Spin spinning={invApprovalLoading}>
          {invApprovalTarget && (
            <div style={{ marginBottom: 16, padding: '12px 16px', background: REDWOOD.neutral100, borderRadius: 8 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Invoice</Text>
                  <div><Text strong>{invApprovalTarget.invoiceNumber}</Text></div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Supplier</Text>
                  <div><Text>{invApprovalTarget.supplierOrParty}</Text></div>
                </Col>
                <Col span={12} style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Amount</Text>
                  <div>
                    <Text strong style={{ color: REDWOOD.info }}>
                      {formatAmount(invApprovalTarget.invoiceAmount)} {invApprovalTarget.invoiceCurrency}
                    </Text>
                  </div>
                </Col>
                <Col span={12} style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Type</Text>
                  <div><Text>{invApprovalTarget.invoiceType}</Text></div>
                </Col>
              </Row>
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <Text strong>Select Approver</Text>
            {invApprovalUsers.length === 0 && !invApprovalLoading && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message="No approvers configured"
                description='No active INVOICE approval rules found for module AP. Go to Administration → Approval Management to set up rules.'
              />
            )}
          </div>
          <Select
            style={{ width: '100%' }}
            placeholder="Select an approver..."
            value={invSelectedApprover}
            onChange={setInvSelectedApprover}
            loading={invApprovalLoading}
            optionFilterProp="label"
            showSearch
          >
            {invApprovalUsers.map(u => {
              const nameLabel = u.fullName && u.fullName !== u.email ? u.fullName : '';
              const label = nameLabel
                ? `${nameLabel} — ${u.email}${u.department ? ` (${u.department})` : ''}`
                : `${u.email}${u.department ? ` (${u.department})` : ''}`;
              return (
                <Option key={u.email} value={u.email} label={label}>
                  <div style={{ lineHeight: 1.4 }}>
                    {nameLabel && <div style={{ fontWeight: 500, fontSize: 13 }}>{nameLabel}</div>}
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{u.email}</div>
                    {u.department && (
                      <div style={{ fontSize: 11, color: REDWOOD.neutral300 }}>{u.department}</div>
                    )}
                  </div>
                </Option>
              );
            })}
          </Select>

          {/* Debug panel */}
          {invDebugOpen && invDebugSteps.length > 0 && (
            <div style={{
              marginTop: 16,
              background: '#0d1117',
              borderRadius: 8,
              padding: '10px 14px',
              fontFamily: 'monospace',
              fontSize: 11,
            }}>
              {invDebugSteps.map((step, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Tag
                      color={
                        typeof step.status === 'number'
                          ? step.status >= 200 && step.status < 300 ? 'success' : 'error'
                          : 'warning'
                      }
                      style={{ fontSize: 10, margin: 0 }}
                    >
                      {step.status}
                    </Tag>
                    <span style={{ color: '#e6edf3', fontWeight: 600 }}>{step.step}</span>
                  </div>
                  <div style={{ color: '#ffa657', marginBottom: 2 }}>
                    {step.method} {step.url}
                  </div>
                  {!!step.payload && (
                    <div style={{ color: '#7ee787', marginBottom: 2 }}>
                      Payload: {JSON.stringify(step.payload)}
                    </div>
                  )}
                  <div style={{ color: '#f85149' }}>
                    Response: {JSON.stringify(step.response)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Spin>
      </Modal>

      {/* ── View Approval Status Modal (AP Invoice) ────────────────────── */}
      <Modal
        title={
          <Space>
            <CheckCircleOutlined style={{
              color: invStatusTarget?.approvalStatus === 'PENDING'
                ? REDWOOD.warning
                : invStatusTarget?.approvalStatus === 'Rejected'
                ? REDWOOD.error
                : REDWOOD.success,
            }} />
            <span>Approval History — {invStatusTarget?.invoiceNumber}</span>
          </Space>
        }
        open={invStatusOpen}
        onCancel={() => setInvStatusOpen(false)}
        footer={<Button onClick={() => setInvStatusOpen(false)}>Close</Button>}
        width={500}
        destroyOnClose
      >
        {invStatusTarget && (
          <div style={{ padding: '8px 0' }}>
            <Row gutter={[16, 14]}>
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 11 }}>Current Status</Text>
                <div style={{ marginTop: 4 }}>{getApprovalStatusTag(invStatusTarget.approvalStatus)}</div>
              </Col>
              {invStatusTarget.approvalSentBy && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Submitted By</Text>
                  <div><Text strong>{invStatusTarget.approvalSentBy}</Text></div>
                </Col>
              )}
              {invStatusTarget.approvalSentDate && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Submitted On</Text>
                  <div><Text>{formatDate(invStatusTarget.approvalSentDate)}</Text></div>
                </Col>
              )}
              {invStatusTarget.approvalApproverName && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Approver</Text>
                  <div><Text strong>{invStatusTarget.approvalApproverName}</Text></div>
                </Col>
              )}
              {invStatusTarget.approvalApproverEmail && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Approver Email</Text>
                  <div><Text>{invStatusTarget.approvalApproverEmail}</Text></div>
                </Col>
              )}
              {invStatusTarget.approvedDate && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Decision Date</Text>
                  <div>
                    <Text style={{ color: invStatusTarget.approvalStatus === 'Rejected' ? REDWOOD.error : REDWOOD.success }}>
                      {formatDate(invStatusTarget.approvedDate)}
                    </Text>
                  </div>
                </Col>
              )}
              {invStatusTarget.approvalRef && (
                <Col span={24}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Approval Reference</Text>
                  <div style={{ marginTop: 2 }}>
                    <code style={{ fontSize: 12, background: REDWOOD.neutral100, padding: '2px 8px', borderRadius: 4 }}>
                      {invStatusTarget.approvalRef}
                    </code>
                  </div>
                </Col>
              )}
            </Row>
          </div>
        )}
      </Modal>

      {/* ── MPA Schedule Detail Modal ── */}
      <Modal
        open={mpaModalOpen}
        onCancel={() => setMpaModalOpen(false)}
        footer={<Button onClick={() => setMpaModalOpen(false)}>Close</Button>}
        width={960}
        title={
          <Space>
            <CalendarOutlined style={{ color: '#722ed1' }} />
            <span>Multiperiod Schedule — {mpaModalRecord?.invoiceNumber}</span>
            {mpaModalData && (
              <Tag color="purple">{mpaModalData.lines.length} period{mpaModalData.lines.length !== 1 ? 's' : ''}</Tag>
            )}
          </Space>
        }
        styles={{ body: { padding: '16px 20px', maxHeight: '72vh', overflowY: 'auto' } }}
      >
        {mpaModalLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
        ) : mpaModalData ? (
          <>
            {/* Header summary */}
            <Descriptions size="small" column={4} style={{ marginBottom: 16 }}
              styles={{ label: { fontWeight: 500, color: '#6B6B6B' } }}
            >
              <Descriptions.Item label="Supplier">{mpaModalData.supplier}</Descriptions.Item>
              <Descriptions.Item label="Business Unit">{mpaModalData.businessUnit}</Descriptions.Item>
              <Descriptions.Item label="Invoice Date">{mpaModalData.invoiceDate}</Descriptions.Item>
              <Descriptions.Item label="Currency">{mpaModalData.currencyCode}</Descriptions.Item>
            </Descriptions>

            {/* Schedule lines table */}
            <Table
              dataSource={mpaModalData.lines.map((l, i) => ({ ...l, key: i }))}
              pagination={false}
              size="small"
              bordered
              scroll={{ x: 900 }}
              summary={(rows) => {
                const totalOrig   = rows.reduce((s, r) => s + (r.originalAmount || 0), 0);
                const totalPeriod = rows.reduce((s, r) => s + (r.periodAmount   || 0), 0);
                return (
                  <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 700 }}>
                    <Table.Summary.Cell index={0} colSpan={3}><strong>Total</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <span style={{ color: '#389e0d' }}>{new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(totalOrig)}</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <span style={{ color: '#389e0d' }}>{new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(totalPeriod)}</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} colSpan={5} />
                  </Table.Summary.Row>
                );
              }}
              columns={[
                { title: 'Line', dataIndex: 'lineNumber', key: 'lineNumber', width: 55, align: 'center' as const },
                { title: 'Period', dataIndex: 'periodName', key: 'periodName', width: 100 },
                { title: 'Period Date', dataIndex: 'periodDate', key: 'periodDate', width: 110 },
                {
                  title: 'Original Amt', dataIndex: 'originalAmount', key: 'originalAmount', width: 120, align: 'right' as const,
                  render: (v: number) => <span style={{ color: '#389e0d', fontWeight: 600 }}>{new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(v)}</span>,
                },
                {
                  title: 'Period Amt', dataIndex: 'periodAmount', key: 'periodAmount', width: 120, align: 'right' as const,
                  render: (v: number) => <span style={{ color: '#389e0d', fontWeight: 600 }}>{new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(v)}</span>,
                },
                { title: 'Accrual Account', dataIndex: 'accrualAccount', key: 'accrualAccount', width: 200, ellipsis: true, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</span> },
                { title: 'Charge Account', dataIndex: 'chargeAccount', key: 'chargeAccount', width: 200, ellipsis: true, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</span> },
                {
                  title: 'Status', dataIndex: 'postingStatus', key: 'postingStatus', width: 100,
                  render: (v: string) => <Tag color={v === 'Posted' ? 'success' : 'warning'}>{v || 'Pending'}</Tag>,
                },
                {
                  title: 'Posted Date', dataIndex: 'postedDate', key: 'postedDate', width: 110,
                  render: (v: string | null) => v || '—',
                },
              ]}
            />
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>No schedule data found.</div>
        )}
      </Modal>

      {/* Accounting for All Invoices Modal */}
      <Modal
        title={
          <Space>
            <AccountBookOutlined style={{ color: REDWOOD.success }} />
            <span>Accounting for All Invoices</span>
            <Tooltip title="View API Endpoint">
              <Button
                type="text"
                size="small"
                icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => setAccountingApiDebugOpen(true)}
                style={{ padding: '0 4px', marginLeft: 'auto' }}
              />
            </Tooltip>
          </Space>
        }
        open={accountingAllModalOpen}
        onCancel={() => { setAccountingAllModalOpen(false); setAccountingAllSelectedKeys([]); }}
        footer={
          <Space>
            <Tooltip title={
              accountingAllSelectedKeys.length === 0
                ? 'Select invoices in the table above to run batch accounting'
                : `Run Re-Create Accounting for ${accountingAllSelectedKeys.length} selected invoice(s)`
            }>
              <Button
                icon={<ApiOutlined />}
                type="primary"
                style={{ color: 'white', background: REDWOOD.success, borderColor: REDWOOD.success }}
                disabled={accountingAllSelectedKeys.length === 0 || batchProcessing}
                loading={batchProcessing}
                onClick={showBatchProgressModal}
              >
                Batch Run Re-Create A/C ({accountingAllSelectedKeys.length})
              </Button>
            </Tooltip>
            {accountingAllSelectedKeys.length > 0 && (
              <Button onClick={() => setAccountingAllSelectedKeys([])}>
                Clear Selection ({accountingAllSelectedKeys.length})
              </Button>
            )}
            <Button onClick={() => { setAccountingAllModalOpen(false); setAccountingAllSelectedKeys([]); }}>Close</Button>
          </Space>
        }
        width="90vw"
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        {accountingAllLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
            <div style={{ marginTop: 12, color: REDWOOD.neutral600 }}>Loading accounting data for all invoices...</div>
          </div>
        ) : accountingAllData.length === 0 ? (
          <Alert type="info" message="No accounting data found for displayed invoices" showIcon />
        ) : (() => {
          const stats = {
            total: accountingAllData.length,
            good: accountingAllData.filter(inv => {
              const hasIssue = inv.debitAccount && inv.creditAccount && inv.debitAccount === inv.creditAccount;
              return !hasIssue;
            }).length,
            issues: accountingAllData.filter(inv =>
              inv.debitAccount && inv.creditAccount && inv.debitAccount === inv.creditAccount
            ).length,
          };

          return (
            <>
              {/* KPI Summary */}
              <Card style={{ marginBottom: 16, background: '#fafafa' }}>
                <Row gutter={24}>
                  <Col span={12}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 600, color: REDWOOD.success }}>
                        {stats.good}
                      </div>
                      <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 4 }}>
                        ✓ Good
                      </div>
                      <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                        No Accounting Issues
                      </div>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 600, color: REDWOOD.error }}>
                        {stats.issues}
                      </div>
                      <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 4 }}>
                        ✕ Issues
                      </div>
                      <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                        Same Debit/Credit Account
                      </div>
                    </div>
                  </Col>
                </Row>
              </Card>

              {/* Data Table */}
              <Table
                rowSelection={{
                  selectedRowKeys: accountingAllSelectedKeys,
                  onChange: (keys: React.Key[]) => setAccountingAllSelectedKeys(keys),
                }}
            columns={[
              {
                title: 'GL Status',
                key: 'status',
                width: 80,
                align: 'center',
                render: (_: any, record: any) => {
                  const hasIssue = record.debitAccount && record.creditAccount && record.debitAccount === record.creditAccount;
                  const isPosted = record.glStatus === 'POSTED' || record.glStatus === 'SUBMITTED';
                  const statusText = record.glStatus || 'N/A';

                  let icon = <CloseCircleOutlined style={{ fontSize: 14, color: REDWOOD.warning }} />;
                  let title = 'Not Posted to GL';

                  if (hasIssue) {
                    icon = <ExclamationCircleOutlined style={{ fontSize: 14, color: REDWOOD.error }} />;
                    title = 'ERROR: Debit and Credit to same account';
                  } else if (isPosted) {
                    icon = <CheckCircleOutlined style={{ fontSize: 14, color: REDWOOD.success }} />;
                    title = `GL ${statusText}`;
                  }

                  return (
                    <Tooltip title={title}>
                      <Space size={4}>
                        {icon}
                        <span style={{ fontSize: 11 }}>{statusText}</span>
                      </Space>
                    </Tooltip>
                  );
                },
              },
              {
                title: 'Invoice Number',
                dataIndex: 'invoiceNumber',
                key: 'invoiceNumber',
                width: 130,
                render: (text: string, record: any) => (
                  <a onClick={() => {
                    const inv = invoices.find(i => i.invoiceId === record.invoiceId);
                    if (inv) openAccountingForSingle(inv);
                  }} style={{ color: REDWOOD.info }}>
                    {text}
                  </a>
                ),
              },
              {
                title: 'Invoice Date',
                dataIndex: 'invoiceDate',
                key: 'invoiceDate',
                width: 110,
                render: (value: string) => (
                  <span style={{ fontSize: 11 }}>{value || '—'}</span>
                ),
              },
              {
                title: 'Ref1 (Invoice#)',
                dataIndex: 'reference1',
                key: 'reference1',
                width: 120,
                ellipsis: true,
                render: (value: string) => (
                  <Tooltip title={value}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{value || '—'}</span>
                  </Tooltip>
                ),
              },
              {
                title: 'Ref2 (ID)',
                dataIndex: 'reference2',
                key: 'reference2',
                width: 100,
                render: (value: string) => (
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{value || '—'}</span>
                ),
              },
              {
                title: 'Ref3 (Class)',
                dataIndex: 'reference3',
                key: 'reference3',
                width: 100,
                render: (value: string) => (
                  <Tooltip title={value || 'Accounting Class'}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{value || '—'}</span>
                  </Tooltip>
                ),
              },
              {
                title: 'Ref4 (BU)',
                dataIndex: 'reference4',
                key: 'reference4',
                width: 100,
                render: (value: string) => (
                  <Tooltip title={value || 'Business Unit'}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{value || '—'}</span>
                  </Tooltip>
                ),
              },
              {
                title: 'Ref5 (Event)',
                dataIndex: 'reference5',
                key: 'reference5',
                width: 140,
                render: (value: string) => (
                  <Tooltip title={value}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: REDWOOD.info }}>{value || '—'}</span>
                  </Tooltip>
                ),
              },
              {
                title: 'Batch ID',
                dataIndex: 'glBatchId',
                key: 'glBatchId',
                width: 100,
                render: (value: number | null) => (
                  <Tooltip title={value ? `Batch ID: ${value}` : 'Not posted to GL'}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: value ? REDWOOD.success : REDWOOD.warning }}>
                      {value ? value : '—'}
                    </span>
                  </Tooltip>
                ),
              },
              {
                title: 'Debit Account',
                dataIndex: 'debitAccount',
                key: 'debitAccount',
                width: 150,
                ellipsis: true,
                render: (value: string, record: any) => {
                  const isIssue = record.debitAccount && record.creditAccount && record.debitAccount === record.creditAccount;
                  return (
                    <Tooltip title={value}>
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: isIssue ? REDWOOD.error : REDWOOD.success,
                        fontWeight: isIssue ? 600 : 'normal'
                      }}>
                        {value || '—'}
                      </span>
                    </Tooltip>
                  );
                },
              },
              {
                title: 'Total Debits',
                dataIndex: 'debits',
                key: 'debits',
                width: 120,
                align: 'right',
                render: (value: number) => <Text style={{ fontSize: 11, color: REDWOOD.success }}>{formatCurrency(value)}</Text>,
              },
              {
                title: 'Credit Account',
                dataIndex: 'creditAccount',
                key: 'creditAccount',
                width: 150,
                ellipsis: true,
                render: (value: string, record: any) => {
                  const isIssue = record.debitAccount && record.creditAccount && record.debitAccount === record.creditAccount;
                  return (
                    <Tooltip title={value}>
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: isIssue ? REDWOOD.error : REDWOOD.error,
                        fontWeight: isIssue ? 600 : 'normal'
                      }}>
                        {value || '—'}
                      </span>
                    </Tooltip>
                  );
                },
              },
              {
                title: 'Total Credits',
                dataIndex: 'credits',
                key: 'credits',
                width: 120,
                align: 'right',
                render: (value: number) => <Text style={{ fontSize: 11, color: REDWOOD.error }}>{formatCurrency(value)}</Text>,
              },
              {
                title: 'Action',
                key: 'action',
                width: 200,
                fixed: 'right',
                render: (_: any, record: any) => {
                  const hasIssue = record.debitAccount && record.creditAccount && record.debitAccount === record.creditAccount;
                  return (
                    <Space size="small">
                      <Button
                        type="link"
                        size="small"
                        onClick={() => handleRecreateAccountingPreview(record)}
                        style={{ color: REDWOOD.info, padding: '0 4px' }}
                      >
                        Review
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        disabled={!hasIssue}
                        onClick={() => {
                          if (hasIssue) {
                            // Call with autoShowDebug=true to skip preview and show debug steps
                            handleRecreateAccountingPreview(record, true);
                          }
                        }}
                        title={hasIssue ? 'Run full accounting recreation sequence with debug details' : 'Only available for invoices with accounting issues'}
                        style={{
                          color: hasIssue ? '#ff7a45' : REDWOOD.neutral300,
                          padding: '0 4px',
                          cursor: hasIssue ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Re-Create A/C
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          const inv = invoices.find(i => i.invoiceId === record.invoiceId);
                          if (inv) openAccountingForSingle(inv);
                        }}
                        style={{ color: REDWOOD.info, padding: '0 4px' }}
                      >
                        Details
                      </Button>
                    </Space>
                  );
                },
              },
            ]}
            dataSource={accountingAllData}
            rowKey="invoiceId"
            pagination={{ pageSize: 20 }}
            size="small"
            scroll={{ x: 2100 }}
            rowClassName={(record: any) => {
              const hasIssue = record.debitAccount && record.creditAccount && record.debitAccount === record.creditAccount;
              return hasIssue ? 'row-issue' : 'row-good';
            }}
            style={{
              backgroundColor: 'transparent',
            }}
            />
            </>
          );
        })()}
      </Modal>

      {/* Batch Progress Modal */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.success }} />
            <span>Batch Re-Create Accounting Progress</span>
            {batchProcessing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                <Progress type="circle" percent={Math.round((batchProgress.current / batchProgress.total) * 100)} width={40} />
                <Text>{batchProgress.current} of {batchProgress.total}</Text>
              </div>
            )}
          </Space>
        }
        open={batchProgressModalOpen}
        onCancel={() => !batchProcessing && setBatchProgressModalOpen(false)}
        footer={
          <Space>
            {!batchProcessing ? (
              <>
                <Button onClick={() => setBatchProgressModalOpen(false)}>Cancel</Button>
                <Button
                  type="primary"
                  style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                  onClick={() => {
                    setBatchConfirmed(true);
                    runBatchReCreateAccounting();
                  }}
                >
                  ✓ Confirm & Run Batch
                </Button>
              </>
            ) : (
              <Text type="secondary">Processing... Please wait</Text>
            )}
          </Space>
        }
        width="95vw"
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
        closable={!batchProcessing}
      >
        <Table
          columns={[
            {
              title: 'Invoice',
              key: 'invoiceNumber',
              width: 120,
              render: (_: any, record: any) => (
                <a style={{ color: REDWOOD.info }}>
                  {record.invoiceNumber}
                </a>
              ),
            },
            {
              title: 'ID',
              dataIndex: 'invoiceId',
              key: 'invoiceId',
              width: 80,
              render: (value: any) => <Text type="secondary" style={{ fontSize: 11 }}>{value}</Text>,
            },
            {
              title: 'Amount',
              dataIndex: 'amount',
              key: 'amount',
              width: 100,
              align: 'right',
              render: (value: number) => <Text strong>{formatCurrency(value)}</Text>,
            },
            ...Array.from({ length: 8 }, (_, idx) => ({
              title: `Step ${idx === 0 ? '0' : idx === 1 ? '0.1' : idx === 2 ? '1' : idx === 3 ? '1.1' : idx - 2}`,
              key: `step${idx}`,
              width: 70,
              align: 'center' as const,
              render: (_: any, record: any) => {
                const step = record.steps[idx];
                const stepStatus = step?.status;
                let icon = null;
                let color = REDWOOD.neutral300;

                if (stepStatus === 'success') {
                  icon = <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 14 }} />;
                  color = REDWOOD.success;
                } else if (stepStatus === 'failed') {
                  icon = <CloseCircleOutlined style={{ color: REDWOOD.error, fontSize: 14 }} />;
                  color = REDWOOD.error;
                } else if (batchProcessing && stepStatus === null) {
                  icon = <LoadingOutlined style={{ color: REDWOOD.warning, fontSize: 14 }} />;
                  color = REDWOOD.warning;
                } else {
                  return <span style={{ color: REDWOOD.neutral300, fontSize: 12 }}>—</span>;
                }

                return (
                  <Tooltip
                    title={
                      <div style={{ maxWidth: 600, maxHeight: 400, overflowY: 'auto' }}>
                        <div style={{ marginBottom: 12 }}>
                          <Text strong style={{ color: 'white', fontSize: 12 }}>
                            {step?.label}
                          </Text>
                        </div>

                        {/* URL */}
                        {step?.url && (
                          <div style={{ marginBottom: 8 }}>
                            <Text type="secondary" style={{ color: '#ccc', fontSize: 11, display: 'block', marginBottom: 2 }}>
                              📤 URL:
                            </Text>
                            <div style={{
                              background: '#1f1f1f',
                              padding: 6,
                              borderRadius: 4,
                              fontSize: 10,
                              fontFamily: 'monospace',
                              color: '#4cd964',
                              wordBreak: 'break-all',
                              maxHeight: 100,
                              overflowY: 'auto',
                            }}>
                              {step.url}
                            </div>
                          </div>
                        )}

                        {/* Request Body */}
                        {step?.request && typeof step.request === 'object' && (
                          <div style={{ marginBottom: 8 }}>
                            <Text type="secondary" style={{ color: '#ccc', fontSize: 11, display: 'block', marginBottom: 2 }}>
                              📥 Request:
                            </Text>
                            <div style={{
                              background: '#1f1f1f',
                              padding: 6,
                              borderRadius: 4,
                              fontSize: 10,
                              fontFamily: 'monospace',
                              color: '#64b5f6',
                              wordBreak: 'break-all',
                              maxHeight: 100,
                              overflowY: 'auto',
                            }}>
                              {JSON.stringify(step.request, null, 2)}
                            </div>
                          </div>
                        )}

                        {/* Response */}
                        {step?.response && (
                          <div style={{ marginBottom: 8 }}>
                            <Text type="secondary" style={{ color: '#ccc', fontSize: 11, display: 'block', marginBottom: 2 }}>
                              ✓ Response (Status: {step.responseStatus}):
                            </Text>
                            <div style={{
                              background: '#1f1f1f',
                              padding: 6,
                              borderRadius: 4,
                              fontSize: 10,
                              fontFamily: 'monospace',
                              color: step.responseStatus === 200 ? '#81c784' : '#e57373',
                              wordBreak: 'break-all',
                              maxHeight: 150,
                              overflowY: 'auto',
                            }}>
                              {JSON.stringify(step.response, null, 2)}
                            </div>
                          </div>
                        )}

                        {!step?.response && (
                          <Text type="secondary" style={{ color: '#999', fontSize: 11 }}>
                            No response data yet
                          </Text>
                        )}
                      </div>
                    }
                    color="#1f1f1f"
                    overlayStyle={{ maxWidth: 700 }}
                  >
                    <div style={{ cursor: 'pointer', display: 'inline-block' }}>
                      {icon}
                    </div>
                  </Tooltip>
                );
              },
            })),
          ]}
          dataSource={batchProgressData}
          rowKey="invoiceId"
          pagination={false}
          size="small"
          scroll={{ x: 1400 }}
          style={{ marginBottom: 16 }}
        />

        {/* Step Labels Legend */}
        <Card size="small" style={{ background: REDWOOD.neutral100 }}>
          <Row gutter={24}>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 0: Check SLA</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 0.1: Delete SLA</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 1: Check GL</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 1.1: Delete GL</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 2: Create SLA</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 3: Create GL</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 4: Post GL</Text></Col>
            <Col span={3}><Text type="secondary" style={{ fontSize: 11 }}>Step 5: Stamp IDs</Text></Col>
          </Row>
          <Row gutter={24} style={{ marginTop: 12 }}>
            <Col span={6}>
              <Space size={4}>
                <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                <Text type="secondary" style={{ fontSize: 11 }}>Success</Text>
              </Space>
            </Col>
            <Col span={6}>
              <Space size={4}>
                <CloseCircleOutlined style={{ color: REDWOOD.error }} />
                <Text type="secondary" style={{ fontSize: 11 }}>Failed</Text>
              </Space>
            </Col>
            <Col span={6}>
              <Space size={4}>
                <LoadingOutlined style={{ color: REDWOOD.warning }} />
                <Text type="secondary" style={{ fontSize: 11 }}>In Progress</Text>
              </Space>
            </Col>
            <Col span={6}>
              <Space size={4}>
                <span style={{ color: REDWOOD.neutral300 }}>—</span>
                <Text type="secondary" style={{ fontSize: 11 }}>Not Started</Text>
              </Space>
            </Col>
          </Row>
        </Card>
      </Modal>

      {/* Accounting for Single Invoice Modal */}
      <Modal
        title={
          <Space>
            <AccountBookOutlined style={{ color: REDWOOD.info }} />
            <span>Accounting Details — {accountingSingleInvoice?.invoiceNumber}</span>
            <Tooltip title="View API Endpoint">
              <Button
                type="text"
                size="small"
                icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => setAccountingApiDebugOpen(true)}
                style={{ padding: '0 4px', marginLeft: 'auto' }}
              />
            </Tooltip>
          </Space>
        }
        open={accountingSingleModalOpen}
        onCancel={() => setAccountingSingleModalOpen(false)}
        footer={<Button onClick={() => setAccountingSingleModalOpen(false)}>Close</Button>}
        width={1200}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        {accountingSingleLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
            <div style={{ marginTop: 12, color: REDWOOD.neutral600 }}>Loading accounting details...</div>
          </div>
        ) : !accountingSingleData || !accountingSingleData.lines || accountingSingleData.lines.length === 0 ? (
          <Alert type="info" message="No accounting lines found for this invoice" showIcon />
        ) : (
          <>
            {/* Summary */}
            <Card style={{ marginBottom: 16 }}>
              <Row gutter={32}>
                <Col span={6}>
                  <Statistic
                    title="Journal Status"
                    value={accountingSingleData.accountingStatus || 'N/A'}
                    valueStyle={{ color: accountingSingleData.accountingStatus === 'POSTED' ? REDWOOD.success : REDWOOD.warning, fontSize: 14 }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Header ID"
                    value={accountingSingleData.headerId || 'N/A'}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Batch ID"
                    value={accountingSingleData.batchId || 'N/A'}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Line Count"
                    value={accountingSingleData.lines?.length || 0}
                  />
                </Col>
              </Row>
            </Card>

            {/* GL Journal Lines Table */}
            <Table
              columns={[
                {
                  title: 'Line #',
                  dataIndex: 'line_num',
                  key: 'line_num',
                  width: 60,
                },
                {
                  title: 'Account',
                  dataIndex: 'account',
                  key: 'account',
                  width: 200,
                  ellipsis: true,
                  render: (value: string) => (
                    <Tooltip title={value}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 500 }}>{value || '—'}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  width: 280,
                  ellipsis: true,
                  render: (value: string) => (
                    <Tooltip title={value}>
                      <span>{value || '—'}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Debit',
                  dataIndex: 'entered_dr',
                  key: 'entered_dr',
                  width: 120,
                  align: 'right',
                  render: (value: number) => value ? <Text style={{ color: REDWOOD.success, fontWeight: 600 }}>{formatCurrency(value)}</Text> : '—',
                },
                {
                  title: 'Credit',
                  dataIndex: 'entered_cr',
                  key: 'entered_cr',
                  width: 120,
                  align: 'right',
                  render: (value: number) => value ? <Text style={{ color: REDWOOD.error, fontWeight: 600 }}>{formatCurrency(value)}</Text> : '—',
                },
              ]}
              dataSource={accountingSingleData.lines}
              rowKey={(_, i) => i}
              pagination={false}
              size="small"
              scroll={{ x: 1000 }}
              summary={() => {
                const totalDebits = (accountingSingleData.lines || []).reduce((sum: number, item: any) => sum + (Number(item.entered_dr) || 0), 0);
                const totalCredits = (accountingSingleData.lines || []).reduce((sum: number, item: any) => sum + (Number(item.entered_cr) || 0), 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
                      <Table.Summary.Cell index={0} colSpan={3}>
                        <Text strong>TOTAL</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Text strong style={{ color: REDWOOD.success, fontSize: 14 }}>{formatCurrency(totalDebits)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Text strong style={{ color: REDWOOD.error, fontSize: 14 }}>{formatCurrency(totalCredits)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </>
        )}
      </Modal>

      {/* Accounting API Debug Modal */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> GL Journal Lines API Test</Space>}
        open={accountingApiDebugOpen}
        onCancel={() => setAccountingApiDebugOpen(false)}
        footer={<Button onClick={() => setAccountingApiDebugOpen(false)}>Close</Button>}
        width={900}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 6, fontWeight: 600 }}>
              GL Journal Lines Endpoint:
            </div>
            <div style={{
              background: REDWOOD.neutral100,
              border: `1px solid ${REDWOOD.neutral200}`,
              borderRadius: 6,
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: 11,
              wordBreak: 'break-all',
              color: REDWOOD.neutral900,
            }}>
              GET {`${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=[INVOICE_ID]&reference5=AP-INVOICE-CREATION`}
            </div>
            <Button
              size="small"
              icon={<CopyOutlined />}
              style={{ marginTop: 8 }}
              onClick={() => {
                const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=[INVOICE_ID]&reference5=AP-INVOICE-CREATION`;
                navigator.clipboard.writeText(url);
                message.success('URL copied to clipboard!');
              }}
            >
              Copy URL
            </Button>
          </div>

          <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 8, fontWeight: 600 }}>
              Test with Invoice ID:
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="Enter Invoice ID (e.g., 900283)"
                value={apiTestInvoiceId}
                onChange={(e) => setApiTestInvoiceId(e.target.value)}
                onPressEnter={() => handleTestGlJournalLinesApi(apiTestInvoiceId)}
              />
              <Button
                type="primary"
                icon={<ApiOutlined />}
                onClick={() => handleTestGlJournalLinesApi(apiTestInvoiceId)}
                loading={apiTestLoading}
              >
                Test API
              </Button>
            </Space.Compact>
          </div>

          {apiTestResponse && (
            <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 6, fontWeight: 600 }}>
                Response:
              </div>
              <pre style={{
                background: REDWOOD.neutral100,
                border: `1px solid ${REDWOOD.neutral200}`,
                borderRadius: 6,
                padding: '12px',
                fontSize: 10,
                maxHeight: 400,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
              }}>
                {JSON.stringify(apiTestResponse, null, 2)}
              </pre>
            </div>
          )}

          {apiTestError && (
            <div style={{
              background: '#fff2f0',
              border: `1px solid ${REDWOOD.error}`,
              borderRadius: 6,
              padding: '10px 12px',
              fontSize: 12,
            }}>
              <div style={{ fontWeight: 600, color: REDWOOD.error, marginBottom: 6 }}>Error:</div>
              <pre style={{ margin: 0, color: REDWOOD.error, fontSize: 11 }}>
                {apiTestError}
              </pre>
            </div>
          )}

          <div style={{
            background: '#f0f7ff',
            border: `1px solid ${REDWOOD.info}`,
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 12,
          }}>
            <div style={{ fontWeight: 600, color: REDWOOD.info, marginBottom: 6 }}>ℹ️ Expected Response Structure:</div>
            <pre style={{
              background: '#e6f7ff',
              padding: '8px',
              borderRadius: 4,
              fontSize: 10,
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
{`[
  {
    "je_header_id": number,
    "je_batch_id": number,
    "reference1": "INVOICE_NUMBER",
    "reference2": "INVOICE_ID",
    "reference5": "AP-INVOICE-CREATION",
    "accountCombination": "GL account code",
    "description": "Line description",
    "enteredDr": number,
    "enteredCr": number,
    "status": "POSTED|DRAFT"
  }
]`}
            </pre>
          </div>
        </Space>
      </Modal>

      {/* Re-Create Accounting Modal - Shows What WILL Be Created */}
      <Modal
        title={`Re-Create Accounting — ${previewPayload?.header?.sourceNumber || ''}`}
        open={previewModalOpen}
        onCancel={() => {
          setPreviewModalOpen(false);
          setPreviewPayload(null);
        }}
        footer={[
          <Button key="close" onClick={() => setPreviewModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="create"
            type="primary"
            onClick={handleCreateAccounting}
            style={{ background: REDWOOD.success }}
          >
            Create Accounting & Post to GL
          </Button>,
        ]}
        width={1200}
        destroyOnClose
      >
        {previewPayload && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* API Endpoint Info */}
            <div style={{
              background: '#f6ffed',
              border: `1px solid #b7eb8f`,
              borderRadius: 6,
              padding: '10px 12px',
              fontSize: 11,
            }}>
              <div style={{ color: '#52c41a', fontWeight: 600, marginBottom: 6 }}>
                <ApiOutlined /> API Endpoint:
              </div>
              <div style={{ fontFamily: 'monospace', color: REDWOOD.neutral600, wordBreak: 'break-all', fontSize: 10 }}>
                GET {APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=[INVOICE_ID]
              </div>
            </div>

            {/* Invoice Summary - Invoice Amount | Tax | Total */}
            <Row gutter={16}>
              <Col span={8}>
                <Card size="small" style={{ background: '#fafafa' }}>
                  <Statistic
                    title="Invoice Amount"
                    value={previewPayload.lines?.filter((l: any) => l.lineType === 'DR' && l.accountingClass !== 'TAX').reduce((s: number, l: any) => s + (l.enteredDr || 0), 0)}
                    precision={2}
                    prefix="AED "
                    valueStyle={{ color: REDWOOD.primary, fontSize: 14 }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" style={{ background: '#fafafa' }}>
                  <Statistic
                    title="Tax Amount"
                    value={previewPayload.lines?.filter((l: any) => l.lineType === 'DR' && l.accountingClass === 'TAX').reduce((s: number, l: any) => s + (l.enteredDr || 0), 0)}
                    precision={2}
                    prefix="AED "
                    valueStyle={{ color: REDWOOD.warning, fontSize: 14 }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" style={{ background: '#fafafa' }}>
                  <Statistic
                    title="Total (Invoice + Tax)"
                    value={previewPayload.lines?.filter((l: any) => l.lineType === 'CR').reduce((s: number, l: any) => s + (l.enteredCr || 0), 0)}
                    precision={2}
                    prefix="AED "
                    valueStyle={{ color: REDWOOD.success, fontSize: 14 }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Preview Info */}
            <div style={{
              background: '#f0f7ff',
              border: `1px solid ${REDWOOD.info}`,
              borderRadius: 6,
              padding: '10px 12px',
              fontSize: 12,
            }}>
              <div style={{ color: REDWOOD.info, fontWeight: 600, marginBottom: 6 }}>
                Accounting entries that WILL BE created:
              </div>
              <div style={{ color: REDWOOD.neutral600, fontSize: 11 }}>
                Invoice: {previewPayload.header?.sourceNumber} | Lines: {previewPayload.lines?.length || 0}
              </div>
            </div>

            {/* Accounting Lines Table */}
            <Table
              columns={[
                {
                  title: 'Line #',
                  dataIndex: 'lineNumber',
                  key: 'lineNumber',
                  width: 70,
                  align: 'center' as const,
                },
                {
                  title: 'Type',
                  dataIndex: 'lineType',
                  key: 'lineType',
                  width: 50,
                  align: 'center' as const,
                  render: (type: string) => (
                    <Tag color={type === 'DR' ? REDWOOD.success : REDWOOD.error} style={{ fontSize: 11 }}>
                      {type}
                    </Tag>
                  ),
                },
                {
                  title: 'Account Combination',
                  key: 'accountCombo',
                  width: 350,
                  ellipsis: false,
                  render: (_: any, record: any) => {
                    const text = record.accountCombination;
                    const desc = record.accountDescription;
                    if (!text) return '—';
                    const segments = text.split('-');
                    const accountSegment = segments[3] || ''; // 4th segment (index 3)
                    const tooltipText = desc ? `${desc}\n\nFull Code: ${text}\n\nSegments: ${segments.map((seg, i) => `[${i}]${seg}`).join(', ')}` : `Full Code: ${text}\n\nSegments: ${segments.map((seg, i) => `[${i}]${seg}`).join(', ')}`;
                    return (
                      <Tooltip title={tooltipText}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {desc && <span style={{ fontSize: 11, color: REDWOOD.primary, fontWeight: 500 }}>{desc}</span>}
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: 9,
                            color: REDWOOD.info,
                            fontWeight: 600
                          }}>
                            {accountSegment}
                          </span>
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: 8,
                            color: REDWOOD.neutral600,
                            wordBreak: 'break-all'
                          }}>
                            {text}
                          </span>
                        </div>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  width: 200,
                  ellipsis: true,
                },
                {
                  title: 'Debit',
                  dataIndex: 'enteredDr',
                  key: 'enteredDr',
                  width: 120,
                  align: 'right' as const,
                  render: (value: number) => value ? <Text style={{ color: REDWOOD.success }}>{value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : '—',
                },
                {
                  title: 'Credit',
                  dataIndex: 'enteredCr',
                  key: 'enteredCr',
                  width: 120,
                  align: 'right' as const,
                  render: (value: number) => value ? <Text style={{ color: REDWOOD.error }}>{value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : '—',
                },
              ]}
              dataSource={previewPayload.lines.map((line: any, idx: number) => ({
                ...line,
                key: idx,
              }))}
              pagination={false}
              size="small"
              bordered
              summary={(rows) => {
                const totalDr = rows.reduce((sum, r: any) => sum + (r.enteredDr || 0), 0);
                const totalCr = rows.reduce((sum, r: any) => sum + (r.enteredCr || 0), 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
                      <Table.Summary.Cell index={0} colSpan={4} align="right">
                        <Text strong>Total</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <Text strong style={{ color: totalDr > 0 ? REDWOOD.primary : 'inherit' }}>
                          {totalDr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Text strong style={{ color: totalCr > 0 ? REDWOOD.success : 'inherit' }}>
                          {totalCr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />

            {/* Balance Check */}
            {previewPayload.lines && (() => {
              const totalDr = previewPayload.lines.reduce((sum: number, l: any) => sum + (l.enteredDr || 0), 0);
              const totalCr = previewPayload.lines.reduce((sum: number, l: any) => sum + (l.enteredCr || 0), 0);
              const balanced = Math.abs(totalDr - totalCr) < 0.01;
              return (
                <div style={{
                  background: balanced ? '#f6ffed' : '#fff1f0',
                  border: `1px solid ${balanced ? '#b7eb8f' : '#ffccc7'}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                }}>
                  <div style={{ color: balanced ? REDWOOD.success : REDWOOD.error, fontWeight: 600 }}>
                    {balanced ? '✓ Balanced' : '✗ Not Balanced'}
                  </div>
                  <div style={{ color: REDWOOD.neutral600, fontSize: 11, marginTop: 4 }}>
                    Total Debits: {totalDr.toLocaleString('en-US', { minimumFractionDigits: 2 })} {previewPayload.header?.currencyCode}
                    {' | '}
                    Total Credits: {totalCr.toLocaleString('en-US', { minimumFractionDigits: 2 })} {previewPayload.header?.currencyCode}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Debug Drawer - Shows API endpoints, payloads, and responses */}
      <Drawer
        title="API Debug - Create Accounting Flow"
        placement="right"
        onClose={() => setPreviewDebugOpen(false)}
        open={previewDebugOpen}
        width={900}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ maxHeight: '100vh', overflowY: 'auto' }}>
          {previewDebugSteps.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: REDWOOD.neutral600 }}>
              No debug steps available. Click "Create Accounting & Post to GL" button to generate steps.
            </div>
          ) : (
            <div style={{ padding: 0 }}>
              {/* Run All Button */}
              <div style={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                padding: 16,
                background: '#ffffff',
                borderBottom: `2px solid ${REDWOOD.primary}`,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<SendOutlined />}
                  onClick={runAllPreviewDebugSteps}
                  loading={executingStepIdx !== null}
                  style={{ flex: 1, background: REDWOOD.primary }}
                >
                  {executingStepIdx !== null ? '⏳ Running Steps...' : '▶ Run All Steps'}
                </Button>
                <Button
                  onClick={() => setPreviewDebugOpen(false)}
                >
                  Close
                </Button>
              </div>

              {/* Invoice Details Section */}
              {previewPayload && (
                <div style={{
                  padding: 16,
                  background: '#fafafa',
                  borderBottom: `1px solid ${REDWOOD.neutral200}`,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 12, color: REDWOOD.neutral800 }}>Invoice Details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 13 }}>
                    <div>
                      <div style={{ color: REDWOOD.neutral600, marginBottom: 4 }}>Invoice No</div>
                      <div style={{ fontWeight: 600, color: REDWOOD.neutral900 }}>{previewPayload.header?.sourceNumber || 'N/A'}</div>
                    </div>
                    <div>
                      <div style={{ color: REDWOOD.neutral600, marginBottom: 4 }}>Invoice ID</div>
                      <div style={{ fontWeight: 600, color: REDWOOD.neutral900 }}>{previewPayload.header?.sourceId || 'N/A'}</div>
                    </div>
                    <div>
                      <div style={{ color: REDWOOD.neutral600, marginBottom: 4 }}>Amount</div>
                      <div style={{ fontWeight: 600, color: REDWOOD.neutral900 }}>
                        {previewPayload.lines
                          .reduce((total: number, line: any) => total + (line.enteredDr || line.enteredCr || 0), 0)
                          .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: REDWOOD.neutral600, marginBottom: 4 }}>Tax Amount</div>
                      <div style={{ fontWeight: 600, color: REDWOOD.neutral900 }}>
                        {previewPayload.lines
                          .filter((line: any) => line.accountingClass === 'TAX' || line.lineType === 'TAX')
                          .reduce((total: number, line: any) => total + (line.enteredDr || line.enteredCr || 0), 0)
                          .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {previewDebugSteps.map((step: any, idx: number) => (
                <Card
                  key={idx}
                  size="small"
                  style={{ margin: 0, borderRadius: 0, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
                >
                  <Collapse
                    items={[
                      {
                        key: idx,
                        label: (
                          <Space>
                            <span style={{ fontWeight: 600, color: REDWOOD.primary }}>{step.step}</span>
                            <Tag color="blue">{step.method}</Tag>
                            {step.status ? (
                              <Tag color={step.status < 400 ? 'green' : 'red'}>HTTP {step.status}</Tag>
                            ) : (
                              <Tag>Not executed yet</Tag>
                            )}
                          </Space>
                        ),
                        children: (
                          <Space direction="vertical" style={{ width: '100%' }} size="large">
                            {/* Run and Delete Buttons */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <Button
                                type="primary"
                                loading={step.loading}
                                onClick={() => runPreviewDebugStep(idx)}
                                icon={<SendOutlined />}
                              >
                                {step.loading ? 'Running...' : `Run Step ${idx + 1}`}
                              </Button>
                              {idx === 2 && (
                                <Button
                                  danger
                                  type="primary"
                                  onClick={handleDeleteSla}
                                  disabled={!previewSlaHeaderId}
                                  icon={<DeleteOutlined />}
                                  title={previewSlaHeaderId ? `Delete SLA ${previewSlaHeaderId}` : 'Run Step 2 to capture SLA ID'}
                                >
                                  Delete SLA {previewSlaHeaderId && `(${previewSlaHeaderId})`}
                                </Button>
                              )}
                              {idx === 3 && (
                                <Button
                                  danger
                                  type="primary"
                                  onClick={handleDeleteGlJournal}
                                  disabled={!previewGlBatchId}
                                  icon={<DeleteOutlined />}
                                  title={previewGlBatchId ? `Delete Journal ${previewGlBatchId}` : 'Run Step 3 to capture GL Batch ID'}
                                >
                                  Delete Journal {previewGlBatchId && `(${previewGlBatchId})`}
                                </Button>
                              )}
                            </div>

                            {/* URL Section */}
                            <div>
                              <div style={{ fontWeight: 600, marginBottom: 8, color: REDWOOD.info }}>
                                📍 Endpoint URL:
                              </div>
                              <div
                                style={{
                                  background: '#f5f5f5',
                                  padding: 12,
                                  borderRadius: 4,
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  wordBreak: 'break-all',
                                  border: `1px solid ${REDWOOD.neutral300}`,
                                }}
                              >
                                <strong>{step.method}</strong> {step.url}
                              </div>
                              <Button
                                size="small"
                                type="text"
                                icon={<CopyOutlined />}
                                onClick={() => {
                                  navigator.clipboard.writeText(`${step.method} ${step.url}`);
                                  message.success('URL copied!');
                                }}
                                style={{ marginTop: 8 }}
                              >
                                Copy URL
                              </Button>
                            </div>

                            {/* Request Body */}
                            {step.requestBody && (
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 8, color: REDWOOD.primary }}>
                                  📤 Request Payload (JSON):
                                </div>
                                <div
                                  style={{
                                    background: '#f5f5f5',
                                    padding: 12,
                                    borderRadius: 4,
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                    maxHeight: 300,
                                    overflowY: 'auto',
                                    border: `1px solid ${REDWOOD.neutral300}`,
                                    whiteSpace: 'pre-wrap',
                                    wordWrap: 'break-word',
                                  }}
                                >
                                  {JSON.stringify(step.requestBody, null, 2)}
                                </div>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<CopyOutlined />}
                                  onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(step.requestBody, null, 2));
                                    message.success('Payload copied!');
                                  }}
                                  style={{ marginTop: 8 }}
                                >
                                  Copy Payload
                                </Button>
                              </div>
                            )}

                            {/* Response */}
                            {step.response && (
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 8, color: REDWOOD.primary }}>
                                  📥 Response:
                                </div>
                                <div
                                  style={{
                                    background: step.status && step.status < 400 ? '#f6ffed' : '#fff1f0',
                                    padding: 12,
                                    borderRadius: 4,
                                    fontFamily: 'monospace',
                                    fontSize: 10,
                                    maxHeight: 300,
                                    overflowY: 'auto',
                                    border: `1px solid ${step.status && step.status < 400 ? '#b7eb8f' : '#ffa39e'}`,
                                    whiteSpace: 'pre-wrap',
                                    wordWrap: 'break-word',
                                  }}
                                >
                                  {JSON.stringify(step.response, null, 2)}
                                </div>
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<CopyOutlined />}
                                  onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(step.response, null, 2));
                                    message.success('Response copied!');
                                  }}
                                  style={{ marginTop: 8 }}
                                >
                                  Copy Response
                                </Button>
                              </div>
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
              ))}

              {/* Manual Delete Section */}
              <Card
                size="small"
                style={{ margin: 0, borderRadius: 0, borderTop: `2px solid ${REDWOOD.error}` }}
                title={<span style={{ color: REDWOOD.error, fontWeight: 600 }}>🗑️ Manual Delete (Test Cleanup)</span>}
              >
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                  {/* Delete SLA Section */}
                  <div style={{ border: `1px solid ${REDWOOD.error}`, borderRadius: 4, padding: 12, backgroundColor: '#fef0f0' }}>
                    <div style={{ fontWeight: 600, marginBottom: 12, color: REDWOOD.error, display: 'flex', alignItems: 'center', gap: 8 }}>
                      🔌 Delete SLA Entry
                      {previewSlaHeaderId && <Tag color="green">Auto-captured: {previewSlaHeaderId}</Tag>}
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                        📤 POST Endpoint:
                      </div>
                      <div
                        style={{
                          background: '#fff',
                          padding: 8,
                          borderRadius: 4,
                          fontFamily: 'monospace',
                          fontSize: 11,
                          border: `1px solid ${REDWOOD.error}`,
                          overflow: 'auto',
                          maxHeight: 60,
                        }}
                      >
                        {`${APEX_DB_CONFIG.baseUrl}/sla/accounting/delete`}
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                        📋 Request Body:
                      </div>
                      <div
                        style={{
                          background: '#fff',
                          padding: 8,
                          borderRadius: 4,
                          fontFamily: 'monospace',
                          fontSize: 10,
                          border: `1px solid ${REDWOOD.error}`,
                          overflow: 'auto',
                          maxHeight: 100,
                          whiteSpace: 'pre-wrap',
                          wordWrap: 'break-word',
                        }}
                      >
                        {JSON.stringify(
                          { headerId: manualSlaDeleteId || previewSlaHeaderId },
                          null,
                          2
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input
                        placeholder="Enter SLA Header ID (e.g., 845)"
                        value={manualSlaDeleteId || (previewSlaHeaderId ? String(previewSlaHeaderId) : '')}
                        onChange={(e) => setManualSlaDeleteId(e.target.value)}
                        type="number"
                        style={{ flex: 1 }}
                      />
                      <Button
                        danger
                        type="primary"
                        onClick={handleManualDeleteSla}
                        icon={<DeleteOutlined />}
                        disabled={!manualSlaDeleteId && !previewSlaHeaderId}
                      >
                        Delete SLA
                      </Button>
                    </div>
                  </div>

                  {/* Delete GL Journal Section */}
                  <div style={{ border: `1px solid ${REDWOOD.error}`, borderRadius: 4, padding: 12, backgroundColor: '#fef0f0' }}>
                    <div style={{ fontWeight: 600, marginBottom: 12, color: REDWOOD.error, display: 'flex', alignItems: 'center', gap: 8 }}>
                      🔌 Delete GL Journal
                      {previewGlBatchId && <Tag color="green">Auto-captured: {previewGlBatchId}</Tag>}
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                        📤 DELETE Endpoint:
                      </div>
                      <div
                        style={{
                          background: '#fff',
                          padding: 8,
                          borderRadius: 4,
                          fontFamily: 'monospace',
                          fontSize: 11,
                          border: `1px solid ${REDWOOD.error}`,
                          overflow: 'auto',
                          maxHeight: 60,
                        }}
                      >
                        {`${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${manualGlDeleteId || previewGlBatchId || '{batchId}'}`}
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                        ℹ️ Note: DELETE request has no body
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input
                        placeholder="Enter GL Batch ID (e.g., 12345)"
                        value={manualGlDeleteId || (previewGlBatchId ? String(previewGlBatchId) : '')}
                        onChange={(e) => setManualGlDeleteId(e.target.value)}
                        type="number"
                        style={{ flex: 1 }}
                      />
                      <Button
                        danger
                        type="primary"
                        onClick={handleManualDeleteGlJournal}
                        icon={<DeleteOutlined />}
                        disabled={!manualGlDeleteId && !previewGlBatchId}
                      >
                        Delete Journal
                      </Button>
                    </div>
                  </div>
                </Space>
              </Card>
            </div>
          )}
        </div>
      </Drawer>

      </Content>

      <FloatingMenu />

      <style>{`
        .row-good {
          background-color: #f6ffed !important;
        }
        .row-good td {
          background-color: #f6ffed !important;
          color: #1D7B4D !important;
        }
        .row-issue {
          background-color: #fff1f0 !important;
        }
        .row-issue td {
          background-color: #fff1f0 !important;
          color: #D93025 !important;
        }
      `}</style>
    </Layout>
  );
};

export default ManageInvoices;
