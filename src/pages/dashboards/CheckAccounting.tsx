/**
 * Check Accounting — cross-module accounting status dashboard.
 *
 * Reads the RR_V_*_ACCT_STATUS views through the same guarded SQL gateway
 * the AI assistant uses (POST ai/executequery), filtered by GL period.
 * Cards show ACCOUNTED vs NOT ACCOUNTED per module; clicking a card lists
 * the documents that are still missing accounting. The Ask AI button opens
 * the assistant to enquire about accounting in natural language.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Input, Modal, Row, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  ApiOutlined, AuditOutlined, CopyOutlined, FileExcelOutlined, LinkOutlined, ReloadOutlined, RobotOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { useNavigate } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';

const { Text, Title } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;

const C = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE', purple: '#722ed1',
  orange: '#d46b08', teal: '#13c2c2', border: '#E5E5E5', text2: '#6B6B6B',
};

interface QueryResult { columns: string[]; rows: (string | number | null)[][] }

const GATEWAY_URL = `${BASE}/ai/executequery`;

// GL period month filter — period names are Mon-YY (e.g. Aug-26)
const periodMonth = (p: string) => `TO_DATE('01-${p}','DD-Mon-RR')`;
const safePeriod  = (p: string) => /^[A-Za-z]{3}-\d{2}$/.test(p);

interface ModuleDef {
  key: string;
  label: string;
  color: string;
  desc: string;
  view: string;                 // status view backing this module
  idColumn: string;             // primary id column in the detail result (drill key)
  pageLabel: string;            // where "Open in ..." navigates
  pagePath: (row: Record<string, string | number | null>) => string;
  summarySql: (period: string | null) => string;
  detailSql:  (period: string | null) => string;
}

const isIdColumn = (name: string) => /(^|_)id$/i.test(name);

const dateFilter = (col: string, period: string | null) =>
  period ? ` AND TRUNC(${col},'MM') = ${periodMonth(period)}` : '';

const MODULES: ModuleDef[] = [
  {
    key: 'AP_INV', label: 'AP Invoices', color: C.orange, desc: 'RR_V_AP_INVOICE_ACCT_STATUS',
    view: 'rr_v_ap_invoice_acct_status', idColumn: 'INVOICE_ID',
    pageLabel: 'Manage AP Invoices', pagePath: () => '/ap/manage-invoices',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ap_invoice_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT invoice_id, invoice_number, supplier, business_unit, invoice_currency, invoice_amount, accounting_date, validation_status, payment_status_calc FROM rr_v_ap_invoice_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY accounting_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'AP_PAY', label: 'AP Payments', color: C.orange, desc: 'RR_V_AP_PAYMENT_ACCT_STATUS',
    view: 'rr_v_ap_payment_acct_status', idColumn: 'CHECK_ID',
    pageLabel: 'AP Payments', pagePath: () => '/ap/payments',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ap_payment_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT check_id, payment_number, payee, business_unit, payment_currency, payment_amount, payment_date, accounting_date, payment_status FROM rr_v_ap_payment_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY payment_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'EXT_TXN', label: 'External Transactions', color: C.info, desc: 'RR_V_EXT_TXN_ACCT_STATUS',
    view: 'rr_v_ext_txn_acct_status', idColumn: 'EXTERNAL_TRANSACTION_ID',
    pageLabel: 'Manage External Transactions', pagePath: () => '/cash/external-transactions',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ext_txn_acct_status WHERE 1=1${dateFilter('transaction_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT external_transaction_id, transaction_date, amount, currency_code, transaction_type, bank_account_name, business_unit_name, description FROM rr_v_ext_txn_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('transaction_date', p)} ORDER BY transaction_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'FA', label: 'Fixed Assets', color: C.purple, desc: 'RR_V_FA_ASSET_ACCT_STATUS (additions; deprn for period)',
    view: 'rr_v_fa_asset_acct_status', idColumn: 'ASSET_ID',
    pageLabel: 'Manage Assets',
    pagePath: row => row.ASSET_NUMBER != null ? `/fa/assets?assetNumber=${row.ASSET_NUMBER}` : '/fa/assets',
    summarySql: p => p
      ? `SELECT 'ADDN ' || addition_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY addition_status UNION ALL SELECT CASE WHEN last_deprn_period = '${p}' THEN 'DEPRN ACCOUNTED' ELSE 'DEPRN NOT ACCOUNTED' END, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY CASE WHEN last_deprn_period = '${p}' THEN 'DEPRN ACCOUNTED' ELSE 'DEPRN NOT ACCOUNTED' END`
      : `SELECT 'ADDN ' || addition_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY addition_status UNION ALL SELECT 'DEPRN ' || deprn_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY deprn_status`,
    detailSql:  p => p
      ? `SELECT asset_id, asset_number, description, addition_status, deprn_status, last_deprn_period, deprn_periods_accounted, retirement_status FROM rr_v_fa_asset_acct_status WHERE addition_status = 'NOT ACCOUNTED' OR NVL(last_deprn_period,'-') <> '${p}' ORDER BY asset_number FETCH FIRST 500 ROWS ONLY`
      : `SELECT asset_id, asset_number, description, addition_status, deprn_status, last_deprn_period, deprn_periods_accounted, retirement_status FROM rr_v_fa_asset_acct_status WHERE addition_status = 'NOT ACCOUNTED' OR deprn_status = 'NOT ACCOUNTED' ORDER BY asset_number FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'AR_INV', label: 'AR Invoices', color: C.success, desc: 'RR_V_AR_INVOICE_ACCT_STATUS',
    view: 'rr_v_ar_invoice_acct_status', idColumn: 'CUSTOMER_TRANSACTION_ID',
    pageLabel: 'AR Invoices', pagePath: () => '/ar/manage-invoices',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ar_invoice_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT customer_transaction_id, transaction_number, bill_to_customer_name, business_unit, invoice_currency_code, entered_amount, invoice_balance_amount, accounting_date, payment_status_calc FROM rr_v_ar_invoice_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY accounting_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'AR_RCPT', label: 'AR Receipts', color: C.success, desc: 'RR_V_AR_RECEIPT_ACCT_STATUS',
    view: 'rr_v_ar_receipt_acct_status', idColumn: 'STANDARD_RECEIPT_ID',
    pageLabel: 'AR Receipts', pagePath: () => '/ar/manage-receipts',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ar_receipt_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT standard_receipt_id, receipt_number, customer_name, business_unit, currency, amount, unapplied_amount, receipt_date, application_status FROM rr_v_ar_receipt_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY receipt_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
];

const CheckAccounting: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userName = (user as { name?: string; email?: string })?.name
    ?? (user as { email?: string })?.email?.split('@')[0] ?? 'user';

  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState<string | null>(null);   // null = all periods
  const [summary, setSummary] = useState<Record<string, Record<string, number>>>({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<QueryResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sqlLog, setSqlLog] = useState<{ label: string; sql: string; ms: number; rows: number }[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [rowSearch, setRowSearch] = useState('');
  // drill-down: full record from the status view + link to the module page
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

  // Period list from the fiscal calendar (newest first)
  useEffect(() => {
    (async () => {
      try {
        const r = await runQuery('GL periods',
          `SELECT DISTINCT period_name, MAX(TO_NUMBER(fiscal_year)) fy, MAX(TO_NUMBER(fiscal_period)) fp FROM rr_v_gl_fiscal_periods WHERE TO_CHAR(application) = 'GL' AND TO_CHAR(adj_flag) = 'N' GROUP BY period_name ORDER BY 2 DESC, 3 DESC`);
        const list = r.rows.map(row => String(row[0])).filter(Boolean);
        setPeriods(list);
      } catch (e) {
        message.error(`Could not load GL periods: ${e instanceof Error ? e.message : e}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSummary = useCallback(async (p: string | null) => {
    if (p && !safePeriod(p)) return;
    setSummaryLoading(true);
    setSummaryError('');
    setDetailKey(null);
    setDetail(null);
    const next: Record<string, Record<string, number>> = {};
    try {
      await Promise.all(MODULES.map(async m => {
        const r = await runQuery(`${m.label} summary`, m.summarySql(p));
        const statuses: Record<string, number> = {};
        r.rows.forEach(row => { statuses[String(row[0])] = Number(row[1]) || 0; });
        next[m.key] = statuses;
      }));
      setSummary(next);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e));
    } finally {
      setSummaryLoading(false);
    }
  }, [runQuery]);

  useEffect(() => { loadSummary(period); }, [period, loadSummary]);

  const openDetail = async (m: ModuleDef) => {
    setDetailKey(m.key);
    setDetail(null);
    setRowSearch('');
    setDetailLoading(true);
    try {
      setDetail(await runQuery(`${m.label} — pending detail`, m.detailSql(period)));
    } catch (e) {
      message.error(`Detail failed: ${e instanceof Error ? e.message : e}`);
      setDetailKey(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const detailModule = MODULES.find(m => m.key === detailKey) || null;

  // client-side search across all columns of the detail grid
  const filteredDetailRows = useMemo(() => {
    if (!detail) return [];
    const f = rowSearch.trim().toLowerCase();
    if (!f) return detail.rows;
    return detail.rows.filter(r => r.some(v => String(v ?? '').toLowerCase().includes(f)));
  }, [detail, rowSearch]);

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

  const detailColumns = useMemo(() => (detail?.columns || []).map((c, i) => ({
    title: c.replace(/_/g, ' '),
    key: c,
    ellipsis: true,
    render: (_: unknown, row: (string | number | null)[]) => {
      const v = row[i];
      if (v === null || v === undefined) return <span style={{ fontSize: 12 }}>—</span>;
      // ids are identifiers, never amounts — show raw, no thousand separators
      if (isIdColumn(c)) {
        const text = String(v);
        return detailModule && c === detailModule.idColumn
          ? (
            <a onClick={() => openDrill(detailModule, text)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              title="Drill into this transaction">
              {text}
            </a>
          )
          : <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{text}</span>;
      }
      return typeof v === 'number'
        ? <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        : <span style={{ fontSize: 12 }}>{String(v)}</span>;
    },
  })), [detail, detailModule, openDrill]);

  const exportDetailExcel = () => {
    if (!detail || !detailModule) return;
    const ws = XLSX.utils.aoa_to_sheet([detail.columns, ...filteredDetailRows]);
    ws['!cols'] = detail.columns.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Accounting');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `Pending_Accounting_${detailModule.label.replace(/\s+/g, '_')}_${period || 'All'}.xlsx`);
  };

  // drill record as { COLUMN: value } for the modal + page link
  const drillRecord = useMemo(() => {
    if (!drillData?.rows.length) return null;
    const rec: Record<string, string | number | null> = {};
    drillData.columns.forEach((c, i) => { rec[c] = drillData.rows[0][i]; });
    return rec;
  }, [drillData]);

  const askAi = () => {
    window.dispatchEvent(new Event('reerp-ai:toggle'));
    message.info('Ask the assistant e.g. "which AP invoices are not accounted for ' + (period || 'this period') + '?"', 4);
  };

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <Title level={3} style={{ margin: 0 }}>
          <AuditOutlined style={{ color: C.primary, marginRight: 8 }} />Check Accounting
        </Title>
        <span style={{ flex: 1 }} />
        <Text style={{ fontSize: 12 }}>Period:</Text>
        <Select
          style={{ width: 140 }}
          value={period ?? 'ALL'}
          onChange={v => setPeriod(v === 'ALL' ? null : v)}
          showSearch
          options={[{ value: 'ALL', label: 'All periods' }, ...periods.map(p => ({ value: p, label: p }))]}
        />
        <Tooltip title="Reload all statuses">
          <Button icon={<ReloadOutlined />} loading={summaryLoading} onClick={() => loadSummary(period)}>Refresh</Button>
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
        Live accounting status across modules — documents matched to GL journal lines via their reference columns,
        queried through the guarded SQL gateway. Click a card to list what is still missing accounting.
      </Text>

      {summaryError && (
        <Alert
          type="error" showIcon style={{ marginBottom: 12 }}
          message={summaryError}
          description={summaryError.includes('ORA-00942')
            ? 'A status view is missing in the database — run database/ap/144_ap_accounting_status_views.sql and database/ap/145_more_accounting_status_views.sql in APEX SQL Workshop → SQL Scripts, then Refresh.'
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

      <Row gutter={[14, 14]}>
        {MODULES.map(m => {
          const statuses = summary[m.key] || {};
          const entries = Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b));
          const notAccounted = entries.filter(([s]) => s.includes('NOT ACCOUNTED')).reduce((t, [, n]) => t + n, 0);
          const selected = detailKey === m.key;
          return (
            <Col xs={24} sm={12} md={8} xl={4} key={m.key}>
              <Card
                hoverable
                onClick={() => openDetail(m)}
                style={{
                  borderRadius: 10, height: '100%', cursor: 'pointer',
                  border: selected ? `2px solid ${m.color}` : `1px solid ${C.border}`,
                  boxShadow: notAccounted > 0 ? '0 0 0 2px rgba(199,70,52,.12)' : undefined,
                }}
                styles={{ body: { padding: '12px 14px' } }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: m.color, marginBottom: 6 }}>{m.label}</div>
                {summaryLoading ? <Spin size="small" /> : (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    {entries.length === 0 && <Text type="secondary" style={{ fontSize: 11 }}>No documents{period ? ` in ${period}` : ''}</Text>}
                    {entries.map(([s, n]) => (
                      <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Tag color={s.includes('NOT ACCOUNTED') ? 'red' : s.includes('CANCEL') || s.includes('VOID') ? 'orange' : 'green'}
                          style={{ fontSize: 10, margin: 0 }}>{s}</Tag>
                        <Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString()}</Text>
                      </div>
                    ))}
                  </Space>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>

      {detailModule && (
        <Card
          size="small"
          style={{ marginTop: 16, borderColor: C.border, borderRadius: 10 }}
          title={
            <Space wrap>
              <Text strong>{detailModule.label} — pending accounting{period ? ` · ${period}` : ''}</Text>
              {detail && <Tag>{filteredDetailRows.length}{rowSearch ? ` of ${detail.rows.length}` : ''} row(s)</Tag>}
            </Space>
          }
          extra={
            <Space>
              <Input
                size="small" allowClear placeholder="Search rows…"
                value={rowSearch} onChange={e => setRowSearch(e.target.value)}
                style={{ width: 200 }}
              />
              <Button size="small" icon={<FileExcelOutlined />} disabled={!filteredDetailRows.length}
                onClick={exportDetailExcel} style={{ color: C.success, borderColor: C.success }}>
                Excel
              </Button>
            </Space>
          }
        >
          {detailLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
          {detail && !detailLoading && (
            detail.rows.length === 0
              ? <Alert type="success" showIcon message={`Nothing pending — every ${detailModule.label.toLowerCase()} document${period ? ` in ${period}` : ''} is accounted.`} />
              : (
                <>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                    Click an {detailModule.idColumn.replace(/_/g, ' ').toLowerCase()} to drill into the transaction.
                  </Text>
                  <Table
                    size="small"
                    dataSource={filteredDetailRows}
                    columns={detailColumns}
                    rowKey={(_, i) => String(i)}
                    pagination={{ pageSize: 20, size: 'small', showTotal: t => `${t} rows` }}
                    scroll={{ x: true }}
                  />
                </>
              )
          )}
        </Card>
      )}

      {/* Drill-down: full record from the status view + jump to the module page */}
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
