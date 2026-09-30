// Run a Profit & Loss statement from an Income Statement Template.
// The template's groups → sections → accounts (single natural accounts or from–to
// ranges) are applied to the GL trial balance of the chosen ledger/period
// (GET gl/rr-trialbalance/standard — RR_V_STANDARD_TB), and the template totals
// (formulas over group/total codes, e.g. "G1+G2", "T2+T3") are evaluated.
//
// Amounts are Credit − Debit: income positive, expenses negative (shown in
// brackets) — the seeded totals rely on this (T2 Profit from Operations = G1+G2).
//   Period = the period's movement (PTD), YTD = fiscal-year-to-date.
import { useEffect, useMemo, useState } from 'react';
import {
  Card, Form, Select, Input, Button, Space, Typography, Alert, Table, Tag, Tooltip, Row, Col, Statistic, Empty, Segmented, message,
  Collapse, Modal,
} from 'antd';
import {
  PlayCircleOutlined, DownloadOutlined, FilePdfOutlined, WarningOutlined, CalculatorOutlined, ZoomInOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAppBranding } from '../../config/company.config';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { buildApexUrl } from '../../config/api.helper';
import type { PLTemplateStructure, PLSectionAccount } from '../../services/pl-templates.service';

const { Text, Title } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;
const RED = '#C74634';

interface TbRow {
  account: string; account_desc: string | null; account_type: string | null; company: string | null;
  debit: number; credit: number; ytd_debit: number; ytd_credit: number;
}
interface Amt { ptd: number; ytd: number }
interface AcctLine { account: string; desc: string | null; ptd: number; ytd: number }
type RowKind = 'group' | 'section' | 'account' | 'groupTotal' | 'total' | 'error';
interface DrillLine { account: string; desc: string | null; section: string; ptd: number; ytd: number }
interface PLRow {
  key: string; kind: RowKind; label: string; code?: string; ptd?: number; ytd?: number;
  indent: number; style?: string; error?: string; children?: PLRow[];
  drill?: DrillLine[];   // group / section: the accounts behind the amount
}

const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number | undefined) => {
  if (n === undefined || n === null) return '';
  const v = r2(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

// natural account matches a template line: exact code, or from–to range (numeric
// comparison when both ends and the account are numeric, else text comparison)
const matches = (acct: string, a: PLSectionAccount) => {
  const from = a.account_from?.trim(); const to = a.account_to?.trim();
  if (from && to) {
    if (/^\d+$/.test(acct) && /^\d+$/.test(from) && /^\d+$/.test(to)) {
      const n = Number(acct); return n >= Number(from) && n <= Number(to);
    }
    return acct >= from && acct <= to;
  }
  return !!a.account_code && acct === a.account_code.trim();
};

// ── formula evaluator: codes (G1, T2, …), numbers, + - * / and ( ) ────────────
const evalFormula = (formula: string, lookup: (code: string) => number): number => {
  const tokens = String(formula).replace(/\s+/g, '').match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[+\-*/()]/g) || [];
  if (tokens.join('') !== String(formula).replace(/\s+/g, '')) throw new Error(`Invalid formula "${formula}"`);
  let i = 0;
  const peek = () => tokens[i];
  const primary = (): number => {
    const t = tokens[i++];
    if (t === undefined) throw new Error(`Incomplete formula "${formula}"`);
    if (t === '(') { const v = expr(); if (tokens[i++] !== ')') throw new Error(`Missing ) in "${formula}"`); return v; }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) return lookup(t.toUpperCase());
    throw new Error(`Unexpected "${t}" in "${formula}"`);
  };
  const term = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') { const op = tokens[i++]; const r = primary(); v = op === '*' ? v * r : (r === 0 ? 0 : v / r); }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = tokens[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  const v = expr();
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i]}" in "${formula}"`);
  return v;
};

export default function ProfitLossRun({ structure }: { structure: PLTemplateStructure }) {
  const tpl = structure.template;
  const [form] = Form.useForm();
  const [ledgers, setLedgers] = useState<string[]>([]);
  const [periods, setPeriods] = useState<{ name: string; year?: number }[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tb, setTb] = useState<TbRow[] | null>(null);
  const [ran, setRan] = useState<{ ledger: string; period: string; company?: string; currency?: string } | null>(null);
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const ledger = Form.useWatch('ledger', form);
  const [companies, setCompanies] = useState<string[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());

  // company names from the COA company value set (same list as the Trial Balance page)
  useEffect(() => {
    fetch(buildApexUrl('valuesets/getvalues/BUIMERC_FIN_GLB_COA_CO'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const m = new Map<string, string>();
        for (const i of (d?.items || []) as any[]) {
          const code = i.value || i.Value; const desc = i.description || i.Description;
          if (code && desc) m.set(String(code), String(desc));
        }
        setCompanyNames(m);
      })
      .catch(() => {});
  }, []);

  // company codes that have balances in the selected ledger
  useEffect(() => {
    if (!ledger) return;
    setCompaniesLoading(true);
    fetch(`${BASE}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceCompanies}?ledger_name=${encodeURIComponent(ledger)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const list = [...new Set(((d?.items || []) as any[]).map(i => i.company).filter(Boolean).map(String))].sort();
        setCompanies(list);
        const cur = form.getFieldValue('company');
        if (cur && list.length && !list.includes(cur)) form.setFieldsValue({ company: undefined });
      })
      .catch(() => setCompanies([]))
      .finally(() => setCompaniesLoading(false));
  }, [ledger, form]);

  useEffect(() => {
    fetch(`${BASE}/gl/getledgername`).then(r => (r.ok ? r.json() : null)).then(d => {
      const names = [...new Set(((d?.items || []) as any[]).map(i => i.ledger_name).filter(Boolean))] as string[];
      setLedgers(names);
      if (names.length && !form.getFieldValue('ledger')) form.setFieldsValue({ ledger: names[0] });
    }).catch(() => {});
  }, [form]);

  useEffect(() => {
    if (!ledger) return;
    setPeriodsLoading(true);
    fetch(`${BASE}/gl/rr-trialbalance/periods?ledger_name=${encodeURIComponent(ledger)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const items: any[] = d?.items || [];
        const list = items.map(i => ({ name: i.period_name || i.period_name_id, year: i.period_year })).filter(p => p.name);
        setPeriods(list);
        if (list.length && !form.getFieldValue('period')) form.setFieldsValue({ period: list[0].name });
      })
      .catch(() => setPeriods([]))
      .finally(() => setPeriodsLoading(false));
  }, [ledger, form]);

  const run = async () => {
    const v = await form.validateFields();
    setRunning(true); setError(null);
    try {
      const rows: TbRow[] = [];
      let currency = '';
      const pageSize = 5000;
      for (let offset = 0, guard = 0; guard < 100; guard++) {
        const p = new URLSearchParams({ ledger_name: v.ledger, period_name: v.period, limit: String(pageSize), offset: String(offset) });
        if (v.company?.trim()) p.set('company', v.company.trim());
        const res = await fetch(`${BASE}/gl/rr-trialbalance/standard?${p}`, { headers: { Accept: 'application/json' } });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d?.message || `Trial balance HTTP ${res.status}`);
        const items: any[] = d.items || [];
        for (const i of items) {
          if (!currency) currency = i.ledger_currency || i.currency_code || i.currency || '';
          rows.push({
            account: String(i.account ?? '').trim(), account_desc: i.account_desc ?? null,
            account_type: i.account_type ?? null, company: i.company ?? null,
            debit: num(i.debit), credit: num(i.credit), ytd_debit: num(i.ytd_debit), ytd_credit: num(i.ytd_credit),
          });
        }
        if (!d.hasMore || !items.length) break;
        offset += items.length;
      }
      setTb(rows);
      setRan({ ledger: v.ledger, period: v.period, company: v.company?.trim() || undefined, currency: currency || undefined });
      if (!rows.length) message.warning(`No trial balance rows for ${v.ledger} / ${v.period}`);
    } catch (e: any) {
      setTb(null);
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  // ── compute the statement ──────────────────────────────────────────────────
  const result = useMemo(() => {
    if (!tb) return null;
    // net per natural account, Credit − Debit
    const byAcct = new Map<string, AcctLine>();
    for (const r of tb) {
      if (!r.account) continue;
      const a = byAcct.get(r.account) || { account: r.account, desc: r.account_desc, ptd: 0, ytd: 0 };
      a.ptd += r.credit - r.debit;
      a.ytd += r.ytd_credit - r.ytd_debit;
      if (!a.desc && r.account_desc) a.desc = r.account_desc;
      byAcct.set(r.account, a);
    }
    const acctType = new Map(tb.map(r => [r.account, r.account_type]));
    const used = new Map<string, string[]>();   // account → sections using it
    const groupVal = new Map<string, Amt>();
    const groups = [...(tpl.groups || [])].sort((a, b) => a.display_order - b.display_order);
    const groupRows = new Map<string, PLRow>();
    let revenueYtd = 0; let revenuePtd = 0;

    for (const g of groups) {
      const gAmt: Amt = { ptd: 0, ytd: 0 };
      const secRows: PLRow[] = [];
      const gDrill: DrillLine[] = [];
      for (const s of [...(g.sections || [])].sort((a, b) => a.display_order - b.display_order)) {
        const sAmt: Amt = { ptd: 0, ytd: 0 };
        const acctRows: PLRow[] = [];
        const sDrill: DrillLine[] = [];
        const secName = s.section_label || s.section_name;
        for (const [acct, line] of byAcct) {
          if (!(s.accounts || []).some(a => matches(acct, a))) continue;
          sAmt.ptd += line.ptd; sAmt.ytd += line.ytd;
          used.set(acct, [...(used.get(acct) || []), `${g.group_code}/${s.section_code}`]);
          if (Math.abs(line.ptd) >= 0.005 || Math.abs(line.ytd) >= 0.005) {
            sDrill.push({ account: acct, desc: line.desc, section: secName, ptd: line.ptd, ytd: line.ytd });
            acctRows.push({ key: `a-${s.section_id}-${acct}`, kind: 'account', label: `${acct}${line.desc ? ` · ${line.desc}` : ''}`,
              code: acct, ptd: line.ptd, ytd: line.ytd, indent: 3 });
          }
        }
        acctRows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
        sDrill.sort((a, b) => a.account.localeCompare(b.account));
        gDrill.push(...sDrill);
        gAmt.ptd += sAmt.ptd; gAmt.ytd += sAmt.ytd;
        secRows.push({ key: `s-${s.section_id}`, kind: 'section', label: secName, code: s.section_code,
          ptd: sAmt.ptd, ytd: sAmt.ytd, indent: 2, children: acctRows.length ? acctRows : undefined, drill: sDrill });
      }
      groupVal.set(g.group_code.toUpperCase(), gAmt);
      if (g.group_type === 'REVENUE') { revenueYtd += gAmt.ytd; revenuePtd += gAmt.ptd; }
      groupRows.set(g.group_code, {
        key: `g-${g.group_id}`, kind: 'group', label: g.group_label || g.group_name, code: g.group_code,
        ptd: gAmt.ptd, ytd: gAmt.ytd, indent: 1, children: secRows.length ? secRows : undefined, drill: gDrill,
      });
    }

    // totals: evaluated on demand so one total can use another; cycles reported
    const totals = [...(tpl.totals || [])];
    const totalByCode = new Map(totals.map(t => [t.total_code.toUpperCase(), t]));
    const totalVal = new Map<string, Amt | Error>();
    const evalTotal = (code: string, stack: string[]): Amt => {
      const cached = totalVal.get(code);
      if (cached instanceof Error) throw cached;
      if (cached) return cached;
      if (stack.includes(code)) throw new Error(`Circular total: ${[...stack, code].join(' → ')}`);
      const t = totalByCode.get(code)!;
      const look = (field: 'ptd' | 'ytd') => (c: string) => {
        if (groupVal.has(c)) return groupVal.get(c)![field];
        if (totalByCode.has(c)) return evalTotal(c, [...stack, code])[field];
        throw new Error(`Unknown code ${c} in ${t.total_code} = ${t.calculation_formula}`);
      };
      try {
        const v = { ptd: evalFormula(t.calculation_formula, look('ptd')), ytd: evalFormula(t.calculation_formula, look('ytd')) };
        totalVal.set(code, v);
        return v;
      } catch (e: any) {
        const err = e instanceof Error ? e : new Error(String(e));
        totalVal.set(code, err);
        throw err;
      }
    };

    // statement rows: groups and totals in display order
    type Item = { order: number; row: PLRow };
    const items: Item[] = groups.map(g => ({ order: g.display_order, row: groupRows.get(g.group_code)! }));
    for (const t of totals) {
      let row: PLRow;
      try {
        const v = evalTotal(t.total_code.toUpperCase(), []);
        row = { key: `t-${t.total_id}`, kind: 'total', label: t.total_label || t.total_name, code: t.total_code, ptd: v.ptd, ytd: v.ytd, indent: 0, style: t.row_style };
      } catch (e: any) {
        row = { key: `t-${t.total_id}`, kind: 'error', label: t.total_label || t.total_name, code: t.total_code, indent: 0, error: e.message };
      }
      items.push({ order: t.display_order, row });
    }
    items.sort((a, b) => a.order - b.order);

    // checks: unmapped P&L accounts, accounts used by several sections, TB net income
    const unmapped: AcctLine[] = [];
    let tbNetYtd = 0; let tbNetPtd = 0;
    for (const [acct, line] of byAcct) {
      const type = (acctType.get(acct) || '').toUpperCase();
      if (type === 'R' || type === 'E') {
        tbNetYtd += line.ytd; tbNetPtd += line.ptd;
        if (!used.has(acct) && (Math.abs(line.ptd) >= 0.005 || Math.abs(line.ytd) >= 0.005)) unmapped.push(line);
      }
    }
    unmapped.sort((a, b) => Math.abs(b.ytd) - Math.abs(a.ytd));
    const duplicates = [...used.entries()].filter(([, secs]) => secs.length > 1);
    // the statement's bottom line = the last total that is not "comprehensive"-only
    const bottom = [...items].reverse().find(i => i.row.kind === 'total' && !/comprehensive/i.test(i.row.label))
      || [...items].reverse().find(i => i.row.kind === 'total');
    const mappedYtd = [...used.keys()].reduce((s, a) => s + (byAcct.get(a)?.ytd || 0), 0);
    return {
      rows: items.map(i => i.row), unmapped, duplicates, revenueYtd, revenuePtd,
      tbNetYtd, tbNetPtd, bottom: bottom?.row, mappedYtd,
      unmappedYtd: unmapped.reduce((s, a) => s + a.ytd, 0),
    };
  }, [tb, tpl]);

  // drill popup (group / section → accounts)
  const [drillRow, setDrillRow] = useState<PLRow | null>(null);
  const [drillSearch, setDrillSearch] = useState('');
  const openDrill = (r: PLRow) => { if (r.drill) { setDrillSearch(''); setDrillRow(r); } };
  const drillLines = useMemo(() => {
    if (!drillRow?.drill) return [];
    const q = drillSearch.trim().toLowerCase();
    return q ? drillRow.drill.filter(l => `${l.account} ${l.desc || ''} ${l.section}`.toLowerCase().includes(q)) : drillRow.drill;
  }, [drillRow, drillSearch]);

  const pct = (v: number | undefined, base: number) => (v === undefined || !base ? '' : `${r2((v / Math.abs(base)) * 100).toFixed(1)}%`);
  const rowsForView = useMemo(() => {
    if (!result) return [];
    if (view === 'detail') return result.rows;
    // summary: groups with sections, no account level
    return result.rows.map(r => (r.kind === 'group'
      ? { ...r, children: r.children?.map(s => ({ ...s, children: undefined })) }
      : r));
  }, [result, view]);

  const columns: ColumnsType<PLRow> = [
    {
      title: 'Line', dataIndex: 'label', key: 'label',
      render: (_: unknown, r) => {
        if (r.kind === 'error') return <Space><Text strong>{r.label}</Text><Tag color="error" icon={<WarningOutlined />}>{r.error}</Tag></Space>;
        if (r.kind === 'total') return <Text strong style={{ fontSize: 14 }}>{r.label}</Text>;
        const drillIcon = r.drill ? <ZoomInOutlined className="pl-drill-icon" style={{ marginLeft: 6, color: '#1677ff', fontSize: 12 }} /> : null;
        if (r.kind === 'group') return <a onClick={() => openDrill(r)} style={{ color: 'inherit' }}><Text strong>{r.label} <Text type="secondary" style={{ fontSize: 11 }}>({r.code})</Text></Text>{drillIcon}</a>;
        if (r.kind === 'section') return <a onClick={() => openDrill(r)} style={{ color: 'inherit' }}><Text>{r.label}</Text>{drillIcon}</a>;
        return <Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Text>;
      },
    },
    {
      title: ran ? `Period ${ran.period}` : 'Period', dataIndex: 'ptd', key: 'ptd', align: 'right', width: 170,
      onCell: r => ({ onClick: () => openDrill(r), style: r.drill ? { cursor: 'pointer' } : undefined }),
      render: (v: number | undefined, r) => <Text strong={r.kind === 'total' || r.kind === 'group'}
        style={{ fontVariantNumeric: 'tabular-nums', color: (v ?? 0) < 0 ? RED : undefined }}>{fmt(v)}</Text>,
    },
    {
      title: 'Year to date', dataIndex: 'ytd', key: 'ytd', align: 'right', width: 170,
      onCell: r => ({ onClick: () => openDrill(r), style: r.drill ? { cursor: 'pointer' } : undefined }),
      render: (v: number | undefined, r) => <Text strong={r.kind === 'total' || r.kind === 'group'}
        style={{ fontVariantNumeric: 'tabular-nums', color: (v ?? 0) < 0 ? RED : undefined }}>{fmt(v)}</Text>,
    },
    {
      title: <Tooltip title="Year-to-date amount as % of year-to-date revenue (REVENUE groups)">% of revenue</Tooltip>,
      key: 'pct', align: 'right', width: 110,
      render: (_: unknown, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.kind === 'account' ? '' : pct(r.ytd, result?.revenueYtd || 0)}</Text>,
    },
  ];

  const exportExcel = () => {
    if (!result || !ran) return;
    const out: (string | number)[][] = [
      [tpl.template_name], [`Ledger: ${ran.ledger}`, `Period: ${ran.period}`, ran.company ? `Company: ${ran.company}` : ''], [],
      ['Line', 'Code', `Period ${ran.period}`, 'Year to date', '% of revenue'],
    ];
    const walk = (rows: PLRow[], depth: number) => {
      for (const r of rows) {
        out.push([`${'   '.repeat(depth)}${r.label}${r.error ? ` — ${r.error}` : ''}`, r.code || '',
          r.ptd === undefined ? '' : r2(r.ptd), r.ytd === undefined ? '' : r2(r.ytd),
          r.kind === 'account' || r.ytd === undefined || !result.revenueYtd ? '' : r2((r.ytd / Math.abs(result.revenueYtd)) * 100)]);
        if (r.children) walk(r.children, depth + 1);
      }
    };
    walk(result.rows, 0);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), 'Profit and Loss');
    if (result.unmapped.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.unmapped.map(u => ({
        Account: u.account, Description: u.desc, [`Period ${ran.period}`]: r2(u.ptd), 'Year to date': r2(u.ytd),
      }))), 'Unmapped accounts');
    }
    XLSX.writeFile(wb, `PL_${tpl.template_code}_${ran.period}${ran.company ? `_${ran.company}` : ''}.xlsx`);
  };

  // ── PDF: statement layout (A4 portrait) ───────────────────────────────────
  const exportPdf = () => {
    if (!result || !ran) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 16;
    const INK: [number, number, number] = [33, 33, 33];
    const MUTED: [number, number, number] = [110, 110, 110];
    const ACCENT: [number, number, number] = [199, 70, 52];
    const pdfAmt = (n: number | undefined) => {
      if (n === undefined || n === null) return '';
      const v = r2(n);
      if (Math.abs(v) < 0.005) return '-';
      const t = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return v < 0 ? `(${t})` : t;
    };
    const pdfPct = (v: number | undefined) => (v === undefined || !result.revenueYtd ? '' : `${((v / Math.abs(result.revenueYtd)) * 100).toFixed(1)}%`);
    const entity = ran.company
      ? `${companyNames.get(ran.company) || `Company ${ran.company}`}${companyNames.get(ran.company) ? ` (${ran.company})` : ''}`
      : `${ran.ledger} - all companies`;

    // header
    doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 3, 'F');
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(entity, W / 2, 16, { align: 'center' });
    doc.setFontSize(12); doc.text('Statement of Profit or Loss', W / 2, 23, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.text(`For the period ${ran.period} and the year to date`, W / 2, 29, { align: 'center' });
    doc.text(`${tpl.template_name}  |  Ledger: ${ran.ledger}${ran.currency ? `  |  Amounts in ${ran.currency}` : ''}`, W / 2, 34, { align: 'center' });
    doc.setDrawColor(...ACCENT); doc.setLineWidth(0.4); doc.line(M, 38, W - M, 38);

    // body rows — statement style: group heading, lines, "Total <group>" subtotal
    type Kind = 'heading' | 'line' | 'account' | 'subtotal' | 'plain' | 'total' | 'double' | 'error' | 'gap';
    const body: { cells: string[]; kind: Kind }[] = [];
    const withAccounts = view === 'detail';
    // groups the template already totals on their own (e.g. T1 = G1) get no extra "Total …" line
    const ownTotal = new Set((tpl.totals || []).map(t => String(t.calculation_formula || '').replace(/[\s()+]/g, '').toUpperCase()));
    for (const r of result.rows) {
      if (r.kind === 'group') {
        const secs = r.children || [];
        if (!secs.length) { body.push({ kind: 'plain', cells: [r.label, pdfAmt(r.ptd), pdfAmt(r.ytd), pdfPct(r.ytd)] }); body.push({ kind: 'gap', cells: ['', '', '', ''] }); continue; }
        body.push({ kind: 'heading', cells: [r.label, '', '', ''] });
        for (const sct of secs) {
          body.push({ kind: 'line', cells: [`    ${sct.label}`, pdfAmt(sct.ptd), pdfAmt(sct.ytd), pdfPct(sct.ytd)] });
          if (withAccounts) for (const a of sct.children || []) {
            body.push({ kind: 'account', cells: [`         ${a.label}`, pdfAmt(a.ptd), pdfAmt(a.ytd), ''] });
          }
        }
        if (!ownTotal.has(String(r.code || '').toUpperCase())) {
          body.push({ kind: 'subtotal', cells: [`Total ${r.label.toLowerCase()}`, pdfAmt(r.ptd), pdfAmt(r.ytd), pdfPct(r.ytd)] });
          body.push({ kind: 'gap', cells: ['', '', '', ''] });
        }
      } else if (r.kind === 'total') {
        body.push({ kind: r.style === 'DOUBLE_LINE' ? 'double' : 'total', cells: [r.label, pdfAmt(r.ptd), pdfAmt(r.ytd), pdfPct(r.ytd)] });
        body.push({ kind: 'gap', cells: ['', '', '', ''] });
      } else if (r.kind === 'error') {
        body.push({ kind: 'error', cells: [`${r.label}: ${r.error}`, '', '', ''] });
      }
    }
    while (body.length && body[body.length - 1].kind === 'gap') body.pop();

    autoTable(doc, {
      startY: 43,
      margin: { left: M, right: M, top: 20, bottom: 18 },
      head: [['', `Period\n${ran.period}`, 'Year to\ndate', '% of\nrevenue']],
      body: body.map(b => b.cells),
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9.5, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, overflow: 'linebreak' },
      headStyles: { fontStyle: 'bold', fontSize: 9, textColor: INK, halign: 'right', valign: 'bottom' },
      columnStyles: {
        0: { cellWidth: 'auto', halign: 'left' },
        1: { cellWidth: 34, halign: 'right' },
        2: { cellWidth: 34, halign: 'right' },
        3: { cellWidth: 18, halign: 'right', textColor: MUTED, fontSize: 8.5 },
      },
      didParseCell: d => {
        if (d.section !== 'body') return;
        const k = body[d.row.index]?.kind;
        if (k === 'heading') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.cellPadding = { top: 3, bottom: 1.2, left: 1.5, right: 1.5 }; }
        if (k === 'subtotal' || k === 'plain') d.cell.styles.fontStyle = 'bold';
        if (k === 'total' || k === 'double') {
          d.cell.styles.fontStyle = 'bold';
          d.cell.styles.fillColor = [253, 243, 241];
        }
        if (k === 'account') { d.cell.styles.fontSize = 8; d.cell.styles.textColor = MUTED; d.cell.styles.cellPadding = { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 }; }
        if (k === 'gap') { d.cell.styles.cellPadding = 0.8; d.cell.styles.minCellHeight = 1.5; d.cell.styles.fontSize = 2; }
        if (k === 'error') { d.cell.styles.textColor = ACCENT; d.cell.styles.fontStyle = 'italic'; }
        if (d.column.index === 0 && d.cell.colSpan === 1 && k === 'error') d.cell.colSpan = 4;
      },
      didDrawCell: d => {
        if (d.section === 'head' && d.column.index > 0 && d.column.index < 3) {
          doc.setDrawColor(...INK); doc.setLineWidth(0.3);
          doc.line(d.cell.x + 3, d.cell.y + d.cell.height, d.cell.x + d.cell.width - 1, d.cell.y + d.cell.height);
        }
        if (d.section !== 'body' || d.column.index === 0 || d.column.index > 2) return;
        const k = body[d.row.index]?.kind;
        const x1 = d.cell.x + 3; const x2 = d.cell.x + d.cell.width - 1;
        doc.setDrawColor(...INK);
        if (k === 'subtotal' || k === 'total' || k === 'double') {
          doc.setLineWidth(0.25); doc.line(x1, d.cell.y + 0.2, x2, d.cell.y + 0.2);           // single rule above
        }
        if (k === 'double') {
          const yb = d.cell.y + d.cell.height;
          doc.setLineWidth(0.3); doc.line(x1, yb - 0.6, x2, yb - 0.6); doc.line(x1, yb + 0.4, x2, yb + 0.4);   // double underline
        }
      },
    });

    // notes under the statement
    let y = (doc as any).lastAutoTable.finalY + 8;
    const notes: string[] = [];
    notes.push('Amounts are credit less debit: income is shown positive, expenses in brackets.');
    if (result.unmapped.length) {
      notes.push(`${result.unmapped.length} income/expense account(s) with a year-to-date balance of ${pdfAmt(result.unmappedYtd)} are not mapped to this template and are excluded.`);
    }
    if (result.duplicates.length) notes.push(`${result.duplicates.length} account(s) are mapped to more than one section and are counted in each.`);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    for (const n of notes) {
      const lines = doc.splitTextToSize(`- ${n}`, W - 2 * M) as string[];
      if (y + lines.length * 4 > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20; }
      doc.text(lines, M, y); y += lines.length * 4;
    }

    // footer on every page
    const pages = doc.getNumberOfPages();
    const H = doc.internal.pageSize.getHeight();
    const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const brand = getAppBranding();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
      doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text(`${entity}  |  Statement of Profit or Loss  |  ${ran.period}`, M, H - 7.5);
      doc.text(`Generated ${stamp} by ${brand.name}  |  Page ${i} of ${pages}`, W - M, H - 7.5, { align: 'right' });
    }
    doc.save(`PL_${tpl.template_code}_${ran.period}${ran.company ? `_${ran.company}` : ''}.pdf`);
  };

  const exportDrill = () => {
    if (!drillRow?.drill || !ran) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(drillLines.map(l => ({
      Account: l.account, Description: l.desc, Section: l.section, [`Period ${ran.period}`]: r2(l.ptd), 'Year to date': r2(l.ytd),
    }))), 'Accounts');
    XLSX.writeFile(wb, `PL_${tpl.template_code}_${drillRow.code || 'drill'}_${ran.period}.xlsx`);
  };

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
        <Form form={form} layout="inline" onFinish={run} style={{ rowGap: 8 }}>
          <Form.Item name="ledger" label="Ledger" rules={[{ required: true, message: 'Ledger' }]}>
            <Select style={{ width: 220 }} placeholder="Ledger" showSearch options={ledgers.map(l => ({ value: l, label: l }))} />
          </Form.Item>
          <Form.Item name="period" label="Period" rules={[{ required: true, message: 'Period' }]}>
            <Select style={{ width: 140 }} placeholder="Period" showSearch loading={periodsLoading}
              options={periods.map(p => ({ value: p.name, label: p.name }))} />
          </Form.Item>
          <Form.Item name="company" label="Company" tooltip="Companies with balances in the selected ledger — leave empty for all companies">
            <Select style={{ width: 260 }} placeholder="All companies" allowClear showSearch loading={companiesLoading}
              optionFilterProp="label" popupMatchSelectWidth={false}
              notFoundContent={companiesLoading ? 'Loading…' : 'No companies for this ledger'}
              options={companies.map(c => ({ value: c, label: companyNames.get(c) ? `${c} - ${companyNames.get(c)}` : c }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={running}
                style={{ background: RED, borderColor: RED }}>Run P&amp;L</Button>
              <Button icon={<DownloadOutlined />} disabled={!result} onClick={exportExcel}>Excel</Button>
              <Tooltip title="Statement layout, A4. Uses the Sections / Accounts view shown below.">
                <Button icon={<FilePdfOutlined />} disabled={!result} onClick={exportPdf}>PDF</Button>
              </Tooltip>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {error && <Alert type="error" showIcon message="Could not run the P&L" description={error} style={{ marginBottom: 12 }} />}
      {!result && !error && (
        <Card><Empty description={`Choose a ledger and period, then Run — the "${tpl.template_name}" structure is applied to the GL balances`} /></Card>
      )}

      {result && ran && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col flex="1"><Card size="small"><Statistic title={`Revenue (${ran.period})`} value={result.revenuePtd} precision={2} /></Card></Col>
            <Col flex="1">
              <Card size="small">
                <Statistic title={`${result.bottom?.label || 'Result'} (${ran.period})`} value={result.bottom?.ptd ?? 0} precision={2}
                  valueStyle={{ color: (result.bottom?.ptd ?? 0) < 0 ? RED : '#1D7B4D' }} />
              </Card>
            </Col>
            <Col flex="1"><Card size="small"><Statistic title="Revenue (YTD)" value={result.revenueYtd} precision={2} /></Card></Col>
            <Col flex="1">
              <Card size="small">
                <Statistic title={`${result.bottom?.label || 'Result'} (YTD)`} value={result.bottom?.ytd ?? 0} precision={2}
                  valueStyle={{ color: (result.bottom?.ytd ?? 0) < 0 ? RED : '#1D7B4D' }} />
              </Card>
            </Col>
          </Row>

          {(result.unmapped.length > 0 || result.duplicates.length > 0) && (
            <Collapse size="small" style={{ marginBottom: 12, background: '#FFFBE6', borderColor: '#FFE58F' }}
              items={[{
                key: 'checks',
                label: (
                  <Space size={6} wrap>
                    <WarningOutlined style={{ color: '#D48806' }} />
                    {result.unmapped.length > 0 && <Text>{result.unmapped.length} income/expense account(s) not in any section — YTD {fmt(result.unmappedYtd)}</Text>}
                    {result.duplicates.length > 0 && <Text>{result.duplicates.length} account(s) in more than one section</Text>}
                    <Text type="secondary" style={{ fontSize: 12 }}>(not included in the statement — click to see)</Text>
                  </Space>
                ),
                children: (
                  <div style={{ maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                    {result.unmapped.map(u => (
                      <div key={u.account}><Tag>{u.account}</Tag>{u.desc} — YTD {fmt(u.ytd)} · Period {fmt(u.ptd)}</div>
                    ))}
                    {result.duplicates.map(([a, secs]) => (
                      <div key={`d-${a}`}><Tag color="orange">{a}</Tag>in {secs.join(', ')} (counted twice)</div>
                    ))}
                    {result.unmapped.length > 0 && <div style={{ marginTop: 6 }}>Add them to a section with <b>Add Account</b> on the template to include them.</div>}
                  </div>
                ),
              }]} />
          )}

          <Card size="small" style={{ borderRadius: 8 }}
            title={(
              <Space direction="vertical" size={0}>
                <Title level={5} style={{ margin: 0 }}><CalculatorOutlined style={{ color: RED }} /> {tpl.template_name}</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {ran.ledger} · Period {ran.period}{ran.company ? ` · Company ${ran.company}${companyNames.get(ran.company) ? ` - ${companyNames.get(ran.company)}` : ''}` : ' · All companies'} · Credit − Debit (expenses in brackets)
                </Text>
              </Space>
            )}
            extra={<Segmented size="small" value={view} onChange={v => setView(v as 'summary' | 'detail')}
              options={[{ label: 'Sections', value: 'summary' }, { label: 'Accounts', value: 'detail' }]} />}>
            <Table<PLRow> size="small" rowKey="key" columns={columns} dataSource={rowsForView} pagination={false}
              expandable={{ defaultExpandAllRows: true, indentSize: 18 }}
              rowClassName={r => (r.kind === 'total' ? `pl-total${r.style === 'DOUBLE_LINE' ? ' pl-double' : ''}` : r.kind === 'group' ? 'pl-group' : '')} />
            <style>{`
              .pl-total > td { background: #FFF6F4 !important; border-top: 1px solid #E8C4BD !important; }
              .pl-double > td { border-bottom: 3px double #C74634 !important; }
              .pl-group > td { background: #FAFAFA !important; }
            `}</style>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              <ZoomInOutlined /> Click a group or section (or its amount) to see the accounts behind it.
            </Text>
          </Card>

          <Modal open={!!drillRow} onCancel={() => setDrillRow(null)} width={900} zIndex={1100}
            title={drillRow && (
              <Space direction="vertical" size={0}>
                <span>{drillRow.label} {drillRow.code && <Text type="secondary" style={{ fontSize: 12 }}>({drillRow.code})</Text>}</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  {ran.ledger} · Period {ran.period}{ran.company ? ` · Company ${ran.company}` : ''} · {drillRow.drill?.length || 0} account(s)
                </Text>
              </Space>
            )}
            footer={[
              <Button key="x" icon={<DownloadOutlined />} onClick={exportDrill} disabled={!drillLines.length}>Excel</Button>,
              <Button key="c" type="primary" onClick={() => setDrillRow(null)}>Close</Button>,
            ]}>
            <Input allowClear prefix={<SearchOutlined />} placeholder="Search account, description or section"
              value={drillSearch} onChange={e => setDrillSearch(e.target.value)} style={{ marginBottom: 8 }} />
            <Table<DrillLine> size="small" rowKey={l => `${l.section}-${l.account}`} dataSource={drillLines}
              pagination={drillLines.length > 50 ? { pageSize: 50, showSizeChanger: false } : false} scroll={{ y: 420 }}
              columns={[
                { title: 'Account', dataIndex: 'account', width: 110, sorter: (a, b) => a.account.localeCompare(b.account) },
                { title: 'Description', dataIndex: 'desc', ellipsis: true },
                ...(drillRow?.kind === 'group' ? [{ title: 'Section', dataIndex: 'section', width: 190, ellipsis: true,
                  filters: [...new Set((drillRow.drill || []).map(l => l.section))].map(v => ({ text: v, value: v })),
                  onFilter: (v: any, l: DrillLine) => l.section === v }] : []),
                { title: `Period ${ran.period}`, dataIndex: 'ptd', align: 'right' as const, width: 150, sorter: (a, b) => a.ptd - b.ptd,
                  render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
                { title: 'Year to date', dataIndex: 'ytd', align: 'right' as const, width: 150, sorter: (a, b) => a.ytd - b.ytd,
                  render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
              ]}
              summary={rows => {
                const t = rows.reduce((acc, l) => ({ ptd: acc.ptd + l.ptd, ytd: acc.ytd + l.ytd }), { ptd: 0, ytd: 0 });
                const span = drillRow?.kind === 'group' ? 3 : 2;
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: '#FFF6F4' }}>
                      <Table.Summary.Cell index={0} colSpan={span}><Text strong>Total{drillSearch ? ' (filtered)' : ''}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={span} align="right"><Text strong style={{ color: t.ptd < 0 ? RED : undefined }}>{fmt(t.ptd)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={span + 1} align="right"><Text strong style={{ color: t.ytd < 0 ? RED : undefined }}>{fmt(t.ytd)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }} />
          </Modal>
        </>
      )}
    </div>
  );
}
