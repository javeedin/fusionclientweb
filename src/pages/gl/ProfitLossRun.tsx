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
} from 'antd';
import {
  PlayCircleOutlined, DownloadOutlined, WarningOutlined, CheckCircleOutlined, CalculatorOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import { APEX_DB_CONFIG } from '../../config/api.config';
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
interface PLRow {
  key: string; kind: RowKind; label: string; code?: string; ptd?: number; ytd?: number;
  indent: number; style?: string; error?: string; children?: PLRow[];
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
  const [ran, setRan] = useState<{ ledger: string; period: string; company?: string } | null>(null);
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const ledger = Form.useWatch('ledger', form);

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
      const pageSize = 5000;
      for (let offset = 0, guard = 0; guard < 100; guard++) {
        const p = new URLSearchParams({ ledger_name: v.ledger, period_name: v.period, limit: String(pageSize), offset: String(offset) });
        if (v.company?.trim()) p.set('company', v.company.trim());
        const res = await fetch(`${BASE}/gl/rr-trialbalance/standard?${p}`, { headers: { Accept: 'application/json' } });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d?.message || `Trial balance HTTP ${res.status}`);
        const items: any[] = d.items || [];
        for (const i of items) {
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
      setRan({ ledger: v.ledger, period: v.period, company: v.company?.trim() || undefined });
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
      for (const s of [...(g.sections || [])].sort((a, b) => a.display_order - b.display_order)) {
        const sAmt: Amt = { ptd: 0, ytd: 0 };
        const acctRows: PLRow[] = [];
        for (const [acct, line] of byAcct) {
          if (!(s.accounts || []).some(a => matches(acct, a))) continue;
          sAmt.ptd += line.ptd; sAmt.ytd += line.ytd;
          used.set(acct, [...(used.get(acct) || []), `${g.group_code}/${s.section_code}`]);
          if (Math.abs(line.ptd) >= 0.005 || Math.abs(line.ytd) >= 0.005) {
            acctRows.push({ key: `a-${s.section_id}-${acct}`, kind: 'account', label: `${acct}${line.desc ? ` · ${line.desc}` : ''}`,
              code: acct, ptd: line.ptd, ytd: line.ytd, indent: 3 });
          }
        }
        acctRows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
        gAmt.ptd += sAmt.ptd; gAmt.ytd += sAmt.ytd;
        secRows.push({ key: `s-${s.section_id}`, kind: 'section', label: s.section_label || s.section_name, code: s.section_code,
          ptd: sAmt.ptd, ytd: sAmt.ytd, indent: 2, children: acctRows.length ? acctRows : undefined });
      }
      groupVal.set(g.group_code.toUpperCase(), gAmt);
      if (g.group_type === 'REVENUE') { revenueYtd += gAmt.ytd; revenuePtd += gAmt.ptd; }
      groupRows.set(g.group_code, {
        key: `g-${g.group_id}`, kind: 'group', label: g.group_label || g.group_name, code: g.group_code,
        ptd: gAmt.ptd, ytd: gAmt.ytd, indent: 1, children: secRows.length ? secRows : undefined,
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
        if (r.kind === 'group') return <Text strong>{r.label} <Text type="secondary" style={{ fontSize: 11 }}>({r.code})</Text></Text>;
        if (r.kind === 'section') return <Text>{r.label}</Text>;
        return <Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Text>;
      },
    },
    {
      title: ran ? `Period ${ran.period}` : 'Period', dataIndex: 'ptd', key: 'ptd', align: 'right', width: 170,
      render: (v: number | undefined, r) => <Text strong={r.kind === 'total' || r.kind === 'group'}
        style={{ fontVariantNumeric: 'tabular-nums', color: (v ?? 0) < 0 ? RED : undefined }}>{fmt(v)}</Text>,
    },
    {
      title: 'Year to date', dataIndex: 'ytd', key: 'ytd', align: 'right', width: 170,
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

  const bottomDiff = result && result.bottom?.ytd !== undefined ? r2(result.bottom.ytd - result.tbNetYtd) : null;

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
          <Form.Item name="company" label="Company" tooltip="Optional: segment 1, e.g. 01 — empty = all companies">
            <Input style={{ width: 90 }} placeholder="All" allowClear />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={running}
                style={{ background: RED, borderColor: RED }}>Run P&amp;L</Button>
              <Button icon={<DownloadOutlined />} disabled={!result} onClick={exportExcel}>Excel</Button>
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
            <Col flex="1"><Card size="small"><Statistic title={`Revenue YTD`} value={result.revenueYtd} precision={2} /></Card></Col>
            <Col flex="1">
              <Card size="small">
                <Statistic title={result.bottom ? `${result.bottom.label} (YTD)` : 'Result (YTD)'} value={result.bottom?.ytd ?? 0} precision={2}
                  valueStyle={{ color: (result.bottom?.ytd ?? 0) < 0 ? RED : '#1D7B4D' }} />
              </Card>
            </Col>
            <Col flex="1">
              <Tooltip title="Net of ALL income & expense accounts (account type R/E) in the trial balance — the statement's result should equal it when every P&L account is mapped once">
                <Card size="small"><Statistic title="Trial balance net income (YTD)" value={result.tbNetYtd} precision={2} /></Card>
              </Tooltip>
            </Col>
            <Col flex="1">
              <Card size="small">
                <Statistic title="Difference" value={bottomDiff ?? 0} precision={2}
                  valueStyle={{ color: bottomDiff !== null && Math.abs(bottomDiff) < 0.005 ? '#1D7B4D' : RED }}
                  prefix={bottomDiff !== null && Math.abs(bottomDiff) < 0.005 ? <CheckCircleOutlined /> : <WarningOutlined />} />
              </Card>
            </Col>
          </Row>

          {(result.unmapped.length > 0 || result.duplicates.length > 0) && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message={`${result.unmapped.length ? `${result.unmapped.length} income/expense account(s) with balances are not in any section (YTD ${fmt(result.unmappedYtd)})` : ''}`
                + `${result.unmapped.length && result.duplicates.length ? ' · ' : ''}`
                + `${result.duplicates.length ? `${result.duplicates.length} account(s) are in more than one section (counted twice)` : ''}`}
              description={(
                <div style={{ maxHeight: 160, overflow: 'auto', fontSize: 12 }}>
                  {result.unmapped.slice(0, 50).map(u => (
                    <div key={u.account}><Tag>{u.account}</Tag>{u.desc} — YTD {fmt(u.ytd)} · Period {fmt(u.ptd)}</div>
                  ))}
                  {result.duplicates.map(([a, secs]) => (
                    <div key={`d-${a}`}><Tag color="orange">{a}</Tag>in {secs.join(', ')}</div>
                  ))}
                  {result.unmapped.length > 0 && <div style={{ marginTop: 4 }}>Add them to a section with <b>Add Account</b> on the template.</div>}
                </div>
              )} />
          )}

          <Card size="small" style={{ borderRadius: 8 }}
            title={(
              <Space direction="vertical" size={0}>
                <Title level={5} style={{ margin: 0 }}><CalculatorOutlined style={{ color: RED }} /> {tpl.template_name}</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {ran.ledger} · Period {ran.period}{ran.company ? ` · Company ${ran.company}` : ' · All companies'} · Credit − Debit (expenses in brackets)
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
          </Card>
        </>
      )}
    </div>
  );
}
