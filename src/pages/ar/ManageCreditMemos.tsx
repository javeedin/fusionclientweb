import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Layout, Card, Form, Select, Input, Button, Space, Typography, Table, Tag,
  Row, Col, Breadcrumb, Tooltip, DatePicker, message, Tabs, Divider,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, CloseOutlined,
  FileTextOutlined, FilterOutlined, ReloadOutlined,
  DownloadOutlined, LockOutlined, EyeOutlined, ApiOutlined,
  UserOutlined, SettingOutlined, ApartmentOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
  textPrimary:'#1A1A1A',
};

const APEX_CM = `${APEX_DB_CONFIG.baseUrl}/ar/credit-memos`;

// ── Types ────────────────────────────────────────────────────────────────────

interface CMRow {
  key:                   string;
  customerTransactionId: number;
  transactionNumber:     string;
  documentNumber:        string | number;
  crossReference:        string;
  customerReference:     string;
  transactionDate:       string;
  accountingDate:        string;
  creditMemoStatus:      string;
  creditMemoCurrency:    string;
  transactionType:       string;
  transactionSource:     string;
  enteredAmount:         number;
  transactionBalanceDue: number;
  creditReason:          string;
  billToCustomerNumber:  string;
  billToCustomerName:    string;
  businessUnit:          string;
  legalEntityIdentifier: string;
  purchaseOrder:         string;
  syncStatus:            string;
  syncDate:              string;
}

interface CMLine {
  key:                        string;
  lineNumber:                 number;
  itemNumber:                 string;
  lineDescription:            string;
  unitOfMeasure:              string;
  warehouse:                  string;
  lineQuantityCredit:         number | null;
  unitSellingPrice:           number | null;
  lineAmountCredit:           number | null;
  assessableValue:            number | null;
  lineCreditReason:           string;
  taxClassificationCode:      string;
  transactionBusinessCategory: string;
  productType:                string;
  salesOrderNumber:           string;
  syncStatus:                 string;
}

interface CMDistribution {
  key:                  string;
  distributionId:       number;
  creditMemoLineNumber: number | null;
  accountClass:         string;
  accountCombination:   string;
  amount:               number | null;
  accountedAmount:      number | null;
  percent:              number | null;
  comments:             string;
  syncStatus:           string;
}

interface CMTab {
  key:   string;
  row:   CMRow;
  lines: CMLine[];
}

interface ChildState<T> {
  loading: boolean;
  rows:    T[];
  fetched: boolean;
  url:     string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusColor(s: string) {
  const m: Record<string, string> = { Complete: 'green', Incomplete: 'orange' };
  return m[s] || 'default';
}

function syncStatusColor(s: string) {
  const m: Record<string, string> = { SYNCED: 'blue', NEW: 'green', ERROR: 'red', UPDATE: 'orange' };
  return m[(s || '').toUpperCase()] || 'default';
}

function apiBar(url: string, onCopy: () => void) {
  return (
    <div
      title="Click to copy URL"
      onClick={onCopy}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#0d1117', border: '1px solid #30363d',
        borderRadius: 4, padding: '4px 10px', marginBottom: 8, cursor: 'copy',
      }}
    >
      <ApiOutlined style={{ color: '#58a6ff', fontSize: 13, flexShrink: 0 }} />
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#58a6ff', flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const ManageCreditMemos: React.FC = () => {
  const [searchForm] = Form.useForm();

  const [businessUnits, setBusinessUnits] = useState<string[]>([]);
  const [searchRows, setSearchRows]       = useState<CMRow[]>([]);
  const [searching, setSearching]         = useState(false);
  const [tabs, setTabs]                   = useState<CMTab[]>([]);
  const [activeKey, setActiveKey]         = useState<string>('search');
  const [gridFilter, setGridFilter]       = useState('');

  // Per-tab distribution state
  const [distMap, setDistMap]           = useState<Record<string, ChildState<CMDistribution>>>({});
  const [showDistApi, setShowDistApi]   = useState<Record<string, boolean>>({});
  const [showLinesApi, setShowLinesApi] = useState<Record<string, boolean>>({});
  const fetchedDistRef = useRef<Set<string>>(new Set());

  // Load business units
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        setBusinessUnits(
          ((d.items || []) as any[]).map((i: any) => i.business_unit_name || '').filter(Boolean).sort()
        );
      })
      .catch(() => {});
  }, []);

  // ── Fetch distributions (lazy) ────────────────────────────────────────────
  const fetchDist = useCallback(async (tabKey: string, id: number) => {
    if (!id || fetchedDistRef.current.has(tabKey)) return;
    fetchedDistRef.current.add(tabKey);
    const url = `${APEX_CM}/${id}/distributions`;
    setDistMap(prev => ({ ...prev, [tabKey]: { loading: true, rows: [], fetched: false, url } }));
    try {
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const rows: CMDistribution[] = ((data.items || []) as any[]).map((d: any, i: number) => ({
        key:                  String(d.distribution_id ?? i),
        distributionId:       d.distribution_id        ?? 0,
        creditMemoLineNumber: d.credit_memo_line_number ?? null,
        accountClass:         d.account_class           ?? '',
        accountCombination:   d.account_combination     ?? '',
        amount:               d.amount                  ?? null,
        accountedAmount:      d.accounted_amount        ?? null,
        percent:              d.percent                 ?? null,
        comments:             d.comments                ?? '',
        syncStatus:           d.sync_status             ?? '',
      }));
      setDistMap(prev => ({ ...prev, [tabKey]: { loading: false, rows, fetched: true, url } }));
    } catch {
      setDistMap(prev => ({ ...prev, [tabKey]: { ...prev[tabKey], loading: false, fetched: true } }));
    }
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    const v = searchForm.getFieldsValue();
    setSearching(true);
    try {
      const p = new URLSearchParams();
      if (v.businessUnit)      p.set('business_unit',      v.businessUnit);
      if (v.transactionNumber) p.set('transaction_number', v.transactionNumber.trim());
      if (v.transactionSource) p.set('transaction_source', v.transactionSource.trim());
      if (v.billToCustomer)    p.set('bill_to_customer',   v.billToCustomer.trim());
      if (v.crossReference)    p.set('cross_reference',    v.crossReference.trim());
      if (v.creditMemoStatus)  p.set('credit_memo_status', v.creditMemoStatus);
      if (v.dateRange?.[0])    p.set('date_from', v.dateRange[0].format('YYYY-MM-DD'));
      if (v.dateRange?.[1])    p.set('date_to',   v.dateRange[1].format('YYYY-MM-DD'));
      p.set('limit', '500');

      const res  = await fetch(`${APEX_CM}?${p}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();

      const rows: CMRow[] = ((data.items || []) as any[]).map((r: any, i: number) => ({
        key:                   String(r.customer_transaction_id ?? i),
        customerTransactionId: Number(r.customer_transaction_id  ?? 0),
        transactionNumber:     String(r.transaction_number       ?? ''),
        documentNumber:        r.document_number != null ? String(r.document_number) : '',
        crossReference:        String(r.cross_reference          ?? ''),
        customerReference:     String(r.customer_reference       ?? ''),
        transactionDate:       String(r.transaction_date  || '').slice(0, 10),
        accountingDate:        String(r.accounting_date   || '').slice(0, 10),
        creditMemoStatus:      String(r.credit_memo_status       ?? ''),
        creditMemoCurrency:    String(r.credit_memo_currency     ?? ''),
        transactionType:       String(r.transaction_type         ?? ''),
        transactionSource:     String(r.transaction_source       ?? ''),
        enteredAmount:         Number(r.entered_amount           ?? 0),
        transactionBalanceDue: Number(r.transaction_balance_due  ?? 0),
        creditReason:          String(r.credit_reason            ?? ''),
        billToCustomerNumber:  String(r.bill_to_customer_number  ?? ''),
        billToCustomerName:    String(r.bill_to_customer_name    ?? ''),
        businessUnit:          String(r.business_unit            ?? ''),
        legalEntityIdentifier: String(r.legal_entity_identifier  ?? ''),
        purchaseOrder:         String(r.purchase_order           ?? ''),
        syncStatus:            String(r.sync_status              ?? ''),
        syncDate:              String(r.sync_date || '').slice(0, 10),
      }));

      setSearchRows(rows);
      if (rows.length === 0) message.info('No credit memos found');
      else message.success(`${rows.length} credit memo${rows.length !== 1 ? 's' : ''} found${data.hasMore ? ' (first 500 shown)' : ''}`);
    } catch (e: any) {
      message.error(`Search failed: ${e.message}`);
    } finally {
      setSearching(false);
    }
  };

  // ── Open tab (fetch lines immediately) ───────────────────────────────────
  const openTab = useCallback(async (row: CMRow) => {
    const key = `cm-${row.customerTransactionId}`;
    if (tabs.find(t => t.key === key)) { setActiveKey(key); return; }

    let lines: CMLine[] = [];
    try {
      const res  = await fetch(`${APEX_CM}/${row.customerTransactionId}/lines`,
        { headers: { Accept: 'application/json' } });
      const data = await res.json();
      lines = ((data.items || []) as any[]).map((l: any, i: number) => ({
        key:                         String(l.customer_transaction_line_id ?? i),
        lineNumber:                  l.line_number             ?? i + 1,
        itemNumber:                  l.item_number             ?? '',
        lineDescription:             l.line_description        ?? '',
        unitOfMeasure:               l.unit_of_measure         ?? '',
        warehouse:                   l.warehouse               ?? '',
        lineQuantityCredit:          l.line_quantity_credit    ?? null,
        unitSellingPrice:            l.unit_selling_price      ?? null,
        lineAmountCredit:            l.line_amount_credit      ?? null,
        assessableValue:             l.assessable_value        ?? null,
        lineCreditReason:            l.line_credit_reason      ?? '',
        taxClassificationCode:       l.tax_classification_code ?? '',
        transactionBusinessCategory: l.transaction_business_category ?? '',
        productType:                 l.product_type            ?? '',
        salesOrderNumber:            l.sales_order_number      ?? '',
        syncStatus:                  l.sync_status             ?? '',
      }));
    } catch { /* use empty */ }

    setTabs(prev => [...prev, { key, row, lines }]);
    setActiveKey(key);
  }, [tabs]);

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = (key: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.key !== key);
      if (activeKey === key) setActiveKey(next.length > 0 ? next[next.length - 1].key : 'search');
      return next;
    });
    fetchedDistRef.current.delete(key);
    setDistMap(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportToExcel = (rows: CMRow[]) => {
    const headers = [
      'Transaction #', 'Document #', 'Cross Reference', 'Customer Reference',
      'Customer #', 'Customer Name',
      'Txn Date', 'Accounting Date',
      'Status', 'CCY', 'Type', 'Source',
      'Entered Amount', 'Balance Due', 'Credit Reason',
      'Business Unit', 'Sync Status', 'Sync Date',
    ];
    const data = rows.map(r => [
      r.transactionNumber, r.documentNumber, r.crossReference, r.customerReference,
      r.billToCustomerNumber, r.billToCustomerName,
      r.transactionDate, r.accountingDate,
      r.creditMemoStatus, r.creditMemoCurrency, r.transactionType, r.transactionSource,
      r.enteredAmount, r.transactionBalanceDue, r.creditReason,
      r.businessUnit, r.syncStatus, r.syncDate,
    ]);
    const totalAmt = rows.reduce((s, r) => s + (r.enteredAmount ?? 0), 0);
    const totals   = [`Total (${rows.length})`, '', '', '', '', '', '', '', '', '', '', '', totalAmt, '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, totals]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 36 },
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 8  }, { wch: 14 }, { wch: 12 },
      { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 32 }, { wch: 10 }, { wch: 12 },
    ];
    for (let row = 2; row <= rows.length + 2; row++) {
      for (const col of ['M', 'N']) {
        const cell = ws[`${col}${row}`];
        if (cell && typeof cell.v === 'number') { cell.t = 'n'; cell.z = '#,##0.00'; }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AR Credit Memos');
    XLSX.writeFile(wb, `AR_CreditMemos_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
  };

  // ── Filter rows ───────────────────────────────────────────────────────────
  const filteredRows = gridFilter.trim()
    ? searchRows.filter(r => {
        const q = gridFilter.trim().toUpperCase();
        return (
          r.transactionNumber.toUpperCase().includes(q)   ||
          r.billToCustomerName.toUpperCase().includes(q)  ||
          r.billToCustomerNumber.toUpperCase().includes(q)||
          r.crossReference.toUpperCase().includes(q)      ||
          r.creditMemoStatus.toUpperCase().includes(q)    ||
          r.businessUnit.toUpperCase().includes(q)        ||
          r.creditReason.toUpperCase().includes(q)
        );
      })
    : searchRows;

  const totalAmount  = filteredRows.reduce((s, r) => s + (r.enteredAmount        ?? 0), 0);
  const totalBalance = filteredRows.reduce((s, r) => s + (r.transactionBalanceDue ?? 0), 0);

  // ── Search columns ────────────────────────────────────────────────────────
  const searchColumns: ColumnsType<CMRow> = [
    { title: '#', key: 'seq', width: 42, fixed: 'left',
      render: (_,__,i) => <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text> },
    { title: 'Transaction #', dataIndex: 'transactionNumber', width: 130, fixed: 'left',
      render: (v, r) => (
        <Button type="link" style={{ padding: 0, fontSize: 12, fontWeight: 600 }}
          onClick={() => openTab(r)}>{v || '—'}</Button>
      ) },
    { title: 'Customer', dataIndex: 'billToCustomerName', width: 220, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Cust #', dataIndex: 'billToCustomerNumber', width: 90, ellipsis: true,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: 'Cross Ref', dataIndex: 'crossReference', width: 110, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Txn Date', dataIndex: 'transactionDate', width: 100,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'CCY', dataIndex: 'creditMemoCurrency', width: 60,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Amount', dataIndex: 'enteredAmount', width: 120, align: 'right',
      render: v => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
          color: (v ?? 0) < 0 ? REDWOOD.primary : 'inherit' }}>{fmt(v)}</Text>
      ) },
    { title: 'Balance Due', dataIndex: 'transactionBalanceDue', width: 110, align: 'right',
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{fmt(v)}</Text> },
    { title: 'Credit Reason', dataIndex: 'creditReason', width: 130, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Source', dataIndex: 'transactionSource', width: 90, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Status', dataIndex: 'creditMemoStatus', width: 100,
      render: v => <Tag color={statusColor(v)} style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    { title: 'Sync', dataIndex: 'syncStatus', width: 70,
      render: v => v ? <Tag color={syncStatusColor(v)} style={{ fontSize: 11 }}>{v}</Tag>
                     : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    { title: 'Business Unit', dataIndex: 'businessUnit', width: 200, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: '', key: 'open', width: 46, fixed: 'right',
      render: (_, r) => (
        <Tooltip title="Open credit memo">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openTab(r)} />
        </Tooltip>
      ) },
  ];

  // ── renderCMPanel — matches invoice edit page layout ───────────────────────
  const renderCMPanel = (tab: CMTab) => {
    const { key: tabKey, row, lines } = tab;
    const distState = distMap[tabKey];

    const linesTotal = lines.reduce((s, l) => s + (l.lineAmountCredit ?? 0), 0);
    const distTotal  = (distState?.rows ?? []).reduce((s, d) => s + (d.amount ?? 0), 0);

    // Read-only field helper
    const ro = (value: React.ReactNode, mono = false) => (
      <Input
        size="small"
        style={{ fontSize: 12, fontFamily: mono ? 'monospace' : undefined, background: '#fafafa' }}
        value={value as string ?? ''}
        readOnly
      />
    );

    const field = (label: string, node: React.ReactNode, required = false) => (
      <Row gutter={4} align="middle" style={{ marginBottom: 5 }}>
        <Col span={8} style={{ textAlign: 'right', paddingRight: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {required && <span style={{ color: REDWOOD.primary, marginRight: 2 }}>*</span>}{label}
          </Text>
        </Col>
        <Col span={16}>{node}</Col>
      </Row>
    );

    // Lines table columns
    const lineColumns: ColumnsType<CMLine> = [
      { title: 'Line', dataIndex: 'lineNumber', width: 50,
        render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
      { title: 'Item', dataIndex: 'itemNumber', width: 110, ellipsis: true,
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
      { title: 'Description', dataIndex: 'lineDescription', width: 200, ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'UOM', dataIndex: 'unitOfMeasure', width: 80, ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'Qty', dataIndex: 'lineQuantityCredit', width: 80, align: 'right',
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v ?? '—'}</Text> },
      { title: 'Unit Price', dataIndex: 'unitSellingPrice', width: 110, align: 'right',
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v != null ? fmt(v) : '—'}</Text> },
      { title: 'Amount', dataIndex: 'lineAmountCredit', width: 120, align: 'right',
        render: v => (
          <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
            color: (v ?? 0) < 0 ? REDWOOD.primary : 'inherit' }}>
            {v != null ? fmt(v) : '—'}
          </Text>
        ) },
      { title: 'Assessable Value', dataIndex: 'assessableValue', width: 130, align: 'right',
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v != null ? fmt(v) : '—'}</Text> },
      { title: 'Credit Reason', dataIndex: 'lineCreditReason', width: 130, ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'Tax Code', dataIndex: 'taxClassificationCode', width: 150, ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'Warehouse', dataIndex: 'warehouse', width: 160, ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
      { title: 'SO #', dataIndex: 'salesOrderNumber', width: 110, ellipsis: true,
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    ];

    // Distributions table columns
    const distColumns: ColumnsType<CMDistribution> = [
      { title: '#', key: 'seq', width: 42,
        render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text> },
      { title: 'Distribution ID', dataIndex: 'distributionId', width: 120,
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
      { title: 'CM Line #', dataIndex: 'creditMemoLineNumber', width: 90,
        render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
      { title: 'Account Class', dataIndex: 'accountClass', width: 120,
        render: v => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag>
                       : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
      { title: 'Account Combination', dataIndex: 'accountCombination', width: 200, ellipsis: true,
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
      { title: 'Amount', dataIndex: 'amount', width: 120, align: 'right',
        render: v => (
          <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
            color: (v ?? 0) < 0 ? REDWOOD.primary : 'inherit' }}>
            {v != null ? fmt(v) : '—'}
          </Text>
        ) },
      { title: 'Accounted Amount', dataIndex: 'accountedAmount', width: 140, align: 'right',
        render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v != null ? fmt(v) : '—'}</Text> },
      { title: 'Percent', dataIndex: 'percent', width: 90, align: 'right',
        render: v => <Text style={{ fontSize: 12 }}>{v != null ? `${v}%` : '—'}</Text> },
      { title: 'Comments', dataIndex: 'comments', ellipsis: true,
        render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    ];

    return (
      <div style={{ background: REDWOOD.neutral100, minHeight: '100%' }}>

        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div style={{
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.border}`,
          padding: '8px 16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space align="center" size={8}>
              <Text strong style={{ fontSize: 18, color: REDWOOD.primary, letterSpacing: 0.3 }}>
                {row.transactionNumber || `CM #${row.customerTransactionId}`}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>ID: {row.customerTransactionId}</Text>
              <Tag icon={<LockOutlined />} color="warning" style={{ fontSize: 11 }}>Read Only</Tag>
              {row.creditMemoStatus && (
                <Tag color={statusColor(row.creditMemoStatus)} style={{ fontSize: 11 }}>
                  {row.creditMemoStatus}
                </Tag>
              )}
              {row.syncStatus && (
                <Tag color={syncStatusColor(row.syncStatus)} style={{ fontSize: 11 }}>
                  {row.syncStatus}
                </Tag>
              )}
              <Tag
                color={(row.transactionBalanceDue ?? 0) !== 0 ? 'orange' : 'green'}
                style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, padding: '2px 10px' }}
              >
                {fmt(row.transactionBalanceDue)}
              </Tag>
            </Space>
            <Space size="small">
              <Button size="small" icon={<CloseOutlined />} onClick={() => closeTab(tabKey)}>
                Close
              </Button>
            </Space>
          </div>
        </div>

        <div style={{ padding: '12px 16px' }}>

          {/* ── General Information ──────────────────────────────────────── */}
          <Card size="small" style={{ marginBottom: 10, borderRadius: 8 }}
            title={<Text strong style={{ fontSize: 13 }}>General Information</Text>}>
            <Row gutter={24}>

              {/* Left column */}
              <Col span={8}>
                {field('Transaction Type',   ro(row.transactionType))}
                {field('Transaction Source', ro(row.transactionSource))}
                {field('Transaction Number', ro(row.transactionNumber), true)}
                {field('Cross Reference',    ro(row.crossReference))}
                {field('Customer Reference', ro(row.customerReference))}
                {field('Document Number',    ro(String(row.documentNumber || '')))}
                {field('Credit Reason',      ro(row.creditReason))}
              </Col>

              {/* Middle column */}
              <Col span={8}>
                {field('Transaction Date',  ro(row.transactionDate), true)}
                {field('Accounting Date',   ro(row.accountingDate),  true)}
                {field('Currency',          ro(row.creditMemoCurrency), true)}
                {field('Status',
                  <Tag color={statusColor(row.creditMemoStatus)} style={{ fontSize: 12 }}>
                    {row.creditMemoStatus || '—'}
                  </Tag>
                )}
              </Col>

              {/* Right: totals */}
              <Col span={8}>
                <Card size="small" style={{ background: REDWOOD.neutral100, borderRadius: 6 }}>
                  {[
                    ['Entered Amount', fmt(row.enteredAmount),         true ],
                    ['Balance Due',    fmt(row.transactionBalanceDue), false],
                    ['Lines Total',    fmt(linesTotal),                false],
                  ].map(([label, val, bold]) => (
                    <div key={label as string} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12, minWidth: 120 }}>{label as string}</Text>
                      <Text style={{
                        fontSize: 12, fontFamily: 'monospace', marginLeft: 8,
                        fontWeight: bold ? 700 : 400,
                        color: (bold && (row.enteredAmount ?? 0) < 0) ? REDWOOD.primary : REDWOOD.textPrimary,
                      }}>{val as string}</Text>
                    </div>
                  ))}
                </Card>
              </Col>
            </Row>
          </Card>

          {/* ── Sub-tabs: Customer | Miscellaneous | Distributions ────────── */}
          <Card size="small" style={{ marginBottom: 10, borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
            <Tabs
              size="small"
              style={{ padding: '0 12px' }}
              onChange={(k) => {
                if (k === 'distributions') fetchDist(tabKey, row.customerTransactionId);
              }}
              items={[
                // ── Customer ─────────────────────────────────────────────
                {
                  key: 'customer',
                  label: <span><UserOutlined style={{ marginRight: 4 }} />Customer</span>,
                  children: (
                    <div style={{ padding: '8px 4px 12px' }}>
                      <Row gutter={32}>
                        <Col span={8}>
                          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Bill-to</Text>
                          {field('Customer Name',   ro(row.billToCustomerName),   true)}
                          {field('Customer Number', ro(row.billToCustomerNumber, true), true)}
                        </Col>
                        <Col span={8}>
                          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Purchase Order</Text>
                          {field('PO Number', ro(row.purchaseOrder || '—'))}
                        </Col>
                      </Row>
                    </div>
                  ),
                },

                // ── Miscellaneous ─────────────────────────────────────────
                {
                  key: 'misc',
                  label: <span><SettingOutlined style={{ marginRight: 4 }} />Miscellaneous</span>,
                  children: (
                    <div style={{ padding: '8px 4px 12px' }}>
                      <Row gutter={32}>
                        <Col span={8}>
                          {field('Business Unit',           ro(row.businessUnit))}
                          {field('Legal Entity Identifier', ro(row.legalEntityIdentifier))}
                        </Col>
                        <Col span={8}>
                          {field('Sync Status',
                            row.syncStatus
                              ? <Tag color={syncStatusColor(row.syncStatus)}>{row.syncStatus}</Tag>
                              : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                          )}
                          {field('Sync Date', ro(row.syncDate || '—'))}
                        </Col>
                        <Col span={8}>
                          {field('Customer Txn ID',
                            <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
                              {row.customerTransactionId}
                            </Text>
                          )}
                        </Col>
                      </Row>
                    </div>
                  ),
                },

                // ── Distributions ─────────────────────────────────────────
                {
                  key: 'distributions',
                  label: (
                    <span>
                      <ApartmentOutlined style={{ marginRight: 4 }} />
                      Distributions
                      {(distState?.rows.length ?? 0) > 0 && (
                        <span style={{
                          marginLeft: 5, background: REDWOOD.warning, color: '#fff',
                          borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 600,
                        }}>{distState!.rows.length}</span>
                      )}
                    </span>
                  ),
                  children: (
                    <div style={{ padding: '8px 4px 12px' }}>
                      <Space style={{ marginBottom: 8 }}>
                        <Tooltip title="Show API URL">
                          <Button size="small" icon={<ApiOutlined />}
                            type={showDistApi[tabKey] ? 'primary' : 'default'}
                            onClick={() => setShowDistApi(p => ({ ...p, [tabKey]: !p[tabKey] }))}
                          />
                        </Tooltip>
                        <Tooltip title="Refresh">
                          <Button size="small" icon={<ReloadOutlined />}
                            onClick={() => {
                              fetchedDistRef.current.delete(tabKey);
                              fetchDist(tabKey, row.customerTransactionId);
                            }}
                          />
                        </Tooltip>
                      </Space>
                      {showDistApi[tabKey] && distState?.url &&
                        apiBar(distState.url, () =>
                          navigator.clipboard?.writeText(distState.url).catch(() => {})
                        )
                      }
                      <Table<CMDistribution>
                        dataSource={distState?.rows ?? []}
                        columns={distColumns}
                        rowKey="key"
                        size="small"
                        loading={distState?.loading ?? false}
                        pagination={false}
                        scroll={{ x: 1100 }}
                        summary={rows => {
                          const total = rows.reduce((s, d) => s + (d.amount ?? 0), 0);
                          return rows.length > 0 ? (
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={5}>
                                <Text strong style={{ fontSize: 12 }}>Total</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={5} align="right">
                                <Text strong style={{
                                  fontSize: 12, fontFamily: 'monospace',
                                  color: distTotal < 0 ? REDWOOD.primary : 'inherit',
                                }}>{fmt(distTotal)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={6} colSpan={3} />
                            </Table.Summary.Row>
                          ) : null;
                        }}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          {/* ── Credit Memo Lines ─────────────────────────────────────────── */}
          <Card size="small" style={{ borderRadius: 8 }}
            title={
              <Space align="center" size={8}>
                <UnorderedListOutlined style={{ color: REDWOOD.info }} />
                <Text strong style={{ fontSize: 13 }}>Credit Memo Lines</Text>
                {lines.length > 0 && (
                  <span style={{
                    background: REDWOOD.info, color: '#fff',
                    borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 600,
                  }}>{lines.length}</span>
                )}
              </Space>
            }
            extra={
              <Space>
                <Tooltip title="Show API URL">
                  <Button size="small" icon={<ApiOutlined />}
                    type={showLinesApi[tabKey] ? 'primary' : 'default'}
                    onClick={() => setShowLinesApi(p => ({ ...p, [tabKey]: !p[tabKey] }))}
                  />
                </Tooltip>
              </Space>
            }
          >
            {showLinesApi[tabKey] && apiBar(
              `${APEX_CM}/${row.customerTransactionId}/lines`,
              () => navigator.clipboard?.writeText(`${APEX_CM}/${row.customerTransactionId}/lines`).catch(() => {})
            )}
            <Table<CMLine>
              dataSource={lines}
              columns={lineColumns}
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: 1200 }}
            />
            <Row justify="end" style={{ marginTop: 8, paddingRight: 50 }}>
              <Space direction="vertical" align="end" size={2}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Lines Total:{' '}
                  <Text strong style={{
                    fontFamily: 'monospace',
                    color: linesTotal < 0 ? REDWOOD.primary : REDWOOD.success,
                  }}>
                    {fmt(linesTotal)}
                  </Text>
                </Text>
              </Space>
            </Row>
          </Card>
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const tabItems = [
    {
      key: 'search',
      label: <span><SearchOutlined style={{ marginRight: 4 }} />Search</span>,
      children: (
        <div>
          {/* Search form */}
          <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
            <Form form={searchForm} layout="vertical" onFinish={handleSearch}>
              <Row gutter={[12, 0]}>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Business Unit" name="businessUnit">
                    <Select allowClear showSearch placeholder="All Business Units"
                      optionFilterProp="children" style={{ width: '100%' }}>
                      {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Status" name="creditMemoStatus">
                    <Select allowClear placeholder="All Statuses">
                      <Option value="Complete">Complete</Option>
                      <Option value="Incomplete">Incomplete</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Transaction #" name="transactionNumber">
                    <Input allowClear placeholder="e.g. 201236" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Bill-To Customer" name="billToCustomer">
                    <Input allowClear placeholder="Name or customer number" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Cross Reference" name="crossReference">
                    <Input allowClear placeholder="Cross reference" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Source" name="transactionSource">
                    <Input allowClear placeholder="e.g. Manual" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Transaction Date Range" name="dateRange">
                    <RangePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={24} md={8} lg={6}
                  style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                  <Space>
                    <Button type="primary" icon={<SearchOutlined />}
                      htmlType="submit" loading={searching}
                      style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                      Search
                    </Button>
                    <Button icon={<FilterOutlined />} onClick={() => {
                      searchForm.resetFields();
                      setSearchRows([]);
                      setGridFilter('');
                    }}>
                      Clear
                    </Button>
                  </Space>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* Results toolbar */}
          {searchRows.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                placeholder="Filter results..."
                value={gridFilter}
                onChange={e => setGridFilter(e.target.value)}
                allowClear style={{ width: 240 }} size="small"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {filteredRows.length} of {searchRows.length} credit memos
              </Text>
              <div style={{ flex: 1 }} />
              <Space size={16}>
                <Text style={{ fontSize: 12 }}>
                  Amount:{' '}
                  <Text strong style={{ fontFamily: 'monospace', color: totalAmount < 0 ? REDWOOD.primary : 'inherit' }}>
                    {fmt(totalAmount)}
                  </Text>
                </Text>
                <Text style={{ fontSize: 12 }}>
                  Balance Due:{' '}
                  <Text strong style={{ fontFamily: 'monospace' }}>{fmt(totalBalance)}</Text>
                </Text>
              </Space>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => exportToExcel(filteredRows)}>Export</Button>
              <Button size="small" icon={<ReloadOutlined />} loading={searching} onClick={handleSearch}>Refresh</Button>
            </div>
          )}

          {/* Results table */}
          <Table
            dataSource={filteredRows}
            columns={searchColumns}
            size="small"
            scroll={{ x: 1600 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
            loading={searching}
            rowKey="key"
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </div>
      ),
    },
    ...tabs.map(tab => ({
      key: tab.key,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileTextOutlined style={{ fontSize: 12, color: REDWOOD.primary }} />
          <span style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tab.row.transactionNumber || `CM ${tab.row.customerTransactionId}`}
          </span>
          <CloseOutlined
            style={{ fontSize: 10, color: REDWOOD.neutral600, marginLeft: 2 }}
            onClick={e => { e.stopPropagation(); closeTab(tab.key); }}
          />
        </span>
      ),
      children: renderCMPanel(tab),
    })),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{
          padding: '12px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /> Home</Link> },
            { title: <Link to="/ar">Accounts Receivable</Link> },
            { title: 'Manage Credit Memos' },
          ]} />
        </div>

        <div style={{ padding: 16 }}>
          {/* Page header */}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #E85D4A 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
            }}>
              <FileTextOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Manage Credit Memos</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Search and view AR credit memos synced from Oracle Fusion
              </Text>
            </div>
          </div>

          {/* Main tabs */}
          <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: '0 12px 12px' }}>
            <Tabs
              activeKey={activeKey}
              onChange={setActiveKey}
              items={tabItems}
              type="card"
              style={{ marginTop: 8 }}
            />
          </Card>
        </div>
      </Content>
      <FloatingMenu />
    </Layout>
  );
};

export default ManageCreditMemos;
