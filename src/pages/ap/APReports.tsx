import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Layout, Typography, Card, Breadcrumb, Space, Tabs,
  Form, Select, Input, Button, Table, Tag, Spin,
  Tooltip, message, Empty, Modal,
} from 'antd';
import {
  HomeOutlined, BarChartOutlined, DollarOutlined,
  ClockCircleOutlined, PlayCircleOutlined, FileExcelOutlined,
  FilePdfOutlined, TeamOutlined, SearchOutlined,
  ApiOutlined, CopyOutlined, FileTextOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, BookOutlined, LockOutlined,
  ZoomInOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5',
  neutral300: '#C7C7C7', neutral600: '#6B6B6B', neutral900: '#1A1A1A',
  surface: '#FFFFFF', reportGreen: '#1D7B4D',
};

// ─── Payables to Ledger Reconciliation result ─────────────────────────────────
interface ReconResult {
  period: string; period_start: string; period_end: string; currency: string;
  payables_begin: number; payables_invoices: number; payables_payments: number;
  payables_prepay: number; payables_end: number;
  gl_opening: number; gl_closing: number;
  gl_ap_invoices: number; gl_ap_payments: number;
  gl_non_ap_journals: number; gl_not_transferred: number;
  gl_not_posted: number; payables_variance: number; accounting_variance: number;
}

// ─── Report definitions ───────────────────────────────────────────────────────
interface ReportDef {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  hasSupplierFilter: boolean;
  hasDateFilter: boolean;
  hasAgingDate?: boolean;
  hasPeriodFilter?: boolean;
  hasCompanyFilter?: boolean;
  hasAccountFilter?: boolean;
}

const REPORTS: ReportDef[] = [
  {
    key: 'suppliers-listing',
    label: 'Suppliers Listing',
    description: 'List of registered suppliers with status and tax info',
    icon: <TeamOutlined />,
    color: REDWOOD.info,
    hasSupplierFilter: true,
    hasDateFilter: false,
  },
  {
    key: 'supplier-balance',
    label: 'Supplier Balance Report',
    description: 'Outstanding invoice balances summarised by supplier',
    icon: <BarChartOutlined />,
    color: REDWOOD.success,
    hasSupplierFilter: true,
    hasDateFilter: false,
  },
  {
    key: 'payment-register',
    label: 'Payment Register',
    description: 'All payments made within the selected period',
    icon: <DollarOutlined />,
    color: REDWOOD.primary,
    hasSupplierFilter: true,
    hasDateFilter: true,
  },
  {
    key: 'aging-report',
    label: 'Supplier Balance Aging Report',
    description: 'Outstanding payables aged by overdue period per supplier — click a row to drill down to invoices',
    icon: <ClockCircleOutlined />,
    color: REDWOOD.warning,
    hasSupplierFilter: true,
    hasDateFilter: false,
    hasAgingDate: true,
  },
  {
    key: 'aging-by-invoice',
    label: 'Supplier Aging by Invoice',
    description: 'Outstanding payables aged by overdue period, one row per invoice',
    icon: <FileTextOutlined />,
    color: '#7B5EA7',
    hasSupplierFilter: true,
    hasDateFilter: false,
    hasAgingDate: true,
  },
  {
    key: 'payables-ledger-recon',
    label: 'Payables to Ledger Reconciliation',
    description: 'Reconciles AP subledger begin/end balances and period activity against the selected GL account',
    icon: <BookOutlined />,
    color: '#5B6AF5',
    hasSupplierFilter: false,
    hasDateFilter: false,
    hasPeriodFilter: true,
    hasCompanyFilter: true,
    hasAccountFilter: true,
  },
];

// ─── Drill-down invoice columns (shown when expanding an aging-report row) ────
const AGING_DRILL_COLUMNS = [
  { title: 'Invoice #',      dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 150 },
  { title: 'Invoice Date',   dataIndex: 'invoiceDate',   key: 'invoiceDate',   width: 110 },
  { title: 'Due Date',       dataIndex: 'dueDate',       key: 'dueDate',       width: 110 },
  { title: 'Invoice Amount', dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 140, align: 'right' as const,
    render: (v: number) => <Text>{fmt(v)}</Text> },
  { title: 'Amount Paid',    dataIndex: 'amountPaid',    key: 'amountPaid',    width: 120, align: 'right' as const,
    render: (v: number) => <Text style={{ color: REDWOOD.success }}>{fmt(v)}</Text> },
  { title: 'Unpaid Amount',  dataIndex: 'unpaidAmount',  key: 'unpaidAmount',  width: 130, align: 'right' as const,
    render: (v: number) => <Text strong style={{ color: v > 0 ? REDWOOD.primary : undefined }}>{fmt(v)}</Text> },
  { title: '1 Month Overdue',    dataIndex: 'months1',    key: 'months1',    width: 120, align: 'right' as const,
    render: (v: number) => <Text style={{ color: v > 0 ? REDWOOD.warning : undefined }}>{fmt(v)}</Text> },
  { title: '2 Months Overdue',   dataIndex: 'months2',    key: 'months2',    width: 130, align: 'right' as const,
    render: (v: number) => <Text style={{ color: v > 0 ? '#D46B08' : undefined }}>{fmt(v)}</Text> },
  { title: '3 Months Overdue',   dataIndex: 'months3',    key: 'months3',    width: 130, align: 'right' as const,
    render: (v: number) => <Text style={{ color: v > 0 ? REDWOOD.primary : undefined }}>{fmt(v)}</Text> },
  { title: 'Over 3 Months',      dataIndex: 'over3months', key: 'over3months', width: 130, align: 'right' as const,
    render: (v: number) => <Text strong style={{ color: v > 0 ? '#8B0000' : undefined }}>{fmt(v)}</Text> },
  { title: 'Current (Not Due)',  dataIndex: 'unallocated', key: 'unallocated', width: 130, align: 'right' as const,
    render: (v: number) => <Text style={{ color: v > 0 ? REDWOOD.neutral600 : undefined }}>{fmt(v)}</Text> },
];

// ─── Column definitions per report ───────────────────────────────────────────
const COLUMNS: Record<string, any[]> = {
  'suppliers-listing': [
    { title: 'Supplier Number', dataIndex: 'supplierNumber', key: 'supplierNumber', width: 140 },
    { title: 'Supplier Name',   dataIndex: 'supplier',       key: 'supplier',       width: 220 },
    { title: 'Type',            dataIndex: 'supplierType',   key: 'supplierType',   width: 120 },
    { title: 'Status',          dataIndex: 'status',         key: 'status',         width: 90,
      render: (s: string) => <Tag color={s === 'Active' ? 'green' : 'default'}>{s || 'Active'}</Tag> },
    { title: 'Taxpayer ID',     dataIndex: 'taxpayerId',     key: 'taxpayerId',     width: 130 },
    { title: 'Tax Reg #',       dataIndex: 'taxRegistrationNumber', key: 'taxReg',  width: 140 },
    { title: 'Creation Date',   dataIndex: 'creationDate',   key: 'creationDate',   width: 120 },
  ],
  'supplier-balance': [
    { title: 'Supplier #',      dataIndex: 'supplierNumber', key: 'supplierNumber', width: 120 },
    { title: 'Supplier Name',   dataIndex: 'supplier',       key: 'supplier',       width: 220 },
    { title: 'Invoices',        dataIndex: 'invoiceCount',   key: 'invoiceCount',   width: 80,  align: 'right' as const },
    { title: 'Invoice Amount',  dataIndex: 'invoiceAmount',  key: 'invoiceAmount',  width: 140, align: 'right' as const,
      render: (v: number) => <Text strong>{fmt(v)}</Text> },
    { title: 'Amount Paid',     dataIndex: 'amountPaid',     key: 'amountPaid',     width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: REDWOOD.success }}>{fmt(v)}</Text> },
    { title: 'Outstanding',     dataIndex: 'outstanding',    key: 'outstanding',    width: 130, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: v > 0 ? REDWOOD.primary : REDWOOD.success }}>{fmt(v)}</Text> },
    { title: 'Currency',        dataIndex: 'currency',       key: 'currency',       width: 80 },
  ],
  'payment-register': [
    { title: 'Payment #',        dataIndex: 'paymentNumber',   key: 'paymentNumber',  width: 140 },
    { title: 'Date',             dataIndex: 'paymentDate',     key: 'paymentDate',    width: 110 },
    { title: 'Supplier',         dataIndex: 'payee',           key: 'payee',          width: 200 },
    { title: 'Amount',           dataIndex: 'paymentAmount',   key: 'paymentAmount',  width: 130, align: 'right' as const,
      render: (v: number) => <Text strong>{fmt(v)}</Text> },
    { title: 'Currency',         dataIndex: 'currency',        key: 'currency',       width: 80 },
    { title: 'Status',           dataIndex: 'paymentStatus',   key: 'paymentStatus',  width: 110,
      render: (s: string) => <Tag color={s === 'NEGOTIABLE' ? 'green' : s === 'VOIDED' ? 'red' : 'blue'}>{s}</Tag> },
    { title: 'Method',           dataIndex: 'paymentMethod',   key: 'paymentMethod',  width: 110 },
    { title: 'Bank Account',     dataIndex: 'bankAccountName', key: 'bankAccountName', ellipsis: true },
  ],
  'aging-report': [
    { title: 'Supplier',          dataIndex: 'supplier',       key: 'supplier',       width: 220 },
    { title: 'Invoice Amount',    dataIndex: 'invoiceAmount',  key: 'invoiceAmount',  width: 140, align: 'right' as const,
      render: (v: number) => <Text>{fmt(v)}</Text> },
    { title: 'Unpaid Amount',     dataIndex: 'unpaidAmount',   key: 'unpaidAmount',   width: 140, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: v < 0 ? REDWOOD.warning : undefined }}>{fmt(v)}{v < 0 ? <span style={{ fontSize: 10, marginLeft: 4 }}>(credit)</span> : null}</Text> },
    { title: '1 Month Overdue',   dataIndex: 'months1',        key: 'months1',        width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? REDWOOD.warning : undefined }}>{fmt(v)}</Text> },
    { title: '2 Months Overdue',  dataIndex: 'months2',        key: 'months2',        width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? '#D46B08' : undefined }}>{fmt(v)}</Text> },
    { title: '3 Months Overdue',  dataIndex: 'months3',        key: 'months3',        width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? REDWOOD.primary : undefined }}>{fmt(v)}</Text> },
    { title: 'Over 3 Months Overdue', dataIndex: 'over3months', key: 'over3months',   width: 150, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? '#8B0000' : undefined }}>{fmt(v)}</Text> },
    { title: 'Current (Not Due)', dataIndex: 'unallocated',   key: 'unallocated',    width: 140, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? REDWOOD.neutral600 : undefined }}>{fmt(v)}</Text> },
  ],
  'aging-by-invoice': [
    { title: 'Supplier',          dataIndex: 'supplier',       key: 'supplier',       width: 200 },
    { title: 'Invoice #',         dataIndex: 'invoiceNumber',  key: 'invoiceNumber',  width: 150 },
    { title: 'Invoice Date',      dataIndex: 'invoiceDate',    key: 'invoiceDate',    width: 110 },
    { title: 'Due Date',          dataIndex: 'dueDate',        key: 'dueDate',        width: 110 },
    { title: 'Invoice Amount',    dataIndex: 'invoiceAmount',  key: 'invoiceAmount',  width: 140, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : undefined }}>{fmt(v)}{v < 0 ? <span style={{ fontSize: 10, marginLeft: 4 }}>(CN)</span> : null}</Text> },
    { title: 'Open Balance',      dataIndex: 'unpaidAmount',   key: 'unpaidAmount',   width: 130, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: v < 0 ? REDWOOD.warning : undefined }}>{fmt(v)}{v < 0 ? <span style={{ fontSize: 10, marginLeft: 4 }}>(credit)</span> : null}</Text> },
    { title: '1 Month Overdue',   dataIndex: 'months1',        key: 'months1',        width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? REDWOOD.warning : undefined }}>{fmt(v)}</Text> },
    { title: '2 Months Overdue',  dataIndex: 'months2',        key: 'months2',        width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? '#D46B08' : undefined }}>{fmt(v)}</Text> },
    { title: '3 Months Overdue',  dataIndex: 'months3',        key: 'months3',        width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? REDWOOD.primary : undefined }}>{fmt(v)}</Text> },
    { title: 'Over 3 Months Overdue', dataIndex: 'over3months', key: 'over3months',   width: 150, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? '#8B0000' : undefined }}>{fmt(v)}</Text> },
    { title: 'Current (Not Due)', dataIndex: 'unallocated',   key: 'unallocated',    width: 140, align: 'right' as const,
      render: (v: number) => <Text style={{ color: v < 0 ? REDWOOD.warning : v > 0 ? REDWOOD.neutral600 : undefined }}>{fmt(v)}</Text> },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: number) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Categorise an outstanding balance into aging buckets based on days overdue
const agingBuckets = (age: number, bal: number) => ({
  months1:    age >= 1  && age <= 30  ? bal : 0,
  months2:    age >= 31 && age <= 60  ? bal : 0,
  months3:    age >= 61 && age <= 90  ? bal : 0,
  over3months: age > 90               ? bal : 0,
  unallocated: age <= 0               ? bal : 0,
});

// ─── Per-tab report panel (fully isolated state) ──────────────────────────────
// ─── Account Picker Modal ─────────────────────────────────────────────────────
const AccountPickerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (account: string, description: string) => void;
  options: { account: string; description: string }[];
  loading: boolean;
}> = ({ open, onClose, onSelect, options, loading }) => {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return q ? options.filter(o => o.account.toLowerCase().includes(lq) || o.description.toLowerCase().includes(lq)) : options;
  }, [options, q]);
  const close = () => { onClose(); setQ(''); };
  return (
    <Modal open={open} onCancel={close} footer={null}
      title={<Space><SearchOutlined style={{ color: '#0572CE' }} />Select Account</Space>} width={620}>
      <Input prefix={<SearchOutlined />} placeholder="Search code or description…"
        allowClear size="small" value={q} onChange={e => setQ(e.target.value)}
        style={{ marginBottom: 8 }} autoFocus />
      <div onClick={() => { onSelect('', ''); close(); }}
        style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid #E5E5E5',
          background: '#fafafa', fontSize: 12, color: '#6B6B6B' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#e6f4ff')}
        onMouseLeave={e => (e.currentTarget.style.background = '#fafafa')}>
        — All Accounts —
      </div>
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {loading && <div style={{ padding: 24, textAlign: 'center' }}><Spin size="small" /></div>}
        {!loading && filtered.map(o => (
          <div key={o.account} onClick={() => { onSelect(o.account, o.description); close(); }}
            style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid #E5E5E5',
              display: 'flex', gap: 10, alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#e6f4ff')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}>
            <Text code style={{ fontSize: 11, minWidth: 130 }}>{o.account}</Text>
            <Text style={{ fontSize: 12, flex: 1 }}>{o.description}</Text>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#6B6B6B' }}>No accounts found</div>
        )}
      </div>
    </Modal>
  );
};

const ReportPanel: React.FC<{ report: ReportDef; businessUnits: { name: string; company: string }[] }> = ({ report, businessUnits }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [gridSearch, setGridSearch] = useState('');
  const reportTitle = useRef('');
  const [apiUrls, setApiUrls] = useState<string[]>([]);
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [reconData, setReconData] = useState<ReconResult | null>(null);
  const [periodOptions, setPeriodOptions] = useState<string[]>([]);

  // ── Payables-ledger-recon specific state ──────────────────────────────────
  const [allPeriods, setAllPeriods]         = useState<{ period_name_id: string; period_year: number; period_number: number }[]>([]);
  const [calPeriodsLoading, setCalPeriodsLoading] = useState(false);
  const [selectedYear, setSelectedYear]     = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [company, setCompany]               = useState('');
  const [companyLocked, setCompanyLocked]   = useState(false);
  const [accountOptions, setAccountOptions] = useState<{ account: string; description: string }[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedAccountDesc, setSelectedAccountDesc] = useState('');

  // ── Drill-down state ───────────────────────────────────────────────────────
  const [drillOpen, setDrillOpen]       = useState(false);
  const [drillTitle, setDrillTitle]     = useState('');
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillRows, setDrillRows]       = useState<any[]>([]);
  const [drillCols, setDrillCols]       = useState<any[]>([]);
  const reconParamsRef = useRef<{ bu: string; company: string; account: string; period: string }>({ bu: '', company: '', account: '', period: '' });

  useEffect(() => {
    if (!report.hasPeriodFilter) return;
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/fiscalperiods`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const items: any[] = Array.isArray(data) ? data : (data.items || []);
        const names = items
          .map((i: any) => i.period_name || i.PERIOD_NAME || '')
          .filter(Boolean);
        setPeriodOptions([...new Set(names)] as string[]);
      }).catch(() => {});
  }, [report.hasPeriodFilter]);

  // Load calendar periods (year+period LOV) for payables-ledger-recon
  useEffect(() => {
    if (report.key !== 'payables-ledger-recon') return;
    setCalPeriodsLoading(true);
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/getledgername`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const ledgers: string[] = (data.items || []).map((i: any) => i.ledger_name).filter(Boolean);
        if (!ledgers.length) return;
        return fetch(`${APEX_DB_CONFIG.baseUrl}/periodsstatus/create?ledger_name=${encodeURIComponent(ledgers[0])}`)
          .then(r => r.ok ? r.json() : null)
          .then(pd => {
            if (!pd) return;
            const items = (pd.items || [])
              .filter((i: any) => i.period_year && (i.period_name_id || i.period_name))
              .map((i: any) => ({
                period_name_id: String(i.period_name_id || i.period_name),
                period_year: Number(i.period_year),
                period_number: Number(i.period_number || 0),
              }));
            setAllPeriods(items);
            if (!items.length) return;
            const latestYear = Math.max(...items.map((p: any) => p.period_year));
            setSelectedYear(latestYear);
            const inYear = items.filter((p: any) => p.period_year === latestYear)
              .sort((a: any, b: any) => b.period_number - a.period_number);
            if (inYear.length) setSelectedPeriod(inYear[0].period_name_id);
          });
      })
      .catch(() => {})
      .finally(() => setCalPeriodsLoading(false));
  }, [report.key]);

  // Load account LOV for payables-ledger-recon
  useEffect(() => {
    if (report.key !== 'payables-ledger-recon') return;
    setAccountsLoading(true);
    fetch(`${APEX_DB_CONFIG.baseUrl}/glaccountslist`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setAccountOptions(
          (data.items || [])
            .map((i: any) => ({
              account: String(i.account || i.ACCOUNT || ''),
              description: String(i.description || i.DESCRIPTION || ''),
            }))
            .filter((i: any) => i.account)
        );
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
  }, [report.key]);

  const calYears = useMemo(
    () => [...new Set(allPeriods.map(p => p.period_year))].sort((a, b) => b - a),
    [allPeriods],
  );
  const periodsForYear = useMemo(() => {
    if (!selectedYear) return [];
    return allPeriods
      .filter(p => p.period_year === selectedYear)
      .sort((a, b) => a.period_number - b.period_number);
  }, [allPeriods, selectedYear]);

  // Auto-select latest period when year changes
  useEffect(() => {
    if (periodsForYear.length) {
      setSelectedPeriod(periodsForYear[periodsForYear.length - 1].period_name_id);
    }
  }, [periodsForYear]);

  // BU → company auto-populate via onValuesChange
  const handleFormValuesChange = useCallback((changedValues: any) => {
    if ('businessUnit' in changedValues) {
      const buName: string | undefined = changedValues.businessUnit;
      if (!buName) { setCompany(''); setCompanyLocked(false); return; }
      const bu = businessUnits.find(b => b.name === buName);
      if (bu?.company) { setCompany(bu.company); setCompanyLocked(true); }
      else { setCompany(''); setCompanyLocked(false); }
    }
  }, [businessUnits]);

  const filteredRows = useMemo(() => {
    if (!gridSearch.trim()) return rows;
    const q = gridSearch.toLowerCase();
    return rows.filter(r =>
      Object.values(r).some(v => typeof v !== 'object' && String(v ?? '').toLowerCase().includes(q))
    );
  }, [rows, gridSearch]);

  const fetchSuppliersListing = async (bu: string, supplierNum: string, supplierName: string) => {
    const p = new URLSearchParams();
    if (bu)           p.set('P_BUSINESS_UNIT', bu);
    if (supplierNum)  p.set('supplier_number', supplierNum);
    if (supplierName) p.set('supplier', supplierName);
    const url = `${APEX_DB_CONFIG.baseUrl}/suppliers${p.toString() ? '?' + p : ''}`;
    setApiUrls([url]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(await res.text() || '{}');
    const items: any[] = Array.isArray(data) ? data : (data.items || []);
    return items.map((it: any, i: number) => ({
      key: it.supplier_id?.toString() || i.toString(),
      supplierNumber: it.supplier_number || '',
      supplier: it.supplier || '',
      supplierType: it.supplier_type || '',
      status: it.status || 'Active',
      taxpayerId: it.taxpayer_id || '',
      taxRegistrationNumber: it.tax_registration_number || '',
      creationDate: it.creation_date ? it.creation_date.slice(0, 10) : '',
    }));
  };

  const fetchSupplierBalance = async (bu: string, supplierNum: string) => {
    // Use the dedicated outstanding-by-supplier endpoint — single call, server-computes
    // outstanding_amount as SUM(GREATEST(0, invoice_amount - payments - prepayments))
    // per unpaid invoice, grouped by supplier. Much more accurate and efficient than
    // fetching invoices per supplier and computing on the frontend.
    const p = new URLSearchParams();
    if (bu)          p.set('P_BUSINESS_UNIT', bu);
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/outstanding-by-supplier${p.toString() ? '?' + p : ''}`;
    setApiUrls([url]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(await res.text() || '{}');
    const items: any[] = Array.isArray(data) ? data : (data.items || []);

    // Optional client-side filter by supplier number if specified
    const filtered = supplierNum
      ? items.filter(it => String(it.supplier_number || '').toLowerCase().includes(supplierNum.toLowerCase()))
      : items;

    return filtered.map((it: any) => ({
      key:           it.supplier_number || '',
      supplierNumber: it.supplier_number || '',
      supplier:      it.supplier_name   || it.supplier_number || '',
      invoiceCount:  Number(it.invoice_count       || 0),
      invoiceAmount: Number(it.total_invoice_amount || 0),
      amountPaid:    Number(it.total_paid           || 0),
      outstanding:   Number(it.outstanding_amount   || 0),
      currency:      'AED',
    }));
  };

  const fetchPaymentRegister = async (bu: string, supplierNum: string, dateFrom: string, dateTo: string) => {
    const p = new URLSearchParams();
    if (bu)          p.set('business_unit', bu);
    if (supplierNum) p.set('supplier_number', supplierNum);
    if (dateFrom)    p.set('date_from', dateFrom);
    if (dateTo)      p.set('date_to', dateTo);
    p.set('limit', '500');
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/payments?${p}`;
    setApiUrls([url]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(await res.text() || '{}');
    const items: any[] = Array.isArray(data) ? data : (data.items || data.payments || []);
    return items.map((it: any, i: number) => ({
      key: it.payment_id?.toString() || i.toString(),
      paymentNumber: it.payment_number || it.check_number || '',
      paymentDate: (it.payment_date || it.check_date || '').slice(0, 10),
      payee: it.payee || it.supplier || '',
      paymentAmount: Number(it.payment_amount || it.amount || 0),
      currency: it.currency || it.payment_currency || 'AED',
      paymentStatus: it.payment_status || it.status || '',
      paymentMethod: it.payment_method || '',
      bankAccountName: it.bank_account_name || '',
    }));
  };

  // Build per-invoice aging row (shared by both aging reports)
  const buildInvoiceAgingRow = (inv: any, supplierName: string, asAt: Date, idx: number) => {
    // Age from due_date (payment terms date), falling back to invoice_date.
    // Using invoice_date causes wrong buckets: a fresh invoice with 30-day terms
    // would show as "1 Month Overdue" when it hasn't even passed its due date.
    const ageDate = new Date(inv.due_date || inv.terms_date || inv.invoice_date || '');
    if (isNaN(ageDate.getTime())) return null;
    const invAmt   = Number(inv.invoice_amount || 0);
    const paid     = Number(inv.amount_paid || 0);
    const bal      = Number(inv.amount_remaining ?? (invAmt - paid));
    if (bal === 0) return null;  // skip fully-settled; credit notes (bal < 0) pass through
    const age  = Math.floor((asAt.getTime() - ageDate.getTime()) / 86400000);
    const bkts = agingBuckets(age, bal);
    return {
      key:           `${inv.invoice_number || idx}-${idx}`,
      supplier:      supplierName,
      invoiceNumber: inv.invoice_number || inv.invoice_num || '',
      invoiceDate:   (inv.invoice_date || '').slice(0, 10),
      dueDate:       (inv.due_date || inv.terms_date || '').slice(0, 10),
      invoiceAmount: invAmt,
      amountPaid:    paid,
      unpaidAmount:  bal,
      ...bkts,
    };
  };

  // Shared helper: fetch all outstanding invoices from the single aging-data endpoint
  // (reads RR_AP_INVOICES_ALL directly — not gated by RR_SUPPLIER_MASTER, so suppliers
  //  missing from the master still appear in the aging)
  const fetchAgingInvoices = async (bu: string, supplierNum: string): Promise<any[]> => {
    const p = new URLSearchParams();
    if (bu)          p.set('P_BUSINESS_UNIT', bu);
    if (supplierNum) p.set('supplier_number',  supplierNum);
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/invoices/aging-data${p.toString() ? '?' + p : ''}`;
    setApiUrls([url]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(await res.text() || '{}');
    return Array.isArray(data) ? data : (data.items || []);
  };

  const fetchAgingReport = async (bu: string, supplierNum: string, asAtDate: string) => {
    const asAt = asAtDate ? new Date(asAtDate) : new Date();
    asAt.setHours(0, 0, 0, 0);

    const allInvoices = await fetchAgingInvoices(bu, supplierNum);

    // Group invoices by supplier
    const supplierMap = new Map<string, any>();
    allInvoices.forEach((inv: any, i: number) => {
      const sn    = inv.supplier_number || '';
      const sName = inv.supplier_name   || sn;
      // Age from due_date; fall back to invoice_date only if no due date
      const ageDate = new Date(inv.due_date || inv.invoice_date || '');
      if (!sn || isNaN(ageDate.getTime())) return;

      const invAmt = Number(inv.invoice_amount  || 0);
      const paid   = Number(inv.amount_paid     || 0);
      const bal    = Number(inv.amount_remaining ?? (invAmt - paid));
      if (bal === 0) return;  // skip fully-settled; credit notes (bal < 0) pass through

      const age  = Math.floor((asAt.getTime() - ageDate.getTime()) / 86400000);
      const bkts = agingBuckets(age, bal);

      if (!supplierMap.has(sn)) {
        supplierMap.set(sn, {
          key: sn, supplierNumber: sn, supplier: sName,
          invoiceAmount: 0, unpaidAmount: 0,
          months1: 0, months2: 0, months3: 0, over3months: 0, unallocated: 0,
          _invoices: [] as any[],
        });
      }
      const row = supplierMap.get(sn)!;
      row.invoiceAmount += invAmt;
      row.unpaidAmount  += bal;
      row.months1       += bkts.months1;
      row.months2       += bkts.months2;
      row.months3       += bkts.months3;
      row.over3months   += bkts.over3months;
      row.unallocated   += bkts.unallocated;
      row._invoices.push({
        key:           `${sn}-${i}`,
        supplier:      sName,
        invoiceNumber: inv.invoice_number || '',
        invoiceDate:   (inv.invoice_date  || '').slice(0, 10),
        dueDate:       (inv.due_date      || '').slice(0, 10),
        invoiceAmount: invAmt,
        amountPaid:    paid,
        unpaidAmount:  bal,
        ...bkts,
      });
    });

    return [...supplierMap.values()]
      .filter(r => r.unpaidAmount !== 0)
      .sort((a, b) => b.unpaidAmount - a.unpaidAmount);
  };

  const fetchAgingByInvoice = async (bu: string, supplierNum: string, asAtDate: string) => {
    const asAt = asAtDate ? new Date(asAtDate) : new Date();
    asAt.setHours(0, 0, 0, 0);

    const allInvoices = await fetchAgingInvoices(bu, supplierNum);

    return allInvoices
      .map((inv: any, i: number) => buildInvoiceAgingRow(inv, inv.supplier_name || inv.supplier_number || '', asAt, i))
      .filter(Boolean)
      .sort((a: any, b: any) => b.unpaidAmount - a.unpaidAmount);
  };

  const fetchPayablesLedgerRecon = async (bu: string, company: string, account: string, period: string) => {
    const p = new URLSearchParams();
    if (bu)      p.set('P_BUSINESS_UNIT', bu);
    if (company) p.set('P_COMPANY', company);
    if (account) p.set('P_ACCOUNT', account);
    if (period)  p.set('P_PERIOD', period);
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/reports/payables-ledger-recon?${p}`;
    setApiUrls([url]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data as ReconResult;
  };

  const fetchDrilldown = useCallback(async (title: string, endpoint: string, extraParams: Record<string, string> = {}) => {
    const p = reconParamsRef.current;
    const qs = new URLSearchParams();
    if (p.period)  qs.set('P_PERIOD', p.period);
    if (p.bu)      qs.set('P_BUSINESS_UNIT', p.bu);
    if (p.company) qs.set('P_COMPANY', p.company);
    if (p.account) qs.set('P_ACCOUNT', p.account);
    Object.entries(extraParams).forEach(([k, v]) => qs.set(k, v));
    const url = `${APEX_DB_CONFIG.baseUrl}/aprecon/${endpoint}?${qs}`;
    setDrillTitle(title);
    setDrillOpen(true);
    setDrillLoading(true);
    setDrillRows([]);
    setDrillCols([]);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const items: any[] = data.items || (Array.isArray(data) ? data : []);
      if (!items.length) { setDrillRows([]); return; }
      // Build columns from first row keys
      const cols = Object.keys(items[0]).map(k => ({
        title: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        dataIndex: k,
        key: k,
        ellipsis: true,
        render: (v: any) => {
          if (v === null || v === undefined) return '—';
          if (typeof v === 'number') {
            const abs = Math.abs(v);
            const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return <span style={{ fontFamily: 'monospace', color: v < 0 ? '#C74634' : undefined }}>{v < 0 ? `(${s})` : s}</span>;
          }
          return String(v);
        },
      }));
      setDrillCols(cols);
      setDrillRows(items.map((r, i) => ({ ...r, _key: i })));
    } catch (e: any) {
      message.error(`Drill-down failed: ${e.message}`);
      setDrillOpen(false);
    } finally {
      setDrillLoading(false);
    }
  }, []);

  const handleRun = async () => {
    const { businessUnit: bu = '', supplierNumber: sn = '', supplierName: snm = '', dateFrom = '', dateTo = '', asAtDate = '' } = form.getFieldsValue();
    const period  = report.key === 'payables-ledger-recon' ? selectedPeriod : (form.getFieldValue('period') || '');
    const account = report.key === 'payables-ledger-recon' ? selectedAccount : (form.getFieldValue('account') || '');
    const resolvedCompany = report.key === 'payables-ledger-recon' ? company : (form.getFieldValue('company') || '');
    setLoading(true); setRows([]); setReconData(null); setGridSearch('');
    reportTitle.current = `${report.label}${bu ? ' — ' + bu : ''}${period ? ' — ' + period : ''}${asAtDate ? ' @ ' + asAtDate : ''}`;
    try {
      if (report.key === 'payables-ledger-recon') {
        const result = await fetchPayablesLedgerRecon(bu, resolvedCompany, account, period);
        setReconData(result); setHasRun(true);
        reconParamsRef.current = { bu, company: resolvedCompany, account, period };
        message.success('Reconciliation loaded.');
      } else {
        let result: any[] = [];
        if (report.key === 'suppliers-listing')  result = await fetchSuppliersListing(bu, sn, snm);
        if (report.key === 'supplier-balance')   result = await fetchSupplierBalance(bu, sn);
        if (report.key === 'payment-register')   result = await fetchPaymentRegister(bu, sn, dateFrom, dateTo);
        if (report.key === 'aging-report')       result = await fetchAgingReport(bu, sn, asAtDate);
        if (report.key === 'aging-by-invoice')   result = await fetchAgingByInvoice(bu, sn, asAtDate);
        setRows(result); setHasRun(true);
        result.length === 0 ? message.info('No data found.') : message.success(`${result.length} records loaded.`);
      }
    } catch (e: any) {
      message.error(`Report failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Recon helpers ──────────────────────────────────────────────────────────
  // Show negative numbers in (parentheses), positive as-is
  const fmtRecon = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const abs = Math.abs(v);
    const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v < 0 ? `(${s})` : s;
  };

  // Build the 15 reconciliation rows from a ReconResult
  const buildReconRows = (d: ReconResult) => {
    const diff = (p: number | null, a: number | null) =>
      p !== null && a !== null ? p + a : null;
    return [
      { rowKey: 'acct_begin',    label: 'Accounting Begin Balance',            payables: null,           accounting: d.gl_opening,        difference: null,                                          bold: false },
      { rowKey: 'non_pay_begin', label: '(Non-Payables Begin Balance)',        payables: null,           accounting: d.gl_opening - d.gl_ap_invoices - d.gl_ap_payments + d.gl_non_ap_journals, difference: null, bold: false, italic: true, indent: true },
      { rowKey: 'pay_begin',     label: 'Payables Begin Balance',              payables: d.payables_begin, accounting: d.gl_opening,      difference: diff(d.payables_begin, d.gl_opening),          bold: true },
      { rowKey: 'invoices',      label: 'Invoices',                            payables: d.payables_invoices, accounting: d.gl_ap_invoices, difference: diff(d.payables_invoices, d.gl_ap_invoices), bold: false },
      { rowKey: 'payments',      label: 'Payments',                            payables: d.payables_payments, accounting: d.gl_ap_payments, difference: diff(d.payables_payments, d.gl_ap_payments), bold: false },
      { rowKey: 'prepayments',   label: 'Prepayments',                         payables: d.payables_prepay, accounting: 0,                difference: diff(d.payables_prepay, 0),                    bold: false },
      { rowKey: 'pay_variance',  label: 'Payables Variance',                   payables: d.payables_variance, accounting: d.payables_variance, difference: 0,                                        bold: false, variance: true },
      { rowKey: 'pay_end',       label: 'Payables End Balance',                payables: d.payables_end, accounting: d.gl_closing,        difference: diff(d.payables_end, d.gl_closing),            bold: true },
      { rowKey: 'non_pay_begin2',label: 'Non-Payables Begin Balance',          payables: null,           accounting: d.gl_opening - d.gl_ap_invoices - d.gl_ap_payments + d.gl_non_ap_journals, difference: null, bold: false },
      { rowKey: 'non_pay_jnls',  label: 'Non-Payables Journals',               payables: null,           accounting: d.gl_non_ap_journals, difference: null,                                         bold: false },
      { rowKey: 'other_acct',    label: 'Other Accounting',                    payables: null,           accounting: 0,                   difference: null,                                          bold: false },
      { rowKey: 'not_trans',     label: '(Not Transferred to General Ledger)', payables: null,           accounting: d.gl_not_transferred, difference: null,                                         bold: false, italic: true, indent: true },
      { rowKey: 'not_posted',    label: '(Not Posted in General Ledger)',      payables: null,           accounting: d.gl_not_posted,     difference: null,                                          bold: false, italic: true, indent: true },
      { rowKey: 'acct_variance', label: 'Accounting Variance',                 payables: null,           accounting: d.accounting_variance, difference: null,                                        bold: false, variance: true },
      { rowKey: 'acct_end',      label: 'Accounting End Balance',              payables: null,           accounting: d.gl_closing,        difference: null,                                          bold: true },
    ];
  };

  const renderReconReport = (d: ReconResult) => {
    const reconRows = buildReconRows(d);
    const thStyle: React.CSSProperties = {
      background: '#F0F0F0', color: '#333', fontWeight: 700, fontSize: 12,
      padding: '8px 12px', textAlign: 'right', borderBottom: '2px solid #d0d0d0',
    };
    const thLabelStyle: React.CSSProperties = { ...thStyle, textAlign: 'left', width: '40%' };
    const tdBase: React.CSSProperties = { padding: '6px 12px', fontSize: 12, borderBottom: '1px solid #e8e8e8', fontFamily: 'monospace' };

    // Returns [endpoint, extraParams, title] or null
    const getDrill = (rowKey: string, side: 'payables' | 'accounting'): [string, Record<string,string>, string] | null => {
      if (side === 'payables') {
        if (rowKey === 'pay_begin')  return ['ap-invoices', { P_DATE_FILTER: 'before' }, 'AP Invoices — Before Period (Begin Balance)'];
        if (rowKey === 'invoices')   return ['ap-invoices', { P_DATE_FILTER: 'in' },     'AP Invoices — Period'];
        if (rowKey === 'payments')   return ['ap-payments', {},                           'AP Payments — Period'];
        if (rowKey === 'pay_end')    return ['ap-invoices', { P_DATE_FILTER: 'end' },     'AP Invoices — End Balance'];
      } else {
        if (rowKey === 'acct_begin' || rowKey === 'pay_begin')   return ['gl-balances', {}, 'GL Balances — Opening'];
        if (rowKey === 'invoices')   return ['gl-lines', { P_CAT_TYPE: 'ap-inv' },  'GL Journal Lines — AP Invoices'];
        if (rowKey === 'payments')   return ['gl-lines', { P_CAT_TYPE: 'ap-pay' },  'GL Journal Lines — AP Payments'];
        if (rowKey === 'non_pay_jnls') return ['gl-lines', { P_CAT_TYPE: 'non-ap' }, 'GL Journal Lines — Non-AP'];
        if (rowKey === 'acct_end' || rowKey === 'pay_end')   return ['gl-balances', {}, 'GL Balances — Closing'];
      }
      return null;
    };

    return (
      <div style={{ overflowX: 'auto' }}>
        <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 8 }}>
          Period: <strong>{d.period}</strong> &nbsp;|&nbsp;
          {d.period_start} – {d.period_end} &nbsp;|&nbsp; Currency: <strong>{d.currency}</strong>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={thLabelStyle}>Description</th>
              <th style={{ ...thStyle, width: '20%' }}>Payables Amount ({d.currency})</th>
              <th style={{ ...thStyle, width: '20%' }}>Accounting Amount ({d.currency})</th>
              <th style={{ ...thStyle, width: '20%' }}>Difference ({d.currency})</th>
            </tr>
          </thead>
          <tbody>
            {reconRows.map((row, i) => {
              const isSection = i === 8; // blank separator before Non-Payables
              const rowBg = (row as any).bold ? '#f0f5ff' : (i % 2 === 0 ? '#fafafa' : '#fff');
              const labelStyle: React.CSSProperties = {
                ...tdBase, textAlign: 'left', fontFamily: 'inherit',
                fontWeight: (row as any).bold ? 700 : 400,
                fontStyle: (row as any).italic ? 'italic' : 'normal',
                paddingLeft: (row as any).indent ? 28 : 12,
                background: rowBg,
              };
              const numStyle = (v: number | null, isVariance?: boolean): React.CSSProperties => ({
                ...tdBase, textAlign: 'right', background: rowBg,
                color: v === null ? 'transparent'
                     : isVariance && Math.abs(v) < 0.005 ? '#ff4d4f'
                     : v < 0 ? '#ff4d4f'
                     : v > 0 && isVariance ? REDWOOD.warning
                     : REDWOOD.neutral900,
                fontWeight: (row as any).bold ? 700 : 400,
              });
              const diffStyle = (v: number | null): React.CSSProperties => ({
                ...tdBase, textAlign: 'right', background: rowBg,
                color: v === null ? 'transparent'
                     : Math.abs(v) < 0.005 ? '#ff4d4f'
                     : v < 0 ? '#ff4d4f'
                     : REDWOOD.warning,
                fontWeight: (row as any).bold ? 700 : 400,
              });
              return (
                <React.Fragment key={i}>
                  {isSection && (
                    <tr><td colSpan={4} style={{ padding: 0, height: 4, background: REDWOOD.neutral200 }} /></tr>
                  )}
                  <tr>
                    <td style={labelStyle}>{row.label}</td>
                    <td style={{ ...numStyle(row.payables), position: 'relative' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {row.payables !== null ? fmtRecon(row.payables) : ''}
                        {(() => { const d = getDrill((row as any).rowKey, 'payables'); return d && row.payables !== null && row.payables !== 0 ? (
                          <Tooltip title={d[2]}><Button type="link" size="small" icon={<ZoomInOutlined style={{ fontSize: 11 }} />}
                            style={{ padding: 0, height: 'auto', color: REDWOOD.info, opacity: 0.7 }}
                            onClick={() => fetchDrilldown(d[2], d[0], d[1])} /></Tooltip>
                        ) : null; })()}
                      </span>
                    </td>
                    <td style={{ ...numStyle(row.accounting, (row as any).variance), position: 'relative' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {row.accounting !== null ? fmtRecon(row.accounting) : ''}
                        {(() => { const d = getDrill((row as any).rowKey, 'accounting'); return d && row.accounting !== null && row.accounting !== 0 ? (
                          <Tooltip title={d[2]}><Button type="link" size="small" icon={<ZoomInOutlined style={{ fontSize: 11 }} />}
                            style={{ padding: 0, height: 'auto', color: REDWOOD.info, opacity: 0.7 }}
                            onClick={() => fetchDrilldown(d[2], d[0], d[1])} /></Tooltip>
                        ) : null; })()}
                      </span>
                    </td>
                    <td style={diffStyle(row.difference)}>{row.difference !== null ? fmtRecon(row.difference) : ''}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const exportExcel = () => {
    if (report.key === 'payables-ledger-recon' && reconData) {
      const d = reconData;
      const reconRows = buildReconRows(d);
      const exportRows = reconRows.map(r => ({
        'Description':               r.label,
        'Payables Amount (AED)':     r.payables  !== null ? r.payables  : '',
        'Accounting Amount (AED)':   r.accounting !== null ? r.accounting : '',
        'Difference (AED)':          r.difference !== null ? r.difference : '',
      }));
      const ws = XLSX.utils.json_to_sheet(exportRows);
      ws['!cols'] = [{ wch: 44 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Recon ${d.period}`.slice(0, 31));
      saveAs(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }),
        `payables_ledger_recon_${d.period}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      return;
    }
    const cols = COLUMNS[report.key];
    const exportRows = report.key === 'aging-report'
      ? rows.flatMap(r => r._invoices?.length
          ? r._invoices.map((inv: any) => ({ ...r, ...inv }))
          : [r])
      : rows;
    const ws = XLSX.utils.json_to_sheet(exportRows.map(r => {
      const obj: any = {};
      cols.forEach(c => { obj[c.title] = r[c.dataIndex as string] ?? ''; });
      return obj;
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, report.label.slice(0, 31));
    saveAs(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }),
      `${report.key}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    doc.setFontSize(14); doc.setTextColor(30, 30, 30); doc.text(reportTitle.current, 14, 16);
    doc.setFontSize(9);  doc.setTextColor(100);
    if (report.key === 'payables-ledger-recon' && reconData) {
      const d = reconData;
      doc.text(`Period: ${d.period}  (${d.period_start} – ${d.period_end})   Generated: ${new Date().toLocaleString()}`, 14, 22);
      const reconRows = buildReconRows(d);
      autoTable(doc, {
        startY: 28,
        head: [['Description', `Payables Amount (${d.currency})`, `Accounting Amount (${d.currency})`, `Difference (${d.currency})`]],
        body: reconRows.map(r => [
          r.label,
          r.payables  !== null ? fmtRecon(r.payables)   : '',
          r.accounting !== null ? fmtRecon(r.accounting) : '',
          r.difference !== null ? fmtRecon(r.difference) : '',
        ]),
        styles: { fontSize: 8, cellPadding: 2, halign: 'right' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'normal' } },
        headStyles: { fillColor: [91, 106, 245], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [247, 247, 247] },
      });
    } else {
      const cols = COLUMNS[report.key];
      doc.text(`Generated: ${new Date().toLocaleString()}   Records: ${rows.length}`, 14, 22);
      autoTable(doc, {
        startY: 28,
        head: [cols.map(c => c.title)],
        body: rows.map(r => cols.map(c => { const v = r[c.dataIndex as string]; return typeof v === 'number' ? fmt(v) : (v ?? ''); })),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [199, 70, 52], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [247, 247, 247] },
      });
    }
    doc.save(`${report.key}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const columns = COLUMNS[report.key];

  // Aging summary fields for both aging reports
  const AGING_FIELDS = ['invoiceAmount', 'unpaidAmount', 'months1', 'months2', 'months3', 'over3months', 'unallocated'] as const;

  // For aging-report:      label spans Supplier col only (index 0), numbers start at index 1
  // For aging-by-invoice:  label spans Supplier+Invoice#+InvoiceDate+DueDate (indices 0-3), numbers at 4
  const agingLabelSpan  = report.key === 'aging-by-invoice' ? 4 : 1;
  const agingStartIndex = agingLabelSpan;
  // aging-report uses all 7 fields so Invoice Amount total shows in its own column
  const agingNumberFields = AGING_FIELDS;

  const agingSummary = () => {
    const totals = AGING_FIELDS.reduce((acc, f) => {
      acc[f] = filteredRows.reduce((s, r) => s + (r[f] || 0), 0);
      return acc;
    }, {} as Record<string, number>);
    const unpaid = totals.unpaidAmount || 1;
    const pct = (v: number) => unpaid > 0 ? ((v / unpaid) * 100).toFixed(2) + '%' : '0.00%';

    return (
      <Table.Summary>
        <Table.Summary.Row style={{ background: '#f0f5ff' }}>
          <Table.Summary.Cell index={0} colSpan={agingLabelSpan}>
            <Text strong style={{ whiteSpace: 'nowrap' }}>Total for Report</Text>
          </Table.Summary.Cell>
          {agingNumberFields.map((f, i) => (
            <Table.Summary.Cell key={f} index={agingStartIndex + i} align="right">
              <Text strong style={{ color: f === 'unpaidAmount' ? REDWOOD.primary : undefined, whiteSpace: 'nowrap' }}>
                {fmt(totals[f])}
              </Text>
            </Table.Summary.Cell>
          ))}
        </Table.Summary.Row>
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} colSpan={agingLabelSpan}>
            <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>% of Unpaid</Text>
          </Table.Summary.Cell>
          {agingNumberFields.map((f, i) => (
            <Table.Summary.Cell key={f} index={agingStartIndex + i} align="right">
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {f === 'invoiceAmount' ? '' : pct(totals[f])}
              </Text>
            </Table.Summary.Cell>
          ))}
        </Table.Summary.Row>
      </Table.Summary>
    );
  };

  return (
    <div style={{ padding: '16px 0' }}>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>{report.description}</Text>

      {/* Parameters */}
      <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }}
        styles={{ body: { padding: '12px 16px' } }}>
        <Form form={form} layout="inline" size="small" onValuesChange={handleFormValuesChange}
          initialValues={{ asAtDate: new Date().toISOString().slice(0, 10) }}>
          <Form.Item label="Business Unit" name="businessUnit">
            <Select placeholder="All Business Units" allowClear showSearch style={{ width: 200 }}
              filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())}>
              {businessUnits.map(b => (
                <Option key={b.name} value={b.name}>
                  {b.company ? `${b.name}  (${b.company})` : b.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          {report.hasSupplierFilter && (<>
            <Form.Item label="Supplier #" name="supplierNumber">
              <Input placeholder="Optional" style={{ width: 120 }} allowClear />
            </Form.Item>
            <Form.Item label="Supplier Name" name="supplierName">
              <Input placeholder="Optional" style={{ width: 150 }} allowClear />
            </Form.Item>
          </>)}
          {report.hasDateFilter && (<>
            <Form.Item label="Date From" name="dateFrom"><Input type="date" style={{ width: 140 }} /></Form.Item>
            <Form.Item label="Date To" name="dateTo"><Input type="date" style={{ width: 140 }} /></Form.Item>
          </>)}
          {report.hasAgingDate && (
            <Form.Item label={<span style={{ fontWeight: 600 }}>As at Date</span>} name="asAtDate"
              tooltip="Aging is calculated relative to this date. Defaults to today if left blank.">
              <Input type="date" style={{ width: 150 }} />
            </Form.Item>
          )}
          {report.hasPeriodFilter && report.key !== 'payables-ledger-recon' && (
            <Form.Item label={<span style={{ fontWeight: 600 }}>Period</span>} name="period"
              tooltip="GL accounting period, e.g. Jan-2024">
              <Select showSearch allowClear placeholder="e.g. Jan-2024" style={{ width: 140 }}
                filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())}>
                {periodOptions.map(p => <Option key={p} value={p}>{p}</Option>)}
              </Select>
            </Form.Item>
          )}
          {report.key === 'payables-ledger-recon' && (
            <>
              <Form.Item label={<span style={{ fontWeight: 600 }}>Year</span>}>
                <Select
                  placeholder="Year"
                  value={selectedYear ?? undefined}
                  loading={calPeriodsLoading}
                  onChange={(v: number) => { setSelectedYear(v); setSelectedPeriod(''); }}
                  style={{ width: 90 }}
                  allowClear
                >
                  {calYears.map(y => <Option key={y} value={y}>{y}</Option>)}
                </Select>
              </Form.Item>
              <Form.Item label={<span style={{ fontWeight: 600 }}>Period</span>}>
                <Select
                  placeholder="Period"
                  value={selectedPeriod || undefined}
                  loading={calPeriodsLoading}
                  onChange={setSelectedPeriod}
                  style={{ width: 120 }}
                  showSearch
                  allowClear
                >
                  {periodsForYear.map(p => <Option key={p.period_name_id} value={p.period_name_id}>{p.period_name_id}</Option>)}
                </Select>
              </Form.Item>
            </>
          )}
          {report.hasCompanyFilter && report.key !== 'payables-ledger-recon' && (
            <Form.Item label="Company" name="company" tooltip="GL Company segment (e.g. 01)">
              <Input placeholder="e.g. 01" style={{ width: 100 }} allowClear />
            </Form.Item>
          )}
          {report.key === 'payables-ledger-recon' && (
            <Form.Item label={
              <Space size={4}>
                <span>Company</span>
                {companyLocked && <LockOutlined style={{ fontSize: 10, color: '#6B6B6B' }} />}
              </Space>
            }>
              <Input
                value={company}
                onChange={e => { if (!companyLocked) setCompany(e.target.value); }}
                disabled={companyLocked}
                placeholder="Auto from BU"
                style={{
                  width: 100,
                  background: companyLocked ? '#F7F7F7' : undefined,
                  color: companyLocked ? '#0572CE' : undefined,
                  fontWeight: companyLocked ? 600 : undefined,
                  fontFamily: 'monospace',
                }}
              />
            </Form.Item>
          )}
          {report.hasAccountFilter && report.key !== 'payables-ledger-recon' && (
            <Form.Item label={<span style={{ fontWeight: 600 }}>GL Account</span>} name="account"
              tooltip="AP liability account segment (e.g. 21100)">
              <Input placeholder="e.g. 21100" style={{ width: 120 }} allowClear />
            </Form.Item>
          )}
          {report.key === 'payables-ledger-recon' && (
            <Form.Item label={<span style={{ fontWeight: 600 }}>GL Account</span>}>
              <Input.Group compact style={{ display: 'flex' }}>
                <Input
                  readOnly
                  value={selectedAccount
                    ? `${selectedAccount}${selectedAccountDesc ? '  –  ' + selectedAccountDesc : ''}`
                    : ''}
                  placeholder="Click to select…"
                  style={{ width: 200, cursor: 'pointer', background: selectedAccount ? '#f0f5ff' : undefined }}
                  onClick={() => setAccountPickerOpen(true)}
                />
                <Button
                  loading={accountsLoading}
                  onClick={() => setAccountPickerOpen(true)}
                  style={{ borderLeft: 0 }}
                >
                  LOV
                </Button>
                {selectedAccount && (
                  <Button onClick={() => { setSelectedAccount(''); setSelectedAccountDesc(''); }}>✕</Button>
                )}
              </Input.Group>
            </Form.Item>
          )}
        </Form>
      </Card>

      {/* Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun} loading={loading}
            style={{ background: report.color, borderColor: report.color }}>Run Report</Button>
          <Tooltip title="Export to Excel">
            <Button icon={<FileExcelOutlined />} onClick={exportExcel} disabled={rows.length === 0 && !reconData}>Excel</Button>
          </Tooltip>
          <Tooltip title="Export to PDF">
            <Button icon={<FilePdfOutlined />} onClick={exportPdf} disabled={rows.length === 0 && !reconData} danger>PDF</Button>
          </Tooltip>
          {apiUrls.length > 0 && (
            <Tooltip title="View API">
              <Button icon={<ApiOutlined />} size="small"
                style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={() => setApiModalOpen(true)} />
            </Tooltip>
          )}
        </Space>
        {hasRun && (
          <Space>
            <Input
              prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
              placeholder="Search in results..."
              size="small"
              allowClear
              value={gridSearch}
              onChange={e => setGridSearch(e.target.value)}
              style={{ width: 220, borderRadius: 6 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filteredRows.length}{filteredRows.length !== rows.length ? ` / ${rows.length}` : ''} record{rows.length !== 1 ? 's' : ''}
            </Text>
          </Space>
        )}
      </div>

      {/* Results */}
      <Spin spinning={loading}>
        {!hasRun ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text type="secondary">Set parameters and click Run Report</Text>}
            style={{ padding: '40px 0' }} />
        ) : report.key === 'payables-ledger-recon' ? (
          reconData
            ? <div style={{ background: REDWOOD.surface, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, padding: 16 }}>
                {renderReconReport(reconData)}
              </div>
            : <Empty description="No reconciliation data" />
        ) : report.key === 'aging-report' ? (
          <Table
            dataSource={filteredRows}
            columns={columns}
            rowKey="key"
            size="small"
            scroll={{ x: 'max-content', y: 400 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} suppliers` }}
            expandable={{
              expandedRowRender: (record: any) => (
                <div style={{ margin: '0 0 8px 32px' }}>
                  <Text strong style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 6 }}>
                    Invoices — {record.supplier}
                  </Text>
                  <Table
                    dataSource={record._invoices || []}
                    columns={AGING_DRILL_COLUMNS}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                    summary={() => {
                      const invs: any[] = record._invoices || [];
                      if (invs.length === 0) return null;
                      return (
                        <Table.Summary.Row style={{ background: '#f6ffed' }}>
                          <Table.Summary.Cell index={0} colSpan={3}><Text strong style={{ fontSize: 11 }}>Subtotal</Text></Table.Summary.Cell>
                          {(['invoiceAmount', 'amountPaid', 'unpaidAmount', 'months1', 'months2', 'months3', 'over3months', 'unallocated'] as const).map((f, i) => (
                            <Table.Summary.Cell key={f} index={3 + i} align="right">
                              <Text strong style={{ fontSize: 11 }}>{fmt(invs.reduce((s, r) => s + (r[f] || 0), 0))}</Text>
                            </Table.Summary.Cell>
                          ))}
                        </Table.Summary.Row>
                      );
                    }}
                  />
                </div>
              ),
              rowExpandable: (record: any) => (record._invoices || []).length > 0,
            }}
            summary={agingSummary}
          />
        ) : (
          <Table dataSource={filteredRows} columns={columns} rowKey="key" size="small"
            scroll={{ x: 'max-content', y: 440 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
            summary={
              report.key === 'supplier-balance' ? () => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}><Text strong>Total</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><Text strong>{filteredRows.reduce((s, r) => s + (r.invoiceCount || 0), 0)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><Text strong>{fmt(filteredRows.reduce((s, r) => s + (r.invoiceAmount || 0), 0))}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><Text style={{ color: REDWOOD.success }}>{fmt(filteredRows.reduce((s, r) => s + (r.amountPaid || 0), 0))}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: REDWOOD.primary }}>{fmt(filteredRows.reduce((s, r) => s + (r.outstanding || 0), 0))}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={6} />
                </Table.Summary.Row>
              ) : report.key === 'aging-by-invoice' ? agingSummary
              : report.key === 'payment-register' ? () => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><Text strong>{fmt(filteredRows.reduce((s, r) => s + (r.paymentAmount || 0), 0))}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} colSpan={4} />
                </Table.Summary.Row>
              ) : undefined
            }
          />
        )}
      </Spin>

      {/* Drill-down modal */}
      <Modal
        open={drillOpen}
        onCancel={() => setDrillOpen(false)}
        title={<Space><ZoomInOutlined style={{ color: REDWOOD.info }} />{drillTitle}</Space>}
        footer={<Button onClick={() => setDrillOpen(false)}>Close</Button>}
        width={1100}
        styles={{ body: { padding: '12px 0' } }}
      >
        <Spin spinning={drillLoading}>
          {drillRows.length === 0 && !drillLoading ? (
            <Empty description="No transactions found" style={{ padding: 32 }} />
          ) : (
            <Table
              dataSource={drillRows}
              columns={drillCols}
              rowKey="_key"
              size="small"
              scroll={{ x: true, y: 420 }}
              pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} records` }}
              style={{ fontSize: 12 }}
            />
          )}
        </Spin>
      </Modal>

      {/* Account Picker for payables-ledger-recon */}
      <AccountPickerModal
        open={accountPickerOpen}
        onClose={() => setAccountPickerOpen(false)}
        onSelect={(acct, desc) => { setSelectedAccount(acct); setSelectedAccountDesc(desc); }}
        options={accountOptions}
        loading={accountsLoading}
      />

      {/* API URL modal */}
      <Modal
        open={apiModalOpen}
        onCancel={() => setApiModalOpen(false)}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />API Endpoints — {report.label}</Space>}
        footer={<Button onClick={() => setApiModalOpen(false)}>Close</Button>}
        width={720}
      >
        {apiUrls.map((url, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            {apiUrls.length > 1 && (
              <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {i === 0 ? 'Step 1 — Supplier List' : `Step 2 — Invoices (per supplier)`}
              </Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: REDWOOD.neutral900 }}>
                {url}
              </div>
              <Tooltip title="Copy">
                <Button size="small" icon={<CopyOutlined />}
                  onClick={() => { navigator.clipboard.writeText(url); message.success('Copied'); }} />
              </Tooltip>
            </div>
            {url.includes('?') && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {url.split('?')[1].split('&').map((p, j) => {
                  const [k, v] = p.split('=');
                  return (
                    <div key={j} style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                      <Text code style={{ fontSize: 11 }}>{decodeURIComponent(k)}</Text>
                      {' = '}
                      <Text style={{ fontSize: 11, color: REDWOOD.info }}>{decodeURIComponent(v || '')}</Text>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </Modal>
    </div>
  );
};

// ─── Tab entry ────────────────────────────────────────────────────────────────
interface TabEntry {
  tabKey: string;
  report: ReportDef;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const APReports: React.FC = () => {
  const [businessUnits, setBusinessUnits] = useState<{ name: string; company: string }[]>([]);
  const [reportSearch, setReportSearch] = useState('');
  const [tabs, setTabs] = useState<TabEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const items: any[] = Array.isArray(data) ? data : (data.items || []);
        setBusinessUnits(
          items
            .filter((i: any) => i.business_unit_name || i.BUSINESS_UNIT_NAME)
            .map((i: any) => ({
              name: String(i.business_unit_name || i.BUSINESS_UNIT_NAME || ''),
              company: String(i.company || i.COMPANY || i.company_code || i.COMPANY_CODE || ''),
            }))
        );
      }).catch(() => {});
  }, []);

  const filteredReports = useMemo(() =>
    REPORTS.filter(r =>
      r.label.toLowerCase().includes(reportSearch.toLowerCase()) ||
      r.description.toLowerCase().includes(reportSearch.toLowerCase())
    ),
    [reportSearch]
  );

  const openReport = (report: ReportDef) => {
    const tabKey = `${report.key}-${Date.now()}`;
    const newTab: TabEntry = { tabKey, report };
    setTabs(prev => [...prev, newTab]);
    setActiveTab(tabKey);
  };

  const closeTab = (targetKey: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.tabKey !== targetKey);
      if (activeTab === targetKey && next.length > 0) {
        setActiveTab(next[next.length - 1].tabKey);
      } else if (next.length === 0) {
        setActiveTab('');
      }
      return next;
    });
  };

  const onTabEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove') closeTab(targetKey as string);
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/ap">Payables</Link> },
            { title: 'Reports' },
          ]} />
        </div>

        <div style={{ display: 'flex', height: 'calc(100vh - 113px)' }}>

          {/* ── Left panel: report list ── */}
          <div style={{
            width: sidebarCollapsed ? 44 : 260,
            flexShrink: 0, background: REDWOOD.surface,
            borderRight: `1px solid ${REDWOOD.neutral200}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            transition: 'width 0.2s ease',
          }}>
            {/* Header */}
            <div style={{
              padding: sidebarCollapsed ? '12px 6px' : '12px 14px 10px',
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex', alignItems: 'center',
              justifyContent: sidebarCollapsed ? 'center' : 'space-between',
              gap: 8, minHeight: 52,
            }}>
              {!sidebarCollapsed && (
                <Space align="center" size={8} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: `linear-gradient(135deg, ${REDWOOD.reportGreen} 0%, #0D5C36 100%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <BarChartOutlined style={{ fontSize: 14, color: '#fff' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.2 }}>Reports</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>Payables Module</Text>
                  </div>
                </Space>
              )}
              <Tooltip title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'} placement="right">
                <Button
                  type="text" size="small"
                  icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setSidebarCollapsed(v => !v)}
                  style={{ color: REDWOOD.neutral600, flexShrink: 0 }}
                />
              </Tooltip>
            </div>

            {!sidebarCollapsed && (
              <>
                {/* Search */}
                <div style={{ padding: '8px 10px 4px' }}>
                  <Input
                    prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                    placeholder="Search reports..."
                    size="small"
                    allowClear
                    value={reportSearch}
                    onChange={e => setReportSearch(e.target.value)}
                    style={{ borderRadius: 6 }}
                  />
                </div>

                {/* Report list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
                  {filteredReports.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12, padding: '12px 6px', display: 'block' }}>
                      No reports match your search.
                    </Text>
                  ) : filteredReports.map(r => (
                    <div
                      key={r.key}
                      onClick={() => openReport(r)}
                      style={{
                        padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                        marginBottom: 4, transition: 'all 0.15s',
                        border: `1px solid transparent`,
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.background = `${r.color}10`;
                        (e.currentTarget as HTMLDivElement).style.borderColor = `${r.color}30`;
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                        (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent';
                      }}
                    >
                      <Space align="start" size={10}>
                        <div style={{
                          width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                          background: `${r.color}18`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: r.color, fontSize: 14,
                        }}>
                          {r.icon}
                        </div>
                        <div>
                          <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900, display: 'block', lineHeight: 1.3 }}>
                            {r.label}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.3 }}>{r.description}</Text>
                        </div>
                      </Space>
                    </div>
                  ))}
                </div>

                <div style={{ padding: '10px 14px', borderTop: `1px solid ${REDWOOD.neutral200}` }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Click a report to open it in a new tab
                  </Text>
                </div>
              </>
            )}

            {/* Collapsed: icon-only list */}
            {sidebarCollapsed && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                {REPORTS.map(r => (
                  <Tooltip key={r.key} title={r.label} placement="right">
                    <div
                      onClick={() => openReport(r)}
                      style={{
                        width: 32, height: 32, borderRadius: 7, cursor: 'pointer',
                        background: `${r.color}18`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: r.color, fontSize: 15, transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = `${r.color}35`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = `${r.color}18`; }}
                    >
                      {r.icon}
                    </div>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>

          {/* ── Right panel: tabs ── */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {tabs.length === 0 ? (
              /* Empty state */
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16,
                  background: `${REDWOOD.reportGreen}12`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <BarChartOutlined style={{ fontSize: 32, color: REDWOOD.reportGreen }} />
                </div>
                <Title level={4} style={{ margin: 0, color: REDWOOD.neutral600 }}>No reports open</Title>
                <Text type="secondary">Select a report from the left panel to open it here</Text>
              </div>
            ) : (
              <Tabs
                type="editable-card"
                hideAdd
                activeKey={activeTab}
                onChange={setActiveTab}
                onEdit={onTabEdit}
                style={{ height: '100%' }}
                tabBarStyle={{ padding: '0 16px', margin: 0, background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
                items={tabs.map(({ tabKey, report }) => ({
                  key: tabKey,
                  closable: true,
                  label: (
                    <Space size={6}>
                      <span style={{ color: report.color, fontSize: 13 }}>{report.icon}</span>
                      <span style={{ fontSize: 13 }}>{report.label}</span>
                    </Space>
                  ),
                  children: (
                    <div style={{ padding: '0 24px 24px', overflowY: 'auto', height: 'calc(100vh - 165px)' }}>
                      <ReportPanel report={report} businessUnits={businessUnits} />
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default APReports;
