import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Layout, Card, Typography, Table, Button, Space, Tag, Breadcrumb, Tabs,
  message, Input, Tooltip, Row, Col, Statistic, Modal, Alert, Select, Divider, Segmented, Dropdown,
} from 'antd';
import {
  HomeOutlined, ReloadOutlined, ThunderboltOutlined, SearchOutlined,
  FileExcelOutlined, FilePdfOutlined, ApiOutlined, DollarOutlined,
  TableOutlined, AuditOutlined, FileSearchOutlined, DownOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ColumnsType } from 'antd/es/table';
import FloatingMenu from '../../components/FloatingMenu';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';
import {
  getRevenueContracts, getRevenueSchedules, markRevenueScheduleAccounted,
} from '../../services/revenue.service';
import type { RevenueContract, RevenueSchedule } from '../../services/revenue.service';
import {
  createAccounting, checkAccountingExists, checkGLJournalExists,
  fetchLedgerByBusinessUnit, derivePeriodName,
} from '../../services/sla.service';
import type { SlaCreatePayload } from '../../services/sla.service';
import { postSlaToGL, buildGlJournalPayload, makeBatchName, getGlJournalLines } from '../../services/glPosting.service';
import type { GlPostingOptions } from '../../services/glPosting.service';
import { useAccountDescriptions } from '../../hooks/useAccountDescriptions';

// Resolve {slaHeaderId}/{batchId}/{batchName}/{glHeaderId} tokens in debug steps.
function resolveTokens<T>(value: T, ctx: Record<string, any>): T {
  if (typeof value === 'string') return value.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : '0')) as unknown as T;
  if (Array.isArray(value)) return value.map(v => resolveTokens(v, ctx)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value as Record<string, any>)) out[k] = resolveTokens((value as any)[k], ctx);
    return out as unknown as T;
  }
  return value;
}

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral500: '#8C8C8C',
};

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));

// ── Fiscal-year helpers (April–March) for the Revenue Matrix GL rollforward ────
const FY_START_MONTH = 3; // April (0-based)
const parseYMD = (s?: string | null): Date | null => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; };
// The fiscal year is named by its starting calendar year: Apr-2026..Mar-2027 → 2026.
const fyStartYearOf = (d: Date): number => (d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1);
const fyLabel = (startYear: number): string => `FY${String(startYear % 100).padStart(2, '0')}/${String((startYear + 1) % 100).padStart(2, '0')}`;

// ── Revenue-recognition accounting ────────────────────────────────────────────
// COA structure (9 segments): Company-Seg2-Seg3-Account-Seg5-Seg6-Seg7-Seg8-Seg9
// e.g. 01-00-00-2313111-0000-000-00-000-000  (natural account is the 4th segment)
const RR_DEBIT_ACCOUNT  = '2313111';   // Dr — unbilled/deferred revenue control
const RR_CREDIT_ACCOUNT = '4111101';   // Cr — revenue
const RR_SEGMENTS_BEFORE_ACCOUNT = ['00', '00'];                    // seg2, seg3 (between company & account)
const RR_REMAINING_SEGMENTS = ['0000', '000', '00', '000', '000']; // seg5..seg9 (after the account)
const RR_SEG5_DEFAULT = RR_REMAINING_SEGMENTS[0];                   // '0000' when no subaccount on the contract
const RR_SOURCE = 'AR_REVENUE_RECOGNIZATION';   // reference5

// Company segment derived from the business unit. Populated at runtime from the
// finBusinessUnitsLOV Company field (keyed by upper-cased BU name); falls back
// to '01' when the BU is unknown.
const BU_TO_COMPANY: Record<string, string> = {
  // 'AMS B2B GHANA': '01',
};
const DEFAULT_COMPANY = '01';
const companyFromBU = (bu?: string): string => {
  if (!bu) return DEFAULT_COMPANY;
  const hit = BU_TO_COMPANY[bu.trim()] ?? BU_TO_COMPANY[bu.trim().toUpperCase()];
  return hit ?? DEFAULT_COMPANY;
};
// The 5th segment (seg5) is the sub-account. It comes from the contract
// (RR_AR_REVENUE_CONTRACT); when the contract has no sub-account we fall back
// to the '0000' default. seg6..seg9 are unchanged.
const buildCombination = (company: string, account: string, subaccount?: string): string => {
  const seg5 = subaccount && String(subaccount).trim() ? String(subaccount).trim() : RR_SEG5_DEFAULT;
  const [, ...seg6to9] = RR_REMAINING_SEGMENTS;
  return [company, ...RR_SEGMENTS_BEFORE_ACCOUNT, account, seg5, ...seg6to9].join('-');
};

// Journal line description: period + period number + unit + tenant + trx.
const revLineDesc = (s: RevenueSchedule): string =>
  [s.periodName, s.scheduleNum, s.unit, s.tenant, s.trxNumber]
    .filter(v => v != null && String(v).trim() !== '')
    .join(' · ');

interface AcctLine {
  key: string;
  scheduleId: number;
  trxNumber: number | null;
  periodName: string;
  unit: string;
  tenant: string;
  lineType: 'DR' | 'CR';
  accountCombination: string;
  description: string;  // period · sched # · unit · tenant · trx
  debit: number;
  credit: number;
  reference1: string;   // trx_number
  reference2: string;   // schedule_id
  reference5: string;   // AR_REVENUE_RECOGNIZATION
}

const buildAcctLines = (rows: RevenueSchedule[]): AcctLine[] => {
  const lines: AcctLine[] = [];
  rows.forEach(s => {
    const company = companyFromBU(s.businessUnit);
    const amount = Number(s.amount) || 0;
    const base = {
      scheduleId: s.id, trxNumber: s.trxNumber, periodName: s.periodName, unit: s.unit, tenant: s.tenant,
      description: revLineDesc(s),
      reference1: String(s.trxNumber ?? ''), reference2: String(s.id), reference5: RR_SOURCE,
    };
    lines.push({ ...base, key: `${s.id}-DR`, lineType: 'DR', accountCombination: buildCombination(company, RR_DEBIT_ACCOUNT),  debit: amount, credit: 0 });
    lines.push({ ...base, key: `${s.id}-CR`, lineType: 'CR', accountCombination: buildCombination(company, RR_CREDIT_ACCOUNT, s.subaccount), debit: 0, credit: amount });
  });
  return lines;
};

// Parse the contract date strings (MM/DD/YYYY, YYYY-MM-DD, DD-MON-YYYY seen).
const parseFlexDate = (s: string): Date | null => {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);                 // YYYY-MM-DD
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                // MM/DD/YYYY
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  const d = new Date(t);                                        // DD-MON-YYYY etc.
  return isNaN(d.getTime()) ? null : d;
};

// Inclusive month count, matching CEIL(MONTHS_BETWEEN(end+1, start)) in the DB.
const contractMonths = (startStr: string, endStr: string): number | null => {
  const start = parseFlexDate(startStr);
  const end = parseFlexDate(endStr);
  if (!start || !end) return null;
  const endPlus = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const diff = (endPlus.getFullYear() - start.getFullYear()) * 12
             + (endPlus.getMonth() - start.getMonth())
             + (endPlus.getDate() - start.getDate()) / 31;
  return Math.max(1, Math.ceil(diff));
};

const RevenueRecognition: React.FC = () => {
  const { user } = useAuth();
  const loggedUser = user?.username || user?.name || 'REACTERP';

  const [tab, setTab] = useState('contracts');
  // Revenue Matrix GL — the fiscal year whose rollforward we show (start calendar year; default Apr-2026).
  const [glFyStartYear, setGlFyStartYear] = useState<number>(2026);

  // Contracts
  const [contracts, setContracts] = useState<RevenueContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [generating, setGenerating] = useState(false);
  const [contractSearch, setContractSearch] = useState('');

  // Generate-schedule debug modal
  const [genOpen, setGenOpen] = useState(false);
  const [genStatus, setGenStatus] = useState<number | null>(null);
  const [genResponse, setGenResponse] = useState<string>('');
  // 'monthly' = equal split by month (default); 'daily' = day-wise proration.
  const [genMode, setGenMode] = useState<'monthly' | 'daily'>('monthly');

  const GEN_URL = `${APEX_DB_CONFIG.baseUrl}/ar/revenue-schedules/${genMode === 'daily' ? 'generate-daily' : 'generate'}`;
  const genPayload = { contractIds: selectedKeys.map(Number), createdBy: loggedUser };

  // Schedules
  const [schedules, setSchedules] = useState<RevenueSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [scheduleSearch, setScheduleSearch] = useState('');

  // Post Revenue — accounting (standard SLA + GL journal flow, like Multiperiod)
  const [postPeriod, setPostPeriod]           = useState<string>();
  // Schedules carry no business unit, so allow the user to pick the Fusion BU
  // that drives ledger + company resolution for accounting.
  const [postBusinessUnit, setPostBusinessUnit] = useState<string>('');
  const [buOptions, setBuOptions] = useState<{ name: string; company: string }[]>([]);
  const [buLoading, setBuLoading] = useState(false);
  const [postSelectedKeys, setPostSelectedKeys] = useState<React.Key[]>([]);
  const [acctPreviewOpen, setAcctPreviewOpen] = useState(false);
  const [acctSchedules, setAcctSchedules]     = useState<RevenueSchedule[]>([]);
  const [acctLines, setAcctLines]             = useState<AcctLine[]>([]);
  const [posting, setPosting]                 = useState(false);
  const [postResults, setPostResults]         = useState<{ schedule: number; trx: number | null; status: string; message: string }[]>([]);

  // Create-accounting debug modal (per-step URL + payload + Run)
  const [acctDebugOpen,   setAcctDebugOpen]   = useState(false);
  const [acctDebugSteps,  setAcctDebugSteps]  = useState<{ step: string; method: string; url: string; payload: any }[]>([]);
  const [acctStepTest,    setAcctStepTest]    = useState<Record<number, { loading: boolean; status: number; body: string }>>({});
  const [acctDebugCtx,    setAcctDebugCtx]    = useState<Record<string, any>>({});
  const [acctDebugHalted, setAcctDebugHalted] = useState(false);
  const [acctDebugLedgerOk, setAcctDebugLedgerOk] = useState(true);
  const [acctDebugBU,     setAcctDebugBU]     = useState('');

  // View-accounting modal (read the posted GL journal for an accounted schedule)
  const [viewAcctOpen,    setViewAcctOpen]    = useState(false);
  const [viewAcctLoading, setViewAcctLoading] = useState(false);
  const [viewAcctLines,   setViewAcctLines]   = useState<any[] | null>(null);
  const [viewAcctSchedule, setViewAcctSchedule] = useState<RevenueSchedule | null>(null);
  // Natural-account description per code combination shown in the modal.
  const viewAcctCodes = useMemo(
    () => (viewAcctLines ?? []).map((l: any) => l.account ?? l.account_combination).filter(Boolean) as string[],
    [viewAcctLines]);
  const acctDescMap = useAccountDescriptions(viewAcctCodes);

  const loadContracts = async () => {
    setContractsLoading(true);
    try { setContracts(await getRevenueContracts()); }
    catch (e: any) { message.error(`Failed to load contracts: ${e.message}`); }
    finally { setContractsLoading(false); }
  };

  const loadSchedules = async () => {
    setSchedulesLoading(true);
    try { setSchedules(await getRevenueSchedules()); }
    catch (e: any) { message.error(`Failed to load schedules: ${e.message}`); }
    finally { setSchedulesLoading(false); }
  };

  // Load business units for the Post Revenue BU picker from the APEX (emparun)
  // backend — GET gl/businessunits — same source the rest of the AR module uses.
  // The company field feeds the runtime BU→company map so the account
  // combination uses the right first segment (falls back to DEFAULT_COMPANY '01').
  const loadBusinessUnits = async () => {
    setBuLoading(true);
    try {
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: any[] = Array.isArray(data) ? data : (data.items ?? []);
      const opts = items
        .map(it => ({
          name: String(it.business_unit_name ?? it.businessUnitName ?? it.BusinessUnitName ?? '').trim(),
          company: String(it.company ?? it.company_code ?? it.companyCode ?? it.Company ?? '').trim(),
        }))
        .filter(o => o.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      // Feed the runtime company map (upper-cased keys) so companyFromBU resolves.
      opts.forEach(o => { if (o.company) BU_TO_COMPANY[o.name.toUpperCase()] = o.company; });
      setBuOptions(opts);
    } catch (e: any) {
      message.error(`Failed to load business units: ${e.message}`);
    } finally { setBuLoading(false); }
  };

  useEffect(() => { loadContracts(); loadSchedules(); loadBusinessUnits(); }, []);

  const openGenerate = (mode: 'monthly' | 'daily' = 'monthly') => {
    if (selectedKeys.length === 0) { message.warning('Select one or more contracts'); return; }
    setGenMode(mode);
    setGenStatus(null);
    setGenResponse('');
    setGenOpen(true);
  };

  // Runs the POST directly (not via the service) so we can show the exact URL,
  // payload, HTTP status and raw response body for debugging.
  const runGenerate = async () => {
    setGenerating(true);
    setGenStatus(null);
    setGenResponse('');
    try {
      const res = await fetch(GEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(genPayload),
      });
      setGenStatus(res.status);
      const text = await res.text();
      setGenResponse(text);
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* non-JSON response */ }
      if (res.ok && data.success) {
        message.success(`Generated ${data.schedules} schedule line(s) for ${data.contracts} contract(s)`);
        setSelectedKeys([]);
        await Promise.all([loadContracts(), loadSchedules()]);
        setGenOpen(false);
        setTab('schedules');
      } else {
        message.error(data.error || `Generation failed (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setGenResponse(e?.message || 'Network error');
      message.error(e?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const showApi = () => {
    const c = `GET  ${APEX_DB_CONFIG.baseUrl}/ar/revenue-contracts`;
    const g = `POST ${APEX_DB_CONFIG.baseUrl}/ar/revenue-schedules/generate   { "contractIds":[...] }`;
    const s = `GET  ${APEX_DB_CONFIG.baseUrl}/ar/revenue-schedules`;
    message.info(<div style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 11 }}>{c}<br />{g}<br />{s}</div>, 8);
  };

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filteredContracts = useMemo(() => {
    const q = contractSearch.trim().toLowerCase();
    if (!q) return contracts;
    return contracts.filter(c =>
      [c.trxNumber, c.unit, c.location, c.tenant, c.status].some(v => v != null && String(v).toLowerCase().includes(q)));
  }, [contracts, contractSearch]);

  const filteredSchedules = useMemo(() => {
    const q = scheduleSearch.trim().toLowerCase();
    if (!q) return schedules;
    return schedules.filter(s =>
      [s.trxNumber, s.unit, s.location, s.tenant, s.periodName, s.invoiceNumber, s.status, s.accountStatus]
        .some(v => v != null && String(v).toLowerCase().includes(q)));
  }, [schedules, scheduleSearch]);

  const scheduleTotal = useMemo(() => filteredSchedules.reduce((s, r) => s + (Number(r.amount) || 0), 0), [filteredSchedules]);

  const isAccounted = (s: RevenueSchedule) => String(s.accountStatus || '').toUpperCase() === 'ACCOUNTED';

  // ── Post Revenue: period list, schedules in the period, and selection ──
  const periodOptions = useMemo(() => {
    const seen = new Map<string, string>();   // name → date (for sort)
    schedules.forEach(s => { if (s.periodName && !seen.has(s.periodName)) seen.set(s.periodName, s.periodDate); });
    return Array.from(seen.entries())
      .sort((a, b) => (a[1] || a[0]).localeCompare(b[1] || b[0]))
      .map(([name]) => name);
  }, [schedules]);

  const postSchedules = useMemo(
    () => (postPeriod ? schedules.filter(s => s.periodName === postPeriod) : []),
    [schedules, postPeriod]);

  // The sub-account (COA seg5) lives on the contract, but schedules only carry
  // contractId — so resolve it from the loaded contracts and stamp each schedule
  // before it feeds the accounting builders (preview, post, and debug all use it).
  const subByContract = useMemo(() => {
    const m = new Map<number, string>();
    contracts.forEach(c => { if (c.subaccount) m.set(c.id, String(c.subaccount).trim()); });
    return m;
  }, [contracts]);
  const withSubaccount = useCallback(
    (s: RevenueSchedule): RevenueSchedule =>
      ({ ...s, subaccount: (s.subaccount || subByContract.get(s.contractId) || '').trim() }),
    [subByContract]);

  // Contract start/end dates for the Post Revenue grid — schedules only carry
  // contractId, so resolve from the loaded contracts (fallback to trx number).
  const contractDates = useMemo(() => {
    const byId = new Map<number, { start: string; end: string; total: number }>();
    const byTrx = new Map<number, { start: string; end: string; total: number }>();
    contracts.forEach(c => { const d = { start: c.contractStartDate, end: c.contractEndDate, total: Number(c.rentTotal) || 0 }; if (c.id != null) byId.set(c.id, d); if (c.trxNumber != null) byTrx.set(Number(c.trxNumber), d); });
    return { byId, byTrx };
  }, [contracts]);
  const scheduleDates = useCallback((r: RevenueSchedule) =>
    contractDates.byId.get(r.contractId) ?? (r.trxNumber != null ? contractDates.byTrx.get(Number(r.trxNumber)) : undefined),
    [contractDates]);
  // Per-schedule day count (days of this period-month inside the contract span)
  // and the contract's daily rate (RENT_TOTAL / total inclusive days).
  const schedulePeriodInfo = useCallback((r: RevenueSchedule): { days: number; dailyRate: number } | null => {
    const d = scheduleDates(r);
    if (!d) return null;
    const start = parseFlexDate(d.start), end = parseFlexDate(d.end), pd = parseFlexDate(r.periodDate);
    if (!start || !end || !pd) return null;
    const DAY = 86400000;
    const totalDays = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
    const dailyRate = totalDays > 0 ? d.total / totalDays : 0;
    const firstOfMonth = new Date(pd.getFullYear(), pd.getMonth(), 1);
    const lastOfMonth = new Date(pd.getFullYear(), pd.getMonth() + 1, 0);
    const segStart = new Date(Math.max(firstOfMonth.getTime(), start.getTime()));
    const segEnd = new Date(Math.min(lastOfMonth.getTime(), end.getTime()));
    const days = segEnd >= segStart ? Math.round((segEnd.getTime() - segStart.getTime()) / DAY) + 1 : 0;
    return { days, dailyRate };
  }, [scheduleDates]);

  const openAcctPreview = () => {
    const chosen = postSchedules.filter(s => postSelectedKeys.includes(s.id)).map(withSubaccount);
    if (chosen.length === 0) { message.warning('Select one or more schedules'); return; }
    setAcctSchedules(chosen);
    setAcctLines(buildAcctLines(chosen));
    setPostResults([]);
    setAcctPreviewOpen(true);
  };

  const acctTotals = useMemo(() => ({
    debit:  acctLines.reduce((s, l) => s + l.debit, 0),
    credit: acctLines.reduce((s, l) => s + l.credit, 0),
  }), [acctLines]);
  // Natural-account description per combination for the preview lines.
  const acctPreviewCodes = useMemo(() => acctLines.map(l => l.accountCombination).filter(Boolean), [acctLines]);
  const acctPreviewDescMap = useAccountDescriptions(acctPreviewCodes);

  // ── Standard SLA create-accounting + GL journal (mirrors ManageMultiperiod) ──
  const RR_SOURCE_TABLE = 'RR_AR_REVENUE_SCHEDULE';

  // Accounting date = last day of the period month (end of period). Formats
  // with local Y/M/D parts so it isn't shifted back a day by UTC conversion.
  const scheduleAcctDate = (s: RevenueSchedule): string => {
    const d = parseFlexDate(s.periodDate) || new Date();
    const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0); // day 0 of next month
    return `${eom.getFullYear()}-${String(eom.getMonth() + 1).padStart(2, '0')}-${String(eom.getDate()).padStart(2, '0')}`;
  };
  const schedulePeriodLabel = (s: RevenueSchedule): string =>
    derivePeriodName(parseFlexDate(s.periodDate) || new Date());

  // Effective business unit for a schedule: use the row's BU if present, else
  // fall back to the BU the user typed in the Post Revenue toolbar.
  const buForSchedule = (s: RevenueSchedule): string => (s.businessUnit || postBusinessUnit || '').trim();

  const buildRevenueSlaPayload = (s: RevenueSchedule, ledger: { ledgerId: number; ledgerName: string }, postedBy: string, today: string): SlaCreatePayload => {
    const acctDate = scheduleAcctDate(s);
    const bu = buForSchedule(s);
    const company = companyFromBU(bu);
    const amount = Number(s.amount) || 0;
    return {
      header: {
        moduleName: 'AR', sourceTable: RR_SOURCE_TABLE, sourceId: s.id,
        sourceNumber: String(s.trxNumber ?? s.id), sourceType: 'Revenue Recognition',
        eventTypeCode: RR_SOURCE, eventDate: today, accountingDate: acctDate,
        periodName: schedulePeriodLabel(s), ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
        currencyCode: 'AED', ledgerCurrency: ledger.ledgerName, exchangeRate: 1,
        businessUnit: bu, description: `Revenue Recognition — Trx ${s.trxNumber ?? s.id} — ${s.periodName}`,
        createdBy: postedBy,
      },
      lines: [
        { lineNumber: 1, lineType: 'DR', accountingClass: 'RECEIVABLE', accountCombination: buildCombination(company, RR_DEBIT_ACCOUNT),
          enteredDr: amount, enteredCr: 0, accountedDr: amount, accountedCr: 0, currencyCode: 'AED', exchangeRate: 1,
          description: revLineDesc(s), sourceLineId: s.id, sourceLineNumber: 1 },
        { lineNumber: 2, lineType: 'CR', accountingClass: 'REVENUE', accountCombination: buildCombination(company, RR_CREDIT_ACCOUNT, s.subaccount),
          enteredDr: 0, enteredCr: amount, accountedDr: 0, accountedCr: amount, currencyCode: 'AED', exchangeRate: 1,
          description: revLineDesc(s), sourceLineId: s.id, sourceLineNumber: 2 },
      ],
    };
  };

  const buildRevenueGlOpts = (s: RevenueSchedule, ledger: { ledgerId: number; ledgerName: string }, postedBy: string, slaHeaderId: number): GlPostingOptions => {
    const acctDate = scheduleAcctDate(s);
    const bu = buForSchedule(s);
    const company = companyFromBU(bu);
    const amount = Number(s.amount) || 0;
    return {
      slaHeaderId, sourceNumber: String(s.trxNumber ?? s.id), sourceId: s.id,
      eventTypeCode: RR_SOURCE, periodName: schedulePeriodLabel(s), ledgerName: ledger.ledgerName,
      ledgerId: ledger.ledgerId, currency: 'AED', accountingDate: acctDate, legalEntity: '',
      businessUnit: bu, jeCategory: 'Revenue', jeSource: 'Receivables', batchSource: 'Receivables',
      createdBy: postedBy,
      lines: [
        { lineType: 'DR', enteredDr: amount, enteredCr: 0, accountedDr: amount, accountedCr: 0,
          description: revLineDesc(s), currencyCode: 'AED', accountingDate: acctDate,
          accountCombination: buildCombination(company, RR_DEBIT_ACCOUNT), accountingClass: 'RECEIVABLE', legalEntity: null },
        { lineType: 'CR', enteredDr: 0, enteredCr: amount, accountedDr: 0, accountedCr: amount,
          description: revLineDesc(s), currencyCode: 'AED', accountingDate: acctDate,
          accountCombination: buildCombination(company, RR_CREDIT_ACCOUNT, s.subaccount), accountingClass: 'REVENUE', legalEntity: null },
      ],
    };
  };

  // Post one schedule end-to-end: ledger → dup check → SLA (reuse/create) →
  // create+post GL journal (reference1=trx, reference2=schedule, reference5=source).
  const postRevenueSchedule = async (s: RevenueSchedule, postedBy: string, today: string): Promise<{ status: 'success' | 'skipped' | 'error'; message: string }> => {
    const bu = buForSchedule(s);
    const ledger = await fetchLedgerByBusinessUnit(bu);
    if (!ledger) return { status: 'error', message: `No ledger for BU '${bu || '—'}' — set the Business Unit field` };

    const dup = await checkGLJournalExists(String(s.trxNumber ?? ''), s.id, RR_SOURCE);
    if (dup.exists && dup.status === 'P') return { status: 'skipped', message: `Already accounted — GL batch ${dup.batchId}` };

    const slaExists = await checkAccountingExists(RR_SOURCE_TABLE, s.id, RR_SOURCE);
    const slaHeaderId = (slaExists.exists && slaExists.headerId)
      ? slaExists.headerId
      : (await createAccounting(buildRevenueSlaPayload(s, ledger, postedBy, today))).headerId;

    const glRes = await postSlaToGL(buildRevenueGlOpts(s, ledger, postedBy, slaHeaderId));
    if (!glRes.success) return { status: 'error', message: glRes.error || 'GL posting failed' };

    // Stamp the revenue schedule accounted (best-effort — don't fail the post).
    let markNote = '';
    try { await markRevenueScheduleAccounted(s.id, { slaHeaderId, updatedBy: postedBy }); }
    catch (e: any) { markNote = ` · schedule not stamped (${e.message})`; }
    return { status: 'success', message: `SLA #${slaHeaderId} — GL ${glRes.batchName}${glRes.skipped ? ' (reused)' : ''}${markNote}` };
  };

  const runCreateAccounting = async () => {
    if (acctSchedules.length === 0) return;
    setPosting(true); setPostResults([]);
    const postedBy = loggedUser;
    const today = new Date().toISOString().split('T')[0];
    const results: { schedule: number; trx: number | null; status: string; message: string }[] = [];
    for (const s of acctSchedules) {
      try {
        const r = await postRevenueSchedule(s, postedBy, today);
        results.push({ schedule: s.id, trx: s.trxNumber, status: r.status, message: r.message });
      } catch (e: any) {
        results.push({ schedule: s.id, trx: s.trxNumber, status: 'error', message: String(e.message) });
      }
      setPostResults([...results]);
    }
    setPosting(false);
    const ok = results.filter(r => r.status === 'success').length;
    const skip = results.filter(r => r.status === 'skipped').length;
    const err = results.filter(r => r.status === 'error').length;
    if (err === 0) message.success(`Accounting created: ${ok} posted${skip ? `, ${skip} already accounted` : ''}`);
    else message.warning(`Posted ${ok}, skipped ${skip}, failed ${err}`);
    await loadSchedules();
  };

  // ── Create-accounting debug: build all steps for the first selected schedule ──
  const openAcctDebug = async () => {
    const chosen = postSchedules.filter(s => postSelectedKeys.includes(s.id)).map(withSubaccount);
    const s = chosen[0];
    if (!s) { message.warning('Select a schedule to debug'); return; }
    const postedBy = loggedUser;
    const today = new Date().toISOString().split('T')[0];
    const base = APEX_DB_CONFIG.baseUrl;
    const bu = buForSchedule(s);
    const ledger = await fetchLedgerByBusinessUnit(bu).catch(() => null);
    // Always build the real SLA/GL request bodies so the JSON is visible in the
    // debug modal even when the ledger can't be resolved — use a placeholder
    // ledger and surface the resolution problem as a warning instead.
    const effLedger = ledger ?? { ledgerId: 0, ledgerName: '(unresolved)' };
    const slaPayload = buildRevenueSlaPayload(s, effLedger, postedBy, today);
    const batchName = makeBatchName(RR_SOURCE, String(s.trxNumber ?? s.id));
    const glPayload = buildGlJournalPayload(buildRevenueGlOpts(s, effLedger, postedBy, 0), batchName);
    setAcctDebugLedgerOk(!!ledger);
    setAcctDebugBU(bu);
    setAcctDebugSteps([
      { step: `1 — Ledger by BU (${bu || '—'})`, method: 'GET',
        url: `${base}/gl/getledgername?P_BUSINESS_UNIT_NAME=${encodeURIComponent(bu)}`, payload: null },
      { step: `2 — Duplicate check (Ref2=${s.id}, Ref5=${RR_SOURCE})`, method: 'GET',
        url: `${base}/gl/journals/check?reference1=${encodeURIComponent(String(s.trxNumber ?? ''))}&reference2=${s.id}&reference5=${RR_SOURCE}`, payload: null },
      { step: '3 — Create SLA accounting', method: 'POST', url: `${base}/sla/accounting/create`, payload: slaPayload },
      { step: '4 — Create GL journal', method: 'POST', url: `${base}/journals/create`, payload: glPayload },
      { step: '5 — Post journal to GL', method: 'PUT', url: `${base}/gl/journals/{batchId}/post`, payload: {} },
      { step: '6 — Stamp SLA header POSTED', method: 'POST', url: `${base}/sla/accounting/post`,
        payload: { headerId: '{slaHeaderId}', glBatchId: '{batchId}', glBatchName: batchName, glHeaderId: '{glHeaderId}', postedBy } },
      { step: `7 — Update revenue schedule (schedule ${s.id})`, method: 'POST', url: `${base}/ar/revenue-schedules/mark-accounted`,
        payload: { scheduleId: s.id, slaHeaderId: '{slaHeaderId}', accountStatus: 'ACCOUNTED', updatedBy: postedBy } },
    ]);
    setAcctStepTest({});
    setAcctDebugCtx({ batchName });
    setAcctDebugHalted(false);
    setAcctDebugOpen(true);
  };

  const runAcctDebugStep = async (idx: number) => {
    const s = acctDebugSteps[idx];
    if (!s) return;
    const isDupCheck = s.url.includes('/gl/journals/check');
    if (acctDebugHalted && !isDupCheck) { message.warning('Journal already exists — remaining steps are halted. Re-open the debug modal to reset.'); return; }
    setAcctStepTest(prev => ({ ...prev, [idx]: { loading: true, status: 0, body: '' } }));
    try {
      const url = resolveTokens(s.url, acctDebugCtx);
      const payload = s.payload ? resolveTokens(s.payload, acctDebugCtx) : null;

      // SLA create — reuse an existing header instead of creating a duplicate.
      if (s.url.includes('/sla/accounting/create') && payload?.header?.sourceId != null) {
        const h = payload.header;
        const chk = await checkAccountingExists(h.sourceTable, h.sourceId, h.eventTypeCode);
        if (chk.exists && chk.headerId) {
          setAcctDebugCtx(prev => ({ ...prev, slaHeaderId: chk.headerId }));
          setAcctStepTest(prev => ({ ...prev, [idx]: { loading: false, status: 200, body: `SLA already exists for schedule ${h.sourceId} — reusing headerId ${chk.headerId}. No duplicate created.\n\n${JSON.stringify(chk, null, 2)}` } }));
          message.info(`SLA already exists — reusing header #${chk.headerId}`);
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
      setAcctStepTest(prev => ({ ...prev, [idx]: { loading: false, status: res.status, body: pretty } }));

      if (data && res.ok) {
        if (isDupCheck) {
          if (data.exists) {
            setAcctDebugCtx(prev => ({ ...prev, batchId: data.batchId ?? prev.batchId, glHeaderId: data.headerId ?? prev.glHeaderId }));
            setAcctDebugHalted(true);
            message.warning(`Journal already exists (GL batch ${data.batchId ?? '—'}) — remaining steps halted.`);
          }
        } else if (s.url.includes('/gl/getledgername')) {
          const item = data.items?.[0];
          if (item) setAcctDebugCtx(prev => ({ ...prev, ledgerId: item.ledger_id, ledgerName: item.ledger_name }));
        } else if (s.url.includes('/sla/accounting/create')) {
          if (data.headerId != null) setAcctDebugCtx(prev => ({ ...prev, slaHeaderId: data.headerId }));
        } else if (s.url.includes('/journals/create')) {
          const batchId    = data.jeBatchId  ?? data.je_batch_id  ?? data.batchId  ?? null;
          const glHeaderId = data.jeHeaderId ?? data.je_header_id ?? data.headerId ?? null;
          setAcctDebugCtx(prev => ({ ...prev, batchId: batchId ?? prev.batchId, glHeaderId: glHeaderId ?? prev.glHeaderId }));
        }
      }
    } catch (e: any) {
      setAcctStepTest(prev => ({ ...prev, [idx]: { loading: false, status: 0, body: e?.message ?? 'Network error' } }));
    }
  };

  // View the posted GL journal for an accounted schedule — read straight from
  // GET /gl/journals/lines by reference2 = schedule id, reference5 = RR source.
  const openViewAccounting = async (s: RevenueSchedule) => {
    setViewAcctSchedule(s);
    setViewAcctOpen(true);
    setViewAcctLoading(true);
    setViewAcctLines(null);
    try {
      const res = await getGlJournalLines({ reference2: s.id, reference5: RR_SOURCE });
      setViewAcctLines(res.items);
    } catch (e: any) {
      message.error(`Failed to load journal: ${e?.message}`);
      setViewAcctLines([]);
    }
    setViewAcctLoading(false);
  };

  // Pivot: one row per contract, one column per month (chronological).
  const matrix = useMemo(() => {
    const months: { name: string; date: string }[] = [];
    const seen = new Set<string>();
    const byContract = new Map<number, any>();
    filteredSchedules.forEach(s => {
      if (!seen.has(s.periodName)) { seen.add(s.periodName); months.push({ name: s.periodName, date: s.periodDate }); }
      let row = byContract.get(s.contractId);
      if (!row) { row = { key: s.contractId, contractId: s.contractId, trxNumber: s.trxNumber, unit: s.unit, tenant: s.tenant, total: 0, accountedAmount: 0, remainingAmount: 0, totalPeriods: 0, accountedPeriods: 0, remainingPeriods: 0, cells: {} as Record<string, RevenueSchedule> }; byContract.set(s.contractId, row); }
      row.cells[s.periodName] = s;
      const amt = Number(s.amount) || 0;
      row.total += amt;
      row.totalPeriods += 1;
      if (isAccounted(s)) { row.accountedAmount += amt; row.accountedPeriods += 1; }
    });
    months.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rows = Array.from(byContract.values()).map((r: any) => {
      // The true contract amount comes from the contract (RENT_TOTAL), not the
      // sum of the per-period invoice-linked schedule lines (r.total = scheduled).
      const contractTotal = contractDates.byId.get(r.contractId)?.total
        ?? (r.trxNumber != null ? contractDates.byTrx.get(Number(r.trxNumber))?.total : undefined)
        ?? r.total;   // fall back to the scheduled sum when the contract isn't loaded
      return {
        ...r,
        scheduledAmount: r.total,             // sum of the generated/invoiced schedule lines
        contractTotal,                        // contract amount (RENT_TOTAL)
        remainingAmount: contractTotal - r.accountedAmount,   // yet to recognize against the contract
        remainingPeriods: r.totalPeriods - r.accountedPeriods,
      };
    });
    // Grand totals across all contracts
    const totals = rows.reduce((a: any, r: any) => ({
      total: a.total + r.total, contractTotal: a.contractTotal + r.contractTotal,
      scheduledAmount: a.scheduledAmount + r.scheduledAmount,
      accountedAmount: a.accountedAmount + r.accountedAmount, remainingAmount: a.remainingAmount + r.remainingAmount,
      totalPeriods: a.totalPeriods + r.totalPeriods, accountedPeriods: a.accountedPeriods + r.accountedPeriods, remainingPeriods: a.remainingPeriods + r.remainingPeriods,
    }), { total: 0, contractTotal: 0, scheduledAmount: 0, accountedAmount: 0, remainingAmount: 0, totalPeriods: 0, accountedPeriods: 0, remainingPeriods: 0 });
    return { months, rows, totals };
  }, [filteredSchedules, contractDates]);

  const matrixColumns: ColumnsType<any> = useMemo(() => [
    { title: 'Trx #', dataIndex: 'trxNumber', key: 'trxNumber', width: 90, fixed: 'left' as const, render: (v: any) => <Text strong>{v ?? '—'}</Text> },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 110, fixed: 'left' as const },
    { title: 'Tenant', dataIndex: 'tenant', key: 'tenant', width: 150, fixed: 'left' as const, ellipsis: true },
    ...matrix.months.map(m => ({
      title: m.name, key: m.name, width: 110, align: 'center' as const,
      render: (_: any, row: any) => {
        const s: RevenueSchedule | undefined = row.cells[m.name];
        if (!s) return <Text type="secondary">—</Text>;
        const acct = isAccounted(s);
        // Show the amount only once the period is accounted (posted); otherwise 0.
        return (
          <Tooltip title={`Accounted: ${acct ? 'Yes' : 'No'} · Schedule amount ${fmt(s.amount)}${s.invoiceNumber ? ` · Inv ${s.invoiceNumber}` : ''}`}>
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: acct ? undefined : REDWOOD.neutral500 }}>{acct ? fmt(s.amount) : fmt(0)}</div>
              {acct && <div><Tag color="green" style={{ fontSize: 9, padding: '0 4px', lineHeight: '14px' }}>Acct</Tag></div>}
            </div>
          </Tooltip>
        );
      },
    })),
    { title: 'Total Amount', dataIndex: 'contractTotal', key: 'contractTotal', width: 130, align: 'right' as const, fixed: 'right' as const,
      render: (v: number) => <Tooltip title="Contract amount (RENT_TOTAL)"><Text strong style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text></Tooltip> },
    { title: 'Scheduled', dataIndex: 'scheduledAmount', key: 'scheduledAmount', width: 120, align: 'right' as const, fixed: 'right' as const,
      render: (v: number) => <Tooltip title="Sum of the generated/invoiced schedule lines"><Text style={{ fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{fmt(v)}</Text></Tooltip> },
    { title: 'Accounted', dataIndex: 'accountedAmount', key: 'accountedAmount', width: 120, align: 'right' as const, fixed: 'right' as const,
      render: (v: number) => <Text style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{fmt(v)}</Text> },
    { title: 'Remaining', dataIndex: 'remainingAmount', key: 'remainingAmount', width: 120, align: 'right' as const, fixed: 'right' as const,
      render: (v: number) => <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(v)}</Text> },
    { title: 'Periods (acct / rem / total)', key: 'periods', width: 150, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Tooltip title={`Accounted ${r.accountedPeriods} · Remaining ${r.remainingPeriods} · Total ${r.totalPeriods}`}>
          <Text style={{ fontSize: 12 }}>
            <Tag color="green" style={{ marginInlineEnd: 2 }}>{r.accountedPeriods}</Tag>
            /<Tag color="orange" style={{ margin: '0 2px' }}>{r.remainingPeriods}</Tag>
            / {r.totalPeriods}
          </Text>
        </Tooltip>
      ) },
  ], [matrix.months]);

  // ── Revenue Matrix GL — fiscal-year rollforward ─────────────────────────────
  // Per contract: recognized monthly cells (like the Schedule Matrix) grouped by
  // fiscal year with a yearly subtotal, plus a deferred-revenue rollforward for the
  // chosen fiscal year:
  //   Closing (unrecognized before the FY) + Additions − Schedules (recognized in FY)
  //     = Available (deferred at FY end).
  // Additions come from RR_CONTRACTS: the full contract value of every contract
  // whose start date falls inside the fiscal year (e.g. a contract starting
  // 1-Apr-2026 is an addition of FY26/27).
  const glMatrix = useMemo(() => {
    const curStart = new Date(glFyStartYear, FY_START_MONTH, 1);
    const curEnd = new Date(glFyStartYear + 1, FY_START_MONTH, 1);   // exclusive
    const months: { name: string; date: string; fy: number }[] = [];
    const seen = new Set<string>();
    const byContract = new Map<number, any>();
    const newRow = (id: number, trxNumber: any, unit: string, tenant: string) => ({ key: id, contractId: id, trxNumber, unit, tenant, cells: {} as Record<string, RevenueSchedule>, fySub: {} as Record<number, number>, closing: 0, additions: 0, additionStart: '' as string, schedulesFy: 0 });
    filteredSchedules.forEach(s => {
      const d = parseYMD(s.periodDate);
      const fy = d ? fyStartYearOf(d) : glFyStartYear;
      if (!seen.has(s.periodName)) { seen.add(s.periodName); months.push({ name: s.periodName, date: s.periodDate, fy }); }
      let row = byContract.get(s.contractId);
      if (!row) { row = newRow(s.contractId, s.trxNumber, s.unit, s.tenant); byContract.set(s.contractId, row); }
      row.cells[s.periodName] = s;
      const amt = Number(s.amount) || 0;
      const acct = isAccounted(s);
      if (acct) row.fySub[fy] = (row.fySub[fy] || 0) + amt;    // recognized per fiscal year (yearly subtotal)
      if (d) {
        if (d < curStart) { if (acct) row.closing += amt; }    // recognized up to Mar-YY (opening balance)
        else if (d < curEnd && acct) row.schedulesFy += amt;   // recognized in this FY
      }
    });
    // Additions from the contracts table: contracts whose start date is in this FY.
    const cById = new Map(contracts.map(c => [c.id, c]));
    const q = scheduleSearch.trim().toLowerCase();
    const matchesSearch = (c: RevenueContract) => !q || [c.trxNumber, c.unit, c.location, c.tenant, c.status].some(v => v != null && String(v).toLowerCase().includes(q));
    contracts.forEach(c => {
      const sd = parseYMD(c.contractStartDate);
      if (!sd || sd < curStart || sd >= curEnd) return;
      if (!byContract.has(c.id) && !matchesSearch(c)) return;   // respect the filter for contract-only rows
      let row = byContract.get(c.id);
      if (!row) { row = newRow(c.id, c.trxNumber, c.unit, c.tenant); byContract.set(c.id, row); }
      row.additions += Number(c.rentTotal) || 0;
      row.additionStart = c.contractStartDate;
    });
    months.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const fyOrder: number[] = [];
    months.forEach(m => { if (!fyOrder.includes(m.fy)) fyOrder.push(m.fy); });
    const rows = Array.from(byContract.values()).map((r: any) => {
      const c = cById.get(r.contractId);
      return {
        ...r,
        available: r.closing + r.additions - r.schedulesFy,
        startDate: c?.contractStartDate || r.additionStart || '',
        endDate: c?.contractEndDate || '',
        controlAmount: c ? Number(c.rentTotal) || 0 : 0,
      };
    });
    const totals = rows.reduce((a: any, r: any) => ({
      closing: a.closing + r.closing, additions: a.additions + r.additions,
      schedulesFy: a.schedulesFy + r.schedulesFy, available: a.available + r.available,
      control: a.control + (r.controlAmount || 0),
    }), { closing: 0, additions: 0, schedulesFy: 0, available: 0, control: 0 });
    return { months, fyOrder, rows, totals };
  }, [filteredSchedules, contracts, scheduleSearch, glFyStartYear]);

  // Only the selected fiscal year's periods are shown (Apr..Mar); everything before
  // it is collapsed into the single Opening-balance column.
  const glFyMonths = useMemo(() => glMatrix.months.filter(m => m.fy === glFyStartYear), [glMatrix.months, glFyStartYear]);
  const openingLabel = `Opening (Mar-${String(glFyStartYear % 100).padStart(2, '0')})`;

  const glColumns: ColumnsType<any> = useMemo(() => {
    const cols: ColumnsType<any> = [
      { title: 'Trx #', dataIndex: 'trxNumber', key: 'trxNumber', width: 90, fixed: 'left' as const, sorter: (a: any, b: any) => (a.trxNumber || 0) - (b.trxNumber || 0), render: (v: any) => <Text strong>{v ?? '—'}</Text> },
      { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 110, fixed: 'left' as const, sorter: (a: any, b: any) => String(a.unit || '').localeCompare(String(b.unit || '')), defaultSortOrder: 'ascend' as const },
      { title: 'Tenant', dataIndex: 'tenant', key: 'tenant', width: 150, fixed: 'left' as const, ellipsis: true },
      { title: <Tooltip title="Contract value (RENT_TOTAL)"><span>Total Rent</span></Tooltip>, dataIndex: 'controlAmount', key: 'controlAmount', width: 130, align: 'right' as const,
        render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> },
      { title: 'Start Date', dataIndex: 'startDate', key: 'startDate', width: 110, align: 'center' as const,
        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'End Date', dataIndex: 'endDate', key: 'endDate', width: 110, align: 'center' as const,
        render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: <Tooltip title={`Revenue recognized up to and including Mar-${String(glFyStartYear % 100).padStart(2, '0')} (opening balance carried into ${fyLabel(glFyStartYear)})`}><span>{openingLabel}</span></Tooltip>, dataIndex: 'closing', key: 'closing', width: 130, align: 'right' as const,
        onCell: () => ({ style: { background: '#f6faf6' } }),
        render: (v: number) => <Text strong style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> },
      { title: <Tooltip title={`Contract value of contracts starting in ${fyLabel(glFyStartYear)} (from RR_AR_REVENUE_CONTRACT)`}><span>+ Additions</span></Tooltip>, dataIndex: 'additions', key: 'additions', width: 120, align: 'right' as const,
        onCell: () => ({ style: { background: '#f6faf6' } }),
        render: (v: number, row: any) => v ? <Tooltip title={row.additionStart ? `Contract starts ${row.additionStart}` : undefined}><Text style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{fmt(v)}</Text></Tooltip> : <Text type="secondary">—</Text> },
    ];
    glFyMonths.forEach(m => {
      cols.push({
        title: m.name, key: m.name, width: 100, align: 'center' as const,
        render: (_: any, row: any) => {
          const s: RevenueSchedule | undefined = row.cells[m.name];
          if (!s) return <Text type="secondary">—</Text>;
          const acct = isAccounted(s);
          return <div style={{ fontFamily: 'monospace', fontSize: 12, color: acct ? undefined : REDWOOD.neutral500 }}>{acct ? fmt(s.amount) : fmt(0)}</div>;
        },
      });
    });
    cols.push(
      { title: <Tooltip title={`Recognized (accounted) in ${fyLabel(glFyStartYear)}`}><span>− Schedules</span></Tooltip>, dataIndex: 'schedulesFy', key: 'schedulesFy', width: 120, align: 'right' as const,
        render: (v: number) => <Text style={{ fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{fmt(v)}</Text> },
      { title: <Tooltip title="Opening + Additions − Schedules = available (closing) balance at year end"><span>= Available</span></Tooltip>, dataIndex: 'available', key: 'available', width: 130, align: 'right' as const,
        render: (v: number) => <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(v)}</Text> },
    );
    return cols;
  }, [glFyMonths, glFyStartYear, openingLabel]);

  // ── Columns ────────────────────────────────────────────────────────────────
  const contractCols: ColumnsType<RevenueContract> = [
    { title: 'Trx #', dataIndex: 'trxNumber', key: 'trxNumber', width: 100, sorter: (a, b) => (a.trxNumber || 0) - (b.trxNumber || 0),
      render: (v) => <Text strong>{v ?? '—'}</Text> },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 120 },
    { title: 'Location', dataIndex: 'location', key: 'location', width: 150, ellipsis: true },
    { title: 'Tenant', dataIndex: 'tenant', key: 'tenant', width: 180, ellipsis: true },
    { title: 'Start', dataIndex: 'contractStartDate', key: 'contractStartDate', width: 110 },
    { title: 'End', dataIndex: 'contractEndDate', key: 'contractEndDate', width: 110 },
    { title: 'Total Periods', key: 'periods', width: 110, align: 'center' as const,
      render: (_: any, r: RevenueContract) => {
        const n = contractMonths(r.contractStartDate, r.contractEndDate);
        return n == null ? <Text type="secondary">—</Text> : <Tag color="purple">{n} mo</Tag>;
      } },
    { title: 'Rent Total', dataIndex: 'rentTotal', key: 'rentTotal', width: 130, align: 'right' as const,
      sorter: (a, b) => (a.rentTotal || 0) - (b.rentTotal || 0),
      render: (v) => <Text style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={String(v).toUpperCase() === 'ACTIVE' ? 'green' : 'default'}>{v || '—'}</Tag> },
    { title: 'Schedules', dataIndex: 'scheduleCount', key: 'scheduleCount', width: 100, align: 'center' as const,
      render: (v: number) => v > 0 ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—</Text> },
  ];

  const scheduleCols: ColumnsType<RevenueSchedule> = [
    { title: 'Trx #', dataIndex: 'trxNumber', key: 'trxNumber', width: 90, sorter: (a, b) => (a.trxNumber || 0) - (b.trxNumber || 0),
      render: (v) => <Text strong>{v ?? '—'}</Text> },
    { title: 'Invoice #', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 120,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 110 },
    { title: 'Location', dataIndex: 'location', key: 'location', width: 140, ellipsis: true },
    { title: 'Tenant', dataIndex: 'tenant', key: 'tenant', width: 160, ellipsis: true },
    { title: '#', dataIndex: 'scheduleNum', key: 'scheduleNum', width: 55, align: 'right' as const },
    { title: 'Month', dataIndex: 'periodName', key: 'periodName', width: 90,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const,
      sorter: (a, b) => (a.amount || 0) - (b.amount || 0),
      render: (v) => <Text style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={String(v).toUpperCase() === 'PENDING' ? 'orange' : 'green'}>{v || '—'}</Tag> },
    { title: 'Acct Status', dataIndex: 'accountStatus', key: 'accountStatus', width: 120,
      render: (v: string) => <Tag color={String(v).toUpperCase() === 'ACCOUNTED' ? 'green' : 'default'}>{v || '—'}</Tag> },
  ];

  const saveWb = (wb: XLSX.WorkBook, name: string) => {
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportContracts = () => {
    if (filteredContracts.length === 0) { message.warning('No contracts to export'); return; }
    const data = filteredContracts.map(c => ({
      'Trx #': c.trxNumber, 'Unit': c.unit, 'Location': c.location, 'Tenant': c.tenant,
      'Start': c.contractStartDate, 'End': c.contractEndDate,
      'Total Periods': contractMonths(c.contractStartDate, c.contractEndDate) ?? '',
      'Rent Total': Number(c.rentTotal) || 0, 'Status': c.status, 'Schedules': c.scheduleCount,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Revenue Contracts');
    saveWb(wb, 'revenue_contracts');
  };

  const exportPostRevenue = () => {
    if (postSchedules.length === 0) { message.warning('No schedules to export'); return; }
    const data = postSchedules.map(s => {
      const d = scheduleDates(s);
      const p = schedulePeriodInfo(s);
      return {
        'Business Unit': buForSchedule(s), 'Period': s.periodName || postPeriod || '',
        'Schedule ID': s.id, 'Trx #': s.trxNumber ?? '', 'Contract Amount': d?.total ?? '',
        'Invoice #': s.invoiceNumber ?? '',
        'Unit': s.unit, 'Tenant': s.tenant, 'Company': companyFromBU(buForSchedule(s)),
        'Contract Start': d?.start ?? '', 'Contract End': d?.end ?? '',
        '#': s.scheduleNum, 'Days': p?.days ?? '', 'Daily Rate': p?.dailyRate ?? '',
        'Amount': Number(s.amount) || 0,
        'Accounted': isAccounted(s) ? 'Accounted' : 'Pending',
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Post Revenue');
    saveWb(wb, `post_revenue${postPeriod ? `_${postPeriod}` : ''}`);
  };

  const exportMatrix = () => {
    if (matrix.rows.length === 0) { message.warning('No schedules to export'); return; }
    // Mirror the on-screen matrix exactly: same column order, month cells show the
    // accounted amount only (0 when not posted), single Periods column, Grand Total row.
    const buildRow = (r: any): Record<string, any> => {
      const row: Record<string, any> = { 'Trx #': r.trxNumber, 'Unit': r.unit, 'Tenant': r.tenant };
      matrix.months.forEach(m => { const c = r.cells[m.name]; row[m.name] = (c && isAccounted(c)) ? (Number(c.amount) || 0) : 0; });
      row['Total Amount'] = r.contractTotal;   // contract amount (RENT_TOTAL)
      row['Scheduled'] = r.scheduledAmount;     // sum of generated/invoiced schedule lines
      row['Accounted'] = r.accountedAmount;
      row['Remaining'] = r.remainingAmount;
      row['Periods (acct / rem / total)'] = `${r.accountedPeriods} / ${r.remainingPeriods} / ${r.totalPeriods}`;
      return row;
    };
    const data = matrix.rows.map(buildRow);
    // Grand Total row — matches the table summary.
    const grand: Record<string, any> = { 'Trx #': `Grand Total (${matrix.rows.length})`, 'Unit': '', 'Tenant': '' };
    matrix.months.forEach(m => { grand[m.name] = matrix.rows.reduce((s: number, r: any) => { const c = r.cells[m.name]; return s + (c && isAccounted(c) ? (Number(c.amount) || 0) : 0); }, 0); });
    grand['Total Amount'] = matrix.totals.contractTotal;
    grand['Scheduled'] = matrix.totals.scheduledAmount;
    grand['Accounted'] = matrix.totals.accountedAmount;
    grand['Remaining'] = matrix.totals.remainingAmount;
    grand['Periods (acct / rem / total)'] = `${matrix.totals.accountedPeriods} / ${matrix.totals.remainingPeriods} / ${matrix.totals.totalPeriods}`;
    data.push(grand);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Schedule Matrix');
    saveWb(wb, 'revenue_matrix');
  };

  // Shared export model — same column order as the on-screen Revenue Matrix GL.
  const buildGlExport = () => {
    const fyMonths = glMatrix.months.filter(m => m.fy === glFyStartYear);
    const openLbl = `Opening (Mar-${String(glFyStartYear % 100).padStart(2, '0')})`;
    const header = ['Trx #', 'Unit', 'Tenant', 'Total Rent', 'Start Date', 'End Date', openLbl, '+ Additions', ...fyMonths.map(m => m.name), '- Schedules', '= Available'];
    const monthStart = 8;
    const numCols = new Set<number>([3, 6, 7]);
    fyMonths.forEach((_, i) => numCols.add(monthStart + i));
    numCols.add(monthStart + fyMonths.length);       // Schedules
    numCols.add(monthStart + fyMonths.length + 1);   // Available
    const rowVals = (r: any): (string | number)[] => ([
      r.trxNumber ?? '', r.unit ?? '', r.tenant ?? '',
      r.controlAmount ?? 0, r.startDate || '', r.endDate || '',
      r.closing ?? 0, r.additions ?? 0,
      ...fyMonths.map(m => { const c = r.cells[m.name]; return (c && isAccounted(c)) ? (Number(c.amount) || 0) : 0; }),
      r.schedulesFy ?? 0, r.available ?? 0,
    ]);
    // Sort by Unit so exports match the default on-screen order.
    const sortedRows = [...glMatrix.rows].sort((a, b) => String(a.unit || '').localeCompare(String(b.unit || '')));
    const body = sortedRows.map(rowVals);
    const totals: (string | number)[] = [
      `Grand Total (${glMatrix.rows.length})`, '', '',
      glMatrix.totals.control, '', '',
      glMatrix.totals.closing, glMatrix.totals.additions,
      ...fyMonths.map(m => glMatrix.rows.reduce((s: number, r: any) => { const c = r.cells[m.name]; return s + (c && isAccounted(c) ? (Number(c.amount) || 0) : 0); }, 0)),
      glMatrix.totals.schedulesFy, glMatrix.totals.available,
    ];
    return { fyMonths, openLbl, header, body, totals, numCols };
  };

  const exportMatrixGl = async () => {
    if (glMatrix.rows.length === 0) { message.warning('No schedules to export'); return; }
    const { header, body, totals, numCols } = buildGlExport();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Revenue Matrix ${fyLabel(glFyStartYear).replace('/', '-')}`, { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    // Title + subtitle
    ws.mergeCells(1, 1, 1, header.length);
    Object.assign(ws.getCell(1, 1), { value: 'Revenue Recognition — Revenue Matrix GL' });
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFC74634' } };
    ws.mergeCells(2, 1, 2, header.length);
    ws.getCell(2, 1).value = `${fyLabel(glFyStartYear)}  (Apr ${glFyStartYear} – Mar ${glFyStartYear + 1})     Generated ${today}`;
    ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: 'FF8C8C8C' } };
    // Header row (row 3)
    const headerRow = ws.getRow(3);
    header.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
      cell.alignment = { horizontal: numCols.has(i) ? 'right' : 'left', vertical: 'middle', wrapText: true };
    });
    headerRow.height = 24;
    // Body rows
    body.forEach(vals => {
      const row = ws.addRow(vals);
      vals.forEach((_, i) => { const cell = row.getCell(i + 1); if (numCols.has(i)) { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; } });
    });
    // Grand-total row
    const tr = ws.addRow(totals);
    tr.eachCell((cell, col) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = { top: { style: 'thin', color: { argb: 'FF999999' } } };
      if (numCols.has(col - 1)) { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; }
    });
    ws.columns.forEach((col, i) => { col.width = i === 2 ? 26 : (i < 6 ? 15 : 13); });
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `revenue_matrix_gl_${fyLabel(glFyStartYear).replace('/', '-')}.xlsx`);
  };

  const exportMatrixGlPdf = () => {
    if (glMatrix.rows.length === 0) { message.warning('No schedules to export'); return; }
    const { header, body, totals, numCols } = buildGlExport();
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(199, 70, 52);
    doc.text('Revenue Recognition — Revenue Matrix GL', 10, 13);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    doc.text(`${fyLabel(glFyStartYear)}  (Apr ${glFyStartYear} – Mar ${glFyStartYear + 1})`, 10, 19);
    doc.text(`Generated ${today}`, pageW - 10, 19, { align: 'right' });
    const fmtCell = (v: any, i: number) => numCols.has(i) ? (typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v) : (v ?? '');
    const columnStyles: any = {}; numCols.forEach(i => { columnStyles[i] = { halign: 'right' }; });
    autoTable(doc, {
      startY: 23,
      head: [header],
      body: body.map(row => row.map((v, i) => fmtCell(v, i))),
      foot: [totals.map((v, i) => fmtCell(v, i))],
      styles: { fontSize: 6.5, cellPadding: 1.1, overflow: 'linebreak', lineColor: [221, 221, 221], lineWidth: 0.1 },
      headStyles: { fillColor: [199, 70, 52], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold', halign: 'right' },
      alternateRowStyles: { fillColor: [250, 248, 247] },
      columnStyles,
      margin: { left: 8, right: 8 },
      tableWidth: 'auto',
    });
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(150);
      doc.text('Generated by ReactERP', pageW / 2, pageH - 6, { align: 'center' });
      doc.text(`Page ${i} / ${pageCount}`, pageW - 10, pageH - 6, { align: 'right' });
      doc.setTextColor(0);
    }
    doc.save(`revenue_matrix_gl_${fyLabel(glFyStartYear).replace('/', '-')}.pdf`);
  };

  const exportSchedules = () => {
    if (filteredSchedules.length === 0) { message.warning('No schedules to export'); return; }
    const data = filteredSchedules.map(s => ({
      'Trx #': s.trxNumber, 'Invoice #': s.invoiceNumber || '', 'Unit': s.unit, 'Location': s.location,
      'Tenant': s.tenant, 'Schedule #': s.scheduleNum, 'Month': s.periodName, 'Period Date': s.periodDate,
      'Amount': Number(s.amount) || 0, 'Status': s.status, 'Account Status': s.accountStatus,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue Schedules');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `revenue_schedules_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px 0' }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /> Home</Link> },
            { title: <Link to="/ar">Receivables</Link> },
            { title: 'Revenue Recognition' },
          ]} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>Revenue Recognition</Title>
              <Text type="secondary">Generate monthly revenue schedules from rental contracts</Text>
            </div>
            <Tooltip title="Show API endpoints">
              <Button icon={<ApiOutlined />} onClick={showApi}>API</Button>
            </Tooltip>
          </div>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          <Card styles={{ body: { padding: 12 } }}>
            <Tabs
              activeKey={tab}
              onChange={setTab}
              items={[
                {
                  key: 'contracts',
                  label: `Revenue Contracts (${contracts.length})`,
                  children: (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                        <Input allowClear prefix={<SearchOutlined />} placeholder="Filter contracts…"
                          value={contractSearch} onChange={e => setContractSearch(e.target.value)} style={{ width: 260 }} />
                        <Space>
                          <Button icon={<FileExcelOutlined />} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }} onClick={exportContracts}>Excel</Button>
                          <Button icon={<ReloadOutlined />} onClick={loadContracts} loading={contractsLoading}>Refresh</Button>
                          <Dropdown.Button type="primary" icon={<DownOutlined />}
                            disabled={selectedKeys.length === 0}
                            onClick={() => openGenerate('monthly')}
                            menu={{ items: [
                              { key: 'monthly', icon: <ThunderboltOutlined />, label: 'Generate — Monthly (equal split)', onClick: () => openGenerate('monthly') },
                              { key: 'daily', icon: <ThunderboltOutlined />, label: 'Generate — Daily (prorated)', onClick: () => openGenerate('daily') },
                            ] }}>
                            <ThunderboltOutlined /> Generate Schedule ({selectedKeys.length})
                          </Dropdown.Button>
                        </Space>
                      </div>
                      <Table
                        rowKey="id"
                        columns={contractCols}
                        dataSource={filteredContracts}
                        loading={contractsLoading}
                        size="small"
                        scroll={{ x: 1100 }}
                        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
                        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['25', '50', '100', '200'], showTotal: (t) => `${t} contracts` }}
                        summary={() => filteredContracts.length === 0 ? null : (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                              {/* selection + Trx# + Unit + Location + Tenant + Start + End + Total Periods = 8 slots → Rent Total at index 8 */}
                              <Table.Summary.Cell index={0} colSpan={8}><Text strong>Total ({filteredContracts.length})</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={8} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(filteredContracts.reduce((s, c) => s + (Number(c.rentTotal) || 0), 0))}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={9} colSpan={2} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />
                    </>
                  ),
                },
                {
                  key: 'schedules',
                  label: `Revenue Schedules (${schedules.length})`,
                  children: (
                    <>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col xs={12} md={6}>
                          <Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Schedule Lines</Text>} value={filteredSchedules.length} valueStyle={{ fontSize: 16 }} /></Card>
                        </Col>
                        <Col xs={12} md={6}>
                          <Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Total Amount</Text>} value={scheduleTotal} precision={2} prefix={<DollarOutlined />} valueStyle={{ fontSize: 15, color: REDWOOD.primary }} /></Card>
                        </Col>
                      </Row>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                        <Input allowClear prefix={<SearchOutlined />} placeholder="Filter schedules…"
                          value={scheduleSearch} onChange={e => setScheduleSearch(e.target.value)} style={{ width: 260 }} />
                        <Space>
                          <Button icon={<FileExcelOutlined />} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }} onClick={exportSchedules}>Excel</Button>
                          <Button icon={<ReloadOutlined />} onClick={loadSchedules} loading={schedulesLoading}>Refresh</Button>
                        </Space>
                      </div>
                      <Table
                        rowKey="id"
                        columns={scheduleCols}
                        dataSource={filteredSchedules}
                        loading={schedulesLoading}
                        size="small"
                        scroll={{ x: 1150 }}
                        pagination={{ pageSize: 100, showSizeChanger: true, pageSizeOptions: ['50', '100', '200', '500'], showTotal: (t) => `${t} schedule lines` }}
                        summary={() => filteredSchedules.length === 0 ? null : (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
                              <Table.Summary.Cell index={0} colSpan={7}><Text strong>Total ({filteredSchedules.length})</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={7} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(scheduleTotal)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={8} colSpan={2} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />
                    </>
                  ),
                },
                {
                  key: 'matrix',
                  label: <Space size={4}><TableOutlined />Schedule Matrix</Space>,
                  children: (
                    <>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col xs={12} md={4}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Contract Total</Text>} value={matrix.totals.contractTotal} precision={2} valueStyle={{ fontSize: 15 }} /></Card></Col>
                        <Col xs={12} md={4}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Scheduled</Text>} value={matrix.totals.scheduledAmount} precision={2} valueStyle={{ fontSize: 15, color: REDWOOD.neutral600 }} /></Card></Col>
                        <Col xs={12} md={4}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Accounted (posted)</Text>} value={matrix.totals.accountedAmount} precision={2} valueStyle={{ fontSize: 15, color: REDWOOD.success }} /></Card></Col>
                        <Col xs={12} md={4}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Remaining</Text>} value={matrix.totals.remainingAmount} precision={2} valueStyle={{ fontSize: 15, color: REDWOOD.primary }} /></Card></Col>
                        <Col xs={12} md={8}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>Periods (accounted / remaining / total)</Text>} valueRender={() => (
                          <Space size={4}>
                            <Tag color="green" style={{ fontSize: 13 }}>{matrix.totals.accountedPeriods}</Tag>/
                            <Tag color="orange" style={{ fontSize: 13 }}>{matrix.totals.remainingPeriods}</Tag>/
                            <Text strong>{matrix.totals.totalPeriods}</Text>
                          </Space>
                        )} /></Card></Col>
                      </Row>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                        <Space wrap>
                          <Input allowClear prefix={<SearchOutlined />} placeholder="Filter…"
                            value={scheduleSearch} onChange={e => setScheduleSearch(e.target.value)} style={{ width: 240 }} />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            <Tag color="green" style={{ fontSize: 9 }}>Acct</Tag> accounted
                          </Text>
                        </Space>
                        <Space>
                          <Button icon={<FileExcelOutlined />} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }} onClick={exportMatrix}>Excel</Button>
                          <Button icon={<ReloadOutlined />} onClick={loadSchedules} loading={schedulesLoading}>Refresh</Button>
                        </Space>
                      </div>
                      <Table
                        rowKey="key"
                        columns={matrixColumns}
                        dataSource={matrix.rows}
                        loading={schedulesLoading}
                        size="small"
                        bordered
                        scroll={{ x: 300 + matrix.months.length * 110 + 640 }}
                        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} contracts` }}
                        locale={{ emptyText: 'No schedules — generate them from the Contracts tab' }}
                        summary={() => matrix.rows.length === 0 ? null : (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                              <Table.Summary.Cell index={0} colSpan={3}><Text strong>Grand Total ({matrix.rows.length})</Text></Table.Summary.Cell>
                              {matrix.months.map((m, i) => (
                                <Table.Summary.Cell key={m.name} index={3 + i} align="center">
                                  <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                    {/* accounted-only period total, matching the 0-when-unaccounted cells */}
                                    {fmt(matrix.rows.reduce((s: number, r: any) => { const c = r.cells[m.name]; return s + (c && isAccounted(c) ? (Number(c.amount) || 0) : 0); }, 0))}
                                  </Text>
                                </Table.Summary.Cell>
                              ))}
                              <Table.Summary.Cell index={3 + matrix.months.length} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{fmt(matrix.totals.contractTotal)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={4 + matrix.months.length} align="right"><Text style={{ fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{fmt(matrix.totals.scheduledAmount)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={5 + matrix.months.length} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{fmt(matrix.totals.accountedAmount)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={6 + matrix.months.length} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(matrix.totals.remainingAmount)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={7 + matrix.months.length} align="center">
                                <Text style={{ fontSize: 11 }}>{matrix.totals.accountedPeriods}/{matrix.totals.remainingPeriods}/{matrix.totals.totalPeriods}</Text>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />
                    </>
                  ),
                },
                {
                  key: 'matrix-gl',
                  label: <Space size={4}><TableOutlined />Revenue Matrix GL</Space>,
                  children: (
                    <>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col xs={12} md={5}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>{openingLabel}</Text>} value={glMatrix.totals.closing} precision={2} valueStyle={{ fontSize: 15 }} /></Card></Col>
                        <Col xs={12} md={5}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>+ Additions ({fyLabel(glFyStartYear)})</Text>} value={glMatrix.totals.additions} precision={2} valueStyle={{ fontSize: 15, color: REDWOOD.success }} /></Card></Col>
                        <Col xs={12} md={5}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>− Schedules ({fyLabel(glFyStartYear)})</Text>} value={glMatrix.totals.schedulesFy} precision={2} valueStyle={{ fontSize: 15, color: REDWOOD.neutral600 }} /></Card></Col>
                        <Col xs={12} md={5}><Card size="small"><Statistic title={<Text style={{ fontSize: 11 }}>= Available</Text>} value={glMatrix.totals.available} precision={2} valueStyle={{ fontSize: 15, color: REDWOOD.primary }} /></Card></Col>
                      </Row>
                      <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
                        message={<>Rollforward for <b>{fyLabel(glFyStartYear)}</b> (Apr {glFyStartYear} – Mar {glFyStartYear + 1}): <b>{openingLabel}</b> balance, then that year's periods only. <b>Opening + Additions</b> (contract value of contracts starting in the year, from RR_AR_REVENUE_CONTRACT) <b>− Schedules</b> (recognized in the year) <b>= Available</b>.</>} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                        <Space wrap>
                          <Text style={{ fontSize: 12 }}>Fiscal year</Text>
                          <Select size="small" style={{ width: 130 }} value={glFyStartYear} onChange={setGlFyStartYear}
                            options={Array.from(new Set([2026, ...glMatrix.fyOrder])).sort((a, b) => a - b).map(fy => ({ label: fyLabel(fy), value: fy }))} />
                          <Input allowClear prefix={<SearchOutlined />} placeholder="Filter…"
                            value={scheduleSearch} onChange={e => setScheduleSearch(e.target.value)} style={{ width: 220 }} />
                        </Space>
                        <Space>
                          <Button icon={<FilePdfOutlined />} style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary }} onClick={exportMatrixGlPdf}>PDF</Button>
                          <Button icon={<FileExcelOutlined />} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }} onClick={exportMatrixGl}>Excel</Button>
                          <Button icon={<ReloadOutlined />} onClick={loadSchedules} loading={schedulesLoading}>Refresh</Button>
                        </Space>
                      </div>
                      <Table
                        rowKey="key"
                        columns={glColumns}
                        dataSource={glMatrix.rows}
                        loading={schedulesLoading}
                        size="small"
                        bordered
                        scroll={{ x: 350 + 130 + 120 + glFyMonths.length * 100 + 250 + 350 }}
                        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} contracts` }}
                        locale={{ emptyText: 'No schedules — generate them from the Contracts tab' }}
                        summary={() => glMatrix.rows.length === 0 ? null : (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                              <Table.Summary.Cell index={0} colSpan={3}><Text strong>Grand Total ({glMatrix.rows.length})</Text></Table.Summary.Cell>
                              {(() => {
                                const cells: React.ReactNode[] = [];
                                let idx = 3;
                                cells.push(<Table.Summary.Cell key="control" index={idx++} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{fmt(glMatrix.totals.control)}</Text></Table.Summary.Cell>);
                                cells.push(<Table.Summary.Cell key="startDate" index={idx++} />);
                                cells.push(<Table.Summary.Cell key="endDate" index={idx++} />);
                                cells.push(<Table.Summary.Cell key="closing" index={idx++} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{fmt(glMatrix.totals.closing)}</Text></Table.Summary.Cell>);
                                cells.push(<Table.Summary.Cell key="additions" index={idx++} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.success }}>{fmt(glMatrix.totals.additions)}</Text></Table.Summary.Cell>);
                                glFyMonths.forEach(m => {
                                  const t = glMatrix.rows.reduce((s: number, r: any) => { const c = r.cells[m.name]; return s + (c && isAccounted(c) ? (Number(c.amount) || 0) : 0); }, 0);
                                  cells.push(<Table.Summary.Cell key={m.name} index={idx++} align="center"><Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(t)}</Text></Table.Summary.Cell>);
                                });
                                cells.push(<Table.Summary.Cell key="schedulesFy" index={idx++} align="right"><Text style={{ fontFamily: 'monospace', color: REDWOOD.neutral500 }}>{fmt(glMatrix.totals.schedulesFy)}</Text></Table.Summary.Cell>);
                                cells.push(<Table.Summary.Cell key="available" index={idx++} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(glMatrix.totals.available)}</Text></Table.Summary.Cell>);
                                return cells;
                              })()}
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />
                    </>
                  ),
                },
                {
                  key: 'post-revenue',
                  label: <Space size={4}><AuditOutlined />Post Revenue</Space>,
                  children: (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                        <Space wrap>
                          <Text style={{ fontSize: 12, color: REDWOOD.neutral500 }}>
                            <span style={{ color: REDWOOD.primary, marginRight: 2 }}>*</span>Business Unit
                          </Text>
                          <Select showSearch allowClear placeholder="Select business unit"
                            status={postBusinessUnit ? undefined : 'error'}
                            loading={buLoading} value={postBusinessUnit || undefined}
                            onChange={(v) => setPostBusinessUnit(v || '')}
                            style={{ width: 240 }}
                            optionFilterProp="label"
                            options={buOptions.map(o => ({
                              label: o.company ? `${o.name} (Co ${o.company})` : o.name, value: o.name }))}
                            notFoundContent={buLoading ? 'Loading…' : 'No business units'} />
                          <Text style={{ fontSize: 12, color: REDWOOD.neutral500 }}>
                            <span style={{ color: REDWOOD.primary, marginRight: 2 }}>*</span>Period
                          </Text>
                          <Select showSearch placeholder="Select accounting period"
                            status={postPeriod ? undefined : 'error'}
                            value={postPeriod} onChange={(v) => { setPostPeriod(v); setPostSelectedKeys([]); }}
                            style={{ width: 220 }} options={periodOptions.map(p => ({ label: p, value: p }))}
                            notFoundContent={schedules.length === 0 ? 'Load schedules first' : 'No periods'} />
                          {postPeriod
                            ? <Text type="secondary" style={{ fontSize: 12 }}>
                                {postSchedules.length} schedule(s) · {postSelectedKeys.length} selected
                              </Text>
                            : <Text style={{ fontSize: 12, color: REDWOOD.primary }}>Select a period to list schedules</Text>}
                        </Space>
                        <Space>
                          <Button type="primary" icon={<AuditOutlined />} disabled={postSelectedKeys.length === 0}
                            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                            onClick={openAcctPreview}>
                            Create Accounting ({postSelectedKeys.length})
                          </Button>
                          <Button icon={<ApiOutlined />} disabled={postSelectedKeys.length === 0} onClick={openAcctDebug}>Debug</Button>
                          <Button icon={<FileExcelOutlined />} disabled={postSchedules.length === 0} onClick={exportPostRevenue}
                            style={postSchedules.length ? { color: '#1D6F42', borderColor: '#1D6F42' } : undefined}>Export Excel</Button>
                          <Button icon={<ReloadOutlined />} onClick={loadSchedules} loading={schedulesLoading}>Refresh</Button>
                        </Space>
                      </div>
                      <Table
                        rowKey="id"
                        size="small"
                        loading={schedulesLoading}
                        dataSource={postSchedules}
                        scroll={{ x: 'max-content' }}
                        pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} schedules` }}
                        rowSelection={{ selectedRowKeys: postSelectedKeys, onChange: setPostSelectedKeys,
                          getCheckboxProps: (r) => ({ disabled: isAccounted(r) }) }}
                        locale={{ emptyText: postPeriod ? 'No schedules for this period' : 'Select a period to list schedules' }}
                        columns={[
                          { title: 'Business Unit', key: 'businessUnit', width: 200, ellipsis: true, render: (_: any, r: RevenueSchedule) => {
                            const bu = buForSchedule(r);
                            return bu ? bu : <span style={{ color: REDWOOD.neutral500 }}>— select BU —</span>;
                          } },
                          { title: 'Period', dataIndex: 'periodName', width: 100, render: (v: string) => <Tag color="purple">{v || postPeriod || '—'}</Tag> },
                          { title: 'Schedule ID', dataIndex: 'id', width: 100, render: (v: number) => <Text code>{v}</Text> },
                          { title: 'Trx #', dataIndex: 'trxNumber', width: 90, render: (v: any) => <Text strong>{v ?? '—'}</Text> },
                          { title: 'Contract Amount', key: 'cAmount', width: 130, align: 'right' as const, render: (_: any, r: RevenueSchedule) => { const d = scheduleDates(r); return d?.total ? <Text style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{fmt(d.total)}</Text> : <span style={{ color: REDWOOD.neutral500 }}>—</span>; } },
                          { title: 'Invoice #', dataIndex: 'invoiceNumber', width: 120, render: (v: any) => v || <span style={{ color: REDWOOD.neutral500 }}>—</span> },
                          { title: 'Unit', dataIndex: 'unit', width: 110 },
                          { title: 'Tenant', dataIndex: 'tenant', width: 170, ellipsis: true },
                          { title: 'Company', key: 'company', width: 90, render: (_: any, r: RevenueSchedule) => <Tag color="blue">{companyFromBU(buForSchedule(r))}</Tag> },
                          { title: 'Contract Start', key: 'cStart', width: 115, render: (_: any, r: RevenueSchedule) => { const d = scheduleDates(r); return d?.start ? <Tag color="geekblue">{d.start}</Tag> : <span style={{ color: REDWOOD.neutral500 }}>—</span>; } },
                          { title: 'Contract End', key: 'cEnd', width: 115, render: (_: any, r: RevenueSchedule) => { const d = scheduleDates(r); return d?.end ? <Tag color="volcano">{d.end}</Tag> : <span style={{ color: REDWOOD.neutral500 }}>—</span>; } },
                          { title: '#', dataIndex: 'scheduleNum', width: 55, align: 'right' as const },
                          { title: 'Days', key: 'days', width: 70, align: 'right' as const, render: (_: any, r: RevenueSchedule) => { const p = schedulePeriodInfo(r); return p ? <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{p.days}</Tag> : <span style={{ color: REDWOOD.neutral500 }}>—</span>; } },
                          { title: 'Daily Rate', key: 'dailyRate', width: 110, align: 'right' as const, render: (_: any, r: RevenueSchedule) => { const p = schedulePeriodInfo(r); return p ? <Text style={{ fontFamily: 'monospace', color: REDWOOD.info }}>{fmt(p.dailyRate)}</Text> : <span style={{ color: REDWOOD.neutral500 }}>—</span>; } },
                          { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right' as const, fixed: 'right' as const, render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> },
                          { title: 'Accounted', key: 'acct', width: 130, align: 'center' as const, fixed: 'right' as const, render: (_: any, r: RevenueSchedule) => isAccounted(r)
                            ? <Space size={4}>
                                <Tag color="green" style={{ marginInlineEnd: 0 }}>Accounted</Tag>
                                <Tooltip title="View accounting / journal details">
                                  <Button type="text" size="small" icon={<FileSearchOutlined style={{ color: REDWOOD.info }} />} onClick={() => openViewAccounting(r)} />
                                </Tooltip>
                              </Space>
                            : <Tag>Pending</Tag> },
                        ]}
                        summary={() => postSchedules.length === 0 ? null : (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                              {/* slots: selection + BU + Period + SchedID + Trx + Contract Amount + Invoice + Unit + Tenant + Company + Contract Start + Contract End + # + Days + Daily Rate = 15 → Amount at index 15, Accounted at 16 */}
                              <Table.Summary.Cell index={0} colSpan={15}><Text strong>Total ({postSchedules.length})</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={15} align="right"><Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(postSchedules.reduce((s, r) => s + (Number(r.amount) || 0), 0))}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={16} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </div>

        {/* ── Generate Schedule — debug/confirm modal ── */}
        <Modal
          open={genOpen}
          onCancel={() => { if (!generating) setGenOpen(false); }}
          maskClosable={!generating}
          width={720}
          title={<Space><ThunderboltOutlined style={{ color: REDWOOD.primary }} /><span>Generate Revenue Schedule</span></Space>}
          footer={
            <Space>
              <Button disabled={generating} onClick={() => setGenOpen(false)}>Close</Button>
              <Button type="primary" loading={generating}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={runGenerate}>
                Run Generate ({selectedKeys.length})
              </Button>
            </Space>
          }
        >
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Calculation method</div>
          <Segmented value={genMode} onChange={(v) => setGenMode(v as 'monthly' | 'daily')}
            options={[
              { label: 'Monthly (equal split)', value: 'monthly' },
              { label: 'Daily (prorated)', value: 'daily' },
            ]} />
          <div style={{ fontSize: 11.5, color: REDWOOD.neutral500, margin: '6px 0 12px' }}>
            {genMode === 'daily'
              ? 'Day-wise: RENT_TOTAL ÷ total days; each month gets daily rate × its days inside the contract span — partial first/last months are prorated.'
              : 'Monthly: RENT_TOTAL ÷ inclusive month count, equal per period (partial months counted as full).'}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Method / URL</div>
          <Typography.Text copyable code style={{ fontSize: 12, wordBreak: 'break-all' }}>{`POST ${GEN_URL}`}</Typography.Text>

          <div style={{ fontSize: 12, color: '#888', margin: '12px 0 4px' }}>Request Body (JSON)</div>
          <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 10, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(genPayload, null, 2)}
          </pre>

          {genStatus != null && (
            <>
              <div style={{ fontSize: 12, color: '#888', margin: '12px 0 4px' }}>
                Response — HTTP <b style={{ color: genStatus >= 200 && genStatus < 300 ? REDWOOD.success : REDWOOD.primary }}>{genStatus}</b>
              </div>
              <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 10, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {genResponse || '(empty)'}
              </pre>
              {genStatus === 404 && (
                <Alert type="warning" showIcon style={{ marginTop: 8, fontSize: 12 }}
                  message="404 — the webservice isn't deployed. Run database/ar/rr_ar_revenue.sql in APEX SQL Workshop (it registers POST ar/revenue-schedules/generate)." />
              )}
            </>
          )}
        </Modal>

        {/* ── Create Accounting — preview + post ── */}
        <Modal
          open={acctPreviewOpen}
          onCancel={() => { if (!posting) setAcctPreviewOpen(false); }}
          maskClosable={!posting}
          width={980}
          title={<Space><AuditOutlined style={{ color: REDWOOD.primary }} /><span>Create Accounting — Preview</span></Space>}
          footer={
            <Space>
              <Button disabled={posting} onClick={() => setAcctPreviewOpen(false)}>Close</Button>
              <Button type="primary" loading={posting} icon={<AuditOutlined />}
                disabled={Math.abs(acctTotals.debit - acctTotals.credit) > 0.005}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={runCreateAccounting}>
                Post Accounting ({acctLines.length / 2})
              </Button>
            </Space>
          }
        >
          <Space size={16} wrap style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 12 }}>Period: <Tag color="blue">{postPeriod}</Tag></Text>
            <Text style={{ fontSize: 12 }}>Dr: <Tag>{RR_DEBIT_ACCOUNT}</Tag></Text>
            <Text style={{ fontSize: 12 }}>Cr: <Tag>{RR_CREDIT_ACCOUNT}</Tag></Text>
            <Text style={{ fontSize: 12 }}>Source (ref5): <Tag color="purple">{RR_SOURCE}</Tag></Text>
          </Space>
          <Table
            rowKey="key"
            size="small"
            bordered
            dataSource={acctLines}
            pagination={false}
            scroll={{ y: 320, x: 1140 }}
            columns={[
              { title: 'Trx #', dataIndex: 'trxNumber', width: 80, render: (v: any) => v ?? '—' },
              { title: 'Sched', dataIndex: 'scheduleId', width: 70 },
              { title: 'Dr/Cr', dataIndex: 'lineType', width: 60, render: (v: string) => <Tag color={v === 'DR' ? 'geekblue' : 'gold'}>{v}</Tag> },
              { title: 'Account Combination', dataIndex: 'accountCombination', width: 250, render: (v: string) => {
                const desc = acctPreviewDescMap[v];
                return (
                  <div>
                    <Text style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{v}</Text>
                    {desc && <div style={{ fontSize: 10.5, color: REDWOOD.neutral500, marginTop: 2 }}>{desc}</div>}
                  </div>
                );
              } },
              { title: 'Description', dataIndex: 'description', width: 240, ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
              { title: 'Debit', dataIndex: 'debit', width: 110, align: 'right' as const, render: (v: number) => v ? <Text style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> : '—' },
              { title: 'Credit', dataIndex: 'credit', width: 110, align: 'right' as const, render: (v: number) => v ? <Text style={{ fontFamily: 'monospace' }}>{fmt(v)}</Text> : '—' },
              { title: 'Ref1', dataIndex: 'reference1', width: 90, render: (v: string) => <Tooltip title="trx_number">{v || '—'}</Tooltip> },
              { title: 'Ref2', dataIndex: 'reference2', width: 90, render: (v: string) => <Tooltip title="schedule_id">{v}</Tooltip> },
              { title: 'Ref5', dataIndex: 'reference5', width: 170, ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text> },
            ]}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                  <Table.Summary.Cell index={0} colSpan={5}><Text strong>Totals</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{fmt(acctTotals.debit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{fmt(acctTotals.credit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={7} colSpan={3} align="right">
                    {Math.abs(acctTotals.debit - acctTotals.credit) < 0.005
                      ? <Tag color="green">Balanced</Tag>
                      : <Tag color="red">Out of balance</Tag>}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />

          <Divider style={{ margin: '12px 0' }} />
          <Alert type="info" showIcon style={{ fontSize: 12, marginBottom: postResults.length ? 10 : 0 }}
            message="Standard Subledger Accounting"
            description={<span>Each schedule runs the standard flow: resolve ledger by business unit → duplicate check → create SLA accounting → create &amp; post the GL journal (reference1 = trx #, reference2 = schedule id, reference5 = {RR_SOURCE}) → stamp SLA. Same path as Multiperiod Accounting.</span>} />
          {postResults.length > 0 && (
            <Table
              rowKey="schedule"
              size="small"
              style={{ marginTop: 10 }}
              dataSource={postResults}
              pagination={false}
              scroll={{ y: 180 }}
              columns={[
                { title: 'Trx #', dataIndex: 'trx', width: 90, render: (v: any) => v ?? '—' },
                { title: 'Schedule', dataIndex: 'schedule', width: 90 },
                { title: 'Status', dataIndex: 'status', width: 100, render: (v: string) =>
                  <Tag color={v === 'success' ? 'green' : v === 'skipped' ? 'gold' : 'red'}>{v}</Tag> },
                { title: 'Result', dataIndex: 'message', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
              ]}
            />
          )}
        </Modal>

        {/* ── Create Accounting — step-by-step debug ── */}
        <Modal
          open={acctDebugOpen}
          onCancel={() => setAcctDebugOpen(false)}
          width={860}
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Create Accounting — Service Debug</span></Space>}
          footer={
            <Space>
              <Button onClick={() => setAcctDebugOpen(false)}>Close</Button>
              <Button type="primary" style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={() => { setAcctDebugOpen(false); openAcctPreview(); }}>
                Go to Create Accounting
              </Button>
            </Space>
          }
        >
          {!acctDebugLedgerOk && (
            <Alert type="error" showIcon style={{ marginBottom: 10, fontSize: 12 }}
              message={`No ledger resolved for Business Unit '${acctDebugBU || '—'}'`}
              description="The JSON bodies below are built with a placeholder ledger (id 0) so you can review them, but steps 3–6 will fail until a valid Business Unit is set in the Post Revenue toolbar." />
          )}
          {acctDebugHalted && (
            <Alert type="warning" showIcon style={{ marginBottom: 10, fontSize: 12 }}
              message="Journal already exists — remaining steps are halted. Re-open Debug to reset." />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            Runs the standard SLA + GL journal services for the first selected schedule. Test each step in order — ids ({'{slaHeaderId}'}, {'{batchId}'}, {'{glHeaderId}'}) captured by earlier steps fill in automatically.
          </Text>
          <div style={{ marginTop: 10 }}>
            {acctDebugSteps.map((s, idx) => {
              const t = acctStepTest[idx];
              const isDupCheck = s.url.includes('/gl/journals/check');
              const stepHalted = acctDebugHalted && !isDupCheck;
              const dispUrl     = resolveTokens(s.url, acctDebugCtx);
              const dispPayload = s.payload != null ? resolveTokens(s.payload, acctDebugCtx) : null;
              return (
                <div key={idx} style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 10, marginBottom: 8, opacity: stepHalted ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color={s.method === 'GET' ? 'blue' : s.method === 'PUT' ? 'purple' : 'green'} style={{ fontSize: 11 }}>{s.method}</Tag>
                    <Text strong style={{ fontSize: 12 }}>{s.step}</Text>
                    <Button size="small" style={{ marginLeft: 'auto' }} loading={t?.loading} disabled={stepHalted} onClick={() => runAcctDebugStep(idx)}>Run</Button>
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all', marginTop: 6 }}>{dispUrl}</div>
                  {dispPayload != null && (
                    <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: '6px 0 0', maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(dispPayload, null, 2)}
                    </pre>
                  )}
                  {t && t.status !== 0 && (
                    <>
                      <div style={{ fontSize: 11, color: '#888', margin: '6px 0 2px' }}>
                        HTTP <b style={{ color: t.status >= 200 && t.status < 300 ? REDWOOD.success : REDWOOD.primary }}>{t.status}</b>
                      </div>
                      <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: 0, maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {t.body || '(empty)'}
                      </pre>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>

        {/* ── View Accounting — posted GL journal for an accounted schedule ── */}
        <Modal
          open={viewAcctOpen}
          onCancel={() => setViewAcctOpen(false)}
          width={900}
          title={<Space><FileSearchOutlined style={{ color: REDWOOD.info }} /><span>
            Accounting — Trx {viewAcctSchedule?.trxNumber ?? '—'} · Schedule {viewAcctSchedule?.id ?? '—'} · {viewAcctSchedule?.periodName ?? ''}
          </span></Space>}
          footer={<Button onClick={() => setViewAcctOpen(false)}>Close</Button>}
        >
          {viewAcctLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">Loading journal…</Text></div>
          ) : !viewAcctLines || viewAcctLines.length === 0 ? (
            <Alert type="info" showIcon message="No posted GL journal found for this schedule."
              description={`Looked up gl/journals/lines?reference2=${viewAcctSchedule?.id}&reference5=${RR_SOURCE}`} />
          ) : (() => {
            const rows = viewAcctLines;
            const totalDr = rows.reduce((s: number, l: any) => s + (Number(l.accounted_dr) || 0), 0);
            const totalCr = rows.reduce((s: number, l: any) => s + (Number(l.accounted_cr) || 0), 0);
            const journals = new Set(rows.map((l: any) => l.je_header_id ?? l.je_batch_id));
            const batchId  = rows[0]?.je_batch_id ?? rows[0]?.je_header_id ?? '—';
            const status   = rows[0]?.posting_status ?? '—';
            return (
              <>
                <Space wrap style={{ marginBottom: 8 }}>
                  <Tag color="blue">Batch {batchId}</Tag>
                  <Tag color={status === 'POSTED' ? 'success' : 'default'}>{status}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{journals.size} journal(s) · {rows.length} line(s)</Text>
                </Space>
                <Table
                  dataSource={rows}
                  rowKey={(r: any, i) => `${r.je_header_id ?? r.je_batch_id}-${r.line_num ?? r.line_id ?? i}`}
                  size="small"
                  pagination={false}
                  scroll={{ x: 820 }}
                  columns={[
                    { title: 'Period', dataIndex: 'period_name', width: 80, render: (v: string) => <Tag color="purple" style={{ fontSize: 10 }}>{v || '—'}</Tag> },
                    { title: 'Journal', dataIndex: 'je_header_id', width: 90, align: 'center' as const, render: (v: number, rec: any) => <Tooltip title={rec.journal_name}><Text style={{ fontSize: 11 }}>{v ?? rec.je_batch_id ?? '—'}</Text></Tooltip> },
                    { title: '#', dataIndex: 'line_num', width: 40, align: 'center' as const },
                    { title: 'Account', dataIndex: 'account', width: 250, render: (v: string, rec: any) => {
                      const code = v ?? rec.account_combination ?? '';
                      const desc = acctDescMap[code];
                      return (
                        <div>
                          <Text code style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{code || '—'}</Text>
                          {desc && <div style={{ fontSize: 10.5, color: REDWOOD.neutral500, marginTop: 2 }}>{desc}</div>}
                        </div>
                      );
                    } },
                    { title: 'Description', dataIndex: 'description', ellipsis: true },
                    { title: 'Class', dataIndex: 'reference3', width: 100, render: (v: string) => v ? <Tag style={{ fontSize: 10 }}>{v}</Tag> : <Text type="secondary">—</Text> },
                    { title: 'Dr Amount', dataIndex: 'accounted_dr', width: 120, align: 'right' as const, render: (v: any) => Number(v) ? <Text style={{ color: REDWOOD.info, fontFamily: 'monospace' }}>{fmt(Number(v))}</Text> : <Text type="secondary">—</Text> },
                    { title: 'Cr Amount', dataIndex: 'accounted_cr', width: 120, align: 'right' as const, render: (v: any) => Number(v) ? <Text style={{ color: REDWOOD.success, fontFamily: 'monospace' }}>{fmt(Number(v))}</Text> : <Text type="secondary">—</Text> },
                  ]}
                  summary={() => (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ background: '#fafafa' }}>
                        <Table.Summary.Cell index={0} colSpan={6} align="right"><Text strong>Total</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: REDWOOD.info, fontFamily: 'monospace' }}>{fmt(totalDr)}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right"><Text strong style={{ color: REDWOOD.success, fontFamily: 'monospace' }}>{fmt(totalCr)}</Text></Table.Summary.Cell>
                      </Table.Summary.Row>
                    </Table.Summary>
                  )}
                />
                <div style={{ marginTop: 6 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    Source: reerp/gl/journals/lines?reference2={viewAcctSchedule?.id}&reference5={RR_SOURCE}
                  </Text>
                </div>
              </>
            );
          })()}
        </Modal>

        <FloatingMenu />
      </Content>
    </Layout>
  );
};

export default RevenueRecognition;
