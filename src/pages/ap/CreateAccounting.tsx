import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import {
  Layout, Card, Form, Select, Button, Space, Table, Tag, Typography, Row, Col,
  Tabs, Statistic, Progress, Modal, Descriptions, DatePicker, Divider,
  Tooltip, Badge, Spin, Alert, Dropdown, message, Empty, Breadcrumb,
} from 'antd';
import {
  SearchOutlined, BookOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, ExclamationCircleOutlined, FileTextOutlined, CreditCardOutlined,
  BarChartOutlined, ReloadOutlined, CaretDownOutlined, EyeOutlined,
  ThunderboltOutlined, DiffOutlined, InfoCircleOutlined, ApiOutlined,
  LoadingOutlined, CodeOutlined, SwapOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';
import {
  fetchLedgerByBusinessUnit,
  buildApInvoiceSlaPayload,
  buildApPaymentSlaPayloads,
  createAccounting,
  getAccounting,
} from '../../services/sla.service';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

// ── Theme ────────────────────────────────────────────────────────────────────
const REDWOOD = {
  primary: '#C74634', success: '#2E8B57', warning: '#E88B00', error: '#C74634',
  info: '#1677ff', neutral400: '#9e9e9e', neutral600: '#616161',
  taskBlue: '#0057A8', surface: '#FAFAFA', headerBg: '#C74634',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const BASE = APEX_DB_CONFIG.baseUrl;
const fmt  = (n: number) => n?.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00';
const toApiDate = (d: string | Dayjs) => (typeof d === 'string' ? dayjs(d) : d).format('YYYY-MM-DD');

const STATUS_COLOR: Record<string, string> = {
  'Not Accounted': 'default', Draft: 'orange', DRAFT: 'orange',
  Posted: 'green', POSTED: 'green', Error: 'red', ERROR: 'red',
};
const STATUS_LABEL: Record<string, string> = {
  'Not Accounted': 'Not Accounted', Draft: 'Draft', DRAFT: 'Draft',
  Posted: 'Posted', POSTED: 'Posted', Error: 'Error', ERROR: 'Error',
};

// ── Interfaces ───────────────────────────────────────────────────────────────
interface InvoiceRow {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  invoiceAmount: number;
  currency: string;
  accountingStatus: string;
  businessUnit: string;
  liabilityDistribution: string;
}

interface PaymentRow {
  key: string;
  checkId: number;
  paymentNumber: string;
  paymentDate: string;
  supplier: string;
  paymentAmount: number;
  currency: string;
  accountingStatus: string;
  businessUnit: string;
  disbursementBankAccount: string;
  maturityDate: string;
  paymentType: string;
}

interface PrepayAppRow {
  key: string;
  applicationId: number;
  invoiceId: number;
  invoiceNumber: string;
  prepayInvoiceId: number;
  prepayNumber: string;
  appliedAmount: number;
  currency: string;
  accountingDate: string;
  businessUnit: string;
  supplierSite: string;
  liabilityDistribution: string;
  accountingStatus: string;   // derived from SLA lookup
  slaHeaderId?: number;
}

interface ProgressRow {
  id: string;                // invoiceNumber or paymentNumber
  label: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?: string;
  headerId?: number;
}

interface ReconcileRow {
  key: string;
  // SLA
  slaHeaderId: number | null;
  sourceType: 'Invoice' | 'Payment' | 'Prepayment';
  sourceTable: string;
  sourceNumber: string;
  sourceId: number;
  eventTypeCode: string;
  accountingDate: string;
  periodName: string;
  slaStatus: string;
  postingStatus: string;
  // SLA amounts (from lines)
  slaDr: number;
  slaCr: number;
  slaAccountedDr: number;
  slaAccountedCr: number;
  slaLineCount: number;
  // GL link
  glHeaderId: number | null;
  glBatchId: number | null;
  glBatchName: string | null;
  glJournalName: string | null;
  glCategory: string | null;
  glSource: string | null;
  glBatchStatus: string | null;
  // GL amounts (from header running totals)
  glDr: number;
  glCr: number;
  glAccountedDr: number;
  glAccountedCr: number;
  glLineCount: number;
  // Comparison
  difference: number;
  isBalanced: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────
const CreateAccounting: React.FC = () => {
  const navigate = useNavigate();
  const [headerForm] = Form.useForm();

  // ── Lookup data ──
  const [businessUnits, setBusinessUnits]       = useState<{ id: number; name: string }[]>([]);
  const [ledgers, setLedgers]                   = useState<{ ledgerId: number; ledgerName: string }[]>([]);
  const [periods, setPeriods]                   = useState<{ period_name_id: string; status: string }[]>([]);
  const [bankAccounts, setBankAccounts]         = useState<{ bankAccountName: string; cashAccountCombination: string; pdcAccountCombination: string; cashClearingAccountCombination: string }[]>([]);

  // ── Data ──
  const [invoices, setInvoices]                 = useState<InvoiceRow[]>([]);
  const [payments, setPayments]                 = useState<PaymentRow[]>([]);
  const [reconcileRows, setReconcileRows]       = useState<ReconcileRow[]>([]);
  const [dataLoading, setDataLoading]           = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  // ── Prepayment applications ──
  const [prepayApps, setPrepayApps]               = useState<PrepayAppRow[]>([]);
  const [selectedPrepayAppKeys, setSelectedPrepayAppKeys] = useState<React.Key[]>([]);

  // ── Selection ──
  const [selectedInvoiceKeys, setSelectedInvoiceKeys] = useState<React.Key[]>([]);
  const [selectedPaymentKeys, setSelectedPaymentKeys] = useState<React.Key[]>([]);

  // ── Active tab ──
  const [activeTab, setActiveTab] = useState('dashboard');

  // ── Progress modal ──
  const [progressVisible, setProgressVisible]   = useState(false);
  const [progressRows, setProgressRows]         = useState<ProgressRow[]>([]);
  const [progressMode, setProgressMode]         = useState<'DRAFT' | 'FINAL'>('DRAFT');
  const [progressRunning, setProgressRunning]   = useState(false);
  const [progressTarget, setProgressTarget]     = useState<'invoices' | 'payments'>('invoices');

  // ── View Accounting modal ──
  const [viewAcctVisible, setViewAcctVisible]   = useState(false);
  const [viewAcctLoading, setViewAcctLoading]   = useState(false);
  const [viewAcctLabel, setViewAcctLabel]       = useState('');
  const [viewAcctHeader, setViewAcctHeader]     = useState<any>(null);
  const [viewAcctLines, setViewAcctLines]       = useState<any[]>([]);

  // ── API log modal ──
  const [apiLogVisible, setApiLogVisible]       = useState(false);
  const [apiLogs, setApiLogs]                   = useState<{ method: string; url: string; status: number | string; body?: string; response?: string; ts: string }[]>([]);

  // ── Logged fetch helper ──────────────────────────────────────────────────
  const loggedFetch = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    const ts     = dayjs().format('HH:mm:ss.SSS');
    const method = options?.method || 'GET';
    const body   = options?.body ? String(options.body).slice(0, 300) : undefined;
    try {
      const res      = await fetch(url, options);
      const cloned   = res.clone();
      cloned.text().then(txt => {
        setApiLogs(prev => [{ method, url, status: res.status, body, response: txt.slice(0, 400), ts }, ...prev.slice(0, 49)]);
      });
      return res;
    } catch (err: any) {
      setApiLogs(prev => [{ method, url, status: 'ERR', body, response: err.message, ts }, ...prev.slice(0, 49)]);
      throw err;
    }
  }, []);

  // ── View Accounting handler ───────────────────────────────────────────────
  const handleViewAccounting = useCallback(async (sourceTable: string, sourceId: number, label: string) => {
    setViewAcctLabel(label);
    setViewAcctHeader(null);
    setViewAcctLines([]);
    setViewAcctVisible(true);
    setViewAcctLoading(true);
    try {
      const result = await getAccounting(sourceTable, sourceId);
      setViewAcctHeader((result as any).header ?? (result as any) ?? null);
      setViewAcctLines((result as any).lines ?? []);
    } catch (err: any) {
      message.error(`Could not load accounting: ${err.message}`);
    } finally {
      setViewAcctLoading(false);
    }
  }, []);

  // ── On mount: load BU + ledgers + bank accounts ──
  useEffect(() => {
    (async () => {
      try {
        const [buRes, ledgerRes, bankRes] = await Promise.all([
          fetch(`${BASE}/gl/businessunits`, { headers: { Accept: 'application/json' } }),
          fetch(`${BASE}/ledgers`,           { headers: { Accept: 'application/json' } }),
          fetch(`${BASE}/ap/bankaccounts`,   { headers: { Accept: 'application/json' } }),
        ]);
        if (buRes.ok) {
          const d = await buRes.json();
          setBusinessUnits((d.items || d || []).map((i: any) => ({ id: i.business_unit_id, name: i.business_unit_name || '' })));
        }
        if (ledgerRes.ok) {
          const d = await ledgerRes.json();
          setLedgers((d.items || d || []).map((i: any) => ({ ledgerId: i.ledger_id || i.ledgerId, ledgerName: i.ledger_name || i.ledgerName })));
        }
        if (bankRes.ok) {
          const d = await bankRes.json();
          setBankAccounts((d.items || d || []).map((i: any) => ({
            bankAccountName:                i.bank_account_name                 || i.bankAccountName                 || '',
            cashAccountCombination:         i.cash_account_combination          || i.cashAccountCombination          || '',
            pdcAccountCombination:          i.pdc_account_combination           || i.pdcAccountCombination           || '',
            cashClearingAccountCombination: i.cash_clearing_account_combination || i.cashClearingAccountCombination  || '',
          })));
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  // ── Load periods when ledger changes ──
  const handleLedgerChange = useCallback(async (ledgerName: string) => {
    setPeriods([]);
    try {
      const url = `${BASE}/periodsstatus/create?P_LEDGER_NAME=${encodeURIComponent(ledgerName)}&P_APPLICATION_NAME=General Ledger`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const d = await res.json();
        setPeriods((d.items || d || []).map((p: any) => ({ period_name_id: p.period_name_id || p.period_name, status: p.status || '' })));
      }
    } catch { /* non-fatal */ }
  }, []);

  // ── Auto-populate ledger when BU changes ──
  const handleBuChange = useCallback(async (buName: string) => {
    const info = await fetchLedgerByBusinessUnit(buName);
    if (info) {
      headerForm.setFieldValue('ledger', info.ledgerName);
      handleLedgerChange(info.ledgerName);
    }
  }, [headerForm, handleLedgerChange]);

  // ── Search ──────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const vals = headerForm.getFieldsValue();
    if (!vals.businessUnit) { message.warning('Select a Business Unit first.'); return; }
    setDataLoading(true);
    setInvoices([]); setPayments([]); setPrepayApps([]);
    setSelectedInvoiceKeys([]); setSelectedPaymentKeys([]); setSelectedPrepayAppKeys([]);

    const fromDate = vals.dateRange?.[0] ? toApiDate(vals.dateRange[0]) : null;
    const toDate   = vals.dateRange?.[1] ? toApiDate(vals.dateRange[1])   : null;

    try {
      const invParams = new URLSearchParams({ business_unit: vals.businessUnit });
      if (fromDate) invParams.append('date_from', fromDate);
      if (toDate)   invParams.append('date_to',   toDate);

      const pmtParams = new URLSearchParams({ business_unit: vals.businessUnit });
      if (fromDate) pmtParams.append('date_from', fromDate);
      if (toDate)   pmtParams.append('date_to',   toDate);

      const slaAppParams = new URLSearchParams({ sourceTable: 'RR_AP_APPLIED_PREPAYMENTS', limit: '1000' });

      const [invRes, pmtRes, slaAppRes] = await Promise.all([
        loggedFetch(`${BASE}/ap/createinvoice?${invParams}`,    { headers: { Accept: 'application/json' } }),
        loggedFetch(`${BASE}/ap/payments?${pmtParams}`,         { headers: { Accept: 'application/json' } }),
        loggedFetch(`${BASE}/sla/journals?${slaAppParams}`,     { headers: { Accept: 'application/json' } }),
      ]);

      // ── Build SLA status map for prepayment applications ──
      const slaAppMap: Record<number, { headerId: number; status: string }> = {};
      if (slaAppRes.ok) {
        const d = await slaAppRes.json();
        (d.items || d || []).forEach((s: any) => {
          const sid = Number(s.sourceId || s.source_id || 0);
          if (sid) slaAppMap[sid] = { headerId: s.headerId || 0, status: s.accountingStatus || s.accounting_status || 'DRAFT' };
        });
      }

      // ── Process invoices ──
      let prepayInvoiceIds: number[] = [];
      if (invRes.ok) {
        const d = await invRes.json();
        const items: InvoiceRow[] = (d.items || d || []).map((i: any) => ({
          key:                  String(i.invoice_id),
          invoiceId:            i.invoice_id,
          invoiceNumber:        i.invoice_number || '',
          invoiceDate:          i.invoice_date   || '',
          supplier:             i.supplier || i.party || '',
          invoiceAmount:        Number(i.invoice_amount || 0),
          currency:             i.invoice_currency || 'AED',
          accountingStatus:     i.accounting_status || 'Not Accounted',
          businessUnit:         i.business_unit || vals.businessUnit,
          liabilityDistribution: i.liability_distribution || i.LiabilityDistribution || '',
        }));
        // Client-side date filter when API doesn't support range
        const filtered = items.filter(r => {
          if (!fromDate && !toDate) return true;
          const d_ = dayjs(r.invoiceDate);
          if (fromDate && d_.isBefore(dayjs(fromDate), 'day')) return false;
          if (toDate   && d_.isAfter(dayjs(toDate),   'day')) return false;
          return true;
        });
        setInvoices(filtered);

        // Collect prepayment invoice IDs to fetch their applications
        prepayInvoiceIds = (d.items || d || [])
          .filter((i: any) => (i.invoice_type || '').toLowerCase() === 'prepayment')
          .map((i: any) => Number(i.invoice_id));
      }

      if (pmtRes.ok) {
        const d = await pmtRes.json();
        const items: PaymentRow[] = (d.items || d || []).map((i: any) => ({
          key:                    String(i.check_id || i.CheckId || i.payment_id),
          checkId:                i.check_id || i.CheckId || i.payment_id || 0,
          paymentNumber:          String(i.payment_number || i.PaymentNumber || i.check_id || ''),
          paymentDate:            i.payment_date || i.PaymentDate || i.check_date || '',
          supplier:               i.payee || i.Payee || i.supplier || '',
          paymentAmount:          Number(i.payment_amount || i.PaymentAmount || 0),
          currency:               i.payment_currency || i.PaymentCurrency || 'AED',
          accountingStatus:       i.AccountingStatus || i.accounting_status || 'Not Accounted',
          businessUnit:           i.business_unit || i.BusinessUnit || vals.businessUnit,
          disbursementBankAccount: i.disbursement_bank_account || i.DisbursementBankAccount || '',
          maturityDate:            i.maturity_date             || i.MaturityDate             || '',
          paymentType:             i.payment_type              || i.PaymentType              || '',
        }));
        const filtered = items.filter(r => {
          if (!fromDate && !toDate) return true;
          const d_ = dayjs(r.paymentDate);
          if (fromDate && d_.isBefore(dayjs(fromDate), 'day')) return false;
          if (toDate   && d_.isAfter(dayjs(toDate),   'day')) return false;
          return true;
        });
        setPayments(filtered);
      }

      // ── Fetch prepayment applications via by-prepayment/{id} per prepayment invoice ──
      if (prepayInvoiceIds.length > 0) {
        const appResponses = await Promise.all(
          prepayInvoiceIds.map(pid =>
            loggedFetch(`${BASE}/ap/applied-prepayments/by-prepayment/${pid}`, { headers: { Accept: 'application/json' } })
              .then(r => r.ok ? r.json() : { items: [] })
              .catch(() => ({ items: [] }))
          )
        );

        const rawApps: any[] = appResponses.flatMap(d =>
          Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : [])
        );

        const rows: PrepayAppRow[] = rawApps.map((a: any, idx: number) => {
          const appId = Number(a.ApplicationId ?? a.application_id ?? 0);
          const slaEntry = slaAppMap[appId];
          return {
            key:                  String(appId || `pa-${idx}`),
            applicationId:        appId,
            invoiceId:            Number(a.InvoiceId ?? a.invoice_id ?? 0),
            invoiceNumber:        a.InvoiceNumber ?? a.invoice_number ?? '',
            prepayInvoiceId:      Number(a.PrepaymentInvoiceId ?? a.prepayment_invoice_id ?? 0),
            prepayNumber:         a.PrepaymentNumber ?? a.prepayment_number ?? '',
            appliedAmount:        Number(a.AppliedAmount ?? a.applied_amount ?? 0),
            currency:             a.Currency ?? a.currency ?? 'AED',
            accountingDate:       a.ApplicationAccountingDate ?? a.application_accounting_date ?? a.creation_date ?? '',
            businessUnit:         a.BusinessUnit ?? a.business_unit ?? vals.businessUnit,
            supplierSite:         a.SupplierSite ?? a.supplier_site ?? '',
            liabilityDistribution: a.LiabilityDistribution ?? a.liability_distribution ?? '',
            accountingStatus:     slaEntry ? slaEntry.status : 'Not Accounted',
            slaHeaderId:          slaEntry?.headerId,
          };
        });

        const filteredApps = rows.filter(r => {
          if (!fromDate && !toDate) return true;
          const d_ = dayjs(r.accountingDate);
          if (fromDate && d_.isBefore(dayjs(fromDate), 'day')) return false;
          if (toDate   && d_.isAfter(dayjs(toDate),   'day')) return false;
          return true;
        });
        setPrepayApps(filteredApps);
      }
    } catch (err: any) {
      message.error(`Search failed: ${err.message}`);
    } finally {
      setDataLoading(false);
    }
  }, [headerForm, loggedFetch]);

  // ── Computed stats ───────────────────────────────────────────────────────────
  const invStats = {
    total:        invoices.length,
    notAccounted: invoices.filter(r => r.accountingStatus === 'Not Accounted').length,
    draft:        invoices.filter(r => ['Draft', 'DRAFT'].includes(r.accountingStatus)).length,
    posted:       invoices.filter(r => ['Posted', 'POSTED'].includes(r.accountingStatus)).length,
    error:        invoices.filter(r => ['Error', 'ERROR'].includes(r.accountingStatus)).length,
    totalAmount:  invoices.reduce((s, r) => s + r.invoiceAmount, 0),
  };
  const pmtStats = {
    total:        payments.length,
    notAccounted: payments.filter(r => r.accountingStatus === 'Not Accounted').length,
    draft:        payments.filter(r => ['Draft', 'DRAFT'].includes(r.accountingStatus)).length,
    posted:       payments.filter(r => ['Posted', 'POSTED'].includes(r.accountingStatus)).length,
    error:        payments.filter(r => ['Error', 'ERROR'].includes(r.accountingStatus)).length,
    totalAmount:  payments.reduce((s, r) => s + r.paymentAmount, 0),
  };

  // ── Bulk accounting runner ───────────────────────────────────────────────────
  const handleRunAccounting = useCallback(async (target: 'invoices' | 'payments', mode: 'DRAFT' | 'FINAL') => {
    const keys   = target === 'invoices' ? selectedInvoiceKeys : selectedPaymentKeys;
    const rows   = target === 'invoices'
      ? invoices.filter(r => keys.includes(r.key))
      : payments.filter(r => keys.includes(r.key));

    if (rows.length === 0) { message.warning('Select at least one record.'); return; }

    const vals      = headerForm.getFieldsValue();
    const ledgerInfo = await fetchLedgerByBusinessUnit(vals.businessUnit || '');

    const initRows: ProgressRow[] = rows.map((r: any) => ({
      id:     r.key,
      label:  target === 'invoices' ? (r as InvoiceRow).invoiceNumber : (r as PaymentRow).paymentNumber,
      status: ['Posted', 'POSTED'].includes(r.accountingStatus) ? 'skipped' : 'pending',
      message: ['Posted', 'POSTED'].includes(r.accountingStatus) ? 'Already posted — skipped' : undefined,
    }));

    setProgressRows(initRows);
    setProgressMode(mode);
    setProgressTarget(target);
    setProgressVisible(true);
    setProgressRunning(true);

    const update = (id: string, partial: Partial<ProgressRow>) =>
      setProgressRows(prev => prev.map(r => r.id === id ? { ...r, ...partial } : r));

    for (const row of rows) {
      const label = target === 'invoices' ? (row as InvoiceRow).invoiceNumber : (row as PaymentRow).paymentNumber;
      if (['Posted', 'POSTED'].includes(row.accountingStatus)) continue;

      update(row.key, { status: 'running' });
      try {
        if (target === 'invoices') {
          const inv = row as InvoiceRow;
          // Fetch invoice lines
          const linesRes = await fetch(`${BASE}/ap/createinvoiceslines?P_INVOICE_ID=${inv.invoiceId}`, { headers: { Accept: 'application/json' } });
          const linesData  = linesRes.ok ? await linesRes.json() : {};
          const rawLines: any[] = (linesData.items || linesData || []).filter((l: any) => l.line_type === 'Item' || !l.line_type);
          if (rawLines.length === 0) { update(row.key, { status: 'error', message: 'No item lines found' }); continue; }

          const expenseAccount = rawLines[0]?.distribution_combination || rawLines[0]?.dist_code_combination || '';
          const liabilityAcct  = inv.liabilityDistribution || '02-00-00-2313101-0000-000-00-000-000';
          const invoiceLines   = rawLines.map((l: any) => ({
            lineNumber:  l.line_number || 1,
            amount:      Number(l.line_amount || 0),
            description: l.description || `Line ${l.line_number}`,
            accrualAccount: l.distribution_combination || l.dist_code_combination || undefined,
            lineId:      l.line_id || undefined,
          }));

          const payload = buildApInvoiceSlaPayload({
            invoiceId:           inv.invoiceId,
            invoiceNumber:       inv.invoiceNumber,
            invoiceDate:         inv.invoiceDate,
            invoiceType:         'Standard',
            currencyCode:        inv.currency,
            invoiceAmount:       inv.invoiceAmount,
            businessUnit:        inv.businessUnit,
            ledgerId:            ledgerInfo?.ledgerId,
            ledgerName:          ledgerInfo?.ledgerName,
            expenseAccount,
            apLiabilityAccount:  liabilityAcct,
            invoiceLines,
          });

          const result = await createAccounting(payload);

          if (mode === 'FINAL' && result.headerId) {
            // Post to GL then stamp SLA
            // Guard: dayjs(undefined) silently returns TODAY — a missing
            // invoice date must fail loudly, not book to the current period.
            if (!inv.invoiceDate) throw new Error(`Invoice ${inv.invoiceNumber}: invoice date is missing — cannot derive GL period.`);
            const invoiceDateD = dayjs(inv.invoiceDate);
            if (!invoiceDateD.isValid()) throw new Error(`Invoice ${inv.invoiceNumber}: invalid invoice date "${inv.invoiceDate}".`);
            const periodName = invoiceDateD.format('MMM-YY');
            const currency   = inv.currency;
            const totalDr    = invoiceLines.reduce((s, l) => s + l.amount, 0);
            const glPayload  = {
              batch: {
                batchName: `AP-${inv.invoiceNumber}-${dayjs().format('YYYYMMDDHHmmss')}`,
                batchDescription: `AP Invoice ${inv.invoiceNumber} – Create Accounting`,
                ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC',
                ledgerId:   ledgerInfo?.ledgerId   ?? 0,
                status: 'NEW', accountingPeriod: periodName,
                controlTotal: totalDr, runningTotalDr: totalDr, runningTotalCr: totalDr,
                batchSource: 'Payables', createdBy: 'user',
              },
              header: {
                ledgerId: ledgerInfo?.ledgerId ?? 0, ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC',
                jeCategory: 'Purchase Invoices', jeSource: 'Payables', periodName,
                journalName: `AP Invoice ${inv.invoiceNumber}`,
                description: `Subledger accounting – Invoice ${inv.invoiceNumber}`,
                currencyCode: currency, currencyConversionType: 'User',
                currencyConversionDate: toApiDate(inv.invoiceDate),
                currencyConversionRate: 1, status: 'NEW',
                defaultEffectiveDate: toApiDate(inv.invoiceDate),
                runningTotalDr: totalDr, runningTotalCr: totalDr, createdBy: 'user',
              },
              lines: payload.lines.map((l, i) => ({
                enteredDr: l.lineType === 'DR' ? l.enteredDr : null,
                enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
                accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null,
                statAmount: null, description: l.description, currencyCode: l.currencyCode || currency,
                currencyConversionDate: toApiDate(inv.invoiceDate), currencyConversionRate: 1,
                userCurrencyConversionType: 'User', accountCombination: l.accountCombination,
                chartOfAccountsName: 'Chart of Accounts', reference1: inv.invoiceNumber,
                reference2: String(inv.invoiceId), reference3: l.accountingClass || null,
                reference4: inv.businessUnit || null, reference5: null, createdBy: 'user',
              })),
            };
            const glRes = await fetch(`${BASE}/journals/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(glPayload) });
            if (glRes.ok) {
              const glData = await glRes.json();
              await fetch(`${BASE}/sla/accounting/post`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ headerId: result.headerId, glBatchId: glData.batchId || 0, glBatchName: glPayload.batch.batchName, glHeaderId: glData.headerId || 0, postedBy: 'user' }),
              });
              update(row.key, { status: 'success', message: `Posted — SLA ID ${result.headerId} | GL Batch: ${glPayload.batch.batchName}`, headerId: result.headerId });
              // Refresh accountingStatus in table
              setInvoices(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'POSTED' } : r));
            } else {
              update(row.key, { status: 'success', message: `Draft created (SLA ID ${result.headerId}) — GL post failed`, headerId: result.headerId });
              setInvoices(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'DRAFT' } : r));
            }
          } else {
            update(row.key, { status: 'success', message: `Draft accounting created — SLA ID ${result.headerId}`, headerId: result.headerId });
            setInvoices(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'DRAFT' } : r));
          }

        } else {
          // ── PAYMENT ──
          const pmt = row as PaymentRow;
          const bank = bankAccounts.find(b => b.bankAccountName === pmt.disbursementBankAccount);
          const isPdc = !!(pmt.maturityDate || pmt.paymentType?.toLowerCase().includes('pdc'));
          const crAccount = isPdc
            ? (bank?.pdcAccountCombination  || '')
            : (bank?.cashAccountCombination || '02-00-00-1011001-0000-000-00-000-000');
          const crClass = isPdc ? 'PDC' : 'CASH';

          const relRes = await fetch(`${BASE}/ap/payments/${pmt.checkId}/related-invoices`, { headers: { Accept: 'application/json' } });
          const relData    = relRes.ok ? await relRes.json() : {};
          const relInvoices: any[] = relData.items || [];

          const payloads = buildApPaymentSlaPayloads({
            checkId:         pmt.checkId,
            paymentNumber:   pmt.paymentNumber,
            paymentDate:     toApiDate(pmt.paymentDate),
            currencyCode:    pmt.currency,
            businessUnit:    pmt.businessUnit,
            ledgerId:        ledgerInfo?.ledgerId,
            ledgerName:      ledgerInfo?.ledgerName,
            cashClearingAccount: crAccount,
            accountingClass:     crClass,
            appliedInvoices: relInvoices.length > 0
              ? relInvoices.map((inv: any) => ({
                  invoiceNumber:       inv.InvoiceNumber || '',
                  invoiceId:           inv.InvoiceId     || 0,
                  amountPaid:          inv.AmountPaidInvoiceCurrency || inv.InvoicePaymentAmount || pmt.paymentAmount,
                  liabilityDistribution: inv.LiabilityDistribution || '02-00-00-2313101-0000-000-00-000-000',
                }))
              : [{ invoiceNumber: 'DIRECT', invoiceId: 0, amountPaid: pmt.paymentAmount, liabilityDistribution: '02-00-00-2313101-0000-000-00-000-000' }],
          });

          let lastHeaderId: number | undefined;
          for (const pl of payloads) {
            const r2 = await createAccounting(pl);
            lastHeaderId = r2.headerId;
          }

          if (mode === 'FINAL' && lastHeaderId) {
            // Guard: dayjs(undefined) silently returns TODAY
            if (!pmt.paymentDate) throw new Error(`Payment ${pmt.paymentNumber}: payment date is missing — cannot derive GL period.`);
            const pmtDateD   = dayjs(pmt.paymentDate);
            if (!pmtDateD.isValid()) throw new Error(`Payment ${pmt.paymentNumber}: invalid payment date "${pmt.paymentDate}".`);
            const periodName = pmtDateD.format('MMM-YY');
            const totalAmt   = pmt.paymentAmount;
            const glPayload  = {
              batch: {
                batchName: `AP-PMT-${pmt.paymentNumber}-${dayjs().format('YYYYMMDDHHmmss')}`,
                batchDescription: `AP Payment ${pmt.paymentNumber}`,
                ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC', ledgerId: ledgerInfo?.ledgerId ?? 0,
                status: 'NEW', accountingPeriod: periodName, controlTotal: totalAmt,
                runningTotalDr: totalAmt, runningTotalCr: totalAmt, batchSource: 'Payables', createdBy: 'user',
              },
              header: {
                ledgerId: ledgerInfo?.ledgerId ?? 0, ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC',
                jeCategory: 'Payments', jeSource: 'Payables', periodName,
                journalName: `AP Payment ${pmt.paymentNumber}`, description: `Payment ${pmt.paymentNumber}`,
                currencyCode: pmt.currency, currencyConversionType: 'User',
                currencyConversionDate: toApiDate(pmt.paymentDate), currencyConversionRate: 1,
                defaultEffectiveDate: toApiDate(pmt.paymentDate),
                status: 'NEW', runningTotalDr: totalAmt, runningTotalCr: totalAmt, createdBy: 'user',
              },
              lines: payloads.flatMap(pl => pl.lines.map(l => ({
                enteredDr: l.lineType === 'DR' ? l.enteredDr : null,
                enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
                accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null,
                statAmount: null, description: l.description, currencyCode: l.currencyCode || pmt.currency,
                currencyConversionDate: toApiDate(pmt.paymentDate), currencyConversionRate: 1,
                userCurrencyConversionType: 'User', accountCombination: l.accountCombination,
                chartOfAccountsName: 'Chart of Accounts', reference1: pmt.paymentNumber,
                reference2: String(pmt.checkId), reference3: l.accountingClass || null,
                reference4: pmt.businessUnit || null, reference5: null, createdBy: 'user',
              }))),
            };
            const glRes = await fetch(`${BASE}/journals/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(glPayload) });
            if (glRes.ok) {
              const glData = await glRes.json();
              await fetch(`${BASE}/sla/accounting/post`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ headerId: lastHeaderId, glBatchId: glData.batchId || 0, glBatchName: glPayload.batch.batchName, glHeaderId: glData.headerId || 0, postedBy: 'user' }),
              });
              update(row.key, { status: 'success', message: `Posted — GL Batch: ${glPayload.batch.batchName}`, headerId: lastHeaderId });
              setPayments(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'POSTED' } : r));
            } else {
              update(row.key, { status: 'success', message: `Draft created (SLA ${lastHeaderId}) — GL post failed`, headerId: lastHeaderId });
              setPayments(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'DRAFT' } : r));
            }
          } else {
            update(row.key, { status: 'success', message: `Draft accounting created — SLA ID ${lastHeaderId}`, headerId: lastHeaderId });
            setPayments(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'DRAFT' } : r));
          }
        }
      } catch (err: any) {
        update(row.key, { status: 'error', message: err.message });
      }
    }

    setProgressRunning(false);
    const done = progressRows;
    const succeeded = done.filter(r => r.status === 'success').length;
    message.success(`Accounting complete — ${succeeded} / ${rows.length} processed.`);
  }, [selectedInvoiceKeys, selectedPaymentKeys, invoices, payments, headerForm, bankAccounts, progressRows]);

  // ── Bulk prepayment-application accounting ───────────────────────────────
  const handleRunPrepayAccounting = useCallback(async (mode: 'DRAFT' | 'FINAL') => {
    const rows = prepayApps.filter(r => selectedPrepayAppKeys.includes(r.key));
    if (rows.length === 0) { message.warning('Select at least one application.'); return; }

    const vals       = headerForm.getFieldsValue();
    const ledgerInfo = await fetchLedgerByBusinessUnit(vals.businessUnit || '');

    // Build invoice liabilityDistribution lookup from already-loaded invoices state
    const liabMap: Record<number, string> = {};
    invoices.forEach(inv => { if (inv.liabilityDistribution) liabMap[inv.invoiceId] = inv.liabilityDistribution; });

    const initRows: ProgressRow[] = rows.map(r => ({
      id: r.key, label: `${r.prepayNumber} → ${r.invoiceNumber}`,
      status: ['POSTED', 'Posted'].includes(r.accountingStatus) ? 'skipped' : 'pending',
      message: ['POSTED', 'Posted'].includes(r.accountingStatus) ? 'Already posted — skipped' : undefined,
    }));
    setProgressRows(initRows);
    setProgressMode(mode);
    setProgressTarget('invoices');   // reuse progress modal
    setProgressVisible(true);
    setProgressRunning(true);

    const update = (id: string, partial: Partial<ProgressRow>) =>
      setProgressRows(prev => prev.map(r => r.id === id ? { ...r, ...partial } : r));

    for (const row of rows) {
      if (['POSTED', 'Posted'].includes(row.accountingStatus)) continue;
      update(row.key, { status: 'running' });
      try {
        // Resolve liabilityDistribution — use from invoice if available
        let liabilityDist = row.liabilityDistribution || liabMap[row.invoiceId] || '';
        if (!liabilityDist) {
          // Last resort: fetch from API
          const invRes = await loggedFetch(`${BASE}/ap/createinvoice?invoice_id=${row.invoiceId}`, { headers: { Accept: 'application/json' } });
          if (invRes.ok) {
            const d = await invRes.json();
            liabilityDist = (d.items || d || [])[0]?.liability_distribution || '02-00-00-2313101-0000-000-00-000-000';
          } else {
            liabilityDist = '02-00-00-2313101-0000-000-00-000-000';
          }
        }
        const firstSeg       = liabilityDist.split('-')[0] || '02';
        const prepaymentDist = `${firstSeg}-00-00-1223108-0000-000-00-000-000`;

        // Guard: never fall back to today's date for the GL period
        if (!row.accountingDate) throw new Error(`Prepayment application ${row.applicationId ?? ''}: accounting date is missing — cannot derive GL period.`);
        const acctDateD  = dayjs(row.accountingDate);
        if (!acctDateD.isValid()) throw new Error(`Prepayment application ${row.applicationId ?? ''}: invalid accounting date "${row.accountingDate}".`);
        const acctDate   = acctDateD.format('YYYY-MM-DD');
        const periodName = acctDateD.format('MMM-YY');

        const slaPayload = {
          header: {
            moduleName: 'AP', sourceTable: 'RR_AP_APPLIED_PREPAYMENTS',
            sourceId: row.applicationId, sourceNumber: row.prepayNumber,
            sourceType: 'APPLIED', eventTypeCode: 'PREPAYMENT_APPLIED',
            eventDate: acctDate, accountingDate: acctDate, periodName,
            ledgerId: ledgerInfo?.ledgerId ?? 300000003259529,
            ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC',
            currencyCode: row.currency, ledgerCurrency: 'AED',
            exchangeRate: 1, exchangeRateType: 'Corporate',
            businessUnit: row.businessUnit,
            description: `Prepayment Applied – ${row.prepayNumber} on Invoice ${row.invoiceNumber}`,
            createdBy: 'user',
          },
          lines: [
            {
              lineNumber: 1, lineType: 'DR', accountingClass: 'LIABILITY',
              accountCombination: liabilityDist,
              enteredDr: row.appliedAmount, enteredCr: 0,
              accountedDr: row.appliedAmount, accountedCr: 0,
              currencyCode: row.currency, exchangeRate: 1,
              description: `AP Liability Reduced – Invoice ${row.invoiceNumber}`,
            },
            {
              lineNumber: 2, lineType: 'CR', accountingClass: 'PREPAYMENT',
              accountCombination: prepaymentDist,
              enteredDr: 0, enteredCr: row.appliedAmount,
              accountedDr: 0, accountedCr: row.appliedAmount,
              currencyCode: row.currency, exchangeRate: 1,
              description: `Prepayment Asset Cleared – ${row.prepayNumber}`,
            },
          ],
        };

        const createRes = await loggedFetch(`${BASE}/sla/accounting/create`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(slaPayload),
        });
        if (!createRes.ok) { const t = await createRes.text(); throw new Error(`HTTP ${createRes.status}: ${t}`); }
        const createData = await createRes.json();
        const newHeaderId = createData.headerId || createData.header_id;

        if (mode === 'FINAL' && newHeaderId) {
          const glPayload = {
            batch: {
              batchName: `AP-PREP-${row.prepayNumber}-${dayjs().format('YYYYMMDDHHmmss')}`,
              batchDescription: `Prepayment Applied – ${row.prepayNumber} on Invoice ${row.invoiceNumber}`,
              ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC', ledgerId: ledgerInfo?.ledgerId ?? 0,
              status: 'NEW', accountingPeriod: periodName,
              controlTotal: row.appliedAmount, runningTotalDr: row.appliedAmount, runningTotalCr: row.appliedAmount,
              batchSource: 'Payables', createdBy: 'user',
            },
            header: {
              ledgerId: ledgerInfo?.ledgerId ?? 0, ledgerName: ledgerInfo?.ledgerName ?? 'BCL DIFC',
              jeCategory: 'Purchase Invoices', jeSource: 'Payables', periodName,
              journalName: `Prepayment Applied – ${row.prepayNumber}`,
              description: `Prepayment Applied – ${row.prepayNumber} on Invoice ${row.invoiceNumber}`,
              currencyCode: row.currency, currencyConversionType: 'User',
              currencyConversionDate: acctDate, currencyConversionRate: 1,
              defaultEffectiveDate: acctDate,
              status: 'NEW', runningTotalDr: row.appliedAmount, runningTotalCr: row.appliedAmount, createdBy: 'user',
            },
            lines: slaPayload.lines.map(l => ({
              enteredDr: l.lineType === 'DR' ? l.enteredDr : null,
              enteredCr: l.lineType === 'CR' ? l.enteredCr : null,
              accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null,
              statAmount: null, description: l.description, currencyCode: l.currencyCode,
              currencyConversionDate: acctDate, currencyConversionRate: 1,
              userCurrencyConversionType: 'User', accountCombination: l.accountCombination,
              chartOfAccountsName: 'Chart of Accounts',
              reference1: row.prepayNumber, reference2: String(row.applicationId),
              reference3: l.accountingClass, reference4: row.businessUnit, reference5: null, createdBy: 'user',
            })),
          };
          const glRes = await loggedFetch(`${BASE}/journals/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(glPayload),
          });
          if (glRes.ok) {
            const glData = await glRes.json();
            await loggedFetch(`${BASE}/sla/accounting/post`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ headerId: newHeaderId, glBatchId: glData.batchId || 0, glBatchName: glPayload.batch.batchName, glHeaderId: glData.headerId || 0, postedBy: 'user' }),
            });
            update(row.key, { status: 'success', message: `Posted — GL Batch: ${glPayload.batch.batchName}`, headerId: newHeaderId });
            setPrepayApps(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'POSTED', slaHeaderId: newHeaderId } : r));
          } else {
            update(row.key, { status: 'success', message: `Draft created (SLA ${newHeaderId}) — GL post failed`, headerId: newHeaderId });
            setPrepayApps(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'DRAFT', slaHeaderId: newHeaderId } : r));
          }
        } else {
          update(row.key, { status: 'success', message: `Draft accounting created — SLA ID ${newHeaderId}`, headerId: newHeaderId });
          setPrepayApps(prev => prev.map(r => r.key === row.key ? { ...r, accountingStatus: 'DRAFT', slaHeaderId: newHeaderId } : r));
        }
      } catch (err: any) {
        update(row.key, { status: 'error', message: err.message });
      }
    }
    setProgressRunning(false);
  }, [prepayApps, selectedPrepayAppKeys, headerForm, invoices, loggedFetch]);

  // ── Reconciliation fetch ──────────────────────────────────────────────────
  // Single call to RR_AP_RECON_PKG.get_recon() via GET /ap/reconciliation.
  // The DB package performs one SQL query joining SLA headers + lines + GL
  // headers + GL batches — no N+1 round trips.
  const handleLoadReconciliation = useCallback(async () => {
    const vals = headerForm.getFieldsValue();
    if (!vals.period && !vals.businessUnit) {
      message.warning('Select a Period or Business Unit first.');
      return;
    }
    setReconcileLoading(true);
    setReconcileRows([]);
    try {
      const params = new URLSearchParams({ moduleName: 'AP', limit: '1000' });
      if (vals.period)       params.append('periodName',   vals.period);
      if (vals.businessUnit) params.append('businessUnit', vals.businessUnit);
      if (vals.ledger)       params.append('ledgerName',   vals.ledger);

      const res = await loggedFetch(`${BASE}/ap/reconciliation?${params}`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Oracle NUMBER serializes integers as "28." — invalid JSON; strip trailing dots
      const rawText = await res.text();
      const cleanedText = rawText.replace(/(\d)\.(?=[,\}\]\s\n\r])/g, '$1');
      const data = JSON.parse(cleanedText);

      if (data.error) throw new Error(data.message || 'Package error');

      const items: any[] = data.items || [];
      const rows: ReconcileRow[] = items.map((r: any, i: number) => {
        const st = (r.sourceTable || '').toUpperCase();
        const sourceType: ReconcileRow['sourceType'] =
          st.includes('PAYMENT')   ? 'Payment'    :
          st.includes('PREPAYMENT') ? 'Prepayment' : 'Invoice';
        return {
          key:            String(r.slaHeaderId || i),
          slaHeaderId:    r.slaHeaderId    ?? null,
          sourceType,
          sourceTable:    r.sourceTable    ?? '',
          sourceNumber:   r.sourceNumber   ?? '',
          sourceId:       r.sourceId       ?? 0,
          eventTypeCode:  r.eventTypeCode  ?? '',
          accountingDate: r.accountingDate ?? '',
          periodName:     r.periodName     ?? '',
          slaStatus:      r.accountingStatus ?? '',
          postingStatus:  r.postingStatus  ?? '',
          slaDr:          Number(r.slaEnteredDr   ?? 0),
          slaCr:          Number(r.slaEnteredCr   ?? 0),
          slaAccountedDr: Number(r.slaAccountedDr ?? 0),
          slaAccountedCr: Number(r.slaAccountedCr ?? 0),
          slaLineCount:   Number(r.slaLineCount    ?? 0),
          glHeaderId:     r.glHeaderId   ?? null,
          glBatchId:      r.glBatchId    ?? null,
          glBatchName:    r.glBatchName  ?? null,
          glJournalName:  r.glJournalName ?? null,
          glCategory:     r.glCategory   ?? null,
          glSource:       r.glSource     ?? null,
          glBatchStatus:  r.glBatchStatus ?? null,
          glDr:           Number(r.glEnteredDr   ?? 0),
          glCr:           Number(r.glEnteredCr   ?? 0),
          glAccountedDr:  Number(r.glAccountedDr ?? 0),
          glAccountedCr:  Number(r.glAccountedCr ?? 0),
          glLineCount:    Number(r.glLineCount    ?? 0),
          difference:     Number(r.difference     ?? 0),
          isBalanced:     r.isBalanced === true || r.isBalanced === 'true',
        };
      });
      setReconcileRows(rows);
    } catch (err: any) {
      message.error(`Reconciliation load failed: ${err.message}`);
    } finally {
      setReconcileLoading(false);
    }
  }, [headerForm, loggedFetch]);

  // ── KPI card helper ───────────────────────────────────────────────────────
  const KpiCard = ({ title, value, color, icon, sub }: { title: string; value: number | string; color: string; icon: React.ReactNode; sub?: string }) => (
    <Card size="small" style={{ borderRadius: 10, border: 'none', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', height: '100%' }}>
      <Row justify="space-between" align="top">
        <Col>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>{title}</Text>
          <Text strong style={{ fontSize: 22, color, lineHeight: 1 }}>{value}</Text>
          {sub && <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>{sub}</Text>}
        </Col>
        <Col>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color }}>
            {icon}
          </div>
        </Col>
      </Row>
    </Card>
  );

  // ── Reusable acct status columns ─────────────────────────────────────────
  const acctStatusCol = {
    title: 'Accounting', dataIndex: 'accountingStatus', width: 130,
    filters: [
      { text: 'Not Accounted', value: 'Not Accounted' }, { text: 'Draft', value: 'DRAFT' },
      { text: 'Posted', value: 'POSTED' }, { text: 'Error', value: 'ERROR' },
    ],
    onFilter: (value: any, record: any) => record.accountingStatus === value || record.accountingStatus?.toUpperCase() === value?.toUpperCase(),
    render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{STATUS_LABEL[v] ?? v}</Tag>,
  };

  // ── Accounting action dropdown ────────────────────────────────────────────
  const AccountingButton = ({ target, count }: { target: 'invoices' | 'payments'; count: number }) => (
    <Dropdown
      disabled={count === 0}
      trigger={['click']}
      menu={{
        items: [
          { key: 'draft', label: <Space><BookOutlined />Create Draft Accounting</Space>, onClick: () => handleRunAccounting(target, 'DRAFT') },
          { key: 'final', label: <Space><ThunderboltOutlined style={{ color: REDWOOD.success }} />Create &amp; Post to GL (Final)</Space>, onClick: () => handleRunAccounting(target, 'FINAL') },
        ],
      }}
    >
      <Button type="primary" style={{ background: REDWOOD.taskBlue, borderColor: REDWOOD.taskBlue }} disabled={count === 0}>
        <Space size={4}><BookOutlined />Create Accounting ({count})<CaretDownOutlined /></Space>
      </Button>
    </Dropdown>
  );

  // ── Tab: Dashboard ────────────────────────────────────────────────────────
  const DashboardTab = () => (
    <div>
      {/* Invoice stats */}
      <div style={{ marginBottom: 20 }}>
        <Space style={{ marginBottom: 10 }}>
          <FileTextOutlined style={{ color: REDWOOD.primary }} />
          <Text strong style={{ fontSize: 14 }}>Invoices</Text>
          <Tag>{invStats.total} total</Tag>
        </Space>
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={8} md={4}><KpiCard title="Total Invoices"    value={invStats.total}        color={REDWOOD.info}     icon={<FileTextOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Not Accounted"     value={invStats.notAccounted}  color={REDWOOD.neutral400} icon={<ExclamationCircleOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Draft"             value={invStats.draft}         color={REDWOOD.warning}  icon={<SyncOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Posted"            value={invStats.posted}        color={REDWOOD.success}  icon={<CheckCircleOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Error"             value={invStats.error}         color={REDWOOD.error}    icon={<CloseCircleOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Total Amount"      value={fmt(invStats.totalAmount)} color={REDWOOD.taskBlue} icon={<BarChartOutlined />} /></Col>
        </Row>
      </div>

      <Divider style={{ margin: '16px 0' }} />

      {/* Payment stats */}
      <div style={{ marginBottom: 20 }}>
        <Space style={{ marginBottom: 10 }}>
          <CreditCardOutlined style={{ color: REDWOOD.taskBlue }} />
          <Text strong style={{ fontSize: 14 }}>Payments</Text>
          <Tag>{pmtStats.total} total</Tag>
        </Space>
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={8} md={4}><KpiCard title="Total Payments"  value={pmtStats.total}          color={REDWOOD.info}     icon={<CreditCardOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Not Accounted"   value={pmtStats.notAccounted}   color={REDWOOD.neutral400} icon={<ExclamationCircleOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Draft"           value={pmtStats.draft}          color={REDWOOD.warning}  icon={<SyncOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Posted"          value={pmtStats.posted}         color={REDWOOD.success}  icon={<CheckCircleOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Error"           value={pmtStats.error}          color={REDWOOD.error}    icon={<CloseCircleOutlined />} /></Col>
          <Col xs={12} sm={8} md={4}><KpiCard title="Total Amount"    value={fmt(pmtStats.totalAmount)} color={REDWOOD.taskBlue} icon={<BarChartOutlined />} /></Col>
        </Row>
      </div>

      {/* Summary accounting status breakdown */}
      {(invoices.length > 0 || payments.length > 0) && (
        <>
          <Divider style={{ margin: '16px 0' }} />
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card size="small" title={<Space><FileTextOutlined />Invoice Accounting Status</Space>} style={{ borderRadius: 8 }}>
                {[
                  { label: 'Not Accounted', count: invStats.notAccounted, color: REDWOOD.neutral400 },
                  { label: 'Draft',         count: invStats.draft,        color: REDWOOD.warning },
                  { label: 'Posted',        count: invStats.posted,       color: REDWOOD.success },
                  { label: 'Error',         count: invStats.error,        color: REDWOOD.error },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <Row justify="space-between" style={{ marginBottom: 2 }}>
                      <Text style={{ fontSize: 12 }}>{label}</Text>
                      <Text style={{ fontSize: 12, color }}>{count} ({invStats.total ? Math.round(count / invStats.total * 100) : 0}%)</Text>
                    </Row>
                    <Progress percent={invStats.total ? Math.round(count / invStats.total * 100) : 0} showInfo={false}
                      strokeColor={color} size="small" />
                  </div>
                ))}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title={<Space><CreditCardOutlined />Payment Accounting Status</Space>} style={{ borderRadius: 8 }}>
                {[
                  { label: 'Not Accounted', count: pmtStats.notAccounted, color: REDWOOD.neutral400 },
                  { label: 'Draft',         count: pmtStats.draft,        color: REDWOOD.warning },
                  { label: 'Posted',        count: pmtStats.posted,       color: REDWOOD.success },
                  { label: 'Error',         count: pmtStats.error,        color: REDWOOD.error },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <Row justify="space-between" style={{ marginBottom: 2 }}>
                      <Text style={{ fontSize: 12 }}>{label}</Text>
                      <Text style={{ fontSize: 12, color }}>{count} ({pmtStats.total ? Math.round(count / pmtStats.total * 100) : 0}%)</Text>
                    </Row>
                    <Progress percent={pmtStats.total ? Math.round(count / pmtStats.total * 100) : 0} showInfo={false}
                      strokeColor={color} size="small" />
                  </div>
                ))}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {invoices.length === 0 && payments.length === 0 && (
        <Empty description="Run a search to load dashboard statistics" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '40px 0' }} />
      )}
    </div>
  );

  // ── Tab: Invoices ─────────────────────────────────────────────────────────
  const InvoicesTab = () => (
    <div>
      {/* Mini KPI row */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        {[
          { label: 'Not Accounted', value: invStats.notAccounted, color: REDWOOD.neutral400 },
          { label: 'Draft',         value: invStats.draft,        color: REDWOOD.warning },
          { label: 'Posted',        value: invStats.posted,       color: REDWOOD.success },
          { label: 'Error',         value: invStats.error,        color: REDWOOD.error },
        ].map(({ label, value, color }) => (
          <Col key={label} xs={12} sm={6}>
            <Card size="small" style={{ borderRadius: 8, textAlign: 'center', border: `1px solid ${color}30` }}>
              <Text strong style={{ fontSize: 20, color, display: 'block' }}>{value}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Action bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
        <Col>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {invoices.length} invoices
              {selectedInvoiceKeys.length > 0 && <> | <Text strong style={{ color: REDWOOD.taskBlue }}>{selectedInvoiceKeys.length} selected</Text></>}
            </Text>
            {selectedInvoiceKeys.length > 0 && (
              <Button size="small" onClick={() => setSelectedInvoiceKeys([])} type="link">Clear selection</Button>
            )}
          </Space>
        </Col>
        <Col>
          <Space>
            <Button size="small" onClick={() => setSelectedInvoiceKeys(
              invoices.filter(r => !['Posted', 'POSTED'].includes(r.accountingStatus)).map(r => r.key)
            )}>
              Select Unaccounted
            </Button>
            <AccountingButton target="invoices" count={selectedInvoiceKeys.length} />
          </Space>
        </Col>
      </Row>

      <Table
        rowSelection={{ selectedRowKeys: selectedInvoiceKeys, onChange: (keys) => setSelectedInvoiceKeys(keys) }}
        dataSource={invoices}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} invoices` }}
        scroll={{ x: 800 }}
        loading={dataLoading}
        columns={[
          { title: 'Invoice Date', dataIndex: 'invoiceDate', width: 110, sorter: (a: InvoiceRow, b: InvoiceRow) => a.invoiceDate.localeCompare(b.invoiceDate), render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YY') : '—'}</Text> },
          { title: 'Invoice #', dataIndex: 'invoiceNumber', width: 140, render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text> },
          { title: 'Supplier', dataIndex: 'supplier', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
          { title: 'Amount', dataIndex: 'invoiceAmount', width: 120, align: 'right' as const, sorter: (a: InvoiceRow, b: InvoiceRow) => a.invoiceAmount - b.invoiceAmount, render: (v: number, r: InvoiceRow) => <Text style={{ fontSize: 12 }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text> },
          acctStatusCol,
          {
            title: '', key: 'action', width: 50, align: 'center' as const,
            render: (_: any, r: InvoiceRow) => (
              <Tooltip title="View Accounting Entries">
                <Button size="small" type="text" icon={<EyeOutlined style={{ color: REDWOOD.taskBlue }} />}
                  disabled={r.accountingStatus === 'Not Accounted'}
                  onClick={() => handleViewAccounting('AP_INVOICES', r.invoiceId, `Invoice ${r.invoiceNumber}`)} />
              </Tooltip>
            ),
          },
        ]}
      />
    </div>
  );

  // ── Tab: Payments ─────────────────────────────────────────────────────────
  const PaymentsTab = () => (
    <div>
      {/* Mini KPI row */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        {[
          { label: 'Not Accounted', value: pmtStats.notAccounted, color: REDWOOD.neutral400 },
          { label: 'Draft',         value: pmtStats.draft,        color: REDWOOD.warning },
          { label: 'Posted',        value: pmtStats.posted,       color: REDWOOD.success },
          { label: 'Error',         value: pmtStats.error,        color: REDWOOD.error },
        ].map(({ label, value, color }) => (
          <Col key={label} xs={12} sm={6}>
            <Card size="small" style={{ borderRadius: 8, textAlign: 'center', border: `1px solid ${color}30` }}>
              <Text strong style={{ fontSize: 20, color, display: 'block' }}>{value}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Action bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
        <Col>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {payments.length} payments
              {selectedPaymentKeys.length > 0 && <> | <Text strong style={{ color: REDWOOD.taskBlue }}>{selectedPaymentKeys.length} selected</Text></>}
            </Text>
            {selectedPaymentKeys.length > 0 && (
              <Button size="small" onClick={() => setSelectedPaymentKeys([])} type="link">Clear selection</Button>
            )}
          </Space>
        </Col>
        <Col>
          <Space>
            <Button size="small" onClick={() => setSelectedPaymentKeys(
              payments.filter(r => !['Posted', 'POSTED'].includes(r.accountingStatus)).map(r => r.key)
            )}>
              Select Unaccounted
            </Button>
            <AccountingButton target="payments" count={selectedPaymentKeys.length} />
          </Space>
        </Col>
      </Row>

      <Table
        rowSelection={{ selectedRowKeys: selectedPaymentKeys, onChange: (keys) => setSelectedPaymentKeys(keys) }}
        dataSource={payments}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} payments` }}
        scroll={{ x: 800 }}
        loading={dataLoading}
        columns={[
          { title: 'Payment Date', dataIndex: 'paymentDate', width: 110, sorter: (a: PaymentRow, b: PaymentRow) => a.paymentDate.localeCompare(b.paymentDate), render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YY') : '—'}</Text> },
          { title: 'Payment #', dataIndex: 'paymentNumber', width: 130, render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text> },
          { title: 'Payee / Supplier', dataIndex: 'supplier', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
          { title: 'Amount', dataIndex: 'paymentAmount', width: 120, align: 'right' as const, sorter: (a: PaymentRow, b: PaymentRow) => a.paymentAmount - b.paymentAmount, render: (v: number, r: PaymentRow) => <Text style={{ fontSize: 12 }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text> },
          acctStatusCol,
          {
            title: '', key: 'action', width: 50, align: 'center' as const,
            render: (_: any, r: PaymentRow) => (
              <Tooltip title="View Accounting Entries">
                <Button size="small" type="text" icon={<EyeOutlined style={{ color: REDWOOD.taskBlue }} />}
                  disabled={r.accountingStatus === 'Not Accounted'}
                  onClick={() => handleViewAccounting('AP_PAYMENTS', r.checkId, `Payment ${r.paymentNumber}`)} />
              </Tooltip>
            ),
          },
        ]}
      />
    </div>
  );

  // ── Tab: Prepayment Applications ─────────────────────────────────────────
  const prepayStats = {
    total:        prepayApps.length,
    notAccounted: prepayApps.filter(r => r.accountingStatus === 'Not Accounted').length,
    draft:        prepayApps.filter(r => ['DRAFT', 'Draft'].includes(r.accountingStatus)).length,
    posted:       prepayApps.filter(r => ['POSTED', 'Posted'].includes(r.accountingStatus)).length,
    error:        prepayApps.filter(r => ['ERROR', 'Error'].includes(r.accountingStatus)).length,
    totalAmount:  prepayApps.reduce((s, r) => s + r.appliedAmount, 0),
  };

  const PrepayAppTab = () => (
    <div>
      {/* Explanation banner */}
      <Alert
        type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
        message="Prepayment application accounting creates journal entries for each applied prepayment: DR AP Liability / CR Prepayment Asset. This is separate from the invoice accounting."
      />

      {/* Mini KPI row */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        {[
          { label: 'Not Accounted', value: prepayStats.notAccounted, color: REDWOOD.neutral400 },
          { label: 'Draft',         value: prepayStats.draft,        color: REDWOOD.warning },
          { label: 'Posted',        value: prepayStats.posted,       color: REDWOOD.success },
          { label: 'Error',         value: prepayStats.error,        color: REDWOOD.error },
        ].map(({ label, value, color }) => (
          <Col key={label} xs={12} sm={6}>
            <Card size="small" style={{ borderRadius: 8, textAlign: 'center', border: `1px solid ${color}30` }}>
              <Text strong style={{ fontSize: 20, color, display: 'block' }}>{value}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Action bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
        <Col>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {prepayApps.length} prepayment applications
              {selectedPrepayAppKeys.length > 0 && <> | <Text strong style={{ color: REDWOOD.taskBlue }}>{selectedPrepayAppKeys.length} selected</Text></>}
            </Text>
            {selectedPrepayAppKeys.length > 0 && (
              <Button size="small" onClick={() => setSelectedPrepayAppKeys([])} type="link">Clear selection</Button>
            )}
          </Space>
        </Col>
        <Col>
          <Space>
            <Button size="small" onClick={() => setSelectedPrepayAppKeys(
              prepayApps.filter(r => !['POSTED', 'Posted'].includes(r.accountingStatus)).map(r => r.key)
            )}>
              Select Unaccounted
            </Button>
            <Dropdown
              disabled={selectedPrepayAppKeys.length === 0}
              trigger={['click']}
              menu={{
                items: [
                  { key: 'draft', label: <Space><BookOutlined />Create Draft Accounting</Space>, onClick: () => handleRunPrepayAccounting('DRAFT') },
                  { key: 'final', label: <Space><ThunderboltOutlined style={{ color: REDWOOD.success }} />Create &amp; Post to GL (Final)</Space>, onClick: () => handleRunPrepayAccounting('FINAL') },
                ],
              }}
            >
              <Button type="primary" style={{ background: REDWOOD.taskBlue, borderColor: REDWOOD.taskBlue }}
                disabled={selectedPrepayAppKeys.length === 0}>
                <Space size={4}><SwapOutlined />Create Prepay Accounting ({selectedPrepayAppKeys.length})<CaretDownOutlined /></Space>
              </Button>
            </Dropdown>
          </Space>
        </Col>
      </Row>

      <Table
        rowSelection={{ selectedRowKeys: selectedPrepayAppKeys, onChange: (keys) => setSelectedPrepayAppKeys(keys) }}
        dataSource={prepayApps}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} applications` }}
        scroll={{ x: 900 }}
        loading={dataLoading}
        summary={(data) => {
          const totApplied = (data as PrepayAppRow[]).reduce((s, r) => s + r.appliedAmount, 0);
          return (
            <Table.Summary.Row style={{ background: '#f5f5f5', fontWeight: 700 }}>
              <Table.Summary.Cell index={0} colSpan={4}><Text strong>Total Applied</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: REDWOOD.info }}>{fmt(totApplied)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={3} />
            </Table.Summary.Row>
          );
        }}
        columns={[
          {
            title: 'App. Date', dataIndex: 'accountingDate', width: 105,
            sorter: (a: PrepayAppRow, b: PrepayAppRow) => a.accountingDate.localeCompare(b.accountingDate),
            render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YY') : '—'}</Text>,
          },
          {
            title: 'Prepayment #', dataIndex: 'prepayNumber', width: 150,
            render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text>,
          },
          {
            title: 'Invoice # (Target)', dataIndex: 'invoiceNumber', width: 160,
            render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
          },
          {
            title: 'Supplier Site', dataIndex: 'supplierSite', width: 130, ellipsis: true,
            render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v || '—'}</Text>,
          },
          {
            title: 'Applied Amt', dataIndex: 'appliedAmount', width: 120, align: 'right' as const,
            sorter: (a: PrepayAppRow, b: PrepayAppRow) => a.appliedAmount - b.appliedAmount,
            render: (v: number, r: PrepayAppRow) => <Text style={{ fontSize: 12 }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text>,
          },
          {
            title: 'Liability Acct', dataIndex: 'liabilityDistribution', width: 190, ellipsis: true,
            render: (v: string) => v
              ? <Text code style={{ fontSize: 10 }}>{v}</Text>
              : <Tooltip title="Liability distribution not available — a default will be used when creating accounting">
                  <Tag color="orange" style={{ fontSize: 10 }}>Not set</Tag>
                </Tooltip>,
          },
          acctStatusCol,
          {
            title: '', key: 'action', width: 50, align: 'center' as const,
            render: (_: any, r: PrepayAppRow) => (
              <Tooltip title="View Accounting Entries">
                <Button size="small" type="text" icon={<EyeOutlined style={{ color: REDWOOD.taskBlue }} />}
                  disabled={r.accountingStatus === 'Not Accounted'}
                  onClick={() => handleViewAccounting('RR_AP_APPLIED_PREPAYMENTS', r.applicationId, `Prepay App ${r.prepayNumber} → ${r.invoiceNumber}`)} />
              </Tooltip>
            ),
          },
        ]}
      />
    </div>
  );

  // ── Tab: Reconciliation ───────────────────────────────────────────────────
  const ReconcileTab = () => {
    const matched   = reconcileRows.filter(r => r.glHeaderId !== null);
    const unmatched = reconcileRows.filter(r => r.glHeaderId === null);
    const withDiff  = reconcileRows.filter(r => r.difference > 0.01);

    return (
      <div>
        <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
          <Col>
            <Space>
              <Tag color="blue">{reconcileRows.length} SLA entries</Tag>
              <Tag color="green">{matched.length} matched to GL</Tag>
              <Tag color="orange">{unmatched.length} SLA only</Tag>
              {withDiff.length > 0 && <Tag color="red">{withDiff.length} with differences</Tag>}
            </Space>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} loading={reconcileLoading} onClick={handleLoadReconciliation}>
              Load / Refresh
            </Button>
          </Col>
        </Row>

        {unmatched.length > 0 && (
          <Alert
            type="warning" showIcon
            message={`${unmatched.length} SLA entries have no matching GL journal. These may be in DRAFT or not yet transferred to GL.`}
            style={{ marginBottom: 12, fontSize: 12 }}
          />
        )}
        {withDiff.length > 0 && (
          <Alert
            type="error" showIcon
            message={`${withDiff.length} entries have a debit/credit difference between SLA and GL — review required.`}
            style={{ marginBottom: 12, fontSize: 12 }}
          />
        )}

        <Table
          dataSource={reconcileRows}
          size="small"
          loading={reconcileLoading}
          pagination={{ pageSize: 100, showSizeChanger: true }}
          scroll={{ x: 1400 }}
          rowClassName={(r) => !r.isBalanced && r.glHeaderId ? 'ant-table-row-error' : ''}
          columns={[
            {
              title: 'Type', dataIndex: 'sourceType', width: 90, fixed: 'left',
              filters: [
                { text: 'Invoice', value: 'Invoice' },
                { text: 'Payment', value: 'Payment' },
                { text: 'Prepayment', value: 'Prepayment' },
              ],
              onFilter: (v: any, r) => r.sourceType === v,
              render: (v: string) => {
                const color = v === 'Invoice' ? 'blue' : v === 'Payment' ? 'purple' : 'gold';
                return <Tag color={color} style={{ fontSize: 10 }}>{v}</Tag>;
              },
            },
            {
              title: 'Source #', dataIndex: 'sourceNumber', width: 150, fixed: 'left',
              render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v || '—'}</Text>,
            },
            { title: 'Acct Date', dataIndex: 'accountingDate', width: 100, render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
            {
              title: 'SLA Subledger',
              children: [
                { title: 'Header ID', dataIndex: 'slaHeaderId', width: 85, render: (v: number | null) => <Text code style={{ fontSize: 10 }}>{v ?? '—'}</Text> },
                {
                  title: 'Status', dataIndex: 'slaStatus', width: 90,
                  filters: [
                    { text: 'Draft', value: 'DRAFT' }, { text: 'Posted', value: 'POSTED' },
                    { text: 'Final', value: 'FINAL' }, { text: 'Error',  value: 'ERROR'  },
                  ],
                  onFilter: (v: any, r) => r.slaStatus === v,
                  render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ fontSize: 10 }}>{STATUS_LABEL[v] ?? v}</Tag>,
                },
                { title: 'Lines', dataIndex: 'slaLineCount', width: 55, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                { title: 'Debit',  dataIndex: 'slaDr', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 11, color: REDWOOD.info  }}>{fmt(v)}</Text> },
                { title: 'Credit', dataIndex: 'slaCr', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 11, color: REDWOOD.error }}>{fmt(v)}</Text> },
              ],
            },
            {
              title: 'GL Journal',
              children: [
                {
                  title: 'Category', dataIndex: 'glCategory', width: 130,
                  render: (v: string | null) => v
                    ? <Tag style={{ fontSize: 10 }}>{v}</Tag>
                    : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
                },
                {
                  title: 'Journal / Batch', dataIndex: 'glJournalName', ellipsis: true, width: 180,
                  render: (v: string | null, r: ReconcileRow) => r.glHeaderId
                    ? <Tooltip title={r.glBatchName || ''}><Text style={{ fontSize: 11 }}>{v || r.glBatchName || '—'}</Text></Tooltip>
                    : <Text type="secondary" style={{ fontSize: 11 }}>Not transferred to GL</Text>,
                },
                {
                  title: 'GL Status', dataIndex: 'glBatchStatus', width: 85,
                  render: (v: string | null) => v
                    ? <Tag color={v === 'Posted' ? 'green' : v === 'Unposted' ? 'orange' : 'default'} style={{ fontSize: 10 }}>{v}</Tag>
                    : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
                },
                { title: 'Lines', dataIndex: 'glLineCount', width: 55, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
                { title: 'Debit',  dataIndex: 'glDr', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 11, color: REDWOOD.info  }}>{v ? fmt(v) : '—'}</Text> },
                { title: 'Credit', dataIndex: 'glCr', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 11, color: REDWOOD.error }}>{v ? fmt(v) : '—'}</Text> },
              ],
            },
            {
              title: 'Match',
              children: [
                {
                  title: 'Difference', dataIndex: 'difference', width: 110, align: 'right' as const,
                  sorter: (a, b) => b.difference - a.difference,
                  render: (v: number, r: ReconcileRow) => {
                    if (!r.glHeaderId) return <Tag color="default" style={{ fontSize: 10 }}>No GL</Tag>;
                    return v > 0.01
                      ? <Text strong style={{ fontSize: 12, color: REDWOOD.error }}>{fmt(v)}</Text>
                      : <Tag color="green" style={{ fontSize: 10 }}>Balanced</Tag>;
                  },
                },
              ],
            },
          ]}
          summary={(data) => {
            const totSlaDr = data.reduce((s, r) => s + r.slaDr, 0);
            const totSlaCr = data.reduce((s, r) => s + r.slaCr, 0);
            const totGlDr  = data.reduce((s, r) => s + r.glDr,  0);
            const totGlCr  = data.reduce((s, r) => s + r.glCr,  0);
            const totDiff  = data.reduce((s, r) => s + r.difference, 0);
            // Leaf column indices:
            // 0=Type 1=Source# 2=AcctDate 3=SLA-HeaderID 4=SLA-Status 5=SLA-Lines
            // 6=SLA-Dr 7=SLA-Cr 8=GL-Category 9=GL-Journal 10=GL-Status
            // 11=GL-Lines 12=GL-Dr 13=GL-Cr 14=Difference
            return (
              <Table.Summary.Row style={{ background: '#f5f5f5', fontWeight: 700 }}>
                <Table.Summary.Cell index={0} colSpan={6}><Text strong>Total</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={6}  align="right"><Text strong style={{ color: REDWOOD.info  }}>{fmt(totSlaDr)}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={7}  align="right"><Text strong style={{ color: REDWOOD.error }}>{fmt(totSlaCr)}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={8}  colSpan={4} />
                <Table.Summary.Cell index={12} align="right"><Text strong style={{ color: REDWOOD.info  }}>{totGlDr > 0 ? fmt(totGlDr) : '—'}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={13} align="right"><Text strong style={{ color: REDWOOD.error }}>{totGlCr > 0 ? fmt(totGlCr) : '—'}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={14} align="right">
                  {totDiff > 0.01
                    ? <Text strong style={{ color: REDWOOD.error }}>{fmt(totDiff)}</Text>
                    : <Tag color="green">Balanced</Tag>}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </div>
    );
  };

  // ── Progress modal ────────────────────────────────────────────────────────
  const doneCount    = progressRows.filter(r => ['success', 'error', 'skipped'].includes(r.status)).length;
  const totalCount   = progressRows.length;
  const successCount = progressRows.filter(r => r.status === 'success').length;
  const errorCount   = progressRows.filter(r => r.status === 'error').length;

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Page header */}
      <div style={{ background: REDWOOD.headerBg, padding: '10px 24px' }}>
        <Breadcrumb
          style={{ marginBottom: 4 }}
          items={[
            {
              title: (
                <span
                  style={{ color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => navigate('/ap')}
                >
                  Payables
                </span>
              ),
            },
            { title: <span style={{ color: '#fff', fontSize: 12 }}>Create Accounting</span> },
          ]}
        />
        <Space>
          <BookOutlined style={{ color: '#fff', fontSize: 18 }} />
          <Title level={4} style={{ color: '#fff', margin: 0 }}>Create Accounting</Title>
          <Tag color="orange" style={{ fontSize: 11 }}>Payables</Tag>
        </Space>
      </div>

      <Content style={{ padding: '16px 24px' }}>
        {/* ── Search header ──────────────────────────────────────────────── */}
        <Card
          style={{ marginBottom: 16, borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          extra={
            <Tooltip title={`API Log (${apiLogs.length} calls)`}>
              <Button size="small" type="text" icon={<ApiOutlined />} onClick={() => setApiLogVisible(true)}>
                <Badge count={apiLogs.length} size="small" style={{ backgroundColor: REDWOOD.taskBlue }} overflowCount={99} />
              </Button>
            </Tooltip>
          }
        >
          <Form form={headerForm} layout="inline" onFinish={handleSearch} size="small">
            <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 8 }}>
              <Select style={{ width: 200 }} placeholder="Select BU" showSearch allowClear onChange={handleBuChange}>
                {businessUnits.map(b => <Option key={b.name} value={b.name}>{b.name}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item label="Ledger" name="ledger" style={{ marginBottom: 8 }}>
              <Select style={{ width: 180 }} placeholder="Ledger" showSearch allowClear onChange={handleLedgerChange}>
                {ledgers.map(l => <Option key={l.ledgerName} value={l.ledgerName}>{l.ledgerName}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item label="Period" name="period" style={{ marginBottom: 8 }}>
              <Select style={{ width: 130 }} placeholder="Period" showSearch allowClear>
                {periods.map(p => <Option key={p.period_name_id} value={p.period_name_id}>{p.period_name_id}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item label="Date Range" name="dateRange" style={{ marginBottom: 8 }}>
              <RangePicker format="D-MMM-YYYY" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={dataLoading}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Search
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {/* ── Main tabs ──────────────────────────────────────────────────── */}
        <Card style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <Tabs
            activeKey={activeTab}
            onChange={key => { setActiveTab(key); if (key === 'reconcile' && reconcileRows.length === 0) handleLoadReconciliation(); }}
            type="card"
            items={[
              {
                key: 'dashboard',
                label: <Space size={4}><BarChartOutlined /><span>Dashboard</span></Space>,
                children: <DashboardTab />,
              },
              {
                key: 'invoices',
                label: (
                  <Space size={4}>
                    <FileTextOutlined />
                    <span>Invoices</span>
                    {invoices.length > 0 && <Badge count={invStats.notAccounted + invStats.draft} style={{ backgroundColor: REDWOOD.warning, fontSize: 10 }} overflowCount={999} />}
                  </Space>
                ),
                children: <InvoicesTab />,
              },
              {
                key: 'payments',
                label: (
                  <Space size={4}>
                    <CreditCardOutlined />
                    <span>Payments</span>
                    {payments.length > 0 && <Badge count={pmtStats.notAccounted + pmtStats.draft} style={{ backgroundColor: REDWOOD.warning, fontSize: 10 }} overflowCount={999} />}
                  </Space>
                ),
                children: <PaymentsTab />,
              },
              {
                key: 'prepayments',
                label: (
                  <Space size={4}>
                    <SwapOutlined />
                    <span>Prepayment Applications</span>
                    {prepayApps.length > 0 && <Badge count={prepayStats.notAccounted + prepayStats.draft} style={{ backgroundColor: REDWOOD.warning, fontSize: 10 }} overflowCount={999} />}
                  </Space>
                ),
                children: <PrepayAppTab />,
              },
              {
                key: 'reconcile',
                label: <Space size={4}><DiffOutlined /><span>Payables to GL Reconciliation</span></Space>,
                children: <ReconcileTab />,
              },
            ]}
          />
        </Card>
      </Content>

      {/* ── Progress Modal ─────────────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <BookOutlined style={{ color: REDWOOD.taskBlue }} />
            <span>Create Accounting — {progressMode === 'FINAL' ? 'Draft + Post to GL' : 'Draft Only'}</span>
            <Tag color={progressMode === 'FINAL' ? 'green' : 'orange'}>{progressMode}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {progressTarget === 'invoices' ? 'Invoices' : 'Payments'}
            </Text>
          </Space>
        }
        open={progressVisible}
        onCancel={() => !progressRunning && setProgressVisible(false)}
        footer={
          <Space>
            {!progressRunning && (
              <Button type="primary" onClick={() => setProgressVisible(false)}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
                Done
              </Button>
            )}
          </Space>
        }
        width={700}
        destroyOnClose
      >
        {/* Overall progress */}
        <div style={{ marginBottom: 16 }}>
          <Row justify="space-between" style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 13 }}>{progressRunning ? 'Processing…' : 'Complete'}</Text>
            <Space>
              {successCount > 0 && <Tag color="green">{successCount} succeeded</Tag>}
              {errorCount   > 0 && <Tag color="red">{errorCount} errors</Tag>}
              <Text type="secondary" style={{ fontSize: 12 }}>{doneCount} / {totalCount}</Text>
            </Space>
          </Row>
          <Progress
            percent={totalCount ? Math.round(doneCount / totalCount * 100) : 0}
            strokeColor={errorCount > 0 ? REDWOOD.error : REDWOOD.success}
            status={progressRunning ? 'active' : errorCount > 0 ? 'exception' : 'success'}
          />
        </div>

        {/* Per-record rows */}
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {progressRows.map(row => (
            <div key={row.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '8px 10px', marginBottom: 4, borderRadius: 6,
              background: row.status === 'success' ? '#f6ffed' : row.status === 'error' ? '#fff2f0' : row.status === 'running' ? '#e6f4ff' : '#fafafa',
              border: `1px solid ${row.status === 'success' ? '#b7eb8f' : row.status === 'error' ? '#ffccc7' : row.status === 'running' ? '#91d5ff' : '#f0f0f0'}`,
            }}>
              <div style={{ marginTop: 2, fontSize: 16 }}>
                {row.status === 'success'  && <CheckCircleOutlined style={{ color: REDWOOD.success }} />}
                {row.status === 'error'    && <CloseCircleOutlined style={{ color: REDWOOD.error }} />}
                {row.status === 'running'  && <SyncOutlined spin style={{ color: REDWOOD.info }} />}
                {row.status === 'skipped'  && <InfoCircleOutlined style={{ color: REDWOOD.neutral400 }} />}
                {row.status === 'pending'  && <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#d9d9d9', marginTop: 2 }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 12 }}>{row.label}</Text>
                {row.message && <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{row.message}</Text>}
                {row.headerId && <Text style={{ fontSize: 10, color: REDWOOD.info }}>SLA Header ID: {row.headerId}</Text>}
              </div>
              <Tag style={{ fontSize: 10, flexShrink: 0 }}
                color={row.status === 'success' ? 'green' : row.status === 'error' ? 'red' : row.status === 'running' ? 'processing' : 'default'}>
                {row.status.toUpperCase()}
              </Tag>
            </div>
          ))}
        </div>
      </Modal>

      {/* ── View Accounting Modal ──────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: REDWOOD.taskBlue }} />
            <span>Accounting Entries — {viewAcctLabel}</span>
          </Space>
        }
        open={viewAcctVisible}
        onCancel={() => setViewAcctVisible(false)}
        footer={<Button onClick={() => setViewAcctVisible(false)}>Close</Button>}
        width={820}
        destroyOnClose
      >
        {viewAcctLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 28, color: REDWOOD.taskBlue }} spin />} />
            <div style={{ marginTop: 12 }}><Text type="secondary">Loading accounting entries…</Text></div>
          </div>
        ) : viewAcctHeader || viewAcctLines.length > 0 ? (
          <>
            {viewAcctHeader && (
              <Descriptions size="small" bordered column={3} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="SLA Header ID">{viewAcctHeader.headerId ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Tag color={STATUS_COLOR[viewAcctHeader.accountingStatus] ?? 'default'}>{STATUS_LABEL[viewAcctHeader.accountingStatus] ?? viewAcctHeader.accountingStatus}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Period">{viewAcctHeader.periodName ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Ledger">{viewAcctHeader.ledgerName ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Event Type">{viewAcctHeader.eventTypeCode ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Accounting Date">{viewAcctHeader.accountingDate ?? '—'}</Descriptions.Item>
                {viewAcctHeader.glBatchName && (
                  <Descriptions.Item label="GL Batch" span={3}>
                    <Text code style={{ fontSize: 11 }}>{viewAcctHeader.glBatchName}</Text>
                    {viewAcctHeader.glHeaderId && <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>Header ID: {viewAcctHeader.glHeaderId}</Text>}
                  </Descriptions.Item>
                )}
              </Descriptions>
            )}
            <Table
              dataSource={viewAcctLines.map((l: any, i: number) => ({ ...l, key: l.lineId ?? l.lineNumber ?? i }))}
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
              summary={(data) => {
                const totDr = data.reduce((s, l) => s + Number(l.enteredDr ?? l.entered_dr ?? 0), 0);
                const totCr = data.reduce((s, l) => s + Number(l.enteredCr ?? l.entered_cr ?? 0), 0);
                return (
                  <Table.Summary.Row style={{ background: '#f5f5f5', fontWeight: 700 }}>
                    <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><Text strong style={{ color: REDWOOD.info }}>{fmt(totDr)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: REDWOOD.error }}>{fmt(totCr)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={5}>
                      {Math.abs(totDr - totCr) < 0.01 ? <Tag color="green" style={{ fontSize: 10 }}>Balanced</Tag> : <Tag color="red" style={{ fontSize: 10 }}>Out of balance by {fmt(Math.abs(totDr - totCr))}</Tag>}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
              columns={[
                { title: '#', dataIndex: 'lineNumber', width: 40, render: (v: any) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                {
                  title: 'Type', dataIndex: 'lineType', width: 50,
                  render: (v: string) => <Tag color={v === 'DR' ? 'blue' : 'red'} style={{ fontSize: 10, minWidth: 28, textAlign: 'center' }}>{v}</Tag>,
                },
                { title: 'Account', dataIndex: 'accountCombination', ellipsis: true, render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
                { title: 'Debit', dataIndex: 'enteredDr', width: 110, align: 'right' as const, render: (v: any) => <Text style={{ fontSize: 11, color: REDWOOD.info }}>{Number(v ?? 0) ? fmt(Number(v)) : '—'}</Text> },
                { title: 'Credit', dataIndex: 'enteredCr', width: 110, align: 'right' as const, render: (v: any) => <Text style={{ fontSize: 11, color: REDWOOD.error }}>{Number(v ?? 0) ? fmt(Number(v)) : '—'}</Text> },
                { title: 'Description', dataIndex: 'description', ellipsis: true, render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> },
              ]}
            />
          </>
        ) : (
          <Empty description="No accounting entries found for this transaction." image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
        )}
      </Modal>

      {/* ── API Log Modal ─────────────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.taskBlue }} />
            <span>API Request Log</span>
            <Tag>{apiLogs.length} calls</Tag>
          </Space>
        }
        open={apiLogVisible}
        onCancel={() => setApiLogVisible(false)}
        footer={
          <Space>
            <Button size="small" danger onClick={() => setApiLogs([])}>Clear Log</Button>
            <Button onClick={() => setApiLogVisible(false)}>Close</Button>
          </Space>
        }
        width={780}
        destroyOnClose={false}
      >
        {apiLogs.length === 0 ? (
          <Empty description="No API calls recorded yet. Run a search first." image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
        ) : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {apiLogs.map((log, i) => (
              <div key={i} style={{
                marginBottom: 8, padding: '8px 10px', borderRadius: 6,
                background: log.status === 200 ? '#f6ffed' : typeof log.status === 'string' || log.status >= 400 ? '#fff2f0' : '#e6f4ff',
                border: `1px solid ${log.status === 200 ? '#b7eb8f' : typeof log.status === 'string' || log.status >= 400 ? '#ffccc7' : '#91d5ff'}`,
              }}>
                <Row justify="space-between" align="middle" style={{ marginBottom: 4 }}>
                  <Space size={6}>
                    <Tag color={log.method === 'GET' ? 'blue' : 'purple'} style={{ fontSize: 10 }}>{log.method}</Tag>
                    <Tag color={log.status === 200 ? 'green' : typeof log.status === 'string' ? 'red' : log.status >= 400 ? 'red' : 'orange'} style={{ fontSize: 10 }}>{log.status}</Tag>
                    <Text type="secondary" style={{ fontSize: 10 }}>{log.ts}</Text>
                  </Space>
                </Row>
                <Text code style={{ fontSize: 10, display: 'block', wordBreak: 'break-all', marginBottom: log.response ? 4 : 0 }}>
                  {log.url}
                </Text>
                {log.body && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, cursor: 'pointer', color: REDWOOD.neutral600 }}>Request body</summary>
                    <pre style={{ fontSize: 10, margin: '4px 0 0', background: '#f5f5f5', padding: 6, borderRadius: 4, maxHeight: 100, overflow: 'auto' }}>{log.body}</pre>
                  </details>
                )}
                {log.response && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, cursor: 'pointer', color: REDWOOD.neutral600 }}>Response preview</summary>
                    <pre style={{ fontSize: 10, margin: '4px 0 0', background: '#f5f5f5', padding: 6, borderRadius: 4, maxHeight: 100, overflow: 'auto' }}>{log.response}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default CreateAccounting;
