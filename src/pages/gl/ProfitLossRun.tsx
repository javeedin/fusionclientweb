// Run a financial statement from a template: Income Statement (P&L), Balance Sheet or Cash Flow
// (indirect method) — the template's TEMPLATE_TYPE decides (pl-templates.service statementKindOf).
//   P&L:  Credit − Debit; Period = PTD movement, YTD = fiscal-year-to-date.
//   BS:   closing balances — "As at <period>" and "Start of year" (YTD opening); assets Debit − Credit,
//         liabilities / equity Credit − Debit. Profit for the year is added to Equity unless the template maps
//         P&L accounts itself; retained earnings B/F comes from GET gl/rr-trialbalance/standardRE.
//   CF:   profit for the period + cash effect of balance-sheet movements (opening − closing, debit basis) +
//         non-cash P&L items mapped to it (added back); a "Cash" group gives opening / closing cash and the
//         reconciliation against the cash accounts.
// Original notes for the P&L:
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
  Modal, Tabs, Badge, Checkbox, InputNumber,
} from 'antd';
import { parsePastedAccounts } from './plPaste';
import {
  PlayCircleOutlined, DownloadOutlined, FilePdfOutlined, FileSearchOutlined, PlusOutlined, BulbOutlined, SwapOutlined, FolderAddOutlined, AppstoreAddOutlined, WarningOutlined, CalculatorOutlined, ZoomInOutlined, SearchOutlined, SnippetsOutlined, EyeOutlined, PrinterOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAppBranding } from '../../config/company.config';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { buildApexUrl } from '../../config/api.helper';
import type { PLTemplateStructure, PLSectionAccount } from '../../services/pl-templates.service';
import { assignAccount, removeSectionAccount, moveAccounts, addGroup, addSection, updateTotal, accountMatches, GROUP_TYPES_BY_KIND, statementKindOf, type StatementKind } from '../../services/pl-templates.service';

const { Text, Title } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;
const RED = '#C74634';

// what each statement shows: titles, the two amount columns, which TB account types belong to it
const TYPE_TAG: Record<string, [string, string]> = {
  R: ['green', 'Revenue'], E: ['volcano', 'Expense'], A: ['blue', 'Asset'], L: ['purple', 'Liability'], O: ['gold', 'Equity'],
};
const TypeTag = ({ t }: { t: string }) => { const [c, l] = TYPE_TAG[t] || ['default', t]; return <Tag color={c}>{l}</Tag>; };

const KIND: Record<StatementKind, {
  title: string; short: string; file: string; col1: (p: string) => string; col2: string; pdfSub: (p: string) => string;
  tbTypes: [string, string][]; tbTitle: string; tbIntro: string; tbNetLabel: string; acctWord: string; signNote: string;
  pctTitle?: string; mainField: 'ptd' | 'ytd'; subNote: string;
}> = {
  PL: {
    title: 'Statement of Profit or Loss', short: 'P&L', file: 'PL', col1: p => `Period ${p}`, col2: 'Year to date',
    pdfSub: p => `For the period ${p} and the year to date`,
    tbTypes: [['R', 'Revenue (account type R)'], ['E', 'Expenses (account type E)']],
    tbTitle: 'Profit & Loss as per Trial Balance', tbIntro: 'Every income (type R) and expense (type E) account in the trial balance',
    tbNetLabel: 'Net profit / (loss) as per TB', acctWord: 'income/expense', pctTitle: '% of revenue', mainField: 'ytd', subNote: 'Credit − Debit (expenses in brackets)',
    signNote: 'Amounts are credit less debit: income is shown positive, expenses in brackets.',
  },
  BS: {
    title: 'Statement of Financial Position', short: 'Balance Sheet', file: 'BS', col1: p => `As at ${p}`, col2: 'Start of year',
    pdfSub: p => `As at the end of ${p}, with the start of the financial year`,
    tbTypes: [['A', 'Assets (account type A)'], ['L', 'Liabilities (account type L)'], ['O', 'Equity (account type O)']],
    tbTitle: 'Balance Sheet as per Trial Balance', tbIntro: 'Every asset (A), liability (L) and equity (O) account in the trial balance — liabilities and equity shown credit-positive',
    tbNetLabel: 'Check: assets − liabilities − equity − profit for the year', acctWord: 'balance-sheet', pctTitle: '% of total assets', mainField: 'ptd', subNote: 'Balances at period end and at the start of the year',
    signNote: 'Assets are debit balances; liabilities and equity credit balances, all shown positive. Profit for the year is included in equity.',
  },
  CF: {
    title: 'Statement of Cash Flows', short: 'Cash Flow', file: 'CF', col1: p => `Period ${p}`, col2: 'Year to date',
    pdfSub: p => `For the period ${p} and the year to date (indirect method)`,
    tbTypes: [['A', 'Assets (account type A)'], ['L', 'Liabilities (account type L)'], ['O', 'Equity (account type O)']],
    tbTitle: 'Balance-sheet movements as per Trial Balance', tbIntro: 'Cash effect of every asset, liability and equity account (opening − closing; an increase in an asset is cash out)',
    tbNetLabel: 'Check: profit + all balance-sheet movements incl. cash (= 0)', acctWord: 'balance-sheet', mainField: 'ytd', subNote: 'Indirect method · cash out in brackets',
    signNote: 'Indirect method: profit, plus non-cash items, plus the cash effect of balance-sheet movements (cash in positive, cash out in brackets).',
  },
};

interface TbRow {
  account: string; account_desc: string | null; account_type: string | null; company: string | null;
  debit: number; credit: number; ytd_debit: number; ytd_credit: number;
  opening: number; closing: number; ytd_opening: number;   // debit-positive balances (BS / CF)
}
interface Amt { ptd: number; ytd: number }
interface AcctLine { account: string; desc: string | null; ptd: number; ytd: number }
type RowKind = 'group' | 'section' | 'account' | 'groupTotal' | 'total' | 'error' | 'check' | 'info';
interface MapEntry { sectionId: number; sectionName: string; entry: PLSectionAccount }
interface TbPlLine { account: string; desc: string | null; type: string; ptd: number; ytd: number; sections: string[]; entries: MapEntry[] }
interface TbPlRow {
  key: string; kind: 'group' | 'account' | 'total'; label: string; desc?: string | null; ptd: number; ytd: number;
  sections?: string[]; missing?: boolean; children?: TbPlRow[]; type?: string;
}
interface DrillLine { account: string; desc: string | null; section: string; ptd: number; ytd: number }
interface PLRow {
  key: string; kind: RowKind; label: string; code?: string; ptd?: number; ytd?: number;
  indent: number; style?: string; error?: string; children?: PLRow[]; ok?: boolean;
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

// natural account matches a template line: exact code, or from–to range — shared with the template editor
const matches = accountMatches;

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

export default function ProfitLossRun({ structure, onTemplateChanged }: {
  structure: PLTemplateStructure;
  onTemplateChanged?: () => void | Promise<void>;   // after accounts are added to the template
}) {
  const tpl = structure.template;
  const kind = statementKindOf(tpl.template_type);
  const cfg = KIND[kind];
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
            opening: num(i.opening), ytd_opening: num(i.ytd_opening),
            closing: i.closing == null ? num(i.opening) + num(i.debit) - num(i.credit) : num(i.closing),
          });
        }
        if (!d.hasMore || !items.length) break;
        offset += items.length;
      }
      // Balance Sheet / Cash Flow: retained earnings brought forward from the saved year-end row (same as the TB page)
      if (kind !== 'PL') {
        const year = periods.find(p => p.name === v.period)?.year;
        if (year) {
          try {
            const rp = new URLSearchParams({ ledger_name: v.ledger, period_year: String(year) });
            const rr = await fetch(`${BASE}/${APEX_DB_CONFIG.endpoints.rrTrialBalanceStandardRE}?${rp}`, { headers: { Accept: 'application/json' } });
            const rd = rr.ok ? await rr.json().catch(() => ({})) : {};
            const company = v.company?.trim();
            for (const re of ((rd.items || []) as any[]).filter(r => !company || !r.company || String(r.company) === company)) {
              const acct = String(re.account ?? '').trim();
              if (!acct) continue;
              const bf = num(re.opening);
              const hits = rows.filter(r => r.account === acct && (!re.company || !r.company || String(r.company) === String(re.company)));
              if (hits.length) {
                hits.forEach((h, i) => {
                  const mvt = h.closing - h.opening;
                  const b = i === 0 ? bf : 0;            // B/F once per account / company
                  h.opening = b; h.ytd_opening = b; h.closing = b + mvt;
                  h.account_desc = h.account_desc || 'Retained Earnings';
                });
              } else {
                rows.push({ account: acct, account_desc: 'Retained Earnings', account_type: 'O', company: re.company ?? null,
                  debit: 0, credit: 0, ytd_debit: 0, ytd_credit: 0, opening: bf, ytd_opening: bf, closing: bf });
              }
            }
          } catch { /* no saved retained earnings: the TB balances are used as they are */ }
        }
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
    const normType = (t: string | null) => { const u = (t || '').toUpperCase(); return u === 'OE' ? 'O' : u; };
    const isPlType = (t: string) => t === 'R' || t === 'E';
    // per natural account: the two amounts this statement shows (see header), plus balances for the cash rows
    type Line = AcctLine & { type: string; open: number; openY: number; close: number };
    const byAcct = new Map<string, Line>();
    let profitPtd = 0; let profitYtd = 0;
    for (const r of tb) {
      if (!r.account) continue;
      const type = normType(r.account_type);
      const a = byAcct.get(r.account) || { account: r.account, desc: r.account_desc, ptd: 0, ytd: 0, type, open: 0, openY: 0, close: 0 };
      if (isPlType(type)) { profitPtd += r.credit - r.debit; profitYtd += r.ytd_credit - r.ytd_debit; }
      if (kind === 'PL') { a.ptd += r.credit - r.debit; a.ytd += r.ytd_credit - r.ytd_debit; }
      else if (kind === 'BS') { a.ptd += r.closing; a.ytd += r.ytd_opening; }
      else if (isPlType(type)) { a.ptd += r.debit - r.credit; a.ytd += r.ytd_debit - r.ytd_credit; }   // CF: non-cash P&L item added back
      else { a.ptd += r.opening - r.closing; a.ytd += r.ytd_opening - r.closing; }                       // CF: asset up = cash out, liability up = cash in
      a.open += r.opening; a.openY += r.ytd_opening; a.close += r.closing;
      if (!a.desc && r.account_desc) a.desc = r.account_desc;
      if (!a.type && type) a.type = type;
      byAcct.set(r.account, a);
    }
    const used = new Map<string, string[]>();   // account → sections using it
    const usedNames = new Map<string, string[]>();   // account → section names (As per TB tab)
    const usedEntries = new Map<string, MapEntry[]>();   // account → template rows that pick it up (Move)
    const groupVal = new Map<string, Amt>();
    const groups = [...(tpl.groups || [])].sort((a, b) => a.display_order - b.display_order);
    const groupRows = new Map<string, PLRow>();
    const gtype = (g: { group_type: string }) => String(g.group_type || '').toUpperCase();
    let revenueYtd = 0; let revenuePtd = 0;

    // automatic profit line: BS → in Equity (unless the template maps P&L accounts itself); CF → top of Operating
    const plMapped = kind === 'BS' && [...byAcct.values()].some(l => isPlType(l.type)
      && groups.some(g => (g.sections || []).some(s => (s.accounts || []).some(a => matches(l.account, a)))));
    const autoProfit: Amt | null = kind === 'BS' ? (plMapped ? null : { ptd: profitYtd, ytd: 0 })
      : kind === 'CF' ? { ptd: profitPtd, ytd: profitYtd } : null;
    const autoLabel = kind === 'BS' ? 'Profit / (loss) for the year' : 'Profit / (loss) for the period';
    const autoHome = autoProfit ? groups.find(g => gtype(g) === (kind === 'BS' ? 'EQUITY' : 'OPERATING')) : undefined;
    const cash = { open: 0, openY: 0, close: 0, found: false };
    const hiddenGroups = new Set<string>();

    for (const g of groups) {
      const isCash = kind === 'CF' && gtype(g) === 'CASH';
      const sign = kind === 'BS' && gtype(g) !== 'ASSET' ? -1 : 1;
      const gAmt: Amt = { ptd: 0, ytd: 0 };
      const secRows: PLRow[] = [];
      const gDrill: DrillLine[] = [];
      if (autoProfit && autoHome === g) {
        gAmt.ptd += autoProfit.ptd; gAmt.ytd += autoProfit.ytd;
        secRows.push({ key: `auto-profit-${g.group_id}`, kind: 'section', label: autoLabel, code: 'P&L', ptd: autoProfit.ptd, ytd: autoProfit.ytd, indent: 2 });
      }
      for (const s of [...(g.sections || [])].sort((a, b) => a.display_order - b.display_order)) {
        const sAmt: Amt = { ptd: 0, ytd: 0 };
        const acctRows: PLRow[] = [];
        const sDrill: DrillLine[] = [];
        const secName = s.section_label || s.section_name;
        for (const [acct, line] of byAcct) {
          if (!(s.accounts || []).some(a => matches(acct, a))) continue;
          // cash group: the change in the cash balances; other groups: the statement amount (BS sign per group)
          const v: Amt = isCash ? { ptd: line.close - line.open, ytd: line.close - line.openY } : { ptd: line.ptd * sign, ytd: line.ytd * sign };
          if (isCash) { cash.open += line.open; cash.openY += line.openY; cash.close += line.close; cash.found = true; }
          sAmt.ptd += v.ptd; sAmt.ytd += v.ytd;
          used.set(acct, [...(used.get(acct) || []), `${g.group_code}/${s.section_code}`]);
          usedNames.set(acct, [...(usedNames.get(acct) || []), secName]);
          usedEntries.set(acct, [...(usedEntries.get(acct) || []),
            { sectionId: s.section_id, sectionName: `${g.group_label || g.group_name} › ${secName}`, entry: (s.accounts || []).find(a => matches(acct, a))! }]);
          if (Math.abs(v.ptd) >= 0.005 || Math.abs(v.ytd) >= 0.005) {
            sDrill.push({ account: acct, desc: line.desc, section: secName, ptd: v.ptd, ytd: v.ytd });
            acctRows.push({ key: `a-${s.section_id}-${acct}`, kind: 'account', label: `${acct}${line.desc ? ` · ${line.desc}` : ''}`,
              code: acct, ptd: v.ptd, ytd: v.ytd, indent: 3 });
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
      if (isCash) { hiddenGroups.add(g.group_code); continue; }     // shown as the opening / closing cash rows below
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
    const items: Item[] = groups.filter(g => !hiddenGroups.has(g.group_code)).map(g => ({ order: g.display_order, row: groupRows.get(g.group_code)! }));
    const stray = autoProfit && !autoHome ? autoProfit : null;      // no Equity / Operating group to hold the profit
    if (stray) {
      items.push({ order: Math.max(0, ...groups.map(g => g.display_order)) + 0.5,
        row: { key: 'auto-profit', kind: 'group', label: `${autoLabel} (add a ${kind === 'BS' ? 'Equity' : 'Operating'} group to place it)`, code: 'P&L', ptd: stray.ptd, ytd: stray.ytd, indent: 1 } });
    }
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

    // system rows: BS balance check; CF net change, opening / closing cash and the reconciliation
    const sumType = (types: string[]): Amt => groups.filter(g => types.includes(gtype(g)))
      .reduce((s, g) => { const v = groupVal.get(g.group_code.toUpperCase()); return { ptd: s.ptd + (v?.ptd || 0), ytd: s.ytd + (v?.ytd || 0) }; }, { ptd: 0, ytd: 0 });
    const sys: PLRow[] = [];
    const near0 = (v: number) => Math.abs(v) < 0.5;
    const kpis: { title: string; value: number; color?: string; ok?: boolean; note?: string }[] = [];
    if (kind === 'BS') {
      const assets = sumType(['ASSET']); const liab = sumType(['LIABILITY']); const eq = sumType(['EQUITY']);
      const eqAll = { ptd: eq.ptd + (stray?.ptd || 0), ytd: eq.ytd + (stray?.ytd || 0) };
      const diff = { ptd: assets.ptd - liab.ptd - eqAll.ptd, ytd: assets.ytd - liab.ytd - eqAll.ytd };
      sys.push({ key: 'sys-check', kind: 'check', label: 'Check: total assets − (liabilities + equity)', ptd: diff.ptd, ytd: diff.ytd, indent: 0, ok: near0(diff.ptd) && near0(diff.ytd) });
      kpis.push({ title: 'Total assets', value: assets.ptd }, { title: 'Total liabilities', value: liab.ptd },
        { title: 'Total equity (incl. profit)', value: eqAll.ptd },
        { title: 'Balance check', value: diff.ptd, ok: near0(diff.ptd), note: near0(diff.ptd) ? 'Balanced' : 'Out of balance' });
    }
    if (kind === 'CF') {
      const op = sumType(['OPERATING']); const inv = sumType(['INVESTING']); const fin = sumType(['FINANCING']);
      const net = { ptd: op.ptd + inv.ptd + fin.ptd + (stray?.ptd || 0), ytd: op.ytd + inv.ytd + fin.ytd + (stray?.ytd || 0) };
      sys.push({ key: 'sys-net', kind: 'total', label: 'Net increase / (decrease) in cash and cash equivalents', ptd: net.ptd, ytd: net.ytd, indent: 0 });
      if (cash.found) {
        const end = { ptd: cash.open + net.ptd, ytd: cash.openY + net.ytd };
        const diff = { ptd: end.ptd - cash.close, ytd: end.ytd - cash.close };
        sys.push({ key: 'sys-open', kind: 'info', label: 'Cash and cash equivalents at beginning of period', ptd: cash.open, ytd: cash.openY, indent: 0 });
        sys.push({ key: 'sys-end', kind: 'total', label: 'Cash and cash equivalents at end of period', ptd: end.ptd, ytd: end.ytd, indent: 0, style: 'DOUBLE_LINE' });
        sys.push({ key: 'sys-check', kind: 'check', label: 'Check: vs cash accounts at end of period', ptd: diff.ptd, ytd: diff.ytd, indent: 0, ok: near0(diff.ptd) && near0(diff.ytd) });
        kpis.push({ title: 'Operating activities', value: op.ptd + (stray?.ptd || 0) }, { title: 'Investing activities', value: inv.ptd }, { title: 'Financing activities', value: fin.ptd },
          { title: 'Cash at end of period', value: end.ptd, ok: near0(diff.ptd), note: near0(diff.ptd) ? 'Agrees with the cash accounts' : `Differs from cash accounts by ${fmt(diff.ptd)}` });
      } else {
        sys.push({ key: 'sys-nocash', kind: 'error', label: 'Cash and cash equivalents', indent: 0, error: 'Add a group of type "Cash" with the bank / cash accounts to show opening and closing cash and reconcile' });
        kpis.push({ title: 'Operating activities', value: op.ptd + (stray?.ptd || 0) }, { title: 'Investing activities', value: inv.ptd }, { title: 'Financing activities', value: fin.ptd },
          { title: 'Net change in cash', value: net.ptd });
      }
    }

    // checks: accounts of this statement missing from the template, accounts used by several sections, TB view
    const relevant = (t: string) => (kind === 'PL' ? isPlType(t) : t === 'A' || t === 'L' || t === 'O');
    const unmapped: (AcctLine & { type: string })[] = [];
    const tbLines: TbPlLine[] = [];
    let tbNetYtd = 0; let tbNetPtd = 0;
    for (const [acct, line] of byAcct) {
      const type = line.type;
      if (!relevant(type)) continue;
      const shown = kind === 'BS' && type !== 'A' ? -1 : 1;           // BS view: liabilities / equity credit-positive
      const v = { ptd: line.ptd * shown, ytd: line.ytd * shown };
      tbNetPtd += line.ptd; tbNetYtd += line.ytd;                       // raw: P&L net, BS debit total, CF cash effect total
      const nonZero = Math.abs(v.ptd) >= 0.005 || Math.abs(v.ytd) >= 0.005;
      if (!used.has(acct) && nonZero) unmapped.push({ account: acct, desc: line.desc, ptd: v.ptd, ytd: v.ytd, type });
      if (nonZero) tbLines.push({ account: acct, desc: line.desc, type, ptd: v.ptd, ytd: v.ytd, sections: usedNames.get(acct) || [], entries: usedEntries.get(acct) || [] });
    }
    if (kind === 'BS') { tbNetPtd -= profitYtd; }                       // Σ BS debit balances = profit for the year
    if (kind === 'CF') { tbNetPtd += profitPtd; tbNetYtd += profitYtd; } // profit + Σ movements = 0
    tbLines.sort((a, b) => a.account.localeCompare(b.account));
    const sum = (ls: TbPlLine[]) => ls.reduce((t, l) => ({ ptd: t.ptd + l.ptd, ytd: t.ytd + l.ytd }), { ptd: 0, ytd: 0 });
    const tbGroups = cfg.tbTypes.map(([type, label]) => { const lines = tbLines.filter(l => l.type === type); return { type, label, lines, amt: sum(lines) }; });
    unmapped.sort((a, b) => Math.abs(b[cfg.mainField]) - Math.abs(a[cfg.mainField]));
    const duplicates = [...used.entries()].filter(([, secs]) => secs.length > 1);
    const allRows = [...items.map(i => i.row), ...sys];
    // the statement's bottom line = the last total that is not "comprehensive"-only
    const bottom = [...items].reverse().find(i => i.row.kind === 'total' && !/comprehensive/i.test(i.row.label))
      || [...items].reverse().find(i => i.row.kind === 'total');
    const mappedYtd = [...used.keys()].reduce((s, a) => s + (byAcct.get(a)?.ytd || 0), 0);
    const totalAssets = kind === 'BS' ? sumType(['ASSET']).ptd : 0;
    return {
      rows: allRows, unmapped, duplicates, revenueYtd, revenuePtd,
      tbNetYtd, tbNetPtd, bottom: bottom?.row, mappedYtd,
      unmappedYtd: unmapped.reduce((s, a) => s + a.ytd, 0),
      unmappedPtd: unmapped.reduce((s, a) => s + a.ptd, 0),
      tbGroups, tbAll: tbLines, profitPtd, profitYtd, kpis, totalAssets,
    };
  }, [tb, tpl, kind, cfg]);

  const pct = (v: number | undefined, base: number) => {
    if (v === undefined || !base) return '';
    const p1 = Math.round((v / Math.abs(base)) * 1000) / 10;
    return `${(p1 === 0 ? 0 : p1).toFixed(1)}%`;
  };
  // % column: P&L → YTD as % of YTD revenue; BS → as % of total assets (period end)
  const pctOf = (r: PLRow): string => {
    if (!result || r.kind === 'account' || r.kind === 'check' || r.kind === 'error') return '';
    if (kind === 'PL') return pct(r.ytd, result.revenueYtd || 0);
    if (kind === 'BS') return pct(r.ptd, result.totalAssets || 0);
    return '';
  };

  // tabs: the template statement | P&L as per TB (account type R / E)
  const [plTab, setPlTab] = useState<'template' | 'tb'>('template');
  const [missingOpen, setMissingOpen] = useState(false);
  const [tbFilter, setTbFilter] = useState<'all' | 'missing'>('all');
  const [tbSearch, setTbSearch] = useState('');
  const [tbSel, setTbSel] = useState<string[]>([]);   // selected account codes (bulk move / add)
  const tbRows = useMemo<TbPlRow[]>(() => {
    if (!result) return [];
    const q = tbSearch.trim().toLowerCase();
    const keep = (l: TbPlLine) => (tbFilter === 'all' || !l.sections.length)
      && (!q || `${l.account} ${l.desc || ''} ${l.sections.join(' ')}`.toLowerCase().includes(q));
    const toRow = (l: TbPlLine): TbPlRow => ({ key: `tb-${l.account}`, kind: 'account', label: l.account, desc: l.desc,
      ptd: l.ptd, ytd: l.ytd, sections: l.sections, missing: !l.sections.length, type: l.type });
    return [
      ...result.tbGroups.map(g => {
        const ch = g.lines.filter(keep).map(toRow);
        return { key: `tb-${g.type}`, kind: 'group' as const, label: g.label, ptd: g.amt.ptd, ytd: g.amt.ytd, children: ch.length ? ch : undefined };
      }),
      { key: 'tb-net', kind: 'total' as const, label: cfg.tbNetLabel, ptd: result.tbNetPtd, ytd: result.tbNetYtd },
    ];
  }, [result, tbFilter, tbSearch, cfg]);
  const tbRevYtd = kind === 'PL' ? (result?.tbGroups[0]?.amt.ytd || 0) : 0;

  // ── add missing accounts to the template ─────────────────────────────────
  // sections of the template, labelled "Group › Section"
  const sectionOptions = useMemo(() => [...(tpl.groups || [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map(g => ({
      label: `${g.group_label || g.group_name} (${g.group_code})`,
      groupType: g.group_type,
      options: [...(g.sections || [])].sort((a, b) => a.display_order - b.display_order).map(sct => ({
        value: sct.section_id, label: `${g.group_label || g.group_name} › ${sct.section_label || sct.section_name}`,
        short: sct.section_label || sct.section_name,
      })),
    }))
    .filter(g => g.options.length), [tpl]);
  // dropdown list: section name only (the group is the heading above it); full "Group › Section" on hover
  const sectionPick = {
    popupMatchSelectWidth: false,
    listHeight: 360,
    optionRender: (o: any) => <span title={o.data?.label}>{o.data?.short ?? o.label}</span>,
    labelRender: (l: any) => <span title={String(sectionLabel.get(l.value as number) ?? l.label ?? '')}>{sectionLabel.get(l.value as number) ?? l.label}</span>,
  } as const;
  const sectionLabel = useMemo(() => new Map(sectionOptions.flatMap(g => g.options.map(o => [o.value, o.label] as const))), [sectionOptions]);

  // suggestion: the section of the nearest account code already in the template
  // (longest common prefix, then numerically closest), preferring the same account type
  const suggestSection = useMemo(() => {
    const known: { code: string; sectionId: number; type?: string }[] = [];
    const typeOf = new Map((tb || []).map(r => [r.account, (r.account_type || '').toUpperCase()]));
    for (const g of tpl.groups || []) for (const sct of g.sections || []) for (const a of sct.accounts || []) {
      for (const c of [a.account_code, a.account_from, a.account_to]) {
        if (c && c.trim()) known.push({ code: c.trim(), sectionId: sct.section_id, type: typeOf.get(c.trim()) });
      }
    }
    const prefer: Record<string, string[]> = kind === 'PL' ? { R: ['REVENUE', 'OTHER_INCOME'], E: ['EXPENSE', 'OTHER_EXPENSE', 'TAX'] }
      : kind === 'BS' ? { A: ['ASSET'], L: ['LIABILITY'], O: ['EQUITY'] } : { A: ['OPERATING'], L: ['OPERATING'], O: ['FINANCING'] };
    const firstOfType = (t: string) => (sectionOptions.find(g => (prefer[t] || []).includes(g.groupType))
      || (kind === 'PL' ? sectionOptions.find(g => (t === 'R' ? g.groupType === 'REVENUE' : g.groupType !== 'REVENUE')) : undefined))?.options[0]?.value;
    return (acct: string, type: string): number | undefined => {
      let best: { score: number; dist: number; id: number } | null = null;
      for (const k of known) {
        let pre = 0; while (pre < acct.length && pre < k.code.length && acct[pre] === k.code[pre]) pre++;
        const score = pre * 2 + (k.type === type ? 1 : 0);
        const dist = /^\d+$/.test(acct) && /^\d+$/.test(k.code) ? Math.abs(Number(acct) - Number(k.code)) : 0;
        if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { score, dist, id: k.sectionId };
      }
      return best && best.score >= 4 ? best.id : firstOfType(type);   // at least 2 matching leading digits
    };
  }, [tpl, tb, sectionOptions, kind]);

  interface AddLine { account: string; desc: string | null; type: string; ytd: number; sectionId?: number; suggested?: number; from?: MapEntry[] }
  const [addLines, setAddLines] = useState<AddLine[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [missingSel, setMissingSel] = useState<string[]>([]);
  const openAdd = (accounts: string[]) => {
    if (!result) return;
    const lines = result.unmapped.filter(u => accounts.includes(u.account)).map(u => {
      const sug = suggestSection(u.account, u.type);
      return { account: u.account, desc: u.desc, type: u.type, ytd: u.ytd, sectionId: sug, suggested: sug };
    });
    if (!lines.length) { message.info('Nothing to add'); return; }
    setAddMode('add');
    setAddLines(lines);
  };
  // Move mapped accounts to another section (also fixes accounts that sit in two sections)
  const openMove = (accounts: string[]) => {
    if (!result) return;
    const lines = result.tbAll.filter(l => accounts.includes(l.account) && l.entries.length)
      .map(l => ({ account: l.account, desc: l.desc, type: l.type, ytd: l.ytd, from: l.entries,
        sectionId: undefined as number | undefined, suggested: undefined as number | undefined }));
    if (!lines.length) { message.info('Nothing to move'); return; }
    setAddMode('move');
    setAddLines(lines);
  };
  // Several accounts at once (checkboxes on the TB view): mapped ones move, missing ones are added
  const openBulk = (accounts: string[]) => {
    if (!result) return;
    const set = new Set(accounts);
    const mapped = result.tbAll.filter(l => set.has(l.account) && l.entries.length)
      .map(l => ({ account: l.account, desc: l.desc, type: l.type, ytd: l.ytd, from: l.entries,
        sectionId: undefined as number | undefined, suggested: undefined as number | undefined }));
    const missing = result.unmapped.filter(u => set.has(u.account)).map(u => {
      const sug = suggestSection(u.account, u.type);
      return { account: u.account, desc: u.desc, type: u.type, ytd: u.ytd, from: [] as MapEntry[], sectionId: undefined as number | undefined, suggested: sug };
    });
    const lines = [...mapped, ...missing].sort((a, b) => a.account.localeCompare(b.account));
    if (!lines.length) { message.info('Select accounts first'); return; }
    setAddMode(mapped.length ? 'move' : 'add');
    setAddLines(lines);
  };
  const isRange = (e: PLSectionAccount) => !!(e.account_from && e.account_to);
  // ── paste a list of accounts → add / move them to a group › section ─────────
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteSection, setPasteSection] = useState<number | undefined>();
  const tbLines = useMemo(() => (result ? result.tbAll : []), [result]);
  const sectionLookup = useMemo(() => {
    const m = new Map<string, number>();
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').replace(/\s*[›>\/]\s*/g, '>').trim();
    for (const g of tpl.groups || []) for (const sc of g.sections || []) {
      const gn = [g.group_label, g.group_name, g.group_code].filter(Boolean) as string[];
      for (const sn of [sc.section_label, sc.section_name, sc.section_code].filter(Boolean) as string[]) {
        if (!m.has(norm(sn))) m.set(norm(sn), sc.section_id);
        gn.forEach(x => m.set(norm(`${x}>${sn}`), sc.section_id));
      }
    }
    return { get: (x: string) => m.get(norm(x)) };
  }, [tpl]);
  // where the template picks an account up today (also for accounts with no balance in this TB)
  const entriesFor = (acct: string): MapEntry[] => {
    const out: MapEntry[] = [];
    for (const g of tpl.groups || []) for (const sc of g.sections || []) {
      const e = (sc.accounts || []).find(a => matches(acct, a));
      if (e) out.push({ sectionId: sc.section_id, sectionName: `${g.group_label || g.group_name} › ${sc.section_label || sc.section_name}`, entry: e });
    }
    return out;
  };
  const pasted = useMemo(() => parsePastedAccounts(pasteText, {
    knownAccounts: [...tbLines.map(l => l.account), ...(result?.unmapped || []).map(u => u.account)],
    sectionOf: x => sectionLookup.get(x),
  }), [pasteText, tbLines, result, sectionLookup]);
  const pasteRows = useMemo(() => pasted.items.map(it => {
    const tbl = tbLines.find(l => l.account === it.account);
    const um = result?.unmapped.find(u => u.account === it.account);
    const from = tbl?.entries.length ? tbl.entries : entriesFor(it.account);
    const target = it.sectionId ?? pasteSection;
    const status = !target ? 'no section' : from.some(f => isRange(f.entry) && f.sectionId !== target) ? 'range'
      : from.length && from.every(f => f.sectionId === target) ? 'already there' : from.length ? 'move' : 'add';
    return { account: it.account, desc: tbl?.desc ?? um?.desc ?? null, type: (tbl?.type ?? um?.type ?? '') as string,
      ytd: tbl?.ytd ?? um?.ytd ?? 0, inTb: !!(tbl || um), from, target, fromPaste: it.sectionId !== undefined, status };
  }), [pasted, tbLines, result, pasteSection, tpl]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPaste = () => { setPasteText(''); setPasteSection(undefined); setPasteOpen(true); };
  const continuePaste = () => {
    const rows = pasteRows.filter(r => r.status !== 'already there');
    if (!rows.length) { message.info(pasteRows.length ? 'All pasted accounts are already in those sections' : 'Paste some account codes first'); return; }
    setAddMode(rows.some(r => r.from.length) ? 'move' : 'add');
    setAddLines(rows.map(r => ({ account: r.account, desc: r.desc, type: r.type, ytd: r.ytd, from: r.from, sectionId: r.target,
      suggested: r.from.length ? undefined : suggestSection(r.account, r.type) })));
    setPasteOpen(false);
  };
  const [addMode, setAddMode] = useState<'add' | 'move'>('add');

  // ── new group / new section from the TB view ─────────────────────────────
  const [newSecForm] = Form.useForm();
  const [newGrpForm] = Form.useForm();
  const [newSecOpen, setNewSecOpen] = useState(false);
  const [newGrpOpen, setNewGrpOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const groupsSorted = useMemo(() => [...(tpl.groups || [])].sort((a, b) => a.display_order - b.display_order), [tpl]);
  // statement order: groups and totals by display order (where a new group can be placed)
  const statementItems = useMemo(() => [
    ...groupsSorted.map(g => ({ key: `G:${g.group_code}`, order: g.display_order, label: `${g.group_label || g.group_name} (${g.group_code})`, code: g.group_code })),
    ...(tpl.totals || []).map(t => ({ key: `T:${t.total_code}`, order: t.display_order, label: `${t.total_label || t.total_name} = ${t.calculation_formula} (${t.total_code})`, code: t.total_code })),
  ].sort((a, b) => a.order - b.order), [groupsSorted, tpl]);
  const nextGroupCode = () => {
    const used = new Set(groupsSorted.map(g => g.group_code.toUpperCase()));
    let n = groupsSorted.length + 1;
    while (used.has(`G${n}`)) n++;
    return `G${n}`;
  };
  const nextSectionCode = (groupCode: string) => {
    const used = new Set(groupsSorted.flatMap(g => (g.sections || []).map(x => x.section_code.toUpperCase())));
    let n = (groupsSorted.find(g => g.group_code === groupCode)?.sections?.length || 0) + 1;
    while (used.has(`${groupCode}S${n}`.toUpperCase())) n++;
    return `${groupCode}S${n}`;
  };
  // order right after the chosen item, before the next one (decimals keep existing orders untouched)
  const orderAfter = (afterKey?: string) => {
    if (!statementItems.length) return 10;
    const i = afterKey ? statementItems.findIndex(x => x.key === afterKey) : statementItems.length - 1;
    const cur = statementItems[i]?.order ?? 0;
    const next = statementItems[i + 1]?.order;
    if (next === undefined) return cur + 10;
    return next - cur > 1 ? cur + 1 : Math.round(((cur + next) / 2) * 100) / 100;
  };
  // which totals should pick up a new group placed after `afterKey`: the first total below it
  // whose formula combines several items — later totals inherit through it (no double counting)
  const suggestTotals = (afterKey?: string) => {
    const i = afterKey ? statementItems.findIndex(x => x.key === afterKey) : statementItems.length - 1;
    const below = (tpl.totals || []).filter(t => t.display_order > (statementItems[i]?.order ?? -Infinity))
      .sort((a, b) => a.display_order - b.display_order);
    const first = below.find(t => /[+\-*/]/.test(t.calculation_formula));
    return first ? [first.total_id] : [];
  };
  const totalRefs = (code: string, seen = new Set<string>()): Set<string> => {   // codes a total depends on, transitively
    const t = (tpl.totals || []).find(x => x.total_code.toUpperCase() === code.toUpperCase());
    if (!t || seen.has(code)) return seen;
    for (const tok of t.calculation_formula.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g) || []) {
      if (!seen.has(tok)) { seen.add(tok); totalRefs(tok, seen); }
    }
    return seen;
  };
  const applyNewSection = (sectionId: number, assignAll: boolean) => {
    if (pasteOpen) setPasteSection(sectionId);
    if (assignAll) setAddLines(ls => ls && ls.map(l => ({ ...l, sectionId })));
  };
  const openNewSection = (groupCode?: string) => {
    const g = groupCode || groupsSorted[0]?.group_code;
    newSecForm.setFieldsValue({ group_code: g, section_name: '', assign_all: (addLines?.length || 0) > 0 });
    setNewSecOpen(true);
  };
  const createSection = async () => {
    const v = await newSecForm.validateFields();
    const g = groupsSorted.find(x => x.group_code === v.group_code);
    if (!g) return;
    setCreating(true);
    const order = Math.max(0, ...(g.sections || []).map(x => x.display_order)) + 1;
    const r = await addSection(g.group_id, nextSectionCode(g.group_code), v.section_name, v.section_name, order);
    setCreating(false);
    if (!r.success || !r.data?.section_id) { message.error(r.error || 'Section could not be created'); return; }
    message.success(`Section "${v.section_name}" created in ${g.group_label || g.group_name}`);
    setNewSecOpen(false);
    await onTemplateChanged?.();
    applyNewSection(r.data.section_id, v.assign_all);
  };
  const openNewGroup = () => {
    // default position: after the last group (before the closing totals)
    const lastGroup = groupsSorted[groupsSorted.length - 1];
    const after = lastGroup ? `G:${lastGroup.group_code}` : statementItems[statementItems.length - 1]?.key;
    newGrpForm.setFieldsValue({ group_name: '', group_type: kind === 'BS' ? 'ASSET' : kind === 'CF' ? 'OPERATING' : 'EXPENSE', after, first_section: '', totals: suggestTotals(after),
      assign_all: (addLines?.length || 0) > 0 });
    setNewGrpOpen(true);
  };
  const createGroup = async () => {
    const v = await newGrpForm.validateFields();
    const code = nextGroupCode();
    const sign = kind === 'PL' ? (['REVENUE', 'OTHER_INCOME', 'COMPREHENSIVE'].includes(v.group_type) ? 1 : -1)
      : kind === 'BS' ? (v.group_type === 'ASSET' ? 1 : -1) : 1;
    setCreating(true);
    const g = await addGroup(tpl.template_id, code, v.group_name, v.group_name, v.group_type, orderAfter(v.after), sign);
    if (!g.success || !g.data?.group_id) { setCreating(false); message.error(g.error || 'Group could not be created'); return; }
    const sec = await addSection(g.data.group_id, `${code}S1`, v.first_section || v.group_name, v.first_section || v.group_name, 1);
    const totalErrors: string[] = [];
    for (const id of (v.totals || []) as number[]) {
      const t = (tpl.totals || []).find(x => x.total_id === id);
      if (!t) continue;
      const r = await updateTotal(id, { calculation_formula: `${t.calculation_formula}+${code}` });
      if (!r.success) totalErrors.push(`${t.total_code}: ${r.error}`);
    }
    setCreating(false);
    setNewGrpOpen(false);
    message.success(`Group "${v.group_name}" (${code}) created${sec.success ? ' with its first section' : ''}`);
    if (!sec.success) message.error(`First section not created: ${sec.error}`);
    if (totalErrors.length) {
      Modal.warning({ title: 'Group created, but not added to these totals', zIndex: 1300,
        content: <div style={{ fontSize: 12 }}>{totalErrors.map(e => <div key={e}>{e}</div>)}<div style={{ marginTop: 6 }}>Add +{code} to their formulas on the template.</div></div> });
    }
    await onTemplateChanged?.();
    if (sec.success && sec.data?.section_id) applyNewSection(sec.data.section_id, v.assign_all);
  };
  const rangeText = (e: PLSectionAccount) => `${e.account_from} – ${e.account_to}`;
  const saveAdd = async () => {
    if (!addLines) return;
    const todo = addLines.filter(l => l.sectionId);
    setAdding(true);
    const failed: string[] = [];
    let skipped = 0;
    let ok = 0;
    const ready: AddLine[] = [];
    for (const l of todo) {
      const from = l.from || [];
      const ranges = from.filter(f => isRange(f.entry));
      if (ranges.length) {   // one account cannot be taken out of a range — the range would go with it
        failed.push(`${l.account}: picked up by range ${ranges.map(f => `${rangeText(f.entry)} in ${f.sectionName}`).join(', ')} — edit the range on the template`);
        continue;
      }
      if (from.length && from.every(f => f.sectionId === l.sectionId)) { skipped++; continue; }   // already only there
      ready.push(l);
    }
    // one call per target section: add + remove happen in one transaction on the server
    const bySection = new Map<number, AddLine[]>();
    ready.forEach(l => bySection.set(l.sectionId!, [...(bySection.get(l.sectionId!) || []), l]));
    for (const [sectionId, ls] of bySection) {
      const r = await moveAccounts(sectionId, ls.map(l => l.account));
      if (r.success) {
        const ranged = r.data?.ranged || [];
        ranged.forEach(x => failed.push(`${x.account}: also picked up by range ${x.from} – ${x.to} in ${x.section} — edit the range on the template`));
        ok += ls.length - new Set(ranged.map(x => x.account)).size;
        continue;
      }
      if (!r.notDeployed) { ls.forEach(l => failed.push(`${l.account}: ${r.error || 'failed'}`)); continue; }
      // move service not installed yet: add, then remove (two calls per account)
      for (const l of ls) {
        const from = l.from || [];
        const toRemove = from.filter(f => f.sectionId !== l.sectionId);
        if (!from.some(f => f.sectionId === l.sectionId)) {                          // add first: nothing lost if it fails
          const a = await assignAccount(l.sectionId!, l.account);
          if (!a.success) { failed.push(`${l.account}: ${a.error || 'failed'}`); continue; }
        }
        let bad = false;
        for (const f of toRemove) {
          const x = await removeSectionAccount(f.sectionId, f.entry);
          if (!x.success) { bad = true; failed.push(`${l.account}: added to the new section but not removed from ${f.sectionName} — ${x.error || 'failed'}. Run database/gl/rr_pl_account_move.sql`); }
        }
        if (!bad) ok++;
      }
    }
    setAdding(false);
    if (ok) message.success(`${ok} account(s) ${addMode === 'move' ? 'moved in' : 'added to'} "${tpl.template_name}"`);
    if (skipped && !ok && !failed.length) message.info('No change — the accounts are already in those sections');
    if (failed.length) {
      Modal.error({ title: `${failed.length} account(s) could not be ${addMode === 'move' ? 'moved' : 'added'}`, content: <div style={{ fontSize: 12 }}>{failed.map(f => <div key={f}>{f}</div>)}</div>, zIndex: 1300 });
    }
    setAddLines(null); setMissingSel([]); setTbSel([]);
    if (ok && failed.length === 0) setMissingOpen(false);
    if (ok || failed.length) await onTemplateChanged?.();   // structure reloads → statement recalculates, TB kept
  };

  // drill popup (group / section → accounts)
  const [drillRow, setDrillRow] = useState<PLRow | null>(null);
  const [drillSearch, setDrillSearch] = useState('');
  const openDrill = (r: PLRow) => { if (r.drill) { setDrillSearch(''); setDrillRow(r); } };
  const drillLines = useMemo(() => {
    if (!drillRow?.drill) return [];
    const q = drillSearch.trim().toLowerCase();
    return q ? drillRow.drill.filter(l => `${l.account} ${l.desc || ''} ${l.section}`.toLowerCase().includes(q)) : drillRow.drill;
  }, [drillRow, drillSearch]);

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
        if (r.kind === 'check') return <Space><Text type="secondary">{r.label}</Text>{r.ok ? <Tag color="success">Balanced</Tag> : <Tag color="error" icon={<WarningOutlined />}>Out of balance</Tag>}</Space>;
        if (r.kind === 'info') return <Text>{r.label}</Text>;
        const drillIcon = r.drill ? <ZoomInOutlined className="pl-drill-icon" style={{ marginLeft: 6, color: '#1677ff', fontSize: 12 }} /> : null;
        if (r.kind === 'group') return <a onClick={() => openDrill(r)} style={{ color: 'inherit' }}><Text strong>{r.label} <Text type="secondary" style={{ fontSize: 11 }}>({r.code})</Text></Text>{drillIcon}</a>;
        if (r.kind === 'section') return <a onClick={() => openDrill(r)} style={{ color: 'inherit' }}><Text>{r.label}</Text>{drillIcon}</a>;
        return <Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Text>;
      },
    },
    {
      title: ran ? cfg.col1(ran.period) : 'Period', dataIndex: 'ptd', key: 'ptd', align: 'right', width: 170,
      onCell: r => ({ onClick: () => openDrill(r), style: r.drill ? { cursor: 'pointer' } : undefined }),
      render: (v: number | undefined, r) => <Text strong={r.kind === 'total' || r.kind === 'group'}
        style={{ fontVariantNumeric: 'tabular-nums', color: (v ?? 0) < 0 ? RED : undefined }}>{fmt(v)}</Text>,
    },
    {
      title: cfg.col2, dataIndex: 'ytd', key: 'ytd', align: 'right', width: 170,
      onCell: r => ({ onClick: () => openDrill(r), style: r.drill ? { cursor: 'pointer' } : undefined }),
      render: (v: number | undefined, r) => <Text strong={r.kind === 'total' || r.kind === 'group'}
        style={{ fontVariantNumeric: 'tabular-nums', color: (v ?? 0) < 0 ? RED : undefined }}>{fmt(v)}</Text>,
    },
    ...(cfg.pctTitle ? [{
      title: <Tooltip title={kind === 'BS' ? 'Period-end amount as % of total assets' : 'Year-to-date amount as % of year-to-date revenue (REVENUE groups)'}>{cfg.pctTitle}</Tooltip>,
      key: 'pct', align: 'right' as const, width: 110,
      render: (_: unknown, r: PLRow) => <Text type="secondary" style={{ fontSize: 12 }}>{pctOf(r)}</Text>,
    }] : []),
  ];

  const exportExcel = () => {
    if (!result || !ran) return;
    const out: (string | number)[][] = [
      [tpl.template_name], [`Ledger: ${ran.ledger}`, `Period: ${ran.period}`, ran.company ? `Company: ${ran.company}` : ''], [],
      ['Line', 'Code', cfg.col1(ran.period), cfg.col2, ...(cfg.pctTitle ? [cfg.pctTitle] : [])],
    ];
    const walk = (rows: PLRow[], depth: number) => {
      for (const r of rows) {
        out.push([`${'   '.repeat(depth)}${r.label}${r.error ? ` — ${r.error}` : ''}`, r.code || '',
          r.ptd === undefined ? '' : r2(r.ptd), r.ytd === undefined ? '' : r2(r.ytd), ...(cfg.pctTitle ? [pctOf(r)] : [])]);
        if (r.children) walk(r.children, depth + 1);
      }
    };
    walk(result.rows, 0);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), cfg.short.replace('&', 'and'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.tbAll.map(l => ({
      Type: cfg.tbTypes.find(([t]) => t === l.type)?.[1] || l.type, Account: l.account, Description: l.desc,
      [cfg.col1(ran.period)]: r2(l.ptd), [cfg.col2]: r2(l.ytd),
      'In template': l.sections.length ? l.sections.join(', ') : 'MISSING',
    }))), 'As per TB');
    if (result.unmapped.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.unmapped.map(u => ({
        Account: u.account, Description: u.desc, Type: u.type, [cfg.col1(ran.period)]: r2(u.ptd), [cfg.col2]: r2(u.ytd),
      }))), 'Missing from template');
    }
    XLSX.writeFile(wb, `${cfg.file}_${tpl.template_code}_${ran.period}${ran.company ? `_${ran.company}` : ''}.xlsx`);
  };

  // ── PDF: statement layout (A4 portrait) ───────────────────────────────────
  const buildPdf = (): { doc: jsPDF; name: string } | null => {
    if (!result || !ran) return null;
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
    const pdfPct = (r: PLRow) => pctOf(r);
    const entity = ran.company
      ? `${companyNames.get(ran.company) || `Company ${ran.company}`}${companyNames.get(ran.company) ? ` (${ran.company})` : ''}`
      : `${ran.ledger} - all companies`;

    // header
    doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 3, 'F');
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(entity, W / 2, 16, { align: 'center' });
    doc.setFontSize(12); doc.text(cfg.title, W / 2, 23, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.text(cfg.pdfSub(ran.period), W / 2, 29, { align: 'center' });
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
        if (!secs.length) { body.push({ kind: 'plain', cells: [r.label, pdfAmt(r.ptd), pdfAmt(r.ytd), pdfPct(r)] }); body.push({ kind: 'gap', cells: ['', '', '', ''] }); continue; }
        body.push({ kind: 'heading', cells: [r.label, '', '', ''] });
        for (const sct of secs) {
          body.push({ kind: 'line', cells: [`    ${sct.label}`, pdfAmt(sct.ptd), pdfAmt(sct.ytd), pdfPct(sct)] });
          if (withAccounts) for (const a of sct.children || []) {
            body.push({ kind: 'account', cells: [`         ${a.label}`, pdfAmt(a.ptd), pdfAmt(a.ytd), ''] });
          }
        }
        if (!ownTotal.has(String(r.code || '').toUpperCase())) {
          body.push({ kind: 'subtotal', cells: [`Total ${r.label.toLowerCase()}`, pdfAmt(r.ptd), pdfAmt(r.ytd), pdfPct(r)] });
          body.push({ kind: 'gap', cells: ['', '', '', ''] });
        }
      } else if (r.kind === 'total') {
        body.push({ kind: r.style === 'DOUBLE_LINE' ? 'double' : 'total', cells: [r.label, pdfAmt(r.ptd), pdfAmt(r.ytd), pdfPct(r)] });
        body.push({ kind: 'gap', cells: ['', '', '', ''] });
      } else if (r.kind === 'error') {
        body.push({ kind: 'error', cells: [`${r.label}: ${r.error}`, '', '', ''] });
      } else if (r.kind === 'info') {
        body.push({ kind: 'line', cells: [r.label, pdfAmt(r.ptd), pdfAmt(r.ytd), ''] });
      } else if (r.kind === 'check') {
        body.push({ kind: 'gap', cells: ['', '', '', ''] });
        body.push({ kind: r.ok ? 'account' : 'error', cells: [`${r.label}${r.ok ? ' — balanced' : ' — OUT OF BALANCE'}`, pdfAmt(r.ptd), pdfAmt(r.ytd), ''] });
      }
    }
    while (body.length && body[body.length - 1].kind === 'gap') body.pop();

    autoTable(doc, {
      startY: 43,
      margin: { left: M, right: M, top: 20, bottom: 18 },
      head: [['', cfg.col1(ran.period).replace(' ', '\n'), cfg.col2.replace(' ', '\n'), cfg.pctTitle ? cfg.pctTitle.replace(/ (?=\S+$)/, '\n') : '']],
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
    notes.push(cfg.signNote);
    if (result.unmapped.length) {
      notes.push(`${result.unmapped.length} ${cfg.acctWord} account(s) (${pdfAmt(kind === 'BS' ? result.unmappedPtd : result.unmappedYtd)}) are not mapped to this template and are excluded.`);
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
      doc.text(`${entity}  |  ${cfg.title}  |  ${ran.period}`, M, H - 7.5);
      doc.text(`Generated ${stamp} by ${brand.name}  |  Page ${i} of ${pages}`, W - M, H - 7.5, { align: 'right' });
    }
    return { doc, name: `${cfg.file}_${tpl.template_code}_${ran.period}${ran.company ? `_${ran.company}` : ''}.pdf` };
  };
  const exportPdf = () => { const b = buildPdf(); if (b) b.doc.save(b.name); };

  // ── PDF preview: the same document in a viewer, rebuilt when Sections / Accounts changes ──
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewOpen) return;
    const b = buildPdf();
    if (!b) return;
    const url = URL.createObjectURL(b.doc.output('blob'));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewOpen, view, result]); // eslint-disable-line react-hooks/exhaustive-deps
  const printPreview = () => {
    const f = document.getElementById('pl-pdf-preview') as HTMLIFrameElement | null;
    try { f?.contentWindow?.focus(); f?.contentWindow?.print(); } catch { if (previewUrl) window.open(previewUrl, '_blank'); }
  };

  const exportDrill = () => {
    if (!drillRow?.drill || !ran) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(drillLines.map(l => ({
      Account: l.account, Description: l.desc, Section: l.section, [cfg.col1(ran.period)]: r2(l.ptd), [cfg.col2]: r2(l.ytd),
    }))), 'Accounts');
    XLSX.writeFile(wb, `${cfg.file}_${tpl.template_code}_${drillRow.code || 'drill'}_${ran.period}.xlsx`);
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
                style={{ background: RED, borderColor: RED }}>Run {cfg.short}</Button>
              <Button icon={<DownloadOutlined />} disabled={!result} onClick={exportExcel}>Excel</Button>
              <Tooltip title="Statement layout, A4. Uses the Sections / Accounts view shown below.">
                <Button icon={<FilePdfOutlined />} disabled={!result} onClick={exportPdf}>PDF</Button>
              </Tooltip>
              <Tooltip title="Preview the PDF before downloading or printing">
                <Button icon={<EyeOutlined />} disabled={!result} onClick={() => setPreviewOpen(true)}>Preview</Button>
              </Tooltip>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {error && <Alert type="error" showIcon message={`Could not run the ${cfg.short}`} description={error} style={{ marginBottom: 12 }} />}
      {!result && !error && (
        <Card><Empty description={`Choose a ledger and period, then Run — the "${tpl.template_name}" structure is applied to the GL balances`} /></Card>
      )}

      {result && ran && (
        <>
          {kind === 'PL' ? (
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
          ) : (
          <Row gutter={12} style={{ marginBottom: 12 }}>
            {result.kpis.map(k => (
              <Col flex="1" key={k.title}>
                <Card size="small" style={k.ok === undefined ? undefined : { background: k.ok ? '#F0FAF4' : '#FFF6F4', borderColor: k.ok ? '#B7E1C6' : '#E8C4BD' }}>
                  <Statistic title={k.title} value={k.value} precision={2}
                    valueStyle={k.ok === undefined ? undefined : { color: k.ok ? '#1D7B4D' : RED }} />
                  {k.note && <Text type="secondary" style={{ fontSize: 11, color: k.ok === false ? RED : undefined }}>{k.note}</Text>}
                </Card>
              </Col>
            ))}
          </Row>
          )}

          <Tabs type="card" activeKey={plTab} onChange={k => setPlTab(k as 'template' | 'tb')} style={{ marginBottom: 0 }}
            items={[
              {
                key: 'template',
                label: (
                  <Space size={8}>
                    <CalculatorOutlined />{tpl.template_name}
                    {(result.unmapped.length > 0 || result.duplicates.length > 0) && (
                      <Tooltip title={`${result.unmapped.length} TB ${cfg.acctWord} account(s) are missing from this template${result.duplicates.length ? `, ${result.duplicates.length} are in more than one section` : ''} — click to see`}>
                        <Badge count={result.unmapped.length + result.duplicates.length} size="small" overflowCount={999} offset={[4, -2]}>
                          <WarningOutlined style={{ color: '#D48806', fontSize: 15, cursor: 'pointer' }}
                            onClick={e => { e.stopPropagation(); setMissingOpen(true); }} />
                        </Badge>
                      </Tooltip>
                    )}
                  </Space>
                ),
                children: null,
              },
              {
                key: 'tb',
                label: <Space size={8}><FileSearchOutlined />As per TB</Space>,
                children: null,
              },
            ]} />

          <style>{`
            .pl-total > td { background: #FFF6F4 !important; border-top: 1px solid #E8C4BD !important; }
            .pl-double > td { border-bottom: 3px double #C74634 !important; }
            .pl-group > td { background: #FAFAFA !important; }
            .pl-missing > td { background: #FFF7E6 !important; }
          `}</style>

          {plTab === 'tb' && (
            <Card size="small" style={{ borderRadius: '0 8px 8px 8px' }}
              title={(
                <Space direction="vertical" size={0}>
                  <Title level={5} style={{ margin: 0 }}><FileSearchOutlined style={{ color: RED }} /> {cfg.tbTitle}</Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {cfg.tbIntro} · {ran.ledger} · Period {ran.period}{ran.company ? ` · Company ${ran.company}` : ' · All companies'}
                  </Text>
                </Space>
              )}
              extra={(
                <Space>
                  <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="Account / description" style={{ width: 200 }}
                    value={tbSearch} onChange={e => setTbSearch(e.target.value)} />
                  <Button size="small" icon={<PlusOutlined />} disabled={!result.unmapped.length}
                    onClick={() => openAdd(tbRows.flatMap(g => g.children || []).filter(r => r.missing).map(r => r.label))}>
                    Add missing to template…
                  </Button>
                  <Button size="small" icon={<SnippetsOutlined />} onClick={openPaste} disabled={!sectionOptions.length && !groupsSorted.length}>Paste accounts…</Button>
                  <Button size="small" icon={<AppstoreAddOutlined />} onClick={() => openNewSection()} disabled={!groupsSorted.length}>New section</Button>
                  <Button size="small" icon={<FolderAddOutlined />} onClick={openNewGroup}>New group</Button>
                  <Segmented size="small" value={tbFilter} onChange={v => setTbFilter(v as 'all' | 'missing')}
                    options={[{ label: 'All accounts', value: 'all' }, { label: `Missing from template (${result.unmapped.length})`, value: 'missing' }]} />
                </Space>
              )}>
              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col flex="1"><Card size="small"><Statistic title={kind === 'PL' ? `${cfg.tbNetLabel} (YTD)` : cfg.tbNetLabel}
                  value={kind === 'BS' ? result.tbNetPtd : result.tbNetYtd} precision={2}
                  valueStyle={{ color: kind === 'PL' ? (result.tbNetYtd < 0 ? RED : '#1D7B4D') : (Math.abs(kind === 'BS' ? result.tbNetPtd : result.tbNetYtd) < 0.5 ? '#1D7B4D' : RED) }} /></Card></Col>
                {kind === 'PL'
                  ? <Col flex="1"><Card size="small"><Statistic title={`${result.bottom?.label || 'Result'} as per template (YTD)`} value={result.bottom?.ytd ?? 0} precision={2} /></Card></Col>
                  : <Col flex="1"><Card size="small"><Statistic title={kind === 'BS' ? `Profit / (loss) for the year (to ${ran.period})` : `Profit / (loss) (${ran.period})`}
                      value={kind === 'BS' ? result.profitYtd : result.profitPtd} precision={2} /></Card></Col>}
                <Col flex="1">
                  <Card size="small" hoverable onClick={() => setTbFilter('missing')} style={{ background: result.unmapped.length ? '#FFFBE6' : undefined }}>
                    <Statistic title={`Missing from template: ${result.unmapped.length} account(s) (${kind === 'BS' ? ran.period : 'YTD'})`}
                      value={kind === 'BS' ? result.unmappedPtd : result.unmappedYtd} precision={2}
                      valueStyle={{ color: result.unmapped.length ? '#D48806' : '#1D7B4D' }} />
                  </Card>
                </Col>
              </Row>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 8, borderRadius: 6,
                background: tbSel.length ? '#FFF6F4' : '#FAFAFA', border: `1px solid ${tbSel.length ? '#E8C4BD' : '#F0F0F0'}` }}>
                {tbSel.length ? (
                  <>
                    <Text strong>{tbSel.length} account(s) selected</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>YTD {fmt(r2(result.tbAll.filter(l => tbSel.includes(l.account)).reduce((t, l) => t + l.ytd, 0)))}</Text>
                    <Button size="small" type="primary" icon={<SwapOutlined />} style={{ background: RED, borderColor: RED }} onClick={() => openBulk(tbSel)}>
                      Move / add to section…
                    </Button>
                    <Button size="small" onClick={() => setTbSel([])}>Clear</Button>
                  </>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>Tick accounts (or a whole {kind === 'PL' ? 'Revenue / Expenses' : 'Assets / Liabilities / Equity'} block) to move or add several at once — to an existing section or a new one.</Text>
                )}
              </div>
              <Table<TbPlRow> size="small" rowKey="key" dataSource={tbRows} pagination={false}
                expandable={{ defaultExpandAllRows: true, indentSize: 18 }}
                rowSelection={{
                  selectedRowKeys: tbSel.map(a => `tb-${a}`),
                  onChange: keys => setTbSel(keys.map(String).filter(k => k.startsWith('tb-') && !['tb-net', ...(result?.tbGroups || []).map(g => `tb-${g.type}`)].includes(k)).map(k => k.slice(3))),
                  checkStrictly: false,
                  getCheckboxProps: r => ({ disabled: r.kind === 'total' || (r.kind === 'group' && !r.children?.length) }),
                }}
                rowClassName={r => (r.kind === 'total' ? 'pl-total pl-double' : r.kind === 'group' ? 'pl-group' : r.missing ? 'pl-missing' : '')}
                columns={[
                  { title: 'Line', key: 'label', render: (_: unknown, r) => (r.kind === 'account'
                    ? <Space size={6}><Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.label}</Text><Text style={{ fontSize: 12 }}>{r.desc}</Text></Space>
                    : <Text strong>{r.label}{r.kind === 'group' ? <Text type="secondary" style={{ fontSize: 11 }}> ({r.children?.length || 0})</Text> : null}</Text>) },
                  { title: 'In template', key: 'sections', width: 300, render: (_: unknown, r) => (r.kind !== 'account' ? null
                    : r.missing ? (
                      <Space size={4}>
                        <Tag color="warning" icon={<WarningOutlined />}>Missing</Tag>
                        <Button size="small" type="link" icon={<PlusOutlined />} style={{ padding: 0 }} onClick={() => openAdd([r.label])}>Add</Button>
                      </Space>
                    )
                      : (
                        <Space size={2} wrap>
                          {r.sections!.map((sn, i) => <Tag key={i} color={r.sections!.length > 1 ? 'orange' : 'default'} style={{ fontSize: 11 }}>{sn}</Tag>)}
                          <Tooltip title={r.sections!.length > 1 ? 'In more than one section — move it to one' : 'Change the section'}>
                            <Button size="small" type="link" icon={<SwapOutlined />} style={{ padding: 0 }} onClick={() => openMove([r.label])}>Move</Button>
                          </Tooltip>
                        </Space>
                      )) },
                  { title: cfg.col1(ran.period), dataIndex: 'ptd', align: 'right', width: 160,
                    render: (v: number, r) => <Text strong={r.kind !== 'account'} style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
                  { title: cfg.col2, dataIndex: 'ytd', align: 'right', width: 160,
                    render: (v: number, r) => <Text strong={r.kind !== 'account'} style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
                  ...(kind === 'PL' ? [{ title: '% of revenue', key: 'pct', align: 'right' as const, width: 100,
                    render: (_: unknown, r: TbPlRow) => <Text type="secondary" style={{ fontSize: 12 }}>{pct(r.ytd, tbRevYtd)}</Text> }] : []),
                ]} />
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                Highlighted accounts are in the trial balance but not in any section of “{tpl.template_name}” — add them on the template with <b>Add Account</b>.
              </Text>
            </Card>
          )}

          {plTab === 'template' && <Card size="small" style={{ borderRadius: '0 8px 8px 8px' }}
            title={(
              <Space direction="vertical" size={0}>
                <Title level={5} style={{ margin: 0 }}><CalculatorOutlined style={{ color: RED }} /> {tpl.template_name}</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {ran.ledger} · Period {ran.period}{ran.company ? ` · Company ${ran.company}${companyNames.get(ran.company) ? ` - ${companyNames.get(ran.company)}` : ''}` : ' · All companies'} · {cfg.subNote}
                </Text>
              </Space>
            )}
            extra={<Segmented size="small" value={view} onChange={v => setView(v as 'summary' | 'detail')}
              options={[{ label: 'Sections', value: 'summary' }, { label: 'Accounts', value: 'detail' }]} />}>
            <Table<PLRow> size="small" rowKey="key" columns={columns} dataSource={rowsForView} pagination={false}
              expandable={{ defaultExpandAllRows: true, indentSize: 18 }}
              rowClassName={r => (r.kind === 'total' ? `pl-total${r.style === 'DOUBLE_LINE' ? ' pl-double' : ''}` : r.kind === 'group' ? 'pl-group' : '')} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              <ZoomInOutlined /> Click a group or section (or its amount) to see the accounts behind it.
            </Text>
          </Card>}

          <Modal open={missingOpen} onCancel={() => setMissingOpen(false)} width={900} zIndex={1100}
            title={(
              <Space direction="vertical" size={0}>
                <span><WarningOutlined style={{ color: '#D48806' }} /> Accounts missing from “{tpl.template_name}”</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  In the trial balance ({cfg.tbTypes.map(([t]) => t).join(' / ')}, with a balance) but in no section of the template — not included in the statement
                </Text>
              </Space>
            )}
            footer={[
              <Button key="tb" onClick={() => { setMissingOpen(false); setTbFilter('missing'); setPlTab('tb'); }}>Show in As per TB</Button>,
              <Button key="add" icon={<PlusOutlined />} disabled={!result.unmapped.length}
                onClick={() => openAdd(missingSel.length ? missingSel : result.unmapped.map(u => u.account))}>
                {missingSel.length ? `Add ${missingSel.length} selected to template…` : 'Add all to template…'}
              </Button>,
              <Button key="c" type="primary" onClick={() => setMissingOpen(false)}>Close</Button>,
            ]}>
            <Table size="small" rowKey="account" dataSource={result.unmapped} pagination={false} scroll={{ y: 420 }}
              rowSelection={{ selectedRowKeys: missingSel, onChange: k => setMissingSel(k as string[]) }}
              columns={[
                { title: 'Account', dataIndex: 'account', width: 110 },
                { title: 'Description', dataIndex: 'desc', ellipsis: true },
                { title: 'Type', dataIndex: 'type', width: 90, render: (t: string) => <TypeTag t={t} /> },
                { title: cfg.col1(ran.period), dataIndex: 'ptd', align: 'right', width: 150,
                  render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
                { title: cfg.col2, dataIndex: 'ytd', align: 'right', width: 150,
                  render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
              ]}
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: '#FFFBE6' }}>
                    <Table.Summary.Cell index={0} colSpan={4}><Text strong>Total missing ({result.unmapped.length})</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><Text strong>{fmt(result.unmappedPtd)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right"><Text strong>{fmt(result.unmappedYtd)}</Text></Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )} />
            {result.duplicates.length > 0 && (
              <Alert type="warning" showIcon style={{ marginTop: 12 }}
                message={`${result.duplicates.length} account(s) are in more than one section (counted twice)`}
                description={<div style={{ fontSize: 12 }}>{result.duplicates.map(([a, secs]) => <div key={a}><Tag color="orange">{a}</Tag>in {secs.join(', ')}</div>)}</div>} />
            )}
          </Modal>

          <Modal open={previewOpen} onCancel={() => { setPreviewOpen(false); setPreviewUrl(null); }} width="min(1100px, 96vw)" zIndex={1100}
            style={{ top: 24 }} destroyOnHidden
            title={(
              <Space wrap>
                <span><EyeOutlined /> PDF preview — {tpl.template_name}</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  {ran?.ledger} · {ran?.period}{ran?.company ? ` · Company ${ran.company}` : ' · All companies'}
                </Text>
                <Segmented size="small" value={view} onChange={v => setView(v as 'summary' | 'detail')}
                  options={[{ label: 'Sections', value: 'summary' }, { label: 'Accounts', value: 'detail' }]} />
              </Space>
            )}
            footer={[
              <Button key="c" onClick={() => { setPreviewOpen(false); setPreviewUrl(null); }}>Close</Button>,
              <Button key="p" icon={<PrinterOutlined />} disabled={!previewUrl} onClick={printPreview}>Print</Button>,
              <Button key="d" type="primary" icon={<DownloadOutlined />} style={{ background: RED, borderColor: RED }} onClick={exportPdf}>Download PDF</Button>,
            ]}>
            {previewUrl
              ? <iframe id="pl-pdf-preview" title="P&L PDF preview" src={`${previewUrl}#view=FitH`} style={{ width: '100%', height: '78vh', border: '1px solid #f0f0f0', borderRadius: 6 }} />
              : <Empty description="Building preview…" />}
          </Modal>

          <Modal open={pasteOpen} onCancel={() => setPasteOpen(false)} width={1100} zIndex={1150} maskClosable={false}
            title={(
              <Space direction="vertical" size={0}>
                <span><SnippetsOutlined /> Paste accounts into “{tpl.template_name}”</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  Accounts not in the template are added; accounts already in another section are moved.
                </Text>
              </Space>
            )}
            footer={[
              <Button key="c" onClick={() => setPasteOpen(false)}>Cancel</Button>,
              <Button key="s" type="primary" style={{ background: RED, borderColor: RED }}
                disabled={!pasteRows.some(r => r.target && r.status !== 'already there')} onClick={continuePaste}>
                Review {pasteRows.filter(r => r.target && r.status !== 'already there').length} account(s) →
              </Button>,
            ]}>
            <Row gutter={16}>
              <Col span={9}>
                <Input.TextArea value={pasteText} onChange={e => setPasteText(e.target.value)} autoSize={{ minRows: 14, maxRows: 22 }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }} autoFocus
                  placeholder={'Paste from Excel or type, one per line or separated by commas:\n\n5229101\n5229102, 5229103\n5229100-5229199   (range: TB accounts in it)\n101-1000-000-5229104-000   (full code: account found)\n\nOptional 2nd column = section name:\n5229101<TAB>Staff Cost\n5229102<TAB>Operating Expense › Other expenses'} />
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
                  {pasted.items.length} account(s) read{pasted.unknown.length ? ` · ${pasted.unknown.length} not recognised` : ''}{pasted.emptyRanges.length ? ` · ${pasted.emptyRanges.length} range(s) with no TB account` : ''}
                </Text>
              </Col>
              <Col span={15}>
                <Space style={{ marginBottom: 8 }} wrap>
                  <Text>Put all in:</Text>
                  <Select style={{ width: 380 }} placeholder="Group › Section" showSearch optionFilterProp="label" allowClear
                    options={sectionOptions} {...sectionPick} value={pasteSection} onChange={(v: number | undefined) => setPasteSection(v)} />
                  <Button size="small" icon={<AppstoreAddOutlined />} onClick={() => openNewSection()} disabled={!groupsSorted.length}>New section…</Button>
                  <Button size="small" icon={<FolderAddOutlined />} onClick={openNewGroup}>New group…</Button>
                </Space>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>A section named in the pasted line wins over “Put all in”.</Text>
                {(pasted.unknown.length > 0 || pasted.emptyRanges.length > 0) && (
                  <Alert type="warning" showIcon style={{ marginBottom: 8, padding: '4px 10px', fontSize: 12 }}
                    message={<>
                      {pasted.unknown.length > 0 && <div>Not recognised: {pasted.unknown.slice(0, 8).join(', ')}{pasted.unknown.length > 8 ? ` … +${pasted.unknown.length - 8}` : ''}</div>}
                      {pasted.emptyRanges.length > 0 && <div>No TB account in: {pasted.emptyRanges.join(', ')}</div>}
                    </>} />
                )}
                <Table size="small" rowKey="account" pagination={false} scroll={{ y: 340 }} dataSource={pasteRows}
                  locale={{ emptyText: 'Paste account codes on the left' }}
                  columns={[
                    { title: 'Account', dataIndex: 'account', width: 95, render: (v: string, r) => <Space size={2}><Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>{!r.inTb && <Tooltip title="No balance in this trial balance — it is still added to the template"><Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>no TB</Tag></Tooltip>}</Space> },
                    { title: 'Description', dataIndex: 'desc', ellipsis: true },
                    { title: 'Now in', key: 'from', width: 190, ellipsis: true, render: (_: unknown, r) => (r.from.length
                      ? <Text style={{ fontSize: 12 }}>{r.from.map(f => f.sectionName.split(' › ').pop()).join(', ')}</Text>
                      : <Tag color="warning" style={{ fontSize: 11 }}>Missing</Tag>) },
                    { title: 'To', key: 'to', width: 190, ellipsis: true, render: (_: unknown, r) => (r.target
                      ? <Text style={{ fontSize: 12 }} strong={r.fromPaste}>{String(sectionLabel.get(r.target) || '').split(' › ').pop()}</Text>
                      : <Text type="secondary" style={{ fontSize: 12 }}>choose section</Text>) },
                    { title: '', key: 'st', width: 100, render: (_: unknown, r) => {
                      const c: Record<string, [string, string]> = { add: ['blue', 'Add'], move: ['purple', 'Move'], 'already there': ['default', 'Already there'], range: ['orange', 'In a range'], 'no section': ['default', '—'] };
                      const [col, txt] = c[r.status];
                      return <Tag color={col} style={{ fontSize: 11 }}>{txt}</Tag>;
                    } },
                  ]} />
              </Col>
            </Row>
          </Modal>

          <Modal open={!!addLines} onCancel={() => !adding && setAddLines(null)} width={1150} zIndex={1200} maskClosable={false}
            title={(
              <Space direction="vertical" size={0}>
                <span>{addMode === 'move' ? <><SwapOutlined /> Move accounts in “{tpl.template_name}”</> : <><PlusOutlined /> Add accounts to “{tpl.template_name}”</>}</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  {addMode === 'move'
                    ? 'Choose the new group › section. The account is added there and removed from its current section(s).'
                    : <>Choose the group › section for each account. <BulbOutlined /> Pre-filled with the section of the nearest account code already in the template.</>}
                </Text>
              </Space>
            )}
            footer={[
              <Button key="c" onClick={() => setAddLines(null)} disabled={adding}>Cancel</Button>,
              <Button key="s" type="primary" loading={adding} onClick={saveAdd}
                disabled={!addLines?.some(l => l.sectionId)} style={{ background: RED, borderColor: RED }}>
                {addMode === 'move' ? 'Move' : 'Add'} {addLines?.filter(l => l.sectionId).length || 0} account(s)
              </Button>,
            ]}>
            {addLines && (
              <>
                <Space style={{ marginBottom: 10 }} wrap>
                  <Text>Put all in:</Text>
                  <Select style={{ width: 520 }} placeholder="Group › Section" showSearch optionFilterProp="label" options={sectionOptions} {...sectionPick}
                    onChange={(v: number) => setAddLines(ls => ls && ls.map(l => ({ ...l, sectionId: v })))} />
                  {addMode === 'add' && (
                    <Button size="small" onClick={() => setAddLines(ls => ls && ls.map(l => ({ ...l, sectionId: l.suggested })))}>
                      <BulbOutlined /> Use suggestions
                    </Button>
                  )}
                  <Button size="small" icon={<AppstoreAddOutlined />} onClick={() => openNewSection()} disabled={!groupsSorted.length}>New section…</Button>
                  <Button size="small" icon={<FolderAddOutlined />} onClick={openNewGroup}>New group…</Button>
                </Space>
                {!sectionOptions.length && (
                  <Alert type="info" showIcon style={{ marginBottom: 10 }} message="This template has no sections yet — create a group (it gets a first section) to place the accounts." />
                )}
                <Table<AddLine> size="small" rowKey="account" dataSource={addLines} pagination={false} scroll={{ y: 420 }}
                  columns={[
                    { title: 'Account', dataIndex: 'account', width: 100 },
                    { title: 'Description', dataIndex: 'desc', ellipsis: { showTitle: true } },
                    { title: 'Type', dataIndex: 'type', width: 90, render: (t: string) => (t ? <TypeTag t={t} /> : <Text type="secondary">—</Text>) },
                    { title: cfg.col2, dataIndex: 'ytd', width: 140, align: 'right',
                      render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
                    ...(addMode === 'move' ? [{ title: 'Currently in', key: 'from', width: 260, render: (_: unknown, l: AddLine) => (
                      <Space direction="vertical" size={0}>
                        {!(l.from || []).length && <Tag color="warning" icon={<WarningOutlined />}>Missing — will be added</Tag>}
                        {(l.from || []).map((f, i) => (
                          <Text key={i} style={{ fontSize: 12 }} type={isRange(f.entry) ? 'warning' : undefined}>
                            {f.sectionName}{isRange(f.entry) ? ` (range ${rangeText(f.entry)} — can't move one account)` : ''}
                          </Text>
                        ))}
                      </Space>
                    ) }] : []),
                    { title: addMode === 'move' ? 'Move to group › section' : 'Add to group › section', key: 'sec', width: 440, render: (_: unknown, l: AddLine) => (
                      <Space size={4}>
                        <Select size="small" style={{ width: 400 }} placeholder={addMode === 'move' ? 'Choose the new section' : 'Skip (not added)'} allowClear showSearch optionFilterProp="label"
                          value={l.sectionId} options={sectionOptions} {...sectionPick}
                          onChange={(v: number | undefined) => setAddLines(ls => ls && ls.map(x => (x.account === l.account ? { ...x, sectionId: v } : x)))} />
                        {l.sectionId && l.sectionId === l.suggested && (
                          <Tooltip title={`Suggested: ${sectionLabel.get(l.suggested) || ''}`}><BulbOutlined style={{ color: '#D48806' }} /></Tooltip>
                        )}
                      </Space>
                    ) },
                  ]} />
              </>
            )}
          </Modal>

          <Modal open={newSecOpen} onCancel={() => !creating && setNewSecOpen(false)} zIndex={1250} width={520}
            title={<span><AppstoreAddOutlined /> New section in “{tpl.template_name}”</span>}
            okText="Create section" onOk={createSection} confirmLoading={creating} okButtonProps={{ style: { background: RED, borderColor: RED } }}>
            <Form form={newSecForm} layout="vertical">
              <Form.Item name="group_code" label="Group" rules={[{ required: true }]}>
                <Select options={groupsSorted.map(g => ({ value: g.group_code, label: `${g.group_label || g.group_name} (${g.group_code})` }))} />
              </Form.Item>
              <Form.Item name="section_name" label="Section name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }]}>
                <Input placeholder="e.g. Professional fees" autoFocus />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() => <Text type="secondary" style={{ fontSize: 12 }}>Code {nextSectionCode(newSecForm.getFieldValue('group_code') || '')} · placed last in the group</Text>}
              </Form.Item>
              {(addLines?.length || 0) > 0 && (
                <Form.Item name="assign_all" valuePropName="checked" style={{ marginTop: 10, marginBottom: 0 }}>
                  <Checkbox>Put the {addLines!.length} account(s) in the dialog into this section</Checkbox>
                </Form.Item>
              )}
            </Form>
          </Modal>

          <Modal open={newGrpOpen} onCancel={() => !creating && setNewGrpOpen(false)} zIndex={1250} width={640}
            title={<span><FolderAddOutlined /> New group in “{tpl.template_name}”</span>}
            okText="Create group" onOk={createGroup} confirmLoading={creating} okButtonProps={{ style: { background: RED, borderColor: RED } }}>
            <Form form={newGrpForm} layout="vertical"
              onValuesChange={(ch) => { if ('after' in ch) newGrpForm.setFieldsValue({ totals: suggestTotals(ch.after) }); }}>
              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item name="group_name" label="Group name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }]}>
                    <Input placeholder="e.g. Depreciation & Amortisation" autoFocus />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item name="group_type" label="Type" rules={[{ required: true }]}>
                    <Select options={GROUP_TYPES_BY_KIND[kind].filter(t => t.value !== 'CALCULATED')} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="after" label="Show it after">
                <Select options={statementItems.map(x => ({ value: x.key, label: x.label }))} popupMatchSelectWidth={false} />
              </Form.Item>
              <Form.Item name="first_section" label="First section name" tooltip="Accounts sit in sections — the group is created with this first section">
                <Input placeholder="Same as the group name when empty" />
              </Form.Item>
              <Form.Item name="totals" label="Add the group to these totals"
                extra={(
                  <Form.Item noStyle shouldUpdate>
                    {() => {
                      const sel = ((newGrpForm.getFieldValue('totals') || []) as number[])
                        .map(id => (tpl.totals || []).find(t => t.total_id === id)).filter(Boolean) as typeof tpl.totals;
                      const dup = sel.find(a => sel.some(b => b !== a && totalRefs(a.total_code).has(b.total_code.toUpperCase())));
                      const code = nextGroupCode();
                      return (
                        <Space direction="vertical" size={2} style={{ fontSize: 12 }}>
                          {sel.map(t => <span key={t.total_id}>{t.total_code}: {t.calculation_formula} → <b>{t.calculation_formula}+{code}</b></span>)}
                          {!sel.length && <span style={{ color: '#D48806' }}>Not in any total — its amounts will not reach the profit lines.</span>}
                          {dup && <span style={{ color: RED }}>{dup.total_code} already includes another selected total — the group would be counted twice.</span>}
                          <span>Suggested: the first total below it that adds several items; totals built on it pick the group up automatically.</span>
                        </Space>
                      );
                    }}
                  </Form.Item>
                )}>
                <Select mode="multiple" placeholder="None"
                  options={(tpl.totals || []).slice().sort((a, b) => a.display_order - b.display_order)
                    .map(t => ({ value: t.total_id, label: `${t.total_code} — ${t.total_label || t.total_name} = ${t.calculation_formula}` }))} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() => <Text type="secondary" style={{ fontSize: 12 }}>Code {nextGroupCode()} · first section {nextGroupCode()}S1 · display order {orderAfter(newGrpForm.getFieldValue('after'))}</Text>}
              </Form.Item>
              {(addLines?.length || 0) > 0 && (
                <Form.Item name="assign_all" valuePropName="checked" style={{ marginTop: 10, marginBottom: 0 }}>
                  <Checkbox>Put the {addLines!.length} account(s) in the dialog into its first section</Checkbox>
                </Form.Item>
              )}
            </Form>
          </Modal>

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
                { title: cfg.col1(ran.period), dataIndex: 'ptd', align: 'right' as const, width: 150, sorter: (a, b) => a.ptd - b.ptd,
                  render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', color: v < 0 ? RED : undefined }}>{fmt(v)}</Text> },
                { title: cfg.col2, dataIndex: 'ytd', align: 'right' as const, width: 150, sorter: (a, b) => a.ytd - b.ytd,
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
