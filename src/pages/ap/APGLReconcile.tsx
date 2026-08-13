import { useState, useCallback, useEffect, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Card, Form, Select, Button, Table, Tag, Statistic, Row, Col,
  Space, Typography, Alert, Segmented, Tooltip, Modal, Input, Badge, Spin, Tabs, Popover, DatePicker,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined,
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined,
  ApiOutlined, CopyOutlined, LockOutlined, BookOutlined, SwapOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Text, Title } = Typography;
const { Option } = Select;

const APEX_BASE = APEX_DB_CONFIG.baseUrl;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  info:       '#0572CE',
  warning:    '#A86C00',
  error:      '#C74634',
  neutral100: '#F8F8F8',
  neutral200: '#E0E0E0',
  neutral600: '#6B6B6B',
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReconRow {
  sourceTable:     string;
  sourceId:        number;
  apNumber:        string;
  apAmount:        number | null;
  apDate:          string | null;
  apStatus:        string | null;
  apSupplier:      string | null;
  businessUnit:    string;
  apCurrency:      string | null;
  slaCount:        number;
  slaExists:       boolean;
  slaStatus:       string | null;
  slaPeriodName:   string | null;
  ledgerName:      string | null;
  slaCurrency:     string | null;
  slaEnteredDr:    number;
  slaEnteredCr:    number;
  slaLineCount:    number;
  glCount:         number;
  glExists:        boolean;
  glHeaderId:      number | null;
  glJournalName:   string | null;
  glBatchStatus:   string | null;
  glEnteredDr:     number;
  glEnteredCr:     number;
  glDrAccount:     string | null;
  glCrAccount:     string | null;
  apVsSlaDiff:     number;
  slaVsGlDiff:     number;
  apMatchesSla:    boolean;
  slaMatchesGl:    boolean;
  isFullyBalanced: boolean;
}

interface Summary {
  totalRows:       number;
  apTotalDr:       number;
  slaTotalDr:      number;
  glTotalDr:       number;
  apVsSlaDiff:     number;
  slaVsGlDiff:     number;
  noSlaCount:      number;
  noGlCount:       number;
  isFullyBalanced: boolean;
}

interface BUOption {
  name:    string;
  company: string;
}

interface PeriodInfo {
  period_name_id: string;
  period_year:    number;
  period_number:  number;
}

interface AccountOption {
  account:     string;
  description: string;
}

// ── Payments-GL Recon types ───────────────────────────────────────────────────

interface PaymentRow {
  checkId:              number | string;
  paperDocumentNumber:  string | null;
  paymentNumber:        string | null;
  paymentAmount:        number | null;
  paymentDate:          string | null;
  accountingDate:       string | null;
  paymentStatus:        string | null;
  accountingStatus:     string | null;
  payee:                string | null;
  supplierNumber:       string | null;
  businessUnit:         string | null;
  paymentMethod:        string | null;
  bankAccount:          string | null;
  currency:             string | null;
  description:          string | null;
}

interface GlSummary {
  lineCount:    number;
  totalDr:      number;
  totalCr:      number;
  journalName:  string | null;
  url:          string;
}

// ── Generic Source→GL Reconciliation Tab ─────────────────────────────────────

interface SourceRow {
  id:          string;        // the ID used to match GL lines
  refLabel:    string;        // human-readable number / reference
  amount:      number | null;
  txnDate:     string | null;
  description: string | null;
  status:      string | null;
  extra:       Record<string, string | null>; // extra display fields
}

interface SourceGLReconConfig {
  label:        string;
  fetchUrl:     (params: URLSearchParams) => string;
  mapRows:      (items: any[]) => SourceRow[];
  glRefParam:   string;                 // 'reference1' | 'reference2'
  glMatchField: (line: any) => string;  // extract the ref value from a GL line
  amountField:  (row: SourceRow) => number; // amount to compare vs GL DR
  extraColumns: { title: string; key: string; width?: number }[];
}

function SourceGLRecon({
  config, buObjects, buLoading,
  sharedDateFrom, sharedDateTo, sharedBU, onSharedChange,
}: {
  config: SourceGLReconConfig; buObjects: BUOption[]; buLoading: boolean;
  sharedDateFrom?: Dayjs | null; sharedDateTo?: Dayjs | null; sharedBU?: string;
  onSharedChange?: (df: Dayjs | null, dt: Dayjs | null, bu: string) => void;
}) {
  const [dateFrom, setDateFrom]             = useState<Dayjs | null>(sharedDateFrom ?? null);
  const [dateTo, setDateTo]                 = useState<Dayjs | null>(sharedDateTo ?? null);
  const [selectedBU, setSelectedBU]         = useState(sharedBU ?? '');
  const [rows, setRows]                     = useState<SourceRow[]>([]);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [sourceUrl, setSourceUrl]           = useState('');
  const [apiPopOpen, setApiPopOpen]         = useState(false);
  const [glData, setGlData]                 = useState<Record<string, GlSummary>>({});
  const [glLoading, setGlLoading]           = useState<Record<string, boolean>>({});
  const [fetchAllProgress, setFetchAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [matchFilter, setMatchFilter]       = useState<'ALL' | 'MATCHED' | 'MISMATCH' | 'NO_GL'>('ALL');

  // Sync incoming shared dates when parent changes them (tab switch)
  useEffect(() => { if (sharedDateFrom !== undefined) setDateFrom(sharedDateFrom); }, [sharedDateFrom]);
  useEffect(() => { if (sharedDateTo   !== undefined) setDateTo(sharedDateTo);     }, [sharedDateTo]);
  useEffect(() => { if (sharedBU       !== undefined) setSelectedBU(sharedBU);     }, [sharedBU]);

  const handleDateFromChange = (v: Dayjs | null) => { setDateFrom(v);    onSharedChange?.(v, dateTo,   selectedBU); };
  const handleDateToChange   = (v: Dayjs | null) => { setDateTo(v);      onSharedChange?.(dateFrom, v, selectedBU); };
  const handleBUChange       = (v: string)       => { setSelectedBU(v);  onSharedChange?.(dateFrom, dateTo, v); };

  const handleSearch = useCallback(async () => {
    if (!dateFrom || !dateTo) { setError('Please select From and To dates'); return; }
    setError(null);
    setLoading(true);
    setGlData({});
    try {
      const p = new URLSearchParams();
      p.set('date_from', dateFrom.format('YYYY-MM-DD'));
      p.set('date_to',   dateTo.format('YYYY-MM-DD'));
      if (selectedBU) p.set('business_unit', selectedBU);
      const url = config.fetchUrl(p);
      setSourceUrl(url);
      const res  = await fetch(url);
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch (parseErr) {
        throw new Error(`Invalid JSON from server: ${(parseErr as Error).message}\n\nFirst 300 chars: ${text.slice(0, 300)}`);
      }
      setRows(config.mapRows(data.items ?? []));
    } catch (e: any) {
      setError(e.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedBU, config]);

  const fetchGlLines = useCallback(async (id: string) => {
    const p = new URLSearchParams({ [config.glRefParam]: id, limit: '500' });
    const url = `${APEX_BASE}/gl/journals/lines?${p}`;
    setGlLoading(prev => ({ ...prev, [id]: true }));
    try {
      const res   = await fetch(url);
      const data  = await res.json();
      const lines: any[] = data.items ?? [];
      const totalDr = lines.reduce((s, l) => s + Number(l.entered_dr ?? l.enteredDr ?? 0), 0);
      const totalCr = lines.reduce((s, l) => s + Number(l.entered_cr ?? l.enteredCr ?? 0), 0);
      const journalName = lines[0] ? String(lines[0].journal_name ?? lines[0].journalName ?? '') || null : null;
      setGlData(prev => ({ ...prev, [id]: { lineCount: lines.length, totalDr, totalCr, journalName, url } }));
    } catch {
      setGlData(prev => ({ ...prev, [id]: { lineCount: 0, totalDr: 0, totalCr: 0, journalName: null, url: '' } }));
    } finally {
      setGlLoading(prev => ({ ...prev, [id]: false }));
    }
  }, [config]);

  const fetchAllGlLines = useCallback(async () => {
    const pending = rows.filter(r => !glData[r.id]);
    if (!pending.length) return;
    setFetchAllProgress({ done: 0, total: pending.length });
    let done = 0;
    const BATCH = 5;
    for (let i = 0; i < pending.length; i += BATCH) {
      await Promise.all(pending.slice(i, i + BATCH).map(r => fetchGlLines(r.id)));
      done += BATCH;
      setFetchAllProgress({ done: Math.min(done, pending.length), total: pending.length });
    }
    setFetchAllProgress(null);
  }, [rows, glData, fetchGlLines]);

  const getMatch = (r: SourceRow): 'matched' | 'mismatch' | 'no_gl' | 'pending' => {
    const gl = glData[r.id];
    if (!gl) return 'pending';
    if (gl.lineCount === 0) return 'no_gl';
    const expected = Math.abs(config.amountField(r) ?? 0);
    return Math.abs(gl.totalDr - expected) < 0.02 ? 'matched' : 'mismatch';
  };

  const filteredRows = rows.filter(r => {
    if (matchFilter === 'ALL')      return true;
    const m = getMatch(r);
    if (matchFilter === 'MATCHED')  return m === 'matched';
    if (matchFilter === 'MISMATCH') return m === 'mismatch';
    if (matchFilter === 'NO_GL')    return m === 'no_gl';
    return true;
  });

  const glFetchedCount = rows.filter(r => !!glData[r.id]).length;
  const matchedCount   = rows.filter(r => getMatch(r) === 'matched').length;
  const mismatchCount  = rows.filter(r => getMatch(r) === 'mismatch').length;
  const noGlCount      = rows.filter(r => getMatch(r) === 'no_gl').length;
  const totalAmount    = rows.reduce((s, r) => s + Math.abs(config.amountField(r) ?? 0), 0);

  const columns: ColumnsType<SourceRow> = [
    {
      title: 'Reference', dataIndex: 'refLabel', width: 180, fixed: 'left',
      render: v => <Text code style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Amount', dataIndex: 'amount', width: 130, align: 'right',
      render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmt(v)}</Text>,
    },
    {
      title: 'Date', dataIndex: 'txnDate', width: 100,
      render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Description', dataIndex: 'description', width: 240,
      render: v => <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: v }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 100,
      render: v => v
        ? <Tag color={v === 'POSTED' || v === 'Negotiable' ? 'green' : v === 'CANCELLED' || v === 'VOID' ? 'red' : 'default'} style={{ fontSize: 10 }}>{v}</Tag>
        : <Text type="secondary">—</Text>,
    },
    ...config.extraColumns.map(col => ({
      title: col.title, key: col.key, width: col.width ?? 140,
      render: (_: any, r: SourceRow) => <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: r.extra[col.key] ?? '' }}>{r.extra[col.key] ?? '—'}</Text>,
    })),
    {
      title: 'GL Lines', key: 'glLines', width: 290,
      render: (_: any, r: SourceRow) => {
        const gl   = glData[r.id];
        const busy = glLoading[r.id];
        if (!gl) {
          return (
            <Button size="small" loading={busy} icon={<SearchOutlined />} onClick={() => fetchGlLines(r.id)}>
              Fetch GL Lines
            </Button>
          );
        }
        const m = getMatch(r);
        return (
          <Space size={4}>
            <Tag color={m === 'no_gl' ? 'red' : m === 'matched' ? 'green' : 'orange'} style={{ fontSize: 10 }}>
              {gl.lineCount} line{gl.lineCount !== 1 ? 's' : ''}
            </Tag>
            {gl.lineCount > 0 && (
              <>
                <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>DR {fmt(gl.totalDr)}</Text>
                <Text type="secondary" style={{ fontSize: 10 }}>/</Text>
                <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>CR {fmt(gl.totalCr)}</Text>
              </>
            )}
            {gl.url && (
              <Popover trigger="click" content={
                <Space.Compact style={{ width: 480 }}>
                  <Input value={gl.url} readOnly style={{ fontFamily: 'monospace', fontSize: 11 }} />
                  <Tooltip title="Copy"><Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(gl.url)} /></Tooltip>
                </Space.Compact>
              }>
                <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 12 }} />
              </Popover>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}>
        <Row gutter={12} align="bottom">
          <Col xs={12} sm={5}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>From Date</div>
            <DatePicker value={dateFrom} onChange={handleDateFromChange} format="DD-MMM-YYYY" placeholder="From date" style={{ width: '100%' }} />
          </Col>
          <Col xs={12} sm={5}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>To Date</div>
            <DatePicker value={dateTo} onChange={handleDateToChange} format="DD-MMM-YYYY" placeholder="To date"
              disabledDate={d => !!dateFrom && d.isBefore(dateFrom, 'day')} style={{ width: '100%' }} />
          </Col>
          <Col xs={24} sm={7}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Business Unit</div>
            <Select placeholder="All business units" value={selectedBU || undefined} loading={buLoading}
              onChange={v => handleBUChange(v ?? '')} allowClear showSearch optionFilterProp="label"
              options={buObjects.map(b => ({ value: b.name, label: b.company ? `${b.name}  (${b.company})` : b.name }))}
              style={{ width: '100%' }} dropdownStyle={{ minWidth: 360 }} />
          </Col>
          <Col xs={24} sm={7} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={handleSearch}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
              Search
            </Button>
            <Popover open={apiPopOpen} onOpenChange={setApiPopOpen} trigger="click"
              title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />Source API Endpoint</Space>}
              content={
                <div style={{ width: 520 }}>
                  {sourceUrl
                    ? <Space.Compact style={{ width: '100%' }}>
                        <Input value={sourceUrl} readOnly style={{ fontFamily: 'monospace', fontSize: 11 }} />
                        <Tooltip title="Copy"><Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(sourceUrl)} /></Tooltip>
                      </Space.Compact>
                    : <Text type="secondary" style={{ fontSize: 12 }}>Run a search first.</Text>}
                </div>
              }>
              <Tooltip title="View API endpoint">
                <Button icon={<ApiOutlined />} style={sourceUrl ? { color: REDWOOD.info, borderColor: REDWOOD.info } : {}} />
              </Tooltip>
            </Popover>
          </Col>
        </Row>
      </Card>

      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} style={{ marginBottom: 12 }} />}

      {rows.length > 0 && (
        <Row gutter={10} style={{ marginBottom: 16 }}>
          {[
            { title: 'Total Records',   value: rows.length },
            { title: 'Total Amount',    value: fmt(totalAmount) },
            { title: 'GL Fetched',      value: `${glFetchedCount} / ${rows.length}` },
            { title: 'Matched',         value: matchedCount,   color: matchedCount  > 0 ? REDWOOD.success : undefined },
            { title: 'Mismatch',        value: mismatchCount,  color: mismatchCount > 0 ? REDWOOD.error   : undefined },
            { title: 'No GL Lines',     value: noGlCount,      color: noGlCount     > 0 ? REDWOOD.warning : undefined },
          ].map(s => (
            <Col span={4} key={s.title}>
              <Card size="small">
                <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 14, color: s.color }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Card size="small"
        title={
          <Space wrap>
            <span>{config.label} – GL Reconciliation</span>
            {rows.length > 0 && <Tag>{rows.length} rows</Tag>}
          </Space>
        }
        extra={rows.length > 0 && (
          <Space>
            <Button size="small" type="primary" icon={<SearchOutlined />}
              loading={!!fetchAllProgress} onClick={fetchAllGlLines}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
              {fetchAllProgress
                ? `Fetching ${fetchAllProgress.done} / ${fetchAllProgress.total}…`
                : `Fetch GL Lines for All${glFetchedCount > 0 ? ` (${rows.length - glFetchedCount} remaining)` : ''}`}
            </Button>
            {glFetchedCount > 0 && (
              <Segmented size="small" value={matchFilter} onChange={v => setMatchFilter(v as typeof matchFilter)}
                options={[
                  { label: `All (${rows.length})`,       value: 'ALL' },
                  { label: `Matched (${matchedCount})`,  value: 'MATCHED' },
                  { label: `Mismatch (${mismatchCount})`, value: 'MISMATCH' },
                  { label: `No GL (${noGlCount})`,       value: 'NO_GL' },
                ]} />
            )}
          </Space>
        )}>
        <Table<SourceRow>
          dataSource={filteredRows}
          columns={columns}
          rowKey={r => r.id}
          loading={loading}
          size="small"
          scroll={{ x: 1400 }}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} rows` }}
          rowClassName={r => {
            const m = getMatch(r);
            return m === 'no_gl' ? 'row-missing' : m === 'mismatch' ? 'row-warning' : '';
          }}
        />
      </Card>

      <style>{`
        .row-missing td { background-color: #fff1f0 !important; }
        .row-warning td { background-color: #fff7e6 !important; }
      `}</style>
    </div>
  );
}

// ── Configs for each source type ─────────────────────────────────────────────

const INVOICES_CONFIG: SourceGLReconConfig = {
  label: 'Invoices',
  fetchUrl: p => {
    // Reuse the same endpoint as Manage Invoices page
    const q = new URLSearchParams();
    if (p.get('date_from'))     q.set('invoice_date_from', p.get('date_from')!);
    if (p.get('date_to'))       q.set('invoice_date_to',   p.get('date_to')!);
    if (p.get('business_unit')) q.set('business_unit',     p.get('business_unit')!);
    return `${APEX_BASE}/ap/createinvoice?${q}`;
  },
  mapRows: items => items.map((i: any) => ({
    id:          String(i.invoiceId   ?? i.invoice_id   ?? ''),
    refLabel:    String(i.invoiceNumber ?? i.invoice_number ?? i.invoiceId ?? ''),
    amount:      Number(i.invoiceAmount ?? i.invoice_amount ?? 0),
    txnDate:     i.invoiceDate    ?? i.invoice_date    ?? null,
    description: i.description    ?? null,
    status:      i.validationStatus ?? i.validation_status ?? null,
    extra: {
      supplier:         i.supplier      ?? null,
      businessUnit:     i.businessUnit  ?? i.business_unit ?? null,
      paidStatus:       i.paidStatus    ?? i.paid_status    ?? null,
    },
  })),
  glRefParam:   'reference2',
  glMatchField: l => String(l.reference2 ?? ''),
  amountField:  r => r.amount ?? 0,
  extraColumns: [
    { title: 'Supplier',      key: 'supplier',     width: 200 },
    { title: 'Business Unit', key: 'businessUnit', width: 180 },
    { title: 'Paid Status',   key: 'paidStatus',   width: 100 },
  ],
};

const EXTERNAL_TXN_CONFIG: SourceGLReconConfig = {
  label: 'External Transactions',
  fetchUrl: p => {
    // endpoint uses row_limit (not limit) and business_unit maps to BUSINESS_UNIT_NAME
    const q = new URLSearchParams();
    if (p.get('date_from'))     q.set('date_from',    p.get('date_from')!);
    if (p.get('date_to'))       q.set('date_to',      p.get('date_to')!);
    if (p.get('business_unit')) q.set('business_unit', p.get('business_unit')!);
    q.set('row_limit', '2000');
    return `${APEX_BASE}/cash/externaltransactions?${q}`;
  },
  mapRows: items => items.map((i: any) => ({
    id:          String(i.external_transaction_id ?? i.externalTransactionId ?? ''),
    refLabel:    String(i.transaction_id ?? i.transactionId ?? i.reference_text ?? i.referenceText ?? i.external_transaction_id ?? ''),
    amount:      Number(i.amount ?? 0),
    txnDate:     i.transaction_date ?? i.transactionDate ?? null,
    description: i.description ?? i.reference_text ?? i.referenceText ?? null,
    status:      i.accounting_flag ?? i.accountingFlag ?? i.status ?? null,
    extra: {
      bankAccount:  i.bank_account_name ?? i.bankAccountName ?? null,
      currency:     i.currency_code     ?? i.currencyCode    ?? null,
    },
  })),
  glRefParam:   'reference1',
  glMatchField: l => String(l.reference1 ?? ''),
  amountField:  r => r.amount ?? 0,
  extraColumns: [
    { title: 'Bank Account', key: 'bankAccount', width: 200 },
    { title: 'Currency',     key: 'currency',    width: 80  },
  ],
};

const BANK_TRANSFER_CONFIG: SourceGLReconConfig = {
  label: 'Bank Transfers',
  fetchUrl: p => {
    const q = new URLSearchParams();
    if (p.get('date_from'))     q.set('date_from',     p.get('date_from')!);
    if (p.get('date_to'))       q.set('date_to',       p.get('date_to')!);
    if (p.get('business_unit')) q.set('business_unit', p.get('business_unit')!);
    q.set('row_limit', '2000');
    return `${APEX_BASE}/cash/banktransfers?${q}`;
  },
  mapRows: items => items.map((i: any) => ({
    id:          String(i.bank_account_transfer_id ?? i.bankAccountTransferId ?? ''),
    refLabel:    String(i.bank_account_transfer_number ?? i.bankAccountTransferNumber ?? i.bank_account_transfer_id ?? ''),
    amount:      Number(i.payment_amount ?? i.paymentAmount ?? 0),
    txnDate:     i.transaction_date ?? i.transactionDate ?? null,
    description: i.memo ?? i.description ?? null,
    status:      i.status ?? i.payment_status ?? i.paymentStatus ?? null,
    extra: {
      fromAccount: i.from_bank_account_name ?? i.fromBankAccountName ?? null,
      toAccount:   i.to_bank_account_name   ?? i.toBankAccountName   ?? null,
    },
  })),
  glRefParam:   'reference1',
  glMatchField: l => String(l.reference1 ?? ''),
  amountField:  r => r.amount ?? 0,
  extraColumns: [
    { title: 'From Account', key: 'fromAccount', width: 180 },
    { title: 'To Account',   key: 'toAccount',   width: 180 },
  ],
};

const SOURCE_TABLE_OPTIONS = [
  { value: 'AP_INVOICES',                label: 'AP Invoices' },
  { value: 'AP_PAYMENTS',                label: 'AP Payments' },
  { value: 'RR_BANK_ACCOUNT_TRANSFERS',  label: 'Bank Transfers' },
];

const STATUS_OPTIONS = [
  { value: 'DRAFT',  label: 'Draft' },
  { value: 'FINAL',  label: 'Final' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'ERROR',  label: 'Error' },
];

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null ? '–' : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

function StatusTick({ exists, tooltip }: { exists: boolean; tooltip?: string }) {
  const icon = exists
    ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16 }} />
    : <CloseCircleOutlined style={{ color: REDWOOD.error,   fontSize: 16 }} />;
  return tooltip ? <Tooltip title={tooltip}>{icon}</Tooltip> : icon;
}

// ── AccountPicker modal (same UX as Account Analysis) ─────────────────────────
const AccountPicker: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (account: string, description: string) => void;
  options: AccountOption[];
  loading: boolean;
}> = ({ open, onClose, onSelect, options, loading }) => {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return q
      ? options.filter(o => o.account.toLowerCase().includes(lq) || o.description.toLowerCase().includes(lq))
      : options;
  }, [options, q]);
  const close = () => { onClose(); setQ(''); };
  return (
    <Modal open={open} onCancel={close} footer={null}
      title={<Space><SearchOutlined style={{ color: REDWOOD.info }} />Select Account</Space>} width={640}>
      <Input prefix={<SearchOutlined />} placeholder="Search code or description…"
        allowClear size="small" value={q} onChange={e => setQ(e.target.value)}
        style={{ marginBottom: 8 }} autoFocus />
      <div onClick={() => { onSelect('', ''); close(); }}
        style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: `1px solid ${REDWOOD.neutral200}`,
          background: '#fafafa', fontSize: 12, color: REDWOOD.neutral600 }}
        onMouseEnter={e => (e.currentTarget.style.background = '#e6f4ff')}
        onMouseLeave={e => (e.currentTarget.style.background = '#fafafa')}>
        — All Accounts —
      </div>
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {loading && <div style={{ padding: 24, textAlign: 'center' }}><Spin size="small" /></div>}
        {!loading && filtered.map(o => (
          <div key={o.account} onClick={() => { onSelect(o.account, o.description); close(); }}
            style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex', gap: 10, alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#e6f4ff')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}>
            <Text code style={{ fontSize: 11, minWidth: 130 }}>{o.account}</Text>
            <Text style={{ fontSize: 12, flex: 1 }}>{o.description}</Text>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: REDWOOD.neutral600 }}>No accounts found</div>
        )}
      </div>
    </Modal>
  );
};

// ── Payments–GL Recon Tab ─────────────────────────────────────────────────────

interface PaymentsGLReconProps {
  buObjects: BUOption[];
  buLoading: boolean;
  sharedDateFrom?: Dayjs | null;
  sharedDateTo?:   Dayjs | null;
  sharedBU?:       string;
  onSharedChange?: (df: Dayjs | null, dt: Dayjs | null, bu: string) => void;
}

function PaymentsGLRecon({ buObjects, buLoading, sharedDateFrom, sharedDateTo, sharedBU, onSharedChange }: PaymentsGLReconProps) {
  const [dateFrom, setDateFrom]       = useState<Dayjs | null>(sharedDateFrom ?? null);
  const [dateTo, setDateTo]           = useState<Dayjs | null>(sharedDateTo ?? null);
  const [selectedBU, setSelectedBU]   = useState(sharedBU ?? '');
  const [rows, setRows]               = useState<PaymentRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [paymentsUrl, setPaymentsUrl] = useState<string>('');
  const [apiPopOpen, setApiPopOpen]   = useState(false);
  // per-row GL summary: keyed by checkId string
  const [glData, setGlData]           = useState<Record<string, GlSummary>>({});
  const [glLoading, setGlLoading]     = useState<Record<string, boolean>>({});
  const [fetchAllProgress, setFetchAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [matchFilter, setMatchFilter] = useState<'ALL' | 'MATCHED' | 'MISMATCH' | 'NO_GL'>('ALL');

  // Sync shared date/BU from parent when tab is revisited
  useEffect(() => { if (sharedDateFrom !== undefined) setDateFrom(sharedDateFrom); }, [sharedDateFrom]);
  useEffect(() => { if (sharedDateTo   !== undefined) setDateTo(sharedDateTo);     }, [sharedDateTo]);
  useEffect(() => { if (sharedBU       !== undefined) setSelectedBU(sharedBU);     }, [sharedBU]);

  const handleDateFromChange = (v: Dayjs | null) => { setDateFrom(v);   onSharedChange?.(v, dateTo,   selectedBU); };
  const handleDateToChange   = (v: Dayjs | null) => { setDateTo(v);     onSharedChange?.(dateFrom, v, selectedBU); };
  const handleBUChange       = (v: string)       => { setSelectedBU(v); onSharedChange?.(dateFrom, dateTo, v); };

  const handleSearch = useCallback(async () => {
    if (!dateFrom || !dateTo) { setError('Please select From and To dates'); return; }
    setError(null);
    setLoading(true);
    setGlData({});
    try {
      const pParams = new URLSearchParams({ limit: '2000' });
      pParams.set('date_from', dateFrom.format('YYYY-MM-DD'));
      pParams.set('date_to',   dateTo.format('YYYY-MM-DD'));
      if (selectedBU) pParams.set('business_unit', selectedBU);
      const url = `${APEX_BASE}/ap/payments?${pParams}`;
      setPaymentsUrl(url);
      const pRes  = await fetch(url);
      const pData = await pRes.json();
      const payments: any[] = pData.items ?? [];

      const built: PaymentRow[] = payments.map((p: any) => ({
        checkId:             p.CheckId            ?? p.checkId            ?? '',
        paperDocumentNumber: p.PaperDocumentNumber ?? p.paperDocumentNumber ?? null,
        paymentNumber:       p.PaymentNumber       ?? p.paymentNumber       ?? null,
        paymentAmount:       Number(p.PaymentAmount ?? p.paymentAmount ?? 0),
        paymentDate:         p.PaymentDate         ?? p.paymentDate         ?? null,
        accountingDate:      p.AccountingDate      ?? p.accountingDate      ?? null,
        paymentStatus:       p.PaymentStatus       ?? p.paymentStatus       ?? null,
        accountingStatus:    p.AccountingStatus    ?? p.accountingStatus    ?? null,
        payee:               p.Payee               ?? p.payee               ?? null,
        supplierNumber:      p.SupplierNumber      ?? p.supplierNumber      ?? null,
        businessUnit:        p.BusinessUnit        ?? p.businessUnit        ?? null,
        paymentMethod:       p.PaymentMethod       ?? p.paymentMethod       ?? null,
        bankAccount:         p.DisbursementBankAccountName ?? p.disbursementBankAccountName ?? null,
        currency:            p.PaymentCurrency     ?? p.paymentCurrency     ?? null,
        description:         p.PaymentDescription  ?? p.paymentDescription  ?? null,
      }));

      setRows(built);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedBU]);

  const fetchGlLines = useCallback(async (checkId: string) => {
    const glParams = new URLSearchParams({ reference2: checkId, limit: '500' });
    const url = `${APEX_BASE}/gl/journals/lines?${glParams}`;
    setGlLoading(prev => ({ ...prev, [checkId]: true }));
    try {
      const res  = await fetch(url);
      const data = await res.json();
      const lines: any[] = data.items ?? [];
      const totalDr = lines.reduce((s, l) => s + Number(l.entered_dr ?? l.enteredDr ?? 0), 0);
      const totalCr = lines.reduce((s, l) => s + Number(l.entered_cr ?? l.enteredCr ?? 0), 0);
      const journalName = lines[0]
        ? String(lines[0].journal_name ?? lines[0].journalName ?? '')
        : null;
      setGlData(prev => ({
        ...prev,
        [checkId]: { lineCount: lines.length, totalDr, totalCr, journalName: journalName || null, url },
      }));
    } catch {
      setGlData(prev => ({ ...prev, [checkId]: { lineCount: 0, totalDr: 0, totalCr: 0, journalName: null, url } }));
    } finally {
      setGlLoading(prev => ({ ...prev, [checkId]: false }));
    }
  }, []);

  const fetchAllGlLines = useCallback(async () => {
    if (!rows.length) return;
    const pending = rows.filter(r => !glData[String(r.checkId)]);
    if (!pending.length) return;
    setFetchAllProgress({ done: 0, total: pending.length });
    let done = 0;
    // process in batches of 5 to avoid flooding the server
    const BATCH = 5;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      await Promise.all(batch.map(r => fetchGlLines(String(r.checkId))));
      done += batch.length;
      setFetchAllProgress({ done, total: pending.length });
    }
    setFetchAllProgress(null);
  }, [rows, glData, fetchGlLines]);

  const getMatch = (r: PaymentRow): 'matched' | 'mismatch' | 'no_gl' | 'pending' => {
    const gl = glData[String(r.checkId)];
    if (!gl) return 'pending';
    if (gl.lineCount === 0) return 'no_gl';
    return Math.abs(gl.totalDr - Math.abs(r.paymentAmount ?? 0)) < 0.02 ? 'matched' : 'mismatch';
  };

  const filteredRows = rows.filter(r => {
    if (matchFilter === 'ALL') return true;
    const m = getMatch(r);
    if (matchFilter === 'MATCHED')  return m === 'matched';
    if (matchFilter === 'MISMATCH') return m === 'mismatch';
    if (matchFilter === 'NO_GL')    return m === 'no_gl';
    return true;
  });

  const glFetchedCount = rows.filter(r => !!glData[String(r.checkId)]).length;
  const matchedCount   = rows.filter(r => getMatch(r) === 'matched').length;
  const mismatchCount  = rows.filter(r => getMatch(r) === 'mismatch').length;
  const noGlCount      = rows.filter(r => getMatch(r) === 'no_gl').length;

  const totalPayments = rows.length;
  const totalApAmount = rows.reduce((s, r) => s + (r.paymentAmount ?? 0), 0);

  const columns: ColumnsType<PaymentRow> = [
    {
      title: 'Check / Doc #', dataIndex: 'paperDocumentNumber', width: 180, fixed: 'left',
      render: v => <Text code style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Payee', dataIndex: 'payee', width: 220,
      render: v => <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: v }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Supplier #', dataIndex: 'supplierNumber', width: 90,
      render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Amount', dataIndex: 'paymentAmount', width: 130, align: 'right',
      render: (v, r) => (
        <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>
          {fmt(v)} {r.currency ? <span style={{ color: '#888', fontSize: 10 }}>{r.currency}</span> : null}
        </Text>
      ),
    },
    {
      title: 'Payment Date', dataIndex: 'paymentDate', width: 110,
      render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Acctg Date', dataIndex: 'accountingDate', width: 100,
      render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Payment Status', dataIndex: 'paymentStatus', width: 120,
      render: v => v ? <Tag style={{ fontSize: 10 }}>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Acctg Status', dataIndex: 'accountingStatus', width: 100,
      render: v => v
        ? <Tag color={v === 'POSTED' ? 'green' : v === 'ERROR' ? 'red' : 'default'} style={{ fontSize: 10 }}>{v}</Tag>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Method', dataIndex: 'paymentMethod', width: 80,
      render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Business Unit', dataIndex: 'businessUnit', width: 180,
      render: v => <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: v }}>{v ?? '—'}</Text>,
    },
    {
      title: 'GL Lines', key: 'glLines', width: 280,
      render: (_, r) => {
        const key  = String(r.checkId);
        const gl   = glData[key];
        const busy = glLoading[key];
        if (!gl) {
          return (
            <Button
              size="small"
              loading={busy}
              icon={<SearchOutlined />}
              onClick={() => fetchGlLines(key)}
            >
              Fetch GL Lines
            </Button>
          );
        }
        const matched = gl.lineCount > 0 && Math.abs(gl.totalDr - Math.abs(r.paymentAmount ?? 0)) < 0.02;
        return (
          <Space size={4}>
            <Tag color={gl.lineCount === 0 ? 'red' : matched ? 'green' : 'orange'} style={{ fontSize: 10 }}>
              {gl.lineCount} line{gl.lineCount !== 1 ? 's' : ''}
            </Tag>
            {gl.lineCount > 0 && (
              <>
                <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>DR {fmt(gl.totalDr)}</Text>
                <Text type="secondary" style={{ fontSize: 10 }}>/</Text>
                <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>CR {fmt(gl.totalCr)}</Text>
              </>
            )}
            <Tooltip title={gl.url}>
              <Popover
                trigger="click"
                content={
                  <Space.Compact style={{ width: 480 }}>
                    <Input value={gl.url} readOnly style={{ fontFamily: 'monospace', fontSize: 11 }} />
                    <Tooltip title="Copy"><Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(gl.url)} /></Tooltip>
                  </Space.Compact>
                }
              >
                <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 12 }} />
              </Popover>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      {/* Filter bar */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}>
        <Row gutter={12} align="bottom">
          <Col xs={12} sm={5}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>From Date</div>
            <DatePicker
              value={dateFrom}
              onChange={handleDateFromChange}
              format="DD-MMM-YYYY"
              placeholder="From date"
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={12} sm={5}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>To Date</div>
            <DatePicker
              value={dateTo}
              onChange={handleDateToChange}
              format="DD-MMM-YYYY"
              placeholder="To date"
              disabledDate={d => !!dateFrom && d.isBefore(dateFrom, 'day')}
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} sm={7}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Business Unit</div>
            <Select
              placeholder="All business units"
              value={selectedBU || undefined}
              loading={buLoading}
              onChange={v => handleBUChange(v ?? '')}
              allowClear
              showSearch
              optionFilterProp="label"
              options={buObjects.map(b => ({
                value: b.name,
                label: b.company ? `${b.name}  (${b.company})` : b.name,
              }))}
              style={{ width: '100%' }}
              dropdownStyle={{ minWidth: 360 }}
            />
          </Col>
          <Col xs={24} sm={7} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={loading}
              onClick={handleSearch}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            >
              Search
            </Button>
            <Popover
              open={apiPopOpen}
              onOpenChange={setApiPopOpen}
              trigger="click"
              title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />Payments API Endpoint</Space>}
              content={
                <div style={{ width: 520 }}>
                  {paymentsUrl ? (
                    <Space.Compact style={{ width: '100%' }}>
                      <Input value={paymentsUrl} readOnly style={{ fontFamily: 'monospace', fontSize: 11 }} />
                      <Tooltip title="Copy">
                        <Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(paymentsUrl)} />
                      </Tooltip>
                    </Space.Compact>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>Run a search first to see the called endpoint.</Text>
                  )}
                </div>
              }
            >
              <Tooltip title="View Payments API endpoint">
                <Button icon={<ApiOutlined />} style={paymentsUrl ? { color: REDWOOD.info, borderColor: REDWOOD.info } : {}} />
              </Tooltip>
            </Popover>
          </Col>
        </Row>
      </Card>

      {error && (
        <Alert type="error" message={error} closable onClose={() => setError(null)} style={{ marginBottom: 12 }} />
      )}

      {/* Summary cards */}
      {rows.length > 0 && (
        <Row gutter={10} style={{ marginBottom: 16 }}>
          {[
            { title: 'Total Payments',  value: totalPayments,        color: undefined },
            { title: 'Total AP Amount', value: fmt(totalApAmount),   color: undefined },
            { title: 'GL Fetched',      value: `${glFetchedCount} / ${totalPayments}`, color: undefined },
            { title: 'Matched',         value: matchedCount,         color: matchedCount > 0 ? REDWOOD.success : undefined },
            { title: 'Mismatch',        value: mismatchCount,        color: mismatchCount > 0 ? REDWOOD.error : undefined },
            { title: 'No GL Lines',     value: noGlCount,            color: noGlCount > 0 ? REDWOOD.warning : undefined },
          ].map(s => (
            <Col span={4} key={s.title}>
              <Card size="small">
                <Statistic title={s.title} value={s.value}
                  valueStyle={{ fontSize: 14, color: s.color }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Table */}
      <Card
        size="small"
        title={
          <Space wrap>
            <span>Payments – GL Reconciliation</span>
            {(dateFrom && dateTo) && <Badge count={`${dateFrom.format('YYYY-MM-DD')} – ${dateTo.format('YYYY-MM-DD')}`} color={REDWOOD.info} />}
            {rows.length > 0 && <Tag>{rows.length} rows</Tag>}
          </Space>
        }
        extra={rows.length > 0 && (
          <Space>
            {/* Fetch All button */}
            <Button
              size="small"
              type="primary"
              icon={<SearchOutlined />}
              loading={!!fetchAllProgress}
              onClick={fetchAllGlLines}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
            >
              {fetchAllProgress
                ? `Fetching ${fetchAllProgress.done} / ${fetchAllProgress.total}…`
                : `Fetch GL Lines for All${glFetchedCount > 0 ? ` (${totalPayments - glFetchedCount} remaining)` : ''}`}
            </Button>

            {/* Match filter */}
            {glFetchedCount > 0 && (
              <Segmented
                size="small"
                value={matchFilter}
                onChange={v => setMatchFilter(v as typeof matchFilter)}
                options={[
                  { label: `All (${totalPayments})`,           value: 'ALL' },
                  { label: `Matched (${matchedCount})`,        value: 'MATCHED' },
                  { label: `Mismatch (${mismatchCount})`,      value: 'MISMATCH' },
                  { label: `No GL (${noGlCount})`,             value: 'NO_GL' },
                ]}
              />
            )}
          </Space>
        )}
      >
        <Table<PaymentRow>
          dataSource={filteredRows}
          columns={columns}
          rowKey={r => String(r.checkId)}
          loading={loading}
          size="small"
          scroll={{ x: 1600 }}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} rows` }}
          rowClassName={r => {
            const m = getMatch(r);
            if (m === 'no_gl')    return 'row-missing';
            if (m === 'mismatch') return 'row-warning';
            return '';
          }}
        />
      </Card>

      <style>{`
        .row-missing td { background-color: #fff1f0 !important; }
        .row-warning td { background-color: #fff7e6 !important; }
      `}</style>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function APGLReconcile() {
  const [form] = Form.useForm();

  // ── Shared date / BU filter (synced across all recon tabs) ───────────────────
  const [sharedDateFrom, setSharedDateFrom] = useState<Dayjs | null>(null);
  const [sharedDateTo,   setSharedDateTo]   = useState<Dayjs | null>(null);
  const [sharedBU,       setSharedBU]       = useState('');

  // ── BU / company ─────────────────────────────────────────────────────────────
  const [buObjects, setBuObjects]     = useState<BUOption[]>([]);
  const [buLoading, setBuLoading]     = useState(false);
  const [company, setCompany]         = useState('');
  const [companyLocked, setCompanyLocked] = useState(false);

  // ── Periods / calendar ────────────────────────────────────────────────────────
  const [allPeriods, setAllPeriods]       = useState<PeriodInfo[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedYear, setSelectedYear]   = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('');

  // ── Account LOV ───────────────────────────────────────────────────────────────
  const [accountOptions, setAccountOptions]   = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedAccountDesc, setSelectedAccountDesc] = useState('');

  // ── Grid state ────────────────────────────────────────────────────────────────
  const [rows, setRows]                   = useState<ReconRow[]>([]);
  const [summary, setSummary]             = useState<Summary | null>(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [filter, setFilter]               = useState<'ALL' | 'OK' | 'MISSING_SLA' | 'MISSING_GL' | 'GAP'>('ALL');
  const [lastCalledUrl, setLastCalledUrl] = useState<string>('');
  const [apiModalOpen, setApiModalOpen]   = useState(false);

  // ── BU API debug modal ────────────────────────────────────────────────────────
  const [buDebugOpen, setBuDebugOpen]       = useState(false);
  const [buRawItems, setBuRawItems]         = useState<any[]>([]);
  const [buDebugLoading, setBuDebugLoading] = useState(false);

  const openBuDebug = useCallback(async () => {
    setBuDebugOpen(true);
    if (buRawItems.length > 0) return;
    setBuDebugLoading(true);
    try {
      const res  = await fetch(`${APEX_BASE}/gl/businessunits`);
      const data = await res.json();
      setBuRawItems(data.items ?? []);
    } catch { /* silent */ } finally { setBuDebugLoading(false); }
  }, [buRawItems.length]);

  // ── Load business units on mount ──────────────────────────────────────────────
  useEffect(() => {
    setBuLoading(true);
    fetch(`${APEX_BASE}/gl/businessunits`)
      .then(r => r.json())
      .then(data => {
        const items: BUOption[] = (data.items ?? [])
          .filter((i: any) => i.business_unit_name || i.BUSINESS_UNIT_NAME)
          .map((i: any) => ({
            name: String(i.business_unit_name || i.BUSINESS_UNIT_NAME || ''),
            // try every casing / naming the APEX endpoint may use
            company: String(
              i.company      || i.COMPANY      ||
              i.company_code || i.COMPANY_CODE ||
              i.companyCode  || i.COMPANY_ID   ||
              ''
            ),
          }));
        setBuObjects(items);
      })
      .catch(() => {})
      .finally(() => setBuLoading(false));
  }, []);

  // ── Load periods via ledger (calendar webservice) on mount ────────────────────
  useEffect(() => {
    setPeriodsLoading(true);
    fetch(`${APEX_BASE}/gl/getledgername`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const ledgers: string[] = (data.items || []).map((i: any) => i.ledger_name).filter(Boolean);
        if (!ledgers.length) return;
        return fetch(`${APEX_BASE}/periodsstatus/create?ledger_name=${encodeURIComponent(ledgers[0])}`)
          .then(r => r.ok ? r.json() : null)
          .then(pd => {
            if (!pd) return;
            const items: PeriodInfo[] = (pd.items || [])
              .filter((i: any) => i.period_year && (i.period_name_id || i.period_name))
              .map((i: any) => ({
                period_name_id: String(i.period_name_id || i.period_name),
                period_year:    Number(i.period_year),
                period_number:  Number(i.period_number || 0),
              }));
            setAllPeriods(items);
            if (!items.length) return;
            const latestYear = Math.max(...items.map(p => p.period_year));
            setSelectedYear(latestYear);
            const inYear = items
              .filter(p => p.period_year === latestYear)
              .sort((a, b) => b.period_number - a.period_number);
            if (inYear.length) setSelectedPeriod(inYear[0].period_name_id);
          });
      })
      .catch(() => {})
      .finally(() => setPeriodsLoading(false));
  }, []);

  // ── Derived period lists ──────────────────────────────────────────────────────
  const years = useMemo(
    () => [...new Set(allPeriods.map(p => p.period_year))].sort((a, b) => b - a),
    [allPeriods],
  );

  const periodsForYear = useMemo(() => {
    if (!selectedYear) return [];
    return allPeriods
      .filter(p => p.period_year === selectedYear)
      .sort((a, b) => a.period_number - b.period_number);
  }, [allPeriods, selectedYear]);

  // Auto-select latest period when year changes
  useEffect(() => {
    if (periodsForYear.length) {
      setSelectedPeriod(periodsForYear[periodsForYear.length - 1].period_name_id);
    }
  }, [periodsForYear]);

  // ── Load account LOV on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setAccountsLoading(true);
    fetch(`${APEX_BASE}/glaccountslist`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setAccountOptions(
          (data.items || [])
            .map((i: any) => ({
              account:     String(i.account     || i.ACCOUNT     || ''),
              description: String(i.description || i.DESCRIPTION || ''),
            }))
            .filter((i: AccountOption) => i.account),
        );
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
  }, []);

  // ── Handle BU selection → auto-populate + lock company ───────────────────────
  // NOTE: must use Form onValuesChange, not Select onChange — Form.Item with a
  // name prop clones the child and replaces its onChange with its own handler.
  const handleFormValuesChange = useCallback((changedValues: any) => {
    if ('businessUnit' in changedValues) {
      const buName: string | undefined = changedValues.businessUnit;
      if (!buName) {
        setCompany('');
        setCompanyLocked(false);
        return;
      }
      const bu = buObjects.find(b => b.name === buName);
      if (bu?.company) {
        setCompany(bu.company);
        setCompanyLocked(true);
      } else {
        setCompany('');
        setCompanyLocked(false);
      }
    }
  }, [buObjects]);

  // ── Preview URL ───────────────────────────────────────────────────────────────
  const previewUrl = useMemo(() => {
    const values = form.getFieldsValue();
    const params = new URLSearchParams({ limit: '2000' });
    if (values.businessUnit)     params.set('businessUnit',    values.businessUnit);
    if (selectedPeriod)          params.set('period_name',     selectedPeriod);
    if (selectedAccount)         params.set('account',         selectedAccount);
    if (company)                 params.set('company',         company);
    if (values.sourceTable)      params.set('sourceTable',     values.sourceTable);
    if (values.accountingStatus) params.set('accountingStatus', values.accountingStatus);
    return `${APEX_BASE}/ap/reconciliation?${params}`;
  }, [form, selectedPeriod, selectedAccount, company]);

  // ── Search ────────────────────────────────────────────────────────────────────
  const handleSearch = async (values: any) => {
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '2000' });
      if (values.businessUnit)     params.set('businessUnit',    values.businessUnit);
      if (selectedPeriod)          params.set('period_name',     selectedPeriod);
      if (selectedAccount)         params.set('account',         selectedAccount);
      if (company)                 params.set('company',         company);
      if (values.sourceTable)      params.set('sourceTable',     values.sourceTable);
      if (values.accountingStatus) params.set('accountingStatus', values.accountingStatus);

      const url = `${APEX_BASE}/ap/reconciliation?${params}`;
      setLastCalledUrl(url);

      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.message ?? 'API error');

      const bool = (v: any) => v === true || v === 'true';
      setRows((data.items ?? []).map((r: any) => ({
        ...r,
        slaExists:       bool(r.slaExists),
        glExists:        bool(r.glExists),
        apMatchesSla:    bool(r.apMatchesSla),
        slaMatchesGl:    bool(r.slaMatchesGl),
        isFullyBalanced: bool(r.isFullyBalanced),
      })));
      setSummary(data.summary ?? null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load reconciliation data');
    } finally { setLoading(false); }
  };

  const handleReset = () => {
    form.resetFields();
    setCompany(''); setCompanyLocked(false);
    setSelectedAccount(''); setSelectedAccountDesc('');
    setRows([]); setSummary(null); setError(null); setLastCalledUrl('');
    // Re-apply latest period
    if (periodsForYear.length) setSelectedPeriod(periodsForYear[periodsForYear.length - 1].period_name_id);
  };

  // ── Filtered rows ─────────────────────────────────────────────────────────────
  const displayed = rows.filter(r => {
    if (filter === 'OK')          return r.isFullyBalanced;
    if (filter === 'MISSING_SLA') return !r.slaExists;
    if (filter === 'MISSING_GL')  return !r.glExists;
    if (filter === 'GAP')         return r.slaExists && r.glExists && !r.isFullyBalanced;
    return true;
  });

  const missingSlaCount = rows.filter(r => !r.slaExists).length;
  const missingGlCount  = rows.filter(r => !r.glExists).length;
  const gapCount        = rows.filter(r => r.slaExists && r.glExists && !r.isFullyBalanced).length;
  const okCount         = rows.filter(r => r.isFullyBalanced).length;

  const sourceLabel = (t: string) =>
    SOURCE_TABLE_OPTIONS.find(o => o.value === t)?.label ?? t;

  // ── Columns ───────────────────────────────────────────────────────────────────
  const columns: ColumnsType<ReconRow> = [
    {
      title: () => <Tooltip title="AP transaction exists"><span>AP</span></Tooltip>,
      key: 'apTick', width: 48, align: 'center', fixed: 'left',
      render: () => <StatusTick exists tooltip="Found in AP tables" />,
    },
    {
      title: () => <Tooltip title="SLA accounting entry exists"><span>SLA</span></Tooltip>,
      key: 'slaTick', width: 48, align: 'center', fixed: 'left',
      render: (_, r) => (
        <StatusTick
          exists={r.slaExists}
          tooltip={r.slaExists
            ? `SLA found — status: ${r.slaStatus ?? 'N/A'}`
            : 'No SLA accounting entry (unposted / not yet accounted)'}
        />
      ),
    },
    {
      title: () => <Tooltip title="GL journal entry exists"><span>GL</span></Tooltip>,
      key: 'glTick', width: 48, align: 'center', fixed: 'left',
      render: (_, r) => (
        <StatusTick
          exists={r.glExists}
          tooltip={r.glExists
            ? `GL found — ${r.glBatchStatus === 'P' ? 'Posted' : (r.glBatchStatus ?? 'N/A')}`
            : 'No GL journal entry'}
        />
      ),
    },
    {
      title: 'Source', key: 'sourceTable', width: 130, fixed: 'left',
      render: (_, r) => <Text style={{ fontSize: 11 }}>{sourceLabel(r.sourceTable)}</Text>,
    },
    {
      title: 'AP Transaction #', dataIndex: 'apNumber', width: 150,
      render: v => <Text code style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Supplier / Memo', dataIndex: 'apSupplier', width: 170,
      render: v => <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: v }}>{v ?? '—'}</Text>,
    },
    { title: 'AP Date',   dataIndex: 'apDate',   width: 100 },
    {
      title: 'AP Status', dataIndex: 'apStatus', width: 105,
      render: v => v ? <Tag style={{ fontSize: 10 }}>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: 'AP Amount', dataIndex: 'apAmount', width: 120, align: 'right',
      render: (v, r) => (
        <Text style={{ fontSize: 11, fontFamily: 'monospace', color: r.slaExists && !r.apMatchesSla ? REDWOOD.warning : undefined }}>
          {fmt(v)}
        </Text>
      ),
    },
    {
      title: 'SLA Status', dataIndex: 'slaStatus', width: 95,
      render: (v, r) => {
        if (!r.slaExists) return <Text type="secondary" style={{ fontSize: 10 }}>—</Text>;
        const color = v === 'POSTED' ? 'success' : v === 'FINAL' ? 'processing' : v === 'DRAFT' ? 'default' : 'error';
        return <Tag color={color} style={{ fontSize: 10 }}>{v}</Tag>;
      },
    },
    {
      title: 'SLA DR', dataIndex: 'slaEnteredDr', width: 120, align: 'right',
      render: (v, r) => r.slaExists
        ? <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmt(v)}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'SLA CR', dataIndex: 'slaEnteredCr', width: 120, align: 'right',
      render: (v, r) => r.slaExists
        ? <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmt(v)}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'AP↔SLA', key: 'apVsSla', width: 75, align: 'center',
      render: (_, r) => {
        if (!r.slaExists) return <Text type="secondary" style={{ fontSize: 10 }}>—</Text>;
        return r.apMatchesSla
          ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
          : <Tooltip title={`Amount gap: ${fmt(r.apVsSlaDiff)}`}>
              <WarningOutlined style={{ color: REDWOOD.warning }} />
            </Tooltip>;
      },
    },
    {
      title: 'GL Journal', dataIndex: 'glJournalName', width: 180,
      render: (v, r) => r.glExists
        ? <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: v }}>{v}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'GL DR Account', dataIndex: 'glDrAccount', width: 170,
      render: (v, r) => r.glExists && v
        ? <Text code style={{ fontSize: 10 }} ellipsis={{ tooltip: v }}>{v}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'GL CR Account', dataIndex: 'glCrAccount', width: 170,
      render: (v, r) => r.glExists && v
        ? <Text code style={{ fontSize: 10 }} ellipsis={{ tooltip: v }}>{v}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'GL Status', dataIndex: 'glBatchStatus', width: 90,
      render: (v, r) => r.glExists
        ? <Tag color={v === 'P' ? 'success' : 'default'} style={{ fontSize: 10 }}>
            {v === 'P' ? 'Posted' : (v ?? '?')}
          </Tag>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'GL DR', dataIndex: 'glEnteredDr', width: 120, align: 'right',
      render: (v, r) => r.glExists
        ? <Text style={{ fontSize: 11, fontFamily: 'monospace', color: !r.slaMatchesGl ? REDWOOD.warning : undefined }}>
            {fmt(v)}
          </Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'GL CR', dataIndex: 'glEnteredCr', width: 120, align: 'right',
      render: (v, r) => r.glExists
        ? <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmt(v)}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'SLA↔GL', key: 'slaVsGl', width: 75, align: 'center',
      render: (_, r) => {
        if (!r.slaExists || !r.glExists) return <Text type="secondary" style={{ fontSize: 10 }}>—</Text>;
        return r.slaMatchesGl
          ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
          : <Tooltip title={`Amount gap: ${fmt(r.slaVsGlDiff)}`}>
              <WarningOutlined style={{ color: REDWOOD.warning }} />
            </Tooltip>;
      },
    },
    {
      title: 'Period', dataIndex: 'slaPeriodName', width: 90,
      render: v => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'Currency', key: 'currency', width: 80,
      render: (_, r) => r.apCurrency ?? r.slaCurrency ?? '—',
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '16px 20px' }}>

      {/* Page heading */}
      <Space style={{ marginBottom: 16 }}>
        <SwapOutlined style={{ color: REDWOOD.primary, fontSize: 22 }} />
        <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>
          AP – GL Reconciliation
        </Title>
      </Space>

      <Tabs type="card" items={[
        {
          key: 'recon',
          label: 'AP ↔ SLA ↔ GL',
          children: (
            <div>
              {/* Search form */}
              <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}>
                <Form form={form} layout="vertical" onFinish={handleSearch} onValuesChange={handleFormValuesChange}>

                  {/* Row 1: BU, Company, Account */}
                  <Row gutter={12}>
                    <Col xs={24} sm={8}>
                      <Form.Item style={{ marginBottom: 10 }}
                        label={
                          <Space size={6}>
                            <span>Business Unit</span>
                            <Tooltip title="Inspect Business Units API response">
                              <ApiOutlined
                                style={{ fontSize: 12, color: REDWOOD.info, cursor: 'pointer' }}
                                onClick={e => { e.preventDefault(); openBuDebug(); }}
                              />
                            </Tooltip>
                          </Space>
                        }
                        name="businessUnit"
                      >
                        <Select
                          placeholder="Select business unit"
                          allowClear
                          showSearch
                          loading={buLoading}
                          optionFilterProp="label"
                          options={buObjects.map(b => ({
                            value: b.name,
                            label: b.company ? `${b.name}  (${b.company})` : b.name,
                          }))}
                          dropdownStyle={{ minWidth: 360 }}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={4}>
                      <Form.Item label={
                        <Space size={4}>
                          <span>Company</span>
                          {companyLocked && <LockOutlined style={{ fontSize: 10, color: REDWOOD.neutral600 }} />}
                        </Space>
                      } style={{ marginBottom: 10 }}>
                        <Input
                          value={company}
                          onChange={e => { if (!companyLocked) setCompany(e.target.value); }}
                          disabled={companyLocked}
                          placeholder="Auto from BU"
                          style={{
                            background: companyLocked ? REDWOOD.neutral100 : undefined,
                            color: companyLocked ? REDWOOD.info : undefined,
                            fontWeight: companyLocked ? 600 : undefined,
                            fontFamily: 'monospace',
                          }}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={12}>
                      <Form.Item label="Account" style={{ marginBottom: 10 }}>
                        <Input.Group compact style={{ display: 'flex' }}>
                          <Input
                            readOnly
                            value={selectedAccount
                              ? `${selectedAccount}${selectedAccountDesc ? '  –  ' + selectedAccountDesc : ''}`
                              : ''}
                            placeholder="Click to select account…"
                            style={{ flex: 1, cursor: 'pointer', background: selectedAccount ? '#f0f5ff' : undefined }}
                            onClick={() => setAccountPickerOpen(true)}
                          />
                          <Button
                            icon={<BookOutlined />}
                            loading={accountsLoading}
                            onClick={() => setAccountPickerOpen(true)}
                            style={{ borderLeft: 0 }}
                          >
                            LOV
                          </Button>
                          {selectedAccount && (
                            <Button onClick={() => { setSelectedAccount(''); setSelectedAccountDesc(''); }}>✕</Button>
                          )}
                        </Input.Group>
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* Row 2: Year, Period, Source, Status, buttons */}
                  <Row gutter={12} align="bottom">
                    <Col xs={12} sm={4}>
                      <Form.Item label="Year" style={{ marginBottom: 0 }}>
                        <Select
                          placeholder="Year"
                          value={selectedYear ?? undefined}
                          loading={periodsLoading}
                          onChange={v => { setSelectedYear(v); setSelectedPeriod(''); }}
                          allowClear
                          style={{ width: '100%' }}
                        >
                          {years.map(y => <Option key={y} value={y}>{y}</Option>)}
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={12} sm={5}>
                      <Form.Item label="Period" style={{ marginBottom: 0 }}>
                        <Select
                          placeholder="Select period"
                          value={selectedPeriod || undefined}
                          loading={periodsLoading}
                          onChange={setSelectedPeriod}
                          allowClear
                          showSearch
                          style={{ width: '100%' }}
                        >
                          {periodsForYear.map(p => (
                            <Option key={p.period_name_id} value={p.period_name_id}>{p.period_name_id}</Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={12} sm={5}>
                      <Form.Item name="sourceTable" label="Source" style={{ marginBottom: 0 }}>
                        <Select placeholder="All" allowClear options={SOURCE_TABLE_OPTIONS} />
                      </Form.Item>
                    </Col>

                    <Col xs={12} sm={4}>
                      <Form.Item name="accountingStatus" label="SLA Status" style={{ marginBottom: 0 }}>
                        <Select placeholder="All" allowClear options={STATUS_OPTIONS} />
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={6} style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Form.Item style={{ marginBottom: 0, width: '100%' }}>
                        <Space>
                          <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                            Search
                          </Button>
                          <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                          <Tooltip title="View API endpoints">
                            <Button icon={<ApiOutlined />} onClick={() => setApiModalOpen(true)} />
                          </Tooltip>
                        </Space>
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
              </Card>

              {error && (
                <Alert type="error" message={error} closable onClose={() => setError(null)} style={{ marginBottom: 12 }} />
              )}

              {/* Summary cards */}
              {summary && (
                <Row gutter={12} style={{ marginBottom: 16 }}>
                  {[
                    { title: 'Total AP Txns',  value: summary.totalRows,      color: undefined },
                    { title: 'AP Total',       value: fmt(summary.apTotalDr), color: undefined },
                    { title: 'SLA Total DR',   value: fmt(summary.slaTotalDr),color: undefined },
                    { title: 'GL Total DR',    value: fmt(summary.glTotalDr), color: undefined },
                    { title: 'No SLA Entry',   value: summary.noSlaCount,
                      color: summary.noSlaCount  > 0 ? REDWOOD.error   : REDWOOD.success },
                    { title: 'No GL Entry',    value: summary.noGlCount,
                      color: summary.noGlCount   > 0 ? REDWOOD.error   : REDWOOD.success },
                    { title: 'AP↔SLA Gap',    value: fmt(summary.apVsSlaDiff),
                      color: summary.apVsSlaDiff > 0.01 ? REDWOOD.warning : REDWOOD.success },
                    { title: 'SLA↔GL Gap',    value: fmt(summary.slaVsGlDiff),
                      color: summary.slaVsGlDiff > 0.01 ? REDWOOD.warning : REDWOOD.success },
                  ].map(s => (
                    <Col span={3} key={s.title}>
                      <Card size="small">
                        <Statistic
                          title={s.title}
                          value={s.value}
                          valueStyle={s.color ? { color: s.color, fontSize: 15 } : { fontSize: 15 }}
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}

              {/* Table */}
              <Card
                size="small"
                title={
                  <Space>
                    <span>AP ↔ SLA ↔ GL Reconciliation</span>
                    {selectedPeriod && <Badge count={selectedPeriod} color={REDWOOD.info} />}
                    {rows.length > 0 && <Tag>{rows.length} rows</Tag>}
                  </Space>
                }
                extra={
                  rows.length > 0 && (
                    <Segmented
                      value={filter}
                      onChange={v => setFilter(v as any)}
                      options={[
                        { label: `All (${rows.length})`,            value: 'ALL' },
                        { label: `OK (${okCount})`,                 value: 'OK' },
                        { label: `No SLA (${missingSlaCount})`,     value: 'MISSING_SLA' },
                        { label: `No GL (${missingGlCount})`,       value: 'MISSING_GL' },
                        { label: `Amount Gap (${gapCount})`,        value: 'GAP' },
                      ]}
                    />
                  )
                }
              >
                <Table<ReconRow>
                  dataSource={displayed}
                  columns={columns}
                  rowKey={r => `${r.sourceTable}_${r.sourceId}`}
                  loading={loading}
                  size="small"
                  scroll={{ x: 2400 }}
                  pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} rows` }}
                  rowClassName={r =>
                    !r.slaExists || !r.glExists ? 'row-missing'
                    : !r.isFullyBalanced ? 'row-warning'
                    : ''
                  }
                />
              </Card>

              {/* API Modal */}
              <Modal
                title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> API Endpoints</Space>}
                open={apiModalOpen}
                onCancel={() => setApiModalOpen(false)}
                footer={null}
                width={820}
              >
                {[
                  { label: 'Business Units',       url: `${APEX_BASE}/gl/businessunits` },
                  { label: 'Ledger Names',          url: `${APEX_BASE}/gl/getledgername` },
                  { label: 'Periods (calendar)',    url: `${APEX_BASE}/periodsstatus/create?ledger_name=<ledger>` },
                  { label: 'Account LOV',           url: `${APEX_BASE}/glaccountslist` },
                ].map(({ label, url }) => (
                  <div key={label} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 5, fontWeight: 600 }}>{label}</div>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input value={url} readOnly style={{ fontFamily: 'monospace', fontSize: 11 }} />
                      <Tooltip title="Copy">
                        <Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(url)} />
                      </Tooltip>
                      <Button type="primary" style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                        onClick={() => window.open(url, '_blank')}>
                        Test
                      </Button>
                    </Space.Compact>
                  </div>
                ))}

                <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 5, fontWeight: 600 }}>
                    AP Reconciliation (last called / current form)
                  </div>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      value={lastCalledUrl || previewUrl}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                    />
                    <Tooltip title="Copy">
                      <Button icon={<CopyOutlined />}
                        onClick={() => navigator.clipboard.writeText(lastCalledUrl || previewUrl)} />
                    </Tooltip>
                    <Button type="primary" style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                      onClick={() => window.open(lastCalledUrl || previewUrl, '_blank')}>
                      Test
                    </Button>
                  </Space.Compact>
                  {!lastCalledUrl && (
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 4 }}>
                      Preview — click Search to see the actual called URL
                    </div>
                  )}
                  {(lastCalledUrl || previewUrl).includes('?') && (
                    <div style={{ marginTop: 8, paddingLeft: 4 }}>
                      {(lastCalledUrl || previewUrl).split('?')[1].split('&').map((part, i) => {
                        const [k, v] = part.split('=');
                        return (
                          <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
                            <Text code style={{ fontSize: 11 }}>{decodeURIComponent(k)}</Text>
                            {' = '}
                            <Text style={{ fontSize: 11, color: REDWOOD.info }}>{decodeURIComponent(v || '')}</Text>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Modal>

              {/* Account Picker Modal */}
              <AccountPicker
                open={accountPickerOpen}
                onClose={() => setAccountPickerOpen(false)}
                onSelect={(acct, desc) => { setSelectedAccount(acct); setSelectedAccountDesc(desc); }}
                options={accountOptions}
                loading={accountsLoading}
              />

              {/* BU API Debug Modal */}
              <Modal
                open={buDebugOpen}
                onCancel={() => setBuDebugOpen(false)}
                title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />Business Units — Raw API Response</Space>}
                footer={<Button onClick={() => setBuDebugOpen(false)}>Close</Button>}
                width={820}
              >
                <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 8 }}>
                  <Text code style={{ fontSize: 11 }}>{APEX_BASE}/gl/businessunits</Text>
                  {' — '}showing all fields returned per item so you can confirm the company field name.
                </div>
                {buDebugLoading && <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>}
                {!buDebugLoading && buRawItems.length === 0 && (
                  <Alert type="warning" message="No items returned or API error" />
                )}
                {!buDebugLoading && buRawItems.length > 0 && (
                  <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                    {buRawItems.slice(0, 20).map((item, idx) => (
                      <div key={idx} style={{ marginBottom: 10, padding: '8px 12px',
                        background: idx % 2 === 0 ? '#fafafa' : '#fff',
                        border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6 }}>
                        {Object.entries(item).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 2, fontSize: 11 }}>
                            <Text code style={{ fontSize: 10, minWidth: 180, color: REDWOOD.info }}>{k}</Text>
                            <Text style={{ fontSize: 11 }}>{String(v ?? '—')}</Text>
                          </div>
                        ))}
                      </div>
                    ))}
                    {buRawItems.length > 20 && (
                      <Text type="secondary" style={{ fontSize: 11 }}>…and {buRawItems.length - 20} more items</Text>
                    )}
                  </div>
                )}
              </Modal>

              <style>{`
                .row-missing td { background-color: #fff1f0 !important; }
                .row-warning td { background-color: #fff7e6 !important; }
              `}</style>
            </div>
          ),
        },
        {
          key: 'payments_gl',
          label: 'Payments – GL',
          children: (
            <PaymentsGLRecon buObjects={buObjects} buLoading={buLoading}
              sharedDateFrom={sharedDateFrom} sharedDateTo={sharedDateTo} sharedBU={sharedBU}
              onSharedChange={(df, dt, bu) => { setSharedDateFrom(df); setSharedDateTo(dt); setSharedBU(bu); }} />
          ),
        },
        {
          key: 'invoices_gl',
          label: 'Invoices – GL',
          children: (
            <SourceGLRecon config={INVOICES_CONFIG} buObjects={buObjects} buLoading={buLoading}
              sharedDateFrom={sharedDateFrom} sharedDateTo={sharedDateTo} sharedBU={sharedBU}
              onSharedChange={(df, dt, bu) => { setSharedDateFrom(df); setSharedDateTo(dt); setSharedBU(bu); }} />
          ),
        },
        {
          key: 'external_gl',
          label: 'External Txns – GL',
          children: (
            <SourceGLRecon config={EXTERNAL_TXN_CONFIG} buObjects={buObjects} buLoading={buLoading}
              sharedDateFrom={sharedDateFrom} sharedDateTo={sharedDateTo} sharedBU={sharedBU}
              onSharedChange={(df, dt, bu) => { setSharedDateFrom(df); setSharedDateTo(dt); setSharedBU(bu); }} />
          ),
        },
        {
          key: 'banktransfer_gl',
          label: 'Bank Transfers – GL',
          children: (
            <SourceGLRecon config={BANK_TRANSFER_CONFIG} buObjects={buObjects} buLoading={buLoading}
              sharedDateFrom={sharedDateFrom} sharedDateTo={sharedDateTo} sharedBU={sharedBU}
              onSharedChange={(df, dt, bu) => { setSharedDateFrom(df); setSharedDateTo(dt); setSharedBU(bu); }} />
          ),
        },
      ]} />

    </div>
  );
}
