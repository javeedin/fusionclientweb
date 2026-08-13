import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  Button, Select, Input, Table, Space, Tooltip, Row, Col, Tag,
  Spin, Empty, message, Modal, DatePicker, Typography, Divider, Switch,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SearchOutlined, FilterOutlined, ReloadOutlined, DownloadOutlined,
  TableOutlined, PieChartOutlined, BugOutlined, AuditOutlined,
  LinkOutlined, ApiOutlined, LoadingOutlined,
} from '@ant-design/icons';

const { Text } = Typography;
const { Option } = Select;

// ── Constants ────────────────────────────────────────────────────────────────
const API_BASE_URL = buildApexUrl('gl');
const VALUES_API   = buildApexUrl('valuesets/getvalues');
const COMPANY_VALUESET = 'BUIMERC_FIN_GLB_COA_CO';
const COMPANY_LOV_URL  = `${VALUES_API}/${COMPANY_VALUESET}`;

export const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── Types ────────────────────────────────────────────────────────────────────
export interface JournalLineSegment {
  key: string;
  batchId: number; jeHeaderId: number; jeLineNumber: number;
  currencyCode: string; company: string; lob: string; department: string;
  account: string; subAccount: string; analysis: string; intercompany: string;
  future1: string; future2: string;
  isOpeningBalance?: boolean; isClosingBalance?: boolean;
  isGroupHeader?: boolean; groupCount?: number;
  groupDr?: number; groupCr?: number;
  groupEnteredDr?: number; groupEnteredCr?: number;
  accountType?: string;
  enteredDr: number; enteredCr: number; accountedDr: number; accountedCr: number;
  chartOfAccountsName: string; accountingDate?: string; defaultPeriodName: string;
  batchName: string; actualFlagMeaning: string; approvalStatusMeaning: string;
  userPeriodSetName: string; userJeSourceName: string; ledgerName: string;
  legalEntityName: string; userJeCategoryName: string;
  jeLineDescription?: string; concatenatedSegments?: string; accountDescription?: string;
}

interface PivotDataRow {
  key: string; account: string; company: string; lob: string; department: string;
  subAccount: string; analysis: string; intercompany: string; concatenatedSegments: string;
  [key: string]: string | number;
}

interface AccountItem { account: string; description: string; account_type: string; }

interface SegmentValues {
  companies: string[]; lobs: string[]; departments: string[];
  subAccounts: string[]; analyses: string[]; intercompanies: string[];
  sources: string[]; categories: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const parsePeriodToDate = (period: string): Date => {
  const monthMap: Record<string, number> = {
    Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11,
  };
  const parts = period.split('-');
  if (parts.length === 2) {
    return new Date(2000 + parseInt(parts[1], 10), monthMap[parts[0]] ?? 0, 1);
  }
  return new Date();
};

const getPreviousPeriod = (period: string): string => {
  const parts = period.split('-');
  if (parts.length !== 2) return period;
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  if (monthIdx === -1) return period;
  const year = parseInt(parts[1], 10);
  if (monthIdx === 0) return `Dec-${String(year - 1).padStart(2, '0')}`;
  return `${MONTH_NAMES[monthIdx - 1]}-${parts[1]}`;
};

export const formatNumber = (value: number | undefined | null): string => {
  if (!value) return '';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const extractPeriodName = (periodNameId: string): string | null => {
  if (!periodNameId) return null;
  const parts = periodNameId.split('_');
  return parts.length >= 2 ? parts[1] : null;
};

const calculateTotals = (data: JournalLineSegment[]) =>
  data.filter(r => !r.isOpeningBalance && !r.isClosingBalance).reduce(
    (acc, r) => ({
      enteredDr:   acc.enteredDr   + (r.enteredDr   || 0),
      enteredCr:   acc.enteredCr   + (r.enteredCr   || 0),
      accountedDr: acc.accountedDr + (r.accountedDr || 0),
      accountedCr: acc.accountedCr + (r.accountedCr || 0),
    }),
    { enteredDr: 0, enteredCr: 0, accountedDr: 0, accountedCr: 0 }
  );

// ── Props ────────────────────────────────────────────────────────────────────
interface SearchTabPanelProps {
  ledgerOptions: string[];
  onOpenAccountTab: (record: JournalLineSegment, selectedPeriods: string[]) => void;
}

// ── Component ────────────────────────────────────────────────────────────────
export const SearchTabPanel: React.FC<SearchTabPanelProps> = ({ ledgerOptions, onOpenAccountTab }) => {

  // Filter state
  const [selectedLedger,     setSelectedLedger]     = useState('BUIMERC LEDGER');
  const [selectedPeriods,    setSelectedPeriods]    = useState<string[]>([]);
  const [availablePeriods,   setAvailablePeriods]   = useState<string[]>([]);
  const [periodsLoading,     setPeriodsLoading]     = useState(false);
  const [fromDate,           setFromDate]           = useState<Dayjs | null>(null);
  const [toDate,             setToDate]             = useState<Dayjs | null>(null);
  const [selectedCompany,    setSelectedCompany]    = useState('');
  const [accountFilter,      setAccountFilter]      = useState('');
  const [accountFilterDesc,  setAccountFilterDesc]  = useState('');
  const [lobFilter,          setLobFilter]          = useState('');
  const [departmentFilter,   setDepartmentFilter]   = useState('');
  const [subAccountFilter,   setSubAccountFilter]   = useState('');
  const [analysisFilter,     setAnalysisFilter]     = useState('');
  const [intercompanyFilter, setIntercompanyFilter] = useState('');
  const [jeSourceFilter,     setJeSourceFilter]     = useState('');
  const [jeCategoryFilter,   setJeCategoryFilter]   = useState('');
  const [segmentValues,      setSegmentValues]      = useState<SegmentValues>({
    companies: [], lobs: [], departments: [], subAccounts: [],
    analyses: [], intercompanies: [], sources: [], categories: [],
  });
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});

  // Results state
  const [searchData,        setSearchData]        = useState<JournalLineSegment[]>([]);
  const [loading,           setLoading]           = useState(false);
  const [totalCount,        setTotalCount]        = useState(0);
  const [searchPageSize,    setSearchPageSize]    = useState(20);
  const [openingBalanceRow, setOpeningBalanceRow] = useState<JournalLineSegment | null>(null);
  const [closingBalanceRow, setClosingBalanceRow] = useState<JournalLineSegment | null>(null);

  // Account lookup modal
  const [accountLookupVisible, setAccountLookupVisible] = useState(false);
  const [accountsList,         setAccountsList]         = useState<AccountItem[]>([]);
  const [accountsLoading,      setAccountsLoading]      = useState(false);
  const [accountSearchText,    setAccountSearchText]    = useState('');

  // Journal drill modal
  const [journalDrillVisible, setJournalDrillVisible] = useState(false);
  const [journalDrillRecord,  setJournalDrillRecord]  = useState<JournalLineSegment | null>(null);

  // Full journal modal
  const [fullJournalVisible, setFullJournalVisible] = useState(false);
  const [fullJournalLoading, setFullJournalLoading] = useState(false);
  const [fullJournalLines,   setFullJournalLines]   = useState<any[]>([]);
  const [fullJournalMeta,    setFullJournalMeta]    = useState<{ batchName: string; jeHeaderId: number; period: string } | null>(null);

  // Pivot modal
  const [pivotVisible, setPivotVisible] = useState(false);
  const [groupByAccount, setGroupByAccount] = useState(false);
  const [showEntered, setShowEntered] = useState(false);
  const [gridFilter, setGridFilter] = useState('');
  const [pivotSegsBefore, setPivotSegsBefore] = useState<string[]>([]);
  const [pivotSegsAfter,  setPivotSegsAfter]  = useState<string[]>([]);

  // ── Fetch periods ──────────────────────────────────────────────────────────
  const fetchPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('P_APPLICATION_NAME', 'General Ledger');
      params.append('P_LEDGER_NAME', selectedLedger);
      const url = `${buildApexUrl("periodsstatus/create?${params.toString()}")}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const result = await response.json();
      const periodSet = new Set<string>();
      (result.items || []).forEach((item: any) => {
        const pid = item.period_name_id || item.PERIOD_NAME_ID || item.periodNameId;
        if (!pid) return;
        if (pid.includes('_')) { const n = extractPeriodName(pid); if (n) periodSet.add(n); }
        else periodSet.add(pid);
      });
      const sorted = Array.from(periodSet).sort((a, b) => parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime());
      setAvailablePeriods(sorted);
    } catch { message.error('Failed to load periods'); }
    finally { setPeriodsLoading(false); }
  }, [selectedLedger]);

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  // ── Fetch segment values ───────────────────────────────────────────────────
  const fetchSegmentValues = useCallback(async () => {
    try {
      const params = new URLSearchParams({ ledger_name: selectedLedger });
      const res = await fetch(`${API_BASE_URL}/segment-values?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSegmentValues(prev => ({
          ...prev,
          lobs: data.lobs || [], departments: data.departments || [],
          subAccounts: data.subAccounts || [], analyses: data.analyses || [],
          intercompanies: data.intercompanies || [], sources: data.sources || [],
          categories: data.categories || [],
        }));
      }
    } catch { /* silent */ }
    try {
      const valRes = await fetch(COMPANY_LOV_URL);
      if (valRes.ok) {
        const valData = await valRes.json();
        const items: any[] = valData.items || [];
        const codes = items.map((i: any) => i.value || i.Value).filter(Boolean);
        const nameMap: Record<string, string> = {};
        items.forEach((i: any) => {
          const code = i.value || i.Value;
          if (code) nameMap[code] = i.description || i.Description || code;
        });
        setSegmentValues(prev => ({ ...prev, companies: codes }));
        setCompanyNames(nameMap);
      }
    } catch { /* silent */ }
  }, [selectedLedger]);

  useEffect(() => { fetchSegmentValues(); }, [fetchSegmentValues]);

  // ── Fetch accounts ─────────────────────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch(`${buildApexUrl("glaccountslist")}`);
      if (res.ok) { const d = await res.json(); setAccountsList(d.items || []); }
    } catch { message.error('Failed to load accounts'); }
    finally { setAccountsLoading(false); }
  }, []);

  // ── Fetch balance rows ─────────────────────────────────────────────────────
  const fetchBalanceRows = async (
    account: string, company: string, period: string
  ): Promise<{ opening: JournalLineSegment | null; closing: JournalLineSegment | null }> => {
    const none = { opening: null, closing: null };
    try {
      let allItems: any[] = [];
      // Single call — the view computes opening/closing for the period dynamically
      const params = new URLSearchParams({ ledger_name: selectedLedger, period_name: period, account });
      if (company) params.append('company', company);
      const resp = await fetch(`${API_BASE_URL}/rr-trialbalance/standard?${params.toString()}`);
      if (resp.ok) {
        const data = await resp.json();
        allItems = (data.items || []).filter((i: any) => String(i.account) === String(account));
      }
      // If no TB row exists the account has zero opening balance — still show the row
      const accountType: string = allItems[0]?.account_type || '';
      const isRetainedEarnings = accountType === 'O';
      const isDebitNormal = accountType === 'A' || accountType === 'E';
      const currencyCode = allItems[0]?.currency_code || 'AED';
      const accountDesc  = allItems[0]?.account_desc  || '';
      const openingAmt    = allItems.reduce((s: number, i: any) => s + (i.opening         || 0), 0);
      const closingAmt    = allItems.reduce((s: number, i: any) => s + (i.closing         || 0), 0);
      const entOpeningAmt = allItems.reduce((s: number, i: any) => s + (i.entered_opening || 0), 0);
      const entClosingAmt = allItems.reduce((s: number, i: any) => s + (i.entered_closing || 0), 0);
      const toDrCr = (amt: number) =>
        isDebitNormal
          ? { dr: amt, cr: 0 }    // debit-normal: preserve sign in Dr (neg = unusual credit balance)
          : { dr: 0, cr: -amt };  // credit-normal: negate into Cr (neg opening → positive Cr = normal credit balance)
      const makeRow = (accAmt: number, entAmt: number, label: string, key: string, isOpen: boolean): JournalLineSegment => {
        const eA = isRetainedEarnings && isOpen ? closingAmt    : accAmt;
        const eE = isRetainedEarnings && isOpen ? entClosingAmt : entAmt;
        const acc = toDrCr(eA), ent = toDrCr(eE);
        return {
          key, batchId: 0, jeHeaderId: 0, jeLineNumber: 0,
          currencyCode, company: (allItems[0]?.company) || company,
          lob: '', department: '', account, subAccount: '', analysis: '',
          intercompany: '', future1: '', future2: '',
          enteredDr: ent.dr, enteredCr: ent.cr, accountedDr: acc.dr, accountedCr: acc.cr,
          chartOfAccountsName: '', accountingDate: '', defaultPeriodName: period,
          batchName: '', actualFlagMeaning: '', approvalStatusMeaning: '',
          userPeriodSetName: '', userJeSourceName: '', ledgerName: selectedLedger,
          legalEntityName: '', userJeCategoryName: '',
          jeLineDescription: label, concatenatedSegments: account, accountDescription: accountDesc,
          isOpeningBalance: isOpen, isClosingBalance: !isOpen, accountType,
        };
      };
      return {
        opening: makeRow(openingAmt,  entOpeningAmt, isRetainedEarnings ? 'Current Year Balance' : 'Opening Balance', 'opening-balance', true),
        closing: makeRow(closingAmt,  entClosingAmt, 'Closing Balance', 'closing-balance', false),
      };
    } catch { return none; }
  };

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    if (selectedPeriods.length === 0 && !fromDate && !toDate) {
      message.warning('Please select at least one period or specify accounting date range');
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ ledger_name: selectedLedger });
      if (selectedPeriods.length > 0) params.append('period_names', selectedPeriods.join(','));
      if (fromDate)           params.append('from_date',    fromDate.format('YYYY-MM-DD'));
      if (toDate)             params.append('to_date',      toDate.format('YYYY-MM-DD'));
      if (selectedCompany)    params.append('company',      selectedCompany);
      if (lobFilter)          params.append('lob',          lobFilter);
      if (departmentFilter)   params.append('department',   departmentFilter);
      if (accountFilter)      params.append('account',      accountFilter);
      if (subAccountFilter)   params.append('sub_account',  subAccountFilter);
      if (analysisFilter)     params.append('analysis',     analysisFilter);
      if (intercompanyFilter) params.append('intercompany', intercompanyFilter);
      if (jeSourceFilter)     params.append('je_source',    jeSourceFilter);
      if (jeCategoryFilter)   params.append('je_category',  jeCategoryFilter);

      let items: JournalLineSegment[] = [];
      let totalCountFromApi = 0;
      try {
        const response = await fetch(`${API_BASE_URL}/accountanalysis?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          const seen = new Set<string>();
          items = (data.items || []).flatMap((item: any, index: number) => {
            const dedupKey = `${item.jeHeaderId ?? item.je_header_id}-${item.jeLineNumber ?? item.je_line_number}`;
            if (seen.has(dedupKey)) return [];
            seen.add(dedupKey);
            return [{
              ...item, key: `${index}`,
              concatenatedSegments: item.accountCombination || item.account_combination ||
                `${item.company}-${item.lob}-${item.department}-${item.account}-${item.subAccount}-${item.analysis}-${item.intercompany}`,
              accountDescription: item.accountDescription || item.account_description || item.ACCOUNT_DESCRIPTION || '',
              jeLineDescription: item.description || item.DESCRIPTION || '',
            }];
          });
          totalCountFromApi = data.totalCount || items.length;
        }
      } catch (err) { console.error('Journal lines fetch error:', err); }

      const finalItems: JournalLineSegment[] = [...items];
      let newClosingRow: JournalLineSegment | null = null;
      if (accountFilter && selectedPeriods.length > 0) {
        const sortedPeriods = [...selectedPeriods].sort((a, b) => parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime());
        const { opening: openingRow, closing: closingRow } = await fetchBalanceRows(accountFilter, selectedCompany, sortedPeriods[0]);
        if (openingRow) finalItems.unshift(openingRow);
        newClosingRow = closingRow;
        setOpeningBalanceRow(openingRow);
      } else {
        setOpeningBalanceRow(null);
      }
      setClosingBalanceRow(newClosingRow);
      setSearchData(finalItems);
      setTotalCount(totalCountFromApi);
      message.success(`Found ${items.length} journal line(s)`);
    } catch (error) {
      message.error('Failed to fetch data. Please try again.');
      setSearchData([]); setOpeningBalanceRow(null); setClosingBalanceRow(null); setTotalCount(0);
    } finally { setLoading(false); }
  };

  const handleReset = () => {
    setSelectedLedger('BUIMERC LEDGER');
    setSelectedCompany(''); setSelectedPeriods([]);
    setFromDate(null); setToDate(null);
    setAccountFilter(''); setAccountFilterDesc('');
    setLobFilter(''); setDepartmentFilter(''); setSubAccountFilter('');
    setAnalysisFilter(''); setIntercompanyFilter('');
    setJeSourceFilter(''); setJeCategoryFilter('');
    setSearchData([]); setTotalCount(0);
    setOpeningBalanceRow(null); setClosingBalanceRow(null);
  };

  const showSearchApiUrl = () => {
    const params = new URLSearchParams({ ledger_name: selectedLedger });
    if (selectedPeriods.length > 0) params.append('period_names', selectedPeriods.join(','));
    if (fromDate)           params.append('from_date',    fromDate.format('YYYY-MM-DD'));
    if (toDate)             params.append('to_date',      toDate.format('YYYY-MM-DD'));
    if (selectedCompany)    params.append('company',      selectedCompany);
    if (lobFilter)          params.append('lob',          lobFilter);
    if (departmentFilter)   params.append('department',   departmentFilter);
    if (accountFilter)      params.append('account',      accountFilter);
    if (subAccountFilter)   params.append('sub_account',  subAccountFilter);
    if (analysisFilter)     params.append('analysis',     analysisFilter);
    if (intercompanyFilter) params.append('intercompany', intercompanyFilter);
    if (jeSourceFilter)     params.append('je_source',    jeSourceFilter);
    if (jeCategoryFilter)   params.append('je_category',  jeCategoryFilter);
    const url = `${API_BASE_URL}/accountanalysis?${params.toString()}`;
    let openingBalUrl = '';
    if (accountFilter && selectedPeriods.length > 0) {
      const sortedPeriods = [...selectedPeriods].sort((a, b) => parsePeriodToDate(a).getTime() - parsePeriodToDate(b).getTime());
      openingBalUrl = `${API_BASE_URL}/rr-trialbalance/standard?ledger_name=${encodeURIComponent(selectedLedger)}&period_name=${encodeURIComponent(sortedPeriods[0])}&account=${encodeURIComponent(accountFilter)}${selectedCompany ? '&company=' + selectedCompany : ''}`;
    }
    Modal.info({
      title: 'API Endpoints', width: 800,
      content: (
        <div style={{ fontFamily: 'monospace', fontSize: 12, padding: '8px 0' }}>
          <div style={{ marginBottom: 8, fontWeight: 'bold', color: '#555' }}>Journal Lines:</div>
          <div style={{ wordBreak: 'break-all', background: '#f5f5f5', padding: 8, borderRadius: 4, marginBottom: 16 }}>{url}</div>
          {openingBalUrl && (<>
            <div style={{ marginBottom: 8, fontWeight: 'bold', color: '#555' }}>Opening Balance:</div>
            <div style={{ wordBreak: 'break-all', background: '#fff8e1', padding: 8, borderRadius: 4 }}>{openingBalUrl}</div>
          </>)}
        </div>
      ),
    });
  };

  const openFullJournal = async (jeHeaderId: number, batchName: string, period: string) => {
    setFullJournalMeta({ batchName, jeHeaderId, period });
    setFullJournalLines([]);
    setFullJournalVisible(true);
    setFullJournalLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/journals/${jeHeaderId}/lines`);
      const data = await res.json();
      setFullJournalLines(data.items || []);
    } catch { message.error('Failed to load journal lines'); }
    finally { setFullJournalLoading(false); }
  };

  // ── Computed values ────────────────────────────────────────────────────────
  const runningBalances = useMemo(() => {
    const result: { accounted: number; entered: number }[] = [];
    let accRun = 0, entRun = 0;
    searchData.forEach(row => {
      accRun += (row.accountedDr || 0) - (row.accountedCr || 0);
      entRun += (row.enteredDr   || 0) - (row.enteredCr   || 0);
      result.push({ accounted: accRun, entered: entRun });
    });
    return result;
  }, [searchData]);

  const gridTotals = useMemo(() =>
    searchData.filter(r => !r.isClosingBalance).reduce(
      (acc, r) => ({
        enteredDr:   acc.enteredDr   + (r.enteredDr   || 0),
        enteredCr:   acc.enteredCr   + (r.enteredCr   || 0),
        accountedDr: acc.accountedDr + (r.accountedDr || 0),
        accountedCr: acc.accountedCr + (r.accountedCr || 0),
      }),
      { enteredDr: 0, enteredCr: 0, accountedDr: 0, accountedCr: 0 }
    ), [searchData]);

  const journalGroups = useMemo(() => {
    const baseLines = journalDrillRecord
      ? searchData.filter(l => l.jeHeaderId === journalDrillRecord.jeHeaderId)
      : searchData;
    const map = new Map<number, {
      key: string; jeHeaderId: number; batchName: string;
      defaultPeriodName: string; userJeSourceName: string; userJeCategoryName: string;
      lines: JournalLineSegment[];
      totalEnteredDr: number; totalEnteredCr: number;
      totalAccountedDr: number; totalAccountedCr: number;
    }>();
    baseLines.forEach(line => {
      if (!map.has(line.jeHeaderId)) {
        map.set(line.jeHeaderId, {
          key: `jg-${line.jeHeaderId}`, jeHeaderId: line.jeHeaderId,
          batchName: line.batchName || '', defaultPeriodName: line.defaultPeriodName,
          userJeSourceName: line.userJeSourceName, userJeCategoryName: line.userJeCategoryName,
          lines: [], totalEnteredDr: 0, totalEnteredCr: 0, totalAccountedDr: 0, totalAccountedCr: 0,
        });
      }
      const g = map.get(line.jeHeaderId)!;
      g.lines.push(line);
      g.totalEnteredDr   += line.enteredDr   || 0;
      g.totalEnteredCr   += line.enteredCr   || 0;
      g.totalAccountedDr += line.accountedDr || 0;
      g.totalAccountedCr += line.accountedCr || 0;
    });
    return Array.from(map.values()).sort((a, b) =>
      a.defaultPeriodName.localeCompare(b.defaultPeriodName) || a.batchName.localeCompare(b.batchName));
  }, [searchData, journalDrillRecord]);

  const pivotData = useMemo((): PivotDataRow[] => {
    const pivotMap = new Map<string, PivotDataRow>();
    const groupBySegments = [...pivotSegsBefore, 'account', ...pivotSegsAfter];
    searchData.forEach(row => {
      const key = groupBySegments.map(s => (row as any)[s] || '').join('-');
      if (!pivotMap.has(key)) {
        pivotMap.set(key, {
          key, account: row.account, accountDescription: row.accountDescription || '',
          company: row.company, lob: row.lob, department: row.department,
          subAccount: row.subAccount, analysis: row.analysis, intercompany: row.intercompany,
          concatenatedSegments: key,
        });
      }
      const pr = pivotMap.get(key)!;
      const periodKey = row.defaultPeriodName;
      pr[`${periodKey}_Dr`] = ((pr[`${periodKey}_Dr`] as number) || 0) + (row.accountedDr || 0);
      pr[`${periodKey}_Cr`] = ((pr[`${periodKey}_Cr`] as number) || 0) + (row.accountedCr || 0);
    });
    return Array.from(pivotMap.values());
  }, [searchData, pivotSegsBefore, pivotSegsAfter]);

  const filteredAccounts = accountsList.filter(item => {
    const s = accountSearchText.toLowerCase();
    return item.account.toLowerCase().includes(s) || item.description.toLowerCase().includes(s);
  });

  // ── Style helpers ──────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = { fontSize: 11, color: REDWOOD.neutral600, marginBottom: 3, fontWeight: 500 };
  const groupBorderLeft  = { borderLeft:  '2px solid #888' };
  const groupBorderRight = { borderRight: '2px solid #888' };
  const headerStyle = (extra?: React.CSSProperties) => ({
    onHeaderCell: () => ({ style: extra }),
    onCell:       () => ({ style: extra }),
  });
  const fmtBalance = (v: number) => {
    const abs = formatNumber(Math.abs(v));
    return v < 0
      ? <span style={{ color: REDWOOD.primary, fontWeight: 600 }}>{abs} Cr</span>
      : <span style={{ color: REDWOOD.success,  fontWeight: 600 }}>{abs}</span>;
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportToExcel = async (data: JournalLineSegment[], title: string) => {
    if (data.length === 0) { message.warning('No data to export'); return; }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ReactERP'; wb.created = new Date();
    const ws = wb.addWorksheet('Account Analysis');
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    const filterLabelFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0D6' } };
    const columnHeaderFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D3D3D' } };
    const accHeaderFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4FF' } };
    const entHeaderFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F7BE' } };
    const totalFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    const white = { argb: 'FFFFFFFF' };
    const numFmt = '#,##0.00';
    const COLS = 16;
    const mergeFull = (row: number) => ws.mergeCells(row, 1, row, COLS);
    mergeFull(1);
    const titleCell = ws.getCell('A1');
    titleCell.value = title;
    titleCell.font = { bold: true, size: 13, color: white };
    titleCell.fill = headerFill;
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 22;
    const filterRows: [string, string][] = [
      ['Ledger',   selectedLedger || '—'],
      ['Company',  selectedCompany || '—'],
      ['Periods',  selectedPeriods.length ? selectedPeriods.join(', ') : '—'],
      ['Account',  accountFilter ? `${accountFilter}${accountFilterDesc ? ' — ' + accountFilterDesc : ''}` : '—'],
      ['Exported', new Date().toLocaleString()],
      ['Records',  String(data.length)],
    ];
    let rowIdx = 2;
    for (const [label, val] of filterRows) {
      ws.mergeCells(rowIdx, 1, rowIdx, 3); ws.mergeCells(rowIdx, 4, rowIdx, COLS);
      const lc = ws.getCell(rowIdx, 1); const vc = ws.getCell(rowIdx, 4);
      lc.value = label; vc.value = val;
      lc.font = { bold: true, size: 10 }; vc.font = { size: 10 };
      lc.fill = filterLabelFill;
      rowIdx++;
    }
    rowIdx++;
    const colHeaders = [
      { label: 'Account',       fill: columnHeaderFill },
      { label: 'Acct Desc',     fill: columnHeaderFill },
      { label: 'Line Desc',     fill: columnHeaderFill },
      { label: 'Period',        fill: columnHeaderFill },
      { label: 'Acctg Date',    fill: columnHeaderFill },
      { label: 'Batch',         fill: columnHeaderFill },
      { label: 'Source',        fill: columnHeaderFill },
      { label: 'Category',      fill: columnHeaderFill },
      { label: 'Currency',      fill: columnHeaderFill },
      { label: 'Acctd Dr',      fill: accHeaderFill },
      { label: 'Acctd Cr',      fill: accHeaderFill },
      { label: 'Acctd Balance', fill: accHeaderFill },
      { label: 'Ent Dr',        fill: entHeaderFill },
      { label: 'Ent Cr',        fill: entHeaderFill },
      { label: 'Ent Balance',   fill: entHeaderFill },
      { label: 'JE Header ID',  fill: columnHeaderFill },
    ];
    colHeaders.forEach((h, i) => {
      const cell = ws.getCell(rowIdx, i + 1);
      cell.value = h.label; cell.fill = h.fill;
      cell.font = { bold: true, size: 10, color: white };
      cell.alignment = { horizontal: 'center' };
    });
    ws.getRow(rowIdx).height = 16;
    rowIdx++;
    let runAccounted = 0, runEntered = 0;
    let totalAccDr = 0, totalAccCr = 0, totalEntDr = 0, totalEntCr = 0;
    data.forEach(row => {
      const accBalance = (row.accountedDr || 0) - (row.accountedCr || 0);
      const entBalance = (row.enteredDr   || 0) - (row.enteredCr   || 0);
      runAccounted += accBalance; runEntered += entBalance;
      totalAccDr += row.accountedDr || 0; totalAccCr += row.accountedCr || 0;
      totalEntDr += row.enteredDr   || 0; totalEntCr += row.enteredCr   || 0;
      const rowData = [
        row.concatenatedSegments, row.accountDescription,
        row.jeLineDescription, row.defaultPeriodName, row.accountingDate,
        row.batchName, row.userJeSourceName, row.userJeCategoryName,
        row.currencyCode, row.accountedDr || null, row.accountedCr || null,
        runAccounted, row.enteredDr || null, row.enteredCr || null,
        runEntered, row.jeHeaderId || null,
      ];
      const exRow = ws.addRow(rowData);
      [10, 11, 12, 13, 14, 15].forEach(c => { if (exRow.getCell(c).value != null) exRow.getCell(c).numFmt = numFmt; });
    });

    // ── Totals row ────────────────────────────────────────────────────────────
    const totalRow = ws.addRow([
      'TOTAL', null, null, null, null, null, null, null, null,
      totalAccDr, totalAccCr, totalAccDr - totalAccCr,
      totalEntDr, totalEntCr, totalEntDr - totalEntCr,
      null,
    ]);
    totalRow.font = { bold: true, size: 10 };
    for (let c = 1; c <= 16; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true, size: 10 };
      if (c >= 10 && c <= 12) {
        cell.numFmt = numFmt;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8CCE4' } };
      } else if (c >= 13 && c <= 15) {
        cell.numFmt = numFmt;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB7E1CD' } };
      } else {
        cell.fill = totalFill;
      }
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF808080' } },
        bottom: { style: 'medium', color: { argb: 'FF808080' } },
      };
    }

    ws.columns.forEach((col, i) => {
      const widths = [28, 24, 30, 10, 12, 28, 14, 16, 8, 14, 14, 14, 12, 12, 14, 12];
      col.width = widths[i] || 14;
    });
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `${title}.xlsx`);
  };

  // ── Grouped dataSource ─────────────────────────────────────────────────────
  const groupedSearchData: JournalLineSegment[] = useMemo(() => {
    if (!groupByAccount) return searchData;
    const opening = searchData.filter(r => r.isOpeningBalance);
    const closing = searchData.filter(r => r.isClosingBalance);
    const normal  = searchData.filter(r => !r.isOpeningBalance && !r.isClosingBalance);

    const groups = new Map<string, JournalLineSegment[]>();
    normal.forEach(row => {
      const k = row.concatenatedSegments || `${row.company}-${row.lob}-${row.department}-${row.account}-${row.subAccount}-${row.analysis}-${row.intercompany}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(row);
    });

    const result: JournalLineSegment[] = [...opening];
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([acct, rows]) => {
      const accDr  = rows.reduce((s, r) => s + (r.accountedDr || 0), 0);
      const accCr  = rows.reduce((s, r) => s + (r.accountedCr || 0), 0);
      const entDr  = rows.reduce((s, r) => s + (r.enteredDr   || 0), 0);
      const entCr  = rows.reduce((s, r) => s + (r.enteredCr   || 0), 0);
      rows.forEach(r => result.push(r));
      result.push({
        ...rows[0], key: `grpftr-${acct}`, isGroupHeader: true,
        groupCount: rows.length,
        groupDr: accDr, groupCr: accCr,
        groupEnteredDr: entDr, groupEnteredCr: entCr,
      });
    });
    result.push(...closing);
    return result;
  }, [searchData, groupByAccount]);

  // Precompute balance lookup for grouped view — O(n) once, not O(n²) per cell
  const groupedBalanceMap = useMemo(() => {
    let di = 0;
    return groupedSearchData.map(row =>
      row.isGroupHeader ? null : (runningBalances[di++] ?? null)
    );
  }, [groupedSearchData, runningBalances]);

  // ── Column definitions ─────────────────────────────────────────────────────
  const searchColumns: ColumnsType<JournalLineSegment> = useMemo(() => [
    {
      title: 'Account', dataIndex: 'concatenatedSegments', key: 'concatenatedSegments',
      width: 240, fixed: 'left',
      render: (text: string, record: JournalLineSegment) =>
        record.isGroupHeader ? (
          <Space size={6}>
            <Text strong style={{ fontSize: 10, color: REDWOOD.neutral600 }}>Subtotal —</Text>
            <Text strong style={{ fontSize: 10 }}>{text || `${record.company}-${record.lob}-${record.department}-${record.account}-${record.subAccount}-${record.analysis}-${record.intercompany}`}</Text>
            <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>{record.groupCount} lines</Tag>
          </Space>
        ) : record.isOpeningBalance ? (
          <Text strong style={{ fontSize: 10, color: REDWOOD.warning }}>{record.jeLineDescription}</Text>
        ) : record.isClosingBalance ? (
          <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{record.jeLineDescription}</Text>
        ) : (
          <a onClick={() => onOpenAccountTab(record, selectedPeriods)}
            style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 10, paddingLeft: groupByAccount ? 14 : 0 }}>
            {text || `${record.company}-${record.lob}-${record.department}-${record.account}-${record.subAccount}-${record.analysis}-${record.intercompany}`}
          </a>
        ),
    },
    {
      title: 'Description', dataIndex: 'accountDescription', key: 'accountDescription',
      width: 180, ellipsis: true,
      render: (text: string, record: JournalLineSegment) =>
        record.isGroupHeader ? null :
        <Tooltip title={text}><span style={{ fontSize: 10 }}>{text || '-'}</span></Tooltip>,
    },
    {
      title: 'Line Description', dataIndex: 'jeLineDescription', key: 'jeLineDescription',
      width: 200, ellipsis: true,
      render: (text: string, record: JournalLineSegment) =>
        record.isGroupHeader ? null : (
          <Tooltip title={text}>
            <span style={{ fontSize: 10, fontWeight: (record.isOpeningBalance || record.isClosingBalance) ? 600 : undefined }}>
              {text || '-'}
            </span>
          </Tooltip>
        ),
    },
    { title: 'Period',    dataIndex: 'defaultPeriodName',  key: 'defaultPeriodName',  width: 80,
      render: (v: string, r: JournalLineSegment) => r.isGroupHeader ? null : v },
    { title: 'Acctg Date', dataIndex: 'accountingDate',   key: 'accountingDate',     width: 100,
      render: (v: string, r: JournalLineSegment) => r.isGroupHeader ? null : v },
    { title: 'Batch',     dataIndex: 'batchName',          key: 'batchName',          width: 150, ellipsis: true,
      render: (v: string, r: JournalLineSegment) => r.isGroupHeader ? null : v },
    { title: 'Source',    dataIndex: 'userJeSourceName',   key: 'userJeSourceName',   width: 100,
      render: (v: string, r: JournalLineSegment) => r.isGroupHeader ? null : v },
    { title: 'Category',  dataIndex: 'userJeCategoryName', key: 'userJeCategoryName', width: 120,
      render: (v: string, r: JournalLineSegment) => r.isGroupHeader ? null : v },
    { title: 'Currency',  dataIndex: 'currencyCode',       key: 'currencyCode',       width: 90,
      render: (v: string, r: JournalLineSegment) => r.isGroupHeader ? null : v },
    // Entered group — shown first when toggle is ON
    ...(showEntered ? [{
      title: <span style={{ color: '#52c41a', fontWeight: 600 }}>Entered</span>,
      onHeaderCell: () => ({ style: groupBorderLeft }),
      children: [
        { title: 'Dr', dataIndex: 'enteredDr', key: 'enteredDr', width: 120, align: 'right' as const,
          ...headerStyle(groupBorderLeft),
          render: (v: number, r: JournalLineSegment) => r.isGroupHeader
            ? <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(r.groupEnteredDr ?? 0)}</Text>
            : <span style={{ color: REDWOOD.success }}>{formatNumber(v)}</span> },
        { title: 'Cr', dataIndex: 'enteredCr', key: 'enteredCr', width: 120, align: 'right' as const,
          render: (v: number, r: JournalLineSegment) => r.isGroupHeader
            ? <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(r.groupEnteredCr ?? 0)}</Text>
            : <span style={{ color: REDWOOD.primary }}>{formatNumber(v)}</span> },
        { title: 'Balance', key: 'enteredRunning', width: 130, align: 'right' as const,
          ...headerStyle(groupBorderRight),
          render: (_: any, r: JournalLineSegment, index: number) => {
            if (r.isGroupHeader) return fmtBalance((r.groupEnteredDr ?? 0) - (r.groupEnteredCr ?? 0));
            return fmtBalance(groupedBalanceMap[index]?.entered ?? 0);
          }},
      ],
    }] : []),
    // Accounted group — always shown
    {
      title: <span style={{ color: '#1677ff', fontWeight: 600 }}>Accounted</span>,
      onHeaderCell: () => ({ style: groupBorderLeft }),
      children: [
        { title: 'Dr', dataIndex: 'accountedDr', key: 'accountedDr', width: 120, align: 'right' as const,
          ...headerStyle(groupBorderLeft),
          render: (v: number, r: JournalLineSegment) => r.isGroupHeader
            ? <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(r.groupDr ?? 0)}</Text>
            : <span style={{ color: REDWOOD.success }}>{formatNumber(v)}</span> },
        { title: 'Cr', dataIndex: 'accountedCr', key: 'accountedCr', width: 120, align: 'right' as const,
          render: (v: number, r: JournalLineSegment) => r.isGroupHeader
            ? <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(r.groupCr ?? 0)}</Text>
            : <span style={{ color: REDWOOD.primary }}>{formatNumber(v)}</span> },
        { title: 'Balance', key: 'accountedRunning', width: 130, align: 'right' as const,
          ...headerStyle(groupBorderRight),
          render: (_: any, r: JournalLineSegment, index: number) => {
            if (r.isGroupHeader) return fmtBalance((r.groupDr ?? 0) - (r.groupCr ?? 0));
            return fmtBalance(groupedBalanceMap[index]?.accounted ?? 0);
          }},
      ],
    },
    {
      title: '', key: 'drillDown', width: 36, fixed: 'right' as const,
      render: (_: any, record: JournalLineSegment) =>
        record.isGroupHeader ? null : (
          <Tooltip title={`View Journal (Header ${record.jeHeaderId})`}>
            <Button type="text" size="small"
              icon={<AuditOutlined style={{ color: REDWOOD.info }} />}
              onClick={(e) => { e.stopPropagation(); setJournalDrillRecord(record); setJournalDrillVisible(true); }}
            />
          </Tooltip>
        ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [groupByAccount, groupedBalanceMap, onOpenAccountTab, selectedPeriods, showEntered]);

  // Memoize filtered display data — stable reference prevents Ant Design Table re-rendering all rows
  const { displayData, filterMatchCount } = useMemo(() => {
    if (!gridFilter) return { displayData: groupedSearchData, filterMatchCount: 0 };
    const q = gridFilter.toLowerCase();
    const matchFields = (r: JournalLineSegment) =>
      [r.concatenatedSegments, r.accountDescription, r.jeLineDescription,
       r.batchName, r.userJeSourceName, r.userJeCategoryName, r.defaultPeriodName, r.currencyCode]
      .some(v => (v || '').toLowerCase().includes(q));

    let matchCount = 0;
    let filtered: JournalLineSegment[];

    if (groupByAccount) {
      filtered = [];
      let pending: JournalLineSegment[] = [];
      groupedSearchData.forEach(row => {
        if (row.isOpeningBalance || row.isClosingBalance) { filtered.push(row); return; }
        if (row.isGroupHeader) {
          const matched = pending.filter(matchFields);
          if (matched.length > 0) {
            matched.forEach(r => filtered.push(r));
            matchCount += matched.length;
            filtered.push({ ...row, groupCount: matched.length,
              groupDr:        matched.reduce((s, r) => s + (r.accountedDr || 0), 0),
              groupCr:        matched.reduce((s, r) => s + (r.accountedCr || 0), 0),
              groupEnteredDr: matched.reduce((s, r) => s + (r.enteredDr   || 0), 0),
              groupEnteredCr: matched.reduce((s, r) => s + (r.enteredCr   || 0), 0),
            });
          }
          pending = [];
        } else {
          pending.push(row);
        }
      });
    } else {
      filtered = groupedSearchData.filter(r => {
        if (r.isOpeningBalance || r.isClosingBalance) return true;
        const m = matchFields(r);
        if (m) matchCount++;
        return m;
      });
    }
    return { displayData: filtered, filterMatchCount: matchCount };
  }, [groupedSearchData, gridFilter, groupByAccount]);


  const pivotColumns: ColumnsType<PivotDataRow> = [
    ...pivotSegsBefore.map(s => ({ title: s, dataIndex: s, key: s, width: 100, fixed: 'left' as const })),
    { title: 'Account',     dataIndex: 'account',            key: 'account',            width: 100, fixed: 'left' as const },
    { title: 'Description', dataIndex: 'accountDescription', key: 'accountDescription', width: 160, fixed: 'left' as const, ellipsis: true },
    ...pivotSegsAfter.map(s => ({ title: s, dataIndex: s, key: s, width: 100, fixed: 'left' as const })),
    ...selectedPeriods.map(period => ({
      title: period, key: period,
      children: [
        { title: 'Dr', key: `${period}_Dr`, dataIndex: `${period}_Dr`, width: 110, align: 'right' as const,
          render: (v: number) => v ? <span style={{ color: REDWOOD.success, fontSize: 10 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 10 }}>—</span> },
        { title: 'Cr', key: `${period}_Cr`, dataIndex: `${period}_Cr`, width: 110, align: 'right' as const,
          render: (v: number) => v ? <span style={{ color: REDWOOD.primary, fontSize: 10 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 10 }}>—</span> },
      ],
    })),
  ];

  const totals = useMemo(() => calculateTotals(searchData), [searchData]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '12px 16px 16px' }}>

      {/* Search Panel */}
      <div style={{
        background: REDWOOD.surface, borderRadius: 10,
        border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14,
        overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '9px 16px',
          background: `linear-gradient(90deg, ${REDWOOD.primary}12 0%, transparent 100%)`,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
          borderLeft: `3px solid ${REDWOOD.primary}`,
        }}>
          <Space size={8}>
            <FilterOutlined style={{ color: REDWOOD.primary, fontSize: 13 }} />
            <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900 }}>Search Parameters</Text>
          </Space>
          <Space size={6}>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}
              loading={loading} size="small"
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, fontSize: 11 }}>
              Search
            </Button>
            <Button icon={<ReloadOutlined />} size="small" onClick={handleReset} style={{ fontSize: 11 }}>Reset</Button>
            <Tooltip title="Log API URL">
              <Button icon={<BugOutlined />} size="small" onClick={showSearchApiUrl}
                style={{ background: '#f0f5ff', borderColor: '#adc6ff', color: '#1d39c4', fontSize: 11 }} />
            </Tooltip>
          </Space>
        </div>

        <div style={{ padding: '12px 16px 10px' }}>
          <Row gutter={[12, 8]} align="bottom">
            <Col xs={24} md={5}>
              <div style={labelStyle}>Ledger</div>
              <Select value={selectedLedger} onChange={setSelectedLedger} style={{ width: '100%' }} size="small">
                {ledgerOptions.map(l => <Option key={l} value={l}>{l}</Option>)}
              </Select>
            </Col>
            <Col xs={24} md={8}>
              <div style={labelStyle}>Periods</div>
              <Select mode="multiple" value={selectedPeriods} onChange={setSelectedPeriods}
                style={{ width: '100%' }} size="small" maxTagCount={4}
                placeholder={periodsLoading ? 'Loading…' : 'Select periods'}
                loading={periodsLoading} disabled={periodsLoading} allowClear
                notFoundContent={periodsLoading ? <Spin size="small" indicator={<LoadingOutlined />} /> : 'No periods'}>
                {availablePeriods.map(p => <Option key={p} value={p}>{p}</Option>)}
              </Select>
            </Col>
            <Col xs={12} md={3}>
              <div style={labelStyle}>Date From</div>
              <DatePicker value={fromDate} onChange={setFromDate} style={{ width: '100%' }} size="small" format="DD-MMM-YYYY" placeholder="From" allowClear />
            </Col>
            <Col xs={12} md={3}>
              <div style={labelStyle}>Date To</div>
              <DatePicker value={toDate} onChange={setToDate} style={{ width: '100%' }} size="small" format="DD-MMM-YYYY" placeholder="To" allowClear
                disabledDate={(d) => !!fromDate && d.isBefore(fromDate, 'day')} />
            </Col>
          </Row>

          <div style={{ margin: '10px 0 8px', padding: '6px 10px', background: REDWOOD.neutral100, borderRadius: 6, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Text style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Account Segments</Text>
          </div>

          <Row gutter={[10, 8]} align="bottom">
            <Col xs={12} sm={8} md={3}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...labelStyle }}>
                Company
                <Tooltip title={`API: ${COMPANY_LOV_URL}`}>
                  <ApiOutlined style={{ fontSize: 10, color: REDWOOD.info, cursor: 'pointer' }}
                    onClick={() => { navigator.clipboard.writeText(COMPANY_LOV_URL); message.info('Copied'); }} />
                </Tooltip>
              </div>
              <Select value={selectedCompany || undefined} onChange={(v) => setSelectedCompany(v ?? '')}
                style={{ width: '100%' }} size="small" placeholder="All" allowClear showSearch optionFilterProp="label">
                {segmentValues.companies.map(c => (
                  <Option key={c} value={c} label={companyNames[c] ? `${c} - ${companyNames[c]}` : c}>
                    {companyNames[c] ? `${c} - ${companyNames[c]}` : c}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={3}>
              <div style={labelStyle}>LOB</div>
              <Select value={lobFilter || undefined} onChange={(v) => setLobFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.lobs.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={3}>
              <div style={labelStyle}>Department</div>
              <Select value={departmentFilter || undefined} onChange={(v) => setDepartmentFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.departments.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <div style={labelStyle}>Account</div>
              <Input.Search allowClear value={accountFilter}
                onChange={(e) => { setAccountFilter(e.target.value); if (!e.target.value) setAccountFilterDesc(''); }}
                style={{ width: '100%' }} size="small" placeholder="e.g. 1116100"
                enterButton={<SearchOutlined />}
                onSearch={() => { setAccountLookupVisible(true); setAccountSearchText(''); if (accountsList.length === 0) fetchAccounts(); }} />
              {accountFilterDesc && <Text style={{ fontSize: 10, color: REDWOOD.info, display: 'block', marginTop: 2 }}>{accountFilterDesc}</Text>}
            </Col>
            <Col xs={12} sm={8} md={3}>
              <div style={labelStyle}>Sub Account</div>
              <Select value={subAccountFilter || undefined} onChange={(v) => setSubAccountFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.subAccounts.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={3}>
              <div style={labelStyle}>Analysis</div>
              <Select value={analysisFilter || undefined} onChange={(v) => setAnalysisFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.analyses.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={3}>
              <div style={labelStyle}>Intercompany</div>
              <Select value={intercompanyFilter || undefined} onChange={(v) => setIntercompanyFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.intercompanies.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={2}>
              <div style={labelStyle}>Source</div>
              <Select value={jeSourceFilter || undefined} onChange={(v) => setJeSourceFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.sources.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
            <Col xs={12} sm={8} md={2}>
              <div style={labelStyle}>Category</div>
              <Select value={jeCategoryFilter || undefined} onChange={(v) => setJeCategoryFilter(v ?? '')} style={{ width: '100%' }} size="small" placeholder="Any" allowClear showSearch>
                {segmentValues.categories.map(v => <Option key={v} value={v}>{v}</Option>)}
              </Select>
            </Col>
          </Row>
        </div>
      </div>

      {/* Results Table */}
      <div style={{
        background: REDWOOD.surface, borderRadius: 10,
        border: `1px solid ${REDWOOD.neutral200}`,
        overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{
          padding: '8px 14px', borderBottom: `1px solid ${REDWOOD.neutral200}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: `linear-gradient(90deg, ${REDWOOD.info}10 0%, transparent 100%)`,
          borderLeft: `3px solid ${REDWOOD.info}`,
        }}>
          <Space size={8}>
            <TableOutlined style={{ color: REDWOOD.info, fontSize: 13 }} />
            <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900 }}>Journal Lines</Text>
            {searchData.length > 0 && (
              <Tag color="blue" style={{ fontSize: 10, padding: '0 6px', lineHeight: '18px' }}>
                {totalCount.toLocaleString()} records
              </Tag>
            )}
          </Space>
          <Space size={6}>
            <Button
              size="small"
              onClick={() => setShowEntered(v => !v)}
              style={{
                fontSize: 11,
                ...(showEntered
                  ? { background: '#f6ffed', borderColor: '#52c41a', color: '#52c41a', fontWeight: 600 }
                  : {}),
              }}
            >
              <Switch size="small" checked={showEntered} style={{ marginRight: 5, pointerEvents: 'none' }} />
              Show Entered
            </Button>
            <Button
              size="small"
              icon={<FilterOutlined />}
              disabled={searchData.length === 0}
              onClick={() => setGroupByAccount(g => !g)}
              style={{ fontSize: 11, ...(groupByAccount ? { background: REDWOOD.info, borderColor: REDWOOD.info, color: '#fff' } : {}) }}
            >
              {groupByAccount ? 'Ungroup' : 'Group by Account'}
            </Button>
            <Button size="small" icon={<PieChartOutlined />} disabled={searchData.length === 0}
              onClick={() => setPivotVisible(true)} style={{ fontSize: 11 }}>
              View Pivot
            </Button>
            <Button size="small" icon={<DownloadOutlined />} disabled={searchData.length === 0}
              onClick={() => exportToExcel(searchData, `GL_Account_Analysis_${selectedPeriods.join('_') || 'All_Periods'}`)}
              style={{ fontSize: 11 }}>
              Export
            </Button>
          </Space>
        </div>

        {/* Grid quick-filter */}
        {searchData.length > 0 && (
          <div style={{ padding: '6px 12px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FilterOutlined style={{ color: REDWOOD.neutral600, fontSize: 11 }} />
            <Input
              size="small"
              allowClear
              placeholder="Filter grid — account, description, batch, source, category…"
              prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
              value={gridFilter}
              onChange={e => setGridFilter(e.target.value)}
              style={{ maxWidth: 480, fontSize: 11 }}
            />
            {gridFilter && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {filterMatchCount} of {searchData.length} rows
              </Text>
            )}
          </div>
        )}

        <Spin spinning={loading}>
          <Table
            columns={searchColumns}
            dataSource={displayData}
            pagination={{ pageSize: searchPageSize, size: 'small', showSizeChanger: true,
              pageSizeOptions: ['10','20','50','100','200'],
              onShowSizeChange: (_, size) => setSearchPageSize(size),
              onChange: (_, size) => size && setSearchPageSize(size),
              showTotal: (total) => `Total ${total} records` }}
            scroll={{ x: 1800 }}
            size="small"
            className="compact-table aa-grid"
            rowClassName={(record: JournalLineSegment) =>
              record.isGroupHeader ? 'aa-group-header-row' :
              record.isOpeningBalance ? 'opening-balance-row' : ''}
            onRow={(record) => record.isGroupHeader ? { style: {
              background: '#e8f0fe',
              borderTop: `2px solid ${REDWOOD.info}55`,
              fontWeight: 600,
            }} : {}}
            locale={{ emptyText: <Empty description="Click Search to load data" /> }}
            summary={() =>
              searchData.length > 0 ? (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0} colSpan={9}>
                      <Text strong style={{ fontSize: 10 }}>Totals</Text>
                    </Table.Summary.Cell>
                    {/* @ts-expect-error antd6 SummaryCell lacks style */}
                    <Table.Summary.Cell index={9} align="right" style={groupBorderLeft}>
                      <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(gridTotals.accountedDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={10} align="right">
                      <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(gridTotals.accountedCr)}</Text>
                    </Table.Summary.Cell>
                    {/* @ts-expect-error antd6 SummaryCell lacks style */}
                    <Table.Summary.Cell index={11} align="right" style={groupBorderRight}>
                      <Text strong style={{ fontSize: 10 }}>{fmtBalance(gridTotals.accountedDr - gridTotals.accountedCr)}</Text>
                    </Table.Summary.Cell>
                    {/* @ts-expect-error antd6 SummaryCell lacks style */}
                    <Table.Summary.Cell index={12} align="right" style={groupBorderLeft}>
                      <Text strong style={{ fontSize: 10, color: REDWOOD.success }}>{formatNumber(gridTotals.enteredDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={13} align="right">
                      <Text strong style={{ fontSize: 10, color: REDWOOD.primary }}>{formatNumber(gridTotals.enteredCr)}</Text>
                    </Table.Summary.Cell>
                    {/* @ts-expect-error antd6 SummaryCell lacks style */}
                    <Table.Summary.Cell index={14} align="right" style={groupBorderRight}>
                      <Text strong style={{ fontSize: 10 }}>{fmtBalance(gridTotals.enteredDr - gridTotals.enteredCr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={15} />
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
        </Spin>

        {/* Balance Summary */}
        {searchData.length > 0 && (
          <div style={{ marginTop: 12, padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ padding: '10px 16px', background: '#f0f5ff', borderRadius: 8, border: '1px solid #adc6ff' }}>
              <Text strong style={{ fontSize: 11, color: '#1677ff', display: 'block', marginBottom: 8 }}>Accounted</Text>
              <Row gutter={0} align="middle">
                {[
                  { label: 'Opening Balance', value: openingBalanceRow ? (openingBalanceRow.accountedDr||0)-(openingBalanceRow.accountedCr||0) : null, border: true },
                  { label: 'PTD Debits',      value: totals.accountedDr, border: true },
                  { label: 'PTD Credits',     value: totals.accountedCr, border: true },
                  { label: 'Closing Balance', value: closingBalanceRow ? (closingBalanceRow.accountedDr||0)-(closingBalanceRow.accountedCr||0) : null, border: false },
                ].map(({ label, value, border }) => (
                  <Col key={label} flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: border ? '1px solid #adc6ff' : undefined }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{label}</Text>
                    <Text strong style={{ fontSize: 14 }}>{value != null ? fmtBalance(value) : '—'}</Text>
                  </Col>
                ))}
              </Row>
            </div>
            <div style={{ padding: '10px 16px', background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
              <Text strong style={{ fontSize: 11, color: '#52c41a', display: 'block', marginBottom: 8 }}>Entered</Text>
              <Row gutter={0} align="middle">
                {[
                  { label: 'Opening Balance', value: openingBalanceRow ? (openingBalanceRow.enteredDr||0)-(openingBalanceRow.enteredCr||0) : null, border: true },
                  { label: 'PTD Debits',      value: totals.enteredDr, border: true },
                  { label: 'PTD Credits',     value: totals.enteredCr, border: true },
                  { label: 'Closing Balance', value: closingBalanceRow ? (closingBalanceRow.enteredDr||0)-(closingBalanceRow.enteredCr||0) : null, border: false },
                ].map(({ label, value, border }) => (
                  <Col key={label} flex="1" style={{ textAlign: 'center', padding: '4px 12px', borderRight: border ? '1px solid #b7eb8f' : undefined }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{label}</Text>
                    <Text strong style={{ fontSize: 14 }}>{value != null ? fmtBalance(value) : '—'}</Text>
                  </Col>
                ))}
              </Row>
            </div>
          </div>
        )}
      </div>

      {/* ── Account Lookup Modal ── */}
      <Modal title="Select Account" open={accountLookupVisible} onCancel={() => setAccountLookupVisible(false)}
        footer={null} width={700} style={{ top: 80 }}>
        <Input placeholder="Search account or description…" value={accountSearchText}
          onChange={e => setAccountSearchText(e.target.value)}
          prefix={<SearchOutlined />} style={{ marginBottom: 12 }} allowClear />
        <Spin spinning={accountsLoading} indicator={<LoadingOutlined />}>
          <Table
            dataSource={filteredAccounts.map((a, i) => ({ ...a, key: i }))}
            size="small" pagination={{ pageSize: 12, size: 'small' }}
            onRow={record => ({ onClick: () => { setAccountFilter(record.account); setAccountFilterDesc(record.description); setAccountLookupVisible(false); } })}
            columns={[
              { title: 'Account', dataIndex: 'account', key: 'account', width: 130 },
              { title: 'Description', dataIndex: 'description', key: 'description' },
              { title: 'Type', dataIndex: 'account_type', key: 'account_type', width: 60 },
            ]}
          />
        </Spin>
      </Modal>

      {/* ── Journal Drill Modal ── */}
      <Modal
        title={
          <Space>
            <AuditOutlined style={{ color: REDWOOD.info }} />
            <Text strong>Journal Breakdown</Text>
            {journalDrillRecord && (
              <>
                <Tag color="blue">{journalDrillRecord.account}</Tag>
                {journalDrillRecord.accountDescription && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{journalDrillRecord.accountDescription}</Text>
                )}
              </>
            )}
            <Tag color="geekblue" style={{ fontSize: 11 }}>{journalGroups.length} journal{journalGroups.length !== 1 ? 's' : ''}</Tag>
            <Tooltip title="Show search API URL">
              <Button size="small" type="text" icon={<LinkOutlined />}
                style={{ color: REDWOOD.info, fontSize: 11 }} onClick={() => showSearchApiUrl()} />
            </Tooltip>
          </Space>
        }
        open={journalDrillVisible} onCancel={() => setJournalDrillVisible(false)}
        footer={null} width={1200} style={{ top: 20 }}
      >
        <Table
          dataSource={journalGroups} rowKey="key" size="small" pagination={false} scroll={{ x: 900 }}
          expandable={{
            defaultExpandedRowKeys: journalDrillRecord ? [`jg-${journalDrillRecord.jeHeaderId}`] : [],
            expandedRowRender: (group) => {
              const seenLines = new Set<number>();
              const uniqueLines = group.lines.filter(l => { if (seenLines.has(l.jeLineNumber)) return false; seenLines.add(l.jeLineNumber); return true; });
              return (
                <Table
                  dataSource={uniqueLines.map((l, i) => ({ ...l, key: `${group.jeHeaderId}-${i}` }))}
                  size="small" pagination={false} style={{ margin: '4px 0' }}
                  columns={[
                    { title: '#', dataIndex: 'jeLineNumber', key: 'jeLineNumber', width: 40 },
                    { title: 'Line Description', dataIndex: 'jeLineDescription', key: 'jeLineDescription', ellipsis: true,
                      render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11 }}>{v || '-'}</span></Tooltip> },
                    { title: 'Account', dataIndex: 'concatenatedSegments', key: 'concatenatedSegments', width: 200,
                      render: (v: string) => <Text code style={{ fontSize: 10 }}>{v}</Text> },
                    { title: 'Account Desc', dataIndex: 'accountDescription', key: 'accountDescription', width: 150, ellipsis: true,
                      render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '-'}</span></Tooltip> },
                    { title: 'Entered Dr',   dataIndex: 'enteredDr',   key: 'enteredDr',   width: 105, align: 'right' as const,
                      render: (v: number) => v ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
                    { title: 'Entered Cr',   dataIndex: 'enteredCr',   key: 'enteredCr',   width: 105, align: 'right' as const,
                      render: (v: number) => v ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
                    { title: 'Accounted Dr', dataIndex: 'accountedDr', key: 'accountedDr', width: 110, align: 'right' as const,
                      render: (v: number) => v ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
                    { title: 'Accounted Cr', dataIndex: 'accountedCr', key: 'accountedCr', width: 110, align: 'right' as const,
                      render: (v: number) => v ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
                    { title: 'Ccy', dataIndex: 'currencyCode', key: 'currencyCode', width: 50,
                      render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
                  ]}
                />
              );
            },
          }}
          columns={[
            { title: 'Period', dataIndex: 'defaultPeriodName', key: 'defaultPeriodName', width: 80,
              render: (v: string) => <Tag color="geekblue" style={{ fontSize: 11 }}>{v}</Tag> },
            { title: 'Batch / Journal', dataIndex: 'batchName', key: 'batchName', ellipsis: true,
              render: (v: string, rec) => (
                <Tooltip title={v || `JE Header #${rec.jeHeaderId}`}>
                  <div style={{ lineHeight: 1.3 }}>
                    <Text strong style={{ fontSize: 11, display: 'block' }}>
                      {v || <Text type="secondary" style={{ fontSize: 11 }}>JE Header #{rec.jeHeaderId}</Text>}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>ID: {rec.jeHeaderId}</Text>
                  </div>
                </Tooltip>
              ),
            },
            { title: 'Source',   dataIndex: 'userJeSourceName',   key: 'userJeSourceName',   width: 110, render: (v: string) => <span style={{ fontSize: 11 }}>{v}</span> },
            { title: 'Category', dataIndex: 'userJeCategoryName', key: 'userJeCategoryName', width: 110, render: (v: string) => <span style={{ fontSize: 11 }}>{v}</span> },
            { title: 'Lines', key: 'lineCount', width: 50, align: 'center' as const, render: (_: any, rec) => <Tag style={{ fontSize: 10 }}>{rec.lines.length}</Tag> },
            { title: 'Entered Dr',   key: 'totalEnteredDr',   width: 110, align: 'right' as const,
              render: (_: any, rec) => rec.totalEnteredDr   ? <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(rec.totalEnteredDr)}</Text>   : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
            { title: 'Entered Cr',   key: 'totalEnteredCr',   width: 110, align: 'right' as const,
              render: (_: any, rec) => rec.totalEnteredCr   ? <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(rec.totalEnteredCr)}</Text>   : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
            { title: 'Accounted Dr', key: 'totalAccountedDr', width: 110, align: 'right' as const,
              render: (_: any, rec) => rec.totalAccountedDr ? <Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(rec.totalAccountedDr)}</Text> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
            { title: 'Accounted Cr', key: 'totalAccountedCr', width: 110, align: 'right' as const,
              render: (_: any, rec) => rec.totalAccountedCr ? <Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(rec.totalAccountedCr)}</Text> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
            { title: '', key: 'fullJournal', width: 130,
              render: (_: any, rec) => (
                <Button size="small" type="link" icon={<AuditOutlined />} style={{ fontSize: 11 }}
                  onClick={e => { e.stopPropagation(); openFullJournal(rec.jeHeaderId, rec.batchName, rec.defaultPeriodName); }}>
                  Full Journal
                </Button>
              ),
            },
          ]}
          summary={() => {
            const totEntDr  = journalGroups.reduce((s, g) => s + g.totalEnteredDr,   0);
            const totEntCr  = journalGroups.reduce((s, g) => s + g.totalEnteredCr,   0);
            const totAccDr  = journalGroups.reduce((s, g) => s + g.totalAccountedDr, 0);
            const totAccCr  = journalGroups.reduce((s, g) => s + g.totalAccountedCr, 0);
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                  <Table.Summary.Cell index={0} colSpan={6}>
                    <Text strong style={{ fontSize: 11 }}>Grand Total ({journalGroups.length} journal{journalGroups.length !== 1 ? 's' : ''})</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right"><Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(totEntDr)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right"><Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(totEntCr)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={8} align="right"><Text strong style={{ fontSize: 11, color: REDWOOD.success }}>{formatNumber(totAccDr)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={9} align="right"><Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{formatNumber(totAccCr)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={10} />
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </Modal>

      {/* ── Full Journal Modal ── */}
      <Modal
        title={fullJournalMeta && (
          <Space>
            <AuditOutlined style={{ color: REDWOOD.success }} />
            <Text strong>Full Journal</Text>
            <Tag color="geekblue">{fullJournalMeta.period}</Tag>
            <Tooltip title={fullJournalMeta.batchName}>
              <Text style={{ fontSize: 12, maxWidth: 400 }} ellipsis>{fullJournalMeta.batchName}</Text>
            </Tooltip>
            <Text type="secondary" style={{ fontSize: 11 }}>#{fullJournalMeta.jeHeaderId}</Text>
          </Space>
        )}
        open={fullJournalVisible} onCancel={() => setFullJournalVisible(false)}
        footer={null} width={1100} style={{ top: 30 }} zIndex={1100}
      >
        <Spin spinning={fullJournalLoading} indicator={<LoadingOutlined />}>
          <Table
            dataSource={fullJournalLines.map((l: any, i: number) => ({ ...l, key: i }))}
            size="small" pagination={{ pageSize: 25, size: 'small', showTotal: (t) => `${t} lines` }}
            scroll={{ x: 900 }}
            columns={[
              { title: '#', dataIndex: 'lineNum', key: 'lineNum', width: 44 },
              { title: 'Account', dataIndex: 'account', key: 'account', width: 220,
                render: (v: string) => <Text code style={{ fontSize: 11 }}>{v || '-'}</Text> },
              { title: 'Account Desc', dataIndex: 'accountDescription', key: 'accountDescription', width: 150, ellipsis: true,
                render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '-'}</span></Tooltip> },
              { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
                render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11 }}>{v || '-'}</span></Tooltip> },
              { title: 'Entered Dr', dataIndex: 'enteredDr', key: 'enteredDr', width: 115, align: 'right' as const,
                render: (v: number) => v ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
              { title: 'Entered Cr', dataIndex: 'enteredCr', key: 'enteredCr', width: 115, align: 'right' as const,
                render: (v: number) => v ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
              { title: 'Accounted Dr', dataIndex: 'accountedDr', key: 'accountedDr', width: 115, align: 'right' as const,
                render: (v: number) => v ? <span style={{ color: REDWOOD.success, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
              { title: 'Accounted Cr', dataIndex: 'accountedCr', key: 'accountedCr', width: 115, align: 'right' as const,
                render: (v: number) => v ? <span style={{ color: REDWOOD.primary, fontSize: 11 }}>{formatNumber(v)}</span> : <span style={{ color: REDWOOD.neutral300, fontSize: 11 }}>—</span> },
            ]}
          />
        </Spin>
      </Modal>

      {/* ── Pivot Modal ── */}
      <Modal title={
          <Space>
            <PieChartOutlined style={{ color: REDWOOD.info }} />
            <Text strong>All Accounts Pivot — {selectedPeriods.join(', ')}</Text>
          </Space>
        }
        open={pivotVisible} onCancel={() => setPivotVisible(false)}
        footer={null} width="95vw" style={{ top: 20 }}
      >
        <div style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Drag segments to group by before or after Account:</Text>
          <Row gutter={8} style={{ marginTop: 6 }}>
            {['company','lob','department','subAccount','analysis','intercompany'].map(seg => (
              <Col key={seg}>
                <Space size={4}>
                  <Button size="small"
                    type={pivotSegsBefore.includes(seg) ? 'primary' : 'default'}
                    onClick={() => {
                      if (pivotSegsBefore.includes(seg)) {
                        setPivotSegsBefore(pivotSegsBefore.filter(s => s !== seg));
                      } else {
                        setPivotSegsAfter(pivotSegsAfter.filter(s => s !== seg));
                        setPivotSegsBefore([...pivotSegsBefore, seg]);
                      }
                    }}
                    style={{ fontSize: 10 }}>
                    {seg} (before)
                  </Button>
                  <Button size="small"
                    type={pivotSegsAfter.includes(seg) ? 'primary' : 'default'}
                    onClick={() => {
                      if (pivotSegsAfter.includes(seg)) {
                        setPivotSegsAfter(pivotSegsAfter.filter(s => s !== seg));
                      } else {
                        setPivotSegsBefore(pivotSegsBefore.filter(s => s !== seg));
                        setPivotSegsAfter([...pivotSegsAfter, seg]);
                      }
                    }}
                    style={{ fontSize: 10 }}>
                    {seg} (after)
                  </Button>
                </Space>
              </Col>
            ))}
          </Row>
        </div>
        <Table
          columns={pivotColumns} dataSource={pivotData}
          pagination={false} scroll={{ x: 800 }} size="small"
          className="compact-table aa-grid"
        />
      </Modal>

    </div>
  );
};
