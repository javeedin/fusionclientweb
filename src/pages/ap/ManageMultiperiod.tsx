import React, { useState, useCallback, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import {
  Layout, Card, Form, Select, Input, Button, Space, Typography,
  Table, Tag, Row, Col, Breadcrumb, Tabs, Descriptions, Alert,
  Modal, message, Tooltip, Statistic, Spin, DatePicker, Drawer, Collapse, Popconfirm, Radio,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, CalendarOutlined,
  CheckCircleOutlined, CloseOutlined, SyncOutlined, BookOutlined,
  FileTextOutlined, WarningOutlined, ApiOutlined, CopyOutlined,
  EyeOutlined, DeleteOutlined, FileExcelOutlined, PauseCircleOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { APEX_DB_CONFIG } from '../../config/api.config';
import {
  listMpaInvoices, getMpaSchedule, generateMpaSchedule, markPeriodPosted, suspendMpaSchedules,
  listFusionMpaLines, getFusionMpaDetail, deleteMpaSchedule,
  type MpaInvoiceSummary, type MpaScheduleLine, type MpaInvoiceDetail,
  type FusionMpaLine, type FusionMpaDetail, type FusionMpaSchedulePeriod,
} from '../../services/multiperiod.service';
import {
  createAccounting, fetchLedgerByBusinessUnit, checkGLJournalExists,
  checkAccountingExists,
  type SlaCreatePayload,
} from '../../services/sla.service';
import { postSlaToGL, buildGlJournalPayload, makeBatchName, getGlJournalLines } from '../../services/glPosting.service';
import type { GlPostingOptions } from '../../services/glPosting.service';
import { getConversionRate, type FxRateResult } from '../../services/fx.service';
import { useAuth } from '../../context/AuthContext';
import { useAccountDescriptions } from '../../hooks/useAccountDescriptions';

const { Content } = Layout;
const { Text, Title, Paragraph } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D',
  warning: '#D4A800',
  info:    '#0572CE',
  neutral: '#F7F7F7',
};

const APEX_BU_URL = `${APEX_DB_CONFIG.baseUrl}/gl/businessunits`;

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtAmt = (v: number | null | undefined, currency = 'AED') =>
  v == null ? '—' : `${currency} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Number-only (no currency prefix) — used where currency has its own column.
const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (s: string | null | undefined) =>
  s ? dayjs(s).format('DD MMM YYYY') : '—';

const currentPeriod = () => dayjs().format('MMM-YY');   // e.g. "Apr-26"

// Functional / ledger currency. AED amounts = entered amount × conversion rate.
const FUNCTIONAL_CCY = 'AED';

// Rate date for a schedule line = LAST DAY of the line's period month.
const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const lineRateDate = (line: { periodDate?: string; periodName?: string }): string => {
  const d = line.periodDate ? dayjs(line.periodDate) : null;
  if (d && d.isValid()) return d.endOf('month').format('YYYY-MM-DD');
  // fall back to parsing "MMM-YYYY" / "MMM-YY" without a dayjs parse plugin
  const parts = (line.periodName || '').split('-');
  if (parts.length === 2) {
    const mi = MON3.indexOf(parts[0].slice(0, 3).toLowerCase());
    const yy = parts[1].length === 2 ? 2000 + parseInt(parts[1], 10) : parseInt(parts[1], 10);
    if (mi >= 0 && !isNaN(yy)) return dayjs(new Date(yy, mi + 1, 0)).format('YYYY-MM-DD'); // day 0 of next month
  }
  return dayjs().endOf('month').format('YYYY-MM-DD');
};

// Accrual period is stored as "MMM-YYYY" (e.g. "May-2026"). GL periods use the
// short "MMM-YY" form ("May-26") and the accounting/effective date must fall in
// that period → use the last day of the month (e.g. "2026-05-31").
const accrualPeriodInfo = (periodName: string): { label: string; endDate: string } => {
  const d = dayjs(periodName, 'MMM-YYYY');
  return d.isValid()
    ? { label: d.format('MMM-YY'), endDate: d.endOf('month').format('YYYY-MM-DD') }
    : { label: periodName, endDate: dayjs().format('YYYY-MM-DD') };
};

// Resolve {token} placeholders in a URL string or payload object from a running
// context map (values captured from earlier debug steps). Missing tokens fall
// back to '0' so a single step can still be exercised in isolation.
function resolveAccrualTokens<T>(value: T, ctx: Record<string, any>): T {
  if (typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : '0')) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(v => resolveAccrualTokens(v, ctx)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value as Record<string, any>)) out[k] = resolveAccrualTokens((value as any)[k], ctx);
    return out as unknown as T;
  }
  return value;
}

const statusTag = (status: string) => {
  if (status === 'Posted')     return <Tag color="success" icon={<CheckCircleOutlined />}>Posted</Tag>;
  if (status === 'Not Posted') return <Tag color="warning" icon={<WarningOutlined />}>Not Posted</Tag>;
  if (status === 'Suspended')  return <Tag color="default" icon={<PauseCircleOutlined />} style={{ color: '#8c8c8c', borderColor: '#d9d9d9' }}>Suspended</Tag>;
  if (status === 'Error')      return <Tag color="error">Error</Tag>;
  return <Tag>{status}</Tag>;
};

// ── types ─────────────────────────────────────────────────────────────────────

interface DetailTab {
  key:     string;
  invoiceId: number;
  label:   string;
  detail:  MpaInvoiceDetail | null;
  loading: boolean;
  error:   string | null;
}

// ── component ─────────────────────────────────────────────────────────────────

const ManageMultiperiod: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();

  const [activeTab,    setActiveTab]    = useState('search');
  const [detailTabs,   setDetailTabs]   = useState<DetailTab[]>([]);
  const [searchResult, setSearchResult] = useState<MpaInvoiceSummary[]>([]);
  const [gridSearch,   setGridSearch]   = useState('');   // quick filter across all result columns
  const [mpaStatusFilter, setMpaStatusFilter] = useState<'all'|'open'|'closed'>('open');
  const [searching,    setSearching]    = useState(false);
  const [searchErr,    setSearchErr]    = useState<string | null>(null);
  const [businessUnits, setBusinessUnits] = useState<string[]>([]);
  const [generating,   setGenerating]   = useState<Set<number>>(new Set());
  const [deleting,     setDeleting]     = useState<Set<number>>(new Set());
  const [postingTab,   setPostingTab]   = useState<string | null>(null);
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [confirmTab,   setConfirmTab]   = useState<string | null>(null);
  const [apiModalOpen,       setApiModalOpen]       = useState(false);
  const [lastApiUrl,         setLastApiUrl]         = useState<string | null>(null);
  const [lastApiStatus,      setLastApiStatus]      = useState<'success' | 'error' | null>(null);
  const [lastApiNote,        setLastApiNote]        = useState<string | null>(null);
  const [copiedUrl,          setCopiedUrl]          = useState(false);
  const [acctModalOpen,      setAcctModalOpen]      = useState(false);
  // View-Accounting modal context. Per-period view is keyed by scheduleId (reference2);
  // the "all periods" view queries by invoiceNumber (reference1) + MPA_ACCRUAL (reference5).
  const [acctCtx,            setAcctCtx]            = useState<{ scheduleId?: number; invoiceNumber: string; periodName?: string } | null>(null);
  const [acctMode,           setAcctMode]           = useState<'period' | 'all'>('period');
  const [acctGlLines,        setAcctGlLines]        = useState<any[] | null>(null);   // actual GL journal lines
  const [acctLoading,        setAcctLoading]        = useState(false);
  const [acctApiOpen,        setAcctApiOpen]        = useState(false);   // show the API URL used to fetch the journal

  // ── Post Accrual tab ──────────────────────────────────────────────────────
  const [accrualPeriods,    setAccrualPeriods]    = useState<string[]>([]);
  const [accrualPeriod,     setAccrualPeriod]     = useState<string>('');
  const [accrualLines,      setAccrualLines]      = useState<any[]>([]);
  const [accrualLoading,    setAccrualLoading]    = useState(false);
  const [accrualSelected,    setAccrualSelected]    = useState<number[]>([]);   // selected invoiceIds
  // Post-Accrual modal (select lines / entire month → KPI + per-line status)
  const [postModalOpen,     setPostModalOpen]     = useState(false);
  const [postRows,          setPostRows]          = useState<any[]>([]);
  const [postRunning,       setPostRunning]       = useState(false);
  const [postStatus,        setPostStatus]        = useState<Record<number, { status: string; message: string }>>({});
  const [accrualSearch,      setAccrualSearch]      = useState('');
  const [detailSearch,       setDetailSearch]       = useState<Record<string, string>>({});
  const [mpaSelected,        setMpaSelected]        = useState<Record<string, number[]>>({});  // per-tab selected scheduleIds
  // Per-line conversion rate (invoice ccy -> AED), keyed by scheduleId.
  const [lineRates,          setLineRates]          = useState<Record<number, FxRateResult & { loading?: boolean }>>({});
  // Per-invoice conversion rate (invoice ccy -> AED at invoice date) for the
  // Manage list AED-converted amount columns, keyed by invoiceId.
  const [invRate,            setInvRate]            = useState<Record<number, { rate: number; found: boolean }>>({});
  const [suspendingTab,      setSuspendingTab]      = useState<string | null>(null);
  const [accrualPreviewOpen, setAccrualPreviewOpen] = useState(false);
  const [accrualPreviewLines, setAccrualPreviewLines] = useState<any[]>([]);
  // Accrual Create-Accounting run + debug
  const [accrualAcctRunning, setAccrualAcctRunning] = useState(false);
  const [accrualAcctResults, setAccrualAcctResults] = useState<{ scheduleId: number; invoiceNumber: string; status: 'success'|'skipped'|'error'; message: string }[]>([]);
  const [accrualDebugOpen,   setAccrualDebugOpen]   = useState(false);
  const [accrualDebugSteps,  setAccrualDebugSteps]  = useState<{ step: string; method: string; url: string; payload: any }[]>([]);
  const [accrualStepTest,    setAccrualStepTest]    = useState<Record<number, { loading: boolean; status: number; body: string }>>({});
  // IDs captured from earlier debug steps ({slaHeaderId} / {batchId} / {batchName} / {glHeaderId})
  const [accrualDebugCtx,    setAccrualDebugCtx]    = useState<Record<string, any>>({});
  // Once the step-1 duplicate check reports the journal already exists, later steps are halted.
  const [accrualDebugHalted, setAccrualDebugHalted] = useState(false);

  // ── Fusion data tab ───────────────────────────────────────────────────────
  const [fusionForm]        = Form.useForm();
  const [fusionRows,        setFusionRows]        = useState<FusionMpaLine[]>([]);
  const [fusionLoading,     setFusionLoading]     = useState(false);
  const [fusionErr,         setFusionErr]         = useState<string | null>(null);
  const [fusionSearched,    setFusionSearched]    = useState(false);

  // ── Fusion detail drawer ──────────────────────────────────────────────────
  const [drawerOpen,        setDrawerOpen]        = useState(false);
  const [drawerData,        setDrawerData]        = useState<FusionMpaDetail | null>(null);
  const [drawerLoading,     setDrawerLoading]     = useState(false);
  const [drawerOpenAsOf,    setDrawerOpenAsOf]    = useState<string | undefined>(undefined);

  // ── Bulk generate modal ───────────────────────────────────────────────────
  const [bulkModalOpen,     setBulkModalOpen]     = useState(false);
  const [bulkInvoices,      setBulkInvoices]      = useState<FusionMpaLine[]>([]);
  const [bulkSelected,      setBulkSelected]      = useState<Set<number>>(new Set());
  const [bulkRunning,       setBulkRunning]        = useState(false);
  const [bulkProgress,      setBulkProgress]      = useState<{ done: number; total: number; current: string; results: { invoiceId: number; invoiceNumber: string; status: 'ok' | 'skip' | 'error'; note: string }[] }>({ done: 0, total: 0, current: '', results: [] });

  // Resolve account-combination descriptions for every account shown on this page.
  const allAccountCodes = useMemo(() => {
    const s = new Set<string>();
    fusionRows.forEach((r: any) => { if (r.chargeAccount) s.add(r.chargeAccount); if (r.multiperiodAccrualAccount) s.add(r.multiperiodAccrualAccount); });
    accrualLines.forEach((inv: any) => (inv.periodAllLines || []).forEach((l: any) => { if (l.chargeAccount) s.add(l.chargeAccount); if (l.accrualAccount) s.add(l.accrualAccount); }));
    (drawerData?.lines || []).forEach((ln: any) => (ln.periods || []).forEach((p: any) => { if (p.chargeAccount) s.add(p.chargeAccount); if (p.accrualAccount) s.add(p.accrualAccount); }));
    detailTabs.forEach((t: any) => (t.detail?.lines || []).forEach((l: any) => { if (l.chargeAccount) s.add(l.chargeAccount); if (l.accrualAccount) s.add(l.accrualAccount); }));
    return Array.from(s);
  }, [fusionRows, accrualLines, drawerData, detailTabs]);
  const accountDescs = useAccountDescriptions(allAccountCodes);
  // Render an account combination with its description underneath.
  const renderAcctWithDesc = (code?: string | null, codeFontSize = 11) => (
    <div style={{ lineHeight: 1.3 }}>
      <Text code style={{ fontSize: codeFontSize }}>{code || '—'}</Text>
      {code && accountDescs[code] && (
        <div><Text type="secondary" style={{ fontSize: 10 }} title={accountDescs[code]}>{accountDescs[code]}</Text></div>
      )}
    </div>
  );

  // Load business units
  useEffect(() => {
    fetch(APEX_BU_URL, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => setBusinessUnits((d?.items ?? []).map((i: any) => i.business_unit_name).filter(Boolean)))
      .catch(() => {});
  }, []);

  // ── search ────────────────────────────────────────────────────────────────

  // Invoice-date Corporate rate (invoice ccy -> AED) for every foreign-currency
  // row, deduped by currency+date. Populates invRate so the amount columns and
  // summary tiles can show AED.
  const invCcy = (r: MpaInvoiceSummary) => (r.invoiceCurrency || r.currencyCode || '').toUpperCase();
  const fetchInvoiceRates = async (rows: MpaInvoiceSummary[]) => {
    const foreign = rows.filter(r => invCcy(r) && invCcy(r) !== FUNCTIONAL_CCY);
    if (!foreign.length) return;
    const keyOf = (r: MpaInvoiceSummary) => `${invCcy(r)}|${dayjs(r.invoiceDate).format('YYYY-MM-DD')}`;
    const uniq = new Map<string, { ccy: string; date: string }>();
    foreign.forEach(r => { if (!uniq.has(keyOf(r))) uniq.set(keyOf(r), { ccy: invCcy(r), date: dayjs(r.invoiceDate).format('YYYY-MM-DD') }); });
    const rateByKey: Record<string, { rate: number; found: boolean }> = {};
    await Promise.all([...uniq.entries()].map(async ([k, v]) => {
      const rr = await getConversionRate(v.ccy, FUNCTIONAL_CCY, v.date, 'Corporate');
      rateByKey[k] = { rate: rr.found ? rr.rate : 0, found: rr.found };
    }));
    setInvRate(prev => {
      const nx = { ...prev };
      foreign.forEach(r => { nx[r.invoiceId] = rateByKey[keyOf(r)]; });
      return nx;
    });
  };
  // AED equivalent of an amount for a row (rate 1 for AED; null if rate unknown).
  const invAedRate = (r: MpaInvoiceSummary): number | null => {
    if (!invCcy(r) || invCcy(r) === FUNCTIONAL_CCY) return 1;
    const st = invRate[r.invoiceId];
    return st?.found ? st.rate : null;
  };
  const toAed = (r: MpaInvoiceSummary, amt: number | null | undefined): number | null => {
    const rt = invAedRate(r);
    return rt == null ? null : (amt || 0) * rt;
  };

  const handleSearch = useCallback(async () => {
    const vals = form.getFieldsValue();
    setSearching(true);
    setSearchErr(null);

    // Build URL for debug display
    const BASE_URL = `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod`;
    const q = new URLSearchParams();
    if (vals.invoiceNumber) q.set('invoice_number', vals.invoiceNumber);
    if (vals.supplier)      q.set('supplier',       vals.supplier);
    if (vals.businessUnit)  q.set('business_unit',  vals.businessUnit);
    if (vals.postingStatus) q.set('posting_status', vals.postingStatus);
    const calledUrl = q.toString() ? `${BASE_URL}?${q.toString()}` : BASE_URL;
    setLastApiUrl(calledUrl);

    try {
      const rows = await listMpaInvoices({
        invoiceNumber: vals.invoiceNumber || undefined,
        supplier:      vals.supplier      || undefined,
        businessUnit:  vals.businessUnit  || undefined,
        postingStatus: vals.postingStatus || undefined,
      });
      setSearchResult(rows);
      fetchInvoiceRates(rows);   // convert foreign-currency list totals to AED
      setLastApiStatus('success');
      setLastApiNote(`${rows.length} invoice(s) returned`);
    } catch (e: any) {
      setSearchErr(e?.message ?? 'Search failed');
      setLastApiStatus('error');
      setLastApiNote(e?.message ?? 'Unknown error');
    }
    setSearching(false);
  }, [form]);

  const handleReset = () => { form.resetFields(); setSearchResult([]); setSearchErr(null); };

  // Export the Manage-Multiperiod search results to Excel.
  const exportSearchToExcel = (rows: MpaInvoiceSummary[]) => {
    if (!rows.length) { message.warning('Nothing to export.'); return; }
    const data = rows.map(r => ({
      'Invoice Number':             r.invoiceNumber,
      'Supplier':                   r.supplier,
      'Supplier No.':               r.supplierNumber,
      'Business Unit':              r.businessUnit,
      'Invoice Date':               r.invoiceDate,
      'MPA Start':                  r.mpaStartDate ?? r.minPeriodDate,
      'MPA End':                    r.mpaEndDate ?? r.maxPeriodDate,
      'Currency':                   r.invoiceCurrency || r.currencyCode,
      'FrC (Foreign Invoice Amt)':  invCcy(r) && invCcy(r) !== FUNCTIONAL_CCY ? (r.invoiceAmount ?? '') : '',
      'Conv. Rate':                 invAedRate(r) ?? '',
      'Total Invoice (AED)':        toAed(r, r.invoiceAmount)   ?? '',
      'Total MPA (AED)':            toAed(r, r.totalAmount)     ?? '',
      'Allocated (Posted, AED)':    toAed(r, r.postedAmount)    ?? '',
      'Not Allocated (Not Posted, AED)': toAed(r, r.notPostedAmount) ?? '',
      'Total Lines':                r.totalLines,
      'Open Lines':                 r.openLines,
      'Closed Lines':               r.closedLines,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Multiperiod Accounting');
    XLSX.writeFile(wb, `Multiperiod_Accounting_${dayjs().format('YYYY-MM-DD')}.xlsx`);
  };

  // Export the Post-Accrual schedule lines (current period) to Excel.
  const exportAccrualToExcel = (rows: any[], period: string) => {
    if (!rows.length) { message.warning('No accrual lines to export.'); return; }
    const data = rows.map(r => ({
      'Sched ID':      r.scheduleId,
      'Line':          r.lineNumber,
      'Period':        r.periodName,
      'Invoice Number': r.invoiceNumber,
      'Supplier':      r.supplier,
      'Business Unit': r.businessUnit,
      'Description':   r.description,
      'Currency':     r.currencyCode,
      'Period Amount': r.periodAmt,
      'Charge A/C (Expense DR)': r.chargeAccount,
      'Charge A/C Desc':  accountDescs[r.chargeAccount] || '',
      'Accrual A/C (CR)': r.accrualAccount,
      'Accrual A/C Desc': accountDescs[r.accrualAccount] || '',
      'Invoice Total': r.totalAmount,
      'Posted to Date': r.postedToDate,
      'Accounted':     r.postingStatus === 'Posted' ? 'Accounted' : 'Not Accounted',
      'Posted By':     r.postedBy || '',
      'Posted Date':   r.postedDate || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Post Accrual');
    XLSX.writeFile(wb, `Post_Accrual_${period || dayjs().format('YYYY-MM-DD')}.xlsx`);
  };

  // ── open detail tab ───────────────────────────────────────────────────────

  const openDetail = useCallback(async (row: MpaInvoiceSummary) => {
    const tabKey = `inv-${row.invoiceId}`;
    const existing = detailTabs.find(t => t.key === tabKey);
    if (existing) { setActiveTab(tabKey); return; }

    const newTab: DetailTab = {
      key: tabKey, invoiceId: row.invoiceId,
      label: row.invoiceNumber, detail: null, loading: true, error: null,
    };
    setDetailTabs(prev => [...prev, newTab]);
    setActiveTab(tabKey);

    try {
      const detail = await getMpaSchedule(row.invoiceId);
      setDetailTabs(prev => prev.map(t => t.key === tabKey ? { ...t, detail, loading: false } : t));
    } catch (e: any) {
      setDetailTabs(prev => prev.map(t => t.key === tabKey ? { ...t, loading: false, error: e?.message ?? 'Failed to load' } : t));
    }
  }, [detailTabs]);

  const closeTab = (key: string) => {
    setDetailTabs(prev => prev.filter(t => t.key !== key));
    if (activeTab === key) setActiveTab('search');
  };

  // ── refresh detail ────────────────────────────────────────────────────────

  const refreshDetail = useCallback(async (tabKey: string, invoiceId: number) => {
    setDetailTabs(prev => prev.map(t => t.key === tabKey ? { ...t, loading: true, error: null } : t));
    try {
      const detail = await getMpaSchedule(invoiceId);
      setDetailTabs(prev => prev.map(t => t.key === tabKey ? { ...t, detail, loading: false } : t));
    } catch (e: any) {
      setDetailTabs(prev => prev.map(t => t.key === tabKey ? { ...t, loading: false, error: e?.message ?? 'Failed' } : t));
    }
  }, []);

  // ── suspend selected schedule lines ───────────────────────────────────────

  const handleSuspend = useCallback(async (tabKey: string, invoiceId: number) => {
    const ids = mpaSelected[tabKey] ?? [];
    if (ids.length === 0) return;
    const updatedBy = user?.name || user?.username || 'System';
    setSuspendingTab(tabKey);
    try {
      const r = await suspendMpaSchedules(ids, updatedBy, 'Suspended');
      if (r.rowsUpdated > 0) {
        message.success(`${r.rowsUpdated} line(s) suspended${r.skipped ? ` — ${r.skipped} skipped (already accounted)` : ''}`);
      } else {
        message.warning('Nothing suspended — selected lines are already accounted');
      }
      setMpaSelected(prev => ({ ...prev, [tabKey]: [] }));
      await refreshDetail(tabKey, invoiceId);
    } catch (e: any) {
      message.error(`Suspend failed: ${e?.message}`);
    } finally {
      setSuspendingTab(null);
    }
  }, [mpaSelected, user, refreshDetail]);

  // ── generate schedule ─────────────────────────────────────────────────────

  const handleGenerate = useCallback(async (invoiceId: number, tabKey?: string) => {
    setGenerating(prev => new Set([...prev, invoiceId]));
    try {
      await generateMpaSchedule(invoiceId);
      message.success('Schedule generated');
      if (tabKey) await refreshDetail(tabKey, invoiceId);
      else await handleSearch();
    } catch (e: any) {
      message.error(`Generate failed: ${e?.message}`);
    }
    setGenerating(prev => { const s = new Set(prev); s.delete(invoiceId); return s; });
  }, [handleSearch, refreshDetail]);

  // ── delete MPA schedule ───────────────────────────────────────────────────

  const handleDeleteMpa = useCallback(async (invoiceId: number) => {
    setDeleting(prev => new Set([...prev, invoiceId]));
    try {
      const result = await deleteMpaSchedule(invoiceId);
      if (result.deleted === 0 && result.postedKept === 0) {
        message.warning('No schedule rows found for this invoice');
      } else if (result.deleted === 0 && result.postedKept > 0) {
        message.info(`All ${result.postedKept} period(s) are already Posted — nothing to delete`);
      } else {
        const kept = result.postedKept > 0 ? ` (${result.postedKept} posted period(s) kept)` : '';
        message.success(`Deleted ${result.deleted} pending period(s)${kept}`);
        await handleSearch();
      }
    } catch (e: any) {
      message.error(`Delete failed: ${e?.message}`);
    }
    setDeleting(prev => { const s = new Set(prev); s.delete(invoiceId); return s; });
  }, [handleSearch]);

  // ── post current period ───────────────────────────────────────────────────

  const handlePostConfirm = async () => {
    if (!confirmTab) return;
    const tab = detailTabs.find(t => t.key === confirmTab);
    if (!tab?.detail) return;

    const period = currentPeriod();
    const linesToPost = (tab.detail.lines || []).filter(
      l => l.periodName === period && l.postingStatus === 'Not Posted',
    );
    if (linesToPost.length === 0) {
      message.warning(`No unposted lines for ${period}`);
      setConfirmOpen(false);
      return;
    }

    setConfirmOpen(false);
    setPostingTab(confirmTab);
    const postedBy = user?.name || user?.username || 'System';

    try {
      const ledger = await fetchLedgerByBusinessUnit(tab.detail.businessUnit);
      if (!ledger) throw new Error('Could not find ledger for Business Unit: ' + tab.detail.businessUnit);

      const currency = tab.detail.currencyCode || FUNCTIONAL_CCY;
      // Conversion rate: 1 when the invoice is already in the functional currency;
      // else the Corporate rate at the posting period's month-end.
      let exRate = 1;
      let rateDate = dayjs().format('YYYY-MM-DD');
      if (currency.toUpperCase() !== FUNCTIONAL_CCY) {
        rateDate = lineRateDate(linesToPost[0]);
        const rr = await getConversionRate(currency, FUNCTIONAL_CCY, rateDate, 'Corporate');
        if (!rr.found || !rr.rate) {
          throw new Error(`No Corporate conversion rate ${currency}→${FUNCTIONAL_CCY} as of ${rateDate}. Add the rate first (Manage Currency Rates), then retry.`);
        }
        exRate = rr.rate;
      }
      // Accounted (functional) amount = entered amount × rate.
      const acc = (amt: number) => Math.round((amt || 0) * exRate * 100) / 100;

      const payload: SlaCreatePayload = {
        header: {
          moduleName:     'AP',
          sourceTable:    'RR_AP_INVOICE_MULTIPERIOD_SCHEDULE',
          sourceId:       tab.detail.invoiceId,
          sourceNumber:   `${tab.detail.invoiceNumber}_${period}`,
          sourceType:     'Multiperiod',
          eventTypeCode:  'MULTIPERIOD_ACCRUAL',
          eventDate:      dayjs().format('YYYY-MM-DD'),
          accountingDate: dayjs().format('YYYY-MM-DD'),
          periodName:     period,
          ledgerId:       ledger.ledgerId,
          ledgerName:     ledger.ledgerName,
          currencyCode:   currency,               // entered (invoice) currency
          ledgerCurrency: FUNCTIONAL_CCY,          // accounted (functional) currency
          exchangeRate:   exRate,
          exchangeRateType: 'Corporate',
          businessUnit:   tab.detail.businessUnit,
          description:    `Multiperiod Accrual – ${tab.detail.invoiceNumber} – ${period}` + (exRate !== 1 ? ` (rate ${exRate} @ ${rateDate})` : ''),
          createdBy:      postedBy,
        },
        lines: linesToPost.flatMap((l, idx) => [
          {
            lineNumber:        idx * 2 + 1,
            lineType:          'DR',
            accountingClass:   'EXPENSE',
            accountCombination: l.chargeAccount || '',
            enteredDr:         l.periodAmount,
            enteredCr:         0,
            accountedDr:       acc(l.periodAmount),
            accountedCr:       0,
            currencyCode:      currency,
            exchangeRate:      exRate,
            description:       `${l.description || 'Expense'} – ${period}`,
            sourceLineId:      l.scheduleId,
            sourceLineNumber:  l.lineNumber,
          },
          {
            lineNumber:        idx * 2 + 2,
            lineType:          'CR',
            accountingClass:   'ACCRUAL',
            accountCombination: l.accrualAccount || '',
            enteredDr:         0,
            enteredCr:         l.periodAmount,
            accountedDr:       0,
            accountedCr:       acc(l.periodAmount),
            currencyCode:      currency,
            exchangeRate:      exRate,
            description:       `${l.description || 'Accrual'} – ${period}`,
            sourceLineId:      l.scheduleId,
            sourceLineNumber:  l.lineNumber,
          },
        ]),
      };

      const result = await createAccounting(payload);
      await markPeriodPosted(tab.detail.invoiceId, period, result.headerId, postedBy);
      message.success(`${period} accrual posted — SLA header #${result.headerId}`);
      await refreshDetail(confirmTab, tab.detail.invoiceId);
    } catch (e: any) {
      message.error(`Posting failed: ${e?.message}`);
    }
    setPostingTab(null);
  };

  const openPostConfirm = (tabKey: string) => {
    const tab = detailTabs.find(t => t.key === tabKey);
    if (!tab?.detail) return;

    const period = currentPeriod();

    // Validation 1: invoice must be posted
    const invStatus = tab.detail.invoiceAccountingStatus?.toUpperCase();
    if (!invStatus || invStatus !== 'POSTED') {
      Modal.error({
        title: 'Invoice Not Posted',
        content: (
          <span>
            The invoice must be <strong>accounted and posted</strong> before posting multiperiod
            accruals.
            {tab.detail.invoiceAccountingStatus
              ? ` Current accounting status: ${tab.detail.invoiceAccountingStatus}.`
              : ' No accounting entries found for this invoice.'}
            {' '}Use <em>Refresh</em> if the invoice was recently posted.
          </span>
        ),
      });
      return;
    }

    // Validation 2: current period only
    const currentLines = (tab.detail.lines || []).filter(
      l => l.periodName === period && l.postingStatus === 'Not Posted',
    );
    if (currentLines.length === 0) {
      Modal.error({
        title: 'Cannot Post Accrual',
        content: (
          <span>
            Multiperiod accruals can only be posted for the <strong>current period ({period})</strong>.
            No unposted lines were found for this period.
          </span>
        ),
      });
      return;
    }

    setConfirmTab(tabKey);
    setConfirmOpen(true);
  };

  // ── Accrual Create Accounting (from preview) ───────────────────────────────
  // Group the 2-line-per-schedule preview into one object per schedule.
  const groupAccrualSchedules = () => {
    const map = new Map<number, any>();
    accrualPreviewLines.forEach((l: any) => {
      let g = map.get(l.scheduleId);
      if (!g) {
        g = { scheduleId: l.scheduleId, invoiceId: l.invoiceId, invoiceNumber: l.invoiceNumber,
              businessUnit: l.businessUnit, periodName: l.periodName, drAcct: '', crAcct: '',
              drDesc: '', crDesc: '', amount: 0 };
        map.set(l.scheduleId, g);
      }
      if (l.dr > 0) { g.drAcct = l.account; g.drDesc = l.description; g.amount = l.dr; }
      else          { g.crAcct = l.account; g.crDesc = l.description; }
    });
    return Array.from(map.values());
  };

  const buildAccrualSlaPayload = (g: any, ledger: any, postedBy: string, today: string): SlaCreatePayload => {
    const { label: periodLabel, endDate: acctDate } = accrualPeriodInfo(g.periodName);
    return {
    header: {
      moduleName: 'AP', sourceTable: 'RR_AP_INVOICE_MULTIPERIOD_SCHEDULE',
      sourceId: g.scheduleId, sourceNumber: g.invoiceNumber, sourceType: 'Multiperiod',
      // eventDate = when the accrual was run (today); accountingDate = the GL date,
      // which must fall inside the accrual period → period-end date.
      eventTypeCode: 'MPA_ACCRUAL', eventDate: today, accountingDate: acctDate,
      periodName: periodLabel, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
      currencyCode: 'AED', ledgerCurrency: ledger.ledgerName, exchangeRate: 1,
      businessUnit: g.businessUnit, description: `MPA Accrual — ${g.invoiceNumber} — ${periodLabel}`,
      createdBy: postedBy,
    },
    lines: [
      { lineNumber: 1, lineType: 'DR', accountingClass: 'EXPENSE', accountCombination: g.drAcct || '',
        enteredDr: g.amount, enteredCr: 0, accountedDr: g.amount, accountedCr: 0, currencyCode: 'AED',
        exchangeRate: 1, description: g.drDesc || `Expense — ${periodLabel}`, sourceLineId: g.scheduleId, sourceLineNumber: 1 },
      { lineNumber: 2, lineType: 'CR', accountingClass: 'ACCRUAL', accountCombination: g.crAcct || '',
        enteredDr: 0, enteredCr: g.amount, accountedDr: 0, accountedCr: g.amount, currencyCode: 'AED',
        exchangeRate: 1, description: g.crDesc || `Accrual — ${periodLabel}`, sourceLineId: g.scheduleId, sourceLineNumber: 2 },
    ],
    };
  };

  const buildGlLines = (g: any, acctDate: string) => ([
    { lineType: 'DR' as const, enteredDr: g.amount, enteredCr: 0, accountedDr: g.amount, accountedCr: 0,
      description: g.drDesc || `Expense — ${g.periodName}`, currencyCode: 'AED', accountingDate: acctDate,
      accountCombination: g.drAcct || '', accountingClass: 'EXPENSE', legalEntity: null },
    { lineType: 'CR' as const, enteredDr: 0, enteredCr: g.amount, accountedDr: 0, accountedCr: g.amount,
      description: g.crDesc || `Accrual — ${g.periodName}`, currencyCode: 'AED', accountingDate: acctDate,
      accountCombination: g.crAcct || '', accountingClass: 'ACCRUAL', legalEntity: null },
  ]);

  // Shared GL posting options for an accrual schedule — used by both the live run
  // (postSlaToGL) and the step-by-step debug modal (buildGlJournalPayload) so the
  // journal body shown in step 3 matches exactly what is posted. periodName is the
  // GL "MMM-YY" form and the accounting/effective date is the period-end date.
  const buildAccrualGlOpts = (g: any, ledger: any, postedBy: string, slaHeaderId = 0): GlPostingOptions => {
    const { label: periodLabel, endDate: acctDate } = accrualPeriodInfo(g.periodName);
    return {
      slaHeaderId, sourceNumber: g.invoiceNumber, sourceId: g.scheduleId,
      eventTypeCode: 'MPA_ACCRUAL', periodName: periodLabel, ledgerName: ledger.ledgerName,
      ledgerId: ledger.ledgerId, currency: 'AED', accountingDate: acctDate, legalEntity: '',
      businessUnit: g.businessUnit, jeCategory: 'Accrual', jeSource: 'Payables', batchSource: 'Payables',
      createdBy: postedBy, lines: buildGlLines(g, acctDate),
    };
  };

  const openAccrualDebug = async () => {
    const groups = groupAccrualSchedules();
    if (!groups.length) { message.warning('No schedules to account.'); return; }
    const postedBy = user?.name || user?.username || 'System';
    const today = dayjs().format('YYYY-MM-DD');
    const base = APEX_DB_CONFIG.baseUrl;
    const g = groups[0];  // representative schedule
    const ledger = await fetchLedgerByBusinessUnit(g.businessUnit).catch(() => null);
    const slaPayload = ledger ? buildAccrualSlaPayload(g, ledger, postedBy, today) : { error: `No ledger for BU '${g.businessUnit}'` };
    // Build the exact POST /journals/create body (batch + header + lines with
    // reference1/2/5) via the shared builder — same call runAccrualAccounting makes.
    const glPayload = ledger
      ? buildGlJournalPayload(buildAccrualGlOpts(g, ledger, postedBy), makeBatchName('MPA_ACCRUAL', g.invoiceNumber))
      : { error: `No ledger for BU '${g.businessUnit}'` };
    setAccrualDebugSteps([
      { step: `1 — Duplicate check (Ref2=${g.scheduleId}, Ref5=MPA_ACCRUAL)`, method: 'GET',
        url: `${base}/gl/journals/check?reference1=${encodeURIComponent(g.invoiceNumber)}&reference2=${g.scheduleId}&reference5=MPA_ACCRUAL`, payload: null },
      { step: '2 — Create SLA accounting', method: 'POST', url: `${base}/sla/accounting/create`, payload: slaPayload },
      { step: '3 — Create GL journal', method: 'POST', url: `${base}/journals/create`, payload: glPayload },
      { step: '4 — Post journal to GL', method: 'PUT', url: `${base}/gl/journals/{batchId}/post`, payload: {} },
      { step: '5 — Stamp SLA header POSTED', method: 'POST', url: `${base}/sla/accounting/post`,
        payload: { headerId: '{slaHeaderId}', glBatchId: '{batchId}', glBatchName: '{batchName}', glHeaderId: '{glHeaderId}', postedBy } },
      { step: '6 — Mark MPA schedule posted', method: 'POST', url: `${base}/ap/multiperiod/mark-posted`,
        payload: { scheduleId: g.scheduleId, invoiceId: g.invoiceId, periodName: g.periodName, slaHeaderId: '{slaHeaderId}', postedBy } },
    ]);
    setAccrualStepTest({});
    // Seed the resolver with the (deterministic) batch name; slaHeaderId / batchId /
    // glHeaderId fill in as steps 2 and 3 run. Reset the halt flag for a fresh run.
    setAccrualDebugCtx({ batchName: (glPayload as any)?.batch?.batchName ?? null });
    setAccrualDebugHalted(false);
    setAccrualDebugOpen(true);
  };

  // Post a single accrual schedule end-to-end: ledger → dup check → SLA (reuse or
  // create) → create+post GL journal → mark the schedule posted. Shared by the
  // preview "Create Accounting" run and the Post-Accrual modal.
  const postAccrualSchedule = async (g: any, postedBy: string, today: string): Promise<{ status: 'success'|'skipped'|'error'; message: string }> => {
    const ledger = await fetchLedgerByBusinessUnit(g.businessUnit);
    if (!ledger) return { status: 'error', message: `No ledger for BU '${g.businessUnit}'` };

    // 1. Duplicate check by reference2 (schedule id) + reference5 (MPA_ACCRUAL)
    const exists = await checkGLJournalExists(g.invoiceNumber, g.scheduleId, 'MPA_ACCRUAL');
    if (exists.exists && exists.status === 'P') {
      // Already posted — sync the schedule status in case an earlier run stopped before mark-posted.
      try { await markPeriodPosted(g.invoiceId, g.periodName, exists.headerId ?? 0, postedBy, g.scheduleId); } catch { /* best-effort */ }
      return { status: 'skipped', message: `Already accounted — GL batch ${exists.batchId}` };
    }

    // 2. Reuse an existing SLA header for this schedule, else create one.
    const slaExists = await checkAccountingExists('RR_AP_INVOICE_MULTIPERIOD_SCHEDULE', g.scheduleId, 'MPA_ACCRUAL');
    const slaHeaderId = (slaExists.exists && slaExists.headerId)
      ? slaExists.headerId
      : (await createAccounting(buildAccrualSlaPayload(g, ledger, postedBy, today))).headerId;

    // 3-5. Create + post GL journal, stamp SLA.
    const glRes = await postSlaToGL(buildAccrualGlOpts(g, ledger, postedBy, slaHeaderId));
    if (!glRes.success) return { status: 'error', message: glRes.error || 'GL posting failed' };

    // 6. Mark the schedule posted.
    await markPeriodPosted(g.invoiceId, g.periodName, slaHeaderId, postedBy, g.scheduleId);
    const slaTag = (slaExists.exists && slaExists.headerId) ? ' (SLA reused)' : '';
    return { status: 'success', message: `SLA #${slaHeaderId}${slaTag} — GL ${glRes.batchName}${glRes.skipped ? ' (reused)' : ''}` };
  };

  // Map a flattened Post-Accrual row into the group shape postAccrualSchedule expects.
  const accrualRowToGroup = (r: any) => ({
    scheduleId: r.scheduleId, invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber,
    businessUnit: r.businessUnit, periodName: r.periodName,
    drAcct: r.chargeAccount, crAcct: r.accrualAccount,
    drDesc: r.description, crDesc: `MPA Accrual — ${r.periodName} (${r.invoiceNumber})`,
    amount: r.periodAmt,
  });

  const runAccrualAccounting = async () => {
    const groups = groupAccrualSchedules();
    if (!groups.length) { message.warning('No schedules to account.'); return; }
    const postedBy = user?.name || user?.username || 'System';
    const today = dayjs().format('YYYY-MM-DD');
    setAccrualAcctRunning(true);
    const results: { scheduleId: number; invoiceNumber: string; status: 'success'|'skipped'|'error'; message: string }[] = [];
    for (const g of groups) {
      try {
        const res = await postAccrualSchedule(g, postedBy, today);
        results.push({ scheduleId: g.scheduleId, invoiceNumber: g.invoiceNumber, ...res });
      } catch (e: any) {
        results.push({ scheduleId: g.scheduleId, invoiceNumber: g.invoiceNumber, status: 'error', message: e?.message || 'Unexpected error' });
      }
      setAccrualAcctResults([...results]);
    }
    setAccrualAcctRunning(false);
    const ok = results.filter(r => r.status === 'success').length;
    const skip = results.filter(r => r.status === 'skipped').length;
    const err = results.filter(r => r.status === 'error').length;
    (err ? message.warning : message.success)(`Accrual accounting — ${ok} created, ${skip} skipped, ${err} failed`);
    if (ok > 0 && accrualPeriod) loadAccrualLines(accrualPeriod);
  };

  // ── Post-Accrual modal (select lines / entire month → KPI + per-line status) ──
  const openPostModal = (rows: any[]) => {
    if (!rows.length) { message.warning('No lines to post.'); return; }
    setPostRows(rows);
    const init: Record<number, { status: string; message: string }> = {};
    rows.forEach(r => {
      init[r.scheduleId] = r.postingStatus === 'Posted'
        ? { status: 'accounted', message: 'Already accounted' }
        : r.postingStatus === 'Suspended'
        ? { status: 'skipped', message: 'Suspended — not posted' }
        : { status: 'pending', message: '' };
    });
    setPostStatus(init);
    setPostRunning(false);
    setPostModalOpen(true);
  };

  const runPostAll = async () => {
    const postedBy = user?.name || user?.username || 'System';
    const today = dayjs().format('YYYY-MM-DD');
    // Only 'Not Posted' lines are eligible — accounted and Suspended are excluded.
    const toPost = postRows.filter(r => r.postingStatus === 'Not Posted');
    if (!toPost.length) { message.info('No postable lines (already accounted or suspended).'); return; }
    setPostRunning(true);
    for (const r of toPost) {
      setPostStatus(prev => ({ ...prev, [r.scheduleId]: { status: 'posting', message: 'Posting…' } }));
      try {
        const res = await postAccrualSchedule(accrualRowToGroup(r), postedBy, today);
        setPostStatus(prev => ({ ...prev, [r.scheduleId]: res }));
      } catch (e: any) {
        setPostStatus(prev => ({ ...prev, [r.scheduleId]: { status: 'error', message: e?.message || 'Unexpected error' } }));
      }
    }
    setPostRunning(false);
    if (accrualPeriod) loadAccrualLines(accrualPeriod);
  };

  // Run a single debug step live from the debug modal. Placeholders like
  // {slaHeaderId} / {batchId} / {batchName} / {glHeaderId} are resolved from IDs
  // captured by earlier steps, and each step feeds its own IDs back into the
  // context. Once the step-1 duplicate check reports the journal already exists,
  // the remaining steps are halted.
  const runAccrualDebugStep = async (idx: number) => {
    const s = accrualDebugSteps[idx];
    if (!s) return;
    const isDupCheck = s.url.includes('/gl/journals/check');
    if (accrualDebugHalted && !isDupCheck) {
      message.warning('Journal already exists — remaining steps are halted. Re-open the debug modal to reset.');
      return;
    }
    setAccrualStepTest(prev => ({ ...prev, [idx]: { loading: true, status: 0, body: '' } }));
    try {
      const url     = resolveAccrualTokens(s.url, accrualDebugCtx);
      const payload = s.payload ? resolveAccrualTokens(s.payload, accrualDebugCtx) : null;

      // Step 2 (Create SLA): don't create a duplicate — if an SLA header already
      // exists for this schedule, reuse it and skip the POST.
      if (s.url.includes('/sla/accounting/create') && payload?.header?.sourceId != null) {
        const h = payload.header;
        const chk = await checkAccountingExists(h.sourceTable, h.sourceId, h.eventTypeCode);
        if (chk.exists && chk.headerId) {
          setAccrualDebugCtx(prev => ({ ...prev, slaHeaderId: chk.headerId }));
          setAccrualStepTest(prev => ({ ...prev, [idx]: { loading: false, status: 200,
            body: `SLA already exists for schedule ${h.sourceId} — reusing headerId ${chk.headerId} (accounting ${chk.accountingStatus ?? '—'}, posting ${chk.postingStatus ?? '—'}). No duplicate created.\n\n${JSON.stringify(chk, null, 2)}` } }));
          message.info(`SLA already exists — reusing header #${chk.headerId} (no duplicate created).`);
          return;
        }
      }

      const hasBody = s.method === 'POST' || s.method === 'PUT';
      const res = await fetch(url, {
        method: s.method,
        headers: hasBody ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: hasBody && payload && !payload.error ? JSON.stringify(payload) : undefined,
      });
      const text = await res.text();
      let data: any = null, pretty = text;
      try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* not json */ }
      setAccrualStepTest(prev => ({ ...prev, [idx]: { loading: false, status: res.status, body: pretty } }));

      // Capture IDs from each step so later steps resolve to real numbers.
      if (data && res.ok) {
        if (isDupCheck) {
          if (data.exists) {
            setAccrualDebugCtx(prev => ({ ...prev,
              batchId:    data.batchId  ?? prev.batchId,
              glHeaderId: data.headerId ?? prev.glHeaderId }));
            setAccrualDebugHalted(true);
            message.warning(`Journal already exists (GL batch ${data.batchId ?? '—'}, status ${data.status ?? '—'}) — remaining steps halted.`);
          }
        } else if (s.url.includes('/sla/accounting/create')) {
          if (data.headerId != null) setAccrualDebugCtx(prev => ({ ...prev, slaHeaderId: data.headerId }));
        } else if (s.url.includes('/journals/create')) {
          const batchId    = data.jeBatchId  ?? data.je_batch_id  ?? data.batchId  ?? null;
          const glHeaderId = data.jeHeaderId ?? data.je_header_id ?? data.headerId ?? null;
          const batchName  = (payload as any)?.batch?.batchName ?? null;
          setAccrualDebugCtx(prev => ({ ...prev,
            batchId:    batchId    ?? prev.batchId,
            glHeaderId: glHeaderId ?? prev.glHeaderId,
            batchName:  batchName  ?? prev.batchName }));
        }
      }
    } catch (e: any) {
      setAccrualStepTest(prev => ({ ...prev, [idx]: { loading: false, status: 0, body: e?.message ?? 'Network error' } }));
    }
  };

  // ── view accounting ───────────────────────────────────────────────────────

  // Load the actual GL journal lines for a given context + mode — read straight
  // from the posted journal (GET /gl/journals/lines), not the SLA staging tables.
  //  • 'period' → the single period's journal (reference2 = scheduleId)
  //  • 'all'    → every period's journal for the invoice (reference1 = invoiceNumber)
  // Both scoped to reference5 = MPA_ACCRUAL.
  const loadAcctData = useCallback(async (ctx: { scheduleId?: number; invoiceNumber: string }, mode: 'period' | 'all') => {
    setAcctLoading(true);
    setAcctGlLines(null);
    try {
      const res = await getGlJournalLines(
        mode === 'period' && ctx.scheduleId != null
          ? { reference2: ctx.scheduleId, reference5: 'MPA_ACCRUAL' }
          : { reference1: ctx.invoiceNumber, reference5: 'MPA_ACCRUAL' }
      );
      setAcctGlLines(res.items);
    } catch (e: any) {
      message.error(`Failed to load journal: ${e?.message}`);
      setAcctGlLines([]);
    }
    setAcctLoading(false);
  }, []);

  const openAccountingPeriod = useCallback((scheduleId: number, invoiceNumber: string, periodName?: string) => {
    const ctx = { scheduleId, invoiceNumber, periodName };
    setAcctCtx(ctx); setAcctMode('period'); setAcctModalOpen(true);
    loadAcctData(ctx, 'period');
  }, [loadAcctData]);

  const openAccountingAll = useCallback((invoiceNumber: string) => {
    const ctx = { invoiceNumber };
    setAcctCtx(ctx); setAcctMode('all'); setAcctModalOpen(true);
    loadAcctData(ctx, 'all');
  }, [loadAcctData]);

  // Toggle inside the modal between the single period and all periods.
  const switchAcctMode = useCallback((mode: 'period' | 'all') => {
    if (!acctCtx) return;
    setAcctMode(mode);
    loadAcctData(acctCtx, mode);
  }, [acctCtx, loadAcctData]);

  // ── fusion data search ────────────────────────────────────────────────────

  const handleFusionSearch = useCallback(async () => {
    const vals = fusionForm.getFieldsValue();
    setFusionLoading(true);
    setFusionErr(null);
    try {
      const rows = await listFusionMpaLines({
        invoiceNumber:   vals.invoiceNumber   || undefined,
        supplier:        vals.supplier        || undefined,
        businessUnit:    vals.businessUnit    || undefined,
        lineDescription: vals.lineDescription || undefined,
        openAsOf:        vals.openAsOf ? (vals.openAsOf as any).format('YYYY-MM-DD') : undefined,
      });
      setFusionRows(rows);
      setFusionSearched(true);
    } catch (e: any) {
      setFusionErr(e?.message ?? 'Search failed');
    }
    setFusionLoading(false);
  }, [fusionForm]);

  // ── Accrual period helpers ────────────────────────────────────────────────

  const loadAccrualPeriods = useCallback(async () => {
    setAccrualLoading(true);
    try {
      const open = await listMpaInvoices({ postingStatus: 'Not Posted' });
      const dates = open.flatMap((r: MpaInvoiceSummary) => [r.minPeriodDate, r.maxPeriodDate]).filter(Boolean) as string[];
      if (dates.length === 0) { setAccrualPeriods([]); setAccrualLoading(false); return; }
      const start = dayjs(dates.reduce((a, b) => a < b ? a : b));
      const end = dayjs(dates.reduce((a, b) => a > b ? a : b));
      const periods: string[] = [];
      let cur = start.startOf('month');
      while (!cur.isAfter(end, 'month')) {
        periods.push(cur.format('MMM-YYYY'));
        cur = cur.add(1, 'month');
      }
      setAccrualPeriods(periods);
      if (periods.length > 0 && !accrualPeriod) {
        setAccrualPeriod(periods[0]);
        await loadAccrualLines(periods[0]);
      }
    } catch (e: any) {
      message.error('Failed to load periods: ' + e?.message);
    }
    setAccrualLoading(false);
  }, [accrualPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAccrualLines = useCallback(async (period: string) => {
    if (!period) return;
    setAccrualLoading(true);
    try {
      // First get summaries where period falls within min/max range and has open lines
      const all = await listMpaInvoices({});
      const periodDate = dayjs(period, 'MMM-YYYY');
      const candidates = (all as MpaInvoiceSummary[]).filter(r => {
        const min = dayjs(r.minPeriodDate);
        const max = dayjs(r.maxPeriodDate);
        return !periodDate.isBefore(min, 'month') && !periodDate.isAfter(max, 'month');
      });

      // Fetch full schedule per invoice to get per-period amounts
      const enriched = await Promise.all(
        candidates.map(async (inv) => {
          try {
            const detail = await getMpaSchedule(inv.invoiceId);
            const periodLines   = detail.lines.filter(l => dayjs(l.periodDate).format('MMM-YYYY') === period);
            const periodAmt     = periodLines.reduce((s, l) => s + (l.periodAmount || 0), 0);
            const periodPosted  = periodLines.filter(l => l.postingStatus === 'Posted').reduce((s, l) => s + (l.periodAmount || 0), 0);
            const periodOpen    = periodLines.filter(l => l.postingStatus === 'Not Posted').reduce((s, l) => s + (l.periodAmount || 0), 0);
            const postedToDate  = detail.lines.filter(l => l.postingStatus === 'Posted').reduce((s, l) => s + (l.periodAmount || 0), 0);
            const totalScheduled = detail.lines.reduce((s, l) => s + (l.periodAmount || 0), 0);
            const periodNotPostedLines = periodLines.filter(l => l.postingStatus === 'Not Posted');
            return {
              ...inv,
              periodAmt,
              periodPosted,
              periodOpen,
              postedToDate,
              totalScheduled,
              hasPeriodLines: periodLines.length > 0,
              hasPeriodOpen: periodOpen > 0,
              periodNotPostedLines,
              periodAllLines: periodLines,   // both posted + not-posted, for the Accounted column
            };
          } catch {
            return { ...inv, periodAmt: 0, periodPosted: 0, periodOpen: 0, postedToDate: 0, totalScheduled: inv.totalAmount, hasPeriodLines: false, hasPeriodOpen: false, periodNotPostedLines: [], periodAllLines: [] };
          }
        })
      );
      // Only show invoices that actually have lines in this period
      setAccrualLines(enriched.filter(r => r.hasPeriodLines));
    } catch (e: any) {
      message.error('Failed to load accrual lines: ' + e?.message);
    }
    setAccrualLoading(false);
  }, []);

  const openBulkModal = useCallback(() => {
    const seen = new Set<number>();
    const pending = fusionRows.filter(r => {
      if (r.scheduleGenerated || seen.has(r.invoiceId)) return false;
      seen.add(r.invoiceId);
      return true;
    });
    setBulkInvoices(pending);
    setBulkSelected(new Set(pending.map(r => r.invoiceId)));
    setBulkProgress({ done: 0, total: 0, current: '', results: [] });
    setBulkRunning(false);
    setBulkModalOpen(true);
  }, [fusionRows]);

  const handleBulkGenerate = useCallback(async () => {
    const toProcess = bulkInvoices.filter(r => bulkSelected.has(r.invoiceId));
    if (toProcess.length === 0) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: toProcess.length, current: '', results: [] });
    const results: { invoiceId: number; invoiceNumber: string; status: 'ok' | 'skip' | 'error'; note: string }[] = [];
    for (let i = 0; i < toProcess.length; i++) {
      const row = toProcess[i];
      setBulkProgress(p => ({ ...p, current: `${row.invoiceNumber} (${row.supplier})`, done: i }));
      try {
        const detail = await getMpaSchedule(row.invoiceId);
        if (detail.lines.length > 0) {
          results.push({ invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber, status: 'skip', note: `Already has ${detail.lines.length} schedule line(s)` });
        } else {
          await generateMpaSchedule(row.invoiceId);
          results.push({ invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber, status: 'ok', note: 'Schedule generated' });
        }
      } catch (e: any) {
        results.push({ invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber, status: 'error', note: e?.message || 'Failed' });
      }
      setBulkProgress(p => ({ ...p, done: i + 1, results: [...results] }));
    }
    setBulkRunning(false);
    handleFusionSearch();
  }, [bulkInvoices, bulkSelected, handleFusionSearch]);

  const openFusionDetail = useCallback(async (invoiceId: number, openAsOf?: string) => {
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerData(null);
    setDrawerOpenAsOf(openAsOf);
    try {
      const detail = await getFusionMpaDetail(invoiceId, openAsOf);
      setDrawerData(detail);
    } catch (e: any) {
      message.error(`Failed to load detail: ${e?.message}`);
      setDrawerOpen(false);
    }
    setDrawerLoading(false);
  }, []);

  const refreshDrawer = useCallback(async () => {
    if (!drawerData) return;
    setDrawerLoading(true);
    try {
      const detail = await getFusionMpaDetail(drawerData.invoiceId, drawerOpenAsOf);
      setDrawerData(detail);
    } catch (e: any) {
      message.error(`Refresh failed: ${e?.message}`);
    }
    setDrawerLoading(false);
  }, [drawerData, drawerOpenAsOf]);

  const fusionColumns: ColumnsType<FusionMpaLine> = [
    {
      title: 'Invoice Number', dataIndex: 'invoiceNumber', width: 150, fixed: 'left' as const,
      render: (v, rec) => {
        const openAsOf = fusionForm.getFieldValue('openAsOf')?.format?.('YYYY-MM-DD');
        return (
          <Button type="link" size="small" style={{ padding: 0 }}
            onClick={() => openFusionDetail(rec.invoiceId, openAsOf)}>
            {v}
          </Button>
        );
      },
    },
    {
      title: 'Invoice Date', dataIndex: 'invoiceDate', width: 110,
      render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    { title: 'Supplier', dataIndex: 'supplier', ellipsis: true, width: 200 },
    { title: 'Supplier No.', dataIndex: 'supplierNumber', width: 110 },
    { title: 'Business Unit', dataIndex: 'businessUnit', width: 160, ellipsis: true },
    {
      title: 'Invoice Amount', dataIndex: 'invoiceAmount', width: 140, align: 'right' as const,
      render: (v, rec) => <Text strong style={{ fontSize: 12 }}>{fmtAmt(v, rec.invoiceCurrency)}</Text>,
    },
    { title: 'Line', dataIndex: 'lineNumber', width: 55, align: 'center' as const },
    {
      title: 'Line Amount', dataIndex: 'lineAmount', width: 130, align: 'right' as const,
      render: (v, rec) => <Text style={{ fontSize: 12 }}>{fmtAmt(v, rec.invoiceCurrency)}</Text>,
    },
    { title: 'Line Description', dataIndex: 'lineDescription', ellipsis: true, width: 200 },
    {
      title: 'MPA Start', dataIndex: 'multiperiodStartDate', width: 110,
      render: v => <Text style={{ fontSize: 12, color: REDWOOD.info }}>{fmtDate(v)}</Text>,
    },
    {
      title: 'MPA End', dataIndex: 'multiperiodEndDate', width: 110,
      render: v => <Text style={{ fontSize: 12, color: REDWOOD.info }}>{fmtDate(v)}</Text>,
    },
    {
      title: 'Charge A/C', dataIndex: 'chargeAccount', width: 210,
      render: v => renderAcctWithDesc(v),
    },
    {
      title: 'Accrual A/C', dataIndex: 'multiperiodAccrualAccount', width: 210,
      render: v => renderAcctWithDesc(v),
    },
    {
      title: 'Schedule', dataIndex: 'scheduleGenerated', width: 100, align: 'center' as const,
      render: v => v
        ? <Tag color="success" icon={<CheckCircleOutlined />}>Generated</Tag>
        : <Tag color="default">Pending</Tag>,
    },
    {
      title: 'Accounting', width: 140, align: 'center' as const,
      render: (_, rec) => {
        const posted = rec.postedAmount || 0;
        if (posted <= 0) return <Tag color="default">Not Accounted</Tag>;
        if ((rec.pendingAmount || 0) > 0)
          return <Tooltip title={`${fmtAmt(posted, rec.invoiceCurrency)} of ${fmtAmt(rec.totalScheduled, rec.invoiceCurrency)} accounted`}><Tag color="gold">Partially Accounted</Tag></Tooltip>;
        return <Tag color="success" icon={<CheckCircleOutlined />}>Accounted</Tag>;
      },
    },
    {
      title: 'Action', width: 230, fixed: 'right' as const,
      render: (_, rec) => {
        const openAsOf = fusionForm.getFieldValue('openAsOf')?.format?.('YYYY-MM-DD');
        return (
          <Space size={4}>
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => openFusionDetail(rec.invoiceId, openAsOf)}
            >
              Detail
            </Button>
            {(rec.postedAmount || 0) > 0 && (
              <Tooltip title="View all periods' accounting journals">
                <Button
                  size="small"
                  icon={<BookOutlined />}
                  onClick={() => openAccountingAll(rec.invoiceNumber)}
                >
                  Accounting
                </Button>
              </Tooltip>
            )}
            {!rec.scheduleGenerated && (
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={generating.has(rec.invoiceId)}
                onClick={() => handleGenerate(rec.invoiceId)}
              >
                Generate
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  // ── search columns ────────────────────────────────────────────────────────

  const searchColumns: ColumnsType<MpaInvoiceSummary> = [
    {
      title: 'Invoice Number',
      dataIndex: 'invoiceNumber',
      width: 160,
      sorter: (a, b) => String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''), undefined, { numeric: true }),
      render: (v, rec) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openDetail(rec)}>{v}</Button>
      ),
    },
    { title: 'Supplier',       dataIndex: 'supplier',      ellipsis: true },
    { title: 'Business Unit',  dataIndex: 'businessUnit',  width: 180, ellipsis: true },
    {
      title: 'Invoice Date', dataIndex: 'invoiceDate', width: 110,
      sorter: (a, b) => dayjs(a.invoiceDate).valueOf() - dayjs(b.invoiceDate).valueOf(),
      defaultSortOrder: 'descend' as const,
      render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: 'MPA Start – End', width: 175,
      render: (_, rec) => (
        <Text style={{ fontSize: 12 }}>
          {fmtDate(rec.mpaStartDate ?? rec.minPeriodDate)} – {fmtDate(rec.mpaEndDate ?? rec.maxPeriodDate)}
        </Text>
      ),
    },
    {
      title: 'Schedules', width: 160,
      render: (_, rec) => (
        <Space size={6}>
          <Tag style={{ fontSize: 11 }}>Total: {rec.totalLines ?? 0}</Tag>
          <Tag color="success" style={{ fontSize: 11 }}>Closed: {rec.closedLines ?? 0}</Tag>
          <Tag color="warning" style={{ fontSize: 11 }}>Open: {rec.openLines ?? 0}</Tag>
        </Space>
      ),
    },
    {
      title: 'Currency', key: 'currency', width: 80, align: 'center' as const,
      render: (_: any, rec) => {
        const ccy = rec.invoiceCurrency || rec.currencyCode || '';
        const foreign = ccy && ccy.toUpperCase() !== FUNCTIONAL_CCY;
        return <Tag color={foreign ? 'blue' : 'default'} style={{ fontSize: 11, fontWeight: foreign ? 600 : 400 }}>{ccy || '—'}</Tag>;
      },
    },
    {
      title: <Tooltip title="Foreign-currency invoice amount (invoice currency)">FrC</Tooltip>,
      key: 'frc', width: 140, align: 'right' as const,
      render: (_: any, rec) => {
        const ccy = rec.invoiceCurrency || rec.currencyCode || '';
        if (!ccy || ccy.toUpperCase() === FUNCTIONAL_CCY) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        return <Text style={{ fontSize: 12, color: REDWOOD.info }}>{fmtAmt(rec.invoiceAmount, ccy)}</Text>;
      },
    },
    {
      title: 'Total Invoice (AED)', dataIndex: 'invoiceAmount', width: 140, align: 'right' as const,
      render: (v, rec) => {
        const a = toAed(rec, v);
        if (a == null) return <Tooltip title="Fetching invoice-date rate…"><Text type="secondary" style={{ fontSize: 12 }}>…</Text></Tooltip>;
        return <Text strong style={{ fontSize: 12 }}>{fmtNum(a)}</Text>;
      },
    },
    {
      title: 'Total MPA (AED)', dataIndex: 'totalAmount', width: 130, align: 'right' as const,
      render: (v, rec) => {
        const a = toAed(rec, v);
        return a == null ? <Text type="secondary" style={{ fontSize: 12 }}>…</Text> : <Text style={{ fontSize: 12 }}>{fmtNum(a)}</Text>;
      },
    },
    {
      title: 'Allocated (Posted, AED)', dataIndex: 'postedAmount', width: 150, align: 'right' as const,
      render: (v, rec) => {
        const a = toAed(rec, v);
        if (a == null) return <Text type="secondary" style={{ fontSize: 12 }}>…</Text>;
        return a > 0 ? <Text style={{ color: REDWOOD.success, fontSize: 12 }}>{fmtNum(a)}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
      },
    },
    {
      title: 'Not Allocated (Not Posted, AED)', dataIndex: 'notPostedAmount', width: 170, align: 'right' as const,
      render: (v, rec) => {
        const a = toAed(rec, v);
        if (a == null) return <Text type="secondary" style={{ fontSize: 12 }}>…</Text>;
        return a > 0 ? <Text type="warning" style={{ fontSize: 12 }}>{fmtNum(a)}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
      },
    },
    {
      title: 'Actions', width: 140,
      render: (_, rec) => (
        <Space size={4}>
          <Button size="small" type="primary" onClick={() => openDetail(rec)}>View</Button>
          <Popconfirm
            title="Delete MPA Schedule"
            description={`Delete all pending (not-posted) schedule rows for invoice ${rec.invoiceNumber}?`}
            onConfirm={() => handleDeleteMpa(rec.invoiceId)}
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleting.has(rec.invoiceId)}
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── conversion rates ──────────────────────────────────────────────────────

  // Fetch the conversion rate for ONE line (invoice ccy -> AED, Corporate, at
  // the line's period month-end).
  const fetchLineRate = async (line: MpaScheduleLine, invoiceCcy: string) => {
    const sid = line.scheduleId;
    if (!invoiceCcy || invoiceCcy.toUpperCase() === FUNCTIONAL_CCY) {
      setLineRates(prev => ({ ...prev, [sid]: { rate: 1, found: true, rateDate: lineRateDate(line), rateType: 'Corporate' } }));
      return;
    }
    setLineRates(prev => ({ ...prev, [sid]: { ...(prev[sid] || { rate: 0, found: false }), loading: true } }));
    const r = await getConversionRate(invoiceCcy, FUNCTIONAL_CCY, lineRateDate(line), 'Corporate');
    setLineRates(prev => ({ ...prev, [sid]: { ...r, loading: false } }));
    if (!r.found) message.warning(r.error || `No Corporate rate for ${invoiceCcy}→${FUNCTIONAL_CCY}`);
  };

  // Fetch rates for ALL lines of a tab (one call per distinct period month-end).
  const fetchAllLineRates = async (lines: MpaScheduleLine[], invoiceCcy: string) => {
    const functional = !invoiceCcy || invoiceCcy.toUpperCase() === FUNCTIONAL_CCY;
    const dates = [...new Set(lines.map(l => lineRateDate(l)))];
    const rateByDate: Record<string, FxRateResult> = {};
    await Promise.all(dates.map(async (dt) => {
      rateByDate[dt] = functional
        ? { rate: 1, found: true, rateDate: dt, rateType: 'Corporate' }
        : await getConversionRate(invoiceCcy, FUNCTIONAL_CCY, dt, 'Corporate');
    }));
    setLineRates(prev => {
      const nx = { ...prev };
      lines.forEach(l => { nx[l.scheduleId] = { ...rateByDate[lineRateDate(l)], loading: false }; });
      return nx;
    });
    const missing = lines.filter(l => !rateByDate[lineRateDate(l)]?.found).length;
    if (missing) message.warning(`${missing} line(s) have no ${invoiceCcy}→${FUNCTIONAL_CCY} rate for their period month-end.`);
  };

  // ── detail schedule columns ───────────────────────────────────────────────

  const buildScheduleColumns = (lines: MpaScheduleLine[], currencyCode: string): ColumnsType<MpaScheduleLine> => {
    const isFunctional = !currencyCode || currencyCode.toUpperCase() === FUNCTIONAL_CCY;
    const periodOptions = [...new Set(lines.map(l => l.periodName))].sort().map(v => ({ text: v, value: v }));
    return [
    {
      title: 'Period', dataIndex: 'periodName', width: 110,
      filters: periodOptions,
      onFilter: (value: any, rec) => rec.periodName === value,
      render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Line', dataIndex: 'lineNumber', width: 55, align: 'center' as const },
    { title: 'Description', dataIndex: 'description', ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v}</Text></Tooltip> },
    {
      title: 'Original Amt', dataIndex: 'originalAmount', width: 140, align: 'right' as const,
      render: v => <Text style={{ fontSize: 12 }}>{fmtAmt(v, currencyCode)}</Text>,
    },
    {
      title: 'Period Amt', dataIndex: 'periodAmount', width: 140, align: 'right' as const,
      render: v => <Text strong style={{ fontSize: 12 }}>{fmtAmt(v, currencyCode)}</Text>,
    },
    {
      title: 'Conv. Rate', width: 120, align: 'right' as const,
      render: (_, rec) => {
        if (isFunctional) return <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>1.000000</Text>;
        const r = lineRates[rec.scheduleId];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            {r?.found
              ? <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.info }}>{r.rate.toFixed(6)}</Text>
              : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>}
            <Button size="small" type="link" loading={r?.loading} icon={<SyncOutlined />}
              onClick={() => fetchLineRate(rec, currencyCode)}
              style={{ fontSize: 10, height: 18, padding: 0 }}>
              {r?.found ? 'Refresh' : 'Fetch'}
            </Button>
            {r?.rateDate && <Text type="secondary" style={{ fontSize: 9 }}>{r.rateDate}</Text>}
          </div>
        );
      },
    },
    {
      title: `${FUNCTIONAL_CCY} Amount`, width: 140, align: 'right' as const,
      render: (_, rec) => {
        const rate = isFunctional ? 1 : (lineRates[rec.scheduleId]?.found ? lineRates[rec.scheduleId].rate : null);
        if (rate == null) return <Text type="secondary" style={{ fontSize: 11 }}>fetch rate</Text>;
        return <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{fmtAmt((rec.periodAmount || 0) * rate, FUNCTIONAL_CCY)}</Text>;
      },
    },
    {
      title: 'Charge A/C (Dr)', dataIndex: 'chargeAccount', width: 210,
      render: v => renderAcctWithDesc(v, 11),
    },
    {
      title: 'Accrual A/C (Cr)', dataIndex: 'accrualAccount', width: 210,
      render: v => renderAcctWithDesc(v, 11),
    },
    {
      title: 'Status', dataIndex: 'postingStatus', width: 120,
      render: v => statusTag(v),
    },
    {
      title: 'Posted By / Date', width: 150,
      render: (_, rec) => rec.postingStatus === 'Posted'
        ? <Text type="secondary" style={{ fontSize: 11 }}>{rec.postedBy}<br />{fmtDate(rec.postedDate)}</Text>
        : null,
    },
  ];};

  // ── render detail tab content ─────────────────────────────────────────────

  const renderDetail = (tab: DetailTab) => {
    if (tab.loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
    if (tab.error)   return <Alert type="error" showIcon message="Failed to load schedule" description={tab.error} style={{ margin: 24 }} />;
    if (!tab.detail) return null;

    const d = tab.detail;
    const period = currentPeriod();
    const currentLines = (d.lines || []).filter(l => l.periodName === period && l.postingStatus === 'Not Posted');
    const hasCurrentPeriod = currentLines.length > 0;
    const isPosting = postingTab === tab.key;
    const isInvoicePosted = d.invoiceAccountingStatus?.toUpperCase() === 'POSTED';
    const canPost = hasCurrentPeriod && isInvoicePosted;

    const postDisabledReason = !isInvoicePosted
      ? `Invoice must be Posted before posting accruals (current: ${d.invoiceAccountingStatus || 'Not Accounted'})`
      : !hasCurrentPeriod
      ? `No unposted lines for the current period (${period})`
      : undefined;

    const totalAmt      = d.lines.reduce((s, l) => s + (l.periodAmount || 0), 0);
    const postedAmt     = d.lines.filter(l => l.postingStatus === 'Posted').reduce((s, l) => s + l.periodAmount, 0);
    const notPostedAmt  = d.lines.filter(l => l.postingStatus === 'Not Posted').reduce((s, l) => s + l.periodAmount, 0);

    return (
      <div style={{ padding: '0 8px' }}>
        {/* Invoice header */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Descriptions size="small" column={6}>
            <Descriptions.Item label="Invoice Number">
              <Text strong>{d.invoiceNumber}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Invoice Date">{fmtDate(d.invoiceDate)}</Descriptions.Item>
            <Descriptions.Item label="Currency">
              <Tag color={d.currencyCode && d.currencyCode.toUpperCase() !== FUNCTIONAL_CCY ? 'blue' : 'default'} style={{ fontWeight: 600 }}>
                {d.currencyCode || FUNCTIONAL_CCY}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Supplier">{d.supplier}</Descriptions.Item>
            <Descriptions.Item label="Business Unit">{d.businessUnit}</Descriptions.Item>
            <Descriptions.Item label="Invoice Accounting">
              {isInvoicePosted
                ? <Tag color="success" icon={<CheckCircleOutlined />}>Posted</Tag>
                : <Tag color="warning" icon={<WarningOutlined />}>{d.invoiceAccountingStatus || 'Not Accounted'}</Tag>
              }
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Summary stats */}
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Total Schedule" value={totalAmt} precision={2} prefix={d.currencyCode} valueStyle={{ fontSize: 14 }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Posted" value={postedAmt} precision={2} prefix={d.currencyCode} valueStyle={{ fontSize: 14, color: REDWOOD.success }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Not Posted" value={notPostedAmt} precision={2} prefix={d.currencyCode} valueStyle={{ fontSize: 14, color: REDWOOD.warning }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Periods" value={new Set(d.lines.map(l => l.periodName)).size} valueStyle={{ fontSize: 14 }} />
            </Card>
          </Col>
        </Row>

        {/* Action bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              size="small"
              onClick={() => refreshDetail(tab.key, tab.invoiceId)}
            >
              Refresh
            </Button>
            <Button
              icon={<EyeOutlined />}
              size="small"
              onClick={() => openAccountingAll(d.invoiceNumber)}
            >
              View Accounting
            </Button>
            {d.currencyCode && d.currencyCode.toUpperCase() !== FUNCTIONAL_CCY && (
              <Tooltip title={`Fetch ${d.currencyCode}→${FUNCTIONAL_CCY} Corporate rates (period month-end) for all lines`}>
                <Button
                  icon={<SyncOutlined />}
                  size="small"
                  onClick={() => fetchAllLineRates(d.lines, d.currencyCode)}
                >
                  Fetch Rates
                </Button>
              </Tooltip>
            )}
            <Tooltip title={(mpaSelected[tab.key]?.length ?? 0) === 0
              ? 'Select one or more not-accounted lines to suspend'
              : `Suspend ${mpaSelected[tab.key]!.length} selected line(s)`}>
              <Button
                icon={<PauseCircleOutlined />}
                size="small"
                danger
                disabled={(mpaSelected[tab.key]?.length ?? 0) === 0}
                loading={suspendingTab === tab.key}
                onClick={() => handleSuspend(tab.key, tab.invoiceId)}
              >
                Suspend{(mpaSelected[tab.key]?.length ?? 0) > 0 ? ` (${mpaSelected[tab.key]!.length})` : ''}
              </Button>
            </Tooltip>
            <Tooltip title={
              <div style={{ maxWidth: 460 }}>
                <div style={{ fontSize: 11, marginBottom: 4 }}>Suspend endpoint:</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff', wordBreak: 'break-all' }}>
                  POST {APEX_DB_CONFIG.baseUrl}/ap/multiperiod/suspend
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 10, marginTop: 4, color: '#bbb', wordBreak: 'break-all' }}>
                  {`{ "scheduleIds": [${(mpaSelected[tab.key] ?? []).join(', ')}], "status": "Suspended", "updatedBy": "…" }`}
                </div>
                <div style={{ fontSize: 10, marginTop: 6, opacity: 0.75 }}>Click to copy URL</div>
              </div>
            }>
              <Button type="text" size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => { navigator.clipboard.writeText(`${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/suspend`); message.success('Suspend URL copied'); }} />
            </Tooltip>
          </Space>

          <Tooltip title={postDisabledReason ?? `Create Dr Expense / Cr Accrual entries for ${period}`}>
            <Button
              type="primary"
              icon={<BookOutlined />}
              disabled={!canPost}
              loading={isPosting}
              onClick={() => openPostConfirm(tab.key)}
              style={{ background: canPost ? REDWOOD.primary : undefined }}
            >
              Post {period} Accrual
            </Button>
          </Tooltip>
        </div>

        {/* Schedule table */}
        {(() => {
          const sq = (detailSearch[tab.key] || '').trim().toLowerCase();
          const filteredLines = sq
            ? d.lines.filter(l =>
                [l.periodName, l.description, l.chargeAccount, l.accrualAccount,
                 l.postingStatus, l.postedBy, String(l.lineNumber), String(l.scheduleId)]
                  .some(v => v && String(v).toLowerCase().includes(sq))
              )
            : d.lines;
          return (
            <>
              <div style={{ marginBottom: 8 }}>
                <Input.Search
                  placeholder="Search schedule lines…"
                  allowClear
                  size="small"
                  style={{ width: 260 }}
                  value={detailSearch[tab.key] || ''}
                  onChange={e => setDetailSearch(prev => ({ ...prev, [tab.key]: e.target.value }))}
                  onSearch={v => setDetailSearch(prev => ({ ...prev, [tab.key]: v }))}
                />
              </div>
              <Table
                dataSource={filteredLines}
                columns={buildScheduleColumns(d.lines, d.currencyCode)}
                rowKey="scheduleId"
                size="small"
                pagination={false}
                scroll={{ x: 1320 }}
                rowSelection={{
                  selectedRowKeys: mpaSelected[tab.key] ?? [],
                  onChange: (keys) => setMpaSelected(prev => ({ ...prev, [tab.key]: keys as number[] })),
                  // Only 'Not Posted' lines can be suspended (accounted & already-suspended are locked).
                  getCheckboxProps: (rec) => ({ disabled: rec.postingStatus !== 'Not Posted' }),
                }}
                rowClassName={(rec) => rec.periodName === period && rec.postingStatus === 'Not Posted' ? 'ant-table-row-selected' : ''}
              />
            </>
          );
        })()}
      </div>
    );
  };

  // ── confirm modal lines preview ───────────────────────────────────────────

  const confirmModalLines = () => {
    if (!confirmTab) return [];
    const tab = detailTabs.find(t => t.key === confirmTab);
    return (tab?.detail?.lines || []).filter(l => l.periodName === currentPeriod() && l.postingStatus === 'Not Posted');
  };

  // ── tabs ──────────────────────────────────────────────────────────────────

  const tabItems = [
    {
      key:   'search',
      label: 'Manage Multiperiod Accounting',
      children: (
        <>
          {/* Search form */}
          <Card size="small" style={{ marginBottom: 12 }}>
            <Form form={form} layout="inline" size="small" onFinish={handleSearch}>
              <Form.Item name="invoiceNumber" label="Invoice Number">
                <Input placeholder="Search…" style={{ width: 160 }} allowClear />
              </Form.Item>
              <Form.Item name="supplier" label="Supplier">
                <Input placeholder="Search…" style={{ width: 180 }} allowClear />
              </Form.Item>
              <Form.Item name="businessUnit" label="Business Unit">
                <Select placeholder="All" style={{ width: 200 }} allowClear>
                  {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                </Select>
              </Form.Item>
              <Form.Item name="postingStatus" label="Status">
                <Select placeholder="All" style={{ width: 130 }} allowClear>
                  <Option value="Not Posted">Not Posted</Option>
                  <Option value="Posted">Posted</Option>
                  <Option value="Error">Error</Option>
                </Select>
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={searching}>Search</Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>

          {searchErr && <Alert type="error" showIcon message={searchErr} style={{ marginBottom: 12 }} />}

          {(() => {
            const gq = gridSearch.trim().toLowerCase();
            const filteredSearchResult = searchResult.filter(r => {
              if (mpaStatusFilter === 'open'   && !((r.openLines   ?? 0) > 0)) return false;
              if (mpaStatusFilter === 'closed' && !((r.closedLines ?? 0) > 0 && (r.openLines ?? 0) === 0)) return false;
              if (!gq) return true;
              return [
                r.invoiceNumber, r.supplier, r.supplierNumber, r.businessUnit,
                fmtDate(r.invoiceDate), r.invoiceCurrency, r.currencyCode,
                r.invoiceAmount, r.totalAmount, r.postedAmount, r.notPostedAmount,
                r.totalLines, r.openLines, r.closedLines,
              ].some(v => v != null && String(v).toLowerCase().includes(gq));
            });
            // All list totals are in AED (each foreign invoice converted at its
            // invoice-date rate; amounts with no rate yet count as 0 until it loads).
            const totInvoice   = filteredSearchResult.reduce((s, r) => s + (toAed(r, r.invoiceAmount)   ?? 0), 0);
            const totMpa       = filteredSearchResult.reduce((s, r) => s + (toAed(r, r.totalAmount)     ?? 0), 0);
            const totPosted    = filteredSearchResult.reduce((s, r) => s + (toAed(r, r.postedAmount)    ?? 0), 0);
            const totNotPosted = filteredSearchResult.reduce((s, r) => s + (toAed(r, r.notPostedAmount) ?? 0), 0);
            const curr         = FUNCTIONAL_CCY;
            return (
              <>
                {filteredSearchResult.length > 0 && (
                  <Row gutter={8} style={{ marginBottom: 12 }}>
                    <Col span={4}><Card size="small" bodyStyle={{ padding: '6px 12px' }}><Statistic title="Invoices" value={filteredSearchResult.length} valueStyle={{ fontSize: 16 }} /></Card></Col>
                    <Col span={5}><Card size="small" bodyStyle={{ padding: '6px 12px' }}><Statistic title="Total Invoice" value={totInvoice} precision={2} prefix={curr} valueStyle={{ fontSize: 14 }} /></Card></Col>
                    <Col span={5}><Card size="small" bodyStyle={{ padding: '6px 12px' }}><Statistic title="Total MPA" value={totMpa} precision={2} prefix={curr} valueStyle={{ fontSize: 14 }} /></Card></Col>
                    <Col span={5}><Card size="small" bodyStyle={{ padding: '6px 12px' }}><Statistic title="Allocated (Posted)" value={totPosted} precision={2} prefix={curr} valueStyle={{ fontSize: 14, color: REDWOOD.success }} /></Card></Col>
                    <Col span={5}><Card size="small" bodyStyle={{ padding: '6px 12px' }}><Statistic title="Not Allocated" value={totNotPosted} precision={2} prefix={curr} valueStyle={{ fontSize: 14, color: REDWOOD.warning }} /></Card></Col>
                  </Row>
                )}
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Input.Search
                    allowClear
                    size="small"
                    placeholder="Filter results (any column)…"
                    style={{ width: 280 }}
                    value={gridSearch}
                    onChange={e => setGridSearch(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    size="small"
                    icon={<FileExcelOutlined />}
                    style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                    disabled={filteredSearchResult.length === 0}
                    onClick={() => exportSearchToExcel(filteredSearchResult)}
                  >
                    Excel
                  </Button>
                  <Radio.Group
                    value={mpaStatusFilter}
                    onChange={e => setMpaStatusFilter(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                  >
                    <Radio.Button value="all">All</Radio.Button>
                    <Radio.Button value="open">Open</Radio.Button>
                    <Radio.Button value="closed">Closed</Radio.Button>
                  </Radio.Group>
                  </div>
                </div>
                <Table
                  dataSource={filteredSearchResult}
                  columns={searchColumns}
                  rowKey="invoiceId"
                  size="small"
                  loading={searching}
                  pagination={{ defaultPageSize: 100, showSizeChanger: true, pageSizeOptions: ['50', '100', '200', '500'] }}
                  scroll={{ x: 1620 }}
                  locale={{ emptyText: 'Run a search to see multiperiod invoices' }}
                  summary={(rows) => {
                    if (!rows.length) return null;
                    // AED-converted totals (invoice-date rate per row).
                    const inv = rows.reduce((s, r: any) => s + (toAed(r, r.invoiceAmount)   ?? 0), 0);
                    const t   = rows.reduce((s, r: any) => s + (toAed(r, r.totalAmount)     ?? 0), 0);
                    const p   = rows.reduce((s, r: any) => s + (toAed(r, r.postedAmount)    ?? 0), 0);
                    const np  = rows.reduce((s, r: any) => s + (toAed(r, r.notPostedAmount) ?? 0), 0);
                    return (
                      <Table.Summary fixed>
                        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 700 }}>
                          <Table.Summary.Cell index={0} colSpan={6}><strong>Total ({rows.length})</strong></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="center"><Text strong>{FUNCTIONAL_CCY}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} />
                          <Table.Summary.Cell index={8} align="right"><Text strong>{fmtNum(inv)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={9} align="right"><Text strong>{fmtNum(t)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={10} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmtNum(p)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={11} align="right"><Text strong style={{ color: REDWOOD.warning }}>{fmtNum(np)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={12} />
                        </Table.Summary.Row>
                      </Table.Summary>
                    );
                  }}
                />
              </>
            );
          })()}
        </>
      ),
    },
    {
      key:   'fusion',
      label: <span><ApiOutlined style={{ marginRight: 4 }} />Data from Fusion</span>,
      children: (
        <>
          <Card size="small" style={{ marginBottom: 12 }}>
            <Form form={fusionForm} layout="inline" size="small" onFinish={handleFusionSearch}>
              <Form.Item name="invoiceNumber" label="Invoice Number">
                <Input placeholder="Search…" style={{ width: 160 }} allowClear />
              </Form.Item>
              <Form.Item name="supplier" label="Supplier">
                <Input placeholder="Search…" style={{ width: 180 }} allowClear />
              </Form.Item>
              <Form.Item name="businessUnit" label="Business Unit">
                <Select placeholder="All" style={{ width: 200 }} allowClear>
                  {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                </Select>
              </Form.Item>
              <Form.Item name="lineDescription" label="Description">
                <Input placeholder="Search…" style={{ width: 160 }} allowClear />
              </Form.Item>
              <Form.Item
                name="openAsOf"
                label="Open As Of"
                tooltip="Show only lines where MPA End Date ≥ selected date"
              >
                <DatePicker
                  format="DD-MMM-YY"
                  placeholder="e.g. 01-May-26"
                  style={{ width: 140 }}
                  allowClear
                />
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={fusionLoading}>
                    Search
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={() => { fusionForm.resetFields(); setFusionRows([]); setFusionErr(null); setFusionSearched(false); }}>
                    Reset
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>

          {fusionErr && <Alert type="error" showIcon message={fusionErr} style={{ marginBottom: 12 }} />}

          {fusionSearched && !fusionLoading && fusionRows.length > 0 && (() => {
            const totalScheduled  = fusionRows.reduce((s, r) => s + (r.totalScheduled  || 0), 0);
            const totalPosted     = fusionRows.reduce((s, r) => s + (r.postedAmount    || 0), 0);
            const totalPending    = fusionRows.reduce((s, r) => s + (r.pendingAmount   || 0), 0);
            const currency        = fusionRows[0]?.invoiceCurrency || '';
            return (
              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col span={4}>
                  <Card size="small">
                    <Statistic title="Lines" value={fusionRows.length} valueStyle={{ fontSize: 14 }} />
                  </Card>
                </Col>
                <Col span={4}>
                  <Card size="small">
                    <Statistic title="Invoices" value={new Set(fusionRows.map(r => r.invoiceId)).size} valueStyle={{ fontSize: 14 }} />
                  </Card>
                </Col>
                <Col span={4}>
                  <Card size="small">
                    <Statistic title="Schedules" value={new Set(fusionRows.filter(r => r.scheduleGenerated).map(r => r.invoiceId)).size} valueStyle={{ fontSize: 14, color: REDWOOD.success }} suffix="generated" />
                  </Card>
                </Col>
                <Col span={4}>
                  <Card size="small">
                    <Statistic title="Total Scheduled" value={totalScheduled} precision={2} prefix={currency} valueStyle={{ fontSize: 13 }} />
                  </Card>
                </Col>
                <Col span={4}>
                  <Card size="small">
                    <Statistic title="Posted" value={totalPosted} precision={2} prefix={currency} valueStyle={{ fontSize: 13, color: REDWOOD.success }} />
                  </Card>
                </Col>
                <Col span={4}>
                  <Card size="small">
                    <Statistic title="Pending" value={totalPending} precision={2} prefix={currency} valueStyle={{ fontSize: 13, color: REDWOOD.warning }} />
                  </Card>
                </Col>
              </Row>
            );
          })()}

          {fusionSearched && !fusionLoading && fusionRows.some(r => !r.scheduleGenerated) && (
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                icon={<SyncOutlined />}
                type="primary"
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
                onClick={openBulkModal}
              >
                Generate Schedule for All Pending
              </Button>
            </div>
          )}

          <Table
            dataSource={fusionRows}
            columns={fusionColumns}
            rowKey={(r) => `${r.invoiceId}-${r.lineNumber}`}
            size="small"
            loading={fusionLoading}
            pagination={{ pageSize: 25, showSizeChanger: true, showTotal: (total) => `${total} lines` }}
            scroll={{ x: 1600 }}
            locale={{ emptyText: fusionSearched ? 'No multiperiod invoice lines found' : 'Run a search to see invoice lines eligible for multiperiod accounting' }}
          />
        </>
      ),
    },
    {
      key: 'post-accrual',
      label: <span><CalendarOutlined style={{ marginRight: 4 }} />Post Accrual</span>,
      children: (
        <div style={{ padding: '0 4px' }}>
          {/* Period selector */}
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space align="center">
              <Text strong>Accrual Period:</Text>
              <Select
                value={accrualPeriod || undefined}
                onChange={(v: string) => { setAccrualPeriod(v); loadAccrualLines(v); }}
                style={{ width: 160 }}
                placeholder="Select period"
                loading={accrualLoading}
              >
                {accrualPeriods.map(p => <Option key={p} value={p}>{p}</Option>)}
              </Select>
              <Button
                icon={<ReloadOutlined />}
                size="small"
                onClick={() => { loadAccrualPeriods(); }}
              >
                Refresh Periods
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Default shows first open (unposted) period
              </Text>
            </Space>
          </Card>

          {/* Invoices with open lines in this period */}
          {(() => {
            // Flatten: one row per schedule line for the selected period
            const allFlatRows = accrualLines.flatMap((inv: any) =>
              (inv.periodAllLines || [])
                .filter((sl: any) => sl.postingStatus !== 'Suspended')   // suspended lines are excluded from accruals
                .map((sl: any) => ({
                rowKey: `${inv.invoiceId}-${sl.scheduleId}`,
                scheduleId: sl.scheduleId,
                invoiceId: inv.invoiceId,
                invoiceNumber: inv.invoiceNumber,
                supplier: inv.supplier,
                businessUnit: inv.businessUnit,
                currencyCode: inv.currencyCode,
                totalLines: inv.totalLines,
                closedLines: inv.closedLines,
                openLines: inv.openLines,
                totalAmount: inv.totalAmount,
                postedToDate: inv.postedToDate,
                periodAmt: sl.periodAmount,
                chargeAccount: sl.chargeAccount,
                accrualAccount: sl.accrualAccount,
                description: sl.description,
                periodName: sl.periodName,
                lineNumber: sl.lineNumber,
                postingStatus: sl.postingStatus,
                postedBy: sl.postedBy,
                postedDate: sl.postedDate,
                slaHeaderId: sl.slaHeaderId,
              }))
            );

            // Apply global search filter across all text columns
            const q = accrualSearch.trim().toLowerCase();
            const flatRows = q
              ? allFlatRows.filter((r: any) =>
                  [r.invoiceNumber, r.supplier, r.description, r.chargeAccount,
                   r.accrualAccount, r.businessUnit, r.periodName, String(r.scheduleId), String(r.lineNumber)]
                    .some(v => v && String(v).toLowerCase().includes(q))
                )
              : allFlatRows;

            // Unique invoice numbers for column filter
            const invoiceOptions = [...new Set(allFlatRows.map((r: any) => r.invoiceNumber as string))]
              .sort()
              .map(v => ({ text: v, value: v }));

            return (
              <>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Input.Search
                      placeholder="Search any column…"
                      allowClear
                      size="small"
                      style={{ width: 280 }}
                      value={accrualSearch}
                      onChange={e => setAccrualSearch(e.target.value)}
                      onSearch={v => setAccrualSearch(v)}
                    />
                    <Tooltip title={
                      <div style={{ maxWidth: 500 }}>
                        <div style={{ fontSize: 11, marginBottom: 4 }}>Post-Accrual loads schedules via:</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff', wordBreak: 'break-all' }}>
                          GET {APEX_DB_CONFIG.baseUrl}/ap/multiperiod
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff', wordBreak: 'break-all', marginTop: 2 }}>
                          GET {APEX_DB_CONFIG.baseUrl}/ap/multiperiod/&#123;invoiceId&#125;
                        </div>
                        <div style={{ fontSize: 10, marginTop: 6, opacity: 0.75 }}>
                          Rows are filtered to the selected period; <b>Suspended</b> and non-period lines are excluded. Click to copy the list URL.
                        </div>
                      </div>
                    }>
                      <Button type="text" size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                        onClick={() => { navigator.clipboard.writeText(`${APEX_DB_CONFIG.baseUrl}/ap/multiperiod`); message.success('Endpoint URL copied'); }} />
                    </Tooltip>
                  </Space>
                </div>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {accrualSelected.length > 0 ? `${accrualSelected.length} schedule(s) selected` : 'Select schedules, or post the whole month at once'}
                  </Text>
                  <Space>
                    {accrualSelected.length > 0 && (
                      <Button size="small" onClick={() => setAccrualSelected([])}>Clear Selection</Button>
                    )}
                    <Button
                      size="small"
                      icon={<FileExcelOutlined />}
                      style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                      disabled={flatRows.length === 0}
                      onClick={() => exportAccrualToExcel(flatRows, accrualPeriod)}
                    >
                      Excel
                    </Button>
                    <Button
                      size="small"
                      icon={<ApiOutlined />}
                      disabled={accrualSelected.length === 0}
                      onClick={() => {
                        const selectedSet = new Set(accrualSelected);
                        const lines: any[] = [];
                        let lineNum = 1;
                        flatRows
                          .filter((r: any) => selectedSet.has(r.scheduleId))
                          .forEach((r: any) => {
                            lines.push({
                              lineNum: lineNum++, scheduleId: r.scheduleId,
                              invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber,
                              supplier: r.supplier, businessUnit: r.businessUnit,
                              periodName: r.periodName,
                              account: r.chargeAccount, accountType: 'Expense (DR)',
                              description: r.description,
                              dr: r.periodAmt, cr: 0,
                              reference1: r.invoiceNumber, reference2: String(r.scheduleId),
                              reference3: r.periodName, reference4: r.invoiceNumber, reference5: 'MPA_ACCRUAL',
                            });
                            lines.push({
                              lineNum: lineNum++, scheduleId: r.scheduleId,
                              invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber,
                              supplier: r.supplier, businessUnit: r.businessUnit,
                              periodName: r.periodName,
                              account: r.accrualAccount, accountType: 'Accrual (CR)',
                              description: `MPA Accrual — ${r.periodName} (${r.invoiceNumber})`,
                              dr: 0, cr: r.periodAmt,
                              reference1: r.invoiceNumber, reference2: String(r.scheduleId),
                              reference3: r.periodName, reference4: r.invoiceNumber, reference5: 'MPA_ACCRUAL',
                            });
                          });
                        setAccrualPreviewLines(lines);
                        setAccrualPreviewOpen(true);
                      }}
                    >
                      Preview / Debug
                    </Button>
                    <Button
                      icon={<CalendarOutlined />}
                      onClick={() => openPostModal(flatRows)}
                    >
                      Post Entire Month
                    </Button>
                    <Button
                      type="primary"
                      icon={<BookOutlined />}
                      disabled={accrualSelected.length === 0}
                      onClick={() => {
                        const selectedSet = new Set(accrualSelected);
                        openPostModal(flatRows.filter((r: any) => selectedSet.has(r.scheduleId)));
                      }}
                    >
                      Post Selected ({accrualSelected.length})
                    </Button>
                  </Space>
                </div>
                <Table
                  dataSource={flatRows}
                  rowKey="scheduleId"
                  size="small"
                  loading={accrualLoading}
                  pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100', '200'] }}
                  scroll={{ x: 1300 }}
                  rowSelection={{
                    selectedRowKeys: accrualSelected,
                    onChange: (keys) => setAccrualSelected(keys as number[]),
                    // Already-accounted OR suspended schedules can't be posted.
                    getCheckboxProps: (rec: any) => ({ disabled: rec.postingStatus === 'Posted' || rec.postingStatus === 'Suspended' }),
                  }}
                  locale={{ emptyText: accrualPeriod ? `No accrual lines for ${accrualPeriod}` : 'Select a period to see accrual lines' }}
                  summary={(rows) => {
                    const totPeriod  = rows.reduce((s, r: any) => s + (r.periodAmt || 0), 0);
                    const cur = rows[0] as any;
                    return (
                      <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 700 }}>
                        <Table.Summary.Cell index={0} colSpan={4}><strong>Total ({rows.length} schedules)</strong></Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">
                          <Text strong style={{ color: '#1677ff', fontSize: 11 }}>{fmtAmt(totPeriod, cur?.currencyCode)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} colSpan={5} />
                      </Table.Summary.Row>
                    );
                  }}
                  columns={[
                    {
                      title: 'Sched ID', dataIndex: 'scheduleId', width: 80, fixed: 'left' as const,
                      render: (v: number) => <Tag style={{ fontSize: 10, fontFamily: 'monospace' }}>{v}</Tag>,
                    },
                    {
                      title: 'Line', dataIndex: 'lineNumber', width: 55, align: 'center' as const,
                      render: (v: number) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                    },
                    {
                      title: 'Period', dataIndex: 'periodName', width: 90,
                      render: (v: string) => <Tag color="purple" style={{ fontSize: 10 }}>{v}</Tag>,
                    },
                    {
                      title: 'Invoice Number', dataIndex: 'invoiceNumber', width: 150, fixed: 'left' as const,
                      filters: invoiceOptions,
                      onFilter: (value: any, rec: any) => rec.invoiceNumber === value,
                      filterSearch: true,
                      render: (v: string, rec: any) => (
                        <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} onClick={() => openDetail(rec)}>{v}</Button>
                      ),
                    },
                    { title: 'Supplier', dataIndex: 'supplier', ellipsis: true, width: 180,
                      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                    { title: 'Description', dataIndex: 'description', ellipsis: true, width: 200,
                      render: (v: string) => <Text style={{ fontSize: 11 }} title={v}>{v}</Text> },
                    {
                      title: `${accrualPeriod || 'Period'} Amount`, dataIndex: 'periodAmt', width: 140, align: 'right' as const,
                      render: (v: number, rec: any) => <Text strong style={{ color: '#1677ff', fontSize: 11 }}>{fmtAmt(v, rec.currencyCode)}</Text>,
                    },
                    {
                      title: 'Charge A/C (Expense DR)', dataIndex: 'chargeAccount', width: 210,
                      render: (v: string) => renderAcctWithDesc(v, 10),
                    },
                    {
                      title: 'Accrual A/C (CR)', dataIndex: 'accrualAccount', width: 210,
                      render: (v: string) => renderAcctWithDesc(v, 10),
                    },
                    {
                      title: 'Invoice Total', dataIndex: 'totalAmount', width: 130, align: 'right' as const,
                      render: (v: number, rec: any) => <Text style={{ color: '#555', fontSize: 11 }}>{fmtAmt(v, rec.currencyCode)}</Text>,
                    },
                    {
                      title: 'Posted to Date', dataIndex: 'postedToDate', width: 130, align: 'right' as const,
                      render: (v: number, rec: any) => <Text style={{ color: REDWOOD.success, fontSize: 11 }}>{fmtAmt(v, rec.currencyCode)}</Text>,
                    },
                    {
                      title: 'Accounted', dataIndex: 'postingStatus', width: 120, align: 'center' as const,
                      filters: [{ text: 'Accounted', value: 'Posted' }, { text: 'Not Accounted', value: 'Not Posted' }],
                      onFilter: (value: any, rec: any) => rec.postingStatus === value,
                      render: (v: string, rec: any) => v === 'Posted'
                        ? <Tooltip title={`${rec.postedBy || ''}${rec.postedDate ? ' · ' + fmtDate(rec.postedDate) : ''}`}><Tag color="success" icon={<CheckCircleOutlined />}>Accounted</Tag></Tooltip>
                        : <Tag color="warning" icon={<WarningOutlined />}>Not Accounted</Tag>,
                    },
                    {
                      title: 'Action', width: 120, fixed: 'right' as const,
                      render: (_: any, rec: any) => rec.postingStatus === 'Posted'
                        ? <Button size="small" icon={<EyeOutlined />} onClick={() => openAccountingPeriod(rec.scheduleId, rec.invoiceNumber, rec.periodName)}>View</Button>
                        : <Button size="small" onClick={() => openDetail(rec)}>View &amp; Post</Button>,
                    },
                  ]}
                />
              </>
            );
          })()}
          <Modal
            open={accrualPreviewOpen}
            onCancel={() => setAccrualPreviewOpen(false)}
            title={
              <Space>
                <BookOutlined style={{ color: REDWOOD.primary }} />
                <span>Accrual Accounting Preview — {accrualPeriod}</span>
                <Tag color="blue">{accrualPreviewLines.filter(l => l.dr > 0).length} invoices</Tag>
              </Space>
            }
            width="95vw"
            style={{ maxWidth: 1600 }}
            footer={
              <Space>
                <Button onClick={() => setAccrualPreviewOpen(false)}>Close</Button>
                <Button icon={<ApiOutlined />} onClick={openAccrualDebug}>
                  Create Account &amp; Debug
                </Button>
                <Button
                  type="primary"
                  icon={<BookOutlined />}
                  loading={accrualAcctRunning}
                  onClick={runAccrualAccounting}
                >
                  Create Accounting
                </Button>
              </Space>
            }
            destroyOnClose
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12, fontSize: 11 }}
              message="DR Expense Account (Charge A/C) / CR Accrual Account — one journal pair per schedule line. Ref 5 class = MPA_ACCRUAL"
            />
            {accrualAcctResults.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {accrualAcctResults.map(r => (
                  <div key={r.scheduleId} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', marginBottom: 3,
                    borderRadius: 4, fontSize: 11,
                    background: r.status === 'success' ? '#f6ffed' : r.status === 'skipped' ? '#fffbe6' : '#fff2f0',
                    border: `1px solid ${r.status === 'success' ? '#b7eb8f' : r.status === 'skipped' ? '#ffe58f' : '#ffccc7'}`,
                  }}>
                    <Tag color={r.status === 'success' ? 'success' : r.status === 'skipped' ? 'warning' : 'error'} style={{ fontSize: 10 }}>
                      {r.status === 'success' ? 'Accounted' : r.status === 'skipped' ? 'Skipped' : 'Error'}
                    </Tag>
                    <Text strong style={{ fontSize: 11 }}>Sched {r.scheduleId}</Text>
                    <Text style={{ fontSize: 11 }}>{r.invoiceNumber}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>— {r.message}</Text>
                  </div>
                ))}
              </div>
            )}
            <Table
              dataSource={accrualPreviewLines}
              rowKey={(r: any) => `${r.scheduleId}-${r.accountType}`}
              size="small"
              pagination={false}
              scroll={{ x: 1700, y: 480 }}
              rowClassName={(r: any) => r.dr > 0 ? 'mpa-preview-dr' : 'mpa-preview-cr'}
              summary={(rows) => {
                const totDr = rows.reduce((s: number, r: any) => s + (r.dr || 0), 0);
                const totCr = rows.reduce((s: number, r: any) => s + (r.cr || 0), 0);
                return (
                  <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 700 }}>
                    <Table.Summary.Cell index={0} colSpan={5}><strong>Total</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong style={{ color: '#237804', fontSize: 12 }}>{totDr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">
                      <Text strong style={{ color: REDWOOD.primary, fontSize: 12 }}>{totCr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} colSpan={5} />
                  </Table.Summary.Row>
                );
              }}
              columns={[
                {
                  title: '#', dataIndex: 'lineNum', width: 42,
                  render: (v: number) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                },
                {
                  title: 'Sched ID', dataIndex: 'scheduleId', width: 75,
                  render: (v: number) => <Tag style={{ fontSize: 10, fontFamily: 'monospace' }}>{v}</Tag>,
                },
                {
                  title: 'Invoice', dataIndex: 'invoiceNumber', width: 130,
                  render: (v: string) => <Text style={{ fontSize: 11, fontWeight: 600 }}>{v}</Text>,
                },
                {
                  title: 'Type', dataIndex: 'accountType', width: 105,
                  render: (v: string) => (
                    <Tag color={v.startsWith('Expense') ? 'blue' : 'orange'} style={{ fontSize: 10 }}>{v}</Tag>
                  ),
                },
                {
                  title: 'Account / Description', dataIndex: 'account', width: 240,
                  render: (v: string, r: any) => (
                    <div>
                      <Text code style={{ fontSize: 10 }}>{v || '—'}</Text>
                      {r.description && (
                        <div style={{ fontSize: 10, color: '#666', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.description}>
                          {r.description}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: 'Debit', dataIndex: 'dr', width: 120, align: 'right' as const,
                  render: (v: number) => v > 0
                    ? <Text style={{ fontFamily: 'monospace', color: '#237804', fontSize: 12, fontWeight: 600 }}>{v.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                    : null,
                },
                {
                  title: 'Credit', dataIndex: 'cr', width: 120, align: 'right' as const,
                  render: (v: number) => v > 0
                    ? <Text style={{ fontFamily: 'monospace', color: REDWOOD.primary, fontSize: 12, fontWeight: 600 }}>{v.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                    : null,
                },
                {
                  title: 'Ref 1 — Invoice No', dataIndex: 'reference1', width: 140, ellipsis: true,
                  render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                },
                {
                  title: 'Ref 2 — Schedule ID', dataIndex: 'reference2', width: 120,
                  render: (v: string) => <Tag style={{ fontSize: 10, fontFamily: 'monospace' }}>{v}</Tag>,
                },
                {
                  title: 'Ref 3 — Period', dataIndex: 'reference3', width: 95,
                  render: (v: string) => <Tag color="purple" style={{ fontSize: 10 }}>{v}</Tag>,
                },
                {
                  title: 'Ref 4 — Invoice No', dataIndex: 'reference4', width: 140, ellipsis: true,
                  render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                },
                {
                  title: 'Ref 5 — Class', dataIndex: 'reference5', width: 110,
                  render: (v: string) => <Tag color="geekblue" style={{ fontSize: 10 }}>{v}</Tag>,
                },
              ]}
            />
          </Modal>

          {/* Accrual Create-Accounting Debug Modal */}
          <Modal
            open={accrualDebugOpen}
            onCancel={() => setAccrualDebugOpen(false)}
            title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Create Accounting — Step-by-step (Debug)</span></Space>}
            width={860}
            footer={
              <Space>
                <Button onClick={() => setAccrualDebugOpen(false)}>Close</Button>
                <Button type="primary" icon={<BookOutlined />} loading={accrualAcctRunning}
                  onClick={() => { setAccrualDebugOpen(false); runAccrualAccounting(); }}>
                  Run Full Flow
                </Button>
              </Space>
            }
            destroyOnClose
          >
            <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 11 }}
              message="Payloads shown for the first selected schedule. Placeholders like {slaHeaderId} / {batchId} resolve from earlier steps as you run them. Use Test to call a single step live." />
            {accrualDebugHalted && (
              <Alert type="warning" showIcon style={{ marginBottom: 12, fontSize: 11 }}
                message="Duplicate check reported the journal already exists — steps 2–6 are halted. Re-open this modal to reset." />
            )}
            {accrualDebugSteps.map((s, idx) => {
              const t = accrualStepTest[idx];
              const isDupCheck = s.url.includes('/gl/journals/check');
              const stepHalted = accrualDebugHalted && !isDupCheck;
              // Show URL + payload with placeholders resolved from IDs captured so far.
              const dispUrl     = resolveAccrualTokens(s.url, accrualDebugCtx);
              const dispPayload = s.payload != null ? resolveAccrualTokens(s.payload, accrualDebugCtx) : null;
              return (
                <div key={idx} style={{ border: `1px solid ${REDWOOD.neutral}`, borderRadius: 6, marginBottom: 10, overflow: 'hidden', opacity: stepHalted ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fafafa', padding: '6px 10px', borderBottom: '1px solid #eee' }}>
                    <Tag color={s.method === 'GET' ? 'blue' : s.method === 'PUT' ? 'orange' : 'green'} style={{ fontSize: 10 }}>{s.method}</Tag>
                    <Text strong style={{ fontSize: 12 }}>{s.step}</Text>
                    {stepHalted && <Tag color="warning" style={{ fontSize: 10 }}>halted</Tag>}
                    <Button size="small" style={{ marginLeft: 'auto' }} loading={t?.loading} disabled={stepHalted} onClick={() => runAccrualDebugStep(idx)}>Test</Button>
                  </div>
                  <div style={{ padding: '6px 10px' }}>
                    <Text type="secondary" style={{ fontSize: 10 }}>URL</Text>
                    <Paragraph copyable style={{ fontFamily: 'monospace', fontSize: 11, margin: '2px 0 6px', wordBreak: 'break-all' }}>{dispUrl}</Paragraph>
                    {dispPayload != null && (
                      <>
                        <Text type="secondary" style={{ fontSize: 10 }}>Payload</Text>
                        <pre style={{ fontFamily: 'monospace', fontSize: 10, background: '#f5f5f5', padding: '6px 8px', borderRadius: 4, maxHeight: 180, overflow: 'auto', margin: '2px 0 0' }}>
                          {JSON.stringify(dispPayload, null, 2)}
                        </pre>
                      </>
                    )}
                    {t && (
                      <div style={{ marginTop: 6 }}>
                        <Tag color={t.status >= 200 && t.status < 300 ? 'green' : 'red'} style={{ fontSize: 10 }}>HTTP {t.status}</Tag>
                        <pre style={{ fontFamily: 'monospace', fontSize: 10, background: '#f0f5ff', padding: '6px 8px', borderRadius: 4, maxHeight: 160, overflow: 'auto', margin: '4px 0 0' }}>{t.body || '(empty)'}</pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Modal>
        </div>
      ),
    },
    ...detailTabs.map(tab => ({
      key:   tab.key,
      label: (
        <span>
          <FileTextOutlined style={{ marginRight: 4 }} />
          {tab.label}
          <CloseOutlined
            style={{ marginLeft: 8, fontSize: 11, color: '#999' }}
            onClick={(e) => { e.stopPropagation(); closeTab(tab.key); }}
          />
        </span>
      ),
      children: renderDetail(tab),
    })),
  ];

  // ── main render ───────────────────────────────────────────────────────────

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral }}>
      <Content style={{ padding: '12px 16px' }}>
        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 8 }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/ap">Accounts Payable</Link> },
          { title: 'Multiperiod Accounting' },
        ]} />

        {/* Page title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Space size={10}>
            <CalendarOutlined style={{ fontSize: 22, color: REDWOOD.primary }} />
            <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Multiperiod Accounting</Title>
          </Space>
          <Tooltip title="View Page APIs">
            <Button
              icon={<ApiOutlined />}
              size="small"
              style={{ color: REDWOOD.info }}
              onClick={() => setApiModalOpen(true)}
            />
          </Tooltip>
        </div>

        <Card bodyStyle={{ padding: 12 }}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              if (key === 'post-accrual') loadAccrualPeriods();
            }}
            type="card"
            size="small"
            items={tabItems}
          />
        </Card>

        {/* ── Fusion Detail Drawer ─────────────────────────────────────── */}
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={900}
          title={
            drawerData
              ? <Space>
                  <FileTextOutlined style={{ color: REDWOOD.primary }} />
                  <span style={{ color: REDWOOD.primary, fontWeight: 600 }}>
                    {drawerData.invoiceNumber}
                  </span>
                  <Tag color="default">{drawerData.businessUnit}</Tag>
                  {drawerData.openAsOf && (
                    <Tag color="blue" icon={<CalendarOutlined />}>Open as of {fmtDate(drawerData.openAsOf)}</Tag>
                  )}
                </Space>
              : 'Invoice Detail'
          }
          extra={
            <Space>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={drawerLoading}
                onClick={refreshDrawer}
              >
                Refresh
              </Button>
              {drawerData && (() => {
              const hasSchedule = (drawerData.lines || []).some(l => l.scheduleGenerated);
              if (!hasSchedule) return (
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={generating.has(drawerData.invoiceId)}
                  onClick={async () => {
                    await handleGenerate(drawerData.invoiceId);
                    await refreshDrawer();
                  }}
                >
                  Generate Schedule
                </Button>
              );
              return (
                <Popconfirm
                  title="Delete MPA Schedule"
                  description="Delete all pending (not-posted) periods for this invoice?"
                  onConfirm={async () => {
                    await handleDeleteMpa(drawerData.invoiceId);
                    setDrawerOpen(false);
                    await handleFusionSearch();
                  }}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  cancelText="Cancel"
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={deleting.has(drawerData.invoiceId)}
                  >
                    Delete Schedule
                  </Button>
                </Popconfirm>
              );
            })()}
            </Space>
          }
        >
          {drawerLoading && !drawerData && (
            <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
          )}
          {drawerData && (() => {
            const d = drawerData;
            const currency = d.currencyCode || '';
            const totalScheduled = (d.lines || []).reduce((s, l) => s + (l.totalScheduled || 0), 0);
            const totalPosted    = (d.lines || []).reduce((s, l) => s + (l.postedAmount   || 0), 0);
            const totalPending   = (d.lines || []).reduce((s, l) => s + (l.pendingAmount  || 0), 0);
            const totalPendingFD = (d.lines || []).reduce((s, l) => s + (l.pendingFromDate|| 0), 0);

            const periodCols: ColumnsType<FusionMpaSchedulePeriod> = [
              {
                title: 'Period', dataIndex: 'periodName', width: 95,
                render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
              },
              {
                title: 'Date', dataIndex: 'periodDate', width: 100,
                render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
              },
              {
                title: 'Amount', dataIndex: 'periodAmount', width: 120, align: 'right' as const,
                render: v => <Text strong style={{ fontSize: 12 }}>{fmtAmt(v, currency)}</Text>,
              },
              {
                title: 'Status', dataIndex: 'postingStatus', width: 110,
                render: v => statusTag(v),
              },
              {
                title: 'Posted By', dataIndex: 'postedBy', width: 120, ellipsis: true,
                render: v => <Text type="secondary" style={{ fontSize: 11 }}>{v || '—'}</Text>,
              },
              {
                title: 'Posted Date', dataIndex: 'postedDate', width: 105,
                render: v => <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(v)}</Text>,
              },
              {
                title: 'Accrual A/C', dataIndex: 'accrualAccount', width: 210,
                render: v => renderAcctWithDesc(v, 10),
              },
              {
                title: 'Journal', width: 90, align: 'center' as const, fixed: 'right' as const,
                render: (_, rec) => (
                  <Tooltip title={rec.postingStatus === 'Posted' ? 'View this period\'s journal' : 'Not accounted yet'}>
                    <Button size="small" type="link" icon={<EyeOutlined />} disabled={rec.postingStatus !== 'Posted'}
                      style={{ padding: 0 }}
                      onClick={() => openAccountingPeriod(rec.scheduleId, d.invoiceNumber, rec.periodName)}>
                      View
                    </Button>
                  </Tooltip>
                ),
              },
            ];

            const collapseItems = (d.lines || []).map(ln => ({
              key: String(ln.lineNumber),
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Tag color="blue">Line {ln.lineNumber}</Tag>
                  <Text style={{ fontSize: 12 }}>{ln.lineDescription || '—'}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {fmtDate(ln.mpaStartDate)} → {fmtDate(ln.mpaEndDate)}
                  </Text>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {ln.scheduleGenerated
                      ? <Tag color="success" icon={<CheckCircleOutlined />}>Generated</Tag>
                      : <Tag color="default">No Schedule</Tag>
                    }
                    <Text strong style={{ fontSize: 12 }}>{fmtAmt(ln.lineAmount, currency)}</Text>
                  </span>
                </div>
              ),
              children: (
                <div>
                  <Row gutter={8} style={{ marginBottom: 10 }}>
                    <Col span={6}>
                      <Card size="small" bodyStyle={{ padding: '6px 10px' }}>
                        <Statistic title="Scheduled" value={ln.totalScheduled} precision={2} prefix={currency} valueStyle={{ fontSize: 12 }} />
                      </Card>
                    </Col>
                    <Col span={6}>
                      <Card size="small" bodyStyle={{ padding: '6px 10px' }}>
                        <Statistic title="Posted" value={ln.postedAmount} precision={2} prefix={currency} valueStyle={{ fontSize: 12, color: REDWOOD.success }} />
                      </Card>
                    </Col>
                    <Col span={6}>
                      <Card size="small" bodyStyle={{ padding: '6px 10px' }}>
                        <Statistic title="Pending" value={ln.pendingAmount} precision={2} prefix={currency} valueStyle={{ fontSize: 12, color: REDWOOD.warning }} />
                      </Card>
                    </Col>
                    <Col span={6}>
                      <Card size="small" bodyStyle={{ padding: '6px 10px' }}>
                        <Statistic
                          title={d.openAsOf ? `Pending ≥ ${fmtDate(d.openAsOf)}` : 'Pending (all)'}
                          value={ln.pendingFromDate}
                          precision={2}
                          prefix={currency}
                          valueStyle={{ fontSize: 12, color: REDWOOD.warning }}
                        />
                      </Card>
                    </Col>
                  </Row>
                  <div style={{ marginBottom: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Charge A/C: <Text code style={{ fontSize: 10 }}>{ln.chargeAccount || '—'}</Text>
                      {'  '}
                      Accrual A/C: <Text code style={{ fontSize: 10 }}>{ln.accrualAccount || '—'}</Text>
                    </Text>
                  </div>
                  {(ln.periods || []).length === 0 ? (
                    <Alert type="info" showIcon message="No schedule periods — generate the schedule first." />
                  ) : (
                    <Table
                      dataSource={ln.periods}
                      columns={periodCols}
                      rowKey="scheduleId"
                      size="small"
                      pagination={false}
                      scroll={{ x: 700 }}
                      rowClassName={rec => rec.postingStatus !== 'Posted' ? 'ant-table-row-selected' : ''}
                    />
                  )}
                </div>
              ),
            }));

            return (
              <>
                {/* Invoice header */}
                <Descriptions size="small" column={3} bordered style={{ marginBottom: 14 }}>
                  <Descriptions.Item label="Invoice Number">
                    <Text strong>{d.invoiceNumber}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Invoice Date">{fmtDate(d.invoiceDate)}</Descriptions.Item>
                  <Descriptions.Item label="Invoice Amount">
                    <Text strong>{fmtAmt(d.invoiceAmount, currency)}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Supplier">{d.supplier}</Descriptions.Item>
                  <Descriptions.Item label="Supplier No.">{d.supplierNumber}</Descriptions.Item>
                  <Descriptions.Item label="Business Unit">{d.businessUnit}</Descriptions.Item>
                </Descriptions>

                {/* Summary */}
                <Row gutter={8} style={{ marginBottom: 14 }}>
                  <Col span={6}>
                    <Card size="small">
                      <Statistic title="Total Scheduled" value={totalScheduled} precision={2} prefix={currency} valueStyle={{ fontSize: 13 }} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small">
                      <Statistic title="Posted / Expensed" value={totalPosted} precision={2} prefix={currency} valueStyle={{ fontSize: 13, color: REDWOOD.success }} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small">
                      <Statistic title="Pending (Total)" value={totalPending} precision={2} prefix={currency} valueStyle={{ fontSize: 13, color: REDWOOD.warning }} />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card size="small">
                      <Statistic
                        title={d.openAsOf ? `Pending ≥ ${fmtDate(d.openAsOf)}` : 'Pending (all)'}
                        value={totalPendingFD}
                        precision={2}
                        prefix={currency}
                        valueStyle={{ fontSize: 13, color: REDWOOD.warning }}
                      />
                    </Card>
                  </Col>
                </Row>

                {/* Per-line collapse */}
                {drawerLoading ? (
                  <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
                ) : (
                  <Collapse
                    defaultActiveKey={(d.lines || []).map(l => String(l.lineNumber))}
                    items={collapseItems}
                    size="small"
                  />
                )}
              </>
            );
          })()}
        </Drawer>

        {/* Post confirmation modal */}
        <Modal
          open={confirmOpen}
          title={<Space><BookOutlined />Post {currentPeriod()} Accrual</Space>}
          onOk={handlePostConfirm}
          onCancel={() => setConfirmOpen(false)}
          okText="Post Accrual"
          okType="primary"
          okButtonProps={{ style: { background: REDWOOD.primary } }}
          width={700}
        >
          <Alert
            type="info"
            showIcon
            message={`This will create Dr Expense / Cr Accrual accounting entries for period ${currentPeriod()}.`}
            style={{ marginBottom: 12 }}
          />
          <Table
            dataSource={confirmModalLines()}
            rowKey="scheduleId"
            size="small"
            pagination={false}
            columns={[
              { title: 'Line', dataIndex: 'lineNumber', width: 55 },
              { title: 'Description', dataIndex: 'description', ellipsis: true },
              { title: 'Dr (Expense)', dataIndex: 'chargeAccount', ellipsis: true, width: 180,
                render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
              { title: 'Cr (Accrual)', dataIndex: 'accrualAccount', ellipsis: true, width: 180,
                render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
              { title: 'Amount', dataIndex: 'periodAmount', width: 110, align: 'right' as const,
                render: v => <Text strong>{fmtAmt(v)}</Text> },
            ]}
          />
        </Modal>

        {/* ── Post Accrual Modal (KPIs + per-line status) ──────────────── */}
        <Modal
          open={postModalOpen}
          title={<Space><BookOutlined style={{ color: REDWOOD.info }} /><span>Post Accrual</span>{postRows[0]?.periodName && <Tag color="purple">{postRows[0].periodName}</Tag>}</Space>}
          onCancel={() => { if (!postRunning) setPostModalOpen(false); }}
          maskClosable={!postRunning}
          width={880}
          footer={
            <Space>
              <Button disabled={postRunning} onClick={() => setPostModalOpen(false)}>Close</Button>
              <Button type="primary" icon={<BookOutlined />} loading={postRunning}
                disabled={!postRows.some(r => r.postingStatus === 'Not Posted')}
                onClick={runPostAll}>
                Post {postRows.filter(r => r.postingStatus === 'Not Posted').length} line(s)
              </Button>
            </Space>
          }
          destroyOnClose
        >
          {(() => {
            const currency  = postRows[0]?.currencyCode || 'AED';
            const accounted = postRows.filter(r => r.postingStatus === 'Posted').length;
            const suspended = postRows.filter(r => r.postingStatus === 'Suspended').length;
            const toPost    = postRows.filter(r => r.postingStatus === 'Not Posted').length;
            const toPostAmt = postRows.filter(r => r.postingStatus === 'Not Posted').reduce((s, r) => s + (r.periodAmt || 0), 0);
            const vals      = Object.values(postStatus);
            const okCount   = vals.filter(s => s.status === 'success').length;
            const errCount  = vals.filter(s => s.status === 'error').length;
            const statusTagFor = (s?: { status: string; message: string }) => {
              switch (s?.status) {
                case 'accounted': return <Tag color="blue" icon={<CheckCircleOutlined />}>Accounted</Tag>;
                case 'posting':   return <Tag color="processing" icon={<SyncOutlined spin />}>Posting…</Tag>;
                case 'success':   return <Tag color="success" icon={<CheckCircleOutlined />}>Posted</Tag>;
                case 'skipped':   return <Tag color="gold">Skipped</Tag>;
                case 'error':     return <Tooltip title={s.message}><Tag color="error" icon={<WarningOutlined />}>Error</Tag></Tooltip>;
                default:          return <Tag>Pending</Tag>;
              }
            };
            return (
              <>
                <Row gutter={8} style={{ marginBottom: 12 }}>
                  <Col span={suspended > 0 ? 5 : 6}><Card size="small" bodyStyle={{ padding: '6px 10px' }}><Statistic title="Lines selected" value={postRows.length} valueStyle={{ fontSize: 16 }} /></Card></Col>
                  <Col span={suspended > 0 ? 5 : 6}><Card size="small" bodyStyle={{ padding: '6px 10px' }}><Statistic title="Already accounted" value={accounted} valueStyle={{ fontSize: 16, color: REDWOOD.info }} /></Card></Col>
                  {suspended > 0 && (
                    <Col span={4}><Card size="small" bodyStyle={{ padding: '6px 10px' }}><Statistic title="Suspended" value={suspended} valueStyle={{ fontSize: 16, color: '#8c8c8c' }} /></Card></Col>
                  )}
                  <Col span={suspended > 0 ? 5 : 6}><Card size="small" bodyStyle={{ padding: '6px 10px' }}><Statistic title="To post" value={toPost} valueStyle={{ fontSize: 16, color: REDWOOD.warning }} /></Card></Col>
                  <Col span={suspended > 0 ? 5 : 6}><Card size="small" bodyStyle={{ padding: '6px 10px' }}><Statistic title="Amount to post" value={toPostAmt} precision={2} prefix={currency} valueStyle={{ fontSize: 14 }} /></Card></Col>
                </Row>
                {(postRunning || okCount + errCount > 0) && (
                  <Alert type={errCount ? 'warning' : 'info'} showIcon style={{ marginBottom: 12, fontSize: 12 }}
                    message={`${okCount} posted · ${errCount} failed · ${vals.filter(s => s.status === 'accounted' || s.status === 'skipped').length} skipped`} />
                )}
                <Text type="secondary" style={{ fontSize: 11 }}>Already-accounted lines are shown for reference and are not posted again.</Text>
                <Table
                  style={{ marginTop: 8 }}
                  dataSource={postRows}
                  rowKey="scheduleId"
                  size="small"
                  pagination={postRows.length > 50 ? { defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['50', '100', '200'] } : false}
                  scroll={{ x: 640, y: 340 }}
                  columns={[
                    { title: 'Sched', dataIndex: 'scheduleId', width: 75, render: (v: number) => <Tag style={{ fontSize: 10, fontFamily: 'monospace' }}>{v}</Tag> },
                    { title: 'Invoice', dataIndex: 'invoiceNumber', width: 130, ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                    { title: 'Description', dataIndex: 'description', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }} title={v}>{v}</Text> },
                    { title: 'Amount', dataIndex: 'periodAmt', width: 120, align: 'right' as const, render: (v: number, rec: any) => <Text strong style={{ fontSize: 11 }}>{fmtAmt(v, rec.currencyCode)}</Text> },
                    { title: 'Status', width: 120, align: 'center' as const, render: (_: any, rec: any) => statusTagFor(postStatus[rec.scheduleId]) },
                  ]}
                />
              </>
            );
          })()}
        </Modal>

        {/* ── View Accounting Modal ────────────────────────────────────── */}
        <Modal
          open={acctModalOpen}
          title={
            <Space>
              <EyeOutlined style={{ color: REDWOOD.info }} />
              <span>Multiperiod Accounting Journal</span>
              {acctCtx?.invoiceNumber && <Tag color="blue">{acctCtx.invoiceNumber}</Tag>}
              {acctMode === 'period' && acctCtx?.periodName && <Tag color="purple">{acctCtx.periodName}</Tag>}
            </Space>
          }
          onCancel={() => setAcctModalOpen(false)}
          footer={<Button onClick={() => setAcctModalOpen(false)}>Close</Button>}
          width={980}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Radio.Group
              size="small"
              value={acctMode}
              onChange={e => switchAcctMode(e.target.value)}
            >
              <Tooltip title={acctCtx?.scheduleId == null ? 'Open from a specific period to see a single journal' : ''}>
                <Radio.Button value="period" disabled={acctCtx?.scheduleId == null}>This Period</Radio.Button>
              </Tooltip>
              <Radio.Button value="all">All Periods</Radio.Button>
            </Radio.Group>
            <Tooltip title="Show the API used to fetch this journal">
              <Button size="small" icon={<ApiOutlined />} type={acctApiOpen ? 'primary' : 'default'}
                onClick={() => setAcctApiOpen(o => !o)}>API</Button>
            </Tooltip>
          </div>
          {acctApiOpen && acctCtx && (() => {
            const base = APEX_DB_CONFIG.baseUrl;
            const api = acctMode === 'period'
              ? { method: 'GET',
                  url: `${base}/gl/journals/lines?reference2=${acctCtx.scheduleId ?? ''}&reference5=MPA_ACCRUAL`,
                  note: 'Actual GL journal lines (RR_GL_JE_LINES_ALL ⨝ headers) for this period — reference2 = scheduleId, reference5 = MPA_ACCRUAL.' }
              : { method: 'GET',
                  url: `${base}/gl/journals/lines?reference1=${encodeURIComponent(acctCtx.invoiceNumber)}&reference5=MPA_ACCRUAL`,
                  note: 'Actual GL journal lines across all periods for reference1 = invoice number, reference5 = MPA_ACCRUAL.' };
            return (
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message={<Space size={6}><Tag color="blue" style={{ fontSize: 10 }}>{api.method}</Tag><Text style={{ fontSize: 11 }}>{acctMode === 'period' ? 'Per-period journal' : 'All-periods journals'}</Text></Space>}
                description={
                  <div>
                    <Paragraph copyable={{ text: api.url }} style={{ fontFamily: 'monospace', fontSize: 11, margin: '4px 0', wordBreak: 'break-all' }}>{api.url}</Paragraph>
                    <Text type="secondary" style={{ fontSize: 11 }}>{api.note}</Text>
                  </div>
                }
              />
            );
          })()}

          {acctLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
          ) : !acctGlLines || acctGlLines.length === 0 ? (
            <Alert type="warning" showIcon message="No GL journal lines found"
              description={acctMode === 'period'
                ? `No posted journal for this period (reference2 = ${acctCtx?.scheduleId ?? '—'}, reference5 = MPA_ACCRUAL).`
                : `No MPA accrual journals for invoice ${acctCtx?.invoiceNumber ?? ''} (reference1, reference5 = MPA_ACCRUAL).`} />
          ) : (() => {
            const rows = acctGlLines;
            const totalDr = rows.reduce((s: number, l: any) => s + (Number(l.accounted_dr) || 0), 0);
            const totalCr = rows.reduce((s: number, l: any) => s + (Number(l.accounted_cr) || 0), 0);
            const periods  = new Set(rows.map((l: any) => l.period_name));
            const journals = new Set(rows.map((l: any) => l.je_header_id));
            return (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {periods.size} period(s) · {journals.size} journal(s) · {rows.length} line(s)
                </Text>
                <Table
                  style={{ marginTop: 8 }}
                  dataSource={rows}
                  rowKey={(r: any) => `${r.je_header_id}-${r.line_id}`}
                  size="small"
                  pagination={false}
                  scroll={{ x: 940 }}
                  columns={[
                    {
                      title: 'Period', dataIndex: 'period_name', width: 80,
                      render: (v: string) => <Tag color="purple" style={{ fontSize: 10 }}>{v || '—'}</Tag>,
                    },
                    {
                      title: 'Journal', dataIndex: 'je_header_id', width: 90, align: 'center' as const,
                      render: (v: number, rec: any) => <Tooltip title={rec.journal_name}><Text style={{ fontSize: 11 }}>{v}</Text></Tooltip>,
                    },
                    { title: '#', dataIndex: 'line_num', width: 40, align: 'center' as const },
                    {
                      title: 'Account', dataIndex: 'account', ellipsis: true,
                      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text>,
                    },
                    { title: 'Description', dataIndex: 'description', ellipsis: true },
                    {
                      title: 'Status', dataIndex: 'posting_status', width: 90, align: 'center' as const,
                      render: (v: string) => <Tag color={v === 'POSTED' ? 'success' : 'default'} style={{ fontSize: 10 }}>{v || '—'}</Tag>,
                    },
                    {
                      title: 'Dr Amount', dataIndex: 'accounted_dr', width: 120, align: 'right' as const,
                      render: (v: any) => Number(v) ? <Text style={{ color: REDWOOD.info }}>{fmtAmt(Number(v))}</Text> : <Text type="secondary">—</Text>,
                    },
                    {
                      title: 'Cr Amount', dataIndex: 'accounted_cr', width: 120, align: 'right' as const,
                      render: (v: any) => Number(v) ? <Text style={{ color: REDWOOD.success }}>{fmtAmt(Number(v))}</Text> : <Text type="secondary">—</Text>,
                    },
                  ]}
                  summary={() => (
                    <Table.Summary fixed>
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={6} align="right"><Text strong>{acctMode === 'all' ? 'Total (all periods)' : 'Total'}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: REDWOOD.info }}>{fmtAmt(totalDr)}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmtAmt(totalCr)}</Text></Table.Summary.Cell>
                      </Table.Summary.Row>
                    </Table.Summary>
                  )}
                />
                <div style={{ marginTop: 6 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    Source: reerp/gl/journals/lines?{acctMode === 'period' ? `reference2=${acctCtx?.scheduleId}` : `reference1=${acctCtx?.invoiceNumber}`}&reference5=MPA_ACCRUAL
                  </Text>
                </div>
              </>
            );
          })()}
        </Modal>

        {/* ── API Debug Modal ──────────────────────────────────────────── */}
        <Modal
          open={apiModalOpen}
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />Page APIs — Multiperiod Accounting</Space>}
          onCancel={() => setApiModalOpen(false)}
          footer={<Button onClick={() => setApiModalOpen(false)}>Close</Button>}
          width={800}
        >
          <div style={{ marginBottom: 12 }}>
            <Tag color="blue">Module: ap</Tag>
            <Tag color="green">Source: Oracle APEX ORDS</Tag>
          </div>

          {/* Endpoint reference table */}
          <Table
            size="small"
            pagination={false}
            style={{ marginBottom: lastApiUrl ? 16 : 0 }}
            dataSource={[
              { method: 'GET',  endpoint: `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/fusion-data`,       purpose: 'Data from Fusion — AP invoice lines with MPA dates' },
              { method: 'GET',  endpoint: `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/fusion-detail/:id`, purpose: 'Fusion Detail — per-line schedule with posted/pending totals' },
              { method: 'GET',  endpoint: `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod`,                  purpose: 'Search — list invoices with MPA schedules' },
              { method: 'GET',  endpoint: `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/:invoice_id`,      purpose: 'Detail — schedule lines for one invoice' },
              { method: 'POST', endpoint: `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/generate`,         purpose: 'Generate / refresh schedule for an invoice' },
              { method: 'POST', endpoint: `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod/mark-posted`,      purpose: 'Mark period lines as Posted after SLA create' },
            ]}
            rowKey="endpoint"
            columns={[
              { title: 'Method', dataIndex: 'method', width: 70,
                render: v => <Tag color={v === 'GET' ? 'blue' : 'orange'}>{v}</Tag> },
              { title: 'Endpoint', dataIndex: 'endpoint', ellipsis: true,
                render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
              { title: 'Purpose', dataIndex: 'purpose' },
            ]}
          />

          {/* Last called URL */}
          {lastApiUrl && (
            <Card
              size="small"
              title={
                <Space>
                  <span style={{ color: lastApiStatus === 'error' ? '#ff4d4f' : '#52c41a' }}>●</span>
                  <Text strong>Last Search Request</Text>
                  <Tag color={lastApiStatus === 'error' ? 'red' : 'green'}>
                    {lastApiStatus === 'error' ? 'Failed' : 'Success'}
                  </Tag>
                  {lastApiNote && <Text type="secondary" style={{ fontSize: 12 }}>{lastApiNote}</Text>}
                </Space>
              }
              style={{ border: `1px solid ${lastApiStatus === 'error' ? '#ff4d4f' : '#52c41a'}` }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text code style={{ fontSize: 11, flex: 1, wordBreak: 'break-all' }}>{lastApiUrl}</Text>
                <Tooltip title={copiedUrl ? 'Copied!' : 'Copy URL'}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(lastApiUrl);
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                  />
                </Tooltip>
                <Tooltip title="Open in new tab">
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    onClick={() => window.open(lastApiUrl, '_blank')}
                  />
                </Tooltip>
              </div>
            </Card>
          )}

          {!lastApiUrl && (
            <Alert type="info" showIcon message="Run a search to see the last called API URL here." />
          )}
        </Modal>

        {/* ── Bulk Generate Schedule Modal ── */}
        <Modal
          open={bulkModalOpen}
          onCancel={() => { if (!bulkRunning) setBulkModalOpen(false); }}
          closable={!bulkRunning}
          maskClosable={!bulkRunning}
          width={700}
          title={
            <Space>
              <SyncOutlined style={{ color: '#722ed1' }} />
              <span>Generate Schedule — Pending Invoices</span>
              <Tag color="purple">{bulkInvoices.length} pending</Tag>
            </Space>
          }
          footer={
            bulkProgress.total > 0 && bulkProgress.done === bulkProgress.total ? (
              <Button type="primary" onClick={() => setBulkModalOpen(false)}>Done</Button>
            ) : (
              <Space>
                <Button onClick={() => setBulkModalOpen(false)} disabled={bulkRunning}>Cancel</Button>
                <Button
                  type="primary"
                  icon={<SyncOutlined spin={bulkRunning} />}
                  loading={bulkRunning}
                  disabled={bulkSelected.size === 0}
                  style={{ background: '#722ed1', borderColor: '#722ed1' }}
                  onClick={handleBulkGenerate}
                >
                  Generate Schedule ({bulkSelected.size})
                </Button>
              </Space>
            )
          }
          styles={{ body: { maxHeight: '65vh', overflowY: 'auto', padding: '12px 20px' } }}
        >
          {bulkProgress.total === 0 ? (
            /* ── Selection list ── */
            <>
              {bulkInvoices.length === 0 ? (
                <Alert type="success" showIcon message="All invoices in the current search already have schedules generated." />
              ) : (
                <>
                  <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input
                      type="checkbox"
                      id="select-all-bulk"
                      checked={bulkSelected.size === bulkInvoices.length}
                      ref={el => { if (el) el.indeterminate = bulkSelected.size > 0 && bulkSelected.size < bulkInvoices.length; }}
                      onChange={e => setBulkSelected(e.target.checked ? new Set(bulkInvoices.map(r => r.invoiceId)) : new Set())}
                    />
                    <label htmlFor="select-all-bulk" style={{ fontWeight: 600, cursor: 'pointer' }}>
                      Select All ({bulkInvoices.length} invoices)
                    </label>
                  </div>
                  <Table
                    dataSource={bulkInvoices}
                    rowKey="invoiceId"
                    size="small"
                    pagination={false}
                    scroll={{ y: 340 }}
                    columns={[
                      {
                        title: '', width: 40,
                        render: (_, rec) => (
                          <input
                            type="checkbox"
                            checked={bulkSelected.has(rec.invoiceId)}
                            onChange={e => setBulkSelected(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(rec.invoiceId) : next.delete(rec.invoiceId);
                              return next;
                            })}
                          />
                        ),
                      },
                      { title: 'Invoice Number', dataIndex: 'invoiceNumber', width: 160 },
                      { title: 'Supplier', dataIndex: 'supplier', ellipsis: true },
                      { title: 'Business Unit', dataIndex: 'businessUnit', width: 160, ellipsis: true },
                      {
                        title: 'Amount', dataIndex: 'lineAmount', width: 120, align: 'right' as const,
                        render: (v: number, rec) => `${rec.invoiceCurrency} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                      },
                    ]}
                  />
                </>
              )}
            </>
          ) : (
            /* ── Progress view ── */
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text strong>{bulkRunning ? `Processing: ${bulkProgress.current}` : 'Completed'}</Text>
                  <Text type="secondary">{bulkProgress.done} / {bulkProgress.total}</Text>
                </div>
                <div style={{ background: '#f0f0f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, transition: 'width 0.3s',
                    background: bulkRunning ? '#722ed1' : '#52c41a',
                    width: `${Math.round(bulkProgress.done / bulkProgress.total * 100)}%`,
                  }} />
                </div>
              </div>
              <Table
                dataSource={bulkProgress.results}
                rowKey="invoiceId"
                size="small"
                pagination={false}
                scroll={{ y: 340 }}
                columns={[
                  { title: 'Invoice', dataIndex: 'invoiceNumber', width: 160 },
                  {
                    title: 'Result', dataIndex: 'status', width: 90,
                    render: (v: string) => v === 'ok'
                      ? <Tag color="success" icon={<CheckCircleOutlined />}>Generated</Tag>
                      : v === 'skip'
                      ? <Tag color="blue">Already Exists</Tag>
                      : <Tag color="error">Error</Tag>,
                  },
                  { title: 'Note', dataIndex: 'note', ellipsis: true },
                ]}
              />
            </>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default ManageMultiperiod;
