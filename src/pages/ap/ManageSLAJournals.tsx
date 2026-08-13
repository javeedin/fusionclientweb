import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useCallback, useEffect } from 'react';
import dayjs from 'dayjs';
import {
  Card, Table, Tabs, Form, Select, DatePicker, Input, Button,
  Space, Tag, Typography, Row, Col, Tooltip, Badge, Divider,
  Statistic, message, Modal, Spin, Descriptions,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, ArrowLeftOutlined,
  AccountBookOutlined, UnorderedListOutlined, FileSearchOutlined,
  CheckCircleOutlined, ClockCircleOutlined, WarningOutlined,
  DollarOutlined, CalendarOutlined, EyeOutlined, FileTextOutlined,
  SendOutlined, CopyOutlined, ApiOutlined, CheckOutlined, CloudOutlined,
  SwapOutlined, DiffOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { fetchLedgerByBusinessUnit, getAccounting, getLinesByHeaderId } from '../../services/sla.service';
import { postSlaToGL, eventTypeToRef5 } from '../../services/glPosting.service';
import type { GlPostingLine } from '../../services/glPosting.service';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

// ── Oracle Redwood colour palette ────────────────────────────────────────────
const REDWOOD = {
  primary:     '#C74634',
  info:        '#0572CE',
  success:     '#1D7B4D',
  warning:     '#D4A800',
  error:       '#D93025',
  neutral100:  '#F7F7F7',
  neutral200:  '#E5E5E5',
  neutral600:  '#6B6B6B',
  surface:     '#FFFFFF',
};

// ── Interfaces ───────────────────────────────────────────────────────────────

interface SlaHeader {
  key: string;
  headerId: number;
  moduleName: string;
  sourceTable: string;
  sourceId: number;
  sourceNumber: string;
  sourceType: string;
  eventTypeCode: string;
  accountingDate: string;
  periodName: string;
  ledgerName: string;
  currencyCode: string;
  businessUnit: string;
  description: string;
  accountingStatus: string;
  postingStatus: string;
  glBatchId: number | null;
  glBatchName: string | null;
  glHeaderId: number | null;
  createdBy: string;
  creationDate: string;
  postedBy: string | null;
  postedDate: string | null;
  lineCount: number;
}

interface SlaLine {
  key: string;
  lineId: number;
  headerId: number;
  lineNumber: number;
  lineType: string;
  accountingClass: string;
  accountCombination: string;
  enteredDr: number;
  enteredCr: number;
  accountedDr: number;
  accountedCr: number;
  currencyCode: string;
  description: string;
  sourceNumber: string;
  sourceTable: string;
  accountingDate: string;
  accountingStatus: string;
  businessUnit: string;
  legalEntity: string;
  moduleName: string;
  partyType: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatAmount = (v: number | null | undefined) => {
  if (v === null || v === undefined || v === 0) return '—';
  // Show full precision — no rounding
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 15 }).format(v);
};

const statusColor = (s: string) => {
  switch (s?.toUpperCase()) {
    case 'POSTED':  return 'success';
    case 'DRAFT':   return 'warning';
    case 'ERROR':   return 'error';
    default:        return 'default';
  }
};

const statusIcon = (s: string) => {
  switch (s?.toUpperCase()) {
    case 'POSTED':  return <CheckCircleOutlined />;
    case 'DRAFT':   return <ClockCircleOutlined />;
    case 'ERROR':   return <WarningOutlined />;
    default:        return null;
  }
};

// ── Component ────────────────────────────────────────────────────────────────

const ManageSLAJournals: React.FC = () => {
  const navigate = useNavigate();
  const [headerForm] = Form.useForm();
  const [lineForm]   = Form.useForm();

  // ── Headers tab state ────────────────────────────────────────────────────
  const [headers, setHeaders]           = useState<SlaHeader[]>([]);
  const [headerLoading, setHeaderLoading] = useState(false);
  const [headerTotal, setHeaderTotal]   = useState(0);

  // ── Lines tab state ──────────────────────────────────────────────────────
  const [lines, setLines]           = useState<SlaLine[]>([]);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineTotal, setLineTotal]   = useState(0);

  // ── Summary stats ────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ draft: 0, posted: 0, error: 0, totalDr: 0, totalCr: 0 });

  // ── Active tab ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('headers');

  // ── GL Journal Entry modal ────────────────────────────────────────────────
  const [glJournalModalVisible, setGlJournalModalVisible]   = useState(false);
  const [glJournalLoading, setGlJournalLoading]             = useState(false);
  const [glJournalData, setGlJournalData]                   = useState<any>(null);
  const [glJournalLines, setGlJournalLines]                 = useState<any[]>([]);
  const [slaModalLines, setSlaModalLines]                   = useState<SlaLine[]>([]);
  const [slaModalRecord, setSlaModalRecord]                 = useState<SlaHeader | null>(null);

  // ── Page-level API inspector ─────────────────────────────────────────────
  const [pageApiModalVisible, setPageApiModalVisible]       = useState(false);
  const [lastCalledUrl, setLastCalledUrl]                   = useState<string | null>(null);
  const [lastApiStatus, setLastApiStatus]                   = useState<number | null>(null);
  const [lastApiError, setLastApiError]                     = useState<string | null>(null);
  const [lastApiRaw, setLastApiRaw]                         = useState<any>(null);
  const [pageApiTesting, setPageApiTesting]                 = useState(false);
  const [pageApiTestUrl, setPageApiTestUrl]                 = useState('');
  const [pageApiTestResult, setPageApiTestResult]           = useState<any>(null);
  const [pageApiTestError, setPageApiTestError]             = useState<string | null>(null);
  const [pageApiCopied, setPageApiCopied]                   = useState(false);

  // ── GL Journal API info modal ─────────────────────────────────────────────
  const [glApiModalVisible, setGlApiModalVisible]           = useState(false);
  const [glLastHeaderUrl, setGlLastHeaderUrl]               = useState<string | null>(null);
  const [glLastLinesUrl, setGlLastLinesUrl]                 = useState<string | null>(null);
  const [glLastError, setGlLastError]                       = useState<string | null>(null);
  const [glCopiedUrl, setGlCopiedUrl]                       = useState<string | null>(null);
  const [glRawLinesData, setGlRawLinesData]                 = useState<any>(null);
  const [slaLastLinesUrl, setSlaLastLinesUrl]               = useState<string | null>(null);
  const [slaLastLinesError, setSlaLastLinesError]           = useState<string | null>(null);
  const [slaRawLinesData, setSlaRawLinesData]               = useState<any>(null);
  const [glApiTesting, setGlApiTesting]                     = useState(false);
  const [glApiTestUrl, setGlApiTestUrl]                     = useState<string>('');
  const [glApiTestResult, setGlApiTestResult]               = useState<any>(null);
  const [glApiTestError, setGlApiTestError]                 = useState<string | null>(null);

  // ── AP Transaction drill-down modal ──────────────────────────────────────
  const [apTxnModalVisible, setApTxnModalVisible]   = useState(false);
  const [apTxnLoading, setApTxnLoading]             = useState(false);
  const [apTxnData, setApTxnData]                   = useState<any>(null);
  const [apTxnType, setApTxnType]                   = useState<'invoice' | 'payment'>('invoice');
  const [apTxnLines, setApTxnLines]                 = useState<any[]>([]);

  // ── GL Compare modal ─────────────────────────────────────────────────────
  const [compareModalVisible, setCompareModalVisible]   = useState(false);
  const [compareLoading, setCompareLoading]             = useState(false);
  const [compareHeader, setCompareHeader]               = useState<SlaHeader | null>(null);
  const [compareSlaLines, setCompareSlaLines]           = useState<SlaLine[]>([]);
  const [compareGlLines, setCompareGlLines]             = useState<any[]>([]);
  const [compareError, setCompareError]                 = useState<string | null>(null);

  // ── Table search filters ─────────────────────────────────────────────────
  const [headerSearch, setHeaderSearch] = useState('');
  const [lineSearch, setLineSearch]     = useState('');

  // ── Bulk GL line-count comparison ────────────────────────────────────────
  const [glLineCounts, setGlLineCounts]       = useState<Record<number, number>>({});
  const [glCountsLoading, setGlCountsLoading] = useState(false);

  // ── Push missing lines modal ──────────────────────────────────────────────
  const [pendingModalVisible, setPendingModalVisible]   = useState(false);
  const [pendingModalLoading, setPendingModalLoading]   = useState(false);
  const [pendingRecord, setPendingRecord]               = useState<SlaHeader | null>(null);
  const [pendingMissingLines, setPendingMissingLines]   = useState<SlaLine[]>([]);
  const [pendingGlLines, setPendingGlLines]             = useState<any[]>([]);
  const [pendingPostLoading, setPendingPostLoading]     = useState(false);
  const [pendingPostResult, setPendingPostResult]       = useState<any>(null);
  const [pendingLedger, setPendingLedger]               = useState<{ ledgerName: string; ledgerId: number } | null>(null);
  const [pendingApiVisible, setPendingApiVisible]       = useState(false);
  const [pendingApiPayload, setPendingApiPayload]       = useState<any>(null);

  // ── Post to GL modal ──────────────────────────────────────────────────────
  const [postGLModalVisible, setPostGLModalVisible]     = useState(false);
  const [postGLRecord, setPostGLRecord]                 = useState<SlaHeader | null>(null);
  const [postGLLines, setPostGLLines]                   = useState<SlaLine[]>([]);
  const [postGLFetchingLines, setPostGLFetchingLines]   = useState(false);
  const [postGLLoading, setPostGLLoading]               = useState(false);
  const [postGLResult, setPostGLResult]                 = useState<any>(null);
  const [postGLLedger, setPostGLLedger]                 = useState<{ ledgerName: string; ledgerId: number } | null>(null);

  // ── Fetch headers ────────────────────────────────────────────────────────
  const fetchHeaders = useCallback(async (values: any) => {
    setHeaderLoading(true);
    try {
      const params = new URLSearchParams();
      if (values.status)      params.append('accountingStatus', values.status);
      if (values.moduleName)  params.append('moduleName', values.moduleName);
      if (values.sourceTable) params.append('sourceTable', values.sourceTable);
      if (values.eventType)   params.append('eventTypeCode', values.eventType);
      if (values.period)      params.append('periodName', values.period);
      if (values.sourceNumber) params.append('sourceNumber', values.sourceNumber);
      if (values.dateRange?.[0]) params.append('dateFrom', values.dateRange[0].format('YYYY-MM-DD'));
      if (values.dateRange?.[1]) params.append('dateTo',   values.dateRange[1].format('YYYY-MM-DD'));
      params.append('limit', '500');

      const url = `${APEX_DB_CONFIG.baseUrl}/sla/journals?${params.toString()}`;
      setLastCalledUrl(url);
      setLastApiError(null);
      setLastApiStatus(null);
      setLastApiRaw(null);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      setLastApiStatus(res.status);
      const rawText = await res.text();
      const fixBD = (s: string) => s.replace(/([^0-9])(\.([0-9]+))/g, (_m, pre, dec) => pre + '0' + dec);
      // Remove corrupt bare-value fragments like ,:18" (ORDS CLOB truncation artefact)
      const repairJson = (s: string) => s.replace(/,\s*:[^",{}\[\]\s][^,}\]"]*/g, '');
      let data: any = rawText;
      for (let pass = 0; pass < 3; pass++) {
        if (typeof data !== 'string') break;
        try { data = JSON.parse(fixBD(data)); } catch {
          try { data = JSON.parse(repairJson(fixBD(data))); } catch { break; }
        }
      }
      setLastApiRaw(data);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${typeof data === 'object' ? (data?.message || data?.error || JSON.stringify(data).slice(0, 200)) : rawText.slice(0, 200)}`);
      const rawItems = data?.items ?? (Array.isArray(data) ? data : []);
      const items: SlaHeader[] = Array.isArray(rawItems) ? rawItems.map((r: any) => ({
        ...r,
        key: String(r.headerId),
      })) : [];
      setHeaders(items);
      setHeaderTotal(items.length);

      // compute quick stats
      setStats({
        draft:   items.filter(h => h.accountingStatus === 'DRAFT').length,
        posted:  items.filter(h => h.accountingStatus === 'POSTED').length,
        error:   items.filter(h => h.accountingStatus === 'ERROR').length,
        totalDr: 0,
        totalCr: 0,
      });
    } catch (err: any) {
      setLastApiError(err.message);
      message.error(`Failed to load journal entries: ${err.message}`);
    } finally {
      setHeaderLoading(false);
    }
  }, []);

  // Auto-load on first render with last 15 days accounting date
  useEffect(() => {
    // Default to last complete month — avoids ORA-06502 when current period is not yet closed
    const defaultRange = [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')];
    headerForm.setFieldsValue({ dateRange: defaultRange });
    fetchHeaders({ dateRange: defaultRange });
  }, [fetchHeaders, headerForm]);

  // ── Fetch lines ──────────────────────────────────────────────────────────
  const fetchLines = useCallback(async (values: any) => {
    setLineLoading(true);
    try {
      const params = new URLSearchParams();
      if (values.status)      params.append('accountingStatus', values.status);
      if (values.moduleName)  params.append('moduleName', values.moduleName);
      if (values.lineType)    params.append('lineType', values.lineType);
      if (values.acctClass)   params.append('accountingClass', values.acctClass);
      if (values.account)     params.append('accountCombination', values.account);
      if (values.sourceNumber) params.append('sourceNumber', values.sourceNumber);
      if (values.period)       params.append('periodName',  values.period);
      if (values.dateRange?.[0]) params.append('dateFrom', values.dateRange[0].format('YYYY-MM-DD'));
      if (values.dateRange?.[1]) params.append('dateTo',   values.dateRange[1].format('YYYY-MM-DD'));
      params.append('limit', '500');

      const url = `${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?${params.toString()}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fixBD = (s: string) => s.replace(/([^0-9])(\.([0-9]+))/g, (_m, pre, dec) => pre + '0' + dec);
      let data: any = await res.text();
      for (let p = 0; p < 3; p++) {
        if (typeof data !== 'string') break;
        try { data = JSON.parse(fixBD(data)); } catch { break; }
      }
      const rawLineItems = data?.items ?? (Array.isArray(data) ? data : []);
      const items: SlaLine[] = Array.isArray(rawLineItems) ? rawLineItems.map((r: any, i: number) => ({
        ...r,
        key: r.lineId ? String(r.lineId) : `${r.headerId}-${r.lineNumber}-${i}`,
      })) : [];
      setLines(items);
      setLineTotal(items.length);

      const totalDr = items.reduce((s, l) => s + (l.accountedDr || 0), 0);
      const totalCr = items.reduce((s, l) => s + (l.accountedCr || 0), 0);
      setStats(prev => ({ ...prev, totalDr, totalCr }));
    } catch (err: any) {
      message.error(`Failed to load journal lines: ${err.message}`);
    } finally {
      setLineLoading(false);
    }
  }, []);

  // ── Compare SLA vs GL lines ───────────────────────────────────────────────
  const handleCompareWithGL = async (record: SlaHeader) => {
    setCompareHeader(record);
    setCompareSlaLines([]);
    setCompareGlLines([]);
    setCompareError(null);
    setCompareLoading(true);
    setCompareModalVisible(true);
    try {
      // Fetch SLA lines
      const slaRes = await fetch(
        `${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${record.headerId}&limit=500`,
        { headers: { Accept: 'application/json' } }
      );
      const slaText = await slaRes.text();
      let slaData: any = slaText;
      try { slaData = JSON.parse(slaData); } catch { try { slaData = JSON.parse(slaData); } catch { /**/ } }
      const slaItems = slaData?.items ?? (Array.isArray(slaData) ? slaData : []);
      setCompareSlaLines(Array.isArray(slaItems) ? slaItems.map((l: any, i: number) => ({ ...l, key: String(l.lineId ?? i) })) : []);

      // Fetch GL lines using the existing working endpoint
      if (record.glHeaderId) {
        const glRes = await fetch(
          `${APEX_DB_CONFIG.baseUrl}/gl/journals/${record.glHeaderId}/lines`,
          { headers: { Accept: 'application/json' } }
        );
        const glText = await glRes.text();
        let glData: any = glText;
        try { glData = JSON.parse(glData); } catch { /**/ }
        const glItems = glData?.items ?? (Array.isArray(glData) ? glData : []);
        setCompareGlLines(
          Array.isArray(glItems) ? glItems.map((l: any, i: number) => ({
            key:              String(l.lineNum ?? l.linenum ?? l.je_line_number ?? i),
            lineNum:          l.lineNum     ?? l.linenum     ?? l.je_line_number,
            accountCombination: l.account   ?? l.accountcombination ?? l.account_combination ?? l.ACCOUNT_COMBINATION,
            description:      l.description ?? l.DESCRIPTION,
            currencyCode:     l.currency    ?? l.currencyCode ?? l.currency_code,
            enteredDr:        l.enteredDr   ?? l.entereddr   ?? l.entered_dr   ?? l.ENTERED_DR,
            enteredCr:        l.enteredCr   ?? l.enteredcr   ?? l.entered_cr   ?? l.ENTERED_CR,
            accountedDr:      l.accountedDr ?? l.accounteddr ?? l.accounted_dr ?? l.ACCOUNTED_DR,
            accountedCr:      l.accountedCr ?? l.accountedcr ?? l.accounted_cr ?? l.ACCOUNTED_CR,
          })) : []
        );
      }
    } catch (err: any) {
      setCompareError(err?.message || 'Failed to load comparison data');
    } finally {
      setCompareLoading(false);
    }
  };

  // ── Bulk GL line-count fetch ─────────────────────────────────────────────
  const handleBulkGLCompare = async () => {
    const headersWithGL = headers.filter(h => h.glHeaderId);
    if (headersWithGL.length === 0) {
      message.warning('No records with a GL header to compare');
      return;
    }
    setGlCountsLoading(true);
    setGlLineCounts({});
    const counts: Record<number, number> = {};
    await Promise.all(
      headersWithGL.map(async (h) => {
        try {
          const res = await fetch(
            `${APEX_DB_CONFIG.baseUrl}/gl/journals/${h.glHeaderId}/lines`,
            { headers: { Accept: 'application/json' } }
          );
          if (!res.ok) { counts[h.headerId] = -1; return; }
          let data: any;
          try { data = await res.json(); } catch { counts[h.headerId] = -1; return; }
          const items = data?.items ?? (Array.isArray(data) ? data : []);
          counts[h.headerId] = Array.isArray(items) ? items.length : -1;
        } catch {
          counts[h.headerId] = -1;
        }
      })
    );
    setGlLineCounts(counts);
    setGlCountsLoading(false);
    const mismatches = headersWithGL.filter(h => counts[h.headerId] !== undefined && counts[h.headerId] !== h.lineCount);
    if (mismatches.length > 0) {
      message.warning(`${mismatches.length} record(s) have mismatched line counts`);
    } else {
      message.success('All GL line counts match SLA line counts');
    }
  };

  // ── Preview & push missing SLA lines to GL ──────────────────────────────
  const handlePreviewMissingLines = async (record: SlaHeader) => {
    setPendingRecord(record);
    setPendingMissingLines([]);
    setPendingGlLines([]);
    setPendingPostResult(null);
    setPendingApiPayload(null);
    setPendingApiVisible(false);
    setPendingLedger(null);
    setPendingModalLoading(true);
    setPendingModalVisible(true);
    try {
      // Fetch SLA lines + GL lines + ledger in parallel
      const [slaRes, glRes, ledgerInfo] = await Promise.all([
        fetch(`${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${record.headerId}&limit=500`, { headers: { Accept: 'application/json' } }),
        record.glHeaderId
          ? fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/${record.glHeaderId}/lines`, { headers: { Accept: 'application/json' } })
          : Promise.resolve(null),
        fetchLedgerByBusinessUnit(record.businessUnit),
      ]);

      if (ledgerInfo) setPendingLedger(ledgerInfo);

      const fixBD = (s: string) => s.replace(/([^0-9])(\.([0-9]+))/g, (_m, pre, dec) => pre + '0' + dec);
      let slaData: any = await slaRes.text();
      for (let p = 0; p < 3; p++) {
        if (typeof slaData !== 'string') break;
        try { slaData = JSON.parse(fixBD(slaData)); } catch { break; }
      }
      const slaItems: SlaLine[] = (slaData?.items ?? (Array.isArray(slaData) ? slaData : []))
        .map((l: any, i: number) => ({ ...l, key: l.lineId ? String(l.lineId) : `sla-${i}` }));

      let glItems: any[] = [];
      if (glRes && glRes.ok) {
        let glData: any;
        try { glData = await glRes.json(); } catch { glData = {}; }
        const raw = glData?.items ?? (Array.isArray(glData) ? glData : []);
        glItems = Array.isArray(raw) ? raw.map((l: any, i: number) => ({
          key: String(l.lineNum ?? i),
          accountCombination: l.account ?? l.accountcombination ?? l.account_combination ?? '',
          accountedDr: l.accountedDr ?? l.accounteddr ?? l.accounted_dr ?? 0,
          accountedCr: l.accountedCr ?? l.accountedcr ?? l.accounted_cr ?? 0,
          enteredDr:   l.enteredDr  ?? l.entereddr  ?? l.entered_dr  ?? 0,
          enteredCr:   l.enteredCr  ?? l.enteredcr  ?? l.entered_cr  ?? 0,
        })) : [];
      }
      setPendingGlLines(glItems);

      // Identify missing: SLA lines with no matching GL line
      // Match by accountCombination + accountedDr + accountedCr (within 0.01 tolerance)
      const usedGlIndices = new Set<number>();
      const missingLines: SlaLine[] = [];
      for (const slaLine of slaItems) {
        const matchIdx = glItems.findIndex((gl, idx) => {
          if (usedGlIndices.has(idx)) return false;
          const acctMatch = (slaLine.accountCombination || '') === (gl.accountCombination || '');
          const drMatch   = Math.abs((slaLine.accountedDr || 0) - (gl.accountedDr || 0)) < 0.01;
          const crMatch   = Math.abs((slaLine.accountedCr || 0) - (gl.accountedCr || 0)) < 0.01;
          return acctMatch && drMatch && crMatch;
        });
        if (matchIdx === -1) {
          missingLines.push(slaLine);
        } else {
          usedGlIndices.add(matchIdx);
        }
      }
      setPendingMissingLines(missingLines);
    } catch (err: any) {
      message.error(`Failed to load lines: ${err.message}`);
      setPendingModalVisible(false);
    } finally {
      setPendingModalLoading(false);
    }
  };

  // Build the line objects for the new endpoint — used for both preview and posting
  const buildMissingLinesPayload = () => {
    if (!pendingRecord || pendingMissingLines.length === 0) return [];
    const ref5 = eventTypeToRef5(pendingRecord.eventTypeCode);
    const rateLine = pendingMissingLines.find(l => (l.enteredDr || l.enteredCr) && (l.accountedDr || l.accountedCr));
    const derivedRate = rateLine
      ? ((rateLine.enteredDr || 0) > 0
          ? (rateLine.accountedDr || 0) / (rateLine.enteredDr || 1)
          : (rateLine.accountedCr || 0) / (rateLine.enteredCr || 1))
      : 1;
    return pendingMissingLines.map(l => ({
      enteredDr:          l.enteredDr  || null,
      enteredCr:          l.enteredCr  || null,
      accountedDr:        l.accountedDr || null,
      accountedCr:        l.accountedCr || null,
      description:        l.description || pendingRecord.description || '',
      currencyCode:       l.currencyCode || pendingRecord.currencyCode,
      accountingDate:     l.accountingDate || pendingRecord.accountingDate,
      accountCombination: l.accountCombination || '',
      conversionRate:     Math.round(derivedRate * 100000) / 100000,
      reconciledFlag:     'N',
      reference1:         pendingRecord.sourceNumber,
      reference2:         String(pendingRecord.sourceId),
      reference3:         l.accountingClass || null,
      reference4:         pendingRecord.businessUnit || null,
      reference5:         ref5,
      createdBy:          pendingRecord.createdBy || 'SYSTEM',
    }));
  };

  const handlePushMissingLines = async () => {
    if (!pendingRecord?.glHeaderId || pendingMissingLines.length === 0) return;
    const linesPayload = buildMissingLinesPayload();
    const addLinesUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${pendingRecord.glHeaderId}/linesaddmissing`;
    const postBatchUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${pendingRecord.glBatchId}/post`;

    setPendingPostLoading(true);
    try {
      // Step 1 — POST new lines into the EXISTING GL header
      const addRes = await fetch(addLinesUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(linesPayload),
      });
      const addData = await addRes.json().catch(() => ({}));
      if (!addRes.ok || addData?.success === false) {
        const err = addData?.error || `HTTP ${addRes.status}`;
        setPendingApiPayload({
          calls: [{ method: 'POST', url: addLinesUrl, description: 'Add missing lines to existing GL header', body: linesPayload, response: addData }],
          result: { success: false, error: err },
        });
        setPendingPostResult({ success: false, error: err });
        message.error(`Add lines failed: ${err}`);
        return;
      }

      // Step 2 — re-POST the batch so Oracle recalculates totals & status
      let postResult: any = { success: true };
      if (pendingRecord.glBatchId) {
        const postRes = await fetch(postBatchUrl, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    '{}',
        });
        const postData = await postRes.json().catch(() => ({}));
        if (!postRes.ok || postData?.success === false) {
          const err = (Array.isArray(postData?.errors) ? postData.errors[0] : null) || postData?.error || `HTTP ${postRes.status}`;
          postResult = { success: false, error: `Re-post warning: ${err} (lines were added)` };
        }
      }

      // Capture API call sequence for the inspector
      setPendingApiPayload({
        calls: [
          { method: 'POST', url: addLinesUrl, description: `Add ${linesPayload.length} missing line(s) into existing GL header ${pendingRecord.glHeaderId}`, body: linesPayload, response: addData },
          { method: 'PUT',  url: postBatchUrl, description: `Re-post GL batch ${pendingRecord.glBatchId} to refresh totals & status`, body: {}, response: postResult },
        ],
        result: postResult,
      });

      const finalResult = { success: true, skipped: false, batchId: pendingRecord.glBatchId, headerId: pendingRecord.glHeaderId, batchName: pendingRecord.glBatchName || '' };
      setPendingPostResult(finalResult);

      if (postResult.success) {
        message.success(`${linesPayload.length} line(s) added to GL batch ${pendingRecord.glBatchId}`);
      } else {
        message.warning(`Lines added but re-post returned a warning: ${postResult.error}`);
      }

      // Refresh the GL count for this row
      const countRes = await fetch(
        `${APEX_DB_CONFIG.baseUrl}/gl/journals/${pendingRecord.glHeaderId}/linesaddmissing`,
        { headers: { Accept: 'application/json' } }
      ).catch(() => null);
      if (countRes?.ok) {
        let d: any;
        try { d = await countRes.json(); } catch { d = {}; }
        const items = d?.items ?? (Array.isArray(d) ? d : []);
        setGlLineCounts(prev => ({ ...prev, [pendingRecord!.headerId]: Array.isArray(items) ? items.length : prev[pendingRecord!.headerId] }));
      }
      headerForm.submit();
    } catch (err: any) {
      message.error(`Push failed: ${err.message}`);
      setPendingPostResult({ success: false, error: err.message });
    } finally {
      setPendingPostLoading(false);
    }
  };

  // ── View GL Journal Entry ─────────────────────────────────────────────────
  const handleViewJournalEntry = async (record: SlaHeader) => {
    setGlJournalData(null);
    setGlJournalLines([]);
    setSlaModalLines([]);
    setSlaModalRecord(record);
    setGlLastHeaderUrl(null);
    setGlLastLinesUrl(null);
    setGlLastError(null);
    setGlRawLinesData(null);
    setSlaLastLinesUrl(null);
    setSlaLastLinesError(null);
    setSlaRawLinesData(null);
    setGlJournalLoading(true);
    setGlJournalModalVisible(true);
    try {
      // Fetch SLA lines directly — capture URL and raw response for API inspector
      const slaUrl = `${APEX_DB_CONFIG.baseUrl}/sla/journals/lines?headerId=${record.headerId}&limit=500`;
      setSlaLastLinesUrl(slaUrl);
      try {
        const slaRes = await fetch(slaUrl, { headers: { Accept: 'application/json' } });
        const slaRawText = await slaRes.text();
        // Fix Oracle bare decimals (.17 → 0.17) then handle double-encoded JSON
        const fixBareDecimals = (s: string) => s.replace(/([^0-9])(\.([0-9]+))/g, (_m, pre, dec) => pre + '0' + dec);
        let slaData: any = slaRawText;
        for (let pass = 0; pass < 3; pass++) {
          if (typeof slaData !== 'string') break;
          try { slaData = JSON.parse(fixBareDecimals(slaData)); } catch { break; }
        }
        setSlaRawLinesData(slaData);
        if (!slaRes.ok) {
          setSlaLastLinesError(`HTTP ${slaRes.status} — ${typeof slaData === 'object' ? (slaData?.message || slaData?.error || JSON.stringify(slaData).slice(0, 200)) : slaRawText.slice(0, 200)}`);
        } else {
          const rawItems = slaData?.items ?? (Array.isArray(slaData) ? slaData : []);
          const items = Array.isArray(rawItems) ? rawItems : [];
          setSlaModalLines(items.map((l: any, i: number) => ({ ...l, key: l.lineId?.toString() ?? String(i) })));
        }
      } catch (e: any) {
        setSlaLastLinesError(e?.message || 'Request failed');
      }

      if (!record.glHeaderId && !record.glBatchId) {
        setGlJournalLoading(false);
        return;
      }
      // Use SLA record data we already have for the header
      setGlJournalData({
        journalName: record.glBatchName || `GL Batch ${record.glBatchId}`,
        batchName:   record.glBatchName,
        glBatchId:   record.glBatchId,
        glHeaderId:  record.glHeaderId,
        periodName:  record.periodName,
        ledgerName:  record.ledgerName,
        effectiveDate: record.accountingDate,
        currencyCode:  record.currencyCode,
        statusMeaning: record.postingStatus,
        source:   'Payables',
        category: record.eventTypeCode,
        jeHeaderId: record.glHeaderId,
      });

      // Fetch journal lines using the correct ORDS path: journals/:id/lines
      if (record.glHeaderId) {
        const linesUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${record.glHeaderId}/lines`;
        setGlLastLinesUrl(linesUrl);
        const linesRes = await fetch(linesUrl, { headers: { Accept: 'application/json' } });
        if (!linesRes.ok) throw new Error(`Lines request failed: ${linesRes.status} ${linesRes.statusText}`);
        const linesData = await linesRes.json();
        console.log('[GL Lines] Raw API response:', JSON.stringify(linesData, null, 2));
        setGlRawLinesData(linesData);
        const rawItems = linesData.items || linesData || [];
        console.log('[GL Lines] Items array:', rawItems);
        if (rawItems.length > 0) {
          console.log('[GL Lines] First item keys:', Object.keys(rawItems[0]));
          console.log('[GL Lines] First item values:', rawItems[0]);
        }
        setGlJournalLines(rawItems.map((l: any, i: number) => ({
          key: i,
          lineNum:     l.lineNum     ?? l.linenum     ?? l.je_line_number  ?? l.JE_LINE_NUMBER,
          account:     l.account     ?? l.accountcombination ?? l.account_combination ?? l.ACCOUNT_COMBINATION,
          description: l.description ?? l.DESCRIPTION,
          currency:    l.currency    ?? l.currencyCode ?? l.currencycode ?? l.currency_code ?? l.CURRENCY_CODE,
          enteredDr:   l.enteredDr   ?? l.entereddr   ?? l.entered_dr   ?? l.ENTERED_DR,
          enteredCr:   l.enteredCr   ?? l.enteredcr   ?? l.entered_cr   ?? l.ENTERED_CR,
          accountedDr: l.accountedDr ?? l.accounteddr ?? l.accounted_dr ?? l.ACCOUNTED_DR,
          accountedCr: l.accountedCr ?? l.accountedcr ?? l.accounted_cr ?? l.ACCOUNTED_CR,
        })));
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to load GL journal lines';
      setGlLastError(errMsg);
      message.error('Failed to load GL journal lines');
    } finally {
      setGlJournalLoading(false);
    }
  };

  // ── AP Transaction drill-down ─────────────────────────────────────────────
  const handleTransactionDrilldown = async (record: SlaHeader) => {
    const isPayment = (record.sourceTable || '').toUpperCase().includes('PAYMENT');
    setApTxnType(isPayment ? 'payment' : 'invoice');
    setApTxnData(null);
    setApTxnLines([]);
    setApTxnLoading(true);
    setApTxnModalVisible(true);
    try {
      let url: string;
      if (isPayment) {
        url = `${APEX_DB_CONFIG.baseUrl}/ap/payments?payment_number=${encodeURIComponent(record.sourceNumber)}`;
      } else {
        url = `${APEX_DB_CONFIG.baseUrl}/ap/createinvoice?invoice_number=${encodeURIComponent(record.sourceNumber)}`;
      }
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const items = data.items || (Array.isArray(data) ? data : [data]);
      if (items.length > 0 && items[0]) {
        setApTxnData(items[0]);
        if (!isPayment) {
          // Fetch invoice lines using the source ID from the SLA record
          const invoiceId = record.sourceId || items[0].invoice_id || items[0].invoiceId;
          if (invoiceId) {
            try {
              const linesRes = await fetch(
                `${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${invoiceId}`,
                { headers: { Accept: 'application/json' } }
              );
              const linesData = await linesRes.json();
              const lineItems = linesData.items || (Array.isArray(linesData) ? linesData : []);
              setApTxnLines(lineItems);
            } catch {
              // Lines fetch failure is non-critical; header is still shown
            }
          }
        }
      } else {
        message.warning('Transaction not found');
        setApTxnModalVisible(false);
      }
    } catch {
      message.error('Failed to load transaction details');
      setApTxnModalVisible(false);
    } finally {
      setApTxnLoading(false);
    }
  };

  // ── Post to GL helpers ────────────────────────────────────────────────────
  const GL_CREATE_URL = buildApexUrl('journals/create');
  const SLA_POST_URL  = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.slaAccountingPost}`;

  /** Build the journals/create payload from SLA header + its fetched lines */
  const buildGLPayload = (hdr: SlaHeader, slaLines: SlaLine[], resolvedLedgerName?: string, resolvedLedgerId?: number) => {
    const totalDr = slaLines.reduce((s, l) => s + (l.enteredDr || 0), 0);
    const totalCr = slaLines.reduce((s, l) => s + (l.enteredCr || 0), 0);
    const batchName = `SLA-${hdr.moduleName}-${hdr.periodName}-${hdr.headerId}`;
    const ledgerName = resolvedLedgerName ?? hdr.ledgerName;
    const ledgerId   = resolvedLedgerId   ?? 0;

    const isCM = hdr.moduleName === 'CM';
    const jeSource   = isCM ? 'Cash Management' : 'Payables';
    const batchSrc   = isCM ? 'Cash Management' : 'Payables';
    const jeCategory = isCM
      ? 'Cash Management'
      : (hdr.eventTypeCode?.includes('PAYMENT') ? 'Payments' : 'Purchase Invoices');

    return {
      batch: {
        batchName,
        batchDescription:  hdr.description || '',
        ledgerName,
        ledgerId,
        status:            'NEW',
        accountingPeriod:  hdr.periodName,
        controlTotal:      totalDr,
        runningTotalDr:    totalDr,
        runningTotalCr:    totalCr,
        batchSource:       batchSrc,
        createdBy:         hdr.createdBy || 'SYSTEM',
      },
      header: {
        ledgerId,
        ledgerName,
        jeCategory,
        jeSource,
        periodName:               hdr.periodName,
        journalName:              `SLA-${hdr.sourceNumber}-${hdr.eventTypeCode}`,
        description:              hdr.description || '',
        currencyCode:             hdr.currencyCode,
        currencyConversionType:   'User',
        currencyConversionDate:   hdr.accountingDate,
        currencyConversionRate:   1,
        defaultEffectiveDate:     hdr.accountingDate,
        status:                   'NEW',
        runningTotalDr:           totalDr,
        runningTotalCr:           totalCr,
        createdBy:                hdr.createdBy || 'SYSTEM',
      },
      lines: slaLines.map(l => ({
        enteredDr:                l.lineType === 'DR' ? (l.enteredDr || null) : null,
        enteredCr:                l.lineType === 'CR' ? (l.enteredCr || null) : null,
        accountedDr:              l.accountedDr || null,
        accountedCr:              l.accountedCr || null,
        statAmount:               null,
        description:              l.description || hdr.description || '',
        currencyCode:             l.currencyCode || hdr.currencyCode,
        currencyConversionDate:   l.accountingDate || hdr.accountingDate,
        currencyConversionRate:   1,
        userCurrencyConversionType: 'User',
        accountCombination:       l.accountCombination || '',
        chartOfAccountsName:      'Chart of Accounts',
        reference1:               hdr.sourceNumber || l.sourceNumber || null,
        reference2:               String(hdr.sourceId || ''),
        reference3:               l.accountingClass || null,
        reference4:               hdr.businessUnit  || null,
        reference5:               eventTypeToRef5(hdr.eventTypeCode),
        createdBy:                hdr.createdBy || 'SYSTEM',
      })),
    };
  };

  const handleOpenPostGL = async (record: SlaHeader) => {
    setPostGLRecord(record);
    setPostGLLines([]);
    setPostGLResult(null);
    setPostGLLedger(null);
    setPostGLModalVisible(true);
    // Fetch SLA lines via sla/accounting (filtered by sourceId) — same approach as ManagePayments
    setPostGLFetchingLines(true);
    try {
      const [fullData, ledgerInfo] = await Promise.all([
        getAccounting(record.sourceTable, record.sourceId),
        fetchLedgerByBusinessUnit(record.businessUnit),
      ]);
      const items: SlaLine[] = (fullData.lines || []).map((r: any, i: number) => ({
        ...r,
        key: r.lineId ? String(r.lineId) : `${r.headerId}-${r.lineNumber}-${i}`,
      }));
      setPostGLLines(items);
      if (ledgerInfo) setPostGLLedger(ledgerInfo);
    } catch (err: any) {
      message.warning(`Could not load SLA lines: ${err.message}`);
    } finally {
      setPostGLFetchingLines(false);
    }
  };

  const handlePostToGL = async () => {
    if (!postGLRecord) return;
    setPostGLLoading(true);
    try {
      // Map SLA lines → GlPostingLine[] for the central service
      const glLines: GlPostingLine[] = postGLLines.map(l => ({
        lineType:           l.lineType as 'DR' | 'CR',
        enteredDr:          l.enteredDr  || null,
        enteredCr:          l.enteredCr  || null,
        accountedDr:        l.accountedDr || null,
        accountedCr:        l.accountedCr || null,
        description:        l.description || postGLRecord.description || '',
        currencyCode:       l.currencyCode || postGLRecord.currencyCode,
        accountingDate:     l.accountingDate || postGLRecord.accountingDate,
        accountCombination: l.accountCombination || '',
        accountingClass:    l.accountingClass || null,
        legalEntity:        l.legalEntity || null,
      }));

      // Fallback legalEntity from first line that has one
      const legalEntity = postGLLines.find(l => l.legalEntity)?.legalEntity || '';

      // Derive conversion rate from first line that has both entered and accounted amounts
      const rateLine = postGLLines.find(l => (l.enteredDr || l.enteredCr) && (l.accountedDr || l.accountedCr));
      const derivedRate = rateLine
        ? ((rateLine.enteredDr || 0) > 0
            ? (rateLine.accountedDr || 0) / (rateLine.enteredDr || 1)
            : (rateLine.accountedCr || 0) / (rateLine.enteredCr || 1))
        : 1;
      const conversionRate = Math.round(derivedRate * 100000) / 100000; // 5dp precision

      const result = await postSlaToGL({
        slaHeaderId:    postGLRecord.headerId,
        sourceNumber:   postGLRecord.sourceNumber,
        sourceId:       postGLRecord.sourceId,
        eventTypeCode:  postGLRecord.eventTypeCode,
        periodName:     postGLRecord.periodName,
        ledgerName:     postGLLedger?.ledgerName ?? postGLRecord.ledgerName,
        ledgerId:       postGLLedger?.ledgerId   ?? 0,
        currency:       postGLRecord.currencyCode,
        accountingDate: postGLRecord.accountingDate,
        legalEntity,
        businessUnit:    postGLRecord.businessUnit || '',
        conversionRate,
        lines:           glLines,
        createdBy:       postGLRecord.createdBy || 'SYSTEM',
      });

      setPostGLResult(result);
      if (result.success) {
        if (result.skipped) {
          message.warning('GL journal already exists — SLA stamped with existing batch');
        } else {
          message.success('SLA journal posted to GL successfully');
        }
        headerForm.submit();
      } else {
        message.error(`Post to GL failed: ${result.error}`);
      }
    } catch (err: any) {
      setPostGLResult({ success: false, skipped: false, batchId: null, headerId: null, batchName: '', error: err.message });
      message.error(`Post to GL failed: ${err.message}`);
    } finally {
      setPostGLLoading(false);
    }
  };

  // ── Header table columns ─────────────────────────────────────────────────
  const headerColumns = [
    {
      title: 'SLA Header ID',
      dataIndex: 'headerId',
      width: 110,
      render: (v: number) => <Text code style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Accounting Date',
      dataIndex: 'accountingDate',
      width: 130,
      sorter: (a: SlaHeader, b: SlaHeader) => a.accountingDate.localeCompare(b.accountingDate),
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('DD-MMM-YYYY') : '—'}</Text>,
    },
    {
      title: 'Transaction #',
      dataIndex: 'sourceNumber',
      width: 150,
      render: (v: string, r: SlaHeader) => (
        <Tooltip title={`Click to view ${r.sourceTable?.includes('PAYMENT') ? 'Payment' : 'Invoice'} | Header ID: ${r.headerId}`}>
          <a
            style={{ fontSize: 12, fontWeight: 600, color: REDWOOD.info }}
            onClick={() => handleTransactionDrilldown(r)}
          >
            {v}
          </a>
        </Tooltip>
      ),
    },
    {
      title: 'Module',
      dataIndex: 'moduleName',
      width: 70,
      render: (v: string) => <Tag color="blue" style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: 'Event Type',
      dataIndex: 'eventTypeCode',
      width: 170,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'accountingStatus',
      width: 90,
      render: (v: string) => (
        <Tag icon={statusIcon(v)} color={statusColor(v)} style={{ fontSize: 11, fontWeight: 600 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Period',
      dataIndex: 'periodName',
      width: 80,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Business Unit',
      dataIndex: 'businessUnit',
      width: 160,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: 'Ledger',
      dataIndex: 'ledgerName',
      width: 120,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: 'Lines',
      dataIndex: 'lineCount',
      width: 90,
      align: 'center' as const,
      render: (v: number, r: SlaHeader) => {
        const glCount = glLineCounts[r.headerId];
        const hasMismatch = glCount !== undefined && glCount !== -1 && glCount !== v;
        if (glCount === undefined) {
          return <Badge count={v} color={REDWOOD.info} style={{ fontSize: 10 }} />;
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 10, color: REDWOOD.neutral600 }}>
              <Tag color="orange" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', margin: 0 }}>SLA</Tag>
              {' '}<Badge count={v} color={REDWOOD.info} style={{ fontSize: 10 }} />
            </span>
            <span style={{ fontSize: 10, color: hasMismatch ? REDWOOD.error : REDWOOD.success }}>
              <Tag color={hasMismatch ? 'red' : 'green'} style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', margin: 0 }}>GL</Tag>
              {' '}<Badge count={glCount === -1 ? '!' : glCount} color={hasMismatch ? REDWOOD.error : REDWOOD.success} style={{ fontSize: 10 }} />
            </span>
          </div>
        );
      },
    },
    {
      title: 'Description',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }} ellipsis>{v}</Text>,
    },
    {
      title: 'GL Batch',
      dataIndex: 'glBatchId',
      width: 90,
      render: (v: number | null, r: SlaHeader) => v ? (
        <Tooltip title={r.glBatchName || ''}>
          <Text code style={{ fontSize: 10 }}>{v}</Text>
        </Tooltip>
      ) : <Text style={{ color: REDWOOD.neutral600, fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Created By',
      dataIndex: 'createdBy',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, r: SlaHeader) => (
        <Space orientation="vertical" size={4}>
          <Button
            size="small"
            icon={<EyeOutlined />}
            style={{
              fontSize: 11,
              color: REDWOOD.info,
              borderColor: REDWOOD.info,
              width: '100%',
            }}
            onClick={() => handleViewJournalEntry(r)}
          >
            View Journal
          </Button>
          {r.glHeaderId && (
          <Button
            size="small"
            icon={<SwapOutlined />}
            style={{ fontSize: 11, width: '100%' }}
            onClick={() => handleCompareWithGL(r)}
          >
            Compare GL
          </Button>
          )}
          {(() => {
            const glCount = glLineCounts[r.headerId];
            const hasMismatch = glCount !== undefined && glCount !== -1 && glCount !== r.lineCount;
            return hasMismatch ? (
              <Button
                size="small"
                icon={<SendOutlined />}
                style={{
                  fontSize: 11,
                  width: '100%',
                  background: REDWOOD.warning,
                  borderColor: REDWOOD.warning,
                  color: '#fff',
                }}
                onClick={() => handlePreviewMissingLines(r)}
              >
                Push Missing Lines
              </Button>
            ) : null;
          })()}
          {r.accountingStatus !== 'POSTED' && (
          <Button
            size="small"
            icon={<SendOutlined />}
            style={{
              fontSize: 11,
              width: '100%',
              background: r.accountingStatus === 'DRAFT' ? REDWOOD.primary : undefined,
              borderColor: r.accountingStatus === 'DRAFT' ? REDWOOD.primary : undefined,
              color: r.accountingStatus === 'DRAFT' ? '#fff' : REDWOOD.neutral600,
            }}
            onClick={() => handleOpenPostGL(r)}
          >
            Post to GL
          </Button>
          )}
        </Space>
      ),
    },
  ];

  // ── Lines table columns ──────────────────────────────────────────────────
  const lineColumns = [
    {
      title: 'SLA Header ID',
      dataIndex: 'headerId',
      width: 110,
      render: (v: number) => <Text code style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 68,
      render: (_: any, r: SlaLine) => {
        const hdr = headers.find(h => h.headerId === r.headerId);
        if (!hdr) return null;
        return (
          <Space size={2}>
            <Tooltip title="View Journal">
              <Button
                size="small"
                icon={<EyeOutlined />}
                style={{ padding: '0 4px', fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={() => handleViewJournalEntry(hdr)}
              />
            </Tooltip>
            <Tooltip title="Compare with GL Lines">
              <Button
                size="small"
                icon={<SwapOutlined />}
                style={{ padding: '0 4px', fontSize: 11 }}
                onClick={() => handleCompareWithGL(hdr)}
              />
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: 'Accounting Date',
      dataIndex: 'accountingDate',
      width: 130,
      sorter: (a: SlaLine, b: SlaLine) => a.accountingDate.localeCompare(b.accountingDate),
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format('DD-MMM-YYYY') : '—'}</Text>,
    },
    {
      title: 'Transaction #',
      dataIndex: 'sourceNumber',
      width: 150,
      render: (v: string, r: SlaLine) => (
        <Tooltip title={`Header ID: ${r.headerId} | Line: ${r.lineNumber}`}>
          <Text style={{ fontSize: 12, color: REDWOOD.info }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'lineType',
      width: 55,
      render: (v: string) => (
        <Tag color={v === 'DR' ? 'blue' : 'red'} style={{ fontSize: 11, fontWeight: 700 }}>{v}</Tag>
      ),
    },
    {
      title: 'Accounting Class',
      dataIndex: 'accountingClass',
      width: 130,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Account Combination',
      dataIndex: 'accountCombination',
      ellipsis: true,
      render: (v: string, r: SlaLine) => (
        <div>
          <Text code style={{ fontSize: 11 }}>{v || '—'}</Text>
          {(r as any).accountDescription && <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{(r as any).accountDescription}</div>}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'accountingStatus',
      width: 90,
      render: (v: string) => (
        <Tag icon={statusIcon(v)} color={statusColor(v)} style={{ fontSize: 11, fontWeight: 600 }}>{v}</Tag>
      ),
    },
    {
      title: 'Ent. Dr',
      dataIndex: 'enteredDr',
      width: 115,
      align: 'right' as const,
      render: (v: number) => v ? <Text strong style={{ fontSize: 11, color: REDWOOD.info }}>{formatAmount(v)}</Text> : <Text style={{ color: REDWOOD.neutral600, fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Ent. Cr',
      dataIndex: 'enteredCr',
      width: 115,
      align: 'right' as const,
      render: (v: number) => v ? <Text strong style={{ fontSize: 11, color: REDWOOD.error }}>{formatAmount(v)}</Text> : <Text style={{ color: REDWOOD.neutral600, fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Acc. Dr',
      dataIndex: 'accountedDr',
      width: 115,
      align: 'right' as const,
      render: (v: number) => v ? <Text style={{ fontSize: 11, color: REDWOOD.info }}>{formatAmount(v)}</Text> : <Text style={{ color: REDWOOD.neutral600, fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Acc. Cr',
      dataIndex: 'accountedCr',
      width: 115,
      align: 'right' as const,
      render: (v: number) => v ? <Text style={{ fontSize: 11, color: REDWOOD.error }}>{formatAmount(v)}</Text> : <Text style={{ color: REDWOOD.neutral600, fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Currency',
      dataIndex: 'currencyCode',
      width: 70,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Period',
      dataIndex: 'periodName',
      width: 80,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: 'Business Unit',
      dataIndex: 'businessUnit',
      width: 160,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: 'Ledger',
      dataIndex: 'ledgerName',
      width: 120,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }} ellipsis>{v}</Text>,
    },
    {
      title: 'Module',
      dataIndex: 'moduleName',
      width: 65,
      render: (v: string) => <Tag color="blue" style={{ fontSize: 10 }}>{v}</Tag>,
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 24px', background: REDWOOD.neutral100, minHeight: '100vh' }}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ap')} size="small" />
          <div>
            <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>
              <AccountBookOutlined style={{ marginRight: 8 }} />
              Manage Subledger Journals
            </Title>
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
              Review and query subledger accounting entries from SLA tables
            </Text>
          </div>
        </Space>
        <Tooltip title="View last API call details">
          <Button
            icon={<ApiOutlined />}
            onClick={() => { setPageApiTestUrl(lastCalledUrl || ''); setPageApiModalVisible(true); }}
            style={{
              color: lastApiError ? REDWOOD.error : lastCalledUrl ? REDWOOD.success : REDWOOD.neutral600,
              borderColor: lastApiError ? REDWOOD.error : lastCalledUrl ? REDWOOD.success : REDWOOD.neutral200,
            }}
          >
            API
            {lastApiStatus && (
              <Tag
                color={lastApiStatus < 300 ? 'success' : 'error'}
                style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
              >
                {lastApiStatus}
              </Tag>
            )}
          </Button>
        </Tooltip>
      </div>

      {/* ── Summary KPI strip ─────────────────────────────────────────────── */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { label: 'Draft',    value: stats.draft,  color: REDWOOD.warning, icon: <ClockCircleOutlined /> },
          { label: 'Posted',   value: stats.posted, color: REDWOOD.success, icon: <CheckCircleOutlined /> },
          { label: 'Error',    value: stats.error,  color: REDWOOD.error,   icon: <WarningOutlined /> },
        ].map(s => (
          <Col key={s.label} xs={8} md={4}>
            <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
              <Statistic
                title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{s.label}</Text>}
                value={s.value}
                styles={{ content: { fontSize: 20, fontWeight: 700, color: s.color } }}
                prefix={s.icon}
              />
            </Card>
          </Col>
        ))}
        {activeTab === 'lines' && stats.totalDr > 0 && (
          <>
            <Col xs={12} md={5}>
              <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
                <Statistic
                  title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Total Debit</Text>}
                  value={stats.totalDr}
                  precision={2}
                  valueStyle={{ fontSize: 16, fontWeight: 700, color: REDWOOD.info }}
                  prefix={<DollarOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} md={5}>
              <Card size="small" styles={{ body: { padding: '10px 14px' } }}>
                <Statistic
                  title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Total Credit</Text>}
                  value={stats.totalCr}
                  precision={2}
                  valueStyle={{ fontSize: 16, fontWeight: 700, color: REDWOOD.error }}
                  prefix={<DollarOutlined />}
                />
              </Card>
            </Col>
          </>
        )}
      </Row>

      {/* ── Main tabs ────────────────────────────────────────────────────── */}
      <Card styles={{ body: { padding: 0 } }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          style={{ padding: '0 16px' }}
          items={[
            // ═══════════════════════════════════════════════════════════════
            // TAB 1 — Journal Entries (headers)
            // ═══════════════════════════════════════════════════════════════
            {
              key: 'headers',
              label: (
                <Space>
                  <FileSearchOutlined />
                  Journal Entries
                  {headerTotal > 0 && <Badge count={headerTotal} color={REDWOOD.info} />}
                </Space>
              ),
              children: (
                <div style={{ padding: '0 0 16px' }}>

                  {/* Search panel */}
                  <div style={{ background: REDWOOD.neutral100, padding: '14px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}`, marginBottom: 0 }}>
                    <Form
                      form={headerForm}
                      layout="vertical"
                      size="small"
                      onFinish={fetchHeaders}
                      initialValues={{ status: '', moduleName: '' }}
                    >
                      <Row gutter={[12, 0]} align="bottom">
                        <Col xs={24} sm={12} md={6}>
                          <Form.Item
                            label="Accounting Date"
                            name="dateRange"
                            style={{ marginBottom: 8 }}
                          >
                            <RangePicker
                              format="DD-MMM-YYYY"
                              style={{ width: '100%' }}
                              placeholder={['From', 'To']}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Status" name="status" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="DRAFT">Draft</Option>
                              <Option value="POSTED">Posted</Option>
                              <Option value="ERROR">Error</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Module" name="moduleName" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="AP">AP</Option>
                              <Option value="AR">AR</Option>
                              <Option value="GL">GL</Option>
                              <Option value="PC">PC</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label="Source Table" name="sourceTable" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="AP_INVOICES">AP_INVOICES</Option>
                              <Option value="AP_PAYMENTS">AP_PAYMENTS</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label="Event Type" name="eventType" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="AP_INVOICE_CREATION">AP Invoice Creation</Option>
                              <Option value="AP_INVOICE_PAYMENT">AP Invoice Payment</Option>
                              <Option value="INVOICE_VALIDATED">Invoice Validated</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Period" name="period" style={{ marginBottom: 8 }}>
                            <Input placeholder="e.g. Mar-26" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label="Transaction #" name="sourceNumber" style={{ marginBottom: 8 }}>
                            <Input placeholder="Invoice / Payment #" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3} style={{ marginBottom: 8 }}>
                          <Space>
                            <Button
                              type="primary"
                              htmlType="submit"
                              icon={<SearchOutlined />}
                              loading={headerLoading}
                              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                            >
                              Search
                            </Button>
                            <Button
                              icon={<ReloadOutlined />}
                              onClick={() => { headerForm.resetFields(); setHeaders([]); setHeaderTotal(0); }}
                            >
                              Reset
                            </Button>
                          </Space>
                        </Col>
                      </Row>
                    </Form>
                  </div>

                  <Divider style={{ margin: 0 }} />

                  {/* Results info + search */}
                  {headerTotal > 0 && (
                    <div style={{ padding: '8px 16px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Space style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                          {headerTotal} journal entr{headerTotal === 1 ? 'y' : 'ies'} found
                        </Text>
                        <Tag color="warning">{stats.draft} Draft</Tag>
                        <Tag color="success">{stats.posted} Posted</Tag>
                        {stats.error > 0 && <Tag color="error">{stats.error} Error</Tag>}
                      </Space>
                      <Button
                        size="small"
                        icon={<SwapOutlined />}
                        loading={glCountsLoading}
                        onClick={handleBulkGLCompare}
                        style={{ color: REDWOOD.info, borderColor: REDWOOD.info, fontWeight: 600 }}
                      >
                        Compare with GL
                      </Button>
                      <Input
                        allowClear
                        prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                        placeholder="Filter results…"
                        size="small"
                        style={{ width: 240 }}
                        value={headerSearch}
                        onChange={e => setHeaderSearch(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Headers table */}
                  <Table
                    dataSource={headers.filter(h => {
                      if (!headerSearch) return true;
                      const q = headerSearch.toLowerCase();
                      return (
                        (h.sourceNumber  || '').toLowerCase().includes(q) ||
                        (h.description   || '').toLowerCase().includes(q) ||
                        (h.moduleName    || '').toLowerCase().includes(q) ||
                        (h.periodName    || '').toLowerCase().includes(q) ||
                        (h.ledgerName    || '').toLowerCase().includes(q) ||
                        (h.accountingStatus || '').toLowerCase().includes(q) ||
                        (h.glBatchName   || '').toLowerCase().includes(q) ||
                        (h.createdBy     || '').toLowerCase().includes(q) ||
                        (h.eventTypeCode || '').toLowerCase().includes(q) ||
                        String(h.headerId).includes(q)
                      );
                    })}
                    columns={headerColumns}
                    loading={headerLoading}
                    size="small"
                    bordered
                    scroll={{ x: 1400 }}
                    pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} entries` }}
                    style={{ fontSize: 12 }}
                    locale={{ emptyText: 'Search to load subledger journal entries' }}
                    rowClassName={(r) => {
                      const glCount = glLineCounts[r.headerId];
                      if (glCount !== undefined && glCount !== -1 && glCount !== r.lineCount) return 'ant-table-row-gl-mismatch';
                      if (r.accountingStatus === 'ERROR') return 'ant-table-row-error';
                      return '';
                    }}
                    onRow={(r) => {
                      const glCount = glLineCounts[r.headerId];
                      const hasMismatch = glCount !== undefined && glCount !== -1 && glCount !== r.lineCount;
                      return hasMismatch ? { style: { background: '#fff2f0' } } : {};
                    }}
                    expandable={{
                      expandedRowRender: (r: SlaHeader) => (
                        <div style={{ padding: '8px 16px', background: REDWOOD.neutral100 }}>
                          <Row gutter={24}>
                            <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>Header ID:</Text> <Text code>{r.headerId}</Text></Col>
                            <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>Source ID:</Text> <Text code>{r.sourceId}</Text></Col>
                            <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>Source Type:</Text> <Text style={{ fontSize: 11 }}>{r.sourceType}</Text></Col>
                            <Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>Ledger:</Text> <Text style={{ fontSize: 11 }}>{r.ledgerName}</Text></Col>
                            {r.glBatchId && <><Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>GL Batch ID:</Text> <Text code>{r.glBatchId}</Text></Col><Col span={6}><Text type="secondary" style={{ fontSize: 11 }}>GL Header ID:</Text> <Text code>{r.glHeaderId}</Text></Col><Col span={12}><Text type="secondary" style={{ fontSize: 11 }}>GL Batch Name:</Text> <Text style={{ fontSize: 11 }}>{r.glBatchName}</Text></Col></>}
                            {r.postedDate && <Col span={12}><Text type="secondary" style={{ fontSize: 11 }}>Posted:</Text> <Text style={{ fontSize: 11 }}>{r.postedDate} by {r.postedBy}</Text></Col>}
                            <Col span={12}><Text type="secondary" style={{ fontSize: 11 }}>Created:</Text> <Text style={{ fontSize: 11 }}>{r.creationDate} by {r.createdBy}</Text></Col>
                          </Row>
                        </div>
                      ),
                    }}
                    summary={(data) => {
                      if (data.length === 0) return null;
                      return (
                        <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
                          <Table.Summary.Cell index={0} colSpan={6}>
                            <Text strong>Total: {data.length} entries</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="center">
                            <Badge count={data.reduce((s, r) => s + (r.lineCount || 0), 0)} color={REDWOOD.info} />
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={7} colSpan={5} />
                        </Table.Summary.Row>
                      );
                    }}
                  />
                </div>
              ),
            },

            // ═══════════════════════════════════════════════════════════════
            // TAB 2 — Journal Entry Lines
            // ═══════════════════════════════════════════════════════════════
            {
              key: 'lines',
              label: (
                <Space>
                  <UnorderedListOutlined />
                  SLA Lines
                  {lineTotal > 0 && <Badge count={lineTotal} color={REDWOOD.info} />}
                </Space>
              ),
              children: (
                <div style={{ padding: '0 0 16px' }}>

                  {/* Search panel */}
                  <div style={{ background: REDWOOD.neutral100, padding: '14px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                    <Form
                      form={lineForm}
                      layout="vertical"
                      size="small"
                      onFinish={fetchLines}
                      initialValues={{ status: '', moduleName: '' }}
                    >
                      <Row gutter={[12, 0]} align="bottom">
                        <Col xs={24} sm={12} md={6}>
                          <Form.Item
                            label="Accounting Date"
                            name="dateRange"
                            style={{ marginBottom: 8 }}
                          >
                            <RangePicker
                              format="DD-MMM-YYYY"
                              style={{ width: '100%' }}
                              placeholder={['From', 'To']}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Status" name="status" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="DRAFT">Draft</Option>
                              <Option value="POSTED">Posted</Option>
                              <Option value="ERROR">Error</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Module" name="moduleName" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="AP">AP</Option>
                              <Option value="AR">AR</Option>
                              <Option value="GL">GL</Option>
                              <Option value="PC">PC</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Line Type" name="lineType" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="DR">Debit (DR)</Option>
                              <Option value="CR">Credit (CR)</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label="Accounting Class" name="acctClass" style={{ marginBottom: 8 }}>
                            <Select allowClear placeholder="All">
                              <Option value="">All</Option>
                              <Option value="EXPENSE">Expense</Option>
                              <Option value="LIABILITY">Liability</Option>
                              <Option value="TAX">Tax</Option>
                              <Option value="PREPAYMENT">Prepayment</Option>
                              <Option value="ASSET">Asset</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3}>
                          <Form.Item label="Period" name="period" style={{ marginBottom: 8 }}>
                            <Input placeholder="e.g. Mar-26" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label="Account Combination" name="account" style={{ marginBottom: 8 }}>
                            <Input placeholder="e.g. 01-100-7010-..." />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label="Transaction #" name="sourceNumber" style={{ marginBottom: 8 }}>
                            <Input placeholder="Invoice / Payment #" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={3} style={{ marginBottom: 8 }}>
                          <Space>
                            <Button
                              type="primary"
                              htmlType="submit"
                              icon={<SearchOutlined />}
                              loading={lineLoading}
                              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                            >
                              Search
                            </Button>
                            <Button
                              icon={<ReloadOutlined />}
                              onClick={() => { lineForm.resetFields(); setLines([]); setLineTotal(0); }}
                            >
                              Reset
                            </Button>
                          </Space>
                        </Col>
                      </Row>
                    </Form>
                  </div>

                  <Divider style={{ margin: 0 }} />

                  {/* Results info + totals + search */}
                  {lineTotal > 0 && (
                    <div style={{ padding: '8px 16px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Space wrap style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                          {lineTotal} line{lineTotal === 1 ? '' : 's'} found
                        </Text>
                        <Divider type="vertical" />
                        <Text style={{ fontSize: 12 }}>
                          Total DR: <Text strong style={{ color: REDWOOD.info }}>{formatAmount(stats.totalDr)}</Text>
                        </Text>
                        <Text style={{ fontSize: 12 }}>
                          Total CR: <Text strong style={{ color: REDWOOD.error }}>{formatAmount(stats.totalCr)}</Text>
                        </Text>
                        {Math.abs(stats.totalDr - stats.totalCr) < 0.01 && stats.totalDr > 0 && (
                          <Tag color="success" icon={<CheckCircleOutlined />}>Balanced</Tag>
                        )}
                      </Space>
                      <Input
                        allowClear
                        prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                        placeholder="Filter results…"
                        size="small"
                        style={{ width: 240 }}
                        value={lineSearch}
                        onChange={e => setLineSearch(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Lines table */}
                  <Table
                    dataSource={lines.filter(l => {
                      if (!lineSearch) return true;
                      const q = lineSearch.toLowerCase();
                      return (
                        (l.sourceNumber       || '').toLowerCase().includes(q) ||
                        (l.accountCombination || '').toLowerCase().includes(q) ||
                        (l.accountingClass    || '').toLowerCase().includes(q) ||
                        (l.description        || '').toLowerCase().includes(q) ||
                        (l.moduleName         || '').toLowerCase().includes(q) ||
                        (l.accountingStatus   || '').toLowerCase().includes(q) ||
                        (l.lineType           || '').toLowerCase().includes(q) ||
                        (l.businessUnit       || '').toLowerCase().includes(q) ||
                        ((l as any).accountDescription || '').toLowerCase().includes(q)
                      );
                    })}
                    columns={lineColumns}
                    loading={lineLoading}
                    size="small"
                    bordered
                    scroll={{ x: 1500 }}
                    pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} lines` }}
                    locale={{ emptyText: 'Search to load subledger accounting lines' }}
                    summary={(data) => {
                      if (data.length === 0) return null;
                      const totalDr = data.reduce((s, r) => s + (r.enteredDr || 0), 0);
                      const totalCr = data.reduce((s, r) => s + (r.enteredCr || 0), 0);
                      return (
                        <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
                          <Table.Summary.Cell index={0} colSpan={3}>
                            <Text strong>Total: {data.length} lines</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} colSpan={3} />
                          <Table.Summary.Cell index={6} align="right">
                            <Text strong style={{ color: REDWOOD.info }}>{formatAmount(totalDr)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="right">
                            <Text strong style={{ color: REDWOOD.error }}>{formatAmount(totalCr)}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={8} colSpan={4} />
                        </Table.Summary.Row>
                      );
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Page API Inspector Modal ─────────────────────────────────────── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span style={{ fontWeight: 600 }}>SLA Journals — API Inspector</span></Space>}
        open={pageApiModalVisible}
        onCancel={() => setPageApiModalVisible(false)}
        footer={<Button onClick={() => setPageApiModalVisible(false)}>Close</Button>}
        width={820}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Last call summary */}
          {lastCalledUrl && (
            <div style={{ padding: 12, background: lastApiError ? '#fff2f0' : '#f6ffed', border: `1px solid ${lastApiError ? '#ffccc7' : '#b7eb8f'}`, borderRadius: 6 }}>
              <Row justify="space-between" align="middle" style={{ marginBottom: 6 }}>
                <Space>
                  <Tag color="blue">GET</Tag>
                  <Text strong style={{ fontSize: 12 }}>Last Called URL</Text>
                  {lastApiStatus && <Tag color={lastApiStatus < 300 ? 'success' : 'error'}>{lastApiStatus}</Tag>}
                  {lastApiError && <Tag color="error" icon={<WarningOutlined />}>Error</Tag>}
                </Space>
                <Button
                  size="small"
                  icon={pageApiCopied ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={() => { navigator.clipboard.writeText(lastCalledUrl); setPageApiCopied(true); setTimeout(() => setPageApiCopied(false), 2000); }}
                />
              </Row>
              <code style={{ display: 'block', background: '#f5f5f5', padding: '6px 10px', borderRadius: 4, fontSize: 11, wordBreak: 'break-all' }}>
                {lastCalledUrl}
              </code>
              {lastApiError && (
                <div style={{ marginTop: 8 }}>
                  <Text type="danger" style={{ fontSize: 12 }}><WarningOutlined /> {lastApiError}</Text>
                </div>
              )}
            </div>
          )}

          {/* Raw response */}
          {lastApiRaw && (
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Raw Response {lastApiStatus && `(HTTP ${lastApiStatus})`}:
              </Text>
              <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '10px 12px', maxHeight: 280, overflow: 'auto' }}>
                <pre style={{ color: '#d4d4d4', fontSize: 11, margin: 0 }}>
                  {JSON.stringify(lastApiRaw, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Test / re-run section */}
          <div style={{ padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Test a URL</Text>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input
                value={pageApiTestUrl}
                onChange={e => setPageApiTestUrl(e.target.value)}
                placeholder={`${APEX_DB_CONFIG.baseUrl}/sla/journals?limit=500`}
                style={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <Button
                type="primary"
                icon={<ApiOutlined />}
                loading={pageApiTesting}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info, whiteSpace: 'nowrap' }}
                onClick={async () => {
                  if (!pageApiTestUrl) return;
                  setPageApiTesting(true);
                  setPageApiTestResult(null);
                  setPageApiTestError(null);
                  try {
                    const r = await fetch(pageApiTestUrl, { headers: { Accept: 'application/json' } });
                    const txt = await r.text();
                    let json: any;
                    try { json = JSON.parse(txt); } catch { json = txt; }
                    setPageApiTestResult({ status: r.status, body: json });
                  } catch (e: any) {
                    setPageApiTestError(e?.message || 'Request failed');
                  } finally {
                    setPageApiTesting(false);
                  }
                }}
              >
                Test
              </Button>
            </div>
            {pageApiTestError && (
              <Text type="danger" style={{ fontSize: 12 }}>{pageApiTestError}</Text>
            )}
            {pageApiTestResult && (
              <div style={{ background: '#1e1e1e', borderRadius: 4, padding: '8px 10px', maxHeight: 300, overflow: 'auto' }}>
                <Text strong style={{ color: '#fff', fontSize: 11, display: 'block', marginBottom: 4 }}>
                  Response (HTTP {pageApiTestResult.status}):
                </Text>
                <pre style={{ color: '#d4d4d4', fontSize: 11, margin: 0 }}>
                  {JSON.stringify(pageApiTestResult.body, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {!lastCalledUrl && (
            <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
              No API call made yet — search for journal entries to populate.
            </Text>
          )}
        </div>
      </Modal>

      {/* ── GL Journal Entry Modal ─────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <AccountBookOutlined style={{ color: '#C74634' }} />
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              Accounting Journal — {slaModalRecord?.sourceNumber || glJournalData?.journalName || 'Loading…'}
            </span>
            {slaModalRecord?.accountingStatus && (
              <Tag color={statusColor(slaModalRecord.accountingStatus)} icon={statusIcon(slaModalRecord.accountingStatus)}>
                {slaModalRecord.accountingStatus}
              </Tag>
            )}
          </Space>
        }
        open={glJournalModalVisible}
        onCancel={() => { setGlJournalModalVisible(false); setGlJournalData(null); setGlJournalLines([]); setSlaModalLines([]); setSlaModalRecord(null); }}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Tooltip title="View API details for this request">
              <Button
                icon={<ApiOutlined />}
                onClick={() => setGlApiModalVisible(true)}
                style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
              >
                API Info
              </Button>
            </Tooltip>
            <Button onClick={() => setGlJournalModalVisible(false)}>Close</Button>
          </Space>
        }
        width={1200}
        style={{ top: 16 }}
        styles={{ body: { padding: 0, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        {glJournalLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: REDWOOD.neutral600 }}>Loading accounting journals…</div>
          </div>
        ) : (slaModalRecord || glJournalData) ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── SLA Header info ───────────────────────────────────────── */}
            {slaModalRecord && (
              <Card
                size="small"
                style={{ borderRadius: 6 }}
                styles={{ header: { background: '#fff7e6', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #ffd591' } }}
                title={<Space><Tag color="orange">SLA</Tag><span>Subledger Header</span></Space>}
              >
                <Descriptions size="small" column={3} bordered styles={{ label: { fontWeight: 500, width: 130, fontSize: 12 }, content: { fontSize: 12 } }}>
                  <Descriptions.Item label="Source #">{slaModalRecord.sourceNumber || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Event Type">{slaModalRecord.eventTypeCode || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Period">{slaModalRecord.periodName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Accounting Date">{slaModalRecord.accountingDate || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Ledger">{slaModalRecord.ledgerName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Currency">{slaModalRecord.currencyCode || '—'}</Descriptions.Item>
                  <Descriptions.Item label="BU">{slaModalRecord.businessUnit || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <Tag color={statusColor(slaModalRecord.accountingStatus)} icon={statusIcon(slaModalRecord.accountingStatus)}>
                      {slaModalRecord.accountingStatus}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="SLA Header ID"><span style={{ fontFamily: 'monospace' }}>{slaModalRecord.headerId}</span></Descriptions.Item>
                </Descriptions>
              </Card>
            )}

            {/* ── SLA Lines ─────────────────────────────────────────────── */}
            <Card
              size="small"
              style={{ borderRadius: 6 }}
              styles={{ header: { background: '#fff7e6', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #ffd591' } }}
              title={<Space><Tag color="orange">SLA</Tag><span>Subledger Lines ({slaModalLines.length})</span></Space>}
            >
              {slaModalLines.length > 0 ? (
                <Table
                  dataSource={slaModalLines}
                  size="small"
                  bordered
                  scroll={{ x: 1000 }}
                  pagination={false}
                  columns={[
                    { title: '#', dataIndex: 'lineNumber', key: 'lineNumber', width: 45 },
                    { title: 'Class', dataIndex: 'accountingClass', key: 'accountingClass', width: 120 },
                    { title: 'Account', dataIndex: 'accountCombination', key: 'accountCombination', width: 180, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || '—'}</span> },
                    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true, render: (v: string) => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
                    { title: 'CCY', dataIndex: 'currencyCode', key: 'currencyCode', width: 60 },
                    { title: 'Entered Dr', dataIndex: 'enteredDr', key: 'enteredDr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? <span style={{ color: REDWOOD.info, fontWeight: 600 }}>{formatAmount(v)}</span> : '—' },
                    { title: 'Entered Cr', dataIndex: 'enteredCr', key: 'enteredCr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? <span style={{ color: REDWOOD.error, fontWeight: 600 }}>{formatAmount(v)}</span> : '—' },
                    { title: 'Accounted Dr', dataIndex: 'accountedDr', key: 'accountedDr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? formatAmount(v) : '—' },
                    { title: 'Accounted Cr', dataIndex: 'accountedCr', key: 'accountedCr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? formatAmount(v) : '—' },
                  ]}
                  summary={(data) => {
                    const totDr = data.reduce((s, r) => s + (r.enteredDr || 0), 0);
                    const totCr = data.reduce((s, r) => s + (r.enteredCr || 0), 0);
                    const balanced = Math.abs(totDr - totCr) < 0.01;
                    return (
                      <Table.Summary.Row style={{ background: balanced ? '#f6ffed' : '#fff2f0' }}>
                        <Table.Summary.Cell index={0} colSpan={5}>
                          <span style={{ fontWeight: 700 }}>{balanced ? '✓ Balanced' : '⚠ Out of Balance'}</span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right"><span style={{ fontWeight: 700, color: REDWOOD.info }}>{formatAmount(totDr)}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right"><span style={{ fontWeight: 700, color: REDWOOD.error }}>{formatAmount(totCr)}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={7} colSpan={2} />
                      </Table.Summary.Row>
                    );
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0', color: REDWOOD.neutral600 }}>No SLA lines found</div>
              )}
            </Card>

            {/* ── GL Header info ────────────────────────────────────────── */}
            {glJournalData && (
              <Card
                size="small"
                style={{ borderRadius: 6 }}
                styles={{ header: { background: '#e6f4ff', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #91caff' } }}
                title={<Space><Tag color="blue">GL</Tag><span>General Ledger Header</span></Space>}
              >
                <Descriptions size="small" column={3} bordered styles={{ label: { fontWeight: 500, width: 130, fontSize: 12 }, content: { fontSize: 12 } }}>
                  <Descriptions.Item label="Journal Name">{glJournalData.journalName || glJournalData.batchName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Batch Name">{glJournalData.batchName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Period">{glJournalData.periodName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Accounting Date">{glJournalData.effectiveDate || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Ledger">{glJournalData.ledgerName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Currency">{glJournalData.currencyCode || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Source">{glJournalData.source || 'Payables'}</Descriptions.Item>
                  <Descriptions.Item label="Category">{glJournalData.category || glJournalData.eventTypeCode || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <Tag color={glJournalData.statusMeaning === 'Posted' ? 'success' : 'warning'}>
                      {glJournalData.statusMeaning || glJournalData.postingStatus || '—'}
                    </Tag>
                  </Descriptions.Item>
                  {glJournalData.jeHeaderId && (
                    <Descriptions.Item label="GL Header ID">
                      <span style={{ fontFamily: 'monospace' }}>{glJournalData.jeHeaderId}</span>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Card>
            )}

            {/* ── GL Lines ──────────────────────────────────────────────── */}
            {slaModalRecord?.glHeaderId && (
              <Card
                size="small"
                style={{ borderRadius: 6 }}
                styles={{ header: { background: '#e6f4ff', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #91caff' } }}
                title={<Space><Tag color="blue">GL</Tag><span>General Ledger Lines ({glJournalLines.length})</span></Space>}
              >
                {glJournalLines.length > 0 ? (
                  <Table
                    dataSource={glJournalLines}
                    size="small"
                    bordered
                    scroll={{ x: 900 }}
                    pagination={false}
                    columns={[
                      { title: '#', dataIndex: 'lineNum', key: 'lineNum', width: 45 },
                      { title: 'Account', dataIndex: 'account', key: 'account', width: 180, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || '—'}</span> },
                      { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true, render: (v: string) => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
                      { title: 'CCY', dataIndex: 'currency', key: 'currency', width: 60 },
                      { title: 'Entered Dr', dataIndex: 'enteredDr', key: 'enteredDr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? <span style={{ color: REDWOOD.info, fontWeight: 600 }}>{formatAmount(v)}</span> : '—' },
                      { title: 'Entered Cr', dataIndex: 'enteredCr', key: 'enteredCr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? <span style={{ color: REDWOOD.error, fontWeight: 600 }}>{formatAmount(v)}</span> : '—' },
                      { title: 'Accounted Dr', dataIndex: 'accountedDr', key: 'accountedDr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? formatAmount(v) : '—' },
                      { title: 'Accounted Cr', dataIndex: 'accountedCr', key: 'accountedCr', width: 120, align: 'right' as const, render: (v: number) => v > 0 ? formatAmount(v) : '—' },
                    ]}
                    summary={(data) => {
                      const totDr = data.reduce((s, r) => s + (r.enteredDr || 0), 0);
                      const totCr = data.reduce((s, r) => s + (r.enteredCr || 0), 0);
                      const balanced = Math.abs(totDr - totCr) < 0.01;
                      return (
                        <Table.Summary.Row style={{ background: balanced ? '#f6ffed' : '#fff2f0' }}>
                          <Table.Summary.Cell index={0} colSpan={4}>
                            <span style={{ fontWeight: 700 }}>{balanced ? '✓ Balanced' : '⚠ Out of Balance'}</span>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={4} align="right"><span style={{ fontWeight: 700, color: REDWOOD.info }}>{formatAmount(totDr)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="right"><span style={{ fontWeight: 700, color: REDWOOD.error }}>{formatAmount(totCr)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} colSpan={2} />
                        </Table.Summary.Row>
                      );
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: REDWOOD.neutral600 }}>
                    {glLastError ? <Text type="danger">{glLastError}</Text> : 'No GL lines returned for this header ID'}
                  </div>
                )}
              </Card>
            )}

            {!slaModalRecord?.glHeaderId && (
              <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '10px 14px' }}>
                <Text style={{ color: REDWOOD.warning }}>No GL journal posted yet — SLA status is {slaModalRecord?.accountingStatus}</Text>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* ── SLA vs GL Compare Modal ──────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <DiffOutlined style={{ color: REDWOOD.info }} />
            <span style={{ fontWeight: 600 }}>Compare SLA Lines vs GL Lines</span>
            {compareHeader && (
              <Tag color="blue">{compareHeader.sourceNumber || `Header #${compareHeader.headerId}`}</Tag>
            )}
          </Space>
        }
        open={compareModalVisible}
        onCancel={() => setCompareModalVisible(false)}
        footer={<Button onClick={() => setCompareModalVisible(false)}>Close</Button>}
        width={1300}
        destroyOnHidden
      >
        <Spin spinning={compareLoading}>
          {compareError && (
            <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
              <Text type="danger"><WarningOutlined /> {compareError}</Text>
            </div>
          )}

          {!compareLoading && !compareError && (
            (() => {
              // Build comparison: match SLA lines to GL lines by account + dr/cr amounts
              const slaRows = compareSlaLines;
              const glRows  = compareGlLines;

              // For each SLA line, try to find a matching GL line
              const isDiff = (sla: any, gl: any) => {
                if (!gl) return true;
                const acctMatch  = (sla.accountCombination || '') === (gl.accountCombination || '');
                const drMatch    = Math.abs((sla.accountedDr || 0) - (gl.accountedDr || 0)) < 0.01;
                const crMatch    = Math.abs((sla.accountedCr || 0) - (gl.accountedCr || 0)) < 0.01;
                return !acctMatch || !drMatch || !crMatch;
              };

              // Create rows for side-by-side: zip by line index
              const maxLen = Math.max(slaRows.length, glRows.length);
              const rows = Array.from({ length: maxLen }, (_, i) => {
                const sla = slaRows[i] || null;
                const gl  = glRows[i]  || null;
                const diff = isDiff(sla, gl);
                return { key: i, sla, gl, diff };
              });

              const slaTotDr = slaRows.reduce((s, r) => s + (r.accountedDr || 0), 0);
              const slaTotCr = slaRows.reduce((s, r) => s + (r.accountedCr || 0), 0);
              const glTotDr  = glRows.reduce((s,  r) => s + (r.accountedDr  || 0), 0);
              const glTotCr  = glRows.reduce((s,  r) => s + (r.accountedCr  || 0), 0);
              const totalMatch = Math.abs(slaTotDr - glTotDr) < 0.01 && Math.abs(slaTotCr - glTotCr) < 0.01;
              const hasDiffs   = rows.some(r => r.diff);

              const cellStyle = (diff: boolean, side: 'sla' | 'gl'): React.CSSProperties => ({
                background: diff ? (side === 'sla' ? '#fff7e6' : '#fff2f0') : undefined,
                padding: '2px 4px',
              });

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Status banner */}
                  <div style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    background: hasDiffs ? '#fff2f0' : '#f6ffed',
                    border: `1px solid ${hasDiffs ? '#ffccc7' : '#b7eb8f'}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    {hasDiffs
                      ? <><WarningOutlined style={{ color: REDWOOD.error }} /><Text strong style={{ color: REDWOOD.error }}>Differences found — lines highlighted in orange (SLA) / red (GL)</Text></>
                      : <><CheckCircleOutlined style={{ color: REDWOOD.success }} /><Text strong style={{ color: REDWOOD.success }}>All lines match</Text></>
                    }
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: REDWOOD.neutral600 }}>
                      SLA: {slaRows.length} lines &nbsp;|&nbsp; GL: {glRows.length} lines
                      {!compareHeader?.glHeaderId && ' (no GL header linked)'}
                    </span>
                  </div>

                  {!compareHeader?.glHeaderId && (
                    <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '8px 14px' }}>
                      <Text style={{ color: REDWOOD.warning }}>This SLA entry has not been posted to GL yet — no GL lines to compare.</Text>
                    </div>
                  )}

                  {/* Side-by-side table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: REDWOOD.neutral100 }}>
                        <th style={{ width: 30, border: '1px solid #e5e5e5', padding: '6px 8px', textAlign: 'center' }}>#</th>
                        {/* SLA columns */}
                        <th colSpan={2} style={{ border: '1px solid #e5e5e5', padding: '6px 8px', background: '#fff7e6', textAlign: 'center' }}>
                          <Tag color="orange" style={{ fontWeight: 700 }}>SLA</Tag> Subledger Lines
                          <Badge count={slaRows.length} color={REDWOOD.warning} style={{ marginLeft: 6, fontSize: 10 }} />
                        </th>
                        <th style={{ width: 110, border: '1px solid #e5e5e5', padding: '6px 8px', background: '#fff7e6', textAlign: 'right' }}>Acc. Dr</th>
                        <th style={{ width: 110, border: '1px solid #e5e5e5', padding: '6px 8px', background: '#fff7e6', textAlign: 'right' }}>Acc. Cr</th>
                        {/* Divider */}
                        <th style={{ width: 24, border: '1px solid #e5e5e5', background: '#f0f0f0' }} />
                        {/* GL columns */}
                        <th colSpan={2} style={{ border: '1px solid #e5e5e5', padding: '6px 8px', background: '#e6f4ff', textAlign: 'center' }}>
                          <Tag color="blue" style={{ fontWeight: 700 }}>GL</Tag> General Ledger Lines
                          <Badge count={glRows.length} color={REDWOOD.info} style={{ marginLeft: 6, fontSize: 10 }} />
                        </th>
                        <th style={{ width: 110, border: '1px solid #e5e5e5', padding: '6px 8px', background: '#e6f4ff', textAlign: 'right' }}>Acc. Dr</th>
                        <th style={{ width: 110, border: '1px solid #e5e5e5', padding: '6px 8px', background: '#e6f4ff', textAlign: 'right' }}>Acc. Cr</th>
                      </tr>
                      <tr style={{ background: '#fafafa', fontSize: 10, color: REDWOOD.neutral600 }}>
                        <th style={{ border: '1px solid #e5e5e5' }} />
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'left' }}>Account</th>
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'left' }}>Class / Description</th>
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'right' }}>Accounted Dr</th>
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'right' }}>Accounted Cr</th>
                        <th style={{ border: '1px solid #e5e5e5', background: '#f0f0f0' }} />
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'left' }}>Account</th>
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'left' }}>Description</th>
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'right' }}>Accounted Dr</th>
                        <th style={{ border: '1px solid #e5e5e5', padding: '3px 8px', textAlign: 'right' }}>Accounted Cr</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ key, sla, gl, diff }) => (
                        <tr key={key} style={{ background: diff ? undefined : undefined }}>
                          <td style={{ border: '1px solid #e5e5e5', padding: '4px 8px', textAlign: 'center', color: REDWOOD.neutral600 }}>{key + 1}</td>
                          {/* SLA side */}
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff, 'sla') }}>
                            {sla ? <code style={{ fontSize: 10 }}>{sla.accountCombination || '—'}</code> : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff, 'sla'), maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sla ? <span title={sla.description}>{sla.accountingClass || ''}{sla.description ? ` · ${sla.description}` : ''}</span> : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff && Math.abs((sla?.accountedDr||0)-(gl?.accountedDr||0))>=0.01, 'sla'), textAlign: 'right' }}>
                            {sla?.accountedDr ? <span style={{ color: REDWOOD.info, fontWeight: 600 }}>{formatAmount(sla.accountedDr)}</span> : '—'}
                          </td>
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff && Math.abs((sla?.accountedCr||0)-(gl?.accountedCr||0))>=0.01, 'sla'), textAlign: 'right' }}>
                            {sla?.accountedCr ? <span style={{ color: REDWOOD.error, fontWeight: 600 }}>{formatAmount(sla.accountedCr)}</span> : '—'}
                          </td>
                          {/* Divider */}
                          <td style={{ border: '1px solid #e5e5e5', background: diff ? '#ffccc7' : '#d9f7be', textAlign: 'center', fontSize: 14 }}>
                            {diff ? '≠' : '='}
                          </td>
                          {/* GL side */}
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff, 'gl') }}>
                            {gl ? <code style={{ fontSize: 10 }}>{gl.accountCombination || '—'}</code> : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff, 'gl'), maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {gl ? <span title={gl.description}>{gl.description || '—'}</span> : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff && Math.abs((sla?.accountedDr||0)-(gl?.accountedDr||0))>=0.01, 'gl'), textAlign: 'right' }}>
                            {gl?.accountedDr ? <span style={{ color: REDWOOD.info, fontWeight: 600 }}>{formatAmount(gl.accountedDr)}</span> : '—'}
                          </td>
                          <td style={{ border: '1px solid #e5e5e5', ...cellStyle(diff && Math.abs((sla?.accountedCr||0)-(gl?.accountedCr||0))>=0.01, 'gl'), textAlign: 'right' }}>
                            {gl?.accountedCr ? <span style={{ color: REDWOOD.error, fontWeight: 600 }}>{formatAmount(gl.accountedCr)}</span> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: totalMatch ? '#f6ffed' : '#fff2f0' }}>
                        <td style={{ border: '1px solid #e5e5e5', padding: '5px 8px' }} colSpan={3}><Text strong>Total</Text></td>
                        <td style={{ border: '1px solid #e5e5e5', padding: '5px 8px', textAlign: 'right' }}><Text strong style={{ color: REDWOOD.info }}>{formatAmount(slaTotDr)}</Text></td>
                        <td style={{ border: '1px solid #e5e5e5', padding: '5px 8px', textAlign: 'right' }}><Text strong style={{ color: REDWOOD.error }}>{formatAmount(slaTotCr)}</Text></td>
                        <td style={{ border: '1px solid #e5e5e5', background: totalMatch ? '#b7eb8f' : '#ffccc7', textAlign: 'center' }}>{totalMatch ? '=' : '≠'}</td>
                        <td style={{ border: '1px solid #e5e5e5', padding: '5px 8px' }} colSpan={2}><Text strong>{glRows.length ? '' : 'No GL lines'}</Text></td>
                        <td style={{ border: '1px solid #e5e5e5', padding: '5px 8px', textAlign: 'right' }}><Text strong style={{ color: REDWOOD.info }}>{glRows.length ? formatAmount(glTotDr) : '—'}</Text></td>
                        <td style={{ border: '1px solid #e5e5e5', padding: '5px 8px', textAlign: 'right' }}><Text strong style={{ color: REDWOOD.error }}>{glRows.length ? formatAmount(glTotCr) : '—'}</Text></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()
          )}
        </Spin>
      </Modal>

      {/* ── Push Missing Lines Modal ────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <SendOutlined style={{ color: REDWOOD.warning }} />
            <span style={{ fontWeight: 600 }}>Push Missing Lines to GL</span>
            {pendingRecord && (
              <Tag color="orange">{pendingRecord.sourceNumber || `Header #${pendingRecord.headerId}`}</Tag>
            )}
          </Space>
        }
        open={pendingModalVisible}
        onCancel={() => { setPendingModalVisible(false); setPendingPostResult(null); }}
        footer={null}
        width={1100}
        destroyOnHidden
      >
        <Spin spinning={pendingModalLoading}>
          {!pendingModalLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Summary banner */}
              <div style={{
                padding: '8px 14px', borderRadius: 6,
                background: pendingMissingLines.length > 0 ? '#fffbe6' : '#f6ffed',
                border: `1px solid ${pendingMissingLines.length > 0 ? '#ffe58f' : '#b7eb8f'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                {pendingMissingLines.length > 0
                  ? <><WarningOutlined style={{ color: REDWOOD.warning }} /><Text strong style={{ color: '#ad8b00' }}>{pendingMissingLines.length} SLA line(s) not found in GL — review below before pushing</Text></>
                  : <><CheckCircleOutlined style={{ color: REDWOOD.success }} /><Text strong style={{ color: REDWOOD.success }}>All SLA lines already exist in GL — no action needed</Text></>
                }
                <span style={{ marginLeft: 'auto', fontSize: 12, color: REDWOOD.neutral600 }}>
                  SLA lines: {pendingMissingLines.length + pendingGlLines.length} &nbsp;|&nbsp; GL lines: {pendingGlLines.length}
                </span>
              </div>

              {/* Missing lines preview table */}
              {pendingMissingLines.length > 0 && (
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                    Lines to be pushed:
                  </Text>
                  <Table
                    dataSource={pendingMissingLines}
                    size="small"
                    bordered
                    scroll={{ x: 900 }}
                    pagination={false}
                    rowClassName={() => 'ant-table-row-warning'}
                    style={{ background: '#fffbe6' }}
                    columns={[
                      { title: '#', dataIndex: 'lineNumber', key: 'lineNumber', width: 45 },
                      { title: 'Type', dataIndex: 'lineType', key: 'lineType', width: 55,
                        render: (v: string) => <Tag color={v === 'DR' ? 'blue' : 'red'} style={{ fontSize: 11, fontWeight: 700 }}>{v}</Tag> },
                      { title: 'Class', dataIndex: 'accountingClass', key: 'accountingClass', width: 120 },
                      { title: 'Account', dataIndex: 'accountCombination', key: 'accountCombination', width: 180,
                        render: (v: string) => <code style={{ fontSize: 10 }}>{v || '—'}</code> },
                      { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
                        render: (v: string) => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
                      { title: 'CCY', dataIndex: 'currencyCode', key: 'currencyCode', width: 55 },
                      { title: 'Entered Dr', dataIndex: 'enteredDr', key: 'enteredDr', width: 115, align: 'right' as const,
                        render: (v: number) => v > 0 ? <span style={{ color: REDWOOD.info, fontWeight: 600 }}>{formatAmount(v)}</span> : '—' },
                      { title: 'Entered Cr', dataIndex: 'enteredCr', key: 'enteredCr', width: 115, align: 'right' as const,
                        render: (v: number) => v > 0 ? <span style={{ color: REDWOOD.error, fontWeight: 600 }}>{formatAmount(v)}</span> : '—' },
                      { title: 'Accounted Dr', dataIndex: 'accountedDr', key: 'accountedDr', width: 115, align: 'right' as const,
                        render: (v: number) => v > 0 ? formatAmount(v) : '—' },
                      { title: 'Accounted Cr', dataIndex: 'accountedCr', key: 'accountedCr', width: 115, align: 'right' as const,
                        render: (v: number) => v > 0 ? formatAmount(v) : '—' },
                    ]}
                    summary={(data) => {
                      const totDr = data.reduce((s, r) => s + (r.enteredDr || 0), 0);
                      const totCr = data.reduce((s, r) => s + (r.enteredCr || 0), 0);
                      return (
                        <Table.Summary.Row style={{ background: '#fff7e6', fontWeight: 700 }}>
                          <Table.Summary.Cell index={0} colSpan={6}><Text strong>Total ({data.length} lines)</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: REDWOOD.info }}>{formatAmount(totDr)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="right"><Text strong style={{ color: REDWOOD.error }}>{formatAmount(totCr)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={8} colSpan={2} />
                        </Table.Summary.Row>
                      );
                    }}
                  />
                </div>
              )}

              {/* Post result */}
              {pendingPostResult && (
                <div style={{
                  padding: '10px 14px', borderRadius: 6,
                  background: pendingPostResult.success ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${pendingPostResult.success ? '#b7eb8f' : '#ffccc7'}`,
                }}>
                  {pendingPostResult.success
                    ? <Space><CheckCircleOutlined style={{ color: REDWOOD.success }} /><Text strong style={{ color: REDWOOD.success }}>Posted successfully</Text>{pendingPostResult.batchId && <Text code>Batch {pendingPostResult.batchId}</Text>}{pendingPostResult.headerId && <Text code>Header {pendingPostResult.headerId}</Text>}</Space>
                    : <Space><WarningOutlined style={{ color: REDWOOD.error }} /><Text type="danger">Failed: {pendingPostResult.error}</Text></Space>
                  }
                </div>
              )}

              {/* API Inspector panel */}
              {pendingApiVisible && (
                <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Space>
                      <ApiOutlined style={{ color: '#69c0ff' }} />
                      <Text strong style={{ color: '#fff', fontSize: 13 }}>API Calls — Push Missing Lines</Text>
                    </Space>
                    <Button size="small" type="text" style={{ color: '#888' }} onClick={() => setPendingApiVisible(false)}>✕</Button>
                  </div>
                  {(() => {
                    const linesPayload = buildMissingLinesPayload();
                    const glHeaderId = pendingRecord?.glHeaderId;
                    const glBatchId  = pendingRecord?.glBatchId;
                    const previewCalls = linesPayload.length > 0 ? [
                      {
                        method: 'POST',
                        url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/${glHeaderId ?? ':headerId'}/linesaddmissing`,
                        description: `Add ${linesPayload.length} missing line(s) directly into existing GL header ${glHeaderId ?? '?'} — no new batch created`,
                        body: linesPayload,
                      },
                      {
                        method: 'PUT',
                        url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/${glBatchId ?? ':batchId'}/post`,
                        description: `Re-post batch ${glBatchId ?? '?'} so Oracle refreshes running totals & posting status`,
                        body: {},
                      },
                    ] : [];
                    const calls = pendingApiPayload?.calls ?? previewCalls;
                    return calls.map((call: any, i: number) => (
                      <div key={i} style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #333' }}>
                        <div style={{ background: '#16213e', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tag color={call.method === 'POST' ? 'green' : 'blue'} style={{ fontWeight: 700, margin: 0 }}>{call.method}</Tag>
                          <code style={{ color: '#69c0ff', fontSize: 11, flex: 1, wordBreak: 'break-all' }}>{call.url}</code>
                          <Button
                            size="small"
                            type="text"
                            icon={<CopyOutlined />}
                            style={{ color: '#888' }}
                            onClick={() => navigator.clipboard.writeText(call.url)}
                          />
                        </div>
                        {call.description && (
                          <div style={{ padding: '3px 10px', background: '#0d1117', color: '#888', fontSize: 10 }}>{call.description}</div>
                        )}
                        {(Array.isArray(call.body) ? call.body.length > 0 : Object.keys(call.body ?? {}).length > 0) && (
                          <div style={{ background: '#0d1117', padding: '8px 10px', maxHeight: 280, overflow: 'auto', position: 'relative' }}>
                            <div style={{ position: 'absolute', top: 4, right: 6, display: 'flex', gap: 4, zIndex: 1 }}>
                              <span style={{ color: '#555', fontSize: 10 }}>Request</span>
                              <Button size="small" type="text" icon={<CopyOutlined />} style={{ color: '#888' }}
                                onClick={() => navigator.clipboard.writeText(JSON.stringify(call.body, null, 2))} />
                            </div>
                            <pre style={{ color: '#d4d4d4', fontSize: 10, margin: 0, paddingTop: 16 }}>
                              {JSON.stringify(call.body, null, 2)}
                            </pre>
                          </div>
                        )}
                        {call.response && (
                          <div style={{ background: '#071107', padding: '8px 10px', maxHeight: 160, overflow: 'auto', position: 'relative' }}>
                            <div style={{ position: 'absolute', top: 4, right: 6, display: 'flex', gap: 4, zIndex: 1 }}>
                              <span style={{ color: '#555', fontSize: 10 }}>Response</span>
                              <Button size="small" type="text" icon={<CopyOutlined />} style={{ color: '#888' }}
                                onClick={() => navigator.clipboard.writeText(JSON.stringify(call.response, null, 2))} />
                            </div>
                            <pre style={{ color: call.response?.success === false ? '#ff7875' : '#95de64', fontSize: 10, margin: 0, paddingTop: 16 }}>
                              {JSON.stringify(call.response, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              )}

              {/* Footer buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                <Tooltip title="View API calls & JSON payload">
                  <Button
                    icon={<ApiOutlined />}
                    size="small"
                    onClick={() => setPendingApiVisible(v => !v)}
                    style={{
                      color: pendingApiVisible ? REDWOOD.info : REDWOOD.neutral600,
                      borderColor: pendingApiVisible ? REDWOOD.info : REDWOOD.neutral200,
                    }}
                  >
                    API
                  </Button>
                </Tooltip>
                <Space>
                  <Button onClick={() => { setPendingModalVisible(false); setPendingPostResult(null); setPendingApiVisible(false); }}>
                    Cancel
                  </Button>
                  {pendingMissingLines.length > 0 && !pendingPostResult?.success && (
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={pendingPostLoading}
                      style={{ background: REDWOOD.warning, borderColor: REDWOOD.warning }}
                      onClick={handlePushMissingLines}
                    >
                      Confirm & Push {pendingMissingLines.length} Line(s) to GL
                    </Button>
                  )}
                </Space>
              </div>

            </div>
          )}
        </Spin>
      </Modal>

      {/* ── GL Journal API Info Modal ─────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span style={{ fontWeight: 600 }}>GL Journal — API Details</span>
          </Space>
        }
        open={glApiModalVisible}
        onCancel={() => setGlApiModalVisible(false)}
        footer={<Button onClick={() => setGlApiModalVisible(false)}>Close</Button>}
        width={760}
        destroyOnHidden
        afterOpenChange={(open) => { if (open && glLastLinesUrl) setGlApiTestUrl(glLastLinesUrl); }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Last error banner */}
          {glLastError && (
            <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '10px 14px' }}>
              <Space>
                <WarningOutlined style={{ color: REDWOOD.error }} />
                <Text style={{ color: REDWOOD.error, fontWeight: 500 }}>Error: {glLastError}</Text>
              </Space>
            </div>
          )}

          {/* Header endpoint (info only — header data comes from SLA record) */}
          <div style={{ padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
            <Row align="middle" style={{ marginBottom: 8 }}>
              <Space>
                <Tag color="default">SLA</Tag>
                <Text strong>Journal Header</Text>
                <Tag color="blue">Loaded from SLA record — no separate API call</Tag>
              </Space>
            </Row>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Header fields (batch name, period, ledger, currency, status) are sourced directly from the SLA journal record already fetched on this page.
              To query GL headers independently, run:
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, fontSize: 11, flex: 1, wordBreak: 'break-all' }}>
                {`${APEX_DB_CONFIG.baseUrl}/gl/journals/headers?jeHeaderId={glHeaderId}`}
              </code>
              <Button size="small" icon={glCopiedUrl === `${APEX_DB_CONFIG.baseUrl}/gl/journals/headers?jeHeaderId={glHeaderId}` ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => { const u = `${APEX_DB_CONFIG.baseUrl}/gl/journals/headers?jeHeaderId={glHeaderId}`; navigator.clipboard.writeText(u); setGlCopiedUrl(u); setTimeout(() => setGlCopiedUrl(null), 2000); }} />
            </div>
          </div>

          {/* SLA Lines endpoint */}
          <div style={{ padding: 12, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6 }}>
            <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
              <Space>
                <Tag color="orange">GET</Tag>
                <Text strong>SLA Journal Lines</Text>
                {slaLastLinesUrl && <Tag color={slaLastLinesError ? 'error' : 'success'}>{slaLastLinesError ? 'Failed' : 'Success'}</Tag>}
              </Space>
              {slaLastLinesUrl && (
                <Button size="small" icon={glCopiedUrl === slaLastLinesUrl ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={() => { navigator.clipboard.writeText(slaLastLinesUrl!); setGlCopiedUrl(slaLastLinesUrl!); setTimeout(() => setGlCopiedUrl(null), 2000); }} />
              )}
            </Row>
            {slaLastLinesUrl ? (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>Last Called URL:</Text>
                <code style={{ display: 'block', background: slaLastLinesError ? '#fff2f0' : '#e8f5e9', padding: '4px 8px', borderRadius: 4, fontSize: 11, wordBreak: 'break-all', marginTop: 2 }}>
                  {slaLastLinesUrl}
                </code>
                {slaLastLinesError && (
                  <div style={{ marginTop: 6 }}>
                    <Text type="danger" style={{ fontSize: 12 }}><WarningOutlined /> {slaLastLinesError}</Text>
                  </div>
                )}
                {slaRawLinesData && (
                  <div style={{ marginTop: 8, background: '#1e1e1e', borderRadius: 4, padding: '8px 10px', maxHeight: 200, overflow: 'auto' }}>
                    <Text strong style={{ color: '#fff', fontSize: 11, display: 'block', marginBottom: 4 }}>Raw SLA Response:</Text>
                    <pre style={{ color: '#d4d4d4', fontSize: 10, margin: 0 }}>{JSON.stringify(slaRawLinesData, null, 2)}</pre>
                  </div>
                )}
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>No SLA request made yet — open a journal to populate.</Text>
            )}
          </div>

          {/* GL Lines endpoint */}
          {[
            { label: 'GL Journal Lines', url: glLastLinesUrl, template: `${APEX_DB_CONFIG.baseUrl}/gl/journals/{glHeaderId}/lines` },
          ].map((api, idx) => (
            <div key={idx} style={{ padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
              <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
                <Col>
                  <Space>
                    <Tag color="blue">GET</Tag>
                    <Text strong>{api.label}</Text>
                  </Space>
                </Col>
                {api.url && (
                  <Col>
                    <Tag color={glLastError ? 'red' : 'green'} icon={<CloudOutlined />}>
                      {glLastError ? 'Failed' : 'Success'}
                    </Tag>
                  </Col>
                )}
              </Row>

              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Template:</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, fontSize: 11, flex: 1, wordBreak: 'break-all' }}>
                    {api.template}
                  </code>
                  <Button size="small" icon={glCopiedUrl === api.template ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(api.template); setGlCopiedUrl(api.template); setTimeout(() => setGlCopiedUrl(null), 2000); }} />
                </div>
              </div>

              {api.url && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Last Called URL:</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <code style={{ background: '#e8f5e9', padding: '4px 8px', borderRadius: 4, fontSize: 11, flex: 1, wordBreak: 'break-all' }}>
                      {api.url}
                    </code>
                    <Button size="small" icon={glCopiedUrl === api.url ? <CheckOutlined /> : <CopyOutlined />}
                      onClick={() => { navigator.clipboard.writeText(api.url!); setGlCopiedUrl(api.url!); setTimeout(() => setGlCopiedUrl(null), 2000); }} />
                  </div>
                </div>
              )}

              {!api.url && (
                <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
                  No request made yet — open a GL Journal entry to populate.
                </Text>
              )}
            </div>
          ))}

          {/* Test section */}
          <div style={{ padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
            <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
              <Space>
                <Tag color="blue">GET</Tag>
                <Text strong>Test API Call</Text>
              </Space>
            </Row>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input
                value={glApiTestUrl}
                onChange={e => setGlApiTestUrl(e.target.value)}
                placeholder={`${APEX_DB_CONFIG.baseUrl}/gl/journals/{glHeaderId}/lines`}
                style={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <Button
                type="primary"
                icon={<ApiOutlined />}
                loading={glApiTesting}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info, whiteSpace: 'nowrap' }}
                onClick={async () => {
                  if (!glApiTestUrl) return;
                  setGlApiTesting(true);
                  setGlApiTestResult(null);
                  setGlApiTestError(null);
                  try {
                    const res = await fetch(glApiTestUrl, { headers: { 'Content-Type': 'application/json' } });
                    const json = await res.json();
                    setGlApiTestResult(json);
                  } catch (e: any) {
                    setGlApiTestError(e?.message || 'Request failed');
                  } finally {
                    setGlApiTesting(false);
                  }
                }}
              >
                Test
              </Button>
            </div>
            {glApiTestError && (
              <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4, padding: '6px 10px', marginBottom: 6 }}>
                <Text style={{ color: REDWOOD.error, fontSize: 12 }}>{glApiTestError}</Text>
              </div>
            )}
            {glApiTestResult && (
              <div style={{ background: '#1e1e1e', borderRadius: 4, padding: '8px 10px' }}>
                <Text strong style={{ color: '#fff', fontSize: 11, display: 'block', marginBottom: 4 }}>
                  Response ({Array.isArray(glApiTestResult?.items ?? glApiTestResult) ? (glApiTestResult?.items ?? glApiTestResult).length : '?'} items):
                </Text>
                <pre style={{ color: '#d4d4d4', fontSize: 11, margin: 0, overflow: 'auto', maxHeight: 300 }}>
                  {JSON.stringify(glApiTestResult, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Raw lines response for debugging */}
          {glRawLinesData && (
            <div style={{ padding: 12, background: '#1e1e1e', borderRadius: 6 }}>
              <Text strong style={{ color: '#fff', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Raw Lines API Response (last loaded in GL Journal modal):
              </Text>
              <pre style={{ color: '#d4d4d4', fontSize: 11, margin: 0, overflow: 'auto', maxHeight: 300 }}>
                {JSON.stringify(glRawLinesData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Post to GL Modal ──────────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <SendOutlined style={{ color: REDWOOD.primary }} />
            <span style={{ fontWeight: 600 }}>Post to GL — SLA Header #{postGLRecord?.headerId}</span>
            {postGLRecord && (
              <Tag color={postGLRecord.accountingStatus === 'DRAFT' ? 'warning' : 'success'}>
                {postGLRecord.accountingStatus}
              </Tag>
            )}
          </Space>
        }
        open={postGLModalVisible}
        onCancel={() => { setPostGLModalVisible(false); setPostGLRecord(null); setPostGLResult(null); }}
        footer={
          <Space>
            <Button onClick={() => { setPostGLModalVisible(false); setPostGLRecord(null); setPostGLResult(null); }}>
              Close
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={postGLLoading}
              disabled={postGLResult?.success === true || postGLFetchingLines || postGLLines.length === 0}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={handlePostToGL}
            >
              {postGLFetchingLines ? 'Loading Lines…' : `Post to GL (${postGLLines.length} lines)`}
            </Button>
          </Space>
        }
        width={780}
        destroyOnClose
      >
        {postGLRecord && (
          <div>
            {/* Endpoint — 4-step flow via central GL posting service */}
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block', marginBottom: 4, letterSpacing: 1 }}>
                GL POSTING FLOW (4 steps via central service)
              </Text>
              <div style={{ background: '#1e1e2e', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#cdd6f4', lineHeight: 2 }}>
                <div><span style={{ color: '#89b4fa', fontWeight: 700 }}>0.</span> <span style={{ color: '#f59e0b' }}>GET</span>  <code style={{ color: '#89d85d' }}>{GL_CREATE_URL.replace('/journals/create', '/gl/journals/check')}</code> — duplicate check</div>
                <div><span style={{ color: '#89b4fa', fontWeight: 700 }}>1.</span> <span style={{ color: '#f59e0b' }}>POST</span> <code style={{ color: '#89d85d' }}>{GL_CREATE_URL}</code> — create journal</div>
                <div><span style={{ color: '#89b4fa', fontWeight: 700 }}>2.</span> <span style={{ color: '#f59e0b' }}>PUT</span>  <code style={{ color: '#89d85d' }}>{GL_CREATE_URL.replace('/journals/create', '/gl/journals/:id/post')}</code> — validate &amp; post</div>
                <div><span style={{ color: '#89b4fa', fontWeight: 700 }}>3.</span> <span style={{ color: '#f59e0b' }}>POST</span> <code style={{ color: '#89d85d' }}>{SLA_POST_URL}</code> — stamp SLA</div>
              </div>
              <Text style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 4, display: 'block' }}>
                reference5 = <code style={{ fontSize: 10 }}>{eventTypeToRef5(postGLRecord?.eventTypeCode || '')}</code>
              </Text>
            </div>

            {/* Request Body */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text strong style={{ fontSize: 11, color: REDWOOD.neutral600, letterSpacing: 1 }}>
                  REQUEST BODY (JSON) — journals/create
                </Text>
                {postGLFetchingLines && <Spin size="small" />}
                {!postGLFetchingLines && (
                  <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                    {postGLLines.length} SLA lines mapped → GL lines
                  </Text>
                )}
              </div>
              {postGLFetchingLines ? (
                <div style={{ background: '#1e1e2e', borderRadius: 6, padding: 24, textAlign: 'center' }}>
                  <Spin />
                  <div style={{ color: '#aaa', marginTop: 8, fontSize: 12 }}>Fetching SLA lines…</div>
                </div>
              ) : (
                <div style={{ background: '#1e1e2e', borderRadius: 6, padding: '12px 14px', position: 'relative' }}>
                  <Button
                    size="small" icon={<CopyOutlined />}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: '1px solid #555', color: '#aaa' }}
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(buildGLPayload(postGLRecord, postGLLines, postGLLedger?.ledgerName, postGLLedger?.ledgerId), null, 2));
                      message.success('JSON body copied');
                    }}
                  />
                  <pre style={{ margin: 0, color: '#cdd6f4', fontSize: 11, lineHeight: 1.6, maxHeight: 340, overflowY: 'auto' }}>
                    {JSON.stringify(buildGLPayload(postGLRecord, postGLLines, postGLLedger?.ledgerName, postGLLedger?.ledgerId), null, 2)
                      .split('\n')
                      .map((line, i) => {
                        const colored = line
                          .replace(/"([^"]+)"(:\s)/g, (_, k, rest) =>
                            `<span style="color:#89b4fa">"${k}"</span>${rest}`)
                          .replace(/:\s*"([^"]*)"(,?)$/,
                            (_, v, c) => `: <span style="color:#a6e3a1">"${v}"</span>${c}`)
                          .replace(/:\s*(\d+(?:\.\d+)?)(,?)$/,
                            (_, v, c) => `: <span style="color:#fab387">${v}</span>${c}`)
                          .replace(/:\s*(null|true|false)(,?)$/,
                            (_, v, c) => `: <span style="color:#f38ba8">${v}</span>${c}`);
                        return <span key={i} dangerouslySetInnerHTML={{ __html: colored + '\n' }} />;
                      })}
                  </pre>
                </div>
              )}
            </div>

            {/* SLA Header info */}
            <Descriptions size="small" column={3} bordered
              labelStyle={{ fontWeight: 500, fontSize: 11, width: 120 }}
              contentStyle={{ fontSize: 11 }}
              style={{ marginBottom: 16 }}
            >
              <Descriptions.Item label="Transaction #">{postGLRecord.sourceNumber}</Descriptions.Item>
              <Descriptions.Item label="Period">{postGLRecord.periodName}</Descriptions.Item>
              <Descriptions.Item label="Accounting Date">{postGLRecord.accountingDate}</Descriptions.Item>
              <Descriptions.Item label="Module"><Tag color="blue" style={{ fontSize: 10 }}>{postGLRecord.moduleName}</Tag></Descriptions.Item>
              <Descriptions.Item label="Event Type">{postGLRecord.eventTypeCode}</Descriptions.Item>
              <Descriptions.Item label="Current Status">
                <Tag color={statusColor(postGLRecord.accountingStatus)} icon={statusIcon(postGLRecord.accountingStatus)} style={{ fontSize: 10 }}>
                  {postGLRecord.accountingStatus}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Ledger">{postGLRecord.ledgerName}</Descriptions.Item>
              <Descriptions.Item label="Lines">{postGLRecord.lineCount}</Descriptions.Item>
              <Descriptions.Item label="Description" span={1}>{postGLRecord.description}</Descriptions.Item>
            </Descriptions>

            {/* Result */}
            {postGLResult && (
              <div style={{
                background: postGLResult.success ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${postGLResult.success ? '#b7eb8f' : '#ffa39e'}`,
                borderRadius: 6,
                padding: '12px 16px',
              }}>
                <Text strong style={{ color: postGLResult.success ? REDWOOD.success : REDWOOD.error }}>
                  {postGLResult.success ? '✓ Posted to GL successfully' : '✗ Post failed'}
                </Text>
                <pre style={{ margin: '8px 0 0', fontSize: 12, color: '#333', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(postGLResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── AP Transaction Drill-Down Modal ───────────────────────────────── */}
      <Modal
        title={
          <Space>
            <FileTextOutlined style={{ color: REDWOOD.info }} />
            <span style={{ fontWeight: 600 }}>
              {apTxnType === 'payment' ? 'AP Payment' : 'AP Invoice'} — Transaction Detail
            </span>
          </Space>
        }
        open={apTxnModalVisible}
        onCancel={() => { setApTxnModalVisible(false); setApTxnData(null); setApTxnLines([]); }}
        footer={<Button onClick={() => { setApTxnModalVisible(false); setApTxnData(null); setApTxnLines([]); }}>Close</Button>}
        width={1000}
        destroyOnClose
      >
        {apTxnLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: REDWOOD.neutral600 }}>
              Loading {apTxnType === 'payment' ? 'payment' : 'invoice'} details…
            </div>
          </div>
        ) : apTxnData ? (
          apTxnType === 'payment' ? (
            <Descriptions size="small" column={2} bordered labelStyle={{ fontWeight: 500, width: 150 }}>
              <Descriptions.Item label="Payment Number">{apTxnData.paymentNumber || apTxnData.payment_number || '—'}</Descriptions.Item>
              <Descriptions.Item label="Payment Date">{apTxnData.paymentDate || apTxnData.payment_date || '—'}</Descriptions.Item>
              <Descriptions.Item label="Payee">{apTxnData.payee || apTxnData.payee_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color="success">{apTxnData.paymentStatus || apTxnData.payment_status || '—'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Payment Amount">{apTxnData.paymentAmount || apTxnData.payment_amount || '—'}</Descriptions.Item>
              <Descriptions.Item label="Currency">{apTxnData.paymentCurrency || apTxnData.currency_code || '—'}</Descriptions.Item>
              <Descriptions.Item label="Payment Method">{apTxnData.paymentMethod || apTxnData.payment_method || '—'}</Descriptions.Item>
              <Descriptions.Item label="Payment Document">{apTxnData.paymentDocument || apTxnData.payment_document || '—'}</Descriptions.Item>
              <Descriptions.Item label="Business Unit" span={2}>{apTxnData.businessUnit || apTxnData.business_unit || '—'}</Descriptions.Item>
              <Descriptions.Item label="Bank Account">{apTxnData.remitToAccountNumber || apTxnData.remit_to_account_number || '—'}</Descriptions.Item>
              <Descriptions.Item label="Legal Entity">{apTxnData.legalEntity || apTxnData.legal_entity || '—'}</Descriptions.Item>
            </Descriptions>
          ) : (
            <Tabs
              size="small"
              items={[
                {
                  key: 'header',
                  label: 'Header',
                  children: (
                    <Descriptions size="small" column={2} bordered labelStyle={{ fontWeight: 500, width: 150 }}>
                      <Descriptions.Item label="Invoice Number">{apTxnData.invoiceNumber || apTxnData.invoice_number || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Invoice Date">{apTxnData.invoiceDate || apTxnData.invoice_date || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Supplier">{apTxnData.supplierOrParty || apTxnData.supplier_name || apTxnData.party_name || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Supplier Site">{apTxnData.supplierSite || apTxnData.supplier_site || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Invoice Amount">{apTxnData.invoiceAmount || apTxnData.invoice_amount || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Currency">{apTxnData.invoiceCurrency || apTxnData.currency_code || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Validation Status">
                        <Tag color="blue">{apTxnData.validationStatus || apTxnData.validation_status || '—'}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Approval Status">
                        <Tag color="green">{apTxnData.approvalStatus || apTxnData.approval_status || 'N/A'}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Business Unit" span={2}>{apTxnData.businessUnit || apTxnData.business_unit || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Unpaid Amount">{apTxnData.unpaidAmount || apTxnData.unpaid_amount || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Invoice Type">{apTxnData.invoiceType || apTxnData.invoice_type || '—'}</Descriptions.Item>
                    </Descriptions>
                  ),
                },
                {
                  key: 'lines',
                  label: `Lines (${apTxnLines.length})`,
                  children: (
                    <Table
                      size="small"
                      dataSource={apTxnLines.map((l: any, i: number) => ({ ...l, key: l.line_id?.toString() || String(i) }))}
                      pagination={false}
                      scroll={{ x: 800 }}
                      locale={{ emptyText: 'No lines found' }}
                      columns={[
                        { title: '#', dataIndex: 'line_number', key: 'line_number', width: 50 },
                        { title: 'Type', dataIndex: 'line_type', key: 'line_type', width: 70 },
                        { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
                        {
                          title: 'Amount',
                          dataIndex: 'line_amount',
                          key: 'line_amount',
                          width: 120,
                          align: 'right' as const,
                          render: (v: number) => formatAmount(v),
                        },
                        { title: 'Quantity', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right' as const },
                        { title: 'Unit Price', dataIndex: 'unit_price', key: 'unit_price', width: 100, align: 'right' as const, render: (v: number) => formatAmount(v) },
                        { title: 'PO Number', dataIndex: 'purchase_order_number', key: 'po_number', width: 110, ellipsis: true },
                        { title: 'Tax Rate', dataIndex: 'tax_rate_code', key: 'tax_rate_code', width: 100 },
                      ]}
                    />
                  ),
                },
              ]}
            />
          )
        ) : null}
      </Modal>
    </div>
  );
};

export default ManageSLAJournals;
