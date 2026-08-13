import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Row, Col, Breadcrumb, Typography, Select, Space,
  Button, Spin, Tag, Tooltip, message, Popover, Table, Alert, Divider, Input, Modal, Tabs,
} from 'antd';
import {
  HomeOutlined, LineChartOutlined, ReloadOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ApiOutlined,
  PlayCircleOutlined, SyncOutlined, CloudUploadOutlined, EyeOutlined,
  SwapOutlined, AuditOutlined, TableOutlined, FileExcelOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { Link, useNavigate } from 'react-router-dom';
import {
  getBookControls, getDeprnLastPeriod,
  getDeprnPreview, postDeprnCalculate,
  getDeprnWorkbench, getDeprnPeriods, getDeprnStatus, postSingleDeprn,
  getDeprnAccountingPreview, createSlaAccounting, markFaDeprnAccounted,
  getDeprnView,
} from '../../services/fa.service';
import { postSlaToGL } from '../../services/glPosting.service';
import { APEX_DB_CONFIG } from '../../config/api.config';
import type { BookControlRecord } from '../../services/fa.service';
import { useAuth } from '../../context/AuthContext';
import { validateAccountCode } from '../../components/AccountSelector';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral500: '#8C8C8C',
  surface:    '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Period straight-line depreciation (same daily-rate math as the Manage
// Assets "Depreciation Preview" dialog) — returns the depreciation for one
// target period ("MMM-YY", e.g. "Apr-26"). Used to show/post the amount for
// assets that are not yet depreciated in that period.
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const periodLabel = (y: number, m: number) => `${MON[m]}-${String(y).slice(-2)}`;
// Previous period name from a 'MMM-YY' label (e.g. 'Apr-26' -> 'Mar-26').
const prevPeriodName = (name?: string): string => {
  if (!name) return '';
  const m = MON.indexOf(name.slice(0, 3));
  const yy = parseInt(name.slice(4), 10);
  if (m < 0 || isNaN(yy)) return '';
  const d = new Date(2000 + yy, m, 1);
  d.setMonth(d.getMonth() - 1);
  return `${MON[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
};
const computePeriodDeprn = (
  cost: number, salvage: number, life: number, dpis?: string, deprnStart?: string, target?: string,
): number | null => {
  if (!cost || cost <= 0 || !life || life <= 0 || !target) return null;
  let startY: number, startM: number;
  if (dpis) {
    const d = new Date(dpis); if (isNaN(d.getTime())) return null;
    // depreciation starts the month AFTER date-placed-in-service
    startY = d.getFullYear() + Math.floor((d.getMonth() + 1) / 12);
    startM = (d.getMonth() + 1) % 12;
  } else if (deprnStart) {
    const d = new Date(deprnStart); if (isNaN(d.getTime())) return null;
    startY = d.getFullYear(); startM = d.getMonth();
  } else return null;

  let totalDays = 0;
  for (let i = 0; i < life; i++) {
    totalDays += daysInMonth(startY + Math.floor((startM + i) / 12), (startM + i) % 12);
  }
  if (totalDays <= 0) return null;
  const dailyRate = (cost - salvage) / totalDays;

  let nbv = cost;
  for (let i = 0; i < life + 3; i++) {
    const yy = startY + Math.floor((startM + i) / 12);
    const mm = (startM + i) % 12;
    const depr = Math.min(dailyRate * daysInMonth(yy, mm), nbv - salvage);
    if (depr <= 0) continue;
    if (periodLabel(yy, mm).toUpperCase() === target.toUpperCase()) return Math.round(depr * 100) / 100;
    nbv -= depr;
  }
  return null;
};

// Months of depreciation elapsed from the depreciation start (month AFTER
// date-placed-in-service, or deprnStart) up to and INCLUDING the target period.
const monthsElapsedTo = (dpis?: string, deprnStart?: string, target?: string): number | null => {
  let sy: number, sm: number;
  if (dpis) { const d = new Date(dpis); if (isNaN(d.getTime())) return null; sy = d.getFullYear() + Math.floor((d.getMonth() + 1) / 12); sm = (d.getMonth() + 1) % 12; }
  else if (deprnStart) { const d = new Date(deprnStart); if (isNaN(d.getTime())) return null; sy = d.getFullYear(); sm = d.getMonth(); }
  else return null;
  if (!target) return null;
  const ti = MON.indexOf(target.slice(0, 3)); const tyy = parseInt(target.slice(4), 10);
  if (ti < 0 || isNaN(tyy)) return null;
  return (2000 + tyy) * 12 + ti - (sy * 12 + sm) + 1;
};

type ViewMode = 'last' | 'preview' | 'compare' | 'status';

const CalculateDeprn: React.FC = () => {
  const navigate = useNavigate();
  const [bookControls, setBookControls] = useState<BookControlRecord[]>([]);
  const [selectedBook, setSelectedBook] = useState<string>('');
  const [lastPeriod,   setLastPeriod]   = useState<any | null>(null);
  const [loading,      setLoading]      = useState(false);

  // Last period workbench
  const [wbItems,   setWbItems]   = useState<any[]>([]);
  const [wbSummary, setWbSummary] = useState<any>(null);
  const [wbLoading, setWbLoading] = useState(false);

  // Preview (next period calculated)
  const [previewItems,   setPreviewItems]   = useState<any[]>([]);
  const [previewSummary, setPreviewSummary] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewed,      setPreviewed]      = useState(false);

  // Posting
  const [posting, setPosting] = useState(false);

  // Which table to show
  const [viewMode, setViewMode] = useState<ViewMode>('last');

  // Outer page tabs: Calculate Depreciation | View Depreciation
  const [pageTab, setPageTab] = useState<'calculate' | 'view'>('calculate');

  // ── View Depreciation (pivot: assets × selected periods) ──
  const [viewPeriodNames, setViewPeriodNames] = useState<string[]>([]);  // selected period names
  const [viewAssetFilter, setViewAssetFilter] = useState('');            // optional asset# filter
  const [viewCols,    setViewCols]    = useState<string[]>([]);          // resolved period columns (chronological)
  const [viewRows,    setViewRows]    = useState<any[]>([]);             // pivoted rows
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSearch,  setViewSearch]  = useState('');
  const [viewError,   setViewError]   = useState('');

  // Status-by-period (all assets)
  const [periodsList,     setPeriodsList]     = useState<any[]>([]);
  const [statusPeriodName, setStatusPeriodName] = useState<string>('');   // period name (resolved server-side)
  const [statusItems,   setStatusItems]   = useState<any[]>([]);
  const [statusSummary, setStatusSummary] = useState<any>(null);
  const [statusMeta,    setStatusMeta]    = useState<{ periodName?: string; postedCount?: number; notPostedCount?: number; totalCount?: number } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusFilter,  setStatusFilter]  = useState<'all' | 'posted' | 'notposted'>('all');
  const [statusError,   setStatusError]   = useState('');
  const [statusUrl,     setStatusUrl]     = useState('');
  const [statusSelected, setStatusSelected] = useState<string[]>([]);   // selected assetIds
  const [statusPosting,  setStatusPosting]  = useState(false);
  const [statusPrev,     setStatusPrev]     = useState<Record<string, number>>({});  // prev-period deprn by assetId
  const [statusPrevName, setStatusPrevName] = useState('');
  const [statusSearch,   setStatusSearch]   = useState('');   // quick filter across all columns
  const [comboDesc,      setComboDesc]      = useState<Record<string, string>>({});  // account combo -> segment descriptions
  // Create Depreciation debug dialog — two phases per asset:
  //   1) create depreciation  (POST fa/deprn-post-single)
  //   2) create accounting     (SLA create -> GL post -> mark accounted)
  interface AcctLine { label: string; account: string; desc?: string; dr: number; cr: number; }
  interface DeprnStep {
    assetId: string; assetNumber: string; kind: 'deprn' | 'acct';
    method: string; url: string; payload: any;
    status: 'pending' | 'posting' | 'done' | 'error' | 'skipped';
    detail?: string; response?: any; expanded?: boolean;
    amount?: number; acctLines?: AcctLine[];   // Dr/Cr preview on the accounting step
  }
  const [deprnModalOpen, setDeprnModalOpen] = useState(false);
  const [deprnSteps,     setDeprnSteps]     = useState<DeprnStep[]>([]);
  const [deprnRunning,   setDeprnRunning]   = useState(false);
  // View Journal modal
  const [journalModal, setJournalModal] = useState<{ assetNumber: string; url: string; loading: boolean; lines: any[]; error?: string } | null>(null);
  // Create Accounting modal (for a Posted deprn row) — reuses the SAME flow as
  // the Manage Assets Depreciation tab: getDeprnAccountingPreview -> createSlaAccounting
  // -> postSlaToGL -> markFaDeprnAccounted, showing Dr/Cr and per-step URL/payload.
  interface AcctStepUI {
    label: string; method: string; url: string; payload?: any; response?: any;
    status: 'pending' | 'posting' | 'done' | 'error'; detail?: string; expanded?: boolean;
  }
  interface AcctModalState {
    assetId: string; assetNumber: string; periodName: string; distributionId?: number | null;
    loading: boolean; error?: string; preview?: any; acctLines?: AcctLine[];
    posting: boolean; posted: boolean; steps: AcctStepUI[];
  }
  const [acctModal, setAcctModal] = useState<AcctModalState | null>(null);

  // Bulk "Create Accounting for All" modal — accounts every Posted-but-unaccounted
  // line, reusing the exact same per-row flow, and shows each line's status.
  interface BulkAcctRow {
    assetId: string; assetNumber: string; periodName: string; distributionId?: number | null;
    status: 'pending' | 'running' | 'done' | 'error' | 'skipped'; detail?: string;
  }
  const [bulkAcct, setBulkAcct] = useState<{ open: boolean; running: boolean; done: boolean; rows: BulkAcctRow[] } | null>(null);

  const { user } = useAuth();
  const loggedUser = user?.username || user?.name || 'REACTERP';

  useEffect(() => {
    getBookControls().then((bc) => {
      setBookControls(bc);
      if (bc.length > 0) setSelectedBook(bc[0].bookTypeCode);
    });
  }, []);

  const loadAll = useCallback(async (book: string) => {
    if (!book) return;
    setLoading(true);
    setPreviewed(false);
    setPreviewItems([]);
    setPreviewSummary(null);
    setViewMode('last');
    try {
      const last = await getDeprnLastPeriod(book);
      setLastPeriod(last);

      if (last?.lastPeriodCounter) {
        setWbLoading(true);
        const wb = await getDeprnWorkbench({
          bookTypeCode:  book,
          periodCounter: last.lastPeriodCounter,
          limit: 500,
        });
        setWbItems(wb.items || []);
        setWbSummary(wb.summary || null);
        setWbLoading(false);
      } else {
        setWbItems([]);
        setWbSummary(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBook) loadAll(selectedBook);
  }, [selectedBook, loadAll]);

  // Load the full period list for the status-by-period selector
  useEffect(() => {
    if (!selectedBook) { setPeriodsList([]); return; }
    getDeprnPeriods(selectedBook).then((ps) => setPeriodsList(ps || []));
  }, [selectedBook]);

  // Period options. The server list (fa/deprn-periods) only returns whatever is
  // loaded in RR_FA_DEPRN_PERIODS — often just the current/next period — so the
  // picker would be limited to those. Depreciation for any month is computed by
  // name (client + server), so we additionally generate a rolling window of
  // periods around the last run so the user can pick any month / full year.
  const periodOptions = React.useMemo(() => {
    const pk = (name: string) => {
      const m = MON.indexOf(name.slice(0, 3));
      const yy = parseInt(name.slice(4), 10);
      return (isNaN(yy) ? 0 : yy) * 12 + (m < 0 ? 0 : m);
    };
    const seen = new Set<string>();
    const out: { name: string; fy?: string }[] = [];
    const add = (name?: string, fy?: string) => {
      if (name && !seen.has(name.toUpperCase())) { seen.add(name.toUpperCase()); out.push({ name, fy }); }
    };
    // 1) server-provided periods carry the real fiscal year — add them first.
    (periodsList || []).forEach((p: any) => add(p.periodName, p.fiscalYear));
    add(lastPeriod?.lastPeriodName, lastPeriod?.fiscalYear);
    add(lastPeriod?.nextPeriodName);
    // 2) generate a window: 6 months forward .. 30 back from the last-run month
    //    (or today if unknown). fy is left blank for generated ones.
    const baseName: string | undefined = lastPeriod?.lastPeriodName;
    const bidx = baseName ? MON.indexOf(baseName.slice(0, 3)) : -1;
    let by: number, bm: number;
    if (baseName && bidx >= 0) { by = 2000 + parseInt(baseName.slice(4), 10); bm = bidx; }
    else { const d = new Date(); by = d.getFullYear(); bm = d.getMonth(); }
    for (let off = 6; off >= -30; off--) {
      const total = by * 12 + bm + off;
      const y = Math.floor(total / 12);
      const m = ((total % 12) + 12) % 12;
      add(periodLabel(y, m));
    }
    out.sort((a, b) => pk(b.name) - pk(a.name));  // newest first
    return out;
  }, [periodsList, lastPeriod]);

  // Default the selection to the last run period once options are known
  useEffect(() => {
    if (!statusPeriodName && periodOptions.length > 0) {
      setStatusPeriodName(lastPeriod?.lastPeriodName || periodOptions[0].name);
    }
  }, [periodOptions, lastPeriod, statusPeriodName]);

  const handleShowStatus = useCallback(async (periodName: string) => {
    if (!selectedBook || !periodName) return;
    setStatusLoading(true);
    setStatusError('');
    setStatusSelected([]);
    setStatusSearch('');
    setViewMode('status');
    const url = `${APEX_DB_CONFIG.baseUrl}/fa/deprn-by-period?bookTypeCode=${encodeURIComponent(selectedBook)}&periodName=${encodeURIComponent(periodName)}`;
    setStatusUrl(url);
    try {
      const res = await getDeprnStatus({ bookTypeCode: selectedBook, periodName });
      if (res.success === false) {
        setStatusError(res.error || 'Failed to load status');
        setStatusItems([]); setStatusSummary(null); setStatusMeta(null);
        message.error(res.error || 'Failed to load status');
        return;
      }
      setStatusItems(res.items || []);
      setStatusSummary(res.summary || null);
      setStatusMeta({
        periodName: res.periodName,
        postedCount: res.postedCount,
        notPostedCount: res.notPostedCount,
        totalCount: res.totalCount,
      });

      // Also fetch the PREVIOUS period so we can show it alongside the current.
      const prevName = prevPeriodName(res.periodName || periodName);
      setStatusPrevName(prevName);
      if (prevName) {
        const pres = await getDeprnStatus({ bookTypeCode: selectedBook, periodName: prevName });
        const map: Record<string, number> = {};
        (pres.items || []).forEach((it: any) => {
          if (it.deprnAmount != null) map[String(it.assetId)] = Number(it.deprnAmount);
        });
        setStatusPrev(map);
      } else {
        setStatusPrev({});
      }
    } finally {
      setStatusLoading(false);
    }
  }, [selectedBook]);

  const handlePreview = async () => {
    if (!lastPeriod?.nextPeriodName) return;
    setPreviewLoading(true);
    setViewMode('preview');
    try {
      const result = await getDeprnPreview(selectedBook, lastPeriod.nextPeriodName);
      if (result.success) {
        setPreviewItems(result.items || []);
        setPreviewSummary(result.summary || null);
        setPreviewed(true);
      } else {
        message.error(result.error || 'Preview failed');
        setViewMode('last');
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePost = async () => {
    if (!lastPeriod?.nextPeriodName || !lastPeriod?.lastPeriodCounter) return;
    setPosting(true);
    try {
      const result = await postDeprnCalculate({
        bookTypeCode:  selectedBook,
        periodName:    lastPeriod.nextPeriodName,
        periodCounter: Number(lastPeriod.lastPeriodCounter) + 1,
      });
      if (result.success) {
        message.success(`Depreciation posted for ${lastPeriod.nextPeriodName} — ${result.assetsProcessed} assets processed`);
        await loadAll(selectedBook);
      } else {
        message.error(result.error || 'Post failed');
      }
    } finally {
      setPosting(false);
    }
  };

  const fmtDate = (v: string | null | undefined) => {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const apiContent = (
    <div style={{ maxWidth: 560, fontSize: 12 }}>
      <div style={{ marginBottom: 10 }}>
        <Text strong>1. Last period status</Text>
        <Typography.Text copyable code style={{ display: 'block', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
          {`${APEX_DB_CONFIG.baseUrl}/fa/deprn-periods/last?bookTypeCode=${encodeURIComponent(selectedBook)}`}
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 10 }}>
        <Text strong>2. Last period actuals (workbench)</Text>
        <Typography.Text copyable code style={{ display: 'block', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
          {`${APEX_DB_CONFIG.baseUrl}/fa/deprn-workbench?bookTypeCode=${encodeURIComponent(selectedBook)}&periodCounter=${lastPeriod?.lastPeriodCounter || '...'}`}
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 10 }}>
        <Text strong>3. Preview next period depreciation</Text>
        <Typography.Text copyable code style={{ display: 'block', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
          {`${APEX_DB_CONFIG.baseUrl}/fa/deprn-calculate/preview?bookTypeCode=${encodeURIComponent(selectedBook)}&periodName=${encodeURIComponent(lastPeriod?.nextPeriodName || '')}`}
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 10 }}>
        <Text strong>Status by period (all assets)</Text>
        <Typography.Text copyable code style={{ display: 'block', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
          {`${APEX_DB_CONFIG.baseUrl}/fa/deprn-by-period?bookTypeCode=${encodeURIComponent(selectedBook)}&periodName=${encodeURIComponent(statusPeriodName || '...')}`}
        </Typography.Text>
      </div>
      <div>
        <Text strong>4. Post depreciation</Text>
        <Typography.Text copyable code style={{ display: 'block', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
          {`POST ${APEX_DB_CONFIG.baseUrl}/fa/deprn-calculate`}
        </Typography.Text>
        <Typography.Text code style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
          {`{ "bookTypeCode": "${selectedBook}", "periodName": "${lastPeriod?.nextPeriodName || ''}", "periodCounter": ${lastPeriod?.lastPeriodCounter ? Number(lastPeriod.lastPeriodCounter) + 1 : '...'} }`}
        </Typography.Text>
      </div>
    </div>
  );

  const summaryCards = (summary: any, isPreview: boolean) => [
    { label: 'Total Cost',       value: summary?.totalCost,                          color: '#1677ff' },
    { label: isPreview ? 'Calculated Deprn' : 'Deprn Amount', value: isPreview ? summary?.totalDeprnAmount : summary?.totalDeprnAmount, color: REDWOOD.primary },
    { label: isPreview ? 'New Reserve'      : 'Total Reserve', value: isPreview ? summary?.totalNewReserve  : summary?.totalDeprnReserve, color: REDWOOD.warning },
    { label: 'Total NBV',        value: summary?.totalNbv,                           color: REDWOOD.success },
  ];

  const lastColumns = [
    { title: 'Asset #',       dataIndex: 'assetNumber',  key: 'assetNumber',  width: 100, fixed: 'left' as const,
      render: (v: string) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{v}</Text> },
    { title: 'Description',   dataIndex: 'description',  key: 'description',  width: 220,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'FY',            dataIndex: 'fiscalYear',   key: 'fiscalYear',   width: 60 },
    { title: 'Cost',          dataIndex: 'adjustedCost', key: 'adjustedCost', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'Deprn Amount',  dataIndex: 'deprnAmount',  key: 'deprnAmount',  width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, color: REDWOOD.primary, fontWeight: 600 }}>{fmt(v)}</Text> },
    { title: 'YTD Deprn',     dataIndex: 'ytdDeprn',     key: 'ytdDeprn',     width: 120, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'Reserve',       dataIndex: 'deprnReserve', key: 'deprnReserve', width: 120, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'NBV',           dataIndex: 'nbv',          key: 'nbv',          width: 120, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, color: REDWOOD.success, fontWeight: 600 }}>{fmt(v)}</Text> },
    { title: 'Run Date',      dataIndex: 'deprnRunDate', key: 'deprnRunDate', width: 120,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text> },
  ];

  const previewColumns = [
    { title: 'Asset #',      dataIndex: 'assetNumber',  key: 'assetNumber',  width: 100, fixed: 'left' as const,
      render: (v: string) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{v}</Text> },
    { title: 'Description',  dataIndex: 'description',  key: 'description',  width: 220,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Method',       dataIndex: 'methodCode',   key: 'methodCode',   width: 90,
      render: (v: string) => <Tag style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    { title: 'Life (Months)',dataIndex: 'lifeInMonths', key: 'lifeInMonths', width: 110, align: 'right' as const },
    { title: 'Cost',         dataIndex: 'adjustedCost', key: 'adjustedCost', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'Salvage',      dataIndex: 'salvageValue', key: 'salvageValue', width: 110, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'Deprn Amount', dataIndex: 'deprnAmount',  key: 'deprnAmount',  width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, color: REDWOOD.primary, fontWeight: 600 }}>{fmt(v)}</Text> },
    { title: 'Prior Reserve',dataIndex: 'priorReserve', key: 'priorReserve', width: 120, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'New Reserve',  dataIndex: 'newReserve',   key: 'newReserve',   width: 120, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'NBV',          dataIndex: 'nbv',          key: 'nbv',          width: 120, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, color: REDWOOD.success, fontWeight: 600 }}>{fmt(v)}</Text> },
  ];

  const compareColumns = [
    { title: 'Asset #',     dataIndex: 'assetNumber', key: 'assetNumber', width: 100, fixed: 'left' as const,
      render: (v: string) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', key: 'description', width: 200,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Method',      dataIndex: 'methodCode',  key: 'methodCode',  width: 80,
      render: (v: string) => <Tag style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    { title: lastPeriod?.lastPeriodName ?? 'Last Deprn', dataIndex: 'lastDeprn', key: 'lastDeprn', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: lastPeriod?.nextPeriodName ?? 'Next Deprn', dataIndex: 'nextDeprn', key: 'nextDeprn', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, color: '#1677ff', fontWeight: 600 }}>{fmt(v)}</Text> },
    { title: 'Difference',  dataIndex: 'difference',  key: 'difference',  width: 130, align: 'right' as const,
      render: (v: number) => {
        const color = v > 0 ? REDWOOD.primary : v < 0 ? REDWOOD.success : REDWOOD.neutral500;
        const prefix = v > 0 ? '+' : '';
        return <Text style={{ fontSize: 12, fontWeight: 700, color }}>{v === 0 ? '—' : `${prefix}${fmt(v)}`}</Text>;
      },
    },
    { title: `${lastPeriod?.lastPeriodName ?? 'Last'} NBV`, dataIndex: 'lastNbv', key: 'lastNbv', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    { title: `${lastPeriod?.nextPeriodName ?? 'Next'} NBV`, dataIndex: 'nextNbv', key: 'nextNbv', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, color: REDWOOD.success }}>{fmt(v)}</Text> },
  ];

  const monoRed = { fontSize: 12, fontFamily: 'monospace', color: REDWOOD.primary, fontWeight: 600 } as const;
  const mono   = { fontSize: 12, fontFamily: 'monospace' } as const;
  const statusColumns = [
    { title: 'Asset #',     dataIndex: 'assetNumber', key: 'assetNumber', width: 100, fixed: 'left' as const,
      render: (v: string) => (
        <Tooltip title="Open asset details">
          <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12, fontWeight: 600 }}
            onClick={() => navigate(`/fa/assets?assetNumber=${encodeURIComponent(v)}&from=deprn`)}>
            {v}
          </Button>
        </Tooltip>
      ) },
    { title: 'Description', dataIndex: 'description', key: 'description', width: 190, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v || '—'}</Text></Tooltip> },
    { title: 'Cost',        dataIndex: 'cost', key: 'cost', width: 130, align: 'right' as const,
      render: (v: any) => <Text style={mono}>{v == null ? '—' : fmt(Number(v))}</Text> },
    { title: 'Total Life',  dataIndex: 'lifeInMonths', key: 'lifeInMonths', width: 90, align: 'right' as const,
      render: (v: any) => <Text style={{ fontSize: 12 }}>{v == null || v === '' ? '—' : Number(v)}</Text> },
    { title: 'Remaining Life', dataIndex: 'remainingLife', key: 'remainingLife', width: 110, align: 'right' as const,
      render: (v: number | null) => v == null
        ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        : <Text style={{ fontSize: 12, color: v === 0 ? REDWOOD.neutral500 : REDWOOD.warning, fontWeight: 600 }}>{v}</Text> },
    { title: 'Period',      dataIndex: 'periodName', key: 'periodName', width: 90,
      render: (v: string) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{v || statusMeta?.periodName || '—'}</Text> },
    { title: 'Days',        dataIndex: 'days', key: 'days', width: 70, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Daily Rate',  dataIndex: 'dailyRate', key: 'dailyRate', width: 110, align: 'right' as const,
      render: (v: number) => <Text style={mono}>{v == null ? '—' : fmt(v)}</Text> },
    { title: `Deprn${statusPrevName ? ` (${statusPrevName})` : ' (Prev)'}`, dataIndex: 'prevDeprn', key: 'prevDeprn', width: 120, align: 'right' as const,
      render: (v: number | null) => v == null
        ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        : <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.neutral500 }}>{fmt(v)}</Text> },
    { title: `Calculated${statusMeta?.periodName ? ` (${statusMeta.periodName})` : ''}`, dataIndex: 'periodDeprn', key: 'periodDeprn', width: 140, align: 'right' as const,
      render: (v: number | null) => v == null
        ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        : <Text style={monoRed} title="Calculated (straight-line)">{fmt(v)}</Text> },
    { title: `Posted${statusMeta?.periodName ? ` (${statusMeta.periodName})` : ''}`, dataIndex: 'periodActual', key: 'periodActual', width: 140, align: 'right' as const,
      render: (v: number | null, r: any) => r.status !== 'Posted'
        ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        : v == null
          ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
          : <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success, fontWeight: 600 }} title="Actual posted amount">{fmt(v)}</Text> },
    { title: 'Debit Account', dataIndex: 'deprnExpenseAccount', key: 'deprnExpenseAccount', width: 240,
      render: (v: string) => v
        ? <Tooltip title="Dr — Depreciation Expense">
            <div>
              <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.primary }}>{v}</Text>
              {comboDesc[v] ? <div style={{ fontSize: 10, color: REDWOOD.neutral500, lineHeight: 1.3, marginTop: 1 }}>{comboDesc[v]}</div> : null}
            </div>
          </Tooltip>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text> },
    { title: 'Credit Account', dataIndex: 'deprnReserveAccount', key: 'deprnReserveAccount', width: 240,
      render: (v: string) => v
        ? <Tooltip title="Cr — Accumulated Depreciation">
            <div>
              <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#1677ff' }}>{v}</Text>
              {comboDesc[v] ? <div style={{ fontSize: 10, color: REDWOOD.neutral500, lineHeight: 1.3, marginTop: 1 }}>{comboDesc[v]}</div> : null}
            </div>
          </Tooltip>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text> },
    { title: 'Status',      dataIndex: 'status', key: 'status', width: 110, fixed: 'right' as const,
      filters: [{ text: 'Posted', value: 'Posted' }, { text: 'Not Posted', value: 'Not Posted' }],
      onFilter: (value: any, r: any) => r.status === value,
      render: (v: string) => v === 'Posted'
        ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Posted</Tag>
        : <Tag color="default" icon={<ClockCircleOutlined />} style={{ fontSize: 11, color: REDWOOD.neutral500 }}>Not Posted</Tag> },
    { title: 'Accounting', key: 'actions', width: 150, fixed: 'right' as const,
      render: (_: any, r: any) => {
        if (r.status !== 'Posted') return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        const accounted = String(r.accountedStatus || '').toUpperCase() === 'ACCOUNTED';
        return accounted ? (
          <Space size={4}>
            <Tag color="success" style={{ fontSize: 10, margin: 0 }}>Accounted</Tag>
            <Tooltip title="View GL journal">
              <Button size="small" icon={<EyeOutlined />} onClick={() => openViewJournal(r)} style={{ fontSize: 11 }} />
            </Tooltip>
          </Space>
        ) : (
          <Tooltip title="Create accounting (SLA → GL journal) — same flow as the asset Depreciation tab">
            <Button size="small" type="primary" ghost icon={<AuditOutlined />} onClick={() => openAccounting(r)}
              style={{ fontSize: 11 }}>
              Create Accounting
            </Button>
          </Tooltip>
        );
      } },
  ];

  // Enrich each asset with the period's depreciation amount + schedule. Prefer
  // the server's values (days/dailyRate/opening/closing/deprnAmount); fall back
  // to the client calc if a field is missing. Exclude assets with 0 cost.
  const enrichedStatusItems = React.useMemo(() => {
    const target = statusMeta?.periodName || statusPeriodName;
    return statusItems
      .filter(r => Number(r.cost) > 0)
      .map(r => {
        const server = r.deprnAmount != null ? Number(r.deprnAmount) : null;
        const posted = r.status === 'Posted';
        // Always compute the client-side straight-line amount (the "calculated").
        const calc = computePeriodDeprn(
          Number(r.cost), Number(r.salvageValue ?? 0), Number(r.lifeInMonths ?? 0),
          r.datePlacedInService, r.deprnStartDate, target,
        );
        // previous period: from the prev-period fetch, else client calc
        const prev = statusPrev[String(r.assetId)] ?? (statusPrevName ? computePeriodDeprn(
          Number(r.cost), Number(r.salvageValue ?? 0), Number(r.lifeInMonths ?? 0),
          r.datePlacedInService, r.deprnStartDate, statusPrevName,
        ) : null);
        // Remaining life = total life − months depreciated up to this period.
        const life = Number(r.lifeInMonths ?? 0);
        const elapsed = life > 0 ? monthsElapsedTo(r.datePlacedInService, r.deprnStartDate, target) : null;
        const remainingLife = (life > 0 && elapsed != null)
          ? Math.max(0, Math.min(life, life - Math.max(0, elapsed)))
          : null;
        // periodDeprn = calculated (shown + used for posting); periodActual =
        // the actual posted amount from the server, only when the row is Posted.
        return { ...r, periodDeprn: calc ?? server, periodActual: posted ? server : null, prevDeprn: prev, remainingLife };
      });
  }, [statusItems, statusMeta, statusPeriodName, statusPrev, statusPrevName]);

  const filteredStatusItems = (() => {
    const byStatus = statusFilter === 'all'
      ? enrichedStatusItems
      : enrichedStatusItems.filter(r => statusFilter === 'posted' ? r.status === 'Posted' : r.status === 'Not Posted');
    const q = statusSearch.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(r =>
      [r.assetNumber, r.description, r.periodName ?? statusMeta?.periodName, r.methodCode,
       r.cost, r.lifeInMonths, r.remainingLife, r.days, r.dailyRate,
       r.prevDeprn, r.periodDeprn, r.periodActual, r.deprnExpenseAccount, r.deprnReserveAccount, r.status]
        .some(v => v != null && String(v).toLowerCase().includes(q)));
  })();

  // Build the debug steps for the selected lines and open the dialog.
  const openCreateDeprnDialog = () => {
    const target = statusMeta?.periodName || statusPeriodName;
    const rows = enrichedStatusItems.filter(r =>
      statusSelected.includes(String(r.assetId)) && r.status !== 'Posted' && (r.periodDeprn ?? 0) > 0);
    if (rows.length === 0) { message.warning('No postable lines selected (need Not-Posted with an amount).'); return; }
    const steps: DeprnStep[] = rows.map(r => {
      const aid = String(r.assetId);
      return {
        assetId: aid, assetNumber: r.assetNumber, kind: 'deprn' as const, method: 'POST',
        url: `${APEX_DB_CONFIG.baseUrl}/fa/deprn-post-single`,
        payload: { assetId: aid, bookTypeCode: selectedBook, periodName: target, deprnAmount: Number(r.periodDeprn), createdBy: loggedUser },
        status: 'pending' as const, expanded: rows.length <= 3,
      };
    });
    setDeprnSteps(steps);
    setDeprnModalOpen(true);
  };

  const setStep = (i: number, patch: Partial<DeprnStep>) =>
    setDeprnSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const distIdRef = React.useRef<Record<string, number | null>>({});
  const [deprnStepRunning, setDeprnStepRunning] = useState<number | null>(null);

  // ── Run ONE 'deprn' step (create depreciation) ──
  const runOneDeprn = async (i: number): Promise<boolean> => {
    const dStep = deprnSteps[i];
    if (!dStep || dStep.kind !== 'deprn') return false;
    setDeprnStepRunning(i);
    setStep(i, { status: 'posting' });
    const dRes = await postSingleDeprn(dStep.payload);
    const good = dRes.success || dRes.status === 'POSTED' || dRes.status === 'ALREADY_EXISTS';
    distIdRef.current[dStep.assetId] = dRes.distributionId ?? null;
    setStep(i, { status: good ? 'done' : 'error', response: dRes, detail: dRes.status });
    setDeprnStepRunning(null);
    return good;
  };

  // ── Create Accounting (standalone, for a Posted row) ────────────────────────
  // Resolve a code-combination's NATURAL ACCOUNT segment description only
  // (skip Company/Cost-Center/Default segments) for display under the combo.
  const describeCombo = async (combo?: string): Promise<string> => {
    if (!combo) return '';
    try {
      const v = await validateAccountCode(combo);
      const segs = Object.values(v.segmentDetails || {});
      const acct = segs.find(s => {
        const p = (s.name || '').toLowerCase();
        return p === 'account' || (p.includes('account') && !p.includes('sub') && !p.includes('chart') && !p.includes('offset'));
      });
      return acct?.description || '';
    } catch { return ''; }
  };

  // Resolve segment descriptions for every distinct Dr/Cr account combo in the
  // status grid, once each, and cache them for the "under the code" display.
  useEffect(() => {
    const combos = new Set<string>();
    enrichedStatusItems.forEach(r => {
      if (r.deprnExpenseAccount) combos.add(r.deprnExpenseAccount);
      if (r.deprnReserveAccount) combos.add(r.deprnReserveAccount);
    });
    const missing = [...combos].filter(c => comboDesc[c] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async c => [c, await describeCombo(c)] as const));
      if (cancelled) return;
      setComboDesc(prev => {
        const next = { ...prev };
        entries.forEach(([c, d]) => { next[c] = d; });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedStatusItems]);

  const setAcctStep = (i: number, patch: Partial<AcctStepUI>) =>
    setAcctModal(m => m && ({ ...m, steps: m.steps.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));

  // Open the Create Accounting dialog for a Posted deprn row. Depreciation is
  // already posted, so getDeprnAccountingPreview returns the real Dr/Cr lines.
  const openAccounting = async (r: any) => {
    const periodName = statusMeta?.periodName || statusPeriodName;
    const distId = r.distributionId ?? null;
    setAcctModal({
      assetId: String(r.assetId), assetNumber: r.assetNumber, periodName, distributionId: distId,
      loading: true, posting: false, posted: false, steps: [],
    });
    try {
      const preview = await getDeprnAccountingPreview(String(r.assetId), selectedBook, periodName, distId ?? undefined);
      if (!preview?.header || !(preview.lines?.length)) {
        setAcctModal(m => m && ({ ...m, loading: false, preview,
          error: (preview as any)?.error || 'No accounting preview returned — depreciation may not be posted for this period, or it is already accounted.' }));
        return;
      }
      const acctLines: AcctLine[] = await Promise.all((preview.lines as any[]).map(async (l) => ({
        label: l.accountingClass || l.lineType || `Line ${l.lineNumber}`,
        account: l.accountCombination,
        desc: await describeCombo(l.accountCombination),
        dr: Number(l.enteredDr || 0), cr: Number(l.enteredCr || 0),
      })));
      setAcctModal(m => m && ({ ...m, loading: false, preview, acctLines }));
    } catch (e: any) {
      setAcctModal(m => m && ({ ...m, loading: false, error: e?.message || 'Failed to load accounting preview' }));
    }
  };

  // Run the accounting flow: SLA create -> GL journal post -> mark accounted.
  const postAccounting = async () => {
    const m0 = acctModal;
    if (!m0?.preview?.header) return;
    const h = m0.preview.header;
    const lines: any[] = m0.preview.lines;
    const distId = m0.distributionId ?? null;

    const slaBody = {
      header: { moduleName: h.moduleName, sourceTable: h.sourceTable, sourceId: h.sourceId, sourceNumber: h.sourceNumber,
        sourceType: h.sourceType, eventTypeCode: h.eventTypeCode, eventDate: h.eventDate, accountingDate: h.accountingDate,
        periodName: h.periodName, ledgerId: h.ledgerId, ledgerName: h.ledgerName, currencyCode: h.currencyCode,
        ledgerCurrency: h.ledgerCurrency, description: h.description, createdBy: loggedUser },
      lines: lines.map((l) => ({ lineNumber: l.lineNumber, lineType: l.lineType, accountingClass: l.accountingClass,
        accountCombo: l.accountCombination, enteredDr: l.enteredDr, enteredCr: l.enteredCr, accountedDr: l.accountedDr,
        accountedCr: l.accountedCr, currencyCode: h.currencyCode, description: l.description, sourceLineId: h.sourceId, sourceLineNum: l.lineNumber })),
    };
    const markBody = {
      assetId: m0.assetId, bookTypeCode: selectedBook, distributionId: distId,
      periodName: m0.periodName, slaHeaderId: 0, glHeaderId: 0, createdBy: loggedUser,
    };
    const steps: AcctStepUI[] = [
      { label: '1 · Create SLA Accounting', method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`, payload: slaBody, status: 'pending', expanded: true },
      { label: '2 · Create + Post GL Journal', method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/create`, payload: { note: 'built by postSlaToGL from the SLA header' }, status: 'pending', expanded: false },
      { label: '3 · Mark Depreciation Accounted', method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/fa/accounting/mark-deprn-accounted`, payload: markBody, status: 'pending', expanded: false },
    ];
    setAcctModal(m => m && ({ ...m, posting: true, error: undefined, steps }));

    try {
      // Step 1 — SLA
      setAcctStep(0, { status: 'posting' });
      const slaRes = await createSlaAccounting(slaBody as any);
      if (!slaRes.headerId) {
        setAcctStep(0, { status: 'error', detail: slaRes.error || slaRes.message || 'SLA failed', response: slaRes });
        setAcctModal(m => m && ({ ...m, posting: false })); message.error(slaRes.error || slaRes.message || 'SLA accounting failed'); return;
      }
      setAcctStep(0, { status: 'done', detail: `SLA Header #${slaRes.headerId}`, response: slaRes });

      // Step 2 — GL
      setAcctStep(1, { status: 'posting' });
      const glRes = await postSlaToGL({
        slaHeaderId: slaRes.headerId, sourceNumber: String(h.sourceNumber || m0.assetNumber), sourceId: h.sourceId,
        eventTypeCode: h.eventTypeCode, periodName: h.periodName, ledgerName: h.ledgerName, ledgerId: h.ledgerId,
        currency: h.currencyCode, accountingDate: h.accountingDate, legalEntity: '', businessUnit: '',
        jeCategory: 'Depreciation', jeSource: 'Fixed Assets', batchSource: 'Fixed Assets',
        journalName: `FA Depreciation — ${h.sourceNumber || m0.assetNumber} — ${h.periodName}`,
        journalDescription: h.description, createdBy: loggedUser,
        lines: lines.map((l) => ({ lineType: l.lineType, enteredDr: l.enteredDr || null, enteredCr: l.enteredCr || null,
          accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null, description: l.description, currencyCode: h.currencyCode,
          accountingDate: h.accountingDate, accountCombination: l.accountCombination, accountingClass: l.accountingClass, legalEntity: null })),
      } as any);
      if (!glRes.success) {
        setAcctStep(1, { status: 'error', detail: glRes.error || 'GL post failed', response: glRes });
        setAcctModal(m => m && ({ ...m, posting: false })); message.error(glRes.error || 'GL journal post failed'); return;
      }
      setAcctStep(1, { status: 'done', detail: `GL Batch ${glRes.batchId} · Header ${glRes.headerId}`, response: glRes });

      // Step 3 — mark accounted
      const markPayload = { ...markBody, slaHeaderId: slaRes.headerId, glHeaderId: glRes.headerId ?? slaRes.headerId };
      setAcctStep(2, { status: 'posting', payload: markPayload });
      const markRes = await markFaDeprnAccounted(markPayload as any);
      if (markRes?.success === false) {
        setAcctStep(2, { status: 'error', detail: markRes.error || 'Mark failed', response: markRes });
        setAcctModal(m => m && ({ ...m, posting: false })); message.error(markRes.error || 'Failed to mark as accounted'); return;
      }
      setAcctStep(2, { status: 'done', detail: `${markRes.rowsUpdated || 1} row(s) updated`, response: markRes });

      setAcctModal(m => m && ({ ...m, posting: false, posted: true }));
      message.success(`Depreciation ${m0.periodName} accounted and posted to GL (Asset ${m0.assetNumber})`);
      // Refresh the status grid so the row flips to accounted (View Journal).
      handleShowStatus(statusPeriodName);
    } catch (e: any) {
      setAcctModal(m => m && ({ ...m, posting: false }));
      message.error(e?.message || 'Accounting failed');
    }
  };

  // Account ONE posted row end-to-end (preview -> SLA -> GL -> mark), no UI steps.
  // Returns { success, detail } for the bulk runner. Same logic as postAccounting.
  const accountOneRow = async (r: any): Promise<{ success: boolean; detail: string }> => {
    const periodName = statusMeta?.periodName || statusPeriodName;
    const distId = r.distributionId ?? null;
    try {
      const preview = await getDeprnAccountingPreview(String(r.assetId), selectedBook, periodName, distId ?? undefined);
      if (!preview?.header || !(preview.lines?.length)) {
        return { success: false, detail: (preview as any)?.error || 'No accounting preview (not posted / already accounted)' };
      }
      const h = preview.header;
      const lines: any[] = preview.lines;
      const slaBody = {
        header: { moduleName: h.moduleName, sourceTable: h.sourceTable, sourceId: h.sourceId, sourceNumber: h.sourceNumber,
          sourceType: h.sourceType, eventTypeCode: h.eventTypeCode, eventDate: h.eventDate, accountingDate: h.accountingDate,
          periodName: h.periodName, ledgerId: h.ledgerId, ledgerName: h.ledgerName, currencyCode: h.currencyCode,
          ledgerCurrency: h.ledgerCurrency, description: h.description, createdBy: loggedUser },
        lines: lines.map((l) => ({ lineNumber: l.lineNumber, lineType: l.lineType, accountingClass: l.accountingClass,
          accountCombo: l.accountCombination, enteredDr: l.enteredDr, enteredCr: l.enteredCr, accountedDr: l.accountedDr,
          accountedCr: l.accountedCr, currencyCode: h.currencyCode, description: l.description, sourceLineId: h.sourceId, sourceLineNum: l.lineNumber })),
      };
      const slaRes = await createSlaAccounting(slaBody as any);
      if (!slaRes.headerId) return { success: false, detail: slaRes.error || slaRes.message || 'SLA accounting failed' };

      const glRes = await postSlaToGL({
        slaHeaderId: slaRes.headerId, sourceNumber: String(h.sourceNumber || r.assetNumber), sourceId: h.sourceId,
        eventTypeCode: h.eventTypeCode, periodName: h.periodName, ledgerName: h.ledgerName, ledgerId: h.ledgerId,
        currency: h.currencyCode, accountingDate: h.accountingDate, legalEntity: '', businessUnit: '',
        jeCategory: 'Depreciation', jeSource: 'Fixed Assets', batchSource: 'Fixed Assets',
        journalName: `FA Depreciation — ${h.sourceNumber || r.assetNumber} — ${h.periodName}`,
        journalDescription: h.description, createdBy: loggedUser,
        lines: lines.map((l) => ({ lineType: l.lineType, enteredDr: l.enteredDr || null, enteredCr: l.enteredCr || null,
          accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null, description: l.description, currencyCode: h.currencyCode,
          accountingDate: h.accountingDate, accountCombination: l.accountCombination, accountingClass: l.accountingClass, legalEntity: null })),
      } as any);
      if (!glRes.success) return { success: false, detail: glRes.error || 'GL journal post failed' };

      const markRes = await markFaDeprnAccounted({
        assetId: String(r.assetId), bookTypeCode: selectedBook, distributionId: distId,
        periodName, slaHeaderId: slaRes.headerId, glHeaderId: glRes.headerId ?? slaRes.headerId, createdBy: loggedUser,
      } as any);
      if (markRes?.success === false) return { success: false, detail: markRes.error || 'Failed to mark accounted' };

      return { success: true, detail: `GL ${glRes.headerId ?? slaRes.headerId} · accounted` };
    } catch (e: any) {
      return { success: false, detail: e?.message || 'Accounting failed' };
    }
  };

  // Open the bulk-accounting dialog: gather all Posted-but-unaccounted lines.
  const openBulkAccounting = () => {
    const rows: BulkAcctRow[] = enrichedStatusItems
      .filter(r => r.status === 'Posted' && String(r.accountedStatus || '').toUpperCase() !== 'ACCOUNTED')
      .map(r => ({
        assetId: String(r.assetId), assetNumber: r.assetNumber,
        periodName: r.periodName ?? statusMeta?.periodName ?? statusPeriodName,
        distributionId: r.distributionId ?? null, status: 'pending' as const,
      }));
    if (rows.length === 0) { message.info('No posted, unaccounted lines to account.'); return; }
    setBulkAcct({ open: true, running: false, done: false, rows });
  };

  // Run accounting for every row in the bulk dialog, sequentially.
  const runBulkAccounting = async () => {
    if (!bulkAcct) return;
    setBulkAcct(m => m && ({ ...m, running: true, done: false }));
    const rows = bulkAcct.rows;
    for (let i = 0; i < rows.length; i++) {
      setBulkAcct(m => m && ({ ...m, rows: m.rows.map((x, idx) => idx === i ? { ...x, status: 'running' } : x) }));
      const res = await accountOneRow(rows[i]);
      setBulkAcct(m => m && ({ ...m, rows: m.rows.map((x, idx) => idx === i
        ? { ...x, status: res.success ? 'done' : 'error', detail: res.detail } : x) }));
    }
    setBulkAcct(m => m && ({ ...m, running: false, done: true }));
    message.success('Bulk accounting complete');
    handleShowStatus(statusPeriodName);
  };

  // Run a single depreciation step (per-step Run button)
  const runOneStep = async (i: number) => {
    setDeprnRunning(true);
    await runOneDeprn(i);
    setDeprnRunning(false);
  };

  // Run all depreciation steps
  const runDeprnSteps = async () => {
    setDeprnRunning(true);
    for (let i = 0; i < deprnSteps.length; i++) await runOneDeprn(i);
    setDeprnRunning(false);
    message.success('Depreciation posted — use the Create Accounting icon on each posted line to account it.');
    setStatusSelected([]);
    handleShowStatus(statusPeriodName);
  };

  // View the FA depreciation GL journal for a posted asset/period.
  const openViewJournal = async (r: any) => {
    const ref2 = r.distributionId ?? r.assetId;
    const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/lines?reference2=${encodeURIComponent(String(ref2))}&reference5=FA_DEPRECIATION`;
    setJournalModal({ assetNumber: r.assetNumber, url, loading: true, lines: [] });
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      const items: any[] = data.items ?? (Array.isArray(data) ? data : []);
      setJournalModal({ assetNumber: r.assetNumber, url, loading: false, lines: items });
    } catch (e: any) {
      setJournalModal({ assetNumber: r.assetNumber, url, loading: false, lines: [], error: e?.message });
    }
  };

  // ── View Depreciation: fetch each selected period and pivot into columns ──
  const periodKey = (name?: string): number => {
    if (!name) return 0;
    const m = MON.indexOf(name.slice(0, 3));
    const yy = parseInt(name.slice(4), 10);
    return (isNaN(yy) ? 0 : yy) * 12 + (m < 0 ? 0 : m);
  };

  // Months depreciated from the depreciation start up to (and including) a target
  // period. Start = month after DPIS (following-month convention) or deprnStart.
  const monthsDepreciated = (dpis?: string, deprnStart?: string, asOf?: string): number | null => {
    let sy: number, sm: number;
    if (dpis) { const d = new Date(dpis); if (isNaN(d.getTime())) return null; sy = d.getFullYear() + Math.floor((d.getMonth() + 1) / 12); sm = (d.getMonth() + 1) % 12; }
    else if (deprnStart) { const d = new Date(deprnStart); if (isNaN(d.getTime())) return null; sy = d.getFullYear(); sm = d.getMonth(); }
    else return null;
    if (!asOf) return null;
    const ai = MON.indexOf(asOf.slice(0, 3)); const ayy = parseInt(asOf.slice(4), 10);
    if (ai < 0 || isNaN(ayy)) return null;
    return (2000 + ayy) * 12 + ai - (sy * 12 + sm) + 1;   // inclusive
  };

  const handleViewFetch = async () => {
    if (!selectedBook || viewPeriodNames.length === 0) {
      message.warning('Select a book and at least one period.');
      return;
    }
    setViewLoading(true);
    setViewError('');
    setViewSearch('');
    try {
      const periods = [...viewPeriodNames].sort((a, b) => periodKey(a) - periodKey(b));
      const asOf = periods[periods.length - 1];   // latest period → remaining-life reference

      // Read straight from RR_FA_DEPRN_DETAIL (fa/deprn-view) — one call per
      // selected period. Only assets that actually have depreciation in the
      // detail table come back, so rows/cells are pure actuals (blank = no data).
      const byAsset: Record<string, any> = {};
      let anySucceeded = false;
      for (const pn of periods) {
        const res = await getDeprnView({ bookTypeCode: selectedBook, periodName: pn, assetNumber: viewAssetFilter || undefined });
        if (res.success === false || !Array.isArray(res.items)) continue;   // no data → nothing
        anySucceeded = true;
        (res.items as any[]).forEach((it) => {
          const aid = String(it.assetId);
          if (!byAsset[aid]) byAsset[aid] = {
            assetId: aid, assetNumber: it.assetNumber, description: it.description,
            cost: Number(it.cost), lifeInMonths: it.lifeInMonths != null ? Number(it.lifeInMonths) : null,
            datePlacedInService: it.datePlacedInService, deprnStartDate: it.deprnStartDate,
          };
          if (it.deprnAmount != null) byAsset[aid][pn] = Number(it.deprnAmount);
        });
      }

      if (!anySucceeded) {
        setViewError('The depreciation endpoint (fa/deprn-view) returned no data — check it is deployed and the selected period(s) exist in RR_FA_DEPRN_PERIODS.');
        setViewRows([]); setViewCols([]); return;
      }
      if (Object.keys(byAsset).length === 0) {
        setViewRows([]); setViewCols(periods); return;   // deployed but no posted rows for the selection
      }

      const rows = Object.values(byAsset).map((m: any) => {
        const used = m.lifeInMonths != null ? monthsDepreciated(m.datePlacedInService, m.deprnStartDate, asOf) : null;
        const remainingLife = (m.lifeInMonths != null && used != null)
          ? Math.max(0, Math.min(m.lifeInMonths, m.lifeInMonths - Math.max(0, used)))
          : null;
        const total = periods.reduce((s, pn) => s + (Number(m[pn]) || 0), 0);
        return { ...m, remainingLife, __total: total };
      });
      rows.sort((a: any, b: any) => String(a.assetNumber).localeCompare(String(b.assetNumber)));
      setViewCols(periods);
      setViewRows(rows);
    } catch (e: any) {
      setViewError(e?.message || 'Failed to fetch depreciation');
    } finally {
      setViewLoading(false);
    }
  };

  // Distinct years available across the period options (from the "MMM-YY" suffix).
  const yearOptions = React.useMemo(() => {
    const seen = new Map<string, string>();  // yy -> label
    periodOptions.forEach(p => {
      const yy = (p.name || '').slice(4);
      if (yy && !seen.has(yy)) seen.set(yy, `FY ${p.fy || yy} (20${yy})`);
    });
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label })).sort((a, b) => a.key.localeCompare(b.key));
  }, [periodOptions]);

  // Add every period of a given year to the selection (dedup, keep existing).
  const addYear = (yy: string) => {
    const names = periodOptions.filter(p => (p.name || '').slice(4) === yy).map(p => p.name);
    if (names.length === 0) { message.info('No periods found for that year.'); return; }
    setViewPeriodNames(prev => Array.from(new Set([...prev, ...names])).sort((a, b) => periodKey(a) - periodKey(b)));
  };

  const filteredViewRows = React.useMemo(() => {
    const q = viewSearch.trim().toLowerCase();
    if (!q) return viewRows;
    return viewRows.filter(r =>
      [r.assetNumber, r.description, r.datePlacedInService, r.lifeInMonths, r.remainingLife, r.cost, ...viewCols.map(pn => r[pn])]
        .some(v => v != null && String(v).toLowerCase().includes(q)));
  }, [viewRows, viewCols, viewSearch]);

  // Export the pivoted View Depreciation grid (ALL rows, not just current page).
  const exportViewExcel = () => {
    if (filteredViewRows.length === 0) { message.warning('Nothing to export.'); return; }
    const data = filteredViewRows.map(r => {
      const row: Record<string, any> = {
        'Asset #': r.assetNumber, 'Description': r.description,
        'Date In Service': fmtDate(r.datePlacedInService), 'Life (Months)': r.lifeInMonths ?? '',
        'Remaining Life': r.remainingLife ?? '', 'Cost': r.cost,
      };
      viewCols.forEach(pn => { row[pn] = r[pn] != null ? Number(r[pn]) : null; });
      row['Total'] = r.__total;
      return row;
    });
    // grand total row
    const totalsRow: Record<string, any> = {
      'Asset #': '', 'Description': 'TOTAL', 'Date In Service': '', 'Life (Months)': '', 'Remaining Life': '',
      'Cost': filteredViewRows.reduce((s, r) => s + (Number(r.cost) || 0), 0),
    };
    viewCols.forEach(pn => { totalsRow[pn] = filteredViewRows.reduce((s, r) => s + (Number(r[pn]) || 0), 0); });
    totalsRow['Total'] = filteredViewRows.reduce((s, r) => s + (Number(r.__total) || 0), 0);
    data.push(totalsRow);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Depreciation');
    XLSX.writeFile(wb, `depreciation_${selectedBook}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Export the active table on the Calculate Depreciation tab (ALL rows).
  const exportCalcExcel = () => {
    let data: any[] = [];
    let sheet = 'Depreciation';
    let fname = 'depreciation';
    if (isStatus) {
      sheet = 'Deprn Status'; fname = `deprn_status_${statusMeta?.periodName || ''}`;
      data = filteredStatusItems.map(r => ({
        'Asset #': r.assetNumber, 'Description': r.description,
        'Cost': r.cost != null ? Number(r.cost) : null,
        'Total Life': r.lifeInMonths != null && r.lifeInMonths !== '' ? Number(r.lifeInMonths) : null,
        'Remaining Life': r.remainingLife ?? null,
        'Period': r.periodName ?? statusMeta?.periodName, 'Days': r.days,
        'Daily Rate': r.dailyRate != null ? Number(r.dailyRate) : null,
        [`Deprn (${statusPrevName || 'Prev'})`]: r.prevDeprn != null ? Number(r.prevDeprn) : null,
        [`Calculated (${statusMeta?.periodName || ''})`]: r.periodDeprn != null ? Number(r.periodDeprn) : null,
        [`Posted (${statusMeta?.periodName || ''})`]: r.periodActual != null ? Number(r.periodActual) : null,
        'Debit Account': r.deprnExpenseAccount || '',
        'Credit Account': r.deprnReserveAccount || '',
        'Status': r.status, 'Accounted': r.accountedStatus || '',
      }));
    } else if (isCompare) {
      sheet = 'Compare'; fname = `deprn_compare_${lastPeriod?.lastPeriodName || ''}_vs_${lastPeriod?.nextPeriodName || ''}`;
      data = compareRows.map(r => ({
        'Asset #': r.assetNumber, 'Description': r.description, 'Method': r.methodCode,
        [`${r.lastPeriod} Deprn`]: r.lastDeprn, [`${r.nextPeriod} Deprn`]: r.nextDeprn,
        'Difference': r.difference, [`${r.lastPeriod} NBV`]: r.lastNbv, [`${r.nextPeriod} NBV`]: r.nextNbv,
      }));
    } else if (isPreview) {
      sheet = 'Preview'; fname = `deprn_preview_${lastPeriod?.nextPeriodName || ''}`;
      data = previewItems.map(r => ({
        'Asset #': r.assetNumber, 'Description': r.description, 'Method': r.methodCode,
        'Life (Months)': r.lifeInMonths, 'Cost': Number(r.adjustedCost), 'Salvage': Number(r.salvageValue),
        'Deprn Amount': Number(r.deprnAmount), 'Prior Reserve': Number(r.priorReserve),
        'New Reserve': Number(r.newReserve), 'NBV': Number(r.nbv),
      }));
    } else {
      sheet = 'Last Period'; fname = `deprn_${lastPeriod?.lastPeriodName || ''}`;
      data = wbItems.map(r => ({
        'Asset #': r.assetNumber, 'Description': r.description, 'FY': r.fiscalYear,
        'Cost': Number(r.adjustedCost), 'Deprn Amount': Number(r.deprnAmount), 'YTD Deprn': Number(r.ytdDeprn),
        'Reserve': Number(r.deprnReserve), 'NBV': Number(r.nbv), 'Run Date': r.deprnRunDate,
      }));
    }
    if (data.length === 0) { message.warning('Nothing to export.'); return; }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, `${fname}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const isPreview = viewMode === 'preview';
  const isCompare = viewMode === 'compare';
  const isStatus  = viewMode === 'status';

  // Build compare rows — join last actuals + preview by assetId
  const compareRows = React.useMemo(() => {
    if (!previewed) return [];
    const lastMap = new Map(wbItems.map(r => [String(r.assetId), r]));
    return previewItems.map(pr => {
      const last = lastMap.get(String(pr.assetId));
      const lastAmt  = Number(last?.deprnAmount  ?? 0);
      const nextAmt  = Number(pr.deprnAmount      ?? 0);
      const diff     = nextAmt - lastAmt;
      return {
        assetId:      pr.assetId,
        assetNumber:  pr.assetNumber,
        description:  pr.description,
        methodCode:   pr.methodCode,
        lastPeriod:   lastPeriod?.lastPeriodName  ?? '—',
        nextPeriod:   lastPeriod?.nextPeriodName  ?? '—',
        lastDeprn:    lastAmt,
        nextDeprn:    nextAmt,
        difference:   diff,
        lastNbv:      Number(last?.nbv ?? 0),
        nextNbv:      Number(pr.nbv    ?? 0),
      };
    });
  }, [previewed, wbItems, previewItems, lastPeriod]);

  const activeItems   = isCompare ? compareRows   : isPreview ? previewItems   : wbItems;
  const activeSummary = isCompare ? null          : isPreview ? previewSummary : wbSummary;
  const activeLoading = isCompare ? false         : isPreview ? previewLoading : wbLoading;
  const activeRowKey  = 'assetId';

  // Columns for the View Depreciation pivot: fixed cols + one per selected period.
  const viewColumns = [
    { title: 'Asset #', dataIndex: 'assetNumber', key: 'assetNumber', width: 100, fixed: 'left' as const,
      render: (v: string) => (
        <Tooltip title="Open asset details">
          <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12, fontWeight: 600 }}
            onClick={() => navigate(`/fa/assets?assetNumber=${encodeURIComponent(v)}&from=deprn`)}>{v}</Button>
        </Tooltip>
      ) },
    { title: 'Description', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, fixed: 'left' as const,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v || '—'}</Text></Tooltip> },
    { title: 'Date In Service', dataIndex: 'datePlacedInService', key: 'datePlacedInService', width: 120,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text> },
    { title: 'Life (Months)', dataIndex: 'lifeInMonths', key: 'lifeInMonths', width: 100, align: 'right' as const,
      render: (v: number | null) => <Text style={{ fontSize: 12 }}>{v == null ? '—' : v}</Text> },
    { title: 'Remaining Life', dataIndex: 'remainingLife', key: 'remainingLife', width: 110, align: 'right' as const,
      render: (v: number | null) => v == null
        ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        : <Text style={{ fontSize: 12, color: v === 0 ? REDWOOD.neutral500 : REDWOOD.warning, fontWeight: 600 }}>{v}</Text> },
    { title: 'Cost', dataIndex: 'cost', key: 'cost', width: 130, align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{fmt(v)}</Text> },
    ...viewCols.map(pn => ({
      title: pn, dataIndex: pn, key: pn, width: 120, align: 'right' as const,
      render: (v: number | null) => v == null
        ? <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        : <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success, fontWeight: 600 }} title="Posted (actual)">{fmt(v)}</Text>,
    })),
    { title: 'Total', dataIndex: '__total', key: '__total', width: 140, align: 'right' as const, fixed: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success, fontWeight: 700 }}>{fmt(v)}</Text> },
  ];

  const renderViewDeprn = () => (
    <Card
      style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      styles={{ body: { padding: '16px 20px' } }}
      title={
        <Space wrap>
          <TableOutlined style={{ color: FA_COLOR }} />
          <Text strong>View Depreciation by Period</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>Periods:</Text>
          <Select
            mode="multiple"
            size="small"
            style={{ minWidth: 300 }}
            allowClear
            placeholder="Select one or more periods"
            value={viewPeriodNames}
            onChange={(v) => setViewPeriodNames(v)}
            showSearch
            optionFilterProp="children"
            maxTagCount="responsive"
          >
            {periodOptions.map(p => (
              <Option key={p.name} value={p.name}>{p.name}{p.fy ? ` (FY ${p.fy})` : ''}</Option>
            ))}
          </Select>
          <Select
            size="small"
            style={{ width: 170 }}
            placeholder="+ Add full year"
            value={null}
            onChange={(yy) => yy && addYear(yy)}
            showSearch
            optionFilterProp="children"
          >
            {yearOptions.map(y => (
              <Option key={y.key} value={y.key}>{y.label}</Option>
            ))}
          </Select>
          <Input
            size="small"
            allowClear
            placeholder="Asset # (optional)"
            style={{ width: 150 }}
            value={viewAssetFilter}
            onChange={e => setViewAssetFilter(e.target.value)}
            onPressEnter={handleViewFetch}
          />
          <Button size="small" type="primary" icon={<LineChartOutlined />} loading={viewLoading}
            style={{ background: FA_COLOR, borderColor: FA_COLOR }} onClick={handleViewFetch}>
            Fetch
          </Button>
          <Popover
            title="API Requests — GET (one per period)"
            trigger="click"
            placement="bottomRight"
            content={(() => {
              const rows = [...viewPeriodNames].sort((a, b) => periodKey(a) - periodKey(b)).map(pn => ({
                pn,
                url: `${APEX_DB_CONFIG.baseUrl}/fa/deprn-view?bookTypeCode=${encodeURIComponent(selectedBook)}&periodName=${encodeURIComponent(pn)}${viewAssetFilter ? `&assetNumber=${encodeURIComponent(viewAssetFilter)}` : ''}`,
              }));
              const seedUrl: string | null = null;
              return (
                <div style={{ maxWidth: 620, fontSize: 12 }}>
                  <div style={{ marginBottom: 8, color: REDWOOD.neutral500 }}>
                    Method <b>GET</b> · no body. Reads straight from <code>RR_FA_DEPRN_DETAIL</code> (joined to
                    <code>RR_FA_DEPRN_PERIODS</code> for the period label). One call per selected period — you can
                    also pass <code>&amp;fiscalYear=26</code> instead of a period to pull a whole year.
                  </div>
                  {rows.length === 0
                    ? <Alert type="info" showIcon message="Select one or more periods first." />
                    : rows.map(r => (
                        <div key={r.pn} style={{ marginBottom: 8 }}>
                          <Text strong>{r.pn}</Text>
                          <Typography.Text copyable code style={{ display: 'block', fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>{r.url}</Typography.Text>
                        </div>
                      ))}
                  {rows.length > 0 && (
                    <Button size="small" style={{ marginTop: 4 }} icon={<ApiOutlined />}
                      onClick={() => { navigator.clipboard.writeText([seedUrl, ...rows.map(r => r.url)].filter(Boolean).join('\n')); message.success('All URLs copied'); }}>
                      Copy all
                    </Button>
                  )}
                </div>
              );
            })()}
          >
            <Tooltip title="Show all API URLs (for Postman)">
              <ApiOutlined style={{ color: '#1677ff', cursor: 'pointer' }} />
            </Tooltip>
          </Popover>
        </Space>
      }
    >
      {viewError && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={viewError} />}
      {viewLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : viewRows.length === 0 ? (
        <Alert type="info" showIcon message="Select a book (top-right) and one or more periods, then click Fetch. Each period becomes its own column." />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <Space wrap>
              <Input.Search allowClear size="small" placeholder="Filter any column…" style={{ width: 240 }}
                value={viewSearch} onChange={e => setViewSearch(e.target.value)} />
              <Text type="secondary" style={{ fontSize: 12 }}>{filteredViewRows.length} asset(s) · {viewCols.length} period(s)</Text>
              <Text style={{ fontSize: 11, color: REDWOOD.success }}><CheckCircleOutlined /> Posted (actual) — blank where nothing is posted</Text>
            </Space>
            <Button size="small" icon={<FileExcelOutlined />} onClick={exportViewExcel}
              style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>
              Export to Excel
            </Button>
          </div>
          <Table
            dataSource={filteredViewRows}
            columns={viewColumns}
            rowKey="assetId"
            size="small"
            scroll={{ x: 900 + viewCols.length * 120, y: 460 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} assets` }}
            summary={(pageData) => {
              const tot = (key: string) => pageData.reduce((s: number, r: any) => s + (Number(r[key]) || 0), 0);
              // Column order: 0 Asset# · 1 Desc · 2 DateInService · 3 Life · 4 Remaining · 5 Cost · 6.. periods · Total
              return (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                    <Table.Summary.Cell index={0}><Text strong style={{ fontSize: 12 }}>Total (page)</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} />
                    <Table.Summary.Cell index={2} />
                    <Table.Summary.Cell index={3} />
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} align="right"><Text strong style={{ fontSize: 12 }}>{fmt(tot('cost'))}</Text></Table.Summary.Cell>
                    {viewCols.map((pn, i) => (
                      <Table.Summary.Cell key={pn} index={6 + i} align="right">
                        <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(tot(pn))}</Text>
                      </Table.Summary.Cell>
                    ))}
                    <Table.Summary.Cell index={6 + viewCols.length} align="right">
                      <Text strong style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.success }}>{fmt(tot('__total'))}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
        </>
      )}
    </Card>
  );

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Header bar */}
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Calculate Depreciation' },
          ]} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Space align="center">
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <LineChartOutlined style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div>
                <Title level={5} style={{ margin: 0 }}>Calculate Depreciation</Title>
                <Text type="secondary" style={{ fontSize: 11 }}>Run depreciation for the current open period</Text>
              </div>
            </Space>
            <Space>
              <Text type="secondary" style={{ fontSize: 12 }}>Book:</Text>
              <Select
                value={selectedBook || undefined}
                onChange={(v) => setSelectedBook(v)}
                style={{ width: 240 }}
                placeholder="Select book"
                showSearch
              >
                {bookControls.map(b => (
                  <Option key={b.bookTypeCode} value={b.bookTypeCode}>{b.bookTypeCode}</Option>
                ))}
              </Select>
              <Tooltip title="Refresh">
                <Button icon={<ReloadOutlined />} onClick={() => loadAll(selectedBook)} loading={loading} />
              </Tooltip>
              <Popover title="API Requests" content={apiContent} trigger="click" placement="bottomRight">
                <Tooltip title="Show API calls">
                  <Button icon={<ApiOutlined />} style={{ color: '#1677ff', borderColor: '#1677ff' }} />
                </Tooltip>
              </Popover>
            </Space>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <Tabs
            activeKey={pageTab}
            onChange={(k) => setPageTab(k as 'calculate' | 'view')}
            style={{ marginBottom: 8 }}
            items={[
              { key: 'calculate', label: <span><LineChartOutlined /> Calculate Depreciation</span> },
              { key: 'view', label: <span><TableOutlined /> View Depreciation</span> },
            ]}
          />
          {pageTab === 'view' ? renderViewDeprn() : loading ? (
            <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
          ) : (
            <>
              {/* Period cards + action buttons */}
              <Row gutter={[12, 12]} style={{ marginBottom: 20 }} align="middle">
                {/* Last Run */}
                <Col xs={12} sm={6} md={4}>
                  <Card size="small" style={{
                    borderRadius: 8, border: `2px solid ${REDWOOD.success}`,
                    textAlign: 'center', background: '#f6ffed',
                  }} styles={{ body: { padding: '12px' } }}>
                    <Text style={{ fontSize: 11, color: REDWOOD.success, display: 'block', marginBottom: 4, fontWeight: 600 }}>
                      Last Depreciation Run
                    </Text>
                    {lastPeriod?.lastPeriodName ? (
                      <>
                        <div style={{ fontSize: 20, fontWeight: 700, color: REDWOOD.success }}>
                          {lastPeriod.lastPeriodName}
                        </div>
                        <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontSize: 11, marginTop: 4 }}>
                          FY {lastPeriod.fiscalYear}
                        </Tag>
                      </>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>Never Run</Text>
                    )}
                  </Card>
                </Col>

                {/* Next Period */}
                <Col xs={12} sm={6} md={4}>
                  <Card size="small" style={{
                    borderRadius: 8, border: `2px solid #1677ff`,
                    textAlign: 'center', background: '#f0f5ff',
                  }} styles={{ body: { padding: '12px' } }}>
                    <Text style={{ fontSize: 11, color: '#1677ff', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                      Next Period to Run
                    </Text>
                    {lastPeriod?.nextPeriodName ? (
                      <>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#1677ff' }}>
                          {lastPeriod.nextPeriodName}
                        </div>
                        <Tag color="processing" icon={<ClockCircleOutlined />} style={{ fontSize: 11, marginTop: 4 }}>Pending</Tag>
                      </>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                    )}
                  </Card>
                </Col>

                {/* Action buttons */}
                <Col xs={24} sm={12} md={10}>
                  <Space wrap>
                    <Button
                      icon={<EyeOutlined />}
                      onClick={handlePreview}
                      loading={previewLoading}
                      disabled={!lastPeriod?.nextPeriodName}
                      style={{ height: 44 }}
                    >
                      Preview {lastPeriod?.nextPeriodName || ''} Depreciation
                    </Button>
                    <Button
                      type="primary"
                      icon={posting ? <SyncOutlined spin /> : <CloudUploadOutlined />}
                      loading={posting}
                      disabled={!previewed || !lastPeriod?.nextPeriodName}
                      onClick={handlePost}
                      style={{ height: 44, background: previewed ? FA_COLOR : undefined, borderColor: previewed ? FA_COLOR : undefined }}
                    >
                      Post Depreciation
                    </Button>
                    {previewed && (
                      <Tag color="orange" style={{ height: 44, display: 'flex', alignItems: 'center', fontSize: 12 }}>
                        <PlayCircleOutlined style={{ marginRight: 4 }} />
                        Preview ready — review then Post
                      </Tag>
                    )}
                  </Space>
                </Col>
              </Row>

              {/* Toggle tabs */}
              <div style={{ marginBottom: 12 }}>
                <Space>
                  <Button
                    type={viewMode === 'last' ? 'primary' : 'default'}
                    size="small"
                    onClick={() => setViewMode('last')}
                    style={viewMode === 'last' ? { background: REDWOOD.success, borderColor: REDWOOD.success } : {}}
                  >
                    Last Period — {lastPeriod?.lastPeriodName || '—'}
                  </Button>
                  {previewed && (
                    <Button
                      type={viewMode === 'preview' ? 'primary' : 'default'}
                      size="small"
                      onClick={() => setViewMode('preview')}
                      style={viewMode === 'preview' ? { background: FA_COLOR, borderColor: FA_COLOR } : {}}
                    >
                      Preview — {lastPeriod?.nextPeriodName}
                    </Button>
                  )}
                  {previewed && (
                    <Button
                      type={viewMode === 'compare' ? 'primary' : 'default'}
                      size="small"
                      icon={<SwapOutlined />}
                      onClick={() => setViewMode('compare')}
                      style={viewMode === 'compare' ? { background: '#722ed1', borderColor: '#722ed1' } : { color: '#722ed1', borderColor: '#722ed1' }}
                    >
                      Compare
                    </Button>
                  )}
                  <Button
                    type={isStatus ? 'primary' : 'default'}
                    size="small"
                    icon={<CheckCircleOutlined />}
                    onClick={() => { setViewMode('status'); if (statusItems.length === 0 && statusPeriodName) handleShowStatus(statusPeriodName); }}
                    style={isStatus ? { background: '#1677ff', borderColor: '#1677ff' } : { color: '#1677ff', borderColor: '#1677ff' }}
                  >
                    Status by Period
                  </Button>
                  <Tooltip title="Export the current table (all rows) to Excel">
                    <Button size="small" icon={<FileExcelOutlined />} onClick={exportCalcExcel}
                      style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>
                      Export to Excel
                    </Button>
                  </Tooltip>
                </Space>
              </div>

              {/* Preview notice */}
              {isPreview && (
                <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                  message={`Depreciation preview for ${lastPeriod?.nextPeriodName} — amounts are calculated but NOT yet posted. Click "Post Depreciation" to commit.`}
                />
              )}

              {/* Compare notice + summary */}
              {isCompare && compareRows.length > 0 && (() => {
                const totalLast = compareRows.reduce((s, r) => s + r.lastDeprn, 0);
                const totalNext = compareRows.reduce((s, r) => s + r.nextDeprn, 0);
                const totalDiff = totalNext - totalLast;
                return (
                  <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
                    {[
                      { label: `${lastPeriod?.lastPeriodName} Deprn`, value: totalLast, color: REDWOOD.neutral500 },
                      { label: `${lastPeriod?.nextPeriodName} Deprn`, value: totalNext, color: '#1677ff' },
                      { label: 'Total Difference', value: totalDiff,
                        color: totalDiff > 0 ? REDWOOD.primary : totalDiff < 0 ? REDWOOD.success : REDWOOD.neutral500 },
                    ].map(s => (
                      <Col xs={8} key={s.label}>
                        <Card size="small" styles={{ body: { padding: '10px 14px' } }}
                          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.neutral100 }}>
                          <Text style={{ fontSize: 11, color: REDWOOD.neutral500, display: 'block' }}>{s.label}</Text>
                          <Text style={{ fontSize: 15, fontWeight: 700, color: s.color }}>
                            {s.label === 'Total Difference' && totalDiff > 0 ? '+' : ''}{fmt(s.value)}
                          </Text>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                );
              })()}

              {/* ── Status by Period (all assets) ── */}
              {isStatus && (
                <Card
                  style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                  styles={{ body: { padding: '16px 20px' } }}
                  title={
                    <Space wrap>
                      <CheckCircleOutlined style={{ color: '#1677ff' }} />
                      <Text strong>Depreciation Status — all assets</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>Period:</Text>
                      <Select
                        size="small"
                        style={{ width: 200 }}
                        placeholder="Select period"
                        value={statusPeriodName || undefined}
                        onChange={(v) => { setStatusPeriodName(v); handleShowStatus(v); }}
                        showSearch
                        optionFilterProp="children"
                      >
                        {periodOptions.map((p) => (
                          <Option key={p.name} value={p.name}>
                            {p.name}{p.fy ? ` (FY ${p.fy})` : ''}
                          </Option>
                        ))}
                      </Select>
                      <Button size="small" icon={<ReloadOutlined />} loading={statusLoading}
                        onClick={() => handleShowStatus(statusPeriodName)}>Show</Button>
                      <Tooltip title={
                        <div style={{ maxWidth: 520 }}>
                          <div style={{ fontSize: 11, marginBottom: 4 }}>GET (no body — query params):</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff', wordBreak: 'break-all' }}>
                            {statusUrl || `${APEX_DB_CONFIG.baseUrl}/fa/deprn-by-period?bookTypeCode=${encodeURIComponent(selectedBook)}&periodName=${encodeURIComponent(statusPeriodName || '...')}`}
                          </div>
                          <div style={{ fontSize: 10, marginTop: 6, opacity: 0.75 }}>Click to copy</div>
                        </div>
                      }>
                        <Button type="text" size="small" icon={<ApiOutlined style={{ color: '#1677ff' }} />}
                          onClick={() => {
                            const u = statusUrl || `${APEX_DB_CONFIG.baseUrl}/fa/deprn-by-period?bookTypeCode=${encodeURIComponent(selectedBook)}&periodName=${encodeURIComponent(statusPeriodName || '')}`;
                            navigator.clipboard.writeText(u); message.success('URL copied');
                          }} />
                      </Tooltip>
                    </Space>
                  }
                >
                  {statusError && (
                    <Alert type="error" showIcon style={{ marginBottom: 12 }}
                      message="Failed to load depreciation status"
                      description={
                        <div>
                          <div style={{ marginBottom: 6 }}>{statusError}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.neutral500 }}>GET {statusUrl}</div>
                          <div style={{ fontSize: 11, marginTop: 6 }}>
                            A 404 means the webservice isn't deployed. Run <b>08_rr_fa_pkg_spec.sql → 09_rr_fa_pkg_body.sql → 18_fa_deprn_by_period_get.sql</b>.
                          </div>
                        </div>
                      } />
                  )}
                  {statusLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : statusMeta ? (
                    <>
                      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
                        {[
                          { label: 'Total Assets',  value: statusMeta.totalCount ?? 0,      color: '#1677ff', isCount: true },
                          { label: 'Posted',         value: statusMeta.postedCount ?? 0,     color: REDWOOD.success, isCount: true },
                          { label: 'Not Posted',     value: statusMeta.notPostedCount ?? 0,  color: REDWOOD.warning, isCount: true },
                          { label: 'Deprn Amount',   value: statusSummary?.totalDeprnAmount, color: REDWOOD.primary },
                        ].map(s => (
                          <Col xs={12} md={6} key={s.label}>
                            <Card size="small" styles={{ body: { padding: '10px 14px' } }}
                              style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.neutral100 }}>
                              <Text style={{ fontSize: 11, color: REDWOOD.neutral500, display: 'block' }}>{s.label}</Text>
                              <Text style={{ fontSize: 15, fontWeight: 700, color: s.color }}>
                                {s.isCount ? s.value : fmt(s.value as number)}
                              </Text>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                        <Space wrap>
                          <Input.Search
                            allowClear
                            size="small"
                            placeholder="Filter any column…"
                            style={{ width: 240 }}
                            value={statusSearch}
                            onChange={e => setStatusSearch(e.target.value)}
                          />
                          <Button size="small" type={statusFilter === 'all' ? 'primary' : 'default'} onClick={() => setStatusFilter('all')}>All ({enrichedStatusItems.length})</Button>
                          <Button size="small" type={statusFilter === 'posted' ? 'primary' : 'default'}
                            style={statusFilter === 'posted' ? { background: REDWOOD.success, borderColor: REDWOOD.success } : {}}
                            onClick={() => setStatusFilter('posted')}>Posted ({statusMeta.postedCount ?? 0})</Button>
                          <Button size="small" type={statusFilter === 'notposted' ? 'primary' : 'default'}
                            style={statusFilter === 'notposted' ? { background: REDWOOD.warning, borderColor: REDWOOD.warning } : {}}
                            onClick={() => setStatusFilter('notposted')}>Not Posted ({statusMeta.notPostedCount ?? 0})</Button>
                        </Space>
                        <Space>
                          {(() => {
                            const unaccounted = enrichedStatusItems.filter(r => r.status === 'Posted' && String(r.accountedStatus || '').toUpperCase() !== 'ACCOUNTED').length;
                            return (
                              <Tooltip title={unaccounted === 0
                                ? 'No posted, unaccounted lines'
                                : `Create accounting for all ${unaccounted} posted, unaccounted line(s)`}>
                                <Button
                                  icon={<AuditOutlined />}
                                  disabled={unaccounted === 0}
                                  onClick={openBulkAccounting}
                                  style={unaccounted > 0 ? { color: '#722ed1', borderColor: '#722ed1' } : {}}
                                >
                                  Create Accounting for All ({unaccounted})
                                </Button>
                              </Tooltip>
                            );
                          })()}
                          <Tooltip title={statusSelected.length === 0
                            ? 'Select one or more Not-Posted assets to post their depreciation'
                            : `Post depreciation (fa/deprn-post-single) for ${statusSelected.length} asset(s), period ${statusMeta.periodName}`}>
                            <Button
                              type="primary"
                              icon={<CloudUploadOutlined />}
                              loading={statusPosting}
                              disabled={statusSelected.length === 0}
                              onClick={openCreateDeprnDialog}
                              style={statusSelected.length > 0 ? { background: FA_COLOR, borderColor: FA_COLOR } : {}}
                            >
                              Create Depreciation ({statusSelected.length})
                            </Button>
                          </Tooltip>
                        </Space>
                      </div>
                      <Table
                        dataSource={filteredStatusItems}
                        columns={statusColumns}
                        rowKey="assetId"
                        size="small"
                        scroll={{ x: 1950, y: 480 }}
                        pagination={{ pageSize: 100, showSizeChanger: true, pageSizeOptions: ['50', '100', '200', '500'], showTotal: (t) => `${t} assets` }}
                        locale={{ emptyText: 'No assets found for this book/period' }}
                        rowSelection={{
                          selectedRowKeys: statusSelected,
                          onChange: (keys) => setStatusSelected(keys as string[]),
                          // Only Not-Posted assets with a computable amount can be posted.
                          getCheckboxProps: (r: any) => ({ disabled: r.status === 'Posted' || !(r.periodDeprn > 0) }),
                        }}
                        summary={() => {
                          // Totals across ALL filtered rows (not just the page).
                          const sum = (k: string) => filteredStatusItems.reduce((s, r) => s + (Number(r[k]) || 0), 0);
                          // Column order (a selection checkbox occupies index 0):
                          // 1 Asset# · 2 Desc · 3 Cost · 4 Total Life · 5 Remaining Life · 6 Period ·
                          // 7 Days · 8 Daily Rate · 9 Deprn(prev) · 10 Calculated · 11 Posted ·
                          // 12 Debit Account · 13 Credit Account · 14 Status · 15 Acctg
                          return (
                            <Table.Summary fixed>
                              <Table.Summary.Row style={{ background: '#fafafa' }}>
                                <Table.Summary.Cell index={0} />
                                <Table.Summary.Cell index={1}><Text strong style={{ fontSize: 12 }}>Total ({filteredStatusItems.length})</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={2} />
                                <Table.Summary.Cell index={3} align="right"><Text strong style={mono}>{fmt(sum('cost'))}</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={4} />
                                <Table.Summary.Cell index={5} />
                                <Table.Summary.Cell index={6} />
                                <Table.Summary.Cell index={7} />
                                <Table.Summary.Cell index={8} />
                                <Table.Summary.Cell index={9} align="right"><Text strong style={{ ...mono, color: REDWOOD.neutral500 }}>{fmt(sum('prevDeprn'))}</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={10} align="right"><Text strong style={monoRed}>{fmt(sum('periodDeprn'))}</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={11} align="right"><Text strong style={{ ...mono, color: REDWOOD.success }}>{fmt(sum('periodActual'))}</Text></Table.Summary.Cell>
                                <Table.Summary.Cell index={12} />
                                <Table.Summary.Cell index={13} />
                                <Table.Summary.Cell index={14} />
                                <Table.Summary.Cell index={15} />
                              </Table.Summary.Row>
                            </Table.Summary>
                          );
                        }}
                      />
                    </>
                  ) : (
                    <Alert type="info" showIcon message="Select a period and click Show to see the depreciation status for all assets." />
                  )}
                </Card>
              )}

              {/* Details card */}
              {!isStatus && (
              <Card
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                styles={{ body: { padding: '16px 20px' } }}
                title={
                  <Space>
                    <LineChartOutlined style={{ color: isPreview ? FA_COLOR : REDWOOD.success }} />
                    <Text strong>
                      {isCompare
                        ? `Compare — ${lastPeriod?.lastPeriodName} vs ${lastPeriod?.nextPeriodName}`
                        : isPreview
                          ? `Calculated Depreciation — ${lastPeriod?.nextPeriodName} (Preview)`
                          : `Depreciation Details — ${lastPeriod?.lastPeriodName || '—'}`}
                    </Text>
                    {!isPreview && !isCompare && lastPeriod?.lastPeriodCounter && (
                      <Tag color="green" style={{ fontSize: 11 }}>Counter: {lastPeriod.lastPeriodCounter}</Tag>
                    )}
                    {isCompare && (
                      <Tag color="purple" icon={<SwapOutlined />} style={{ fontSize: 11 }}>
                        {compareRows.length} assets
                      </Tag>
                    )}
                  </Space>
                }
              >
                {activeLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : (
                  <>
                    {activeSummary && (
                      <>
                        <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
                          {summaryCards(activeSummary, isPreview).map(s => (
                            <Col xs={12} md={6} key={s.label}>
                              <Card size="small" styles={{ body: { padding: '10px 14px' } }}
                                style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.neutral100 }}>
                                <Text style={{ fontSize: 11, color: REDWOOD.neutral500, display: 'block' }}>{s.label}</Text>
                                <Text style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{fmt(s.value)}</Text>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                        <Divider style={{ margin: '0 0 12px' }} />
                      </>
                    )}

                    <Table
                      dataSource={activeItems}
                      columns={isCompare ? compareColumns : isPreview ? previewColumns : lastColumns}
                      rowKey={activeRowKey}
                      size="small"
                      scroll={{ x: isCompare ? 1100 : isPreview ? 1200 : 1100, y: 420 }}
                      pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} assets` }}
                      locale={{ emptyText: lastPeriod ? 'No records found' : 'Select a book' }}
                      rowClassName={(r: any) =>
                        isCompare && r.difference > 0 ? 'row-increase'
                        : isCompare && r.difference < 0 ? 'row-decrease' : ''
                      }
                    />
                  </>
                )}
              </Card>
              )}
            </>
          )}
        </div>

        {/* ── Create Depreciation — API Steps ── */}
        <Modal
          open={deprnModalOpen}
          title={<Space><CloudUploadOutlined style={{ color: FA_COLOR }} /><span>Create Depreciation — {deprnSteps.length} line(s) · {statusMeta?.periodName}</span></Space>}
          onCancel={() => { if (!deprnRunning) setDeprnModalOpen(false); }}
          maskClosable={!deprnRunning}
          width={860}
          footer={
            <Space>
              <Button disabled={deprnRunning} onClick={() => setDeprnModalOpen(false)}>Close</Button>
              <Button type="primary" icon={<CloudUploadOutlined />} loading={deprnRunning}
                disabled={!deprnSteps.some(s => s.status === 'pending' || s.status === 'error')}
                style={{ background: FA_COLOR, borderColor: FA_COLOR }}
                onClick={runDeprnSteps}>
                Run {deprnSteps.filter(s => s.kind === 'deprn').length} asset(s)
              </Button>
            </Space>
          }
          destroyOnClose
        >
          <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
            message={<span><b>Step 1 — Post Depreciation</b> (<code>POST fa/deprn-post-single</code>). Once a line is posted, use the <b>Create Accounting</b> icon on that row to account it (SLA → GL journal → mark). Expand a step to see its full URL and JSON payload/response.</span>} />
          <div style={{ maxHeight: 460, overflowY: 'auto', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6 }}>
            {deprnSteps.map((s, i) => {
              const color = s.status === 'done' ? REDWOOD.success : s.status === 'error' ? REDWOOD.primary : s.status === 'posting' ? '#1677ff' : REDWOOD.neutral500;
              const isAcct = s.kind === 'acct';
              return (
                <div key={`${s.assetId}-${s.kind}`} style={{ borderTop: i === 0 ? 'none' : `1px solid ${REDWOOD.neutral200}` }}>
                  <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: s.expanded ? '#fafafa' : '#fff', paddingLeft: isAcct ? 28 : 12 }}
                    onClick={() => setDeprnSteps(prev => prev.map((x, idx) => idx === i ? { ...x, expanded: !x.expanded } : x))}>
                    {s.status === 'posting' ? <SyncOutlined spin style={{ color: '#1677ff' }} />
                      : s.status === 'done' ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                      : s.status === 'error' ? <Tag color="error" style={{ margin: 0 }}>ERR</Tag>
                      : s.status === 'skipped' ? <Tag style={{ margin: 0, fontSize: 10 }}>SKIP</Tag>
                      : <ClockCircleOutlined style={{ color: REDWOOD.neutral500 }} />}
                    <Tag color={isAcct ? 'purple' : 'green'} style={{ margin: 0, fontSize: 10 }}>{isAcct ? '2 · ACCT' : '1 · DEPRN'}</Tag>
                    <Text strong style={{ fontSize: 12 }}>Asset {s.assetNumber}</Text>
                    <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral500, flex: 1 }} ellipsis>{isAcct ? 'Create Accounting' : s.url}</Text>
                    <Text style={{ fontSize: 11, color, fontWeight: 600 }}>{s.detail || (!isAcct && s.payload?.deprnAmount != null ? fmt(s.payload.deprnAmount) : '')}</Text>
                    <Tooltip title={isAcct ? 'Run accounting for this asset' : 'Create depreciation for this asset'}>
                      <Button size="small" type="primary" ghost icon={<PlayCircleOutlined />}
                        loading={deprnStepRunning === i}
                        disabled={deprnRunning && deprnStepRunning !== i}
                        onClick={(e) => { e.stopPropagation(); runOneStep(i); }}
                        style={{ height: 22, fontSize: 10, padding: '0 8px' }}>
                        Run
                      </Button>
                    </Tooltip>
                    <Text style={{ fontSize: 10, color: '#999' }}>{s.expanded ? '▲' : '▼'}</Text>
                  </div>
                  {s.expanded && (
                    <div style={{ padding: '0 12px 10px 32px' }}>
                      {/* Dr/Cr accounting lines for the accounting step */}
                      {isAcct && s.acctLines && (
                        <div style={{ marginBottom: 8 }}>
                          <Text style={{ fontSize: 10, color: '#888' }}>Accounting entry (Dr Depreciation Expense / Cr Accumulated Depreciation)</Text>
                          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 4 }}>
                            <thead>
                              <tr style={{ background: '#fafafa', color: '#888' }}>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Line</th>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Account</th>
                                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Dr</th>
                                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Cr</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.acctLines.map((l, li) => (
                                <tr key={li} style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}>
                                  <td style={{ padding: '3px 6px' }}>{l.label}</td>
                                  <td style={{ padding: '3px 6px' }}>
                                    <div style={{ fontFamily: 'monospace', color: '#1677ff' }}>{l.account}</div>
                                    {l.desc && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 1 }}>{l.desc}</div>}
                                  </td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', color: l.dr ? REDWOOD.success : '#bbb' }}>{l.dr ? fmt(l.dr) : '—'}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', color: l.cr ? REDWOOD.primary : '#bbb' }}>{l.cr ? fmt(l.cr) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 10, color: '#888' }}>Request Payload</Text>
                          <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: '4px 0 0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(s.payload, null, 2)}</pre>
                        </div>
                        {s.response !== undefined && (
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 10, color: '#888' }}>Response</Text>
                            <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: '4px 0 0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(s.response, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>

        {/* ── View Journal ── */}
        {journalModal && (
          <Modal
            open
            title={<Space><EyeOutlined style={{ color: '#722ed1' }} /><span>Depreciation Journal — Asset {journalModal.assetNumber}</span>
              <Tooltip title={<Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', wordBreak: 'break-all' }}>{`GET ${journalModal.url}`}</Text>}>
                <ApiOutlined style={{ color: '#1677ff', cursor: 'help' }} onClick={() => { navigator.clipboard.writeText(journalModal.url); message.success('URL copied'); }} />
              </Tooltip>
            </Space>}
            onCancel={() => setJournalModal(null)}
            footer={<Button onClick={() => setJournalModal(null)}>Close</Button>}
            width={860}
          >
            {journalModal.loading
              ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading journal…" /></div>
              : journalModal.error
                ? <Alert type="error" showIcon message="Failed to load journal" description={journalModal.error} />
                : journalModal.lines.length === 0
                  ? <Alert type="warning" showIcon message="No GL journal found for this asset's depreciation (may not be accounted yet)." />
                  : <Table
                      dataSource={journalModal.lines.map((l: any, i: number) => ({ ...l, _k: i }))}
                      rowKey="_k" size="small" pagination={false} scroll={{ x: 'max-content' }}
                      columns={[
                        { title: 'Account', dataIndex: 'account', width: 200, render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#1677ff' }}>{v}</Text> },
                        { title: 'Description', dataIndex: 'description', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                        { title: 'Dr', dataIndex: 'entered_dr', width: 120, align: 'right' as const, render: (v: number) => v ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>{fmt(v)}</Text> : '—' },
                        { title: 'Cr', dataIndex: 'entered_cr', width: 120, align: 'right' as const, render: (v: number) => v ? <Text style={{ fontSize: 11, color: REDWOOD.primary }}>{fmt(v)}</Text> : '—' },
                        { title: 'Period', dataIndex: 'period_name', width: 90, render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
                        { title: 'Status', dataIndex: 'posting_status', width: 90, render: (v: string) => <Tag color={v === 'POSTED' ? 'green' : 'orange'} style={{ fontSize: 10 }}>{v}</Tag> },
                      ]}
                    />}
          </Modal>
        )}

        {/* ── Create Accounting (for a Posted deprn row) ── */}
        {acctModal && (
          <Modal
            open
            title={<Space><AuditOutlined style={{ color: '#722ed1' }} /><span>Create Accounting — Asset {acctModal.assetNumber} · {acctModal.periodName}</span></Space>}
            onCancel={() => { if (!acctModal.posting) setAcctModal(null); }}
            maskClosable={!acctModal.posting}
            width={860}
            footer={
              <Space>
                <Button disabled={acctModal.posting} onClick={() => setAcctModal(null)}>Close</Button>
                <Button type="primary" icon={<AuditOutlined />} loading={acctModal.posting}
                  disabled={acctModal.loading || !!acctModal.error || acctModal.posted || !acctModal.preview}
                  style={{ background: acctModal.posted ? undefined : FA_COLOR, borderColor: acctModal.posted ? undefined : FA_COLOR }}
                  onClick={postAccounting}>
                  {acctModal.posted ? 'Accounted' : 'Create Accounting'}
                </Button>
              </Space>
            }
            destroyOnClose
          >
            {acctModal.loading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading accounting preview…" /></div>
            ) : acctModal.error ? (
              <Alert type="warning" showIcon message="Cannot create accounting" description={acctModal.error} />
            ) : (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
                  message={<span>Depreciation is posted — this accounts it: <b>SLA</b> (<code>sla/accounting/create</code>) → <b>GL journal</b> (<code>gl/journals/create</code> + post) → <b>mark accounted</b> (<code>fa/accounting/mark-deprn-accounted</code>).</span>} />

                {/* Dr/Cr accounting entry */}
                {acctModal.acctLines && acctModal.acctLines.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 11, color: '#888' }}>Accounting entry (Dr Depreciation Expense / Cr Accumulated Depreciation)</Text>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 4 }}>
                      <thead>
                        <tr style={{ background: '#fafafa', color: '#888' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Line</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Account</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Dr</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Cr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acctModal.acctLines.map((l, li) => (
                          <tr key={li} style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}>
                            <td style={{ padding: '4px 8px' }}>{l.label}</td>
                            <td style={{ padding: '4px 8px' }}>
                              <div style={{ fontFamily: 'monospace', color: '#1677ff' }}>{l.account}</div>
                              {l.desc && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 1 }}>{l.desc}</div>}
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', color: l.dr ? REDWOOD.success : '#bbb' }}>{l.dr ? fmt(l.dr) : '—'}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', color: l.cr ? REDWOOD.primary : '#bbb' }}>{l.cr ? fmt(l.cr) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Per-step URL / payload / response */}
                {acctModal.steps.length > 0 && (
                  <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6 }}>
                    {acctModal.steps.map((s, i) => {
                      const color = s.status === 'done' ? REDWOOD.success : s.status === 'error' ? REDWOOD.primary : s.status === 'posting' ? '#1677ff' : REDWOOD.neutral500;
                      return (
                        <div key={i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${REDWOOD.neutral200}` }}>
                          <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: s.expanded ? '#fafafa' : '#fff' }}
                            onClick={() => setAcctModal(m => m && ({ ...m, steps: m.steps.map((x, idx) => idx === i ? { ...x, expanded: !x.expanded } : x) }))}>
                            {s.status === 'posting' ? <SyncOutlined spin style={{ color: '#1677ff' }} />
                              : s.status === 'done' ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                              : s.status === 'error' ? <Tag color="error" style={{ margin: 0 }}>ERR</Tag>
                              : <ClockCircleOutlined style={{ color: REDWOOD.neutral500 }} />}
                            <Text strong style={{ fontSize: 12 }}>{s.label}</Text>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral500, flex: 1 }} ellipsis>{s.method} {s.url}</Text>
                            <Text style={{ fontSize: 11, color, fontWeight: 600 }}>{s.detail}</Text>
                            <Text style={{ fontSize: 10, color: '#999' }}>{s.expanded ? '▲' : '▼'}</Text>
                          </div>
                          {s.expanded && (
                            <div style={{ padding: '0 12px 10px 32px', display: 'flex', gap: 12 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ fontSize: 10, color: '#888' }}>Request Payload</Text>
                                <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: '4px 0 0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(s.payload, null, 2)}</pre>
                              </div>
                              {s.response !== undefined && (
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ fontSize: 10, color: '#888' }}>Response</Text>
                                  <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: '4px 0 0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(s.response, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Modal>
        )}

        {/* ── Create Accounting for All (bulk) ── */}
        {bulkAcct?.open && (() => {
          const rows = bulkAcct.rows;
          const doneCount = rows.filter(r => r.status === 'done').length;
          const errCount  = rows.filter(r => r.status === 'error').length;
          const statusTag = (s: BulkAcctRow['status']) => {
            switch (s) {
              case 'running': return <Tag icon={<Spin size="small" />} color="processing">Accounting…</Tag>;
              case 'done':    return <Tag color="success" icon={<CheckCircleOutlined />}>Accounted</Tag>;
              case 'error':   return <Tag color="error">Failed</Tag>;
              case 'skipped': return <Tag>Skipped</Tag>;
              default:        return <Tag color="default" icon={<ClockCircleOutlined />}>Pending</Tag>;
            }
          };
          return (
            <Modal
              open
              title={<Space><AuditOutlined style={{ color: '#722ed1' }} /><span>Create Accounting for All — {statusMeta?.periodName || statusPeriodName}</span></Space>}
              onCancel={() => { if (!bulkAcct.running) setBulkAcct(null); }}
              maskClosable={!bulkAcct.running}
              width={760}
              footer={
                <Space>
                  <Button disabled={bulkAcct.running} onClick={() => setBulkAcct(null)}>Close</Button>
                  <Button type="primary" icon={<AuditOutlined />} loading={bulkAcct.running}
                    disabled={bulkAcct.done}
                    style={{ background: bulkAcct.done ? undefined : FA_COLOR, borderColor: bulkAcct.done ? undefined : FA_COLOR }}
                    onClick={runBulkAccounting}>
                    {bulkAcct.done ? 'Done' : `Create Accounting (${rows.length})`}
                  </Button>
                </Space>
              }
              destroyOnClose
            >
              <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
                message={<span>Accounts all <b>{rows.length}</b> posted, unaccounted line(s). Each runs the same flow: <b>SLA</b> → <b>GL journal</b> → <b>mark accounted</b>.</span>} />
              {(doneCount > 0 || errCount > 0) && (
                <div style={{ marginBottom: 10 }}>
                  <Tag color="success">Accounted: {doneCount}</Tag>
                  {errCount > 0 && <Tag color="error">Failed: {errCount}</Tag>}
                  <Tag>Pending: {rows.length - doneCount - errCount}</Tag>
                </div>
              )}
              <Table
                dataSource={rows}
                rowKey="assetId"
                size="small"
                pagination={false}
                scroll={{ y: 380 }}
                columns={[
                  { title: 'Asset #', dataIndex: 'assetNumber', key: 'assetNumber', width: 110 },
                  { title: 'Period', dataIndex: 'periodName', key: 'periodName', width: 100 },
                  { title: 'Status', key: 'status', width: 130, render: (_: any, r: BulkAcctRow) => statusTag(r.status) },
                  { title: 'Detail', dataIndex: 'detail', key: 'detail', ellipsis: true,
                    render: (v: string, r: BulkAcctRow) => <Text type={r.status === 'error' ? 'danger' : 'secondary'} style={{ fontSize: 11 }}>{v || '—'}</Text> },
                ]}
              />
            </Modal>
          );
        })()}
      </Content>
    </Layout>
  );
};

export default CalculateDeprn;
