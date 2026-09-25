// Accounts Payables > Payables Trial Balance (Oracle style).
// Open ACCOUNTED liability per invoice as of a date, grouped by liability account
// and supplier, compared with the posted GL balance of each liability account.
// Pending (not yet accounted) invoices, payments and prepayment applications are
// listed separately: they are in neither the trial balance nor GL until posted.
// Data: GET reerp/ap/reports/trial-balance (database/ap/rr_ap_payables_trial_balance.sql)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Card, Form, Select, Button, Table, Tag, Statistic, Row, Col, Space, Typography,
  Alert, Tooltip, Input, Tabs, DatePicker, AutoComplete, Drawer, Collapse, Empty, Segmented,
} from 'antd';
import {
  SearchOutlined, DownloadOutlined, ApiOutlined, CheckCircleOutlined, WarningOutlined,
  ReconciliationOutlined, PlayCircleOutlined, ReloadOutlined, DeleteOutlined, ExportOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Text, Title } = Typography;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE', warning: '#A86C00',
  neutral100: '#F8F8F8', neutral200: '#E0E0E0', neutral600: '#6B6B6B',
};

interface PtdFields {
  tb_opening: number; invoices_ptd: number; payments_ptd: number; prepayments_ptd: number;
  gl_opening: number; gl_ptd: number; difference_opening: number; difference_ptd: number;
}
interface AccountRow extends Partial<PtdFields> {
  account: string; tb_total: number; gl_balance: number; difference: number;
  invoice_count: number; supplier_count: number; gl_by_date?: number;
}
interface InvoiceRow {
  account: string; supplier_number: string; supplier_name: string;
  invoice_id: number; invoice_number: string; invoice_type: string | null;
  invoice_date: string | null; accounting_date: string | null;
  currency: string; rate: number;
  invoice_amount: number; paid_amount: number; prepaid_amount: number;
  open_entered: number; open_functional: number; synced: boolean;
  opening_functional?: number; invoices_ptd?: number; payments_ptd?: number; prepayments_ptd?: number;
}
interface PendingRow {
  type: 'INVOICE' | 'PAYMENT' | 'PREPAYMENT_APPLICATION'; id: number; number: string;
  supplier_number: string | null; supplier_name: string | null; doc_date: string | null;
  currency: string; amount_functional: number; effect: number;
}
interface TbResponse {
  success: string | boolean; error?: string; asOfDate: string; businessUnit: string | null;
  mode?: 'ASOF' | 'PTD'; periodStart?: string | null; openingDate?: string | null;
  totals: { tb_total: number; gl_balance: number; difference: number; unaccounted_effect: number; gl_by_date?: number } & Partial<PtdFields>;
  accounts: AccountRow[]; invoices: InvoiceRow[]; unaccounted: PendingRow[];
  glLines?: GlLine[]; glLinesCapped?: boolean; ptdDocs?: PtdDoc[];
  glMonthly?: GlMonth[]; apMonthly?: ApMonth[];
  ledger?: string | null; glByLedger?: { ledger: string; balance: number }[];
}
interface GlMonth { account: string; month: string; dr: number; cr: number; lines: number }
interface ApMonth {
  account: string; month: string; invoices: number; cancellations: number; payments: number; prepayments: number;
}
interface MonthRow {
  key: string; month: string; dr: number; cr: number; glNet: number; glBal: number; lines: number;
  invoices: number; cancellations: number; payments: number; prepayments: number; apNet: number; apBal: number;
  diff: number; cumDiff: number;
}
interface GlLine {
  account: string; gl_date: string | null; journal: string | null; je_header_id: number;
  source: string | null; category: string | null; reference1: string | null; reference2: string | null;
  reference5: string | null; description: string | null; dr: number; cr: number; net: number; from_ap: boolean;
}
interface PtdDoc {
  type: 'PAYMENT' | 'PREPAYMENT'; id: number; number: string; account: string;
  supplier_number: string | null; supplier_name: string | null; doc_date: string | null; amount: number;
}
type ReconKind = 'INVOICE' | 'PAYMENT' | 'PREPAYMENT' | 'GL';
type ReconStatus = 'matched' | 'amount' | 'no_gl' | 'no_ap';
interface ReconRow {
  key: string; kind: ReconKind; number: string; supplier: string; supplier_number: string | null;
  account: string; date: string | null; ap: number | null; gl: number | null; diff: number;
  status: ReconStatus; matchedBy: 'reference' | 'number' | null; source: string | null; lines: GlLine[];
}
interface ApiCall {
  id: number; label: string; url: string; at: number;
  status: number | null; ms: number | null; response: string; error: string | null;
}
interface LiabilityAccount {
  account: string; natural_account: string | null; description: string | null; invoice_count: number;
}
interface SupplierRow {
  key: string; account: string; supplier_number: string; supplier_name: string;
  invoice_count: number; open_functional: number;
  opening_functional: number; invoices_ptd: number; payments_ptd: number; prepayments_ptd: number;
}

const fmt = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => (
  <span style={{ fontVariantNumeric: 'tabular-nums', color: n < 0 ? REDWOOD.primary : undefined }}>{fmt(n)}</span>
);
const isZero = (n: number) => Math.abs(Number(n) || 0) < 0.005;
const PENDING_LABEL: Record<PendingRow['type'], string> = {
  INVOICE: 'Invoice', PAYMENT: 'Payment', PREPAYMENT_APPLICATION: 'Prepayment application',
};

export default function PayablesTrialBalance() {
  const [form] = Form.useForm();
  const [businessUnits, setBusinessUnits] = useState<string[]>([]);
  const [liabAccounts, setLiabAccounts] = useState<LiabilityAccount[]>([]);
  const [liabLoading, setLiabLoading] = useState(false);
  const selectedBu = Form.useWatch('businessUnit', form) as string | undefined;
  const formMode = (Form.useWatch('mode', form) as 'ASOF' | 'PTD' | undefined) || 'ASOF';
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TbResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ── API inspector: every call this screen makes, with status, time and response
  const [calls, setCalls] = useState<ApiCall[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const callSeq = useRef(0);
  const callApi = useCallback(async (label: string, url: string): Promise<{ status: number; text: string }> => {
    const id = ++callSeq.current;
    const started = Date.now();
    setCalls(prev => [{ id, label, url, at: started, status: null, ms: null, response: '', error: null }, ...prev].slice(0, 30));
    const patch = (p: Partial<ApiCall>) => setCalls(prev => prev.map(c => (c.id === id ? { ...c, ...p } : c)));
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      patch({ status: res.status, ms: Date.now() - started, response: text.slice(0, 50000) });
      return { status: res.status, text };
    } catch (e: any) {
      const msg = e?.message || String(e);
      patch({ ms: Date.now() - started, error: `Network error: ${msg}` });
      throw new Error(`Network error calling the report service: ${msg}`);
    }
  }, []);
  const [tab, setTab] = useState('summary');
  const [invSearch, setInvSearch] = useState('');
  const [drill, setDrill] = useState<{ account?: string; supplier?: string } | null>(null);
  const [glFilter, setGlFilter] = useState<'all' | 'ap' | 'other'>('all');
  const [glSearch, setGlSearch] = useState('');
  const [txView, setTxView] = useState<'recon' | 'invoices'>('recon');
  const [reconFilter, setReconFilter] = useState<'all' | ReconStatus>('all');
  const [aaAccount, setAaAccount] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d?.items || []);
        setBusinessUnits(items.map(i => i.business_unit_name || '').filter(Boolean));
      })
      .catch(() => { /* BU list optional */ });
  }, []);

  // liability accounts used by the selected BU's invoices (all BUs when none)
  useEffect(() => {
    const p = new URLSearchParams();
    if (selectedBu) p.set('P_BUSINESS_UNIT', selectedBu);
    setLiabLoading(true);
    callApi('Liability accounts', `${APEX_DB_CONFIG.baseUrl}/ap/reports/liability-accounts${p.toString() ? `?${p}` : ''}`)
      .then(r => { try { return r.status < 400 ? JSON.parse(r.text) : null; } catch { return null; } })
      .then(d => {
        const items: LiabilityAccount[] = (d?.items || []).map((x: any) => ({
          account: x.account, natural_account: x.natural_account ?? null,
          description: x.description ?? null, invoice_count: Number(x.invoice_count) || 0,
        })).filter((x: LiabilityAccount) => !!x.account);
        setLiabAccounts(items);
        // drop a picked full combination that the new BU does not use
        const cur = form.getFieldValue('account') as string | undefined;
        if (cur && cur.includes('-') && !items.some(a => a.account === cur)) form.setFieldValue('account', undefined);
      })
      .catch(() => setLiabAccounts([]))   // service not deployed: typing still works
      .finally(() => setLiabLoading(false));
  }, [selectedBu, form, callApi]);

  // picker options: each natural account ("all companies") first, then every full combination
  const liabOptions = useMemo(() => {
    const naturals = new Map<string, { desc: string | null; count: number }>();
    for (const a of liabAccounts) {
      if (!a.natural_account) continue;
      const n = naturals.get(a.natural_account) || { desc: a.description, count: 0 };
      n.count += a.invoice_count;
      naturals.set(a.natural_account, n);
    }
    const row = (value: string, title: string, desc: string | null, count: number) => ({
      value,
      search: `${value} ${desc || ''}`.toLowerCase(),
      label: (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span><Text code style={{ fontSize: 12 }}>{title}</Text>{desc ? <Text type="secondary" style={{ fontSize: 12 }}> {desc}</Text> : null}</span>
          <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{count.toLocaleString()} inv</Text>
        </div>
      ),
    });
    return [
      ...(naturals.size ? [{
        label: 'Natural account (all combinations)',
        options: [...naturals.entries()].map(([nat, n]) => row(nat, nat, n.desc, n.count)),
      }] : []),
      ...(liabAccounts.length ? [{
        label: 'Account combination',
        options: liabAccounts.map(a => row(a.account, a.account, a.description, a.invoice_count)),
      }] : []),
    ];
  }, [liabAccounts]);

  const run = useCallback(async () => {
    await form.validateFields();
    const v = form.getFieldsValue(true); // all stored values, incl. a field that has just mounted
    const p = v.mode === 'PTD'
      ? new URLSearchParams({ P_PERIOD: (v.period as Dayjs).format('YYYY-MM') })
      : new URLSearchParams({ P_AS_OF_DATE: (v.asOfDate as Dayjs).format('YYYY-MM-DD') });
    if (v.businessUnit) p.set('P_BUSINESS_UNIT', v.businessUnit);
    if (v.account?.trim()) p.set('P_LIABILITY_ACCOUNT', v.account.trim());
    if (v.supplier?.trim()) p.set('P_SUPPLIER_NUMBER', v.supplier.trim());
    if (v.currency) p.set('P_CURRENCY', v.currency);
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/reports/trial-balance?${p}`;
    setLoading(true); setError(null); setDrill(null); setInvSearch('');
    try {
      const { status, text } = await callApi('Trial balance', url);
      if (!text.trim()) throw new Error(`Empty response (HTTP ${status}) — is the trial balance service deployed?`);
      let d: TbResponse & { code?: string; message?: string };
      try { d = JSON.parse(text); }
      catch { throw new Error(`HTTP ${status}: the service did not return JSON — open the API Inspector to see the response.`); }
      if (status === 404 || d.code === 'NotFound') {
        throw new Error('The trial balance service is not deployed (HTTP 404). Run database/ap/rr_ap_payables_trial_balance.sql in the bcldifc schema.');
      }
      if (d.success === 'false' || d.success === false) throw new Error(d.error || 'Report failed');
      if (status >= 400 || !d.totals || !Array.isArray(d.accounts)) {
        throw new Error(`HTTP ${status}: unexpected response${d.message ? ` — ${d.message}` : ''}. Open the API Inspector to see it.`);
      }
      setData(d);
    } catch (e: any) {
      setData(null);
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [form, callApi]);

  // supplier summary is derived from the invoice-level rows
  const suppliers = useMemo<SupplierRow[]>(() => {
    const m = new Map<string, SupplierRow>();
    for (const r of data?.invoices || []) {
      const key = `${r.account}|${r.supplier_number}`;
      const s = m.get(key) || {
        key, account: r.account, supplier_number: r.supplier_number, supplier_name: r.supplier_name,
        invoice_count: 0, open_functional: 0, opening_functional: 0, invoices_ptd: 0, payments_ptd: 0, prepayments_ptd: 0,
      };
      s.invoice_count += 1;
      s.open_functional += Number(r.open_functional) || 0;
      s.opening_functional += Number(r.opening_functional) || 0;
      s.invoices_ptd += Number(r.invoices_ptd) || 0;
      s.payments_ptd += Number(r.payments_ptd) || 0;
      s.prepayments_ptd += Number(r.prepayments_ptd) || 0;
      m.set(key, s);
    }
    return [...m.values()].sort((a, b) => a.account.localeCompare(b.account) || a.supplier_name.localeCompare(b.supplier_name));
  }, [data]);

  const invoices = useMemo(() => {
    let rows = data?.invoices || [];
    if (drill?.account) rows = rows.filter(r => r.account === drill.account);
    if (drill?.supplier) rows = rows.filter(r => r.supplier_number === drill.supplier);
    const q = invSearch.trim().toLowerCase();
    if (q) rows = rows.filter(r => [r.invoice_number, r.supplier_name, r.supplier_number, r.account, r.currency]
      .some(x => String(x ?? '').toLowerCase().includes(q)));
    return rows;
  }, [data, drill, invSearch]);

  // ── PTD reconciliation: each Payables document of the period against its GL lines ──
  // Match 1: GL line tagged by the posting service (REFERENCE5 event + REFERENCE2 id).
  // Match 2 (e.g. Fusion journals): GL REFERENCE1 = document number, same account.
  // GL lines left over become "X in Payables" rows (manual / other-source entries).
  const recon = useMemo<ReconRow[]>(() => {
    if (data?.mode !== 'PTD') return [];
    const gl = data.glLines || [];
    const kindOf = (ref5: string | null): ReconKind | null => {
      const r = (ref5 || '').toUpperCase();
      if (r.startsWith('AP-INVOICE')) return 'INVOICE';
      if (r.startsWith('AP-PREPAYMENT')) return 'PREPAYMENT';
      if (r.startsWith('AP-PAYMENT')) return 'PAYMENT';
      return null;
    };
    const byRef = new Map<string, number[]>();
    const byNum = new Map<string, number[]>();
    gl.forEach((g, i) => {
      const k = kindOf(g.reference5);
      if (k && g.reference2) {
        const key = `${k}|${g.reference2}|${g.account}`;
        byRef.set(key, [...(byRef.get(key) || []), i]);
      }
      if (g.reference1) {
        const key = `${g.account}|${g.reference1.trim().toUpperCase()}`;
        byNum.set(key, [...(byNum.get(key) || []), i]);
      }
    });
    const used = new Set<number>();
    const docs: Omit<ReconRow, 'gl' | 'diff' | 'status' | 'matchedBy' | 'lines' | 'source'>[] = [
      ...data.invoices.filter(r => !isZero(Number(r.invoices_ptd) || 0)).map(r => ({
        key: `INVOICE-${r.invoice_id}-${r.account}`, kind: 'INVOICE' as const, number: r.invoice_number,
        supplier: r.supplier_name, supplier_number: r.supplier_number, account: r.account,
        date: r.accounting_date, ap: Number(r.invoices_ptd) || 0, id: r.invoice_id,
      })),
      ...(data.ptdDocs || []).map(d => ({
        key: `${d.type}-${d.id}-${d.account}`, kind: d.type as ReconKind, number: d.number,
        supplier: d.supplier_name || '', supplier_number: d.supplier_number, account: d.account,
        date: d.doc_date, ap: Number(d.amount) || 0, id: d.id,
      })),
    ].map(({ id, ...rest }) => ({ ...rest, _id: id } as any));
    const rows: ReconRow[] = docs.map((d: any) => {
      let idx = (byRef.get(`${d.kind}|${d._id}|${d.account}`) || []).filter(i => !used.has(i));
      let matchedBy: ReconRow['matchedBy'] = idx.length ? 'reference' : null;
      if (!idx.length && d.number) {
        idx = (byNum.get(`${d.account}|${String(d.number).trim().toUpperCase()}`) || []).filter(i => !used.has(i));
        if (idx.length) matchedBy = 'number';
      }
      idx.forEach(i => used.add(i));
      const lines = idx.map(i => gl[i]);
      const glAmt = lines.length ? lines.reduce((t, g) => t + (Number(g.net) || 0), 0) : null;
      const diff = (d.ap ?? 0) - (glAmt ?? 0);
      const status: ReconStatus = glAmt === null ? 'no_gl' : isZero(diff) ? 'matched' : 'amount';
      const { _id, ...base } = d;
      return { ...base, gl: glAmt, diff, status, matchedBy, source: lines[0]?.source ?? null, lines };
    });
    // GL lines not matched to any Payables document: group per journal + reference
    const left = new Map<string, GlLine[]>();
    gl.forEach((g, i) => {
      if (used.has(i)) return;
      const key = `${g.account}|${g.je_header_id}|${g.reference1 || ''}`;
      left.set(key, [...(left.get(key) || []), g]);
    });
    left.forEach((lines, key) => {
      const g = lines[0];
      const glAmt = lines.reduce((t, x) => t + (Number(x.net) || 0), 0);
      rows.push({
        key: `GL-${key}`, kind: 'GL', number: g.reference1 || g.journal || `Journal ${g.je_header_id}`,
        supplier: g.description || '', supplier_number: null, account: g.account, date: g.gl_date,
        ap: null, gl: glAmt, diff: -glAmt, status: 'no_ap', matchedBy: null, source: g.source, lines,
      });
    });
    return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.number.localeCompare(b.number));
  }, [data]);

  const reconShown = useMemo(() => {
    let rows = recon;
    if (drill?.account) rows = rows.filter(r => r.account === drill.account);
    if (drill?.supplier) rows = rows.filter(r => r.supplier_number === drill.supplier);
    if (reconFilter !== 'all') rows = rows.filter(r => r.status === reconFilter);
    const q = invSearch.trim().toLowerCase();
    if (q) rows = rows.filter(r => [r.number, r.supplier, r.account, r.source, r.kind]
      .some(x => String(x ?? '').toLowerCase().includes(q)));
    return rows;
  }, [recon, drill, reconFilter, invSearch]);
  const reconCount = (st: ReconStatus) => recon.filter(r => r.status === st).length;

  // PTD headline figures are the totals of the details, so cards, grid and GL tab always agree
  const ptdAp = recon.reduce((t2, r) => t2 + (r.ap ?? 0), 0);
  const ptdGl = data?.glLinesCapped
    ? Number(data?.totals.gl_ptd) || 0
    : (data?.glLines || []).reduce((t2, g) => t2 + (Number(g.net) || 0), 0);
  const rollForward = data ? (Number(data.totals.tb_total) || 0) - (Number(data.totals.tb_opening) || 0) : 0;
  const rollGap = rollForward - ptdAp;

  // ── Account Analysis (PTD): GL opening, every line of the period, running balance, closing
  type AaRow = { key: string; kind: 'open' | 'line' | 'total' | 'close'; date: string | null; journal: string | null;
    source: string | null; reference: string | null; description: string | null;
    dr: number | null; cr: number | null; balance: number | null; from_ap?: boolean };
  const aaAccounts = useMemo(() => (data?.accounts || []).map(a => a.account), [data]);
  const aaSelected = aaAccount && aaAccounts.includes(aaAccount) ? aaAccount : aaAccounts[0];
  const aaRows = useMemo<AaRow[]>(() => {
    if (!data || data.mode !== 'PTD' || !aaSelected) return [];
    const acc = data.accounts.find(a => a.account === aaSelected);
    const opening = Number(acc?.gl_opening) || 0;
    const lines = (data.glLines || []).filter(g => g.account === aaSelected)
      .slice().sort((a, b) => String(a.gl_date).localeCompare(String(b.gl_date)) || a.je_header_id - b.je_header_id);
    let bal = opening;
    let tDr = 0; let tCr = 0;
    const rows: AaRow[] = [{ key: 'open', kind: 'open', date: data.openingDate || null, journal: 'Opening balance', source: null,
      reference: null, description: null, dr: null, cr: null, balance: opening }];
    lines.forEach((g, i) => {
      const dr = Number(g.dr) || 0; const cr = Number(g.cr) || 0;
      tDr += dr; tCr += cr; bal += cr - dr;
      rows.push({ key: `l${i}`, kind: 'line', date: g.gl_date, journal: g.journal, source: g.source, reference: g.reference1,
        description: g.description, dr: dr || null, cr: cr || null, balance: bal, from_ap: g.from_ap });
    });
    const lbl = data.periodStart ? dayjs(data.periodStart).format('MMM-YY') : '';
    rows.push({ key: 'total', kind: 'total', date: null, journal: `Period ${lbl}: ${lines.length} line(s)`, source: null,
      reference: null, description: `Net movement ${fmt(tCr - tDr)} (Cr − Dr)`, dr: tDr, cr: tCr, balance: null });
    rows.push({ key: 'close', kind: 'close', date: data.asOfDate, journal: 'Closing balance', source: null,
      reference: null, description: null, dr: null, cr: null, balance: bal });
    return rows;
  }, [data, aaSelected]);

  // ── Account Analysis (as of): month-by-month GL debits / credits / running balance
  // next to the Payables movement of the same month, so the month a gap opened shows.
  const ALL = '__ALL__';
  const aaAsofSelected = aaAccount === ALL || (aaAccount && aaAccounts.includes(aaAccount))
    ? aaAccount : (aaAccounts.length > 1 ? ALL : aaAccounts[0]);
  const monthRows = useMemo<MonthRow[]>(() => {
    if (!data || data.mode === 'PTD') return [];
    const pick = (a: string) => aaAsofSelected === ALL || a === aaAsofSelected;
    const m = new Map<string, MonthRow>();
    const get = (month: string) => {
      let r = m.get(month);
      if (!r) {
        r = { key: month, month, dr: 0, cr: 0, glNet: 0, glBal: 0, lines: 0, invoices: 0, cancellations: 0,
          payments: 0, prepayments: 0, apNet: 0, apBal: 0, diff: 0, cumDiff: 0 };
        m.set(month, r);
      }
      return r;
    };
    for (const g of data.glMonthly || []) {
      if (!pick(g.account)) continue;
      const r = get(g.month);
      r.dr += Number(g.dr) || 0; r.cr += Number(g.cr) || 0; r.lines += Number(g.lines) || 0;
    }
    for (const a of data.apMonthly || []) {
      if (!pick(a.account)) continue;
      const r = get(a.month);
      r.invoices += Number(a.invoices) || 0; r.cancellations += Number(a.cancellations) || 0;
      r.payments += Number(a.payments) || 0; r.prepayments += Number(a.prepayments) || 0;
    }
    const rows = [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
    let gl = 0; let ap = 0;
    for (const r of rows) {
      r.glNet = r.cr - r.dr; gl += r.glNet; r.glBal = gl;
      r.apNet = r.invoices + r.cancellations + r.payments + r.prepayments; ap += r.apNet; r.apBal = ap;
      r.diff = r.apNet - r.glNet; r.cumDiff = r.apBal - r.glBal;
    }
    return rows;
  }, [data, aaAsofSelected]);
  const monthTot = useMemo(() => monthRows.reduce((t2, r) => ({
    dr: t2.dr + r.dr, cr: t2.cr + r.cr, lines: t2.lines + r.lines, invoices: t2.invoices + r.invoices,
    cancellations: t2.cancellations + r.cancellations, payments: t2.payments + r.payments, prepayments: t2.prepayments + r.prepayments,
  }), { dr: 0, cr: 0, lines: 0, invoices: 0, cancellations: 0, payments: 0, prepayments: 0 }), [monthRows]);
  const cents = (n: number) => Math.round(n * 100) / 100;
  // trial balance / GL balance of the selected account(s) — what the months must add up to
  const aaTarget = useMemo(() => {
    const acc = (data?.accounts || []).filter(a => aaAsofSelected === ALL || a.account === aaAsofSelected);
    return {
      tb: acc.reduce((s2, a) => s2 + (Number(a.tb_total) || 0), 0),
      gl: acc.reduce((s2, a) => s2 + (Number(a.gl_balance) || 0), 0),
      byDate: acc.some(a => a.gl_by_date != null) ? acc.reduce((s2, a) => s2 + (Number(a.gl_by_date) || 0), 0) : null,
    };
  }, [data, aaAsofSelected]);
  // months where Payables and GL moved differently, biggest first
  const gapMonths = useMemo(() => monthRows.filter(r => !isZero(r.diff))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), [monthRows]);
  const monLabel = (mm: string) => dayjs(`${mm}-01`).format('MMM-YY');
  // drill: re-run the report in Period (PTD) mode for that month, straight to its Transactions
  const drillMonth = (mm: string) => {
    form.setFieldsValue({ mode: 'PTD', period: dayjs(`${mm}-01`) });
    setTab('invoices'); setTxView('recon'); setReconFilter('all');
    setTimeout(() => form.submit(), 50); // let the Period field mount first
  };

  const openInvoices = (account?: string, supplier?: string) => {
    setDrill({ account, supplier });
    setTab('invoices');
  };

  // ── columns ────────────────────────────────────────────────────────────────
  const isPtd = data?.mode === 'PTD';
  const periodLabel = data?.periodStart ? dayjs(data.periodStart).format('MMM-YY') : '';
  const diffTag = (v: number) => (isZero(v)
    ? <Tag icon={<CheckCircleOutlined />} color="success">0.00</Tag>
    : <Tag icon={<WarningOutlined />} color="error">{fmt(v)}</Tag>);
  const amt = <T,>(title: string, key: keyof T & string, width = 130) =>
    ({ title, dataIndex: key, key, align: 'right' as const, width, render: (v: number) => money(Number(v) || 0) });

  const accountCols: ColumnsType<AccountRow> = [
    { title: 'Liability Account', dataIndex: 'account', key: 'account', fixed: 'left', width: 290,
      render: (v, r) => (
        <Space size={4}>
          <Text code style={{ fontSize: 12 }}>{v}</Text>
          {!r.invoice_count && isZero(r.tb_total) && isZero(r.tb_opening || 0) && (
            <Tooltip title="No invoice uses this combination as liability account, but GL has entries on it (same company and natural account). The GL Trial Balance includes it, so it is compared here too.">
              <Tag color="orange" style={{ fontSize: 10 }}>GL only</Tag>
            </Tooltip>
          )}
        </Space>
      ) },
    { title: 'Suppliers', dataIndex: 'supplier_count', key: 'supplier_count', align: 'right', width: 90 },
    { title: isPtd ? 'Invoices' : 'Open Invoices', dataIndex: 'invoice_count', key: 'invoice_count', align: 'right', width: 100,
      render: (v, r) => (v ? <a onClick={() => openInvoices(r.account)}>{v}</a> : 0) },
    ...(isPtd ? [
      { title: `Payables ${periodLabel} (balance roll-forward)`, key: 'payables', children: [
        amt<AccountRow>('Opening', 'tb_opening'), amt<AccountRow>('+ Invoices', 'invoices_ptd'),
        amt<AccountRow>('− Payments', 'payments_ptd'), amt<AccountRow>('− Prepayments', 'prepayments_ptd'),
        amt<AccountRow>('Closing', 'tb_total', 140),
      ] },
      { title: `GL ${periodLabel}`, key: 'gl', children: [
        amt<AccountRow>('Opening', 'gl_opening'), amt<AccountRow>('Movement', 'gl_ptd'), amt<AccountRow>('Closing', 'gl_balance', 140),
      ] },
      { title: 'Difference (Payables − GL)', key: 'diff', children: [
        { title: 'Opening', dataIndex: 'difference_opening', key: 'difference_opening', align: 'right' as const, width: 130, render: diffTag },
        { title: 'Period', dataIndex: 'difference_ptd', key: 'difference_ptd', align: 'right' as const, width: 130, render: diffTag },
        { title: 'Closing', dataIndex: 'difference', key: 'difference', align: 'right' as const, width: 130, render: diffTag },
      ] },
    ] : [
      amt<AccountRow>('Payables Balance (AED)', 'tb_total', 170),
      amt<AccountRow>('GL Balance (AED)', 'gl_balance', 170),
      { title: 'Difference', dataIndex: 'difference', key: 'difference', align: 'right' as const, width: 170, render: diffTag },
    ]),
  ];
  // total row follows the leaf columns after the first three
  const accountTotalKeys: string[] = isPtd
    ? ['tb_opening', 'invoices_ptd', 'payments_ptd', 'prepayments_ptd', 'tb_total', 'gl_opening', 'gl_ptd', 'gl_balance', 'difference_opening', 'difference_ptd', 'difference']
    : ['tb_total', 'gl_balance', 'difference'];

  const supplierCols: ColumnsType<SupplierRow> = [
    { title: 'Liability Account', dataIndex: 'account', width: 290, render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Supplier', dataIndex: 'supplier_name', sorter: (a, b) => a.supplier_name.localeCompare(b.supplier_name) },
    { title: 'Supplier #', dataIndex: 'supplier_number', width: 120 },
    { title: isPtd ? 'Invoices' : 'Open Invoices', dataIndex: 'invoice_count', align: 'right', width: 110,
      render: (v, r) => <a onClick={() => openInvoices(r.account, r.supplier_number)}>{v}</a> },
    ...(isPtd ? [
      amt<SupplierRow>('+ Invoices', 'invoices_ptd'),
      amt<SupplierRow>('− Payments', 'payments_ptd'), amt<SupplierRow>('− Prepayments', 'prepayments_ptd'),
      { title: `Net activity ${periodLabel}`, key: 'net', align: 'right' as const, width: 150,
        sorter: (a: SupplierRow, b: SupplierRow) => (a.invoices_ptd - a.payments_ptd - a.prepayments_ptd) - (b.invoices_ptd - b.payments_ptd - b.prepayments_ptd),
        render: (_: unknown, r: SupplierRow) => money(r.invoices_ptd - r.payments_ptd - r.prepayments_ptd) },
    ] : [
      { title: 'Open Balance (AED)', dataIndex: 'open_functional', align: 'right' as const, width: 150,
        sorter: (a: SupplierRow, b: SupplierRow) => a.open_functional - b.open_functional, render: money },
    ]),
  ];

  // PTD: GL lines behind the period movement
  const glLines = useMemo(() => {
    let rows = data?.glLines || [];
    if (glFilter === 'ap') rows = rows.filter(r => r.from_ap);
    if (glFilter === 'other') rows = rows.filter(r => !r.from_ap);
    const q = glSearch.trim().toLowerCase();
    if (q) rows = rows.filter(r => [r.journal, r.source, r.category, r.reference1, r.reference5, r.description, r.account]
      .some(x => String(x ?? '').toLowerCase().includes(q)));
    return rows;
  }, [data, glFilter, glSearch]);
  const glCols: ColumnsType<GlLine> = [
    { title: 'GL Date', dataIndex: 'gl_date', width: 105, sorter: (a, b) => String(a.gl_date).localeCompare(String(b.gl_date)) },
    { title: 'Journal', dataIndex: 'journal', width: 240, ellipsis: true },
    { title: 'Source', dataIndex: 'source', width: 130, ellipsis: true,
      render: (v, r) => <Space size={4}>{v || '—'}{r.from_ap ? <Tag color="blue" style={{ fontSize: 10 }}>AP</Tag> : <Tag color="orange" style={{ fontSize: 10 }}>Other</Tag>}</Space> },
    { title: 'Category', dataIndex: 'category', width: 130, ellipsis: true },
    { title: 'Reference', dataIndex: 'reference1', width: 150, ellipsis: true },
    { title: 'Event', dataIndex: 'reference5', width: 190, ellipsis: true },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    { title: 'Dr', dataIndex: 'dr', align: 'right', width: 120, render: (v: number) => (v ? money(v) : '') },
    { title: 'Cr', dataIndex: 'cr', align: 'right', width: 120, render: (v: number) => (v ? money(v) : '') },
    { title: 'Net (Cr − Dr)', dataIndex: 'net', align: 'right', width: 130, render: money,
      sorter: (a, b) => a.net - b.net },
  ];

  const invoiceCols: ColumnsType<InvoiceRow> = [
    { title: 'Supplier', dataIndex: 'supplier_name', width: 220, ellipsis: true,
      sorter: (a, b) => a.supplier_name.localeCompare(b.supplier_name) },
    { title: 'Invoice', dataIndex: 'invoice_number', width: 160,
      render: (v, r) => <Space size={4}>{v}{r.synced && <Tooltip title="Accounted in Oracle Fusion"><Tag color="purple" style={{ fontSize: 10 }}>Fusion</Tag></Tooltip>}</Space> },
    { title: 'Type', dataIndex: 'invoice_type', width: 110 },
    { title: 'Invoice Date', dataIndex: 'invoice_date', width: 110 },
    { title: 'Accounting Date', dataIndex: 'accounting_date', width: 120,
      sorter: (a, b) => String(a.accounting_date).localeCompare(String(b.accounting_date)) },
    { title: 'CCY', dataIndex: 'currency', width: 60 },
    { title: 'Invoice Amount', dataIndex: 'invoice_amount', align: 'right', width: 130, render: money },
    { title: 'Paid', dataIndex: 'paid_amount', align: 'right', width: 120, render: money },
    { title: 'Prepaid', dataIndex: 'prepaid_amount', align: 'right', width: 110, render: money },
    { title: 'Open (Entered)', dataIndex: 'open_entered', align: 'right', width: 130, render: money },
    ...(isPtd ? [
      amt<InvoiceRow>('Opening (AED)', 'opening_functional'), amt<InvoiceRow>('+ Invoices', 'invoices_ptd', 120),
      amt<InvoiceRow>('− Payments', 'payments_ptd', 120), amt<InvoiceRow>('− Prepayments', 'prepayments_ptd', 120),
    ] : []),
    { title: isPtd ? 'Closing (AED)' : 'Open (AED)', dataIndex: 'open_functional', align: 'right', width: 130, render: money,
      sorter: (a, b) => a.open_functional - b.open_functional },
    { title: 'Liability Account', dataIndex: 'account', width: 270, render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
  ];

  const X = <Tag color="error" style={{ fontWeight: 700 }}>X</Tag>;
  const KIND_TAG: Record<ReconKind, { label: string; color: string }> = {
    INVOICE: { label: 'Invoice', color: 'blue' }, PAYMENT: { label: 'Payment', color: 'green' },
    PREPAYMENT: { label: 'Prepayment', color: 'purple' }, GL: { label: 'GL only', color: 'orange' },
  };
  const STATUS_TAG: Record<ReconStatus, ReactNode> = {
    matched: <Tag icon={<CheckCircleOutlined />} color="success">Matched</Tag>,
    amount: <Tag icon={<WarningOutlined />} color="warning">Amount differs</Tag>,
    no_gl: <Tag color="error">Not in GL</Tag>,
    no_ap: <Tag color="error">Not in Payables</Tag>,
  };
  const reconCols: ColumnsType<ReconRow> = [
    { title: 'Type', dataIndex: 'kind', width: 110, render: (k: ReconKind) => <Tag color={KIND_TAG[k].color}>{KIND_TAG[k].label}</Tag> },
    { title: 'Document / Reference', dataIndex: 'number', width: 210, ellipsis: true },
    { title: 'Supplier / Description', dataIndex: 'supplier', ellipsis: true },
    { title: 'Date', dataIndex: 'date', width: 105, sorter: (a, b) => String(a.date).localeCompare(String(b.date)) },
    { title: `Payables ${periodLabel}`, dataIndex: 'ap', align: 'right', width: 150,
      render: (v: number | null) => (v === null ? X : money(v)),
      sorter: (a, b) => (a.ap ?? 0) - (b.ap ?? 0) },
    { title: `GL ${periodLabel}`, dataIndex: 'gl', align: 'right', width: 150,
      render: (v: number | null) => (v === null ? X : money(v)),
      sorter: (a, b) => (a.gl ?? 0) - (b.gl ?? 0) },
    { title: 'Difference', dataIndex: 'diff', align: 'right', width: 130,
      render: (v: number) => (isZero(v) ? <Text type="secondary">0.00</Text> : <Text strong style={{ color: REDWOOD.primary }}>{fmt(v)}</Text>),
      sorter: (a, b) => Math.abs(a.diff) - Math.abs(b.diff) },
    { title: 'Status', dataIndex: 'status', width: 150, render: (st: ReconStatus, r) => (
      <Space size={2}>{STATUS_TAG[st]}{r.matchedBy === 'number' && <Tooltip title="Matched on the document number in GL Reference 1 (no Re-ERP posting tag)"><Tag style={{ fontSize: 10 }}>by no.</Tag></Tooltip>}</Space>) },
    { title: 'GL Source', dataIndex: 'source', width: 120, ellipsis: true },
    { title: 'Liability Account', dataIndex: 'account', width: 270, render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
  ];

  const pendingCols: ColumnsType<PendingRow> = [
    { title: 'Type', dataIndex: 'type', width: 190, render: (v: PendingRow['type']) => <Tag>{PENDING_LABEL[v] || v}</Tag>,
      filters: Object.entries(PENDING_LABEL).map(([value, text]) => ({ text, value })),
      onFilter: (v, r) => r.type === v },
    { title: 'Number', dataIndex: 'number', width: 200 },
    { title: 'Supplier', dataIndex: 'supplier_name', ellipsis: true },
    { title: 'Date', dataIndex: 'doc_date', width: 110 },
    { title: 'CCY', dataIndex: 'currency', width: 60 },
    { title: 'Amount (AED)', dataIndex: 'amount_functional', align: 'right', width: 140, render: money },
    { title: 'Effect on liability once posted', dataIndex: 'effect', align: 'right', width: 200, render: money },
  ];

  // ── export ─────────────────────────────────────────────────────────────────
  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const hdr = [
      ['Payables Trial Balance'],
      ...(data.mode === 'PTD'
        ? [['Period', `${data.periodStart} to ${data.asOfDate}`], ['Opening balance as of', data.openingDate || '']]
        : [['As of', data.asOfDate]]),
      ['Business Unit', data.businessUnit || 'All'],
      [],
    ];
    const summary = XLSX.utils.aoa_to_sheet([
      ...hdr,
      ...(data.mode === 'PTD' ? [
        ['Liability Account', 'Suppliers', 'Invoices', 'Payables Opening', '+ Invoices', '- Payments', '- Prepayments', 'Payables Closing',
         'GL Opening', 'GL Movement', 'GL Closing', 'Diff Opening', 'Diff Period', 'Diff Closing'],
        ...data.accounts.map(a => [a.account, a.supplier_count, a.invoice_count, a.tb_opening, a.invoices_ptd, a.payments_ptd, a.prepayments_ptd,
          a.tb_total, a.gl_opening, a.gl_ptd, a.gl_balance, a.difference_opening, a.difference_ptd, a.difference]),
        ['TOTAL', '', '', data.totals.tb_opening, data.totals.invoices_ptd, data.totals.payments_ptd, data.totals.prepayments_ptd,
          data.totals.tb_total, data.totals.gl_opening, data.totals.gl_ptd, data.totals.gl_balance,
          data.totals.difference_opening, data.totals.difference_ptd, data.totals.difference],
      ] : [
        ['Liability Account', 'Suppliers', 'Open Invoices', 'Payables Balance (AED)', 'GL Balance (AED)', 'Difference'],
        ...data.accounts.map(a => [a.account, a.supplier_count, a.invoice_count, a.tb_total, a.gl_balance, a.difference]),
        ['TOTAL', '', '', data.totals.tb_total, data.totals.gl_balance, data.totals.difference],
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, summary, 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suppliers.map(s => ({
      'Liability Account': s.account, Supplier: s.supplier_name, 'Supplier #': s.supplier_number,
      'Invoices': s.invoice_count,
      ...(data.mode === 'PTD' ? {
        '+ Invoices': Math.round(s.invoices_ptd * 100) / 100,
        '- Payments': Math.round(s.payments_ptd * 100) / 100, '- Prepayments': Math.round(s.prepayments_ptd * 100) / 100,
        'Net activity': Math.round((s.invoices_ptd - s.payments_ptd - s.prepayments_ptd) * 100) / 100,
      } : { 'Open Balance (AED)': Math.round(s.open_functional * 100) / 100 }),
    }))), 'By Supplier');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.invoices.map(r => ({
      'Liability Account': r.account, Supplier: r.supplier_name, 'Supplier #': r.supplier_number,
      Invoice: r.invoice_number, Type: r.invoice_type, 'Invoice Date': r.invoice_date,
      'Accounting Date': r.accounting_date, Currency: r.currency, Rate: r.rate,
      'Invoice Amount': r.invoice_amount, Paid: r.paid_amount, Prepaid: r.prepaid_amount,
      'Open (Entered)': r.open_entered,
      ...(data.mode === 'PTD' ? {
        'Opening (AED)': r.opening_functional, '+ Invoices': r.invoices_ptd, '- Payments': r.payments_ptd, '- Prepayments': r.prepayments_ptd,
      } : {}),
      [data.mode === 'PTD' ? 'Closing (AED)' : 'Open (AED)']: r.open_functional,
      Source: r.synced ? 'Oracle Fusion' : 'Re-ERP',
    }))), 'Invoices');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.unaccounted.map(u => ({
      Type: PENDING_LABEL[u.type] || u.type, Number: u.number, Supplier: u.supplier_name,
      'Supplier #': u.supplier_number, Date: u.doc_date, Currency: u.currency,
      'Amount (AED)': u.amount_functional, 'Effect once posted': u.effect,
    }))), 'Pending Accounting');
    if (data.mode === 'PTD') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recon.map(r => ({
        Type: KIND_TAG[r.kind].label, Document: r.number, 'Supplier / Description': r.supplier, Date: r.date,
        [`Payables ${periodLabel}`]: r.ap === null ? 'X' : Math.round(r.ap * 100) / 100,
        [`GL ${periodLabel}`]: r.gl === null ? 'X' : Math.round(r.gl * 100) / 100,
        Difference: Math.round(r.diff * 100) / 100,
        Status: { matched: 'Matched', amount: 'Amount differs', no_gl: 'Not in GL', no_ap: 'Not in Payables' }[r.status],
        'Matched by': r.matchedBy || '', 'GL Source': r.source || '', 'Liability Account': r.account,
      }))), 'Payables vs GL');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((data.glLines || []).map(g => ({
        'Liability Account': g.account, 'GL Date': g.gl_date, Journal: g.journal, Source: g.source,
        Category: g.category, 'From Payables': g.from_ap ? 'Yes' : 'No', Reference: g.reference1,
        Event: g.reference5, Description: g.description, Dr: g.dr, Cr: g.cr, 'Net (Cr-Dr)': g.net,
      }))), 'GL Lines');
    }
    if (data.mode !== 'PTD' && monthRows.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthRows.map(r => ({
        Period: monLabel(r.month), 'GL Lines': r.lines, 'GL Debit': r.dr, 'GL Credit': r.cr,
        'GL Net (Cr-Dr)': Math.round(r.glNet * 100) / 100, 'GL Balance': Math.round(r.glBal * 100) / 100,
        '+ Invoices': r.invoices, '- Cancelled': r.cancellations, '- Payments': r.payments, '- Prepayments': r.prepayments,
        'Payables Net': Math.round(r.apNet * 100) / 100, 'Payables Balance': Math.round(r.apBal * 100) / 100,
        'Difference (month)': Math.round(r.diff * 100) / 100, 'Difference (cumulative)': Math.round(r.cumDiff * 100) / 100,
      }))), 'Account Analysis');
    }
    XLSX.writeFile(wb, `Payables_Trial_Balance_${data.mode === 'PTD' ? `PTD_${dayjs(data.periodStart).format('MMM-YY')}` : data.asOfDate}.xlsx`);
  };

  const t = data?.totals;
  const reconciled = t && isZero(t.difference);

  return (
    <div style={{ padding: 16, background: REDWOOD.neutral100, minHeight: '100%' }}>
      <style>{`.tb-recon-issue > td { background: #fff8f6 !important; } .tb-aa-strong > td { background: #f5f5f5 !important; font-weight: 600; }`}</style>
      <Space align="center" style={{ marginBottom: 12 }}>
        <ReconciliationOutlined style={{ fontSize: 22, color: REDWOOD.primary }} />
        <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Payables Trial Balance</Title>
        <Button size="small" icon={<ApiOutlined />} onClick={() => setInspectorOpen(true)}>
          API Inspector{calls.length ? ` (${calls.length})` : ''}
        </Button>
      </Space>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Form form={form} layout="inline" initialValues={{ mode: 'ASOF', asOfDate: dayjs(), period: dayjs().subtract(1, 'month') }}
          onFinish={run} style={{ rowGap: 8 }}>
          <Form.Item name="mode">
            <Segmented options={[{ label: 'As of Date', value: 'ASOF' }, { label: 'Period (PTD)', value: 'PTD' }]} />
          </Form.Item>
          {formMode === 'PTD' ? (
            <Form.Item name="period" label="Period" rules={[{ required: true, message: 'Required' }]}
              tooltip="Opening balance at the day before the period, activity in the period, closing at period end — compared with the GL movement of the same period">
              <DatePicker picker="month" format="MMM-YY" allowClear={false} />
            </Form.Item>
          ) : (
            <Form.Item name="asOfDate" label="As of Date" rules={[{ required: true, message: 'Required' }]}>
              <DatePicker format="DD-MMM-YYYY" allowClear={false} />
            </Form.Item>
          )}
          <Form.Item name="businessUnit" label="Business Unit">
            <Select allowClear showSearch placeholder="All" style={{ width: 240 }}
              options={businessUnits.map(b => ({ value: b, label: b }))} />
          </Form.Item>
          <Form.Item name="account" label="Liability Account"
            tooltip="Full combination (01-00-00-2313101-…) or the natural account only (2313101)">
            <AutoComplete
              allowClear
              style={{ width: 340 }}
              popupMatchSelectWidth={520}
              placeholder={liabLoading ? 'Loading accounts…' : 'All — pick or type, e.g. 2313101'}
              options={liabOptions}
              filterOption={(input, opt) => {
                const o = opt as { search?: string; options?: unknown[] } | undefined;
                if (!o || o.options) return true; // group headers
                return !input || (o.search || '').includes(input.toLowerCase());
              }}
            />
          </Form.Item>
          <Form.Item name="supplier" label="Supplier #">
            <Input allowClear placeholder="All" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="currency" label="Currency">
            <Select allowClear placeholder="All" style={{ width: 100 }}
              options={['AED', 'USD', 'EUR', 'GBP', 'INR', 'SAR'].map(c => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Run</Button>
              <Button icon={<DownloadOutlined />} disabled={!data} onClick={exportExcel}>Excel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {error && <Alert type="error" showIcon message="Could not run the trial balance" description={error} style={{ marginBottom: 12 }} />}

      {data && t && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }} wrap={false}>
            {isPtd ? (
              <>
                <Col flex="1">
                  <Tooltip title="Total of the Payables column in Transactions (invoices, payments and prepayments of the period)">
                    <Card size="small" hoverable onClick={() => { setTab('invoices'); setTxView('recon'); }}>
                      <Statistic title={`Payables activity ${periodLabel}`} value={ptdAp} precision={2} />
                    </Card>
                  </Tooltip>
                </Col>
                <Col flex="1">
                  <Tooltip title="Net (Cr − Dr) of the GL lines of the period on the liability account(s) — see Account Analysis">
                    <Card size="small" hoverable onClick={() => setTab('analysis')}>
                      <Statistic title={`GL movement ${periodLabel}`} value={ptdGl} precision={2} />
                    </Card>
                  </Tooltip>
                </Col>
                <Col flex="1">
                  <Card size="small">
                    <Statistic title="Period difference" value={ptdAp - ptdGl} precision={2}
                      valueStyle={{ color: isZero(ptdAp - ptdGl) ? REDWOOD.success : REDWOOD.primary }}
                      prefix={isZero(ptdAp - ptdGl) ? <CheckCircleOutlined /> : <WarningOutlined />} />
                  </Card>
                </Col>
                <Col flex="1">
                  <Tooltip title={`Payables closing ${fmt(t.tb_total)} vs GL closing ${fmt(t.gl_balance)} at ${data.asOfDate}`}>
                    <Card size="small">
                      <Statistic title="Closing difference" value={t.difference} precision={2}
                        valueStyle={{ color: reconciled ? REDWOOD.success : REDWOOD.primary }} />
                    </Card>
                  </Tooltip>
                </Col>
              </>
            ) : (
              <>
                <Col flex="1">
                  <Tooltip title="Payables side: open balance of the accounted invoices (invoice − payments − prepayments applied), i.e. the supplier balances. Compare with GL Balance.">
                    <Card size="small" hoverable onClick={() => setTab('suppliers')}>
                      <Statistic title="Payables Balance (AED)" value={t.tb_total} precision={2} />
                    </Card>
                  </Tooltip>
                </Col>
                <Col flex="1">
                  <Tooltip title="GL Trial Balance basis: every combination of the liability account(s), lines by GL period — click for the month-by-month Account Analysis">
                    <Card size="small" hoverable onClick={() => setTab('analysis')}>
                      <Statistic title="GL Balance (AED)" value={t.gl_balance} precision={2} />
                    </Card>
                  </Tooltip>
                </Col>
                <Col flex="1">
                  <Card size="small">
                    <Statistic title="Difference" value={t.difference} precision={2}
                      valueStyle={{ color: reconciled ? REDWOOD.success : REDWOOD.primary }}
                      prefix={reconciled ? <CheckCircleOutlined /> : <WarningOutlined />} />
                  </Card>
                </Col>
              </>
            )}
            <Col flex="1">
              <Tooltip title="Invoices, payments and prepayment applications dated on or before the closing date that have no posted GL journal yet. They are in neither the trial balance nor GL; posting them changes both by this amount.">
                <Card size="small" hoverable onClick={() => setTab('pending')}>
                  <Statistic title={`Pending accounting (${data.unaccounted.length})`} value={t.unaccounted_effect} precision={2}
                    valueStyle={{ color: data.unaccounted.length ? REDWOOD.warning : undefined }} />
                </Card>
              </Tooltip>
            </Col>
          </Row>

          {isPtd && !isZero(rollGap) && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message={`Balance roll-forward activity is ${fmt(rollForward)} — ${fmt(rollGap)} different from the ${periodLabel} transactions (${fmt(ptdAp)})`}
              description={`The roll-forward (closing ${fmt(t.tb_total)} − opening ${fmt(t.tb_opening || 0)}) only counts payments and prepayments on invoices that are themselves in the balance at period end. Payments or prepayments in ${periodLabel} against invoices accounted after ${data.asOfDate} (or not accounted yet) are in the transactions and in GL but not in the roll-forward — that is the ${fmt(rollGap)}.`} />
          )}

          <Card size="small" styles={{ body: { paddingTop: 0 } }}>
            <Tabs activeKey={tab} onChange={setTab} items={[
              {
                key: 'summary', label: 'Summary by Account',
                children: (
                  <Table<AccountRow> size="small" rowKey="account" columns={accountCols} dataSource={data.accounts}
                    pagination={false} bordered={isPtd} scroll={isPtd ? { x: 1900 } : undefined}
                    summary={() => (
                      <Table.Summary.Row style={{ fontWeight: 600, background: REDWOOD.neutral100 }}>
                        <Table.Summary.Cell index={0} colSpan={3}>Total</Table.Summary.Cell>
                        {accountTotalKeys.map((k, i) => (
                          <Table.Summary.Cell key={k} index={3 + i} align="right">
                            {fmt((t as unknown as Record<string, number>)[k])}
                          </Table.Summary.Cell>
                        ))}
                      </Table.Summary.Row>
                    )} />
                ),
              },
              {
                key: 'suppliers', label: `By Supplier (${suppliers.length})`,
                children: (
                  <Table<SupplierRow> size="small" rowKey="key" columns={supplierCols} dataSource={suppliers}
                    scroll={isPtd ? { x: 1400 } : undefined}
                    pagination={{ pageSize: 50, showSizeChanger: false, showTotal: n => `${n} suppliers` }} />
                ),
              },
              {
                key: 'invoices', label: isPtd ? `Transactions ${periodLabel} (${recon.length})` : `Invoices (${data.invoices.length})`,
                children: isPtd && txView === 'recon' ? (
                  <>
                    <Space style={{ marginBottom: 8 }} wrap>
                      <Segmented value={txView} onChange={v => setTxView(v as 'recon' | 'invoices')}
                        options={[{ label: 'Payables vs GL', value: 'recon' }, { label: 'Invoice detail', value: 'invoices' }]} />
                      <Segmented value={reconFilter} onChange={v => setReconFilter(v as 'all' | ReconStatus)} options={[
                        { label: `All (${recon.length})`, value: 'all' },
                        { label: `Matched (${reconCount('matched')})`, value: 'matched' },
                        { label: `Amount differs (${reconCount('amount')})`, value: 'amount' },
                        { label: `X in GL (${reconCount('no_gl')})`, value: 'no_gl' },
                        { label: `X in Payables (${reconCount('no_ap')})`, value: 'no_ap' },
                      ]} />
                      <Input.Search allowClear placeholder="Search document, supplier, account…" style={{ width: 260 }}
                        value={invSearch} onChange={e => setInvSearch(e.target.value)} />
                      {drill && (
                        <Tag closable color="blue" onClose={() => setDrill(null)}>
                          {drill.supplier ? `Supplier ${drill.supplier}` : ''}{drill.supplier && drill.account ? ' · ' : ''}{drill.account || ''}
                        </Tag>
                      )}
                    </Space>
                    <Table<ReconRow> size="small" rowKey="key" columns={reconCols} dataSource={reconShown}
                      scroll={{ x: 1650 }} pagination={{ pageSize: 50, showSizeChanger: false }}
                      rowClassName={r => (r.status === 'matched' ? '' : 'tb-recon-issue')}
                      expandable={{
                        rowExpandable: r => r.lines.length > 0,
                        expandedRowRender: r => (
                          <Table<GlLine> size="small" rowKey={(g, i) => `${g.je_header_id}-${i}`} pagination={false}
                            columns={glCols} dataSource={r.lines} scroll={{ x: 1500 }} />
                        ),
                      }}
                      summary={rows => {
                        const ap = rows.reduce((t, r) => t + (r.ap ?? 0), 0);
                        const glT = rows.reduce((t, r) => t + (r.gl ?? 0), 0);
                        return (
                          <Table.Summary.Row style={{ fontWeight: 600, background: REDWOOD.neutral100 }}>
                            <Table.Summary.Cell index={0} colSpan={5}>Total (this page)</Table.Summary.Cell>
                            <Table.Summary.Cell index={5} align="right">{fmt(ap)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={6} align="right">{fmt(glT)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">{fmt(ap - glT)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={8} colSpan={3} />
                          </Table.Summary.Row>
                        );
                      }}
                    />
                    <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                      All rows ({reconShown.length}): Payables {fmt(reconShown.reduce((t, r) => t + (r.ap ?? 0), 0))}
                      {' · '}GL {fmt(reconShown.reduce((t, r) => t + (r.gl ?? 0), 0))}
                      {' · '}Difference {fmt(reconShown.reduce((t, r) => t + (r.ap ?? 0) - (r.gl ?? 0), 0))} AED
                    </Text>
                  </>
                ) : (
                  <>
                    <Space style={{ marginBottom: 8 }} wrap>
                      {isPtd && (
                        <Segmented value={txView} onChange={v => setTxView(v as 'recon' | 'invoices')}
                          options={[{ label: 'Payables vs GL', value: 'recon' }, { label: 'Invoice detail', value: 'invoices' }]} />
                      )}
                      <Input.Search allowClear placeholder="Search invoice, supplier, account…" style={{ width: 300 }}
                        value={invSearch} onChange={e => setInvSearch(e.target.value)} />
                      {drill && (
                        <Tag closable color="blue" onClose={() => setDrill(null)}>
                          {drill.supplier ? `Supplier ${drill.supplier}` : ''}{drill.supplier && drill.account ? ' · ' : ''}{drill.account || ''}
                        </Tag>
                      )}
                      <Text type="secondary">
                        {invoices.length} invoice(s) · open {fmt(invoices.reduce((s, r) => s + (Number(r.open_functional) || 0), 0))} AED
                      </Text>
                    </Space>
                    <Table<InvoiceRow> size="small" rowKey="invoice_id" columns={invoiceCols} dataSource={invoices}
                      scroll={{ x: isPtd ? 2300 : 1800 }} pagination={{ pageSize: 50, showSizeChanger: false }} />
                  </>
                ),
              },
              ...(isPtd ? [{
                key: 'gl', label: `GL Lines ${periodLabel} (${(data.glLines || []).length})`,
                children: (
                  <>
                    <Space style={{ marginBottom: 8 }} wrap>
                      <Segmented value={glFilter} onChange={v => setGlFilter(v as 'all' | 'ap' | 'other')} options={[
                        { label: 'All', value: 'all' },
                        { label: 'From Payables', value: 'ap' },
                        { label: 'Not from Payables', value: 'other' },
                      ]} />
                      <Input.Search allowClear placeholder="Search journal, reference, description…" style={{ width: 300 }}
                        value={glSearch} onChange={e => setGlSearch(e.target.value)} />
                      <Text type="secondary">
                        {glLines.length} line(s) · net {fmt(glLines.reduce((s2, r) => s2 + (Number(r.net) || 0), 0))} AED
                      </Text>
                    </Space>
                    {data.glLinesCapped && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="Showing the first 20,000 GL lines — filter by Liability Account to see all." />}
                    <Alert type="info" showIcon style={{ marginBottom: 8 }}
                      message={`GL entries dated in ${periodLabel} on the liability account(s). Lines not from Payables (manual journals, other sources) are the usual cause of a period difference.`} />
                    <Table<GlLine> size="small" rowKey={(r, i) => `${r.je_header_id}-${i}`} columns={glCols} dataSource={glLines}
                      scroll={{ x: 1700 }} pagination={{ pageSize: 50, showSizeChanger: false }} />
                  </>
                ),
              }, {
                key: 'analysis', label: 'Account Analysis',
                children: (
                  <>
                    <Space style={{ marginBottom: 8 }} wrap>
                      <Text strong>Account</Text>
                      <Select style={{ width: 360 }} value={aaSelected} onChange={setAaAccount}
                        options={aaAccounts.map(a => ({ value: a, label: a }))} />
                      <Text type="secondary">GL opening, every {periodLabel} line with running balance (Cr − Dr), closing</Text>
                    </Space>
                    {data.glLinesCapped && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="GL lines are capped at 20,000 — pick a single liability account for a complete analysis." />}
                    <Table<AaRow> size="small" rowKey="key" dataSource={aaRows} pagination={false}
                      scroll={{ x: 1400, y: 560 }} sticky
                      rowClassName={r => (r.kind === 'line' ? '' : 'tb-aa-strong')}
                      columns={[
                        { title: 'Date', dataIndex: 'date', width: 105 },
                        { title: 'Journal', dataIndex: 'journal', width: 260, ellipsis: true },
                        { title: 'Source', dataIndex: 'source', width: 130, ellipsis: true,
                          render: (v, r) => (r.kind !== 'line' ? null : <Space size={4}>{v || '—'}{r.from_ap ? <Tag color="blue" style={{ fontSize: 10 }}>AP</Tag> : <Tag color="orange" style={{ fontSize: 10 }}>Other</Tag>}</Space>) },
                        { title: 'Reference', dataIndex: 'reference', width: 150, ellipsis: true },
                        { title: 'Description', dataIndex: 'description', ellipsis: true },
                        { title: 'Debit', dataIndex: 'dr', align: 'right', width: 140, render: (v: number | null) => (v ? fmt(v) : '') },
                        { title: 'Credit', dataIndex: 'cr', align: 'right', width: 140, render: (v: number | null) => (v ? fmt(v) : '') },
                        { title: 'Balance', dataIndex: 'balance', align: 'right', width: 150,
                          render: (v: number | null) => (v === null ? '' : money(v)) },
                      ]} />
                  </>
                ),
              }] : [{
                key: 'analysis', label: 'Account Analysis',
                children: (
                  <>
                    <Space style={{ marginBottom: 8 }} wrap>
                      <Text strong>Account</Text>
                      <Select style={{ width: 380 }} value={aaAsofSelected} onChange={setAaAccount}
                        options={[
                          ...(aaAccounts.length > 1 ? [{ value: ALL, label: `All liability accounts (${aaAccounts.length})` }] : []),
                          ...aaAccounts.map(a => ({ value: a, label: a })),
                        ]} />
                      <Text type="secondary">Month by month up to {dayjs(data.asOfDate).format('DD-MMM-YYYY')}: GL debits, credits and running balance (Cr − Dr) vs Payables movement</Text>
                    </Space>
                    <Alert type="info" showIcon style={{ marginBottom: 8 }}
                      message={`GL is on the GL Trial Balance basis${data.ledger ? ` for ledger ${data.ledger}` : ' (all ledgers — no business unit ledger found)'}: lines by GL period (valid, non-adjusting periods), through ${dayjs(data.asOfDate).format('MMM-YY')}${dayjs(data.asOfDate).isSame(dayjs(data.asOfDate).endOf('month'), 'day') ? '' : ` (${dayjs(data.asOfDate).format('MMM-YY')} only up to ${dayjs(data.asOfDate).format('DD-MMM')} — pick the month end to match the GL TB exactly)`}. The balance equals the GL TB closing for the same account and company.`}
                      description={aaTarget.byDate != null && !isZero(aaTarget.byDate - aaTarget.gl)
                        ? `By accounting date instead of GL period the balance would be ${fmt(aaTarget.byDate)} (${fmt(aaTarget.byDate - aaTarget.gl)} different): journals whose period differs from their date, or with no valid period / ledger — the GL Trial Balance leaves them out or counts them in their period.`
                        : undefined} />
                    {(data.glByLedger || []).filter(l => !isZero(l.balance)).length > 1 && (
                      <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                        message="More than one ledger posts to the liability account(s) — only the business unit's ledger is compared, as in the GL Trial Balance"
                        description={(
                          <Space wrap size={[6, 6]}>
                            {(data.glByLedger || []).filter(l => !isZero(l.balance)).map(l => (
                              <Tag key={l.ledger} color={l.ledger === data.ledger ? 'blue' : 'orange'}>
                                {l.ledger}{l.ledger === data.ledger ? ' (used)' : ''}: {fmt(l.balance)}
                              </Tag>
                            ))}
                          </Space>
                        )} />
                    )}
                    <Row gutter={12} style={{ marginBottom: 8 }}>
                      {[
                        { title: 'GL Debits', v: monthTot.dr },
                        { title: 'GL Credits', v: monthTot.cr },
                        { title: 'GL Balance (Cr − Dr)', v: cents(monthTot.cr - monthTot.dr) },
                        { title: 'Payables Balance (open invoices)', v: aaTarget.tb },
                        { title: 'Difference', v: cents(aaTarget.tb - (monthTot.cr - monthTot.dr)), diff: true },
                      ].map(c => (
                        <Col flex="1" key={c.title}>
                          <Card size="small">
                            <Statistic title={c.title} value={c.v} precision={2}
                              valueStyle={c.diff ? { color: isZero(c.v) ? REDWOOD.success : REDWOOD.primary } : undefined}
                              prefix={c.diff ? (isZero(c.v) ? <CheckCircleOutlined /> : <WarningOutlined />) : undefined} />
                          </Card>
                        </Col>
                      ))}
                    </Row>
                    {gapMonths.length > 0 ? (
                      <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                        message={`The difference built up in ${gapMonths.length} month(s) — ${monLabel(monthRows.find(r => !isZero(r.diff))!.month)} is the first. Click a month to open its Payables vs GL transactions (Period mode).`}
                        description={(
                          <Space wrap size={[6, 6]}>
                            {gapMonths.slice(0, 12).map(r => (
                              <Tag key={r.month} color="error" style={{ cursor: 'pointer' }} onClick={() => drillMonth(r.month)}>
                                {monLabel(r.month)}: {fmt(r.diff)}
                              </Tag>
                            ))}
                          </Space>
                        )} />
                    ) : monthRows.length > 0 && (
                      <Alert type="success" showIcon style={{ marginBottom: 8 }} message="Payables and GL moved by the same amount every month." />
                    )}
                    {monthRows.length > 0 && !isZero((monthRows[monthRows.length - 1]?.apBal || 0) - aaTarget.tb) && (
                      <Alert type="info" showIcon style={{ marginBottom: 8 }}
                        message={`Monthly Payables movement adds up to ${fmt(monthRows[monthRows.length - 1].apBal)}; the trial balance is ${fmt(aaTarget.tb)} (${fmt(aaTarget.tb - monthRows[monthRows.length - 1].apBal)} from per-document rounding at the invoice rate).`} />
                    )}
                    {monthRows.length > 1 && (
                      <Card size="small" style={{ marginBottom: 8 }} title={<Text type="secondary" style={{ fontSize: 12 }}>Payables − GL: monthly difference (bars) and cumulative difference (line)</Text>}>
                        <ResponsiveContainer width="100%" height={200}>
                          <ComposedChart data={monthRows.map(r => ({ ...r, label: monLabel(r.month) }))}
                            onClick={(e: any) => { const mm = e?.activePayload?.[0]?.payload?.month; if (mm) drillMonth(mm); }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} width={80} tickFormatter={(v: number) => v.toLocaleString('en-US', { notation: 'compact' })} />
                            <RTooltip formatter={(v: any) => fmt(Number(v))} />
                            <ReferenceLine y={0} stroke="#999" />
                            <Bar dataKey="diff" name="Month difference" cursor="pointer">
                              {monthRows.map(r => <Cell key={r.month} fill={isZero(r.diff) ? REDWOOD.success : REDWOOD.primary} />)}
                            </Bar>
                            <Line dataKey="cumDiff" name="Cumulative difference" stroke={REDWOOD.info} dot={false} strokeWidth={2} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Card>
                    )}
                    <Table<MonthRow> size="small" rowKey="key" dataSource={monthRows} pagination={false} bordered
                      scroll={{ x: 1700, y: 520 }} sticky
                      rowClassName={r => (isZero(r.diff) ? '' : 'tb-recon-issue')}
                      onRow={r => ({ onDoubleClick: () => drillMonth(r.month) })}
                      columns={[
                        { title: 'Period', dataIndex: 'month', key: 'month', fixed: 'left', width: 90,
                          render: (v: string) => <Tooltip title="Open this month in Period (PTD) mode"><a onClick={() => drillMonth(v)}>{monLabel(v)}</a></Tooltip> },
                        { title: 'GL', key: 'gl', children: [
                          { title: 'Lines', dataIndex: 'lines', key: 'lines', align: 'right', width: 70 },
                          { title: 'Debit', dataIndex: 'dr', key: 'dr', align: 'right', width: 140, render: (v: number) => (v ? fmt(v) : '') },
                          { title: 'Credit', dataIndex: 'cr', key: 'cr', align: 'right', width: 140, render: (v: number) => (v ? fmt(v) : '') },
                          { title: 'Net (Cr − Dr)', dataIndex: 'glNet', key: 'glNet', align: 'right', width: 140, render: money },
                          { title: 'Balance', dataIndex: 'glBal', key: 'glBal', align: 'right', width: 150, render: (v: number) => <Text strong>{money(v)}</Text> },
                        ] },
                        { title: 'Payables', key: 'ap', children: [
                          { title: '+ Invoices', dataIndex: 'invoices', key: 'invoices', align: 'right', width: 130, render: (v: number) => (isZero(v) ? '' : money(v)) },
                          { title: '− Cancelled', dataIndex: 'cancellations', key: 'cancellations', align: 'right', width: 120, render: (v: number) => (isZero(v) ? '' : money(v)) },
                          { title: '− Payments', dataIndex: 'payments', key: 'payments', align: 'right', width: 130, render: (v: number) => (isZero(v) ? '' : money(v)) },
                          { title: '− Prepayments', dataIndex: 'prepayments', key: 'prepayments', align: 'right', width: 130, render: (v: number) => (isZero(v) ? '' : money(v)) },
                          { title: 'Net', dataIndex: 'apNet', key: 'apNet', align: 'right', width: 140, render: money },
                          { title: 'Balance', dataIndex: 'apBal', key: 'apBal', align: 'right', width: 150, render: (v: number) => <Text strong>{money(v)}</Text> },
                        ] },
                        { title: 'Payables − GL', key: 'd', children: [
                          { title: 'Month', dataIndex: 'diff', key: 'diff', align: 'right', width: 130, render: diffTag },
                          { title: 'Cumulative', dataIndex: 'cumDiff', key: 'cumDiff', align: 'right', width: 140, render: diffTag },
                        ] },
                      ]}
                      summary={() => monthRows.length ? (
                        <Table.Summary fixed>
                          <Table.Summary.Row className="tb-aa-strong">
                            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right">{monthTot.lines.toLocaleString()}</Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right">{fmt(monthTot.dr)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right">{fmt(monthTot.cr)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">{money(monthTot.cr - monthTot.dr)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={5} align="right"><Text strong>{money(monthTot.cr - monthTot.dr)}</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={6} align="right">{money(monthTot.invoices)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">{money(monthTot.cancellations)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={8} align="right">{money(monthTot.payments)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={9} align="right">{money(monthTot.prepayments)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={10} align="right">{money(monthRows[monthRows.length - 1].apBal)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={11} align="right"><Text strong>{money(monthRows[monthRows.length - 1].apBal)}</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={12} align="right">{diffTag(monthRows[monthRows.length - 1].cumDiff)}</Table.Summary.Cell>
                            <Table.Summary.Cell index={13} align="right">{diffTag(monthRows[monthRows.length - 1].cumDiff)}</Table.Summary.Cell>
                          </Table.Summary.Row>
                        </Table.Summary>
                      ) : null} />
                    {!monthRows.length && <Empty description="No GL or Payables activity for this account — re-deploy rr_ap_payables_trial_balance.sql if this persists" />}
                  </>
                ),
              }]),
              {
                key: 'pending', label: `Pending Accounting (${data.unaccounted.length})`,
                children: (
                  <>
                    <Alert type="info" showIcon style={{ marginBottom: 8 }}
                      message={isPtd ? `Dated in ${periodLabel} but not yet accounted — excluded from both Payables and GL` : 'Not yet accounted — excluded from both the trial balance and GL'}
                      description="Create and post accounting for these to bring them into the liability. Invoices increase it; payments and prepayment applications reduce it." />
                    <Table<PendingRow> size="small" rowKey={r => `${r.type}-${r.id}`} columns={pendingCols}
                      dataSource={data.unaccounted} pagination={{ pageSize: 50, showSizeChanger: false }} />
                  </>
                ),
              },
            ]} />
          </Card>
        </>
      )}

      <Drawer
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />API Inspector</Space>}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        width={760}
        extra={
          <Space>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={loading}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={() => form.submit()}>Run report</Button>
            <Button icon={<DeleteOutlined />} disabled={!calls.length} onClick={() => setCalls([])}>Clear</Button>
          </Space>
        }
      >
        {!calls.length
          ? <Empty description="No calls yet — press Run report" />
          : (
            <Collapse
              defaultActiveKey={[String(calls[0].id)]}
              items={calls.map(c => ({
                key: String(c.id),
                label: (
                  <Space wrap size={6}>
                    <Tag color="green">GET</Tag>
                    <Text strong>{c.label}</Text>
                    {c.status === null && !c.error && <Tag color="processing">running…</Tag>}
                    {c.status !== null && <Tag color={c.status < 400 ? 'success' : 'error'}>HTTP {c.status}</Tag>}
                    {c.error && <Tag color="error">failed</Tag>}
                    {c.ms !== null && <Text type="secondary">{c.ms.toLocaleString()} ms</Text>}
                    <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(c.at).format('HH:mm:ss')}</Text>
                  </Space>
                ),
                children: (
                  <>
                    <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', display: 'block', marginBottom: 8 }}>{c.url}</Text>
                    <Space style={{ marginBottom: 8 }}>
                      <Button size="small" icon={<ReloadOutlined />} onClick={() => { callApi(`${c.label} (re-run)`, c.url).catch(() => {}); }}>Call again</Button>
                      <Button size="small" icon={<ExportOutlined />} onClick={() => window.open(c.url, '_blank', 'noopener')}>Open in browser</Button>
                    </Space>
                    {c.error && <Alert type="error" showIcon message={c.error} style={{ marginBottom: 8 }} />}
                    <pre style={{ maxHeight: 360, overflow: 'auto', margin: 0, padding: 8, fontSize: 11, background: '#1e1e1e', color: '#d4d4d4', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {c.status === null && !c.error ? 'Waiting for response…' : (() => {
                        try { return JSON.stringify(JSON.parse(c.response), null, 2).slice(0, 50000); } catch { return c.response || '(empty response)'; }
                      })()}
                    </pre>
                  </>
                ),
              }))}
            />
          )}
      </Drawer>
    </div>
  );
}
