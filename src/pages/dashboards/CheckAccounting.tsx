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
import { Alert, Button, Card, Col, Row, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  AuditOutlined, CodeOutlined, FileExcelOutlined, ReloadOutlined, RobotOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';

const { Text, Title } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;

const C = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE', purple: '#722ed1',
  orange: '#d46b08', teal: '#13c2c2', border: '#E5E5E5', text2: '#6B6B6B',
};

interface QueryResult { columns: string[]; rows: (string | number | null)[][] }

// GL period month filter — period names are Mon-YY (e.g. Aug-26)
const periodMonth = (p: string) => `TO_DATE('01-${p}','DD-Mon-RR')`;
const safePeriod  = (p: string) => /^[A-Za-z]{3}-\d{2}$/.test(p);

interface ModuleDef {
  key: string;
  label: string;
  color: string;
  desc: string;
  summarySql: (period: string | null) => string;
  detailSql:  (period: string | null) => string;
}

const dateFilter = (col: string, period: string | null) =>
  period ? ` AND TRUNC(${col},'MM') = ${periodMonth(period)}` : '';

const MODULES: ModuleDef[] = [
  {
    key: 'AP_INV', label: 'AP Invoices', color: C.orange, desc: 'RR_V_AP_INVOICE_ACCT_STATUS',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ap_invoice_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT invoice_id, invoice_number, supplier, business_unit, invoice_currency, invoice_amount, accounting_date, validation_status, payment_status_calc FROM rr_v_ap_invoice_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY accounting_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'AP_PAY', label: 'AP Payments', color: C.orange, desc: 'RR_V_AP_PAYMENT_ACCT_STATUS',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ap_payment_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT check_id, payment_number, payee, business_unit, payment_currency, payment_amount, payment_date, accounting_date, payment_status FROM rr_v_ap_payment_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY payment_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'EXT_TXN', label: 'External Transactions', color: C.info, desc: 'RR_V_EXT_TXN_ACCT_STATUS',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ext_txn_acct_status WHERE 1=1${dateFilter('transaction_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT external_transaction_id, transaction_date, amount, currency_code, transaction_type, bank_account_name, business_unit_name, description FROM rr_v_ext_txn_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('transaction_date', p)} ORDER BY transaction_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'FA', label: 'Fixed Assets', color: C.purple, desc: 'RR_V_FA_ASSET_ACCT_STATUS (additions; deprn for period)',
    summarySql: p => p
      ? `SELECT 'ADDN ' || addition_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY addition_status UNION ALL SELECT CASE WHEN last_deprn_period = '${p}' THEN 'DEPRN ACCOUNTED' ELSE 'DEPRN NOT ACCOUNTED' END, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY CASE WHEN last_deprn_period = '${p}' THEN 'DEPRN ACCOUNTED' ELSE 'DEPRN NOT ACCOUNTED' END`
      : `SELECT 'ADDN ' || addition_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY addition_status UNION ALL SELECT 'DEPRN ' || deprn_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY deprn_status`,
    detailSql:  p => p
      ? `SELECT asset_id, asset_number, description, addition_status, deprn_status, last_deprn_period, deprn_periods_accounted, retirement_status FROM rr_v_fa_asset_acct_status WHERE addition_status = 'NOT ACCOUNTED' OR NVL(last_deprn_period,'-') <> '${p}' ORDER BY asset_number FETCH FIRST 500 ROWS ONLY`
      : `SELECT asset_id, asset_number, description, addition_status, deprn_status, last_deprn_period, deprn_periods_accounted, retirement_status FROM rr_v_fa_asset_acct_status WHERE addition_status = 'NOT ACCOUNTED' OR deprn_status = 'NOT ACCOUNTED' ORDER BY asset_number FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'AR_INV', label: 'AR Invoices', color: C.success, desc: 'RR_V_AR_INVOICE_ACCT_STATUS',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ar_invoice_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT customer_transaction_id, transaction_number, bill_to_customer_name, business_unit, invoice_currency_code, entered_amount, invoice_balance_amount, accounting_date, payment_status_calc FROM rr_v_ar_invoice_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY accounting_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
  {
    key: 'AR_RCPT', label: 'AR Receipts', color: C.success, desc: 'RR_V_AR_RECEIPT_ACCT_STATUS',
    summarySql: p => `SELECT gl_status, COUNT(*) FROM rr_v_ar_receipt_acct_status WHERE 1=1${dateFilter('accounting_date', p)} GROUP BY gl_status`,
    detailSql:  p => `SELECT standard_receipt_id, receipt_number, customer_name, business_unit, currency, amount, unapplied_amount, receipt_date, application_status FROM rr_v_ar_receipt_acct_status WHERE gl_status = 'NOT ACCOUNTED'${dateFilter('accounting_date', p)} ORDER BY receipt_date DESC FETCH FIRST 500 ROWS ONLY`,
  },
];

const CheckAccounting: React.FC = () => {
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

  // Same execution path as the AI assistant's SQL mode
  const runQuery = useCallback(async (label: string, sql: string): Promise<QueryResult> => {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/ai/executequery`, {
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

  const detailColumns = useMemo(() => (detail?.columns || []).map((c, i) => ({
    title: c.replace(/_/g, ' '),
    key: c,
    ellipsis: true,
    render: (_: unknown, row: (string | number | null)[]) => {
      const v = row[i];
      return typeof v === 'number'
        ? <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        : <span style={{ fontSize: 12 }}>{v === null || v === undefined ? '—' : String(v)}</span>;
    },
  })), [detail]);

  const exportDetailExcel = () => {
    if (!detail || !detailModule) return;
    const ws = XLSX.utils.aoa_to_sheet([detail.columns, ...detail.rows]);
    ws['!cols'] = detail.columns.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Accounting');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `Pending_Accounting_${detailModule.label.replace(/\s+/g, '_')}_${period || 'All'}.xlsx`);
  };

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
        <Button icon={<CodeOutlined />} onClick={() => setSqlOpen(s => !s)}>
          {sqlOpen ? 'Hide SQL' : 'Inspect SQL'}
        </Button>
        <Button type="primary" icon={<RobotOutlined />} onClick={askAi}
          style={{ background: C.primary, borderColor: C.primary }}>
          Ask AI about Accounting
        </Button>
      </div>
      <Text style={{ fontSize: 12, color: C.text2, display: 'block', marginBottom: 14 }}>
        Live accounting status across modules — documents matched to GL journal lines via their reference columns,
        queried through the guarded SQL gateway. Click a card to list what is still missing accounting.
      </Text>

      {summaryError && <Alert type="error" showIcon message={summaryError} style={{ marginBottom: 12 }} />}

      {sqlOpen && (
        <Card size="small" style={{ marginBottom: 14, borderColor: C.border }} title={<Text strong style={{ fontSize: 12 }}><CodeOutlined /> SQL executed (latest first)</Text>}>
          {sqlLog.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>No queries yet.</Text>}
          {sqlLog.map((q, i) => (
            <pre key={i} style={{ margin: '4px 0', padding: 8, background: '#F7F5F3', border: '1px solid #EFEBE9', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
              {detail && <Tag>{detail.rows.length} row(s)</Tag>}
            </Space>
          }
          extra={
            <Button size="small" icon={<FileExcelOutlined />} disabled={!detail?.rows.length}
              onClick={exportDetailExcel} style={{ color: C.success, borderColor: C.success }}>
              Excel
            </Button>
          }
        >
          {detailLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
          {detail && !detailLoading && (
            detail.rows.length === 0
              ? <Alert type="success" showIcon message={`Nothing pending — every ${detailModule.label.toLowerCase()} document${period ? ` in ${period}` : ''} is accounted.`} />
              : <Table
                  size="small"
                  dataSource={detail.rows}
                  columns={detailColumns}
                  rowKey={(_, i) => String(i)}
                  pagination={{ pageSize: 20, size: 'small', showTotal: t => `${t} rows` }}
                  scroll={{ x: true }}
                />
          )}
        </Card>
      )}
    </div>
  );
};

export default CheckAccounting;
