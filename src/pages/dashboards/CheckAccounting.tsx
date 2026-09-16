/**
 * Check Accounting — cross-module accounting status dashboard.
 *
 * Pick a fiscal Year, then a Period (or all periods of the year). The
 * summary grid shows, period by period and transaction type by type,
 * how many documents exist and how many are accounted vs not — built
 * from the RR_V_*_ACCT_STATUS views through the same guarded SQL
 * gateway the AI assistant uses (POST ai/executequery). Clicking a
 * summary row drills to the documents; the transaction number links to
 * the full record and on to the module page.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Modal, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  ApiOutlined, AuditOutlined, CheckOutlined, CloseOutlined, CopyOutlined,
  FileExcelOutlined, LinkOutlined, ReloadOutlined, RobotOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { useNavigate } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';

const { Text, Title } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;
const GATEWAY_URL = `${BASE}/ai/executequery`;

const C = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE', purple: '#722ed1',
  orange: '#d46b08', teal: '#13c2c2', border: '#E5E5E5', text2: '#6B6B6B',
};

interface QueryResult { columns: string[]; rows: (string | number | null)[][] }

const isIdColumn = (name: string) => /(^|_)id$/i.test(name);
const esc = (s: string) => s.replace(/'/g, "''");
const inList = (periods: string[]) => periods.map(p => `'${esc(p)}'`).join(', ');
// period names are Mon-YY; documents map to a period by their date's month
const PERIOD_EXPR = (dateCol: string) => `TO_CHAR(${dateCol}, 'Mon-RR')`;

interface ModuleDef {
  key: string;
  label: string;
  view: string;
  idColumn: string;
  pageLabel: string;
  pagePath: (row: Record<string, string | number | null>) => string;
  /** UNION-able summary part: module, period, txn_type, total, accounted, not_accounted */
  summarySql: (periods: string[]) => string;
  /** document list for one (period, txn type): id, txn_number, party, currency, amount, gl_status */
  detailSql: (period: string, txnType: string) => string;
}

const docSummary = (label: string, view: string, dateCol: string, typeExpr: string, periods: string[]) =>
  `SELECT '${label}' AS module, ${PERIOD_EXPR(dateCol)} AS period, ${typeExpr} AS txn_type, ` +
  `COUNT(*) AS total, ` +
  `SUM(CASE WHEN gl_status <> 'NOT ACCOUNTED' THEN 1 ELSE 0 END) AS accounted, ` +
  `SUM(CASE WHEN gl_status = 'NOT ACCOUNTED' THEN 1 ELSE 0 END) AS not_accounted ` +
  `FROM ${view} WHERE ${PERIOD_EXPR(dateCol)} IN (${inList(periods)}) ` +
  `GROUP BY ${PERIOD_EXPR(dateCol)}, ${typeExpr}`;

const docDetail = (view: string, dateCol: string, typeExpr: string,
  idCol: string, numCol: string, partyCol: string, ccyCol: string, amtCol: string,
  period: string, txnType: string) =>
  `SELECT ${idCol} AS id, ${numCol} AS txn_number, ${partyCol} AS party, ${ccyCol} AS currency, ${amtCol} AS amount, gl_status ` +
  `FROM ${view} WHERE ${PERIOD_EXPR(dateCol)} = '${esc(period)}' AND ${typeExpr} = '${esc(txnType)}' ` +
  `ORDER BY 2 FETCH FIRST 1000 ROWS ONLY`;

// FA depreciation is per (asset, period): an asset counts as accounted for a
// period when an FA_DEPRECIATION journal in that period carries its number
const faDeprnJoin = (period: string) =>
  `LEFT JOIN (SELECT DISTINCT l.reference1 AS acc FROM rr_gl_je_lines_all l ` +
  `JOIN rr_gl_je_headers h ON h.je_header_id = l.je_header_id ` +
  `WHERE l.reference5 = 'FA_DEPRECIATION' AND h.period_name = '${esc(period)}') d ` +
  `ON d.acc = TO_CHAR(a.asset_number)`;

const MODULES: ModuleDef[] = [
  {
    key: 'AP_INV', label: 'AP Invoices',
    view: 'rr_v_ap_invoice_acct_status', idColumn: 'INVOICE_ID',
    pageLabel: 'Manage AP Invoices', pagePath: () => '/ap/manage-invoices',
    summarySql: p => docSummary('AP Invoices', 'rr_v_ap_invoice_acct_status', 'accounting_date', `NVL(invoice_type, 'Standard')`, p),
    detailSql: (p, t) => docDetail('rr_v_ap_invoice_acct_status', 'accounting_date', `NVL(invoice_type, 'Standard')`,
      'invoice_id', 'invoice_number', 'supplier', 'invoice_currency', 'invoice_amount', p, t),
  },
  {
    key: 'AP_PAY', label: 'AP Payments',
    view: 'rr_v_ap_payment_acct_status', idColumn: 'CHECK_ID',
    pageLabel: 'AP Payments', pagePath: () => '/ap/payments',
    summarySql: p => docSummary('AP Payments', 'rr_v_ap_payment_acct_status', 'accounting_date',
      `CASE WHEN maturity_date IS NOT NULL THEN 'PDC Payment' ELSE 'Payment' END`, p),
    detailSql: (p, t) => docDetail('rr_v_ap_payment_acct_status', 'accounting_date',
      `CASE WHEN maturity_date IS NOT NULL THEN 'PDC Payment' ELSE 'Payment' END`,
      'check_id', 'payment_number', 'payee', 'payment_currency', 'payment_amount', p, t),
  },
  {
    key: 'EXT_TXN', label: 'External Transactions',
    view: 'rr_v_ext_txn_acct_status', idColumn: 'EXTERNAL_TRANSACTION_ID',
    pageLabel: 'Manage External Transactions', pagePath: () => '/cash/external-transactions',
    summarySql: p => docSummary('External Transactions', 'rr_v_ext_txn_acct_status', 'transaction_date', `NVL(transaction_type, 'External')`, p),
    detailSql: (p, t) => docDetail('rr_v_ext_txn_acct_status', 'transaction_date', `NVL(transaction_type, 'External')`,
      'external_transaction_id', 'external_transaction_id', 'bank_account_name', 'currency_code', 'amount', p, t),
  },
  {
    key: 'FA', label: 'Fixed Assets',
    view: 'rr_v_fa_asset_acct_status', idColumn: 'ASSET_ID',
    pageLabel: 'Manage Assets',
    pagePath: row => row.ASSET_NUMBER != null ? `/fa/assets?assetNumber=${row.ASSET_NUMBER}` : '/fa/assets',
    summarySql: periods => periods.map(p =>
      `SELECT 'Fixed Assets' AS module, '${esc(p)}' AS period, 'Depreciation' AS txn_type, ` +
      `COUNT(*) AS total, ` +
      `SUM(CASE WHEN d.acc IS NOT NULL THEN 1 ELSE 0 END) AS accounted, ` +
      `SUM(CASE WHEN d.acc IS NULL THEN 1 ELSE 0 END) AS not_accounted ` +
      `FROM rr_v_fa_asset_acct_status a ${faDeprnJoin(p)}`
    ).join(' UNION ALL '),
    detailSql: p =>
      `SELECT a.asset_id AS id, TO_CHAR(a.asset_number) AS txn_number, a.description AS party, ` +
      `NULL AS currency, NULL AS amount, ` +
      `CASE WHEN d.acc IS NOT NULL THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS gl_status ` +
      `FROM rr_v_fa_asset_acct_status a ${faDeprnJoin(p)} ` +
      `ORDER BY 2 FETCH FIRST 1000 ROWS ONLY`,
  },
  {
    key: 'AR_INV', label: 'AR Invoices',
    view: 'rr_v_ar_invoice_acct_status', idColumn: 'CUSTOMER_TRANSACTION_ID',
    pageLabel: 'AR Invoices', pagePath: () => '/ar/manage-invoices',
    summarySql: p => docSummary('AR Invoices', 'rr_v_ar_invoice_acct_status', 'accounting_date', `NVL(transaction_type, 'Invoice')`, p),
    detailSql: (p, t) => docDetail('rr_v_ar_invoice_acct_status', 'accounting_date', `NVL(transaction_type, 'Invoice')`,
      'customer_transaction_id', 'transaction_number', 'bill_to_customer_name', 'invoice_currency_code', 'entered_amount', p, t),
  },
  {
    key: 'AR_RCPT', label: 'AR Receipts',
    view: 'rr_v_ar_receipt_acct_status', idColumn: 'STANDARD_RECEIPT_ID',
    pageLabel: 'AR Receipts', pagePath: () => '/ar/manage-receipts',
    summarySql: p => docSummary('AR Receipts', 'rr_v_ar_receipt_acct_status', 'accounting_date', `NVL(receipt_type, 'Receipt')`, p),
    detailSql: (p, t) => docDetail('rr_v_ar_receipt_acct_status', 'accounting_date', `NVL(receipt_type, 'Receipt')`,
      'standard_receipt_id', 'receipt_number', 'customer_name', 'currency', 'amount', p, t),
  },
];

interface SummaryRow {
  key: string; moduleKey: string; module: string; year: number;
  period: string; txnType: string; total: number; accounted: number; notAccounted: number;
}
interface DetailRow {
  key: string; id: string; txnNumber: string; party: string;
  currency: string; amount: number | null; accounted: boolean;
}

const CheckAccounting: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userName = (user as { name?: string; email?: string })?.name
    ?? (user as { email?: string })?.email?.split('@')[0] ?? 'user';

  // fiscal calendar: year -> ordered period names
  const [calendar, setCalendar] = useState<Map<number, string[]>>(new Map());
  const [year, setYear] = useState<number | null>(null);
  const [period, setPeriod] = useState<string | null>(null);   // null = all periods of the year

  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [sumSearch, setSumSearch] = useState('');

  const [detailFor, setDetailFor] = useState<SummaryRow | null>(null);
  const [detailRows, setDetailRows] = useState<DetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detSearch, setDetSearch] = useState('');

  const [sqlLog, setSqlLog] = useState<{ label: string; sql: string; ms: number; rows: number }[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);

  // record modal (from the transaction-number link)
  const [drill, setDrill] = useState<{ module: ModuleDef; id: string } | null>(null);
  const [drillData, setDrillData] = useState<QueryResult | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Same execution path as the AI assistant's SQL mode
  const runQuery = useCallback(async (label: string, sql: string): Promise<QueryResult> => {
    const t0 = performance.now();
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sql, maxRows: 1000, appUser: userName || 'CHECK_ACCOUNTING' }),
    });
    const data = await res.json();
    const ms = Math.round(performance.now() - t0);
    if (!res.ok || data.success === false) {
      setSqlLog(prev => [{ label: `${label} — FAILED`, sql, ms, rows: 0 }, ...prev].slice(0, 20));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setSqlLog(prev => [{ label, sql, ms, rows: data.rowCount ?? 0 }, ...prev].slice(0, 20));
    return { columns: data.columns || [], rows: data.rows || [] };
  }, [userName]);

  // Load the fiscal calendar once; default to the current-date's year
  useEffect(() => {
    (async () => {
      try {
        const r = await runQuery('GL fiscal calendar',
          `SELECT period_name, MAX(TO_NUMBER(fiscal_year)) AS fy, MAX(TO_NUMBER(fiscal_period)) AS fp FROM rr_v_gl_fiscal_periods WHERE TO_CHAR(application) = 'GL' AND TO_CHAR(adj_flag) = 'N' GROUP BY period_name ORDER BY 2, 3`);
        const cal = new Map<number, string[]>();
        r.rows.forEach(row => {
          const fy = Number(row[1]);
          if (!cal.has(fy)) cal.set(fy, []);
          cal.get(fy)!.push(String(row[0]));
        });
        setCalendar(cal);
        // default: the fiscal year containing TODAY's period (Mon-YY built from
        // fixed month names — toLocaleDateString gives "Sept" in some locales
        // and never matched, which used to fall through to the last year, 2034)
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const now = new Date();
        const nowPeriod = `${MONTHS[now.getMonth()]}-${String(now.getFullYear() % 100).padStart(2, '0')}`;
        const yearsAsc = [...cal.keys()].sort((a, b) => a - b);
        const yr = yearsAsc.find(y => cal.get(y)!.includes(nowPeriod))
          // fallback: never a far-future year — the closest fiscal year at or
          // just after the current calendar year
          ?? yearsAsc.filter(y => y <= now.getFullYear() + 1).pop()
          ?? yearsAsc[0] ?? null;
        setYear(yr);
      } catch (e) {
        message.error(`Could not load the fiscal calendar: ${e instanceof Error ? e.message : e}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yearPeriods = useMemo(() => (year != null ? calendar.get(year) ?? [] : []), [calendar, year]);
  const selectedPeriods = useMemo(
    () => (period ? [period] : yearPeriods),
    [period, yearPeriods],
  );

  const loadSummary = useCallback(async () => {
    if (year == null || selectedPeriods.length === 0) return;
    setSummaryLoading(true);
    setSummaryError('');
    setDetailFor(null);
    setDetailRows([]);
    try {
      const sql = MODULES.map(m => m.summarySql(selectedPeriods)).join(' UNION ALL ');
      const r = await runQuery(`Summary ${year}${period ? ` · ${period}` : ' · all periods'}`, sql);
      const rows: SummaryRow[] = r.rows.map((row, i) => {
        const moduleLabel = String(row[0]);
        const def = MODULES.find(m => m.label === moduleLabel);
        return {
          key: `s${i}`, moduleKey: def?.key ?? '', module: moduleLabel, year,
          period: String(row[1]), txnType: String(row[2]),
          total: Number(row[3]) || 0, accounted: Number(row[4]) || 0, notAccounted: Number(row[5]) || 0,
        };
      });
      const order = new Map(MODULES.map((m, i) => [m.label, i]));
      const pOrder = new Map(yearPeriods.map((p, i) => [p, i]));
      rows.sort((a, b) =>
        (order.get(a.module)! - order.get(b.module)!)
        || ((pOrder.get(a.period) ?? 99) - (pOrder.get(b.period) ?? 99))
        || a.txnType.localeCompare(b.txnType));
      setSummary(rows);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e));
    } finally {
      setSummaryLoading(false);
    }
  }, [year, period, selectedPeriods, yearPeriods, runQuery]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const openDetail = async (row: SummaryRow) => {
    const def = MODULES.find(m => m.key === row.moduleKey);
    if (!def) return;
    setDetailFor(row);
    setDetailRows([]);
    setDetSearch('');
    setDetailLoading(true);
    try {
      const r = await runQuery(`${row.module} · ${row.period} · ${row.txnType} — documents`,
        def.detailSql(row.period, row.txnType));
      setDetailRows(r.rows.map((d, i) => ({
        key: `d${i}`,
        id: d[0] == null ? '' : String(d[0]),
        txnNumber: d[1] == null ? '—' : String(d[1]),
        party: d[2] == null ? '—' : String(d[2]),
        currency: d[3] == null ? '' : String(d[3]),
        amount: typeof d[4] === 'number' ? d[4] : null,
        accounted: String(d[5]) !== 'NOT ACCOUNTED',
      })));
    } catch (e) {
      message.error(`Detail failed: ${e instanceof Error ? e.message : e}`);
      setDetailFor(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDrill = useCallback(async (m: ModuleDef, idText: string) => {
    const idNum = idText.replace(/[^0-9]/g, '');
    if (!idNum) { message.warning(`Cannot drill — ${idText} is not a numeric id`); return; }
    setDrill({ module: m, id: idNum });
    setDrillData(null);
    setDrillLoading(true);
    try {
      setDrillData(await runQuery(`${m.label} — record ${idNum}`,
        `SELECT * FROM ${m.view} WHERE ${m.idColumn.toLowerCase()} = ${idNum}`));
    } catch (e) {
      message.error(`Drill failed: ${e instanceof Error ? e.message : e}`);
      setDrill(null);
    } finally {
      setDrillLoading(false);
    }
  }, [runQuery]);

  const drillRecord = useMemo(() => {
    if (!drillData?.rows.length) return null;
    const rec: Record<string, string | number | null> = {};
    drillData.columns.forEach((c, i) => { rec[c] = drillData.rows[0][i]; });
    return rec;
  }, [drillData]);

  // filters
  const visibleSummary = useMemo(() => {
    const f = sumSearch.trim().toLowerCase();
    if (!f) return summary;
    return summary.filter(r =>
      [r.module, r.period, r.txnType, String(r.total), String(r.notAccounted)].some(v => v.toLowerCase().includes(f)));
  }, [summary, sumSearch]);

  const visibleDetail = useMemo(() => {
    const f = detSearch.trim().toLowerCase();
    if (!f) return detailRows;
    return detailRows.filter(r =>
      [r.txnNumber, r.party, r.currency, String(r.amount ?? ''), r.accounted ? 'yes accounted' : 'x not accounted']
        .some(v => v.toLowerCase().includes(f)));
  }, [detailRows, detSearch]);

  const detailDef = detailFor ? MODULES.find(m => m.key === detailFor.moduleKey) ?? null : null;

  const exportExcel = (name: string, header: string[], rows: (string | number | null)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = header.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Check Accounting');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${name}.xlsx`);
  };

  const summaryColumns = [
    { title: 'Module', dataIndex: 'module', key: 'module', width: 170,
      render: (v: string) => <Text strong style={{ fontSize: 12.5 }}>{v}</Text> },
    { title: 'Year', dataIndex: 'year', key: 'year', width: 70,
      render: (v: number) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
    { title: 'Period', dataIndex: 'period', key: 'period', width: 90,
      render: (v: string) => <Tag color="geekblue" style={{ fontSize: 11 }}>{v}</Tag> },
    { title: 'Transaction Type', dataIndex: 'txnType', key: 'txnType', width: 170,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
    { title: 'Total Transactions', dataIndex: 'total', key: 'total', align: 'right' as const, width: 130,
      render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{v.toLocaleString()}</span> },
    { title: 'Accounted', dataIndex: 'accounted', key: 'accounted', align: 'right' as const, width: 110,
      render: (v: number) => <span style={{ color: C.success, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span> },
    { title: 'Not Accounted', dataIndex: 'notAccounted', key: 'notAccounted', align: 'right' as const, width: 120,
      render: (v: number) => v > 0
        ? <Tag color="red" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{v.toLocaleString()}</Tag>
        : <span style={{ color: C.text2 }}>0</span> },
  ];

  const detailColumns = detailFor && detailDef ? [
    { title: 'Module', key: 'm', width: 150, render: () => <Text strong style={{ fontSize: 12 }}>{detailFor.module}</Text> },
    { title: 'Year', key: 'y', width: 60, render: () => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{detailFor.year}</span> },
    { title: 'Period', key: 'p', width: 80, render: () => <Tag color="geekblue" style={{ fontSize: 11 }}>{detailFor.period}</Tag> },
    { title: 'Transaction Type', key: 't', width: 150, render: () => <span style={{ fontSize: 12 }}>{detailFor.txnType}</span> },
    { title: 'Transaction Number', dataIndex: 'txnNumber', key: 'txnNumber', width: 170,
      render: (v: string, r: DetailRow) => (
        <a onClick={() => openDrill(detailDef, r.id)} title="Open the full record"
          style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</a>
      ) },
    { title: 'Party / Description', dataIndex: 'party', key: 'party', ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
    { title: 'Amount', key: 'amt', align: 'right' as const, width: 140,
      render: (_: unknown, r: DetailRow) => r.amount == null ? <span style={{ color: C.text2 }}>—</span>
        : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.currency ? `${r.currency} ` : ''}{r.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> },
    { title: 'Accounted', key: 'acc', align: 'center' as const, width: 100,
      render: (_: unknown, r: DetailRow) => r.accounted
        ? <Tag color="green" style={{ margin: 0 }}><CheckOutlined /> Yes</Tag> : null },
    { title: 'Not Accounted', key: 'nacc', align: 'center' as const, width: 110,
      render: (_: unknown, r: DetailRow) => !r.accounted
        ? <Tag color="red" style={{ margin: 0, fontWeight: 700 }}><CloseOutlined /> X</Tag> : null },
  ] : [];

  const askAi = () => {
    window.dispatchEvent(new Event('reerp-ai:toggle'));
    message.info(`Ask the assistant e.g. "which AP invoices are not accounted in ${period || year || 'this period'}?"`, 4);
  };

  const years = useMemo(() => [...calendar.keys()].sort((a, b) => b - a), [calendar]);

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <Title level={3} style={{ margin: 0 }}>
          <AuditOutlined style={{ color: C.primary, marginRight: 8 }} />Check Accounting
        </Title>
        <span style={{ flex: 1 }} />
        <Text style={{ fontSize: 12 }}>Year:</Text>
        <Select
          style={{ width: 100 }}
          value={year ?? undefined}
          placeholder="Year"
          onChange={v => { setYear(v); setPeriod(null); }}
          options={years.map(y => ({ value: y, label: String(y) }))}
        />
        <Text style={{ fontSize: 12 }}>Period:</Text>
        <Select
          style={{ width: 140 }}
          value={period ?? 'ALL'}
          onChange={v => setPeriod(v === 'ALL' ? null : v)}
          options={[{ value: 'ALL', label: 'All periods' }, ...yearPeriods.map(p => ({ value: p, label: p }))]}
        />
        <Tooltip title="Reload the summary">
          <Button icon={<ReloadOutlined />} loading={summaryLoading} onClick={loadSummary}>Refresh</Button>
        </Tooltip>
        <Tooltip title="Show the API calls made by this page — the gateway endpoint and every SQL executed">
          <Button icon={<ApiOutlined />} onClick={() => setSqlOpen(s => !s)}
            style={sqlOpen ? { color: C.info, borderColor: C.info } : undefined}>
            API
          </Button>
        </Tooltip>
        <Button type="primary" icon={<RobotOutlined />} onClick={askAi}
          style={{ background: C.primary, borderColor: C.primary }}>
          Ask AI about Accounting
        </Button>
      </div>
      <Text style={{ fontSize: 12, color: C.text2, display: 'block', marginBottom: 14 }}>
        Pick a fiscal year, then a period (or all periods) — the grid shows per period and transaction type how many
        documents are accounted vs not, matched to GL journal lines via their reference columns through the guarded
        SQL gateway. Click a row to drill to the transactions.
      </Text>

      {summaryError && (
        <Alert
          type="error" showIcon style={{ marginBottom: 12 }}
          message={summaryError}
          description={summaryError.includes('ORA-00942')
            ? 'A status view is missing in the database — run database/ap/146_all_accounting_status_views.sql in APEX SQL Workshop → SQL Scripts, then Refresh.'
            : undefined}
        />
      )}

      {sqlOpen && (
        <Card size="small" style={{ marginBottom: 14, borderColor: C.border }}
          title={<Text strong style={{ fontSize: 12 }}><ApiOutlined /> API calls — SQL gateway</Text>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            background: '#fafafa', border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 8px' }}>
            <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>POST</Tag>
            <code style={{ flex: 1, fontSize: 11, color: '#595959', wordBreak: 'break-all' }}>{GATEWAY_URL}</code>
            <CopyOutlined style={{ cursor: 'pointer', color: '#8c8c8c', flexShrink: 0 }}
              onClick={() => { navigator.clipboard.writeText(GATEWAY_URL); message.success('URL copied'); }} />
          </div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
            Body: {'{ "sql": "...", "maxRows": 1000, "appUser": "…" }'} — every query below was sent to this endpoint (latest first).
          </Text>
          {sqlLog.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>No queries yet.</Text>}
          {sqlLog.map((q, i) => (
            <pre key={i} style={{
              margin: '4px 0', padding: 8, borderRadius: 6, fontSize: 11,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: q.label.includes('FAILED') ? '#FFF1F0' : '#F7F5F3',
              border: q.label.includes('FAILED') ? '1px solid #FFA39E' : '1px solid #EFEBE9',
            }}>
              {`-- ${q.label} · ${q.rows} rows · ${q.ms} ms\n${q.sql}`}
            </pre>
          ))}
        </Card>
      )}

      <Card
        size="small"
        style={{ borderColor: C.border, borderRadius: 10 }}
        title={
          <Space wrap>
            <Text strong>Accounting by period &amp; transaction type{year ? ` · ${year}` : ''}{period ? ` · ${period}` : ''}</Text>
            <Tag>{visibleSummary.length}{sumSearch ? ` of ${summary.length}` : ''} row(s)</Tag>
          </Space>
        }
        extra={
          <Space>
            <Input size="small" allowClear placeholder="Search…" value={sumSearch}
              onChange={e => setSumSearch(e.target.value)} style={{ width: 180 }} />
            <Button size="small" icon={<FileExcelOutlined />} disabled={!visibleSummary.length}
              style={{ color: C.success, borderColor: C.success }}
              onClick={() => exportExcel(
                `Check_Accounting_Summary_${year}${period ? `_${period}` : ''}`,
                ['Module', 'Year', 'Period', 'Transaction Type', 'Total Transactions', 'Accounted', 'Not Accounted'],
                visibleSummary.map(r => [r.module, r.year, r.period, r.txnType, r.total, r.accounted, r.notAccounted]),
              )}>
              Excel
            </Button>
          </Space>
        }
      >
        <Table
          size="small"
          loading={summaryLoading}
          dataSource={visibleSummary}
          columns={summaryColumns}
          rowKey="key"
          pagination={{ pageSize: 25, size: 'small', showTotal: t => `${t} rows` }}
          onRow={r => ({
            onClick: () => openDetail(r),
            style: { cursor: 'pointer', background: detailFor?.key === r.key ? '#FBF1EF' : undefined },
          })}
          scroll={{ x: 900 }}
        />
      </Card>

      {detailFor && (
        <Card
          size="small"
          style={{ marginTop: 16, borderColor: C.border, borderRadius: 10 }}
          title={
            <Space wrap>
              <Text strong>{detailFor.module} · {detailFor.period} · {detailFor.txnType} — transactions</Text>
              <Tag>{visibleDetail.length}{detSearch ? ` of ${detailRows.length}` : ''} row(s)</Tag>
            </Space>
          }
          extra={
            <Space>
              <Input size="small" allowClear placeholder="Search rows…" value={detSearch}
                onChange={e => setDetSearch(e.target.value)} style={{ width: 200 }} />
              <Button size="small" icon={<FileExcelOutlined />} disabled={!visibleDetail.length}
                style={{ color: C.success, borderColor: C.success }}
                onClick={() => exportExcel(
                  `Check_Accounting_${detailFor.module.replace(/\s+/g, '_')}_${detailFor.period}`,
                  ['Module', 'Year', 'Period', 'Transaction Type', 'Transaction Number', 'Party', 'Currency', 'Amount', 'Accounted', 'Not Accounted'],
                  visibleDetail.map(r => [detailFor.module, detailFor.year, detailFor.period, detailFor.txnType,
                    r.txnNumber, r.party, r.currency, r.amount, r.accounted ? 'Yes' : '', r.accounted ? '' : 'X']),
                )}>
                Excel
              </Button>
            </Space>
          }
        >
          {detailLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
          {!detailLoading && (
            <Table
              size="small"
              dataSource={visibleDetail}
              columns={detailColumns}
              rowKey="key"
              pagination={{ pageSize: 20, size: 'small', showTotal: t => `${t} rows` }}
              scroll={{ x: 1100 }}
            />
          )}
        </Card>
      )}

      {/* Record modal: full row from the status view + jump to the module page */}
      <Modal
        open={!!drill}
        onCancel={() => { setDrill(null); setDrillData(null); }}
        width={720}
        title={drill ? `${drill.module.label} · ${drill.id}` : ''}
        footer={drill ? [
          <Button key="open" type="primary" icon={<LinkOutlined />}
            style={{ background: C.primary, borderColor: C.primary }}
            onClick={() => { if (drillRecord) navigate(drill.module.pagePath(drillRecord)); }}
            disabled={!drillRecord}>
            Open in {drill.module.pageLabel}
          </Button>,
          <Button key="close" onClick={() => { setDrill(null); setDrillData(null); }}>Close</Button>,
        ] : null}
      >
        {drillLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
        {!drillLoading && drillData && !drillRecord && (
          <Alert type="warning" showIcon message="Record not found in the status view." />
        )}
        {!drillLoading && drillRecord && (
          <Descriptions size="small" column={2} bordered
            items={Object.entries(drillRecord).map(([k, v]) => ({
              key: k,
              label: <span style={{ fontSize: 11 }}>{k.replace(/_/g, ' ')}</span>,
              children: (
                <span style={{
                  fontSize: 12,
                  fontFamily: isIdColumn(k) ? 'monospace' : undefined,
                  color: String(v).includes('NOT ACCOUNTED') ? C.primary : undefined,
                  fontWeight: k === 'GL_STATUS' ? 700 : undefined,
                }}>
                  {v === null || v === undefined ? '—'
                    : typeof v === 'number' && !isIdColumn(k)
                      ? v.toLocaleString('en-US', { minimumFractionDigits: 2 })
                      : String(v)}
                </span>
              ),
            }))}
          />
        )}
      </Modal>
    </div>
  );
};

export default CheckAccounting;
