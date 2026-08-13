import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Card, Table, Button, Space, Typography, Breadcrumb, Tag,
  Row, Col, Select, Statistic, Spin, Alert, Input, Tooltip, Divider,
  Popover, Badge, message, Progress,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
// antd 6 SummaryCellProps omits style — use this cast helper where needed
const SummaryCell = Table.Summary.Cell as React.ComponentType<React.ComponentProps<typeof Table.Summary.Cell> & { style?: React.CSSProperties }>;
import {
  HomeOutlined, ReloadOutlined, CalculatorOutlined, PlayCircleOutlined,
  FilterOutlined, FileExcelOutlined, ApiOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined, SearchOutlined, InfoCircleOutlined,
  AccountBookOutlined, SyncOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

// ── Oracle Redwood palette ──────────────────────────────────
const REDWOOD = {
  primary:    '#C74634',
  primaryDark:'#A33B2C',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  error:      '#D93025',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
  textPrimary:'#1A1A1A',
  textSecondary:'#6B6B6B',
};

// Account type labels and colors
const ACCT_TYPE: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: 'Asset',     color: '#0572CE', bg: '#E6F4FF' },
  L: { label: 'Liability', color: '#722ED1', bg: '#F9F0FF' },
  O: { label: 'Equity',    color: '#1D7B4D', bg: '#F6FFED' },
  R: { label: 'Revenue',   color: '#0F8B8D', bg: '#E6FFFB' },
  E: { label: 'Expense',   color: '#D46B08', bg: '#FFF7E6' },
};

// ── Types ───────────────────────────────────────────────────
interface TBRow {
  tb_id: number;
  ledger_name: string;
  period_name: string;
  period_year: number;
  period_num: number;
  currency_code: string | null;
  account_combination: string;
  company: string | null;
  lob: string | null;
  department: string | null;
  account: string | null;
  account_desc: string | null;
  sub_account: string | null;
  analysis: string | null;
  intercompany: string | null;
  future1: string | null;
  future2: string | null;
  account_type: string | null;
  opening_dr: number;
  opening_cr: number;
  ptd_dr: number;
  ptd_cr: number;
  ytd_dr: number;
  ytd_cr: number;
  closing_dr: number;
  closing_cr: number;
  run_date: string | null;
}

interface GenerateResult {
  success: boolean;
  inserted: number;
  updated: number;
  errors: number;
  error_msg: string | null;
  message: string;
  elapsed_sec: number;
  ledger_name: string | null;
  period_year: number | null;
  period_name: string | null;
}

interface LedgerOption { ledger_name: string }
interface PeriodOption { period_name: string; period_year: number; period_num: number }

// ── Helpers ─────────────────────────────────────────────────
const fmt = (n: number) =>
  n === 0 ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCcy = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Component ───────────────────────────────────────────────
const GenerateTrialBalance: React.FC = () => {
  // Parameters
  const [ledgerName, setLedgerName]   = useState<string>('');
  const [periodYear, setPeriodYear]   = useState<number | null>(new Date().getFullYear());
  const [periodName, setPeriodName]   = useState<string | null>(null); // null = all periods
  const [companyName, setCompanyName] = useState<string | null>(null); // null = all companies

  // Dropdowns
  const [ledgers,        setLedgers]        = useState<string[]>([]);
  const [periods,        setPeriods]        = useState<PeriodOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);

  // Data
  const [data,     setData]     = useState<TBRow[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult]   = useState<GenerateResult | null>(null);

  // Filters
  const [filterType,    setFilterType]    = useState<string | null>(null);
  const [filterCompany, setFilterCompany] = useState<string | null>(null);
  const [filterSearch,  setFilterSearch]  = useState('');

  // API panel
  const [apiPanelVisible, setApiPanelVisible] = useState(false);
  const [apiCalls, setApiCalls] = useState<Record<string, {
    label: string; url: string; method: string;
    status: number | null; ok: boolean | null; durationMs: number | null; running: boolean;
    body: string; requestBody: string;
  }>>({
    ledgers:   { label: 'GET Ledgers',       url: `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.getLedgerName}`,            method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '', requestBody: '' },
    companies: { label: 'GET Companies',    url: '',                                                                                 method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '', requestBody: '' },
    periods:   { label: 'GET Periods',      url: '',                                                                                 method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '', requestBody: '' },
    fetch:     { label: 'GET Trial Balance',url: '',                                                                                 method: 'GET',  status: null, ok: null, durationMs: null, running: false, body: '', requestBody: '' },
    generate:  { label: 'POST Generate TB', url: `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceGenerate}`,    method: 'POST', status: null, ok: null, durationMs: null, running: false, body: '', requestBody: '' },
  });

  const trackCall = (key: string, url: string, requestBody: string = '') => {
    setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], url, status: null, ok: null, durationMs: null, running: true, body: '', requestBody } }));
    return performance.now();
  };
  const resolveCall = (key: string, t0: number, status: number, ok: boolean, body: string) => {
    setApiCalls(prev => ({ ...prev, [key]: { ...prev[key], status, ok, durationMs: Math.round(performance.now() - t0), running: false, body } }));
  };
  const testEndpoint = async (key: string) => {
    const call = apiCalls[key];
    if (!call.url || call.method !== 'GET') return;
    const t0 = trackCall(key, call.url);
    try {
      const res = await fetch(call.url);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}
      resolveCall(key, t0, res.status, res.ok, pretty.slice(0, 1000));
    } catch (e: any) {
      resolveCall(key, t0, 0, false, e.message);
    }
  };

  // ── Fetch ledger options ─────────────────────────────────
  const fetchLedgers = useCallback(async () => {
    const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.getLedgerName}`;
    const t0 = trackCall('ledgers', url);
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        resolveCall('ledgers', t0, res.status, false, text);
        message.error(`Failed to load ledgers: HTTP ${res.status}`);
        return;
      }
      const json = JSON.parse(text);
      const names = (json.items || []).map((r: LedgerOption) => r.ledger_name).filter(Boolean);
      resolveCall('ledgers', t0, res.status, true, `${names.length} ledgers returned`);
      setLedgers(names);
      if (names.length > 0) setLedgerName(names[0]);
    } catch (e: any) {
      resolveCall('ledgers', t0, 0, false, e.message);
      message.error(`Failed to load ledgers: ${e.message}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch period options ─────────────────────────────────
  const fetchPeriods = useCallback(async (ledger: string, year: number | null) => {
    if (!ledger) return;
    const params = new URLSearchParams();
    params.set('ledger_name', ledger);
    if (year) params.set('period_year', String(year));
    const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalancePeriods}?${params}`;
    const t0 = trackCall('periods', url);
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) { resolveCall('periods', t0, res.status, false, text); return; }
      const json = JSON.parse(text);
      resolveCall('periods', t0, res.status, true, `${(json.items || []).length} periods`);
      setPeriods(json.items || []);
    } catch (e: any) {
      resolveCall('periods', t0, 0, false, e.message);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch company options ────────────────────────────────
  const fetchCompanies = useCallback(async (ledger: string) => {
    if (!ledger) return;
    const params = new URLSearchParams({ ledger_name: ledger });
    const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceCompanies}?${params}`;
    const t0 = trackCall('companies', url);
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) { resolveCall('companies', t0, res.status, false, text); return; }
      const json = JSON.parse(text);
      const names = (json.items || []).map((r: any) => r.company).filter(Boolean);
      resolveCall('companies', t0, res.status, true, `${names.length} companies`);
      setCompanyOptions(names);
    } catch (e: any) {
      resolveCall('companies', t0, 0, false, e.message);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchLedgers(); }, [fetchLedgers]);

  useEffect(() => {
    if (ledgerName) {
      fetchPeriods(ledgerName, periodYear);
      fetchCompanies(ledgerName);
    }
  }, [ledgerName, periodYear, fetchPeriods, fetchCompanies]);

  // ── Fetch TB data ────────────────────────────────────────
  const fetchTB = useCallback(async () => {
    if (!ledgerName) { message.warning('Please select a ledger'); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('ledger_name', ledgerName);
      if (periodYear)   params.set('period_year',   String(periodYear));
      if (periodName)   params.set('period_name',   periodName);
      if (companyName)  params.set('company',        companyName);
      if (filterType)   params.set('account_type',  filterType);
      if (filterCompany) params.set('company',       filterCompany); // client-side override
      params.set('limit', '10000');
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalance}?${params}`;
      const t0 = trackCall('fetch', url);
      const res = await fetch(url);
      if (!res.ok) { resolveCall('fetch', t0, res.status, false, res.statusText); throw new Error(`HTTP ${res.status}`); }
      const json = await res.json();
      resolveCall('fetch', t0, res.status, true, `${(json.items || []).length} rows`);
      setData(json.items || []);
    } catch (e: any) {
      message.error('Failed to load TB data: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [ledgerName, periodYear, periodName, companyName, filterType, filterCompany]);

  // ── Generate TB ──────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!ledgerName) { message.warning('Please select a ledger'); return; }
    setGenerating(true);
    setGenResult(null);
    try {
      const body = {
        p_ledger_name: ledgerName || null,
        p_period_year: periodYear || null,
        p_period_name: periodName || null,
        p_company:     companyName || null,
      };
      const url = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceGenerate}`;
      const t0 = trackCall('generate', url, JSON.stringify(body, null, 2));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: GenerateResult;
      try {
        json = JSON.parse(text);
      } catch (_) {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      resolveCall('generate', t0, res.status, res.ok, json.message || '');
      setGenResult(json);
      if (json.error_msg && !json.success) {
        message.error(json.error_msg);
      } else {
        message.success(json.message || 'Trial Balance generated');
        await fetchTB();
      }
    } catch (e: any) {
      message.error('Generate error: ' + e.message);
    } finally {
      setGenerating(false);
    }
  }, [ledgerName, periodYear, periodName, fetchTB]);

  // ── Client-side filtering ────────────────────────────────
  const filteredData = useMemo(() => {
    let rows = data;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      rows = rows.filter(r =>
        (r.account_combination || '').toLowerCase().includes(q) ||
        (r.account || '').toLowerCase().includes(q) ||
        (r.account_desc || '').toLowerCase().includes(q) ||
        (r.company || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, filterSearch]);

  // ── Companies for filter dropdown ────────────────────────
  const companies = useMemo(() =>
    [...new Set(data.map(r => r.company).filter(Boolean) as string[])].sort(),
  [data]);

  // ── KPI calculations ─────────────────────────────────────
  const kpi = useMemo(() => {
    const sum = (fn: (r: TBRow) => number) => filteredData.reduce((s, r) => s + fn(r), 0);
    return {
      rows:        filteredData.length,
      openingDr:   sum(r => r.opening_dr),
      openingCr:   sum(r => r.opening_cr),
      ptdDr:       sum(r => r.ptd_dr),
      ptdCr:       sum(r => r.ptd_cr),
      ytdDr:       sum(r => r.ytd_dr),
      ytdCr:       sum(r => r.ytd_cr),
      closingDr:   sum(r => r.closing_dr),
      closingCr:   sum(r => r.closing_cr),
    };
  }, [filteredData]);

  // ── Account type summary ──────────────────────────────────
  const typeSummary = useMemo(() => {
    const map: Record<string, number> = {};
    data.forEach(r => {
      const k = r.account_type || '?';
      map[k] = (map[k] || 0) + 1;
    });
    return map;
  }, [data]);

  // ── Export to Excel ──────────────────────────────────────
  const handleExport = () => {
    if (!filteredData.length) { message.warning('No data to export'); return; }
    const rows = filteredData.map(r => ({
      'Ledger':          r.ledger_name,
      'Period':          r.period_name,
      'Year':            r.period_year,
      'Currency':        r.currency_code,
      'Account Combo':   r.account_combination,
      'Company':         r.company,
      'LOB':             r.lob,
      'Department':      r.department,
      'Account':         r.account,
      'Description':     r.account_desc,
      'Type':            ACCT_TYPE[r.account_type || '']?.label || r.account_type,
      'Opening DR':      r.opening_dr,
      'Opening CR':      r.opening_cr,
      'PTD DR':          r.ptd_dr,
      'PTD CR':          r.ptd_cr,
      'YTD DR':          r.ytd_dr,
      'YTD CR':          r.ytd_cr,
      'Closing DR':      r.closing_dr,
      'Closing CR':      r.closing_cr,
      'Run Date':        r.run_date,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trial Balance');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `RR_TrialBalance_${ledgerName}_${periodYear || 'All'}_${periodName || 'AllPeriods'}.xlsx`);
  };

  // ── Table columns ────────────────────────────────────────
  const columns: ColumnsType<TBRow> = [
    {
      title: 'Type',
      dataIndex: 'account_type',
      key: 'account_type',
      width: 80,
      fixed: 'left',
      filters: Object.entries(ACCT_TYPE).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (val, r) => r.account_type === val,
      render: (v: string) => {
        const t = ACCT_TYPE[v] || { label: v || '?', color: '#888', bg: '#f5f5f5' };
        return (
          <Tag style={{
            background: t.bg, color: t.color, border: `1px solid ${t.color}33`,
            fontSize: 10, padding: '0 5px', margin: 0, fontWeight: 600,
          }}>
            {t.label}
          </Tag>
        );
      },
    },
    {
      title: 'Account',
      dataIndex: 'account',
      key: 'account',
      width: 100,
      fixed: 'left',
      sorter: (a, b) => (a.account || '').localeCompare(b.account || ''),
      render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'account_desc',
      key: 'account_desc',
      width: 160,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Company',
      dataIndex: 'company',
      key: 'company',
      width: 80,
      render: (v: string) => <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{v || '—'}</Text>,
    },
    {
      title: 'LOB',
      dataIndex: 'lob',
      key: 'lob',
      width: 70,
      render: (v: string) => <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{v || '—'}</Text>,
    },
    {
      title: 'Dept',
      dataIndex: 'department',
      key: 'department',
      width: 70,
      render: (v: string) => <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{v || '—'}</Text>,
    },
    {
      title: 'Period',
      dataIndex: 'period_name',
      key: 'period_name',
      width: 80,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    // ── Opening ──────────────────────────────────────────
    {
      title: <span style={{ color: '#0572CE' }}>Opening DR</span>,
      dataIndex: 'opening_dr',
      key: 'opening_dr',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.opening_dr - b.opening_dr,
      render: (v: number) => (
        <Text style={{ fontSize: 11, color: v > 0 ? '#0572CE' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    {
      title: <span style={{ color: '#722ED1' }}>Opening CR</span>,
      dataIndex: 'opening_cr',
      key: 'opening_cr',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.opening_cr - b.opening_cr,
      render: (v: number) => (
        <Text style={{ fontSize: 11, color: v > 0 ? '#722ED1' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    // ── PTD ───────────────────────────────────────────────
    {
      title: <span style={{ color: '#1D7B4D' }}>PTD DR</span>,
      dataIndex: 'ptd_dr',
      key: 'ptd_dr',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.ptd_dr - b.ptd_dr,
      render: (v: number) => (
        <Text style={{ fontSize: 11, color: v > 0 ? '#1D7B4D' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    {
      title: <span style={{ color: REDWOOD.primary }}>PTD CR</span>,
      dataIndex: 'ptd_cr',
      key: 'ptd_cr',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.ptd_cr - b.ptd_cr,
      render: (v: number) => (
        <Text style={{ fontSize: 11, color: v > 0 ? REDWOOD.primary : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    // ── YTD ───────────────────────────────────────────────
    {
      title: <span style={{ color: '#0F8B8D' }}>YTD DR</span>,
      dataIndex: 'ytd_dr',
      key: 'ytd_dr',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.ytd_dr - b.ytd_dr,
      render: (v: number) => (
        <Text style={{ fontSize: 11, color: v > 0 ? '#0F8B8D' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    {
      title: <span style={{ color: '#D46B08' }}>YTD CR</span>,
      dataIndex: 'ytd_cr',
      key: 'ytd_cr',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.ytd_cr - b.ytd_cr,
      render: (v: number) => (
        <Text style={{ fontSize: 11, color: v > 0 ? '#D46B08' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    // ── Closing ───────────────────────────────────────────
    {
      title: <span style={{ color: '#0572CE', fontWeight: 700 }}>Closing DR</span>,
      dataIndex: 'closing_dr',
      key: 'closing_dr',
      align: 'right',
      width: 120,
      sorter: (a, b) => a.closing_dr - b.closing_dr,
      render: (v: number) => (
        <Text strong style={{ fontSize: 11, color: v > 0 ? '#0572CE' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
    {
      title: <span style={{ color: '#722ED1', fontWeight: 700 }}>Closing CR</span>,
      dataIndex: 'closing_cr',
      key: 'closing_cr',
      align: 'right',
      width: 120,
      sorter: (a, b) => a.closing_cr - b.closing_cr,
      render: (v: number) => (
        <Text strong style={{ fontSize: 11, color: v > 0 ? '#722ED1' : REDWOOD.textSecondary }}>
          {fmt(v)}
        </Text>
      ),
    },
  ];

  // ── Table summary row ────────────────────────────────────
  // Wrapped in <Table.Summary fixed> so the row scrolls in sync with the
  // table body and the fixed-left Type/Account columns stay pinned correctly.
  const tableSummary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 700 }}>
        {/* Fixed-left span: Type + Account */}
        <SummaryCell index={0} colSpan={2} style={{ background: REDWOOD.neutral100 }}>
          <Text strong style={{ fontSize: 11 }}>
            TOTAL ({filteredData.length.toLocaleString()} rows)
          </Text>
        </SummaryCell>
        {/* Non-fixed non-numeric cols: Description, Company, LOB, Dept, Period */}
        <SummaryCell index={2} colSpan={5} style={{ background: REDWOOD.neutral100 }} />
        {/* Numeric columns */}
        {[kpi.openingDr, kpi.openingCr, kpi.ptdDr, kpi.ptdCr,
          kpi.ytdDr, kpi.ytdCr, kpi.closingDr, kpi.closingCr].map((v, i) => (
          <SummaryCell
            key={i}
            index={7 + i}
            align="right"
            style={{ textAlign: 'right', background: REDWOOD.neutral100 }}
          >
            <Text strong style={{ fontSize: 11 }}>{fmtCcy(v)}</Text>
          </SummaryCell>
        ))}
      </Table.Summary.Row>
    </Table.Summary>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 20px' }}>

        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 12 }}>
          <Breadcrumb.Item><Link to="/home"><HomeOutlined /></Link></Breadcrumb.Item>
          <Breadcrumb.Item><Link to="/gl"><AccountBookOutlined /> General Ledger</Link></Breadcrumb.Item>
          <Breadcrumb.Item>Generate RR Trial Balance</Breadcrumb.Item>
        </Breadcrumb>

        {/* Page title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <Title level={4} style={{ margin: 0, color: REDWOOD.textPrimary }}>
              <CalculatorOutlined style={{ color: REDWOOD.primary, marginRight: 8 }} />
              Generate RR Trial Balance
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Derived from RR_GL_JE_LINES_ALL journal lines · Opening → PTD → YTD → Closing
            </Text>
          </div>
          <Space>
            <Button
              icon={<ApiOutlined />}
              size="small"
              type={apiPanelVisible ? 'primary' : 'default'}
              style={apiPanelVisible
                ? { background: REDWOOD.info, borderColor: REDWOOD.info }
                : { borderColor: REDWOOD.info, color: REDWOOD.info }}
              onClick={() => setApiPanelVisible(v => !v)}
            >
              API
            </Button>
          </Space>
        </div>

        {/* ── API Panel ───────────────────────────────────── */}
        {apiPanelVisible && (
          <Card
            size="small"
            style={{ marginBottom: 12, background: '#f0f5ff', border: `1px solid ${REDWOOD.info}`, borderRadius: 8 }}
            title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>API Endpoints</Text></Space>}
            extra={<Button size="small" type="text" onClick={() => setApiPanelVisible(false)}>✕</Button>}
          >
            {Object.entries(apiCalls).map(([key, call]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <Space align="start" wrap>
                  <Tag color={call.method === 'POST' ? 'blue' : 'green'} style={{ fontFamily: 'monospace', minWidth: 42, textAlign: 'center' }}>{call.method}</Tag>
                  <Text strong style={{ fontSize: 12 }}>{call.label}</Text>
                  {call.method === 'GET' && call.url && (
                    <Button
                      size="small"
                      icon={call.running ? <LoadingOutlined /> : <ApiOutlined />}
                      onClick={() => testEndpoint(key)}
                      disabled={call.running}
                    >
                      Test
                    </Button>
                  )}
                  {call.status !== null && (
                    <Tag
                      color={call.ok ? 'success' : 'error'}
                      icon={call.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    >
                      {call.status} · {call.durationMs}ms
                    </Tag>
                  )}
                  {call.running && <Tag icon={<LoadingOutlined />} color="processing">Running…</Tag>}
                </Space>
                {call.url && (
                  <div style={{ marginTop: 2, marginLeft: 52 }}>
                    <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>{call.url}</Text>
                  </div>
                )}
                {call.requestBody && (
                  <div style={{ marginTop: 4, marginLeft: 52 }}>
                    <Text type="secondary" style={{ fontSize: 10 }}>Request body:</Text>
                    <pre style={{ fontSize: 11, background: '#1a1a2e', color: '#a8d8ff', border: '1px solid #334', padding: 6, borderRadius: 4, maxHeight: 100, overflow: 'auto', marginTop: 2 }}>
                      {call.requestBody}
                    </pre>
                  </div>
                )}
                {call.body && (
                  <div style={{ marginTop: 4, marginLeft: 52 }}>
                    <Text type="secondary" style={{ fontSize: 10 }}>Response:</Text>
                    <pre style={{ fontSize: 11, background: '#fff', border: '1px solid #e5e5e5', padding: 6, borderRadius: 4, maxHeight: 80, overflow: 'auto', marginTop: 2 }}>
                      {call.body}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}

        {/* ── Parameters Card ─────────────────────────────── */}
        <Card
          size="small"
          style={{ marginBottom: 12, borderColor: REDWOOD.neutral200 }}
          bodyStyle={{ padding: '12px 16px' }}
        >
          <Row gutter={12} align="middle" wrap>
            <Col>
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>Ledger</Text>
              <Select
                style={{ width: 220 }}
                placeholder="Select ledger"
                value={ledgerName || undefined}
                onChange={v => { setLedgerName(v); setPeriodName(null); }}
                showSearch
                size="small"
              >
                {ledgers.map(l => <Option key={l} value={l}>{l}</Option>)}
              </Select>
            </Col>
            <Col>
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>Year</Text>
              <Select
                style={{ width: 90 }}
                placeholder="Year"
                value={periodYear ?? undefined}
                onChange={v => { setPeriodYear(v); setPeriodName(null); }}
                size="small"
              >
                {[...Array(5)].map((_, i) => {
                  const y = new Date().getFullYear() - i;
                  return <Option key={y} value={y}>{y}</Option>;
                })}
              </Select>
            </Col>
            <Col>
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>
                Company <Text type="secondary" style={{ fontSize: 10 }}>(optional)</Text>
              </Text>
              <Select
                style={{ width: 130 }}
                placeholder="All companies"
                value={companyName ?? undefined}
                onChange={v => setCompanyName(v ?? null)}
                allowClear
                size="small"
                showSearch
              >
                {companyOptions.map(c => (
                  <Option key={c} value={c}>{c}</Option>
                ))}
              </Select>
            </Col>
            <Col>
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, display: 'block', marginBottom: 2 }}>
                Period <Text type="secondary" style={{ fontSize: 10 }}>(optional)</Text>
              </Text>
              <Select
                style={{ width: 130 }}
                placeholder="All periods"
                value={periodName ?? undefined}
                onChange={v => setPeriodName(v)}
                allowClear
                size="small"
              >
                {periods.map(p => (
                  <Option key={p.period_name} value={p.period_name}>{p.period_name}</Option>
                ))}
              </Select>
            </Col>
            <Col>
              <div style={{ marginTop: 18 }}>
                <Button
                  type="primary"
                  icon={generating ? <LoadingOutlined spin /> : <PlayCircleOutlined />}
                  onClick={handleGenerate}
                  loading={generating}
                  disabled={!ledgerName}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primaryDark, marginRight: 8 }}
                  size="small"
                >
                  {generating ? 'Generating…' : 'Generate'}
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchTB}
                  loading={loading}
                  disabled={!ledgerName}
                  size="small"
                >
                  View / Refresh
                </Button>
              </div>
            </Col>
            {genResult && (
              <Col flex="auto">
                <div style={{ marginTop: 18 }}>
                  <Alert
                    type={genResult.success ? 'success' : 'warning'}
                    message={genResult.message}
                    description={genResult.errors > 0 ? genResult.error_msg : undefined}
                    showIcon
                    style={{ padding: '2px 10px', fontSize: 11 }}
                  />
                </div>
              </Col>
            )}
          </Row>

          {generating && (
            <div style={{ marginTop: 8 }}>
              <Progress
                percent={100} status="active" showInfo={false}
                strokeColor={REDWOOD.primary} style={{ margin: 0 }}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Computing trial balance from journal lines — this may take a moment for large datasets...
              </Text>
            </div>
          )}
        </Card>

        {/* ── Account Type Summary Chips ────────────────────── */}
        {data.length > 0 && (
          <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 11, color: REDWOOD.textSecondary, lineHeight: '24px' }}>Account Types:</Text>
            {Object.entries(ACCT_TYPE).map(([k, v]) => (
              typeSummary[k] ? (
                <Tag
                  key={k}
                  style={{
                    background: filterType === k ? v.color : v.bg,
                    color:      filterType === k ? '#fff'   : v.color,
                    border:     `1px solid ${v.color}55`,
                    cursor: 'pointer', fontSize: 11, padding: '0 8px',
                  }}
                  onClick={() => setFilterType(filterType === k ? null : k)}
                >
                  {v.label} <Badge count={typeSummary[k]} style={{ backgroundColor: filterType === k ? 'rgba(255,255,255,0.4)' : v.color, boxShadow: 'none', fontSize: 9 }} />
                </Tag>
              ) : null
            ))}
            {filterType && (
              <Button size="small" type="link" style={{ padding: 0, fontSize: 11 }}
                onClick={() => setFilterType(null)}>Clear filter</Button>
            )}
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────── */}
        {data.length > 0 && (
          <Row gutter={10} style={{ marginBottom: 12 }}>
            {[
              { label: 'Accounts',     value: kpi.rows,       suffix: 'rows',  color: REDWOOD.neutral600, isCcy: false },
              { label: 'Opening DR',   value: kpi.openingDr,  color: '#0572CE', isCcy: true },
              { label: 'Opening CR',   value: kpi.openingCr,  color: '#722ED1', isCcy: true },
              { label: 'PTD DR',       value: kpi.ptdDr,      color: '#1D7B4D', isCcy: true },
              { label: 'PTD CR',       value: kpi.ptdCr,      color: REDWOOD.primary, isCcy: true },
              { label: 'YTD DR',       value: kpi.ytdDr,      color: '#0F8B8D', isCcy: true },
              { label: 'YTD CR',       value: kpi.ytdCr,      color: '#D46B08', isCcy: true },
              { label: 'Closing DR',   value: kpi.closingDr,  color: '#0572CE', isCcy: true, bold: true },
              { label: 'Closing CR',   value: kpi.closingCr,  color: '#722ED1', isCcy: true, bold: true },
            ].map(k => (
              <Col key={k.label}>
                <Card size="small" style={{ minWidth: 110, borderColor: REDWOOD.neutral200, textAlign: 'center' }}
                  bodyStyle={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: REDWOOD.textSecondary, marginBottom: 2 }}>{k.label}</div>
                  <div style={{ fontSize: k.bold ? 14 : 13, fontWeight: k.bold ? 700 : 600, color: k.color }}>
                    {k.isCcy ? fmtCcy(k.value) : k.value.toLocaleString()}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}

        {/* ── Filter Bar ─────────────────────────────────────── */}
        {data.length > 0 && (
          <Card size="small" style={{ marginBottom: 8, borderColor: REDWOOD.neutral200 }}
            bodyStyle={{ padding: '8px 12px' }}>
            <Space wrap>
              <FilterOutlined style={{ color: REDWOOD.textSecondary }} />
              <Select
                placeholder="Company"
                allowClear
                size="small"
                style={{ width: 140 }}
                value={filterCompany ?? undefined}
                onChange={v => setFilterCompany(v ?? null)}
              >
                {companies.map(c => <Option key={c} value={c}>{c}</Option>)}
              </Select>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.textSecondary }} />}
                placeholder="Search account / description"
                size="small"
                style={{ width: 240 }}
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                allowClear
              />
              <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>
                Showing {filteredData.length.toLocaleString()} of {data.length.toLocaleString()} rows
              </Text>
              <Button
                icon={<FileExcelOutlined />}
                size="small"
                onClick={handleExport}
                style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
              >
                Export Excel
              </Button>
            </Space>
          </Card>
        )}

        {/* ── Main Table ─────────────────────────────────────── */}
        <Card
          style={{ borderColor: REDWOOD.neutral200 }}
          bodyStyle={{ padding: 0 }}
          title={
            data.length > 0 ? (
              <Space>
                <Text strong style={{ fontSize: 13 }}>Trial Balance</Text>
                <Tag color="blue">{ledgerName}</Tag>
                {periodYear && <Tag>{periodYear}</Tag>}
                {periodName && <Tag color="green">{periodName}</Tag>}
                {data[0]?.run_date && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Last generated: {data[0].run_date}
                  </Text>
                )}
              </Space>
            ) : null
          }
          extra={
            data.length === 0 && !loading ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Select parameters and click <strong>Generate</strong> to compute from journal lines,
                or <strong>View / Refresh</strong> to load existing data.
              </Text>
            ) : null
          }
        >
          {data.length === 0 && !loading ? (
            <div style={{
              textAlign: 'center', padding: '60px 24px',
              color: REDWOOD.textSecondary,
            }}>
              <CalculatorOutlined style={{ fontSize: 48, color: REDWOOD.neutral300, marginBottom: 16 }} />
              <div style={{ fontSize: 14 }}>No trial balance data loaded</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Choose a ledger and year above, then click <strong>Generate</strong> to produce the trial balance
                or <strong>View / Refresh</strong> to load previously generated data.
              </div>
            </div>
          ) : (
            <Table<TBRow>
              columns={columns}
              dataSource={filteredData}
              rowKey="tb_id"
              size="small"
              loading={loading || generating}
              scroll={{ x: 1600 }}
              sticky
              pagination={{
                pageSize: 100,
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                showSizeChanger: true,
                pageSizeOptions: ['50', '100', '250', '500'],
              }}
              summary={filteredData.length > 0 ? tableSummary : undefined}
              rowClassName={(r) => {
                const t = r.account_type || '';
                if (t === 'A') return 'tb-row-asset';
                if (t === 'L') return 'tb-row-liability';
                if (t === 'O') return 'tb-row-equity';
                if (t === 'R') return 'tb-row-revenue';
                if (t === 'E') return 'tb-row-expense';
                return '';
              }}
              onRow={(r) => ({
                style: {
                  background: ACCT_TYPE[r.account_type || '']?.bg || REDWOOD.surface,
                  borderLeft: `3px solid ${ACCT_TYPE[r.account_type || '']?.color || 'transparent'}`,
                },
              })}
            />
          )}
        </Card>

        {/* ── How It Works ───────────────────────────────────── */}
        <Card
          size="small"
          style={{ marginTop: 12, background: '#fffbe6', borderColor: '#ffe58f' }}
          bodyStyle={{ padding: '10px 16px' }}
        >
          <Space align="start">
            <InfoCircleOutlined style={{ color: REDWOOD.warning, marginTop: 2 }} />
            <div>
              <Text strong style={{ fontSize: 12 }}>How the RR Trial Balance Works</Text>
              <Row gutter={24} style={{ marginTop: 6 }}>
                <Col xs={24} sm={12} md={6}>
                  <Text style={{ fontSize: 11 }}>
                    <strong>Opening(P)</strong> = Closing of prior period.
                    Balance Sheet accounts (A/L/O) carry forward across fiscal years.
                    P&L accounts (R/E) reset to 0 each year.
                  </Text>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Text style={{ fontSize: 11 }}>
                    <strong>PTD DR / PTD CR</strong> = Period-to-Date debit / credit activity
                    summed from <em>RR_GL_JE_LINES_ALL</em> for the selected period.
                  </Text>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Text style={{ fontSize: 11 }}>
                    <strong>YTD DR / YTD CR</strong> = Cumulative debit / credit from the first period
                    of the fiscal year through the current period (inclusive).
                  </Text>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Text style={{ fontSize: 11 }}>
                    <strong>Closing(P)</strong> = Opening + PTD DR − PTD CR.
                    Stored as separate DR / CR columns — a debit-dominant account shows Closing DR &gt; 0.
                  </Text>
                </Col>
              </Row>
            </div>
          </Space>
        </Card>

      </Content>
    </Layout>
  );
};

export default GenerateTrialBalance;
