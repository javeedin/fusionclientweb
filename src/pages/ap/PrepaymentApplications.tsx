import React, { useState, useCallback, useEffect } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Layout, Card, Form, Select, Button, Space, Table, Tag, Typography, Row, Col,
  Tabs, Progress, Modal, Descriptions, DatePicker, Divider, InputNumber,
  Tooltip, Badge, Spin, Alert, message, Empty, Popconfirm, Drawer, Collapse,
} from 'antd';
import {
  SearchOutlined, FileTextOutlined, DollarOutlined, CheckCircleOutlined,
  CloseCircleOutlined, SyncOutlined, ExclamationCircleOutlined, EyeOutlined,
  SwapOutlined, MinusCircleOutlined, PlusCircleOutlined, ReloadOutlined,
  ApiOutlined, LoadingOutlined, WarningOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

// ── Theme ─────────────────────────────────────────────────────────────────────
const REDWOOD = {
  primary: '#C74634', success: '#2E8B57', warning: '#E88B00', error: '#C74634',
  info: '#1677ff', neutral400: '#9e9e9e', neutral600: '#616161',
  taskBlue: '#0057A8', surface: '#FAFAFA', headerBg: '#C74634',
};

const BASE = APEX_DB_CONFIG.baseUrl;
const fmt  = (n: number) => (n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Application status colours ────────────────────────────────────────────────
const APP_STATUS_COLOR: Record<string, string> = {
  Applied: 'green', Unapplied: 'orange', Cancelled: 'red',
  applied: 'green', unapplied: 'orange', cancelled: 'red',
};

// ── Interfaces ────────────────────────────────────────────────────────────────
interface PrepayInvoiceRow {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  supplierId: number;
  supplierSite: string;
  supplierNumber: string;
  businessUnit: string;
  invoiceAmount: number;
  appliedAmount: number;
  availableBalance: number;
  currency: string;
  applyAfterDate: string;
  accountingStatus: string;
}

interface ApplicationRow {
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
  purchaseOrder: string;
  status: string;
  lineNumber: number;
  prepayLineNumber: number;
  description: string;
  createdBy: string;
  accountingStatus: string;
  syncStatus: string;
}

interface StandardInvoiceRow {
  key: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  supplierId: number;
  supplierNumber: string;
  supplierSite: string;
  businessUnit: string;
  invoiceAmount: number;
  appliedPrepayments: number;
  currency: string;
}

interface AvailPrepay {
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
  accountingDate: Dayjs;
}

// ── Component ─────────────────────────────────────────────────────────────────
const PrepaymentApplications: React.FC = () => {
  const [searchForm]  = Form.useForm();
  const [applyForm]   = Form.useForm();

  // ── Lookups ──
  const [businessUnits, setBusinessUnits] = useState<{ id: number; name: string }[]>([]);

  // ── Data ──
  const [prepayInvoices, setPrepayInvoices]   = useState<PrepayInvoiceRow[]>([]);
  const [applications, setApplications]       = useState<ApplicationRow[]>([]);
  const [stdInvoices, setStdInvoices]         = useState<StandardInvoiceRow[]>([]);
  const [dataLoading, setDataLoading]         = useState(false);
  const [activeTab, setActiveTab]             = useState('dashboard');

  // ── Apply workflow ──
  const [selectedStdInvoice, setSelectedStdInvoice] = useState<StandardInvoiceRow | null>(null);
  const [availPrepays, setAvailPrepays]       = useState<AvailPrepay[]>([]);
  const [availLoading, setAvailLoading]       = useState(false);
  const [selectedAvailKeys, setSelectedAvailKeys] = useState<React.Key[]>([]);
  const [applying, setApplying]              = useState(false);

  // ── Unapply modal ──
  const [unapplyVisible, setUnapplyVisible]   = useState(false);
  const [unapplyRecord, setUnapplyRecord]     = useState<ApplicationRow | null>(null);
  const [unapplyDate, setUnapplyDate]         = useState<Dayjs>(dayjs());
  const [unapplying, setUnapplying]           = useState(false);

  // ── Detail drawer (prepay invoice → view applications) ──
  const [detailVisible, setDetailVisible]     = useState(false);
  const [detailPrepay, setDetailPrepay]       = useState<PrepayInvoiceRow | null>(null);
  const [detailApps, setDetailApps]           = useState<ApplicationRow[]>([]);
  const [detailLoading, setDetailLoading]     = useState(false);

  // ── API log ──
  const [apiLogVisible, setApiLogVisible]     = useState(false);
  const [apiLogs, setApiLogs]                 = useState<{ method: string; url: string; status: number | string; ts: string; response?: string }[]>([]);

  const loggedFetch = useCallback(async (url: string, opts?: RequestInit): Promise<Response> => {
    const ts = dayjs().format('HH:mm:ss.SSS');
    const method = opts?.method || 'GET';
    try {
      const res = await fetch(url, opts);
      res.clone().text().then(txt => setApiLogs(prev => [{ method, url, status: res.status, ts, response: txt.slice(0, 300) }, ...prev.slice(0, 49)]));
      return res;
    } catch (err: any) {
      setApiLogs(prev => [{ method, url, status: 'ERR', ts, response: err.message }, ...prev.slice(0, 49)]);
      throw err;
    }
  }, []);

  // ── Load BU list on mount ──
  useEffect(() => {
    fetch(`${BASE}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setBusinessUnits((d.items || d || []).map((i: any) => ({ id: i.business_unit_id, name: i.business_unit_name || '' }))));
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const vals = searchForm.getFieldsValue();
    if (!vals.businessUnit) { message.warning('Select a Business Unit first.'); return; }
    setDataLoading(true);
    setPrepayInvoices([]); setApplications([]); setStdInvoices([]);
    setSelectedStdInvoice(null); setAvailPrepays([]);

    try {
      const params = new URLSearchParams({ business_unit: vals.businessUnit });
      const [invRes, appRes] = await Promise.all([
        loggedFetch(`${BASE}/ap/createinvoice?${params}`, { headers: { Accept: 'application/json' } }),
        loggedFetch(`${BASE}/ap/applied-prepayments?business_unit=${encodeURIComponent(vals.businessUnit)}&limit=500`, { headers: { Accept: 'application/json' } }),
      ]);

      if (invRes.ok) {
        const d = await invRes.json();
        const all: any[] = d.items || d || [];

        // Prepayment invoices
        const preps: PrepayInvoiceRow[] = all
          .filter((i: any) => (i.invoice_type || '').toLowerCase() === 'prepayment')
          .map((i: any) => {
            const invAmt = Number(i.invoice_amount || 0);
            const applied = Number(i.applied_prepayments || 0);
            return {
              key:             String(i.invoice_id),
              invoiceId:       Number(i.invoice_id),
              invoiceNumber:   i.invoice_number || '',
              invoiceDate:     i.invoice_date   || '',
              supplier:        i.supplier || i.party || '',
              supplierId:      Number(i.supplier_id || 0),
              supplierSite:    i.supplier_site   || '',
              supplierNumber:  i.supplier_number || '',
              businessUnit:    i.business_unit   || vals.businessUnit,
              invoiceAmount:   invAmt,
              appliedAmount:   applied,
              availableBalance: invAmt - applied,
              currency:        i.invoice_currency || 'AED',
              applyAfterDate:  i.apply_after_date || '',
              accountingStatus: i.accounting_status || 'Not Accounted',
            };
          });

        // Standard invoices (for Apply workflow)
        const stds: StandardInvoiceRow[] = all
          .filter((i: any) => (i.invoice_type || 'Standard').toLowerCase() !== 'prepayment')
          .map((i: any) => ({
            key:              String(i.invoice_id),
            invoiceId:        Number(i.invoice_id),
            invoiceNumber:    i.invoice_number || '',
            invoiceDate:      i.invoice_date   || '',
            supplier:         i.supplier || i.party || '',
            supplierId:       Number(i.supplier_id || 0),
            supplierNumber:   i.supplier_number || '',
            supplierSite:     i.supplier_site   || '',
            businessUnit:     i.business_unit   || vals.businessUnit,
            invoiceAmount:    Number(i.invoice_amount || 0),
            appliedPrepayments: Number(i.applied_prepayments || 0),
            currency:         i.invoice_currency || 'AED',
          }));

        setPrepayInvoices(preps);
        setStdInvoices(stds);
      }

      if (appRes.ok) {
        const d = await appRes.json();
        const items: any[] = d.items || d || [];
        setApplications(items.map((a: any, idx: number) => ({
          key:              String(a.application_id ?? `app-${idx}`),
          applicationId:   Number(a.application_id ?? 0),
          invoiceId:       Number(a.invoice_id ?? 0),
          invoiceNumber:   a.invoice_number ?? '',
          prepayInvoiceId: Number(a.prepayment_invoice_id ?? 0),
          prepayNumber:    a.prepayment_number ?? '',
          appliedAmount:   Number(a.applied_amount ?? 0),
          currency:        a.currency ?? 'AED',
          accountingDate:  a.application_accounting_date ?? a.creation_date ?? '',
          businessUnit:    a.business_unit ?? vals.businessUnit,
          supplierSite:    a.supplier_site ?? '',
          purchaseOrder:   a.purchase_order ?? '',
          status:          a.status ?? 'Applied',
          lineNumber:      Number(a.line_number ?? 1),
          prepayLineNumber: Number(a.prepayment_line_number ?? 1),
          description:     a.description ?? '',
          createdBy:       a.created_by ?? '',
          accountingStatus: a.accounting_status ?? '',
          syncStatus:      a.sync_status ?? 'NEW',
        })));
      }
    } catch (err: any) {
      message.error(`Search failed: ${err.message}`);
    } finally {
      setDataLoading(false);
    }
  }, [searchForm, loggedFetch]);

  // ── Computed stats ───────────────────────────────────────────────────────
  const totalPrepayAmount   = prepayInvoices.reduce((s, r) => s + r.invoiceAmount,   0);
  const totalApplied        = prepayInvoices.reduce((s, r) => s + r.appliedAmount,   0);
  const totalAvailable      = prepayInvoices.reduce((s, r) => s + r.availableBalance, 0);
  const appliedApps         = applications.filter(a => a.status === 'Applied' || a.status === 'applied');
  const unappliedApps       = applications.filter(a => a.status === 'Unapplied' || a.status === 'unapplied');

  // ── Fetch available prepayments when selecting a standard invoice ─────────
  const handleSelectStdInvoice = useCallback(async (inv: StandardInvoiceRow) => {
    setSelectedStdInvoice(inv);
    setAvailPrepays([]);
    setSelectedAvailKeys([]);
    if (!inv.supplierId) { message.warning('No supplier ID on this invoice.'); return; }
    setAvailLoading(true);
    try {
      const res = await loggedFetch(`${BASE}/ap/prepayments/available?P_SUPPLIER_ID=${inv.supplierId}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d    = await res.json();
      const items: any[] = d.items || (Array.isArray(d) ? d : []);
      setAvailPrepays(items.map((i: any, idx: number) => ({
        key:                  String(i.invoice_id ?? idx),
        invoiceId:            Number(i.invoice_id ?? 0),
        invoiceNumber:        i.invoice_number ?? '',
        description:          i.description ?? '',
        supplierSite:         i.supplier_site ?? '',
        purchaseOrder:        i.purchase_order ?? '',
        currency:             i.currency ?? 'AED',
        availableAmount:      Number(i.available_amount ?? 0),
        lineNumber:           Number(i.line_number ?? 1),
        prepaymentLineNumber: Number(i.prepayment_line_number ?? 1),
        businessUnit:         i.business_unit ?? inv.businessUnit,
        toApply:              Math.min(Number(i.available_amount ?? 0), inv.invoiceAmount),
        accountingDate:       dayjs(),
      })));
    } catch (err: any) {
      message.error(`Could not load prepayments: ${err.message}`);
    } finally {
      setAvailLoading(false);
    }
  }, [loggedFetch]);

  // ── Apply ─────────────────────────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    if (!selectedStdInvoice) return;
    const selectedRows = availPrepays.filter(r => selectedAvailKeys.includes(r.key));
    if (selectedRows.length === 0) { message.warning('Select at least one prepayment.'); return; }
    const invalid = selectedRows.filter(r => !r.toApply || r.toApply <= 0 || r.toApply > r.availableAmount);
    if (invalid.length > 0) { message.error(`Invalid amounts on: ${invalid.map(r => r.invoiceNumber).join(', ')}`); return; }

    setApplying(true);
    let successCount = 0;
    for (const row of selectedRows) {
      try {
        const body = {
          InvoiceId:                  selectedStdInvoice.invoiceId,
          InvoiceNumber:              selectedStdInvoice.invoiceNumber,
          PrepaymentInvoiceId:        row.invoiceId,
          PrepaymentNumber:           row.invoiceNumber,
          LineNumber:                 1,
          PrepaymentLineNumber:       row.prepaymentLineNumber,
          Description:                row.description || null,
          BusinessUnit:               selectedStdInvoice.businessUnit,
          SupplierSite:               selectedStdInvoice.supplierSite || row.supplierSite,
          PurchaseOrder:              row.purchaseOrder || null,
          Currency:                   row.currency,
          AppliedAmount:              row.toApply,
          IncludedTax:                null,
          IncludedonInvoiceFlag:      false,
          ApplicationAccountingDate:  row.accountingDate.format('YYYY-MM-DD'),
          Status:                     'Applied',
        };
        const res = await loggedFetch(`${BASE}/ap/invoices/appliedprepayments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t}`); }
        successCount++;
      } catch (err: any) {
        message.error(`Failed to apply ${row.invoiceNumber}: ${err.message}`);
      }
    }
    if (successCount > 0) {
      message.success(`${successCount} prepayment(s) applied successfully.`);
      // Refresh available prepayments for this invoice
      await handleSelectStdInvoice(selectedStdInvoice);
      setSelectedAvailKeys([]);
      // Partial refresh of applications and prepay invoices
      handleSearch();
    }
    setApplying(false);
  }, [selectedStdInvoice, availPrepays, selectedAvailKeys, loggedFetch, handleSelectStdInvoice, handleSearch]);

  // ── Unapply ───────────────────────────────────────────────────────────────
  const handleUnapply = useCallback(async () => {
    if (!unapplyRecord) return;
    setUnapplying(true);
    try {
      const body = {
        InvoiceId:                  unapplyRecord.invoiceId,
        InvoiceNumber:              unapplyRecord.invoiceNumber,
        PrepaymentInvoiceId:        unapplyRecord.prepayInvoiceId,
        PrepaymentNumber:           unapplyRecord.prepayNumber,
        LineNumber:                 unapplyRecord.lineNumber,
        PrepaymentLineNumber:       unapplyRecord.prepayLineNumber,
        Description:                unapplyRecord.description || null,
        BusinessUnit:               unapplyRecord.businessUnit,
        SupplierSite:               unapplyRecord.supplierSite,
        PurchaseOrder:              unapplyRecord.purchaseOrder || null,
        Currency:                   unapplyRecord.currency,
        AppliedAmount:              -(unapplyRecord.appliedAmount),
        IncludedTax:                null,
        IncludedonInvoiceFlag:      false,
        ApplicationAccountingDate:  unapplyDate.format('YYYY-MM-DD'),
        Status:                     'Unapplied',
      };
      const res = await loggedFetch(`${BASE}/ap/invoices/appliedprepayments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t}`); }
      message.success(`Prepayment ${unapplyRecord.prepayNumber} un-applied successfully.`);
      setUnapplyVisible(false);
      setApplications(prev => prev.map(a => a.key === unapplyRecord.key ? { ...a, status: 'Unapplied' } : a));
    } catch (err: any) {
      message.error(`Unapply failed: ${err.message}`);
    } finally {
      setUnapplying(false);
    }
  }, [unapplyRecord, unapplyDate, loggedFetch]);

  // ── View prepay invoice detail (which invoices it was applied to) ─────────
  const handleViewDetail = useCallback(async (row: PrepayInvoiceRow) => {
    setDetailPrepay(row);
    setDetailApps([]);
    setDetailVisible(true);
    setDetailLoading(true);
    try {
      const res = await loggedFetch(`${BASE}/ap/applied-prepayments/by-prepayment/${row.invoiceId}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const items: any[] = d.items || (Array.isArray(d) ? d : []);
      setDetailApps(items.map((a: any, idx: number) => ({
        key:              String(a.application_id ?? `da-${idx}`),
        applicationId:   Number(a.application_id ?? 0),
        invoiceId:       Number(a.invoice_id ?? 0),
        invoiceNumber:   a.invoice_number ?? '',
        prepayInvoiceId: row.invoiceId,
        prepayNumber:    row.invoiceNumber,
        appliedAmount:   Number(a.applied_amount ?? 0),
        currency:        a.currency ?? row.currency,
        accountingDate:  a.application_accounting_date ?? '',
        businessUnit:    a.business_unit ?? row.businessUnit,
        supplierSite:    a.supplier_site ?? '',
        purchaseOrder:   a.purchase_order ?? '',
        status:          a.status ?? 'Applied',
        lineNumber:      Number(a.line_number ?? 1),
        prepayLineNumber: Number(a.prepayment_line_number ?? 1),
        description:     a.description ?? '',
        createdBy:       a.created_by ?? '',
        accountingStatus: a.accounting_status ?? '',
        syncStatus:      a.sync_status ?? 'NEW',
      })));
    } catch (err: any) {
      message.error(`Could not load applications: ${err.message}`);
    } finally {
      setDetailLoading(false);
    }
  }, [loggedFetch]);

  // ── KPI card ─────────────────────────────────────────────────────────────
  const KpiCard = ({ title, value, color, icon, sub }: { title: string; value: string | number; color: string; icon: React.ReactNode; sub?: string }) => (
    <Card size="small" style={{ borderRadius: 10, border: 'none', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', height: '100%' }}>
      <Row justify="space-between" align="top">
        <Col>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>{title}</Text>
          <Text strong style={{ fontSize: 20, color, lineHeight: 1.1, display: 'block' }}>{value}</Text>
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

  // ── Applications table columns (reused in both Applications tab & detail drawer) ─────
  const appColumns = (showPrepayCol = true, showInvCol = true) => [
    ...(showPrepayCol ? [{ title: 'Prepayment #', dataIndex: 'prepayNumber', width: 150, render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text> }] : []),
    ...(showInvCol    ? [{ title: 'Invoice #',     dataIndex: 'invoiceNumber', width: 150, render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> }] : []),
    { title: 'App. Date', dataIndex: 'accountingDate', width: 100, render: (v: string) => <Text style={{ fontSize: 11 }}>{v ? dayjs(v).format('D-MMM-YY') : '—'}</Text> },
    { title: 'Amount',    dataIndex: 'appliedAmount',  width: 120, align: 'right' as const, render: (v: number, r: ApplicationRow) => <Text style={{ fontSize: 12 }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text> },
    {
      title: 'Status', dataIndex: 'status', width: 100,
      render: (v: string) => <Tag color={APP_STATUS_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: 'Source', key: 'source', width: 110, align: 'center' as const,
      render: (_: any, r: ApplicationRow) =>
        r.syncStatus === 'SYNCED'
          ? <Tag color="blue" style={{ fontSize: 10 }}>FUSION SYNC</Tag>
          : r.createdBy
            ? <Text type="secondary" style={{ fontSize: 11 }}>{r.createdBy}</Text>
            : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Action', key: 'action', width: 90, align: 'center' as const,
      render: (_: any, r: ApplicationRow) => {
        const isFusionSync = r.syncStatus === 'SYNCED';
        if (r.status === 'Applied' || r.status === 'applied') {
          return (
            <Tooltip title={isFusionSync ? 'Cannot unapply Fusion-synced application' : 'Unapply this prepayment'}>
              <Button size="small" danger type="text" icon={<MinusCircleOutlined />}
                disabled={isFusionSync}
                onClick={() => { if (!isFusionSync) { setUnapplyRecord(r); setUnapplyDate(dayjs()); setUnapplyVisible(true); } }}>
                Unapply
              </Button>
            </Tooltip>
          );
        }
        return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      },
    },
  ];

  // ── Tabs ──────────────────────────────────────────────────────────────────

  const DashboardTab = () => (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8} md={4}>
          <KpiCard title="Prepayment Invoices" value={prepayInvoices.length} color={REDWOOD.info}     icon={<FileTextOutlined />} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard title="Total Prepayment Amt" value={fmt(totalPrepayAmount)} color={REDWOOD.taskBlue} icon={<DollarOutlined />} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard title="Total Applied" value={fmt(totalApplied)} color={REDWOOD.success} icon={<CheckCircleOutlined />} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard title="Available Balance" value={fmt(totalAvailable)} color={REDWOOD.warning} icon={<ExclamationCircleOutlined />} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard title="Applied Applications" value={appliedApps.length} color={REDWOOD.success} icon={<SwapOutlined />} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <KpiCard title="Unapplied" value={unappliedApps.length} color={REDWOOD.neutral400} icon={<MinusCircleOutlined />} />
        </Col>
      </Row>

      {prepayInvoices.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0' }} />
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card size="small" title="Prepayment Utilisation" style={{ borderRadius: 8 }}>
                {[
                  { label: 'Applied',   amount: totalApplied,   color: REDWOOD.success },
                  { label: 'Available', amount: totalAvailable, color: REDWOOD.warning },
                ].map(({ label, amount, color }) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <Row justify="space-between" style={{ marginBottom: 2 }}>
                      <Text style={{ fontSize: 12 }}>{label}</Text>
                      <Text style={{ fontSize: 12, color }}>{fmt(amount)} ({totalPrepayAmount ? Math.round(amount / totalPrepayAmount * 100) : 0}%)</Text>
                    </Row>
                    <Progress percent={totalPrepayAmount ? Math.round(amount / totalPrepayAmount * 100) : 0}
                      showInfo={false} strokeColor={color} size="small" />
                  </div>
                ))}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title="Application Status" style={{ borderRadius: 8 }}>
                {[
                  { label: 'Applied',    count: appliedApps.length,   color: REDWOOD.success },
                  { label: 'Unapplied',  count: unappliedApps.length, color: REDWOOD.warning },
                  { label: 'Cancelled',  count: applications.filter(a => a.status === 'Cancelled' || a.status === 'cancelled').length, color: REDWOOD.error },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <Row justify="space-between" style={{ marginBottom: 2 }}>
                      <Text style={{ fontSize: 12 }}>{label}</Text>
                      <Text style={{ fontSize: 12, color }}>{count}</Text>
                    </Row>
                    <Progress percent={applications.length ? Math.round(count / applications.length * 100) : 0}
                      showInfo={false} strokeColor={color} size="small" />
                  </div>
                ))}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {prepayInvoices.length === 0 && !dataLoading && (
        <Empty description="Run a search to load dashboard statistics" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '40px 0' }} />
      )}
    </div>
  );

  const PrepayInvoicesTab = () => (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{prepayInvoices.length} prepayment invoices</Text>
      </Row>
      <Table
        dataSource={prepayInvoices}
        size="small"
        loading={dataLoading}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
        scroll={{ x: 900 }}
        summary={(data) => {
          const totAmt  = data.reduce((s, r) => s + r.invoiceAmount, 0);
          const totApp  = data.reduce((s, r) => s + r.appliedAmount, 0);
          const totAvail = data.reduce((s, r) => s + r.availableBalance, 0);
          return (
            <Table.Summary.Row style={{ background: '#f5f5f5', fontWeight: 700 }}>
              <Table.Summary.Cell index={0} colSpan={4}><Text strong>Total</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: REDWOOD.info }}>{fmt(totAmt)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmt(totApp)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: REDWOOD.warning }}>{fmt(totAvail)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={7} />
            </Table.Summary.Row>
          );
        }}
        columns={[
          { title: 'Invoice Date', dataIndex: 'invoiceDate', width: 105, sorter: (a, b) => a.invoiceDate.localeCompare(b.invoiceDate), render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('D-MMM-YY') : '—'}</Text> },
          { title: 'Prepayment #', dataIndex: 'invoiceNumber', width: 150, render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text> },
          { title: 'Supplier', dataIndex: 'supplier', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
          { title: 'Site', dataIndex: 'supplierSite', width: 120, render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
          { title: 'Invoice Amt', dataIndex: 'invoiceAmount', width: 115, align: 'right' as const, render: (v: number, r: PrepayInvoiceRow) => <Text style={{ fontSize: 12 }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text> },
          { title: 'Applied', dataIndex: 'appliedAmount', width: 110, align: 'right' as const, render: (v: number) => <Text style={{ fontSize: 12, color: REDWOOD.success }}>{fmt(v)}</Text> },
          {
            title: 'Available',
            dataIndex: 'availableBalance',
            width: 110,
            align: 'right' as const,
            sorter: (a, b) => b.availableBalance - a.availableBalance,
            render: (v: number) => (
              <Text strong style={{ fontSize: 12, color: v > 0 ? REDWOOD.warning : REDWOOD.neutral400 }}>{fmt(v)}</Text>
            ),
          },
          {
            title: '', key: 'action', width: 60, align: 'center' as const,
            render: (_: any, r: PrepayInvoiceRow) => (
              <Tooltip title="View applications for this prepayment">
                <Button size="small" type="text" icon={<EyeOutlined style={{ color: REDWOOD.taskBlue }} />} onClick={() => handleViewDetail(r)} />
              </Tooltip>
            ),
          },
        ]}
      />
    </div>
  );

  const [appStatusFilter, setAppStatusFilter] = useState<string>('All');
  const filteredApps = appStatusFilter === 'All' ? applications : applications.filter(a => a.status === appStatusFilter);

  const ApplicationsTab = () => (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{filteredApps.length} applications</Text>
          <Select size="small" value={appStatusFilter} onChange={setAppStatusFilter} style={{ width: 130 }}>
            <Option value="All">All Status</Option>
            <Option value="Applied">Applied</Option>
            <Option value="Unapplied">Unapplied</Option>
            <Option value="Cancelled">Cancelled</Option>
          </Select>
        </Space>
        <Tag color="blue">{appliedApps.length} Applied | {unappliedApps.length} Unapplied</Tag>
      </Row>
      <Table
        dataSource={filteredApps}
        size="small"
        loading={dataLoading}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
        scroll={{ x: 900 }}
        columns={appColumns(true, true) as any}
        summary={(data) => {
          const tot = (data as ApplicationRow[]).filter(a => a.status === 'Applied' || a.status === 'applied').reduce((s, a) => s + a.appliedAmount, 0);
          return (
            <Table.Summary.Row style={{ background: '#f5f5f5', fontWeight: 700 }}>
              <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total Applied</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmt(tot)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={4} colSpan={2} />
            </Table.Summary.Row>
          );
        }}
      />
    </div>
  );

  // ── Apply tab ─────────────────────────────────────────────────────────────
  const ApplyTab = () => (
    <Row gutter={16} style={{ height: '100%' }}>
      {/* Left: Standard Invoices */}
      <Col xs={24} lg={12}>
        <Card
          size="small"
          title={<Space><FileTextOutlined style={{ color: REDWOOD.primary }} /><Text strong>Standard Invoices</Text><Text type="secondary" style={{ fontSize: 11 }}>Select an invoice to apply a prepayment to</Text></Space>}
          style={{ borderRadius: 8, height: '100%' }}
        >
          <Table
            dataSource={stdInvoices}
            size="small"
            loading={dataLoading}
            rowSelection={{ type: 'radio', selectedRowKeys: selectedStdInvoice ? [selectedStdInvoice.key] : [], onSelect: (r: StandardInvoiceRow) => handleSelectStdInvoice(r) }}
            onRow={(r: StandardInvoiceRow) => ({ onClick: () => handleSelectStdInvoice(r), style: { cursor: 'pointer', background: selectedStdInvoice?.key === r.key ? '#e6f4ff' : undefined } })}
            pagination={{ pageSize: 20, showSizeChanger: false, size: 'small' }}
            scroll={{ y: 300 }}
            columns={[
              { title: 'Invoice #', dataIndex: 'invoiceNumber', render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text> },
              { title: 'Supplier', dataIndex: 'supplier', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
              { title: 'Amount', dataIndex: 'invoiceAmount', width: 110, align: 'right' as const, render: (v: number, r: StandardInvoiceRow) => <Text style={{ fontSize: 12 }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text> },
              { title: 'Applied', dataIndex: 'appliedPrepayments', width: 90, align: 'right' as const, render: (v: number) => v > 0 ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>{fmt(v)}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
            ]}
          />
        </Card>
      </Col>

      {/* Right: Available Prepayments */}
      <Col xs={24} lg={12}>
        <Card
          size="small"
          title={
            <Space>
              <SwapOutlined style={{ color: REDWOOD.taskBlue }} />
              <Text strong>Available Prepayments</Text>
              {selectedStdInvoice && <Text type="secondary" style={{ fontSize: 11 }}>for {selectedStdInvoice.supplier}</Text>}
            </Space>
          }
          style={{ borderRadius: 8, height: '100%' }}
          extra={
            selectedStdInvoice && availPrepays.length > 0 ? (
              <Button type="primary" size="small" icon={<PlusCircleOutlined />} loading={applying}
                disabled={selectedAvailKeys.length === 0}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                onClick={handleApply}>
                Apply ({selectedAvailKeys.length})
              </Button>
            ) : null
          }
        >
          {!selectedStdInvoice ? (
            <Empty description="Select a standard invoice on the left to view available prepayments." image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
          ) : availLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
              <div style={{ marginTop: 8 }}><Text type="secondary">Loading prepayments…</Text></div>
            </div>
          ) : availPrepays.length === 0 ? (
            <Empty description={`No available prepayments for ${selectedStdInvoice.supplier}.`} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
          ) : (
            <>
              {selectedStdInvoice && (
                <Alert type="info" showIcon style={{ marginBottom: 10, fontSize: 11 }}
                  message={`Applying to: ${selectedStdInvoice.invoiceNumber} — ${selectedStdInvoice.supplier} (${selectedStdInvoice.currency} ${fmt(selectedStdInvoice.invoiceAmount)})`} />
              )}
              <Table
                dataSource={availPrepays}
                size="small"
                rowSelection={{
                  selectedRowKeys: selectedAvailKeys,
                  onChange: setSelectedAvailKeys,
                }}
                pagination={false}
                scroll={{ y: 260 }}
                columns={[
                  { title: 'Prepayment #', dataIndex: 'invoiceNumber', render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.taskBlue }}>{v}</Text> },
                  { title: 'Available', dataIndex: 'availableAmount', width: 110, align: 'right' as const, render: (v: number, r: AvailPrepay) => <Text style={{ fontSize: 12, color: REDWOOD.warning }}>{fmt(v)} <Text type="secondary" style={{ fontSize: 10 }}>{r.currency}</Text></Text> },
                  {
                    title: 'To Apply', dataIndex: 'toApply', width: 110,
                    render: (v: number, r: AvailPrepay) => (
                      <InputNumber
                        size="small" min={0.01} max={r.availableAmount} step={0.01}
                        value={v} style={{ width: 100, fontSize: 12 }}
                        onChange={(val) => setAvailPrepays(prev => prev.map(p => p.key === r.key ? { ...p, toApply: val ?? 0 } : p))}
                      />
                    ),
                  },
                  {
                    title: 'Acctg Date', dataIndex: 'accountingDate', width: 120,
                    render: (v: Dayjs, r: AvailPrepay) => (
                      <DatePicker size="small" value={v} format="D-MMM-YYYY" style={{ width: 110 }}
                        onChange={(d) => setAvailPrepays(prev => prev.map(p => p.key === r.key ? { ...p, accountingDate: d ?? dayjs() } : p))} />
                    ),
                  },
                ]}
              />
            </>
          )}
        </Card>
      </Col>
    </Row>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ background: REDWOOD.headerBg, padding: '12px 24px' }}>
        <Space>
          <SwapOutlined style={{ color: '#fff', fontSize: 18 }} />
          <Title level={4} style={{ color: '#fff', margin: 0 }}>Prepayment Applications</Title>
          <Tag color="orange" style={{ fontSize: 11 }}>Payables</Tag>
        </Space>
      </div>

      <Content style={{ padding: '16px 24px' }}>
        {/* Search header */}
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
          <Form form={searchForm} layout="inline" size="small">
            <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 8 }}>
              <Select style={{ width: 220 }} placeholder="Select BU" showSearch allowClear>
                {businessUnits.map(b => <Option key={b.name} value={b.name}>{b.name}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" icon={<SearchOutlined />} loading={dataLoading} onClick={handleSearch}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Search
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {/* Tabs */}
        <Card style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type="card"
            items={[
              {
                key: 'dashboard',
                label: <Space size={4}><InfoCircleOutlined /><span>Dashboard</span></Space>,
                children: <DashboardTab />,
              },
              {
                key: 'prepayments',
                label: (
                  <Space size={4}>
                    <FileTextOutlined />
                    <span>Prepayment Invoices</span>
                    {prepayInvoices.length > 0 && <Badge count={prepayInvoices.filter(r => r.availableBalance > 0).length} style={{ backgroundColor: REDWOOD.warning, fontSize: 10 }} overflowCount={999} />}
                  </Space>
                ),
                children: <PrepayInvoicesTab />,
              },
              {
                key: 'applications',
                label: (
                  <Space size={4}>
                    <SwapOutlined />
                    <span>Applications</span>
                    {applications.length > 0 && <Badge count={applications.length} style={{ backgroundColor: REDWOOD.info, fontSize: 10 }} overflowCount={999} />}
                  </Space>
                ),
                children: <ApplicationsTab />,
              },
              {
                key: 'apply',
                label: <Space size={4}><PlusCircleOutlined style={{ color: REDWOOD.success }} /><span>Apply to Invoice</span></Space>,
                children: <ApplyTab />,
              },
            ]}
          />
        </Card>
      </Content>

      {/* ── Unapply Modal ───────────────────────────────────────────────────── */}
      <Modal
        title={<Space><MinusCircleOutlined style={{ color: REDWOOD.error }} /><span>Unapply Prepayment</span></Space>}
        open={unapplyVisible}
        onCancel={() => !unapplying && setUnapplyVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setUnapplyVisible(false)} disabled={unapplying}>Cancel</Button>
            <Button danger type="primary" loading={unapplying} onClick={handleUnapply}>Unapply</Button>
          </Space>
        }
        width={480}
        destroyOnClose
      >
        {unapplyRecord && (
          <>
            <Alert type="warning" showIcon style={{ marginBottom: 16, fontSize: 12 }}
              message={`This will reverse the application of ${unapplyRecord.prepayNumber} (${unapplyRecord.currency} ${fmt(unapplyRecord.appliedAmount)}) from invoice ${unapplyRecord.invoiceNumber}.`} />
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Prepayment #">{unapplyRecord.prepayNumber}</Descriptions.Item>
              <Descriptions.Item label="Invoice #">{unapplyRecord.invoiceNumber}</Descriptions.Item>
              <Descriptions.Item label="Applied Amount">{fmt(unapplyRecord.appliedAmount)} {unapplyRecord.currency}</Descriptions.Item>
              <Descriptions.Item label="Original Date">{unapplyRecord.accountingDate ? dayjs(unapplyRecord.accountingDate).format('D-MMM-YYYY') : '—'}</Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>Unapply Date</Text>
              <DatePicker value={unapplyDate} onChange={(d) => d && setUnapplyDate(d)} format="D-MMM-YYYY" style={{ width: '100%' }} />
            </div>
          </>
        )}
      </Modal>

      {/* ── Prepayment Detail Drawer ────────────────────────────────────────── */}
      <Drawer
        title={
          detailPrepay ? (
            <Space>
              <EyeOutlined style={{ color: REDWOOD.taskBlue }} />
              <span>Applications for Prepayment: {detailPrepay.invoiceNumber}</span>
            </Space>
          ) : 'Prepayment Details'
        }
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        width={640}
        extra={detailPrepay && (
          <Space>
            <Tag color="blue">{detailPrepay.currency}</Tag>
            <Text>Original: {fmt(detailPrepay.invoiceAmount)}</Text>
            <Text style={{ color: REDWOOD.success }}>Applied: {fmt(detailPrepay.appliedAmount)}</Text>
            <Text style={{ color: detailPrepay.availableBalance > 0 ? REDWOOD.warning : REDWOOD.neutral400 }}>
              Available: {fmt(detailPrepay.availableBalance)}
            </Text>
          </Space>
        )}
      >
        {detailPrepay && (
          <>
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Supplier">{detailPrepay.supplier}</Descriptions.Item>
              <Descriptions.Item label="Supplier Site">{detailPrepay.supplierSite || '—'}</Descriptions.Item>
              <Descriptions.Item label="Invoice Date">{detailPrepay.invoiceDate ? dayjs(detailPrepay.invoiceDate).format('D-MMM-YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Apply After">{detailPrepay.applyAfterDate ? dayjs(detailPrepay.applyAfterDate).format('D-MMM-YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Acctg Status">
                <Tag color={detailPrepay.accountingStatus === 'POSTED' || detailPrepay.accountingStatus === 'Posted' ? 'green' : 'orange'} style={{ fontSize: 10 }}>{detailPrepay.accountingStatus}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Business Unit">{detailPrepay.businessUnit}</Descriptions.Item>
            </Descriptions>

            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                <div style={{ marginTop: 8 }}><Text type="secondary">Loading applications…</Text></div>
              </div>
            ) : detailApps.length === 0 ? (
              <Empty description="No standard invoices have applied this prepayment yet." image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
            ) : (
              <Table
                dataSource={detailApps}
                size="small"
                pagination={false}
                scroll={{ y: 400 }}
                summary={(data) => {
                  const tot = (data as ApplicationRow[]).filter(a => a.status === 'Applied' || a.status === 'applied').reduce((s, a) => s + a.appliedAmount, 0);
                  return (
                    <Table.Summary.Row style={{ background: '#f5f5f5' }}>
                      <Table.Summary.Cell index={0} colSpan={2}><Text strong>Total Applied</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmt(tot)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} colSpan={2} />
                    </Table.Summary.Row>
                  );
                }}
                columns={appColumns(false, true) as any}
              />
            )}
          </>
        )}
      </Drawer>

      {/* ── API Log Modal ────────────────────────────────────────────────────── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.taskBlue }} /><span>API Request Log</span><Tag>{apiLogs.length} calls</Tag></Space>}
        open={apiLogVisible}
        onCancel={() => setApiLogVisible(false)}
        footer={<Space><Button size="small" danger onClick={() => setApiLogs([])}>Clear Log</Button><Button onClick={() => setApiLogVisible(false)}>Close</Button></Space>}
        width={760}
        destroyOnClose={false}
      >
        {apiLogs.length === 0 ? (
          <Empty description="No API calls recorded yet." image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
        ) : (
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {apiLogs.map((log, i) => (
              <div key={i} style={{ marginBottom: 6, padding: '6px 10px', borderRadius: 6,
                background: log.status === 200 ? '#f6ffed' : typeof log.status === 'string' || Number(log.status) >= 400 ? '#fff2f0' : '#e6f4ff',
                border: `1px solid ${log.status === 200 ? '#b7eb8f' : typeof log.status === 'string' || Number(log.status) >= 400 ? '#ffccc7' : '#91d5ff'}`,
              }}>
                <Space size={6}>
                  <Tag color={log.method === 'GET' ? 'blue' : 'purple'} style={{ fontSize: 10 }}>{log.method}</Tag>
                  <Tag color={log.status === 200 ? 'green' : 'red'} style={{ fontSize: 10 }}>{log.status}</Tag>
                  <Text type="secondary" style={{ fontSize: 10 }}>{log.ts}</Text>
                </Space>
                <Text code style={{ fontSize: 10, display: 'block', wordBreak: 'break-all', marginTop: 4 }}>{log.url}</Text>
                {log.response && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, cursor: 'pointer' }}>Response preview</summary>
                    <pre style={{ fontSize: 10, margin: '4px 0 0', background: '#f5f5f5', padding: 6, borderRadius: 4, maxHeight: 80, overflow: 'auto' }}>{log.response}</pre>
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

export default PrepaymentApplications;
